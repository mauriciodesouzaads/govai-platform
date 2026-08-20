import { describe, expect, it } from 'vitest';
import { frameType, parseFrameJson, pumpSse, type SseFrame } from './sse.js';

// The SSE reader, tested against the ways a real network actually delivers bytes.
//
// Every case here is a way a naive `chunk.split('\n\n')` parser breaks: a frame split across
// two TCP segments, two frames in one segment, CRLF line endings, a multi-line `data:`, a
// keep-alive comment, and a multi-byte character cut in half at a chunk boundary. The last one
// is the one that silently corrupts output rather than failing loudly, which is why it is
// pinned in three different shapes.

/** A stream that yields exactly the given byte chunks, in order. */
function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i] as Uint8Array);
      i += 1;
    },
  });
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Split a UTF-8 encoding of `text` into byte slices of the given sizes — deliberately
 *  ignoring character boundaries, which is exactly what a network does. */
function byteChunks(text: string, size: number): Uint8Array[] {
  const bytes = new TextEncoder().encode(text);
  const out: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out;
}

async function collect(chunks: readonly Uint8Array[], signal?: AbortSignal): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  await pumpSse({
    body: streamOf(chunks),
    onFrame: (f) => frames.push(f),
    ...(signal ? { signal } : {}),
  });
  return frames;
}

describe('framing', () => {
  it('assembles a frame split across chunks', async () => {
    const frames = await collect([enc('data: {"a"'), enc(':1}\n'), enc('\n')]);
    expect(frames).toEqual([{ event: undefined, data: '{"a":1}' }]);
  });

  it('emits every frame when several arrive in one chunk', async () => {
    const frames = await collect([enc('data: one\n\ndata: two\n\ndata: three\n\n')]);
    expect(frames.map((f) => f.data)).toEqual(['one', 'two', 'three']);
  });

  it('accepts CRLF line endings', async () => {
    const frames = await collect([enc('event: ping\r\ndata: {}\r\n\r\n')]);
    expect(frames).toEqual([{ event: 'ping', data: '{}' }]);
  });

  it('accepts bare LF line endings', async () => {
    const frames = await collect([enc('event: ping\ndata: {}\n\n')]);
    expect(frames).toEqual([{ event: 'ping', data: '{}' }]);
  });

  it('joins a multi-line data field with newlines, as the specification requires', async () => {
    const frames = await collect([enc('data: line one\ndata: line two\n\n')]);
    expect(frames[0]?.data).toBe('line one\nline two');
  });

  it('drops comment lines rather than surfacing them as events', async () => {
    const frames = await collect([enc(': keep-alive\n\ndata: real\n\n')]);
    expect(frames.map((f) => f.data)).toEqual(['real']);
  });

  it('dispatches no event for a block whose data field is empty', async () => {
    // Per the specification an empty data buffer dispatches nothing. A parser that emitted a
    // frame here would hand every adapter an empty payload to misread.
    const frames = await collect([enc('event: ping\n\ndata: real\n\n')]);
    expect(frames.map((f) => f.data)).toEqual(['real']);
  });

  it('surfaces an unknown event name without interpreting it', async () => {
    const frames = await collect([enc('event: something.new\ndata: {"x":1}\n\n')]);
    expect(frames[0]?.event).toBe('something.new');
  });

  it('passes malformed JSON through as data — parsing is the adapter’s job', async () => {
    const frames = await collect([enc('data: {not json\n\n')]);
    expect(frames[0]?.data).toBe('{not json');
  });
});

describe('★ the incomplete final frame is DISCARDED, never completed for the sender', () => {
  it('drops a frame whose terminating blank line never arrived', async () => {
    // A connection cut mid-frame must not look like a message the provider sent. This is what
    // makes a truncated stream classify as an unconfirmed outcome instead of a finished answer.
    const frames = await collect([enc('data: complete\n\ndata: truncated-mid')]);
    expect(frames.map((f) => f.data)).toEqual(['complete']);
  });

  it('drops a frame that ended after its data line but before the blank line', async () => {
    const frames = await collect([enc('data: {"almost":true}\n')]);
    expect(frames).toEqual([]);
  });
});

