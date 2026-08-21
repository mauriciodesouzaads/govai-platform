// Walk an OpenAI Responses or Chat Completions body and return DLP-relevant
// text segments + their JSON paths.
//
// ─────────────────────────────────────────────────────────────────────────────
// AI-CONSOLE-RESPONSES-DLP-GAP-01 — owner-adjudicated FIX_REQUIRED
// (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §4)
//
// This walker used to descend into a Responses `input[]` item ONLY when the item
// carried an explicit `type: 'message'` AND an array `content`. The OpenAI
// Responses contract also accepts the role-shaped `EasyInputMessage` form, whose
// `type` is optional, and accepts a plain string `content` in either form — so
// semantically identical requests were scanned or not scanned depending purely on
// which accepted spelling the caller used. Measured against the running API with
// the same CPF in every body:
//
//   input: "…"                                                    → risk C, enforce
//   input: [{type:'message', role, content:[{type:'input_text'}]}] → risk C, enforce
//   input: [{role, content: "…"}]                                  → risk A, observe  ✗
//   input: [{role, content:[{type:'input_text', …}]}]              → risk A, observe  ✗
//
// A governed request whose text is invisible to the pre-scan is forwarded with
// base risk A and `enforcement_decision: observe`: the governance decision is
// sound for what it saw, and what it saw was nothing. Chat Completions and
// Anthropic Messages scan the same CPF correctly, which made the DEFAULT OpenAI
// surface the one place governed mode quietly scanned nothing.
//
// The five accepted message spellings now extract identically:
//
//   1. input: "text"
//   2. input: [{type:'message', role, content: "text"}]
//   3. input: [{type:'message', role, content: [{type:'input_text', text}]}]
//   4. input: [{role, content: "text"}]                        (EasyInputMessage)
//   5. input: [{role, content: [{type:'input_text', text}]}]   (EasyInputMessage)
//
// ★ NOT a recursive string scan. Extraction stays keyed to provider-semantic text
// fields — `instructions`, message `content`, and the `text` of a `text` /
// `input_text` / `output_text` content part. Ids, metadata, model names, tool
// identifiers, URLs and every other string in the body are still never treated as
// prompt text, and non-message input items (function_call, function_call_output,
// computer_call, reasoning, item_reference, …) keep their existing classifier
// responsibilities rather than becoming DLP text.

export type ExtractedSegment = {
  text: string;
  path: string;
};

/**
 * Is this object a Responses `input[]` MESSAGE item?
 *
 * Two accepted spellings, per the current OpenAI Responses contract:
 *   • the fully-qualified item — `type: 'message'` (role optional in the type,
 *     always present in practice);
 *   • `EasyInputMessage` — `type` is OPTIONAL, so the item is identified by its
 *     `role` alone.
 *
 * Requiring `type === undefined` for the role-shaped form is deliberate: an item
 * that names a DIFFERENT type is that type, even if it also carries a `role`, and
 * must not be re-read as a message.
 */
function isMessageItem(item: Record<string, unknown>): boolean {
  const type = item['type'];
  if (type === 'message') return true;
  return type === undefined && typeof item['role'] === 'string';
}

/**
 * Walk a `content` value — a string, or a list of provider content parts — and
 * push the text it carries. Shared by both surfaces: a Chat Completions
 * `messages[].content` and a Responses message `content` are the same shape of
 * thing, and a Responses `input[]` is walked with the same function so a
 * top-level content part keeps the coverage it has always had.
 */
function pushParts(parts: unknown, pathPrefix: string, out: ExtractedSegment[]): void {
  if (typeof parts === 'string') {
    out.push({ text: parts, path: pathPrefix });
    return;
  }
  if (!Array.isArray(parts)) return;
  parts.forEach((p, i) => {
    if (p && typeof p === 'object') {
      const part = p as Record<string, unknown>;
      // Chat Completions content parts: {type: 'text', text: '...'} | {type: 'image_url', ...}
      if (part['type'] === 'text' && typeof part['text'] === 'string') {
        out.push({ text: part['text'] as string, path: `${pathPrefix}[${i}].text` });
      }
      // Responses input content parts: {type: 'input_text', text: '...'}.
      if (part['type'] === 'input_text' && typeof part['text'] === 'string') {
        out.push({ text: part['text'] as string, path: `${pathPrefix}[${i}].text` });
      }
      // Responses OUTPUT content parts, replayed as input when a caller carries an
      // assistant turn back in `input[]`. Text leaving the org boundary again is
      // still text leaving the org boundary; scanning it keeps a replayed
      // assistant turn from being the shape that evades the pre-scan.
      if (part['type'] === 'output_text' && typeof part['text'] === 'string') {
        out.push({ text: part['text'] as string, path: `${pathPrefix}[${i}].text` });
      }
      // A message item nested in the walked list — the Responses `input[]` case.
      // `content` may be a string OR an array of parts; both recurse here, which
      // is what closes AI-CONSOLE-RESPONSES-DLP-GAP-01 for shapes 2 and 4.
      if (isMessageItem(part)) {
        pushParts(part['content'], `${pathPrefix}[${i}].content`, out);
      }
    }
  });
}

/**
 * Extract DLP-relevant text from an OpenAI Responses body
 * (POST /v1/responses): `input` is a string OR an array of items.
 * `instructions` field also relevant if string.
 */
export function extractOpenAIResponsesText(body: unknown): ExtractedSegment[] {
  if (typeof body !== 'object' || body === null) return [];
  const b = body as Record<string, unknown>;
  const segments: ExtractedSegment[] = [];

  if (typeof b['instructions'] === 'string') {
    segments.push({ text: b['instructions'] as string, path: 'instructions' });
  }
  if (typeof b['input'] === 'string') {
    segments.push({ text: b['input'] as string, path: 'input' });
  } else if (Array.isArray(b['input'])) {
    pushParts(b['input'], 'input', segments);
  }

  return segments;
}

/**
 * Extract DLP-relevant text from an OpenAI Chat Completions body
 * (POST /v1/chat/completions): `messages[]` with `content` string or array of parts.
 */
export function extractOpenAIChatCompletionsText(body: unknown): ExtractedSegment[] {
  if (typeof body !== 'object' || body === null) return [];
  const b = body as Record<string, unknown>;
  const segments: ExtractedSegment[] = [];

  if (Array.isArray(b['messages'])) {
    b['messages'].forEach((m, mi) => {
      if (m && typeof m === 'object') {
        const msg = m as Record<string, unknown>;
        const path = `messages[${mi}].content`;
        const c = msg['content'];
        if (typeof c === 'string') {
          segments.push({ text: c, path });
        } else if (Array.isArray(c)) {
          pushParts(c, path, segments);
        }
      }
    });
  }

  return segments;
}
