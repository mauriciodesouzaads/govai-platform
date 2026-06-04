# ADR-023: Stale Sealing Recovery Strategy

Status: Proposed — blocked on append→mark_sealed partial-failure idempotency decision

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

## Blocking decision: append→mark_sealed partial-failure idempotency

**This decision is NOT made. ADR-023 cannot be Accepted until it is.**

- **Capture idempotency is solved** by `capture_id` / outbox insertion semantics (`capture_id` UNIQUE + `chain_state` row-level lock, in `captureAuditEvent` / migration 0025). It protects capture **insertion** only.
- **`mark_sealed` same-event idempotency is solved/partially solved** by same-`audit_event_id` no-op semantics in `markAuditCaptureSealed`. It protects **repeated `mark_sealed` calls** only.
- **Neither solves the B3 partial-failure case**, where `auditAppend` succeeds and `mark_sealed` fails before the outbox ref (`audit_event_id` / `audit_event_capture_refs`) is recorded, after which recovery reprocesses the same capture.
- **Source finding:** `auditAppend` (`packages/core-audit/src/append.ts:72`) generates a fresh `randomUUID()` per call and has **no per-capture idempotency key**; its advisory lock (`append.ts:58`) only serializes concurrent appends on the same chain. A re-append for the same capture would create a **duplicate** chain event. The only alternative guarantee — single-transaction atomicity of claim+append+mark_sealed — is a **caller-owned** transaction-boundary decision (`sealNextAuditCapture` has no internal BEGIN/COMMIT, `sealer.ts:658-722`) and is in tension with this ADR's own premise that captures can be left in `sealing` after a crash (which implies the claim/`sealing` state may be committed separately).
- **B3 must not be implemented** until an exact append idempotency key, a deterministic `audit_event_id` strategy, an existing-ref lookup-before-append strategy, or an equivalent source-verified single-transaction guarantee is **selected and made testable**. The required future tests are listed in `specs/audit-sealer-b3-technical-plan.md` §11.
- This remains a **B3 implementation blocker**.

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
