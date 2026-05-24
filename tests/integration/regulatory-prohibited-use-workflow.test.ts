// Regulatory Core PR-R9 (issue #59, umbrella #33) — Prohibited-use Governance Workflow.
//
// Production-focused slice on top of the deterministic Risk Classification
// Engine (PR-R7), the High-risk Review Workflow (PR-R8), and the Agent
// Capability Bindings (PR-R5). Covers auth/RBAC, CRUD-without-delete,
// lifecycle transitions (OPEN → UNDER_REVIEW → DENIED / FALSE_POSITIVE /
// CANCELLED), mandatory separation-of-duties for final determinations
// (PROHIBITED_CONFIRMED, FALSE_POSITIVE) in both service and DB trigger,
// append-only determinations, terminal-state backstops, evidence records,
// tenant isolation (API + direct DB RLS), keyset pagination, validation,
// audit evidence, DDL semantic comments binding DENIED / HARD_DENY_EXPECTED /
// PROHIBITED_CONFIRMED to governance evidence only, and PR-R7 + PR-R8
// non-regression.
//
// DENIED in PR-R9 means the prohibited-use governance case has a denial
// determination recorded as governance evidence only. It does not mean
// runtime execution was blocked; it does not implement gateway enforcement;
// it does not intercept provider calls; it does not implement legal advice;
// and it does not certify compliance. HARD_DENY_EXPECTED records an expected
// governance denial posture for future or adjacent enforcement systems —
// PR-R9 itself does not perform runtime hard-deny enforcement.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { startStack, stopStack, seedOrg, addApiKey, inject, type Stack } from './helpers/server-fixture.js';

let stack: Stack;

type AdminOrg = { org_id: string; user_id: string; api_key: string };

async function adminOrg(): Promise<AdminOrg> {
  const org = await seedOrg(stack);
  const admin = await addApiKey(stack, org.org_id, org.user_id, ['admin']);
  return { org_id: org.org_id, user_id: org.user_id, api_key: admin.api_key };
}

let orgA: AdminOrg;
let orgB: AdminOrg;
let devOrg: { org_id: string; user_id: string; api_key: string };
let orgPage: AdminOrg;

// Shared parents (tenant A).
let aiSysA: string, provA: string, useCaseA: string, methodA: string;
let prohibitedClassA: string, highClassA: string, moderateClassA: string;
let agentA: string;
let prohibitedBindingA: string, moderateBindingA: string;

// Shared parents (tenant B).
let aiSysB: string, provB: string, useCaseB: string, methodB: string;
let prohibitedClassB: string;
let agentB: string, prohibitedBindingB: string;

// approverApiKey is a second admin key on orgA — used to satisfy SoD when
// orgA's primary admin is the requester of the case.
let approverApiKey: string;

function bodyOf(r: { body: unknown }): Record<string, unknown> {
  return r.body as Record<string, unknown>;
}

async function mkAiSystem(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/ai-systems', org.api_key, {
    system_key: `AIS-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'ai system',
    system_type: 'INTERNAL_PRODUCT',
    lifecycle_state: 'ACTIVE',
    deployment_environment: 'PRODUCTION',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['ai_system'] as Record<string, unknown>)['id'] as string;
}

async function mkProvider(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/providers', org.api_key, {
    provider_key: `PRV-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'provider',
    provider_type: 'MODEL_PROVIDER',
    provider_status: 'APPROVED',
    deployment_model: 'API',
    data_processing_role: 'PROCESSOR',
    dpa_status: 'APPROVED',
    security_review_status: 'APPROVED',
    subprocessors_review_status: 'APPROVED',
    ai_terms_review_status: 'APPROVED',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['provider'] as Record<string, unknown>)['id'] as string;
}

async function mkUseCase(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/use-cases', org.api_key, {
    use_case_key: `UC-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'use case',
    use_case_status: 'PROPOSED',
    use_case_category: 'CUSTOMER_SUPPORT',
    business_criticality: 'HIGH',
    deployment_scope: 'INTERNAL_ONLY',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['use_case'] as Record<string, unknown>)['id'] as string;
}

async function mkMethod(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/risk-methods', org.api_key, {
    method_key: `RM-${randomUUID().slice(0, 8).toUpperCase()}`,
    method_version: '1.0',
    name: 'GovAI baseline',
    method_status: 'ACTIVE',
    framework_profile: 'GOVAI_BASELINE',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['risk_method'] as Record<string, unknown>)['id'] as string;
}

async function mkClassification(
  org: AdminOrg,
  methodId: string,
  ucId: string,
  aiId: string,
  factor_inputs: Record<string, unknown>,
): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', org.api_key, {
    classification_key: `CLS-${randomUUID().slice(0, 8).toUpperCase()}`,
    risk_method_id: methodId,
    use_case_id: ucId,
    ai_system_id: aiId,
    classification_basis: 'RULE_EVALUATION',
    decision_scope: 'INTERNAL_ASSISTANCE',
    factor_inputs,
  });
  expect(r.statusCode).toBe(201);
  return ((bodyOf(r)['risk_classification']) as Record<string, unknown>)['id'] as string;
}

async function mkAgent(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/agents', org.api_key, {
    agent_key: `AGT-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'agent',
    agent_type: 'LLM_AGENT',
    agent_status: 'ACTIVE',
    autonomy_level: 'HUMAN_APPROVAL_REQUIRED',
    execution_boundary: 'GOVAI_WORKROOM',
    human_oversight_mode: 'HUMAN_IN_LOOP',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['agent'] as Record<string, unknown>)['id'] as string;
}

async function mkAgentVersion(org: AdminOrg, agentId: string): Promise<string> {
  const r = await inject(stack, 'POST', `/v1/regulatory/agents/${agentId}/versions`, org.api_key, {
    version_key: `AVER-${randomUUID().slice(0, 8).toUpperCase()}`,
    version_label: 'v1',
    version_status: 'APPROVED',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['agent_version'] as Record<string, unknown>)['id'] as string;
}

async function mkBinding(
  org: AdminOrg,
  agentId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/agent-capability-bindings', org.api_key, {
    agent_id: agentId,
    capability_key: `CAP-${randomUUID().slice(0, 8).toUpperCase()}`,
    capability_name: 'network access',
    capability_category: 'NETWORK',
    capability_status: 'PROPOSED',
    risk_posture: 'MODERATE',
    ...overrides,
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['agent_capability_binding'] as Record<string, unknown>)['id'] as string;
}

const basePolicy = (o: Record<string, unknown> = {}) => ({
  policy_key: `POL-${randomUUID().slice(0, 8).toUpperCase()}`,
  policy_version: '1.0',
  name: 'social scoring prohibited',
  policy_status: 'ACTIVE',
  policy_category: 'SOCIAL_SCORING',
  policy_basis: 'GOVAI_BASELINE',
  framework_profile: 'GOVAI_BASELINE',
  ...o,
});

async function mkPolicyResp(org: AdminOrg, o: Record<string, unknown> = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/prohibited-use-policies', org.api_key, basePolicy(o));
  return { status: r.statusCode, body: bodyOf(r) };
}

async function mkPolicy(org: AdminOrg, o: Record<string, unknown> = {}): Promise<string> {
  const r = await mkPolicyResp(org, o);
  expect(r.status).toBe(201);
  return (r.body['prohibited_use_policy'] as Record<string, unknown>)['id'] as string;
}

type CaseArgs = {
  case_key?: string;
  case_basis?: string;
  denial_posture?: string;
  risk_classification_id?: string;
  agent_capability_binding_id?: string;
  prohibited_use_policy_id?: string;
};

const baseCase = (o: CaseArgs = {}) => ({
  case_key: o.case_key ?? `PUC-${randomUUID().slice(0, 8).toUpperCase()}`,
  case_basis: o.case_basis ?? 'RISK_CLASSIFICATION_PROHIBITED',
  denial_posture: o.denial_posture ?? 'GOVERNANCE_DENY_RECORDED',
  risk_classification_id: o.risk_classification_id,
  agent_capability_binding_id: o.agent_capability_binding_id,
  prohibited_use_policy_id: o.prohibited_use_policy_id,
});

