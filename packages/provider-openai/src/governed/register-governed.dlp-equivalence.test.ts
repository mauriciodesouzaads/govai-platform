// AI-CONSOLE-RESPONSES-DLP-GAP-01 — governed Responses classifies EQUIVALENT message
// representations consistently, and does so BEFORE the provider is dispatched
// (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §4/§5/§10).
//
// Why an end-to-end proof and not only the extractor unit test: the governance outcome
// is what the caller actually receives, and it is the thing that was wrong. A body whose
// text the pre-scan could not read was forwarded at base risk A / `observe` — a sound
// decision about nothing. The four shapes that used to be invisible now resolve to the
// same effective risk class and the same enforcement decision as the two that always
// worked.
//
// ★ NO REAL PERSONAL DATA. `SENSITIVE` is a local synthetic marker and the DLP scanner
// here is a test double keyed to it (§10: hermetic upstream for DLP-sensitive fixtures;
// a synthetic identifier matching the test detector is sufficient). Nothing in this file
// contacts a real provider.
//
// The ordering proof is explicit: the scanner records `providerCalls` at the moment it
// runs, so `dispatchesBeforeScan` === 0 IS the "before dispatch" assertion — not an
// inference from the code's shape.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerOpenAIGoverned, type OpenAIGovernedDeps } from './register-governed.js';
import type { GovernedTenant } from './handle-responses.js';

const SENSITIVE = 'GOVAI-TEST-CPF-000.000.000-00';

let fake: http.Server;
let app: FastifyInstance;
let govUrl: string;
let providerCalls = 0;
const auditEvents: Array<Record<string, unknown>> = [];
/** Every text the governed pre-scan was handed, with the provider call count at that moment. */
let scans: Array<{ text: string; providerCallsAtScan: number }> = [];

beforeAll(async () => {
  fake = http.createServer((req, res) => {
    req.on('data', () => undefined);
    req.on('end', () => {
      providerCalls++;
      res.writeHead(200, { 'content-type': 'application/json', 'openai-request-id': 'req_dlp' });
      res.end('{"id":"resp_1","ok":true}');
    });
  });
  await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));

  const deps: OpenAIGovernedDeps = {
    upstreamBaseUrl: `http://127.0.0.1:${(fake.address() as AddressInfo).port}`,
    resolveTenant: async (): Promise<GovernedTenant> => ({
      org_id: '00000000-0000-4000-8000-0000000000c4',
      tier: 'enterprise',
      operational_mode: 'production',
    }),
    resolveProviderKey: async () => ({ apiKey: 'sk-harness-fake', source: 'platform_env' }),
    // A test double, not the real detector: it fires on the synthetic marker only, and
    // reports the `cpf` detector so resolveGovernance treats it as strong PII (A → C).
    dlpScan: async (text: string) => {
      scans.push({ text, providerCallsAtScan: providerCalls });
      return text.includes(SENSITIVE) ? { findings: [{ detector: 'cpf' }] } : { findings: [] };
    },
    emitAuditEvent: (ev) => {
      auditEvents.push(ev as unknown as Record<string, unknown>);
    },
  };
  app = Fastify({ logger: false });
  await app.register(async (i) => registerOpenAIGoverned(i, deps));
  await app.listen({ port: 0, host: '127.0.0.1' });
  govUrl = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await new Promise<void>((r) => fake.close(() => r()));
});

beforeEach(() => {
  providerCalls = 0;
  scans = [];
  auditEvents.length = 0;
});

/** The same message, in every representation the current OpenAI Responses contract accepts. */
const SHAPES: ReadonlyArray<{ name: string; input: unknown }> = [
  { name: 'string input', input: SENSITIVE },
  {
    name: 'typed message + string content',
    input: [{ type: 'message', role: 'user', content: SENSITIVE }],
  },
  {
    name: 'typed message + input_text[]',
    input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: SENSITIVE }] }],
  },
  { name: 'role-shaped message + string content', input: [{ role: 'user', content: SENSITIVE }] },
  {
    name: 'role-shaped message + input_text[]',
    input: [{ role: 'user', content: [{ type: 'input_text', text: SENSITIVE }] }],
  },
  {
    name: 'mixed valid input array',
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'context' }] },
      { role: 'assistant', content: 'acknowledged' },
      { role: 'user', content: SENSITIVE },
    ],
  },
];

