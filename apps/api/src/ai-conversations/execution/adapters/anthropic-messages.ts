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
//   * STREAM EVENT FLOW (reverified 2026-08-31, verbatim): "1. `message_start` … 2. A series of
//     content blocks … 3. One or more `message_delta` events … 4. A final `message_stop`
//     event." — the message-level delta CLOSES the content phase, but it is explicitly NOT
//     unique, so this adapter enforces its ORDERING and refuses to enforce a cardinality the
//     provider does not promise. `ping`: "Event streams may also include any number of `ping`
//     events" — stated with no positional constraint, so ping is legal wherever a frame is.
//   * REFUSALS ARE 2xx NON-ANSWERS: a classifier refusal is "a normal response, not an error"
//     with `"content": []`, `stop_reason: "refusal"` and `output_tokens: 0`. An empty assistant
//     message is therefore a PROVIDER NON-ANSWER (input-only projection), never a corruption to
//     refuse — refusing it would brick every later turn of a branch that contains one.
//   * A completed `thinking` block ALWAYS carries a string `signature` (both the summarized and
//     the `display: "omitted"` response shapes show one); `redacted_thinking` carries `data`.
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// THE REPLAY LAW — ONE SET OF INVARIANTS, BOTH TRANSPORTS
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** The ONLY role a `/v1/messages` response can carry. First-party `Message.role` is typed as the
 *  literal `'assistant'` and documented "This will always be `\"assistant\"`." */
const ASSISTANT_ROLE = 'assistant';

/** ★ THE ASSISTANT-ROLE LAW, SHARED BY BOTH DOORS (independent validator audit; RF-3). A
 *  `/v1/messages` response IS an assistant message; replaying one under any other role would feed
 *  provider output back into the next prompt as an instruction.
 *
 *  IT IS EXPRESSED ONCE BECAUSE IT ALREADY DRIFTED ONCE: review finding 3891516882 (exact head
 *  50d55d6) was this exact law present on the stream door and missing on the stored-response
 *  door. Two independent copies of one truth is the defect shape that audit removed, so the
 *  copies are two ENFORCEMENT POINTS of a single predicate rather than two rules.
 *
 *  ★ RF-3 — MALFORMED PRESENCE IS NOT ABSENCE (review finding 3899816809). The predicate used to
 *  read `typeof role === 'string' && role !== 'assistant'`, so a PRESENT non-string role (`42`,
 *  `null`, `{}`, `true`, `["assistant"]`) was not "invalid" — it was silently laundered into the
 *  assistant default and replayed under a role the provider never recorded. First-party requires
 *  `role` and admits exactly one value, so a present non-`assistant` role has NO legitimate
 *  representation and refusing it cannot refuse real provider output.
 *
 *  ABSENCE, and ONLY absence, still defaults: the field's one lawful value is a CONSTANT, so
 *  reconstructing it returns the provider's own value and cannot alter the replayed message —
 *  whereas refusing it would brick a branch forever for zero fidelity gain. That asymmetry is the
 *  whole law: defaulting is allowed only after the raw value is proven legitimately absent, never
 *  as a way to make corrupt evidence look valid. */
function roleInvalid(role: unknown): boolean {
  return role !== undefined && role !== ASSISTANT_ROLE;
}

/** ★ THE PROVIDER-MODEL LAW — RF-3's CLOSEST SIBLING, AND THE SAME SHAPE (RF-3 sibling audit).
 *  `model` is REQUIRED on `Message`, and GovAI SEMANTICALLY CONSUMES it: it is the historical side
 *  of the model-switch comparison that decides whether signed `thinking` is passed back or
 *  stripped. Read through the old `typeof … === 'string' ? … : null` coercion, a PRESENT malformed
 *  model collapsed into `null` — indistinguishable from "the provider did not name a model" — and
 *  the fallback chain then answered with the REQUEST's model. Corrupt provenance became a
 *  confident same-model verdict, which PRESERVES signed thinking under a provenance the capture
 *  itself contradicts.
 *
 *  So: absent → `null`, and the documented fallback chain (request → branch metadata) applies,
 *  exactly as before. Present but not a string → REFUSE. Model IDENTITY is never inspected: GovAI
 *  is model-agnostic by architecture, and any string is provider truth. */
function providerModelOf(message: JsonObject): string | null {
  const model = message['model'];
  if (model === undefined) return null;
  if (typeof model !== 'string') throw new UnreplayableStream('message_model_not_string');
  return model;
}

