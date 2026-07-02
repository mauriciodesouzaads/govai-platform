// EP-OBS-COLLECTOR — the ZERO-SPEND telemetry e2e (Part 2 of the collector spec).
//
// Proves the telemetry export path works end-to-end at NO provider cost: the
// telemetry is fed by the audit-capture OUTBOX (not provider bytes), so seeding
// the outbox directly (the §4.3 helper) drives the metric values. A real OTel
// MeterProvider (startTelemetry) exports OTLP/HTTP → a real otel-collector →
// scraped by a real Prometheus → queried back out, and the SCRAPED value must
// equal the SEEDED value. No provider is touched.
//
// ★ What this proves, precisely (PR #114 @codex Finding 2 — the honest labels):
//   - govai_audit_bridge_* COUNTERS: emitted via the SHIPPED app path
//     (createOtelAuditBridgeMetrics) — the real production emitter.
//   - govai_evidence_* GAUGES: registered HERE BY THE TEST (registerEvidenceGauges
//     with a per-org source below). No app boot path registers them yet — apps/api
//     builds only the govai_app pool (session-org-scoped), so it has no operator-
//     privileged pool to enumerate all orgs; boot-wiring is a deferred follow-up EP.
//     So for the GAUGES this validates the TRANSPORT + SHAPE (emit→collect→scrape→
//     query of the frozen names/labels), NOT that the running app emits them.
//
// Lives in tests/live/ (CI-excluded). Run: `pnpm test:obs` (needs Docker).
// D1: testcontainers (matches §4.3). D2: forceFlush() on the global MeterProvider
// (no startTelemetry signature change — the PR stays test/infra-only).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { metrics } from '@opentelemetry/api';
import { GenericContainer, Network, Wait, type StartedTestContainer, type StartedNetwork } from 'testcontainers';
import { startTelemetry, type TelemetryHandle } from '@govai/observability';
import { withTenant } from '@govai/core-tenant';
import { startStack, stopStack, seedOrg, type Stack } from '../integration/helpers/server-fixture.js';
import { createSeedHelpers, type SeedHelpers } from '../integration/helpers/evidence-seed.js';
import { evidenceSummary, type ReportScope } from '../../apps/api/src/pipeline/evidence-reports.js';
import {
  registerEvidenceGauges,
  summaryToGaugePoints,
  type EvidenceGaugesHandle,
} from '../../apps/api/src/pipeline/evidence-metrics.js';
import { createOtelAuditBridgeMetrics } from '../../apps/api/src/pipeline/audit-bridge-metrics.js';

// NOTE: 0.116.0's arm64 image is a broken build (the binary fails to exec — missing ELF
// interpreter — reproduced on Docker Desktop AND a clean colima Linux VM); 0.119.0 runs.
const COLLECTOR_IMAGE = 'otel/opentelemetry-collector-contrib:0.119.0';
const PROMETHEUS_IMAGE = 'prom/prometheus:v3.1.0';
const SCOPE: ReportScope = { windowSeconds: 86_400, tSealSeconds: 0 };

let network: StartedNetwork;
let collector: StartedTestContainer;
let prometheus: StartedTestContainer;
let stack: Stack;
let seed: SeedHelpers;
let telemetry: TelemetryHandle;
let gauges: EvidenceGaugesHandle | undefined;
let promBase: string;

async function forceFlushGlobal(): Promise<void> {
  // The global provider registered by startTelemetry is the SDK MeterProvider,
  // which exposes forceFlush() (a collect + export without teardown). D2.
  const provider = metrics.getMeterProvider() as unknown as { forceFlush?: () => Promise<void> };
  if (typeof provider.forceFlush === 'function') await provider.forceFlush();
}