type Outcome = {
  status: number;
  effective: string | null;
  decision: string | null;
  scannedText: string;
  /** Provider dispatches THIS request had made when its pre-scan ran. Must be 0. */
  dispatchesBeforeScan: number;
  /** Provider dispatches THIS request made in total. Must be 1. */
  dispatchesAfter: number;
};

async function send(input: unknown): Promise<Outcome> {
  // Snapshot the counter so `dispatchesBeforeScan` is a DELTA for THIS request —
  // `providerCalls` accumulates across a test that sends more than one body.
  const before = providerCalls;
  const res = await fetch(`${govUrl}/governed/openai/v1/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-x', input }),
  });
  await res.text();
  const scan = scans.at(-1);
  if (!scan) throw new Error('the governed pre-scan was never invoked');
  return {
    status: res.status,
    effective: res.headers.get('x-govai-effective-risk-class'),
    decision: res.headers.get('x-govai-enforcement-decision'),
    scannedText: scan.text,
    dispatchesBeforeScan: scan.providerCallsAtScan - before,
    dispatchesAfter: providerCalls - before,
  };
}

describe('governed Responses — DLP semantic equivalence across accepted message shapes', () => {
  for (const shape of SHAPES) {
    it(`${shape.name}: the synthetic marker is scanned BEFORE dispatch and escalates to C / enforce`, async () => {
      const out = await send(shape.input);
      expect(out.status).toBe(200);
      expect(out.dispatchesBeforeScan).toBe(0); // ★ scanned before the provider was called
      expect(out.scannedText).toContain(SENSITIVE);
      expect(out.effective).toBe('C');
      expect(out.decision).toBe('enforce');
      expect(out.dispatchesAfter).toBe(1);
    });
  }

  it('all six representations resolve to ONE governance outcome — no shape is privileged', async () => {
    const outcomes: Outcome[] = [];
    for (const shape of SHAPES) outcomes.push(await send(shape.input));
    expect(new Set(outcomes.map((o) => `${o.effective}/${o.decision}`))).toEqual(
      new Set(['C/enforce']),
    );
    expect(outcomes.map((o) => o.dispatchesBeforeScan)).toEqual(SHAPES.map(() => 0));
    // The escalation reason is recorded identically on every emitted event.
    const reasons = auditEvents
      .filter((e) => e['event_type'] === 'passthrough.invoked')
      .map((e) => JSON.stringify(e['risk_escalation_reasons']));
    expect(reasons).toHaveLength(SHAPES.length);
    expect(new Set(reasons)).toEqual(new Set([JSON.stringify(['dlp:cpf:pii_strong'])]));
  });

  it('a clean body in the same shapes stays at base A / observe — the escalation tracks the text, not the shape', async () => {
    for (const input of [
      'nothing sensitive here',
      [{ type: 'message', role: 'user', content: 'nothing sensitive here' }],
      [{ role: 'user', content: 'nothing sensitive here' }],
      [{ role: 'user', content: [{ type: 'input_text', text: 'nothing sensitive here' }] }],
    ]) {
      const out = await send(input);
      expect(out.effective).toBe('A');
      expect(out.decision).toBe('observe');
    }
  });

  it('the marker in metadata, ids or a model name is NOT read as prompt text (no indiscriminate string scan)', async () => {
    const res = await fetch(`${govUrl}/governed/openai/v1/responses`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: `gpt-${SENSITIVE}`,
        previous_response_id: `resp_${SENSITIVE}`,
        metadata: { ticket: SENSITIVE },
        input: [{ role: 'user', content: 'a harmless question' }],
      }),
    });
    await res.text();
    expect(scans.at(-1)?.text).toBe('a harmless question');
    expect(res.headers.get('x-govai-effective-risk-class')).toBe('A');
    expect(res.headers.get('x-govai-enforcement-decision')).toBe('observe');
  });
});
