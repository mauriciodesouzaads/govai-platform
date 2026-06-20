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

export interface Runner {
  health: HealthState;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createRunner(deps: RunnerDeps): Runner {
  const logger = deps.logger ?? createLogger();
  const metrics = deps.metrics ?? createOtelSealerMetrics();
  const pool = deps.pool ?? createSealerPool(deps.config);
  const ownsPool = deps.pool === undefined;
  const health = new HealthState();
  let loop: ClaimLoopHandle | null = null;

  return {
    health,
    async start() {
      const startup = await validateStartup(pool);
      health.setStartup(startup);
      if (!startup.ready) {
        logger.error(
          { checks: startup.checks },
          'audit_sealer: startup validation failed — staying NOT ready (liveness intact)',
        );
        return;
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
        onBacklogAlert: (healthy) => health.setBacklogHealthy(healthy),
      });
    },
    async stop() {
      health.setLive(false);
      if (loop) await loop.stop();
      if (ownsPool) await pool.end().catch(() => undefined);
    },
  };
}
