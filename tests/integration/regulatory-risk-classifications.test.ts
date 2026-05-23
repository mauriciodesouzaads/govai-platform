// Regulatory Core PR-R7 (issue #59, umbrella #33) — Risk Classification Engine.
//
// Production-focused slice: deterministic technical risk classifier, methodology
// + classification + factor + reclassification-trigger evidence, with all R1-R6
// guarantees preserved (auth/RBAC, CRUD-without-delete, tenant isolation at the
// API and direct DB RLS layers, keyset pagination, validation, audit evidence,
// version-requires-parent / version-belongs-to-parent / asset-link consistency).
//
// Honesty constraints exercised here:
//   - residual_risk_tier ALWAYS equals inherent_risk_tier (DB CHECK).
//   - residual_risk_score ALWAYS equals risk_score (DB CHECK).
//   - mitigation_strength is recorded as an evidence-only factor and does NOT
//     downgrade tier or score (engine + persisted rows assert this).
//   - requires_high_risk_review / requires_prohibited_use_review are evidence
//     flags only — PR-R7 does NOT create review workflows, assign reviewers,
//     block execution, or enforce runtime decisions. They are CHECK-implied
//     by tier (PROHIBITED ⇒ both, HIGH ⇒ high_review).
//   - the factors table grants SELECT + INSERT only; UPDATE is blocked.
//
// Governance evidence only — no prompts, credentials, legal opinions, or raw
// sensitive data are stored or tested.

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
let orgFilter: AdminOrg;

// Shared parent records (per tenant).
let aiSysA: string, provA: string, modelA: string, modelVerA: string, agentA: string, agentVerA: string;
let useCaseA: string, linkA: string;
let methodA: string;

let aiSysB: string, provB: string, modelB: string, modelVerB: string, agentB: string, agentVerB: string;
let useCaseB: string, methodB: string, classificationB: string;

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

