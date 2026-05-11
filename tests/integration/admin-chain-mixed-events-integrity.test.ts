// Admin-chain mixed-events integrity — PR3.1b addendum (issue #22).
//
// Goal: prove the `<orgId>:admin` chain remains hash/sequence-coherent when
// heterogeneous admin event types coexist on it. PR3.1b adds two new admin
// event types (ProviderCredentialSet, ProviderCredentialRevoked); the chain
// must keep linking correctly when other admin schemas land on it too.
//
// Approach:
// 1) Call POST /v1/admin/provider-credentials (emits ProviderCredentialSet).
// 2) Append a synthetic OrgBetaOverrideSet event directly via auditAppend
//    (no runtime emitter exists for this schema, so this is the cleanest way
//    to inject a heterogeneous event type into the same chain).
// 3) Call POST /v1/admin/provider-credentials/:id/revoke (emits
//    ProviderCredentialRevoked).
// 4) Verify the chain end-to-end:
//      - sequence_number monotonic (1,2,3);
//      - previous_hmac links correctly across all three events;
//      - each event's redaction_metadata payload parses with its own Zod
//        schema;
//      - no plaintext provider key appears in any chain row.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  startStack,
  stopStack,
  seedOrg,
  grantAdminRole,
  type Stack,
} from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { auditAppend, sha256 } from '@govai/core-audit';
import {
  chainIdFor,
  ProviderCredentialSetSchema,
  ProviderCredentialRevokedSchema,
  OrgBetaOverrideSetSchema,
} from '@govai/core-events';

const PROVIDER_KEY_PLAINTEXT = 'sk-ant-tenant-matrix-test-PLAINTEXT';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

async function injectAdmin(
  method: 'POST',
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown }> {
  const res = await stack.app.inject({
    method,
    url,
    headers: { 'content-type': 'application/json', 'x-govai-api-key': apiKey },
    payload: JSON.stringify(body),
  });
  let parsed: unknown;
  try {
    parsed = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return { statusCode: res.statusCode, body: parsed };
}

interface AdminChainRow {
  id: string;
  chain_id: string;
  sequence_number: string;
  event_type: string;
  event_version: string;
  subject_type: string;
  subject_id: string;
  previous_hmac: Buffer | null;
  hmac: Buffer;
  redaction_metadata: Record<string, unknown>;
}

async function fetchAdminChain(orgId: string): Promise<AdminChainRow[]> {
  const chainId = chainIdFor(orgId, 'admin');
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    const r = await c.query<AdminChainRow>(
      `SELECT id, chain_id, sequence_number, event_type, event_version,
              subject_type, subject_id, previous_hmac, hmac, redaction_metadata
         FROM govai.audit_events
        WHERE chain_id = $1
        ORDER BY sequence_number ASC`,
      [chainId],
    );
    await c.query('COMMIT');
    return r.rows;
  } finally {
    c.release();
  }
}

