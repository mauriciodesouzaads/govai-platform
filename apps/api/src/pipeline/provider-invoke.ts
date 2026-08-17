// Provider invoke step. In runtime-patch-1 this calls the hermetic
// provider-protocol test server via plain fetch, not the SDKs (PR2 wires SDKs).

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { sha256 } from '@govai/core-audit';
import { extractAnthropicRequestId } from '@govai/provider-anthropic';
import { isLoopbackUrl } from './capability-resolution.js';

export type ProviderInvokeInput = {
  capability: 'anthropic.messages.create' | 'openai.responses.create' | 'openai.chat.completions.create';
  model: string;
  inputText: string;
  baseUrl: string;
  headers?: Record<string, string>;
  /**
   * Test-only discriminator forwarded to the hermetic provider-protocol server
   * via `x-test-workspace-id` so suites can inject per-workspace HTTP errors.
   * Forwarded ONLY when buildProviderHeaders sees NODE_ENV='test' AND a loopback
   * baseUrl. In any other environment it is silently dropped.
   */
  workspaceId?: string;
  /**
   * Hermetic-mode signal. Defaults to false. The orchestrator sets this from
   * `env.NODE_ENV === 'test'`; production callers leave it false.
   */
  testMode?: boolean;
};

/**
 * Pure header builder — extracted so the hermetic-only forwarding rule can be
 * unit-tested independently. Returns the header object that fetch() will send.
 */
export function buildProviderHeaders(input: {
  baseUrl: string;
  workspaceId?: string;
  testMode?: boolean;
  baseHeaders?: Record<string, string>;
}): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...input.baseHeaders,
  };
  // Forward x-test-workspace-id ONLY in NODE_ENV=test AND when the provider is
  // a loopback URL. Both conditions must hold; either one missing → drop.
  if (input.testMode === true && isLoopbackUrl(input.baseUrl) && input.workspaceId) {
    headers['x-test-workspace-id'] = input.workspaceId;
  }
  return headers;
}

export type ProviderInvokeResult = {
  invocationId: string;
  endpoint: string;
  method: 'POST';
  requestBody: Record<string, unknown>;
  requestHash: Uint8Array;
  responseStatus: number;
  responseBody: unknown;
  responseHash: Uint8Array | null;
  providerRequestId: string | null;
  latencyMs: number;
  errorClass: string | null;
  usage: { input_tokens: number; output_tokens: number; total_tokens: number } | null;
};

export class ProviderInvokeError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly errorClass: string,
  ) {
    super(message);
    this.name = 'ProviderInvokeError';
  }
}

function endpointFor(capability: ProviderInvokeInput['capability']): string {
  switch (capability) {
    case 'anthropic.messages.create':
      return '/v1/messages';
    case 'openai.responses.create':
      return '/v1/responses';
    case 'openai.chat.completions.create':
      return '/v1/chat/completions';
  }
}

function buildRequestBody(input: ProviderInvokeInput): Record<string, unknown> {
  switch (input.capability) {
    case 'anthropic.messages.create':
      return {
        model: input.model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: input.inputText }],
      };
    case 'openai.responses.create':
      return {
        model: input.model,
        input: input.inputText,
      };
    case 'openai.chat.completions.create':
      return {
        model: input.model,
        messages: [{ role: 'user', content: input.inputText }],
      };
  }
}

function classifyStatus(status: number): string | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 503 || status === 529) return 'overloaded';
  if (status >= 500) return 'server_error';
  return 'unknown';
}

function extractUsage(
  capability: ProviderInvokeInput['capability'],
  body: unknown,
): { input_tokens: number; output_tokens: number; total_tokens: number } | null {
  if (typeof body !== 'object' || body === null) return null;
  const u = (body as { usage?: Record<string, number> }).usage;
  if (!u) return null;
  if (capability === 'anthropic.messages.create') {
    if (typeof u['input_tokens'] === 'number' && typeof u['output_tokens'] === 'number') {
      const inT = u['input_tokens'];
      const outT = u['output_tokens'];
      return { input_tokens: inT, output_tokens: outT, total_tokens: inT + outT };
    }
  }
  if (capability === 'openai.responses.create') {
    if (typeof u['input_tokens'] === 'number' && typeof u['output_tokens'] === 'number') {
      const inT = u['input_tokens'];
      const outT = u['output_tokens'];
      return { input_tokens: inT, output_tokens: outT, total_tokens: inT + outT };
    }
  }
  if (capability === 'openai.chat.completions.create') {
    if (typeof u['prompt_tokens'] === 'number' && typeof u['completion_tokens'] === 'number') {
      const inT = u['prompt_tokens'];
      const outT = u['completion_tokens'];
      return { input_tokens: inT, output_tokens: outT, total_tokens: inT + outT };
    }
  }
  return null;
}

