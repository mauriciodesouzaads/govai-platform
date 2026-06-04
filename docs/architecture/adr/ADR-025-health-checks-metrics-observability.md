# ADR-025: Health Checks, Metrics, and Observability for AuditSealer

Status: Accepted — design constraint for future B3 implementation (does not authorize implementation)

> **Acceptance note (B3 decision pack, 2026-06-04):** accepted as a design constraint for future B3 implementation. Does not authorize implementation. B3 remains blocked by ADR-023 (append→mark_sealed idempotency) and the Phase 2.5 runtime-to-evidence dispatch decision.

## Context

- A dedicated process must operate in production.
- Health cannot be just "process alive".
- Metrics must distinguish the provider path from the evidence / sealing path.

## Decision

### Health checks

- liveness;
- readiness;
- DB connectivity;
- ability to claim;
- ability to mark sealed / failed;
- backlog age;
- stale sealing count.

### Metrics

- captures claimed;
- captures sealed;
- captures failed;
- claim latency;
- seal latency;
- append latency;
- backlog depth;
- oldest pending age;
- stale sealing count;
- retry count;
- terminal failure count.

### Logs

- structured;
- no raw prompts;
- no raw provider responses;
- no secrets;
- sanitized errors.

### Alerts

- stale backlog;
- high failure rate;
- no progress;
- DB errors;
- role errors.

Provider-native SLO must be tracked separately from sealer SLO.

## Metrics format

- Metrics format default: OpenTelemetry-compatible names and labels.
- Prometheus exposition is acceptable as deployment adapter, but metric semantics must remain OTel-compatible.
- Required labels:
  - org_id only if cardinality-safe or hashed;
  - tenant_tier;
  - operational_mode;
  - result;
  - reason;
  - provider only when relevant;
  - capability_id only when relevant.
- High-cardinality labels prohibited:
  - raw run_id;
  - raw capture_id;
  - raw provider_request_id;
  - raw prompt;
  - raw response;
  - user email;
  - secret identifiers.

## Required metric names

- `govai_audit_sealer_claim_total`
- `govai_audit_sealer_sealed_total`
- `govai_audit_sealer_failed_total`
- `govai_audit_sealer_claim_latency_ms`
- `govai_audit_sealer_seal_latency_ms`
- `govai_audit_sealer_backlog_depth`
- `govai_audit_sealer_oldest_pending_age_seconds`
- `govai_audit_sealer_stale_count`
- `govai_audit_sealer_retry_total`
- `govai_audit_sealer_terminal_failure_total`
- `govai_provider_native_latency_ms`
- `govai_provider_native_error_total`

## Health response shape

- liveness: process alive only;
- readiness: DB reachable, required permissions validated, backlog below critical threshold, no fatal config error;
- readiness must fail for sealer if sealer cannot seal;
- readiness failure of sealer must not imply provider-native endpoints are down;
- health payload must not include raw prompts/responses/secrets.

## Structured log fields

- event;
- component;
- result;
- reason;
- provider when relevant;
- capability_id when relevant;
- org_hash or tenant tier, not raw sensitive org details;
- no raw prompt;
- no raw response;
- no secrets.

## Provider-native impact

- Observability must prove the sealer is not degrading OpenAI, Anthropic, or
  Claude Code.
- If provider latency changes, it must not be hidden by sealer metrics.
- The provider path and the sealer path must have separate dashboards.
- No logging of raw Claude Code payloads.

## Acceptance criteria

- metrics list complete;
- health endpoints / spec documented;
- raw prompt / response logging forbidden;
- provider-native latency separated from sealer latency.
