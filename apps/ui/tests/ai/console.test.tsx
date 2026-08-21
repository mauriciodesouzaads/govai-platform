import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { AiConsolePage } from '../../src/features/ai/AiConsolePage.js';
import { renderApp } from '../render.js';
import { server, VALID_KEY } from '../msw/server.js';
import { CATALOGS } from '../../src/lib/i18n/catalogs/index.js';
import {
  ANTHROPIC_MODELS,
  OPENAI_MODELS,
  PATHS,
  chatScript,
  defaultModelHandlers,
  errorHandler,
  messagesScript,
  modelsHandler,
  newCallLog,
  openEndedScript,
  responsesScript,
  streamHandler,
} from './provider-msw.js';

const T = CATALOGS['pt-BR'];

/** Render the console authenticated, with model discovery answered.
 *
 *  `extra` is registered FIRST: MSW resolves runtime handlers in order and the first match
 *  wins, so a test that supplies its own `/v1/models` handler must be able to shadow the
 *  default one rather than be shadowed by it. */
function renderConsole(extra: Parameters<typeof server.use> = []) {
  server.use(...extra, ...defaultModelHandlers());
  return renderApp(<AiConsolePage />, { route: '/ai', credential: VALID_KEY });
}

async function chooseModel(user: ReturnType<typeof renderApp>['user'], model: string) {
  const input = await screen.findByTestId('model-input');
  await user.clear(input);
  await user.type(input, model);
}

async function send(user: ReturnType<typeof renderApp>['user'], text: string) {
  await user.type(screen.getByTestId('composer-input'), text);
  await user.click(screen.getByTestId('composer-send'));
}

/** Configure the transport controls before the first send. */
async function configure(
  user: ReturnType<typeof renderApp>['user'],
  opts: { provider?: 'openai' | 'anthropic'; mode?: 'native_audited' | 'governed'; surface?: string },
) {
  if (opts.provider) {
    await user.selectOptions(screen.getByTestId('provider-select'), opts.provider);
  }
  if (opts.surface) {
    await user.selectOptions(screen.getByTestId('surface-select'), opts.surface);
  }
  if (opts.mode) {
    await user.selectOptions(screen.getByTestId('mode-select'), opts.mode);
  }
}

describe('★ the six provider × mode combinations', () => {
  const MATRIX = [
    { name: 'OpenAI Responses · Native', path: PATHS.openaiResponsesNative, provider: 'openai', surface: 'responses', mode: 'native_audited', script: responsesScript },
    { name: 'OpenAI Responses · Governed', path: PATHS.openaiResponsesGoverned, provider: 'openai', surface: 'responses', mode: 'governed', script: responsesScript },
    { name: 'OpenAI Chat · Native', path: PATHS.openaiChatNative, provider: 'openai', surface: 'chat_completions', mode: 'native_audited', script: chatScript },
    { name: 'OpenAI Chat · Governed', path: PATHS.openaiChatGoverned, provider: 'openai', surface: 'chat_completions', mode: 'governed', script: chatScript },
    { name: 'Anthropic Messages · Native', path: PATHS.anthropicMessagesNative, provider: 'anthropic', surface: 'messages', mode: 'native_audited', script: messagesScript },
    { name: 'Anthropic Messages · Governed', path: PATHS.anthropicMessagesGoverned, provider: 'anthropic', surface: 'messages', mode: 'governed', script: messagesScript },
  ] as const;

  it.each(MATRIX)('$name streams an answer through the registered GovAI route', async (entry) => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(entry.path, { chunks: entry.script('the answer') }, log),
    ]);
    await configure(user, {
      provider: entry.provider,
      ...(entry.provider === 'openai' ? { surface: entry.surface } : {}),
      mode: entry.mode,
    });
    await chooseModel(user, 'a-model');
    await send(user, 'a question');

    expect(await screen.findByText('the answer')).toBeInTheDocument();
    // Exactly one POST, to exactly the registered path.
    expect(log.calls).toHaveLength(1);
    expect(log.calls[0]?.path).toBe(entry.path);
    await waitFor(() =>
      expect(screen.getByTestId('attempt-state-badge')).toHaveTextContent(T['ai.state.completed']),
    );
  });

  it('sends a provider-native body, not an invented GovAI chat schema', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.anthropicMessagesNative, { chunks: messagesScript('ok') }, log),
    ]);
    await configure(user, { provider: 'anthropic' });
    await chooseModel(user, 'claude-test');
    await send(user, 'olá');
    await screen.findByText('ok');

    expect(log.calls[0]?.body).toEqual({
      model: 'claude-test',
      messages: [{ role: 'user', content: 'olá' }],
      max_tokens: 2048,
      stream: true,
    });
  });
});

