import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

import { canonicalize, sha256, ALL_BANNED_REDACTION_KEYS } from '@govai/core-audit';
import { projectCapturePayloadV1 } from '@govai/core-events';
import type { PassthroughInvoked } from '@govai/core-events';

import {
  makeAuditBridge,
  auditBridgeCaptureId,
  AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID,
} from './audit-bridge.js';
import { AUDIT_CHAIN_KEY } from './audit-keys.js';
import type { AuditBridgeRequestIdentity } from './request-identity.js';

// ---- capture.ts param indices (SELECT ... audit_capture_insert_locked($1..$20)) ----
const P_CAPTURE_ID = 0;
const P_SUBJECT_ID = 8;
const P_OCCURRED_AT = 9;
const P_PAYLOAD_HASH = 10;
const P_KEY_ID = 13;
const P_KEY_VERSION = 14;
const P_REDACTION = 15;
const P_POSTURE = 19;

type RecordedCall = { sql: string; values: unknown[] };

function makeStack(opts?: { insertError?: unknown }) {
  const calls: RecordedCall[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values: values ?? [] });
    if (sql.includes('audit_capture_insert_locked')) {
      if (opts?.insertError !== undefined) throw opts.insertError;
      const captureId = (values ?? [])[P_CAPTURE_ID];
      return { rows: [{ capture_id: captureId, capture_seq: '1' }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  const release = vi.fn();
  const client = { query, release } as unknown as PoolClient;
  const connect = vi.fn(async () => client);
  const pool = { connect } as unknown as Pool;
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  } as unknown as FastifyBaseLogger;
  const insert = () => calls.find((c) => c.sql.includes('audit_capture_insert_locked'));
  const sql = (needle: string) => calls.filter((c) => c.sql.includes(needle));
  return { pool, connect, query, release, log, calls, insert, sql };
}

function baseEnvelope(): PassthroughInvoked {
  return {
    event_type: 'passthrough.invoked',
    schema_version: 4,
    tenant_context: {
      org_id: '11111111-1111-4111-8111-111111111111',
      tier: 'business',
      operational_mode: 'production',
    },
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
    capability_level: 'passthrough_audited',
    capability_canonical_level: 'policy_governed',
    native_endpoint: '/passthrough/anthropic/v1/messages',
    native_method: 'POST',
    is_stream: false,
    is_multipart: false,
    base_risk_class: 'B',
    effective_risk_class: 'B',
    risk_escalation_reasons: [],
    enforcement_decision: 'observe',
    native_request_hash: 'a'.repeat(64),
    native_response_hash: 'b'.repeat(64),
    latency_ms: 42,
    status_code: 200,
    occurred_at: '2026-06-15T00:00:00.000Z',
    credential_source: 'tenant_db',
    allowlist_version: 'v1',
    provider_request_id: 'req_baseline',
    body_forward_mode: 'raw',
    dlp_decisions: [],
    beta_allowlist_sources: [],
    detected_tool_classifications: [],
    audit_event_id: '99999999-9999-4999-8999-999999999999',
    chain_category: 'run',
  };
}

const REQ_IDENTITY: AuditBridgeRequestIdentity = {
  govaiRequestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  identityScope: 'govai_request_id',
};

function expectedHashHex(env: PassthroughInvoked): string {
  return Buffer.from(sha256(Buffer.from(canonicalize(projectCapturePayloadV1(env)), 'utf8'))).toString(
    'hex',
  );
}

async function run(
  event: unknown,
  identity?: AuditBridgeRequestIdentity,
  opts?: { insertError?: unknown },
) {
  const s = makeStack(opts);
  const bridge = makeAuditBridge({ pool: s.pool, log: s.log });
  await bridge(event, identity);
  return s;
}

describe('audit-bridge: AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID + captureId vectors (U2)', () => {
  it('pins the implementation namespace literal', () => {
    expect(AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID).toBe('2ce65cb8-4e28-42e2-b7cd-0be36d6e6f7b');
  });

  // Expected values precomputed by an INDEPENDENT reference (Python uuid.uuid5)
  // against the pinned namespace — never by calling makeAuditBridge (RR-000 A3).
  const FS1 = {
    orgId: '11111111-1111-1111-1111-111111111111',
    provider: 'anthropic',
    capabilityId: 'anthropic.messages.create',
    nativeMethod: 'POST',
    nativeEndpoint: '/passthrough/anthropic/v1/messages',
  };
  const FS2 = {
    orgId: '22222222-2222-2222-2222-222222222222',
    provider: 'openai',
    capabilityId: 'openai.responses.create',
    nativeMethod: 'POST',
    nativeEndpoint: '/passthrough/openai/v1/responses',
  };
  const FS3 = {
    orgId: '33333333-3333-3333-3333-333333333333',
    provider: 'anthropic',
    capabilityId: 'anthropic.messages.create',
    nativeMethod: 'POST',
    nativeEndpoint: '/governed/anthropic/v1/messages',
  };
  const clientId = (hash: string): AuditBridgeRequestIdentity => ({
    govaiRequestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    identityScope: 'client_idempotency_key',
    idempotencyKeyHash: hash,
  });
  const reqId = (govaiRequestId: string): AuditBridgeRequestIdentity => ({
    govaiRequestId,
    identityScope: 'govai_request_id',
  });

  const VECTORS: ReadonlyArray<{
    identity: AuditBridgeRequestIdentity;
    fields: typeof FS1;
    expected: string;
  }> = [
    { identity: clientId('0'.repeat(64)), fields: FS1, expected: '581882d0-ab1b-5623-b841-891b3005d929' },
    { identity: reqId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), fields: FS1, expected: '308da174-0eb9-51d7-8e7a-0ee03651aae6' },
    { identity: clientId('f'.repeat(64)), fields: FS2, expected: '6bddb7a9-f010-5b23-bc14-223ec87d45de' },
    { identity: reqId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), fields: FS2, expected: '594c5ed2-cb79-5eee-965d-b9a26fa7060a' },
    { identity: clientId('1'.repeat(64)), fields: FS3, expected: '698ae3f5-d833-56f5-bd1e-35def4b9d82c' },
    { identity: reqId('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), fields: FS3, expected: '7f50f320-7621-5a50-abee-01c73a627a19' },
  ];

  it('reproduces all 6 namespace-pinned captureId vectors (both scopes)', () => {
    for (const v of VECTORS) {
      expect(auditBridgeCaptureId(v.identity, v.fields)).toBe(v.expected);
    }
  });

  it('client and request scopes for the same coordinates derive different captureIds', () => {
    expect(auditBridgeCaptureId(clientId('0'.repeat(64)), FS1)).not.toBe(
      auditBridgeCaptureId(reqId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), FS1),
    );
  });
});

