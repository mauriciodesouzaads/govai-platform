# GovAI Backend Foundation V1 — Canonical Freeze Record

Formal Foundation V1 baseline. Written by EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2
(REV2) on 2026-08-18 from merged source, migrations, executing tests, accepted ADRs and the
hash-verified M1/M2/M2A mission records — not from memory. This record makes the repository
say exactly what the source and the real acceptance prove; it does not make GovAI more
complete by writing stronger words. Where any other document conflicts with this record or
with `current-state.md`, this record and `current-state.md` prevail; merged executable source
prevails over both.

## 1. Immutable runtime anchor

```text
FOUNDATION_V1_RUNTIME_ANCHOR=de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68
FOUNDATION_V1_RUNTIME_TREE=0174a5c5b2e74c80b904d035b4f8ddc10abbbd69
FOUNDATION_V1_RUNTIME_PARENT=3e90f2fbfb60a011ce8a21e189896c06887c1c04
BASE_MEANING=POST_M2A_FOUNDATION_RUNTIME_ACCEPTED
```

Meaning: the last Foundation V1 runtime-changing accepted commit before the documentary
freeze — the squash of PR #132 (M2A), whose tree equals the live-accepted M2A head tree.
The Foundation V1 runtime is the executable content of that tree; nothing in this
documentary movement changes it.

## 2. Documentary freeze

```text
FOUNDATION_V1_DOCUMENTARY_FREEZE_PR=133
FOUNDATION_V1_DOCUMENTARY_FREEZE_BRANCH=docs/foundation-v1-m3-canonical-freeze
FOUNDATION_V1_DOCUMENTARY_FREEZE_TREE=RECORDED_IN_EXTERNAL_MISSION_RECORD
  (a tree cannot embed its own hash; the frozen PR head SHA/tree that the two
   independent reviewers verify — and the eventual squash merge SHA — are
   recorded in the external M3 mission record and review packet, and are
   proven post-merge by tree equality against main)
FOUNDATION_V1_DOCUMENTARY_FREEZE_MOVEMENT=EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2-REV2
```

Movements composing Foundation V1 (all merged before this record):

| Movement | Merge | Content |
|---|---|---|
| M1 — native/governed contract | PR #131 → `3e90f2fb` (2026-08-16) | Native pass-and-observe (OD-1=A), computer-use-only floor, non-computer tools forwarded, unknown-beta forwarding with hashed markers, Content-Encoding transport truth (FB-3), evidenced denies (durable blocked v4), 502 credential contract, auth-before-registry + registry-truthful 405, governed recommendation-vs-applied honesty (F2 HTTP), governed original bytes |
| M2 — real-provider acceptance | read-only at `3e90f2fb` (2026-08-16/17) | live acceptance (see §4); 6 findings F1–F6 (1×P2, 5×P3) |
| M2A — final corrections | PR #132 → `de80664a` (2026-08-17) | Anthropic `request-id` evidence (F1), `isMainModule` entrypoints (F2), raw query preservation (F5); live re-accepted at the merged tree |
| M3 — canonical freeze (this) | PR #133 | documentary only |

## 3. Freeze assertions

```text
FOUNDATION_V1_RUNTIME_CORRECTION_COMPLETE=YES
FOUNDATION_V1_REAL_PROVIDER_ACCEPTANCE=PASS_WITH_EXECUTED_SCOPE
FOUNDATION_V1_AGENT_CLIENT_ACCEPTANCE=PASS_WITH_EXECUTED_SCOPE
FOUNDATION_V1_PROVIDER_NATIVE_DOCTRINE=ACCEPTED            (ADR-021)
FOUNDATION_V1_D9_PROMULGATION=COMPLETE_IN_FREEZE_TREE
FOUNDATION_V1_F2=CLOSED_WITH_REGISTERED_RESIDUAL
FOUNDATION_V1_KNOWN_RUNTIME_BLOCKERS=0
FOUNDATION_V1_SCHEMA_RESIDUALS_REGISTERED=YES              (§6, §7)
```

Explicit negatives (these are NOT claimed by Foundation V1):

