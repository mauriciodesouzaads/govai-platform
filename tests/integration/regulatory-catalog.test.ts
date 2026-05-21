// Regulatory Core PR-R1 (issue #59, umbrella #33) — catalog happy-path,
// constraints, validation, and audit emission.
//
// Exercises the native source registry + control catalog end-to-end through the
// HTTP surface, asserts DB constraints reject invalid data, and verifies every
// mutation emits a real audit event onto the `policy` chain without leaking
// secrets or storing encrypted payloads.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  startStack,
  stopStack,
  seedOrg,
  addApiKey,
  inject,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

type AdminOrg = { org_id: string; user_id: string; api_key: string };

async function adminOrg(): Promise<AdminOrg> {
  const org = await seedOrg(stack);
  const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
  return { org_id: org.org_id, user_id: org.user_id, api_key: admin.api_key };
}

async function asOrg<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

const baseSource = (overrides: Record<string, unknown> = {}) => ({
  source_key: `BR-TEST-${randomUUID().slice(0, 8).toUpperCase()}`,
  title: 'Lei Geral de Proteção de Dados (test fixture)',
  jurisdiction: 'BR',
  authority: 'Congresso Nacional',
  instrument_type: 'lei',
  source_quality: 'PRIMARY_REGULATORY_SOURCE',
  verification_status: 'CONFIRMED_PRIMARY_SOURCE',
  legal_status: 'ACTIVE',
  official_url: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm',
  publication_date: '2018-08-14',
  effective_date: '2020-09-18',
  review_frequency: 'QUARTERLY',
  ...overrides,
});

const baseControl = (overrides: Record<string, unknown> = {}) => ({
  control_key: `GOVAI-TEST-${randomUUID().slice(0, 8).toUpperCase()}`,
  domain: 'governance_and_accountability',
  name: 'Test control',
  description: 'A tenant control catalog entry for tests.',
  capability_type: 'REQUIRED_NATIVE_CAPABILITY',
  implementation_state: 'TARGET_CAPABILITY_REQUIRED',
  build_decision: 'BUILD_NATIVE_CORE',
  automation_level: 'MANUAL',
  review_frequency: 'AD_HOC',
  evidence_required: ['migration', 'tests'],
  ...overrides,
});

function bodyOf(r: { body: unknown }): Record<string, unknown> {
  return r.body as Record<string, unknown>;
}

