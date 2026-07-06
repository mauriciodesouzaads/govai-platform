// EP-006 — B3 AuditSealer runner integration matrix (S0–S11), real Postgres
// (Testcontainers). Exercises the REAL runner modules (startup-validation,
// seal-once, stale-recovery, claim-loop, health) under the production role model:
// a dedicated login role `govai_sealer_runner` that is a MEMBER of BOTH
// govai_audit_sealer AND govai_app (ADR-022), connecting via the runner's own
// pool. The stale-recovery path is verified to NOT duplicate appends and to
// reconstruct the event byte-identically via the EP-005.5 shared mapping (GATE D).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type PoolClient } from 'pg';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { installPostgresPoolShutdownGuard } from './setup.js';
import type { Kms } from '@govai/core-identity';
import {
  captureAuditEvent,
  claimAuditCaptureForSeal,
  buildAuditCaptureSealingEvent,
  deriveAuditSealerCaptureEventId,
  auditAppend,
} from '@govai/core-audit';

import { loadSealerConfig, type SealerConfig } from '../../apps/audit-sealer/src/config.js';
import { setLocalAppOrgId } from '../../apps/audit-sealer/src/tenant-context.js';
import { validateStartup } from '../../apps/audit-sealer/src/startup-validation.js';
import { sealOnce } from '../../apps/audit-sealer/src/seal-once.js';
import { sweepStaleRecoveries, recoverStaleRow } from '../../apps/audit-sealer/src/stale-recovery.js';
import { runScanTick, startClaimLoop } from '../../apps/audit-sealer/src/claim-loop.js';
import { createRunner } from '../../apps/audit-sealer/src/runner.js';
import { HealthState } from '../../apps/audit-sealer/src/health.js';
import {
  createRecordingSealerMetrics,
  type SealerMetrics,
  SEALER_METRIC_NAMES,
} from '../../apps/audit-sealer/src/metrics.js';
import { createLogger } from '../../apps/audit-sealer/src/logging.js';

const RUNNER_ROLE = 'govai_sealer_runner';
let stack: Stack;
let runnerPool: Pool;
let runnerUrl: string;
let kms: Kms;
const logger = createLogger({ level: 'silent' });