describe('★ one Send is one provider POST', () => {
  it('issues exactly one request per click, and none on mount', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('hi') }, log),
    ]);
    await screen.findByTestId('composer-input');
    // Mounting the console must not call a provider.
    expect(log.calls).toHaveLength(0);

    await chooseModel(user, 'a-model');
    await send(user, 'one');
    await screen.findByText('hi');
    expect(log.calls).toHaveLength(1);
  });

  it('refuses to send an empty or whitespace-only prompt', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('hi') }, log),
    ]);
    await chooseModel(user, 'a-model');
    await user.type(screen.getByTestId('composer-input'), '    ');
    expect(screen.getByTestId('composer-send')).toBeDisabled();
    await user.click(screen.getByTestId('composer-send'));
    expect(log.calls).toHaveLength(0);
  });

  it('refuses to send before a model has been chosen', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('hi') }, log),
    ]);
    await user.type(await screen.findByTestId('composer-input'), 'a question');
    expect(screen.getByTestId('composer-send')).toBeDisabled();
    expect(log.calls).toHaveLength(0);
  });

  it('sends on Enter and inserts a newline on Shift+Enter', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('hi') }, log),
    ]);
    await chooseModel(user, 'a-model');
    const composer = await screen.findByTestId('composer-input');
    await user.type(composer, 'line one{Shift>}{Enter}{/Shift}line two');
    expect((composer as HTMLTextAreaElement).value).toBe('line one\nline two');
    expect(log.calls).toHaveLength(0);

    await user.type(composer, '{Enter}');
    await screen.findByText('hi');
    expect(log.calls).toHaveLength(1);
    // A user turn goes as a fully-qualified typed item (see providers/openai-responses.ts).
    expect((log.calls[0]?.body as { input: unknown[] }).input[0]).toEqual({
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'line one\nline two' }],
    });
  });
});

describe('★ NO AUTOMATIC RETRY of a provider POST', () => {
  it.each([
    ['429 rate limit', 429, { error: { type: 'rate_limit_error', message: 'slow down' } }],
    ['500 server error', 500, { error: { type: 'server_error', message: 'boom' } }],
    ['503 unavailable', 503, { error: { type: 'overloaded_error' } }],
  ])('issues exactly one request on %s', async (_label, status, body) => {
    const log = newCallLog();
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, { status, body, headers: { 'retry-after': '5' } }, log),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'a question');
    await screen.findByTestId('attempt-state-badge');
    // Wait past any plausible retry delay, then assert the count is still one.
    await new Promise((r) => setTimeout(r, 60));
    expect(log.calls).toHaveLength(1);
  });

  it('shows the advertised wait on a 429 instead of retrying inside it', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, {
        status: 429,
        body: { error: { type: 'rate_limit_error' } },
        headers: { 'retry-after': '42' },
      }),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'a question');
    expect(await screen.findByTestId('attempt-state-badge')).toHaveTextContent(
      T['ai.state.rateLimited'],
    );
    expect(screen.getByTestId('attempt-retry-after')).toHaveTextContent('42');
  });

  it('labels retry as a NEW provider call and only fires it on an explicit click', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, { status: 500, body: { error: {} } }, log),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'a question');
    await screen.findByTestId('attempt-state-badge');
    expect(log.calls).toHaveLength(1);

    const retry = await screen.findByTestId('retry-turn');
    expect(retry).toHaveTextContent(T['ai.retry']);
    expect(retry.textContent?.toLowerCase()).toContain('provedor');
    await user.click(retry);
    await waitFor(() => expect(log.calls).toHaveLength(2));
    // The failed attempt is still visible; a retry appends, it does not erase.
    expect(screen.getAllByTestId('attempt')).toHaveLength(2);
  });

  it('does not offer retry for a turn the provider completed', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('done') }),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'a question');
    await screen.findByText('done');
    expect(screen.queryByTestId('retry-turn')).toBeNull();
  });
});

