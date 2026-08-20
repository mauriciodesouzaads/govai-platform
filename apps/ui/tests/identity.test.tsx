import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes } from '../src/app/routes.js';
import { renderApp, TEST_BASE_URL } from './render.js';
import { server, VALID_KEY } from './msw/server.js';
import { ME_PRINCIPAL, ORG_ID, USER_ID } from './msw/fixtures.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';
import { LOCALES, type Locale } from '../src/lib/i18n/locales.js';
import { I18nProvider } from '../src/lib/i18n/I18nProvider.js';
import { SessionProvider } from '../src/lib/session/SessionProvider.js';
import { EvidenceWindowProvider } from '../src/app/shell/evidence-window-context.js';
import { createCredentialStore } from '../src/lib/session/credential.js';

// GET /v1/me in the interface (EP-B2 §11).
//
// The rule under test is the one that has governed this UI from the first commit and did NOT
// change here: THE SHELL DISPLAYS ONLY WHAT A RESPONSE CARRIED. What changed is that a
// response now carries roles, commercial tier and operational mode. So every test below either
// proves a value came from the server, or proves the interface added nothing to it.

/** Serve a principal, keeping the real credential check so an unauthenticated render still
 *  behaves like the API. */
function servePrincipal(principal: Record<string, unknown>) {
  server.use(
    http.get('*/v1/me', ({ request }) => {
      const key =
        request.headers.get('x-govai-api-key') ??
        request.headers.get('authorization')?.replace(/^Bearer /, '') ??
        null;
      if (key !== VALID_KEY) {
        return HttpResponse.json({ error: 'auth_error', message: 'invalid' }, { status: 401 });
      }
      return HttpResponse.json(principal);
    }),
  );
}

async function renderAuthenticated(options: { locale?: Locale } = {}) {
  const result = renderApp(<AppRoutes />, {
    route: '/',
    credential: VALID_KEY,
    ...(options.locale ? { locale: options.locale } : {}),
  });
  await screen.findByTestId('coverage-panel');
  await screen.findByTestId('identity-cluster');
  return result;
}

describe('the operational mode is the server’s, not a constant', () => {
  it.each(['production', 'pilot', 'dev', 'test'])('renders %s exactly as reported', async (mode) => {
    servePrincipal({ ...ME_PRINCIPAL, operational_mode: mode });
    const { unmount } = await renderAuthenticated();
    expect(screen.getByTestId('identity-operational-mode')).toHaveTextContent(
      new RegExp(`${CATALOGS['pt-BR']['identity.operationalMode']}\\s*${mode}`),
    );
    unmount();
  });

  it('renders a mode this build has never seen, rather than hiding it', async () => {
    // The contract deliberately types this as a string (contract/me.ts): a new backend mode
    // must not take the sign-in probe — and therefore the whole application — down.
    servePrincipal({ ...ME_PRINCIPAL, operational_mode: 'staging' });
    await renderAuthenticated();
    expect(screen.getByTestId('identity-operational-mode')).toHaveTextContent('staging');
  });
});

describe('roles are the server’s, and the interface invents none', () => {
  it('shows nothing in the header for a key with no grants, and says so in the details', async () => {
    servePrincipal({ ...ME_PRINCIPAL, roles: [] });
    await renderAuthenticated();
    // No roles chip at all: an empty array is not a badge, and an empty badge is clutter.
    expect(screen.queryByTestId('identity-roles')).toBeNull();
    // But the fact IS stated where the reader goes looking for it — "no role granted" is an
    // assertion the backend made, not a value the interface failed to fetch.
    expect(screen.getByTestId('session-details-roles')).toHaveTextContent(
      CATALOGS['pt-BR']['identity.roles.none'],
    );
  });

  it('shows exactly the roles that were returned, and no others', async () => {
    servePrincipal({ ...ME_PRINCIPAL, roles: ['auditor', 'developer'] });
    await renderAuthenticated();
    const chip = screen.getByTestId('identity-roles');
    expect(chip).toHaveTextContent('auditor');
    expect(chip).toHaveTextContent('developer');
    for (const absent of ['admin', 'dlp_admin', 'data_protection_officer']) {
      expect(chip.textContent).not.toContain(absent);
    }
    expect(screen.getByTestId('session-details-roles')).toHaveTextContent('auditor developer');
  });

  it('renders an unrecognized role verbatim instead of dropping or renaming it', async () => {
    // The canonical filter is the SERVER's (apps/api/src/pipeline/auth.ts:68-71, proven by
    // apps/api/src/pipeline/auth.test.ts). If something ever gets past it, an auditor must SEE
    // it — a client-side second filter would hide the very fact that the backend changed.
    servePrincipal({ ...ME_PRINCIPAL, roles: ['some_future_role'] });
    await renderAuthenticated();
    expect(screen.getByTestId('identity-roles')).toHaveTextContent('some_future_role');
  });
});