function baseConfig(overrides: Record<string, string> = {}): SealerConfig {
  return loadSealerConfig({
    AUDIT_SEALER_DATABASE_URL: runnerUrl,
    AUDIT_SEALER_IDLE_SLEEP_MS: '40',
    AUDIT_SEALER_DRAIN_MS: '5000',
    AUDIT_SEALER_STALE_THRESHOLD_MS: '1',
    AUDIT_SEALER_WORKER_ID: 'sealer-test',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

beforeAll(async () => {
  stack = await startStack();
  kms = stack.app.govai.kms;

  // Create the ADR-022 runner identity: a LOGIN role that is a MEMBER of both
  // phase roles (so it can SET LOCAL ROLE to each). NOINHERIT — it acts only via
  // an explicit role switch. No grant-weakening: the underlying B0 grant split is
  // untouched; this role simply holds membership in both.
  const runnerPwd = randomBytes(18).toString('hex');
  const admin = await stack.db.adminPool.connect();
  try {
    await admin.query(
      `DO $$ BEGIN CREATE ROLE ${RUNNER_ROLE} LOGIN NOINHERIT; EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
    );
    await admin.query(`ALTER ROLE ${RUNNER_ROLE} WITH LOGIN PASSWORD '${runnerPwd}'`);
    await admin.query(`GRANT govai_audit_sealer TO ${RUNNER_ROLE}`);
    await admin.query(`GRANT govai_app TO ${RUNNER_ROLE}`);
    // The runner identity needs USAGE on schema govai so its bare-role startup
    // probe (to_regprocedure name resolution) can see the B0/B1 functions. This
    // is part of the runner identity's own privileges — it does NOT alter the
    // B0 EXECUTE grant split (claim/seal → sealer, append → app), which the
    // per-phase SET LOCAL ROLE still governs. Production grants the same USAGE.
    await admin.query(`GRANT USAGE ON SCHEMA govai TO ${RUNNER_ROLE}`);
  } finally {
    admin.release();
  }

  const u = new URL(stack.db.appUrl);
  u.username = RUNNER_ROLE;
  u.password = runnerPwd;
  runnerUrl = u.toString();
  runnerPool = new Pool({ connectionString: runnerUrl, max: 4 });
  installPostgresPoolShutdownGuard(runnerPool, stack.db.shuttingDown, 'sealer-runner');
}, 240_000);

afterAll(async () => {
  if (runnerPool) {
    stack.db.shuttingDown.value = true;
    await runnerPool.end().catch(() => undefined);
  }
  if (stack) await stopStack(stack);
});

// ---- helpers (test setup runs as superuser via adminPool) --------------------

async function withAdmin<T>(orgId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query('BEGIN');
    if (orgId) await setLocalAppOrgId(c, orgId);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function seedCapture(orgId: string, chainId: string): Promise<{ captureId: string; captureSeq: string }> {
  return withAdmin(orgId, async (c) => {
    const r = await captureAuditEvent(c, {
      captureId: randomUUID(),
      orgId,
      chainId,
      chainCategory: 'run',
      eventType: 'passthrough.invoked',
      eventVersion: '4',
      subjectType: 'runtime_event',
      subjectId: randomUUID(),
      occurredAt: new Date('2026-06-15T00:00:00.000Z'),
      payloadHash: Buffer.from('ab'.repeat(32), 'hex'),
      keyId: 'audit-1',
      keyVersion: 1,
      redactionMetadata: { surface: 'provider-native' },
    });
    return { captureId: r.captureId, captureSeq: r.captureSeq };
  });
}

function newChain(orgId: string): string {
  return `org:${orgId}:run:${randomUUID()}`;
}

async function fetchStatus(orgId: string, captureId: string): Promise<string | null> {
  return withAdmin(orgId, async (c) => {
    const r = await c.query<{ status: string }>(
      `SELECT status FROM govai.audit_capture_outbox WHERE capture_id = $1::uuid`,
      [captureId],
    );
    return r.rows[0]?.status ?? null;
  });
}

async function countEvents(eventId: string): Promise<number> {
  return withAdmin(null, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.audit_events WHERE id = $1::uuid`,
      [eventId],
    );
    return Number(r.rows[0]!.n);
  });
}

async function eventSeq(eventId: string): Promise<string | null> {
  return withAdmin(null, async (c) => {
    const r = await c.query<{ s: string }>(
      `SELECT sequence_number::text AS s FROM govai.audit_events WHERE id = $1::uuid`,
      [eventId],
    );
    return r.rows[0]?.s ?? null;
  });
}

async function lastSealedSeq(chainId: string): Promise<string> {
  return withAdmin(null, async (c) => {
    const r = await c.query<{ s: string }>(
      `SELECT last_sealed_capture_seq::text AS s FROM govai.audit_capture_chain_state WHERE chain_id = $1::text`,
      [chainId],
    );
    return r.rows[0]?.s ?? '0';
  });
}

async function captureRefExists(captureId: string): Promise<boolean> {
  return withAdmin(null, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM govai.audit_event_capture_refs WHERE capture_id = $1::uuid`,
      [captureId],
    );
    return Number(r.rows[0]!.n) > 0;
  });
}

// The outbox guard freezes lifecycle timestamps on a same-status UPDATE, so a
// `sealing` row cannot be aged directly. Instead the recovery sweep runs with
// AUDIT_SEALER_STALE_THRESHOLD_MS=1 and this small sleep guarantees the row has
// been `sealing` for > 1ms (its sealing_started_at was set by the real claim).
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Drive the REAL claim → load → append path (no mark_sealed) to leave a stuck
 *  `sealing` row, optionally with the deterministic event already appended
 *  (crash-after-append) or not (crash-after-claim). Uses the runner pool/role. */
async function seedStuckSealing(
  orgId: string,
  chainId: string,
  opts: { appendEvent: boolean; divergentSubjectId?: string },
): Promise<{ captureId: string; eventId: string }> {
  const { captureId } = await seedCapture(orgId, chainId);
  const eventId = deriveAuditSealerCaptureEventId({ orgId, captureId });
  const c = await runnerPool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL ROLE govai_audit_sealer');
    await setLocalAppOrgId(c, orgId);
    const claimed = await claimAuditCaptureForSeal(c, { orgId, chainId }); // captured → sealing
    if (!claimed) throw new Error('seedStuckSealing: claim returned null');
    if (opts.appendEvent) {
      const event = buildAuditCaptureSealingEvent(claimed, { workerId: 'setup' });
      await c.query('SET LOCAL ROLE govai_app');
      await setLocalAppOrgId(c, orgId);
      await auditAppend(c, kms, {
        ...event,
        eventId,
        ...(opts.divergentSubjectId ? { subjectId: opts.divergentSubjectId } : {}),
      });
    }
    await c.query('COMMIT'); // leave it `sealing`, mark_sealed never ran
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
  return { captureId, eventId };
}

function recordingDeps(orgId: string, config: SealerConfig, metrics: SealerMetrics) {
  return {
    orgId,
    thresholdMs: config.stale.thresholdMs,
    batch: config.stale.recoveryBatch,
    maxRetries: config.stale.maxRetries,
    recoveryBackoff: {
      minMs: config.stale.recoveryBackoffMinMs,
      maxMs: config.stale.recoveryBackoffMaxMs,
    },
    workerId: config.workerId,
    metrics,
    logger,
    sleep: async () => undefined, // no real waiting in tests
    rand: () => 0,
  };
}

// =============================================================================

describe('S0 — startup validation', () => {
  it('passes the role/permission/function probe on a correct DB', async () => {
    const result = await validateStartup(runnerPool);
    expect(result.ready).toBe(true);
    expect(result.checks.find((c) => c.name === 'set_role_govai_audit_sealer')?.ok).toBe(true);
    expect(result.checks.find((c) => c.name === 'set_role_govai_app')?.ok).toBe(true);
    expect(result.checks.find((c) => c.name === 'fn_claim_for_seal')?.ok).toBe(true);
    expect(result.checks.find((c) => c.name === 'fn_audit_append_locked')?.ok).toBe(true);
  });

  it('fails readiness (not liveness) when a required EXECUTE grant is missing', async () => {
    const sig = 'govai.audit_capture_claim_for_seal(uuid, text, bigint)';
    await withAdmin(null, async (c) => {
      await c.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM govai_audit_sealer`);
    });
    try {
      const result = await validateStartup(runnerPool); // must NOT throw
      expect(result.ready).toBe(false);
      expect(result.checks.find((c) => c.name === 'fn_claim_for_seal')?.ok).toBe(false);
    } finally {
      await withAdmin(null, async (c) => {
        await c.query(`GRANT EXECUTE ON FUNCTION ${sig} TO govai_audit_sealer`);
      });
    }
  });
});

