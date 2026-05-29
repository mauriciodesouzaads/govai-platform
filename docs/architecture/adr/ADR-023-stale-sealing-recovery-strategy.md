# ADR-023: Stale Sealing Recovery Strategy

Status: Proposed

## Context

- The B0 outbox has explicit states (`captured`, `sealing`, `sealed`,
  `failed`).
- B2 documented stale sealing as a B3 concern.
- Captures can be left in `sealing` if the runner crashes between claim and
  mark-sealed.
- We need a recovery strategy before introducing the loop.

## Decision

- Stale sealing recovery belongs to the dedicated runner, not to the core
  library.
- Recovery must be transactional.
- Recovery must use a configurable minimum age before acting on a
  `sealing` row.
- Recovery must distinguish between:
  - still in progress;
  - stale recoverable;
  - failed terminal;
  - retryable.
- Recovery must not duplicate the audit append.
- Recovery must not break the state machine.
- Recovery must emit metrics and work items.
- Recovery must not block the provider hot path.
- Recovery must not affect Claude Code, OpenAI, or Anthropic.

## B3 default recovery policy

- stale threshold initial default: 10 minutes;
- max retry attempts initial default: 3;
- retry backoff initial default: exponential backoff with jitter, starting at 30 seconds, capped at 5 minutes;
- terminal failure after max retries or unrecoverable integrity error;
- recovery batch initial default: 10 rows;
- recovery is transactional;
- recovery never appends duplicate audit events for the same capture.

## Duplicate append prevention

- audit append must be idempotent per capture sealing attempt;
- runner must check capture state before append;
- runner must claim row under row-level lock or equivalent existing B0 claim function;
- runner must not append if capture is already sealed;
- runner must not append twice for same capture/attempt;
- if append succeeded but mark sealed failed, recovery must detect existing append/evidence before deciding retry vs failed;
- if exact append idempotency key does not yet exist, B3 must either introduce one explicitly or document why existing capture state/functions guarantee idempotency;
- no duplicate append prevention may rely only on process memory.

## Provider-native impact

- Stale recovery runs outside the provider path.
- The user must not feel recovery happening.
- A recovery backlog must not cripple providers.
- A governance gap must be reported as an evidence / sealer health issue, not as
  a provider failure.
- stale recovery does not block low-risk provider-native traffic;
- stale backlog is evidence-plane health, not OpenAI/Anthropic/Claude Code UX degradation.

## Acceptance criteria

- define the stale threshold;
- define the retry policy;
- define the terminal failure policy;
- define idempotency;
- define metric / event / work item emission;
- make the non-hot-path property explicit.
