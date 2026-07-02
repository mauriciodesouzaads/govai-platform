// EP-E2E-USER — the "real user" e2e: governed native-model chat with governance
// applied, no UI (tests/live/, CI-excluded; run: `pnpm test:live`).
//
// ★ SPEC-vs-SOURCE CORRECTION (flagged for the architect diff-verify): the spec's
// Part A trigger — "a CPF/CNPJ (pii_strong, C→D) → enforcement_blocked" — is NOT
// reachable on POST /governed/anthropic/v1/messages. That route hardcodes the
// capability `anthropic.messages.create`, which is base_risk_class 'A', and
// computeEffectiveRiskClass does NOT chain escalations (only from===base applies),
// so a CPF gives at most effective 'C' → decision 'ask' (never 'blocked').
// The deterministic block at source is a RISK-D TOOL: `bash_20241022` classifies
// as anthropic_defined_client_executed_bash, decision 'allowed', contributes 'D'
// (tool-classifier.ts:93-94) → base A escalates to effective D → computeEnforcement
// ('starter','D','production') === 'blocked' → enforcement_blocked:D. This meets
// EVERY Part-A assertion (403 + enforcement_blocked:<risk> + dummy-key + audited).
// We include a valid CPF as flavor (it IS detected → dlp:cpf:pii_strong in the
// reasons) plus a CPF-ONLY control proving CPF alone resolves to 'ask' (non-block).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  seedProviderCredential,
  type Stack,
} from '../integration/helpers/server-fixture.js';
import { createSeedHelpers, type SeedHelpers } from '../integration/helpers/evidence-seed.js';

// A checksum-valid Brazilian CPF (a pii_strong DLP trigger; source-confirmed valid
// in packages/dlp-br/src/baseline-detectors.test.ts).
const VALID_CPF = '111.444.777-35';

let stack: Stack;
let seed: SeedHelpers;
const auditEvents: unknown[] = [];

