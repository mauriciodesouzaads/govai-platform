import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';

import {
  aggregateOperatorView,
  createEvidenceGaugeSource,
  enumerateAllOrgs,
  type OrgEvidence,
} from './evidence-operator.js';
import type { EvidenceSummary, ReportScope } from './evidence-reports.js';

function summaryWith(overrides: {
  coverage: number;
  ec1_total?: number;
  ec1_failed?: number;
  ec4_without_terminal?: number;
}): EvidenceSummary {
  return {
    window_seconds: 86_400,
    t_seal_seconds: 0,
    counts: {
      ec1: {
        total: overrides.ec1_total ?? 0,
        sealed: 0,
        failed: overrides.ec1_failed ?? 0,
        stalled_past_slo: 0,
      },
      ec2: { chains: 0, chains_with_gap: 0 },
      ec3seal: { native_total: 0, native_sealed: 0, native_unsealed_past_slo: 0 },
      ec4: { provider_invocations: 0, without_terminal: overrides.ec4_without_terminal ?? 0 },
      ec6: { chains: 0, verified_ok: 0, pending: 0 },
    },
    ec3drop: {
      invariant: 'ec3drop',
      label: 'EC-3 — native (drop)',
      drops: 0,
      captures: 0,
      drop_rate: null,
      observed: false,
      bound: 'native capture loss in aggregate',
    },
    ec6: {
      invariant: 'ec6',
      label: 'EC-6 — chain integrity',
      total_chains: 0,
      verified_ok: 0,
      pending: 0,
      last_verified_at: null,
      note: 'pending',
    },
    coverage_ratio: {
      label: 'coverage_ratio',
      ratio: overrides.coverage,
      covered: 0,
      total: 0,
      terms: [],
      excluded: [],
    },
  };
}

describe('aggregateOperatorView — cross-org fold (aggregate columns only)', () => {
  const perOrg: OrgEvidence[] = [
    { org_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', summary: summaryWith({ coverage: 0.4, ec1_failed: 2, ec4_without_terminal: 1 }) },
    { org_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', summary: summaryWith({ coverage: 0.9, ec1_failed: 0, ec4_without_terminal: 3 }) },
  ];

  it('returns one aggregate row per org and folds the totals', () => {
    const view = aggregateOperatorView(perOrg);
    expect(view.orgs.map((o) => o.org_id)).toEqual([
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
    expect(view.totals.org_count).toBe(2);
    expect(view.totals.coverage_ratio_min).toBeCloseTo(0.4, 10);
    expect(view.totals.ec1_failed).toBe(2);
    expect(view.totals.ec4_without_terminal).toBe(4);
  });

  it('exposes ONLY aggregate columns — no payload or capture/run identifier', () => {
    const view = aggregateOperatorView(perOrg);
    const FORBIDDEN = [
      'payload_hash',
      'payload_encrypted',
      'canonical_bytes',
      'redaction_metadata',
      'capture_id',
      'run_id',
      'provider_invocation_id',
    ];
    for (const row of view.orgs) {
      for (const k of FORBIDDEN) expect(row).not.toHaveProperty(k);
      // every value on an operator row is a string org_id or a number aggregate.
      for (const [key, val] of Object.entries(row)) {
        expect(key === 'org_id' ? typeof val === 'string' : typeof val === 'number').toBe(true);
      }
    }
  });

  it('reports null coverage floor for an empty org set', () => {
    expect(aggregateOperatorView([]).totals.coverage_ratio_min).toBeNull();
  });
});

const SCOPE: ReportScope = { windowSeconds: 86_400, tSealSeconds: 0 };

describe('enumerateAllOrgs — Pool→PoolClient wrapper (EP-EVIDENCE-GAUGE-WIRING U1)', () => {
  it('connects, lists via listOrgIds, and releases the client', async () => {
    const client = {
      query: vi.fn(async () => ({ rows: [{ id: 'org-1' }, { id: 'org-2' }] })),
      release: vi.fn(),
    };
    const connect = vi.fn(async () => client);
    const ids = await enumerateAllOrgs({ connect } as unknown as Pool);
    expect(ids).toEqual(['org-1', 'org-2']);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('releases the client even when the query throws (release-on-throw)', async () => {
    const client = {
      query: vi.fn(async () => {
        throw new Error('boom');
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
    await expect(enumerateAllOrgs(pool)).rejects.toThrow('boom');
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});

describe('createEvidenceGaugeSource — two-pool routing (EP-EVIDENCE-GAUGE-WIRING U2/I6)', () => {
  it('U2 — enumeration uses enumeratePool while reads use pool (INV-1 code half)', async () => {
    let enumReceived: unknown = null;
    const enumerate = vi.fn(async (p: Pool) => {
      enumReceived = p;
      return ['org-1'];
    });
    const enumeratePool = { id: 'ENUM' } as unknown as Pool;
    // A read pool whose connect() throws a marker — reaching it proves reads used `pool`.
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('READ_POOL_CONNECTED');
      }),
    } as unknown as Pool;

    const source = createEvidenceGaugeSource({ pool, scope: SCOPE, enumerate, enumeratePool });
    await expect(source()).rejects.toThrow('READ_POOL_CONNECTED'); // reads connected `pool`
    expect(enumReceived).toBe(enumeratePool); // enumeration used enumeratePool
  });

  it('U2 — without enumeratePool, enumeration falls back to pool (backward-compatible)', async () => {
    let enumReceived: unknown = null;
    const enumerate = vi.fn(async (p: Pool) => {
      enumReceived = p;
      return []; // [] ⇒ no read path is taken
    });
    const pool = { id: 'READ' } as unknown as Pool;
    const source = createEvidenceGaugeSource({ pool, scope: SCOPE, enumerate });
    const points = await source();
    expect(enumReceived).toBe(pool);
    expect(points).toEqual([]);
  });

  it('I6 — zero orgs ⇒ empty points, no throw', async () => {
    const source = createEvidenceGaugeSource({
      pool: {} as unknown as Pool,
      scope: SCOPE,
      enumerate: async () => [],
    });
    await expect(source()).resolves.toEqual([]);
  });
});
