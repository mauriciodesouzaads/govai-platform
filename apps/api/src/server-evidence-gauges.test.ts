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
  // Each createPool call returns a FRESH pool with an `on` spy — server.ts attaches an
  // 'error' listener to every pool it owns (FIXUP6 class fix); the fresh objects let the
  // test distinguish the main pool (call 0) from the enumerator pool (call 1).
  createPool: vi.fn(() => ({ end: async () => undefined, on: vi.fn() })),
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
  createPool: hoisted.createPool,
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

  // FIXUP1: G4 upgraded from "absent" to "absent OR empty" — an EMPTY-string env value
  // must disable the wiring without throwing (matches loadEnv's ''→unset normalization).
  it('cell {endpoint set, url EMPTY string} — no throw, disabled (enumerator_url_unset)', async () => {
    await buildWith(OTEL_ENDPOINT, '');
    expect(hoisted.registerEvidenceGauges).not.toHaveBeenCalled();
  });

  it('cell {endpoint EMPTY string, url set} — no throw, disabled (otel_endpoint_unset)', async () => {
    await buildWith('', ENUM_URL);
    expect(hoisted.registerEvidenceGauges).not.toHaveBeenCalled();
  });

  // FIXUP2 D-D: with no injected pool and no DATABASE_URL, the app must fail loud + named
  // (the guard fires before createPool; tests that inject overrides.pool are unaffected).
  it('D-D — buildServer with no injected pool and no DATABASE_URL throws a named BootError', async () => {
    // envWith uses loadEnv({ NODE_ENV: 'test', … }) → env has no DATABASE_URL; no pool override.
    await expect(buildServer({ env: envWith(OTEL_ENDPOINT, undefined) })).rejects.toThrow(
      /DATABASE_URL/,
    );
  });

  // FIXUP6 D-C.1 (class fix): BOTH long-lived pools the app OWNS get an absorbing 'error'
  // listener — the enumerator pool (warn) and the main app pool (error). Built WITHOUT
  // overrides.pool so the app creates both via createPool.
  it('class fix — both app-owned pools get an absorbing error listener (warn enumerator / error app)', async () => {
    hoisted.createPool.mockClear();
    const app = await buildServer({
      env: { ...envWith(OTEL_ENDPOINT, ENUM_URL), DATABASE_URL: 'postgres://unit' },
    });
    try {
      // createPool call 0 = main pool (server.ts:70-72), call 1 = enumerator pool (:113).
      const pools = hoisted.createPool.mock.results.map(
        (r) => r.value as { on: ReturnType<typeof vi.fn> },
      );
      expect(pools.length).toBeGreaterThanOrEqual(2);
      const errorListener = (p: { on: ReturnType<typeof vi.fn> }) =>
        p.on.mock.calls.find((c) => c[0] === 'error')?.[1] as ((e: Error) => void) | undefined;
      const mainListener = errorListener(pools[0]!);
      const enumListener = errorListener(pools[1]!);
      expect(mainListener).toBeTypeOf('function');
      expect(enumListener).toBeTypeOf('function');

      // Invoking each ABSORBS (no throw) and logs at the intended level.
      const warnSpy = vi.spyOn(app.log, 'warn');
      const errorSpy = vi.spyOn(app.log, 'error');
      expect(() => enumListener!(new Error('boom'))).not.toThrow();
      expect(() => mainListener!(new Error('boom'))).not.toThrow();
      expect(warnSpy).toHaveBeenCalled(); // enumerator pool → warn
      expect(errorSpy).toHaveBeenCalled(); // app pool → error
    } finally {
      await app.close();
    }
  });
});
