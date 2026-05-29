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

## Provider-native impact

- Stale recovery runs outside the provider path.
- The user must not feel recovery happening.
- A recovery backlog must not cripple providers.
- A governance gap must be reported as an evidence / sealer health issue, not as
  a provider failure.

## Acceptance criteria

- define the stale threshold;
- define the retry policy;
- define the terminal failure policy;
- define idempotency;
- define metric / event / work item emission;
- make the non-hot-path property explicit.