describe('makeAuditBridge dispatch', () => {
  it('U4: inserts the keys from the single-source AUDIT_CHAIN_KEY constant', async () => {
    expect(Object.isFrozen(AUDIT_CHAIN_KEY)).toBe(true);
    const s = await run(baseEnvelope(), REQ_IDENTITY);
    const ins = s.insert();
    expect(ins).toBeDefined();
    expect(ins!.values[P_KEY_ID]).toBe(AUDIT_CHAIN_KEY.keyId);
    expect(ins!.values[P_KEY_VERSION]).toBe(AUDIT_CHAIN_KEY.keyVersion);
    expect(ins!.values[P_KEY_ID]).toBe('audit-1');
    expect(ins!.values[P_KEY_VERSION]).toBe(1);
  });

  it('drives connect -> BEGIN -> set_config -> insert -> COMMIT and releases', async () => {
    const s = await run(baseEnvelope(), REQ_IDENTITY);
    expect(s.connect).toHaveBeenCalledTimes(1);
    expect(s.sql('BEGIN')).toHaveLength(1);
    expect(s.sql('set_config')).toHaveLength(1);
    expect(s.insert()).toBeDefined();
    expect(s.sql('COMMIT')).toHaveLength(1);
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it('maps the B1 envelope: captureId/subjectId/occurredAt/posture', async () => {
    const env = baseEnvelope();
    const captureId = auditBridgeCaptureId(REQ_IDENTITY, {
      orgId: env.tenant_context.org_id,
      provider: env.provider,
      capabilityId: env.capability_id,
      nativeMethod: env.native_method,
      nativeEndpoint: env.native_endpoint,
    });
    const s = await run(env, REQ_IDENTITY);
    const ins = s.insert()!;
    expect(ins.values[P_CAPTURE_ID]).toBe(captureId);
    // subjectId is now the deterministic captureId (the P1 fix, column #7), NOT
    // the per-attempt audit_event_id.
    expect(ins.values[P_SUBJECT_ID]).toBe(captureId);
    expect(ins.values[P_SUBJECT_ID]).not.toBe(env.audit_event_id);
    // occurredAt is read from the v4 envelope (column #8) and round-trips ISO-stably.
    expect(ins.values[P_OCCURRED_AT]).toBe(env.occurred_at);
    expect(ins.values[P_POSTURE]).toBe('best_effort');
  });

  // U1 (hash level): payloadHash = sha256(canonicalize(projection)); R1 wiring.
  it('U1/R1: payloadHash is deterministic; usage_json change alters it; excluded fields do not', async () => {
    const env = baseEnvelope();
    const hashA = (await run(env, REQ_IDENTITY)).insert()!.values[P_PAYLOAD_HASH] as Buffer;
    expect(hashA.toString('hex')).toBe(expectedHashHex(env));

    // determinism
    const hashA2 = (await run(baseEnvelope(), REQ_IDENTITY)).insert()!.values[P_PAYLOAD_HASH] as Buffer;
    expect(hashA2.toString('hex')).toBe(hashA.toString('hex'));

    // R1: a change to usage_json changes the hash (proves it is in the hash).
    const withUsage: PassthroughInvoked = { ...baseEnvelope(), usage_json: { input_tokens: 5 } };
    const withUsage2: PassthroughInvoked = { ...baseEnvelope(), usage_json: { input_tokens: 6 } };
    const hU = (await run(withUsage, REQ_IDENTITY)).insert()!.values[P_PAYLOAD_HASH] as Buffer;
    const hU2 = (await run(withUsage2, REQ_IDENTITY)).insert()!.values[P_PAYLOAD_HASH] as Buffer;
    expect(hU.toString('hex')).not.toBe(hU2.toString('hex'));

    // excluded per-attempt fields do not change the hash.
    const excludedOnly: PassthroughInvoked = {
      ...baseEnvelope(),
      latency_ms: 999999,
      provider_request_id: 'req_other',
      audit_event_id: '00000000-0000-4000-8000-000000000000',
    };
    const hExcl = (await run(excludedOnly, REQ_IDENTITY)).insert()!.values[P_PAYLOAD_HASH] as Buffer;
    expect(hExcl.toString('hex')).toBe(hashA.toString('hex'));
  });

  it('U3: an invalid runtime event is not inserted (warn, no throw, no connect)', async () => {
    const s = await run({ not: 'a passthrough event' }, REQ_IDENTITY);
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.insert()).toBeUndefined();
    expect(s.log.warn).toHaveBeenCalledTimes(1);
    expect(s.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'invalid_runtime_event' }),
      expect.any(String),
    );
  });

  it('U7: missing request identity skips capture (error, no throw, no connect)', async () => {
    const s = await run(baseEnvelope(), undefined);
    expect(s.connect).not.toHaveBeenCalled();
    expect(s.insert()).toBeUndefined();
    expect(s.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'missing_request_identity' }),
      expect.any(String),
    );
  });

  it('evidence_idempotency_conflict (SQLSTATE 23505) -> error log + ROLLBACK, never throws', async () => {
    const pgConflict = Object.assign(new Error('divergent immutable content'), { code: '23505' });
    const s = await run(baseEnvelope(), REQ_IDENTITY, { insertError: pgConflict });
    expect(s.sql('ROLLBACK')).toHaveLength(1);
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'evidence_idempotency_conflict' }),
      expect.any(String),
    );
  });

  it('generic capture failure -> warn (capture_failed) + ROLLBACK, never throws', async () => {
    const s = await run(baseEnvelope(), REQ_IDENTITY, { insertError: new Error('db down') });
    expect(s.sql('ROLLBACK')).toHaveLength(1);
    expect(s.log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'capture_failed' }),
      expect.any(String),
    );
  });

  // U6 (redactionMetadata half): no banned key / raw value reaches the capture row.
  it('U6: nested banned keys never reach the payload hash or redactionMetadata', async () => {
    const RAW = 'RAW_SENSITIVE_DO_NOT_LEAK';
    const dirty = {
      ...baseEnvelope(),
      usage_json: { input_tokens: 1, prompt: RAW, messages: [{ requestBody: RAW }] },
      tenant_context: {
        org_id: '11111111-1111-4111-8111-111111111111',
        tier: 'business',
        operational_mode: 'production',
        response: RAW,
      },
      prompt: RAW,
    } as unknown as PassthroughInvoked;
    const s = await run(dirty, REQ_IDENTITY);
    const ins = s.insert()!;
    const redactionJson = ins.values[P_REDACTION] as string;
    expect(redactionJson).not.toContain(RAW);
    for (const banned of ALL_BANNED_REDACTION_KEYS) {
      expect(redactionJson).not.toContain(`"${banned}"`);
    }
    // the capture row carries identity_scope; the absence of every per-attempt
    // FIELD is asserted (by parsed-key scan, not substring) in U10 — a substring
    // check is unsafe here because identity_scope's VALUE is 'govai_request_id'.
    expect(redactionJson).toContain('identity_scope');
  });

  // ---- U9: the two-direction idempotent-immutability guard (THE regression) ----
  const KEY_HASH = 'c'.repeat(64);
  const clientIdentity = (govaiRequestId: string): AuditBridgeRequestIdentity => ({
    govaiRequestId,
    identityScope: 'client_idempotency_key',
    idempotencyKeyHash: KEY_HASH,
  });
  // Deep-collect object KEYS (not values): `identity_scope` legitimately holds the
  // VALUE 'govai_request_id' on the request path, so a substring scan would
  // false-positive. U10 asserts no per-attempt FIELD is present.
  const collectKeys = (v: unknown, acc: Set<string>): Set<string> => {
    if (Array.isArray(v)) {
      v.forEach((x) => collectKeys(x, acc));
    } else if (v !== null && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        acc.add(k);
        collectKeys(val, acc);
      }
    }
    return acc;
  };

  it('U9a: faithful replay (same key + same occurred_at, varied per-attempt) -> all 18 equality columns byte-identical', async () => {
    // Two attempts of the SAME logical operation: same idempotency key AND same
    // occurred_at, differing ONLY in per-attempt fields (a fresh govai_request_id
    // each, plus different audit_event_id / latency_ms / provider_request_id).
    const a1 = await run(
      {
        ...baseEnvelope(),
        audit_event_id: '11111111-1111-4111-8111-aaaaaaaaaaaa',
        latency_ms: 11,
        provider_request_id: 'req_a1',
      },
      clientIdentity('a1111111-1111-4111-8111-111111111111'),
    );
    const a2 = await run(
      {
        ...baseEnvelope(),
        audit_event_id: '22222222-2222-4222-8222-bbbbbbbbbbbb',
        latency_ms: 22,
        provider_request_id: 'req_a2',
      },
      clientIdentity('a2222222-2222-4222-8222-222222222222'),
    );
    const v1 = a1.insert()!.values;
    const v2 = a2.insert()!.values;
    // The full param array (all 18 SQL-equality columns + the captureId; none is
    // a wall-clock value) is byte-identical across the replay -> SQL REUSES.
    expect(v1).toEqual(v2);
    // ...and explicitly the columns the P1 used to break:
    expect(v1[P_SUBJECT_ID]).toBe(v2[P_SUBJECT_ID]); // column #7 (now captureId)
    expect(v1[P_OCCURRED_AT]).toBe(v2[P_OCCURRED_AT]); // column #8
    expect((v1[P_PAYLOAD_HASH] as Buffer).toString('hex')).toBe(
      (v2[P_PAYLOAD_HASH] as Buffer).toString('hex'),
    ); // column #9
    expect(JSON.stringify(v1[P_REDACTION])).toBe(JSON.stringify(v2[P_REDACTION])); // column #14
  });

  it('U9b: a genuinely different occurred_at (same key) diverges on column #8 only -> NOT reuse-eligible', async () => {
    // Same key, same everything EXCEPT occurred_at. By ADR-028 (d) a different
    // event-time is a DIFFERENT event. This asserts the INPUT divergence; the SQL
    // outcome (a 23505 conflict, since the captureId is unchanged) is PR-B's
    // integration test, deliberately NOT asserted here.
    const b1 = await run(
      { ...baseEnvelope(), occurred_at: '2026-06-15T00:00:00.000Z' },
      clientIdentity('b1111111-1111-4111-8111-111111111111'),
    );
    const b2 = await run(
      { ...baseEnvelope(), occurred_at: '2026-06-15T09:09:09.999Z' },
      clientIdentity('b2222222-2222-4222-8222-222222222222'),
    );
    const v1 = b1.insert()!.values;
    const v2 = b2.insert()!.values;
    expect(v1).not.toEqual(v2); // not byte-identical -> not reuse-eligible
    // they diverge ONLY on occurred_at (#8); captureId/subjectId and the payload
    // hash are identical (occurred_at is in neither the captureId nor the payload).
    expect(v1[P_OCCURRED_AT]).not.toBe(v2[P_OCCURRED_AT]);
    expect(v1[P_CAPTURE_ID]).toBe(v2[P_CAPTURE_ID]);
    expect(v1[P_SUBJECT_ID]).toBe(v2[P_SUBJECT_ID]);
    expect((v1[P_PAYLOAD_HASH] as Buffer).toString('hex')).toBe(
      (v2[P_PAYLOAD_HASH] as Buffer).toString('hex'),
    );
  });

  it('U10: no per-attempt data on the capture row (both identity scopes)', async () => {
    const PER_ATTEMPT = ['govai_request_id', 'audit_event_id', 'latency_ms', 'provider_request_id'];
    const reqJson = (await run(baseEnvelope(), REQ_IDENTITY)).insert()!.values[P_REDACTION] as string;
    const keyJson = (await run(baseEnvelope(), clientIdentity('a1111111-1111-4111-8111-111111111111')))
      .insert()!
      .values[P_REDACTION] as string;
    for (const json of [reqJson, keyJson]) {
      const keys = collectKeys(JSON.parse(json), new Set<string>());
      for (const k of PER_ATTEMPT) expect(keys.has(k)).toBe(false);
      expect(keys.has('identity_scope')).toBe(true);
    }
    // the client scope carries the (stable) idempotency_key_hash; request scope does not.
    expect(collectKeys(JSON.parse(keyJson), new Set<string>()).has('idempotency_key_hash')).toBe(true);
    expect(collectKeys(JSON.parse(reqJson), new Set<string>()).has('idempotency_key_hash')).toBe(false);
  });

  it('U11: occurred_at round-trips ISO-stably (Date -> adapter -> ISO, no TZ/precision drift)', async () => {
    const ISO = '2026-06-15T12:34:56.789Z';
    const s = await run({ ...baseEnvelope(), occurred_at: ISO }, REQ_IDENTITY);
    expect(s.insert()!.values[P_OCCURRED_AT]).toBe(ISO);
  });

  it('per-attempt traceability is emitted as a structured audit_bridge.capture log', async () => {
    const env = {
      ...baseEnvelope(),
      audit_event_id: '33333333-3333-4333-8333-cccccccccccc',
      latency_ms: 77,
      provider_request_id: 'req_log',
    };
    const s = await run(env, REQ_IDENTITY);
    expect(s.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        govai_request_id: REQ_IDENTITY.govaiRequestId,
        audit_event_id: env.audit_event_id,
        latency_ms: env.latency_ms,
        provider_request_id: env.provider_request_id,
        identity_scope: 'govai_request_id',
      }),
      'audit_bridge.capture',
    );
  });
});
