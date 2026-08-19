import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { I18nProvider } from '../src/lib/i18n/I18nProvider.js';
import { SessionProvider } from '../src/lib/session/SessionProvider.js';
import { EvidenceWindowProvider } from '../src/app/shell/evidence-window-context.js';
import { createCredentialStore, type CredentialStore } from '../src/lib/session/credential.js';
import type { Locale } from '../src/lib/i18n/locales.js';
import type { WindowOption } from '../src/lib/window.js';

// A test host that wires the real providers, so a component test exercises the real session,
// i18n and query layers rather than a stand-in.
//
// `baseUrl` is absolute because the test runtime's fetch (undici under jsdom) cannot parse a
// relative URL. The MSW handlers match any origin, so this changes nothing the code under test
// can observe — the application itself defaults to same-origin.
export const TEST_BASE_URL = 'http://govai.test';

/** A query client with retries OFF: a component test asserts one deterministic outcome, and a
 *  retry would only turn a real failure into a timeout. */
function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
  });
}

export type RenderAppOptions = {
  /** Initial router entry, e.g. `/evidence/gaps/ec2`. */
  route?: string;
  /** Route pattern when the component reads path params. */
  path?: string;
  locale?: Locale;
  evidenceWindow?: WindowOption;
  /** Pre-authenticate by seeding the credential store. */
  credential?: string;
  store?: CredentialStore;
  queryClient?: QueryClient;
};

export type RenderAppResult = RenderResult & {
  user: ReturnType<typeof userEvent.setup>;
  store: CredentialStore;
  queryClient: QueryClient;
};

export function renderApp(ui: ReactElement, options: RenderAppOptions = {}): RenderAppResult {
  const store = options.store ?? createCredentialStore();
  if (options.credential) store.set(options.credential);
  const queryClient = options.queryClient ?? testQueryClient();
  const route = options.route ?? '/';

  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <I18nProvider initial={options.locale ?? 'pt-BR'}>
        <SessionProvider baseUrl={TEST_BASE_URL} store={store}>
          <EvidenceWindowProvider
            {...(options.evidenceWindow ? { initial: options.evidenceWindow } : {})}
          >
            <MemoryRouter initialEntries={[route]}>
              {options.path ? (
                <Routes>
                  <Route path={options.path} element={children} />
                </Routes>
              ) : (
                children
              )}
            </MemoryRouter>
          </EvidenceWindowProvider>
        </SessionProvider>
      </I18nProvider>
    </QueryClientProvider>
  );

  const result = render(ui, { wrapper });
  return { ...result, user: userEvent.setup(), store, queryClient };
}
