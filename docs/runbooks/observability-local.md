# Observability (local) — OTLP collector + Prometheus + Grafana

Stand up the receiving end of the telemetry `apps/api` and `apps/audit-sealer`
already emit (via `@govai/observability` `startTelemetry`, gated on
`OTEL_EXPORTER_OTLP_ENDPOINT`), so the `govai_evidence_*` gauges (EP-008D), the
`govai_audit_bridge_{drops,captures}_total` counters (EP-008B), and the sealer's
ADR-025 instruments become **observable** in Prometheus/Grafana.

Everything here is **additive and local** — the export code is already live; you
only need to populate `OTEL_EXPORTER_OTLP_ENDPOINT`. No provider spend is involved.

## 1. Bring up the collector stack

```bash
# GRAFANA_ADMIN_PASSWORD is refuse-if-missing (see .env.example). Set it first:
#   openssl rand -hex 24 | xargs printf 'GRAFANA_ADMIN_PASSWORD=%s\n' >> .env
docker compose -f infra/docker-compose.yml up -d otel-collector prometheus grafana
```

- `otel-collector` (`otel/opentelemetry-collector-contrib`): OTLP/HTTP `:4318`,
  OTLP/gRPC `:4317`, Prometheus scrape endpoint `:8889`, health `:13133`
  (`infra/otel/collector-config.yaml`).
- `prometheus` (`prom/prometheus`): `:9090`, scrapes `otel-collector:8889` every 5s
  (`infra/prometheus/prometheus.yml`).
- `grafana` (`grafana/grafana`): `:3000`, provisioned Prometheus datasource + a
  starter dashboard (`infra/grafana/provisioning/`).

## 2. Point the API at the collector and run it

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318   # exporter POSTs to /v1/metrics
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @govai/api run migrate
pnpm --filter @govai/api run dev
```

With the endpoint set, `startTelemetry` registers the global MeterProvider and the
periodic reader exports metrics; with it **unset** the boot is byte-identical and
export is a no-op (the CI/default state).

## 3. See the metrics

- Grafana: <http://localhost:3000> (admin / `$GRAFANA_ADMIN_PASSWORD`) →
  dashboard **"GovAI — Evidence & Audit-Bridge Telemetry"**.
- Prometheus directly: <http://localhost:9090> →
  `govai_evidence_coverage_ratio`, `govai_audit_bridge_drops_total`, etc.

## 4. Prove it end-to-end (ZERO provider spend)

The telemetry is fed by the audit-capture **outbox**, not by provider bytes, so the
whole emit → collect → scrape → query-back pipeline is validated with **no provider
call at all** — it seeds the outbox directly (as the §4.3 isolation suite does):

```bash
pnpm test:obs      # tests/live/observability-collector.test.ts (out of CI)
```

It seeds a known outbox shape + a known drop snapshot, `forceFlush`es the exporter,
then asserts the value queried back out of the Prometheus HTTP API equals the seeded
value for a `govai_evidence_*` gauge and `govai_audit_bridge_{drops,captures}_total`.

> The OPTIONAL, budget-capped (<< $0.01), CI-excluded real-provider check that proves
> the real capture path feeds the same telemetry is gated behind
> `GOVAI_LIVE_PROVIDER_BUDGET_OK=1` + real provider keys — see
> [user-e2e-local.md](./user-e2e-local.md).
