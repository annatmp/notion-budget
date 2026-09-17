import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Credentials stay server-side.
 *
 * The Notion token grants write access to a live budget and the DeepSeek key is
 * billed, so neither may reach the browser. In the App Router that is structural
 * rather than incidental: a module only becomes client code if it opts in with
 * `'use client'`, so the way to break this is for a client component to import
 * something that reaches the configuration.
 *
 * This is a static check, and it is deliberately the cheap one: it runs on every
 * `npm test`, with no build and no credentials. The complementary check — that
 * the built bundles contain no credential — needs a build and lives in the
 * verification notes rather than here.
 */

const srcRoot = fileURLToPath(new URL('.', import.meta.url));

/** Modules that hold, or can reach, a credential. */
const SERVER_ONLY = [
  '@/config',
  '@/runtime',
  '@/notion',
  '@/extract',
  '@/drafts',
  '@/auth',
  '@/ratelimit',
  '@/api',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sourceFiles(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

function importsOf(source: string): string[] {
  return [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1] as string);
}

describe('credentials never reach the client', () => {
  const files = sourceFiles(srcRoot);

  const clientComponents = files.filter((file) =>
    /^\s*['"]use client['"]/m.test(readFileSync(file, 'utf8')),
  );

  it('has no client component importing anything that reaches a credential', () => {
    const offenders: string[] = [];

    for (const file of clientComponents) {
      for (const specifier of importsOf(readFileSync(file, 'utf8'))) {
        const reachesServer = SERVER_ONLY.some(
          (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
        );
        if (reachesServer) {
          offenders.push(`${relative(srcRoot, file)} imports ${specifier}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('exposes no environment variable to the browser', () => {
    // A `NEXT_PUBLIC_` prefix is the only way a value is inlined into a client
    // bundle, so none may name a credential.
    const exposed = files
      .flatMap((file) => [...readFileSync(file, 'utf8').matchAll(/NEXT_PUBLIC_[A-Z0-9_]*/g)])
      .map((match) => match[0]);

    expect(exposed).toEqual([]);
  });

  it('declares no public variable in the environment template', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');

    expect(example).not.toMatch(/NEXT_PUBLIC_/);
  });

  it('keeps every route handler on the server', () => {
    // A route under app/api is server code by definition; marking one
    // `'use client'` would be a mistake that silently changes the bundling.
    const routes = files.filter((file) => relative(srcRoot, file).startsWith('app/api/'));

    expect(routes.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(readFileSync(route, 'utf8')).not.toMatch(/^\s*['"]use client['"]/m);
    }
  });
});