/** ★ RF-4 — THE `citations` CONTAINER LAW, EXPRESSED EXACTLY ONCE (review finding 3900679017).
 *  First-party: the RESPONSE `TextBlock.citations` is `Array<TextCitation> | null`, and the
 *  REQUEST `TextBlockParam.citations` is OPTIONAL and `Array<TextCitationParam> | null`. So
 *  ABSENT, `null` and ARRAY are all lawful — on the wire GovAI reads AND on the wire it replays
 *  onto — while a PRESENT non-array has no representation on either side. Refusing one therefore
 *  cannot refuse legitimate provider output, and the justification is the one that already
 *  justifies `thinking_block_unsigned`: a malformed block sits in the branch's history forever,
 *  so an opaque provider 400 would repeat on EVERY later turn, whereas `context_unreplayable`
 *  fails once, precisely, and names the reason.
 *
 *  ★ THE ELEMENTS ARE DELIBERATELY NOT VALIDATED. `TextCitation` is an OPEN, provider-evolving
 *  union — it has already grown `web_search_result_location` and `search_result_location` beyond
 *  the original three location kinds — so enforcing a closed element list would version-lock this
 *  adapter and refuse FUTURE legitimate provider output. That is the §31 forward-compatible
 *  posture already kept for unknown block types and unknown fields. CONTAINER SHAPE: STRICT.
 *  ARRAY ELEMENT UNION: FORWARD COMPATIBLE. */
function citationsContainerInvalid(citations: unknown): boolean {
  return citations !== undefined && citations !== null && !Array.isArray(citations);
}

/** ★ THE KNOWN-BLOCK PAYLOAD LAW, SHARED BY BOTH DOORS (closure sweep). A provider-produced
 *  Anthropic assistant message is replayable only if its blocks satisfy the SAME invariants,
 *  whether they arrived as a JSON response body or were reassembled from SSE — duplicating the
 *  rules is what let the two paths drift apart.
 *
 *  `phase` distinguishes the two LAWFUL moments of a streamed `thinking` block: at
 *  `content_block_start` its signature has not arrived yet (first-party: the block opens as
 *  `{"type":"thinking","thinking":"","signature":""}` and the real value is delivered "as a
 *  `signature_delta` … just before the `content_block_stop`"), while the FINAL block must carry
 *  it — every documented completed `thinking` block does. UNKNOWN block types are deliberately
 *  unconstrained: the forward-compatible §31 posture passes them through verbatim (a
 *  server-side-fallback `fallback` block, which "stays where it appeared", is exactly this
 *  case).
 *
 *  ★ RF-4 — A KNOWN BLOCK'S SEMANTIC FIELDS ARE ADJUDICATED HERE, NOT AT A TRANSPORT SITE. The
 *  `citations` container rule joined this law because it had been placed at the `citations_delta`
 *  ACCUMULATION SITE instead, so it fired only when a delta happened to arrive: one raw value
 *  produced TWO verdicts — refused on the delta path, replayed verbatim through the stored door
 *  and through a stream whose text block carried no delta. This function is the one point BOTH
 *  doors run, at BOTH phases, so expressing the rule here is what makes the verdict identical
 *  however the block arrived. The container law is phase-independent and safe at `start`:
 *  first-party types the streamed `content_block_start.content_block` for a text block as the
 *  SAME `TextBlock`, so a lawful opening shape (`citations` absent or `null`) still passes. */
function blockPayloadInvalid(block: JsonObject, phase: 'start' | 'final'): boolean {
  const type = block['type'];
  return (
    (type === 'text' &&
      (typeof block['text'] !== 'string' || citationsContainerInvalid(block['citations']))) ||
    (type === 'thinking' &&
      (typeof block['thinking'] !== 'string' ||
        (phase === 'final' && typeof block['signature'] !== 'string'))) ||
    (type === 'redacted_thinking' && typeof block['data'] !== 'string') ||
    ((type === 'tool_use' || type === 'server_tool_use' || type === 'mcp_tool_use') &&
      (typeof block['id'] !== 'string' ||
        typeof block['name'] !== 'string' ||
        !isObject(block['input'])))
  );
}

