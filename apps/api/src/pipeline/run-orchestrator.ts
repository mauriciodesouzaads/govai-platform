// Governed Run orchestrator: composes auth, tenant, capability, dlp, policy,
// provider-invoke, audit-append into one transaction-aware flow.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { auditAppend, sha256 } from '@govai/core-audit';
import type { Kms } from '@govai/core-identity';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainIdFor } from '@govai/core-events';
import type { GovAIEnv } from '@govai/config';

import { authenticateApiKey, AuthError, type AuthIdentity } from './auth.js';
import {
  assertCapabilityExecutable,
  loadOrgOverrides,
  resolveCapability,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
} from './capability-resolution.js';
import { dlpPreScan, redactFindings } from './dlp.js';
import { decidePolicy, persistPolicyDecision } from './policy.js';
import { invokeProvider, persistInvocation, ProviderInvokeError } from './provider-invoke.js';

export type SupportedCapabilityId =
  | 'anthropic.messages.create'
  | 'openai.responses.create'
  | 'openai.chat.completions.create';

export type RunRequest = {
  workspace_id: string;
  // Open string so unknown ids reach resolveCapability and become 404, not 400.
  capability: string;
  model: string;
  input: string;
  metadata?: Record<string, unknown>;
};

export type RunResponse = {
  run_id: string;
  audit_chain_id: string;
  audit_event_id: string;
  policy_decision: { kind: string; reasons: string[] };
  output?: unknown;
  status: 'completed' | 'denied' | 'failed';
  provider_invocation_id?: string;
};

export type OrchestratorDeps = {
  pool: Pool;
  kms: Kms;
  env: GovAIEnv;
  policyCommitSha: string;
};

const ANTHROPIC_KEYS = ['sk-ant-test-hermetic'] as const;

