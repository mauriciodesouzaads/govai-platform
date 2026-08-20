import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { EnterKeyPage } from '../src/features/auth/EnterKeyPage.js';
import { renderApp } from './render.js';
import { server, VALID_KEY } from './msw/server.js';
import { CATALOGS } from '../src/lib/i18n/catalogs/index.js';

// /enter is where the credential enters the application. These tests pin both halves of that:
// the probe really validates against the API, and the key really goes nowhere it must not.
//
// EP-B2 changed WHICH read the probe makes — `GET /v1/me` rather than an evidence aggregate —
// so the failure-path stubs below target that route. What the probe must prove is unchanged:
// a real authenticated read, writing nothing, whose outcome alone decides whether the key
// becomes the session credential.

async function submitKey(user: ReturnType<typeof renderApp>['user'], key: string) {
  await user.type(screen.getByTestId('api-key-input'), key);
  await user.click(screen.getByTestId('enter-submit'));
}

describe('/enter — valid key', () => {
  it('validates against a real authenticated read and starts the session', async () => {
    const { user, store } = renderApp(<EnterKeyPage />, { route: '/enter' });
    await submitKey(user, VALID_KEY);
    await waitFor(() => expect(store.hasCredential()).toBe(true));
    expect(store.get()).toBe(VALID_KEY);
  });

  it('leaves no trace of the credential in the DOM once it is accepted', async () => {
    const { user, store } = renderApp(<EnterKeyPage />, { route: '/enter' });
    await submitKey(user, VALID_KEY);
    await waitFor(() => expect(store.hasCredential()).toBe(true));

    // The field is cleared before the transition, and the screen then leaves /enter — either
    // way the live DOM must not still hold the key.
    await waitFor(() => {
      const live = screen.queryByTestId('api-key-input') as HTMLInputElement | null;
      expect(live === null || live.value === '').toBe(true);
    });
    expect(document.documentElement.outerHTML).not.toContain(VALID_KEY);
  });

  it('never persists the key in localStorage, sessionStorage or a cookie', async () => {
    const { user, store } = renderApp(<EnterKeyPage />, { route: '/enter' });
    await submitKey(user, VALID_KEY);
    await waitFor(() => expect(store.hasCredential()).toBe(true));

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
    expect(JSON.stringify(window.localStorage)).not.toContain(VALID_KEY);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(VALID_KEY);
  });

  it('marks the input as a password field that no autofill will remember', () => {
    renderApp(<EnterKeyPage />, { route: '/enter' });
    const input = screen.getByTestId('api-key-input') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocapitalize')).toBe('off');
  });
});

describe('/enter — rejection paths', () => {
  it('a 401 keeps the reader on /enter with a localized failure and no stored key', async () => {
    const { user, store } = renderApp(<EnterKeyPage />, { route: '/enter' });
    await submitKey(user, 'govai_sk_wrong-key-value-000000000');

    const error = await screen.findByTestId('enter-error');
    expect(error).toHaveTextContent(CATALOGS['pt-BR']['enter.error.auth']);
    expect(store.hasCredential()).toBe(false);
    expect(store.get()).toBeNull();
  });

  it('a rejected key is never stored, not even transiently', async () => {
    // Every value the store ever holds during the attempt is recorded. The probe passes the
    // candidate as a function argument, so the store is only ever cleared — never set — and a
    // rejected credential is never the session credential for even one tick.
    const observed: Array<string | null> = [];
    const { user, store } = renderApp(<EnterKeyPage />, { route: '/enter' });
    const unsubscribe = store.subscribe(() => observed.push(store.get()));
    await submitKey(user, 'govai_sk_wrong-key-value-000000000');
    await screen.findByTestId('enter-error');
    unsubscribe();
    expect(observed.every((v) => v === null)).toBe(true);
    expect(store.get()).toBeNull();
  });

  it('a network failure is reported as such, not as a bad key', async () => {
    server.use(http.get('*/v1/me', () => HttpResponse.error()));
    const { user } = renderApp(<EnterKeyPage />, { route: '/enter' });
    await submitKey(user, VALID_KEY);
    const error = await screen.findByTestId('enter-error');
    expect(error).toHaveTextContent(CATALOGS['pt-BR']['enter.error.network']);
  });

  it('a server error is reported as retryable, not as a rejected credential', async () => {
    server.use(
      http.get('*/v1/me', () => HttpResponse.json({ error: 'internal' }, { status: 500 })),
    );
    const { user } = renderApp(<EnterKeyPage />, { route: '/enter' });
    await submitKey(user, VALID_KEY);
    const error = await screen.findByTestId('enter-error');
    expect(error).toHaveTextContent(CATALOGS['pt-BR']['enter.error.server']);
  });

  it('an empty submission is refused before any request is made', async () => {
    const { user } = renderApp(<EnterKeyPage />, { route: '/enter' });
    await user.click(screen.getByTestId('enter-submit'));
    expect(await screen.findByTestId('enter-error')).toHaveTextContent(
      CATALOGS['pt-BR']['enter.error.empty'],
    );
  });
});

describe('/enter — honesty about what this is', () => {
  it('states that no production human authentication exists', () => {
    renderApp(<EnterKeyPage />, { route: '/enter' });
    expect(screen.getByTestId('enter-no-production-auth')).toHaveTextContent(
      CATALOGS['pt-BR']['enter.noProductionAuth'],
    );
  });

  it('states that the key is memory-only and that a reload ends the session', () => {
    renderApp(<EnterKeyPage />, { route: '/enter' });
    expect(screen.getByText(CATALOGS['pt-BR']['enter.keyHint'])).toBeInTheDocument();
  });

  it('renders in every supported language', () => {
    for (const locale of ['pt-BR', 'en-US', 'es'] as const) {
      const { unmount } = renderApp(<EnterKeyPage />, { route: '/enter', locale });
      expect(
        screen.getByRole('heading', { name: CATALOGS[locale]['enter.title'] }),
      ).toBeInTheDocument();
      expect(screen.getByText(CATALOGS[locale]['enter.noProductionAuth'])).toBeInTheDocument();
      unmount();
    }
  });
});
