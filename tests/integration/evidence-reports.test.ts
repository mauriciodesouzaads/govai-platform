// EP-008D-1 — Evidence-completeness reports + the /v1/evidence read API.
//
// Seeded-holes acceptance: each EC invariant FIRES on a deliberate hole, over
// the REAL grant/RLS model (no bypass — seeding via the SECURITY DEFINER capture
// path / writer policies, reads as govai_app under the per-org RLS pin). Covers:
//   EC-1 (stuck captured/sealing + failed list), EC-2 (capture_seq gap),
//   EC-3.seal (native unsealed past T_seal), EC-3.drop (simulated drops>0),
//   EC-4 (provider invocation w/o terminal run event — ★ under the EC-4 label,
//   NEVER EC-3), EC-6 (chains surfaced pending), coverage_ratio reflects holes,
//   and the read API (RLS-scoped, paginated, no payload bytes; enum sans ec5).
// EC-5 is deferred (no test) — see the EC-5 reconcile.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startStack, stopStack, seedOrg, type Stack } from './helpers/server-fixture.js';
import { createSeedHelpers, H32, type SeedHelpers } from './helpers/evidence-seed.js';
import {
  evidenceCounts,
  ec1FailedList,
  ec2Gaps,
  ec3SealList,
  ec4List,
  chainVerificationStatus,
  nativeDropEstimate,
  evidenceSummary,
  EC_LABELS,
  ZERO_DROP_SNAPSHOT,
  type ReportScope,
} from '../../apps/api/src/pipeline/evidence-reports.js';

let stack: Stack;
let seed: SeedHelpers;

const SCOPE: ReportScope = { windowSeconds: 86_400, tSealSeconds: 0 };

const PAYLOAD_KEYS = [
  'payload_hash',
  'payload_encrypted',
  'dek_wrapped',
  'canonical_bytes',
  'canonical_hash',
  'redaction_metadata',
];

function expectNoPayload(rows: unknown[]): void {
  for (const row of rows) {
    if (row && typeof row === 'object') {
      for (const k of PAYLOAD_KEYS) expect(row).not.toHaveProperty(k);
    }
  }
}