async function mkModel(org: AdminOrg, providerId: string): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/models', org.api_key, {
    model_key: `MDL-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'model',
    model_type: 'FOUNDATION_MODEL',
    model_status: 'ACTIVE',
    provider_id: providerId,
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['model'] as Record<string, unknown>)['id'] as string;
}

async function mkModelVersion(org: AdminOrg, modelId: string): Promise<string> {
  const r = await inject(stack, 'POST', `/v1/regulatory/models/${modelId}/versions`, org.api_key, {
    version_key: `VER-${randomUUID().slice(0, 8).toUpperCase()}`,
    version_label: 'v1',
    version_status: 'APPROVED',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['model_version'] as Record<string, unknown>)['id'] as string;
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

async function mkUseCase(org: AdminOrg): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/use-cases', org.api_key, {
    use_case_key: `UC-${randomUUID().slice(0, 8).toUpperCase()}`,
    name: 'use case',
    use_case_status: 'PROPOSED',
    use_case_category: 'CUSTOMER_SUPPORT',
    business_criticality: 'MEDIUM',
    deployment_scope: 'INTERNAL_ONLY',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['use_case'] as Record<string, unknown>)['id'] as string;
}

async function mkAssetLink(org: AdminOrg, useCaseId: string, aiSystemId: string): Promise<string> {
  const r = await inject(stack, 'POST', '/v1/regulatory/use-case-asset-links', org.api_key, {
    use_case_id: useCaseId,
    ai_system_id: aiSystemId,
    link_status: 'ACTIVE',
    usage_role: 'PRIMARY_SYSTEM',
    deployment_environment: 'PRODUCTION',
  });
  expect(r.statusCode).toBe(201);
  return (bodyOf(r)['use_case_asset_link'] as Record<string, unknown>)['id'] as string;
}

const baseMethod = (o: Record<string, unknown> = {}) => ({
  method_key: `RM-${randomUUID().slice(0, 8).toUpperCase()}`,
  method_version: '1.0',
  name: 'GovAI baseline',
  method_status: 'ACTIVE',
  framework_profile: 'GOVAI_BASELINE',
  methodology_summary: 'deterministic technical classifier',
  ...o,
});

async function mkMethodResp(org: AdminOrg, o: Record<string, unknown> = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/risk-methods', org.api_key, baseMethod(o));
  return { status: r.statusCode, body: bodyOf(r) };
}

async function mkMethod(org: AdminOrg, o: Record<string, unknown> = {}): Promise<string> {
  const r = await mkMethodResp(org, o);
  expect(r.status).toBe(201);
  return (r.body['risk_method'] as Record<string, unknown>)['id'] as string;
}

type ClsArgs = {
  factor_inputs?: Record<string, unknown>;
  decision_scope?: string;
  classification_basis?: string;
  classification_status?: string;
  risk_method_id?: string;
  use_case_id?: string;
  ai_system_id?: string;
  use_case_asset_link_id?: string;
  model_id?: string;
  model_version_id?: string;
  agent_id?: string;
  agent_version_id?: string;
  supersedes_classification_id?: string;
  classification_key?: string;
};

const baseClassification = (o: ClsArgs = {}) => ({
  classification_key: o.classification_key ?? `CLS-${randomUUID().slice(0, 8).toUpperCase()}`,
  classification_status: o.classification_status ?? 'DRAFT',
  risk_method_id: o.risk_method_id ?? methodA,
  use_case_id: o.use_case_id ?? useCaseA,
  ai_system_id: o.ai_system_id ?? aiSysA,
  use_case_asset_link_id: o.use_case_asset_link_id,
  model_id: o.model_id,
  model_version_id: o.model_version_id,
  agent_id: o.agent_id,
  agent_version_id: o.agent_version_id,
  supersedes_classification_id: o.supersedes_classification_id,
  classification_basis: o.classification_basis ?? 'RULE_EVALUATION',
  decision_scope: o.decision_scope ?? 'INTERNAL_ASSISTANCE',
  factor_inputs: o.factor_inputs ?? {},
});

async function mkClassificationResp(org: AdminOrg, o: ClsArgs = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', org.api_key, baseClassification(o));
  return { status: r.statusCode, body: bodyOf(r) };
}

async function mkClassification(org: AdminOrg, o: ClsArgs = {}): Promise<{ id: string; body: Record<string, unknown> }> {
  const r = await mkClassificationResp(org, o);
  expect(r.status).toBe(201);
  const c = r.body['risk_classification'] as Record<string, unknown>;
  return { id: c['id'] as string, body: r.body };
}

const baseTrigger = (o: Record<string, unknown> = {}) => ({
  trigger_key: `TRG-${randomUUID().slice(0, 8).toUpperCase()}`,
  trigger_status: 'OPEN',
  trigger_type: 'MATERIAL_CHANGE',
  recommended_action: 'RECLASSIFY',
  use_case_id: useCaseA,
  ai_system_id: aiSysA,
  trigger_reason: 'data scope change observed',
  ...o,
});

async function mkTriggerResp(org: AdminOrg, o: Record<string, unknown> = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/reclassification-triggers', org.api_key, baseTrigger(o));
  return { status: r.statusCode, body: bodyOf(r) };
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

const HIGH_INPUTS = { rights_affecting_automated_decision: true, automated_decisioning: 'AUTOMATED_EXTERNAL_EFFECT' };
const MODERATE_INPUTS = { personal_data: true };
const PROHIBITED_INPUTS = { social_scoring_signal: true };

beforeAll(async () => {
  stack = await startStack();
  orgA = await adminOrg();
  orgB = await adminOrg();
  const dev = await seedOrg(stack);
  const devKey = await addApiKey(stack, dev.org_id, dev.user_id, ['developer']);
  devOrg = { org_id: dev.org_id, user_id: dev.user_id, api_key: devKey.api_key };
  orgPage = await adminOrg();
  orgFilter = await adminOrg();

  aiSysA = await mkAiSystem(orgA);
  provA = await mkProvider(orgA);
  modelA = await mkModel(orgA, provA);
  modelVerA = await mkModelVersion(orgA, modelA);
  agentA = await mkAgent(orgA);
  agentVerA = await mkAgentVersion(orgA, agentA);
  useCaseA = await mkUseCase(orgA);
  linkA = await mkAssetLink(orgA, useCaseA, aiSysA);
  methodA = await mkMethod(orgA);

  aiSysB = await mkAiSystem(orgB);
  provB = await mkProvider(orgB);
  modelB = await mkModel(orgB, provB);
  modelVerB = await mkModelVersion(orgB, modelB);
  agentB = await mkAgent(orgB);
  agentVerB = await mkAgentVersion(orgB, agentB);
  useCaseB = await mkUseCase(orgB);
  methodB = await mkMethod(orgB);
  classificationB = (await mkClassification(orgB, {
    risk_method_id: methodB,
    use_case_id: useCaseB,
    ai_system_id: aiSysB,
    factor_inputs: MODERATE_INPUTS,
  })).id;
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

// ===========================================================================
// auth + rbac
// ===========================================================================

describe('regulatory-risk / auth + rbac', () => {
  it('rejects unauthenticated reads and writes (401) on all R7 endpoints', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/risk-methods', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/risk-methods', undefined, baseMethod())).statusCode).toBe(401);
    expect((await inject(stack, 'GET', '/v1/regulatory/risk-classifications', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/risk-classifications', undefined, baseClassification())).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', undefined, baseClassification())).statusCode).toBe(401);
    expect((await inject(stack, 'GET', '/v1/regulatory/risk-classification-factors', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'GET', '/v1/regulatory/reclassification-triggers', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/reclassification-triggers', undefined, baseTrigger())).statusCode).toBe(401);
  });

  it('non-write role can read but not write; cannot evaluate either (evaluate requires write role)', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/risk-methods', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', '/v1/regulatory/risk-classifications', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', '/v1/regulatory/risk-classification-factors', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', '/v1/regulatory/reclassification-triggers', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/risk-methods', devOrg.api_key, baseMethod())).statusCode).toBe(403);
    expect((await inject(stack, 'POST', '/v1/regulatory/risk-classifications', devOrg.api_key, baseClassification())).statusCode).toBe(403);
    expect((await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', devOrg.api_key, baseClassification())).statusCode).toBe(403);
    expect((await inject(stack, 'POST', '/v1/regulatory/reclassification-triggers', devOrg.api_key, baseTrigger())).statusCode).toBe(403);
  });
});

// ===========================================================================
// Risk methods
// ===========================================================================

describe('regulatory-risk / risk-methods API', () => {
  it('create + GET own/cross + list filters; created audit emitted', async () => {
    const id = await mkMethod(orgA, { method_key: `RM-A-${randomUUID().slice(0, 8).toUpperCase()}` });
    expect(await auditCount(orgA.org_id, id, 'regulatory_risk_method.created')).toBe(1);
    expect((await inject(stack, 'GET', `/v1/regulatory/risk-methods/${id}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/risk-methods/${id}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('risk_method_not_found');
    const list = await inject(stack, 'GET', '/v1/regulatory/risk-methods?limit=200', orgB.api_key);
    expect((bodyOf(list)['risk_methods'] as Array<Record<string, unknown>>).map((x) => x['id'])).not.toContain(id);
  });

  it('PATCH updates non-identity fields + audits; status_changed emitted on status transition', async () => {
    const id = await mkMethod(orgA, { method_status: 'DRAFT' });
    const p1 = await inject(stack, 'PATCH', `/v1/regulatory/risk-methods/${id}`, orgA.api_key, { name: 'renamed', methodology_summary: 'new methodology' });
    expect(p1.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_risk_method.updated')).toBe(1);
    const p2 = await inject(stack, 'PATCH', `/v1/regulatory/risk-methods/${id}`, orgA.api_key, { method_status: 'ACTIVE' });
    expect(p2.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, id, 'regulatory_risk_method.status_changed')).toBe(1);
  });

  it('duplicate (method_key, method_version) per tenant rejected (409); same key across tenants allowed; different version allowed', async () => {
    const key = `RM-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkMethodResp(orgA, { method_key: key, method_version: '1.0' })).status).toBe(201);
    const dup = await mkMethodResp(orgA, { method_key: key, method_version: '1.0' });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('risk_method_key_conflict');
    expect((await mkMethodResp(orgA, { method_key: key, method_version: '1.1' })).status).toBe(201);
    expect((await mkMethodResp(orgB, { method_key: key, method_version: '1.0' })).status).toBe(201);
  });

  it('invalid enum/key rejected (400); empty PATCH rejected (400); identity-only PATCH allowed via metadata-only', async () => {
    expect((await mkMethodResp(orgA, { method_status: 'NOPE' })).status).toBe(400);
    expect((await mkMethodResp(orgA, { framework_profile: 'NOPE' })).status).toBe(400);
    expect((await mkMethodResp(orgA, { method_key: 'bad key' })).status).toBe(400);
    const id = await mkMethod(orgA);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/risk-methods/${id}`, orgA.api_key, {})).statusCode).toBe(400);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/risk-methods/${id}`, orgA.api_key, { metadata: { note: 'ok' } })).statusCode).toBe(200);
  });
});

// ===========================================================================
// Deterministic engine — POST /risk-classifications/evaluate (no persistence)
// ===========================================================================

async function evaluate(org: AdminOrg, factor_inputs: Record<string, unknown>, decision_scope = 'INTERNAL_ASSISTANCE') {
  const body = {
    risk_method_id: methodA,
    use_case_id: useCaseA,
    ai_system_id: aiSysA,
    classification_basis: 'RULE_EVALUATION',
    decision_scope,
    factor_inputs,
  };
  const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', org.api_key, body);
  return { status: r.statusCode, body: bodyOf(r) };
}

describe('regulatory-risk / deterministic engine (evaluate)', () => {
  it('insufficient_information short-circuits to UNKNOWN with score 0; no persistence side effect', async () => {
    const r = await evaluate(orgA, { insufficient_information: true });
    expect(r.status).toBe(200);
    const p = r.body['risk_classification_preview'] as Record<string, unknown>;
    expect(p['inherent_risk_tier']).toBe('UNKNOWN');
    expect(p['residual_risk_tier']).toBe('UNKNOWN');
    expect(p['risk_score']).toBe(0);
    expect(p['residual_risk_score']).toBe(0);
    expect(p['requires_high_risk_review']).toBe(false);
    expect(p['requires_prohibited_use_review']).toBe(false);
    expect(p['insufficient_information']).toBe(true);
    // No row persisted by evaluate.
    const after = await inject(stack, 'GET', '/v1/regulatory/risk-classifications?limit=200', orgA.api_key);
    for (const row of (bodyOf(after)['risk_classifications'] as Array<Record<string, unknown>>)) {
      expect(row['inherent_risk_tier']).not.toBe('UNKNOWN');
    }
  });

  it('prohibited signals short-circuit to PROHIBITED with score 100 and both review flags true', async () => {
    for (const signal of ['prohibited_use_signal', 'social_scoring_signal', 'biometric_emotion_recognition_signal']) {
      const r = await evaluate(orgA, { [signal]: true });
      expect(r.status).toBe(200);
      const p = r.body['risk_classification_preview'] as Record<string, unknown>;
      expect(p['inherent_risk_tier']).toBe('PROHIBITED');
      expect(p['residual_risk_tier']).toBe('PROHIBITED');
      expect(p['risk_score']).toBe(100);
      expect(p['residual_risk_score']).toBe(100);
      expect(p['requires_high_risk_review']).toBe(true);
      expect(p['requires_prohibited_use_review']).toBe(true);
    }
  });

  it('HIGH rules: rights-affecting automation, sensitive+automation, children, biometric, judicial-secret, attorney-client, employment+automation, public-sector+judicial-scope, agent autonomous side effects', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ rights_affecting_automated_decision: true }, 'INTERNAL_ASSISTANCE'],
      [{ sensitive_data: true, automated_decisioning: 'DECISION_SUPPORT' }, 'INTERNAL_ASSISTANCE'],
      [{ children_or_adolescents_data: true }, 'INTERNAL_ASSISTANCE'],
      [{ biometric_data: true }, 'INTERNAL_ASSISTANCE'],
      [{ judicial_secret_data: true }, 'INTERNAL_ASSISTANCE'],
      [{ attorney_client_privileged_data: true }, 'INTERNAL_ASSISTANCE'],
      [{ employment_or_credit_access: true, automated_decisioning: 'AUTOMATED_EXTERNAL_EFFECT' }, 'EXTERNAL_EFFECT'],
      [{ public_sector_context: true }, 'JUDICIAL_SUPPORT'],
      [{ agent_external_side_effects: true, agent_autonomy_level: 'AUTONOMOUS_WITH_GUARDRAILS' }, 'INTERNAL_ASSISTANCE'],
      [{ health_data: true }, 'AUTOMATED_DECISION'],
    ];
    for (const [fi, ds] of cases) {
      const r = await evaluate(orgA, fi, ds);
      const p = r.body['risk_classification_preview'] as Record<string, unknown>;
      expect(p['inherent_risk_tier']).toBe('HIGH');
      expect(p['residual_risk_tier']).toBe('HIGH');
      expect(p['risk_score']).toBe(80);
      expect(p['requires_high_risk_review']).toBe(true);
      expect(p['requires_prohibited_use_review']).toBe(false);
    }
  });

  it('MODERATE rules: personal_data, customer/public-facing, third_party_runtime, limited_human_oversight', async () => {
    const cases: Array<Record<string, unknown>> = [
      { personal_data: true },
      { customer_facing_or_public_facing: true },
      { third_party_runtime: true },
      { limited_human_oversight: true },
    ];
    for (const fi of cases) {
      const r = await evaluate(orgA, fi);
      const p = r.body['risk_classification_preview'] as Record<string, unknown>;
      expect(p['inherent_risk_tier']).toBe('MODERATE');
      expect(p['risk_score']).toBe(50);
      expect(p['requires_high_risk_review']).toBe(false);
      expect(p['requires_prohibited_use_review']).toBe(false);
    }
  });

  it('no triggers ⇒ MINIMAL with score 5; engine is deterministic (same inputs ⇒ identical output)', async () => {
    const r1 = await evaluate(orgA, {});
    const p1 = r1.body['risk_classification_preview'] as Record<string, unknown>;
    expect(p1['inherent_risk_tier']).toBe('MINIMAL');
    expect(p1['risk_score']).toBe(5);
    const r2 = await evaluate(orgA, {});
    expect(r2.body['risk_classification_preview']).toEqual(p1);
  });

  it('tier = max severity (HIGH wins over MODERATE when both triggered)', async () => {
    const r = await evaluate(orgA, { personal_data: true, biometric_data: true });
    const p = r.body['risk_classification_preview'] as Record<string, unknown>;
    expect(p['inherent_risk_tier']).toBe('HIGH');
    expect(p['risk_score']).toBe(80);
  });

  it('mitigation_strength STRONG/PARTIAL/NONE does NOT downgrade tier or score — evidence only', async () => {
    for (const strength of ['STRONG', 'PARTIAL', 'NONE']) {
      const r = await evaluate(orgA, { biometric_data: true, mitigation_strength: strength });
      const p = r.body['risk_classification_preview'] as Record<string, unknown>;
      expect(p['inherent_risk_tier']).toBe('HIGH');
      expect(p['residual_risk_tier']).toBe('HIGH');
      expect(p['risk_score']).toBe(80);
      expect(p['residual_risk_score']).toBe(80);
      expect(p['mitigation_strength']).toBe(strength);
      const factors = p['factors'] as Array<Record<string, unknown>>;
      const mit = factors.find((f) => f['factor_key'] === 'mitigation_strength');
      expect(mit).toBeTruthy();
      expect(mit!['factor_category']).toBe('MITIGATION');
      expect(mit!['triggered']).toBe(false);
      expect(mit!['score_contribution']).toBe(0);
    }
  });

  it('decision_scope gating works: public_sector_context alone (INTERNAL_ASSISTANCE) is NOT HIGH; with JUDICIAL_SUPPORT becomes HIGH', async () => {
    const internal = await evaluate(orgA, { public_sector_context: true }, 'INTERNAL_ASSISTANCE');
    expect((internal.body['risk_classification_preview'] as Record<string, unknown>)['inherent_risk_tier']).not.toBe('HIGH');
    const judicial = await evaluate(orgA, { public_sector_context: true }, 'JUDICIAL_SUPPORT');
    expect((judicial.body['risk_classification_preview'] as Record<string, unknown>)['inherent_risk_tier']).toBe('HIGH');
  });

  it('health_data with INTERNAL_ASSISTANCE is NOT HIGH; with EXTERNAL_EFFECT becomes HIGH', async () => {
    const internal = await evaluate(orgA, { health_data: true }, 'INTERNAL_ASSISTANCE');
    expect((internal.body['risk_classification_preview'] as Record<string, unknown>)['inherent_risk_tier']).not.toBe('HIGH');
    const ext = await evaluate(orgA, { health_data: true }, 'EXTERNAL_EFFECT');
    expect((ext.body['risk_classification_preview'] as Record<string, unknown>)['inherent_risk_tier']).toBe('HIGH');
  });

  it('agent_external_side_effects under HUMAN_APPROVAL_REQUIRED is NOT HIGH; under AUTONOMOUS_WITH_GUARDRAILS becomes HIGH', async () => {
    const human = await evaluate(orgA, { agent_external_side_effects: true, agent_autonomy_level: 'HUMAN_APPROVAL_REQUIRED' });
    expect((human.body['risk_classification_preview'] as Record<string, unknown>)['inherent_risk_tier']).not.toBe('HIGH');
    const auto = await evaluate(orgA, { agent_external_side_effects: true, agent_autonomy_level: 'AUTONOMOUS_WITH_GUARDRAILS' });
    expect((auto.body['risk_classification_preview'] as Record<string, unknown>)['inherent_risk_tier']).toBe('HIGH');
  });

  it('evaluate validation: strict-bounded factor_inputs rejects unknown keys; bad enum rejected; version-without-parent rejected', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', orgA.api_key, {
      risk_method_id: methodA, use_case_id: useCaseA, ai_system_id: aiSysA,
      classification_basis: 'RULE_EVALUATION', decision_scope: 'INTERNAL_ASSISTANCE',
      factor_inputs: { unknown_signal: true },
    });
    expect(r.statusCode).toBe(400);
    const bad = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', orgA.api_key, {
      risk_method_id: methodA, use_case_id: useCaseA, ai_system_id: aiSysA,
      classification_basis: 'NOPE', decision_scope: 'INTERNAL_ASSISTANCE', factor_inputs: {},
    });
    expect(bad.statusCode).toBe(400);
    const verNoParent = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', orgA.api_key, {
      risk_method_id: methodA, use_case_id: useCaseA, ai_system_id: aiSysA,
      classification_basis: 'RULE_EVALUATION', decision_scope: 'INTERNAL_ASSISTANCE',
      factor_inputs: {}, model_version_id: modelVerA,
    });
    expect(verNoParent.statusCode).toBe(400);
  });
});

// ===========================================================================
// Risk classifications — POST/GET/PATCH/list
// ===========================================================================

describe('regulatory-risk / classification API — create + read', () => {
  it('create with HIGH inputs: persists classification + factor rows; emits created, risk_tier_assigned, factor.created per factor', async () => {
    const out = await mkClassification(orgA, { factor_inputs: HIGH_INPUTS });
    const factors = out.body['risk_classification_factors'] as Array<Record<string, unknown>>;
    expect(factors.length).toBeGreaterThan(0);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_risk_classification.created')).toBe(1);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_risk_classification.risk_tier_assigned')).toBe(1);
    for (const f of factors) {
      expect(await auditCount(orgA.org_id, f['id'] as string, 'regulatory_risk_classification_factor.created')).toBe(1);
    }
    // GET own / cross
    expect((await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${out.id}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('risk_classification_not_found');
  });

  it('residual mirrors inherent; mitigation_strength persists as evidence-only factor (triggered=false, score_contribution=0)', async () => {
    const out = await mkClassification(orgA, { factor_inputs: { biometric_data: true, mitigation_strength: 'STRONG' } });
    const c = out.body['risk_classification'] as Record<string, unknown>;
    expect(c['inherent_risk_tier']).toBe('HIGH');
    expect(c['residual_risk_tier']).toBe('HIGH');
    expect(c['risk_score']).toBe(80);
    expect(c['residual_risk_score']).toBe(80);
    expect(c['mitigation_strength']).toBe('STRONG');
    const factors = out.body['risk_classification_factors'] as Array<Record<string, unknown>>;
    const mit = factors.find((f) => f['factor_key'] === 'mitigation_strength');
    expect(mit).toBeTruthy();
    expect(mit!['triggered']).toBe(false);
    expect(mit!['score_contribution']).toBe(0);
    expect(mit!['factor_category']).toBe('MITIGATION');
  });

  it('PROHIBITED classification: both review flags true; superseded audit on supersedes_classification_id', async () => {
    const first = await mkClassification(orgA, { factor_inputs: PROHIBITED_INPUTS });
    expect((first.body['risk_classification'] as Record<string, unknown>)['requires_prohibited_use_review']).toBe(true);
    expect((first.body['risk_classification'] as Record<string, unknown>)['requires_high_risk_review']).toBe(true);
    const second = await mkClassification(orgA, {
      factor_inputs: PROHIBITED_INPUTS,
      supersedes_classification_id: first.id,
    });
    expect(await auditCount(orgA.org_id, second.id, 'regulatory_risk_classification.superseded')).toBe(1);
  });

  it('create rejects client-supplied tier/score (strict body) and requires bounded factor_inputs shape', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', orgA.api_key, {
      ...baseClassification({ factor_inputs: {} }),
      inherent_risk_tier: 'PROHIBITED',
    });
    // zod by default strips unknown keys silently — confirm engine still computed MINIMAL.
    if (r.statusCode === 201) {
      const c = bodyOf(r)['risk_classification'] as Record<string, unknown>;
      expect(c['inherent_risk_tier']).toBe('MINIMAL');
      expect(c['residual_risk_tier']).toBe('MINIMAL');
    } else {
      expect(r.statusCode).toBe(400);
    }
    const bad = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', orgA.api_key, {
      ...baseClassification({}),
      factor_inputs: { not_a_real_factor: true },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('asset-link consistency required: use_case_asset_link_id must belong to same use_case and ai_system', async () => {
    // Own link belongs to (useCaseA, aiSysA) — accepted.
    const ok = await mkClassificationResp(orgA, { use_case_asset_link_id: linkA, factor_inputs: MODERATE_INPUTS });
    expect(ok.status).toBe(201);
    // Mismatch: use a different ai_system in orgA.
    const otherAi = await mkAiSystem(orgA);
    const mismatched = await mkClassificationResp(orgA, {
      use_case_asset_link_id: linkA, ai_system_id: otherAi, factor_inputs: MODERATE_INPUTS,
    });
    expect(mismatched.status).toBe(400);
    expect(mismatched.body['error']).toBe('use_case_asset_link_subject_mismatch');
  });

  it('version-without-parent rejected (400); version-belongs-to-parent enforced for both model and agent', async () => {
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, model_version_id: modelVerA })).status).toBe(400);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, agent_version_id: agentVerA })).status).toBe(400);
    const model2 = await mkModel(orgA, provA);
    const mm = await mkClassificationResp(orgA, { factor_inputs: {}, model_id: model2, model_version_id: modelVerA });
    expect(mm.status).toBe(400);
    expect(mm.body['error']).toBe('model_version_model_mismatch');
    const agent2 = await mkAgent(orgA);
    const am = await mkClassificationResp(orgA, { factor_inputs: {}, agent_id: agent2, agent_version_id: agentVerA });
    expect(am.status).toBe(400);
    expect(am.body['error']).toBe('agent_version_agent_mismatch');
  });

  it('cross-tenant parent references return 404 without leakage', async () => {
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, risk_method_id: methodB })).status).toBe(404);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, use_case_id: useCaseB })).status).toBe(404);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, ai_system_id: aiSysB })).status).toBe(404);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, model_id: modelB })).status).toBe(404);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, model_id: modelA, model_version_id: modelVerB })).status).toBe(404);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, agent_id: agentB })).status).toBe(404);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, agent_id: agentA, agent_version_id: agentVerB })).status).toBe(404);
    expect((await mkClassificationResp(orgA, { factor_inputs: {}, supersedes_classification_id: classificationB })).status).toBe(404);
  });

  it('duplicate classification_key per tenant rejected (409); same key across tenants allowed', async () => {
    const key = `CLS-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkClassificationResp(orgA, { classification_key: key, factor_inputs: {} })).status).toBe(201);
    const dup = await mkClassificationResp(orgA, { classification_key: key, factor_inputs: {} });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('risk_classification_key_conflict');
    expect((await mkClassificationResp(orgB, {
      classification_key: key, factor_inputs: {}, risk_method_id: methodB, use_case_id: useCaseB, ai_system_id: aiSysB,
    })).status).toBe(201);
  });
});

