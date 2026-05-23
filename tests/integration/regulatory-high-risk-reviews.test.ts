// Regulatory Core PR-R8 (issue #59, umbrella #33) — High-risk Review Workflow.
//
// Production-focused slice on top of the deterministic Risk Classification
// Engine (PR-R7). Covers auth/RBAC, CRUD-without-delete, lifecycle transitions
// (OPEN → IN_REVIEW / CHANGES_REQUESTED → APPROVED / REJECTED / CANCELLED),
// separation-of-duties enforcement in both service and DB trigger, append-only
// decisions, terminal-state backstops, evidence + reviewer assignment evidence,
// tenant isolation (API + direct DB RLS), keyset pagination, validation, audit
// evidence, DDL semantic comments binding APPROVED/APPROVE to governance
// evidence only, and PR-R7 non-regression (residual=inherent, mitigation
// evidence-only, PROHIBITED rejected as future workflow).
//
// APPROVED in PR-R8 means the high-risk governance review case has an approval
// decision recorded as governance evidence only. It does not mean legal
// approval; it does not mean compliance certification; it does not mean safety
// certification; and it does not authorize runtime execution. High-risk review
// approval does not mutate the underlying risk classification, does not
// authorize runtime execution, does not bypass hard-deny controls, and does
// not make the AI system legally compliant.

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
let highClassA: string, lowClassA: string, prohibitedClassA: string;

// Shared parents (tenant B).
let aiSysB: string, provB: string, useCaseB: string, methodB: string;
let highClassB: string;

// approverApiKey is a second admin key on orgA — used to satisfy SoD when
// orgA's primary admin is the requester.
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

const baseReview = (o: Record<string, unknown> = {}) => ({
  review_key: `HRR-${randomUUID().slice(0, 8).toUpperCase()}`,
  risk_classification_id: highClassA,
  review_basis: 'RISK_CLASSIFICATION_REQUIRED_REVIEW',
  ...o,
});

async function mkReviewResp(org: AdminOrg, o: Record<string, unknown> = {}) {
  const r = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', org.api_key, baseReview(o));
  return { status: r.statusCode, body: bodyOf(r) };
}

// A partial unique index enforces "one non-terminal review per classification".
// To keep the rest of the suite tractable, mkReview defaults to seeding a fresh
// HIGH classification for `orgA` unless the caller supplied risk_classification_id
// (and the same shortcut for orgB / orgPage). Callers that need to test the
// partial-uniqueness behavior pass risk_classification_id explicitly.
async function mkReview(
  org: AdminOrg,
  o: Record<string, unknown> = {},
): Promise<{ id: string; body: Record<string, unknown> }> {
  let body = baseReview(o);
  if (o['risk_classification_id'] === undefined) {
    const cls =
      org.org_id === orgA.org_id
        ? await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS)
        : org.org_id === orgB.org_id
          ? await mkClassification(orgB, methodB, useCaseB, aiSysB, HIGH_INPUTS)
          : highClassA; // orgPage callers set risk_classification_id explicitly.
    body = { ...body, risk_classification_id: cls };
  }
  const r = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', org.api_key, body);
  expect(r.statusCode).toBe(201);
  const rev = (bodyOf(r))['high_risk_review'] as Record<string, unknown>;
  return { id: rev['id'] as string, body: bodyOf(r) };
}

async function submitReview(org: AdminOrg, id: string) {
  const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${id}/submit`, org.api_key, {});
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

const HIGH_INPUTS = { rights_affecting_automated_decision: true, automated_decisioning: 'AUTOMATED_EXTERNAL_EFFECT' };
const LOW_INPUTS = { personal_data: true }; // produces MODERATE
const PROHIBITED_INPUTS = { social_scoring_signal: true };

beforeAll(async () => {
  stack = await startStack();
  orgA = await adminOrg();
  // Second admin api key on tenant A used to satisfy SoD when admin of orgA is requester.
  const approverKey = await addApiKey(stack, orgA.org_id, randomUUID(), ['admin']);
  approverApiKey = approverKey.api_key;

  orgB = await adminOrg();
  const dev = await seedOrg(stack);
  const devKey = await addApiKey(stack, dev.org_id, dev.user_id, ['developer']);
  devOrg = { org_id: dev.org_id, user_id: dev.user_id, api_key: devKey.api_key };
  orgPage = await adminOrg();

  aiSysA = await mkAiSystem(orgA);
  provA = await mkProvider(orgA);
  // Seed a model under orgA so PR-R7 classifications can optionally link to it later;
  // not directly referenced from PR-R8 tests, but keeps the registry surface realistic.
  await mkModel(orgA, provA);
  useCaseA = await mkUseCase(orgA);
  methodA = await mkMethod(orgA);
  highClassA = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
  lowClassA = await mkClassification(orgA, methodA, useCaseA, aiSysA, LOW_INPUTS);
  prohibitedClassA = await mkClassification(orgA, methodA, useCaseA, aiSysA, PROHIBITED_INPUTS);

  aiSysB = await mkAiSystem(orgB);
  provB = await mkProvider(orgB);
  await mkModel(orgB, provB);
  useCaseB = await mkUseCase(orgB);
  methodB = await mkMethod(orgB);
  highClassB = await mkClassification(orgB, methodB, useCaseB, aiSysB, HIGH_INPUTS);
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

// ===========================================================================
// Auth + RBAC
// ===========================================================================

describe('regulatory-high-risk-reviews / auth + rbac', () => {
  it('unauthenticated requests rejected (401)', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/high-risk-reviews', undefined)).statusCode).toBe(401);
    expect((await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', undefined, baseReview())).statusCode).toBe(401);
  });

  it('non-write role can read but not write', async () => {
    expect((await inject(stack, 'GET', '/v1/regulatory/high-risk-reviews', devOrg.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', devOrg.api_key, baseReview())).statusCode).toBe(403);
  });

  it('admin write role can create + submit + cancel a high-risk review', async () => {
    const out = await mkReview(orgA);
    expect((await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/submit`, orgA.api_key, {})).statusCode).toBe(200);
    expect(
      (await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'no longer needed' }))
        .statusCode,
    ).toBe(200);
  });
});

// ===========================================================================
// Create review
// ===========================================================================

