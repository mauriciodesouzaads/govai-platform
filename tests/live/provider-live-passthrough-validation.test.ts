// Live passthrough validation — PR3.1i.
//
// Validates real Anthropic + OpenAI provider calls through the GovAI
// provider-native PASSTHROUGH surfaces, using tenant-scoped credentials seeded
// via the /v1/admin/provider-credentials control plane.
//
// PRIMARY validation surfaces (this file):
//   - POST /passthrough/anthropic/v1/messages            (non-stream + stream)
//   - POST /passthrough/openai/v1/responses              (non-stream + stream)
//   - POST /passthrough/openai/v1/chat/completions       (non-stream)
//
// Architectural note:
//   /passthrough/{provider}/...  is the AUDIT-ONLY native compatibility surface.
//                                 enforcement_decision is intentionally 'observe'
//                                 and the body is forwarded byte-perfect to the
//                                 upstream provider.
//   /governed/{provider}/...     is the ENFORCEMENT-ACTIVE native surface
//                                 (validated in PR3.1d non-stream + PR3.1h stream).
//   /v1/runs                     is NOT a primary native validation path and is
//                                 not exercised in this file.
//
// Safety:
//   - Suite is gated by GOVAI_LIVE_TESTS=1 and skipped otherwise.
//   - tests/live/** is excluded from default vitest runs; this file only
//     executes under vitest.live.config.ts.
//   - No provider key value is ever printed, logged, asserted, or echoed.
//   - Leak canary checks the last 20 chars of each real key (high-entropy
//     substring) plus the full key against every response body, header,
//     captured log, audit row, and credential metadata column.
//   - Token budgets per request capped at 16 tokens.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  grantAdminRole,
  type Stack,
} from '../integration/helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainIdFor } from '@govai/core-events';

const LIVE_ENABLED = process.env.GOVAI_LIVE_TESTS === '1';
const describeLive = LIVE_ENABLED ? describe : describe.skip;

// Token-budget caps. All live calls in this suite must be small.
const ANTHROPIC_MAX_TOKENS = 16;
const OPENAI_MAX_OUTPUT_TOKENS = 16;
const OPENAI_CHAT_MAX_TOKENS = 16;

// Models: prefer env override, otherwise the known-good cheap defaults used by
// the prior PR3.1d/PR3.1h live suites.
const ANTHROPIC_MODEL =
  process.env.ANTHROPIC_LIVE_MODEL && process.env.ANTHROPIC_LIVE_MODEL.length > 0
    ? process.env.ANTHROPIC_LIVE_MODEL
    : 'claude-haiku-4-5-20251001';
const OPENAI_MODEL =
  process.env.OPENAI_LIVE_MODEL && process.env.OPENAI_LIVE_MODEL.length > 0
    ? process.env.OPENAI_LIVE_MODEL
    : 'gpt-4.1-mini';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? '';
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? '';

// Last 20 chars of each key as a high-entropy leak-canary substring.
function keyCanary(k: string): string {
  return k.length > 20 ? k.slice(-20) : k;
}
const ANTHROPIC_CANARY = keyCanary(ANTHROPIC_KEY);
const OPENAI_CANARY = keyCanary(OPENAI_KEY);

let stack: Stack;
const capturedLogs: string[] = [];

function hijackLog(): void {
  const orig = {
    info: stack.app.log.info.bind(stack.app.log),
    warn: stack.app.log.warn.bind(stack.app.log),
    error: stack.app.log.error.bind(stack.app.log),
    debug: stack.app.log.debug.bind(stack.app.log),
  };
  function replacer(_k: string, v: unknown): unknown {
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack };
    }
    return v;
  }
  const capture = (level: string, args: unknown[]): void => {
    try {
      capturedLogs.push(`${level}:${JSON.stringify(args, replacer)}`);
    } catch {
      capturedLogs.push(`${level}:<unserializable>`);
    }
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stack.app.log.info = ((...args: any[]) => {
    capture('info', args);
    return orig.info(args[0], args[1]);
  }) as typeof stack.app.log.info;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stack.app.log.warn = ((...args: any[]) => {
    capture('warn', args);
    return orig.warn(args[0], args[1]);
  }) as typeof stack.app.log.warn;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stack.app.log.error = ((...args: any[]) => {
    capture('error', args);
    return orig.error(args[0], args[1]);
  }) as typeof stack.app.log.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  stack.app.log.debug = ((...args: any[]) => {
    capture('debug', args);
    return orig.debug(args[0], args[1]);
  }) as typeof stack.app.log.debug;
}

