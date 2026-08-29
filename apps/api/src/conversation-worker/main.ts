// THE DETACHED CONVERSATION WORKER PROCESS (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §9).
//
// This is the executable that owns provider execution for durable conversation turns. It is a
// SEPARATE PROCESS from the request-serving API, started and stopped independently
// (`pnpm --filter @govai/api run conversation-worker`).
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// WHY AN ENTRYPOINT INSIDE apps/api AND NOT A NEW WORKSPACE APP (source-adjudicated)
//
// The dispatch prefers a dedicated workspace app on the `apps/audit-sealer` pattern, "IF source
// adjudication supports that cleanly". It does not, and the reason is structural rather than
// stylistic: `apps/audit-sealer` depends ONLY on `packages/*`, whereas the conversation worker
// MUST reuse execution machinery that lives in `apps/api/src/pipeline` —
//   * `audit-bridge.ts`        the AuditBridge dispatcher (§14 evidence contract)
//   * `provider-credentials.ts` the credential/KMS resolution semantics
//   * `request-identity.ts`     the `AuditBridgeRequestIdentity` ALS the capture reads
// A new workspace app could not import those without either duplicating them — which would
// create the SECOND governance/evidence path §9 forbids ("the conversation runner is an
// ADDITIONAL caller of the same provider pipeline, not a fork of it") — or relocating them into
// `packages/*`, a refactor of the FROZEN Foundation V1 runtime that is far outside P0-C.
//
// So the honest choice is a distinct executable entrypoint here, meeting every condition the
// dispatch attaches to that fallback:
//   ✓ authenticates as `govai_conversation_worker` (attested live, per checkout)
//   ✓ has a SEPARATE database credential lifecycle (`GOVAI_CONVERSATION_WORKER_DATABASE_URL`)
//   ✓ does NOT share the API's pool — it constructs its own, inside an opaque capability
//   ✓ CANNOT fall back to `govai_app` — the config loader fails closed with no fallback
//   ✓ is independently startable/stoppable — this file, with its own signal handling
//   ✓ leaves the request-serving API as NOT the execution authority — `server.ts` neither
//     imports nor starts any of this, which `ai-conversation-p0c-boundary.test.ts` asserts.
// ═══════════════════════════════════════════════════════════════════════════════════════════

// ★ THE `/kms` SUBPATH, NEVER THE PACKAGE INDEX — a deployability constraint this repository has
// already paid for once. `core-identity`'s index re-exports `api-keys.js`, which pulls in argon2 (a
// native module); the audit-sealer, the repo's only bundled deployable, imports from
// `@govai/core-identity/kms` for exactly this reason. This worker is the SECOND deployable-shaped
// entrypoint, and today it runs under `tsx`, where the difference is invisible — which is precisely
// why the wrong import would survive until someone bundled it and then fail at deploy time rather
// than here. The type-only `Kms` imports elsewhere in this movement are erased at compile time and
// carry no such risk.
import { createKmsFromEnv, type Kms } from '@govai/core-identity/kms';
import { loadEnv, type GovAIEnv } from '@govai/config';
import pino from 'pino';
import { isMainModule } from '../main-module.js';
import {
  createConversationWorkerDb,
  loadConversationWorkerDbConfig,
  type ConversationWorkerDb,
} from '../pipeline/ai-conversation-worker.js';
import {
  startConversationWorker,
  type ConversationWorkerHandle,
  type ConversationWorkerRunnerConfig,
} from '../ai-conversations/execution/runner.js';
import type { ConversationExecutorDeps, ExecutorLog } from '../ai-conversations/execution/execute-turn.js';

export class ConversationWorkerRuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConversationWorkerRuntimeConfigError';
  }
}

export type ConversationWorkerRuntimeConfig = {
  leaseMs: number;
  heartbeatIntervalMs: number;
  recoveryGraceMs: number;
  dispatchTimeoutMs: number;
  streamFlushBytes: number;
  runner: ConversationWorkerRunnerConfig;
  upstreamBaseUrlAnthropic: string;
  upstreamBaseUrlOpenAI: string;
};

/**
 * Cross-field validation the per-key env schema cannot express.
 *
 * ★ HEARTBEAT ≪ LEASE IS A SAFETY PROPERTY, NOT A TUNING PREFERENCE. The heartbeat is what keeps
 * a HEALTHY runner's lease alive while the provider is slow. If a tick could fall outside the
 * lease, a runner doing everything right would be ratcheted out from under itself by recovery —
 * and its in-flight provider call would become a zombie the fence has to catch. Requiring the
 * lease to be at least THREE ticks means two consecutive tick failures are survivable.
 */