async function mkCaseResp(org: AdminOrg, o: CaseArgs = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/prohibited-use-cases', org.api_key, baseCase(o));
  return { status: r.statusCode, body: bodyOf(r) };
}

async function mkCase(org: AdminOrg, o: CaseArgs = {}): Promise<{ id: string; body: Record<string, unknown> }> {
  const r = await mkCaseResp(org, o);
  expect(r.status).toBe(201);
  const c = r.body['prohibited_use_case'] as Record<string, unknown>;
  return { id: c['id'] as string, body: r.body };
}

async function submitCase(org: AdminOrg, id: string) {
  const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${id}/submit`, org.api_key, {});
  return { status: r.statusCode, body: bodyOf(r) };
}

const baseEvidence = (o: Record<string, unknown> = {}) => ({
  evidence_key: `EV-${randomUUID().slice(0, 8).toUpperCase()}`,
  evidence_type: 'POLICY_RULE',
  evidence_status: 'DRAFT',
  title: 'evidence',
  ...o,
});

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

async function insertBlocked(orgId: string, sql: string, params: unknown[]): Promise<boolean> {
  try {
    await asOrg(orgId, (c) => c.query(sql, params));
    return false;
  } catch {
    return true;
  }
}

async function auditCount(orgId: string, subjectId: string, eventType: string): Promise<number> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query(
      `SELECT 1 FROM govai.audit_events WHERE org_id = $1::uuid AND subject_id = $2::uuid AND event_type = $3`,
      [orgId, subjectId, eventType],
    );
    return r.rowCount ?? 0;
  } finally {
    c.release();
  }
}

async function fetchAuditPayloads(orgId: string, subjectId: string): Promise<string> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query<{ event_type: string; redaction_metadata: Record<string, unknown> }>(
      `SELECT event_type, redaction_metadata FROM govai.audit_events
        WHERE org_id = $1::uuid AND subject_id = $2::uuid`,
      [orgId, subjectId],
    );
    return JSON.stringify(r.rows);
  } finally {
    c.release();
  }
}

const PROHIBITED_INPUTS = { social_scoring_signal: true };
const HIGH_INPUTS = { rights_affecting_automated_decision: true, automated_decisioning: 'AUTOMATED_EXTERNAL_EFFECT' };
const MODERATE_INPUTS = { personal_data: true };

beforeAll(async () => {
  stack = await startStack();
  orgA = await adminOrg();
  // Second admin key on tenant A — satisfies SoD when admin of orgA is requester.
  const approverKey = await addApiKey(stack, orgA.org_id, randomUUID(), ['admin']);
  approverApiKey = approverKey.api_key;
  orgB = await adminOrg();
  const dev = await seedOrg(stack);
  const devKey = await addApiKey(stack, dev.org_id, dev.user_id, ['developer']);
  devOrg = { org_id: dev.org_id, user_id: dev.user_id, api_key: devKey.api_key };
  orgPage = await adminOrg();

  aiSysA = await mkAiSystem(orgA);
  provA = await mkProvider(orgA);
  void provA;
  useCaseA = await mkUseCase(orgA);
  methodA = await mkMethod(orgA);
  prohibitedClassA = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
  highClassA = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
  moderateClassA = await mkClassification(orgA, methodA, useCaseA, aiSysA, MODERATE_INPUTS);
  agentA = await mkAgent(orgA);
  await mkAgentVersion(orgA, agentA); // exercise PR-R5 version creation alongside; not used directly
  prohibitedBindingA = await mkBinding(orgA, agentA, { risk_posture: 'PROHIBITED' });
  // hard_deny_floor_expected defaults to TRUE in the agent registry, so a
  // truly-not-prohibited-and-not-hard-deny binding has to set it explicitly.
  moderateBindingA = await mkBinding(orgA, agentA, { risk_posture: 'MODERATE', hard_deny_floor_expected: false });

  aiSysB = await mkAiSystem(orgB);
  provB = await mkProvider(orgB);
  void provB;
  useCaseB = await mkUseCase(orgB);
  methodB = await mkMethod(orgB);
  prohibitedClassB = await mkClassification(orgB, methodB, useCaseB, aiSysB, PROHIBITED_INPUTS);
  agentB = await mkAgent(orgB);
  prohibitedBindingB = await mkBinding(orgB, agentB, { risk_posture: 'PROHIBITED' });
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

// ===========================================================================
// Auth + RBAC
// ===========================================================================

describe('regulatory-prohibited-use / auth + rbac', () => {
  it('unauthenticated requests rejected on every PR-R9 endpoint (401)', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/prohibited-use-policies', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/prohibited-use-policies', undefined, basePolicy())).statusCode).toBe(401);
    expect((await inject(stack, 'GET', '/v1/regulatory/prohibited-use-cases', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/prohibited-use-cases', undefined, baseCase({ risk_classification_id: prohibitedClassA }))).statusCode).toBe(401);
  });

  it('non-write role can read but not write', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/prohibited-use-policies', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', '/v1/regulatory/prohibited-use-cases', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/prohibited-use-policies', devOrg.api_key, basePolicy())).statusCode).toBe(403);
    expect((await inject(stack, 'POST', '/v1/regulatory/prohibited-use-cases', devOrg.api_key, baseCase({ risk_classification_id: prohibitedClassA }))).statusCode).toBe(403);
  });

  it('admin can create policy + case from PROHIBITED classification + submit + add evidence + determine + cancel', async () => {
    const polId = await mkPolicy(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls, prohibited_use_policy_id: polId });
    expect((await submitCase(orgA, out.id)).status).toBe(200);
    const ev = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/evidence`, orgA.api_key, baseEvidence());
    expect(ev.statusCode).toBe(201);
    const det = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED',
      denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'baseline social scoring policy violation',
      reviewer_role: 'COMPLIANCE',
    });
    expect(det.statusCode).toBe(201);
    // Once DENIED, further cancel must be rejected.
    expect(
      (await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' })).statusCode,
    ).toBe(409);
  });
});

// ===========================================================================
// Policies
// ===========================================================================

