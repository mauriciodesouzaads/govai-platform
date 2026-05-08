// NI.1, NI.2 — 501 schema for routes that still defer to PR2/PR3.
// /passthrough/anthropic/v1/messages was a 501 stub in PR1; PR2 Batch A replaced
// it with the real implementation, so it is no longer in this list.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startStack, stopStack, inject, type Stack } from './helpers/server-fixture.js';

let stack: Stack;

beforeAll(async () => {
  stack = await startStack();
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
  { method: 'POST', url: '/passthrough/openai/v1/chat/completions', capability: 'passthrough.openai', phase: 'PR2' },
  { method: 'POST', url: '/v1/admin/audit-events/00000000-0000-0000-0000-000000000000/crypto-shred', capability: 'admin.audit_event.crypto_shred', phase: 'PR3' },
  { method: 'POST', url: '/v1/admin/dlp-detectors', capability: 'admin.dlp_detectors.crud', phase: 'PR3' },
];

describe('501 not-implemented routes', () => {
  it('NI.1 — every deferred route returns 501 with structured body', async () => {
    for (const r of ROUTES) {
      const res = await inject(stack, r.method, r.url, undefined, {});
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
      const res = await inject(stack, r.method, r.url, undefined, {});
      expect(res.rawBody).not.toContain('pipeline_incomplete_in_baseline');
    }
  });
});
