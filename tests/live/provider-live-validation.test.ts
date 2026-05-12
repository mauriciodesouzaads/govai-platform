// Governed live provider validation — PR3.1d.
//
// Validates real Anthropic + OpenAI provider calls through the GovAI
// provider-native governed surfaces, using tenant-scoped credentials seeded
// via the /v1/admin/provider-credentials control plane.
//
// PRIMARY validation surfaces:
//   - POST /governed/anthropic/v1/messages
//   - POST /governed/openai/v1/responses
//   - POST /governed/openai/v1/chat/completions
//
// CONTROL PLANE:
//   - POST /v1/admin/provider-credentials
//   - GET  /v1/admin/provider-credentials
//   - POST /v1/admin/provider-credentials/:id/revoke
//
// SECONDARY (smoke only):
//   - POST /v1/runs   — shortcut/orchestration; NOT primary native validation.
//
// Safety:
//   - Suite is gated by GOVAI_LIVE_TESTS=1 and skipped otherwise.
//   - tests/live/** is excluded from default vitest runs (vitest.config.ts).
//   - No provider key value is ever printed, logged, asserted, or echoed.
//   - Leak canary checks the last 20 chars of each real key (high-entropy
//     substring) against captured logs / responses / audit rows / DB metadata.
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
// Use the suite via `describe.skipIf` so the runner cleanly skips when the env
// gate is off, instead of failing on missing keys.
const describeLive = LIVE_ENABLED ? describe : describe.skip;

// Token-budget caps. All live calls in this suite must be small.
const ANTHROPIC_MAX_TOKENS = 16;
const OPENAI_MAX_OUTPUT_TOKENS = 16;
const OPENAI_CHAT_MAX_TOKENS = 16;

// Models: prefer env override, otherwise use the known-good cheap defaults
// (Anthropic claude-3-5-sonnet-latest and similar aliases 404 at the time of
// writing; the haiku/sonnet 4.5 family is the working one).
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

// Take the last 20 chars of each key as a high-entropy leak-canary substring.
// 20 chars of base64-url-ish entropy is unique enough that it would never
// appear by accident in any non-leak surface.
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

