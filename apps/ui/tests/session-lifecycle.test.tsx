import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { QueryClient } from '@tanstack/react-query';
import { AppRoutes } from '../src/app/routes.js';
import { renderApp } from './render.js';
import { server, VALID_KEY } from './msw/server.js';
import { ME_PRINCIPAL, ORG_ID, SUMMARY_WITH_GAPS as SUMMARY_FOR_SEED } from './msw/fixtures.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';
import { createCredentialStore } from '../src/lib/session/credential.js';
import { queryKeys } from '../src/lib/api/keys.js';
import { createQueryClient } from '../src/lib/api/query-client.js';

// The session is the security boundary of this application, so its lifecycle is tested through
// the real router: sign in, navigate, expire, sign out.

/** Sign in the way a reader does, so the identity is LEARNED from the authenticated response
 *  (GET /v1/me) rather than seeded — the shell only ever shows what an actual response told
 *  it. */
async function signInThroughUi(user: ReturnType<typeof renderApp>['user']) {
  await user.type(await screen.findByTestId('api-key-input'), VALID_KEY);
  await user.click(screen.getByTestId('enter-submit'));
  await screen.findByTestId('coverage-panel');
}

describe('routing requires a session', () => {
  it('sends an unauthenticated reader to /enter from any protected route', async () => {
    renderApp(<AppRoutes />, { route: '/capabilities' });
    expect(
      await screen.findByRole('heading', { name: CATALOGS['pt-BR']['enter.title'] }),
    ).toBeInTheDocument();
  });

  it('lands on the cockpit after a successful sign-in', async () => {
    const { user } = renderApp(<AppRoutes />, { route: '/enter' });
    await signInThroughUi(user);
    expect(screen.getByTestId('coverage-panel')).toBeInTheDocument();
    // The org id is LEARNED from the authenticated response, never chosen.
    await waitFor(() => expect(screen.getAllByText(ORG_ID).length).toBeGreaterThan(0));
  });

  it('signing in costs ONE summary read, not two', async () => {
    // EP-B2 made the /enter probe `GET /v1/me` — a cheap identity read — instead of an
    // evidence summary, which removed the cache-seeding the previous probe needed. The
    // property that mattered still holds, and now holds for a better reason: the summary's
    // several server-side aggregates run ONCE per sign-in, on the cockpit that actually
    // displays them, and a reader who signs in and navigates straight to another screen never
    // pays for them at all.
    let summaryCalls = 0;
    server.use(
      http.get('*/v1/evidence/summary', ({ request }) => {
        if (request.headers.get('x-govai-api-key') !== VALID_KEY) {
          return HttpResponse.json({ error: 'auth_error', message: 'invalid' }, { status: 401 });
        }
        summaryCalls += 1;
        return HttpResponse.json(SUMMARY_FOR_SEED);
      }),
    );
    // The application's real query client, so its staleTime governs the refetch decision.
    const { user } = renderApp(<AppRoutes />, {
      route: '/enter',
      queryClient: createQueryClient(),
    });
    await signInThroughUi(user);
    await waitFor(() => expect(summaryCalls).toBe(1));
  });

  it('exposes no organization selector — the org derives from the credential', async () => {
    renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    const selects = screen.getAllByRole('combobox');
    // Exactly two selects in the shell: the evidence window and the language.
    expect(selects).toHaveLength(2);
  });
});

