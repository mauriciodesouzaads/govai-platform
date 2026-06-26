// Shared stream-transport control utility for the provider HTTP streaming handlers
// (@govai/provider-stream-http, EP-008C). It owns the drain → finalize →
// emit-on-EVERY-termination-path discipline + classifyStreamError + the ALS-safe
// abort wiring, so the terminal audit event is produced on clean completion, a
// mid-stream upstream error, AND a client disconnect — not only on clean completion
// (the EC-2-stream capture-completeness fix).
//
// ★ ZERO provider/event knowledge: this module imports NOTHING from
// @govai/core-events or @govai/provider-*. The provider injects its own
// buildPassthroughInvoked + emit as the `finalizeAndEmit` closure. It is a pure
// fastify/stream transport-control utility (fastify type-only dependency).
//
// ★ ALS hard rule: `finalizeAndEmit` is invoked inside the drain `finally` — the
// handler's same async continuation chain (reply.hijack() does not leave it) — so the
// ingress hook's AsyncLocalStorage store is still in scope when the provider's emit
// reads request identity. It is NEVER deferred into the reply.raw.on('close', ...)
// callback (a different tick, outside als.run() → getStore() undefined → silent
// identity loss). on('close') does ONLY controller.abort().

import type { FastifyReply } from 'fastify';

export type StreamOutcome = 'complete' | 'upstream_error' | 'client_disconnect';

/**
 * Classify a drain-loop failure. A caller abort (client disconnect) or a broken-pipe /
 * closed-socket write error is `client_disconnect`; anything else (an upstream reader
 * rejection propagated by the forwarder) is `upstream_error`. The abort wins: when the
 * client-close abort fired, the resulting read/write rejection is a disconnect even if
 * its surface error looks generic.
 */
export function classifyStreamError(err: unknown, signal: AbortSignal): StreamOutcome {
  if (signal.aborted) return 'client_disconnect';
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? (err as { code?: unknown }).code
      : undefined;
  if (
    typeof code === 'string' &&
    (code === 'EPIPE' || code === 'ECONNRESET' || code.startsWith('ERR_STREAM_'))
  ) {
    return 'client_disconnect';
  }
  return 'upstream_error';
}

export interface PumpStreamArgs {
  /** Reader over the upstream byte stream (e.g. `forwardStream(...).body.getReader()`). */
  reader: ReadableStreamDefaultReader<Uint8Array>;
  /** The hijacked Fastify reply to write raw chunks to. */
  reply: FastifyReply;
  /**
   * The AbortController whose `.signal` was passed to the forwarder. The helper aborts
   * it on client disconnect (so the upstream fetch is cancelled) and reads `.signal`
   * to classify the termination.
   */
  controller: AbortController;
  /**
   * Provider-supplied terminal action: resolve the partial/full hash and build+emit the
   * terminal audit event for `outcome`. Invoked EXACTLY ONCE, inside the drain `finally`
   * (the handler's async chain — request-identity ALS in scope). MUST own its emit; this
   * helper holds zero provider/event knowledge.
   */
  finalizeAndEmit: (outcome: StreamOutcome) => Promise<void>;
}

/**
 * Drain `reader` to `reply.raw`, then emit the terminal event on EVERY path: clean drain
 * → `complete`; a drain throw → `classifyStreamError`; a client close → abort the
 * upstream (via `controller`) and let the resulting rejection classify as
 * `client_disconnect`. `finalizeAndEmit` runs once in the `finally` (ALS-safe) and any
 * throw it leaks is swallowed so observe-only never crashes the hijacked reply.
 */
export async function pumpStreamWithTerminalEmit(args: PumpStreamArgs): Promise<void> {
  const { reader, reply, controller, finalizeAndEmit } = args;
  let drained = false;
  let emitted = false;
  const onClose = (): void => {
    // ONLY abort here — NEVER emit (the ALS rule: this callback is off the als.run chain).
    if (!drained) controller.abort();
  };
  reply.raw.on('close', onClose);

  let outcome: StreamOutcome = 'complete';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) reply.raw.write(Buffer.from(value));
    }
    drained = true;
  } catch (err) {
    outcome = classifyStreamError(err, controller.signal);
  } finally {
    reply.raw.removeListener('close', onClose);
    try {
      reply.raw.end();
    } catch {
      /* socket already closed — nothing to flush */
    }
    if (!emitted) {
      emitted = true;
      try {
        await finalizeAndEmit(outcome);
      } catch {
        /* observe-only: a finalize/build/emit failure must never crash the hijacked reply */
      }
    }
  }
}