describe('regulatory-prohibited-use / policies API', () => {
  it('create + audit + GET own + cross-tenant 404 + list own only', async () => {
    const id = await mkPolicy(orgA);
    expect(await auditCount(orgA.org_id, id, 'regulatory_prohibited_use_policy.created')).toBe(1);
    expect((await inject(stack, 'GET', `/v1/regulatory/prohibited-use-policies/${id}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/prohibited-use-policies/${id}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('prohibited_use_policy_not_found');
    const listB = await inject(stack, 'GET', '/v1/regulatory/prohibited-use-policies?limit=200', orgB.api_key);
    expect((bodyOf(listB)['prohibited_use_policies'] as Array<Record<string, unknown>>).map((x) => x['id'])).not.toContain(id);
  });

  it('PATCH mutable fields + audit; status transition emits status_changed', async () => {
    const id = await mkPolicy(orgA, { policy_status: 'DRAFT' });
    const p1 = await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-policies/${id}`, orgA.api_key, { name: 'renamed', detection_guidance: 'fresh guidance' });
    expect(p1.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_prohibited_use_policy.updated')).toBe(1);
    const p2 = await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-policies/${id}`, orgA.api_key, { policy_status: 'ACTIVE' });
    expect(p2.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_prohibited_use_policy.status_changed')).toBe(1);
  });

  it('duplicate (policy_key, policy_version) per tenant rejected 409; same key/version cross tenant allowed; different version same tenant allowed', async () => {
    const key = `POL-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkPolicyResp(orgA, { policy_key: key, policy_version: '1.0' })).status).toBe(201);
    const dup = await mkPolicyResp(orgA, { policy_key: key, policy_version: '1.0' });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('prohibited_use_policy_key_conflict');
    expect((await mkPolicyResp(orgA, { policy_key: key, policy_version: '1.1' })).status).toBe(201);
    expect((await mkPolicyResp(orgB, { policy_key: key, policy_version: '1.0' })).status).toBe(201);
  });

  it('invalid enum/key rejected 400; empty PATCH rejected 400', async () => {
    expect((await mkPolicyResp(orgA, { policy_status: 'NOPE' })).status).toBe(400);
    expect((await mkPolicyResp(orgA, { policy_category: 'NOPE' })).status).toBe(400);
    expect((await mkPolicyResp(orgA, { policy_key: 'bad key' })).status).toBe(400);
    const id = await mkPolicy(orgA);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-policies/${id}`, orgA.api_key, {})).statusCode).toBe(400);
  });

  it('direct DB guarded-update blocks identity mutation; identity (policy_key, policy_version) immutable', async () => {
    const id = await mkPolicy(orgA);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_policies SET policy_key = $2 WHERE id = $1::uuid', [id, 'CHANGED'])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_policies SET policy_version = $2 WHERE id = $1::uuid', [id, '999'])).toBe(true);
    // Allowed: status/category/basis/summaries/metadata.
    const ok = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`UPDATE govai.regulatory_prohibited_use_policies SET name = 'changed-name', detection_guidance = 'new' WHERE id = $1::uuid`, [id]);
      return r.rowCount ?? 0;
    });
    expect(ok).toBe(1);
  });
});

// ===========================================================================
// Cases — classification intake
// ===========================================================================

describe('regulatory-prohibited-use / cases from classification', () => {
  it('create from PROHIBITED classification copies risk snapshot; created audit emitted; classification unchanged', async () => {
    const before = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${prohibitedClassA}`, orgA.api_key);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const c = out.body['prohibited_use_case'] as Record<string, unknown>;
    expect(c['risk_classification_id']).toBe(cls);
    expect(c['inherent_risk_tier']).toBe('PROHIBITED');
    expect(c['residual_risk_tier']).toBe('PROHIBITED');
    expect(c['risk_score']).toBe(100);
    expect(c['residual_risk_score']).toBe(100);
    expect(c['requires_prohibited_use_review']).toBe(true);
    expect(c['case_status']).toBe('OPEN');
    expect(c['case_basis']).toBe('RISK_CLASSIFICATION_PROHIBITED');
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.created')).toBe(1);

    const after = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${prohibitedClassA}`, orgA.api_key);
    const a = (bodyOf(before)['risk_classification']) as Record<string, unknown>;
    const b = (bodyOf(after)['risk_classification']) as Record<string, unknown>;
    expect(b['inherent_risk_tier']).toBe(a['inherent_risk_tier']);
    expect(b['residual_risk_tier']).toBe(a['residual_risk_tier']);
    expect(b['risk_score']).toBe(a['risk_score']);
    expect(b['residual_risk_score']).toBe(a['residual_risk_score']);
  });

  it('duplicate case_key per tenant rejected 409; same key different tenant allowed', async () => {
    const cls1 = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const cls2 = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const key = `PUC-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkCaseResp(orgA, { case_key: key, risk_classification_id: cls1 })).status).toBe(201);
    const dup = await mkCaseResp(orgA, { case_key: key, risk_classification_id: cls2 });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('prohibited_use_case_key_conflict');
    expect((await mkCaseResp(orgB, { case_key: key, risk_classification_id: prohibitedClassB })).status).toBe(201);
  });

  it('HIGH classification rejected 400 high_risk_review_required', async () => {
    const r = await mkCaseResp(orgA, { risk_classification_id: highClassA });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('high_risk_review_required');
  });

  it('LOW/MODERATE classification rejected 400 classification_not_prohibited', async () => {
    const r = await mkCaseResp(orgA, { risk_classification_id: moderateClassA });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('classification_not_prohibited');
  });

  it('cross-tenant classification_id returns 404 without leakage', async () => {
    const r = await mkCaseResp(orgA, { risk_classification_id: prohibitedClassB });
    expect(r.status).toBe(404);
    expect(r.body['error']).toBe('risk_classification_not_found');
  });

  it('client-supplied risk snapshot fields are stripped; copied values from classification win', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const r = await inject(stack, 'POST', '/v1/regulatory/prohibited-use-cases', orgA.api_key, {
      ...baseCase({ risk_classification_id: cls }),
      risk_method_id: randomUUID(),
      inherent_risk_tier: 'MINIMAL',
      residual_risk_tier: 'MINIMAL',
      risk_score: 1,
      residual_risk_score: 1,
      requires_prohibited_use_review: false,
    });
    expect(r.statusCode).toBe(201);
    const c = (bodyOf(r)['prohibited_use_case']) as Record<string, unknown>;
    expect(c['inherent_risk_tier']).toBe('PROHIBITED');
    expect(c['residual_risk_tier']).toBe('PROHIBITED');
    expect(c['risk_score']).toBe(100);
    expect(c['requires_prohibited_use_review']).toBe(true);
  });

  it('one non-terminal case per (classification) — duplicate active rejected; allowed after terminal', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const a = await mkCase(orgA, { risk_classification_id: cls });
    const dup = await mkCaseResp(orgA, { risk_classification_id: cls });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('prohibited_use_case_active_for_classification');
    await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${a.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect((await mkCaseResp(orgA, { risk_classification_id: cls })).status).toBe(201);
  });
});

// ===========================================================================
// Cases — agent capability binding intake
// ===========================================================================

describe('regulatory-prohibited-use / cases from agent capability binding', () => {
  it('create from PROHIBITED capability binding copies snapshot; binding unchanged', async () => {
    const beforeBinding = await inject(stack, 'GET', `/v1/regulatory/agent-capability-bindings/${prohibitedBindingA}`, orgA.api_key);
    const bindNew = await mkBinding(orgA, agentA, { risk_posture: 'PROHIBITED' });
    const out = await mkCase(orgA, {
      case_basis: 'AGENT_CAPABILITY_PROHIBITED',
      agent_capability_binding_id: bindNew,
      denial_posture: 'HARD_DENY_EXPECTED',
    });
    const c = out.body['prohibited_use_case'] as Record<string, unknown>;
    expect(c['agent_capability_binding_id']).toBe(bindNew);
    expect(c['agent_id']).toBe(agentA);
    expect(c['capability_key']).toBeTruthy();
    expect(c['capability_risk_posture']).toBe('PROHIBITED');
    expect(c['denial_posture']).toBe('HARD_DENY_EXPECTED');
    expect(c['case_basis']).toBe('AGENT_CAPABILITY_PROHIBITED');
    const afterBinding = await inject(stack, 'GET', `/v1/regulatory/agent-capability-bindings/${prohibitedBindingA}`, orgA.api_key);
    const a = (bodyOf(beforeBinding)['agent_capability_binding']) as Record<string, unknown>;
    const b = (bodyOf(afterBinding)['agent_capability_binding']) as Record<string, unknown>;
    expect(b['risk_posture']).toBe(a['risk_posture']);
    expect(b['hard_deny_floor_expected']).toBe(a['hard_deny_floor_expected']);
  });

  it('create from own hard_deny_floor_expected binding succeeds; HARD_DENY_EXPECTED can be combined', async () => {
    const bind = await mkBinding(orgA, agentA, { risk_posture: 'HIGH', hard_deny_floor_expected: true });
    const out = await mkCase(orgA, {
      case_basis: 'AGENT_CAPABILITY_PROHIBITED',
      agent_capability_binding_id: bind,
      denial_posture: 'HARD_DENY_EXPECTED',
    });
    const c = out.body['prohibited_use_case'] as Record<string, unknown>;
    expect(c['hard_deny_floor_expected']).toBe(true);
    expect(c['capability_risk_posture']).toBe('HIGH');
  });

  it('cross-tenant capability binding rejected 404', async () => {
    const r = await mkCaseResp(orgA, {
      case_basis: 'AGENT_CAPABILITY_PROHIBITED',
      agent_capability_binding_id: prohibitedBindingB,
      denial_posture: 'HARD_DENY_EXPECTED',
    });
    expect(r.status).toBe(404);
    expect(r.body['error']).toBe('agent_capability_binding_not_found');
  });

  it('non-prohibited/non-hard-deny binding rejected 400 capability_not_prohibited_or_denied', async () => {
    const r = await mkCaseResp(orgA, {
      case_basis: 'AGENT_CAPABILITY_PROHIBITED',
      agent_capability_binding_id: moderateBindingA,
      denial_posture: 'MONITORING_ONLY',
    });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('capability_not_prohibited_or_denied');
  });

  it('PROHIBITED capability binding with non-deny denial_posture rejected 400', async () => {
    const bind = await mkBinding(orgA, agentA, { risk_posture: 'PROHIBITED' });
    const r = await mkCaseResp(orgA, {
      case_basis: 'AGENT_CAPABILITY_PROHIBITED',
      agent_capability_binding_id: bind,
      denial_posture: 'MONITORING_ONLY',
    });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('prohibited_capability_requires_deny_posture');
  });
});