describe('S1/S2 — claim→seal happy path + deterministic id', () => {
  it('claims, appends, mark_sealed; chain advances; id is the deterministic id', async () => {
    const org = await seedOrg(stack);
    const chainId = newChain(org.org_id);
    const { captureId } = await seedCapture(org.org_id, chainId);

    const result = await sealOnce(runnerPool, kms, { orgId: org.org_id, chainId, workerId: 'sealer-test' });
    expect(result.status).toBe('sealed');
    if (result.status !== 'sealed') return;
    expect(result.captureSeq).toBe('1');

    const expectedId = deriveAuditSealerCaptureEventId({ orgId: org.org_id, captureId });
    expect(result.auditEventId).toBe(expectedId); // S2: deterministic id
    expect(await fetchStatus(org.org_id, captureId)).toBe('sealed');
    expect(await captureRefExists(captureId)).toBe(true);
    expect(await lastSealedSeq(chainId)).toBe('1');
    expect(await countEvents(expectedId)).toBe(1);
  });
});

describe('S3 + S4 — append-succeeded + mark_sealed-failed recovery (GATE D, no duplicate, byte-identical lookup-HIT)', () => {
  it('recovers via the SEPARATE path with NO duplicate append and a byte-identical match', async () => {
    const org = await seedOrg(stack);
    const chainId = newChain(org.org_id);
    // Crash-after-append: event appended at the deterministic id, row stuck `sealing`,
    // capture_ref ABSENT (mark_sealed never ran). S4: the lookup finds the event
    // even though the ref is absent.
    const { captureId, eventId } = await seedStuckSealing(org.org_id, chainId, { appendEvent: true });
    expect(await fetchStatus(org.org_id, captureId)).toBe('sealing');
    expect(await captureRefExists(captureId)).toBe(false);
    expect(await countEvents(eventId)).toBe(1);
    const seqBefore = await eventSeq(eventId);
    await sleep(25); // ensure sealing_started_at is > 1ms in the past (stale)

    const metrics = createRecordingSealerMetrics();
    const config = baseConfig();
    const summary = await sweepStaleRecoveries(runnerPool, kms, recordingDeps(org.org_id, config, metrics));

    // GATE D #1 — NO duplicate: exactly ONE chain event for the deterministic id.
    expect(await countEvents(eventId)).toBe(1);
    // GATE D #2 — byte-identical lookup-HIT: the recovered append returned the
    // EXISTING event (sequence_number unchanged); a divergent reconstruction would
    // have thrown in assertExistingEventMatches → the row would be `failed`, not sealed.
    expect(await eventSeq(eventId)).toBe(seqBefore);
    expect(summary.recovered).toBe(1);
    expect(summary.failed).toBe(0);
    // GATE D #3 — chain advances by 1, ref now present, row sealed.
    expect(await fetchStatus(org.org_id, captureId)).toBe('sealed');
    expect(await captureRefExists(captureId)).toBe(true);
    expect(await lastSealedSeq(chainId)).toBe('1');
    // recoverable rows are advanced, NEVER terminal-failed.
    expect(metrics.records.some((r) => r.name === SEALER_METRIC_NAMES.terminalFailureTotal)).toBe(false);
  });
});

