import { describe, it, expect } from 'vitest';
import type { FastifyReply } from 'fastify';

import {
  armAbortOnClose,
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

function fakeReply(opts?: { destroyed?: boolean; writeThrows?: Error }) {
  const closeCbs: Array<() => void> = [];
  const writes: Uint8Array[] = [];
  let ended = 0;
  const raw = {
    destroyed: opts?.destroyed ?? false,
    writableEnded: false,
    closed: opts?.destroyed ?? false,
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
      if (opts?.writeThrows) throw opts.writeThrows;
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

describe('armAbortOnClose', () => {
  it('installs a close listener that aborts the controller; detach removes it', () => {
    const f = fakeReply();
    const ctrl = new AbortController();
    const detach = armAbortOnClose(f.reply, ctrl);
    expect(f.closeCbs).toHaveLength(1);
    expect(ctrl.signal.aborted).toBe(false);
    // a client close fires the listener → abort only (no emit hook here)
    for (const cb of [...f.closeCbs]) cb();
    expect(ctrl.signal.aborted).toBe(true);
    detach();
    expect(f.closeCbs).toHaveLength(0);
  });

  it('detach before any close → controller is never aborted (no leaked listener)', () => {
    const f = fakeReply();
    const ctrl = new AbortController();
    const detach = armAbortOnClose(f.reply, ctrl);
    detach();
    expect(f.closeCbs).toHaveLength(0);
    for (const cb of [...f.closeCbs]) cb();
    expect(ctrl.signal.aborted).toBe(false);
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

  it('CHANGE A (P2#2): an already-closed reply at pump entry → abort + SKIP the drain (no read) + client_disconnect', async () => {
    // The handoff race: if the socket already closed when the pump arms its (one-shot) close
    // listener, that listener never fires. The pump must self-detect the closed socket, abort
    // the upstream, and NOT read/hash bytes for a client that is gone.
    const f = fakeReply({ destroyed: true });
    const ctrl = new AbortController();
    let reads = 0;
    const reader = readerOf([Uint8Array.of(1), Uint8Array.of(2)], { onRead: () => { reads += 1; } });
    const outcomes: StreamOutcome[] = [];
    await pumpStreamWithTerminalEmit({
      reader,
      reply: f.reply,
      controller: ctrl,
      finalizeAndEmit: async (o) => { outcomes.push(o); },
    });
    expect(ctrl.signal.aborted).toBe(true); // upstream aborted → no orphan
    expect(reads).toBe(0); // never read/hashed a byte for the gone client
    expect(f.writes).toHaveLength(0);
    expect(outcomes).toEqual(['client_disconnect']); // NOT 'complete'
    expect(f.ended()).toBe(1); // still finalized once
  });

  it('P1 (P1#3): a write-side-first disconnect (write throws EPIPE before close fires) → aborts upstream + client_disconnect', async () => {
    // The close listener never fires; the reply.raw.write() throw is the FIRST signal of the
    // disconnect. The catch must abort the controller so finalize() does not keep draining the
    // upstream for a gone client.
    const f = fakeReply({ writeThrows: withCode('write EPIPE', 'EPIPE') });
    const ctrl = new AbortController();
    const outcomes: StreamOutcome[] = [];
    await pumpStreamWithTerminalEmit({
      reader: readerOf([Uint8Array.of(1)]),
      reply: f.reply,
      controller: ctrl,
      finalizeAndEmit: async (o) => { outcomes.push(o); },
    });
    expect(ctrl.signal.aborted).toBe(true); // ← P1: upstream aborted on the write-side-first path
    expect(outcomes).toEqual(['client_disconnect']);
  });
});
