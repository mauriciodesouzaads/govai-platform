// Server-sent-event reading for the AI Console.
//
// The conversation surfaces are POSTs with request bodies, so `EventSource` is not applicable:
// the browser drives them with `fetch` + a `ReadableStream`, and this module turns those bytes
// into SSE frames.
//
// ★ THE GRAMMAR IS NOT PARSED HERE. `eventsource-parser` owns it (comments, CRLF vs LF,
// multi-line `data:`, `id:`/`retry:`, the blank-line terminator). A hand-rolled
// `chunk.split('\n\n')` is wrong in at least four ways that show up only under real network
// fragmentation, and this file exists to make sure none of them is ours to get wrong. What
// this module owns is the two things the parser deliberately does not:
//
//   1. UTF-8 ACROSS CHUNK BOUNDARIES. The network splits bytes, not characters. A streaming
//      `TextDecoder` holds a partial multi-byte sequence until the continuation bytes arrive;
//      decoding each chunk independently would emit U+FFFD in the middle of a word. Every
//      chunk is decoded with `{ stream: true }`, and the decoder is flushed once at EOF.
//
//   2. THE INCOMPLETE FINAL FRAME. If the stream ends mid-frame — before the blank line — the
//      event is DISCARDED, never completed on the reader's behalf. That is what the SSE
//      specification requires ("if the file ends in the middle of an event … the incomplete
//      event is not dispatched"), and it is also the honest behaviour: a truncated frame is
//      not a message the provider sent, and inventing one would let a cut connection look
//      like a finished answer. The caller sees a stream that ended with no terminal marker
//      and classifies the turn as an unconfirmed outcome — which is the truth.
//
// ★ WHICH NAME IDENTIFIES A FRAME. The two providers disagree about the wire, and this module
// refuses to bet on either. Anthropic sends BOTH an `event:` line and a matching `"type"` in
// the JSON. OpenAI's Responses stream sends `event:` lines whose payloads also carry `type`,
// while its Chat Completions stream sends `data:`-only frames with no `event:` line at all.
// Frames are therefore surfaced with both fields and each adapter decides: the adapters below
// read `data.type` when the payload has one and fall back to the SSE event name. Neither
// provider can break the console by moving the discriminator it already sends twice.

import { createParser, type EventSourceMessage } from 'eventsource-parser';

export type SseFrame = {
  /** The SSE `event:` name, or undefined when the frame declared none. */
  event: string | undefined;
  /** The accumulated `data:` payload, newline-joined, exactly as the spec assembles it. */
  data: string;
};

/**
 * Ceiling on what the parser may buffer across `feed()` calls. A stream that never sends a
 * blank line would otherwise grow a buffer without bound; past this the parser reports the
 * overflow and stops, which surfaces as a stream that produced no terminal marker. 1 MiB is
 * far above any real provider frame (the largest are `message_start` / `response.created`
 * envelopes measured in kilobytes).
 */
export const SSE_MAX_BUFFER_CHARS = 1024 * 1024;

export type PumpSseInput = {
  body: ReadableStream<Uint8Array>;
  /** Called once per complete frame, in order. Must not throw. */
  onFrame: (frame: SseFrame) => void;
  /** Aborting cancels the reader and resolves; the caller owns the abort semantics. */
  signal?: AbortSignal;
  /**
   * Checked after each chunk: return true to stop reading and cancel the body.
   *
   * ★ This is what lets a turn SETTLE when the provider says it is done, rather than when the
   * socket happens to close. A provider may send its terminal event and hold the connection
   * open — the acceptance stack does exactly that — and draining to EOF anyway would leave the
   * answer stuck as "generating", keep the client-observed duration climbing, and hold the
   * answer out of later context, all long after the provider finished.
   */
  stopWhen?: () => boolean;
};

/**
 * Drain an SSE body, dispatching one call to `onFrame` per complete frame.
 *
 * Resolves when the stream ends or the signal aborts. Rejects only if the underlying stream
 * itself errors mid-flight (a transport fault the caller must classify), never for a
 * malformed frame: a frame whose payload is not JSON is still a frame, and deciding what it
 * means belongs to the provider adapter, not to the byte reader.
 */
export async function pumpSse(input: PumpSseInput): Promise<void> {
  const decoder = new TextDecoder('utf-8');
  const parser = createParser({
    maxBufferSize: SSE_MAX_BUFFER_CHARS,
    onEvent: (message: EventSourceMessage) => {
      input.onFrame({ event: message.event, data: message.data });
    },
    // Comments (`: keep-alive`), retry hints and parse errors are deliberately dropped: none
    // of them carries model output, and none may become UI text or a diagnostic dump.
  });

  const reader = input.body.getReader();
  const onAbort = (): void => {
    void reader.cancel().catch(() => undefined);
  };
  if (input.signal) {
    if (input.signal.aborted) {
      await reader.cancel().catch(() => undefined);
      return;
    }
    input.signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      try {
        parser.feed(decoder.decode(value, { stream: true }));
      } catch {
        // The parser terminates itself past `maxBufferSize`. Stop reading rather than
        // feeding a terminated parser: the caller sees a stream with no terminal marker.
        break;
      }
      if (input.signal?.aborted) break;
      // The provider has said everything it is going to say; the `finally` cancels the body.
      if (input.stopWhen?.()) break;
    }
    // Flush the decoder's pending bytes. An incomplete multi-byte sequence at EOF becomes
    // U+FFFD here rather than silently vanishing.
    const tail = decoder.decode();
    if (tail.length > 0) {
      try {
        parser.feed(tail);
      } catch {
        /* terminated parser — nothing left to dispatch */
      }
    }
    // ★ The parser is NOT reset with `consume: true`: an event that never received its blank
    // line is incomplete data, and completing it here would fabricate a frame. See the header.
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
    await reader.cancel().catch(() => undefined);
  }
}

/**
 * Parse a frame payload as JSON, or return null.
 *
 * Never throws and never surfaces the offending text: a malformed frame is a fact ("the
 * provider sent something this client could not read"), not a string to render or log.
 */
export function parseFrameJson(data: string): Record<string, unknown> | null {
  const trimmed = data.trim();
  if (trimmed.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

/**
 * The discriminator for a frame: the payload's own `type` when it has one, else the SSE
 * event name. See the header for why both are consulted.
 */
export function frameType(frame: SseFrame, payload: Record<string, unknown> | null): string | null {
  const declared = payload?.['type'];
  if (typeof declared === 'string' && declared.length > 0) return declared;
  if (frame.event !== undefined && frame.event.length > 0) return frame.event;
  return null;
}
