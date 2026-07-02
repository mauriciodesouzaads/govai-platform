# Observability (local) — OTLP collector + Prometheus + Grafana

Stand up the receiving end of the telemetry `apps/api` and `apps/audit-sealer`
emit (via `@govai/observability` `startTelemetry`, gated on
`OTEL_EXPORTER_OTLP_ENDPOINT`), so the `govai_audit_bridge_{drops,captures}_total`
counters (EP-008B) and the sealer's ADR-025 instruments become **observable** in
Prometheus/Grafana.

> ⚠️ **Not emitted by app boot yet: the `govai_evidence_*` gauges (EP-008D).** Their
> registration plumbing (`registerEvidenceGauges` / `createEvidenceGaugeSource`) and
> per-org source ship, but **no `apps/api` boot path registers them** — the cross-org
> emission needs an operator-privileged pool that sees all orgs, and `apps/api`
> constructs only the `govai_app` pool (RLS-scoped to one org). Wiring them into boot
> is a **follow-up EP**. Until then, setting `OTEL_EXPORTER_OTLP_ENDPOINT` yields the
> audit-bridge counters + sealer instruments, **not** `govai_evidence_*` series. (The
> `pnpm test:obs` live test exercises the gauge transport by registering the source
> itself — see §4.)

Everything here is **additive and local**. No provider spend is involved.

## 1. Bring up the collector stack

```bash
# GRAFANA_ADMIN_PASSWORD is refuse-if-missing (see .env.example). Set it first:
#   openssl rand -hex 24 | xargs printf 'GRAFANA_ADMIN_PASSWORD=%s\n' >> .env
docker compose -f infra/docker-compose.observability.yml up -d
```

The observability stack is a **separate** compose file, so the everyday
`docker compose -f infra/docker-compose.yml up -d postgres` (below) never evaluates the
Grafana refuse-if-missing secret; only bringing up this file requires `GRAFANA_ADMIN_PASSWORD`.

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
- Prometheus directly: <http://localhost:9090> → `govai_audit_bridge_drops_total`,
  `govai_audit_bridge_captures_total`, etc. (the `govai_evidence_*` gauges are **not**
  emitted by app boot yet — see the note above; a follow-up EP wires them, and the
  dashboard's evidence panels stay empty until then.)

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

> What Part 2 proves — and what it does not: the `govai_audit_bridge_*` **counters**
> go through the real shipped app path (`createOtelAuditBridgeMetrics`). The
> `govai_evidence_*` **gauges** are registered by the **test itself**
> (`registerEvidenceGauges` with a per-org source), because no app boot path registers
> them yet — so Part 2 validates the gauge **transport + shape** end-to-end, not that
> the running app emits them. App-boot wiring is the follow-up EP noted at the top.

> The OPTIONAL, budget-capped (<< $0.01), CI-excluded real-provider check that proves
> the real capture path feeds the same telemetry is gated behind
> `GOVAI_LIVE_PROVIDER_BUDGET_OK=1` + real provider keys — see
> [user-e2e-local.md](./user-e2e-local.md).

## 5. Apple Silicon / non-Linux Docker hosts

If **Docker Desktop on Apple Silicon** fails to run the distroless collector image
(e.g. `exec /otelcol-contrib: no such file or directory`, even after a fresh
re-pull — a Docker Desktop image-extraction quirk with distroless/`FROM scratch`
images), run the live test against a **real Linux Docker host** instead. A clean
[colima](https://github.com/abiosoft/colima) VM (or Lima, or any Linux host) works:

```bash
brew install colima && colima start            # a lightweight Linux Docker VM
export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"
export TESTCONTAINERS_RYUK_DISABLED=true        # colima's virtiofs can't bind-mount the
                                                # docker socket into Ryuk; the test stops
                                                # its own containers, so this is safe
pnpm test:obs
```

> Also confirm the pinned collector tag is a **working build**: `0.116.0`'s arm64
> image is broken (the binary fails to exec on *any* host — reproduced on a clean
> colima Linux VM); the stack pins `0.119.0`, which runs.
