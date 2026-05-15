// /v1/runs orchestrator — UX shortcut over the governed-native surface.
//
// Macro Architecture Realignment: /v1/runs is no longer the universal core.
// It is a convenience entry that takes a simplified `{capability, model, input}`
// shape, runs the existing PR1 DLP+policy decision (input-string level), and
// then DELEGATES to the canonical governed-native handler (handle*GovernedX)
// living in @govai/provider-anthropic / @govai/provider-openai. The handler
// performs body-level DLP, tool classification, real risk + enforcement, native
// forward, and emits `passthrough.invoked v3` with capability_level='policy_governed'.
//
// Run lifecycle audit events (run.queued/run.completed/run.denied/run.failed)
// remain on the same chain so existing tests + audit chain integrity stay
// valid; the canonical fact is the v3 event.

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { auditAppend, sha256 } from '@govai/core-audit';
import type { Kms } from '@govai/core-identity';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainIdFor, type PassthroughInvoked } from '@govai/core-events';
import type { GovAIEnv } from '@govai/config';
import { detectAllBaseline } from '@govai/dlp-br';
import {
  handleAnthropicGovernedMessages,
  forwardRaw as forwardRawAnthropic,
  rewritePassthroughHeaders as rewriteAnthropicPassthroughHeaders,
  type AnthropicGovernedTenant,
  type AnthropicDlpScanFn,
} from '@govai/provider-anthropic';
import {
  handleOpenAIGovernedResponses,
  handleOpenAIGovernedChatCompletions,
  forwardRaw as forwardRawOpenai,
  rewritePassthroughHeaders as rewriteOpenaiPassthroughHeaders,
  type OpenAIGovernedTenant,
  type OpenAIDlpScanFn,
} from '@govai/provider-openai';

import { authenticateApiKey, AuthError, type AuthIdentity } from './auth.js';
import {
  assertCapabilityExecutable,
  isLoopbackUrl,
  loadOrgOverrides,
  resolveCapability,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
} from './capability-resolution.js';
import {
  resolveAnthropicProviderKey,
  resolveOpenAIProviderKey,
} from './provider-credentials.js';
import { dlpPreScan, redactFindings } from './dlp.js';
import { decidePolicy, persistPolicyDecision } from './policy.js';

export type SupportedCapabilityId =
  | 'anthropic.messages.create'
  | 'openai.responses.create'
  | 'openai.chat.completions.create';

export type RunRequest = {
  workspace_id: string;
  capability: string;
  model: string;
  input: string;
  /**
   * Execution mode for the run. Omitted / 'governed' → the enforcement-active
   * governed path (executeGovernedRun). 'passthrough' → the observe-only
   * provider-native forward path (executePassthroughRun). 'shadow' is admitted
   * by the DB enum but has no `/v1/runs` execution path and is rejected by the
   * route.
   */
  mode?: 'governed' | 'passthrough' | 'shadow';
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
  /** Hex of the canonical passthrough.invoked v3 event the governed handler emitted. */
  passthrough_invoked_event_id?: string;
};

export type OrchestratorDeps = {
  pool: Pool;
  kms: Kms;
  env: GovAIEnv;
  policyCommitSha: string;
};

/**
 * Resolve the upstream provider base URL the orchestrator should pass to the
 * governed handler. Mirrors the fallback behavior of the direct governed
 * routes (apps/api/src/routes/governed-{anthropic,openai}.ts):
 *
 * - If GOVAI_PROVIDER_BASE_URL is set and non-empty, use it (preserves
 *   hermetic loopback test behavior and any operator-pinned proxy).
 * - Otherwise, fall back to the canonical provider production URL.
 *
 * The previous orchestrator code defaulted to `'' (empty string)` when
 * GOVAI_PROVIDER_BASE_URL was unset — which caused the governed handler to
 * attempt `fetch('' + '/v1/messages')` and throw a URL parse error before
 * any network call, producing a fast pre-network 502 on /v1/runs in live
 * mode. The hermetic test fixture always sets GOVAI_PROVIDER_BASE_URL to a
 * loopback URL, so the bug was latent until PR3.1d live validation. See
 * issue #31.
 */
