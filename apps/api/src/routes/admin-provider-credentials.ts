// /v1/admin/provider-credentials — PR3.1b (issue #22).
//
// Three admin endpoints for tenant-scoped provider credential management.
// Replaces the PR3.1a seed CLI bridge as the canonical operational path.
//
// Security:
// - All endpoints require an authenticated API key with the 'admin' role.
//   Non-admin keys receive 403 via requireAdmin → AdminAccessError.
// - Plaintext provider keys are accepted only in the POST request body and
//   are NEVER returned, logged, or persisted (envelope-encrypted via KMS).
// - Tenant isolation is enforced via RLS (SET LOCAL app.org_id + FORCE RLS
//   on govai.provider_credentials) — a tenant cannot read or mutate another
//   tenant's credentials. Cross-tenant attempts surface as 404, not 403,
//   because the row is invisible at the DB layer.
// - Audit chain: every set/revoke emits a ProviderCredentialSet /
//   ProviderCredentialRevoked event on chainIdFor(org_id, 'admin').

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { auditAppend, sha256 } from '@govai/core-audit';
import { setLocalAppOrgId } from '@govai/core-tenant';
import {
  chainIdFor,
  ProviderCredentialSetSchema,
  ProviderCredentialRevokedSchema,
} from '@govai/core-events';
import {
  createProviderCredential,
  revokeProviderCredential,
  ApiError,
} from '@govai/core-governance';
import { authenticateApiKey, AuthError, type AuthIdentity } from '../pipeline/auth.js';
import { requireAdmin, AdminAccessError } from '../pipeline/require-admin.js';

const SetBody = z.object({
  provider: z.enum(['anthropic', 'openai']),
  api_key: z.string().min(1).max(4096),
  reason: z.string().min(1).max(512),
});

const RevokeBody = z.object({
  reason: z.string().min(1).max(512),
});

const ListQuery = z.object({
  status: z.enum(['active', 'revoked', 'all']).default('all'),
});

function extractApiKey(req: FastifyRequest): string {
  const header = req.headers['x-govai-api-key'];
  if (typeof header === 'string') return header;
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  return '';
}

