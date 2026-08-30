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
// ★ CLIENT-OWNED CONTINUATION FIELDS ARE A CONFLICT, NOT AN INPUT. A stored config carrying
// `previous_response_id` or `conversation` asserts continuation state the durable store cannot
// see: honoring it would build every LATER turn's context from history GovAI never persisted,
// and stripping it would silently rewrite a provider-native control (§30). The dispatch
// refuses truthfully (`continuation_conflict`) — on every turn, first included, so no hidden
// provider-side context can enter a durable conversation.

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
 *  `response.completed` event's `response` from the durable stream bytes. */
function terminalResponseOf(entry: AssembledContextEntry): JsonObject {
  const output = entry.assistant!.output;
  if (output.kind === 'response') {
    if (!isObject(output.body)) throw new Unreplayable('response_body_shape_unknown');
    return output.body;
  }
  let terminal: JsonObject | null = null;
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
    if (isObject(parsed) && parsed['type'] === 'response.completed' && isObject(parsed['response'])) {
      terminal = parsed['response'] as JsonObject;
    }
  }
  if (!terminal) throw new Unreplayable('stream_has_no_terminal_response');
  return terminal;
}

/** The provider's own id of the terminal response — the chaining anchor candidate. */
function responseIdOf(terminal: JsonObject): string | null {
  const id = terminal['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** The complete output array, replayed VERBATIM (reasoning items included — the documented
 *  stateless pattern; adjacency preserved, nothing filtered, nothing reshaped). */
function outputItemsOf(terminal: JsonObject): unknown[] {
  const output = terminal['output'];
  if (!Array.isArray(output)) throw new Unreplayable('response_output_shape_unknown');
  return output;
}

/** A turn's own input, normalized to items only when it must merge into an array — using the
 *  provider's documented string ≡ user-message equivalence. */
function inputItemsOf(native: unknown): unknown[] {
  if (!isObject(native)) throw new Unreplayable('history_input_shape_unknown');
  const input = native['input'];
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (Array.isArray(input)) return [...(input as unknown[])];
  throw new Unreplayable('history_input_shape_unknown');
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
      }
      // ── Anchor scan: the LAST eligible completed output, walked from the end ────────────
      let anchorIndex = -1;
      for (let i = input.entries.length - 1; i >= 0; i -= 1) {
        if (input.entries[i]!.assistant !== null) {
          anchorIndex = i;
          break;
        }
      }

      if (anchorIndex >= 0) {
        const anchorEntry = input.entries[anchorIndex]!;
        const terminal = terminalResponseOf(anchorEntry);
        const anchorId = responseIdOf(terminal);
        const chainable =
          anchorId !== null &&
          anchorEntry.assistant!.providerCredentialId === input.activeCredentialId &&
          configStoreAllowsChaining(anchorEntry.userNative) &&
          configStoreAllowsChaining(input.turnConfig) &&
          input.nowMs - anchorEntry.assistant!.completedAtMs < ANCHOR_MAX_AGE_MS;

        if (chainable) {
          // Turns after the anchor contributed user input only (had any contributed output,
          // IT would be the anchor) — their input rides along ahead of this turn's own.
          const trailing: unknown[] = [];
          for (const entry of input.entries.slice(anchorIndex + 1)) {
            trailing.push(...inputItemsOf(entry.userNative));
          }
          // With nothing to merge, the turn's own `input` passes through VERBATIM (string or
          // array); only a genuine merge normalizes it into item form.
          const body: JsonObject =
            trailing.length === 0
              ? { ...input.turnConfig, previous_response_id: anchorId }
              : {
                  ...input.turnConfig,
                  input: [...trailing, ...inputItemsOf(input.turnConfig)],
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
        assembled.push(...inputItemsOf(entry.userNative));
        if (entry.assistant) {
          assembled.push(...outputItemsOf(terminalResponseOf(entry)));
        }
      }
      assembled.push(...inputItemsOf(input.turnConfig));
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