describe('★ context is committed only by a completed answer', () => {
  it('carries a completed exchange into the next request', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('first answer') }, log),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'first question');
    await screen.findByText('first answer');
    await send(user, 'second question');
    await waitFor(() => expect(log.calls).toHaveLength(2));

    expect((log.calls[1]?.body as { input: unknown }).input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first question' }] },
      { role: 'assistant', content: 'first answer' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'second question' }] },
    ]);
  });

  it('excludes an UNCONFIRMED answer from the next request, while still showing it', async () => {
    const log = newCallLog();
    server.use(
      ...defaultModelHandlers(),
      // A stream with text but no terminal marker.
      streamHandler(
        PATHS.openaiResponsesNative,
        { chunks: ['data: {"type":"response.output_text.delta","delta":"truncated"}\n\n'] },
        log,
      ),
    );
    const { user } = renderApp(<AiConsolePage />, { route: '/ai', credential: VALID_KEY });
    await chooseModel(user, 'a-model');
    await send(user, 'first question');
    await screen.findByText('truncated');
    expect(await screen.findByTestId('attempt-state-badge')).toHaveTextContent(
      T['ai.state.unknownOutcome'],
    );
    // The reader is told why it will not be reused.
    expect(screen.getByTestId('attempt-context-excluded')).toHaveTextContent(T['ai.contextExcluded']);

    await send(user, 'second question');
    await waitFor(() => expect(log.calls).toHaveLength(2));
    expect((log.calls[1]?.body as { input: unknown }).input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'second question' }] },
    ]);
  });
});

describe('★ retrying an EARLIER turn does not fabricate a conversation branch', () => {
  it('shows the retried answer, labels why it is not context, and leaves it out of the request', async () => {
    const log = newCallLog();
    let failFirst = true;
    server.use(
      http.post(`*${PATHS.openaiResponsesNative}`, async ({ request }) => {
        log.calls.push({
          path: PATHS.openaiResponsesNative,
          body: await request.clone().json(),
          apiKey: request.headers.get('x-govai-api-key'),
        });
        // The FIRST send fails; every later one succeeds. That is what lets the reader answer
        // turn 2 and only then go back and retry turn 1.
        if (failFirst) {
          failFirst = false;
          return HttpResponse.json({ error: { type: 'server_error' } }, { status: 500 });
        }
        const chunks = responsesScript('an answer');
        const encoder = new TextEncoder();
        let i = 0;
        return new HttpResponse(
          new ReadableStream<Uint8Array>({
            pull(c) {
              if (i >= chunks.length) return void c.close();
              c.enqueue(encoder.encode(chunks[i] as string));
              i += 1;
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }),
      ...defaultModelHandlers(),
    );
    const { user } = renderApp(<AiConsolePage />, { route: '/ai', credential: VALID_KEY });
    await chooseModel(user, 'a-model');

    await send(user, 'first question');
    await screen.findByTestId('retry-turn'); // turn 1 failed
    await send(user, 'second question');
    await waitFor(() => expect(screen.getAllByText('an answer')).toHaveLength(1)); // turn 2 answered

    // Now go back and retry turn 1 — successfully.
    await user.click(screen.getByTestId('retry-turn'));
    await waitFor(() => expect(screen.getAllByText('an answer')).toHaveLength(2));

    // The retried answer is on screen, with the OUT-OF-ORDER reason, not the unfinished one.
    const notes = screen.getAllByTestId('attempt-context-excluded');
    const outOfOrder = notes.filter(
      (n) => n.getAttribute('data-context-excluded-reason') === 'out-of-order',
    );
    expect(outOfOrder).toHaveLength(1);
    expect(outOfOrder[0]).toHaveTextContent(T['ai.contextExcluded.outOfOrder']);

    // And a third message carries turn 2's pair only — never the retried turn-1 answer.
    await send(user, 'third question');
    await waitFor(() => expect(log.calls).toHaveLength(4));
    expect((log.calls[3]?.body as { input: unknown }).input).toEqual([
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'second question' }] },
      { role: 'assistant', content: 'an answer' },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'third question' }] },
    ]);
  });
});

