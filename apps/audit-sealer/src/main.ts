// Entrypoint for the B3 AuditSealer runner. Loads the runner config + the shared
// KMS env, constructs the Kms exactly as apps/api does, builds the runner, and
// starts it. SIGTERM/SIGINT drain in-flight work then close the pool. A failed
// startup probe leaves the runner not-ready (no crash-loop).

import { loadEnv } from '@govai/config';
// Import KMS from the ./kms subpath, NOT the package index: the index re-exports api-keys, which
// pulls the native `argon2` (a .node binding the sealer never uses). Narrowing to /kms keeps
// argon2 out of the esbuild bundle entirely, so the deployable stays a clean, self-contained JS.
import { createKmsFromEnv } from '@govai/core-identity/kms';
import { startTelemetry } from '@govai/observability';
import { loadSealerConfig } from './config.js';
import { resolveOrgDiscovery } from './org-discovery.js';
import { createRunner } from './runner.js';
import { createLogger } from './logging.js';

async function main(): Promise<void> {
  const logger = createLogger();
  const config = loadSealerConfig(process.env);
  const env = loadEnv(process.env);
  const kms = createKmsFromEnv(env);

  // EP-008B-FOLLOWUP-SEALER: register the global OTel MeterProvider BEFORE
  // createRunner (which builds the default createOtelSealerMetrics() and caches its
  // instruments at getMeter()-time). Gated on OTEL_EXPORTER_OTLP_ENDPOINT: a no-op
  // with the endpoint unset. No KMS boot-probe here, so the placement is free
  // between loadEnv and createRunner. Observe-only.
  const telemetry = startTelemetry(env, { serviceName: 'govai-audit-sealer', logger });

  // EP-SEALER-DEPLOY: resolve the tenant-discovery source. DEFAULT = the DB via the enumerator
  // runtime URL (closes the silent-drop); the AUDIT_SEALER_ORG_IDS CSV is an optional override.
  // Throws SealerConfigError at boot if neither is configured (caught by main().catch → exit 1).
  const discovery = resolveOrgDiscovery(config, process.env);
  logger.info({ org_discovery_source: discovery.source }, 'audit_sealer: org discovery resolved');

  const runner = createRunner({
    config,
    kms,
    listOrgs: discovery.listOrgs,
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
    await discovery.enumeratorPool?.end().catch(() => undefined); // close the discovery pool (DB source only)
    await telemetry.shutdown().catch(() => undefined);
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
