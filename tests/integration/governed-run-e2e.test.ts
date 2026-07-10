// E2E.1-E2E.5: full Governed Run pipeline against hermetic provider.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  setBaselineDlpAction,
  inject,
  configureProviderError,
  clearProviderErrors,
  type Stack,
} from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { verifyFullChain } from '@govai/core-audit';
import { DevKms } from '@govai/core-identity';
import { chainIdFor } from '@govai/core-events';

let stack: Stack;
let kms: DevKms;

beforeAll(async () => {
  stack = await startStack();
  kms = new DevKms(stack.seed);
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('Governed Run E2E', () => {
  it('E2E.1 — clean input completes, audit chain valid', async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'Olá, como vai?',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      run_id: string;
      audit_event_id: string;
      audit_chain_id: string;
      status: string;
      policy_decision: { kind: string };
      provider_invocation_id: string;
    };
    expect(body.status).toBe('completed');
    expect(body.policy_decision.kind).toBe('allow');
    expect(body.run_id).toBeDefined();
    expect(body.audit_event_id).toBeDefined();
    expect(body.provider_invocation_id).toBeDefined();

    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const chain = await verifyFullChain(c, kms, chainIdFor(org.org_id, 'run'));
      await c.query('COMMIT');
      expect(chain.valid).toBe(true);
      // Batch G: completed governed run emits 2 events on the chain —
      // `run.completed` (legacy lifecycle) + `passthrough.invoked v3` (canonical).
      expect(chain.events).toBe(2);
    } finally {
      c.release();
    }
  });

  it('E2E.2 — input with CPF (action=deny) → 403, audit run.denied, no provider invocation', async () => {
    const org = await seedOrg(stack);
    await setBaselineDlpAction(stack, org.org_id, 'cpf', 'deny');
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'Meu CPF é 111.444.777-35, posso ser ajudado?',
    });
    expect(res.statusCode).toBe(403);
    const body = res.body as { status: string; policy_decision: { kind: string } };
    expect(body.status).toBe('denied');
    expect(body.policy_decision.kind).toBe('deny');

    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const inv = await c.query(
        `SELECT count(*)::text AS c FROM govai.provider_invocations WHERE org_id = $1::uuid`,
        [org.org_id],
      );
      expect(inv.rows[0].c).toBe('0');
      const ev = await c.query(
        `SELECT event_type FROM govai.audit_events WHERE org_id = $1::uuid ORDER BY sequence_number`,
        [org.org_id],
      );
      expect(ev.rows.map((r: { event_type: string }) => r.event_type)).toEqual(['run.denied']);
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('E2E.3 — input with email (action=redact) → 200, redaction applied, audit decision=mutate', async () => {
    const org = await seedOrg(stack);
    await setBaselineDlpAction(stack, org.org_id, 'email', 'redact');
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'openai.responses.create',
      model: 'gpt-fixture-1',
      input: 'Mande email para teste@exemplo.com.br avisando.',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as { status: string; policy_decision: { kind: string }; output: { output: Array<{ content: Array<{ text: string }> }> } };
    expect(body.status).toBe('completed');
    expect(body.policy_decision.kind).toBe('mutate');
    // Echo response should not contain the literal email — confirms redaction reached the provider.
    const echo = JSON.stringify(body.output);
    expect(echo).not.toContain('teste@exemplo.com.br');
    expect(echo).toContain('REDACTED:email');
  });

  it('E2E.3b — F5/F6: CPF nu (casa cpf+phone_br, action=redact) → UM marcador, zero dígitos, 1 linha em dlp_findings', async () => {
    const org = await seedOrg(stack);
    await setBaselineDlpAction(stack, org.org_id, 'cpf', 'redact');
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'openai.responses.create',
      model: 'gpt-fixture-1',
      input: 'meu cpf 11144477735 ok',
    });
    expect(res.statusCode).toBe(200);
    const body = res.body as {
      run_id: string;
      status: string;
      policy_decision: { kind: string };
      output: unknown;
    };
    expect(body.status).toBe('completed');
    expect(body.policy_decision.kind).toBe('mutate');
    // O span fundido (cpf+phone_br) vira UM marcador rotulado pelo detector de
    // classe mais forte; nenhum dígito do CPF sobrevive; nada de phone_br.
    const echo = JSON.stringify(body.output);
    expect(echo).not.toContain('11144477735');
    expect(echo).toContain('REDACTED:cpf');
    expect(echo).not.toContain('REDACTED:phone_br');
    expect((echo.match(/REDACTED:/g) ?? []).length).toBe(1);

    // F6: a contagem persistida é por SPAN fundido — exatamente 1 linha, com a
    // ação efetiva do span.
    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const rows = await c.query(
        `SELECT detector_id, action, count FROM govai.dlp_findings WHERE run_id = $1::uuid`,
        [body.run_id],
      );
      await c.query('COMMIT');
      expect(rows.rows).toEqual([{ detector_id: 'cpf', action: 'redact', count: 1 }]);
    } finally {
      c.release();
    }
  });

  it('E2E.4 — cross-tenant: orgA run not visible to orgB GET /v1/audit-events', async () => {
    const orgA = await seedOrg(stack, 'orgA');
    const orgB = await seedOrg(stack, 'orgB');
    const created = await inject(stack, 'POST', '/v1/runs', orgA.api_key, {
      workspace_id: orgA.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'hello',
    });
    expect(created.statusCode).toBe(200);

    const events = await inject(stack, 'GET', '/v1/audit-events?chain_category=run', orgB.api_key);
    expect(events.statusCode).toBe(200);
    const ev = events.body as { events: Array<{ id: string }> };
    expect(ev.events).toEqual([]);
  });

  it('E2E.5 — provider network failure → /v1/runs returns 502 with status=failed and audit run.failed', async () => {
    // Run a fresh stack pointed at a closed loopback port so provider-invoke fails
    // with a network error (mapped to ProviderInvokeError → orchestrator failure path).
    const failStack = await startStack({
      GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:1' as unknown as string,
    });
    try {
      const org = await seedOrg(failStack);
      const res = await inject(failStack, 'POST', '/v1/runs', org.api_key, {
        workspace_id: org.workspace_id,
        capability: 'anthropic.messages.create',
        model: 'claude-fixture-1',
        input: 'test',
      });
      expect(res.statusCode).toBe(502);
      const body = res.body as {
        status: string;
        run_id: string;
        audit_event_id: string;
        provider_invocation_id?: string;
        policy_decision: { kind: string };
      };
      expect(body.status).toBe('failed');
      expect(body.policy_decision.kind).toBe('allow');
      expect(body.audit_event_id).toBeDefined();
      expect(body.provider_invocation_id).toBeDefined();

      // Audit chain reflects run.failed event.
      const events = await inject(failStack, 'GET', '/v1/audit-events?chain_category=run', org.api_key);
      expect(events.statusCode).toBe(200);
      const ev = events.body as { events: Array<{ event_type: string }> };
      expect(ev.events.map((e) => e.event_type)).toContain('run.failed');
    } finally {
      await stopStack(failStack);
    }
  });

  it('E2E.6 — unknown capability id → 404 capability_not_registered', async () => {
    const org = await seedOrg(stack);
    const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'imaginary.capability',
      model: 'whatever',
      input: 'x',
    });
    expect(res.statusCode).toBe(404);
    const body = res.body as { error: string; capability: string };
    expect(body.error).toBe('capability_not_registered');
    expect(body.capability).toBe('imaginary.capability');
  });

  it('E2E.7 — provider returns HTTP 429 → 502 + run.failed + audit chain still valid', async () => {
    const org = await seedOrg(stack);
    try {
      await configureProviderError(stack, { workspaceId: org.workspace_id, status: 429 });

      const res = await inject(stack, 'POST', '/v1/runs', org.api_key, {
        workspace_id: org.workspace_id,
        capability: 'anthropic.messages.create',
        model: 'claude-fixture-1',
        input: 'test 429 path',
      });

      expect(res.statusCode).toBe(502);
      const body = res.body as {
        status: string;
        run_id: string;
        audit_event_id: string;
        provider_invocation_id: string;
        policy_decision: { kind: string };
      };
      expect(body.status).toBe('failed');
      expect(body.policy_decision.kind).toBe('allow');
      expect(body.audit_event_id).toBeDefined();
      expect(body.provider_invocation_id).toBeDefined();

      // provider_invocation row carries status_code=429 and an error_class.
      const c = await stack.db.appPool.connect();
      try {
        await c.query('BEGIN');
        await setLocalAppOrgId(c, org.org_id);
        const inv = await c.query<{ status_code: number; error_class: string | null }>(
          `SELECT status_code, error_class FROM govai.provider_invocations WHERE id = $1::uuid`,
          [body.provider_invocation_id],
        );
        await c.query('COMMIT');
        expect(inv.rows[0]?.status_code).toBe(429);
        expect(inv.rows[0]?.error_class).toBeTruthy();
      } finally {
        c.release();
      }

      // Audit event run.failed is on the chain via the public route.
      const events = await inject(stack, 'GET', '/v1/audit-events?chain_category=run', org.api_key);
      expect(events.statusCode).toBe(200);
      const ev = events.body as { events: Array<{ event_type: string }> };
      expect(ev.events.map((e) => e.event_type)).toContain('run.failed');

      // verifyFullChain is still green — failure event didn't corrupt the chain.
      const c2 = await stack.db.appPool.connect();
      try {
        await c2.query('BEGIN');
        await setLocalAppOrgId(c2, org.org_id);
        const result = await verifyFullChain(c2, kms, chainIdFor(org.org_id, 'run'));
        await c2.query('COMMIT');
        expect(result.valid).toBe(true);
      } finally {
        c2.release();
      }
    } finally {
      // Clean up the override so following tests aren't poisoned.
      clearProviderErrors();
    }
  });
});