/** ★ THE FINAL REPLAY VALIDATION, APPLIED TO WHICHEVER DOOR PRODUCED THE MESSAGE (closure
 *  sweep, post-pause review finding; the role law folded in by the independent validator audit).
 *  Stored non-streaming bodies were admitted with NO per-block validation at all while the
 *  reassembler enforced the full stream grammar — so an unsigned `thinking` block (which the
 *  provider ALWAYS signs) could enter same-model replay through the non-streaming door and make
 *  Anthropic reject every later turn of the branch.
 *
 *  THIS IS THE SEMANTIC LAW, not a transport one: it is the single point BOTH the stored JSON
 *  body and the reassembled SSE message must pass before either may join a prompt, and it runs
 *  BEFORE the model-switch projection — a lawful transformation OF A VALID message, never a way
 *  to launder an invalid one. Transport-only grammar (`message_start` discipline, block
 *  lifecycle, delta compatibility, terminal proof) stays in the reassembler where it belongs. */
function validateReplayableMessage(role: unknown, content: unknown[]): void {
  // THE ROLE LAW RUNS FIRST, AND DELIBERATELY SO: a message captured under the wrong role is a
  // corrupt capture whatever it contains, and an empty one must not be reclassified as a lawful
  // provider non-answer on the way past.
  if (roleInvalid(role)) throw new UnreplayableStream('message_role_not_assistant');
  // ★ AN EMPTY CONTENT ARRAY IS A PROVIDER NON-ANSWER, NEVER A CORRUPTION (closure sweep,
  // first-party fact reverified 2026-08-31). A classifier refusal is "a normal response, not an
  // error": HTTP 2xx, `"content": []`, `stop_reason: "refusal"`, `output_tokens: 0`. Refusing
  // it would be the worst possible outcome — a refused turn sits in the branch's history
  // forever, so EVERY later turn would refuse too and the branch would be permanently bricked.
  // It projects INPUT-ONLY instead, exactly as the `error` stream verdict and the OpenAI
  // `failed`/`cancelled` statuses do: the question stays context, the non-answer never does.
  if (content.length === 0) throw new ProviderFailedStream();
  for (const block of content) {
    if (!isObject(block)) throw new UnreplayableStream('content_block_not_object');
    // Every documented Anthropic content block carries a `type` discriminator. Requiring it is
    // STRUCTURAL, not a version lock — unknown type VALUES still pass through verbatim.
    if (typeof block['type'] !== 'string') {
      throw new UnreplayableStream('content_block_type_invalid');
    }
    if (blockPayloadInvalid(block, 'final')) {
      throw new UnreplayableStream('content_block_payload_invalid');
    }
  }
}

/** Reassemble `{ role, content, model }` from a completed attempt's durable stream bytes.
 *  `role` is returned as RAW provider evidence (`unknown`, `undefined` when the start message
 *  carried none) so the shared semantic law sees exactly what the wire said — RF-3. */