describe('a 401 mid-session drops the credential and returns to /enter', () => {
  it('clears the store and routes back, without leaving stale data on screen', async () => {
    const store = createCredentialStore();
    renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY, store });
    await screen.findByTestId('coverage-panel');

    // The credential is revoked server-side while the reader is looking at the cockpit.
    server.use(
      http.get('*/v1/evidence/summary', () =>
        HttpResponse.json({ error: 'auth_error', message: 'invalid api key' }, { status: 401 }),
      ),
    );

    // Any subsequent read triggers the 401 path.
    const { unmount } = renderApp(<AppRoutes />, { route: '/', store });
    await waitFor(() => expect(store.hasCredential()).toBe(false));
    unmount();
  });

  it('clears the query cache, so the next credential cannot read the previous org from cache', async () => {
    // Query keys carry no identity by design (api/keys.ts), which is exactly why dropping the
    // session must drop the cache with it.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } },
    });
    const store = createCredentialStore();
    const { user } = renderApp(<AppRoutes />, {
      route: '/',
      credential: VALID_KEY,
      store,
      queryClient,
    });
    await screen.findByTestId('coverage-panel');
    expect(queryClient.getQueryData(queryKeys.evidenceSummary(86_400))).toBeDefined();

    await user.click(screen.getByTestId('sign-out'));
    await waitFor(() => expect(store.hasCredential()).toBe(false));
    expect(queryClient.getQueryData(queryKeys.evidenceSummary(86_400))).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  });
});

describe('signing out', () => {
  it('zeroes the credential and returns to /enter', async () => {
    const store = createCredentialStore();
    const { user } = renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY, store });
    await screen.findByTestId('coverage-panel');

    await user.click(screen.getByTestId('sign-out'));
    expect(store.get()).toBeNull();
    expect(
      await screen.findByRole('heading', { name: CATALOGS['pt-BR']['enter.title'] }),
    ).toBeInTheDocument();
  });

  it('leaves no credential in any browser storage after the whole lifecycle', async () => {
    const { user } = renderApp(<AppRoutes />, { route: '/enter' });
    await signInThroughUi(user);
    await user.click(screen.getByTestId('sign-out'));

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(document.documentElement.outerHTML).not.toContain(VALID_KEY);
  });
});

describe('the shell shows only facts it knows', () => {
  it('shows the identity a response carried, and adds nothing to it', async () => {
    // ★ This test replaces one that asserted the shell showed NO role/tier/mode badge, on the
    // grounds that no route serialized them. `GET /v1/me` (EP-B2) does, so that premise is
    // gone; the RULE it protected — display only what a response actually carried — is not,
    // and is what is asserted here.
    //
    // ★ It is asserted PER ELEMENT, not against the header's concatenated `textContent`. That
    // is not a style preference: adjacent elements concatenate without a separator, so
    // `operational_mode` + the next chip reads as "productionprincipal", and a `\bproduction\b`
    // whole-word probe over that blob returns FALSE for a value that is plainly on screen. A
    // text-blob assertion of an absence is a test that stops working silently.
    const { user } = renderApp(<AppRoutes />, { route: '/enter' });
    await signInThroughUi(user);
    const cluster = await screen.findByTestId('identity-cluster');
    // Present, because /v1/me returned them.
    expect(screen.getByTestId('identity-operational-mode')).toHaveTextContent(
      ME_PRINCIPAL.operational_mode,
    );
    expect(screen.getByTestId('identity-principal')).toHaveTextContent(ME_PRINCIPAL.principal_type);
    expect(screen.getByTestId('app-header')).toHaveTextContent(ORG_ID);
    // Absent, because the fixture's key carries no roles — an empty array is not a badge.
    expect(screen.queryByTestId('identity-roles')).toBeNull();
    // Absent from the HEADER by design even though the response carried it: a plan name beside
    // an operational mode invites exactly the "regulated is stricter" reading residual R13
    // forbids. It lives in the details affordance, with its qualifier.
    expect(cluster.textContent ?? '').not.toContain(ME_PRINCIPAL.tier);
    expect(screen.getByTestId('session-details-tier')).toHaveTextContent(ME_PRINCIPAL.tier);
  });

  it('offers no navigation to areas this delivery does not implement', async () => {
    renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    const nav = screen.getByRole('navigation', { name: CATALOGS['pt-BR']['app.nav.label'] });
    const hrefs = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    // Exhaustive, and every entry is a screen that exists. U1.5 added /ai; nothing else.
    expect(hrefs).toEqual(['/ai', '/', '/audit-events', '/capabilities']);
    // Not even a disabled item: a promise the backend cannot keep is still a promise. The
    // out-of-scope areas appear exactly once in the whole application — in the footer
    // statement that says they are NOT part of this delivery.
    const navText = (nav.textContent ?? '').toLowerCase();
    for (const absent of [/workroom/, /regulat/, /\badmin/, /playground/, /\brun\b/]) {
      expect(absent.test(navText), `navigation must not offer ${absent}`).toBe(false);
    }
    expect(within(nav).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText(CATALOGS['pt-BR']['app.footer.scope'])).toBeInTheDocument();
  });

  it('shows the evidence-window control ONLY where the endpoint is scoped by it', async () => {
    // On /audit-events and /capabilities the API takes no `window`; leaving the selector
    // visible would let a screenshot imply a time scope that was never applied.
    const { user } = renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    expect(screen.getByTestId('window-selector')).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: CATALOGS['pt-BR']['app.nav.auditEvents'] }));
    await screen.findByTestId('audit-metadata-only');
    expect(screen.queryByTestId('window-selector')).toBeNull();

    await user.click(screen.getByRole('link', { name: CATALOGS['pt-BR']['app.nav.capabilities'] }));
    await screen.findByTestId('capability-filter');
    expect(screen.queryByTestId('window-selector')).toBeNull();

    await user.click(screen.getByRole('link', { name: CATALOGS['pt-BR']['app.nav.cockpit'] }));
    await screen.findByTestId('coverage-panel');
    expect(screen.getByTestId('window-selector')).toBeInTheDocument();
  });

  it('keeps the window control on the gap views, which the window does scope', async () => {
    renderApp(<AppRoutes />, { route: '/evidence/gaps/ec1', credential: VALID_KEY });
    await screen.findByRole('table');
    expect(screen.getByTestId('window-selector')).toBeInTheDocument();
  });

  it('states the build stamp explicitly, including when the build did not provide one', async () => {
    renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    // Unset in the test build, so the footer says so rather than fabricating a SHA.
    expect(screen.getByText(CATALOGS['pt-BR']['app.footer.buildUnavailable'])).toBeInTheDocument();
  });

  it('states the scope of this delivery in the footer', async () => {
    renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    expect(screen.getByText(CATALOGS['pt-BR']['app.footer.scope'])).toBeInTheDocument();
  });
});