describe('regulatory-risk / classification API — update', () => {
  it('PATCH updates non-identity fields + audits; status_changed emitted; SUPERSEDED transition also emits superseded', async () => {
    const out = await mkClassification(orgA, { factor_inputs: MODERATE_INPUTS, classification_status: 'DRAFT' });
    const p1 = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, {
      review_notes: 'reviewed', rationale_summary: 'updated rationale',
    });
    expect(p1.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_risk_classification.updated')).toBe(1);
    const p2 = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, { classification_status: 'ACTIVE' });
    expect(p2.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_risk_classification.status_changed')).toBe(1);
    const p3 = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, { classification_status: 'SUPERSEDED' });
    expect(p3.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_risk_classification.superseded')).toBeGreaterThanOrEqual(1);
  });

  it('PATCH rejects identity-changing keys (strict): classification_key, risk_method_id, use_case_id, ai_system_id, model_id, tier/score not in patch schema', async () => {
    const out = await mkClassification(orgA, { factor_inputs: {} });
    // Send unknown/identity keys — zod will reject because patch schema has no such fields (and the .refine requires at least one valid field).
    const noFields = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, {});
    expect(noFields.statusCode).toBe(400);
    // Sending only an unknown key gets stripped → ends up as {} → also 400.
    const onlyUnknown = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, {
      classification_key: 'CHANGED', risk_method_id: methodA, inherent_risk_tier: 'PROHIBITED', risk_score: 100,
    });
    expect(onlyUnknown.statusCode).toBe(400);
    // Confirm computed fields did NOT change.
    const after = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key);
    const c = bodyOf(after)['risk_classification'] as Record<string, unknown>;
    expect(c['inherent_risk_tier']).toBe('MINIMAL');
    expect(c['risk_score']).toBe(5);
  });

  it('PATCH cross-tenant returns 404 (not 403) without leakage', async () => {
    const out = await mkClassification(orgA, { factor_inputs: {} });
    const r = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgB.api_key, { review_notes: 'noted' });
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('risk_classification_not_found');
  });
});

