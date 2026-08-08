// T12 (unit half, EP-P03A-A / F3 §20) — the governed v4 in-memory capture.
//
// The capture is the emitAuditEvent callback handed to the governed handlers
// while the provider fetch is in flight: it must validate the schema, accept
// at most ONE event, and — by construction — never touch a client, a query,
// KMS, the outbox or auditAppend. The runtime half instruments a REAL blocked
// handler dispatch (no DB, no network on the blocked path) to prove the
// callback runs fully in memory. The TX-B persistence half of T12 lives in
// tests/integration/run-dispatch-durability.test.ts.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { handleAnthropicGovernedMessages } from '@govai/provider-anthropic';
import { createGovernedV4Capture } from './run-orchestrator.js';

const TENANT = {
  org_id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  tier: 'starter' as const,
  operational_mode: 'test' as const,
};

/** A real blocked dispatch: a provider-hosted code_execution tool is
 *  blocked_at_validation by the classifier — before any credential/fetch. */
async function realBlockedDispatch(capture: ReturnType<typeof createGovernedV4Capture>) {
  return handleAnthropicGovernedMessages(
    {
      tenant: TENANT,
      rawBody: Buffer.from(
        JSON.stringify({
          model: 'claude-fixture-1',
          max_tokens: 16,
          messages: [{ role: 'user', content: 'run ls' }],
          tools: [{ type: 'code_execution_20241022', name: 'code_execution' }],
        }),
        'utf8',
      ),
      inboundHeaders: { 'content-type': 'application/json' },
      isStream: false,
    },
    {
      upstreamBaseUrl: 'http://127.0.0.1:1',
      resolveProviderKey: async () => {
        throw new Error('resolveProviderKey must NOT be called on the blocked path');
      },
      dlpScan: async () => ({ findings: [] }),
      emitAuditEvent: capture.capture,
    },
  );
}

describe('T12 — createGovernedV4Capture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('captures exactly one schema-valid event from a real blocked dispatch — zero DB, zero KMS, zero fetch', async () => {
    vi.stubGlobal('fetch', () => {
      throw new Error('blocked path must not fetch');
    });
    const capture = createGovernedV4Capture();
    expect(capture.captured()).toBeNull();

    const result = await realBlockedDispatch(capture);
    expect(result.kind).toBe('blocked');

    const ev = capture.captured();
    expect(ev).not.toBeNull();
    expect(ev!.event_type).toBe('passthrough.invoked');
    expect(ev!.schema_version).toBe(4);
    expect(ev!.enforcement_decision).toBe('blocked');
    expect(ev!.body_forward_mode).toBe('blocked');
  });

  it('rejects a second event for the same dispatch', async () => {
    const capture = createGovernedV4Capture();
    const result = await realBlockedDispatch(capture);
    expect(result.kind).toBe('blocked');
    const ev = capture.captured();
    expect(ev).not.toBeNull();
    expect(() => capture.capture(ev!)).toThrow(/duplicate event/);
  });

  it('rejects a schema-invalid event', () => {
    const capture = createGovernedV4Capture();
    expect(() =>
      capture.capture({ event_type: 'passthrough.invoked' } as never),
    ).toThrow();
    expect(capture.captured()).toBeNull();
  });
});
