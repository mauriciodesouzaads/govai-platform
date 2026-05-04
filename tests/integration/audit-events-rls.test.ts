// RLS.1, RLS.2, RLS.3 — including redaction substring scan.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, stopStack, seedOrg, setBaselineDlpAction, inject, type Stack } from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

describe('audit events RLS + redaction', () => {
  it('RLS.1 — direct DB SELECT under org B does not see org A rows', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);

    // orgA inserts a run via the route.
    const r = await inject(stack, 'POST', '/v1/runs', orgA.api_key, {
      workspace_id: orgA.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'plain',
    });
    expect(r.statusCode).toBe(200);

    const c = await stack.db.appPool.connect();
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, orgB.org_id);
      const visible = await c.query(
        `SELECT count(*)::text AS c FROM govai.audit_events WHERE org_id = $1::uuid`,
        [orgA.org_id],
      );
      expect(visible.rows[0].c).toBe('0');
      const myEvents = await c.query(
        `SELECT count(*)::text AS c FROM govai.audit_events`,
      );
      expect(myEvents.rows[0].c).toBe('0');
      await c.query('COMMIT');
    } finally {
      c.release();
    }
  });

  it('RLS.2 — GET /v1/audit-events as orgA does not return orgB events', async () => {
    const orgA = await seedOrg(stack);
    const orgB = await seedOrg(stack);
    await inject(stack, 'POST', '/v1/runs', orgB.api_key, {
      workspace_id: orgB.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: 'orgB private content',
    });
    const list = await inject(stack, 'GET', '/v1/audit-events?chain_category=run', orgA.api_key);
    expect(list.statusCode).toBe(200);
    const body = list.body as { events: unknown[] };
    expect(body.events.length).toBe(0);
  });

  it('RLS.3 — sensitive content NOT leaked through GET /v1/audit-events (literal substring scan)', async () => {
    const org = await seedOrg(stack);
    // configure both detectors so input is partially redacted (action=redact)
    await setBaselineDlpAction(stack, org.org_id, 'cpf', 'redact');
    await setBaselineDlpAction(stack, org.org_id, 'email', 'redact');

    const sensitivePrompt =
      'meu CPF é 111.444.777-35 e email teste@exemplo.com.br, ajude com algo confidencial: TOKEN_SENSIVEL_XYZ';

    const created = await inject(stack, 'POST', '/v1/runs', org.api_key, {
      workspace_id: org.workspace_id,
      capability: 'anthropic.messages.create',
      model: 'claude-fixture-1',
      input: sensitivePrompt,
    });
    expect(created.statusCode).toBe(200);

    const list = await inject(stack, 'GET', '/v1/audit-events?chain_category=run', org.api_key);
    expect(list.statusCode).toBe(200);

    const raw = list.rawBody;
    // No sensitive literals leak through the metadata-only audit response.
    expect(raw).not.toContain('111.444.777-35');
    expect(raw).not.toContain('teste@exemplo.com.br');
    expect(raw).not.toContain('TOKEN_SENSIVEL_XYZ');
    expect(raw).not.toContain(sensitivePrompt);

    // Required metadata IS present.
    const body = list.body as { events: Array<Record<string, unknown>> };
    expect(body.events.length).toBeGreaterThan(0);
    const ev = body.events[0]!;
    expect(typeof ev['payload_hash']).toBe('string');
    expect(typeof ev['canonical_hash']).toBe('string');
    expect(typeof ev['hmac']).toBe('string');
    expect(typeof ev['event_type']).toBe('string');
    expect(typeof ev['chain_id']).toBe('string');
    expect(typeof ev['sequence_number']).toBe('number');
    expect(typeof ev['occurred_at']).toBe('string');
  });
});