describe('tier is commercial context and never a governance posture (residual R13)', () => {
  it('is absent from the header cluster even though the server sent it', async () => {
    servePrincipal({ ...ME_PRINCIPAL, tier: 'regulated' });
    await renderAuthenticated();
    expect(screen.getByTestId('identity-cluster').textContent ?? '').not.toContain('regulated');
  });

  it('appears only in the account/details affordance, carrying its qualifier', async () => {
    servePrincipal({ ...ME_PRINCIPAL, tier: 'regulated' });
    await renderAuthenticated();
    const tier = screen.getByTestId('session-details-tier');
    expect(tier).toHaveTextContent('regulated');
    expect(tier).toHaveTextContent(CATALOGS['pt-BR']['identity.tier.qualifier']);
  });

  it('states, in every language, that the plan is not a governance or security level', async () => {
    for (const locale of LOCALES) {
      servePrincipal(ME_PRINCIPAL);
      const { unmount } = await renderAuthenticated({ locale });
      expect(screen.getByTestId('identity-tier-note')).toHaveTextContent(
        CATALOGS[locale]['identity.tier.note'],
      );
      unmount();
    }
  });
});

describe('the principal type is represented honestly', () => {
  it('names the API key, not a login', async () => {
    await renderAuthenticated();
    expect(screen.getByTestId('identity-principal')).toHaveTextContent(
      CATALOGS['pt-BR']['status.principalType.api_key'],
    );
    // The raw value travels with the label, as every status badge in this app does.
    expect(screen.getByTestId('identity-principal')).toHaveTextContent('api_key');
  });

  it('degrades an unknown principal type to an explicit unknown, never to the API-key copy', async () => {
    // A future `user_session` principal must NOT inherit wording written for a controlled-pilot
    // API key: that would be the interface claiming a maturity the runtime has not reached.
    servePrincipal({ ...ME_PRINCIPAL, principal_type: 'user_session' });
    await renderAuthenticated();
    const principal = screen.getByTestId('identity-principal');
    expect(principal).toHaveTextContent(CATALOGS['pt-BR']['status.unknown']);
    expect(principal).toHaveTextContent('user_session');
    expect(principal.textContent ?? '').not.toContain(
      CATALOGS['pt-BR']['status.principalType.api_key'],
    );
  });

  it('states that production human authentication is not implemented, in every language', async () => {
    for (const locale of LOCALES) {
      const { unmount } = await renderAuthenticated({ locale });
      expect(screen.getByTestId('identity-no-production-auth')).toHaveTextContent(
        CATALOGS[locale]['identity.noProductionAuth'],
      );
      unmount();
    }
  });

  it('says out loud that the server is the authority for every value shown', async () => {
    await renderAuthenticated();
    expect(screen.getByTestId('identity-server-authoritative')).toHaveTextContent(
      CATALOGS['pt-BR']['identity.serverAuthoritative'],
    );
  });
});

describe('the identity affordance is read-only', () => {
  it('offers no control that would edit, grant or switch anything', async () => {
    await renderAuthenticated();
    const details = screen.getByTestId('session-details');
    expect(within(details).queryAllByRole('button')).toHaveLength(0);
    expect(within(details).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(details).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(details).queryAllByRole('link')).toHaveLength(0);
  });

  it('adds no navigation: the shell still offers exactly the three U1 areas', async () => {
    await renderAuthenticated();
    const nav = screen.getByRole('navigation', { name: CATALOGS['pt-BR']['app.nav.label'] });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['/', '/audit-events', '/capabilities']);
  });
});