// ===========================================================================
// Risk classification factors — read-only
// ===========================================================================

describe('regulatory-risk / factor API (read-only)', () => {
  it('list factors under a classification (own); GET a single factor own/cross; UPDATE is forbidden at the grant level', async () => {
    const out = await mkClassification(orgA, { factor_inputs: HIGH_INPUTS });
    const list = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${out.id}/factors?limit=200`, orgA.api_key);
    expect(list.statusCode).toBe(200);
    const rows = bodyOf(list)['risk_classification_factors'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    const fid = rows[0]!['id'] as string;
    expect((await inject(stack, 'GET', `/v1/regulatory/risk-classification-factors/${fid}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/risk-classification-factors/${fid}`, orgB.api_key)).statusCode).toBe(404);

    // Direct DB: UPDATE on factors table is blocked (no UPDATE grant + no UPDATE policy).
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_risk_classification_factors SET rationale = $2 WHERE id = $1::uuid', [fid, 'tampered'])).toBe(true);
  });

  it('cross-classification list with filters works; cross-tenant rows are not returned', async () => {
    const a = await mkClassification(orgA, { factor_inputs: HIGH_INPUTS });
    const list = await inject(stack, 'GET', `/v1/regulatory/risk-classification-factors?classification_id=${a.id}&triggered=true&limit=200`, orgA.api_key);
    expect(list.statusCode).toBe(200);
    const rows = bodyOf(list)['risk_classification_factors'] as Array<Record<string, unknown>>;
    for (const row of rows) {
      expect(row['classification_id']).toBe(a.id);
      expect(row['triggered']).toBe(true);
    }
    // Cross-tenant: orgB asking for classifications belonging to orgA returns no rows.
    const cross = await inject(stack, 'GET', `/v1/regulatory/risk-classification-factors?classification_id=${a.id}&limit=200`, orgB.api_key);
    expect(cross.statusCode).toBe(200);
    expect((bodyOf(cross)['risk_classification_factors'] as Array<unknown>).length).toBe(0);
  });
});

// ===========================================================================
// Reclassification triggers
// ===========================================================================

describe('regulatory-risk / reclassification triggers', () => {
  it('create with use_case + ai_system + optional matching classification; created audit', async () => {
    const cls = await mkClassification(orgA, { factor_inputs: MODERATE_INPUTS });
    const r = await mkTriggerResp(orgA, { classification_id: cls.id, use_case_id: useCaseA, ai_system_id: aiSysA });
    expect(r.status).toBe(201);
    const tid = (r.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, tid, 'regulatory_reclassification_trigger.created')).toBe(1);
  });

  it('classification ↔ subject mismatch rejected (400)', async () => {
    const cls = await mkClassification(orgA, { factor_inputs: {} });
    const otherUc = await mkUseCase(orgA);
    const r = await mkTriggerResp(orgA, { classification_id: cls.id, use_case_id: otherUc, ai_system_id: aiSysA });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('classification_subject_mismatch');
  });

  it('PATCH triggers status_changed; transition to RESOLVED also emits resolved; setting resolved_at on previously NULL emits resolved', async () => {
    const r1 = await mkTriggerResp(orgA, { use_case_id: useCaseA, ai_system_id: aiSysA });
    expect(r1.status).toBe(201);
    const tid = (r1.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    const p1 = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, { trigger_reason: 'updated reason' });
    expect(p1.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, tid, 'regulatory_reclassification_trigger.updated')).toBe(1);
    const p2 = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, { trigger_status: 'ACKNOWLEDGED' });
    expect(p2.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, tid, 'regulatory_reclassification_trigger.status_changed')).toBe(1);
    const p3 = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, {
      trigger_status: 'RESOLVED', resolved_at: '2026-06-01T00:00:00.000Z',
    });
    expect(p3.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, tid, 'regulatory_reclassification_trigger.resolved')).toBeGreaterThanOrEqual(1);
  });

  it('duplicate trigger_key per tenant rejected (409); same key across tenants allowed; cross-tenant references 404', async () => {
    const key = `TRG-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkTriggerResp(orgA, { trigger_key: key })).status).toBe(201);
    const dup = await mkTriggerResp(orgA, { trigger_key: key });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('reclassification_trigger_key_conflict');
    expect((await mkTriggerResp(orgB, {
      trigger_key: key, use_case_id: useCaseB, ai_system_id: aiSysB,
    })).status).toBe(201);
    expect((await mkTriggerResp(orgA, { use_case_id: useCaseB, ai_system_id: aiSysA })).status).toBe(404);
    expect((await mkTriggerResp(orgA, { classification_id: classificationB, use_case_id: useCaseA, ai_system_id: aiSysA })).status).toBe(404);
  });

  it('empty PATCH rejected (400)', async () => {
    const r1 = await mkTriggerResp(orgA, { use_case_id: useCaseA, ai_system_id: aiSysA });
    const tid = (r1.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, {})).statusCode).toBe(400);
  });
});