function assistantMessageFromStream(sseText: string): {
  role: unknown;
  content: unknown[];
  model: string | null;
} {
  const events = parseSseEvents(sseText);
  let role: unknown;
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
  /** The message-level delta CLOSES the content phase (post-pause review finding). NOTE THE
   *  CARDINALITY: first-party says "One or more `message_delta` events", so a REPEATED message
   *  delta is LEGAL — enforcing uniqueness here would refuse legitimate provider output, which
   *  is its own defect. Only the ORDERING is a grammar violation. */
  let sawMessageDelta = false;
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
    // ★ CONTENT AFTER THE MESSAGE-LEVEL DELTA IS OUT OF GRAMMAR (post-pause review finding).
    // The first-party event flow is: `message_start` → "A series of content blocks" → "One or
    // more `message_delta` events" → "A final `message_stop` event". A content-block frame
    // after the message delta is therefore a duplicated or out-of-order capture, and admitting
    // it would splice post-content text into every later prompt on the branch.
    if (
      sawMessageDelta &&
      (type === 'content_block_start' ||
        type === 'content_block_delta' ||
        type === 'content_block_stop')
    ) {
      throw new UnreplayableStream('content_after_message_delta');
    }
    switch (type) {
      case 'message_start': {
        // Exactly ONE message_start, and it must open the stream's message (review finding,
        // exact head bf7e1a8): a duplicate could silently swap the role/model metadata the
        // replay depends on, and a non-assistant role would replay provider output as another
        // speaker. Role is validated strictly WHEN PRESENT; a role-less skeleton keeps the
        // assistant default (the only role a Messages response can carry).
        if (sawMessageStart) throw new UnreplayableStream('duplicate_message_start');
        sawMessageStart = true;
        // First-party: `message_start` "contains a `Message` object with empty `content`" — a
        // frame without one carries none of the role/model metadata the replay reads.
        const message = raw['message'];
        if (!isObject(message)) throw new UnreplayableStream('message_start_shape_unknown');
        // ★ THE RAW ROLE IS CARRIED FORWARD UNNORMALIZED (RF-3). The law is enforced here for
        // an early, precise refusal AND again at `validateReplayableMessage` — but on the RAW
        // value both times, so this door and the stored door feed the shared predicate the same
        // evidence. Normalizing here (the stored door's old sin) would make the two doors
        // disagree about `{role: 42}` while still "sharing" one predicate.
        role = message['role'];
        if (roleInvalid(role)) throw new UnreplayableStream('message_role_not_assistant');
        // ★ THE START MESSAGE CARRIES NO CONTENT (review finding RF-2, exact head d6cddf33).
        // First-party, verbatim: "`message_start`: contains a `Message` object with empty
        // `content`" — every documented example is `"content": []`. The reassembler builds the
        // final content from the content-block events ALONE, so start content would be SILENTLY
        // DROPPED and the message GovAI replays would differ from the message the provider sent.
        // This is WIRE GRAMMAR, not a final-message law (§15): a stored non-streaming body has
        // no `message_start` and must not inherit it. It is scoped to exactly what replay
        // fidelity depends on — content that is PRESENT must be an empty array; an ABSENT
        // `content` can lose nothing, so requiring its presence would be a version lock with no
        // consumer (§21).
        const startContent = message['content'];
        if (
          startContent !== undefined &&
          !(Array.isArray(startContent) && startContent.length === 0)
        ) {
          throw new UnreplayableStream('message_start_content_not_empty');
        }
        model = providerModelOf(message);
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
        // fafbff6) through the SHARED payload law, so the stored-response door cannot drift
        // from this one: a text block whose `text` is not a string would silently drop the
        // start value on the first delta append, and a tool_use missing id/name/input would
        // replay a shape the provider rejects. Unknown block types still pass through verbatim
        // — the forward-compatible §31 posture — and are protected by the delta-compat map.
        // The `type` DISCRIMINATOR itself is required (closure sweep): a typeless block replays
        // as a shape the provider rejects, and the delta-compat map can only catch it if a
        // delta happens to arrive.
        if (typeof block['type'] !== 'string' || blockPayloadInvalid(block, 'start')) {
          throw new UnreplayableStream('block_start_payload_invalid');
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
            // ★ RF-3 SIBLING — THE EXISTING `citations` IS PROVIDER EVIDENCE, NOT SCRATCH SPACE.
            // First-party `TextBlock.citations` is `Array<TextCitation> | null`, so `null` (and an
            // absent key) legitimately mean "none yet" and start a fresh array. A PRESENT
            // malformed value is neither: the old `Array.isArray(…) ? … : []` threw it away and
            // replaced it with a fabricated array, silently altering the content GovAI claims to
            // replay. Refuse instead — same law as the role and model fields.
            //
            // ★ RF-4 — ONE RULE, TWO ENFORCEMENT POINTS (never two rules). RF-3 expressed that
            // container rule HERE and only here, which is why it decided the verdict on this path
            // alone. It now lives in `citationsContainerInvalid`, which `blockPayloadInvalid` runs
            // for every `text` block at `content_block_start` — so a malformed container has
            // ALREADY refused before any delta reaches this line, and this call is unreachable
            // through the public API. It is kept, calling the SAME predicate rather than restating
            // it, for the reason the assistant-role law is enforced twice: the accumulator must
            // never be the place the law is weaker, because the failure it guards is silent
            // fabrication rather than a visible error.
            const existing = block['citations'];
            if (citationsContainerInvalid(existing)) {
              throw new UnreplayableStream('block_citations_invalid');
            }
            // Absent and `null` both mean "no citations yet" and start a fresh array; an existing
            // array is appended to. Provider evidence is never discarded — the shared law above
            // has already proven `existing` is one of exactly those three lawful shapes.
            const citations = Array.isArray(existing) ? (existing as unknown[]) : [];
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
        // ★ THE TERMINAL PROVES A MESSAGE THAT ACTUALLY BEGAN (review finding on fd2df776).
        // `message_stop` is step 4 of a flow whose step 1 is `message_start`, and since a
        // COMPLETE zero-block stream is now read as the provider's own non-answer, an
        // unanchored `message_stop` (alone, or after only pings) would be laundered from a
        // malformed capture into a silent input-only projection. The start flag is what
        // separates a real refusal from a capture that never carried a message at all.
        if (!sawMessageStart) throw new UnreplayableStream('message_stop_before_message_start');
        sawMessageStop = true;
        break;
      case 'message_delta': {
        // Top-level changes to the final Message (stop_reason / stop_sequence / usage). Its
        // PAYLOAD is deliberately not validated: nothing in the replayed `{role, content,
        // model}` message depends on it, so a shape rule here would harden a field the
        // replay never reads. Its POSITION, however, IS grammar — and is enforced.
        if (!sawMessageStart) throw new UnreplayableStream('message_delta_before_message_start');
        // Step 3 of the flow follows step 2 IN FULL: an open block here means the capture
        // interleaved the message-level delta into the content phase.
        if (openBlocks.size > 0) throw new UnreplayableStream('message_delta_before_block_stop');
        sawMessageDelta = true;
        break;
      }
      case 'ping':
        // First-party: "Event streams may also include any number of `ping` events" — stated
        // with NO positional constraint, so a ping stays legal anywhere a frame is legal at
        // all (the terminal guards above already bound that). Adjudicated, not assumed.
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
  // TRUNCATION IS ADJUDICATED FIRST (closure sweep): an incomplete capture is ambiguous
  // whatever it contains, and a missing terminal is exactly what distinguishes it from the
  // case below. A byte stream truncates at the TAIL, so a capture that reached `message_stop`
  // with every block closed did observe the whole message.
  if (openBlocks.size > 0 || !sawMessageStop) throw new UnreplayableStream('stream_truncated');
  // A COMPLETE stream carrying no content blocks is the streamed form of the same 2xx
  // non-answer the non-streaming door sees as `"content": []` — a classifier refusal. It is
  // the PROVIDER's answer, not a broken capture, so it projects input-only rather than
  // bricking every later turn of the branch. (Superseded `stream_has_no_content_blocks`,
  // which conflated this with truncation — the truncation guard above is the real proof.)
  // Reaching here REQUIRES both terminal proofs — the message provably began
  // (`message_stop_before_message_start`) and provably ended (`stream_truncated`) — so the
  // only zero-block stream that projects input-only is `message_start` [`message_delta`]
  // `message_stop`, which is exactly the documented refusal shape.
  if (order.length === 0) throw new ProviderFailedStream();
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

/** The `model` a native REQUEST object names, when it names one. Requests are GovAI/client-owned
 *  inputs the provider validates on dispatch — they are NOT captured provider evidence, so the
 *  RF-3 raw-evidence law does not apply to them and a shape that cannot be read simply falls
 *  through to the next link of the documented chain. Provider RESPONSES go through
 *  `providerModelOf`, which refuses malformed presence. */
function nativeModelOf(value: unknown): string | null {
  return isObject(value) && typeof value['model'] === 'string' ? value['model'] : null;
}

function assistantMessageFromEntry(
  entry: AssembledContextEntry,
  currentModel: string,
): { role: string; content: unknown } {
  const output = entry.assistant!.output;
  // ★ RAW PROVIDER EVIDENCE, CARRIED TO ITS LAW UNTRANSFORMED (RF-3). Whichever door produced it,
  // what reaches `validateReplayableMessage` is what the provider actually recorded — not a value
  // this function repaired on the way. The stored door used to normalize first
  // (`typeof body['role'] === 'string' ? body['role'] : 'assistant'`) and hand the shared
  // predicate a synthetic `'assistant'`, so ONE law was being fed TWO different inputs: the
  // consolidated predicate could not drift, but the evidence underneath it already had.
  let rawRole: unknown;
  let content: unknown[];
  let producedBy: string | null;
  if (output.kind === 'response') {
    const body = output.body;
    if (!isObject(body) || !Array.isArray(body['content'])) {
      throw new UnreplayableStream('response_body_shape_unknown');
    }
    rawRole = body['role'];
    content = body['content'] as unknown[];
    producedBy = providerModelOf(body);
  } else {
    const message = assistantMessageFromStream(output.sseText);
    rawRole = message.role;
    content = message.content;
    producedBy = message.model;
  }
  // ★ ONE REPLAY LAW FOR BOTH TRANSPORTS (closure sweep). Whichever door produced the message,
  // it must satisfy the same invariants before it may join a prompt — applied BEFORE the
  // model-switch projection, which is a lawful transformation OF A VALID message, never a way
  // to launder an invalid one.
  validateReplayableMessage(rawRole, content);
  // ★ THE DEFAULT IS APPLIED ONLY NOW, AFTER THE LAW HAS PROVEN THE RAW VALUE LEGITIMATE (RF-3):
  // it is either absent or exactly `assistant`, and both resolve to the one role a Messages
  // response can carry. Defaulting BEFORE this point is what turned corrupt captures into
  // valid-looking assistant messages.
  const role = ASSISTANT_ROLE;
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