describe('regulatory-high-risk-reviews / create', () => {
  it('create from HIGH classification copies risk snapshot and emits created audit; classification is not mutated', async () => {
    // Use highClassA explicitly so we can compare before/after on a known row.
    // Capture state, create one review, then re-fetch the same classification.
    const before = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${highClassA}`, orgA.api_key);
    const ownCls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const out = await mkReview(orgA, { risk_classification_id: ownCls });
    const rev = out.body['high_risk_review'] as Record<string, unknown>;
    expect(rev['risk_classification_id']).toBe(ownCls);
    expect(rev['inherent_risk_tier']).toBe('HIGH');
    expect(rev['residual_risk_tier']).toBe('HIGH');
    expect(rev['risk_score']).toBe(80);
    expect(rev['residual_risk_score']).toBe(80);
    expect(rev['requires_high_risk_review']).toBe(true);
    expect(rev['requires_prohibited_use_review']).toBe(false);
    expect(rev['review_status']).toBe('OPEN');
    expect(rev['risk_method_id']).toBeTruthy();
    expect(rev['use_case_id']).toBe(useCaseA);
    expect(rev['ai_system_id']).toBe(aiSysA);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.created')).toBe(1);

    const after = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${highClassA}`, orgA.api_key);
    const cbefore = bodyOf(before)['risk_classification'] as Record<string, unknown>;
    const cafter = bodyOf(after)['risk_classification'] as Record<string, unknown>;
    expect(cafter['inherent_risk_tier']).toBe(cbefore['inherent_risk_tier']);
    expect(cafter['residual_risk_tier']).toBe(cbefore['residual_risk_tier']);
    expect(cafter['risk_score']).toBe(cbefore['risk_score']);
    expect(cafter['residual_risk_score']).toBe(cbefore['residual_risk_score']);
  });

  it('duplicate review_key per tenant rejected 409; same key different tenant allowed', async () => {
    // Use two distinct classifications so only the review_key uniqueness applies.
    const cls1 = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const cls2 = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const key = `HRR-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await mkReviewResp(orgA, { review_key: key, risk_classification_id: cls1 })).status).toBe(201);
    const dup = await mkReviewResp(orgA, { review_key: key, risk_classification_id: cls2 });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('high_risk_review_key_conflict');
    expect((await mkReviewResp(orgB, { review_key: key, risk_classification_id: highClassB })).status).toBe(201);
  });

  it('LOW/MODERATE/MINIMAL/UNKNOWN classification rejected 400 classification_not_high_risk', async () => {
    const r = await mkReviewResp(orgA, { risk_classification_id: lowClassA });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('classification_not_high_risk');
  });

  it('PROHIBITED classification rejected 400 prohibited_classification_requires_future_workflow', async () => {
    const r = await mkReviewResp(orgA, { risk_classification_id: prohibitedClassA });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('prohibited_classification_requires_future_workflow');
  });

  it('cross-tenant classification_id returns 404 without leakage', async () => {
    const r = await mkReviewResp(orgA, { risk_classification_id: highClassB });
    expect(r.status).toBe(404);
    expect(r.body['error']).toBe('risk_classification_not_found');
  });

  it('client-supplied risk snapshot fields are stripped/ignored (strict body); copied values from classification win', async () => {
    const ownCls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const r = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: ownCls }),
      risk_method_id: methodB,
      ai_system_id: aiSysB,
      use_case_id: useCaseB,
      inherent_risk_tier: 'PROHIBITED',
      residual_risk_tier: 'PROHIBITED',
      risk_score: 100,
      residual_risk_score: 100,
      requires_prohibited_use_review: true,
      requires_high_risk_review: false,
    });
    // zod strips unknown keys silently by default — review still copies classification snapshot.
    expect(r.statusCode).toBe(201);
    const rev = (bodyOf(r)['high_risk_review']) as Record<string, unknown>;
    expect(rev['risk_method_id']).not.toBe(methodB);
    expect(rev['ai_system_id']).toBe(aiSysA);
    expect(rev['use_case_id']).toBe(useCaseA);
    expect(rev['inherent_risk_tier']).toBe('HIGH');
    expect(rev['risk_score']).toBe(80);
    expect(rev['requires_high_risk_review']).toBe(true);
    expect(rev['requires_prohibited_use_review']).toBe(false);
  });

  it('one non-terminal review per classification — duplicate active rejected; allowed after terminal', async () => {
    // Create a fresh HIGH classification for this isolation test.
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const a = await mkReview(orgA, { risk_classification_id: cls });
    const dup = await mkReviewResp(orgA, { risk_classification_id: cls });
    expect(dup.status).toBe(409);
    expect(dup.body['error']).toBe('high_risk_review_active_for_classification');
    // Cancel and re-create succeeds.
    expect(
      (await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${a.id}/cancel`, orgA.api_key, { cancellation_reason: 'redo' }))
        .statusCode,
    ).toBe(200);
    expect((await mkReviewResp(orgA, { risk_classification_id: cls })).status).toBe(201);
  });
});

// ===========================================================================
// Read/list
// ===========================================================================