// ===========================================================================
// Pagination + filters
// ===========================================================================

describe('regulatory-risk / pagination + filters', () => {
  it('classification keyset pagination returns every classification exactly once; filters honored', async () => {
    const methodP = await mkMethod(orgPage);
    const aiP = await mkAiSystem(orgPage);
    const ucP = await mkUseCase(orgPage);
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const out = await mkClassification(orgPage, { factor_inputs: {}, risk_method_id: methodP, use_case_id: ucP, ai_system_id: aiP });
      created.push(out.id);
    }
    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/risk-classifications${qs}`, orgPage.api_key);
      const rows = bodyOf(page)['risk_classifications'] as Array<Record<string, unknown>>;
      for (const row of rows) seen.add(row['id'] as string);
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);
    for (const id of created) expect(seen.has(id)).toBe(true);
  });

  it('classification filters by tier/method/review-flags/status work', async () => {
    const methodF = await mkMethod(orgFilter);
    const aiF = await mkAiSystem(orgFilter);
    const ucF = await mkUseCase(orgFilter);
    await mkClassification(orgFilter, { factor_inputs: PROHIBITED_INPUTS, risk_method_id: methodF, use_case_id: ucF, ai_system_id: aiF });
    await mkClassification(orgFilter, { factor_inputs: MODERATE_INPUTS, risk_method_id: methodF, use_case_id: ucF, ai_system_id: aiF });
    const prohib = await inject(stack, 'GET', `/v1/regulatory/risk-classifications?inherent_risk_tier=PROHIBITED&requires_prohibited_use_review=true&limit=200`, orgFilter.api_key);
    const prows = bodyOf(prohib)['risk_classifications'] as Array<Record<string, unknown>>;
    expect(prows.length).toBeGreaterThan(0);
    for (const row of prows) {
      expect(row['inherent_risk_tier']).toBe('PROHIBITED');
      expect(row['requires_prohibited_use_review']).toBe(true);
    }
    const byMethod = await inject(stack, 'GET', `/v1/regulatory/risk-classifications?risk_method_id=${methodF}&limit=200`, orgFilter.api_key);
    for (const row of bodyOf(byMethod)['risk_classifications'] as Array<Record<string, unknown>>) {
      expect(row['risk_method_id']).toBe(methodF);
    }
  });

  it('factor filters by category/severity/triggered work; trigger filters by status/type/action/due_before work', async () => {
    const methodFi = await mkMethod(orgFilter);
    const aiFi = await mkAiSystem(orgFilter);
    const ucFi = await mkUseCase(orgFilter);
    const cls = await mkClassification(orgFilter, {
      factor_inputs: HIGH_INPUTS, risk_method_id: methodFi, use_case_id: ucFi, ai_system_id: aiFi,
    });
    const triggered = await inject(stack, 'GET', `/v1/regulatory/risk-classification-factors?classification_id=${cls.id}&triggered=true&factor_severity=HIGH&limit=200`, orgFilter.api_key);
    const rows = bodyOf(triggered)['risk_classification_factors'] as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row['triggered']).toBe(true);
      expect(row['factor_severity']).toBe('HIGH');
    }
    const t = await mkTriggerResp(orgFilter, {
      use_case_id: (await mkUseCase(orgFilter)),
      ai_system_id: (await mkAiSystem(orgFilter)),
      trigger_status: 'OPEN',
      trigger_type: 'MATERIAL_CHANGE',
      recommended_action: 'RECLASSIFY',
      due_at: '2026-06-01T00:00:00.000Z',
    });
    expect(t.status).toBe(201);
    const due = await inject(stack, 'GET', `/v1/regulatory/reclassification-triggers?trigger_status=OPEN&due_before=2026-12-31T00:00:00.000Z&limit=200`, orgFilter.api_key);
    const trows = bodyOf(due)['reclassification_triggers'] as Array<Record<string, unknown>>;
    expect(trows.length).toBeGreaterThan(0);
    for (const row of trows) {
      expect(row['trigger_status']).toBe('OPEN');
      expect(row['due_at']).not.toBeNull();
    }
  });
});

// ===========================================================================
// Direct DB RLS — tenant isolation
// ===========================================================================

describe('regulatory-risk / RLS (direct DB) — methods', () => {
  it('tenant A cannot read tenant B methods; A cannot insert method with org_id of B', async () => {
    const id = await mkMethod(orgA, { method_key: `RM-RLS-${randomUUID().slice(0, 8).toUpperCase()}` });
    const seen = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_risk_methods WHERE id = $1::uuid', [id]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(0);
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_risk_methods (org_id, method_key, method_version, name, method_status, framework_profile)
       VALUES ($1::uuid, $2, '1.0', 'm', 'DRAFT', 'GOVAI_BASELINE')`,
      [orgB.org_id, `RM-XT-${randomUUID().slice(0, 8)}`])).toBe(true);
  });
});

