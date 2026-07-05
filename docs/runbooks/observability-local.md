# Observability (local) — OTLP collector + Prometheus + Grafana

Stand up the receiving end of the telemetry `apps/api` and `apps/audit-sealer`
emit (via `@govai/observability` `startTelemetry`, gated on
`OTEL_EXPORTER_OTLP_ENDPOINT`), so the `govai_audit_bridge_{drops,captures}_total`
counters (EP-008B) and the sealer's ADR-025 instruments become **observable** in
Prometheus/Grafana.

> ✅ **The `govai_evidence_*` gauges (EP-008D) now emit per-org from app boot** — set
> BOTH `OTEL_EXPORTER_OTLP_ENDPOINT` AND `GOVAI_EVIDENCE_ENUMERATOR_URL` (the
> least-privilege enumerate-only role; provision it via `GOVAI_DB_EVIDENCE_ENUMERATOR_PASSWORD`,
> see `.env.example`). With either unset, the wiring is fully off and boot is
> byte-identical. Enumeration runs on the operator-privileged `govai_evidence_enumerator`
> pool (whose entire capability is `SELECT` on `govai.orgs`); every per-org read stays on
> the `govai_app` pool under `withTenant` — no single database identity holds both
> enumerate and read (INV-1).

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
# For the per-org govai_evidence_* gauges, provision + point at the enumerator role.
# Export this password to PROVISION/ROTATE the enumerator on `migrate`. Omitting it leaves the
# role UNTOUCHED (a routine migration never drops the gauges); to DISABLE it, see the note below.
#   Generate: openssl rand -hex 24 | xargs printf 'GOVAI_DB_EVIDENCE_ENUMERATOR_PASSWORD=%s\n'
export GOVAI_DB_EVIDENCE_ENUMERATOR_PASSWORD=<generated-above>
export GOVAI_EVIDENCE_ENUMERATOR_URL=postgres://govai_evidence_enumerator:<pw>@localhost:5432/govai
docker compose -f infra/docker-compose.yml up -d postgres
pnpm --filter @govai/api run migrate
pnpm --filter @govai/api run dev
```

With `OTEL_EXPORTER_OTLP_ENDPOINT` set, `startTelemetry` registers the global
MeterProvider and the periodic reader exports metrics; additionally, with
`GOVAI_EVIDENCE_ENUMERATOR_URL` set the `govai_evidence_*` gauges register and emit
per-org. With either **unset** the boot is byte-identical and export is a no-op (the
CI/default state).

> **Enumerator credential lifecycle (five-way, GUC-driven):** the LOGIN state on each `migrate`
> is chosen by two INDEPENDENT signals — `GOVAI_DB_EVIDENCE_ENUMERATOR_PASSWORD` and the explicit
> `GOVAI_DB_EVIDENCE_ENUMERATOR_DEPROVISION` (sole accepted value `1`). There is no password
> sentinel: an absent password no longer means "disable".
> - **Provision / rotate:** export the password (no deprovision flag) → `LOGIN` with that password.
> - **Routine migration:** neither signal → the role is **left untouched**; the gauges survive (a
>   schema migration must never drop them by omission).
> - **Disable (deprovision):** export `GOVAI_DB_EVIDENCE_ENUMERATOR_DEPROVISION=1` with **no**
>   password and re-run `migrate` → the role is set `NOLOGIN` (password cleared), then the runner
>   runs a post-commit bounded sweep of live enumerator sessions.
> - Password **and** `DEPROVISION=1` together, or any deprovision value other than `1`, **fail loud**.
>
> Deprovision guarantees, precisely (do not overclaim):
> - **Hard guarantee:** once `NOLOGIN` commits (the `migrate` call returns), **no fresh
>   authentication** with the revoked credential can succeed.
> - **Normal behavior:** the runner's post-commit sweep terminates already-live enumerator sessions.
> - **Exception:** if the bounded sweep reaches its cap it logs a `WARNING` and continues (it never
>   fails the migration — the role is already `NOLOGIN`); re-run the deprovision or restart the API
>   to reap any remaining pre-existing sessions.

## 3. See the metrics

- Grafana: <http://localhost:3000> (admin / `$GRAFANA_ADMIN_PASSWORD`) →
  dashboard **"GovAI — Evidence & Audit-Bridge Telemetry"**.
- Prometheus directly: <http://localhost:9090> → `govai_audit_bridge_drops_total`,
  `govai_audit_bridge_captures_total`, and — with `GOVAI_EVIDENCE_ENUMERATOR_URL` set —
  the per-org `govai_evidence_*` gauges (`govai_evidence_coverage_ratio`, etc.).

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