function providerUpstreamBaseUrl(env: GovAIEnv, provider: 'anthropic' | 'openai'): string {
  if (env.GOVAI_PROVIDER_BASE_URL && env.GOVAI_PROVIDER_BASE_URL.length > 0) {
    return env.GOVAI_PROVIDER_BASE_URL;
  }
  return provider === 'anthropic'
    ? 'https://api.anthropic.com'
    : 'https://api.openai.com';
}

function buildAnthropicMessagesBody(model: string, inputText: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: inputText }],
    }),
    'utf8',
  );
}

function buildOpenAIResponsesBody(model: string, inputText: string): Buffer {
  return Buffer.from(JSON.stringify({ model, input: inputText }), 'utf8');
}

function buildOpenAIChatCompletionsBody(model: string, inputText: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      model,
      messages: [{ role: 'user', content: inputText }],
    }),
    'utf8',
  );
}

function buildAnthropicTenant(identity: AuthIdentity): AnthropicGovernedTenant {
  return {
    org_id: identity.org_id,
    user_id: identity.user_id,
    tier: identity.tier,
    operational_mode: identity.operational_mode,
  };
}
function buildOpenAITenant(identity: AuthIdentity): OpenAIGovernedTenant {
  return {
    org_id: identity.org_id,
    user_id: identity.user_id,
    tier: identity.tier,
    operational_mode: identity.operational_mode,
  };
}

const inMemoryDlpScan: AnthropicDlpScanFn & OpenAIDlpScanFn = async (text) => {
  // The orchestrator already pre-scans (DB-aware) over the input string, so by
  // the time the body reaches the handler it is either redacted (no findings)
  // or accepted (findings emit a `dlp_decisions` audit entry but enforcement
  // already approved). The handler's own scan stays no-DB on this code path.
  const findings = detectAllBaseline(text);
  return {
    findings: findings.map((f) => ({
      detector: f.detector,
      signal_class:
        f.detector === 'cpf' || f.detector === 'cnpj' ? 'pii_strong' : 'pii_standard',
    })),
  };
};