beforeAll(async () => {
  if (!LIVE_ENABLED) return;
  if (!ANTHROPIC_KEY || !OPENAI_KEY) {
    throw new Error('GOVAI_LIVE_TESTS=1 but provider keys are not set');
  }
  // Real provider URLs (GOVAI_PROVIDER_BASE_URL undefined so passthrough
  // routes default to https://api.anthropic.com / https://api.openai.com).
  stack = await startStack({
    ANTHROPIC_API_KEY: ANTHROPIC_KEY,
    OPENAI_API_KEY: OPENAI_KEY,
    GOVAI_PROVIDER_BASE_URL: undefined,
  });
  hijackLog();
}, 240_000);

afterAll(async () => {
  if (!LIVE_ENABLED || !stack) return;
  await stopStack(stack);
});

async function injectJson(
  method: 'GET' | 'POST',
  url: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<{
  statusCode: number;
  body: unknown;
  rawBody: string;
  headers: Record<string, unknown>;
}> {
  const res = await stack.app.inject({
    method,
    url,
    headers: { 'content-type': 'application/json', 'x-govai-api-key': apiKey },
    payload: body ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown;
  try {
    parsed = res.body.length > 0 ? JSON.parse(res.body) : null;
  } catch {
    parsed = res.body;
  }
  return {
    statusCode: res.statusCode,
    body: parsed,
    rawBody: res.body,
    headers: res.headers as unknown as Record<string, unknown>,
  };
}

interface StreamCallResult {
  statusCode: number;
  contentType: string;
  rawPayload: string;
  rawPayloadLength: number;
  payloadHeaders: Record<string, unknown>;
}

async function injectStream(
  url: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<StreamCallResult> {
  const res = await stack.app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', 'x-govai-api-key': apiKey },
    payload: JSON.stringify(body),
  });
  return {
    statusCode: res.statusCode,
    contentType: (res.headers['content-type'] as string | undefined) ?? '',
    rawPayload: res.body,
    rawPayloadLength: res.body.length,
    payloadHeaders: res.headers as unknown as Record<string, unknown>,
  };
}

async function dumpRunChain(orgId: string): Promise<string[]> {
  const chainId = chainIdFor(orgId, 'run');
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    const r = await c.query<{ payload: string }>(
      `SELECT to_jsonb(audit_events.*) AS payload
         FROM govai.audit_events
        WHERE chain_id = $1
        ORDER BY sequence_number ASC`,
      [chainId],
    );
    await c.query('COMMIT');
    return r.rows.map((row) => JSON.stringify(row.payload));
  } finally {
    c.release();
  }
}

async function dumpAdminChain(orgId: string): Promise<string[]> {
  const chainId = chainIdFor(orgId, 'admin');
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    const r = await c.query<{ payload: string }>(
      `SELECT to_jsonb(audit_events.*) AS payload
         FROM govai.audit_events WHERE chain_id = $1`,
      [chainId],
    );
    await c.query('COMMIT');
    return r.rows.map((row) => JSON.stringify(row.payload));
  } finally {
    c.release();
  }
}

async function dumpCredentialMetadata(orgId: string): Promise<string[]> {
  const c = await stack.db.adminPool.connect();
  try {
    const r = await c.query<{
      key_prefix: string;
      key_last4: string;
      kms_key_id: string;
      status: string;
      revocation_reason: string | null;
    }>(
      `SELECT key_prefix, key_last4, kms_key_id, status, revocation_reason
         FROM govai.provider_credentials WHERE org_id = $1::uuid`,
      [orgId],
    );
    return r.rows.flatMap((row) => [
      row.key_prefix,
      row.key_last4,
      row.kms_key_id,
      row.status,
      row.revocation_reason ?? '',
    ]);
  } finally {
    c.release();
  }
}

async function assertNoLeakAcrossSurfaces(opts: {
  orgId: string;
  rawPayloads: string[];
  headers: Record<string, unknown>;
}): Promise<void> {
  const auditAdmin = await dumpAdminChain(opts.orgId);
  const auditRun = await dumpRunChain(opts.orgId);
  const credMeta = await dumpCredentialMetadata(opts.orgId);
  const merged = [
    ...opts.rawPayloads,
    JSON.stringify(opts.headers),
    ...capturedLogs,
    ...auditAdmin,
    ...auditRun,
    ...credMeta,
  ].join('\n');
  if (ANTHROPIC_CANARY) expect(merged).not.toContain(ANTHROPIC_CANARY);
  if (OPENAI_CANARY) expect(merged).not.toContain(OPENAI_CANARY);
  if (ANTHROPIC_KEY) expect(merged).not.toContain(ANTHROPIC_KEY);
  if (OPENAI_KEY) expect(merged).not.toContain(OPENAI_KEY);
}

