// Governed live streaming validation — PR3.1h.
//
// Validates real Anthropic + OpenAI STREAMING calls through the GovAI
// provider-native governed surfaces, using tenant-scoped credentials seeded
// via the /v1/admin/provider-credentials control plane.
//
// PRIMARY streaming surfaces (this file):
//   - POST /governed/anthropic/v1/messages          (with stream:true)
//   - POST /governed/openai/v1/responses            (with stream:true)
//   - POST /governed/openai/v1/chat/completions     (with stream:true)
//
// /v1/runs is NOT used as a streaming validation surface. It already
// explicitly rejects streaming via the UX-shortcut path
// (run-orchestrator.ts: "streaming not supported via /v1/runs UX shortcut;
// use /governed/* directly").
//
// Safety:
//   - Suite is gated by GOVAI_LIVE_TESTS=1 and skipped otherwise.
//   - tests/live/** is excluded from default vitest runs; this file only
//     executes under vitest.live.config.ts.
//   - No provider key value is ever printed, logged, asserted, or echoed.
//   - Leak canary checks the last 20 chars of each real key (high-entropy
//     substring) plus the full key against every streamed byte, response
//     header, captured log, audit row, and credential metadata column.
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

const ANTHROPIC_MAX_TOKENS = 16;
const OPENAI_MAX_OUTPUT_TOKENS = 16;
const OPENAI_CHAT_MAX_TOKENS = 16;

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

async function injectAdmin(
  method: 'POST' | 'GET',
  url: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown; rawBody: string }> {
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
  return { statusCode: res.statusCode, body: parsed, rawBody: res.body };
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
    const r = await c.query<{ payload: string; event_type: string; redaction_metadata: unknown }>(
      `SELECT to_jsonb(audit_events.*) AS payload, event_type, redaction_metadata
         FROM govai.audit_events
        WHERE chain_id = $1
        ORDER BY sequence_number ASC`,
      [chainId],
    );
    await c.query('COMMIT');
    return r.rows.map((row) => JSON.stringify(row));
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

describeLive('governed live streaming validation (GOVAI_LIVE_TESTS=1)', () => {
  it('streams Anthropic, OpenAI Responses, and OpenAI Chat through /governed/* with no plaintext leak', async () => {
    capturedLogs.length = 0;

    const orgA = await seedOrg(stack);
    await grantAdminRole(stack, orgA.api_key_prefix);

    // Seed real provider credentials through the admin control plane.
    const setAnthropic = await injectAdmin(
      'POST',
      '/v1/admin/provider-credentials',
      orgA.api_key,
      { provider: 'anthropic', api_key: ANTHROPIC_KEY, reason: 'live streaming validation' },
    );
    expect(setAnthropic.statusCode).toBe(200);
    const setOpenai = await injectAdmin(
      'POST',
      '/v1/admin/provider-credentials',
      orgA.api_key,
      { provider: 'openai', api_key: OPENAI_KEY, reason: 'live streaming validation' },
    );
    expect(setOpenai.statusCode).toBe(200);

    // ── A. Anthropic governed streaming.
    const anthropic = await injectStream(
      '/governed/anthropic/v1/messages',
      orgA.api_key,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        stream: true,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      },
    );
    expect(anthropic.statusCode).toBe(200);
    expect(anthropic.contentType.toLowerCase()).toContain('text/event-stream');
    expect(anthropic.rawPayloadLength).toBeGreaterThan(0);
    // At least one SSE 'data:' line is expected from a real stream response.
    expect(anthropic.rawPayload).toMatch(/data:\s*\{/);
    expect(anthropic.rawPayload).not.toContain(ANTHROPIC_CANARY);
    expect(anthropic.rawPayload).not.toContain(ANTHROPIC_KEY);

    // ── B. OpenAI Responses governed streaming.
    const openaiResponses = await injectStream(
      '/governed/openai/v1/responses',
      orgA.api_key,
      {
        model: OPENAI_MODEL,
        input: 'Reply with OK only.',
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
        stream: true,
      },
    );
    expect(openaiResponses.statusCode).toBe(200);
    expect(openaiResponses.contentType.toLowerCase()).toContain('text/event-stream');
    expect(openaiResponses.rawPayloadLength).toBeGreaterThan(0);
    expect(openaiResponses.rawPayload).toMatch(/data:\s*\{/);
    expect(openaiResponses.rawPayload).not.toContain(OPENAI_CANARY);
    expect(openaiResponses.rawPayload).not.toContain(OPENAI_KEY);

    // ── C. OpenAI Chat Completions governed streaming.
    const openaiChat = await injectStream(
      '/governed/openai/v1/chat/completions',
      orgA.api_key,
      {
        model: OPENAI_MODEL,
        max_tokens: OPENAI_CHAT_MAX_TOKENS,
        stream: true,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      },
    );
    expect(openaiChat.statusCode).toBe(200);
    expect(openaiChat.contentType.toLowerCase()).toContain('text/event-stream');
    expect(openaiChat.rawPayloadLength).toBeGreaterThan(0);
    expect(openaiChat.rawPayload).toMatch(/data:\s*[\{\[]/);
    expect(openaiChat.rawPayload).not.toContain(OPENAI_CANARY);
    expect(openaiChat.rawPayload).not.toContain(OPENAI_KEY);

    // ── Audit: each governed streaming call MUST have emitted a
    // passthrough.invoked v3 event with is_stream=true and a stream_final_hash.
    // The direct /governed/{provider}/* routes intentionally emit via the
    // server logger (app.log.info) rather than persisting to the audit chain
    // — chain persistence for governed routes is tracked separately as a
    // PR3+ wiring task. We therefore inspect the hijacked logger stream
    // (capturedLogs), not the DB chain.
    const streamingAuditLogs = capturedLogs.filter(
      (line) =>
        line.includes('"event_type":"passthrough.invoked"') &&
        line.includes('"is_stream":true'),
    );
    expect(streamingAuditLogs.length).toBeGreaterThanOrEqual(3);
    for (const line of streamingAuditLogs) {
      // stream_final_hash is hex-encoded SHA-256 (64 chars) from the
      // governed handler's forwardStream finalize step.
      expect(line).toMatch(/"stream_final_hash":"[0-9a-f]{32,}"/);
      expect(line).toContain('"credential_source":"tenant_provider_credential"');
      expect(line).toContain('"body_forward_mode":"raw"');
    }

    // ── Aggregate plaintext leak check across every observable surface.
    await assertNoLeakAcrossSurfaces({
      orgId: orgA.org_id,
      rawPayloads: [
        anthropic.rawPayload,
        openaiResponses.rawPayload,
        openaiChat.rawPayload,
        setAnthropic.rawBody,
        setOpenai.rawBody,
      ],
      headers: {
        anthropic_stream: anthropic.payloadHeaders,
        openai_responses_stream: openaiResponses.payloadHeaders,
        openai_chat_stream: openaiChat.payloadHeaders,
      },
    });
  }, 120_000);
});
