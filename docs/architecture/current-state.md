# GovAI Current State

## Status

- **Source of truth** for the current *implementation* state of GovAI.
- **Does not authorize B3.** B3 (the AuditSealer runner) is not started and is not authorized by this document.
- Distinguishes **implemented runtime** from **foundational controls** (evidence-only), **provider-native evidence**, and **documented target architecture**.
- Generated 2026-06-04 from direct inspection of `apps/api/src/server.ts`, route handlers, migrations, `packages/*`, ADRs, and the regulatory docs, at main `8be5cfc74f67feb2824d0cb25da0816b7689a163`.
- State vocabulary used throughout:
  - `IMPLEMENTED_RUNTIME` — real code enforcing/executing at request time.
  - `IMPLEMENTED_FOUNDATIONAL_CONTROL` — real code/schema that records governance **evidence** but does **not** enforce an outcome at runtime.
  - `IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE` — proven by the provider-native raw-body / response harness.
  - `DOCUMENTED_TARGET_ONLY` — described in docs; no code.
  - `PLANNED` — on the roadmap; not built.
  - `BLOCKED_BY_DECISION` — cannot proceed until an explicit decision/ADR acceptance.
  - `STALE_DOC_NEEDS_UPDATE` — a document still describes an older state (see [stale-docs-register.md](./stale-docs-register.md)).

---

## 1. Runtime surfaces

All surfaces below are registered in `apps/api/src/server.ts:79-94`. Only two routes are not-implemented stubs (`sendNotImplemented`, PR3); everything else is real logic.

| Surface | Implemented? | Route/file evidence | Runtime maturity | Limitations | Next step |
|---|---|---|---|---|---|
| Health | yes | `routes/health.ts` (`server.ts:79`) | IMPLEMENTED_RUNTIME | liveness/readiness only | — |
| Capabilities | yes | `routes/capabilities.ts` (`:80`) | IMPLEMENTED_RUNTIME | per-org capability registry view; default-deny for non-registered | — |
| `/v1/runs` | yes | `routes/runs.ts` (`:81`) → `pipeline/run-orchestrator.ts` | IMPLEMENTED_RUNTIME | governed + passthrough modes; hard-deny is policy-block, see §4 | — |
| Audit events | yes | `routes/audit-events.ts` (`:82`) | IMPLEMENTED_RUNTIME | read of HMAC-chained audit chain | — |
| Admin audit crypto-shred | stub | `routes/admin-audit-shred.ts:41` (`sendNotImplemented … 'PR3'`) | PLANNED | route returns not-implemented; the `crypto_shredded` state + ADR-011 design exist in schema, the admin runtime route does not | implement in a later PR |
| Admin DLP detector CRUD | stub | `routes/admin-dlp.ts:40` (`sendNotImplemented … 'PR3'`) | PLANNED | admin detector CRUD is a placeholder; the DLP **pre-scan** itself runs in the governed pipeline (`packages/dlp-br`) | implement detector CRUD later |
| Passthrough Anthropic | yes | `routes/passthrough-anthropic.ts` (`:85`) → `@govai/provider-anthropic` | IMPLEMENTED_RUNTIME + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | see §2 | — |
| Passthrough OpenAI | yes | `routes/passthrough-openai.ts` (`:86`) → `@govai/provider-openai` | IMPLEMENTED_RUNTIME + IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | see §2 | — |
| Governed Anthropic | yes | `routes/governed-anthropic.ts` (`:87`) | IMPLEMENTED_RUNTIME | DLP pre-scan (scan-only) + beta-policy gate + raw forward | — |
| Governed OpenAI | yes | `routes/governed-openai.ts` (`:88`) | IMPLEMENTED_RUNTIME | same governed pattern | — |
| Admin provider credentials | yes | `routes/admin-provider-credentials.ts` (`:89`) | IMPLEMENTED_FOUNDATIONAL_CONTROL | KMS envelope-encrypted SET/GET/REVOKE; no plaintext echo; no rotation policy enforcement | — |
| Workrooms | yes | `routes/workrooms.ts` (`:90`) | IMPLEMENTED_RUNTIME | Phase 1: create/get/list, participants; migration 0012 | see §4 / roadmap |
| Workroom transcript | yes | `routes/workroom-transcript.ts` (`:91`) | IMPLEMENTED_RUNTIME | Phase 2: messages, tasks, evidence index, auditor subview; migration 0013 | — |
| Workroom runs | yes | `routes/workroom-runs.ts` (`:92`) | IMPLEMENTED_RUNTIME | Phase 3: workroom-owned runs via orchestrator `WorkroomRunContext`; migration 0014 | — |
| Workroom approvals | yes | `routes/workroom-approvals.ts` (`:93`) | IMPLEMENTED_RUNTIME | Phase 4: request/decide/revoke; SoD + TOCTOU + encrypted intended-action + hash-bind; migration 0015 | — |
| Regulatory | yes | `routes/regulatory.ts` (`:94`) → `apps/api/src/regulatory/` | IMPLEMENTED_FOUNDATIONAL_CONTROL | PR-R1..R9 registries + workflows; **evidence only, not runtime enforcement** (see §5) | — |