async function authenticateAndRequireAdmin(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthIdentity | null> {
  const apiKey = extractApiKey(req);
  const client = await app.govai.pool.connect();
  try {
    const identity = await authenticateApiKey(client, apiKey);
    requireAdmin(identity);
    return identity;
  } catch (err) {
    if (err instanceof AuthError) {
      reply.code(err.status);
      // Do NOT include the request body in this response — the API key from
      // the body (if this was a POST) must never echo back.
      reply.send({ error: 'auth_error', message: err.message });
      return null;
    }
    if (err instanceof AdminAccessError) {
      reply.code(err.status);
      reply.send({ error: err.code, required_role: err.required_role });
      return null;
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Map ApiError thrown by core-governance helpers to safe HTTP responses. The
 * helper errors are constructed with pre-redacted `details` (no plaintext) so
 * we can echo them directly.
 */
function sendApiError(reply: FastifyReply, err: ApiError): void {
  reply.code(err.status);
  reply.send({ error: err.code, ...(err.details ?? {}) });
}

export async function adminProviderCredentialsRoute(app: FastifyInstance): Promise<void> {
  // ============================================================================
  // POST /v1/admin/provider-credentials — set or rotate
  // ============================================================================
  app.post('/v1/admin/provider-credentials', async (req, reply) => {
    // Validate body BEFORE auth: a malformed body without an api_key field
    // still needs to be rejected, and Zod's safeParse never echoes string
    // *values* (only paths + messages), so plaintext cannot leak via 400.
    const parsed = SetBody.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }

    const identity = await authenticateAndRequireAdmin(app, req, reply);
    if (!identity) return reply;

    const { provider, api_key: plaintextKey, reason } = parsed.data;

    const client = await app.govai.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);

        const result = await createProviderCredential({
          db: client,
          kms: app.govai.kms,
          org_id: identity.org_id,
          provider,
          plaintext_key: plaintextKey,
          set_by_user_id: identity.user_id,
        });

        const chainId = chainIdFor(identity.org_id, 'admin');
        const auditPayload = {
          event_type: 'provider_credential.set' as const,
          schema_version: 1 as const,
          tenant_context: {
            org_id: identity.org_id,
            user_id: identity.user_id,
            tier: identity.tier,
            operational_mode: identity.operational_mode,
          },
          provider: result.provider,
          credential_id: result.id,
          key_prefix: result.key_prefix,
          key_last4: result.key_last4,
          kms_key_id: result.kms_key_id,
          kms_key_version: result.kms_key_version,
          set_by_user_id: result.set_by_user_id,
          set_at: result.set_at.toISOString(),
          replaced_credential_id: result.replaced_credential_id,
          audit_event_id: randomUUID(),
          chain_id: 'admin' as const,
        };
        const auditPayloadJson = JSON.stringify(auditPayload);

        const auditOut = await auditAppend(client, app.govai.kms, {
          orgId: identity.org_id,
          chainId,
          eventType: 'provider_credential.set',
          eventVersion: '1',
          subjectType: 'provider_credential',
          subjectId: result.id,
          occurredAt: new Date(),
          payloadHash: sha256(Buffer.from(auditPayloadJson, 'utf8')),
          keyId: 'audit-1',
          keyVersion: 1,
          redactionMetadata: {
            provider_credential_set: { ...auditPayload, audit_event_id: undefined },
            reason,
          },
        });
        // Replace the placeholder audit_event_id with the canonical one from
        // the chain so consumers can correlate. Schema-validate to assert no
        // plaintext field exists by construction.
        const canonicalEvent = {
          ...auditPayload,
          audit_event_id: auditOut.eventId,
        };
        ProviderCredentialSetSchema.parse(canonicalEvent);

        await client.query('COMMIT');

        reply.code(200);
        return {
          id: result.id,
          provider: result.provider,
          key_prefix: result.key_prefix,
          key_last4: result.key_last4,
          kms_key_id: result.kms_key_id,
          kms_key_version: result.kms_key_version,
          status: 'active' as const,
          set_at: result.set_at.toISOString(),
          replaced_credential_id: result.replaced_credential_id,
          audit_event_id: auditOut.eventId,
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (err instanceof ApiError) {
          sendApiError(reply, err);
          return reply;
        }
        // Unknown error — do not echo the request body.
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'admin provider-credentials set failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });

  // ============================================================================
  // POST /v1/admin/provider-credentials/:id/revoke
  // ============================================================================
  app.post<{ Params: { id: string } }>(
    '/v1/admin/provider-credentials/:id/revoke',
    async (req, reply) => {
      const credentialId = req.params.id;
      // UUID shape check; ApiError details from the helper are also safe.
      if (
        typeof credentialId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credentialId)
      ) {
        reply.code(400);
        return { error: 'invalid_credential_id' };
      }

      const parsed = RevokeBody.safeParse(req.body);
      if (!parsed.success) {
        reply.code(400);
        return {
          error: 'invalid_request',
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        };
      }

      const identity = await authenticateAndRequireAdmin(app, req, reply);
      if (!identity) return reply;

      const client = await app.govai.pool.connect();
      try {
        await client.query('BEGIN');
        try {
          await setLocalAppOrgId(client, identity.org_id);
          const result = await revokeProviderCredential({
            db: client,
            credential_id: credentialId,
            org_id: identity.org_id,
            revoked_by_user_id: identity.user_id,
            revocation_reason: parsed.data.reason,
          });

          const chainId = chainIdFor(identity.org_id, 'admin');
          const auditPayload = {
            event_type: 'provider_credential.revoked' as const,
            schema_version: 1 as const,
            tenant_context: {
              org_id: identity.org_id,
              user_id: identity.user_id,
              tier: identity.tier,
              operational_mode: identity.operational_mode,
            },
            provider: result.provider,
            credential_id: result.credential_id,
            key_prefix: result.key_prefix,
            key_last4: result.key_last4,
            revoked_at: result.revoked_at.toISOString(),
            revoked_by_user_id: result.revoked_by_user_id,
            revocation_reason: result.revocation_reason,
            audit_event_id: randomUUID(),
            chain_id: 'admin' as const,
          };
          const auditPayloadJson = JSON.stringify(auditPayload);

          const auditOut = await auditAppend(client, app.govai.kms, {
            orgId: identity.org_id,
            chainId,
            eventType: 'provider_credential.revoked',
            eventVersion: '1',
            subjectType: 'provider_credential',
            subjectId: result.credential_id,
            occurredAt: new Date(),
            payloadHash: sha256(Buffer.from(auditPayloadJson, 'utf8')),
            keyId: 'audit-1',
            keyVersion: 1,
            redactionMetadata: {
              provider_credential_revoked: { ...auditPayload, audit_event_id: undefined },
            },
          });

          const canonicalEvent = {
            ...auditPayload,
            audit_event_id: auditOut.eventId,
          };
          ProviderCredentialRevokedSchema.parse(canonicalEvent);

          await client.query('COMMIT');

          reply.code(200);
          return {
            id: result.credential_id,
            provider: result.provider,
            key_prefix: result.key_prefix,
            key_last4: result.key_last4,
            status: 'revoked' as const,
            revoked_at: result.revoked_at.toISOString(),
            revoked_by_user_id: result.revoked_by_user_id,
            revocation_reason: result.revocation_reason,
            audit_event_id: auditOut.eventId,
          };
        } catch (err) {
          await client.query('ROLLBACK').catch(() => undefined);
          if (err instanceof ApiError) {
            sendApiError(reply, err);
            return reply;
          }
          req.log.error(
            { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
            'admin provider-credentials revoke failed',
          );
          reply.code(500);
          return { error: 'internal_error' };
        }
      } finally {
        client.release();
      }
    },
  );

  // ============================================================================
  // GET /v1/admin/provider-credentials
  // ============================================================================
  app.get('/v1/admin/provider-credentials', async (req, reply) => {
    const parsed = ListQuery.safeParse(req.query);
    if (!parsed.success) {
      reply.code(400);
      return {
        error: 'invalid_query',
        issues: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      };
    }

    const identity = await authenticateAndRequireAdmin(app, req, reply);
    if (!identity) return reply;

    const client = await app.govai.pool.connect();
    try {
      await client.query('BEGIN');
      try {
        await setLocalAppOrgId(client, identity.org_id);

        const params: unknown[] = [];
        let where = 'TRUE';
        if (parsed.data.status === 'active') {
          where = "status = 'active'";
        } else if (parsed.data.status === 'revoked') {
          where = "status = 'revoked'";
        }
        // SELECT explicitly omits ciphertext + dek_wrapped; they would never
        // serialize meaningfully, but defense-in-depth: keep the bytea columns
        // off the wire entirely.
        const r = await client.query<{
          id: string;
          provider: 'anthropic' | 'openai';
          key_prefix: string;
          key_last4: string;
          kms_key_id: string;
          kms_key_version: number;
          status: 'active' | 'revoked';
          set_by_user_id: string;
          set_at: Date;
          revoked_at: Date | null;
          revoked_by_user_id: string | null;
          revocation_reason: string | null;
        }>(
          `SELECT id, provider, key_prefix, key_last4,
                  kms_key_id, kms_key_version, status,
                  set_by_user_id, set_at,
                  revoked_at, revoked_by_user_id, revocation_reason
             FROM govai.provider_credentials
            WHERE ${where}
            ORDER BY set_at DESC`,
          params,
        );
        await client.query('COMMIT');

        return {
          data: r.rows.map((row) => ({
            id: row.id,
            provider: row.provider,
            key_prefix: row.key_prefix,
            key_last4: row.key_last4,
            kms_key_id: row.kms_key_id,
            kms_key_version: row.kms_key_version,
            status: row.status,
            set_by_user_id: row.set_by_user_id,
            set_at: row.set_at.toISOString(),
            revoked_at: row.revoked_at ? row.revoked_at.toISOString() : null,
            revoked_by_user_id: row.revoked_by_user_id,
            revocation_reason: row.revocation_reason,
          })),
        };
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        req.log.error(
          { err_name: err instanceof Error ? err.name : 'unknown', org_id: identity.org_id },
          'admin provider-credentials list failed',
        );
        reply.code(500);
        return { error: 'internal_error' };
      }
    } finally {
      client.release();
    }
  });
}