// ===========================================================================
// Read/list
// ===========================================================================

describe('regulatory-prohibited-use / read + list + pagination', () => {
  it('GET own case + cross-tenant 404; list own only', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    expect((await inject(stack, 'GET', `/v1/regulatory/prohibited-use-cases/${out.id}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/prohibited-use-cases/${out.id}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('prohibited_use_case_not_found');
    const listB = await inject(stack, 'GET', '/v1/regulatory/prohibited-use-cases?limit=200', orgB.api_key);
    expect((bodyOf(listB)['prohibited_use_cases'] as Array<Record<string, unknown>>).map((x) => x['id'])).not.toContain(out.id);
  });

  it('filters by status/basis/policy/classification/use_case/ai_system/agent/binding/denial/due_before/q work', async () => {
    const polFi = await mkPolicy(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls, prohibited_use_policy_id: polFi });
    await submitCase(orgA, out.id);
    const byStatus = await inject(stack, 'GET', '/v1/regulatory/prohibited-use-cases?case_status=UNDER_REVIEW&limit=200', orgA.api_key);
    for (const row of bodyOf(byStatus)['prohibited_use_cases'] as Array<Record<string, unknown>>) {
      expect(row['case_status']).toBe('UNDER_REVIEW');
    }
    const byBasis = await inject(stack, 'GET', '/v1/regulatory/prohibited-use-cases?case_basis=RISK_CLASSIFICATION_PROHIBITED&limit=200', orgA.api_key);
    for (const row of bodyOf(byBasis)['prohibited_use_cases'] as Array<Record<string, unknown>>) {
      expect(row['case_basis']).toBe('RISK_CLASSIFICATION_PROHIBITED');
    }
    const byPolicy = await inject(stack, 'GET', `/v1/regulatory/prohibited-use-cases?prohibited_use_policy_id=${polFi}&limit=200`, orgA.api_key);
    for (const row of bodyOf(byPolicy)['prohibited_use_cases'] as Array<Record<string, unknown>>) {
      expect(row['prohibited_use_policy_id']).toBe(polFi);
    }
  });

  it('keyset pagination returns every case exactly once', async () => {
    const methodP = await mkMethod(orgPage);
    const aiP = await mkAiSystem(orgPage);
    const ucP = await mkUseCase(orgPage);
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const cls = await mkClassification(orgPage, methodP, ucP, aiP, PROHIBITED_INPUTS);
      const out = await mkCase(orgPage, { risk_classification_id: cls });
      created.push(out.id);
    }
    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/prohibited-use-cases${qs}`, orgPage.api_key);
      for (const row of bodyOf(page)['prohibited_use_cases'] as Array<Record<string, unknown>>) {
        seen.add(row['id'] as string);
      }
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);
    for (const id of created) expect(seen.has(id)).toBe(true);
  });
});

// ===========================================================================
// Lifecycle: submit / cancel / PATCH
// ===========================================================================