async function dumpAdminChain(orgId: string): Promise<string[]> {
  const chainId = chainIdFor(orgId, 'admin');
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    const r = await c.query<{ payload: string }>(
      `SELECT to_jsonb(audit_events.*) AS payload FROM govai.audit_events WHERE chain_id = $1`,
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

async function inject(
  method: 'GET' | 'POST',
  url: string,
  apiKey: string,
  body?: Record<string, unknown>,
): Promise<{ statusCode: number; body: unknown; rawBody: string; headers: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-govai-api-key': apiKey,
  };
  const res = await stack.app.inject({
    method,
    url,
    headers,
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

beforeAll(async () => {
  if (!LIVE_ENABLED) return;
  if (!ANTHROPIC_KEY || !OPENAI_KEY) {
    throw new Error('GOVAI_LIVE_TESTS=1 but provider keys are not set');
  }
  // Live stack: real provider URLs (GOVAI_PROVIDER_BASE_URL undefined so the
  // governed routes default to https://api.anthropic.com / https://api.openai.com),
  // real env keys passed through (the tenant-scoped resolver will prefer the
  // tenant credentials we seed; env keys remain as a defense-in-depth fallback
  // only in dev/test+non-loopback modes per PR3.1a matrix).
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

async function assertNoLeakAcrossSurfaces(opts: {
  orgId: string;
  rawBody: string;
  headers: Record<string, unknown>;
  extra?: string[];
}): Promise<void> {
  const auditPayloads = await dumpAdminChain(opts.orgId);
  const credMeta = await dumpCredentialMetadata(opts.orgId);
  const surfaces = [
    opts.rawBody,
    JSON.stringify(opts.headers),
    ...capturedLogs,
    ...auditPayloads,
    ...credMeta,
    ...(opts.extra ?? []),
  ];
  const merged = surfaces.join('\n');
  // Each canary is the last 20 chars of the corresponding real key.
  if (ANTHROPIC_CANARY) {
    expect(merged).not.toContain(ANTHROPIC_CANARY);
  }
  if (OPENAI_CANARY) {
    expect(merged).not.toContain(OPENAI_CANARY);
  }
  // Also assert the full keys are absent (covers any case where the canary
  // happened to be too short to be unique).
  if (ANTHROPIC_KEY) expect(merged).not.toContain(ANTHROPIC_KEY);
  if (OPENAI_KEY) expect(merged).not.toContain(OPENAI_KEY);
}

describeLive('live provider validation (GOVAI_LIVE_TESTS=1)', () => {
  it('control plane: set + list + revoke; primary governed Anthropic + OpenAI; secondary /v1/runs smoke; tenant isolation; fail-closed', async () => {
    capturedLogs.length = 0;

    // ── 0. Seed admin tenant (tenant A) and a non-credentialed tenant (tenant B).
    const orgA = await seedOrg(stack);
    await grantAdminRole(stack, orgA.api_key_prefix);
    const orgB = await seedOrg(stack);

    // ── A. Set real Anthropic credential through admin endpoint.
    const setAnthropic = await inject(
      'POST',
      '/v1/admin/provider-credentials',
      orgA.api_key,
      { provider: 'anthropic', api_key: ANTHROPIC_KEY, reason: 'live validation' },
    );
    expect(setAnthropic.statusCode).toBe(200);
    const setABody = setAnthropic.body as Record<string, unknown>;
    expect(setABody['provider']).toBe('anthropic');
    expect(setABody['status']).toBe('active');
    expect(setABody['key_prefix']).toBe('sk-ant-');
    expect(setABody['key_last4']).toBeDefined();
    // Response is metadata only — no raw key body.
    expect(setAnthropic.rawBody).not.toContain(ANTHROPIC_CANARY);
    expect(setAnthropic.rawBody).not.toContain(ANTHROPIC_KEY);

    // ── B. Set real OpenAI credential through admin endpoint.
    const setOpenai = await inject(
      'POST',
      '/v1/admin/provider-credentials',
      orgA.api_key,
      { provider: 'openai', api_key: OPENAI_KEY, reason: 'live validation' },
    );
    expect(setOpenai.statusCode).toBe(200);
    const setOBody = setOpenai.body as Record<string, unknown>;
    expect(setOBody['provider']).toBe('openai');
    expect(setOBody['status']).toBe('active');
    // OpenAI keys may start with 'sk-' or 'sk-proj-' depending on type.
    expect(['sk-', 'sk-proj-']).toContain(setOBody['key_prefix']);
    expect(setOpenai.rawBody).not.toContain(OPENAI_CANARY);
    expect(setOpenai.rawBody).not.toContain(OPENAI_KEY);

    const anthropicCredId = setABody['id'] as string;

    // ── C. List credentials — metadata only.
    const list = await inject('GET', '/v1/admin/provider-credentials', orgA.api_key);
    expect(list.statusCode).toBe(200);
    const listRows = (list.body as { data: Array<Record<string, unknown>> }).data;
    expect(listRows.length).toBe(2);
    for (const row of listRows) {
      expect(row['ciphertext']).toBeUndefined();
      expect(row['dek_wrapped']).toBeUndefined();
    }

    // ── D. Anthropic primary live call via /governed/anthropic/v1/messages.
    const anthropicCall = await inject(
      'POST',
      '/governed/anthropic/v1/messages',
      orgA.api_key,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      },
    );
    expect(anthropicCall.statusCode).toBe(200);
    const aBody = anthropicCall.body as Record<string, unknown>;
    // Native Anthropic response shape: { id, type:'message', content:[{type:'text', text:...}], usage, ... }
    expect(aBody['type']).toBe('message');
    expect(Array.isArray(aBody['content'])).toBe(true);
    // The native response did not carry our key body — defense-in-depth check.
    expect(anthropicCall.rawBody).not.toContain(ANTHROPIC_CANARY);
    expect(anthropicCall.rawBody).not.toContain(ANTHROPIC_KEY);

    // ── E. OpenAI Responses primary live call.
    const openaiResponsesCall = await inject(
      'POST',
      '/governed/openai/v1/responses',
      orgA.api_key,
      {
        model: OPENAI_MODEL,
        input: 'Reply with OK only.',
        max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
      },
    );
    expect(openaiResponsesCall.statusCode).toBe(200);
    const orBody = openaiResponsesCall.body as Record<string, unknown>;
    // Native Responses API: { id, object:'response', output:[...], usage:{...}, ... }
    expect(orBody['object']).toBe('response');
    expect(openaiResponsesCall.rawBody).not.toContain(OPENAI_CANARY);
    expect(openaiResponsesCall.rawBody).not.toContain(OPENAI_KEY);

    // ── F. OpenAI Chat Completions primary live call.
    const openaiChatCall = await inject(
      'POST',
      '/governed/openai/v1/chat/completions',
      orgA.api_key,
      {
        model: OPENAI_MODEL,
        max_tokens: OPENAI_CHAT_MAX_TOKENS,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
      },
    );
    expect(openaiChatCall.statusCode).toBe(200);
    const ocBody = openaiChatCall.body as Record<string, unknown>;
    // Native Chat Completions: { id, object:'chat.completion', choices:[...], usage:{...} }
    expect(ocBody['object']).toBe('chat.completion');
    expect(openaiChatCall.rawBody).not.toContain(OPENAI_CANARY);

    // ── J. Secondary /v1/runs smoke (shortcut delegation — NOT primary validation).
    // /v1/runs remains secondary for provider-native validation, but it is
    // still a real GovAI entry point and must work. PR3.1e fixed issue #31
    // (orchestrator was passing an empty upstreamBaseUrl when
    // GOVAI_PROVIDER_BASE_URL was unset) so we can now assert hard success
    // here instead of merely logging the status.
    const runsSmoke = await inject('POST', '/v1/runs', orgA.api_key, {
      workspace_id: orgA.workspace_id,
      capability: 'anthropic.messages.create',
      model: ANTHROPIC_MODEL,
      input: 'Reply with OK only.',
    });
    expect(runsSmoke.statusCode).toBe(200);
    expect((runsSmoke.body as { status?: string }).status).toBe('completed');
    expect(runsSmoke.rawBody).not.toContain(ANTHROPIC_CANARY);
    expect(runsSmoke.rawBody).not.toContain(ANTHROPIC_KEY);

    // ── I. Tenant isolation — orgB has no credential set. In test+non-loopback
    // mode the resolver allows env-key fallback; to prove a real fail-closed
    // semantic we explicitly flip orgB to operational_mode='production'.
    const c = await stack.db.adminPool.connect();
    try {
      await c.query(`UPDATE govai.orgs SET operational_mode='production' WHERE id=$1::uuid`, [
        orgB.org_id,
      ]);
    } finally {
      c.release();
    }
    const orgBCall = await inject(
      'POST',
      '/governed/anthropic/v1/messages',
      orgB.api_key,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: 'user', content: 'should never reach provider' }],
      },
    );
    // Resolver throws MissingProviderKeyError → 5xx error envelope from the
    // governed handler. The exact status varies with handler error wiring;
    // the invariant is that the call does NOT return 200 from a real provider.
    expect(orgBCall.statusCode).not.toBe(200);
    expect(orgBCall.rawBody).not.toContain(ANTHROPIC_CANARY);

    // ── H. Revoke Anthropic credential on orgA → next governed call fails closed.
    // Flip orgA to production so the resolver cannot env-fallback.
    const c2 = await stack.db.adminPool.connect();
    try {
      await c2.query(`UPDATE govai.orgs SET operational_mode='production' WHERE id=$1::uuid`, [
        orgA.org_id,
      ]);
    } finally {
      c2.release();
    }
    const revoke = await inject(
      'POST',
      `/v1/admin/provider-credentials/${anthropicCredId}/revoke`,
      orgA.api_key,
      { reason: 'live validation' },
    );
    expect(revoke.statusCode).toBe(200);
    expect((revoke.body as { status?: string }).status).toBe('revoked');

    const orgAAfterRevoke = await inject(
      'POST',
      '/governed/anthropic/v1/messages',
      orgA.api_key,
      {
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        messages: [{ role: 'user', content: 'should never reach provider' }],
      },
    );
    expect(orgAAfterRevoke.statusCode).not.toBe(200);
    expect(orgAAfterRevoke.rawBody).not.toContain(ANTHROPIC_CANARY);

    // ── K. Final aggregate plaintext-leak check across all surfaces.
    await assertNoLeakAcrossSurfaces({
      orgId: orgA.org_id,
      rawBody:
        [
          setAnthropic.rawBody,
          setOpenai.rawBody,
          list.rawBody,
          anthropicCall.rawBody,
          openaiResponsesCall.rawBody,
          openaiChatCall.rawBody,
          runsSmoke.rawBody,
          orgBCall.rawBody,
          revoke.rawBody,
          orgAAfterRevoke.rawBody,
        ].join('\n'),
      headers: {
        ...setAnthropic.headers,
        ...setOpenai.headers,
        ...list.headers,
        ...anthropicCall.headers,
        ...openaiResponsesCall.headers,
        ...openaiChatCall.headers,
        ...runsSmoke.headers,
        ...orgBCall.headers,
        ...revoke.headers,
        ...orgAAfterRevoke.headers,
      },
    });
    await assertNoLeakAcrossSurfaces({
      orgId: orgB.org_id,
      rawBody: orgBCall.rawBody,
      headers: orgBCall.headers,
    });
  }, 120_000);
});
