// EP-EVIDENCE-GAUGE-WIRING U3 — the D6 boot-gating 2×2 matrix. Asserts registration
// happens ONLY when telemetry.enabled (OTEL endpoint set) AND the enumerator URL is set,
// without a DB, a collector, or a real MeterProvider. The gauge-wiring collaborators are
// mocked (real modules preserved via importActual + only the wiring fns overridden), so
// startTelemetry.enabled mirrors the real gate and registerEvidenceGauges is a spy.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadEnv, type GovAIEnv } from '@govai/config';

const hoisted = vi.hoisted(() => ({
  registerEvidenceGauges: vi.fn(() => ({ unregister: vi.fn() })),
  createEvidenceGaugeSource: vi.fn(() => async () => []),
  enumerateAllOrgs: vi.fn(),
}));

vi.mock('@govai/observability', async (importActual) => ({
  ...(await importActual<typeof import('@govai/observability')>()),
  startTelemetry: vi.fn((env: { OTEL_EXPORTER_OTLP_ENDPOINT?: string }) => ({
    enabled: Boolean(env.OTEL_EXPORTER_OTLP_ENDPOINT),
    shutdown: async () => undefined,
  })),
}));

vi.mock('./db/client.js', async (importActual) => ({
  ...(await importActual<typeof import('./db/client.js')>()),
  createPool: vi.fn(() => ({ end: async () => undefined })),
}));

vi.mock('./pipeline/evidence-metrics.js', async (importActual) => ({
  ...(await importActual<typeof import('./pipeline/evidence-metrics.js')>()),
  registerEvidenceGauges: hoisted.registerEvidenceGauges,
}));

vi.mock('./pipeline/evidence-operator.js', async (importActual) => ({
  ...(await importActual<typeof import('./pipeline/evidence-operator.js')>()),
  createEvidenceGaugeSource: hoisted.createEvidenceGaugeSource,
  enumerateAllOrgs: hoisted.enumerateAllOrgs,
}));

import { buildServer } from './server.js';

const ENUM_URL = 'postgres://govai_evidence_enumerator:pw@localhost:5432/govai';
const OTEL_ENDPOINT = 'http://localhost:4318';

function envWith(otel: string | undefined, url: string | undefined): GovAIEnv {
  // A clearly-fake dev seed (test-only; never a real secret).
  const base = loadEnv({ NODE_ENV: 'test', KMS_DEV_SEED: 'a'.repeat(64) });
  return { ...base, OTEL_EXPORTER_OTLP_ENDPOINT: otel, GOVAI_EVIDENCE_ENUMERATOR_URL: url };
}

async function buildWith(otel: string | undefined, url: string | undefined): Promise<void> {
  const app = await buildServer({
    env: envWith(otel, url),
    pool: { end: async () => undefined } as never,
  });
  await app.close();
}

describe('server D6 gauge-wiring gate — the 2×2 matrix (EP-EVIDENCE-GAUGE-WIRING U3)', () => {
  beforeEach(() => hoisted.registerEvidenceGauges.mockClear());

  it('cell {endpoint unset, url unset} — does NOT register', async () => {
    await buildWith(undefined, undefined);
    expect(hoisted.registerEvidenceGauges).not.toHaveBeenCalled();
  });

  it('cell {endpoint set, url unset} — does NOT register', async () => {
    await buildWith(OTEL_ENDPOINT, undefined);
    expect(hoisted.registerEvidenceGauges).not.toHaveBeenCalled();
  });

  it('cell {endpoint UNSET, url set} — MUST no-op (reason otel_endpoint_unset)', async () => {
    await buildWith(undefined, ENUM_URL);
    expect(hoisted.registerEvidenceGauges).not.toHaveBeenCalled();
  });

  it('cell {both set} — the ONLY registering cell', async () => {
    await buildWith(OTEL_ENDPOINT, ENUM_URL);
    expect(hoisted.registerEvidenceGauges).toHaveBeenCalledTimes(1);
  });
});