describe('the identity lives in memory and nowhere else', () => {
  it('writes no identity value to localStorage, sessionStorage or a cookie', async () => {
    await renderAuthenticated();
    const persisted = [
      JSON.stringify(window.localStorage),
      JSON.stringify(window.sessionStorage),
      document.cookie,
    ].join('|');
    for (const secret of [VALID_KEY, ORG_ID, USER_ID, 'api_key', 'starter']) {
      expect(persisted, `"${secret}" must not be persisted`).not.toContain(secret);
    }
  });

  it('is dropped with the credential on sign-out', async () => {
    const store = createCredentialStore();
    const { user } = renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY, store });
    await screen.findByTestId('identity-cluster');
    await user.click(screen.getByTestId('sign-out'));
    await waitFor(() => expect(store.hasCredential()).toBe(false));
    expect(screen.queryByTestId('identity-cluster')).toBeNull();
    expect(screen.queryByTestId('session-details')).toBeNull();
  });

  it('is dropped when the API rejects the credential mid-session', async () => {
    const store = createCredentialStore();
    renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY, store });
    await screen.findByTestId('identity-cluster');

    server.use(
      http.get('*/v1/me', () =>
        HttpResponse.json({ error: 'auth_error', message: 'invalid api key' }, { status: 401 }),
      ),
      http.get('*/v1/evidence/summary', () =>
        HttpResponse.json({ error: 'auth_error', message: 'invalid api key' }, { status: 401 }),
      ),
    );
    const second = renderApp(<AppRoutes />, { route: '/', store });
    await waitFor(() => expect(store.hasCredential()).toBe(false));
    second.unmount();
  });
});

describe('the /v1/me contract is validated before anything is rendered', () => {
  it('refuses a body that does not match the mirrored contract', async () => {
    // A shape change must surface as an explicit failure, never as blank fields a reader would
    // take for "this organization has no roles".
    server.use(
      http.get('*/v1/me', () => HttpResponse.json({ org_id: ORG_ID, roles: 'admin' })),
    );
    const { user, store } = renderApp(<AppRoutes />, { route: '/enter' });
    await user.type(await screen.findByTestId('api-key-input'), VALID_KEY);
    await user.click(screen.getByTestId('enter-submit'));
    expect(await screen.findByTestId('enter-error')).toHaveTextContent(
      CATALOGS['pt-BR']['enter.error.unknown'],
    );
    expect(store.hasCredential()).toBe(false);
  });

  it('carries an additive backend field through instead of failing on it', async () => {
    servePrincipal({ ...ME_PRINCIPAL, some_new_field: 'x' });
    await renderAuthenticated();
    expect(screen.getByTestId('identity-cluster')).toBeInTheDocument();
  });
});

describe('signing in obtains the principal without a duplicate request', () => {
  it('probes /v1/me exactly once and never re-probes after it succeeds', async () => {
    let meCalls = 0;
    server.use(
      http.get('*/v1/me', ({ request }) => {
        if (request.headers.get('x-govai-api-key') !== VALID_KEY) {
          return HttpResponse.json({ error: 'auth_error', message: 'invalid' }, { status: 401 });
        }
        meCalls += 1;
        return HttpResponse.json(ME_PRINCIPAL);
      }),
    );
    const { user } = renderApp(<AppRoutes />, { route: '/enter' });
    await user.type(await screen.findByTestId('api-key-input'), VALID_KEY);
    await user.click(screen.getByTestId('enter-submit'));
    await screen.findByTestId('coverage-panel');
    await screen.findByTestId('identity-cluster');
    // The adoption effect must not fire after a sign-in that already set the principal.
    await waitFor(() => expect(meCalls).toBe(1));
    // Navigating does not re-probe: identity is session state, not per-screen state.
    await user.click(screen.getByRole('link', { name: CATALOGS['pt-BR']['app.nav.capabilities'] }));
    await screen.findByTestId('capability-filter');
    expect(meCalls).toBe(1);
  });
});

describe('the session survives React’s development double-invocation', () => {
  it('adopts a credential under <StrictMode>, which mounts every effect twice', async () => {
    // ★ REGRESSION. The application really does render under <StrictMode> (src/main.tsx), so
    // an adoption guarded by a cancel-on-unmount closure flag would be defeated by StrictMode's
    // mount → unmount → remount: the first cleanup flips the flag, the remount bails on the
    // still-in-flight ref, and the response is then thrown away by the flag meant to protect
    // it — leaving a session with a credential and no principal, in development only. Renders
    // the real providers inside StrictMode rather than through renderApp(), whose wrapper sits
    // outside it and would therefore not double-invoke the SessionProvider effect under test.
    const store = createCredentialStore();
    store.set(VALID_KEY);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
    });
    render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <I18nProvider initial="pt-BR">
            <SessionProvider baseUrl={TEST_BASE_URL} store={store}>
              <EvidenceWindowProvider>
                <MemoryRouter initialEntries={['/']}>
                  <AppRoutes />
                </MemoryRouter>
              </EvidenceWindowProvider>
            </SessionProvider>
          </I18nProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(await screen.findByTestId('identity-cluster')).toHaveTextContent(
      ME_PRINCIPAL.operational_mode,
    );
  });
});