/** Poll the Prometheus HTTP API until `query` returns a vector, then the sample value. */
async function promQuery(query: string, timeoutMs = 30_000): Promise<number | null> {
  const deadline = Date.now() + timeoutMs;
  const url = `${promBase}/api/v1/query?query=${encodeURIComponent(query)}`;
  let last: unknown = null;
  // Bounded poll — Prometheus scrapes the collector every 5s.
  while (Date.now() < deadline) {
    const res = await fetch(url).catch(() => null);
    if (res && res.ok) {
      const body = (await res.json()) as {
        status: string;
        data: { result: Array<{ metric: Record<string, string>; value: [number, string] }> };
      };
      last = body;
      const result = body.data?.result ?? [];
      if (result.length > 0) return Number(result[0]!.value[1]);
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  void last;
  return null;
}

describe('EP-OBS-COLLECTOR — telemetry e2e (seed → emit → collect → scrape → query, ZERO spend)', () => {
  beforeAll(async () => {
    network = await new Network().start();

    collector = await new GenericContainer(COLLECTOR_IMAGE)
      .withNetwork(network)
      .withNetworkAliases('otel-collector')
      .withCopyFilesToContainer([
        { source: join(process.cwd(), 'infra/otel/collector-config.yaml'), target: '/etc/otel/collector-config.yaml' },
      ])
      .withCommand(['--config=/etc/otel/collector-config.yaml'])
      .withExposedPorts(4318, 8889, 13133)
      .withWaitStrategy(Wait.forHttp('/', 13133).forStatusCode(200))
      .start();

    prometheus = await new GenericContainer(PROMETHEUS_IMAGE)
      .withNetwork(network)
      .withCopyFilesToContainer([
        { source: join(process.cwd(), 'infra/prometheus/prometheus.yml'), target: '/etc/prometheus/prometheus.yml' },
      ])
      .withCommand(['--config.file=/etc/prometheus/prometheus.yml'])
      .withExposedPorts(9090)
      .withWaitStrategy(Wait.forHttp('/-/healthy', 9090).forStatusCode(200))
      .start();

    promBase = `http://${prometheus.getHost()}:${prometheus.getMappedPort(9090)}`;

    stack = await startStack();
    seed = createSeedHelpers(stack);

    // Our own real MeterProvider → the collector's host-mapped OTLP/HTTP port.
    // (The app's own startTelemetry was a no-op — the fixture leaves the endpoint unset.)
    telemetry = startTelemetry(
      { OTEL_EXPORTER_OTLP_ENDPOINT: `http://${collector.getHost()}:${collector.getMappedPort(4318)}` },
      { serviceName: 'govai-api-e2e' },
    );
  }, 240_000);

  afterAll(async () => {
    gauges?.unregister();
    await telemetry?.shutdown().catch(() => undefined);
    if (stack) await stopStack(stack);
    await prometheus?.stop().catch(() => undefined);
    await collector?.stop().catch(() => undefined);
    await network?.stop().catch(() => undefined);
  });

  it('seeded govai_evidence_* and govai_audit_bridge_* values are scraped back out of Prometheus and MATCH', async () => {
    expect(telemetry.enabled).toBe(true);
    const org = await seedOrg(stack);

    // Seed a KNOWN outbox shape: 3 stalled-past-SLO (captured), 1 failed, 2 sealed.
    // With tSeal=0 every unsealed capture is past-SLO → EC-1 stalled_past_slo = 3.
    for (let i = 0; i < 3; i++) await seed.seedCaptureInStatus(org.org_id, 'captured');
    await seed.seedCaptureInStatus(org.org_id, 'failed');
    await seed.seedCaptureInStatus(org.org_id, 'sealed');
    await seed.seedCaptureInStatus(org.org_id, 'sealed');
    const EXPECT_STALLED = 3;

    // A KNOWN drop snapshot into the evidence gauge source (as fix-up#4 injects
    // ZERO_DROP_SNAPSHOT — non-zero here), through the shipped evidenceSummary →
    // summaryToGaugePoints path.
    const KNOWN_DROP = { drops: 4, captures: 6 };
    gauges = registerEvidenceGauges(async () => {
      const client = await stack.db.appPool.connect();
      try {
        const summary = await withTenant(client, org.org_id, (c) => evidenceSummary(c, SCOPE, KNOWN_DROP));
        return summaryToGaugePoints(org.org_id, summary);
      } finally {
        client.release();
      }
    });

    // KNOWN audit-bridge counter emissions via the shipped safeMetric path.
    const bridge = createOtelAuditBridgeMetrics('govai.audit_bridge.e2e');
    const EXPECT_CAPTURES = 6;
    const EXPECT_DROPS = 2;
    for (let i = 0; i < EXPECT_CAPTURES; i++) bridge.captureTotal({ org_id: org.org_id, provider: 'anthropic' });
    for (let i = 0; i < EXPECT_DROPS; i++)
      bridge.dropTotal({ org_id: org.org_id, provider: 'anthropic', reason: 'capture_failed' });

    await forceFlushGlobal();

    // ★ The acceptance crux: values queried back out of Prometheus == seeded.
    const stalled = await promQuery('govai_evidence_captures_past_slo');
    expect(stalled).not.toBeNull();
    expect(stalled).toBe(EXPECT_STALLED);

    const captures = await promQuery('govai_audit_bridge_captures_total');
    expect(captures).not.toBeNull();
    expect(captures).toBe(EXPECT_CAPTURES);

    const drops = await promQuery('govai_audit_bridge_drops_total');
    expect(drops).not.toBeNull();
    expect(drops).toBe(EXPECT_DROPS);

    // Safe-label re-confirmation end-to-end: org_hash present, raw org_id absent.
    const labelled = await fetch(
      `${promBase}/api/v1/query?query=${encodeURIComponent('govai_audit_bridge_captures_total')}`,
    ).then((r) => r.json() as Promise<{ data: { result: Array<{ metric: Record<string, string> }> } }>);
    const labels = labelled.data.result[0]?.metric ?? {};
    expect(labels).toHaveProperty('org_hash');
    expect(labels).not.toHaveProperty('org_id');
  });
});