```text
UNIVERSAL_PROVIDER_PARITY=NOT_CLAIMED
PROVIDER_EXACTLY_ONCE=NOT_CLAIMED
CERTIFICATION=NOT_CLAIMED
REGULATORY_COMPLIANCE=NOT_CLAIMED
PRODUCT_COMPLETE=NO
PHASE5_COMPLETE=NO
WORKROOM_COMPLETE=NO
HUMAN_AUTH_COMPLETE=NO
EC5_COMPLETE=NO
QUERY_TARGET_FULL_SEALED_RECONSTRUCTION=NOT_CLAIMED
CONTINUOUS_PRODUCTION_SEALER_OPERATION=NOT_IMPLIED          (runner code exists; live loop operation is a separate authorization)
```

The sentence "Foundation V1 works against real AI providers" is permitted **only with the
executed-scope qualification** of §4. It must not be read as: every endpoint works; every
future SDK works; every provider is supported; every beta is known; every tool is
understood; universal compatibility exists.

## 4. Real acceptance — executed scope (from the hash-verified records)

Sources: `EP-FOUNDATION-V1-M2-MISSION-RECORD-REV2.md` (SHA-256
`f48fac2c4e94f1a3ad8e2281fa769d6e7314723ba3ca0ee1f8330b456745f0ab`) and
`EP-FOUNDATION-V1-M2A-MISSION-RECORD-REV2.md` (SHA-256
`5bfdbcaa3b58af2680c4f6b0bfb99fa261c9feec103d856f68aa7362d3b70fa2`), both with sanitized
call ledgers, kept in the owner's external audit handoff (paths intentionally not
recorded here). M2 ran read-only at `3e90f2fb`; M2A ran at head `7cdde191` whose tree
`0174a5c5` equals the runtime anchor tree, so no post-merge live rerun was needed.

Executed and PASS (real TCP, provider keys held only by GovAI as KMS-envelope tenant
credentials, agent/SDK children built without any provider key):

- Anthropic + OpenAI, Native/Audited (`/passthrough`) and Governed (`/governed`),
  non-stream and stream: 8/8 via official SDKs (`@anthropic-ai/sdk` 0.117.1, `openai` 7.4.0);
  OpenAI Chat Completions smoke; FB-3 header truth on the real socket.
- Provider-native 4xx relayed truthfully (Anthropic 404 `not_found_error`, OpenAI 400
  `model_not_found`) with the provider request id relayed.
- Synthetic unknown `anthropic-beta` token forwarded → provider rejected it
  (`PASS_PROVIDER_REJECTED_AS_EXPECTED`; hashed marker durable; raw token persisted nowhere);
  a real current Anthropic beta accepted through GovAI.
- Client-defined / function tool descriptors reached both providers (no execution);
  provider-hosted computer-use blocked pre-provider on all four surfaces (403, provider
  dispatch count 0, durable blocked v4 captures with taxonomy version).
- `/v1/runs` real governed runs on both providers; idempotent replay returned the SAME run
  with zero second dispatch; divergent same-key intent → 409.
- AuditBridge → `govai.audit_capture_outbox`: durable captures for every direct-route
  request; `payload_hash` and `capture_id` recomputed with the repository's own functions
  and matched (M2 21/21; M2A 6/6). Bounded seal-once (one committed transaction, no loop)
  sealed exactly one capture with the deterministic `audit_event_id`; HMAC chain verified;
  tenant isolation held.
- Coding-agent CLIs: Claude Code 2.1.233 and the OpenAI Codex CLI 0.140.0-alpha.2,
  passthrough and governed, each answered through GovAI with durable
  captures; API-key mode only; no provider secret in any child env, output, log or DB dump
  (leak scans PASS).
