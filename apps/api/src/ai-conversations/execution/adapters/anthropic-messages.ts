// Anthropic Messages continuation — PROVIDER-NATIVE STATELESS REPLAY
// (EP-AI-CONVERSATION-CONTINUITY-V1 P0-D1; spec §11 "ANTHROPIC (Messages)", §12, §17;
// provider facts reverified against first-party documentation 2026-08-30).
//
// FIRST-PARTY FACTS THIS ADAPTER IS BUILT ON (reverified, not assumed):
//   * `/v1/messages` is STATELESS: "you specify the prior conversational turns with the
//     `messages` parameter". Full history is resent per request — there is no provider-held
//     conversation state to seed, taint or rotate on this surface.
//   * Consecutive same-role turns are LEGAL and are combined by the API — so a turn whose
//     attempt failed (contributing user input but no output) followed by the next user turn is
//     a valid history, not a protocol violation.
//   * Thinking blocks "must be passed back unmodified and in their original order"; passing
//     prior-turn thinking is the documented pattern ("Pass all thinking blocks back in
//     multi-turn conversations, and the API automatically filters them") — per-model keep-all
//     vs auto-strip is the PROVIDER's behavior, not ours to emulate.
//   * MODEL SWITCH: "When you switch between any two models … strip `thinking` and
//     `redacted_thinking` blocks from prior assistant turns. Thinking blocks are tied to the
//     model that produced them." Applied below on the models ACTUALLY IN PLAY (review finding,
//     exact head 10a6d65): the historical side is the model the PROVIDER says produced the
//     answer (the response body's / `message_start`'s own `model`, falling back to the request
//     that produced it, then to branch metadata), and the current side is the dispatching
//     config's own `model` (falling back to branch metadata). Branch columns are defaults the
//     send contract deliberately does not force the native body to match, so comparing
//     metadata alone could both retain foreign signed thinking (provider rejects) and strip
//     valid thinking (silent quality loss).
//   * Streaming: content arrives as `content_block_start` / `content_block_delta`
//     (`text_delta` | `input_json_delta` | `thinking_delta` | `signature_delta` |
//     `citations_delta`) / `content_block_stop`, with the signature "as a `signature_delta`
//     … just before the `content_block_stop`".
//
// ★ THE CONTEXT-BEARING FIELD IS `messages`, AND ONLY `messages`. The build spreads the turn's
// immutable config and replaces `messages` with [assembled history … the turn's OWN messages].
// Everything else — model, max_tokens, system, tools, tool_choice, thinking, metadata,
// stop_sequences, stream — passes through verbatim (§30). `cache_control` markers inside the
// turn's own content pass through untouched: prompt caching is a cost optimization, never a
// correctness dependency (§17 of the movement dispatch), and P0-D1 neither adds nor strips
// breakpoints.
//
// ★ THE TURN'S OWN `messages` ARRAY IS THE TURN'S OWN INPUT. Under server-assembled context the
// send contract is: a turn's `native_request.messages` carries THAT turn's new content (one or
// more messages — e.g. a user message, or tool_result continuations), never the full history —
// the server owns history (LAW 5, the movement's north star). A first turn with no eligible
// history is passed VERBATIM, byte-identical to P0-C behavior.
//
// ★ STREAM REASSEMBLY FAILS CLOSED. A durable stream is reassembled into the terminal assistant
// message by replaying the documented event grammar. An event or delta type this adapter does
// not recognise is an explicit `context_unreplayable` refusal — never a silent drop and never
// a flatten-to-text (§31): guessing at unrecognised provider state would put words in the
// model's mouth on every later turn.

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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Stream reassembly — durable SSE bytes → the terminal assistant message
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Parse the durable SSE text into ordered JSON event payloads. Tolerates both `data:`-only
 *  framing and `event: …` + `data: …` framing; ignores comment lines and `[DONE]`-style
 *  sentinels (not part of the Anthropic grammar, but cheap to survive). */
function parseSseEvents(sseText: string): unknown[] {
  const events: unknown[] = [];
  for (const line of sseText.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new UnreplayableStream('sse_data_not_json');
    }
    events.push(parsed);
  }
  return events;
}

class UnreplayableStream extends Error {
  constructor(readonly detail: string) {
    super(`stream is not replayable (${detail})`);
    this.name = 'UnreplayableStream';
  }
}