describeLive('live passthrough validation (GOVAI_LIVE_TESTS=1)', () => {
  it('non-stream + stream passthrough Anthropic/OpenAI with observe semantics and no plaintext leak', async () => {
    capturedLogs.length = 0;

    // ── 0. Seed tenant orgA and grant admin role so the control plane endpoints
    //       accept us to seed real provider credentials.
    const orgA = await seedOrg(stack);
    await grantAdminRole(stack, orgA.api_key_prefix);

    // ── 1. Seed real provider credentials through the admin control plane.
    const setAnthropic = await injectJson(
      'POST',
      '/v1/admin/provider-credentials',
      orgA.api_key,
      { provider: 'anthropic', api_key: ANTHROPIC_KEY, reason: 'live passthrough validation' },
    );
    expect(setAnthropic.statusCode).toBe(200);
    const setABody = setAnthropic.body as Record<string, unknown>;
    expect(setABody['provider']).toBe('anthropic');
    expect(setABody['status']).toBe('active');
    expect(setABody['key_prefix']).toBe('sk-ant-');
    // Response is metadata only — no raw key body.
    expect(setAnthropic.rawBody).not.toContain(ANTHROPIC_CANARY);
    expect(setAnthropic.rawBody).not.toContain(ANTHROPIC_KEY);

    const setOpenai = await injectJson(
      'POST',
      '/v1/admin/provider-credentials',
      orgA.api_key,
      { provider: 'openai', api_key: OPENAI_KEY, reason: 'live passthrough validation' },
    );
    expect(setOpenai.statusCode).toBe(200);
    const setOBody = setOpenai.body as Record<string, unknown>;
    expect(setOBody['provider']).toBe('openai');
    expect(setOBody['status']).toBe('active');
    expect(['sk-', 'sk-proj-']).toContain(setOBody['key_prefix']);
    expect(setOpenai.rawBody).not.toContain(OPENAI_CANARY);
    expect(setOpenai.rawBody).not.toContain(OPENAI_KEY);

    // ── A. Anthropic passthrough — non-stream POST /v1/messages.
    const anthropicNon = await injectJson(
      'POST',
      '/passthrough/anthropic/v1/messages',
      orgA.api_key,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      },
    );
    expect(anthropicNon.statusCode).toBe(200);
    const aBody = anthropicNon.body as Record<string, unknown>;
    // Native Anthropic response shape passed through byte-perfect.
    expect(aBody['type']).toBe('message');
    expect(Array.isArray(aBody['content'])).toBe(true);
    expect(anthropicNon.rawBody).not.toContain(ANTHROPIC_CANARY);
    expect(anthropicNon.rawBody).not.toContain(ANTHROPIC_KEY);

    // ── B. OpenAI Responses passthrough — non-stream POST /v1/responses.
    const openaiResponsesNon = await injectJson(
      'POST',
      '/passthrough/openai/v1/responses',
      orgA.api_key,
      {
        model: OPENAI_MODEL,
        input: 'Reply with OK only.',
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      },
    );
    expect(openaiResponsesNon.statusCode).toBe(200);
    const orBody = openaiResponsesNon.body as Record<string, unknown>;
    expect(orBody['object']).toBe('response');
    expect(openaiResponsesNon.rawBody).not.toContain(OPENAI_CANARY);
    expect(openaiResponsesNon.rawBody).not.toContain(OPENAI_KEY);

    // ── C. OpenAI Chat Completions passthrough — non-stream POST /v1/chat/completions.
    const openaiChatNon = await injectJson(
      'POST',
      '/passthrough/openai/v1/chat/completions',
      orgA.api_key,
      {
        model: OPENAI_MODEL,
        max_tokens: OPENAI_CHAT_MAX_TOKENS,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      },
    );
    expect(openaiChatNon.statusCode).toBe(200);
    const ocBody = openaiChatNon.body as Record<string, unknown>;
    expect(ocBody['object']).toBe('chat.completion');
    expect(openaiChatNon.rawBody).not.toContain(OPENAI_CANARY);
    expect(openaiChatNon.rawBody).not.toContain(OPENAI_KEY);

    // ── D. Anthropic passthrough — streaming POST /v1/messages with stream:true.
    //       Passthrough streaming is implemented (forwardStream) and emits a
    //       passthrough.invoked v3 event with stream_final_hash. Content-Type
    //       propagation was fixed in PR3.1j (#38) by switching the streaming
    //       branch to `reply.hijack()` + `reply.raw.writeHead(status, headers)`,
    //       mirroring the governed pattern.
    const anthropicStream = await injectStream(
      '/passthrough/anthropic/v1/messages',
      orgA.api_key,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        stream: true,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      },
    );
    expect(anthropicStream.statusCode).toBe(200);
    expect(anthropicStream.contentType.toLowerCase()).toContain('text/event-stream');
    expect(anthropicStream.rawPayloadLength).toBeGreaterThan(0);
    // SSE frame regex — what the user-required assertion ("chunks/events") looks
    // like at the byte level for a successful Anthropic streamed message.
    expect(anthropicStream.rawPayload).toMatch(/data:\s*\{/);
    expect(anthropicStream.rawPayload).not.toContain(ANTHROPIC_CANARY);
    expect(anthropicStream.rawPayload).not.toContain(ANTHROPIC_KEY);

    // ── E. OpenAI Responses passthrough — streaming POST /v1/responses with stream:true.
    //       Content-Type propagation also fixed in PR3.1j (#38).
    const openaiResponsesStream = await injectStream(
      '/passthrough/openai/v1/responses',
      orgA.api_key,
      {
        model: OPENAI_MODEL,
        input: 'Reply with OK only.',
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        stream: true,
      },
    );
    expect(openaiResponsesStream.statusCode).toBe(200);
    expect(openaiResponsesStream.contentType.toLowerCase()).toContain('text/event-stream');
    expect(openaiResponsesStream.rawPayloadLength).toBeGreaterThan(0);
    expect(openaiResponsesStream.rawPayload).toMatch(/data:\s*\{/);
    expect(openaiResponsesStream.rawPayload).not.toContain(OPENAI_CANARY);
    expect(openaiResponsesStream.rawPayload).not.toContain(OPENAI_KEY);

    // ── Audit assertions on the passthrough.invoked v3 events emitted to the
    //       hijacked logger.
    //
    //   - Three non-stream invocations (is_stream=false) → A/B/C above.
    //   - Two streaming invocations (is_stream=true)     → D/E above.
    //
    //   Passthrough is the explicit AUDIT-ONLY surface, so every event must
    //   carry enforcement_decision='observe', body_forward_mode='raw' and
    //   credential_source='tenant_provider_credential' — independent of
    //   whether governance WOULD have enforced on the same request through
    //   /governed/*.
    const passthroughLogs = capturedLogs.filter((line) =>
      line.includes('"event_type":"passthrough.invoked"'),
    );
    expect(passthroughLogs.length).toBeGreaterThanOrEqual(5);

    const nonStreamLogs = passthroughLogs.filter((line) => line.includes('"is_stream":false'));
    expect(nonStreamLogs.length).toBeGreaterThanOrEqual(3);
    for (const line of nonStreamLogs) {
      expect(line).toContain('"enforcement_decision":"observe"');
      expect(line).toContain('"credential_source":"tenant_provider_credential"');
      expect(line).toContain('"body_forward_mode":"raw"');
      // Non-stream events expose native_response_hash from the forwardRaw step.
      expect(line).toMatch(/"native_response_hash":"[0-9a-f]{32,}"/);
    }

    const streamLogs = passthroughLogs.filter((line) => line.includes('"is_stream":true'));
    expect(streamLogs.length).toBeGreaterThanOrEqual(2);
    for (const line of streamLogs) {
      expect(line).toContain('"enforcement_decision":"observe"');
      expect(line).toContain('"credential_source":"tenant_provider_credential"');
      expect(line).toContain('"body_forward_mode":"raw"');
      // Streaming events expose stream_final_hash from the forwardStream finalize step.
      expect(line).toMatch(/"stream_final_hash":"[0-9a-f]{32,}"/);
    }

    // Capability ids — confirm the three primary passthrough capabilities all
    // produced an event in this run.
    const allCapabilityIds = passthroughLogs
      .map((line) => line.match(/"capability_id":"([^"]+)"/)?.[1])
      .filter((v): v is string => typeof v === 'string');
    expect(allCapabilityIds).toEqual(
      expect.arrayContaining([
        'anthropic.messages.create',
        'anthropic.messages.stream',
        'openai.responses.create',
        'openai.responses.stream',
        'openai.chat.completions.create',
      ]),
    );

    // ── Aggregate plaintext-leak check across every observable surface.
    await assertNoLeakAcrossSurfaces({
      orgId: orgA.org_id,
      rawPayloads: [
        setAnthropic.rawBody,
        setOpenai.rawBody,
        anthropicNon.rawBody,
        openaiResponsesNon.rawBody,
        openaiChatNon.rawBody,
        anthropicStream.rawPayload,
        openaiResponsesStream.rawPayload,
      ],
      headers: {
        set_anthropic: setAnthropic.headers,
        set_openai: setOpenai.headers,
        anthropic_non_stream: anthropicNon.headers,
        openai_responses_non_stream: openaiResponsesNon.headers,
        openai_chat_non_stream: openaiChatNon.headers,
        anthropic_stream: anthropicStream.payloadHeaders,
        openai_responses_stream: openaiResponsesStream.payloadHeaders,
      },
    });
  }, 120_000);
});
