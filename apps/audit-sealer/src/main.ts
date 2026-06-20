// Entrypoint for the B3 AuditSealer runner. Loads the runner config + the shared
// KMS env, constructs the Kms exactly as apps/api does, builds the runner, and
// starts it. SIGTERM/SIGINT drain in-flight work then close the pool. A failed
// startup probe leaves the runner not-ready (no crash-loop).

import { loadEnv } from '@govai/config';
import { createKmsFromEnv } from '@govai/core-identity';
import { loadSealerConfig } from './config.js';
import { listOrgsFromEnv } from './org-discovery.js';
import { createRunner } from './runner.js';
import { createLogger } from './logging.js';

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadSealerConfig(process.env);
  const env = loadEnv(process.env);
  const kms = createKmsFromEnv(env);

  const runner = createRunner({
    config,
    kms,
    listOrgs: listOrgsFromEnv(process.env),
    logger,
  });

  const result = await runner.start();
  if (!result.ready) {
    // NOT a silent idle and NOT a crash: the runner is alive but NOT ready, and
    // its health surface (the health file) reports not-ready with the reason. The
    // health-file refresh interval keeps the process alive so an orchestrator
    // readiness probe observes not-ready and acts (restart / alert).
    logger.error(
      'audit_sealer: NOT ready after startup — health surface reports not-ready; awaiting orchestrator action',
    );
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'audit_sealer: shutting down — draining');
    await runner.stop();
    logger.info('audit_sealer: drained; exiting');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  // Boot-time failure (bad config / KMS): log and exit non-zero so the
  // orchestrator restarts. (A failed DB startup PROBE is handled inside the
  // runner as not-ready, not a crash.)
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[audit-sealer boot-fail] ${message}`);
  process.exit(1);
});
