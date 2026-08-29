// P0-C DISPATCH SURFACE REGISTRY (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §9/§12/§23).
//
// PURE. The single place that answers: "given this branch's DURABLE (provider, surface) and this
// conversation's DURABLE mode, what may P0-C execute?" — and, far more often, "why not".
//
// ★ WHY A REGISTRY AT ALL, AND WHY IT IS SMALL. `ai_conversations.surface` is free-form NOT NULL
// text: 0031 constrains `provider` with a CHECK and deliberately leaves `surface`/`model`
// unconstrained because NO runtime surface registry existed at that anchor (the adjudication is
// recorded verbatim in `contracts.ts`). P0-C does not invent that registry for the whole system.
// It declares only what THIS movement can execute TRUTHFULLY, and fails closed on everything
// else. A conversation created with an unsupported surface is still a perfectly valid durable
// conversation — it simply cannot be dispatched yet, and says so in those terms.
//
// ★ FAIL CLOSED, NEVER FALL BACK. An unsupported (provider, surface) pair is answered with an
// explicit unsupported state at BOTH boundaries — the Send route rejects it before reserving,
// and the executor refuses it before claiming. It is NEVER silently rerouted to a different
// surface, and NEVER "best-effort" translated: substituting a surface the user did not choose
// would send their content to a model/endpoint they never asked for.
//
// ★ WHAT IS EXCLUDED AND WHY (§23, the P0-D wall):
//   * `codex` and `claude_code` — their conversation continuity IS thread/session state
//     (§11/§17). An INITIAL request against them without the continuation machinery would
//     execute once and then be structurally unable to continue, which is a worse lie than
//     refusing. P0-D owns them.
//   * every other `surface` token, including future Anthropic/OpenAI endpoints — files, vector
//     stores, embeddings, models. None of them is a conversation turn.
//
// ★ THIS REGISTRY DECIDES ROUTING ONLY FROM DURABLE STATE. `provider` and `surface` are read
// from the BRANCH (§3: adapter selection reads the branch, not the conversation root) and `mode`
// from the conversation root's immutable column. No in-memory routing hint is consulted, so a
// dispatch that happens minutes after a reload — in a different process — resolves identically.

import type { ConversationMode, ConversationProvider } from './contracts.js';

/** The `provider` values 0031's CHECK admits which P0-C can actually execute. */
export const P0C_DISPATCHABLE_PROVIDERS = ['anthropic', 'openai'] as const;

/** The ONE conversation surface token per provider that P0-C executes. */
export const ANTHROPIC_MESSAGES_SURFACE = 'anthropic_messages';
export const OPENAI_RESPONSES_SURFACE = 'openai_responses';

/**
 * A resolved, dispatchable execution plan. Everything the executor needs to reach the provider,
 * derived from durable state alone.
 */
export type DispatchPlan = {
  provider: 'anthropic' | 'openai';
  surface: typeof ANTHROPIC_MESSAGES_SURFACE | typeof OPENAI_RESPONSES_SURFACE;
  mode: ConversationMode;
  /** The concrete native path this surface POSTs to. */
  nativePath: '/v1/messages' | '/v1/responses';
  /** Registry capability id for the NON-stream form; the stream form is selected by the
   *  governed handler itself from the request body (`selectCapability`). Used for the
   *  passthrough-mode evidence event, which has no handler to select it. */
  nonStreamCapabilityId: 'anthropic.messages.create' | 'openai.responses.create';
  streamCapabilityId: 'anthropic.messages.stream' | 'openai.responses.stream';
  /** Registry-canonical level for this capability (Decisão 4 / HAE-002): `policy_governed` for
   *  both conversation surfaces, INDEPENDENT of the conversation's operating mode. A
   *  `passthrough` conversation runs the capability in `passthrough_audited` operating mode
   *  while its CANONICAL level stays what the registry says — the exact distinction the direct
   *  routes already encode. */
  canonicalLevel: 'policy_governed';
};

/** Why a (provider, surface, mode) triple cannot be dispatched by P0-C. */
export type DispatchUnsupportedReason =
  /** `codex` / `claude_code`: continuation IS the transport (§11/§17) — P0-D. */
  | 'provider_requires_p0d_continuation'
  /** The provider is dispatchable but this `surface` token is not a P0-C conversation surface. */
  | 'surface_not_supported_in_p0c';

export class DispatchSurfaceUnsupportedError extends Error {
  readonly code = 'conversation_surface_unsupported';
  constructor(
    readonly provider: string,
    readonly surface: string,
    readonly reason: DispatchUnsupportedReason,
  ) {
    super(`provider/surface is not dispatchable in P0-C (${reason})`);
    this.name = 'DispatchSurfaceUnsupportedError';
  }
}

export type DispatchResolution =
  | { supported: true; plan: DispatchPlan }
  | { supported: false; reason: DispatchUnsupportedReason };

/**
 * Resolve the durable execution triple to a P0-C dispatch plan.
 *
 * `model` is deliberately NOT an input: the model vocabulary is provider-owned and changes
 * without a GovAI release (`contracts.ts`'s adjudication), so gating on it here would break
 * working conversations every time a provider ships a model. The model travels inside the
 * client's native request body, where the provider validates it.
 */
export function resolveDispatchPlan(input: {
  provider: ConversationProvider;
  surface: string;
  mode: ConversationMode;
}): DispatchResolution {
  if (input.provider !== 'anthropic' && input.provider !== 'openai') {
    return { supported: false, reason: 'provider_requires_p0d_continuation' };
  }
  if (input.provider === 'anthropic' && input.surface === ANTHROPIC_MESSAGES_SURFACE) {
    return {
      supported: true,
      plan: {
        provider: 'anthropic',
        surface: ANTHROPIC_MESSAGES_SURFACE,
        mode: input.mode,
        nativePath: '/v1/messages',
        nonStreamCapabilityId: 'anthropic.messages.create',
        streamCapabilityId: 'anthropic.messages.stream',
        canonicalLevel: 'policy_governed',
      },
    };
  }
  if (input.provider === 'openai' && input.surface === OPENAI_RESPONSES_SURFACE) {
    return {
      supported: true,
      plan: {
        provider: 'openai',
        surface: OPENAI_RESPONSES_SURFACE,
        mode: input.mode,
        nativePath: '/v1/responses',
        nonStreamCapabilityId: 'openai.responses.create',
        streamCapabilityId: 'openai.responses.stream',
        canonicalLevel: 'policy_governed',
      },
    };
  }
  return { supported: false, reason: 'surface_not_supported_in_p0c' };
}

/**
 * Whether the client's native request asked for a streaming response.
 *
 * Reads ONLY the top-level `stream` field — the same rule `register-governed.ts:isStreamRequest`
 * applies, and for the same reason: a substring or regex match false-positives on a nested
 * `"stream": true` inside message content. A body that is not an object is not streaming; the
 * provider owns body validity.
 */
export function isStreamingNativeRequest(nativeRequest: unknown): boolean {
  return (
    typeof nativeRequest === 'object' &&
    nativeRequest !== null &&
    !Array.isArray(nativeRequest) &&
    (nativeRequest as { stream?: unknown }).stream === true
  );
}