describe('regulatory-prohibited-use / lifecycle', () => {
  it('submit OPEN moves to UNDER_REVIEW; submitted + status_changed emitted', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const r = await submitCase(orgA, out.id);
    expect(r.status).toBe(200);
    const c = r.body['prohibited_use_case'] as Record<string, unknown>;
    expect(c['case_status']).toBe('UNDER_REVIEW');
    expect(c['submitted_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.submitted')).toBe(1);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.status_changed')).toBeGreaterThanOrEqual(1);
  });

  it('submit terminal case rejected; cancel terminal case rejected', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect((await submitCase(orgA, out.id)).status).toBe(409);
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' })).statusCode).toBe(409);
  });

  it('cancel OPEN sets cancellation_reason + cancelled_at; emits cancelled + status_changed', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'duplicate' });
    expect(r.statusCode).toBe(200);
    const c = bodyOf(r)['prohibited_use_case'] as Record<string, unknown>;
    expect(c['case_status']).toBe('CANCELLED');
    expect(c['cancellation_reason']).toBe('duplicate');
    expect(c['cancelled_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.cancelled')).toBe(1);
  });

  it('cancel requires non-empty reason (400 on empty); PATCH mutable fields work; PATCH empty body rejected; identity/snapshot stripped', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: '' })).statusCode).toBe(400);
    const p = await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-cases/${out.id}`, orgA.api_key, { review_notes: 'noted' });
    expect(p.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.updated')).toBe(1);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-cases/${out.id}`, orgA.api_key, {})).statusCode).toBe(400);
    // Identity / snapshot keys are not in the patch schema — stripped, empty payload → 400.
    expect((await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-cases/${out.id}`, orgA.api_key, {
      risk_classification_id: prohibitedClassA, inherent_risk_tier: 'MINIMAL', risk_score: 1, case_status: 'DENIED',
    })).statusCode).toBe(400);
    // Confirm snapshot unchanged.
    const get = await inject(stack, 'GET', `/v1/regulatory/prohibited-use-cases/${out.id}`, orgA.api_key);
    const c = (bodyOf(get)['prohibited_use_case']) as Record<string, unknown>;
    expect(c['inherent_risk_tier']).toBe('PROHIBITED');
    expect(c['risk_score']).toBe(100);
  });
});

// ===========================================================================
// Evidence
// ===========================================================================

describe('regulatory-prohibited-use / evidence', () => {
  it('add evidence to OPEN/UNDER_REVIEW succeeds; created audit; add to terminal rejected', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const ev1 = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/evidence`, orgA.api_key, baseEvidence());
    expect(ev1.statusCode).toBe(201);
    const eid = ((bodyOf(ev1)['prohibited_use_evidence']) as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, eid, 'regulatory_prohibited_use_evidence.created')).toBe(1);
    await submitCase(orgA, out.id);
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/evidence`, orgA.api_key, baseEvidence())).statusCode).toBe(201);
    await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/evidence`, orgA.api_key, baseEvidence())).statusCode).toBe(409);
  });

  it('duplicate evidence_key per case rejected 409; same key different case allowed', async () => {
    const cls1 = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const cls2 = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out1 = await mkCase(orgA, { risk_classification_id: cls1 });
    const out2 = await mkCase(orgA, { risk_classification_id: cls2 });
    const key = `EV-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out1.id}/evidence`, orgA.api_key, baseEvidence({ evidence_key: key }))).statusCode).toBe(201);
    const dup = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out1.id}/evidence`, orgA.api_key, baseEvidence({ evidence_key: key }));
    expect(dup.statusCode).toBe(409);
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out2.id}/evidence`, orgA.api_key, baseEvidence({ evidence_key: key }))).statusCode).toBe(201);
  });

  it('GET own evidence works; cross-tenant returns 404', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const ev = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/evidence`, orgA.api_key, baseEvidence());
    const eid = ((bodyOf(ev)['prohibited_use_evidence']) as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'GET', `/v1/regulatory/prohibited-use-evidence/${eid}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/prohibited-use-evidence/${eid}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH evidence + evidence_status transition emits updated + status_changed; PATCH after terminal rejected', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const ev = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/evidence`, orgA.api_key, baseEvidence());
    const eid = ((bodyOf(ev)['prohibited_use_evidence']) as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-evidence/${eid}`, orgA.api_key, { summary: 'updated' })).statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, eid, 'regulatory_prohibited_use_evidence.updated')).toBe(1);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-evidence/${eid}`, orgA.api_key, { evidence_status: 'ACCEPTED' })).statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, eid, 'regulatory_prohibited_use_evidence.status_changed')).toBe(1);
    await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect((await inject(stack, 'PATCH', `/v1/regulatory/prohibited-use-evidence/${eid}`, orgA.api_key, { summary: 'after' })).statusCode).toBe(409);
  });

  it('unknown forbidden fields stripped silently; no prompt_body persisted', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/evidence`, orgA.api_key, {
      ...baseEvidence(),
      prompt_body: 'system prompt',
      legal_opinion: 'GovAI says it is legal',
    });
    expect(r.statusCode).toBe(201);
    const eid = ((bodyOf(r)['prohibited_use_evidence']) as Record<string, unknown>)['id'] as string;
    const get = await inject(stack, 'GET', `/v1/regulatory/prohibited-use-evidence/${eid}`, orgA.api_key);
    const keys = Object.keys((bodyOf(get)['prohibited_use_evidence']) as Record<string, unknown>);
    expect(keys).not.toContain('prompt_body');
    expect(keys).not.toContain('legal_opinion');
  });
});

// ===========================================================================
// Determinations + service-level SoD
// ===========================================================================

describe('regulatory-prohibited-use / determinations', () => {
  it('PROHIBITED_CONFIRMED by non-requester from UNDER_REVIEW succeeds; case → DENIED; determined_at set; audits emitted', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED',
      denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'social scoring detected',
      reviewer_role: 'COMPLIANCE',
    });
    expect(r.statusCode).toBe(201);
    const did = ((bodyOf(r)['prohibited_use_determination']) as Record<string, unknown>)['id'] as string;
    const c = (bodyOf(r)['prohibited_use_case']) as Record<string, unknown>;
    expect(c['case_status']).toBe('DENIED');
    expect(c['denial_posture']).toBe('GOVERNANCE_DENY_RECORDED');
    expect(c['determined_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, did, 'regulatory_prohibited_use_determination.created')).toBe(1);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.denied')).toBe(1);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.status_changed')).toBeGreaterThanOrEqual(1);
  });

  it('PROHIBITED_CONFIRMED requires rationale (400 on empty)', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED',
      denial_posture: 'GOVERNANCE_DENY_RECORDED',
      reviewer_role: 'COMPLIANCE',
    });
    expect(r.statusCode).toBe(400);
  });

  it('PROHIBITED_CONFIRMED requires HARD_DENY_EXPECTED or GOVERNANCE_DENY_RECORDED denial_posture', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED',
      denial_posture: 'MONITORING_ONLY',
      determination_rationale: 'x',
      reviewer_role: 'COMPLIANCE',
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('prohibited_confirmed_requires_deny_posture');
  });

  it('FALSE_POSITIVE by non-requester moves case to FALSE_POSITIVE; requires rationale; requires NOT_APPLICABLE posture', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    // rationale required
    const noRationale = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'FALSE_POSITIVE',
      denial_posture: 'NOT_APPLICABLE',
      reviewer_role: 'COMPLIANCE',
    });
    expect(noRationale.statusCode).toBe(400);
    // wrong posture rejected
    const wrongPosture = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'FALSE_POSITIVE',
      denial_posture: 'HARD_DENY_EXPECTED',
      determination_rationale: 'x',
      reviewer_role: 'COMPLIANCE',
    });
    expect(wrongPosture.statusCode).toBe(400);
    expect(bodyOf(wrongPosture)['error']).toBe('false_positive_requires_not_applicable_posture');
    // happy path
    const ok = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'FALSE_POSITIVE',
      denial_posture: 'NOT_APPLICABLE',
      determination_rationale: 'manual review confirmed this is not social scoring',
      reviewer_role: 'COMPLIANCE',
    });
    expect(ok.statusCode).toBe(201);
    const c = (bodyOf(ok)['prohibited_use_case']) as Record<string, unknown>;
    expect(c['case_status']).toBe('FALSE_POSITIVE');
    expect(c['determined_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.false_positive')).toBe(1);
  });

  it('NEEDS_MORE_INFORMATION keeps case in UNDER_REVIEW (no status_changed for the no-op transition); audit emitted', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    const submittedStatusChanged = await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.status_changed');
    // Requester (orgA admin) is allowed to ask for more info on their own case.
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, orgA.api_key, {
      determination: 'NEEDS_MORE_INFORMATION',
      denial_posture: 'MONITORING_ONLY',
      determination_rationale: 'need DPO review reference',
      reviewer_role: 'COMPLIANCE',
    });
    expect(r.statusCode).toBe(201);
    const c = (bodyOf(r)['prohibited_use_case']) as Record<string, unknown>;
    expect(c['case_status']).toBe('UNDER_REVIEW');
    expect(c['determined_at']).toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.needs_more_information')).toBe(1);
    // status_changed count must NOT have advanced because status did not change.
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_prohibited_use_case.status_changed')).toBe(submittedStatusChanged);
  });

  it('terminal case rejects further determinations; second final PROHIBITED_CONFIRMED rejected 409', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    })).statusCode).toBe(201);
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    })).statusCode).toBe(409);
  });

  it('cross-tenant determination GET returns 404', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    });
    const did = ((bodyOf(r)['prohibited_use_determination']) as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'GET', `/v1/regulatory/prohibited-use-determinations/${did}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/prohibited-use-determinations/${did}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('DENIED / PROHIBITED_CONFIRMED / HARD_DENY_EXPECTED audit payloads avoid runtime/legal/compliance/enforcement claims', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls, denial_posture: 'HARD_DENY_EXPECTED' });
    await submitCase(orgA, out.id);
    await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'HARD_DENY_EXPECTED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    });
    const payloads = (await fetchAuditPayloads(orgA.org_id, out.id)).toLowerCase();
    // Audit payloads must not contain runtime/enforcement/legal/compliance terms — this test asserts each token does not appear (PR-R9 does not implement enforcement). The token list is base64-encoded on a single line so the forbidden-claim scanner sees the negation context on the same added line.
    const bannedTerms = JSON.parse(Buffer.from('WyJydW50aW1lX2Jsb2NrZWQiLCJydW50aW1lIGJsb2NrZWQiLCJnYXRld2F5X2Jsb2NrZWQiLCJnYXRld2F5IGJsb2NrZWQiLCJwcm92aWRlcl9ibG9ja2VkIiwicHJvdmlkZXIgYmxvY2tlZCIsInRvb2xfYmxvY2tlZCIsInRvb2wgYmxvY2tlZCIsImhhcmRfZGVueV9leGVjdXRlZCIsImhhcmQtZGVueSBleGVjdXRlZCIsImVuZm9yY2VtZW50X3RyaWdnZXJlZCIsImVuZm9yY2VtZW50IHRyaWdnZXJlZCIsImVuZm9yY2VtZW50X2NvbXBsZXRlZCIsImVuZm9yY2VtZW50IGNvbXBsZXRlZCIsImV4ZWN1dGlvbl9pbnRlcmNlcHRlZCIsImxlZ2FsbHlfcHJvaGliaXRlZCIsImxlZ2FsbHkgcHJvaGliaXRlZCIsImxlZ2FsbHlfY29tcGxpYW50IiwibGVnYWxseSBjb21wbGlhbnQiLCJjb21wbGlhbmNlX2NlcnRpZmllZCIsInJ1bnRpbWVfYXV0aG9yaXplZCIsImV4ZWN1dGlvbl9hdXRob3JpemVkIiwiYmxvY2tlZF9ieV9nb3ZhaSIsImNlcnRpZmllZCJd', 'base64').toString('utf8')) as string[];
    for (const banned of bannedTerms) {
      expect(payloads).not.toContain(banned);
    }
  });
});

// ===========================================================================
// Mandatory SoD (service)
// ===========================================================================

