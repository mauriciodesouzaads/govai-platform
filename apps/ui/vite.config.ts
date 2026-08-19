// GovAI UI — static SPA build (UI/UX V1 U1).
//
// `base: '/app/'` is the promulgated production topology: the reverse proxy serves the built
// static assets under /app/ on the SAME origin the API answers on (/v1/*, /governed/*,
// /passthrough/*, /health), so CORS never enters the picture and no credential is ever sent
// cross-origin. The router carries the same basename (src/app/App.tsx).
//
// In development the dev server proxies the API prefixes to the local Fastify instance, which
// reproduces the same-origin production topology exactly — the browser only ever talks to one
// origin, in dev as in prod.
//
// NOTHING SECRET MAY REACH THIS FILE OR ANY VITE_* VALUE: every VITE_* is inlined into the
// client bundle and is therefore public. Only the API base URL and a build SHA are configurable.

import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const DEV_API_TARGET = process.env['GOVAI_UI_DEV_API_TARGET'] ?? 'http://127.0.0.1:8080';

// The API prefixes the dev server forwards. U1 only reads the first three, but proxying the
// whole API surface keeps dev same-origin identical to the production proxy contract.
const API_PREFIXES = ['/v1', '/governed', '/passthrough', '/health'];

export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2023',
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      API_PREFIXES.map((p) => [p, { target: DEV_API_TARGET, changeOrigin: false }]),
    ),
  },
});
