import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment: the code under test is server-side (config validation,
    // Notion and DeepSeek clients, draft store). Browser tests for the PWA
    // client will need their own environment when they arrive.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],

    // The project has no tests yet, so a bare `npm test` on a fresh checkout
    // should not fail. Once the suite has real coverage this should be removed
    // so an empty run is an error rather than a silent pass.
    passWithNoTests: true,
  },
});