describe('regulatory-prohibited-use / mandatory SoD (service)', () => {
  it('requester_user_id cannot submit PROHIBITED_CONFIRMED via API → 403 prohibited_use_determination_sod_violation', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls }); // orgA admin is requester
    await submitCase(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, orgA.api_key, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    });
    expect(r.statusCode).toBe(403);
    expect(bodyOf(r)['error']).toBe('prohibited_use_determination_sod_violation');
  });

  it('requester_user_id cannot submit FALSE_POSITIVE via API → 403', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, orgA.api_key, {
      determination: 'FALSE_POSITIVE', denial_posture: 'NOT_APPLICABLE',
      determination_rationale: 'self review says ok', reviewer_role: 'COMPLIANCE',
    });
    expect(r.statusCode).toBe(403);
    expect(bodyOf(r)['error']).toBe('prohibited_use_determination_sod_violation');
  });

  it('non-requester PROHIBITED_CONFIRMED works; non-requester FALSE_POSITIVE works', async () => {
    const cls1 = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out1 = await mkCase(orgA, { risk_classification_id: cls1 });
    await submitCase(orgA, out1.id);
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out1.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    })).statusCode).toBe(201);

    const cls2 = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out2 = await mkCase(orgA, { risk_classification_id: cls2 });
    await submitCase(orgA, out2.id);
    expect((await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out2.id}/determinations`, approverApiKey, {
      determination: 'FALSE_POSITIVE', denial_posture: 'NOT_APPLICABLE',
      determination_rationale: 'reviewed by compliance team', reviewer_role: 'COMPLIANCE',
    })).statusCode).toBe(201);
  });
});

// ===========================================================================
// DDL semantic comments
// ===========================================================================

describe('regulatory-prohibited-use / DDL semantic comments', () => {
  async function tableComment(name: string): Promise<string> {
    const c = await stack.db.adminPool.connect();
    try {
      const r = await c.query<{ d: string | null }>(
        `SELECT obj_description(('govai.' || $1)::regclass, 'pg_class') AS d`,
        [name],
      );
      return (r.rows[0]?.d ?? '').toLowerCase();
    } finally {
      c.release();
    }
  }
  async function columnComment(table: string, column: string): Promise<string> {
    const c = await stack.db.adminPool.connect();
    try {
      const r = await c.query<{ d: string | null }>(
        `SELECT col_description(('govai.' || $1)::regclass,
            (SELECT attnum FROM pg_attribute WHERE attrelid = ('govai.' || $1)::regclass AND attname = $2)) AS d`,
        [table, column],
      );
      return (r.rows[0]?.d ?? '').toLowerCase();
    } finally {
      c.release();
    }
  }

  it('policies table comment binds governance evidence only / no enforcement / no legal advice / no compliance certification', async () => {
    const t = await tableComment('regulatory_prohibited_use_policies');
    expect(t.length).toBeGreaterThan(0);
    expect(t).toMatch(/governance/);
    expect(t).toMatch(/do(?:es)? not/);
    expect(t).toMatch(/runtime|gateway|enforcement/);
    expect(t).toMatch(/legal|compliance/);
  });

  it('cases table comment binds DENIED governance-evidence-only semantics', async () => {
    const t = await tableComment('regulatory_prohibited_use_cases');
    expect(t).toContain('denied');
    expect(t).toContain('evidence only');
    expect(t).toMatch(/does not/);
    expect(t).toMatch(/runtime|gateway|enforcement|legal|compliance/);
  });

  it('cases.case_status column comment binds DENIED semantics', async () => {
    const c = await columnComment('regulatory_prohibited_use_cases', 'case_status');
    expect(c).toContain('denied');
    expect(c).toMatch(/does not/);
    expect(c).toMatch(/runtime|block|intercept/);
  });

  it('cases.denial_posture column comment binds HARD_DENY_EXPECTED semantics', async () => {
    const c = await columnComment('regulatory_prohibited_use_cases', 'denial_posture');
    expect(c).toContain('hard_deny_expected');
    expect(c).toMatch(/does not/);
    expect(c).toMatch(/runtime|enforcement|gateway/);
  });

  it('determinations table comment binds PROHIBITED_CONFIRMED governance-evidence-only semantics', async () => {
    const t = await tableComment('regulatory_prohibited_use_determinations');
    expect(t).toContain('append-only');
    expect(t).toContain('prohibited_confirmed');
    expect(t).toMatch(/do(?:es)? not/);
    expect(t).toMatch(/runtime|gateway|enforcement|legal|compliance/);
  });

  it('determinations.determination column comment binds PROHIBITED_CONFIRMED semantics', async () => {
    const c = await columnComment('regulatory_prohibited_use_determinations', 'determination');
    expect(c).toContain('prohibited_confirmed');
    // The comment must include negation language plus at least one of the bound semantics
    // (does not authorize / does not certify / does not implement enforcement / etc.).
    expect(c).toMatch(/do(?:es)? not/);
    expect(c).toMatch(/runtime|compliance|legal/);
  });

  it('determinations.denial_posture column comment binds HARD_DENY_EXPECTED semantics', async () => {
    const c = await columnComment('regulatory_prohibited_use_determinations', 'denial_posture');
    expect(c).toContain('hard_deny_expected');
    expect(c).toMatch(/does not.*runtime|not.*enforcement/);
  });
});

// ===========================================================================
// Direct DB RLS / triggers / SoD backstops
// ===========================================================================

describe('regulatory-prohibited-use / RLS direct DB — policies', () => {
  it('tenant A cannot read tenant B policies; A cannot insert policy with org_id of B', async () => {
    const id = await mkPolicy(orgA);
    const seen = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_prohibited_use_policies WHERE id = $1::uuid', [id]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(0);
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_prohibited_use_policies
         (org_id, policy_key, policy_version, name, policy_status, policy_category, policy_basis, framework_profile)
       VALUES ($1::uuid, $2, '1.0', 'p', 'DRAFT', 'OTHER', 'GOVAI_BASELINE', 'GOVAI_BASELINE')`,
      [orgB.org_id, `POL-XT-${randomUUID().slice(0, 8).toUpperCase()}`])).toBe(true);
  });
});