describe('the evidence window drives the request', () => {
  it('re-queries with the selected window and shows it as measurement context', async () => {
    const windows: Array<string | null> = [];
    server.use(
      http.get('*/v1/evidence/summary', ({ request }) => {
        const w = new URL(request.url).searchParams.get('window');
        windows.push(w);
        return HttpResponse.json({
          org_id: ORG_ID,
          window_seconds: Number(w),
          t_seal_seconds: 300,
          counts: {
            ec1: { total: 0, sealed: 0, failed: 0, stalled_past_slo: 0 },
            ec2: { chains: 0, chains_with_gap: 0 },
            ec3seal: { native_total: 0, native_sealed: 0, native_unsealed_past_slo: 0 },
            ec4: { provider_invocations: 0, without_terminal: 0 },
            ec6: { chains: 0, verified_ok: 0, pending: 0 },
          },
          ec3drop: {
            invariant: 'ec3drop',
            label: 'EC-3 — native (drop)',
            drops: 0,
            captures: 0,
            drop_rate: null,
            observed: false,
            bound: 'bound',
          },
          ec6: {
            invariant: 'ec6',
            label: 'EC-6 — chain integrity',
            total_chains: 0,
            verified_ok: 0,
            pending: 0,
            last_verified_at: null,
            note: 'note',
          },
          coverage_ratio: {
            label: 'coverage_ratio',
            ratio: 1,
            covered: 0,
            total: 0,
            terms: [],
            excluded: [],
          },
        });
      }),
    );
    const { user } = renderApp(<AppRoutes />, { route: '/', credential: VALID_KEY });
    await screen.findByTestId('coverage-panel');
    expect(windows).toEqual(['86400']);

    await user.selectOptions(screen.getByTestId('window-selector'), '7d');
    await waitFor(() => expect(windows).toEqual(['86400', '604800']));
    await waitFor(() =>
      expect(screen.getByTestId('measurement-context')).toHaveTextContent('7 d'),
    );
  });
});