export async function executeGovernedRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
): Promise<RunResponse> {
  const client = await deps.pool.connect();
  try {
    // Step 1: auth (uses SECURITY DEFINER lookup; no tenant context needed yet).
    const identity = await authenticateApiKey(client, apiKey);

    // Step 2: open transaction + set tenant context.
    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, identity.org_id);

      // Step 3: capability resolution + hermetic guard.
      // Pass the resolved capability (not raw) so org-level status_override is honored.
      const overrides = await loadOrgOverrides(client, body.capability);
      const resolved = resolveCapability(body.capability, overrides);
      assertCapabilityExecutable(resolved, deps.env);

      const runId = randomUUID();
      const chainId = chainIdFor(identity.org_id, 'run');

      // Step 4: persist run row in `queued` state.
      await client.query(
        `INSERT INTO govai.runs (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, 'governed', 'queued', $7::jsonb)`,
        [
          runId,
          identity.org_id,
          body.workspace_id,
          identity.user_id,
          body.capability.split('.')[0],
          body.model,
          JSON.stringify(body.metadata ?? {}),
        ],
      );

      // Step 5: DLP pre-scan.
      const dlp = await dlpPreScan(client, body.input);

      // Step 6: policy decision.
      const { decision, needsRedaction } = decidePolicy(
        {
          capabilityId: body.capability,
          effectiveLevel: resolved.effectiveFacets[0]?.effectiveLevel ?? 1,
          policyCommitSha: deps.policyCommitSha,
        },
        dlp,
      );
      await persistPolicyDecision(client, identity.org_id, runId, decision);

      // Step 7: branch on decision.
      if (decision.kind === 'deny') {
        // Mark run failed/denied + audit.
        await client.query(
          `UPDATE govai.runs SET status = 'denied', completed_at = now() WHERE id = $1::uuid`,
          [runId],
        );
        const denyAudit = await auditAppend(client, deps.kms, {
          orgId: identity.org_id,
          chainId,
          eventType: 'run.denied',
          eventVersion: '1',
          subjectType: 'run',
          subjectId: runId,
          occurredAt: new Date(),
          payloadHash: sha256(Buffer.from(JSON.stringify(decision.reasons))),
          keyId: 'audit-1',
          keyVersion: 1,
          redactionMetadata: {
            actor_user_id: identity.user_id,
            policy_decision_id: decision.id,
            dlp_finding_count: dlp.findings.length,
          },
        });
        await client.query('COMMIT');
        return {
          run_id: runId,
          audit_chain_id: chainId,
          audit_event_id: denyAudit.eventId,
          policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
          status: 'denied',
        };
      }

      // Step 8: persist DLP findings.
      for (const f of dlp.findings) {
        await client.query(
          `INSERT INTO govai.dlp_findings (id, run_id, org_id, detector_id, detector_kind, count, action)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 'baseline', 1, $5::text)`,
          [randomUUID(), runId, identity.org_id, f.detector, dlp.configByDetector.get(f.detector) ?? 'detect'],
        );
      }

      const effectiveInput = needsRedaction ? redactFindings(body.input, dlp.findings) : body.input;

      // Step 9: provider invoke.
      await client.query(
        `UPDATE govai.runs SET status = 'running', started_at = now() WHERE id = $1::uuid`,
        [runId],
      );

      let invokeResult: Awaited<ReturnType<typeof invokeProvider>>;
      try {
        invokeResult = await invokeProvider({
          capability: body.capability as SupportedCapabilityId,
          model: body.model,
          inputText: effectiveInput,
          baseUrl: deps.env.GOVAI_PROVIDER_BASE_URL ?? '',
          headers: { 'x-api-key': ANTHROPIC_KEYS[0] },
          workspaceId: body.workspace_id,
          testMode: deps.env.NODE_ENV === 'test',
        });
      } catch (err) {
        if (err instanceof ProviderInvokeError) {
          // Persist failed invocation + audit + mark run failed.
          const failedInvocationId = randomUUID();
          await client.query(
            `INSERT INTO govai.provider_invocations (
               id, run_id, org_id, provider, native_endpoint, native_method,
               native_request_hash, native_response_hash, streaming, usage_json,
               latency_ms, status_code, provider_request_id, error_class
             ) VALUES (
               $1::uuid, $2::uuid, $3::uuid, $4::text, '/error', 'POST',
               '\\x00'::bytea, NULL, false, '{"source":"estimated_from_text"}'::jsonb,
               NULL, $5::integer, NULL, $6::text
             )`,
            [
              failedInvocationId,
              runId,
              identity.org_id,
              body.capability.split('.')[0],
              err.status,
              err.errorClass,
            ],
          );
          await client.query(
            `UPDATE govai.runs SET status = 'failed', completed_at = now() WHERE id = $1::uuid`,
            [runId],
          );
          const failAudit = await auditAppend(client, deps.kms, {
            orgId: identity.org_id,
            chainId,
            eventType: 'run.failed',
            eventVersion: '1',
            subjectType: 'run',
            subjectId: runId,
            occurredAt: new Date(),
            payloadHash: sha256(Buffer.from(`${err.status}:${err.errorClass}`)),
            keyId: 'audit-1',
            keyVersion: 1,
            redactionMetadata: {
              actor_user_id: identity.user_id,
              policy_decision_id: decision.id,
              provider_invocation_id: failedInvocationId,
              error_status: err.status,
              error_class: err.errorClass,
            },
          });
          await client.query('COMMIT');
          return {
            run_id: runId,
            audit_chain_id: chainId,
            audit_event_id: failAudit.eventId,
            policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
            provider_invocation_id: failedInvocationId,
            status: 'failed',
          };
        }
        throw err;
      }

      // Step 10: persist invocation success.
      await persistInvocation(client, identity.org_id, runId, body.capability, invokeResult);

      // Step 11: audit append (run.completed).
      await client.query(
        `UPDATE govai.runs SET status = 'completed', completed_at = now() WHERE id = $1::uuid`,
        [runId],
      );

      const auditPayload = {
        run_id: runId,
        provider_invocation_id: invokeResult.invocationId,
        policy_decision_id: decision.id,
        provider_request_id: invokeResult.providerRequestId,
        usage: invokeResult.usage,
        finding_count: dlp.findings.length,
      };
      const completeAudit = await auditAppend(client, deps.kms, {
        orgId: identity.org_id,
        chainId,
        eventType: 'run.completed',
        eventVersion: '1',
        subjectType: 'run',
        subjectId: runId,
        occurredAt: new Date(),
        payloadHash: sha256(Buffer.from(JSON.stringify(auditPayload))),
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: {
          actor_user_id: identity.user_id,
          policy_decision_id: decision.id,
          provider_invocation_id: invokeResult.invocationId,
          finding_count: dlp.findings.length,
        },
      });

      await client.query('COMMIT');
      return {
        run_id: runId,
        audit_chain_id: chainId,
        audit_event_id: completeAudit.eventId,
        policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
        output: invokeResult.responseBody,
        provider_invocation_id: invokeResult.invocationId,
        status: 'completed',
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

export { AuthError, CapabilityNotSupportedError, CapabilityNotRegisteredError, ProviderInvokeError };
export type { AuthIdentity };