describe('S5 — mismatched existing event fails safe (terminal, no forged append)', () => {
  it('marks the capture failed + emits terminal_failure; no duplicate', async () => {
    const org = await seedOrg(stack);
    const chainId = newChain(org.org_id);
    // An event exists at the deterministic id with DIVERGENT immutable content
    // (different subject_id) than the recovery will reconstruct.
    const divergentSubject = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const { captureId, eventId } = await seedStuckSealing(org.org_id, chainId, {
      appendEvent: true,
      divergentSubjectId: divergentSubject,
    });
    // S5 drives recoverStaleRow directly (no detection sweep), so no aging needed.

    const metrics = createRecordingSealerMetrics();
    const config = baseConfig();
    const outcome = await recoverStaleRow(runnerPool, kms, {
      ...recordingDeps(org.org_id, config, metrics),
      captureId,
    });

    expect(outcome.outcome).toBe('failed');
    if (outcome.outcome === 'failed') expect(outcome.reason).toBe('divergent_content');
    expect(metrics.records.some((r) => r.name === SEALER_METRIC_NAMES.terminalFailureTotal)).toBe(true);
    expect(await fetchStatus(org.org_id, captureId)).toBe('failed'); // the documented stall
    expect(await countEvents(eventId)).toBe(1); // no duplicate / forged append
    expect(await captureRefExists(captureId)).toBe(false);
  });
});

describe('S6 — stale sealing detection + recovery (crash-after-claim; ends sealed, not failed)', () => {
  it('detects via sealing_started_at and advances the chain', async () => {
    const org = await seedOrg(stack);
    const chainId = newChain(org.org_id);
    // Crash-after-claim: row `sealing`, NO event appended yet.
    const { captureId, eventId } = await seedStuckSealing(org.org_id, chainId, { appendEvent: false });
    expect(await countEvents(eventId)).toBe(0);
    await sleep(25); // ensure sealing_started_at is > 1ms in the past (stale)

    const metrics = createRecordingSealerMetrics();
    const config = baseConfig();
    const summary = await sweepStaleRecoveries(runnerPool, kms, recordingDeps(org.org_id, config, metrics));

    expect(summary.staleDetected).toBeGreaterThanOrEqual(1);
    expect(summary.recovered).toBe(1);
    expect(summary.failed).toBe(0);
    expect(await fetchStatus(org.org_id, captureId)).toBe('sealed'); // NOT failed
    expect(await countEvents(eventId)).toBe(1); // freshly appended exactly once
    expect(await lastSealedSeq(chainId)).toBe('1');
    expect(metrics.records.some((r) => r.name === SEALER_METRIC_NAMES.staleCount)).toBe(true);
  });
});

describe('S7 — bounded loop / backpressure (no busy loop; backlog alert; no provider throttling)', () => {
  it('drains a chain within a tick, emits backlog metrics, raises the alert when over threshold', async () => {
    const org = await seedOrg(stack);
    const chainId = newChain(org.org_id);
    for (let i = 0; i < 3; i += 1) await seedCapture(org.org_id, chainId);

    const metrics = createRecordingSealerMetrics();
    const config = baseConfig({ AUDIT_SEALER_BACKLOG_PENDING_COUNT: '1' }); // 3 pending > 1 → alert
    let healthy = true;
    const summary = await runScanTick({
      pool: runnerPool,
      kms,
      config,
      metrics,
      logger,
      listOrgs: async () => [org.org_id],
      sleep: async () => undefined,
      rand: () => 0,
      onBacklogAlert: (h) => {
        healthy = h;
      },
    });

    expect(summary.sealed).toBe(3); // chain drained in-tick
    expect(summary.backlogAlert).toBe(true);
    expect(healthy).toBe(false);
    expect(metrics.records.some((r) => r.name === SEALER_METRIC_NAMES.backlogDepth)).toBe(true);
    expect(metrics.records.some((r) => r.name === SEALER_METRIC_NAMES.oldestPendingAgeSeconds)).toBe(true);
    expect(await lastSealedSeq(chainId)).toBe('3');
  });
});