export function loadConversationWorkerRuntimeConfig(env: GovAIEnv): ConversationWorkerRuntimeConfig {
  const leaseMs = env.CONVERSATION_WORKER_LEASE_MS;
  const heartbeatIntervalMs = env.CONVERSATION_WORKER_HEARTBEAT_MS;
  if (heartbeatIntervalMs * 3 > leaseMs) {
    throw new ConversationWorkerRuntimeConfigError(
      `CONVERSATION_WORKER_HEARTBEAT_MS (${heartbeatIntervalMs}) must be at most one third of ` +
        `CONVERSATION_WORKER_LEASE_MS (${leaseMs}): the lease has to survive two consecutive ` +
        'missed heartbeat ticks, or a healthy runner can be recovered out from under itself.',
    );
  }
  // The provider bound must fit inside a lease that the heartbeat is renewing; it does not have
  // to be SHORTER than the lease, because the heartbeat extends the lease for the whole call.
  const base =
    env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0
      ? env.GOVAI_PROVIDER_BASE_URL
      : null;
  return {
    leaseMs,
    heartbeatIntervalMs,
    recoveryGraceMs: env.CONVERSATION_WORKER_RECOVERY_GRACE_MS,
    dispatchTimeoutMs: env.GOVAI_PROVIDER_DISPATCH_TIMEOUT_MS,
    streamFlushBytes: env.CONVERSATION_WORKER_STREAM_FLUSH_BYTES,
    runner: {
      batchSize: env.CONVERSATION_WORKER_BATCH_SIZE,
      intervalMs: env.CONVERSATION_WORKER_INTERVAL_MS,
      maxPagesPerSweep: env.CONVERSATION_WORKER_MAX_PAGES_PER_SWEEP,
    },
    // One override serves both providers (the hermetic protocol server hosts both surfaces),
    // exactly as the direct routes read it; absent, each provider gets its real API host.
    upstreamBaseUrlAnthropic: base ?? 'https://api.anthropic.com',
    upstreamBaseUrlOpenAI: base ?? 'https://api.openai.com',
  };
}

export type ConversationWorkerProcess = {
  db: ConversationWorkerDb;
  handle: ConversationWorkerHandle;
  stop(): Promise<void>;
};

/**
 * Build the executor deps.
 *
 * ★ ONE SET OF DEPS SERVES BOTH PROVIDERS. The base URL is a RESOLVER, not a value, because one
 * discovery sweep returns candidates of both providers and the provider is only known once the
 * plan is resolved from durable branch state. A fixed URL here would have sent every OpenAI
 * conversation to `api.anthropic.com` in production, where the two hosts differ — a defect the
 * hermetic stack could never surface, because there `GOVAI_PROVIDER_BASE_URL` makes them equal.
 */
export function buildExecutorDeps(input: {
  db: ConversationWorkerDb;
  kms: Kms;
  log: ExecutorLog;
  claimant: string;
  config: ConversationWorkerRuntimeConfig;
}): ConversationExecutorDeps {
  return {
    db: input.db,
    kms: input.kms,
    upstreamBaseUrlFor: (provider) =>
      provider === 'anthropic'
        ? input.config.upstreamBaseUrlAnthropic
        : input.config.upstreamBaseUrlOpenAI,
    log: input.log,
    claimant: input.claimant,
    leaseMs: input.config.leaseMs,
    recoveryGraceMs: input.config.recoveryGraceMs,
    heartbeatIntervalMs: input.config.heartbeatIntervalMs,
    dispatchTimeoutMs: input.config.dispatchTimeoutMs,
    streamFlushBytes: input.config.streamFlushBytes,
  };
}

/**
 * Start the worker process's runtime. Exported so an integration test can start and stop the
 * REAL runtime rather than a re-implementation of it.
 */
export async function startConversationWorkerProcess(overrides?: {
  env?: GovAIEnv;
  log?: ExecutorLog;
}): Promise<ConversationWorkerProcess> {
  const env = overrides?.env ?? loadEnv(process.env);
  const log =
    overrides?.log ??
    (pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug' }) as unknown as ExecutorLog);
  const runtime = loadConversationWorkerRuntimeConfig(env);
  // FAILS CLOSED when the dedicated URL is absent: there is no fallback to `DATABASE_URL`.
  const dbConfig = loadConversationWorkerDbConfig(process.env);
  const kms = createKmsFromEnv(env);
  const db = createConversationWorkerDb({
    config: dbConfig,
    log: log as never,
  });
  const claimant = `conversation-worker:${dbConfig.workerId ?? 'default'}`;

  // ★ ONE LOOP, BOTH PROVIDERS. Discovery is provider-agnostic (it returns claim-plane metadata
  // only), and the provider is resolved per candidate from durable branch state at dispatch. The
  // per-provider host resolution lives in the deps, so a single sweep drives Anthropic and
  // OpenAI conversations correctly even when their hosts differ.
  const deps = buildExecutorDeps({ db, kms, log, claimant, config: runtime });
  const handle = startConversationWorker(deps, runtime.runner);

  log.info(
    {
      claimant,
      lease_ms: runtime.leaseMs,
      heartbeat_ms: runtime.heartbeatIntervalMs,
      recovery_grace_ms: runtime.recoveryGraceMs,
      interval_ms: runtime.runner.intervalMs,
      batch_size: runtime.runner.batchSize,
    },
    'conversation worker: started',
  );

  return {
    db,
    handle,
    async stop(): Promise<void> {
      await handle.stop();
      await db.close();
      log.info({ claimant }, 'conversation worker: stopped');
    },
  };
}

if (isMainModule(import.meta.url)) {
  void (async () => {
    let proc: ConversationWorkerProcess | undefined;
    const shutdown = (signal: string): void => {
      void (async () => {
        console.error(`conversation worker: received ${signal}, shutting down`);
        await proc?.stop().catch(() => undefined);
        process.exit(0);
      })();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    try {
      proc = await startConversationWorkerProcess();
    } catch (err) {
      // A boot failure names its CLASS and message but can never carry a connection string: the
      // config loader's messages are written to hold env-var NAMES only.
      console.error(
        `conversation worker: failed to start (${err instanceof Error ? `${err.name}: ${err.message}` : 'unknown'})`,
      );
      process.exit(1);
    }
  })();
}