/**
 * M2A F1 — provider-AWARE request id extraction for the shared dispatcher.
 * The dispatcher knows its concrete capability, so it must never apply one
 * provider's identifier names to another:
 *   anthropic.messages.create → request-id → anthropic-request-id → x-request-id → null
 *                               (the REAL Anthropic header is `request-id`)
 *   openai.*                  → x-request-id → null
 * A synthetic `request-id` / `anthropic-request-id` on an OpenAI response must
 * NOT override OpenAI's real `x-request-id`; a missing header yields null (no
 * fabrication).
 */
export function extractProviderRequestId(
  capability: ProviderInvokeInput['capability'],
  headers: Headers,
): string | null {
  if (capability === 'anthropic.messages.create') {
    return extractAnthropicRequestId(headers);
  }
  const v = headers.get('x-request-id');
  return v === null || v === '' ? null : v;
}

export async function invokeProvider(input: ProviderInvokeInput): Promise<ProviderInvokeResult> {
  const endpoint = endpointFor(input.capability);
  const url = `${input.baseUrl.replace(/\/$/, '')}${endpoint}`;
  const requestBody = buildRequestBody(input);
  const bodyJson = JSON.stringify(requestBody);
  const requestHash = sha256(Buffer.from(bodyJson, 'utf8'));
  const invocationId = randomUUID();

  const t0 = Date.now();
  const headers = buildProviderHeaders({
    baseUrl: input.baseUrl,
    workspaceId: input.workspaceId,
    testMode: input.testMode,
    baseHeaders: input.headers,
  });
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: bodyJson });
  } catch (err) {
    // Network-level failure (DNS, connection refused, TLS, etc.). Convert into
    // a structured ProviderInvokeError so the orchestrator's failure path runs
    // (persists provider_invocation row + run.failed audit + 502 response).
    const message = err instanceof Error ? err.message : String(err);
    throw new ProviderInvokeError(`provider network failure: ${message}`, 0, 'network_error');
  }
  const latencyMs = Date.now() - t0;

  let responseBody: unknown;
  let responseText = '';
  try {
    responseText = await res.text();
    responseBody = responseText.length > 0 ? JSON.parse(responseText) : null;
  } catch {
    responseBody = { raw: responseText };
  }
  const responseHash = responseText.length > 0
    ? sha256(Buffer.from(responseText, 'utf8'))
    : null;

  const errorClass = classifyStatus(res.status);
  if (errorClass !== null) {
    throw new ProviderInvokeError(
      `provider returned ${res.status} (${errorClass})`,
      res.status,
      errorClass,
    );
  }

  const usage = extractUsage(input.capability, responseBody);
  const providerRequestId = extractProviderRequestId(input.capability, res.headers);

  return {
    invocationId,
    endpoint,
    method: 'POST',
    requestBody,
    requestHash,
    responseStatus: res.status,
    responseBody,
    responseHash,
    providerRequestId,
    latencyMs,
    errorClass: null,
    usage,
  };
}

export async function persistInvocation(
  client: PoolClient,
  orgId: string,
  runId: string,
  capability: string,
  result: ProviderInvokeResult,
  failure?: { status: number; errorClass: string },
): Promise<void> {
  await client.query(
    `INSERT INTO govai.provider_invocations (
       id, run_id, org_id, provider, native_endpoint, native_method,
       native_request_hash, native_response_hash, streaming, usage_json,
       latency_ms, status_code, provider_request_id, error_class
     ) VALUES (
       $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text,
       $7::bytea, $8::bytea, false, $9::jsonb,
       $10::integer, $11::integer, $12::text, $13::text
     )`,
    [
      result.invocationId,
      runId,
      orgId,
      capability.split('.')[0],
      result.endpoint,
      result.method,
      Buffer.from(result.requestHash),
      result.responseHash ? Buffer.from(result.responseHash) : null,
      JSON.stringify({
        provider_native: result.responseBody && typeof result.responseBody === 'object'
          ? (result.responseBody as { usage?: unknown }).usage ?? null
          : null,
        normalized: result.usage ?? null,
        source: result.usage ? 'provider_direct' : 'estimated_from_text',
        pricing_table_version: 'v0',
      }),
      result.latencyMs,
      failure?.status ?? result.responseStatus,
      result.providerRequestId,
      failure?.errorClass ?? result.errorClass,
    ],
  );
}
