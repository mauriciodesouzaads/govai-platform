import { StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../src/lib/i18n/I18nProvider.js';
import { SessionProvider } from '../../src/lib/session/SessionProvider.js';
import { AiConsolePage } from '../../src/features/ai/AiConsolePage.js';
import { createCredentialStore } from '../../src/lib/session/credential.js';
import { createQueryClient } from '../../src/lib/api/query-client.js';
import { server, VALID_KEY } from '../msw/server.js';
import { TEST_BASE_URL } from '../render.js';
import {
  PATHS,
  defaultModelHandlers,
  newCallLog,
  openEndedScript,
  responsesScript,
  streamHandler,
} from './provider-msw.js';

// ★★ THE DUPLICATE-BILLING REGRESSION.
//
// The application really does render inside <StrictMode> (src/main.tsx). In development React
// mounts every component, unmounts it and mounts it again, and runs every effect twice. A
// provider POST issued from an effect would therefore be issued TWICE: two provider
// executions, two bills, two audit events — and the second one invisible, because the UI would
// only ever show one answer.
//
// The console's defence is structural: `runTurn` is called from the send handler and the retry
// handler and from nowhere else, and React does not double-invoke event handlers. This file
// exists to prove that claim against the REAL component tree inside a REAL <StrictMode>, not
// against a mock. A test that counted handler invocations outside StrictMode would prove
// nothing about the failure mode it is named after.

function renderUnderStrictMode(options: { realQueryClient?: boolean } = {}) {
  const store = createCredentialStore();
  store.set(VALID_KEY);
  // Most cases want retries off and no caching, so one deterministic outcome is asserted.
  // The discovery case wants the APPLICATION's real query client, because what it is pinning
  // IS that configuration.
  const queryClient = options.realQueryClient
    ? createQueryClient()
    : new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } });
  const result = render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <I18nProvider initial="pt-BR">
          <SessionProvider baseUrl={TEST_BASE_URL} store={store}>
            <MemoryRouter initialEntries={['/ai']}>
              <AiConsolePage />
            </MemoryRouter>
          </SessionProvider>
        </I18nProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  return { ...result, user: userEvent.setup(), store };
}

async function sendOnce(user: ReturnType<typeof userEvent.setup>, model: string, prompt: string) {
  const input = await screen.findByTestId('model-input');
  await user.clear(input);
  await user.type(input, model);
  await user.type(screen.getByTestId('composer-input'), prompt);
  await user.click(screen.getByTestId('composer-send'));
}

describe('★ under <StrictMode>, one Send is still exactly one provider POST', () => {
  it('does not double-dispatch a conversation request', async () => {
    const log = newCallLog();
    server.use(
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('one answer') }, log),
      ...defaultModelHandlers(),
    );
    const { user } = renderUnderStrictMode();

    // Mounting under StrictMode — mount, unmount, remount — must call no provider at all.
    await screen.findByTestId('composer-input');
    expect(log.calls).toHaveLength(0);

    await sendOnce(user, 'a-model', 'a question');
    expect(await screen.findByText('one answer')).toBeInTheDocument();

    // Settle any late effect before counting.
    await new Promise((r) => setTimeout(r, 50));
    expect(log.calls).toHaveLength(1);
    // And exactly one answer is rendered, not two.
    expect(screen.getAllByTestId('turn')).toHaveLength(1);
    expect(screen.getAllByTestId('attempt')).toHaveLength(1);
  });

  it('does not double-dispatch an explicit retry', async () => {
    const log = newCallLog();
    server.use(
      streamHandler(
        PATHS.openaiResponsesNative,
        { chunks: ['data: {"type":"response.output_text.delta","delta":"cut"}\n\n'] },
        log,
      ),
      ...defaultModelHandlers(),
    );
    const { user } = renderUnderStrictMode();
    await sendOnce(user, 'a-model', 'a question');
    await screen.findByTestId('retry-turn');
    expect(log.calls).toHaveLength(1);

    await user.click(screen.getByTestId('retry-turn'));
    await waitFor(() => expect(log.calls).toHaveLength(2));
    await new Promise((r) => setTimeout(r, 50));
    expect(log.calls).toHaveLength(2);
  });

  it('does not re-dispatch when the reader changes an unrelated control', async () => {
    const log = newCallLog();
    server.use(
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('answer') }, log),
      ...defaultModelHandlers(),
    );
    const { user } = renderUnderStrictMode();
    await sendOnce(user, 'a-model', 'a question');
    await screen.findByText('answer');
    expect(log.calls).toHaveLength(1);

    // Typing in the composer, and every re-render it causes, must not resend anything.
    await user.type(screen.getByTestId('composer-input'), 'drafting a follow-up');
    await new Promise((r) => setTimeout(r, 50));
    expect(log.calls).toHaveLength(1);
  });

  it('aborts an in-flight stream when the console unmounts', async () => {
    // Leaving /ai mid-stream must not leave an orphaned provider request running — and
    // billing — in the background.
    const log = newCallLog();
    server.use(
      streamHandler(PATHS.openaiResponsesNative, openEndedScript('still going'), log),
      ...defaultModelHandlers(),
    );
    const { user, unmount } = renderUnderStrictMode();
    await sendOnce(user, 'a-model', 'a question');
    await screen.findByText('still going');
    expect(log.calls).toHaveLength(1);

    unmount();
    // No further request, and nothing throws on the way out.
    await new Promise((r) => setTimeout(r, 50));
    expect(log.calls).toHaveLength(1);
  });
});

describe('what mounting the console is allowed to do', () => {
  it('★ issues NO provider POST on mount, and only the idempotent discovery read', async () => {
    // The distinction this pins is the whole retry doctrine in miniature. StrictMode's
    // mount → unmount → remount really does run the discovery query twice in development
    // (the first fetch is cancelled with the first unmount, so the remount refetches) — and
    // that is FINE: `GET /v1/models` is idempotent, read-only, and costs nothing but one of
    // the shared 100 requests per minute. The same doubling on a conversation POST would be a
    // duplicated provider execution and a duplicated bill, which is why dispatch lives in an
    // event handler and never in an effect.
    let modelCalls = 0;
    const log = newCallLog();
    server.use(
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('x') }, log),
      streamHandler(PATHS.anthropicMessagesNative, { chunks: responsesScript('x') }, log),
      http.get('*/passthrough/openai/v1/models', () => {
        modelCalls += 1;
        return HttpResponse.json({ object: 'list', data: [{ id: 'm' }] });
      }),
      http.get('*/passthrough/anthropic/v1/models', () => HttpResponse.json({ data: [] })),
    );
    renderUnderStrictMode({ realQueryClient: true });
    await screen.findByTestId('model-input');
    await waitFor(() => expect(modelCalls).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 60));

    // ZERO provider conversations. This is the assertion that protects a bill.
    expect(log.calls).toHaveLength(0);
    // Discovery is bounded by the StrictMode double-mount and never loops.
    expect(modelCalls).toBeLessThanOrEqual(2);
  });
});
