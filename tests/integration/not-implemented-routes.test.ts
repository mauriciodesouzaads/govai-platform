// NI.1, NI.2 — 501 schema for routes that still defer to PR3.
// /passthrough/anthropic/v1/messages was replaced by PR2 Batch A with the real implementation.
// /passthrough/openai/v1/chat/completions was replaced by PR2 Batch C with the real implementation.
// Only the 2 PR3 admin routes remain in this list.
//
// PR3.1c (issue #26): the admin placeholder routes now require admin RBAC
// before returning 501. This test was updated to pass an admin API key so
// the canonical 501 contract is still exercised.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startStack,
  stopStack,
  inject,
  seedOrg,
  grantAdminRole,
  type Stack,
} from './helpers/server-fixture.js';

let stack: Stack;
let adminApiKey: string;

beforeAll(async () => {
  stack = await startStack();
  const org = await seedOrg(stack);
  await grantAdminRole(stack, org.api_key_prefix);
  adminApiKey = org.api_key;
}, 240_000);

afterAll(async () => {
  if (stack) await stopStack(stack);
});

const ROUTES: Array<{
  method: 'GET' | 'POST';
  url: string;
  capability: string;
  phase: 'PR2' | 'PR3';
}> = [
  { method: 'POST', url: '/v1/admin/audit-events/00000000-0000-0000-0000-000000000000/crypto-shred', capability: 'admin.audit_event.crypto_shred', phase: 'PR3' },
  { method: 'POST', url: '/v1/admin/dlp-detectors', capability: 'admin.dlp_detectors.crud', phase: 'PR3' },
];

describe('501 not-implemented routes', () => {
  it('NI.1 — every deferred route returns 501 with structured body (admin auth)', async () => {
    for (const r of ROUTES) {
      const res = await inject(stack, r.method, r.url, adminApiKey, {});
      expect(res.statusCode, `route ${r.url}`).toBe(501);
      const body = res.body as Record<string, unknown>;
      expect(body['error']).toBe('capability_not_implemented_in_runtime_patch_1');
      expect(body['capability']).toBe(r.capability);
      expect(body['status']).toBe('planned');
      expect(body['planned_phase']).toBe(r.phase);
      expect(body['tracker']).toBe('docs/architecture/baseline-decisions.md#runtime-roadmap');
    }
  });

  it('NI.2 — no response body in any deferred route contains the literal pipeline_incomplete_in_baseline', async () => {
    for (const r of ROUTES) {
      const res = await inject(stack, r.method, r.url, adminApiKey, {});
      expect(res.rawBody).not.toContain('pipeline_incomplete_in_baseline');
    }
  });
});