describe('admin-chain mixed-events integrity', () => {
  it('ProviderCredentialSet + OrgBetaOverrideSet + ProviderCredentialRevoked coexist with coherent chain links', async () => {
    const org = await seedOrg(stack);
    await grantAdminRole(stack, org.api_key_prefix);

    // 1) Set provider credential → emits ProviderCredentialSet (seq 1).
    const setRes = await injectAdmin(
      'POST',
      '/v1/admin/provider-credentials',
      org.api_key,
      {
        provider: 'anthropic',
        api_key: PROVIDER_KEY_PLAINTEXT,
        reason: 'mixed-chain step 1',
      },
    );
    expect(setRes.statusCode).toBe(200);
    const credentialId = (setRes.body as { id: string }).id;

    // 2) Inject an OrgBetaOverrideSet event onto the same chain directly via
    //    auditAppend. This schema has no runtime emitter today, but it is a
    //    valid admin event and tests the chain's heterogeneity contract.
    const overrideId = randomUUID();
    const setByUserId = randomUUID();
    const setAt = new Date();
    const expiresAt = new Date(setAt.getTime() + 86_400_000);
    const overridePayload = {
      event_type: 'org.beta_override_set' as const,
      schema_version: 1 as const,
      tenant_context: {
        org_id: org.org_id,
        user_id: setByUserId,
        tier: 'starter' as const,
        operational_mode: 'test' as const,
      },
      provider: 'anthropic' as const,
      override_id: overrideId,
      beta_token: 'message-batches-2024-09-24',
      reason: 'mixed-chain step 2: synthetic OrgBetaOverrideSet event',
      set_by_user_id: setByUserId,
      set_at: setAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      policy_at_resolution: 'org_override_allowed' as const,
      audit_event_id: randomUUID(),
      chain_id: 'admin' as const,
    };
    const overridePayloadJson = JSON.stringify(overridePayload);
    const c = await stack.db.appPool.connect();
    let auditOverrideId: string;
    try {
      await c.query('BEGIN');
      await setLocalAppOrgId(c, org.org_id);
      const out = await auditAppend(c, stack.app.govai.kms, {
        orgId: org.org_id,
        chainId: chainIdFor(org.org_id, 'admin'),
        eventType: 'org.beta_override_set',
        eventVersion: '1',
        subjectType: 'org_beta_override',
        subjectId: overrideId,
        occurredAt: setAt,
        payloadHash: sha256(Buffer.from(overridePayloadJson, 'utf8')),
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: {
          org_beta_override_set: { ...overridePayload, audit_event_id: undefined },
        },
      });
      auditOverrideId = out.eventId;
      await c.query('COMMIT');
    } catch (err) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      c.release();
    }

    // 3) Revoke provider credential → emits ProviderCredentialRevoked (seq 3).
    const revRes = await injectAdmin(
      'POST',
      `/v1/admin/provider-credentials/${credentialId}/revoke`,
      org.api_key,
      { reason: 'mixed-chain step 3' },
    );
    expect(revRes.statusCode).toBe(200);

    // 4) Verify the chain end-to-end.
    const chain = await fetchAdminChain(org.org_id);
    expect(chain.length).toBe(3);
    const [e1, e2, e3] = chain;
    expect(e1!.event_type).toBe('provider_credential.set');
    expect(e2!.event_type).toBe('org.beta_override_set');
    expect(e3!.event_type).toBe('provider_credential.revoked');

    // Sequence numbers monotonic 1,2,3.
    expect(BigInt(e1!.sequence_number)).toBe(1n);
    expect(BigInt(e2!.sequence_number)).toBe(2n);
    expect(BigInt(e3!.sequence_number)).toBe(3n);

    // First event has no previous_hmac; subsequent events link via prev.hmac.
    expect(e1!.previous_hmac).toBeNull();
    expect(e2!.previous_hmac).not.toBeNull();
    expect(Buffer.from(e2!.previous_hmac!).equals(Buffer.from(e1!.hmac))).toBe(true);
    expect(e3!.previous_hmac).not.toBeNull();
    expect(Buffer.from(e3!.previous_hmac!).equals(Buffer.from(e2!.hmac))).toBe(true);

    // Each event's payload (reconstructed from redaction_metadata + audit_event_id)
    // parses with its canonical schema.
    const e1Payload = {
      ...(e1!.redaction_metadata as { provider_credential_set: Record<string, unknown> })
        .provider_credential_set,
      audit_event_id: e1!.id,
    };
    expect(ProviderCredentialSetSchema.safeParse(e1Payload).success).toBe(true);

    const e2Payload = {
      ...(e2!.redaction_metadata as { org_beta_override_set: Record<string, unknown> })
        .org_beta_override_set,
      audit_event_id: auditOverrideId,
    };
    expect(OrgBetaOverrideSetSchema.safeParse(e2Payload).success).toBe(true);

    const e3Payload = {
      ...(e3!.redaction_metadata as {
        provider_credential_revoked: Record<string, unknown>;
      }).provider_credential_revoked,
      audit_event_id: e3!.id,
    };
    expect(ProviderCredentialRevokedSchema.safeParse(e3Payload).success).toBe(true);

    // No provider plaintext on the chain.
    const allChainJson = JSON.stringify(chain);
    expect(allChainJson).not.toContain(PROVIDER_KEY_PLAINTEXT);
    expect(allChainJson).not.toContain('PLAINTEXT');

    // Subject ids consistent.
    expect(e1!.subject_id).toBe(credentialId);
    expect(e1!.subject_type).toBe('provider_credential');
    expect(e2!.subject_id).toBe(overrideId);
    expect(e2!.subject_type).toBe('org_beta_override');
    expect(e3!.subject_id).toBe(credentialId);
    expect(e3!.subject_type).toBe('provider_credential');
  });
});
