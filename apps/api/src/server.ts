import Fastify, { type FastifyInstance } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Pool } from 'pg';
import { loadEnv, originsFromCsv, assertCorsSafeForProd, BootError, type GovAIEnv } from '@govai/config';
import { createKmsFromEnv, type Kms } from '@govai/core-identity';
import { startTelemetry } from '@govai/observability';
import { createPool } from './db/client.js';
import { healthRoute } from './routes/health.js';
import { capabilitiesRoute } from './routes/capabilities.js';
import { meRoute } from './routes/me.js';
import { aiConversationsRoute } from './routes/ai-conversations.js';
import { runsRoute } from './routes/runs.js';
import { auditEventsRoute } from './routes/audit-events.js';
import { evidenceRoute } from './routes/evidence.js';
import { adminAuditShredRoute } from './routes/admin-audit-shred.js';
import { adminDlpRoute } from './routes/admin-dlp.js';
import { passthroughAnthropicRoute } from './routes/passthrough-anthropic.js';
import { passthroughOpenaiRoute } from './routes/passthrough-openai.js';
import { governedAnthropicRoute } from './routes/governed-anthropic.js';
import { governedOpenaiRoute } from './routes/governed-openai.js';
import { adminProviderCredentialsRoute } from './routes/admin-provider-credentials.js';
import { workroomsRoute } from './routes/workrooms.js';
import { workroomTranscriptRoute } from './routes/workroom-transcript.js';
import { workroomRunsRoute } from './routes/workroom-runs.js';
import { workroomApprovalsRoute } from './routes/workroom-approvals.js';
import { regulatoryRoute } from './routes/regulatory.js';
import { registerRequestIdentityHook } from './pipeline/request-identity-hook.js';
import { createEvidenceGaugeSource, enumerateAllOrgs } from './pipeline/evidence-operator.js';
import { registerEvidenceGauges } from './pipeline/evidence-metrics.js';
import { runDispatchConfigFromEnv } from './pipeline/run-dispatch-config.js';
import {
  startRunDispatchRecoveryWorker,
  type RecoveryWorkerHandle,
} from './pipeline/run-dispatch-recovery.js';
import { isMainModule } from './main-module.js';

export type ServerDeps = {
  env: GovAIEnv;
  kms: Kms;
  pool: Pool;
  policyCommitSha: string;
  /** Injectable clock for the direct-route producers (tests only; production
   *  omits it → real `new Date()`). Threaded to the passthrough deps so an
   *  integration replay can hold `occurred_at` stable across attempts. */
  now?: () => Date;
};

export type ServerOverrides = Partial<{
  pool: Pool;
  env: GovAIEnv;
  now: () => Date;
}>;