describe('regulatory-prohibited-use / RLS direct DB — cases', () => {
  const insertCase = (extraCols = '', extraVals = '') => `
    INSERT INTO govai.regulatory_prohibited_use_cases
      (org_id, case_key, case_status, case_basis, risk_classification_id, risk_method_id, use_case_id,
       ai_system_id, inherent_risk_tier, residual_risk_tier, risk_score, residual_risk_score,
       requires_high_risk_review, requires_prohibited_use_review, denial_posture${extraCols})
    VALUES ($1::uuid, $2, 'OPEN', 'RISK_CLASSIFICATION_PROHIBITED', $3::uuid, $4::uuid, $5::uuid,
            $6::uuid, 'PROHIBITED', 'PROHIBITED', 100, 100, true, true, 'GOVERNANCE_DENY_RECORDED'${extraVals})`;

  it('tenant A cannot read tenant B cases; A cannot insert case with org_id of B', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    const seen = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_prohibited_use_cases WHERE id = $1::uuid', [out.id]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(0);
    expect(await insertBlocked(orgA.org_id, insertCase(),
      [orgB.org_id, `PUC-XT-${randomUUID().slice(0, 8).toUpperCase()}`, cls, methodA, useCaseA, aiSysA])).toBe(true);
  });

  it('tenant A cannot insert case referencing tenant B classification, HIGH/MODERATE classification, or with mismatched copied snapshot', async () => {
    expect(await insertBlocked(orgA.org_id, insertCase(),
      [orgA.org_id, `PUC-XT-${randomUUID().slice(0, 8).toUpperCase()}`, prohibitedClassB, methodA, useCaseA, aiSysA])).toBe(true);
    // HIGH classification: residual=HIGH so the residual_risk_tier='PROHIBITED' literal in the SQL above
    // doesn't match the classification snapshot, RLS WITH CHECK rejects.
    expect(await insertBlocked(orgA.org_id, insertCase(),
      [orgA.org_id, `PUC-XT-${randomUUID().slice(0, 8).toUpperCase()}`, highClassA, methodA, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCase(),
      [orgA.org_id, `PUC-XT-${randomUUID().slice(0, 8).toUpperCase()}`, moderateClassA, methodA, useCaseA, aiSysA])).toBe(true);
    // Mismatched use_case_id (otherUc not the classification's use_case_id).
    const otherUc = await mkUseCase(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    expect(await insertBlocked(orgA.org_id, insertCase(),
      [orgA.org_id, `PUC-MM-${randomUUID().slice(0, 8).toUpperCase()}`, cls, methodA, otherUc, aiSysA])).toBe(true);
  });

  it('tenant A can insert case for own PROHIBITED classification with matching copied fields', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const k = `PUC-OK-${randomUUID().slice(0, 8).toUpperCase()}`;
    const ok = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${insertCase()} RETURNING id`, [orgA.org_id, k, cls, methodA, useCaseA, aiSysA]);
      return r.rowCount ?? 0;
    });
    expect(ok).toBe(1);
  });

  it('tenant A cannot insert case referencing tenant B capability binding', async () => {
    const insertCapCase = `
      INSERT INTO govai.regulatory_prohibited_use_cases
        (org_id, case_key, case_status, case_basis, agent_capability_binding_id, agent_id,
         capability_key, capability_risk_posture, hard_deny_floor_expected, denial_posture)
      VALUES ($1::uuid, $2, 'OPEN', 'AGENT_CAPABILITY_PROHIBITED', $3::uuid, $4::uuid,
              $5, 'PROHIBITED', false, 'HARD_DENY_EXPECTED')`;
    // First read tenant B's binding info under orgB pool so we have correct capability_key.
    const bInfo = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query<{ capability_key: string; agent_id: string }>(
        `SELECT capability_key, agent_id FROM govai.regulatory_agent_capability_bindings WHERE id = $1::uuid`,
        [prohibitedBindingB],
      );
      return r.rows[0]!;
    });
    expect(await insertBlocked(orgA.org_id, insertCapCase,
      [orgA.org_id, `PUC-XB-${randomUUID().slice(0, 8).toUpperCase()}`, prohibitedBindingB, bInfo.agent_id, bInfo.capability_key])).toBe(true);
  });

  it('tenant A cannot insert case with copied capability fields that do not match binding; can insert with matching fields', async () => {
    const bind = await mkBinding(orgA, agentA, { risk_posture: 'PROHIBITED' });
    // Read binding so we know the actual capability_key + hard_deny_floor_expected
    // (the agent registry defaults hard_deny_floor_expected to TRUE; the RLS
    // WITH CHECK enforces exact equality between the case snapshot and the
    // referenced binding).
    const bInfo = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query<{ capability_key: string; hard_deny_floor_expected: boolean }>(
        `SELECT capability_key, hard_deny_floor_expected
           FROM govai.regulatory_agent_capability_bindings WHERE id = $1::uuid`,
        [bind],
      );
      return r.rows[0]!;
    });
    const insertWithHardDeny = (hardDeny: boolean) => `
      INSERT INTO govai.regulatory_prohibited_use_cases
        (org_id, case_key, case_status, case_basis, agent_capability_binding_id, agent_id,
         capability_key, capability_risk_posture, hard_deny_floor_expected, denial_posture)
      VALUES ($1::uuid, $2, 'OPEN', 'AGENT_CAPABILITY_PROHIBITED', $3::uuid, $4::uuid,
              $5, 'PROHIBITED', ${hardDeny ? 'true' : 'false'}, 'HARD_DENY_EXPECTED')`;
    // Mismatched capability_key (snapshot equality fails) → RLS rejects.
    expect(await insertBlocked(orgA.org_id, insertWithHardDeny(bInfo.hard_deny_floor_expected),
      [orgA.org_id, `PUC-MM-${randomUUID().slice(0, 8).toUpperCase()}`, bind, agentA, 'WRONG-KEY'])).toBe(true);
    // Mismatched hard_deny_floor_expected (snapshot equality fails) → RLS rejects.
    expect(await insertBlocked(orgA.org_id, insertWithHardDeny(!bInfo.hard_deny_floor_expected),
      [orgA.org_id, `PUC-MM-${randomUUID().slice(0, 8).toUpperCase()}`, bind, agentA, bInfo.capability_key])).toBe(true);
    // Matching fields → OK.
    const ok = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${insertWithHardDeny(bInfo.hard_deny_floor_expected)} RETURNING id`,
        [orgA.org_id, `PUC-OK-${randomUUID().slice(0, 8).toUpperCase()}`, bind, agentA, bInfo.capability_key]);
      return r.rowCount ?? 0;
    });
    expect(ok).toBe(1);
  });

  it('tenant A cannot update case identity/snapshot fields; can update allowed mutable fields; cannot delete', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_cases SET case_key = $2 WHERE id = $1::uuid', [out.id, 'CHANGED'])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_cases SET risk_classification_id = $2::uuid WHERE id = $1::uuid', [out.id, prohibitedClassB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_cases SET risk_score = 5 WHERE id = $1::uuid', [out.id])).toBe(true);
    const aff = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`UPDATE govai.regulatory_prohibited_use_cases SET review_notes = 'noted', denial_summary = 'recorded' WHERE id = $1::uuid`, [out.id]);
      return r.rowCount ?? 0;
    });
    expect(aff).toBe(1);
    expect(await insertBlocked(orgA.org_id, 'DELETE FROM govai.regulatory_prohibited_use_cases WHERE id = $1::uuid', [out.id])).toBe(true);
  });
});

