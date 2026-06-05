# ADR-023: Stale Sealing Recovery Strategy

Status: Accepted as design constraint — not implemented, not tested, does not authorize B3

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

## Decision: append→mark_sealed partial-failure idempotency

**Decision:**
- Choose **Option A(b)**: a deterministic `audit_event_id` derived from `org_id + capture_id`.
- B3 sealing appends must be idempotent per capture by deriving the **same** audit event id on every retry.
- The deterministic id is the **primary recovery key** for orphan-append detection.
- This is a **design constraint only: not implemented, not tested, and does not authorize B3.**

The three idempotency layers remain distinct: capture idempotency is solved by `capture_id` UNIQUE + `chain_state` row-level lock (`captureAuditEvent` / migration 0025; insertion only); `mark_sealed` same-event idempotency is partially solved by same-`audit_event_id` no-op semantics in `markAuditCaptureSealed`; **neither** solves the partial-failure case where `auditAppend` succeeds and `mark_sealed` fails before the outbox ref is recorded.

**Mechanism:**
- Future deterministic id: `audit_event_id = UUIDv5(namespace = govai.audit_sealer.capture_event.v1, name = "org:{org_id}:capture:{capture_id}")`
- The exact namespace UUID must be documented as a constant in the implementation PR (not defined here).
- B3 must look up `govai.audit_events.id = deterministic_audit_event_id` **before** append (`audit_events.id` is a `uuid PRIMARY KEY`, migration 0001:29).
- If the event exists:
  - validate that it belongs to the same org, expected audit chain/category, `event_type`, subject, `payload_hash`, and `redaction_metadata.audit_sealer.capture_id` (carried by `buildAuditCaptureSealingEvent`, `sealer.ts`);
  - do not append again;
  - call `mark_sealed` with the deterministic `audit_event_id`.
- If the event does not exist:
  - call a future append path that accepts the deterministic `eventId` (today `auditAppend` generates `randomUUID()` and passes it to `govai.audit_append_locked(p_event_id, …)`; the SQL function already takes a caller-supplied id, but `AuditAppendInput` does not yet accept one);
  - then call `mark_sealed`.
- If an insert collision occurs (race):
  - re-read by deterministic `audit_event_id`;
  - validate correspondence;
  - continue to `mark_sealed`.
- `audit_event_capture_refs` remains the final ref after `mark_sealed`, but **cannot** be the primary orphan-append detector, because it is written only by `mark_sealed` / `mark_failed` (migration 0025:196) and may not exist in the critical window.

**Why not Option A(a) — `UNIQUE(capture_id)` on `audit_events`:**
- `audit_events` has no `capture_id` column today (migration 0001); a `UNIQUE(capture_id)` constraint would require a new column and schema change.
- It is unnecessary for the minimal guarantee because `audit_events.id` is already a UUID primary key.
- **No migration is required by this design decision for the minimal duplicate-append guard.** A future implementation may still choose a migration for observability or stronger validation, but it is not part of this decision PR.

**Why not Option A(c) alone — `audit_event_capture_refs` lookup:**
- `audit_event_capture_refs` is written by `mark_sealed`. In the critical case, append succeeded but `mark_sealed` failed before writing the ref, so a refs-only lookup cannot find the orphan append.

**Why not Option B — source-verified single-transaction atomicity:**
- The source does not currently provide a source-verified guarantee that claim/`sealing`, append, and `mark_sealed` always commit atomically.
- The library is caller-owned and does not open/commit transactions (`sealer.ts:658-722`).
- ADR-023 and `sealer.ts` assume captures may remain in `sealing` after a crash.
- Relying on Option B would either contradict the existing stale-sealing premise or require redesigning transaction ownership.

**Result:**
- The decision is **accepted as a design constraint**.
- The mechanism is **not implemented**.
- The mechanism is **not tested**.
- **B3 implementation is still not authorized.**
- A future implementation PR must: evolve `auditAppend` (or add a sealer-only append adapter) to accept an explicit deterministic event id; add lookup-before-append logic; add validation of existing-event correspondence; and add tests for append-succeeded / `mark_sealed`-failed recovery without duplicate append (see `specs/audit-sealer-b3-technical-plan.md` §11).

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