describe('S8 — RLS/tenant isolation', () => {
  it('a runner scoped to org B cannot claim/seal org A captures', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const chainA = newChain(orgA.org_id);
    const { captureId } = await seedCapture(orgA.org_id, chainA);

    // sealOnce with org B's context against org A's chain → RLS hides the row →
    // claim finds nothing → idle. Org A's capture is untouched.
    const result = await sealOnce(runnerPool, kms, { orgId: orgB.org_id, chainId: chainA, workerId: 'sealer-test' });
    expect(result.status).toBe('idle');
    expect(await fetchStatus(orgA.org_id, captureId)).toBe('captured');

    // A scan for org B (which has no work) leaves org A untouched too.
    const summary = await runScanTick({
      pool: runnerPool,
      kms,
      config: baseConfig(),
      metrics: createRecordingSealerMetrics(),
      logger,
      listOrgs: async () => [orgB.org_id],
      sleep: async () => undefined,
      rand: () => 0,
    });
    expect(summary.sealed).toBe(0);
    expect(await fetchStatus(orgA.org_id, captureId)).toBe('captured');
  });
});

describe('S9 — graceful shutdown drain', () => {
  it('in-flight seals complete; no row left stuck in sealing after a clean stop', async () => {
    const org = await seedOrg(stack);
    const chainId = newChain(org.org_id);
    const { captureId } = await seedCapture(org.org_id, chainId);

    const handle = startClaimLoop({
      pool: runnerPool,
      kms,
      config: baseConfig(),
      metrics: createRecordingSealerMetrics(),
      logger,
      listOrgs: async () => [org.org_id],
      rand: () => 0,
    });

    // Poll until the seed is sealed (deterministic; avoids a timing race), then stop.
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if ((await fetchStatus(org.org_id, captureId)) === 'sealed') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await handle.stop();

    expect(await fetchStatus(org.org_id, captureId)).toBe('sealed');
    // No row from this org is left stuck in `sealing` after a clean shutdown.
    const stuck = await withAdmin(org.org_id, async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM govai.audit_capture_outbox WHERE org_id = $1::uuid AND status = 'sealing'`,
        [org.org_id],
      );
      return Number(r.rows[0]!.n);
    });
    expect(stuck).toBe(0);
  });
});

describe('S10 — readiness semantics (sealer-scoped, provider unaffected)', () => {
  it('readiness reflects the startup probe but never implies provider endpoints down', async () => {
    const ok = await validateStartup(runnerPool);
    const healthOk = new HealthState();
    healthOk.setStartup(ok);
    healthOk.setDiscoveryProbed(true); // Fix 2: readiness is not ready until the first discovery probe resolves
    const rOk = healthOk.readiness();
    expect(rOk.ready).toBe(true);
    expect(rOk.scope).toBe('audit-sealer');
    expect(rOk.provider_native_unaffected).toBe(true);

    const sig = 'govai.audit_capture_mark_sealed(uuid, uuid, uuid, bigint)';
    await withAdmin(null, async (c) => {
      await c.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM govai_audit_sealer`);
    });
    try {
      const bad = await validateStartup(runnerPool);
      const healthBad = new HealthState();
      healthBad.setStartup(bad);
      const rBad = healthBad.readiness();
      expect(rBad.ready).toBe(false); // fails for the sealer
      expect(rBad.provider_native_unaffected).toBe(true); // but NOT a provider-down signal
      expect(rBad.reason).toBe('startup_probe_failed');
    } finally {
      await withAdmin(null, async (c) => {
        await c.query(`GRANT EXECUTE ON FUNCTION ${sig} TO govai_audit_sealer`);
      });
    }
  });
});

