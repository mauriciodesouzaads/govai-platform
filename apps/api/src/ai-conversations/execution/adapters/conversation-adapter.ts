// ProviderConversationAdapter — the §11 adapter boundary, established by P0-D1
// (EP-AI-CONVERSATION-CONTINUITY-V1 P0-D1; spec §11, §17, §24 LAW 4/9/15/17; NX-1/NX-5/NX-11/
// NX-15).
//
// ★ RESPONSIBILITIES, NOT A NORMALIZED PROTOCOL. This interface defines WHAT a provider
// continuation strategy must answer — never a shared conversation wire format. An Anthropic
// `/v1/messages` history replay and an OpenAI `/v1/responses` chain are structurally different
// things, and both stay fully native behind this boundary (LAW NX-1: no lowest common
// denominator; §12: stored truth stays provider-native). The future Codex thread and Claude
// Code session adapters (P0-D2) attach HERE — they add strategies with provider-held state and
// receiver-side fencing, they do not reshape this interface into a generic `conversation_id`.
//
// What an adapter owns (movement dispatch §10, realized):
//   1. STRATEGY SELECTION   from durable facts only — never in-memory hints.
//   2. REQUEST ASSEMBLY     durable branch context + the turn's IMMUTABLE native config. The
//                           adapter replaces ONLY the context-bearing portion of the request
//                           (Anthropic `messages`, OpenAI `input`/`previous_response_id`);
//                           every other provider-native control — tools, sampling, limits,
//                           thinking/reasoning settings, `store`, service tier, metadata —
//                           passes through VERBATIM (§30; LAW NX-11). No silent rewriting.
//   3. PROVENANCE VALIDATION  a continuation anchor is chained only when the credential that
//                           will authenticate the POST is the credential that created the
//                           anchor (§11 CREDENTIAL-ANCHOR RECONCILIATION); a mismatch falls
//                           back to the strategy that carries no account-scoped state.
//   4. ANCHOR REPORTING     the exact continuation parent used, for the executor to persist
//                           encrypted on the attempt row BEFORE the POST (§20/§21).
//   5. HONEST DEGRADATION   an unreplayable context is an explicit refusal, never a silent
//                           flattening to text and never a silent field drop (§31).
//   6. NO SUBSTITUTION      model, provider, surface and mode are never rewritten (LAW NX-5).
//
// What an adapter is NOT: it performs no I/O — no database, no KMS, no network. It is a pure
// function from decrypted durable context + config to a provider-native request body, which is
// what makes every rule above unit-testable without a provider.
//
// CONSUMING RESULTS (responsibility "5. consume a successful provider result" of the movement
// dispatch): for BOTH P0-D1 strategies the durable native output persisted by the executor IS
// the next continuation state — stateless replay reads it back as history, and the OpenAI
// chain derives its next anchor from the LAST eligible completed response's own id at the NEXT
// dispatch (spec §11 "continuation roots in context-eligible attempts only"). No separate
// provider-state row exists to advance, so the two context domains cannot diverge (LAW 17):
// the projection is the single causal truth. A strategy that later introduces provider-HELD
// shared state (OpenAI conversation objects, Codex threads, Claude Code sessions) brings its
// own `ai_conversation_provider_state` lifecycle WITH the §11 taint/rotation discipline —
// deliberately absent here because P0-D1 creates no provider-held state.

import type { AssembledContextEntry } from '../durable-context.js';

export type BuildRequestInput = {
  /** Context-eligible prior turns, OLDEST → NEWEST, decrypted and provider-native. */
  entries: readonly AssembledContextEntry[];
  /** The dispatching turn's IMMUTABLE native request config, parsed (LAW 2). */
  turnConfig: unknown;
  /** The executing branch's durable model — the source-model comparison input for provider
   *  model-switch rules (Anthropic strips foreign thinking blocks; §17). */
  branchModel: string;
  /** The row id of the ACTIVE credential that will authenticate the POST (§8 commit 4's
   *  resolution, already performed by the executor's step 3). */
  activeCredentialId: string;
  /** The executor's clock at build time, epoch ms. Supplied as an INPUT so adapters stay pure
   *  and deterministic under test; used for coarse anchor-age judgments (a provider-stored
   *  response has a bounded retention window), never for lease/fencing decisions — those stay
   *  on database time (the 0029 rule). */
  nowMs: number;
};

/** How the built request continues the conversation — reported truthfully so the executor can
 *  persist the anchor (chaining) or nothing (stateless). */
export type BuildContinuation =
  | { kind: 'stateless_replay' }
  | { kind: 'response_chain'; parentResponseId: string };

export type BuildRequestResult =
  | { ok: true; body: Record<string, unknown>; continuation: BuildContinuation }
  | {
      ok: false;
      /** `continuation_conflict`: the stored config carries client-owned continuation state
       *  that server-assembled context cannot honor without lying about what the provider
       *  will see. `context_unreplayable`: the durable output cannot be faithfully replayed
       *  (§31 — refuse, never degrade behind the user's back). */
      reason: 'continuation_conflict' | 'context_unreplayable';
      /** Payload-free reason class for logs. Never content, never identifiers. */
      detail: string;
    };

export type ProviderConversationAdapter = {
  readonly provider: 'anthropic' | 'openai';
  buildRequest(input: BuildRequestInput): BuildRequestResult;
};
