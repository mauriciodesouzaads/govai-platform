# ADR-032 — OpenAI Files `purpose=assistants`: provider-truth correction

## Status

Accepted.

The owner adjudication is complete (2026-07-25). The accepted decision is
recorded in repository history (PR #121 squash, commit
`e422280d63d52da2ed08fb488146266b2ef7dac0`: "ADR-032 was accepted
separately as the controlling implementation constraint"), and this ADR is
its repository-promulgation artifact. Only the version merged to `main` is
canonical.

`DECISION_STATUS=ACCEPTED`

`IMPLEMENTATION_STATUS=COMPLETE` — implemented by **EP-11 / PR #126**
(squash `01c05fd61428a76d300b73fb335021f598519d2f`, tree `20ccd433`
byte-identical to the audited head, single parent `629b6e9f`; post-merge
main CI run `31649394857` SUCCESS). `IMPLEMENTED_BY=EP-11 / PR #126`.
Reconciled by EP-FOUNDATION-V1-M3 (2026-08-18); the promulgation-era pointer
`IMPLEMENTATION_STATUS=PENDING` and the "Runtime truth at promulgation" /
"Consequences" interim wording below are **HISTORICAL_PRE_EP11_RUNTIME** —
retained as the record of the state when this ADR was promulgated (PR #125),
not as current prose.

Current runtime (Foundation V1 anchor
`de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68`): the removed local Files-purpose
validator (`packages/provider-openai/src/passthrough/files-purpose-validator.ts`)
does NOT exist and does NOT execute; the date-triggered `block_post_sunset`
branch, the synthetic local 403, the `x-govai-deprecation-warning` header and
the route-side supply of the legacy purpose-deprecation fields are gone;
passthrough Files requests with `purpose=assistants` are forwarded and the
provider's own accept/reject is the recorded evidence. Only the historical
event/emitter/capture compatibility machinery is retained
(`packages/provider-openai/src/passthrough/audit-emit.ts`,
`packages/core-events/src/passthrough-invoked.ts`,
`packages/core-events/src/audit-bridge-capture-payload.ts`).

This ADR changes no runtime code. Repository promulgation of the decision
(PR #125) and its runtime implementation (PR #126) were distinct, separately
verified acts.

## Context

The passthrough Files surface applies a date-gated validator
(`packages/provider-openai/src/passthrough/files-purpose-validator.ts`) to
uploads with `purpose=assistants`.

The completed EP-11 source inspection determined that the affected external
surface is the **Assistants API, not the Files API**. That correction and the
separate acceptance of ADR-032 are recorded in permanent repository history
at commit `e422280d63d52da2ed08fb488146266b2ef7dac0`.

The validator attaches the Assistants API sunset event to the Files surface.
Past its executable gate instant, GovAI would return a synthetic HTTP 403
before provider forwarding and thereby assert an outcome that the provider
did not produce or observe for that request.

The local block also returns before provider credential resolution, and no
audit event is emitted for that locally blocked request.

## Decision

1. Remove the date-triggered local deny (`block_post_sunset`).
2. Remove the current warning injection (`allow_with_warning` header path).
3. Preserve forwarding of the affected request to the provider.
4. Preserve evidence of the provider's actual result — the provider's own
   accept/reject is the recorded truth.
5. This decision and its priority are not date-dependent.

## Runtime truth at promulgation (HISTORICAL_PRE_EP11_RUNTIME — superseded by PR #126)

At source anchor
`main@ee984f2111611b3fef71ad00ac897f3ff984347c`, the validator remains
implemented.

For `purpose=assistants`:

- at `now <= 2026-08-26T00:00:00.000Z`, it returns
  `allow_with_warning`; the request proceeds to the provider and
  `x-govai-deprecation-warning` is injected;
- at `now > 2026-08-26T00:00:00.000Z`, it returns
  `block_post_sunset`;
- the boundary is fixed by executable source and tests: the exact instant
  `2026-08-26T00:00:00.000Z` produces the warning path, while
  `2026-08-26T00:00:01.000Z` produces the block path;
- the block is a local synthetic HTTP 403 returned before provider
  credential resolution and before provider forwarding;
- no provider result therefore exists for that locally blocked request;
- no audit event is emitted for that local block.

The validator's own header comment describes the post-sunset branch as
`>= 2026-08-27`. That comment is inconsistent with the executable comparison
and its tests. Executable behavior and tests are the runtime truth.

The merge of this ADR alone changes none of the behavior above.

EP-11 is a subsequent, separate implementation movement and must not begin
until this ADR's repository-promulgation artifact is present on `main`.
*(Historical gate — satisfied: PR #125 promulgated this ADR; PR #126
implemented EP-11.)*

## Invariants

- GovAI does not assert provider outcomes it did not observe.
- Local enforcement decisions must not masquerade as provider results.
- Decision promulgation and runtime implementation are distinct, separately
  verified acts.

## Consequences

- EP-11 has a narrow implementation scope: remove the false local deny and
  warning paths, preserve provider forwarding, preserve provider-result
  evidence, and update the affected tests accordingly.
- *(Historical, pre-EP11)* Until EP-11 merged, every passthrough Files request
  that reached the validator with `purpose=assistants` followed the then-current
  validator behavior: warning-and-forward at or before the configured boundary
  instant, and synthetic local 403 after it. **EP-11 merged (PR #126); this
  interim state no longer exists.**
- The interim runtime state was recorded here so acceptance of this ADR could
  not be mistaken for completed implementation; implementation is now
  complete and recorded above.

## Non-goals

- `LOCAL_DENY_EVIDENCE_INCOMPLETENESS` — class-wide local-deny evidence gaps;
  this remains a separate P1 evidence-integrity movement.
- D9 / PR-0 documentary promotion.
- F2 source adjudication or sealed-schema work.
- P0.3-C.
- Any CI, branch-protection or repository-ruleset change.
- Any runtime implementation of EP-11 in this documentary movement.

## Evidence / provenance

The decision is supported in layers, each with a different role:

- **Owner decision:** owner adjudication completed on 2026-07-25. The
  out-of-tree handoff artifact is
  `ADJUDICACAO-GPT-x-OPUS-PR-BODY+ADR032-PROMULGACAO_ARCHITECT_50fb0ca.md`;
  its storage path is operational evidence rather than a repository
  dependency.
- **Acceptance and corrected surface:** permanent repository history,
  commit `e422280d63d52da2ed08fb488146266b2ef7dac0`, records both the
  acceptance of ADR-032 as the controlling implementation constraint and
  the source-inspection correction that the affected external surface is
  the Assistants API, not the Files API.
- **Canonical corroboration:** `docs/architecture/development-roadmap.md`,
  items 3–4 at the pre-promulgation anchor, records completed owner
  adjudication, the repository-promulgation gate and the narrow EP-11
  decision. The roadmap explicitly is not the constraint text; this ADR is.
- **Executable truth:**
  `packages/provider-openai/src/passthrough/files-purpose-validator.ts`,
  `packages/provider-openai/src/passthrough/files-purpose-validator.test.ts`
  and `packages/provider-openai/src/routes/register-passthrough.ts` at
  `main@ee984f2111611b3fef71ad00ac897f3ff984347c`.
- **External corroboration, non-normative:** as observed on 2026-08-12,
  OpenAI's public API documentation records the Assistants API shutdown for
  2026-08-26 and still lists `assistants` as a Files API `purpose` value.
  This observation may change independently of this decision and does not
  control the ADR. Provider truth for an executed request is the result
  actually returned by the provider.
