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
        'packages/provider-anthropic/src/**/*.ts',
        'packages/provider-openai/src/**/*.ts',
        // PR3.1a — tenant provider credential bridge code + resolver.
        'apps/api/src/scripts/**/*.ts',
        'apps/api/src/pipeline/provider-credentials.ts',
        // Phase 2.5 — AuditBridge PR-A (EP-001) new pipeline modules.
        'apps/api/src/pipeline/audit-bridge.ts',
        'apps/api/src/pipeline/audit-keys.ts',
        'apps/api/src/pipeline/request-identity.ts',
        // Phase 3 — B3 AuditSealer runner (EP-006): the well-tested modules
        // (entrypoint/wiring/signal-handlers excluded, mirroring apps/api).
        'apps/audit-sealer/src/config.ts',
        'apps/audit-sealer/src/backoff.ts',
        'apps/audit-sealer/src/phase-role.ts',
        'apps/audit-sealer/src/metrics.ts',
        'apps/audit-sealer/src/startup-validation.ts',
        'apps/audit-sealer/src/seal-once.ts',
        'apps/audit-sealer/src/stale-recovery.ts',
        'apps/audit-sealer/src/claim-loop.ts',
        'apps/audit-sealer/src/health.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'packages/dlp-br/scripts/**'],
      thresholds: {
        // Active gate per runtime-patch-1 §3.1.6.
        // append.ts and verify.ts are exercised by integration tests; configured
        // accordingly so the gate measures real production paths.
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
