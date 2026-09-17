import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json. Vitest does not read
    // tsconfig paths on its own, so without this a runtime `@/` import would
    // resolve under `next build` and fail under `npm test`.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Node environment: the code under test is server-side (config validation,
    // Notion and DeepSeek clients, extraction, draft store). Browser tests for
    // the PWA client will need their own environment when they arrive.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // No `passWithNoTests`: the suite has real coverage now, so a run that finds
    // no tests should fail rather than pass quietly.
  },
});
