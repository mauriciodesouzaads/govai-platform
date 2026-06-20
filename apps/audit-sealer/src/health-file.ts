// Minimal internal readiness/liveness surface (SPEC-B3 §5; EP-006 rev2 / Codex-bot
// P1). The runner is NOT a server (no public route, no fastify); it exposes health
// via a FILE the orchestrator can stat/read. A live-but-idle sealer with no
// observable not-ready signal must be IMPOSSIBLE — so the file is written on
// startup, on every state change (probe result, backlog health), and on a small
// interval. A write error is surfaced via the optional `onError`, never swallowed.

import { writeFileSync } from 'node:fs';
import type { HealthState } from './health.js';

export interface HealthFilePublisher {
  /** Write the current health snapshot now. */
  publish(): void;
  /** Begin the periodic refresh (keeps the surface fresh even when idle). */
  start(): void;
  /** Stop the periodic refresh. */
  stop(): void;
}

export interface HealthFileOptions {
  path: string;
  intervalMs?: number;
  onError?: (err: unknown) => void;
}

export function createHealthFilePublisher(
  health: HealthState,
  opts: HealthFileOptions,
): HealthFilePublisher {
  let timer: NodeJS.Timeout | null = null;
  const publish = (): void => {
    const snapshot = {
      liveness: health.liveness(),
      readiness: health.readiness(),
      written_at: new Date().toISOString(),
    };
    try {
      writeFileSync(opts.path, `${JSON.stringify(snapshot)}\n`, 'utf8');
    } catch (err) {
      // The health surface itself failing must be observable, not silent.
      opts.onError?.(err);
    }
  };
  return {
    publish,
    start: () => {
      publish();
      if (timer === null) {
        // Intentionally NOT unref'd: in the not-ready idle case this interval is
        // what keeps the process alive AND the surface fresh, so an orchestrator
        // readiness probe can observe not-ready. Cleared on stop().
        timer = setInterval(publish, opts.intervalMs ?? 5000);
      }
    },
    stop: () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
