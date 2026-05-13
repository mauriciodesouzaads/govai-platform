import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      'tests/integration/**/*.test.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/live/**',
    ],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: [
        'packages/core-audit/src/**/*.ts',
        'packages/core-events/src/**/*.ts',
        'packages/core-governance/src/**/*.ts',
        'packages/core-identity/src/**/*.ts',
        'packages/core-types/src/**/*.ts',
        'packages/dlp-br/src/**/*.ts',
        // PR3.1a — tenant provider credential bridge code + resolver.
        'apps/api/src/scripts/**/*.ts',
        'apps/api/src/pipeline/provider-credentials.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'packages/dlp-br/scripts/**'],
      thresholds: {
        // Active gate per runtime-patch-1 §3.1.6.
        // append.ts and verify.ts are exercised by integration tests; configured
        // accordingly so the gate measures real production paths.
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