beforeAll(async () => {
  stack = await startStack();
  seed = createSeedHelpers(stack);
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

// =============================================================================
// Seeded-holes report tests (one fresh org per test → RLS-isolated)
// =============================================================================

describe('EC-1 — capture terminal-state', () => {
  it('fires on stuck (captured/sealing) and failed captures + a sanitized failed list', async () => {
    const org = await seedOrg(stack);
    await seed.seedCaptureInStatus(org.org_id, 'captured');
    await seed.seedCaptureInStatus(org.org_id, 'sealing');
    await seed.seedCaptureInStatus(org.org_id, 'failed');

    const counts = await seed.asRole('govai_app', org.org_id, (c) => evidenceCounts(c, SCOPE));
    expect(counts.ec1.total).toBe(3);
    expect(counts.ec1.failed).toBe(1);
    expect(counts.ec1.stalled_past_slo).toBe(2); // captured + sealing, past T_seal=0

    const failed = await seed.asRole('govai_app', org.org_id, (c) => ec1FailedList(c, SCOPE));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.last_error).toBeTruthy();
    expect(failed[0]!.attempts).toBeGreaterThanOrEqual(1);
    expectNoPayload(failed);
  });
});

describe('EC-2 — chain contiguity', () => {
  it('detects a per-chain capture_seq gap (chain_id, first_gap_seq, gap_count)', async () => {
    const org = await seedOrg(stack);
    const chain = `org:${org.org_id}:run:${randomUUID()}`;
    await seed.insertRawCapture(org.org_id, chain, 1);
    await seed.insertRawCapture(org.org_id, chain, 3); // gap at seq 2

    const gaps = await seed.asRole('govai_app', org.org_id, (c) => ec2Gaps(c, SCOPE));
    const g = gaps.find((x) => x.chain_id === chain);
    expect(g).toBeDefined();
    expect(g!.first_gap_seq).toBe(2);
    expect(g!.gap_count).toBe(1);

    const counts = await seed.asRole('govai_app', org.org_id, (c) => evidenceCounts(c, SCOPE));
    expect(counts.ec2.chains_with_gap).toBeGreaterThanOrEqual(1);
  });
});

describe('EC-3.seal — native captures unsealed', () => {
  it('fires on a native (chain_category=run) capture left unsealed past T_seal', async () => {
    const org = await seedOrg(stack);
    await seed.seedCaptureInStatus(org.org_id, 'captured'); // native, unsealed

    const counts = await seed.asRole('govai_app', org.org_id, (c) => evidenceCounts(c, SCOPE));
    expect(counts.ec3seal.native_total).toBeGreaterThanOrEqual(1);
    expect(counts.ec3seal.native_unsealed_past_slo).toBeGreaterThanOrEqual(1);

    const list = await seed.asRole('govai_app', org.org_id, (c) => ec3SealList(c, SCOPE));
    expect(list.some((r) => r.chain_category === 'run')).toBe(true);
  });
});

describe('EC-3.drop — native drop estimate (path-B proxy)', () => {
  it('computes a drop rate on a simulated snapshot and folds it into coverage_ratio', async () => {
    const org = await seedOrg(stack);
    const est = nativeDropEstimate({ drops: 4, captures: 6 });
    expect(est.drop_rate).toBeCloseTo(0.4, 10);

    const summary = await seed.asRole('govai_app', org.org_id, (c) =>
      evidenceSummary(c, SCOPE, { drops: 4, captures: 6 }),
    );
    expect(summary.ec3drop.observed).toBe(true);
    expect(summary.coverage_ratio.terms.map((t) => t.invariant)).toContain('ec3drop');
  });
});

describe('EC-4 — run-lifecycle / path-A (★ never under EC-3)', () => {
  it('surfaces a provider invocation with no terminal run event, labeled EC-4', async () => {
    const org = await seedOrg(stack);
    const gapRun = await seed.seedRunWithInvocation(org.org_id, { withAudit: false });
    const healthyRun = await seed.seedRunWithInvocation(org.org_id, { withAudit: true });

    const rows = await seed.asRole('govai_app', org.org_id, (c) => ec4List(c, SCOPE));
    expect(rows.map((r) => r.run_id)).toContain(gapRun);
    expect(rows.map((r) => r.run_id)).not.toContain(healthyRun);
    expectNoPayload(rows);

    // ★ The §2 label discipline: this detector is EC-4 (path-A), NEVER EC-3.
    expect(EC_LABELS.ec4.startsWith('EC-4')).toBe(true);
    expect(EC_LABELS.ec4).not.toContain('EC-3');
    // ...and the EC-3 (native capture) reports never carry provider-invocation rows.
    const ec3 = await seed.asRole('govai_app', org.org_id, (c) => ec3SealList(c, SCOPE));
    for (const r of ec3) expect(r).not.toHaveProperty('provider_invocation_id');
  });
});

describe('EC-6 — chain integrity (surface-only, status-via-summary)', () => {
  it('surfaces known chains as pending with a null last-verified marker (no persisted status)', async () => {
    const org = await seedOrg(stack);
    await seed.seedRunWithInvocation(org.org_id, { withAudit: true }); // creates an audit_events chain

    const ec6 = await seed.asRole('govai_app', org.org_id, (c) => chainVerificationStatus(c, SCOPE));
    expect(ec6.total_chains).toBeGreaterThanOrEqual(1);
    expect(ec6.verified_ok).toBe(0);
    expect(ec6.pending).toBe(ec6.total_chains);
    expect(ec6.last_verified_at).toBeNull();
    expect(ec6.note).toContain('pending');
  });
});

describe('coverage_ratio — reflects the seeded holes', () => {
  it('drops below 1.0 once unsealed/failed captures and an EC-4 gap are present', async () => {
    const org = await seedOrg(stack);
    // Healthy baseline.
    await seed.seedCaptureInStatus(org.org_id, 'sealed');
    await seed.seedRunWithInvocation(org.org_id, { withAudit: true });
    const before = await seed.asRole('govai_app', org.org_id, (c) =>
      evidenceSummary(c, SCOPE, ZERO_DROP_SNAPSHOT),
    );
    // Punch holes.
    await seed.seedCaptureInStatus(org.org_id, 'failed');
    await seed.seedRunWithInvocation(org.org_id, { withAudit: false });
    const after = await seed.asRole('govai_app', org.org_id, (c) =>
      evidenceSummary(c, SCOPE, ZERO_DROP_SNAPSHOT),
    );

    expect(after.coverage_ratio.ratio).toBeLessThan(1.0);
    expect(after.coverage_ratio.ratio).toBeLessThanOrEqual(before.coverage_ratio.ratio);
    // EC-6 is excluded from the ratio (pending ≠ uncovered); EC-3.drop excluded when unobserved.
    expect(after.coverage_ratio.excluded.map((e) => e.invariant)).toEqual(
      expect.arrayContaining(['ec6', 'ec3drop']),
    );
  });
});

// =============================================================================
// Read API — /v1/evidence/summary + /v1/evidence/gaps (RLS, pagination, safe)
// =============================================================================

describe('FIX-1 — past-SLO counts only rows ACTUALLY past T_seal', () => {
  it('1 old + N fresh unsealed in one (org, chain_category) → exactly 1 past-SLO', async () => {
    const org = await seedOrg(stack);
    const scope3600: ReportScope = { windowSeconds: 86_400, tSealSeconds: 3600 };
    // 1 OLD unsealed native capture (captured 2h ago → past T_seal=1h), inserted
    // directly with a backdated captured_at (the SECURITY DEFINER path stamps now()).
    const oldChain = `org:${org.org_id}:run:${randomUUID()}`;
    const oldCapture = randomUUID();
    await seed.asRole('govai_audit_writer', org.org_id, (c) =>
      c.query(
        `INSERT INTO govai.audit_capture_outbox
           (capture_id, org_id, chain_id, chain_category, capture_seq, event_type, event_version,
            subject_type, subject_id, occurred_at, payload_hash, key_id, key_version, status, captured_at)
         VALUES ($1::uuid, $2::uuid, $3::text, 'run', 1, 'passthrough.invoked', '4',
            'runtime_event', $4::uuid, now(), $5::bytea, 'audit-1', 1, 'captured', now() - make_interval(secs => 7200))`,
        [oldCapture, org.org_id, oldChain, randomUUID(), H32('00')],
      ),
    );
    // 3 FRESH unsealed native captures (captured now → NOT past T_seal).
    for (let i = 0; i < 3; i++) await seed.seedCaptureInStatus(org.org_id, 'captured');

    const counts = await seed.asRole('govai_app', org.org_id, (c) => evidenceCounts(c, scope3600));
    expect(counts.ec1.total).toBe(4); // 1 old + 3 fresh
    expect(counts.ec1.stalled_past_slo).toBe(1); // ★ exactly the 1 old — not 1+3
    expect(counts.ec3seal.native_total).toBe(4);
    expect(counts.ec3seal.native_unsealed_past_slo).toBe(1); // ★ exactly 1

    const list = await seed.asRole('govai_app', org.org_id, (c) => ec3SealList(c, scope3600));
    expect(list).toHaveLength(1); // ★ only the old row, not the fresh ones
    expect(list[0]!.capture_id).toBe(oldCapture);
  });
});

describe('read API — /v1/evidence/*', () => {
  it('summary is RLS-scoped to the caller, carries coverage_ratio, leaks no payload bytes', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await seed.seedRunWithInvocation(orgA.org_id, { withAudit: false }); // an EC-4 gap for A only
    await seed.seedCaptureInStatus(orgA.org_id, 'failed');

    const resA = await stack.app.inject({
      method: 'GET',
      url: '/v1/evidence/summary',
      headers: { 'x-govai-api-key': orgA.api_key },
    });
    expect(resA.statusCode).toBe(200);
    const bodyA = resA.json();
    expect(bodyA.org_id).toBe(orgA.org_id);
    expect(bodyA.coverage_ratio).toBeDefined();
    expect(bodyA.counts.ec4.without_terminal).toBeGreaterThanOrEqual(1);
    expect(bodyA.counts.ec1.failed).toBeGreaterThanOrEqual(1);
    // No payload bytes anywhere in the serialized response.
    for (const k of PAYLOAD_KEYS) expect(resA.payload).not.toContain(k);

    // RLS: org B sees only its own (empty) plane — none of A's gaps.
    const resB = await stack.app.inject({
      method: 'GET',
      url: '/v1/evidence/summary',
      headers: { 'x-govai-api-key': orgB.api_key },
    });
    expect(resB.statusCode).toBe(200);
    expect(resB.json().counts.ec4.without_terminal).toBe(0);
  });

  it('/gaps lists the caller gaps and paginates by cursor', async () => {
    const org = await seedOrg(stack);
    await seed.seedRunWithInvocation(org.org_id, { withAudit: false });
    await seed.seedRunWithInvocation(org.org_id, { withAudit: false });

    const page1 = await stack.app.inject({
      method: 'GET',
      url: '/v1/evidence/gaps?invariant=ec4&limit=1',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(page1.statusCode).toBe(200);
    const b1 = page1.json();
    expect(b1.invariant).toBe('ec4');
    expect(b1.items).toHaveLength(1);
    expect(b1.next_cursor).toBe(1);

    const page2 = await stack.app.inject({
      method: 'GET',
      url: '/v1/evidence/gaps?invariant=ec4&limit=1&cursor=1',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().items).toHaveLength(1);
    for (const k of PAYLOAD_KEYS) expect(page2.payload).not.toContain(k);
  });

  it('treats ec3drop as a singleton — no spurious next_cursor, no pagination loop', async () => {
    const org = await seedOrg(stack);
    const p1 = await stack.app.inject({
      method: 'GET',
      url: '/v1/evidence/gaps?invariant=ec3drop&limit=1',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(p1.statusCode).toBe(200);
    const b1 = p1.json();
    expect(b1.invariant).toBe('ec3drop');
    expect(b1.items).toHaveLength(1); // the single aggregate estimate
    expect(b1.next_cursor).toBeNull(); // ★ no spurious cursor (FIX-2)
    // A follow-up with any cursor must NOT re-loop: empty page, null cursor.
    const p2 = await stack.app.inject({
      method: 'GET',
      url: '/v1/evidence/gaps?invariant=ec3drop&limit=1&cursor=1',
      headers: { 'x-govai-api-key': org.api_key },
    });
    expect(p2.statusCode).toBe(200);
    expect(p2.json().items).toHaveLength(0);
    expect(p2.json().next_cursor).toBeNull();
  });

  it('rejects the deferred ec5 and the summary-only ec6 from the /gaps enum', async () => {
    const org = await seedOrg(stack);
    for (const inv of ['ec5', 'ec6']) {
      const res = await stack.app.inject({
        method: 'GET',
        url: `/v1/evidence/gaps?invariant=${inv}`,
        headers: { 'x-govai-api-key': org.api_key },
      });
      expect(res.statusCode).toBe(400);
    }
  });

  it('requires authentication', async () => {
    const res = await stack.app.inject({ method: 'GET', url: '/v1/evidence/summary' });
    expect(res.statusCode).toBe(401);
  });
});
