/**
 * Next.js runs `register` once when the server starts.
 *
 * Configuration is validated here so the app refuses to start on an incomplete
 * environment rather than failing later, mid-write, with a partial Notion
 * binding (`specs/notion-integration` — "Budget binding is configuration").
 */
export async function register(): Promise<void> {
  // Only the Node runtime serves requests and holds credentials.
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  // A production build is not a start. Skipping validation here keeps
  // `next build` runnable without secrets; the server still validates on boot,
  // which is what the spec requires.
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    return;
  }

  const { loadConfig } = await import('./config');
  loadConfig();
}