beforeAll(async () => {
  stack = await startStack();
  seed = createSeedHelpers(stack);
  const orig = stack.app.log.info.bind(stack.app.log);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stack.app.log.info = ((arg: any, msg?: string) => {
    if (arg && typeof arg === 'object' && arg.audit_event) auditEvents.push(arg.audit_event);
    return orig(arg, msg);
  }) as typeof stack.app.log.info;
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

function takeInvoked(): Array<Record<string, unknown>> {
  return auditEvents.filter(
    (e): e is Record<string, unknown> =>
      typeof e === 'object' && e !== null && (e as Record<string, unknown>).event_type === 'passthrough.invoked',
  );
}

// Force tier + operational_mode via the admin (superuser) pool — tier mutation is
// reserved for the admin role; tests bypass RLS as the model integration test does.
async function setTierMode(orgId: string, tier: string, mode: string): Promise<void> {
  const c = await stack.db.adminPool.connect();
  try {
    await c.query(`UPDATE govai.orgs SET tier = $2, operational_mode = $3 WHERE id = $1::uuid`, [
      orgId,
      tier,
      mode,
    ]);
  } finally {
    c.release();
  }
}

// The org's persisted outbox capture count — the DURABLE audit signal. Read as
// govai_app, single-org RLS-scoped, via the shipped seed helper's queryAsApp (the
// same audit_capture_outbox table evidenceSummary + Part 2's gauge source read).
// A RAW count (not /v1/evidence/summary): a fresh block capture is unsealed and not
// yet past-SLO, so the summary would only surface it with tSeal=0 — a raw count is
// the direct "the row landed" signal, decoupled from the seal SLO.
async function outboxCaptureCount(orgId: string): Promise<number> {
  const rows = await seed.queryAsApp<{ n: number }>(
    orgId,
    `SELECT count(*)::int AS n FROM govai.audit_capture_outbox`,
  );
  return rows[0]!.n;
}

// Bounded poll — the AuditBridge is best-effort + async (governed-anthropic.ts:74-80
// awaits it, but tolerate eventual consistency), so poll until the count reaches the
// target or a deadline (then return the last value → the assertion fails, not hangs).
// Mirrors Part 2's bounded Prometheus poll.
async function pollOutboxCaptureCount(orgId: string, target: number, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let last = await outboxCaptureCount(orgId);
  while (last < target && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
    last = await outboxCaptureCount(orgId);
  }
  return last;
}

describe('EP-E2E-USER Part A — governance BLOCKS at 403, structurally zero-spend', () => {
  it('a starter/production org + a risk-D tool → exactly 403 enforcement_blocked:D, provider never reached, audited', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack); // tier defaults to 'starter'
    await setTierMode(org.org_id, 'starter', 'production');
    // ★ NO provider credential seeded on purpose: the block returns (handle-messages.ts:296)
    //   BEFORE resolveProviderKey (:306) — a dummy/absent key still yielding a clean 403 is
    //   the PRIMARY proof the upstream was never called (a resolved key would surface an
    //   upstream error, not a govai 403).

    // BEFORE: the org's persisted outbox capture count (fresh org → 0). The (e)
    // assertion below proves the block DURABLY persisted a capture, not just logged.
    const before = await outboxCaptureCount(org.org_id);

    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        // CPF flavor (pii_strong, escalates A→C) + the risk-D tool (drives effective D → block).
        messages: [{ role: 'user', content: `meu CPF é ${VALID_CPF}` }],
        tools: [{ type: 'bash_20241022', name: 'sh' }],
      }),
    });

    // (a) exactly 403 (not a generic non-200)
    expect(res.statusCode).toBe(403);
    const body = res.json() as {
      error: string;
      reason: string;
      governance: {
        base_risk_class: string;
        effective_risk_class: string;
        risk_escalation_reasons: string[];
        enforcement_decision: string;
      };
    };
    // (b) the block reason literal enforcement_blocked:<risk>
    expect(body.error).toBe('governed_blocked');
    expect(body.reason).toBe('enforcement_blocked:D');
    expect(body.governance.effective_risk_class).toBe('D');
    expect(body.governance.enforcement_decision).toBe('blocked');
    // the tool drove D; the CPF was detected too (PII governance applied)
    expect(body.governance.risk_escalation_reasons).toContain('tool:anthropic_defined_client_executed_bash:d');
    expect(body.governance.risk_escalation_reasons).toContain('dlp:cpf:pii_strong');

    // (d) the blocked attempt is AUDITED (evidence even when blocked)
    const ev = takeInvoked()[0]!;
    expect(ev['enforcement_decision']).toBe('blocked');
    expect(ev['body_forward_mode']).toBe('blocked');
    expect(ev['latency_ms']).toBe(0);
    expect(ev['native_response_hash']).toBeUndefined();
    expect(ev['capability_id']).toBe('anthropic.messages.create');
    // (c) provider never reached: no credential was seeded, yet the govai 403 is clean.

    // (e) ★ DURABLY audited — the blocked attempt PERSISTED an outbox capture row, not
    //     just a log line. Because emitAuditEvent logs BEFORE awaiting the best-effort
    //     AuditBridge (governed-anthropic.ts:74-80, which swallows capture failures), a
    //     regression that dropped the persisted row would still pass the (d) log-spy
    //     checks above — so read the PERSISTED layer: assert the org's audit_capture_outbox
    //     count incremented by exactly 1 (bounded poll, single-org RLS-scoped).
    const afterCaptures = await pollOutboxCaptureCount(org.org_id, before + 1);
    expect(afterCaptures).toBe(before + 1);
  });

  it('control — a CPF WITHOUT a risk-D tool escalates to C → decision "ask" (non-blocking); CPF alone cannot 403 at base A', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    await setTierMode(org.org_id, 'starter', 'production');
    // 'ask' forwards to the provider → seed a DUMMY credential; the fixture points the
    // upstream at a loopback stub (GOVAI_PROVIDER_BASE_URL), so this is still zero real spend.
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-prod-fixture-AAAA',
      setByUserId: org.user_id,
    });

    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: `meu CPF é ${VALID_CPF}` }],
      }),
    });

    // ★ NOT a 403 — CPF alone (base A → effective C) does not block; it resolves to 'ask'.
    expect(res.statusCode).not.toBe(403);
    const ev = takeInvoked()[0]!;
    expect(ev['effective_risk_class']).toBe('C');
    expect(ev['enforcement_decision']).toBe('ask');
    expect(ev['risk_escalation_reasons']).toContain('dlp:cpf:pii_strong');
  });

  it('control — a CLEAN payload resolves to "observe" and forwards the native shape (stubbed upstream, zero spend)', async () => {
    auditEvents.length = 0;
    const org = await seedOrg(stack);
    await setTierMode(org.org_id, 'starter', 'production');
    await seedProviderCredential(stack, {
      orgId: org.org_id,
      provider: 'anthropic',
      plaintextKey: 'sk-ant-prod-fixture-AAAA',
      setByUserId: org.user_id,
    });

    const res = await stack.app.inject({
      method: 'POST',
      url: '/governed/anthropic/v1/messages',
      headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
      payload: JSON.stringify({
        model: 'claude-fixture-1',
        max_tokens: 100,
        messages: [{ role: 'user', content: 'hello governed' }],
      }),
    });

    expect(res.statusCode).toBe(200);
    const ev = takeInvoked()[0]!;
    expect(ev['effective_risk_class']).toBe('A');
    expect(ev['enforcement_decision']).toBe('observe');
    expect(ev['body_forward_mode']).toBe('raw');
    expect(typeof ev['native_response_hash']).toBe('string'); // forwarded to the (stub) provider
  });
});

// ── Part B — REAL native call, budget-capped << $0.01. Triple-gated; SKIPS unless
//    GOVAI_LIVE_PROVIDER_BUDGET_OK=1 AND a real ANTHROPIC_API_KEY is present. CI never
//    sets these. (This would need a stack pointed at the real provider, not the stub.)
const PART_B_ENABLED =
  process.env.GOVAI_LIVE_PROVIDER_BUDGET_OK === '1' && !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!PART_B_ENABLED)('EP-E2E-USER Part B — real native passthrough (<< $0.01, budget-acked)', () => {
  it('passthrough returns the native Anthropic top-level shape (max_tokens:1)', async () => {
    // A dedicated real-provider stack (no loopback stub) is required to spend; gated so
    // this only runs under an explicit budget acknowledgement, never in CI.
    const real = await startStack({
      GOVAI_PROVIDER_BASE_URL: undefined,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    } as never);
    try {
      const org = await seedOrg(real);
      await seedProviderCredential(real, {
        orgId: org.org_id,
        provider: 'anthropic',
        plaintextKey: process.env.ANTHROPIC_API_KEY!,
        setByUserId: org.user_id,
      });
      const res = await real.app.inject({
        method: 'POST',
        url: '/passthrough/anthropic/v1/messages',
        headers: { 'content-type': 'application/json', 'x-govai-api-key': org.api_key },
        payload: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as Record<string, unknown>;
      // NATIVE top-level shape (not a govai envelope).
      expect(body['type']).toBe('message');
      expect(body['role']).toBe('assistant');
      expect(Array.isArray(body['content'])).toBe(true);
      expect(body).toHaveProperty('stop_reason');
    } finally {
      await stopStack(real);
    }
  });
});