describe('S11 — NO provider traffic / NO apps/api loop (static source assertion + GATE A grep)', () => {
  const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
  const read = (rel: string): string => readFileSync(`${repoRoot}${rel}`, 'utf8');

  it('the runner package has no provider SDK / fastify dependency', () => {
    const pkg = JSON.parse(read('apps/audit-sealer/package.json')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of Object.keys(all)) {
      expect(name).not.toMatch(/provider-(anthropic|openai)/);
      expect(name).not.toMatch(/fastify/);
      expect(name).not.toMatch(/dlp-br/);
    }
  });

  it('GATE A: stale-recovery does NOT use sealNextAuditCapture/claimAuditCaptureForSeal, DOES use loadSealingCaptureForRecovery, has NO ClaimedAuditCapture literal', () => {
    const src = read('apps/audit-sealer/src/stale-recovery.ts');
    expect(src).not.toMatch(/sealNextAuditCapture/);
    expect(src).not.toMatch(/claimAuditCaptureForSeal/);
    expect(src).toMatch(/loadSealingCaptureForRecovery/);
    expect(src).not.toMatch(/ClaimedAuditCapture\s*=\s*\{/);
  });

  it('apps/api contains no sealing loop (no sealNextAuditCapture / claim-loop usage)', () => {
    const grepNo = (rel: string): void => {
      const src = read(rel);
      expect(src).not.toMatch(/sealNextAuditCapture/);
      expect(src).not.toMatch(/startClaimLoop|runScanTick/);
    };
    grepNo('apps/api/src/server.ts');
    grepNo('apps/api/src/pipeline/audit-bridge.ts');
  });
});

describe('EP-006 rev2 FIX 2 — backlog health is the TICK AGGREGATE (P2)', () => {
  it('A-critical + B-healthy in one tick → onBacklogAlert fired ONCE with healthy=false', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    const chainA = newChain(orgA.org_id);
    for (let i = 0; i < 3; i += 1) await seedCapture(orgA.org_id, chainA); // A: 3 pending
    // B: no captures → healthy.
    const calls: boolean[] = [];
    const config = baseConfig({ AUDIT_SEALER_BACKLOG_PENDING_COUNT: '1' }); // A (3) > 1 → critical
    await runScanTick({
      pool: runnerPool,
      kms,
      config,
      metrics: createRecordingSealerMetrics(),
      logger,
      listOrgs: async () => [orgA.org_id, orgB.org_id], // A critical first, B healthy AFTER
      sleep: async () => undefined,
      rand: () => 0,
      onBacklogAlert: (h) => calls.push(h),
    });
    // ONCE, healthy=false — B (healthy, scanned later) did NOT overwrite A's critical.
    expect(calls).toEqual([false]);
  });

  it('all-healthy tick → onBacklogAlert fired ONCE with healthy=true', async () => {
    const orgA = await seedOrg(stack);
    const calls: boolean[] = [];
    await runScanTick({
      pool: runnerPool,
      kms,
      config: baseConfig(),
      metrics: createRecordingSealerMetrics(),
      logger,
      listOrgs: async () => [orgA.org_id],
      sleep: async () => undefined,
      rand: () => 0,
      onBacklogAlert: (h) => calls.push(h),
    });
    expect(calls).toEqual([true]);
  });
});

describe('EP-006 rev2 FIX 1 — a failed startup probe is OBSERVABLE not-ready (P1)', () => {
  it('runner.start() returns not-ready AND the health file reads ready:false (not a silent idle)', async () => {
    const healthPath = join(tmpdir(), `sealer-health-${randomUUID()}.json`);
    const sig = 'govai.audit_capture_claim_for_seal(uuid, text, bigint)';
    await withAdmin(null, async (c) => {
      await c.query(`REVOKE EXECUTE ON FUNCTION ${sig} FROM govai_audit_sealer`);
    });
    const runner = createRunner({
      config: baseConfig({ AUDIT_SEALER_HEALTH_FILE: healthPath }),
      kms,
      pool: runnerPool,
      logger,
      metrics: createRecordingSealerMetrics(),
      listOrgs: async () => [],
    });
    try {
      const result = await runner.start();
      expect(result.started).toBe(false);
      expect(result.ready).toBe(false);
      // the EXPOSED surface (the health file), not just the in-memory readiness().
      const surface = JSON.parse(readFileSync(healthPath, 'utf8')) as {
        readiness: { ready: boolean; reason?: string; provider_native_unaffected: boolean };
      };
      expect(surface.readiness.ready).toBe(false);
      expect(surface.readiness.reason).toBe('startup_probe_failed');
      expect(surface.readiness.provider_native_unaffected).toBe(true); // not a provider-down signal
    } finally {
      await runner.stop();
      await withAdmin(null, async (c) => {
        await c.query(`GRANT EXECUTE ON FUNCTION ${sig} TO govai_audit_sealer`);
      });
      try {
        rmSync(healthPath);
      } catch {
        /* ignore */
      }
    }
  });
});
