// CONT-P5-A — PROCESS TIER vitest config (dispatch §2 tests, §5 exit gate).
//
//   CODEX_PIN_BINARY=<absolute path of the extracted §0 member> \
//   CODEX_PIN_ARCHIVE=<absolute path of the §0 release archive> \
//   pnpm exec vitest run --config apps/api/src/ai-conversations/harness/codex/vitest.process.config.ts
//
// This tier runs ONLY the mandatory no-credential process-integration suite (`*.process.test.ts`) and marks
// itself with GOVAI_CODEX_PROCESS_TIER=1, under which that suite FAILS — never skips — when the pinned binary is
// missing, is the wrong asset, has the wrong archive/executable digest, the wrong version, the wrong
// CODEX_HOME, experimentalApi enabled, or any attestation predicate fails. CI runs the unit tier only (root
// vitest.config.ts); the PR is review-eligible only once the executor's report carries this tier's evidence.

import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const REPO_ROOT = fileURLToPath(new URL('../../../../../../', import.meta.url));

export default defineConfig({
  root: REPO_ROOT,
  test: {
    environment: 'node',
    globals: false,
    include: ['apps/api/src/ai-conversations/harness/codex/**/*.process.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    env: { GOVAI_CODEX_PROCESS_TIER: '1' },
    passWithNoTests: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: 'forks',
  },
});