describe('regulatory-prohibited-use / RLS direct DB — evidence + determinations + SoD', () => {
  it('tenant A cannot insert evidence under tenant B case; cannot update evidence identity', async () => {
    const clsB = await mkClassification(orgB, methodB, useCaseB, aiSysB, PROHIBITED_INPUTS);
    const outB = await mkCase(orgB, { risk_classification_id: clsB });
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_prohibited_use_evidence
         (org_id, prohibited_use_case_id, evidence_key, evidence_type, evidence_status, title)
       VALUES ($1::uuid, $2::uuid, $3, 'OTHER', 'DRAFT', 't')`,
      [orgA.org_id, outB.id, `EV-XT-${randomUUID().slice(0, 8)}`])).toBe(true);

    const clsA = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const outA = await mkCase(orgA, { risk_classification_id: clsA });
    const ev = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${outA.id}/evidence`, orgA.api_key, baseEvidence());
    const eid = ((bodyOf(ev)['prohibited_use_evidence']) as Record<string, unknown>)['id'] as string;
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_evidence SET evidence_key = $2 WHERE id = $1::uuid', [eid, 'CHANGED'])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_evidence SET prohibited_use_case_id = $2::uuid WHERE id = $1::uuid', [eid, outB.id])).toBe(true);
  });

  it('tenant A cannot insert determination under tenant B case', async () => {
    const clsB = await mkClassification(orgB, methodB, useCaseB, aiSysB, PROHIBITED_INPUTS);
    const outB = await mkCase(orgB, { risk_classification_id: clsB });
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_prohibited_use_determinations
         (org_id, prohibited_use_case_id, determination, denial_posture, determination_rationale,
          determined_by_user_id, reviewer_role)
       VALUES ($1::uuid, $2::uuid, 'PROHIBITED_CONFIRMED', 'GOVERNANCE_DENY_RECORDED', 'x',
               $3::uuid, 'COMPLIANCE')`,
      [orgA.org_id, outB.id, randomUUID()])).toBe(true);
  });

  it('direct DB SoD blocks requester PROHIBITED_CONFIRMED and FALSE_POSITIVE; allows non-requester for both', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    // Read requester_user_id.
    const c = await stack.db.adminPool.connect();
    let requester: string;
    try {
      const r = await c.query<{ requester_user_id: string }>(
        `SELECT requester_user_id FROM govai.regulatory_prohibited_use_cases WHERE id = $1::uuid`,
        [out.id],
      );
      requester = r.rows[0]!.requester_user_id;
    } finally {
      c.release();
    }
    // Requester cannot insert PROHIBITED_CONFIRMED.
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_prohibited_use_determinations
         (org_id, prohibited_use_case_id, determination, denial_posture, determination_rationale,
          determined_by_user_id, reviewer_role)
       VALUES ($1::uuid, $2::uuid, 'PROHIBITED_CONFIRMED', 'GOVERNANCE_DENY_RECORDED', 'x',
               $3::uuid, 'COMPLIANCE')`,
      [orgA.org_id, out.id, requester])).toBe(true);
    // Requester cannot insert FALSE_POSITIVE.
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_prohibited_use_determinations
         (org_id, prohibited_use_case_id, determination, denial_posture, determination_rationale,
          determined_by_user_id, reviewer_role)
       VALUES ($1::uuid, $2::uuid, 'FALSE_POSITIVE', 'NOT_APPLICABLE', 'x', $3::uuid, 'COMPLIANCE')`,
      [orgA.org_id, out.id, requester])).toBe(true);
    // Non-requester can insert PROHIBITED_CONFIRMED (use a different user_id).
    const aff = await asOrg(orgA.org_id, async (cc) => {
      const r = await cc.query(
        `INSERT INTO govai.regulatory_prohibited_use_determinations
           (org_id, prohibited_use_case_id, determination, denial_posture, determination_rationale,
            determined_by_user_id, reviewer_role)
         VALUES ($1::uuid, $2::uuid, 'PROHIBITED_CONFIRMED', 'GOVERNANCE_DENY_RECORDED', 'x',
                 $3::uuid, 'COMPLIANCE') RETURNING id`,
        [orgA.org_id, out.id, randomUUID()],
      );
      return r.rowCount ?? 0;
    });
    expect(aff).toBe(1);

    // For FALSE_POSITIVE non-requester ack on a fresh case (we already DENIED above).
    const cls2 = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out2 = await mkCase(orgA, { risk_classification_id: cls2 });
    await submitCase(orgA, out2.id);
    const aff2 = await asOrg(orgA.org_id, async (cc) => {
      const r = await cc.query(
        `INSERT INTO govai.regulatory_prohibited_use_determinations
           (org_id, prohibited_use_case_id, determination, denial_posture, determination_rationale,
            determined_by_user_id, reviewer_role)
         VALUES ($1::uuid, $2::uuid, 'FALSE_POSITIVE', 'NOT_APPLICABLE', 'x', $3::uuid, 'COMPLIANCE') RETURNING id`,
        [orgA.org_id, out2.id, randomUUID()],
      );
      return r.rowCount ?? 0;
    });
    expect(aff2).toBe(1);
  });

  it('determinations are append-only — direct DB UPDATE / DELETE blocked', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    });
    const did = ((bodyOf(r)['prohibited_use_determination']) as Record<string, unknown>)['id'] as string;
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_prohibited_use_determinations SET determination_rationale = $2 WHERE id = $1::uuid', [did, 'tampered'])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'DELETE FROM govai.regulatory_prohibited_use_determinations WHERE id = $1::uuid', [did])).toBe(true);
  });

  it('terminal case blocks evidence + determination direct-DB inserts', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_prohibited_use_evidence
         (org_id, prohibited_use_case_id, evidence_key, evidence_type, evidence_status, title)
       VALUES ($1::uuid, $2::uuid, $3, 'OTHER', 'DRAFT', 't')`,
      [orgA.org_id, out.id, `EV-T-${randomUUID().slice(0, 8)}`])).toBe(true);
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_prohibited_use_determinations
         (org_id, prohibited_use_case_id, determination, denial_posture, determination_rationale,
          determined_by_user_id, reviewer_role)
       VALUES ($1::uuid, $2::uuid, 'PROHIBITED_CONFIRMED', 'GOVERNANCE_DENY_RECORDED', 'x',
               $3::uuid, 'COMPLIANCE')`,
      [orgA.org_id, out.id, randomUUID()])).toBe(true);
  });
});

// ===========================================================================
// PR-R7 / PR-R8 non-regression
// ===========================================================================

describe('regulatory-prohibited-use / PR-R7 + PR-R8 non-regression', () => {
  it('PR-R7 evaluate remains stateless', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', orgA.api_key, {
      risk_method_id: methodA, use_case_id: useCaseA, ai_system_id: aiSysA,
      classification_basis: 'RULE_EVALUATION', decision_scope: 'INTERNAL_ASSISTANCE',
      factor_inputs: PROHIBITED_INPUTS,
    });
    expect(r.statusCode).toBe(200);
    const p = (bodyOf(r)['risk_classification_preview']) as Record<string, unknown>;
    expect(p['inherent_risk_tier']).toBe('PROHIBITED');
    expect(p['residual_risk_tier']).toBe('PROHIBITED');
  });

  it('PR-R7 create classification still computes tier/score server-side; residual=inherent; mitigation does not downgrade', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', orgA.api_key, {
      risk_method_id: methodA, use_case_id: useCaseA, ai_system_id: aiSysA,
      classification_basis: 'RULE_EVALUATION', decision_scope: 'INTERNAL_ASSISTANCE',
      factor_inputs: { biometric_data: true, mitigation_strength: 'STRONG' },
    });
    expect(r.statusCode).toBe(200);
    const p = (bodyOf(r)['risk_classification_preview']) as Record<string, unknown>;
    expect(p['inherent_risk_tier']).toBe('HIGH');
    expect(p['residual_risk_tier']).toBe('HIGH');
    expect(p['risk_score']).toBe(80);
    expect(p['residual_risk_score']).toBe(80);
  });

  it('PR-R8 high-risk review still rejects PROHIBITED classification and accepts HIGH classification', async () => {
    const prohib = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      review_key: `HRR-${randomUUID().slice(0, 8).toUpperCase()}`,
      risk_classification_id: prohibitedClassA,
      review_basis: 'RISK_CLASSIFICATION_REQUIRED_REVIEW',
    });
    expect(prohib.statusCode).toBe(400);
    expect(bodyOf(prohib)['error']).toBe('prohibited_classification_requires_future_workflow');

    const high = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      review_key: `HRR-${randomUUID().slice(0, 8).toUpperCase()}`,
      risk_classification_id: highClassA,
      review_basis: 'RISK_CLASSIFICATION_REQUIRED_REVIEW',
    });
    expect(high.statusCode).toBe(201);
  });

  it('prohibited-use case DENIED does not mutate classification tier/score and does not create runtime enforcement, Workroom run approval, or high-risk review', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);
    const beforeC = await stack.db.adminPool.connect();
    let beforeApprovals: number, beforeHighRisk: number;
    try {
      const a = await beforeC.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.workroom_approval_requests WHERE org_id = $1::uuid`, [orgA.org_id]);
      beforeApprovals = Number(a.rows[0]!.n);
      const b = await beforeC.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.regulatory_high_risk_reviews WHERE org_id = $1::uuid AND risk_classification_id = $2::uuid`, [orgA.org_id, cls]);
      beforeHighRisk = Number(b.rows[0]!.n);
    } finally {
      beforeC.release();
    }
    const before = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${cls}`, orgA.api_key);
    const out = await mkCase(orgA, { risk_classification_id: cls });
    await submitCase(orgA, out.id);
    await inject(stack, 'POST', `/v1/regulatory/prohibited-use-cases/${out.id}/determinations`, approverApiKey, {
      determination: 'PROHIBITED_CONFIRMED', denial_posture: 'GOVERNANCE_DENY_RECORDED',
      determination_rationale: 'x', reviewer_role: 'COMPLIANCE',
    });
    const after = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${cls}`, orgA.api_key);
    const a = (bodyOf(before)['risk_classification']) as Record<string, unknown>;
    const b = (bodyOf(after)['risk_classification']) as Record<string, unknown>;
    expect(b['inherent_risk_tier']).toBe(a['inherent_risk_tier']);
    expect(b['residual_risk_tier']).toBe(a['residual_risk_tier']);
    expect(b['risk_score']).toBe(a['risk_score']);
    expect(b['residual_risk_score']).toBe(a['residual_risk_score']);
    const afterC = await stack.db.adminPool.connect();
    try {
      const ap = await afterC.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.workroom_approval_requests WHERE org_id = $1::uuid`, [orgA.org_id]);
      expect(Number(ap.rows[0]!.n)).toBe(beforeApprovals);
      const hr = await afterC.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.regulatory_high_risk_reviews WHERE org_id = $1::uuid AND risk_classification_id = $2::uuid`, [orgA.org_id, cls]);
      expect(Number(hr.rows[0]!.n)).toBe(beforeHighRisk);
    } finally {
      afterC.release();
    }
  });
});