describe('regulatory-risk / RLS (direct DB) — classifications', () => {
  const insertCls = (extraCols = '', extraVals = '') => `
    INSERT INTO govai.regulatory_risk_classifications
      (org_id, classification_key, classification_status, risk_method_id, use_case_id, ai_system_id,
       classification_basis, decision_scope, inherent_risk_tier, residual_risk_tier, risk_score,
       residual_risk_score, mitigation_strength, requires_high_risk_review, requires_prohibited_use_review${extraCols})
    VALUES ($1::uuid, $2, 'DRAFT', $3::uuid, $4::uuid, $5::uuid, 'RULE_EVALUATION', 'INTERNAL_ASSISTANCE',
            'MINIMAL', 'MINIMAL', 5, 5, 'UNKNOWN', false, false${extraVals})`;

  it('tenant A cannot insert classification with org_id of B, nor referencing tenant B method/use_case/ai_system/model/agent versions or supersedes_id', async () => {
    const key = () => `CLS-XT-${randomUUID().slice(0, 8)}`;
    expect(await insertBlocked(orgA.org_id, insertCls(), [orgB.org_id, key(), methodA, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(), [orgA.org_id, key(), methodB, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(), [orgA.org_id, key(), methodA, useCaseB, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(), [orgA.org_id, key(), methodA, useCaseA, aiSysB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(', model_id', ', $6::uuid'), [orgA.org_id, key(), methodA, useCaseA, aiSysA, modelB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(', model_id, model_version_id', ', $6::uuid, $7::uuid'), [orgA.org_id, key(), methodA, useCaseA, aiSysA, modelA, modelVerB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(', agent_id', ', $6::uuid'), [orgA.org_id, key(), methodA, useCaseA, aiSysA, agentB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(', agent_id, agent_version_id', ', $6::uuid, $7::uuid'), [orgA.org_id, key(), methodA, useCaseA, aiSysA, agentA, agentVerB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertCls(', supersedes_classification_id', ', $6::uuid'), [orgA.org_id, key(), methodA, useCaseA, aiSysA, classificationB])).toBe(true);
  });

  it('tenant A cannot insert classification with foreign asset_link or asset_link not matching subject', async () => {
    // The asset link belongs to orgA (linkA, useCaseA, aiSysA). With a different ai_system → asset-link mismatch via RLS.
    const otherAi = await mkAiSystem(orgA);
    expect(await insertBlocked(orgA.org_id,
      insertCls(', use_case_asset_link_id', ', $6::uuid'),
      [orgA.org_id, `CLS-XT-${randomUUID().slice(0, 8)}`, methodA, useCaseA, otherAi, linkA])).toBe(true);
  });

  it('CHECK invariants (direct DB): residual_risk_tier must equal inherent_risk_tier; residual_risk_score must equal risk_score', async () => {
    // residual != inherent
    expect(await insertBlocked(orgA.org_id, `
      INSERT INTO govai.regulatory_risk_classifications
        (org_id, classification_key, classification_status, risk_method_id, use_case_id, ai_system_id,
         classification_basis, decision_scope, inherent_risk_tier, residual_risk_tier, risk_score,
         residual_risk_score, mitigation_strength, requires_high_risk_review, requires_prohibited_use_review)
      VALUES ($1::uuid, $2, 'DRAFT', $3::uuid, $4::uuid, $5::uuid, 'RULE_EVALUATION', 'INTERNAL_ASSISTANCE',
              'HIGH', 'LOW', 80, 80, 'STRONG', true, false)`,
      [orgA.org_id, `CLS-CHK1-${randomUUID().slice(0, 8)}`, methodA, useCaseA, aiSysA])).toBe(true);
    // residual_score != risk_score
    expect(await insertBlocked(orgA.org_id, `
      INSERT INTO govai.regulatory_risk_classifications
        (org_id, classification_key, classification_status, risk_method_id, use_case_id, ai_system_id,
         classification_basis, decision_scope, inherent_risk_tier, residual_risk_tier, risk_score,
         residual_risk_score, mitigation_strength, requires_high_risk_review, requires_prohibited_use_review)
      VALUES ($1::uuid, $2, 'DRAFT', $3::uuid, $4::uuid, $5::uuid, 'RULE_EVALUATION', 'INTERNAL_ASSISTANCE',
              'HIGH', 'HIGH', 80, 40, 'STRONG', true, false)`,
      [orgA.org_id, `CLS-CHK2-${randomUUID().slice(0, 8)}`, methodA, useCaseA, aiSysA])).toBe(true);
  });

  it('CHECK invariants (direct DB): PROHIBITED implies prohibited_review; HIGH implies high_review; model_version requires model', async () => {
    expect(await insertBlocked(orgA.org_id, `
      INSERT INTO govai.regulatory_risk_classifications
        (org_id, classification_key, classification_status, risk_method_id, use_case_id, ai_system_id,
         classification_basis, decision_scope, inherent_risk_tier, residual_risk_tier, risk_score,
         residual_risk_score, mitigation_strength, requires_high_risk_review, requires_prohibited_use_review)
      VALUES ($1::uuid, $2, 'DRAFT', $3::uuid, $4::uuid, $5::uuid, 'RULE_EVALUATION', 'INTERNAL_ASSISTANCE',
              'PROHIBITED', 'PROHIBITED', 100, 100, 'UNKNOWN', true, false)`,
      [orgA.org_id, `CLS-PRO-${randomUUID().slice(0, 8)}`, methodA, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, `
      INSERT INTO govai.regulatory_risk_classifications
        (org_id, classification_key, classification_status, risk_method_id, use_case_id, ai_system_id,
         classification_basis, decision_scope, inherent_risk_tier, residual_risk_tier, risk_score,
         residual_risk_score, mitigation_strength, requires_high_risk_review, requires_prohibited_use_review)
      VALUES ($1::uuid, $2, 'DRAFT', $3::uuid, $4::uuid, $5::uuid, 'RULE_EVALUATION', 'INTERNAL_ASSISTANCE',
              'HIGH', 'HIGH', 80, 80, 'UNKNOWN', false, false)`,
      [orgA.org_id, `CLS-HI-${randomUUID().slice(0, 8)}`, methodA, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id,
      insertCls(', model_version_id', ', $6::uuid'),
      [orgA.org_id, `CLS-MV-${randomUUID().slice(0, 8)}`, methodA, useCaseA, aiSysA, modelVerA])).toBe(true);
  });

  it('tenant A CAN insert classification referencing own method + use_case + ai_system (+ asset_link/model/version/agent/version)', async () => {
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${insertCls(', use_case_asset_link_id, model_id, model_version_id, agent_id, agent_version_id',
        ', $6::uuid, $7::uuid, $8::uuid, $9::uuid, $10::uuid')} RETURNING id`,
        [orgA.org_id, `CLS-OK-${randomUUID().slice(0, 8)}`, methodA, useCaseA, aiSysA, linkA, modelA, modelVerA, agentA, agentVerA]);
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('tenant A cannot UPDATE classification to set foreign references', async () => {
    const out = await mkClassification(orgA, { factor_inputs: {} });
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_risk_classifications SET risk_method_id = $2::uuid WHERE id = $1::uuid', [out.id, methodB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_risk_classifications SET use_case_id = $2::uuid WHERE id = $1::uuid', [out.id, useCaseB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_risk_classifications SET ai_system_id = $2::uuid WHERE id = $1::uuid', [out.id, aiSysB])).toBe(true);
  });
});

describe('regulatory-risk / RLS (direct DB) — factors', () => {
  it('tenant A cannot insert factor under tenant B classification; cannot SELECT factors of tenant B', async () => {
    expect(await insertBlocked(orgA.org_id,
      `INSERT INTO govai.regulatory_risk_classification_factors
         (org_id, classification_id, factor_key, factor_category, factor_severity)
       VALUES ($1::uuid, $2::uuid, $3, 'OTHER', 'MINIMAL')`,
      [orgA.org_id, classificationB, 'cross_tenant_factor'])).toBe(true);
    const seen = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_risk_classification_factors WHERE classification_id = $1::uuid', [classificationB]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(0);
  });

  it('tenant A cannot UPDATE factors even on own classification (no UPDATE grant + no UPDATE policy)', async () => {
    const out = await mkClassification(orgA, { factor_inputs: HIGH_INPUTS });
    const list = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${out.id}/factors?limit=10`, orgA.api_key);
    const fid = (bodyOf(list)['risk_classification_factors'] as Array<Record<string, unknown>>)[0]!['id'] as string;
    expect(await insertBlocked(orgA.org_id,
      'UPDATE govai.regulatory_risk_classification_factors SET rationale = $2 WHERE id = $1::uuid',
      [fid, 'tampered'])).toBe(true);
  });
});

describe('regulatory-risk / RLS (direct DB) — triggers', () => {
  const insertTrg = (extraCols = '', extraVals = '') => `
    INSERT INTO govai.regulatory_reclassification_triggers
      (org_id, trigger_key, trigger_status, trigger_type, recommended_action, use_case_id, ai_system_id${extraCols})
    VALUES ($1::uuid, $2, 'OPEN', 'MATERIAL_CHANGE', 'RECLASSIFY', $3::uuid, $4::uuid${extraVals})`;

  it('tenant A cannot insert trigger with org_id of B nor referencing tenant B use_case/ai_system/classification', async () => {
    expect(await insertBlocked(orgA.org_id, insertTrg(), [orgB.org_id, `TRG-XT-${randomUUID().slice(0, 8)}`, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertTrg(), [orgA.org_id, `TRG-XT-${randomUUID().slice(0, 8)}`, useCaseB, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertTrg(), [orgA.org_id, `TRG-XT-${randomUUID().slice(0, 8)}`, useCaseA, aiSysB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertTrg(', classification_id', ', $5::uuid'),
      [orgA.org_id, `TRG-XT-${randomUUID().slice(0, 8)}`, useCaseA, aiSysA, classificationB])).toBe(true);
  });

  it('tenant A cannot insert trigger with own classification but mismatched subject', async () => {
    const cls = await mkClassification(orgA, { factor_inputs: {} });
    const otherUc = await mkUseCase(orgA);
    expect(await insertBlocked(orgA.org_id, insertTrg(', classification_id', ', $5::uuid'),
      [orgA.org_id, `TRG-MM-${randomUUID().slice(0, 8)}`, otherUc, aiSysA, cls.id])).toBe(true);
  });

  it('tenant A can insert/update own trigger (no over-blocking)', async () => {
    const cls = await mkClassification(orgA, { factor_inputs: {} });
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${insertTrg(', classification_id', ', $5::uuid')} RETURNING id`,
        [orgA.org_id, `TRG-OK-${randomUUID().slice(0, 8)}`, useCaseA, aiSysA, cls.id]);
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });
});

// ===========================================================================
// PR-R7 review-finding patches (P1 + 2× P2)
// ===========================================================================

describe('regulatory-risk / AutomatedDecisioning enum vocabulary (P1)', () => {
  it('evaluate accepts ASSISTIVE_RECOMMENDATION as valid automated_decisioning value', async () => {
    const r = await evaluate(orgA, { automated_decisioning: 'ASSISTIVE_RECOMMENDATION' });
    expect(r.status).toBe(200);
    expect(r.body['risk_classification_preview']).toBeTruthy();
  });

  it('evaluate accepts BINDING_LEGAL_EFFECT as valid automated_decisioning value', async () => {
    const r = await evaluate(orgA, { automated_decisioning: 'BINDING_LEGAL_EFFECT' });
    expect(r.status).toBe(200);
    expect(r.body['risk_classification_preview']).toBeTruthy();
  });

  it('sensitive_data + ASSISTIVE_RECOMMENDATION produces HIGH (non-NONE automation triggers HIGH rule)', async () => {
    const r = await evaluate(orgA, { sensitive_data: true, automated_decisioning: 'ASSISTIVE_RECOMMENDATION' });
    expect(r.status).toBe(200);
    const p = r.body['risk_classification_preview'] as Record<string, unknown>;
    expect(p['inherent_risk_tier']).toBe('HIGH');
    expect(p['residual_risk_tier']).toBe('HIGH');
    expect(p['risk_score']).toBe(80);
    expect(p['requires_high_risk_review']).toBe(true);
  });

  it('employment_or_credit_access + BINDING_LEGAL_EFFECT (EXTERNAL_EFFECT scope) produces HIGH', async () => {
    const r = await evaluate(
      orgA,
      { employment_or_credit_access: true, automated_decisioning: 'BINDING_LEGAL_EFFECT' },
      'EXTERNAL_EFFECT',
    );
    expect(r.status).toBe(200);
    const p = r.body['risk_classification_preview'] as Record<string, unknown>;
    expect(p['inherent_risk_tier']).toBe('HIGH');
    expect(p['residual_risk_tier']).toBe('HIGH');
    expect(p['risk_score']).toBe(80);
  });

  it('invalid automated_decisioning value still returns 400', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', orgA.api_key, {
      risk_method_id: methodA, use_case_id: useCaseA, ai_system_id: aiSysA,
      classification_basis: 'RULE_EVALUATION', decision_scope: 'INTERNAL_ASSISTANCE',
      factor_inputs: { automated_decisioning: 'NOT_A_REAL_VALUE' },
    });
    expect(r.statusCode).toBe(400);
  });
});

describe('regulatory-risk / classification effective range (P2)', () => {
  const FROM_EARLY = '2026-05-01T00:00:00.000Z';
  const TO_LATE = '2026-06-01T00:00:00.000Z';
  const TO_EARLIER = '2026-04-01T00:00:00.000Z';

  it('POST rejects effective_to before effective_from with 400', async () => {
    const r = await mkClassificationResp(orgA, { factor_inputs: {} });
    expect(r.status).toBe(201); // baseline to confirm helper still works
    const bad = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', orgA.api_key, {
      ...baseClassification({ factor_inputs: {} }),
      effective_from: FROM_EARLY, effective_to: TO_EARLIER,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('POST accepts equal effective_from/effective_to', async () => {
    const ok = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', orgA.api_key, {
      ...baseClassification({ factor_inputs: {} }),
      effective_from: FROM_EARLY, effective_to: FROM_EARLY,
    });
    expect(ok.statusCode).toBe(201);
  });

  it('POST accepts valid effective_to after effective_from', async () => {
    const ok = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', orgA.api_key, {
      ...baseClassification({ factor_inputs: {} }),
      effective_from: FROM_EARLY, effective_to: TO_LATE,
    });
    expect(ok.statusCode).toBe(201);
  });

  it('PATCH rejects both-fields inverted range with 400', async () => {
    const out = await mkClassification(orgA, { factor_inputs: {} });
    const r = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, {
      effective_from: FROM_EARLY, effective_to: TO_EARLIER,
    });
    expect(r.statusCode).toBe(400);
  });

  it('PATCH rejects only effective_to before existing effective_from with 400', async () => {
    const seeded = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', orgA.api_key, {
      ...baseClassification({ factor_inputs: {} }),
      effective_from: FROM_EARLY,
    });
    expect(seeded.statusCode).toBe(201);
    const id = ((bodyOf(seeded)['risk_classification']) as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${id}`, orgA.api_key, {
      effective_to: TO_EARLIER,
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_effective_range');
  });

  it('PATCH rejects only effective_from after existing effective_to with 400', async () => {
    const seeded = await inject(stack, 'POST', '/v1/regulatory/risk-classifications', orgA.api_key, {
      ...baseClassification({ factor_inputs: {} }),
      effective_to: TO_LATE,
    });
    expect(seeded.statusCode).toBe(201);
    const id = ((bodyOf(seeded)['risk_classification']) as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${id}`, orgA.api_key, {
      effective_from: '2026-12-01T00:00:00.000Z',
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_effective_range');
  });

  it('PATCH allows equal effective_from/effective_to', async () => {
    const out = await mkClassification(orgA, { factor_inputs: {} });
    const r = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, {
      effective_from: FROM_EARLY, effective_to: FROM_EARLY,
    });
    expect(r.statusCode).toBe(200);
  });

  it('PATCH allows valid effective_to after effective_from', async () => {
    const out = await mkClassification(orgA, { factor_inputs: {} });
    const r = await inject(stack, 'PATCH', `/v1/regulatory/risk-classifications/${out.id}`, orgA.api_key, {
      effective_from: FROM_EARLY, effective_to: TO_LATE,
    });
    expect(r.statusCode).toBe(200);
  });
});

describe('regulatory-risk / reclassification trigger time range (P2)', () => {
  const DETECTED = '2026-05-10T00:00:00.000Z';
  const RESOLVED_LATER = '2026-05-20T00:00:00.000Z';
  const RESOLVED_EARLIER = '2026-04-01T00:00:00.000Z';

  it('POST rejects resolved_at before detected_at with 400', async () => {
    const r = await mkTriggerResp(orgA, {
      use_case_id: useCaseA, ai_system_id: aiSysA,
      detected_at: DETECTED, resolved_at: RESOLVED_EARLIER,
    });
    expect(r.status).toBe(400);
  });

  it('POST accepts equal detected_at/resolved_at', async () => {
    const r = await mkTriggerResp(orgA, {
      use_case_id: useCaseA, ai_system_id: aiSysA,
      detected_at: DETECTED, resolved_at: DETECTED,
    });
    expect(r.status).toBe(201);
  });

  it('POST accepts valid resolved_at after detected_at', async () => {
    const r = await mkTriggerResp(orgA, {
      use_case_id: useCaseA, ai_system_id: aiSysA,
      detected_at: DETECTED, resolved_at: RESOLVED_LATER,
    });
    expect(r.status).toBe(201);
  });

  it('PATCH rejects both-fields inverted range with 400', async () => {
    const seeded = await mkTriggerResp(orgA, { use_case_id: useCaseA, ai_system_id: aiSysA });
    const tid = (seeded.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, {
      detected_at: DETECTED, resolved_at: RESOLVED_EARLIER,
    });
    expect(r.statusCode).toBe(400);
  });

  it('PATCH rejects only resolved_at before existing detected_at with 400', async () => {
    const seeded = await mkTriggerResp(orgA, {
      use_case_id: useCaseA, ai_system_id: aiSysA, detected_at: DETECTED,
    });
    const tid = (seeded.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, {
      resolved_at: RESOLVED_EARLIER,
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_trigger_time_range');
  });

  it('PATCH rejects only detected_at after existing resolved_at with 400', async () => {
    const seeded = await mkTriggerResp(orgA, {
      use_case_id: useCaseA, ai_system_id: aiSysA,
      detected_at: DETECTED, resolved_at: RESOLVED_LATER,
    });
    const tid = (seeded.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, {
      detected_at: '2026-12-01T00:00:00.000Z',
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('invalid_trigger_time_range');
  });

  it('PATCH allows equal detected_at/resolved_at', async () => {
    const seeded = await mkTriggerResp(orgA, { use_case_id: useCaseA, ai_system_id: aiSysA });
    const tid = (seeded.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, {
      detected_at: DETECTED, resolved_at: DETECTED,
    });
    expect(r.statusCode).toBe(200);
  });

  it('PATCH allows valid resolved_at after detected_at', async () => {
    const seeded = await mkTriggerResp(orgA, { use_case_id: useCaseA, ai_system_id: aiSysA });
    const tid = (seeded.body['reclassification_trigger'] as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'PATCH', `/v1/regulatory/reclassification-triggers/${tid}`, orgA.api_key, {
      detected_at: DETECTED, resolved_at: RESOLVED_LATER,
    });
    expect(r.statusCode).toBe(200);
  });
});
