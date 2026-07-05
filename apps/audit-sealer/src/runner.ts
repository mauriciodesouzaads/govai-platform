// Runner wiring (SPEC-B3 §2/§3): config → pool → startup-validation → (ready) →
// claim loop, with graceful shutdown. On a failed startup probe the runner stays
// NOT-ready (liveness intact) rather than crash-looping.

import type { Pool } from 'pg';
import type { Kms } from '@govai/core-identity/kms';
import { sanitizeSealerError } from '@govai/core-audit';
import type { SealerConfig } from './config.js';
import { createSealerPool } from './pool.js';
import { validateStartup } from './startup-validation.js';
import { startClaimLoop, type ClaimLoopHandle } from './claim-loop.js';
import { HealthState, withDiscoveryHealth } from './health.js';
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

  // EP-SEALER-DEPLOY: every discovery call (startup probe + loop) drives readiness fail-loud —
  // a failure ⇒ readiness `org_discovery_failed`, a later success recovers. Republish on change.
  const listOrgsTracked = withDiscoveryHealth(deps.listOrgs, health, () => healthFile.publish());

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
      // EP-SEALER-DEPLOY: startup org-discovery probe — fail-loud but RECOVERABLE. A failure sets
      // readiness `org_discovery_failed` (via the wrapper) yet does NOT crash or block the loop:
      // the loop keeps retrying discovery and readiness recovers on the next success. No stale/
      // empty set is sealed — a failed discovery throws before any org is scanned.
      await listOrgsTracked().catch((err: unknown) => {
        logger.error(
          { err: sanitizeSealerError(err) },
          'audit_sealer: startup org-discovery probe failed — readiness NOT ready (org_discovery_failed); loop will retry',
        );
      });
      healthFile.publish();
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
        listOrgs: listOrgsTracked,
        onBacklogAlert: (healthy) => {
          health.setBacklogHealthy(healthy);
          healthFile.publish();
        },
      });
      return { started: true, ready: health.readiness().ready };
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