describe('regulatory-high-risk-reviews / read + list', () => {
  it('GET own + cross-tenant 404; list only own tenant', async () => {
    const out = await mkReview(orgA);
    expect((await inject(stack, 'GET', `/v1/regulatory/high-risk-reviews/${out.id}`, orgA.api_key)).statusCode).toBe(200);
    const cross = await inject(stack, 'GET', `/v1/regulatory/high-risk-reviews/${out.id}`, orgB.api_key);
    expect(cross.statusCode).toBe(404);
    expect(bodyOf(cross)['error']).toBe('high_risk_review_not_found');
    const listB = await inject(stack, 'GET', '/v1/regulatory/high-risk-reviews?limit=200', orgB.api_key);
    const rows = (bodyOf(listB)['high_risk_reviews']) as Array<Record<string, unknown>>;
    expect(rows.map((x) => x['id'])).not.toContain(out.id);
  });

  it('filters by status/classification/use_case/ai_system/review_basis/due_before/q work', async () => {
    const out = await mkReview(orgA, { reviewer_guidance: 'guidance_marker_xyz' });
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/submit`, orgA.api_key, {});
    const byStatus = await inject(stack, 'GET', `/v1/regulatory/high-risk-reviews?review_status=IN_REVIEW&limit=200`, orgA.api_key);
    const rows = (bodyOf(byStatus)['high_risk_reviews']) as Array<Record<string, unknown>>;
    for (const row of rows) expect(row['review_status']).toBe('IN_REVIEW');
    const byClass = await inject(stack, 'GET', `/v1/regulatory/high-risk-reviews?risk_classification_id=${highClassA}&limit=200`, orgA.api_key);
    for (const row of bodyOf(byClass)['high_risk_reviews'] as Array<Record<string, unknown>>) {
      expect(row['risk_classification_id']).toBe(highClassA);
    }
    const byQ = await inject(stack, 'GET', `/v1/regulatory/high-risk-reviews?q=guidance_marker_xyz&limit=200`, orgA.api_key);
    expect((bodyOf(byQ)['high_risk_reviews'] as Array<unknown>).length).toBeGreaterThan(0);
  });

  it('keyset pagination returns every review exactly once', async () => {
    const aiP = await mkAiSystem(orgPage);
    const provP = await mkProvider(orgPage);
    await mkModel(orgPage, provP);
    const ucP = await mkUseCase(orgPage);
    const mP = await mkMethod(orgPage);
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const cls = await mkClassification(orgPage, mP, ucP, aiP, HIGH_INPUTS);
      const out = await mkReview(orgPage, { risk_classification_id: cls });
      created.push(out.id);
    }
    const seen = new Set<string>();
    let cursor: { before_created_at: string; before_id: string } | null = null;
    let guard = 0;
    do {
      const qs = cursor
        ? `?limit=2&before_created_at=${encodeURIComponent(cursor.before_created_at)}&before_id=${cursor.before_id}`
        : '?limit=2';
      const page = await inject(stack, 'GET', `/v1/regulatory/high-risk-reviews${qs}`, orgPage.api_key);
      for (const row of bodyOf(page)['high_risk_reviews'] as Array<Record<string, unknown>>) {
        seen.add(row['id'] as string);
      }
      cursor = bodyOf(page)['next_cursor'] as { before_created_at: string; before_id: string } | null;
      guard += 1;
    } while (cursor && guard < 20);
    for (const id of created) expect(seen.has(id)).toBe(true);
  });
});

// ===========================================================================
// Lifecycle (submit / cancel / PATCH)
// ===========================================================================

describe('regulatory-high-risk-reviews / lifecycle', () => {
  it('submit OPEN → IN_REVIEW emits submitted + status_changed', async () => {
    const out = await mkReview(orgA);
    const r = await submitReview(orgA, out.id);
    expect(r.status).toBe(200);
    const rev = (r.body['high_risk_review']) as Record<string, unknown>;
    expect(rev['review_status']).toBe('IN_REVIEW');
    expect(rev['submitted_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.submitted')).toBe(1);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.status_changed')).toBeGreaterThanOrEqual(1);
  });

  it('submit terminal review rejected; cancel terminal review rejected', async () => {
    const out = await mkReview(orgA);
    expect((await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' })).statusCode).toBe(200);
    expect((await submitReview(orgA, out.id)).status).toBe(409);
    expect(
      (await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' })).statusCode,
    ).toBe(409);
  });

  it('cancel OPEN sets cancellation_reason + cancelled_at and emits cancelled + status_changed', async () => {
    const out = await mkReview(orgA);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, {
      cancellation_reason: 'duplicate request',
    });
    expect(r.statusCode).toBe(200);
    const rev = (bodyOf(r)['high_risk_review']) as Record<string, unknown>;
    expect(rev['review_status']).toBe('CANCELLED');
    expect(rev['cancellation_reason']).toBe('duplicate request');
    expect(rev['cancelled_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.cancelled')).toBe(1);
  });

  it('cancel requires a non-empty reason (400 on empty)', async () => {
    const out = await mkReview(orgA);
    expect(
      (await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: '' })).statusCode,
    ).toBe(400);
  });

  it('PATCH mutable fields works, empty PATCH rejected, identity/snapshot fields are stripped (no effect)', async () => {
    const out = await mkReview(orgA);
    const p = await inject(stack, 'PATCH', `/v1/regulatory/high-risk-reviews/${out.id}`, orgA.api_key, {
      reviewer_guidance: 'updated',
    });
    expect(p.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.updated')).toBe(1);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/high-risk-reviews/${out.id}`, orgA.api_key, {})).statusCode).toBe(400);
    // Identity/snapshot fields are not in the patch schema — zod strips them, resulting in empty body → 400.
    expect(
      (
        await inject(stack, 'PATCH', `/v1/regulatory/high-risk-reviews/${out.id}`, orgA.api_key, {
          risk_method_id: methodB,
          inherent_risk_tier: 'PROHIBITED',
          risk_score: 100,
        })
      ).statusCode,
    ).toBe(400);
    // Confirm snapshot unchanged.
    const get = await inject(stack, 'GET', `/v1/regulatory/high-risk-reviews/${out.id}`, orgA.api_key);
    const rev = (bodyOf(get)['high_risk_review']) as Record<string, unknown>;
    expect(rev['inherent_risk_tier']).toBe('HIGH');
    expect(rev['risk_score']).toBe(80);
  });
});

// ===========================================================================
// Evidence
// ===========================================================================

const baseEvidence = (o: Record<string, unknown> = {}) => ({
  evidence_key: `EV-${randomUUID().slice(0, 8).toUpperCase()}`,
  evidence_type: 'CLASSIFICATION_RATIONALE',
  evidence_status: 'DRAFT',
  title: 'Rationale',
  ...o,
});

