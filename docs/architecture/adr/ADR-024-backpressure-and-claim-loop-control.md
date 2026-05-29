# ADR-024: Backpressure and Claim-Loop Control

Status: Proposed

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
