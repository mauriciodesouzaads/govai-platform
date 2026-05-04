// Provider invoke step. In runtime-patch-1 this calls the hermetic
// provider-protocol test server via plain fetch, not the SDKs (PR2 wires SDKs).

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { sha256 } from '@govai/core-audit';

export type ProviderInvokeInput = {
  capability: 'anthropic.messages.create' | 'openai.responses.create' | 'openai.chat.completions.create';
  model: string;
  inputText: string;
  baseUrl: string;
  headers?: Record<string, string>;
};

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

export async function invokeProvider(input: ProviderInvokeInput): Promise<ProviderInvokeResult> {
  const endpoint = endpointFor(input.capability);
  const url = `${input.baseUrl.replace(/\/$/, '')}${endpoint}`;
  const requestBody = buildRequestBody(input);
  const bodyJson = JSON.stringify(requestBody);
  const requestHash = sha256(Buffer.from(bodyJson, 'utf8'));
  const invocationId = randomUUID();

  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...input.headers,
      },
      body: bodyJson,
    });
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
  const providerRequestId =
    res.headers.get('x-request-id') ?? res.headers.get('anthropic-request-id') ?? null;

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