describe('regulatory-catalog / happy path', () => {
  it('creates source → versions → relationship → control → link → mapping', async () => {
    const org = await adminOrg();

    // Source
    const srcRes = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource());
    expect(srcRes.statusCode).toBe(201);
    const source = bodyOf(srcRes)['source'] as Record<string, unknown>;
    expect(source['scope']).toBe('tenant');
    expect(source['org_id']).toBe(org.org_id);
    const sourceId = source['id'] as string;

    // Versions (monotonic numbering)
    const v1 = await inject(stack, 'POST', `/v1/regulatory/sources/${sourceId}/versions`, org.api_key, {
      change_type: 'CLARIFICATION',
      verification_status: 'CONFIRMED_PRIMARY_SOURCE',
      content_hash: 'sha256:abc',
      summary: 'first recorded version',
    });
    expect(v1.statusCode).toBe(201);
    expect((bodyOf(v1)['version'] as Record<string, unknown>)['version_number']).toBe(1);
    const v2 = await inject(stack, 'POST', `/v1/regulatory/sources/${sourceId}/versions`, org.api_key, {
      change_type: 'EXPANSION',
      verification_status: 'PARTIAL_PRIMARY_SOURCE',
    });
    expect(v2.statusCode).toBe(201);
    expect((bodyOf(v2)['version'] as Record<string, unknown>)['version_number']).toBe(2);

    const listV = await inject(stack, 'GET', `/v1/regulatory/sources/${sourceId}/versions`, org.api_key);
    expect(listV.statusCode).toBe(200);
    expect((bodyOf(listV)['versions'] as unknown[]).length).toBe(2);

    // Relationship to a second source
    const src2Res = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource());
    const source2Id = (bodyOf(src2Res)['source'] as Record<string, unknown>)['id'] as string;
    const rel = await inject(
      stack,
      'POST',
      `/v1/regulatory/sources/${sourceId}/relationships`,
      org.api_key,
      { to_source_id: source2Id, relationship_type: 'CITES', notes: 'cites companion norm' },
    );
    expect(rel.statusCode).toBe(201);

    // Control
    const ctrlRes = await inject(stack, 'POST', '/v1/regulatory/controls', org.api_key, baseControl());
    expect(ctrlRes.statusCode).toBe(201);
    const control = bodyOf(ctrlRes)['control'] as Record<string, unknown>;
    expect(control['scope']).toBe('tenant');
    const controlId = control['id'] as string;

    // Link control → source
    const link = await inject(
      stack,
      'POST',
      `/v1/regulatory/controls/${controlId}/source-links`,
      org.api_key,
      { source_id: sourceId, link_type: 'LEGAL_DRIVER', requirement_ref: 'art. 6' },
    );
    expect(link.statusCode).toBe(201);

    // Map control → framework
    const map = await inject(
      stack,
      'POST',
      `/v1/regulatory/controls/${controlId}/framework-mappings`,
      org.api_key,
      { framework_key: 'LGPD', requirement_ref: 'art. 6', mapping_status: 'PARTIAL', source_id: sourceId },
    );
    expect(map.statusCode).toBe(201);
    const listM = await inject(
      stack,
      'GET',
      `/v1/regulatory/controls/${controlId}/framework-mappings`,
      org.api_key,
    );
    expect((bodyOf(listM)['framework_mappings'] as unknown[]).length).toBe(1);

    // Updates
    const patchSrc = await inject(stack, 'PATCH', `/v1/regulatory/sources/${sourceId}`, org.api_key, {
      legal_status: 'AMENDED',
      notes: 'amended by a later instrument',
    });
    expect(patchSrc.statusCode).toBe(200);
    expect((bodyOf(patchSrc)['source'] as Record<string, unknown>)['legal_status']).toBe('AMENDED');

    const patchCtrl = await inject(stack, 'PATCH', `/v1/regulatory/controls/${controlId}`, org.api_key, {
      implementation_state: 'IMPLEMENTED_FOUNDATIONAL_CONTROL',
    });
    expect(patchCtrl.statusCode).toBe(200);

    // Audit: one event per mutation, all on the policy chain, no encrypted payloads.
    const events = await asOrg(org.org_id, (c) =>
      c.query<{ event_type: string; chain_id: string; payload_ref: string | null; subject_type: string }>(
        `SELECT event_type, chain_id, payload_ref, subject_type
           FROM govai.audit_events
          WHERE org_id = $1::uuid AND event_type LIKE 'regulatory_%'
          ORDER BY sequence_number ASC`,
        [org.org_id],
      ),
    );
    const types = events.rows.map((r) => r.event_type);
    expect(types).toContain('regulatory_source.created');
    expect(types).toContain('regulatory_source.version_created');
    expect(types).toContain('regulatory_source.relationship_created');
    expect(types).toContain('regulatory_source.updated');
    expect(types).toContain('regulatory_control.created');
    expect(types).toContain('regulatory_control.source_link_created');
    expect(types).toContain('regulatory_control.framework_mapping_created');
    expect(types).toContain('regulatory_control.updated');
    for (const row of events.rows) {
      expect(row.chain_id.endsWith(':policy')).toBe(true);
      // Governance metadata mutations are not encrypted payloads.
      expect(row.payload_ref).toBeNull();
    }
  });

  it('audit redaction_metadata carries safe metadata only (no secret markers)', async () => {
    const org = await adminOrg();
    const srcRes = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource());
    const sourceId = (bodyOf(srcRes)['source'] as Record<string, unknown>)['id'] as string;
    const meta = await asOrg(org.org_id, (c) =>
      c.query<{ redaction_metadata: Record<string, unknown> }>(
        `SELECT redaction_metadata FROM govai.audit_events
          WHERE org_id = $1::uuid AND subject_id = $2::uuid AND event_type = 'regulatory_source.created'`,
        [org.org_id, sourceId],
      ),
    );
    const text = JSON.stringify(meta.rows[0]!.redaction_metadata);
    expect(text).toContain('regulatory_source.created');
    expect(text).toContain('source_key');
    expect(text).not.toContain('PRIVATE KEY');
    expect(text).not.toContain('sk-ant-');
  });
});

