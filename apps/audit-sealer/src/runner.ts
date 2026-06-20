// Runner wiring (SPEC-B3 §2/§3): config → pool → startup-validation → (ready) →
// claim loop, with graceful shutdown. On a failed startup probe the runner stays
// NOT-ready (liveness intact) rather than crash-looping.

import type { Pool } from 'pg';
import type { Kms } from '@govai/core-identity';
import type { SealerConfig } from './config.js';
import { createSealerPool } from './pool.js';
import { validateStartup } from './startup-validation.js';
import { startClaimLoop, type ClaimLoopHandle } from './claim-loop.js';
import { HealthState } from './health.js';
import { createHealthFilePublisher, type HealthFilePublisher } from './health-file.js';
import { createOtelSealerMetrics, type SealerMetrics } from './metrics.js';
import { createLogger, type SealerLogger } from './logging.js';

export interface RunnerDeps {
  config: SealerConfig;
  kms: Kms;
  listOrgs: () => Promise<string[]>;
  /** Injectable for tests; defaults to a fresh pool/OTel metrics/pino logger. */
  pool?: Pool;
  metrics?: SealerMetrics;
  logger?: SealerLogger;
}

export interface StartResult {
  started: boolean;
  ready: boolean;
}

export interface Runner {
  health: HealthState;
  start(): Promise<StartResult>;
  stop(): Promise<void>;
}

export function createRunner(deps: RunnerDeps): Runner {
  const logger = deps.logger ?? createLogger();
  const metrics = deps.metrics ?? createOtelSealerMetrics();
  const pool = deps.pool ?? createSealerPool(deps.config);
  const ownsPool = deps.pool === undefined;
  const health = new HealthState();
  const healthFile: HealthFilePublisher = createHealthFilePublisher(health, {
    path: deps.config.healthFilePath,
    intervalMs: deps.config.healthIntervalMs,
    onError: (err) => logger.error({ err: String(err) }, 'audit_sealer: health-file write failed'),
  });
  let loop: ClaimLoopHandle | null = null;

  return {
    health,
    async start(): Promise<StartResult> {
      // Begin publishing immediately — the surface starts as not-ready and is
      // refreshed below, so there is no window where the sealer is up without an
      // observable readiness signal (EP-006 rev2 / Codex-bot P1).
      healthFile.start();
      const startup = await validateStartup(pool);
      health.setStartup(startup);
      healthFile.publish();
      if (!startup.ready) {
        // NOT a silent return: the health surface reports not-ready (with the
        // reason); the caller/orchestrator decides (restart / alert). The runner
        // stays alive and observable; the pool remains open under it.
        logger.error(
          { checks: startup.checks },
          'audit_sealer: startup validation failed — health surface reports NOT ready (liveness intact)',
        );
        return { started: false, ready: false };
      }
      logger.info(
        { worker_id: deps.config.workerId },
        'audit_sealer: startup validated; starting claim loop',
      );
      loop = startClaimLoop({
        pool,
        kms: deps.kms,
        config: deps.config,
        metrics,
        logger,
        listOrgs: deps.listOrgs,
        onBacklogAlert: (healthy) => {
          health.setBacklogHealthy(healthy);
          healthFile.publish();
        },
      });
      return { started: true, ready: true };
    },
    async stop() {
      health.setLive(false);
      healthFile.publish();
      healthFile.stop();
      if (loop) await loop.stop();
      if (ownsPool) await pool.end().catch(() => undefined);
    },
  };
}