- M2A: real Anthropic `request-id` captured in evidence (3/3 captures incl. the CLI lane);
  the raw query reached both providers verbatim (`/v1/models?limit=1`, `/v1/files?limit=1`,
  the CLI's `/v1/messages?beta=true`); the real entrypoints (`run migrate` / `run dev`) booted
  the live stack from a spaced checkout path.
- Spend: M2 ≈ USD 0.0177; M2A ≈ USD 0.0084. No secrets in any persisted artifact.

## 5. Foundation F2 — final source adjudication (closed with residual)

Re-read at the anchor (`packages/core-governance/src/enforcement.ts`,
`packages/provider-anthropic/src/governed/handle-messages.ts`,
`packages/provider-openai/src/governed/handle-responses.ts` / `handle-chat-completions.ts`,
`packages/provider-*/src/governed/register-governed.ts`,
`packages/core-events/src/passthrough-invoked.ts`):

- The enforcement matrix RECOMMENDS `observe|warn|ask|enforce|sandbox_required|blocked`;
  the governed handlers stop only on the computer-use floor or `enforcement_decision ===
  'blocked'` — so the recommendation can differ from the applied result (`ask`,
  `sandbox_required`, `enforce`, `warn` forward).
- HTTP is honest about it: `x-govai-enforcement-decision` carries the recommendation and
  `x-govai-enforcement-applied` carries `forwarded` or `blocked`; a 403 body carries
  `enforcement_applied: 'blocked'` and `block_trigger: 'tool_validation' |
  'governance_enforcement'`.
- A blocked request emits a v4 event with `enforcement_decision='blocked'` and
  `body_forward_mode='blocked'` (schema Rule 2) — the sealed evidence reflects the actual
  block; no false "applied" event is fabricated on the forward path (the forwarded event
  carries the recommendation label with `body_forward_mode='raw'` and a response hash).
- What is NOT first-class in sealed v4: `block_trigger`, an explicit applied-vs-recommended
  field, the matrix version — this provenance is recomputed from other fields / HTTP, not
  sealed.

```text
F2_CLASSIFICATION=EVIDENCE_GRANULARITY_GAP
F2_RUNTIME_DEFECT=NO
F2_FALSE_EVIDENCE=NO
F2_FOUNDATION_BLOCKER=NO
F2_SCHEMA_V5_REQUIRED_NOW=NO
F2_SCHEMA_EVOLUTION=DEFERRED
F2_FOUNDATION_V1_STATUS=CLOSED_WITH_RESIDUAL      (residual R2)
```

Query evidence (M2A F5), same class:

```text
QUERY_STRING_RUNTIME_FORWARDING=CORRECT_POST_M2A
QUERY_STRING_FIRST_CLASS_SEALED_EVIDENCE=NOT_PRESENT_IN_V4
CLASSIFICATION=EVIDENCE_GRANULARITY_RESIDUAL       (residual R1)
FOUNDATION_RUNTIME_BLOCKER=NO
```

## 6. Foundation V1 residual register (retained; not erased to look cleaner)

| # | Residual | Class | Runtime blocker | Where it lives |
|---|---|---|---|---|
| R1 | Query request-target not first-class in sealed v4 (`native_endpoint` stays the registry template; the query is forwarded verbatim) | DEFERRED_EVIDENCE_SCHEMA | NO | M2A F5; H1 map FV1-QUERY |
| R2 | F2 recommendation/applied provenance (`block_trigger`, applied field, matrix version) not fully first-class sealed | DEFERRED_EVIDENCE_SCHEMA | NO | §5 |
| R3 | Unknown-beta provenance not a dedicated typed v4 field; the hashed/bounded marker in `risk_escalation_reasons` is a schema-neutral compromise | DEFERRED_EVIDENCE_SCHEMA | NO | M1 FB-1; M2 F6 |
| R4 | Provider-credential-unresolvable path (HTTP 502 `provider_credential_unresolvable`) receives NO fabricated passthrough v4 event (v4 cannot represent it truthfully); structured warn log only | DEFERRED_EVIDENCE_SCHEMA | NO | M1 FB-4 |
| R5 | `tool.validation_blocked` / `passthrough.beta_denied` v1 diagnostics pass through the v4-only AuditBridge sink → `invalid_runtime_event` warn + drop-counter noise; the actual block evidence (blocked v4) is durable | DEFERRED_RUNTIME_NON_BLOCKING | NO | M2 F3 |
| R6 | Beta policy snapshot freshness (`anthropic-beta-policy@2026-05-06`, `openai-beta-policy@2026-08-16`) is not universal provider knowledge; unknown-beta provider-truth forwarding mitigates runtime compatibility risk | DEFERRED_RUNTIME_NON_BLOCKING | NO | M2 F6 |
| R7 | Real EC-5 deferred (separate Option-A EP) | DEFERRED_RUNTIME | NO | EP-008D |
| R8 | P0.3-C pre-reservation concurrent-winner window — `KNOWN_V1_LIMITATION`, liveness only; not a safety/idempotency violation | DEFERRED_RUNTIME_NON_BLOCKING | NO | current-state §8 |
| R9 | GitHub branch protection / ruleset enforcement absent/deferred (`REPO_ENFORCEMENT_ASSESSMENT=DEFERRED_NON_BLOCKING`); merge safety is process-enforced | DEFERRED_PROCESS | NO | resume-playbook |
| R10 | Broader provider endpoint parity (e.g. Anthropic multipart route-level test, `/v1/conversations`, batches, realtime, images/audio) is future work | DEFERRED_COMPATIBILITY | NO | ADR-021 proven scope; consolidation-plan matrix |
| R11 | Workroom Phases 5–7 incomplete | DEFERRED_RUNTIME | NO | current-state §1 |
| R12 | True Phase 5 ask / sandbox / enforce primitives incomplete (only `blocked` blocks) | DEFERRED_RUNTIME | NO | §5, §10 |
| R13 | Commercial tier ↔ governance-profile coupling must be separated before governance settings or high-risk agentic UI | DEFERRED_DESIGN | NO | §10 |
| R14 | Production human UI requires human auth / session / API-key lifecycle (none exists) | DEFERRED_RUNTIME | NO | roadmap next lane |
| R15 | Full SPEC v2.2 consolidation (Governance Kernel + AuditBridge + durable run dispatch) remains a NAMED follow-up — `EP-FOUNDATION-V1-SPEC-V2.2-CONSOLIDATION`; SPEC v2.1 is historical; no v2.2 file exists | DOCUMENTARY_FOLLOW_UP | NO | D8 |
| R16 | Legacy `docs/` root artifacts (`docs/codex-*`, `docs/govai_runtime_patch_1_pre_merge_v2.md`) relocation remains a separate hygiene follow-up (checks L1–L5) | DOCUMENTARY_FOLLOW_UP | NO | §28 of the M3 dispatch |

Additional non-blocking notes carried from the records: Claude Code's auxiliary
`HEAD <base>/api/hello` probe answers 401 (passthrough) / 404 (governed), non-fatal
(`DEFERRED_COMPATIBILITY_NON_BLOCKING`); the `X-GovAI-Request-Id` echo does not reach direct
streaming responses (`PRE_EXISTING`, tracked); `SEEDORG_FLAKE_CANDIDATE` — observed in the
shared integration harness, but source review at the anchor shows its collision domain derives
from the current API-key prefix generator and schema, not from the fixture:
`packages/core-identity/src/api-keys.ts` forms the lookup prefix as `govai_sk_` plus the first
three base64url characters (`PREFIX_LOOKUP_LEN=12`, nominal domain 64³ = 262,144) with no
collision retry, and `govai.api_keys.prefix` is the PRIMARY KEY (migration
`0005_runtime_patch_1.sql`). Foundation V1 implements no production human/API-key issuance
lifecycle — at the anchor `generateApiKey()` and every `INSERT INTO govai.api_keys` in the tree
are test-only — so this is classified `LATENT_AUTH_LIFECYCLE_DESIGN_RISK` and carried as
deferred hardening in the R14 human-auth lane under the named follow-up
`EP-AUTH-API-KEY-PREFIX-COLLISION-HARDENING`; it is NOT a current Foundation V1 runtime
blocker, and M3 records this truth without changing any runtime behaviour.

## 7. Anti-evaporation clause for future event schemas

```text
FOUNDATION_V1_SCHEMA_RESIDUALS_REGISTERED=YES
FUTURE_EVENT_SCHEMA_VERSION_CHANGE_REQUIRES=
  REVIEW_OF_ALL_FOUNDATION_V1_REGISTERED_EVIDENCE_GRANULARITY_RESIDUALS
```

Any future event-schema evolution (v5, v6, …) MUST, for each registered evidence-granularity
residual — at minimum R1 (query request-target), R2 (F2 recommendation vs applied
provenance), R3 (unknown-beta first-class provenance), R4 (credential-unresolvable durable
evidence), and block-trigger granularity where applicable, plus the H1 follow-up
`body_parse_status` / `classification_skipped` — explicitly **close**, **preserve**, or
**supersede with rationale** it. No silent deletion. A schema change that does not carry
this review is out of order.

## 8. M2 / M2A finding carry-forward (from the verified records, not memory)

| Family | Origin | Disposition at the anchor |
|---|---|---|
| Anthropic provider request id never captured | M2 F1 (P2) | CLOSED — M2A F1 (`request-id` primary, provider-aware dispatcher, fixture models the real header, hermetic + live proof) |
| Entrypoint main-guard path fragility (`import.meta.url === file://argv[1]`) | M2 F2 (P3) | CLOSED — M2A F2 (`apps/api/src/main-module.ts` `isMainModule`; real spaced-path boot) |
| Passthrough stripped the request query | M2 F5 (P3) | CLOSED — M2A F5 (raw query preserved; CASE A `?beta=true` PRESERVE proven directly against Anthropic) |
| `tool.validation_blocked` diagnostic counted as a bridge drop | M2 F3 (P3) | DEFERRED_NON_BLOCKING — residual R5 |
| Claude Code `HEAD /api/hello` probe 401/404 | M2 F4 (P3) | DEFERRED_COMPATIBILITY_NON_BLOCKING (non-fatal; observed again in M2A) |
| Beta policy snapshot 2026-05-06 does not know current betas | M2 F6 (P3) | DEFERRED_RUNTIME_NON_BLOCKING — residual R6 (M3 documents; M3 does NOT refresh runtime policy) |
| Query evidence granularity | M2A | DEFERRED_EVIDENCE_SCHEMA — residual R1 |
| F2 evidence granularity | M1/M3 | CLOSED_WITH_REGISTERED_RESIDUAL — residual R2 |
| Stale live-test comments ("logger-only", "hijacked logger") in `tests/live/*` | M2 (STALE_COMMENT_ONLY ×2) | DOCUMENTARY_ONLY — comments in live tests, not edited by M3 (test files are out of M3 scope); registered in `stale-docs-register.md` |
| Owner `.env.local` retired model alias | M2 | NOT_A_DEFECT (operator environment) |

## 9. Local-deny / evidence residual reclassification (source-adjudicated at the anchor)

Native gate order (both providers): auth (401) → path (404) → method (405 + `Allow`) → tool
floor → beta floor → credential (502) → forward.

| Path | Provider reached? | HTTP | Durable v4? | Outbox? | Structured log? | Evidence status |
|---|---|---|---|---|---|---|
| A. Provider-hosted computer-use Native hard floor | NO | 403 | YES (blocked v4: `enforcement_decision='blocked'`, `body_forward_mode='blocked'`, `credential_source='not_resolved_pre_provider_block'`, classifications + taxonomy v3) | YES | `tool.validation_blocked` v1 diagnostic (log-only) | present; less granular (no typed block_trigger) |
| B. Unknown / unresolved beta token | YES (forwarded byte-intact) | provider's | YES (hashed marker in `risk_escalation_reasons`) | YES | — | present; not a typed field (R3) |
| C. Non-computer tools (client-defined, function, typed_unknown, hosted non-computer) | YES | provider's | YES (classifications, contributed risk) | YES | — | present |
| D. Old OpenAI Files `purpose` local deny | REMOVED by EP-11 (PR #126) | — | — | — | — | CLOSED_BY_EP11 |
| E. Provider credential unresolvable | NO | 502 `provider_credential_unresolvable` | NO (v4 cannot represent it truthfully) | NO | YES (warn: provider, org, reason; no secret) | R4 |
| F. `hard_denied` beta (computer-use family) | NO | 403 `beta_denied` | YES (blocked v4) | YES | `passthrough.beta_denied` v1 diagnostic (log-only) | present |
| G. Governed matrix `blocked` (risk E; D on starter) | NO | 403 `governed_blocked` (+ `block_trigger`) | YES (blocked v4) | YES | — | present; R2 granularity |
| H. Auth/path/method contract errors | NO | 401 / 404 / 405 | NO (no tenant/capability decision) | NO | request log | NOT_A_GOVERNANCE_DECISION |

```text
OLD_CLASS_WIDE_LOCAL_DENY_LABEL=SUPERSEDED_BY_NARROW_RESIDUALS
```

The former class-wide `LOCAL_DENY_EVIDENCE_INCOMPLETENESS` P1 family is not carried
forward as such: at this anchor every governance-decision block emits a durable blocked v4
capture; the narrow residuals are R3, R4, R5 (and R2 for granularity).

## 10. Enforcement hardening line (frozen distinction)

```text
RECOMMENDATION_VS_APPLIED_HTTP_HONESTY=IMPLEMENTED
TRUE_PHASE5_ASK_ENFORCEMENT=NOT_IMPLEMENTED
TRUE_PHASE5_SANDBOX_ENFORCEMENT=NOT_IMPLEMENTED
PROVIDER_NATIVE_COMPUTER_USE_FLOOR=EXPLICIT_HIGH_RISK_HARD_DENY
UNKNOWN_PROVIDER_SEMANTICS=PASS_OR_OBSERVE_BY_DEFAULT
COMMERCIAL_TIER_VS_GOVERNANCE_PROFILE_SEPARATION=
  REQUIRED_BEFORE_GOVERNANCE_SETTINGS_OR_HIGH_RISK_AGENTIC_UI
```

No canonical document may imply that "ask happened because recommendation=ask" or that
"sandbox happened because recommendation=sandbox_required". A UI must not represent ask /
sandbox / enforcement as applied until the Phase 5 primitives exist.

## 11. What this freeze does not erase (future lanes)

Production human auth/session/key lifecycle; UI/UX V1; Phase 5 actual enforcement
primitives; governance-profile / commercial-tier separation; broader provider endpoint
parity; event-schema evidence-granularity evolution; query request-target sealed
provenance; F2 evidence granularity; credential-unresolvable evidence; beta taxonomy
freshness; real EC-5; Workroom 5–7; legacy docs-root hygiene; SPEC v2.2 consolidation;
repository enforcement assessment; certification/audit-product evolution.
**Foundation frozen does NOT mean product finished.**

Next recommended product lane after this freeze merges (NOT executed by M3):
`UI_UX_V1_FOUNDATION` — conversational/native streaming UX over the direct native/governed
routes; durable work/replay/workrooms over `/v1/runs`; evidence views over `/v1/evidence`
and `/v1/audit-events`; production user release requires human auth/session/key lifecycle;
the UI must not represent ask/sandbox/enforcement as applied until Phase 5 primitives exist.
See `development-roadmap.md`.

## 12. Named documentary follow-ups

- `EP-FOUNDATION-V1-SPEC-V2.2-CONSOLIDATION` — SPEC v2.2 (Governance Kernel, AuditBridge
  and Durable Run Dispatch). Not authored in M3; current operational truth = merged source +
  accepted ADRs + `current-state.md` + this record. No file exists yet; do not link to one.
- Legacy `docs/` root artifact relocation (R16) — separate hygiene PR after checks L1–L5.
- `EP-FOUNDATION-V1-RUN-DISPATCH-DEPLOY-RUNBOOK` — author
  `docs/runbooks/run-dispatch-deploy.md` as a dedicated operational-documentation movement.
  It must formalize the source-proven migration 0029 deployment invariant
  (`apps/api/src/db/migrations/0029_durable_provider_dispatch.sql`, `DEPLOY_ORDER`):
  `APPLY_MIGRATION → DRAIN_OLD_API_INSTANCES → DEPLOY_NEW_API →
  START_RECOVERY_WORKER → RESUME_RUN_TRAFFIC`. That ordering already exists today as a
  migration/runtime compatibility constraint; M3 records the outstanding
  operational-documentation obligation and neither authors the runbook nor changes any
  deployment behavior. No file exists at that path yet; do not link to one.
- Future D9 doctrine changes require a dedicated architecture/doctrine movement.