export async function executeGovernedRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
): Promise<RunResponse> {
  const client = await deps.pool.connect();
  try {
    const identity = await authenticateApiKey(client, apiKey);

    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, identity.org_id);

      const overrides = await loadOrgOverrides(client, body.capability);
      const resolved = resolveCapability(body.capability, overrides);
      assertCapabilityExecutable(resolved, deps.env);

      const runId = randomUUID();
      const chainId = chainIdFor(identity.org_id, 'run');

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

      const dlp = await dlpPreScan(client, body.input);
      const { decision, needsRedaction } = decidePolicy(
        {
          capabilityId: body.capability,
          effectiveLevel: resolved.effectiveFacets[0]?.effectiveLevel ?? 1,
          policyCommitSha: deps.policyCommitSha,
        },
        dlp,
      );
      await persistPolicyDecision(client, identity.org_id, runId, decision);

      if (decision.kind === 'deny') {
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

      for (const f of dlp.findings) {
        await client.query(
          `INSERT INTO govai.dlp_findings (id, run_id, org_id, detector_id, detector_kind, count, action)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, 'baseline', 1, $5::text)`,
          [
            randomUUID(),
            runId,
            identity.org_id,
            f.detector,
            dlp.configByDetector.get(f.detector) ?? 'detect',
          ],
        );
      }

      const effectiveInput = needsRedaction ? redactFindings(body.input, dlp.findings) : body.input;

      await client.query(
        `UPDATE govai.runs SET status = 'running', started_at = now() WHERE id = $1::uuid`,
        [runId],
      );

      // The env baseUrl (possibly unset/empty) drives ONLY the hermetic
      // test-workspace-id injection below. The actual upstream URL passed to
      // the governed handler is resolved per-provider via
      // providerUpstreamBaseUrl() so the orchestrator's fallback matches the
      // direct routes' canonical production URLs.
      const envBaseUrl = deps.env.GOVAI_PROVIDER_BASE_URL ?? '';
      // Forward the test-only workspace discriminator only on hermetic loopback
      // (mirrors the PR1 pattern from the legacy provider-invoke). This lets
      // tests inject per-workspace upstream errors (HTTP 429/500/etc.) without
      // leaking the header in any real environment.
      const inboundHeaders: Record<string, string> = { 'content-type': 'application/json' };
      if (deps.env.NODE_ENV === 'test' && isLoopbackUrl(envBaseUrl)) {
        inboundHeaders['x-test-workspace-id'] = body.workspace_id;
      }

      // Capture the v3 audit event id emitted by the governed handler so we can
      // include it in RunResponse for client traceability.
      let v3EventId: string | undefined;
      const captureAudit = async (event: PassthroughInvoked): Promise<void> => {
        const json = JSON.stringify(event);
        const r = await auditAppend(client, deps.kms, {
          orgId: identity.org_id,
          chainId,
          eventType: 'passthrough.invoked',
          eventVersion: '3',
          subjectType: 'run',
          subjectId: runId,
          occurredAt: new Date(),
          payloadHash: sha256(Buffer.from(json, 'utf8')),
          keyId: 'audit-1',
          keyVersion: 1,
          redactionMetadata: {
            passthrough_invoked_v3: event as unknown as Record<string, unknown>,
          },
        });
        v3EventId = r.eventId;
      };

      // Dispatch to the governed handler matching the requested capability.
      let result:
        | Awaited<ReturnType<typeof handleAnthropicGovernedMessages>>
        | Awaited<ReturnType<typeof handleOpenAIGovernedResponses>>
        | Awaited<ReturnType<typeof handleOpenAIGovernedChatCompletions>>
        | null = null;

      try {
        // E2E.5 path: fetch network failures (DNS, connection refused, TLS)
        // bubble up from the governed handler. Convert into a structured
        // run.failed response with HTTP 502 instead of 500.
        if (body.capability === 'anthropic.messages.create') {
          result = await handleAnthropicGovernedMessages(
            {
              tenant: buildAnthropicTenant(identity),
              rawBody: buildAnthropicMessagesBody(body.model, effectiveInput),
              inboundHeaders,
              isStream: false,
            },
            {
              upstreamBaseUrl: providerUpstreamBaseUrl(deps.env, 'anthropic'),
              resolveProviderKey: async (orgId, operationalMode) =>
                resolveAnthropicProviderKey(
                  { env: deps.env, pool: deps.pool, kms: deps.kms },
                  { orgId, operationalMode },
                ),
              dlpScan: inMemoryDlpScan,
              emitAuditEvent: captureAudit,
            },
          );
        } else if (body.capability === 'openai.responses.create') {
          result = await handleOpenAIGovernedResponses(
            {
              tenant: buildOpenAITenant(identity),
              rawBody: buildOpenAIResponsesBody(body.model, effectiveInput),
              inboundHeaders,
              isStream: false,
            },
            {
              upstreamBaseUrl: providerUpstreamBaseUrl(deps.env, 'openai'),
              resolveProviderKey: async (orgId, operationalMode) =>
                resolveOpenAIProviderKey(
                  { env: deps.env, pool: deps.pool, kms: deps.kms },
                  { orgId, operationalMode },
                ),
              dlpScan: inMemoryDlpScan,
              emitAuditEvent: captureAudit,
            },
          );
        } else if (body.capability === 'openai.chat.completions.create') {
          result = await handleOpenAIGovernedChatCompletions(
            {
              tenant: buildOpenAITenant(identity),
              rawBody: buildOpenAIChatCompletionsBody(body.model, effectiveInput),
              inboundHeaders,
              isStream: false,
            },
            {
              upstreamBaseUrl: providerUpstreamBaseUrl(deps.env, 'openai'),
              resolveProviderKey: async (orgId, operationalMode) =>
                resolveOpenAIProviderKey(
                  { env: deps.env, pool: deps.pool, kms: deps.kms },
                  { orgId, operationalMode },
                ),
              dlpScan: inMemoryDlpScan,
              emitAuditEvent: captureAudit,
            },
          );
        } else {
          throw new CapabilityNotSupportedError(body.capability, 'planned');
        }
      } catch (err) {
        if (err instanceof CapabilityNotSupportedError || err instanceof CapabilityNotRegisteredError) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw err;
        }
        // Network / fetch failure → run.failed with 502.
        const failedInvocationId = randomUUID();
        const message = err instanceof Error ? err.message : String(err);
        await client.query(
          `INSERT INTO govai.provider_invocations (
             id, run_id, org_id, provider, native_endpoint, native_method,
             native_request_hash, native_response_hash, streaming, usage_json,
             latency_ms, status_code, provider_request_id, error_class
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::text, '/error', 'POST',
             '\\x00'::bytea, NULL, false, '{"source":"network_error"}'::jsonb,
             NULL, 0, NULL, 'network_error'
           )`,
          [
            failedInvocationId,
            runId,
            identity.org_id,
            body.capability.split('.')[0],
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
          payloadHash: sha256(Buffer.from(`network_error:${message}`)),
          keyId: 'audit-1',
          keyVersion: 1,
          redactionMetadata: {
            actor_user_id: identity.user_id,
            policy_decision_id: decision.id,
            provider_invocation_id: failedInvocationId,
            error_class: 'network_error',
            error_message: message.slice(0, 200),
          },
        });
        await client.query('COMMIT');
        return {
          run_id: runId,
          audit_chain_id: chainId,
          audit_event_id: failAudit.eventId,
          policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
          status: 'failed',
          provider_invocation_id: failedInvocationId,
        };
      }

      if (result.kind === 'blocked') {
        // governed-native blocked: persist failed run with the captured v3 audit
        // already in chain.
        const failedInvocationId = randomUUID();
        await client.query(
          `INSERT INTO govai.provider_invocations (
             id, run_id, org_id, provider, native_endpoint, native_method,
             native_request_hash, native_response_hash, streaming, usage_json,
             latency_ms, status_code, provider_request_id, error_class
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::text, '/governed-blocked', 'POST',
             '\\x00'::bytea, NULL, false, '{"source":"governed_blocked"}'::jsonb,
             0, 403, NULL, 'governed_blocked'
           )`,
          [
            failedInvocationId,
            runId,
            identity.org_id,
            body.capability.split('.')[0],
          ],
        );
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
          payloadHash: sha256(Buffer.from(`governed_blocked:${result.reason}`)),
          keyId: 'audit-1',
          keyVersion: 1,
          redactionMetadata: {
            actor_user_id: identity.user_id,
            policy_decision_id: decision.id,
            provider_invocation_id: failedInvocationId,
            governed_block_reason: result.reason,
          },
        });
        await client.query('COMMIT');
        return {
          run_id: runId,
          audit_chain_id: chainId,
          audit_event_id: denyAudit.eventId,
          policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
          status: 'denied',
          provider_invocation_id: failedInvocationId,
          ...(v3EventId ? { passthrough_invoked_event_id: v3EventId } : {}),
        };
      }

      if (result.kind === 'stream') {
        // /v1/runs does not currently expose streaming via this UX shortcut.
        // The governed-native surface (/governed/{provider}/*) handles streams.
        await client.query('ROLLBACK').catch(() => undefined);
        throw new Error('streaming not supported via /v1/runs UX shortcut; use /governed/* directly');
      }

      // Non-stream success: build response shape for /v1/runs. The handler
      // forwarded byte-perfect, so we parse the response JSON for the API
      // response only (audit chain already has the v3 event with the hash).
      let responseBodyParsed: unknown = null;
      if (result.response_body_raw.length > 0) {
        try {
          responseBodyParsed = JSON.parse(result.response_body_raw.toString('utf8'));
        } catch {
          responseBodyParsed = { raw: result.response_body_raw.toString('utf8') };
        }
      }

      // Provider returned non-2xx → run.failed.
      if (result.status_code < 200 || result.status_code >= 300) {
        const failedInvocationId = randomUUID();
        await client.query(
          `INSERT INTO govai.provider_invocations (
             id, run_id, org_id, provider, native_endpoint, native_method,
             native_request_hash, native_response_hash, streaming, usage_json,
             latency_ms, status_code, provider_request_id, error_class
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 'POST',
             $6::bytea, $7::bytea, false, '{"source":"governed_failed"}'::jsonb,
             $8::integer, $9::integer, $10::text, 'provider_error'
           )`,
          [
            failedInvocationId,
            runId,
            identity.org_id,
            body.capability.split('.')[0],
            result.audit_event.native_endpoint,
            Buffer.from(result.native_request_hash_hex, 'hex'),
            Buffer.from(result.native_response_hash_hex, 'hex'),
            result.latency_ms,
            result.status_code,
            result.provider_request_id ?? null,
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
          payloadHash: sha256(Buffer.from(`${result.status_code}:provider_error`)),
          keyId: 'audit-1',
          keyVersion: 1,
          redactionMetadata: {
            actor_user_id: identity.user_id,
            policy_decision_id: decision.id,
            provider_invocation_id: failedInvocationId,
            error_status: result.status_code,
            error_class: 'provider_error',
          },
        });
        await client.query('COMMIT');
        return {
          run_id: runId,
          audit_chain_id: chainId,
          audit_event_id: failAudit.eventId,
          policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
          status: 'failed',
          provider_invocation_id: failedInvocationId,
          ...(v3EventId ? { passthrough_invoked_event_id: v3EventId } : {}),
        };
      }

      // Persist successful provider_invocation row.
      const invocationId = randomUUID();
      await client.query(
        `INSERT INTO govai.provider_invocations (
           id, run_id, org_id, provider, native_endpoint, native_method,
           native_request_hash, native_response_hash, streaming, usage_json,
           latency_ms, status_code, provider_request_id, error_class
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 'POST',
           $6::bytea, $7::bytea, false, $8::jsonb,
           $9::integer, $10::integer, $11::text, NULL
         )`,
        [
          invocationId,
          runId,
          identity.org_id,
          body.capability.split('.')[0],
          result.audit_event.native_endpoint,
          Buffer.from(result.native_request_hash_hex, 'hex'),
          Buffer.from(result.native_response_hash_hex, 'hex'),
          JSON.stringify({
            provider_native:
              responseBodyParsed && typeof responseBodyParsed === 'object'
                ? (responseBodyParsed as { usage?: unknown }).usage ?? null
                : null,
            normalized: null,
            source: 'provider_direct',
            pricing_table_version: 'v0',
          }),
          result.latency_ms,
          result.status_code,
          result.provider_request_id ?? null,
        ],
      );

      await client.query(
        `UPDATE govai.runs SET status = 'completed', completed_at = now() WHERE id = $1::uuid`,
        [runId],
      );

      const completeAudit = await auditAppend(client, deps.kms, {
        orgId: identity.org_id,
        chainId,
        eventType: 'run.completed',
        eventVersion: '1',
        subjectType: 'run',
        subjectId: runId,
        occurredAt: new Date(),
        payloadHash: sha256(
          Buffer.from(
            JSON.stringify({
              run_id: runId,
              provider_invocation_id: invocationId,
              policy_decision_id: decision.id,
              provider_request_id: result.provider_request_id,
              finding_count: dlp.findings.length,
            }),
          ),
        ),
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: {
          actor_user_id: identity.user_id,
          policy_decision_id: decision.id,
          provider_invocation_id: invocationId,
          finding_count: dlp.findings.length,
        },
      });

      await client.query('COMMIT');
      return {
        run_id: runId,
        audit_chain_id: chainId,
        audit_event_id: completeAudit.eventId,
        policy_decision: { kind: decision.kind, reasons: [...decision.reasons] },
        output: responseBodyParsed,
        provider_invocation_id: invocationId,
        ...(v3EventId ? { passthrough_invoked_event_id: v3EventId } : {}),
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

// =============================================================================
// Passthrough run execution path (issue #54).
//
// `executeGovernedRun` is the enforcement-active path. `executePassthroughRun`
// is the observe-only counterpart: it performs the SAME provider call against
// the SAME provider-native upstream, but via the raw passthrough forwarder
// (`forwardRaw`) instead of the governed handler — no DLP redaction-mutation,
// no policy deny/mutate, no tool-classification block. It reuses the existing
// capability registry gating, credential resolver, body builders, and audit
// chain; it does not fork provider execution (forwardRaw is the shared,
// already-exported forwarder used by the `/passthrough/*` routes).
// =============================================================================

export type PassthroughRunResponse = {
  run_id: string;
  audit_chain_id: string;
  audit_event_id: string;
  mode: 'passthrough';
  status: 'completed' | 'failed';
  provider_invocation_id: string;
  native_request_hash: string;
  native_response_hash?: string;
  provider_request_id?: string;
  output?: unknown;
};

type PassthroughPlan = {
  provider: 'anthropic' | 'openai';
  nativeEndpoint: string;
  body: Buffer;
};

function passthroughPlanFor(capability: string, model: string, input: string): PassthroughPlan {
  switch (capability) {
    case 'anthropic.messages.create':
      return {
        provider: 'anthropic',
        nativeEndpoint: '/v1/messages',
        body: buildAnthropicMessagesBody(model, input),
      };
    case 'openai.responses.create':
      return {
        provider: 'openai',
        nativeEndpoint: '/v1/responses',
        body: buildOpenAIResponsesBody(model, input),
      };
    case 'openai.chat.completions.create':
      return {
        provider: 'openai',
        nativeEndpoint: '/v1/chat/completions',
        body: buildOpenAIChatCompletionsBody(model, input),
      };
    default:
      throw new CapabilityNotSupportedError(capability, 'planned');
  }
}

/**
 * Execute a standalone `/v1/runs` request in passthrough mode. Creates a real
 * `govai.runs` row with `mode='passthrough'`, forwards the provider-native call
 * raw (observe-only), persists a real `provider_invocations` row, and emits a
 * real `run.completed` / `run.failed` audit event on the existing `run` chain.
 * No governed enforcement/mutation is applied. No new audit chain.
 */
export async function executePassthroughRun(
  deps: OrchestratorDeps,
  apiKey: string,
  body: RunRequest,
): Promise<PassthroughRunResponse> {
  const client = await deps.pool.connect();
  try {
    const identity = await authenticateApiKey(client, apiKey);

    await client.query('BEGIN');
    try {
      await setLocalAppOrgId(client, identity.org_id);

      // Same capability-registry gating the governed path applies — planned
      // capabilities still cannot execute outside the hermetic environment.
      const overrides = await loadOrgOverrides(client, body.capability);
      const resolved = resolveCapability(body.capability, overrides);
      assertCapabilityExecutable(resolved, deps.env);

      const plan = passthroughPlanFor(body.capability, body.model, body.input);
      const chainId = chainIdFor(identity.org_id, 'run');

      // The provider-native request body is known up front, so compute its
      // sha256 once. Every record of this run — the provider_invocations row,
      // the API response, and the run.failed audit metadata on the
      // network/fetch failure path — carries this same real hash, never a
      // placeholder. (forwardRaw computes the identical hash on the success
      // path; using the precomputed value everywhere avoids future drift.)
      const nativeRequestHash = Buffer.from(sha256(plan.body));
      const nativeRequestHashHex = nativeRequestHash.toString('hex');

      // Resolve the tenant provider key BEFORE inserting the run row: if no
      // credential is available the provider call is never attempted, and no
      // `govai.runs` row should be persisted for it.
      const providerKey =
        plan.provider === 'anthropic'
          ? await resolveAnthropicProviderKey(
              { env: deps.env, pool: deps.pool, kms: deps.kms },
              { orgId: identity.org_id, operationalMode: identity.operational_mode },
            )
          : await resolveOpenAIProviderKey(
              { env: deps.env, pool: deps.pool, kms: deps.kms },
              { orgId: identity.org_id, operationalMode: identity.operational_mode },
            );

      const runId = randomUUID();
      await client.query(
        `INSERT INTO govai.runs (id, org_id, workspace_id, actor_user_id, provider, model, mode, status, metadata)
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::text, 'passthrough', 'queued', $7::jsonb)`,
        [
          runId,
          identity.org_id,
          body.workspace_id,
          identity.user_id,
          plan.provider,
          body.model,
          JSON.stringify(body.metadata ?? {}),
        ],
      );

      const envBaseUrl = deps.env.GOVAI_PROVIDER_BASE_URL ?? '';
      const inboundHeaders: Record<string, string> = { 'content-type': 'application/json' };
      // Hermetic loopback only: forward the test workspace discriminator so
      // tests can inject per-workspace upstream errors. Mirrors the governed path.
      if (deps.env.NODE_ENV === 'test' && isLoopbackUrl(envBaseUrl)) {
        inboundHeaders['x-test-workspace-id'] = body.workspace_id;
      }
      const outboundHeaders =
        plan.provider === 'anthropic'
          ? rewriteAnthropicPassthroughHeaders(inboundHeaders, providerKey).outbound
          : rewriteOpenaiPassthroughHeaders(inboundHeaders, providerKey).outbound;

      await client.query(
        `UPDATE govai.runs SET status = 'running', started_at = now() WHERE id = $1::uuid`,
        [runId],
      );

      const forwardRaw = plan.provider === 'anthropic' ? forwardRawAnthropic : forwardRawOpenai;
      let fwd: Awaited<ReturnType<typeof forwardRawAnthropic>>;
      try {
        fwd = await forwardRaw({
          baseUrl: providerUpstreamBaseUrl(deps.env, plan.provider),
          pathTemplate: plan.nativeEndpoint,
          concretePath: plan.nativeEndpoint,
          method: 'POST',
          headers: outboundHeaders,
          body: plan.body,
        });
      } catch (err) {
        // Network / fetch failure → the provider call was attempted, so the
        // run row persists with status='failed'.
        const message = err instanceof Error ? err.message : String(err);
        const failedInvocationId = randomUUID();
        await client.query(
          `INSERT INTO govai.provider_invocations (
             id, run_id, org_id, provider, native_endpoint, native_method,
             native_request_hash, native_response_hash, streaming, usage_json,
             latency_ms, status_code, provider_request_id, error_class
           ) VALUES (
             $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 'POST',
             $6::bytea, NULL, false, '{"source":"network_error"}'::jsonb,
             NULL, 0, NULL, 'network_error'
           )`,
          [
            failedInvocationId,
            runId,
            identity.org_id,
            plan.provider,
            plan.nativeEndpoint,
            nativeRequestHash,
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
          payloadHash: sha256(Buffer.from(`passthrough_network_error:${message}`)),
          keyId: 'audit-1',
          keyVersion: 1,
          redactionMetadata: {
            actor_user_id: identity.user_id,
            run_mode: 'passthrough',
            enforcement: 'observe',
            provider: plan.provider,
            capability: body.capability,
            provider_invocation_id: failedInvocationId,
            native_request_hash: nativeRequestHashHex,
            error_class: 'network_error',
            error_message: message.slice(0, 200),
          },
        });
        await client.query('COMMIT');
        return {
          run_id: runId,
          audit_chain_id: chainId,
          audit_event_id: failAudit.eventId,
          mode: 'passthrough',
          status: 'failed',
          provider_invocation_id: failedInvocationId,
          native_request_hash: nativeRequestHashHex,
        };
      }

      let responseBodyParsed: unknown = null;
      if (fwd.responseBody.length > 0) {
        try {
          responseBodyParsed = JSON.parse(fwd.responseBody.toString('utf8'));
        } catch {
          responseBodyParsed = { raw: fwd.responseBody.toString('utf8') };
        }
      }
      const ok = fwd.status >= 200 && fwd.status < 300;
      const invocationId = randomUUID();
      await client.query(
        `INSERT INTO govai.provider_invocations (
           id, run_id, org_id, provider, native_endpoint, native_method,
           native_request_hash, native_response_hash, streaming, usage_json,
           latency_ms, status_code, provider_request_id, error_class
         ) VALUES (
           $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, 'POST',
           $6::bytea, $7::bytea, false, $8::jsonb,
           $9::integer, $10::integer, $11::text, $12::text
         )`,
        [
          invocationId,
          runId,
          identity.org_id,
          plan.provider,
          plan.nativeEndpoint,
          nativeRequestHash,
          Buffer.from(fwd.native_response_hash, 'hex'),
          JSON.stringify({
            provider_native:
              responseBodyParsed && typeof responseBodyParsed === 'object'
                ? (responseBodyParsed as { usage?: unknown }).usage ?? null
                : null,
            normalized: null,
            source: 'provider_direct',
            pricing_table_version: 'v0',
          }),
          fwd.latency_ms,
          fwd.status,
          fwd.provider_request_id,
          ok ? null : 'provider_error',
        ],
      );

      await client.query(
        `UPDATE govai.runs SET status = $2::text, completed_at = now() WHERE id = $1::uuid`,
        [runId, ok ? 'completed' : 'failed'],
      );

      const runAudit = await auditAppend(client, deps.kms, {
        orgId: identity.org_id,
        chainId,
        eventType: ok ? 'run.completed' : 'run.failed',
        eventVersion: '1',
        subjectType: 'run',
        subjectId: runId,
        occurredAt: new Date(),
        payloadHash: sha256(
          Buffer.from(
            JSON.stringify({
              run_id: runId,
              provider_invocation_id: invocationId,
              status_code: fwd.status,
              native_request_hash: nativeRequestHashHex,
              native_response_hash: fwd.native_response_hash,
            }),
          ),
        ),
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: {
          actor_user_id: identity.user_id,
          run_mode: 'passthrough',
          enforcement: 'observe',
          provider: plan.provider,
          capability: body.capability,
          provider_invocation_id: invocationId,
          status_code: fwd.status,
          native_request_hash: nativeRequestHashHex,
          native_response_hash: fwd.native_response_hash,
          ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
        },
      });

      await client.query('COMMIT');
      return {
        run_id: runId,
        audit_chain_id: chainId,
        audit_event_id: runAudit.eventId,
        mode: 'passthrough',
        status: ok ? 'completed' : 'failed',
        provider_invocation_id: invocationId,
        native_request_hash: nativeRequestHashHex,
        native_response_hash: fwd.native_response_hash,
        ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
        output: responseBodyParsed,
      };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

export {
  AuthError,
  CapabilityNotSupportedError,
  CapabilityNotRegisteredError,
};
export type { AuthIdentity };

// Internal helper exported for unit testing only (run-orchestrator.test.ts).
// Not part of the public API; the double-underscore prefix marks it as
// test-only and discourages external consumption.
export { providerUpstreamBaseUrl as __test_providerUpstreamBaseUrl };
