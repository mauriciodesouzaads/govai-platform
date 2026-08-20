import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '../../lib/i18n/I18nProvider.js';
import { useSession } from '../../lib/session/SessionProvider.js';
import { queryKeys } from '../../lib/api/keys.js';
import { PageHeader } from '../../components/PageHeader.js';
import { CaveatNote } from '../../components/CaveatNote.js';
import { Composer } from './components/Composer.js';
import { Conversation } from './components/Conversation.js';
import { ModelPicker } from './components/ModelPicker.js';
import { ProviderControls } from './components/ProviderControls.js';
import {
  conversationReducer,
  initialConversationState,
  isBusy,
} from './conversation/reducer.js';
import { contextForTurn, type ConversationConfig } from './conversation/types.js';
import type { ContextMessage } from './providers/types.js';
import { findAdapter } from './providers/registry.js';
import {
  MODEL_PAGE_LIMIT,
  modelListSchema,
  modelsPath,
  modelsQuery as modelsQuery_,
  nextPageCursor,
  toProviderModels,
  type ModelListResponse,
  type ProviderModel,
} from './providers/models.js';
import { ANTHROPIC_DEFAULT_MAX_TOKENS } from './providers/anthropic-messages.js';
import { runTurn } from './streaming/run-turn.js';

// /ai — the AI Console.
//
// ★ EVERY PROVIDER CALL ORIGINATES IN A USER GESTURE. `runTurn` is invoked from the send
// handler and the retry handler, and from nowhere else. There is deliberately no effect that
// dispatches a provider request — not "send on mount", not "resend when the model changes",
// not a query. Under <StrictMode> React runs effects twice in development; a provider POST
// inside one would be executed twice, billed twice and audited twice, and the second call
// would be invisible in the UI. Keeping dispatch out of effects makes that unreachable rather
// than merely unobserved, and a StrictMode test pins it.
//
// ★ THE TRANSCRIPT LIVES HERE AND NOWHERE ELSE. `useReducer` state in this component. Leaving
// /ai unmounts it and the conversation is gone; ending the session unmounts it through the
// route guard and the conversation is gone. There is no storage write anywhere in this
// feature, so "not persisted" is a property of the code rather than a promise in the copy.
//
// ★ LEAVING MID-STREAM ABORTS. The unmount cleanup aborts whatever is in flight, so navigating
// away does not leave an orphaned provider request running (and billing) in the background.
// The GovAI stream path propagates a client disconnect to the upstream request; the UI copy
// still claims no more than "stopped by this browser", because the response path does not
// report back what the provider then did.

/** A fresh identifier for a turn or an attempt. `crypto.randomUUID` is available in every
 *  supported browser and in the test runtime; the fallback keeps a hostile environment from
 *  breaking the console rather than from being cryptographically interesting. */
function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  /* c8 ignore next 2 -- randomUUID is present in every runtime this app supports */
  return `id-${Math.random().toString(36).slice(2)}-${String(Date.now())}`;
}

const DEFAULT_CONFIG: ConversationConfig = {
  provider: 'openai',
  surface: 'responses',
  mode: 'native_audited',
  // Deliberately empty: this console ships NO hardcoded production model id. The reader
  // chooses from the provider's own listing, or types one.
  model: '',
  maxTokens: ANTHROPIC_DEFAULT_MAX_TOKENS,
};