describe('★ Stop', () => {
  it('aborts the stream, keeps the partial text, and says who stopped it', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, openEndedScript('partial answer'), log),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'a question');
    expect(await screen.findByText('partial answer')).toBeInTheDocument();

    await user.click(await screen.findByTestId('composer-stop'));
    expect(await screen.findByTestId('attempt-state-badge')).toHaveTextContent(T['ai.state.stopped']);
    // The partial text survives, and is marked as not-context.
    expect(screen.getByText('partial answer')).toBeInTheDocument();
    expect(screen.getByTestId('attempt-context-excluded')).toBeInTheDocument();
    // Stopping issues no new request.
    expect(log.calls).toHaveLength(1);
  });

  it('does not claim the provider cancelled anything', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, openEndedScript('partial')),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    await screen.findByText('partial');
    await user.click(await screen.findByTestId('composer-stop'));
    const note = await screen.findByTestId('attempt-state-note');
    expect(note).toHaveTextContent(T['ai.state.stopped.note']);
    // The copy attributes the cancellation to this browser, and says the response does not
    // report what the provider then did.
    expect(note.textContent ?? '').toMatch(/navegador cancelou/i);
    expect(note.textContent ?? '').not.toMatch(/provedor cancelou/i);
  });

  it('swaps Send for Stop while a turn is in flight', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, openEndedScript('x')),
    ]);
    await chooseModel(user, 'a-model');
    expect(screen.getByTestId('composer-send')).toBeInTheDocument();
    await send(user, 'q');
    expect(await screen.findByTestId('composer-stop')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-send')).toBeNull();
  });
});

