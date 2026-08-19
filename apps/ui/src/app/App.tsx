import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { createQueryClient } from '../lib/api/query-client.js';
import { I18nProvider } from '../lib/i18n/I18nProvider.js';
import { SessionProvider } from '../lib/session/SessionProvider.js';
import { EvidenceWindowProvider } from './shell/evidence-window-context.js';
import { AppRoutes } from './routes.js';

/**
 * The SPA basename. It must match Vite's `base` (/app/) so the built static bundle and the
 * router agree under the production reverse proxy. `import.meta.env.BASE_URL` is exactly that
 * value, with the trailing slash the router does not want.
 */
export const routerBasename = import.meta.env.BASE_URL.replace(/\/$/, '');

/**
 * The API base URL. Empty means same-origin, which is the production topology (the proxy serves
 * /app/ and /v1/* from one origin) and also the dev topology (the Vite dev server proxies the
 * API prefixes). It is a PUBLIC build-time value: nothing secret may ever be configured here.
 */
export const apiBaseUrl = import.meta.env.VITE_GOVAI_API_BASE_URL ?? '';

export function App() {
  // Created once per application instance, never re-created on render — a new QueryClient
  // would silently discard the cache and re-issue every request against the shared rate limit.
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <SessionProvider baseUrl={apiBaseUrl}>
          <EvidenceWindowProvider>
            <BrowserRouter basename={routerBasename}>
              <AppRoutes />
            </BrowserRouter>
          </EvidenceWindowProvider>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