export async function buildServer(overrides: ServerOverrides = {}): Promise<FastifyInstance> {
  const env = overrides.env ?? loadEnv(process.env);
  assertCorsSafeForProd(env);
  // EP-EVIDENCE-GAUGE-WIRING FIXUP2: a loud, named boot failure when the app must build its
  // own pool but DATABASE_URL is absent — restores diagnosability after FIXUP1 normalized
  // ''→undefined (a missing/empty DATABASE_URL would otherwise silently reach createPool('')).
  // Skipped when a pool is injected (tests). Deliberately NOT in loadEnv, whose legitimate
  // partial-env callers (the U3 boot suite, the config unit test) pass no DATABASE_URL.
  if (!overrides.pool && !env.DATABASE_URL) {
    throw new BootError('DATABASE_URL is required');
  }
  const kms = createKmsFromEnv(env);

  if (env.NODE_ENV === 'production') {
    await kms.deriveKey({
      purpose: 'audit_hmac',
      orgId: '00000000-0000-0000-0000-000000000000',
      keyId: 'boot-probe',
      version: 1,
    });
  }

  const pool =
    overrides.pool ??
    createPool({ connectionString: env.DATABASE_URL ?? '' });

  const app = Fastify({
    logger: { level: env.NODE_ENV === 'production' ? 'info' : 'debug' },
    disableRequestLogging: false,
  });

  // FIXUP6 (class fix): absorb async pool 'error' events so a transient backend loss never
  // throws-unhandled and kills the API. ONLY when the app OWNS the pool — an injected pool
  // (tests) owns its own lifecycle. Attached here (not at the createPool line) because app.log
  // does not exist until the Fastify app is created. Main-pool errors are an operational alarm
  // (error) but still absorbed; the pool attempts its own reconnection.
  if (!overrides.pool) {
    pool.on('error', (err) => {
      app.log.error(
        { err, pool: 'app' },
        'app database pool error (connection lost; pool will attempt recovery)',
      );
    });
  }

  await app.register(helmet, { contentSecurityPolicy: false });
  const origins = originsFromCsv(env.API_CORS_ORIGINS);
  await app.register(cors, {
    origin: origins.length === 0 ? false : origins,
    credentials: env.API_CORS_CREDENTIALS,
  });
  // The integration suite drives many requests per process; the in-memory
  // limiter would otherwise throttle a test file. Production is unaffected —
  // it keeps the 100/min limit.
  await app.register(rateLimit, {
    max: env.NODE_ENV === 'test' ? 1_000_000 : 100,
    timeWindow: '1 minute',
  });

  const policyCommitSha = process.env['GOVAI_POLICY_COMMIT_SHA'] ?? 'runtime-patch-1';

  app.decorate('govai', { env, kms, pool, policyCommitSha, now: overrides.now });

  // EP-008B-FOLLOWUP: register the global OTel MeterProvider BEFORE the route
  // registers (the EP-008B metrics factory runs at route-registration time and
  // caches its Counter at getMeter()-time). Placed after the KMS boot-probe so a
  // prod BootError->exit(1) never orphans a periodic reader. Gated on
  // OTEL_EXPORTER_OTLP_ENDPOINT: a no-op with the endpoint unset. Observe-only.
  const telemetry = startTelemetry(env, { serviceName: 'govai-api', logger: app.log });

  // EP-EVIDENCE-GAUGE-WIRING: wire the govai_evidence_* gauges (EP-008D) into boot —
  // gated identically to startTelemetry (OTEL endpoint) PLUS the enumerator URL, so with
  // either unset boot is byte-identical. Must run AFTER startTelemetry (getMeter needs the
  // global MeterProvider). INV-1: enumeration runs on a least-privilege enumerator pool;
  // the per-org reads stay on the app `pool` under withTenant. Observe-only (the shipped
  // batch callback try/catches). Handles are closed in onClose below.
  let evidenceGauges: { unregister(): void } | null = null;
  let enumeratorPool: Pool | null = null;
  if (telemetry.enabled && env.GOVAI_EVIDENCE_ENUMERATOR_URL) {
    enumeratorPool = createPool({ connectionString: env.GOVAI_EVIDENCE_ENUMERATOR_URL, max: 2 });
    // FIXUP6 (class fix): absorb the enumerator pool's async 'error' (e.g. FIXUP5's
    // deprovision-terminate kills its backends) — observe-only stays observe-only, never
    // throws-unhandled. Non-fatal: gauge collection pauses until reprovision/restart.
    enumeratorPool.on('error', (err) => {
      app.log.warn(
        { err, pool: 'evidence_enumerator' },
        'enumerator pool error (non-fatal; gauge collection may pause until reprovision/restart)',
      );
    });
    const scope = {
      windowSeconds: env.EVIDENCE_DEFAULT_WINDOW_SECONDS,
      tSealSeconds: env.EVIDENCE_T_SEAL_SECONDS,
    };
    const source = createEvidenceGaugeSource({
      pool,
      scope,
      enumerate: enumerateAllOrgs,
      enumeratePool: enumeratorPool,
    });
    evidenceGauges = registerEvidenceGauges(source);
    app.log.info({ evidence_gauges: 'registered' });
  } else {
    app.log.info({
      evidence_gauges: 'disabled',
      reason: !telemetry.enabled ? 'otel_endpoint_unset' : 'enumerator_url_unset',
    });
  }

  await app.register(healthRoute);
  await app.register(capabilitiesRoute);
  await app.register(meRoute);
  // EP-AI-CONVERSATION-CONTINUITY-V1 P0-B: the owner-authorized conversation control plane.
  // Registered as its own plugin so its AUTH-READ-CACHE-01 `onRequest` hook (no-store on every
  // response of the surface) is ENCAPSULATED to these routes. It starts no worker, no timer and
  // no queue: registration adds routes and nothing else.
  await app.register(aiConversationsRoute);
  await app.register(runsRoute);
  await app.register(auditEventsRoute);
  await app.register(evidenceRoute);
  await app.register(adminAuditShredRoute);
  await app.register(adminDlpRoute);
  await app.register(passthroughAnthropicRoute);
  await app.register(passthroughOpenaiRoute);
  await app.register(governedAnthropicRoute);
  await app.register(governedOpenaiRoute);
  // AuditBridge ingress: one prefix-scoped onRequest hook that builds the
  // per-request identity for the four direct-provider routes and enters it into
  // the ALS store the wired dispatcher reads (ADR-028 §2). No-op elsewhere.
  registerRequestIdentityHook(app);
  await app.register(adminProviderCredentialsRoute);
  await app.register(workroomsRoute);
  await app.register(workroomTranscriptRoute);
  await app.register(workroomRunsRoute);
  await app.register(workroomApprovalsRoute);
  await app.register(regulatoryRoute);

  // EP-P03A-A (F3 §25): run dispatch recovery worker — starts AFTER the app is
  // ready (onReady), stops on close (interval cleared + in-flight sweep awaited,
  // no floating promise, never blocks shutdown). Gated by RUN_DISPATCH_RECOVERY_
  // ENABLED so deterministic tests can drive runDispatchRecoverySweepOnce directly.
  const dispatchConfig = runDispatchConfigFromEnv(env);
  let recoveryWorker: RecoveryWorkerHandle | null = null;
  if (dispatchConfig.recoveryEnabled) {
    app.addHook('onReady', async () => {
      recoveryWorker = startRunDispatchRecoveryWorker({
        pool,
        kms,
        config: dispatchConfig,
        log: app.log,
      });
      app.log.info(
        { interval_ms: dispatchConfig.recoveryIntervalMs },
        'run dispatch recovery worker started',
      );
    });
  } else {
    app.log.info({ run_dispatch_recovery: 'disabled' });
  }

  app.addHook('onClose', async () => {
    await recoveryWorker?.stop().catch(() => undefined); // (0) stop sweeps before pools close
    evidenceGauges?.unregister(); // (1) remove the batch callback before provider shutdown (sync)
    await telemetry.shutdown().catch(() => undefined); // (2) existing, unchanged
    await enumeratorPool?.end().catch(() => undefined); // (3) created locally ⇒ no overrides guard
    if (!overrides.pool) {
      // (4) BOUNDED owned-pool close (Codex P2 on 6362c47): pg's pool.end()
      // waits for borrowed clients to return, so a client stalled on a
      // partitioned database — e.g. an abandoned recovery sweep past its own
      // shutdown bound — would hold close() past the API's termination grace
      // even after (0) returned. Past the bound the pool teardown is
      // abandoned: the process is exiting and the platform reaps the sockets.
      let ended = false;
      const ending = pool.end().then(
        () => {
          ended = true;
        },
        () => {
          ended = true;
        },
      );
      await Promise.race([
        ending,
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 5_000);
          t.unref?.();
        }),
      ]);
      if (!ended) {
        app.log.error(
          { waited_ms: 5_000, pool: 'app' },
          'app pool close still waiting on borrowed clients at the shutdown bound; abandoned',
        );
      }
    }
  });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    govai: ServerDeps;
  }
}

// M2A F2: canonical-path entrypoint check (the textual `file://${argv[1]}` guard
// silently no-ops under percent-encoded / symlinked checkout paths — see main-module.ts).
if (isMainModule(import.meta.url)) {
  buildServer()
    .then(async (app) => {
      try {
        await app.listen({ host: app.govai.env.API_HOST, port: app.govai.env.API_PORT });
      } catch (err) {
        app.log.error(err);
        process.exit(1);
      }
    })
    .catch((err) => {
      if (err instanceof BootError) {
        console.error(`[boot-fail] ${err.message}`);
      } else {
        console.error(err);
      }
      process.exit(1);
    });
}
