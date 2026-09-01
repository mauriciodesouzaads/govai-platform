// OpenAI Responses continuation — DURABLE STATELESS REPLAY + `previous_response_id` CHAINING
// (EP-AI-CONVERSATION-CONTINUITY-V1 P0-D1; spec §11 "OPENAI (Responses family)", §12, §24
// LAW 4/17; provider facts reverified against first-party documentation 2026-08-30).
//
// FIRST-PARTY FACTS THIS ADAPTER IS BUILT ON (reverified, not assumed):
//   * `previous_response_id` is the supported response-chaining continuation; it and the
//     `conversation` parameter are MUTUALLY EXCLUSIVE on one request.
//   * `store` defaults to true; stored responses are retained ~30 days and retrievable — a
//     response created under `store: false` is NOT retrievable, so its id is not a usable
//     chaining anchor and the request that would chain from it must replay statelessly.
//   * Manual/stateless continuation is "include the model's previous response output as input,
//     and append that input to your next request"; "Replaying the complete output keeps
//     reasoning items and assistant `phase` values intact", and the platform "will smartly
//     ignore any reasoning items that aren't relevant" — replaying the full output array
//     verbatim is the documented safe pattern.
//   * `input` accepts a string ("equivalent to a text prompt with the user role") or an item
//     array — the string→user-message equivalence used below is the provider's own, not a
//     GovAI normalization.
//
// STRATEGY ORDER, SOURCE-ADJUDICATED FOR THIS TREE (spec §11 prefers conversation objects →
// chaining → stateless):
//   * CONVERSATION OBJECTS are DEFERRED_WITHIN_P0D (movement dispatch §22): the accepted
//     architecture permits them only "where tenant policy permits provider-stored state", and
//     NO such policy signal exists anywhere in executable source at this anchor
//     (EXPLICIT_POLICY_SIGNAL_EXISTS = NO — adjudicated against the org/tier/governance
//     surface; commercial tier is not governance policy). Inventing one is forbidden.
//   * CHAINING is used when every correctness condition holds (below); otherwise
//   * STATELESS REPLAY — the mandatory fallback that depends on no provider-held state.
//
// ★ THE ANCHOR IS DERIVED FROM THE DURABLE PROJECTION, NEVER FROM A SIDE TABLE. Spec §11 is
// explicit: "every strategy derives its next-dispatch continuation … from attempts that are
// completed, current AND not context_excluded". The chaining anchor is therefore the LAST
// context-eligible completed response's own durable id — which makes the LAW 4 retry boundary
// automatic (a superseded attempt is not eligible, so its successor chains from the SAME
// parent the superseded attempt chained from, never from the answer being regenerated), makes
// fork boundaries automatic (a pinned attempt's id is a valid anchor for the child, and the
// provider-side chain is a TREE — chaining from an interior response never sees what came
// after it on the parent), and leaves NO second continuation store to diverge from the
// durable truth (LAW 17). Turns AFTER the anchor that contributed only user input (a failed
// or unknown-outcome sibling) ride along in `input`, so nothing eligible is lost.
//
// ★ CHAINING IS A STRICT SUBSET OF REPLAYABILITY — `chainable(r) ⇒ replayable(r)`, never the
// reverse. A response may be replayable but not chainable (an aged anchor, a rotated credential,
// `store: false`, an `incomplete` result, a provider failure that demotes the chain); it may NEVER
// be chainable without being replayable, because GovAI would then be leaning on provider-held
// history to make a durable capture it cannot itself replay look usable. Condition 0 is therefore
// structural rather than a predicate: the anchor is only ever read out of a `TerminalResolution`,
// which cannot exist without a validated terminal `output`. The conditions below are the
// STRATEGY-SPECIFIC ones layered on top of that semantic validity.
//
// ★ CHAINING CONDITIONS — every one must hold, else stateless replay (no partial credit):
//   1. an anchor exists (some eligible completed output precedes this turn);
//   2. CREDENTIAL-ANCHOR RECONCILIATION (§11/§23 of the movement dispatch): the anchor
//      attempt's recorded dispatch credential row id equals the ACTIVE credential's row id —
//      response ids are account-scoped, and chaining another account's id would at best fail
//      and at worst resolve inside the wrong account. Never gambled;
//   3. the ANCHOR turn's own config did not set `store: false` (an unstored response is not
//      retrievable, so its id is not a lawful parent);
//   4. THIS turn's config does not set `store: false` — chaining a response that will itself
//      be unstored would strand the NEXT turn; an explicit `store: false` is honored by
//      replaying statelessly instead (never silently flipped to true — §20 of the movement
//      dispatch);
//   5. the anchor is YOUNG enough to still be retrievable (review finding, exact head
//      20e7b67): stored responses are retained ~30 days, so a conversation resumed after the
//      window would chain an EXPIRED id — and, because the anchor derivation is deterministic,
//      would re-select the same dead parent on every later dispatch. The age gate uses the
//      anchor attempt's durable `terminal_at` against a deliberately conservative bound
//      (14 days, half the documented window) and falls back to stateless replay — which needs
//      no provider-held state at all — the honest degradation for an aged conversation.
//
// ★ CLIENT-OWNED CONTINUATION FIELDS ARE A CONFLICT, NOT AN INPUT — ON EVERY TURN THE BUILD
// TOUCHES. A stored config carrying `previous_response_id` or `conversation` asserts
// continuation state the durable store cannot see: honoring it would build every LATER turn's
// context from history GovAI never persisted, and stripping it would silently rewrite a
// provider-native control (§30). The dispatch refuses truthfully (`continuation_conflict`) for
// the CURRENT turn's config AND for every HISTORICAL entry (review finding, exact head
// 210c561): a rejected turn's user input remains context-eligible (LAW 2), but replaying an
// input that was composed RELATIVE TO external provider state while discarding its continuation
// fields would silently change its meaning. Recovery from such a poisoned turn is an explicit
// `before_attempt_output` fork from before it — the architecture's regeneration boundary —
// never a silent reinterpretation.