describe('★ new conversation', () => {
  it('drops the transcript, unlocks the controls and starts a fresh context', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('an answer') }, log),
      streamHandler(PATHS.anthropicMessagesNative, { chunks: messagesScript('other answer') }, log),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'a question');
    await screen.findByText('an answer');
    expect(screen.getByTestId('controls-locked-note')).toBeInTheDocument();

    await user.click(screen.getByTestId('new-conversation'));
    expect(screen.getByTestId('conversation-empty')).toBeInTheDocument();
    expect(screen.queryByText('an answer')).toBeNull();
    expect(screen.queryByTestId('controls-locked-note')).toBeNull();

    // A different provider is now selectable, and the new conversation carries no history.
    await configure(user, { provider: 'anthropic' });
    await chooseModel(user, 'claude-test');
    await send(user, 'a fresh question');
    await screen.findByText('other answer');
    expect((log.calls[1]?.body as { messages: unknown }).messages).toEqual([
      { role: 'user', content: 'a fresh question' },
    ]);
  });

  it('★ also aborts the background drain of a turn that already SETTLED', async () => {
    // ★ REGRESSION. A turn settles at the provider's terminal frame while its body keeps
    // draining in the background (detaching rather than cancelling is what keeps GovAI's audit
    // event `complete`). If the page forgets that controller once the turn settles, a provider
    // that never reaches EOF strands a reader and a proxy request — and "New conversation
    // aborts the stream" quietly stops being true for exactly the turns that succeeded.
    // The request's own signal is what the page ultimately controls, and it is observable from
    // the handler — unlike the source stream's `cancel`, which MSW does not propagate.
    let requestSignal: AbortSignal | null = null;
    server.use(
      http.post(`*${PATHS.openaiResponsesNative}`, ({ request }) => {
        requestSignal = request.signal;
        const chunks = [...responsesScript('an answer')];
        const encoder = new TextEncoder();
        let i = 0;
        return new HttpResponse(
          new ReadableStream<Uint8Array>({
            async pull(c) {
              if (i < chunks.length) {
                c.enqueue(encoder.encode(chunks[i] as string));
                i += 1;
                return;
              }
              // Terminal already sent; hold the connection open for ever.
              await new Promise<void>(() => undefined);
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } },
        );
      }),
      ...defaultModelHandlers(),
    );
    const { user } = renderApp(<AiConsolePage />, { route: '/ai', credential: VALID_KEY });
    await chooseModel(user, 'a-model');
    await send(user, 'a question');

    // The turn SETTLES even though the connection is still open.
    await screen.findByText('an answer');
    await waitFor(() =>
      expect(screen.getByTestId('attempt-state-badge')).toHaveTextContent(T['ai.state.completed']),
    );
    // Detached, not cancelled: the request is still live, which is what keeps GovAI's audit
    // event `complete` rather than `client_disconnect`.
    expect(requestSignal).not.toBeNull();
    expect((requestSignal as unknown as AbortSignal).aborted).toBe(false);

    // …and New conversation still reaches it, because the page kept the controller.
    await user.click(screen.getByTestId('new-conversation'));
    await waitFor(() =>
      expect((requestSignal as unknown as AbortSignal).aborted).toBe(true),
    );
  });

  it('aborts an in-flight stream when the conversation is reset', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, openEndedScript('in flight')),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    await screen.findByText('in flight');
    await user.click(screen.getByTestId('new-conversation'));
    expect(await screen.findByTestId('conversation-empty')).toBeInTheDocument();
    // The composer is usable again, which means nothing is still in flight.
    expect(screen.getByTestId('composer-send')).toBeInTheDocument();
  });
});

describe('★ the transport identity locks after the first send', () => {
  it('disables provider, mode, surface and model once a turn has gone out', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('ok') }),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    await screen.findByText('ok');

    expect(screen.getByTestId('provider-select')).toBeDisabled();
    expect(screen.getByTestId('mode-select')).toBeDisabled();
    expect(screen.getByTestId('surface-select')).toBeDisabled();
    expect(screen.getByTestId('model-input')).toBeDisabled();
    expect(screen.getByTestId('controls-locked-note')).toHaveTextContent(T['ai.locked']);
  });
});

