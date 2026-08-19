// Component/data-layer test runner for @govai/ui. Kept SEPARATE from vite.config.ts so the
// production build config carries no test-only surface, and separate from the repo-root
// vitest.config.ts (node environment) because these tests need a DOM.
//
// The root `pnpm test` excludes apps/ui/** (see the repo-root vitest.config.ts) — the UI suite
// runs through `pnpm --filter @govai/ui test`, which the CI `ui` job invokes.

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    restoreMocks: true,
  },
});