/** The provider's own terminal FAILURE verdict (an `error` SSE event): the turn produced no
 *  answer, so it projects as INPUT-ONLY context — mirroring how a `failed` attempt projects —
 *  never as a refusal that would block the branch behind a provider failure (review finding,
 *  exact head 14746af; the executor durably completes any 2xx stream from HTTP status alone). */
class ProviderFailedStream extends Error {
  constructor() {
    super('provider reported a terminal failure for this stream');
    this.name = 'ProviderFailedStream';
  }
}

/** Reassemble `{ role, content, model }` from a completed attempt's durable stream bytes. */
function assistantMessageFromStream(sseText: string): {
  role: string;
  content: unknown[];
  model: string | null;
} {
  const events = parseSseEvents(sseText);
  let role = 'assistant';
  let model: string | null = null;
  // Sparse by `index`, exactly as the wire addresses blocks.
  const blocks = new Map<number, JsonObject>();
  const partialJson = new Map<number, string>();
  const order: number[] = [];
  // ★ TERMINAL-GRAMMAR VALIDATION (review finding, exact head e08465fd): the EXECUTOR marks a
  // 2xx stream `completed` on byte-stream EOF — it does not know the provider's event grammar.
  // A cleanly truncated stream (a proxy closing after a partial `text_delta`, a block that
  // never stopped) therefore CAN be durably `completed`, and replaying its partial answer as a
  // finished assistant message would silently put words in the model's mouth on every later
  // turn. So the REASSEMBLER owns the grammar check: every started block must have stopped and
  // the terminal `message_stop` must have been observed, else the replay refuses (§31) — the
  // same posture as the OpenAI adapter's `response.completed` requirement.
  const openBlocks = new Set<number>();
  /** Blocks whose signature_delta was seen: the signature SIGNS the accumulated thinking, so
   *  it must be the FINAL delta of its block — any later delta would mutate signed content
   *  (review finding, exact head cf65d0c). */
  const signedBlocks = new Set<number>();
  let sawMessageStart = false;
  let sawMessageStop = false;
  /** The provider's failure verdict, RECORDED rather than thrown (review finding, exact head
   *  7c8e21e): throwing at the `error` frame would stop inspection, letting a conflicting
   *  success sequence AFTER it silently degrade to input-only — a conflicted capture must
   *  REFUSE, exactly like the OpenAI conflicting-verdict rule. */
  let sawError = false;
  /** Indexes name POSITIONS in the final content array, so starts must arrive contiguously
   *  from 0 (review finding, exact head 65150e9): a gap means an unknown block was lost, and
   *  out-of-order starts would reorder assistant content. */
  let nextBlockIndex = 0;

  for (const raw of events) {
    if (!isObject(raw) || typeof raw['type'] !== 'string') {
      throw new UnreplayableStream('sse_event_shape_unknown');
    }
    const type = raw['type'];
    // `message_stop` is TERMINAL (review finding, exact head 4a95cb2): any frame after it is a
    // duplicated or out-of-order capture, and processing it would replay post-terminal content
    // that the terminal validation could no longer catch.
    if (sawMessageStop) throw new UnreplayableStream('frame_after_message_stop');
    // The `error` verdict is terminal too: a success-shaped continuation after it is a
    // CONFLICTED capture and refuses — never a silent choice between the two verdicts.
    if (sawError) throw new UnreplayableStream('frame_after_error');
    switch (type) {
      case 'message_start': {
        // Exactly ONE message_start, and it must open the stream's message (review finding,
        // exact head bf7e1a8): a duplicate could silently swap the role/model metadata the
        // replay depends on, and a non-assistant role would replay provider output as another
        // speaker. Role is validated strictly WHEN PRESENT; a role-less skeleton keeps the
        // assistant default (the only role a Messages response can carry).
        if (sawMessageStart) throw new UnreplayableStream('duplicate_message_start');
        sawMessageStart = true;
        const message = raw['message'];
        if (isObject(message) && typeof message['role'] === 'string') {
          if (message['role'] !== 'assistant') {
            throw new UnreplayableStream('message_role_not_assistant');
          }
          role = message['role'];
        }
        if (isObject(message) && typeof message['model'] === 'string') model = message['model'];
        break;
      }
      case 'content_block_start': {
        if (!sawMessageStart) throw new UnreplayableStream('content_before_message_start');
        const index = raw['index'];
        const block = raw['content_block'];
        if (typeof index !== 'number' || !isObject(block)) {
          throw new UnreplayableStream('content_block_start_shape_unknown');
        }
        // Indexes are unique within one message: a REUSED start (a duplicated frame, a corrupt
        // capture) would overwrite the first block and double-replay the replacement (review
        // finding, exact head 7f8dc89). Refuse rather than corrupt.
        if (blocks.has(index)) throw new UnreplayableStream('block_index_reused');
        if (index !== nextBlockIndex) throw new UnreplayableStream('block_index_not_contiguous');
        nextBlockIndex += 1;
        // KNOWN block types validate their required start fields (review finding, exact head
        // fafbff6): a text block whose `text` is not a string would silently drop the start
        // value on the first delta append, and a tool_use missing id/name/input would replay a
        // shape the provider rejects. Unknown block types still pass through verbatim — the
        // forward-compatible §31 posture — and are protected by the delta-compat map.
        {
          const blockType = block['type'];
          const startInvalid =
            (blockType === 'text' && typeof block['text'] !== 'string') ||
            (blockType === 'thinking' && typeof block['thinking'] !== 'string') ||
            (blockType === 'redacted_thinking' && typeof block['data'] !== 'string') ||
            ((blockType === 'tool_use' || blockType === 'server_tool_use' || blockType === 'mcp_tool_use') &&
              (typeof block['id'] !== 'string' ||
                typeof block['name'] !== 'string' ||
                !isObject(block['input'])));
          if (startInvalid) throw new UnreplayableStream('block_start_payload_invalid');
        }
        blocks.set(index, { ...block });
        order.push(index);
        openBlocks.add(index);
        break;
      }
      case 'content_block_delta': {
        const index = raw['index'];
        const delta = raw['delta'];
        if (typeof index !== 'number' || !isObject(delta) || typeof delta['type'] !== 'string') {
          throw new UnreplayableStream('content_block_delta_shape_unknown');
        }
        const block = blocks.get(index);
        if (!block) throw new UnreplayableStream('delta_without_block');
        // A delta after the block's own stop (a duplicated or out-of-order frame) would mutate
        // retained content while still passing the terminal checks (review finding, exact head
        // ca5bfe2): deltas require the block to be OPEN.
        if (!openBlocks.has(index)) throw new UnreplayableStream('delta_after_stop');
        if (signedBlocks.has(index)) throw new UnreplayableStream('delta_after_signature');
        // Deltas must MATCH their block's type (review finding, exact head 4a95cb2): an
        // `input_json_delta` mutating a `text` block (or a `text_delta` mutating `tool_use`)
        // fabricates content the event grammar never expressed. Scoped to KNOWN delta types —
        // an unknown type still gets the more precise `delta_type_unknown` from the switch.
        {
          const blockType = block['type'];
          const deltaType = delta['type'];
          const expectation: Record<string, readonly string[]> = {
            text_delta: ['text'],
            citations_delta: ['text'],
            thinking_delta: ['thinking'],
            signature_delta: ['thinking'],
            input_json_delta: ['tool_use', 'server_tool_use', 'mcp_tool_use'],
          };
          const allowed = expectation[deltaType];
          if (allowed && (typeof blockType !== 'string' || !allowed.includes(blockType))) {
            throw new UnreplayableStream('delta_block_type_mismatch');
          }
        }
        // ★ KNOWN DELTA TYPES VALIDATE THEIR PAYLOAD FIELD STRICTLY (review finding, exact
        // head c8cc5bb): coercing a missing/mistyped payload (`String(x ?? '')`) would
        // silently ALTER content — e.g. an `input_json_delta` without `partial_json`
        // accumulating as '' and reconstructing as fabricated `{}` tool arguments. A malformed
        // payload on a known type refuses, exactly like an unknown type.
        switch (delta['type']) {
          case 'text_delta': {
            const text = delta['text'];
            if (typeof text !== 'string') throw new UnreplayableStream('delta_payload_invalid');
            block['text'] = `${typeof block['text'] === 'string' ? block['text'] : ''}${text}`;
            break;
          }
          case 'thinking_delta': {
            const thinking = delta['thinking'];
            if (typeof thinking !== 'string') throw new UnreplayableStream('delta_payload_invalid');
            block['thinking'] = `${typeof block['thinking'] === 'string' ? block['thinking'] : ''}${thinking}`;
            break;
          }
          case 'signature_delta': {
            // Byte-preserved: the signature is stored exactly as the wire delivered it (§18 of
            // the movement dispatch — never synthesize or modify signatures).
            const signature = delta['signature'];
            if (typeof signature !== 'string') throw new UnreplayableStream('delta_payload_invalid');
            block['signature'] = signature;
            signedBlocks.add(index);
            break;
          }
          case 'input_json_delta': {
            const fragment = delta['partial_json'];
            if (typeof fragment !== 'string') throw new UnreplayableStream('delta_payload_invalid');
            partialJson.set(index, `${partialJson.get(index) ?? ''}${fragment}`);
            break;
          }
          case 'citations_delta': {
            if (!isObject(delta['citation'])) throw new UnreplayableStream('delta_payload_invalid');
            const citations = Array.isArray(block['citations']) ? (block['citations'] as unknown[]) : [];
            citations.push(delta['citation']);
            block['citations'] = citations;
            break;
          }
          default:
            // An unknown delta type means provider state this adapter cannot faithfully
            // reconstruct. Refuse rather than replay a guess (§31).
            throw new UnreplayableStream('delta_type_unknown');
        }
        break;
      }
      case 'content_block_stop': {
        const index = raw['index'];
        if (typeof index !== 'number') throw new UnreplayableStream('content_block_stop_shape_unknown');
        const block = blocks.get(index);
        if (!block) throw new UnreplayableStream('stop_without_block');
        if (!openBlocks.has(index)) throw new UnreplayableStream('block_already_stopped');
        // A `thinking` block must carry its signature before it may close (review finding,
        // exact head bf7e1a8): the pass-back contract requires signed thinking, and replaying
        // an unsigned block would make the provider reject every later turn.
        if (blocks.get(index)!['type'] === 'thinking' && !signedBlocks.has(index)) {
          throw new UnreplayableStream('thinking_block_unsigned');
        }
        const acc = partialJson.get(index);
        if (acc !== undefined) {
          let parsedInput: unknown;
          try {
            parsedInput = acc === '' ? {} : JSON.parse(acc);
          } catch {
            throw new UnreplayableStream('tool_input_json_invalid');
          }
          // The accumulated value must satisfy the SAME object check as the block-start
          // `input` (review finding, exact head 9fe03ad): valid-but-non-object JSON ("[]",
          // "null", a primitive) would overwrite the validated object with a shape the
          // provider rejects on replay.
          if (!isObject(parsedInput)) throw new UnreplayableStream('tool_input_json_invalid');
          block['input'] = parsedInput;
          partialJson.delete(index);
        }
        openBlocks.delete(index);
        break;
      }
      case 'message_stop':
        sawMessageStop = true;
        break;
      case 'message_delta': // stop_reason/usage — carries no content to reassemble.
      case 'ping':
        break;
      case 'error':
        // The provider's own failure verdict — recorded; the end-of-stream resolution below
        // projects input-only, and any FOLLOWING frame refuses as a conflicted capture.
        sawError = true;
        break;
      default:
        throw new UnreplayableStream('event_type_unknown');
    }
  }
  // A pure failure verdict (nothing followed it): the turn projects as input-only. The
  // truncation/content checks deliberately do not apply to a stream the provider itself
  // declared failed.
  if (sawError) throw new ProviderFailedStream();
  if (order.length === 0) throw new UnreplayableStream('stream_has_no_content_blocks');
  if (openBlocks.size > 0 || !sawMessageStop) throw new UnreplayableStream('stream_truncated');
  return { role, content: order.map((i) => blocks.get(i)!), model };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// History assembly
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The first-party model-switch rule: strip thinking blocks produced under a DIFFERENT model. */
function stripForeignThinking(content: unknown[]): unknown[] {
  return content.filter(
    (block) =>
      !isObject(block) || (block['type'] !== 'thinking' && block['type'] !== 'redacted_thinking'),
  );
}

/** The `model` a native request/response object names, when it names one. */
function nativeModelOf(value: unknown): string | null {
  return isObject(value) && typeof value['model'] === 'string' ? value['model'] : null;
}

function assistantMessageFromEntry(
  entry: AssembledContextEntry,
  currentModel: string,
): { role: string; content: unknown } {
  const output = entry.assistant!.output;
  let role: string;
  let content: unknown[];
  let producedBy: string | null;
  if (output.kind === 'response') {
    const body = output.body;
    if (!isObject(body) || !Array.isArray(body['content'])) {
      throw new UnreplayableStream('response_body_shape_unknown');
    }
    // Same assistant-role validation as the stream path (review finding, exact head 50d55d6):
    // a corrupted body carrying another role would replay provider output as an instruction.
    if (typeof body['role'] === 'string' && body['role'] !== 'assistant') {
      throw new UnreplayableStream('message_role_not_assistant');
    }
    role = typeof body['role'] === 'string' ? body['role'] : 'assistant';
    content = body['content'] as unknown[];
    producedBy = nativeModelOf(body);
  } else {
    const message = assistantMessageFromStream(output.sseText);
    role = message.role;
    content = message.content;
    producedBy = message.model;
  }
  // The model that produced this answer, from NATIVE truth outward: the provider's own
  // response `model`, else the request that produced it, else branch metadata (the send
  // contract does not force the native body to match the branch column, so the column is a
  // fallback — never the primary comparison).
  const historicalModel = producedBy ?? nativeModelOf(entry.userNative) ?? entry.sourceModel;
  if (historicalModel !== currentModel) {
    content = stripForeignThinking(content);
    if (content.length === 0) {
      // An assistant message whose entire content was foreign thinking cannot be replayed as
      // an empty message; refuse honestly (§18 of the movement dispatch: explicit truthful
      // degraded outcome, never silent loss).
      throw new UnreplayableStream('model_switch_leaves_empty_message');
    }
  }
  return { role, content };
}

export const anthropicMessagesAdapter: ProviderConversationAdapter = {
  provider: 'anthropic',

  buildRequest(input: BuildRequestInput): BuildRequestResult {
    // No eligible history: the turn's own immutable config IS the request, verbatim — the
    // first turn of a branch behaves byte-identically to P0-C, which is what keeps the P0-C
    // fidelity proofs true unchanged.
    if (input.entries.length === 0) {
      if (!isObject(input.turnConfig)) return fail('context_unreplayable', 'config_not_object');
      return { ok: true, body: input.turnConfig, continuation: { kind: 'stateless_replay' } };
    }

    if (!isObject(input.turnConfig)) return fail('context_unreplayable', 'config_not_object');
    const ownMessages = input.turnConfig['messages'];
    if (!Array.isArray(ownMessages)) {
      // With history to splice, a config whose `messages` is not an array cannot be assembled
      // faithfully; the provider owns validity of everything else.
      return fail('context_unreplayable', 'config_messages_not_array');
    }

    const currentModel = nativeModelOf(input.turnConfig) ?? input.branchModel;
    const history: unknown[] = [];
    try {
      for (const entry of input.entries) {
        if (entry.sourceProvider !== 'anthropic') {
          // A §17 cross-provider fork ancestor. The portable projection (normalized text +
          // declared tool outcomes, DLP re-scanned, quality loss labeled — LAW NX-16) is a
          // later P0-D arc; until it exists the only honest dispatch is a PRECISE refusal —
          // never a silent flatten and never an incidental shape error.
          return fail('context_unreplayable', 'cross_provider_replay_not_implemented');
        }
        const native = entry.userNative;
        if (!isObject(native) || !Array.isArray(native['messages'])) {
          return fail('context_unreplayable', 'history_input_shape_unknown');
        }
        history.push(...(native['messages'] as unknown[]));
        if (entry.assistant) {
          try {
            history.push(assistantMessageFromEntry(entry, currentModel));
          } catch (err) {
            if (!(err instanceof ProviderFailedStream)) throw err;
            // Input-only projection: the question stays context; the non-answer never does.
          }
        }
      }
    } catch (err) {
      if (err instanceof UnreplayableStream) return fail('context_unreplayable', err.detail);
      throw err;
    }

    return {
      ok: true,
      body: { ...input.turnConfig, messages: [...history, ...ownMessages] },
      continuation: { kind: 'stateless_replay' },
    };
  },
};