export function AiConsolePage() {
  const { t } = useI18n();
  const { client } = useSession();
  const [state, dispatch] = useReducer(conversationReducer, DEFAULT_CONFIG, initialConversationState);
  const [draft, setDraft] = useState('');

  // The controller for the attempt currently in flight. A ref, not state: aborting must not
  // depend on a re-render having happened, and the value must survive one.
  const controllerRef = useRef<AbortController | null>(null);

  // Abort on unmount — route change, sign-out, or the tab's owner navigating away.
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    },
    [],
  );

  const adapter = useMemo(
    () => findAdapter(state.config.provider, state.config.surface),
    [state.config.provider, state.config.surface],
  );

  // ── Model discovery ────────────────────────────────────────────────────────────────────
  // A read, through the SAME client, with the query layer's existing bounded retry. That
  // retry policy is for GETs only and never reaches a provider POST (lib/api/client.ts).
  const provider = state.config.provider;
  const modelsQuery = useQuery({
    queryKey: queryKeys.providerModels(provider),
    queryFn: async ({ signal }) => {
      // ★ FOLLOW THE PROVIDER'S CURSOR. Anthropic's models endpoint pages (20 by default), so
      // reading one page and stopping would present a partial listing as "the provider's own"
      // — with every model past the first page silently missing. Asking for the maximum page
      // size makes a realistic account a single request; the loop exists for the case where it
      // is not, and it is bounded so a provider that always says `has_more` cannot spin the
      // screen that opens /ai. OpenAI's endpoint is not paginated and takes no parameters.
      const pages: ModelListResponse[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MODEL_PAGE_LIMIT; page += 1) {
        const query = modelsQuery_(provider, cursor);
        const response = await client.get(modelsPath(provider), {
          schema: modelListSchema(provider),
          signal,
          ...(query ? { query } : {}),
          // A rejected PROVIDER key relays as a 401; it must not end the GovAI session.
          authScope: 'provider-native',
        });
        pages.push(response);
        const next = nextPageCursor(response);
        if (next === null) break;
        cursor = next;
      }
      return pages;
    },
    // A provider's model list does not change minute to minute, and the API's shared
    // rate limit is better spent on conversation.
    staleTime: 5 * 60_000,
    retry: false,
  });

  const models: readonly ProviderModel[] = useMemo(
    () => (modelsQuery.data ? toProviderModels(modelsQuery.data) : []),
    [modelsQuery.data],
  );

  // ── Dispatching a turn ─────────────────────────────────────────────────────────────────
  //
  // The caller resolves the history and the transport config and passes them in, so what a
  // turn was sent WITH is fixed at the moment the reader acted — not re-read later from a
  // state that may have moved on.
  const execute = useCallback(
    async (args: {
      turnId: string;
      attemptId: string;
      prompt: string;
      history: readonly ContextMessage[];
      config: ConversationConfig;
    }) => {
      const turnAdapter = findAdapter(args.config.provider, args.config.surface);
      /* c8 ignore next -- the send/retry handlers refuse to dispatch without an adapter */
      if (turnAdapter === null) return;
      const controller = new AbortController();
      controllerRef.current = controller;

      const result = await runTurn({
        client,
        adapter: turnAdapter,
        mode: args.config.mode,
        model: args.config.model,
        maxTokens: args.config.maxTokens,
        history: args.history,
        prompt: args.prompt,
        signal: controller.signal,
        onStreamStart: () =>
          dispatch({ type: 'streaming', turnId: args.turnId, attemptId: args.attemptId }),
        onText: (text) =>
          dispatch({ type: 'delta', turnId: args.turnId, attemptId: args.attemptId, text }),
      });

      if (controllerRef.current === controller) controllerRef.current = null;
      dispatch({
        type: 'settle',
        turnId: args.turnId,
        attemptId: args.attemptId,
        state: result.state,
        text: result.text,
        refusal: result.refusal,
        unsupportedOutput: result.unsupportedOutput,
        error: result.error,
        retryAfterSeconds: result.retryAfterSeconds,
        receipt: result.receipt,
      });
    },
    [client],
  );

  const onSend = useCallback(() => {
    const prompt = draft.trim();
    if (prompt.length === 0 || isBusy(state) || adapter === null) return;
    if (state.config.model.trim().length === 0) return;
    const turnId = newId();
    const attemptId = newId();
    const turnIndex = state.turns.length;
    dispatch({ type: 'send', turnId, attemptId, userText: prompt });
    setDraft('');
    void execute({
      turnId,
      attemptId,
      prompt,
      history: contextForTurn(state.turns, turnIndex),
      config: state.config,
    });
  }, [adapter, draft, execute, state]);

  const onRetry = useCallback(
    (turnId: string) => {
      if (isBusy(state) || adapter === null) return;
      const turnIndex = state.turns.findIndex((turn) => turn.id === turnId);
      if (turnIndex === -1) return;
      const turn = state.turns[turnIndex];
      /* c8 ignore next -- findIndex just proved the element exists */
      if (turn === undefined) return;
      const attemptId = newId();
      dispatch({ type: 'retry', turnId, attemptId });
      // ★ The retry reproduces the context as it stood BEFORE this turn — see
      // contextForTurn. A retry is the same question asked again, not a new question
      // grounded on everything that has happened since.
      void execute({
        turnId,
        attemptId,
        prompt: turn.userText,
        history: contextForTurn(state.turns, turnIndex),
        config: state.config,
      });
    },
    [adapter, execute, state],
  );

  const onStop = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
  }, []);

  const onNewConversation = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setDraft('');
    dispatch({ type: 'newConversation' });
  }, []);

  const busy = isBusy(state);
  const canSend = adapter !== null && state.config.model.trim().length > 0;

  return (
    <div className="flex flex-col gap-[var(--govai-space-4)]">
      <PageHeader title={t('ai.title')} description={t('ai.lead')} />

      <ProviderControls
        config={state.config}
        locked={state.locked}
        onChange={(patch) => dispatch({ type: 'configure', patch })}
        onNewConversation={onNewConversation}
      />

      <div className="flex flex-wrap items-start gap-[var(--govai-space-4)]">
        <ModelPicker
          value={state.config.model}
          onChange={(model) => dispatch({ type: 'configure', patch: { model } })}
          disabled={state.locked}
          models={models}
          isLoading={modelsQuery.isLoading}
          error={modelsQuery.error}
        />
      </div>

      <CaveatNote label={t('ai.memoryOnly.label')}>{t('ai.memoryOnly')}</CaveatNote>

      <Conversation state={state} onRetry={onRetry} />

      <Composer
        value={draft}
        onChange={setDraft}
        onSend={onSend}
        onStop={onStop}
        busy={busy}
        canSend={canSend}
      />

      <p className="max-w-prose text-[length:var(--govai-text-2xs)] text-[var(--govai-text-tertiary)]">
        {t('ai.scopeNote')}
      </p>
    </div>
  );
}

export default AiConsolePage;
