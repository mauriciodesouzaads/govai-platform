import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { AiConsolePage } from '../../src/features/ai/AiConsolePage.js';
import { AppRoutes } from '../../src/app/routes.js';
import { renderApp } from '../render.js';
import { server, VALID_KEY } from '../msw/server.js';
import { CATALOGS } from '../../src/lib/i18n/catalogs/index.js';
import { createQueryClient } from '../../src/lib/api/query-client.js';
import { createCredentialStore } from '../../src/lib/session/credential.js';
import {
  PATHS,
  defaultModelHandlers,
  responsesScript,
  streamHandler,
} from './provider-msw.js';

// ★★ MEMORY ONLY.
//
// The console writes nothing durable. That is a structural property — the transcript is
// `useReducer` state inside the /ai route component and there is no storage adapter anywhere in
// the feature — and these tests are what keeps it structural: a future "helpful" draft-saving
// or history feature would fail here rather than ship quietly.

const T = CATALOGS['pt-BR'];
const PROMPT = 'a question with CONFIDENTIAL-PROMPT-MARKER in it';
const ANSWER = 'an answer with CONFIDENTIAL-ANSWER-MARKER in it';

function renderConsole(extra: Parameters<typeof server.use> = []) {
  server.use(...extra, ...defaultModelHandlers());
  return renderApp(<AiConsolePage />, { route: '/ai', credential: VALID_KEY });
}

async function converse(user: ReturnType<typeof renderApp>['user']) {
  const input = await screen.findByTestId('model-input');
  await user.clear(input);
  await user.type(input, 'a-model');
  await user.type(screen.getByTestId('composer-input'), PROMPT);
  await user.click(screen.getByTestId('composer-send'));
  await screen.findByText(ANSWER);
}

/** Everything a browser could have written, as one searchable string. */
function persistedSurface(): string {
  return [
    JSON.stringify(window.localStorage),
    JSON.stringify(window.sessionStorage),
    document.cookie,
    window.location.href,
  ].join('|');
}

describe('★ nothing about a conversation is persisted by the browser', () => {
  it('writes no prompt, answer, model, provider or credential anywhere durable', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
    ]);
    await converse(user);

    const persisted = persistedSurface();
    for (const secret of [
      'CONFIDENTIAL-PROMPT-MARKER',
      'CONFIDENTIAL-ANSWER-MARKER',
      VALID_KEY,
      'a-model',
      'passthrough',
    ]) {
      expect(persisted, `"${secret}" must not be persisted`).not.toContain(secret);
    }
  });

  it('leaves sessionStorage completely empty', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
    ]);
    await converse(user);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('persists ONLY the locale in localStorage', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
    ]);
    await converse(user);
    // The locale is the one preference this application is allowed to remember, and it is a
    // display choice with no tenant meaning.
    const keys = Object.keys(window.localStorage);
    for (const key of keys) {
      expect(key.toLowerCase()).toContain('locale');
    }
  });

  it('puts nothing in the URL', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
    ]);
    await converse(user);
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('');
  });

  it('opens no IndexedDB database', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
    ]);
    await converse(user);
    // jsdom exposes no indexedDB by default; if a future dependency polyfilled one, this
    // assertion is what would notice a database appearing.
    const idb = (window as unknown as { indexedDB?: { databases?: () => Promise<unknown[]> } })
      .indexedDB;
    if (idb?.databases) {
      expect(await idb.databases()).toEqual([]);
    } else {
      expect(idb).toBeUndefined();
    }
  });
});

describe('★ the React Query cache holds no conversation and no credential', () => {
  it('keys only the provider name, and caches only the model listing', async () => {
    const queryClient = createQueryClient();
    server.use(
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
      ...defaultModelHandlers(),
    );
    const { user } = renderApp(<AiConsolePage />, {
      route: '/ai',
      credential: VALID_KEY,
      queryClient,
    });
    await converse(user);

    const entries = queryClient.getQueryCache().getAll();
    const serialized = JSON.stringify(entries.map((q) => ({ key: q.queryKey, data: q.state.data })));
    expect(serialized).not.toContain(VALID_KEY);
    expect(serialized).not.toContain('CONFIDENTIAL-PROMPT-MARKER');
    expect(serialized).not.toContain('CONFIDENTIAL-ANSWER-MARKER');
    // The only cached resource is discovery.
    for (const q of entries) {
      expect(q.queryKey[0]).toBe('provider-models');
    }
  });
});

describe('★ the transcript dies with the component', () => {
  it('is gone after leaving /ai and coming back', async () => {
    server.use(
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
      ...defaultModelHandlers(),
    );
    const { user } = renderApp(<AppRoutes />, { route: '/ai', credential: VALID_KEY });
    const input = await screen.findByTestId('model-input');
    await user.clear(input);
    await user.type(input, 'a-model');
    await user.type(screen.getByTestId('composer-input'), PROMPT);
    await user.click(screen.getByTestId('composer-send'));
    await screen.findByText(ANSWER);

    // Navigate away and back through the real router.
    await user.click(screen.getByRole('link', { name: T['app.nav.capabilities'] }));
    await screen.findByTestId('capability-filter');
    await user.click(screen.getByRole('link', { name: T['app.nav.ai'] }));

    expect(await screen.findByTestId('conversation-empty')).toBeInTheDocument();
    expect(screen.queryByText(ANSWER)).toBeNull();
    expect(screen.queryByText(PROMPT)).toBeNull();
  });

  it('is gone when the session ends, along with the credential and the cache', async () => {
    const store = createCredentialStore();
    store.set(VALID_KEY);
    server.use(
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) }),
      ...defaultModelHandlers(),
    );
    const { user } = renderApp(<AppRoutes />, { route: '/ai', store });
    const input = await screen.findByTestId('model-input');
    await user.clear(input);
    await user.type(input, 'a-model');
    await user.type(screen.getByTestId('composer-input'), PROMPT);
    await user.click(screen.getByTestId('composer-send'));
    await screen.findByText(ANSWER);

    await user.click(screen.getByTestId('sign-out'));
    await waitFor(() => expect(store.hasCredential()).toBe(false));
    // The route guard sends the reader to /enter and the console is unmounted with everything
    // it held.
    expect(await screen.findByTestId('api-key-input')).toBeInTheDocument();
    expect(screen.queryByText(ANSWER)).toBeNull();
    expect(persistedSurface()).not.toContain('CONFIDENTIAL-ANSWER-MARKER');
  });

  it('tells the reader plainly that the transcript is not saved', async () => {
    renderConsole([streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript(ANSWER) })]);
    const note = await screen.findByTestId('caveat-note');
    expect(note).toHaveTextContent(T['ai.memoryOnly']);
    // ★ And it does NOT claim anything about the provider's own retention.
    expect(note.textContent ?? '').toMatch(/configuração do provedor e da conta/i);
    expect(note.textContent ?? '').not.toMatch(/nada é retido|nada fica guardado em lugar nenhum/i);
  });
});