describe('model discovery', () => {
  it('offers the provider’s own listing as suggestions', async () => {
    renderConsole();
    const list = await screen.findByTestId('model-suggestions');
    await waitFor(() =>
      expect(within(list).getAllByRole('option', { hidden: true }).length).toBe(
        OPENAI_MODELS.data.length,
      ),
    );
  });

  it('switches the listing with the provider and keeps the provider’s display name', async () => {
    const { user } = renderConsole();
    await screen.findByTestId('model-suggestions');
    await configure(user, { provider: 'anthropic' });
    await waitFor(() => {
      const options = within(screen.getByTestId('model-suggestions')).getAllByRole('option', {
        hidden: true,
      });
      expect(options.map((o) => o.getAttribute('value'))).toEqual([ANTHROPIC_MODELS.data[0]?.id]);
    });
  });

  it('★ sends a manually typed model id VERBATIM, even when the listing does not contain it', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('ok') }, log),
    ]);
    await chooseModel(user, 'a-model-not-in-the-listing');
    await send(user, 'q');
    await screen.findByText('ok');
    expect((log.calls[0]?.body as { model: string }).model).toBe('a-model-not-in-the-listing');
  });

  it('states that listing membership does not imply endpoint support', async () => {
    renderConsole();
    expect(await screen.findByText(new RegExp(T['ai.model.hint'].slice(0, 40)))).toBeInTheDocument();
  });

  it.each([
    ['an empty listing', { object: 'list', data: [] }, 200, 'model-list-empty'],
    ['a malformed listing', { unexpected: true }, 200, 'model-list-error'],
  ])('reports %s without blocking manual entry', async (_label, body, status, testId) => {
    const log = newCallLog();
    const { user } = renderConsole([
      modelsHandler('openai', body, { status }),
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('ok') }, log),
    ]);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    // Manual entry still works.
    await chooseModel(user, 'typed-by-hand');
    await send(user, 'q');
    await screen.findByText('ok');
    expect((log.calls[0]?.body as { model: string }).model).toBe('typed-by-hand');
  });

  it('names the credential condition when discovery returns the 502 contract', async () => {
    renderConsole([
      modelsHandler(
        'openai',
        { error: 'provider_credential_unresolvable', provider: 'openai', reason: 'no_active_credential' },
        { status: 502 },
      ),
    ]);
    expect(await screen.findByTestId('model-list-error')).toHaveTextContent(
      T['ai.model.listCredential'],
    );
  });

  it('★ a PROVIDER 401 during discovery does not end the GovAI session', async () => {
    const { store } = renderConsole([
      modelsHandler('openai', { error: { type: 'authentication_error' } }, { status: 401 }),
    ]);
    expect(await screen.findByTestId('model-list-error')).toHaveTextContent(
      T['ai.model.listRejected'],
    );
    // The reader stays signed in: it is the PROVIDER key that was rejected, not theirs.
    expect(store.hasCredential()).toBe(true);
  });

  it('reports a rate-limited listing', async () => {
    // A model LIST is a read, so it keeps the transport's existing bounded 429 retry (that
    // policy is GET-only and never reaches a conversation POST). The advertised wait here is
    // longer than the client will block for, which is the documented "surface it immediately
    // rather than retry inside the blocked window" path — and keeps the test deterministic
    // instead of sitting through the real backoff.
    renderConsole([
      http.get('*/passthrough/openai/v1/models', () =>
        HttpResponse.json({ error: {} }, { status: 429, headers: { 'retry-after': '600' } }),
      ),
    ]);
    expect(await screen.findByTestId('model-list-error')).toHaveTextContent(
      T['ai.model.listRateLimited'],
    );
  });
});

describe('provider and GovAI error surfaces', () => {
  it('renders a provider error with its own type, code and message — and nothing else', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, {
        status: 400,
        body: {
          error: {
            message: 'model does not exist',
            type: 'invalid_request_error',
            code: 'model_not_found',
            // A field that echoes the request back must not reach the screen.
            request_echo: { input: 'MY CONFIDENTIAL PROMPT' },
          },
        },
      }),
    ]);
    await chooseModel(user, 'nope');
    await send(user, 'q');
    const detail = await screen.findByTestId('provider-error-detail');
    expect(detail).toHaveTextContent('invalid_request_error');
    expect(detail).toHaveTextContent('model_not_found');
    expect(detail).toHaveTextContent('model does not exist');
    expect(document.body.textContent ?? '').not.toContain('MY CONFIDENTIAL PROMPT');
  });

  it('names a GovAI pre-provider block as such', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesGoverned, {
        status: 403,
        body: {
          error: 'governed_blocked',
          reason: 'enforcement_blocked:D',
          enforcement_applied: 'blocked',
          block_trigger: 'governance_enforcement',
        },
        headers: {
          'x-govai-capability-level': 'policy_governed',
          'x-govai-effective-risk-class': 'D',
          'x-govai-enforcement-decision': 'blocked',
          'x-govai-enforcement-applied': 'blocked',
        },
      }),
    ]);
    await configure(user, { mode: 'governed' });
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    expect(await screen.findByTestId('attempt-state-badge')).toHaveTextContent(T['ai.state.blocked']);
    expect(screen.getByTestId('attempt-state-note')).toHaveTextContent(T['ai.state.blocked.note']);
  });

  it('★ a PROVIDER 403 is a provider error, not a GovAI block', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, {
        status: 403,
        body: { error: { type: 'permission_error', message: 'not allowed for this key' } },
      }),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    const badge = await screen.findByTestId('attempt-state-badge');
    expect(badge).toHaveTextContent(T['ai.state.providerError']);
    expect(badge).not.toHaveTextContent(T['ai.state.blocked']);
  });

  it('reports the credential 502 as a configuration condition with no secret metadata', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, {
        status: 502,
        body: {
          error: 'provider_credential_unresolvable',
          provider: 'openai',
          reason: 'kms_decrypt_failed',
        },
      }),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    expect(await screen.findByTestId('attempt-state-badge')).toHaveTextContent(
      T['ai.state.credentialUnavailable'],
    );
    const page = document.body.textContent ?? '';
    expect(page).not.toMatch(/sk-/);
    expect(page).not.toMatch(/dek_wrapped|ciphertext|kms_key_id/);
  });

  it('reports an unreachable API as an unconfirmed outcome, never as "did not run"', async () => {
    const { user } = renderConsole([
      // A transport-level failure: the request leaves the browser and no response comes back.
      http.post(`*${PATHS.openaiResponsesNative}`, () => HttpResponse.error()),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    const badge = await screen.findByTestId('attempt-state-badge');
    expect(badge).toHaveTextContent(T['ai.state.networkError']);
    expect(screen.getByTestId('attempt-state-note')).toHaveTextContent(T['ai.state.networkError.note']);
  });
});