describe('★ UTF-8 sequences split across chunk boundaries', () => {
  it('reassembles a multi-byte character cut in half', async () => {
    // "é" is two bytes; the split lands between them.
    const payload = 'data: café\n\n';
    const bytes = new TextEncoder().encode(payload);
    const cut = payload.indexOf('é') + 4; // one byte into the two-byte sequence
    const frames = await collect([bytes.subarray(0, cut), bytes.subarray(cut)]);
    expect(frames[0]?.data).toBe('café');
  });

  it('reassembles a four-byte emoji delivered one byte at a time', async () => {
    const frames = await collect(byteChunks('data: hi 🚀 there\n\n', 1));
    expect(frames[0]?.data).toBe('hi 🚀 there');
  });

  it('survives every chunk size for a mixed-script payload', async () => {
    const text = 'data: ação 漢字 🚀 ok\n\n';
    for (const size of [1, 2, 3, 5, 7, 13]) {
      const frames = await collect(byteChunks(text, size));
      expect(frames[0]?.data, `chunk size ${String(size)}`).toBe('ação 漢字 🚀 ok');
    }
  });
});

describe('abort', () => {
  it('resolves without dispatching further frames when aborted mid-stream', async () => {
    const controller = new AbortController();
    const frames: SseFrame[] = [];
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulls += 1;
        if (pulls > 20) {
          ctrl.close();
          return;
        }
        ctrl.enqueue(enc(`data: chunk-${String(pulls)}\n\n`));
      },
    });
    await pumpSse({
      body,
      signal: controller.signal,
      onFrame: (f) => {
        frames.push(f);
        if (frames.length === 2) controller.abort();
      },
    });
    // The reader stops promptly. The exact count depends on how much was already buffered,
    // but it must not run to the stream's natural end.
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames.length).toBeLessThan(20);
  });

  it('reads nothing at all when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const frames = await collect([enc('data: never\n\n')], controller.signal);
    expect(frames).toEqual([]);
  });

  it('leaves an incomplete frame undispatched when aborted mid-frame', async () => {
    const controller = new AbortController();
    const frames: SseFrame[] = [];
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        pulls += 1;
        if (pulls === 1) ctrl.enqueue(enc('data: first\n\ndata: incomp'));
        else {
          controller.abort();
          ctrl.close();
        }
      },
    });
    await pumpSse({ body, signal: controller.signal, onFrame: (f) => frames.push(f) });
    expect(frames.map((f) => f.data)).toEqual(['first']);
  });
});

describe('a stream that errors mid-flight', () => {
  it('rejects, so the caller can classify the outcome rather than assume success', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(enc('data: partial\n\n'));
      },
      pull(ctrl) {
        ctrl.error(new Error('connection reset'));
      },
    });
    const frames: SseFrame[] = [];
    await expect(pumpSse({ body, onFrame: (f) => frames.push(f) })).rejects.toThrow();
    expect(frames.map((f) => f.data)).toEqual(['partial']);
  });
});

describe('parseFrameJson', () => {
  it('returns the object for a valid payload', () => {
    expect(parseFrameJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null — never throws — for anything that is not a JSON object', () => {
    for (const input of ['', '   ', '[DONE]', '{oops', '[1,2]', '"a string"', '42', 'null']) {
      expect(parseFrameJson(input), input).toBeNull();
    }
  });
});

describe('frameType prefers the payload type and falls back to the event name', () => {
  it('uses the payload `type` when present', () => {
    const frame: SseFrame = { event: 'message', data: '{"type":"content_block_delta"}' };
    expect(frameType(frame, parseFrameJson(frame.data))).toBe('content_block_delta');
  });

  it('uses the SSE event name when the payload declares no type', () => {
    const frame: SseFrame = { event: 'response.completed', data: '{"id":"x"}' };
    expect(frameType(frame, parseFrameJson(frame.data))).toBe('response.completed');
  });

  it('is null when neither is available, so nothing is guessed', () => {
    expect(frameType({ event: undefined, data: '{}' }, {})).toBeNull();
    expect(frameType({ event: '', data: 'x' }, null)).toBeNull();
  });
});