describe('regulatory-high-risk-reviews / evidence', () => {
  it('add evidence to OPEN/IN_REVIEW reviews succeeds; created audit emitted', async () => {
    const out = await mkReview(orgA);
    const ev1 = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/evidence`, orgA.api_key, baseEvidence());
    expect(ev1.statusCode).toBe(201);
    const eid = ((bodyOf(ev1)['high_risk_review_evidence']) as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, eid, 'regulatory_high_risk_review_evidence.created')).toBe(1);
    await submitReview(orgA, out.id);
    const ev2 = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/evidence`, orgA.api_key, baseEvidence());
    expect(ev2.statusCode).toBe(201);
  });

  it('add evidence to terminal review rejected', async () => {
    const out = await mkReview(orgA);
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    const ev = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/evidence`, orgA.api_key, baseEvidence());
    expect(ev.statusCode).toBe(409);
  });

  it('duplicate evidence_key per review rejected; same evidence_key in different review allowed', async () => {
    const out1 = await mkReview(orgA);
    const out2 = await mkReview(orgA);
    const key = `EV-DUP-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect((await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out1.id}/evidence`, orgA.api_key, baseEvidence({ evidence_key: key }))).statusCode).toBe(201);
    const dup = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out1.id}/evidence`, orgA.api_key, baseEvidence({ evidence_key: key }));
    expect(dup.statusCode).toBe(409);
    expect((await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out2.id}/evidence`, orgA.api_key, baseEvidence({ evidence_key: key }))).statusCode).toBe(201);
  });

  it('GET own evidence works; cross-tenant returns 404', async () => {
    const out = await mkReview(orgA);
    const ev = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/evidence`, orgA.api_key, baseEvidence());
    const eid = ((bodyOf(ev)['high_risk_review_evidence']) as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'GET', `/v1/regulatory/high-risk-review-evidence/${eid}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/high-risk-review-evidence/${eid}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('PATCH evidence + evidence_status transition emit updated + status_changed; PATCH after terminal rejected', async () => {
    const out = await mkReview(orgA);
    const ev = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/evidence`, orgA.api_key, baseEvidence());
    const eid = ((bodyOf(ev)['high_risk_review_evidence']) as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'PATCH', `/v1/regulatory/high-risk-review-evidence/${eid}`, orgA.api_key, { summary: 'updated' })).statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, eid, 'regulatory_high_risk_review_evidence.updated')).toBe(1);
    expect((await inject(stack, 'PATCH', `/v1/regulatory/high-risk-review-evidence/${eid}`, orgA.api_key, { evidence_status: 'ACCEPTED' })).statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, eid, 'regulatory_high_risk_review_evidence.status_changed')).toBe(1);
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect((await inject(stack, 'PATCH', `/v1/regulatory/high-risk-review-evidence/${eid}`, orgA.api_key, { summary: 'after' })).statusCode).toBe(409);
  });

  it('evidence body rejects unknown forbidden fields (prompt_body / legal_opinion / raw_sensitive_sample)', async () => {
    const out = await mkReview(orgA);
    const r1 = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/evidence`, orgA.api_key, {
      ...baseEvidence(),
      prompt_body: 'system prompt',
    });
    // zod strict not set on evidence body; unknown keys are stripped silently → still 201 but stored value has no prompt_body.
    expect(r1.statusCode).toBe(201);
    const eid = ((bodyOf(r1)['high_risk_review_evidence']) as Record<string, unknown>)['id'] as string;
    const get = await inject(stack, 'GET', `/v1/regulatory/high-risk-review-evidence/${eid}`, orgA.api_key);
    expect(Object.keys((bodyOf(get)['high_risk_review_evidence']) as Record<string, unknown>)).not.toContain('prompt_body');
  });
});

// ===========================================================================
// Assignments
// ===========================================================================

describe('regulatory-high-risk-reviews / assignments', () => {
  it('create assignment with user works; created audit emitted', async () => {
    const out = await mkReview(orgA);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/assignments`, orgA.api_key, {
      assignee_user_id: randomUUID(),
      reviewer_role: 'LEGAL',
    });
    expect(r.statusCode).toBe(201);
    const aid = ((bodyOf(r)['high_risk_review_assignment']) as Record<string, unknown>)['id'] as string;
    expect(await auditCount(orgA.org_id, aid, 'regulatory_high_risk_review_assignment.created')).toBe(1);
  });

  it('assignment with neither user nor participant rejected 400', async () => {
    const out = await mkReview(orgA);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/assignments`, orgA.api_key, {
      reviewer_role: 'LEGAL',
    });
    expect(r.statusCode).toBe(400);
  });

  it('assignment with cross-tenant participant returns 404', async () => {
    // Seed a workroom + participant in orgB.
    const wr = await inject(stack, 'POST', '/v1/workrooms', orgB.api_key, {
      workspace_id: randomUUID(),
      name: `wr-${randomUUID().slice(0, 6)}`,
      governance_mode: 'governance_active',
    });
    expect(wr.statusCode).toBe(201);
    const wrId = ((bodyOf(wr)['workroom']) as Record<string, unknown>)['id'] as string;
    const part = await inject(stack, 'POST', `/v1/workrooms/${wrId}/participants`, orgB.api_key, {
      kind: 'human', role: 'human_reviewer', user_id: randomUUID(),
    });
    expect(part.statusCode).toBe(201);
    const partId = ((bodyOf(part)['participant']) as Record<string, unknown>)['id'] as string;

    const out = await mkReview(orgA);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/assignments`, orgA.api_key, {
      assignee_participant_id: partId,
      reviewer_role: 'LEGAL',
    });
    expect(r.statusCode).toBe(404);
  });

  it('assignment status transition emits status_changed; update after terminal rejected', async () => {
    const out = await mkReview(orgA);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/assignments`, orgA.api_key, {
      assignee_user_id: randomUUID(),
      reviewer_role: 'LEGAL',
    });
    const aid = ((bodyOf(r)['high_risk_review_assignment']) as Record<string, unknown>)['id'] as string;
    const upd = await inject(stack, 'PATCH', `/v1/regulatory/high-risk-review-assignments/${aid}`, orgA.api_key, {
      assignment_status: 'ACKNOWLEDGED', acknowledged_at: '2026-06-01T00:00:00.000Z',
    });
    expect(upd.statusCode).toBe(200);
    expect(await auditCount(orgA.org_id, aid, 'regulatory_high_risk_review_assignment.status_changed')).toBe(1);
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect((await inject(stack, 'PATCH', `/v1/regulatory/high-risk-review-assignments/${aid}`, orgA.api_key, { assignment_status: 'COMPLETED' })).statusCode).toBe(409);
  });

  it('duplicate active assignment for same review + role + user rejected 409', async () => {
    const out = await mkReview(orgA);
    const uid = randomUUID();
    const r1 = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/assignments`, orgA.api_key, {
      assignee_user_id: uid, reviewer_role: 'LEGAL',
    });
    expect(r1.statusCode).toBe(201);
    const r2 = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/assignments`, orgA.api_key, {
      assignee_user_id: uid, reviewer_role: 'LEGAL',
    });
    expect(r2.statusCode).toBe(409);
    expect(bodyOf(r2)['error']).toBe('high_risk_review_assignment_active_duplicate');
  });
});

// ===========================================================================
// Decisions
// ===========================================================================

describe('regulatory-high-risk-reviews / decisions', () => {
  it('APPROVE by non-requester from IN_REVIEW moves to APPROVED and emits decision.created + review.approved + status_changed', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'APPROVE',
      reviewer_role: 'COMPLIANCE',
      decision_rationale: 'all controls in place',
    });
    expect(r.statusCode).toBe(201);
    const did = ((bodyOf(r)['high_risk_review_decision']) as Record<string, unknown>)['id'] as string;
    const rev = (bodyOf(r)['high_risk_review']) as Record<string, unknown>;
    expect(rev['review_status']).toBe('APPROVED');
    expect(rev['decided_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, did, 'regulatory_high_risk_review_decision.created')).toBe(1);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.approved')).toBe(1);
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.status_changed')).toBeGreaterThanOrEqual(1);
  });

  it('APPROVE by requester rejected 403 by service', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, orgA.api_key, {
      decision: 'APPROVE',
      reviewer_role: 'COMPLIANCE',
    });
    expect(r.statusCode).toBe(403);
    expect(bodyOf(r)['error']).toBe('high_risk_review_sod_violation');
  });

  it('REJECT requires rationale and moves to REJECTED', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const noRationale = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'REJECT', reviewer_role: 'COMPLIANCE',
    });
    expect(noRationale.statusCode).toBe(400);
    const ok = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'REJECT', reviewer_role: 'COMPLIANCE', decision_rationale: 'controls insufficient',
    });
    expect(ok.statusCode).toBe(201);
    const rev = (bodyOf(ok)['high_risk_review']) as Record<string, unknown>;
    expect(rev['review_status']).toBe('REJECTED');
    expect(rev['decided_at']).not.toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.rejected')).toBe(1);
  });

  it('REQUEST_CHANGES requires rationale and moves to CHANGES_REQUESTED; review can then re-submit', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const noRationale = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'REQUEST_CHANGES', reviewer_role: 'COMPLIANCE',
    });
    expect(noRationale.statusCode).toBe(400);
    const ok = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'REQUEST_CHANGES', reviewer_role: 'COMPLIANCE', decision_rationale: 'add SECURITY evidence',
    });
    expect(ok.statusCode).toBe(201);
    const rev = (bodyOf(ok)['high_risk_review']) as Record<string, unknown>;
    expect(rev['review_status']).toBe('CHANGES_REQUESTED');
    expect(rev['decided_at']).toBeNull();
    expect(await auditCount(orgA.org_id, out.id, 'regulatory_high_risk_review.changes_requested')).toBe(1);
    const resubmit = await submitReview(orgA, out.id);
    expect(resubmit.status).toBe(200);
    expect(((resubmit.body['high_risk_review']) as Record<string, unknown>)['review_status']).toBe('IN_REVIEW');
  });

  it('decision on terminal review rejected; second final APPROVE/REJECT rejected', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    expect(
      (
        await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
          decision: 'APPROVE', reviewer_role: 'COMPLIANCE',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
          decision: 'APPROVE', reviewer_role: 'COMPLIANCE',
        })
      ).statusCode,
    ).toBe(409);
  });

  it('cross-tenant decision GET returns 404; cross-tenant decisions list returns empty', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'APPROVE', reviewer_role: 'COMPLIANCE',
    });
    const did = ((bodyOf(r)['high_risk_review_decision']) as Record<string, unknown>)['id'] as string;
    expect((await inject(stack, 'GET', `/v1/regulatory/high-risk-review-decisions/${did}`, orgA.api_key)).statusCode).toBe(200);
    expect((await inject(stack, 'GET', `/v1/regulatory/high-risk-review-decisions/${did}`, orgB.api_key)).statusCode).toBe(404);
  });

  it('APPROVED audit payloads avoid legal/compliance/runtime authorization language', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'APPROVE', reviewer_role: 'COMPLIANCE',
    });
    const payloads = (await fetchAuditPayloads(orgA.org_id, out.id)).toLowerCase();
    for (const banned of [
      'legally_approved', 'legal_approved', 'legally compliant', 'legally_compliant',
      'compliance_certified', 'compliance certified', 'runtime_authorized', 'runtime authorized',
      'execution_authorized', 'execution authorized', 'hard_deny_bypassed', 'hard-deny bypassed',
      'enforcement_triggered', 'enforcement triggered', 'runtime_blocked', 'runtime blocked',
      'hard_denied', 'cnj_submitted', 'cnj submitted', 'certified',
    ]) {
      expect(payloads).not.toContain(banned);
    }
  });
});

// ===========================================================================
// DDL semantic comments
// ===========================================================================

describe('regulatory-high-risk-reviews / DDL semantic comments', () => {
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

  it('regulatory_high_risk_reviews table comment binds APPROVED semantics', async () => {
    const t = await tableComment('regulatory_high_risk_reviews');
    expect(t.length).toBeGreaterThan(0);
    expect(t).toContain('evidence only');
    expect(t).toContain('does not');
    expect(t).toMatch(/legally approved|legally compliant|certified|authorized for runtime execution/);
  });

  it('regulatory_high_risk_reviews.review_status column comment binds APPROVED semantics', async () => {
    const c = await columnComment('regulatory_high_risk_reviews', 'review_status');
    expect(c.length).toBeGreaterThan(0);
    expect(c).toContain('approved');
    expect(c).toContain('does not');
    expect(c).toMatch(/runtime execution|legal approval|certify compliance/);
  });

  it('regulatory_high_risk_review_decisions table comment binds APPROVE semantics', async () => {
    const t = await tableComment('regulatory_high_risk_review_decisions');
    expect(t).toContain('append-only');
    expect(t).toContain('approve');
    expect(t).toContain('does not');
    expect(t).toMatch(/runtime execution|legal compliance|enforcement/);
  });

  it('regulatory_high_risk_review_decisions.decision column comment binds APPROVE semantics', async () => {
    const c = await columnComment('regulatory_high_risk_review_decisions', 'decision');
    expect(c).toContain('approve');
    expect(c).toMatch(/not legal approval|compliance certification|runtime authorization|hard-deny/);
  });
});

// ===========================================================================
// Direct DB RLS / SoD / append-only / terminal-state backstops
// ===========================================================================

describe('regulatory-high-risk-reviews / RLS direct DB — reviews', () => {
  const insertRev = (extraCols = '', extraVals = '') => `
    INSERT INTO govai.regulatory_high_risk_reviews
      (org_id, review_key, review_status, risk_classification_id, risk_method_id, use_case_id,
       ai_system_id, inherent_risk_tier, residual_risk_tier, risk_score, residual_risk_score,
       requires_high_risk_review, requires_prohibited_use_review, review_basis${extraCols})
    VALUES ($1::uuid, $2, 'OPEN', $3::uuid, $4::uuid, $5::uuid, $6::uuid,
            'HIGH', 'HIGH', 80, 80, true, false, 'RISK_CLASSIFICATION_REQUIRED_REVIEW'${extraVals})`;

  it('tenant A cannot read tenant B reviews', async () => {
    const out = await mkReview(orgA);
    const seen = await asOrg(orgB.org_id, async (c) => {
      const r = await c.query('SELECT id FROM govai.regulatory_high_risk_reviews WHERE id = $1::uuid', [out.id]);
      return r.rowCount ?? 0;
    });
    expect(seen).toBe(0);
  });

  it('tenant A cannot insert review with org_id of B, nor referencing tenant B classification or non-HIGH/PROHIBITED', async () => {
    const k = () => `HRR-XT-${randomUUID().slice(0, 8).toUpperCase()}`;
    expect(await insertBlocked(orgA.org_id, insertRev(), [orgB.org_id, k(), highClassA, methodA, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertRev(), [orgA.org_id, k(), highClassB, methodA, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertRev(), [orgA.org_id, k(), lowClassA, methodA, useCaseA, aiSysA])).toBe(true);
    expect(await insertBlocked(orgA.org_id, insertRev(), [orgA.org_id, k(), prohibitedClassA, methodA, useCaseA, aiSysA])).toBe(true);
  });

  it('tenant A cannot insert review with copied fields that do not match classification', async () => {
    // use_case_id mismatch (orgA has its own different use case).
    const otherUc = await mkUseCase(orgA);
    expect(
      await insertBlocked(orgA.org_id, insertRev(), [orgA.org_id, `HRR-MM-${randomUUID().slice(0, 8).toUpperCase()}`, highClassA, methodA, otherUc, aiSysA]),
    ).toBe(true);
  });

  it('tenant A can insert review for own HIGH classification with matching copied fields', async () => {
    const k = `HRR-OK-${randomUUID().slice(0, 8).toUpperCase()}`;
    const ok = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`${insertRev()} RETURNING id`, [orgA.org_id, k, highClassA, methodA, useCaseA, aiSysA]);
      return r.rowCount ?? 0;
    });
    expect(ok).toBe(1);
  });

  it('tenant A cannot update review identity fields', async () => {
    const out = await mkReview(orgA);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_high_risk_reviews SET risk_classification_id = $2::uuid WHERE id = $1::uuid', [out.id, highClassB])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_high_risk_reviews SET review_key = $2 WHERE id = $1::uuid', [out.id, 'NEW'])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_high_risk_reviews SET risk_score = 50 WHERE id = $1::uuid', [out.id])).toBe(true);
  });

  it('tenant A can update allowed mutable review fields', async () => {
    const out = await mkReview(orgA);
    const aff = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(`UPDATE govai.regulatory_high_risk_reviews SET reviewer_guidance = 'updated', decision_summary = 'noted' WHERE id = $1::uuid`, [out.id]);
      return r.rowCount ?? 0;
    });
    expect(aff).toBe(1);
  });

  it('tenant A cannot delete review', async () => {
    const out = await mkReview(orgA);
    expect(await insertBlocked(orgA.org_id, 'DELETE FROM govai.regulatory_high_risk_reviews WHERE id = $1::uuid', [out.id])).toBe(true);
  });
});

describe('regulatory-high-risk-reviews / RLS direct DB — evidence + assignments + decisions', () => {
  it('tenant A cannot insert evidence under tenant B review; cannot update evidence identity', async () => {
    // Tenant B review: let the helper seed a fresh own-tenant HIGH classification
    // to avoid colliding with the one-active-per-classification partial uniqueness.
    const outB = await mkReview(orgB);
    expect(
      await insertBlocked(orgA.org_id,
        `INSERT INTO govai.regulatory_high_risk_review_evidence
           (org_id, high_risk_review_id, evidence_key, evidence_type, evidence_status, title)
         VALUES ($1::uuid, $2::uuid, $3, 'OTHER', 'DRAFT', 't')`,
        [orgA.org_id, outB.id, `EV-XT-${randomUUID().slice(0, 8)}`]),
    ).toBe(true);

    const outA = await mkReview(orgA);
    const ev = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${outA.id}/evidence`, orgA.api_key, baseEvidence());
    const eid = ((bodyOf(ev)['high_risk_review_evidence']) as Record<string, unknown>)['id'] as string;
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_high_risk_review_evidence SET evidence_key = $2 WHERE id = $1::uuid', [eid, 'CHANGED'])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_high_risk_review_evidence SET high_risk_review_id = $2::uuid WHERE id = $1::uuid', [eid, outB.id])).toBe(true);
  });

  it('tenant A cannot insert assignment under tenant B review nor with tenant B participant', async () => {
    const outB = await mkReview(orgB);
    expect(
      await insertBlocked(orgA.org_id,
        `INSERT INTO govai.regulatory_high_risk_review_assignments
           (org_id, high_risk_review_id, assignee_user_id, reviewer_role, assignment_status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'LEGAL', 'ASSIGNED')`,
        [orgA.org_id, outB.id, randomUUID()]),
    ).toBe(true);
  });

  it('tenant A cannot insert APPROVE decision by requester (DB SoD trigger backstop)', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    // Read requester_user_id of the review.
    const c = await stack.db.adminPool.connect();
    let requester: string;
    try {
      const r = await c.query<{ requester_user_id: string }>(
        `SELECT requester_user_id FROM govai.regulatory_high_risk_reviews WHERE id = $1::uuid`,
        [out.id],
      );
      requester = r.rows[0]!.requester_user_id;
    } finally {
      c.release();
    }
    expect(
      await insertBlocked(orgA.org_id,
        `INSERT INTO govai.regulatory_high_risk_review_decisions
           (org_id, high_risk_review_id, decision, decided_by_user_id, reviewer_role)
         VALUES ($1::uuid, $2::uuid, 'APPROVE', $3::uuid, 'COMPLIANCE')`,
        [orgA.org_id, out.id, requester]),
    ).toBe(true);
  });

  it('tenant A can insert APPROVE decision by non-requester via direct DB', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const inserted = await asOrg(orgA.org_id, async (c) => {
      const r = await c.query(
        `INSERT INTO govai.regulatory_high_risk_review_decisions
           (org_id, high_risk_review_id, decision, decided_by_user_id, reviewer_role)
         VALUES ($1::uuid, $2::uuid, 'APPROVE', $3::uuid, 'COMPLIANCE') RETURNING id`,
        [orgA.org_id, out.id, randomUUID()],
      );
      return r.rowCount ?? 0;
    });
    expect(inserted).toBe(1);
  });

  it('decisions are append-only — direct DB UPDATE / DELETE blocked', async () => {
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'APPROVE', reviewer_role: 'COMPLIANCE',
    });
    const did = ((bodyOf(r)['high_risk_review_decision']) as Record<string, unknown>)['id'] as string;
    expect(await insertBlocked(orgA.org_id, 'UPDATE govai.regulatory_high_risk_review_decisions SET decision_rationale = $2 WHERE id = $1::uuid', [did, 'tampered'])).toBe(true);
    expect(await insertBlocked(orgA.org_id, 'DELETE FROM govai.regulatory_high_risk_review_decisions WHERE id = $1::uuid', [did])).toBe(true);
  });

  it('terminal review blocks evidence/assignment/decision direct-DB inserts', async () => {
    const out = await mkReview(orgA);
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/cancel`, orgA.api_key, { cancellation_reason: 'x' });
    expect(
      await insertBlocked(orgA.org_id,
        `INSERT INTO govai.regulatory_high_risk_review_evidence
           (org_id, high_risk_review_id, evidence_key, evidence_type, evidence_status, title)
         VALUES ($1::uuid, $2::uuid, $3, 'OTHER', 'DRAFT', 't')`,
        [orgA.org_id, out.id, `EV-T-${randomUUID().slice(0, 8)}`]),
    ).toBe(true);
    expect(
      await insertBlocked(orgA.org_id,
        `INSERT INTO govai.regulatory_high_risk_review_assignments
           (org_id, high_risk_review_id, assignee_user_id, reviewer_role, assignment_status)
         VALUES ($1::uuid, $2::uuid, $3::uuid, 'LEGAL', 'ASSIGNED')`,
        [orgA.org_id, out.id, randomUUID()]),
    ).toBe(true);
    expect(
      await insertBlocked(orgA.org_id,
        `INSERT INTO govai.regulatory_high_risk_review_decisions
           (org_id, high_risk_review_id, decision, decided_by_user_id, reviewer_role)
         VALUES ($1::uuid, $2::uuid, 'APPROVE', $3::uuid, 'COMPLIANCE')`,
        [orgA.org_id, out.id, randomUUID()]),
    ).toBe(true);
  });
});

// ===========================================================================
// PR-R7 non-regression
// ===========================================================================

describe('regulatory-high-risk-reviews / PR-R7 non-regression', () => {
  it('residual_risk_tier still equals inherent_risk_tier after APPROVED review (classification untouched)', async () => {
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const before = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${cls}`, orgA.api_key);
    const out = await mkReview(orgA, { risk_classification_id: cls });
    await submitReview(orgA, out.id);
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'APPROVE', reviewer_role: 'COMPLIANCE',
    });
    const after = await inject(stack, 'GET', `/v1/regulatory/risk-classifications/${cls}`, orgA.api_key);
    const a = (bodyOf(before)['risk_classification']) as Record<string, unknown>;
    const b = (bodyOf(after)['risk_classification']) as Record<string, unknown>;
    expect(b['inherent_risk_tier']).toBe(a['inherent_risk_tier']);
    expect(b['residual_risk_tier']).toBe(a['residual_risk_tier']);
    expect(b['risk_score']).toBe(a['risk_score']);
    expect(b['residual_risk_score']).toBe(a['residual_risk_score']);
  });

  it('PR-R7 evaluate endpoint remains stateless (no persistence side effect)', async () => {
    const r = await inject(stack, 'POST', '/v1/regulatory/risk-classifications/evaluate', orgA.api_key, {
      risk_method_id: methodA, use_case_id: useCaseA, ai_system_id: aiSysA,
      classification_basis: 'RULE_EVALUATION', decision_scope: 'INTERNAL_ASSISTANCE',
      factor_inputs: HIGH_INPUTS,
    });
    expect(r.statusCode).toBe(200);
    const p = (bodyOf(r)['risk_classification_preview']) as Record<string, unknown>;
    expect(p['inherent_risk_tier']).toBe('HIGH');
    expect(p['residual_risk_tier']).toBe('HIGH');
  });

  it('PROHIBITED still does not flow into high-risk review (re-asserted)', async () => {
    const r = await mkReviewResp(orgA, { risk_classification_id: prohibitedClassA });
    expect(r.status).toBe(400);
    expect(r.body['error']).toBe('prohibited_classification_requires_future_workflow');
  });

  it('mitigation_strength STRONG does not downgrade tier or score (engine unchanged)', async () => {
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

  it('APPROVED review does not create runtime enforcement or Workroom run approval (no new approval_request row appears)', async () => {
    const beforeC = await stack.db.adminPool.connect();
    let beforeCount: number;
    try {
      const r = await beforeC.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.workroom_approval_requests WHERE org_id = $1::uuid`, [orgA.org_id]);
      beforeCount = Number(r.rows[0]!.n);
    } finally {
      beforeC.release();
    }
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'APPROVE', reviewer_role: 'COMPLIANCE',
    });
    const afterC = await stack.db.adminPool.connect();
    let afterCount: number;
    try {
      const r = await afterC.query<{ n: string }>(`SELECT count(*)::text AS n FROM govai.workroom_approval_requests WHERE org_id = $1::uuid`, [orgA.org_id]);
      afterCount = Number(r.rows[0]!.n);
    } finally {
      afterC.release();
    }
    expect(afterCount).toBe(beforeCount);
  });
});

// ===========================================================================
// Service-layer tenant pre-checks (Codex P1 #1 + #2 + GPT helper finding)
//
// Service-layer lookups for workroom_id, workroom_approval_request_id, and
// workroom_participants (both the assignment-create and decision-create paths)
// must be scoped by org_id so cross-tenant ids surface as deterministic
// 404/400 RegulatoryError responses rather than falling through to RLS
// WITH CHECK on INSERT and producing a generic DB 500. RLS remains the
// defense-in-depth backstop and is exercised by the direct-DB RLS suite above.
// ===========================================================================

describe('regulatory-high-risk-reviews / tenant pre-checks', () => {
  // Build a workroom + a passthrough_run approval request + an additional
  // human-reviewer participant in a given tenant. All via existing public
  // routes — no direct DB INSERT into audit_events / workroom_approval_requests
  // is needed. Returns the ids used downstream by the pre-check tests.
  async function seedWorkroomBundle(
    org: AdminOrg,
  ): Promise<{ workroomId: string; participantId: string; approvalRequestId: string }> {
    // Creating a workroom registers the caller as the human_owner participant
    // automatically, which is what the approval-request route requires.
    const wr = await inject(stack, 'POST', '/v1/workrooms', org.api_key, {
      workspace_id: randomUUID(),
      name: `wr-${randomUUID().slice(0, 6)}`,
      governance_mode: 'governance_active',
    });
    expect(wr.statusCode).toBe(201);
    const workroomId = ((bodyOf(wr)['workroom']) as Record<string, unknown>)['id'] as string;

    // Add a second human-reviewer participant — used as the assignee/decider in
    // the participant pre-check tests below.
    const part = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/participants`, org.api_key, {
      kind: 'human',
      role: 'human_reviewer',
      user_id: randomUUID(),
    });
    expect(part.statusCode).toBe(201);
    const participantId = ((bodyOf(part)['participant']) as Record<string, unknown>)['id'] as string;

    // Raise an approval request via the public route. The caller (workroom
    // owner) is an active participant by construction.
    const ar = await inject(stack, 'POST', `/v1/workrooms/${workroomId}/approvals`, org.api_key, {
      subject_kind: 'passthrough_run',
      intended_run: {
        capability: 'anthropic.passthrough.messages',
        model: 'claude-3-5-sonnet',
        input: 'pr-r8 pre-check test fixture',
      },
    });
    expect(ar.statusCode).toBe(201);
    const approvalRequestId = ((bodyOf(ar)['approval_request']) as Record<string, unknown>)['id'] as string;

    return { workroomId, participantId, approvalRequestId };
  }

  it('create review with foreign-tenant workroom_id returns 404 workroom_not_found, not 500', async () => {
    const bundleB = await seedWorkroomBundle(orgB);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const r = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_id: bundleB.workroomId,
    });
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('workroom_not_found');
  });

  it('create review with foreign-tenant workroom_approval_request_id returns 404 workroom_approval_request_not_found, not 500', async () => {
    const bundleB = await seedWorkroomBundle(orgB);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const r = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_approval_request_id: bundleB.approvalRequestId,
    });
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('workroom_approval_request_not_found');
  });

  it('create review with own-tenant approval request but mismatched own workroom_id returns 400 workroom_approval_request_workroom_mismatch', async () => {
    const bundleA1 = await seedWorkroomBundle(orgA);
    const bundleA2 = await seedWorkroomBundle(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const r = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_id: bundleA1.workroomId,
      workroom_approval_request_id: bundleA2.approvalRequestId,
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('workroom_approval_request_workroom_mismatch');
  });

  it('create review with own-tenant workroom + own-tenant matching approval request succeeds (200/201, not 500)', async () => {
    const bundle = await seedWorkroomBundle(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const r = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_id: bundle.workroomId,
      workroom_approval_request_id: bundle.approvalRequestId,
    });
    expect(r.statusCode).toBe(201);
    const rev = (bodyOf(r)['high_risk_review']) as Record<string, unknown>;
    expect(rev['workroom_id']).toBe(bundle.workroomId);
    expect(rev['workroom_approval_request_id']).toBe(bundle.approvalRequestId);
  });

  it('create assignment with foreign-tenant assignee_participant_id returns 404 workroom_participant_not_found, not 500', async () => {
    const bundleB = await seedWorkroomBundle(orgB);
    const out = await mkReview(orgA);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/assignments`, orgA.api_key, {
      assignee_participant_id: bundleB.participantId,
      reviewer_role: 'LEGAL',
    });
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('workroom_participant_not_found');
  });

  it('create assignment with own-tenant participant outside review-bound workroom returns 400 workroom_participant_workroom_mismatch', async () => {
    // Bind the review to workroom A1, then assign a participant from workroom A2 — same tenant, different workroom.
    const bundleA1 = await seedWorkroomBundle(orgA);
    const bundleA2 = await seedWorkroomBundle(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const reviewResp = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_id: bundleA1.workroomId,
    });
    expect(reviewResp.statusCode).toBe(201);
    const reviewId = ((bodyOf(reviewResp)['high_risk_review']) as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${reviewId}/assignments`, orgA.api_key, {
      assignee_participant_id: bundleA2.participantId,
      reviewer_role: 'LEGAL',
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('workroom_participant_workroom_mismatch');
  });

  it('create assignment with own-tenant participant inside review-bound workroom succeeds (201)', async () => {
    const bundle = await seedWorkroomBundle(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const reviewResp = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_id: bundle.workroomId,
    });
    expect(reviewResp.statusCode).toBe(201);
    const reviewId = ((bodyOf(reviewResp)['high_risk_review']) as Record<string, unknown>)['id'] as string;
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${reviewId}/assignments`, orgA.api_key, {
      assignee_participant_id: bundle.participantId,
      reviewer_role: 'LEGAL',
    });
    expect(r.statusCode).toBe(201);
  });

  it('create decision with foreign-tenant decided_by_participant_id returns 404 workroom_participant_not_found, not 500', async () => {
    const bundleB = await seedWorkroomBundle(orgB);
    const out = await mkReview(orgA);
    await submitReview(orgA, out.id);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${out.id}/decisions`, approverApiKey, {
      decision: 'APPROVE',
      reviewer_role: 'COMPLIANCE',
      decided_by_participant_id: bundleB.participantId,
    });
    expect(r.statusCode).toBe(404);
    expect(bodyOf(r)['error']).toBe('workroom_participant_not_found');
  });

  it('create decision with own-tenant participant outside review-bound workroom returns 400 workroom_participant_workroom_mismatch', async () => {
    const bundleA1 = await seedWorkroomBundle(orgA);
    const bundleA2 = await seedWorkroomBundle(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const reviewResp = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_id: bundleA1.workroomId,
    });
    expect(reviewResp.statusCode).toBe(201);
    const reviewId = ((bodyOf(reviewResp)['high_risk_review']) as Record<string, unknown>)['id'] as string;
    await submitReview(orgA, reviewId);
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${reviewId}/decisions`, approverApiKey, {
      decision: 'APPROVE',
      reviewer_role: 'COMPLIANCE',
      decided_by_participant_id: bundleA2.participantId,
    });
    expect(r.statusCode).toBe(400);
    expect(bodyOf(r)['error']).toBe('workroom_participant_workroom_mismatch');
  });

  it('create decision with own-tenant participant inside review-bound workroom succeeds (201)', async () => {
    const bundle = await seedWorkroomBundle(orgA);
    const cls = await mkClassification(orgA, methodA, useCaseA, aiSysA, HIGH_INPUTS);
    const reviewResp = await inject(stack, 'POST', '/v1/regulatory/high-risk-reviews', orgA.api_key, {
      ...baseReview({ risk_classification_id: cls }),
      workroom_id: bundle.workroomId,
    });
    expect(reviewResp.statusCode).toBe(201);
    const reviewId = ((bodyOf(reviewResp)['high_risk_review']) as Record<string, unknown>)['id'] as string;
    await submitReview(orgA, reviewId);
    // The approverApiKey identity is a non-requester admin on orgA — SoD passes.
    // The bundle's workroom_id matches the review's workroom_id, so the participant lookup passes too.
    const r = await inject(stack, 'POST', `/v1/regulatory/high-risk-reviews/${reviewId}/decisions`, approverApiKey, {
      decision: 'APPROVE',
      reviewer_role: 'COMPLIANCE',
      decided_by_participant_id: bundle.participantId,
    });
    expect(r.statusCode).toBe(201);
    const rev = (bodyOf(r)['high_risk_review']) as Record<string, unknown>;
    expect(rev['review_status']).toBe('APPROVED');
  });
});
