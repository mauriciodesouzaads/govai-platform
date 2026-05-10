// Walk an OpenAI Responses or Chat Completions body and return DLP-relevant
// text segments + their JSON paths.

export type ExtractedSegment = {
  text: string;
  path: string;
};

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
      // Responses input items: {type: 'input_text', text: '...'} | {type: 'message', content: [...]}
      if (part['type'] === 'input_text' && typeof part['text'] === 'string') {
        out.push({ text: part['text'] as string, path: `${pathPrefix}[${i}].text` });
      }
      if (part['type'] === 'message' && Array.isArray(part['content'])) {
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
