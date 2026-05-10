// Walk an Anthropic Messages-shaped body and return the text segments that DLP
// should pre-scan, along with their JSON paths so callers can rewrite if they
// want to (mutate path is a follow-up; initial scope only extracts).
//
// Handles canonical shapes:
//   body.system: string  | array of content blocks
//   body.messages[].content: string | array of content blocks
//   body.messages[].content[i].text                       (type: 'text')
//   body.messages[].content[i].content (tool_result text) (type: 'tool_result')

export type ExtractedSegment = {
  /** Concatenation key used to scan a single string. */
  text: string;
  /** Tagging hint useful for downstream redaction. */
  path: string;
};

function pushBlocks(
  blocks: unknown,
  pathPrefix: string,
  out: ExtractedSegment[],
): void {
  if (typeof blocks === 'string') {
    out.push({ text: blocks, path: pathPrefix });
    return;
  }
  if (!Array.isArray(blocks)) return;
  blocks.forEach((b, i) => {
    if (b && typeof b === 'object') {
      const block = b as Record<string, unknown>;
      if (block['type'] === 'text' && typeof block['text'] === 'string') {
        out.push({ text: block['text'] as string, path: `${pathPrefix}[${i}].text` });
      }
      if (block['type'] === 'tool_result' && typeof block['content'] === 'string') {
        out.push({ text: block['content'] as string, path: `${pathPrefix}[${i}].content` });
      }
      if (block['type'] === 'tool_result' && Array.isArray(block['content'])) {
        pushBlocks(block['content'], `${pathPrefix}[${i}].content`, out);
      }
    }
  });
}

/**
 * Extract DLP-relevant text from an Anthropic /v1/messages body. Returns one
 * segment per text-bearing field. Concatenating all `text` values gives a flat
 * scan target; the `path` lets a future redactor rewrite specific fields.
 */
export function extractAnthropicText(body: unknown): ExtractedSegment[] {
  if (typeof body !== 'object' || body === null) return [];
  const b = body as Record<string, unknown>;
  const segments: ExtractedSegment[] = [];

  if (typeof b['system'] === 'string') {
    segments.push({ text: b['system'] as string, path: 'system' });
  } else if (Array.isArray(b['system'])) {
    pushBlocks(b['system'], 'system', segments);
  }

  if (Array.isArray(b['messages'])) {
    b['messages'].forEach((m, mi) => {
      if (m && typeof m === 'object') {
        const msg = m as Record<string, unknown>;
        const path = `messages[${mi}].content`;
        pushBlocks(msg['content'], path, segments);
      }
    });
  }

  return segments;
}