describe('regulatory-catalog / constraints', () => {
  it('rejects duplicate tenant source_key (409)', async () => {
    const org = await adminOrg();
    const body = baseSource();
    const first = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, body);
    expect(first.statusCode).toBe(201);
    const dup = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, body);
    expect(dup.statusCode).toBe(409);
    expect(bodyOf(dup)['error']).toBe('source_key_conflict');
  });

  it('rejects self-relationship (400) and duplicate relationship (409)', async () => {
    const org = await adminOrg();
    const a = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource());
    const b = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource());
    const aId = (bodyOf(a)['source'] as Record<string, unknown>)['id'] as string;
    const bId = (bodyOf(b)['source'] as Record<string, unknown>)['id'] as string;

    const self = await inject(stack, 'POST', `/v1/regulatory/sources/${aId}/relationships`, org.api_key, {
      to_source_id: aId,
      relationship_type: 'RELATED',
    });
    expect(self.statusCode).toBe(400);
    expect(bodyOf(self)['error']).toBe('self_relationship_forbidden');

    const first = await inject(stack, 'POST', `/v1/regulatory/sources/${aId}/relationships`, org.api_key, {
      to_source_id: bId,
      relationship_type: 'AMENDS',
    });
    expect(first.statusCode).toBe(201);
    const dup = await inject(stack, 'POST', `/v1/regulatory/sources/${aId}/relationships`, org.api_key, {
      to_source_id: bId,
      relationship_type: 'AMENDS',
    });
    expect(dup.statusCode).toBe(409);
  });

  it('rejects duplicate source link and duplicate framework mapping (409)', async () => {
    const org = await adminOrg();
    const src = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource());
    const ctrl = await inject(stack, 'POST', '/v1/regulatory/controls', org.api_key, baseControl());
    const sourceId = (bodyOf(src)['source'] as Record<string, unknown>)['id'] as string;
    const controlId = (bodyOf(ctrl)['control'] as Record<string, unknown>)['id'] as string;

    const link1 = await inject(stack, 'POST', `/v1/regulatory/controls/${controlId}/source-links`, org.api_key, {
      source_id: sourceId,
      link_type: 'LEGAL_DRIVER',
    });
    expect(link1.statusCode).toBe(201);
    const link2 = await inject(stack, 'POST', `/v1/regulatory/controls/${controlId}/source-links`, org.api_key, {
      source_id: sourceId,
      link_type: 'LEGAL_DRIVER',
    });
    expect(link2.statusCode).toBe(409);

    const map1 = await inject(stack, 'POST', `/v1/regulatory/controls/${controlId}/framework-mappings`, org.api_key, {
      framework_key: 'LGPD',
      mapping_status: 'PARTIAL',
    });
    expect(map1.statusCode).toBe(201);
    const map2 = await inject(stack, 'POST', `/v1/regulatory/controls/${controlId}/framework-mappings`, org.api_key, {
      framework_key: 'LGPD',
      mapping_status: 'GAP',
    });
    expect(map2.statusCode).toBe(409);
  });

  it('DB CHECK rejects an invalid enum on direct insert', async () => {
    const org = await adminOrg();
    let blocked = false;
    try {
      await asOrg(org.org_id, (c) =>
        c.query(
          `INSERT INTO govai.regulatory_sources
             (org_id, scope, source_key, title, source_quality, verification_status, legal_status)
           VALUES ($1::uuid, 'tenant', 'BR-BAD-1', 't', 'NOT_A_QUALITY', 'CONFIRMED_PRIMARY_SOURCE', 'ACTIVE')`,
          [org.org_id],
        ),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });

  it('DB CHECK rejects scope/org_id inconsistency on direct insert', async () => {
    const org = await adminOrg();
    let blocked = false;
    try {
      await asOrg(org.org_id, (c) =>
        c.query(
          `INSERT INTO govai.regulatory_sources
             (org_id, scope, source_key, title, source_quality, verification_status, legal_status)
           VALUES ($1::uuid, 'system', 'BR-BAD-2', 't', 'PRIMARY_OFFICIAL_SOURCE', 'CONFIRMED_PRIMARY_SOURCE', 'ACTIVE')`,
          [org.org_id],
        ),
      );
    } catch {
      blocked = true;
    }
    expect(blocked).toBe(true);
  });
});

describe('regulatory-catalog / validation', () => {
  it('rejects a malformed source_key (400)', async () => {
    const org = await adminOrg();
    const r = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource({ source_key: 'lower case key' }));
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_request');
  });

  it('rejects effective_date before publication_date without notes, accepts with notes', async () => {
    const org = await adminOrg();
    const bad = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource({
      publication_date: '2020-01-01',
      effective_date: '2019-01-01',
    }));
    expect(bad.statusCode).toBe(400);
    expect(bodyOf(bad)['error']).toBe('effective_date_before_publication_date');

    const ok = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource({
      publication_date: '2020-01-01',
      effective_date: '2019-01-01',
      notes: 'retroactive effect explicitly provided by the instrument',
    }));
    expect(ok.statusCode).toBe(201);
  });

  it('rejects an invalid official_url (400)', async () => {
    const org = await adminOrg();
    const r = await inject(stack, 'POST', '/v1/regulatory/sources', org.api_key, baseSource({ official_url: 'not-a-url' }));
    expect(r.statusCode).toBe(400);
  });

  it('rejects an unknown framework_key (400)', async () => {
    const org = await adminOrg();
    const ctrl = await inject(stack, 'POST', '/v1/regulatory/controls', org.api_key, baseControl());
    const controlId = (bodyOf(ctrl)['control'] as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'POST', `/v1/regulatory/controls/${controlId}/framework-mappings`, org.api_key, {
      framework_key: 'NOT_A_FRAMEWORK',
      mapping_status: 'PARTIAL',
    });
    expect(r.statusCode).toBe(400);
  });
});
