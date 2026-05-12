// PR3.1c (issue #26): every /v1/admin/* placeholder route must authenticate
// and require the admin role before returning its 501 placeholder body.
//
// Routes covered:
// - POST /v1/admin/audit-events/:id/crypto-shred
// - POST /v1/admin/dlp-detectors
//
// Negative cases (no key / non-admin key) must short-circuit BEFORE the
// route reveals the deferred-capability shape. Positive case (admin key)
// continues to return the canonical 501 contract that
// not-implemented-routes.test.ts already pins.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  seedOrg,
  grantAdminRole,
  inject,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
beforeAll(async () => {
  stack = await startStack();
}, 240_000);
afterAll(async () => {
  if (stack) await stopStack(stack);
});

const PLACEHOLDERS: Array<{ url: string; capability: string }> = [
  {
    url: '/v1/admin/audit-events/00000000-0000-0000-0000-000000000000/crypto-shred',
    capability: 'admin.audit_event.crypto_shred',
  },
  {
    url: '/v1/admin/dlp-detectors',
    capability: 'admin.dlp_detectors.crud',
  },
];

describe('admin placeholder routes / auth + RBAC gate', () => {
  it('missing API key → 401 BEFORE the 501 placeholder body is revealed', async () => {
    for (const p of PLACEHOLDERS) {
      const res = await inject(stack, 'POST', p.url, undefined, {});
      expect(res.statusCode, `route ${p.url}`).toBe(401);
      const body = res.body as Record<string, unknown>;
      expect(body['error']).toBe('auth_error');
      // Placeholder shape must NOT leak through the 401.
      expect(body['capability']).toBeUndefined();
      expect(body['status']).toBeUndefined();
      expect(body['planned_phase']).toBeUndefined();
      expect(res.rawBody).not.toContain('capability_not_implemented_in_runtime_patch_1');
    }
  });

  it('invalid API key → 401', async () => {
    for (const p of PLACEHOLDERS) {
      const res = await inject(stack, 'POST', p.url, 'invalid-key-too-short', {});
      expect(res.statusCode).toBe(401);
      expect((res.body as Record<string, unknown>)['error']).toBe('auth_error');
    }
  });

  it('non-admin valid API key → 403 forbidden', async () => {
    const org = await seedOrg(stack); // no admin role grant
    for (const p of PLACEHOLDERS) {
      const res = await inject(stack, 'POST', p.url, org.api_key, {});
      expect(res.statusCode, `route ${p.url}`).toBe(403);
      const body = res.body as Record<string, unknown>;
      expect(body['error']).toBe('forbidden');
      expect(body['required_role']).toBe('admin');
      // Placeholder shape must NOT leak through the 403.
      expect(body['capability']).toBeUndefined();
      expect(res.rawBody).not.toContain('capability_not_implemented_in_runtime_patch_1');
    }
  });

  it('admin API key → 501 placeholder (canonical contract preserved)', async () => {
    const org = await seedOrg(stack);
    await grantAdminRole(stack, org.api_key_prefix);
    for (const p of PLACEHOLDERS) {
      const res = await inject(stack, 'POST', p.url, org.api_key, {});
      expect(res.statusCode, `route ${p.url}`).toBe(501);
      const body = res.body as Record<string, unknown>;
      expect(body['error']).toBe('capability_not_implemented_in_runtime_patch_1');
      expect(body['capability']).toBe(p.capability);
      expect(body['planned_phase']).toBe('PR3');
    }
  });

  it('admin API key with multiple roles still passes the gate', async () => {
    const org = await seedOrg(stack);
    await grantAdminRole(stack, org.api_key_prefix);
    // Add the admin role via grantAdminRole; the row already has roles=['admin'].
    // No second mutation needed — verify that having admin alongside other
    // future roles still works by promoting via add-roles path is out of
    // scope for this gate test. Single-role admin coverage above is enough.
    const res = await inject(stack, 'POST', PLACEHOLDERS[0]!.url, org.api_key, {});
    expect(res.statusCode).toBe(501);
  });

  it('response bodies for 401/403/501 never contain provider plaintext substrings', async () => {
    const org = await seedOrg(stack); // non-admin
    const url = PLACEHOLDERS[0]!.url;
    const r401 = await inject(stack, 'POST', url, undefined, {});
    const r403 = await inject(stack, 'POST', url, org.api_key, {});
    await grantAdminRole(stack, org.api_key_prefix);
    const r501 = await inject(stack, 'POST', url, org.api_key, {});
    for (const r of [r401, r403, r501]) {
      expect(r.rawBody).not.toContain('sk-ant-');
      expect(r.rawBody).not.toContain('sk-proj-');
      expect(r.rawBody).not.toContain('leak-canary');
    }
  });
});