Workroom Phases 5 (tool invocations), 6 (UI), 7 (external autonomous agents) are `DOCUMENTED_TARGET_ONLY`. A workroom **mode-downgrade approval** flow is designed but its route is not exposed (partial).

---

## 2. Provider-native layer

Proven by the raw-body + response harness (`packages/provider-*/src/routes/register-passthrough.raw-body.test.ts`, `response-headers.test.ts`) and mapped in [specs/h1v2-coverage-map.md](./specs/h1v2-coverage-map.md) (versioned in main; PRs #81/#82/#83/#84/#86/#87).

| Capability | Status | Evidence | Remaining follow-ups |
|---|---|---|---|
| OpenAI raw-body preservation | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-OAI byte-for-byte (`Buffer.compare===0`) | — |
| Anthropic raw-body preservation | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-ANT byte-for-byte | — |
| `native_request_hash` over original bytes | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | RB-OAI/RB-ANT hash === sha256(sent)===sha256(captured) | — |
| `body_forward_mode:"raw"` | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | asserted with byte equality | — |
| Valid-tools pass-through (allowed) | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | PR #87 — `function` (OpenAI) / `client_defined` (Anthropic) allowed + forwarded byte-for-byte | — |
| Invalid-tools block | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | 403 + `tool.validation_blocked` | — |
| Unknown/future fields preserved | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | `z_unknown_field` / `experimental_array` survive | — |
| Response hop-by-hop filter | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | PR #86 pre-normalization unit + PR #83/#84 downstream + sentinel | downstream HTTP assertion of keep-alive/transfer-encoding/content-length is runtime-owned (documented, non-blocking) |
| Malformed JSON forwarded | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | byte-for-byte; provider 4xx relayed | — |
| Streaming detection (top-level `stream`) | IMPLEMENTED_PROVIDER_NATIVE_EVIDENCE | nested-negative + top-level-positive | — |
| gzip / `Content-Encoding` policy | PLANNED | spec §12/§15 follow-up | non-blocking policy gap |
| Anthropic multipart route-level | PLANNED | spec §9/§15 follow-up | OpenAI multipart covered |
| `stream_final_hash` hash-over-bytes correctness | PLANNED | presence asserted; correctness not proven | non-blocking hardening |

---

## 3. Audit and Evidence Plane

| Item | Status | Evidence |
|---|---|---|
| Audit chain baseline (HMAC-chained, append-only) | IMPLEMENTED_RUNTIME | `packages/core-audit/src/append.ts`; `migrations/0001_audit_chain.sql` (`previous_hmac`); ADR-009 (3-layer defense-in-depth) |
| Crypto-shred / right-to-erasure | IMPLEMENTED_FOUNDATIONAL_CONTROL (design + state) / PLANNED (admin route) | ADR-011 accepted; `crypto_shredded` state in migration 0001; **admin route is a stub** (`admin-audit-shred.ts:41`, PR3) |
| B0 — capture outbox foundation | IMPLEMENTED_FOUNDATIONAL_CONTROL | `migrations/0025_audit_capture_outbox_foundation.sql`: `audit_capture_chain_state`, `audit_capture_outbox`, `audit_event_capture_refs`; 4 SECURITY DEFINER fns; state machine captured→sealing→sealed/failed; RLS FORCE |
| B1 — `captureAuditEvent` | IMPLEMENTED_FOUNDATIONAL_CONTROL | `packages/core-audit/src/capture.ts` — validated adapter that writes a capture to the outbox under the caller's transaction; idempotent via capture_id + chain_state lock |
| B2 — sealer **library** | IMPLEMENTED_FOUNDATIONAL_CONTROL | `packages/core-audit/src/sealer.ts` — `claim/build/markSealed/markFailed/sealNextAuditCapture`; **one-shot primitives, no loop, no process, no `SET ROLE`** |
| B3 — sealer **runner** | DOCUMENTED_TARGET_ONLY / BLOCKED_BY_DECISION | No `apps/audit-sealer`; no claim/seal loop; no call sites in `apps/`. ADR-020 Draft; runner blocked on the B3 decision pack (ADR-022..026 acceptance + idempotency decision) |
| Append/seal idempotency | IMPLEMENTED (capture+seal) / BLOCKED_BY_DECISION (append-per-capture key) | capture_id UNIQUE + chain_state lock; `markAuditCaptureSealed` idempotent for same `audit_event_id`. ADR-023 leaves the **explicit append idempotency key** for B3 to introduce or to document why existing state guarantees it |
| Stale-sealing recovery | DOCUMENTED_TARGET_ONLY | ADR-023; not implemented (B3 owns it) |
| Evidence completeness (captured/sealed/failed counts, provider-without-audit) | PLANNED | B0 stores raw data (`attempts`, `last_error`, timestamps); no reporting/metrics/query layer yet |

---

## 4. Governance and policy

| Item | Status | Evidence / note |
|---|---|---|
| Capability registry (code-defined facets, default-deny) | IMPLEMENTED_RUNTIME | `@govai/core-governance`; ADR-004 |
| Org override downgrade resolver | IMPLEMENTED_RUNTIME | `@govai/core-governance` override resolver |
| `/v1/runs` governed mode | IMPLEMENTED_RUNTIME | `run-orchestrator.ts` (`executeGovernedRun`) |
| `/v1/runs` passthrough mode | IMPLEMENTED_RUNTIME | `run-orchestrator.ts` (`executePassthroughRun`); ADR-002/003 |
| DLP pre-scan (scan-only) | IMPLEMENTED_RUNTIME | `@govai/dlp-br` over concatenated text in governed surfaces; "we do not redact" |
| Policy decision persistence | IMPLEMENTED_FOUNDATIONAL_CONTROL | beta-policy gate emits `passthrough.beta_denied`; decisions audited |
| Workroom approval override (passthrough) | IMPLEMENTED_RUNTIME | `workroom-approvals.ts` binds an approved intended-action hash to a workroom passthrough run |
| Hard-deny runtime enforcement (regulatory) | DOCUMENTED_TARGET_ONLY | beta-policy **does** 403 at the provider surface, but the regulatory prohibited-use / high-risk / agent hard-deny-floor are **evidence only** — no runtime gateway blocking (see §5) |

---

## 5. Regulatory Core

PR-R1..R9 are LIVE but are **governance evidence primitives**: they record classifications/reviews/determinations; they do **not** block execution or enforce at runtime.

| Capability | Current status | Evidence | Runtime enforcement? | Product maturity | Next step |
|---|---|---|---|---|---|
| Regulatory Source Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0016; `regulatory/service.ts`; tests | no | source versioning live; change/diff engine future | source change monitor |
| Unified Control Catalog | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0016 | no | CRUD + framework mapping | drift detection |
| AI System Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0017 | no | inventory + lifecycle events | — |
| Provider Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0018 | no | posture inventory (not the credential vault) | — |
| Model Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0019 | no | identity/version/provenance metadata | — |
| Agent Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0020 | no | `hard_deny_floor_expected` is a declared expectation, **not** enforced | wire to runtime later |
| Use-case Registry | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0021 | no | purpose/ownership/jurisdiction evidence | — |
| Risk Classification Engine | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0022; `service.ts::classifyRisk` | no | deterministic tier+score+factors; mitigation does not downgrade | — |
| High-risk Review Workflow | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0023; SoD | no | APPROVED = governance evidence, **not** runtime authorization | bind to execution (future) |
| Prohibited-use Governance Workflow | IMPLEMENTED_FOUNDATIONAL_CONTROL | migration 0024; SoD | no | DENIED = evidence, **not** a runtime block | runtime gateway (future) |
| Sensitive Data taxonomy/detectors | IMPLEMENTED_FOUNDATIONAL_CONTROL | `@govai/dlp-br` SD1 (4 detectors of a 22-category taxonomy) + SD2A (financial/health signal detectors) | no | advisory `recommended_action` only; no persistence/UI | SD persistence + policy binding |
| CNJ/Sinapses readiness | DOCUMENTED_TARGET_ONLY | regulatory/25-cnj-sinapses-readiness.md | no | required-native-capability + external deps | — |
| Certification/readiness dossiers | DOCUMENTED_TARGET_ONLY | regulatory/22-certification-and-audit-readiness.md | no | audit-readiness model; dossiers not generated | — |

The README and regulatory docs explicitly disclaim LGPD/judicial/legal/medical/financial/ISO/NIST/EU-AI-Act compliance, certification, or court admissibility. This document makes no compliance claim.

---

## 6. Known stale docs

Summarized in [stale-docs-register.md](./stale-docs-register.md). Headlines: README status block (Phase 1 / "501"), `workroom-governance-room.md` ("no runtime implementation yet"), and ADR-020 (role-model open question, resolved by ADR-022). All three are addressed minimally in the same PR that creates this document; ADR-022..026 acceptance is a separate B3 decision-pack PR.

---

## 7. Current non-negotiables

- **Provider-native semantics are sacred.** No re-serialization, no hidden defaults/caps/remaps, no schema narrowing on the native surface.
- **B3 is not authorized.** The AuditSealer runner must not be built until the B3 decision pack (ADR-022..026) is accepted and the append/seal idempotency strategy is resolved.
- **No provider traffic in the AuditSealer.** The sealer never sits on the provider hot path (ADR-020/021/024).
- **Evidence failure is evidence-plane health, not provider UX failure** for low-risk traffic (ADR-022).
- **No runtime hard-deny claim** unless implemented and tested. Regulatory prohibited-use/high-risk/agent hard-deny-floor are evidence-only today.
- **No compliance/legal/certification claim** unless validated externally.
