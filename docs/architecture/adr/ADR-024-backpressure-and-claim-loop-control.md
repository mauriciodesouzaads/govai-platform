# ADR-024: Backpressure and Claim-Loop Control

Status: Accepted — design constraint for future B3 implementation (does not authorize implementation)

> **Acceptance note (B3 decision pack, 2026-06-04):** accepted as a design constraint for future B3 implementation. Does not authorize implementation. B3 remains blocked by ADR-023 (append→mark_sealed idempotency) and the Phase 2.5 runtime-to-evidence dispatch decision.

## Context

- B3 will introduce a loop / process.
- The claim loop can generate database load.
- A sealing backlog must not degrade the provider-native experience.

## Decision

- The claim loop must be bounded.
- No busy loop.
- No unbounded concurrency.
- No aggressive lock contention.
- Use a small / configurable batch.
- Use jitter / backoff.
- Use idle sleep.
- Use a max in-flight bound.
- Use graceful shutdown.
- Use advisory / row locks as defined in B0.
- Do not block OpenAI, Anthropic, or Claude Code.
- Backpressure must affect sealing throughput, not the provider request path.
- If the backlog grows, emit metrics / work items / alerts.
- Do not use provider request latency as a backpressure mechanism.

## B3 initial runtime defaults

- claim batch size default: 10;
- max in-flight seals default: 2;
- idle sleep default: 1000 ms;
- empty-queue backoff default: exponential 1s to 30s with jitter;
- error backoff default: exponential 30s to 5m with jitter;
- lock wait timeout default: fail fast / no long blocking wait;
- graceful shutdown drain timeout default: 30s;
- max loop CPU behavior: no busy loop;
- provider request path throttling: forbidden;
- backlog alert threshold default: oldest pending age > 5 minutes or backlog > 1000 pending captures.

## Provider-native protection

- sealer backlog cannot throttle provider requests;
- sealer loop cannot run in apps/api;
- sealer CPU/DB backpressure must be bounded to its own deploy unit/pool;
- no model/token/stream/tool caps may be used to reduce sealer backlog.

## Provider-native impact

- Backpressure must not make the user feel slowness in the providers.
- Do not cap tokens, model, streaming, or tool calling to compensate for a
  backlog.
- Do not turn off Claude Code because of a sealing backlog.
- Any degradation must be governance / evidence-side, not provider-side, except
  for an explicit high-risk policy.

## Acceptance criteria

- bounded loop;
- limited concurrency;
- backoff / jitter;
- graceful shutdown;
- metrics;
- no provider-path throttling;
- no silent caps.
