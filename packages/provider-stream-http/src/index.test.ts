import { describe, it, expect } from 'vitest';
import type { FastifyReply } from 'fastify';

import {
  classifyStreamError,
  pumpStreamWithTerminalEmit,
  type StreamOutcome,
} from './index.js';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function readerOf(
  chunks: Uint8Array[],
  opts?: { throwAt?: number; err?: unknown; onRead?: () => void },
): ReadableStreamDefaultReader<Uint8Array> {
  let i = 0;
  return {
    read: async () => {
      opts?.onRead?.();
      if (opts?.throwAt !== undefined && i >= opts.throwAt) throw opts.err ?? new Error('boom');
      if (i >= chunks.length) return { value: undefined, done: true };
      return { value: chunks[i++]!, done: false };
    },
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

function fakeReply() {
  const closeCbs: Array<() => void> = [];
  const writes: Uint8Array[] = [];
  let ended = 0;
  const raw = {
    on: (ev: string, cb: () => void) => {
      if (ev === 'close') closeCbs.push(cb);
    },
    removeListener: (ev: string, cb: () => void) => {
      if (ev === 'close') {
        const idx = closeCbs.indexOf(cb);
        if (idx >= 0) closeCbs.splice(idx, 1);
      }
    },
    write: (b: Uint8Array) => {
      writes.push(b);
      return true;
    },
    end: () => {
      ended += 1;
    },
  };
  return { reply: { raw } as unknown as FastifyReply, writes, closeCbs, ended: () => ended };
}

describe('classifyStreamError', () => {
  it('an aborted signal → client_disconnect (regardless of the surface error)', () => {
    const ac = new AbortController();
    ac.abort();
    expect(classifyStreamError(new Error('whatever'), ac.signal)).toBe('client_disconnect');
  });

  it('EPIPE / ECONNRESET / ERR_STREAM_* → client_disconnect', () => {
    const s = new AbortController().signal;
    expect(classifyStreamError(withCode('broken pipe', 'EPIPE'), s)).toBe('client_disconnect');
    expect(classifyStreamError(withCode('reset', 'ECONNRESET'), s)).toBe('client_disconnect');
    expect(classifyStreamError(withCode('after end', 'ERR_STREAM_WRITE_AFTER_END'), s)).toBe(
      'client_disconnect',
    );
  });

  it('a generic (non-aborted) upstream error → upstream_error', () => {
    const s = new AbortController().signal;
    expect(classifyStreamError(new Error('upstream 500'), s)).toBe('upstream_error');
    expect(classifyStreamError('weird', s)).toBe('upstream_error');
  });
});

describe('pumpStreamWithTerminalEmit', () => {
  it('clean drain → outcome=complete, writes every chunk, ends once, emits once', async () => {
    const f = fakeReply();
    const ctrl = new AbortController();
    const outcomes: StreamOutcome[] = [];
    await pumpStreamWithTerminalEmit({
      reader: readerOf([Uint8Array.of(1), Uint8Array.of(2)]),
      reply: f.reply,
      controller: ctrl,
      finalizeAndEmit: async (o) => {
        outcomes.push(o);
      },
    });
    expect(outcomes).toEqual(['complete']);
    expect(f.writes).toHaveLength(2);
    expect(f.ended()).toBe(1);
  });

  it('a drain throw (not aborted) → outcome=upstream_error', async () => {
    const f = fakeReply();
    const ctrl = new AbortController();
    const outcomes: StreamOutcome[] = [];
    await pumpStreamWithTerminalEmit({
      reader: readerOf([], { throwAt: 0, err: new Error('upstream boom') }),
      reply: f.reply,
      controller: ctrl,
      finalizeAndEmit: async (o) => {
        outcomes.push(o);
      },
    });
    expect(outcomes).toEqual(['upstream_error']);
    expect(f.ended()).toBe(1);
  });

  it('client close mid-drain → aborts the controller, outcome=client_disconnect', async () => {
    const f = fakeReply();
    const ctrl = new AbortController();
    const outcomes: StreamOutcome[] = [];
    // The reader simulates a client disconnect: on read it fires the registered
    // close callback (which aborts the controller) then throws a broken-pipe error.
    const reader = readerOf([], {
      throwAt: 0,
      err: withCode('write EPIPE', 'EPIPE'),
      onRead: () => {
        for (const cb of f.closeCbs) cb();
      },
    });
    await pumpStreamWithTerminalEmit({ reader, reply: f.reply, controller: ctrl, finalizeAndEmit: async (o) => { outcomes.push(o); } });
    expect(ctrl.signal.aborted).toBe(true);
    expect(outcomes).toEqual(['client_disconnect']);
  });

  it('never throws into the reply: a finalizeAndEmit failure is swallowed (still ends)', async () => {
    const f = fakeReply();
    const ctrl = new AbortController();
    await expect(
      pumpStreamWithTerminalEmit({
        reader: readerOf([Uint8Array.of(1)]),
        reply: f.reply,
        controller: ctrl,
        finalizeAndEmit: async () => {
          throw new Error('emit boom');
        },
      }),
    ).resolves.toBeUndefined();
    expect(f.ended()).toBe(1);
  });
});
