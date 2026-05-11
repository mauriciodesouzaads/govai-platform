// HTTP-layer plaintext leak canary for admin provider credentials endpoints —
// PR3.1b (issue #22).
//
// Submits the deterministic canary 'sk-ant-leak-canary-XYZABC123-DO-NOT-LEAK'
// (already allowlisted in .gitleaks.toml from PR3.1a) through the POST set
// endpoint and asserts that the canary substring 'leak-canary-XYZABC123'
// appears NOWHERE in:
//   - HTTP response body / headers (success and error paths)
//   - logger output (info/warn/error/debug)
//   - audit event payloads (redaction_metadata + every text/jsonb column)
//   - Error.message / .stack / .cause chain depth 5
//   - validation-failure responses

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  grantAdminRole,
  type Stack,
} from './helpers/server-fixture.js';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { chainIdFor } from '@govai/core-events';

const CANARY_PLAINTEXT = 'sk-ant-leak-canary-XYZABC123-DO-NOT-LEAK';
const CANARY_SUBSTRING = 'leak-canary-XYZABC123';

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
  stack = await startStack();
  hijackLog();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});
beforeEach(() => {
  capturedLogs.length = 0;
});

async function inject(
  method: 'POST' | 'GET',
  url: string,
  apiKey: string,
  body?: unknown,
): Promise<{ statusCode: number; rawBody: string; headers: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-govai-api-key': apiKey,
  };
  const res = await stack.app.inject({ method, url, headers, payload: body ?? undefined });
  return {
    statusCode: res.statusCode,
    rawBody: res.body,
    headers: res.headers as unknown as Record<string, unknown>,
  };
}

async function dumpAdminChain(orgId: string): Promise<string[]> {
  const chainId = chainIdFor(orgId, 'admin');
  const c = await stack.db.appPool.connect();
  try {
    await c.query('BEGIN');
    await setLocalAppOrgId(c, orgId);
    const r = await c.query<{ payload: string }>(
      `SELECT to_jsonb(audit_events.*) AS payload
         FROM govai.audit_events
        WHERE chain_id = $1`,
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
         FROM govai.provider_credentials
        WHERE org_id = $1::uuid`,
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

async function adminOrg(): Promise<{
  org_id: string;
  user_id: string;
  api_key: string;
}> {
  const org = await seedOrg(stack);
  await grantAdminRole(stack, org.api_key_prefix);
  return { org_id: org.org_id, user_id: org.user_id, api_key: org.api_key };
}

async function assertNoCanary(opts: {
  orgId: string;
  responseBody: string;
  responseHeaders: Record<string, unknown>;
}): Promise<void> {
  const auditPayloads = await dumpAdminChain(opts.orgId);
  const credMeta = await dumpCredentialMetadata(opts.orgId);
  const surfaces = [
    opts.responseBody,
    JSON.stringify(opts.responseHeaders),
    ...capturedLogs,
    ...auditPayloads,
    ...credMeta,
  ];
  const merged = surfaces.join('\n');
  expect(merged).not.toContain(CANARY_SUBSTRING);
  expect(merged).not.toContain(CANARY_PLAINTEXT);
}

describe('admin-provider-credentials / plaintext leak canary', () => {
  it('happy path: canary in POST body does not appear in response, headers, logs, audit, or DB metadata', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: CANARY_PLAINTEXT,
      reason: 'canary-happy-path',
    });
    expect(r.statusCode).toBe(200);
    await assertNoCanary({
      orgId: admin.org_id,
      responseBody: r.rawBody,
      responseHeaders: r.headers,
    });
  });

  it('400 validation error (missing provider): zod issues do not echo api_key body', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      api_key: CANARY_PLAINTEXT,
      reason: 'validation-fail',
    });
    expect(r.statusCode).toBe(400);
    expect(r.rawBody).not.toContain(CANARY_SUBSTRING);
    expect(r.rawBody).not.toContain(CANARY_PLAINTEXT);
    await assertNoCanary({
      orgId: admin.org_id,
      responseBody: r.rawBody,
      responseHeaders: r.headers,
    });
  });

  it('400 validation error (unknown provider): zod issues do not echo api_key', async () => {
    const admin = await adminOrg();
    const r = await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'cohere',
      api_key: CANARY_PLAINTEXT,
      reason: 'unknown-provider',
    });
    expect(r.statusCode).toBe(400);
    expect(r.rawBody).not.toContain(CANARY_SUBSTRING);
  });

  it('403 forbidden (non-admin): canary in body does not appear in response or logs', async () => {
    const org = await seedOrg(stack); // no admin role
    const r = await inject('POST', '/v1/admin/provider-credentials', org.api_key, {
      provider: 'anthropic',
      api_key: CANARY_PLAINTEXT,
      reason: 'non-admin',
    });
    expect(r.statusCode).toBe(403);
    expect(r.rawBody).not.toContain(CANARY_SUBSTRING);
    const captured = capturedLogs.join('\n');
    expect(captured).not.toContain(CANARY_SUBSTRING);
  });

  it('401 unauthenticated: canary in body does not appear in response or logs', async () => {
    const r = await inject('POST', '/v1/admin/provider-credentials', 'invalid-key', {
      provider: 'anthropic',
      api_key: CANARY_PLAINTEXT,
      reason: 'unauthenticated',
    });
    expect(r.statusCode).toBe(401);
    expect(r.rawBody).not.toContain(CANARY_SUBSTRING);
    const captured = capturedLogs.join('\n');
    expect(captured).not.toContain(CANARY_SUBSTRING);
  });

  it('GET list: response body has no canary substring after a set', async () => {
    const admin = await adminOrg();
    await inject('POST', '/v1/admin/provider-credentials', admin.api_key, {
      provider: 'anthropic',
      api_key: CANARY_PLAINTEXT,
      reason: 'pre-list',
    });
    const r = await inject('GET', '/v1/admin/provider-credentials', admin.api_key);
    expect(r.statusCode).toBe(200);
    expect(r.rawBody).not.toContain(CANARY_SUBSTRING);
    expect(r.rawBody).not.toContain(CANARY_PLAINTEXT);
  });
});
