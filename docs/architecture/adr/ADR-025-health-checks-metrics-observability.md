# ADR-025: Health Checks, Metrics, and Observability for AuditSealer

Status: Proposed

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