import type {
  BuildRequestInput,
  BuildRequestResult,
  ProviderConversationAdapter,
} from './conversation-adapter.js';
import type { AssembledContextEntry } from '../durable-context.js';

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const fail = (
  reason: 'continuation_conflict' | 'context_unreplayable',
  detail: string,
): BuildRequestResult => ({ ok: false, reason, detail });

/** Chaining condition 5: half the provider's documented ~30-day stored-response retention. */
const ANCHOR_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

class Unreplayable extends Error {
  constructor(readonly detail: string) {
    super(`context is not replayable (${detail})`);
    this.name = 'UnreplayableResponses';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Durable output → replayable native items / anchor id
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The terminal response object of a completed attempt: the stored body itself, or the
 *  terminal event's `response` from the durable stream bytes.
 *
 *  ★ TERMINALITY IS VALIDATED, NOT ASSUMED (review findings, exact heads fd06f99 + de5d6ac):
 *  a supported native `background: true` request answers HTTP 200 with `status`
 *  `queued`/`in_progress`, and the executor durably completes any 2xx attempt — so a stored
 *  body is a lawful context contribution only when the provider's own `status` says the
 *  operation FINISHED. Both terminal shapes count: `completed`, and `incomplete` — a
 *  legitimate truncated result (`max_output_tokens`, content filter) whose partial output is
 *  the real durable answer (the UI adapter classifies `response.incomplete` as terminal
 *  success for exactly this reason); refusing it would permanently brick the branch behind a
 *  truncated turn. A genuinely NONTERMINAL body still refuses. Whether an INCOMPLETE response
 *  may serve as a CHAINING anchor is a separate, stricter question — see the chaining
 *  condition below. */
const TERMINAL_RESPONSE_STATUSES = new Set(['completed', 'incomplete']);
/** Provider-declared TERMINAL FAILURE shapes: the provider's own verdict that this request
 *  produced NO answer (review finding, exact head 14746af — a 2xx stream can end in
 *  `response.failed`, and the executor durably completes any 2xx attempt from the HTTP status
 *  alone). Such a turn projects as INPUT-ONLY context — exactly how a `failed` attempt
 *  projects — rather than refusing and blocking the branch behind a provider failure. This is
 *  distinct from TRUNCATION (no terminal event at all), which stays a refusal: a missing
 *  verdict is ambiguity, a failure verdict is truth. */
const FAILED_RESPONSE_STATUSES = new Set(['failed', 'cancelled']);

/** ★ ONE SEMANTIC TERMINAL-RESPONSE LAW, EVERY STRATEGY (independent validator audit; review
 *  finding RF-1 on head d6cddf33). A `terminal` resolution CANNOT BE CONSTRUCTED without a
 *  validated `output` array, so no caller — chaining anchor selection, stateless replay, or any
 *  future strategy — can obtain a terminal response whose replayability was never decided. This
 *  is the type-level form of the invariant `chainable(r) ⇒ replayable(r)`: chaining picks its
 *  anchor from a TerminalResolution, and a TerminalResolution is by construction replayable.
 *
 *  BEFORE this consolidation the output law lived on ONE branch — `outputItemsOf()` was called
 *  only from the stateless path — so a capture with a valid `id` and a `completed` status but a
 *  missing / non-array `output` was admitted as a chaining anchor while the IDENTICAL capture
 *  refused `response_output_shape_unknown` the moment the age gate, a credential rotation or
 *  `store: false` disabled chaining. Two strategies disagreed about the same durable truth, and
 *  only one of them looked. */
type TerminalResolution =
  | { kind: 'terminal'; body: JsonObject; output: readonly unknown[] }
  | { kind: 'provider_failed' };

/** The complete output array, replayed VERBATIM (reasoning items included — the documented
 *  stateless pattern; adjacency preserved, nothing filtered, nothing reshaped).
 *
 *  First-party: `output` is a REQUIRED property of the Response object and is typed `array`, so a
 *  terminal body without one is out of grammar — not a shape GovAI may guess at. */
function terminalOf(body: JsonObject): TerminalResolution {
  const output = body['output'];
  if (!Array.isArray(output)) throw new Unreplayable('response_output_shape_unknown');
  return { kind: 'terminal', body, output };
}

/** ★ THE STATUS LAW — RF-3's RAW-EVIDENCE RULE, APPLIED TO THE OPENAI TERMINAL (bounded
 *  cross-check). First-party `Response.status` is OPTIONAL and NOT nullable, so ABSENCE is lawful
 *  and stays terminal-and-chainable — hardening that would refuse ordinary captures, and it is
 *  deliberately preserved. But "optional" describes ABSENCE, not corruption: the guards used to
 *  read `typeof status === 'string' && …` twice, so a PRESENT non-string status matched NEITHER
 *  and fell through as if the provider had said nothing — which can silently promote a
 *  provider-declared FAILURE into a replayed terminal. Same laundering RF-3 named on the
 *  Anthropic role, same remedy: absence defaults, malformed presence refuses. */
function statusOf(body: JsonObject): string | undefined {
  const status = body['status'];
  if (status === undefined) return undefined;
  if (typeof status !== 'string') throw new Unreplayable('response_status_shape_unknown');
  return status;
}

function terminalResponseOf(entry: AssembledContextEntry): TerminalResolution {
  const output = entry.assistant!.output;
  if (output.kind === 'response') {
    if (!isObject(output.body)) throw new Unreplayable('response_body_shape_unknown');
    const status = statusOf(output.body);
    if (status !== undefined) {
      if (FAILED_RESPONSE_STATUSES.has(status)) return { kind: 'provider_failed' };
      if (!TERMINAL_RESPONSE_STATUSES.has(status)) {
        throw new Unreplayable('anchor_response_not_terminal');
      }
    }
    return terminalOf(output.body);
  }
  let terminal: JsonObject | null = null;
  let failed = false;
  for (const line of output.sseText.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Unreplayable('sse_data_not_json');
    }
    if (!isObject(parsed)) continue;
    if (parsed['type'] === 'response.failed' || parsed['type'] === 'error') {
      failed = true;
    }
    if (
      (parsed['type'] === 'response.completed' || parsed['type'] === 'response.incomplete') &&
      isObject(parsed['response'])
    ) {
      // A SECOND success-shaped terminal (duplicated / out-of-order frames, possibly with
      // different bodies) is an ambiguous capture — silently keeping either body would replay
      // or chain content the grammar cannot vouch for (review finding, exact head 6d526c2).
      if (terminal !== null) throw new Unreplayable('duplicate_terminal_verdicts');
      const nested = parsed['response'] as JsonObject;
      // The nested body's own status must AGREE with the event type when present (review
      // finding, exact head cf65d0c): a `response.completed` carrying `in_progress` (or an
      // `incomplete` carrying `completed`) is a contradictory capture — refusing here applies
      // the same terminality validation the non-streaming path performs.
      // The SAME status law as the non-streaming door (RF-3 cross-check): a malformed nested
      // status used to skip the agreement check entirely, so a corrupt terminal body was
      // admitted as though its status simply had not been sent.
      const nestedStatus = statusOf(nested);
      const expected = parsed['type'] === 'response.completed' ? 'completed' : 'incomplete';
      if (nestedStatus !== undefined && nestedStatus !== expected) {
        throw new Unreplayable('terminal_status_mismatch');
      }
      terminal = nested;
    }
  }
  // CONFLICTING verdicts (review finding, exact head 4a95cb2): a stream carrying BOTH a
  // failure verdict and a success-shaped terminal (duplicated / out-of-order frames) is a
  // capture whose truth cannot be decided — preferring the success body would replay or chain
  // content the provider also declared failed. Refuse.
  if (failed && terminal !== null) throw new Unreplayable('conflicting_terminal_verdicts');
  if (failed) return { kind: 'provider_failed' };
  if (!terminal) throw new Unreplayable('stream_has_no_terminal_response');
  return terminalOf(terminal);
}

/** An anchor must be a FULLY completed response: an `incomplete` result is honest terminal
 *  CONTEXT (its truncated output replays statelessly), but chaining from it would continue a
 *  generation the provider itself reported as cut short — stateless replay is the safe form. */
function isChainableTerminal(terminal: JsonObject): boolean {
  const status = terminal['status'];
  return status === undefined || status === 'completed';
}

/** The provider's own id of the terminal response — the chaining anchor candidate. */
function responseIdOf(terminal: JsonObject): string | null {
  const id = terminal['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** A turn's own input, normalized to items only when it must merge into an array — using the
 *  provider's documented string ≡ user-message equivalence.
 *
 *  ★ `origin` NAMES THE TWO GENUINELY DIFFERENT OBJECTS THIS READS (independent validator audit).
 *  A `history` entry is a durable capture GovAI is RECONSTRUCTING: a turn whose stored request
 *  carries no `input` at all (a first-party `prompt` template supplied its content server-side)
 *  cannot be reproduced, and replaying its ANSWER without its QUESTION would silently change the
 *  context — so it refuses. The `own_turn` config is NOT history: it is dispatched as-is, the
 *  provider resolves its own `prompt`, and GovAI reconstructs nothing from it. First-party leaves
 *  `input` OPTIONAL on the create request, and GovAI's own send contract validates only that the
 *  native request is a JSON object — so requiring one here refused a lawful request, and refused
 *  it INCONSISTENTLY: the same config passed through verbatim on a first turn and on a chain with
 *  no trailing input, and refused on stateless replay. An absent `input` on the dispatching turn
 *  therefore contributes NOTHING; a PRESENT one that is neither string nor array still refuses. */
function inputItemsOf(native: unknown, origin: 'history' | 'own_turn'): unknown[] {
  const shapeUnknown =
    origin === 'history' ? 'history_input_shape_unknown' : 'config_input_shape_unknown';
  if (!isObject(native)) throw new Unreplayable(shapeUnknown);
  const input = native['input'];
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (Array.isArray(input)) return [...(input as unknown[])];
  if (input === undefined && origin === 'own_turn') return [];
  throw new Unreplayable(shapeUnknown);
}

function configStoreAllowsChaining(native: unknown): boolean {
  return !isObject(native) || native['store'] !== false;
}

export const openaiResponsesAdapter: ProviderConversationAdapter = {
  provider: 'openai',

  buildRequest(input: BuildRequestInput): BuildRequestResult {
    if (!isObject(input.turnConfig)) return fail('context_unreplayable', 'config_not_object');

    // Client-owned continuation state conflicts with server-assembled context on EVERY turn.
    for (const field of ['previous_response_id', 'conversation'] as const) {
      if (field in input.turnConfig) {
        return fail('continuation_conflict', `config_carries_${field}`);
      }
    }
    // `background: true` is a provider-side EXECUTION LIFECYCLE (the 200 answers `queued` and
    // the result must be polled) that this movement does not implement: accepting it would
    // durably record a nonterminal body as the turn's completed answer. Refused explicitly
    // until the polling lifecycle exists — never silently stripped (§30).
    if (input.turnConfig['background'] === true) {
      return fail('continuation_conflict', 'config_requests_background_mode');
    }

    // No eligible history: the turn's own immutable config IS the request, verbatim.
    if (input.entries.length === 0) {
      return { ok: true, body: input.turnConfig, continuation: { kind: 'stateless_replay' } };
    }

    try {
      for (const entry of input.entries) {
        if (entry.sourceProvider !== 'openai') {
          // §17 cross-provider fork ancestor — same refusal as the Anthropic adapter: the
          // portable projection is a later P0-D arc, and an incidental shape error would
          // misreport a known, precise condition.
          return fail('context_unreplayable', 'cross_provider_replay_not_implemented');
        }
        if (isObject(entry.userNative)) {
          for (const field of ['previous_response_id', 'conversation'] as const) {
            if (field in entry.userNative) {
              // A historical turn whose stored input is bound to client-owned provider state:
              // replaying it stripped would reinterpret it silently. Refuse; the lawful
              // recovery is a regeneration fork from BEFORE the poisoned turn.
              return fail('continuation_conflict', 'history_carries_client_continuation');
            }
          }
        }
      }
      // ── Anchor scan: the LAST eligible completed output with a provider-terminal BODY,
      //    walked from the end (a provider-declared failure contributes no output at all) ────
      let anchorIndex = -1;
      let anchorTerminal: JsonObject | null = null;
      // PAYLOAD-level provider failures after the anchor (review finding, exact head fafbff6):
      // a 2xx capture ending in `response.failed` is durably COMPLETED, so the durable
      // state-derived flag alone cannot see it — but a failure the scan walks past sits AFTER
      // the eventual anchor by construction, and it must demote exactly like a durable one.
      let payloadFailureAfterAnchor = false;
      for (let i = input.entries.length - 1; i >= 0; i -= 1) {
        const candidate = input.entries[i]!;
        if (candidate.assistant === null) continue;
        const resolution = terminalResponseOf(candidate);
        if (resolution.kind === 'provider_failed') {
          payloadFailureAfterAnchor = true; // input-only turn — keep walking
          continue;
        }
        anchorIndex = i;
        anchorTerminal = resolution.body;
        break;
      }

      if (anchorIndex >= 0 && anchorTerminal !== null) {
        const anchorEntry = input.entries[anchorIndex]!;
        const terminal = anchorTerminal;
        const anchorId = responseIdOf(terminal);
        // Condition 6 — FAILURE-AWARE DEMOTION (review finding, exact head 65150e9): a stored
        // response can be DELETED through the provider's supported deletion API while every
        // static condition still holds; the chained POST then fails, and a purely static
        // anchor selection would re-select the same dead parent forever. A provider-observed
        // FAILURE on any turn AFTER the anchor therefore demotes this build to stateless
        // replay — which does not need the anchor at all, succeeds, and its own response
        // becomes the NEXT anchor: the branch self-heals without probing or anchor state.
        const providerFailedAfterAnchor =
          payloadFailureAfterAnchor ||
          input.entries.slice(anchorIndex + 1).some((e) => e.selectedAttemptProviderFailed);
        // Every condition here is STRATEGY-SPECIFIC. Semantic replayability is NOT among them: it
        // was already decided when `terminalResponseOf` produced this resolution, which is what
        // makes `chainable ⇒ replayable` true by construction rather than by agreement between
        // two lists of checks that must be kept in sync.
        const chainable =
          anchorId !== null &&
          !providerFailedAfterAnchor &&
          isChainableTerminal(terminal) &&
          anchorEntry.assistant!.providerCredentialId === input.activeCredentialId &&
          configStoreAllowsChaining(anchorEntry.userNative) &&
          configStoreAllowsChaining(input.turnConfig) &&
          input.nowMs - anchorEntry.assistant!.completedAtMs < ANCHOR_MAX_AGE_MS;

        if (chainable) {
          // Turns after the anchor contributed user input only (had any contributed output,
          // IT would be the anchor) — their input rides along ahead of this turn's own.
          const trailing: unknown[] = [];
          for (const entry of input.entries.slice(anchorIndex + 1)) {
            trailing.push(...inputItemsOf(entry.userNative, 'history'));
          }
          // With nothing to merge, the turn's own `input` passes through VERBATIM (string or
          // array); only a genuine merge normalizes it into item form.
          const body: JsonObject =
            trailing.length === 0
              ? { ...input.turnConfig, previous_response_id: anchorId }
              : {
                  ...input.turnConfig,
                  input: [...trailing, ...inputItemsOf(input.turnConfig, 'own_turn')],
                  previous_response_id: anchorId,
                };
          return {
            ok: true,
            body,
            continuation: { kind: 'response_chain', parentResponseId: anchorId },
          };
        }
      }

      // ── Stateless replay: full durable projection, provider-native, in order ────────────
      const assembled: unknown[] = [];
      for (const entry of input.entries) {
        assembled.push(...inputItemsOf(entry.userNative, 'history'));
        if (entry.assistant) {
          const resolution = terminalResponseOf(entry);
          if (resolution.kind === 'terminal') {
            assembled.push(...resolution.output);
          }
          // provider_failed: the turn's question stays context; its non-answer never does.
        }
      }
      assembled.push(...inputItemsOf(input.turnConfig, 'own_turn'));
      return {
        ok: true,
        body: { ...input.turnConfig, input: assembled },
        continuation: { kind: 'stateless_replay' },
      };
    } catch (err) {
      if (err instanceof Unreplayable) return fail('context_unreplayable', err.detail);
      throw err;
    }
  },
};
