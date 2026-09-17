import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Next.js 16 writes AGENTS.md and CLAUDE.md into the repo root on the first
  // `next dev`. This project's agent configuration is managed by OpenSpec
  // (openspec/, .github/skills, .claude/skills), so an auto-generated pair of
  // root-level files would be unmanaged noise. Set to `true` to get Next.js's
  // own agent rules instead.
  agentRules: false,
};

export default nextConfig;