describe('the composer and the empty state', () => {
  it('starts empty, with an explanation rather than a fake first message', async () => {
    renderConsole();
    expect(await screen.findByTestId('conversation-empty')).toHaveTextContent(T['ai.empty.title']);
  });

  it('announces generation politely, without reading every token', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, openEndedScript('streaming text')),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    const status = await screen.findByTestId('conversation-status');
    expect(status).toHaveTextContent(T['ai.generating']);
    // The answer text lives OUTSIDE the live region: it is document content, not an
    // announcement stream.
    expect(within(status).queryByText('streaming text')).toBeNull();
  });

  // The other half of the same promise: a screen-reader user who hears "generating" must also
  // hear how it ended. Clearing the region on settle announces nothing, so the outcome — the
  // one distinction this console exists to make — would be withheld from exactly the readers
  // who cannot see the badge.
  it('announces the TERMINAL state too, not silence', async () => {
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('done') }),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    const status = await screen.findByTestId('conversation-status');
    await waitFor(() => expect(status).toHaveTextContent(T['ai.state.completed']));
    expect(status).not.toHaveTextContent(T['ai.generating']);
  });

  it('announces a FAILED terminal state with its own label, not a generic one', async () => {
    const { user } = renderConsole([
      errorHandler(PATHS.openaiResponsesNative, {
        status: 429,
        body: { error: { type: 'rate_limit_error', message: 'slow down' } },
      }),
    ]);
    await chooseModel(user, 'a-model');
    await send(user, 'q');
    const status = await screen.findByTestId('conversation-status');
    await waitFor(() => expect(status).toHaveTextContent(T['ai.state.rateLimited']));
  });

  it('warns about an unusually large prompt without refusing it', async () => {
    const log = newCallLog();
    const { user } = renderConsole([
      streamHandler(PATHS.openaiResponsesNative, { chunks: responsesScript('ok') }, log),
    ]);
    await chooseModel(user, 'a-model');
    const composer = screen.getByTestId('composer-input');
    // Typing 100k characters would be glacial; set the value the way a paste would, then fire
    // the change React listens for.
    fireEvent.change(composer, { target: { value: 'x'.repeat(100_001) } });
    expect(screen.getByTestId('composer-large-warning')).toBeInTheDocument();
    expect(screen.getByTestId('composer-send')).not.toBeDisabled();
    await user.click(screen.getByTestId('composer-send'));
    await waitFor(() => expect(log.calls).toHaveLength(1));
  });
});
