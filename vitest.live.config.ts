// Vitest config for live provider tests. Mirrors the main config but
// targets tests/live exclusively. The default `vitest.config.ts` excludes
// tests/live so normal CI never runs provider calls; this config is only
// reached via `pnpm test:live` or the equivalent direct CLI invocation.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/live/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 120_000,
    hookTimeout: 240_000,
    pool: 'forks',
  },
});
