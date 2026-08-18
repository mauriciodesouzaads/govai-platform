# ADR Index

Generated from the actual `docs/architecture/adr/` tree at the Foundation V1 documentary
freeze (EP-FOUNDATION-V1-M3, 2026-08-18; runtime anchor
`de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68`). **Filesystem counts are authoritative** —
regenerate this index when the directory changes; do not infer a status from a file's
presence, and do not create files to fill numeric gaps.

- ADR files present: **31** (ADR-001..014, ADR-016..032). Absent number: **ADR-015**.
- Status vocabulary used here: `Accepted` (owner/repository decision in force),
  `Accepted (baseline)` (PR1-era baseline decisions), `Accepted as target decision`,
  `Accepted as doctrine`, `Candidate target architecture`, `Historical precursor`,
  `Proposed` (not accepted; text may be reconciled), `Superseded in part`.
  "Authority" = the documentary authority class recorded in the file's header
  (M3 promulgation standard) or the class implied by its status.

## Numbering history (source-adjudicated)

- **ADR-015 — never created.** The PR2 canonical/execution documents reserved ADR-015
  for a conditional *prompt-caching* beta decision and cancelled it by default
  ("ADR-015 cancelado por default"; `ADR-014-allow-files-beta.md:80` "ADR-015
  (prompt-caching) … não são gerados"). The number is **reserved / cancelled**; no file
  exists and none is required.
- **ADR-016 — number reused (documented).** The same PR2 documents conditionally
  reserved ADR-016 for a *message-batches* global-allowlist decision that was
  never taken ("ADR-016 NÃO criado — Batch D deferred"; the beta entry
  `message-batches-2024-09-24` remains `verification_required` in
  `packages/provider-anthropic/src/beta-policy.ts`, whose comment still mentions
  that conditional ADR-016). No such file was ever created. The file that now
  carries the number, `ADR-016-governance-kernel.md`, is the **v0.9 corpus
  Governance Kernel ADR** promulgated by M3 — a different subject. Any future
  message-batches decision must take a NEW number; do not read the
  `beta-policy.ts` / PR2 mentions as references to the Governance Kernel ADR.
- **ADR-016..019** — promulgated by M3 from the owner-supplied v0.9 architecture
  package (D1–D4). **ADR-029..031** — promulgated by M3 from the PR-0 document tree
  (D9/D10). **ADR-032** — promulgated by PR #125, implemented by PR #126 (EP-11).
- The headings "ADR-016 — Tier-based enforcement … ADR-019 — Operational Modes" in
  `docs/architecture/canonical/govai_adp_v4_2.md` §(ADRs) are the ADP v4.2 document's
  own internal decision list (homonyms), NOT references to the files below.

## Index

| # | File | Title | Status (as written in the file) | Authority / notes |
|---|---|---|---|---|
| 001 | `ADR-001-run-as-central-unit.md` | Run é a unidade central, não Chat | Accepted (baseline) | baseline decision |
| 002 | `ADR-002-dual-mode.md` | Dois modos de operação | Accepted (baseline) | baseline decision |
| 003 | `ADR-003-provider-native.md` | Provider-native, sem abstração lossy | Accepted (baseline) | baseline decision; doctrine later strengthened by ADR-021 |
| 004 | `ADR-004-capability-registry-facets.md` | Capability registry com facets, code-defined | Accepted (baseline) | baseline decision |
| 005 | `ADR-005-levels-and-evidence-strength.md` | Governance levels + evidence_strength ortogonal | Accepted (baseline) | baseline decision |
| 006 | `ADR-006-zero-public-placeholders.md` | Zero placeholders públicos | Accepted (baseline) — com nota honesta | baseline decision (two admin routes remain not-implemented stubs, see current-state §1) |
| 007 | `ADR-007-real-infra-from-day-one.md` | Real infrastructure desde commit 1 | Accepted (baseline) | baseline decision |
| 008 | `ADR-008-kms-correct-from-start.md` | KMS correto desde o início | Accepted (baseline) | baseline decision; AWS KMS adapter shipped |
| 009 | `ADR-009-audit-chain-defense-in-depth.md` | Audit chain é fundação, com defense-in-depth | Accepted (baseline) | baseline decision |
| 010 | `ADR-010-otel-not-audit.md` | Observability não substitui audit | Accepted (baseline) | baseline decision |
| 011 | `ADR-011-right-to-erasure.md` | Right-to-erasure compatível com append-only | Accepted (baseline) | baseline decision; admin crypto-shred route still a stub |
| 012 | `ADR-012-cost-attribution-source.md` | Cost attribution com procedência | Accepted (baseline) | baseline decision |
| 013 | `ADR-013-node-24-install.md` | Node 24 instalado on-the-fly no início da execução | Accepted (baseline, decisão automática) | baseline decision |
| 014 | `ADR-014-allow-files-beta.md` | Allow `files-api-2025-04-14` em ANTHROPIC_BETA_POLICY como global_allowlist | Accepted | PR2 beta decision; NOT edited by M3 (its "ADR-015/ADR-016 não são gerados" note is the numbering history above) |
| 015 | — (no file) | — | reserved / cancelled | never created (see numbering history) |
| 016 | `ADR-016-governance-kernel.md` | Governance Kernel | Candidate target architecture (M3 / D1) — originally Proposed 2026-05-27 | CANDIDATE_TARGET_ARCHITECTURE; NOT implemented (no `packages/governance-kernel`) |
| 017 | `ADR-017-audit-bridge-evidence-plane.md` | Audit Bridge and Evidence Plane | Historical precursor (M3 / D2 Option A) — originally Proposed 2026-05-27 | HISTORICAL_PRECURSOR; superseded in implementation detail by ADR-027/028 + AuditBridge/B3 |
| 018 | `ADR-018-seven-planes-ai-trust-layer.md` | Seven-Plane GovAI AI Trust Layer | Accepted as architectural doctrine (M3 / D3) — originally Proposed 2026-05-27 | ACCEPTED_ARCHITECTURAL_DOCTRINE; plane implementation status per current-state |
| 019 | `ADR-019-provider-identity-model.md` | Provider Identity Model | Accepted as target decision (M3 / D4) — originally Proposed 2026-05-27 | ACCEPTED_TARGET_DECISION; P2.7 arbitrary-provider expansion NOT implemented |
| 020 | `ADR-020-audit-sealer-runtime-model.md` | AuditSealer Runtime Model | Superseded in part by ADR-022–026; B3 implemented in EP-006 | historical runtime model |
| 021 | `ADR-021-provider-native-experience-preservation.md` | Provider-Native Experience Preservation Doctrine | **Accepted** (M3, `ADR021_FINAL_STATUS=ACCEPTED`) — originally Proposed | ACCEPTED doctrine; proven scope = registered lanes + M2/M2A executed acceptance; B3-gate wording historical |
| 022 | `ADR-022-audit-sealer-runtime-role-model.md` | AuditSealer Runtime Role Model | Accepted — design constraint | implemented by EP-006 (status line's "future B3" wording is pre-EP-006) |
| 023 | `ADR-023-stale-sealing-recovery-strategy.md` | Stale Sealing Recovery Strategy | Accepted — Option A(b) implemented/tested (PR #92) | implemented (EP-006 stale-recovery path) |
| 024 | `ADR-024-backpressure-and-claim-loop-control.md` | Backpressure and Claim-Loop Control | Accepted — design constraint | implemented by EP-006 |
| 025 | `ADR-025-health-checks-metrics-observability.md` | Health Checks, Metrics, and Observability for AuditSealer | Accepted — design constraint | implemented by EP-006 / EP-OBS-* |
| 026 | `ADR-026-dedicated-audit-sealer-deploy-unit.md` | Dedicated AuditSealer Deploy Unit Lifecycle | Accepted — design constraint | implemented by EP-006 + EP-SEALER-DEPLOY (PR #117) |
| 027 | `ADR-027-runtime-to-evidence-dispatch.md` | Runtime-to-evidence dispatch / AuditBridge | Accepted as design constraint (status line still says "not implemented, not tested" — pre-EP-004 wording); superseded in part by ADR-028 | IMPLEMENTED by PR-B / EP-004 (see current-state §3); the stale status wording is registered in stale-docs-register.md, not edited by M3 |
| 028 | `ADR-028-direct-route-request-identity-and-idempotency.md` | Direct-route request identity and AuditBridge capture idempotency | Accepted | implemented (PR-B / EP-004; F4 hardening PR #120) |
| 029 | `ADR-029-two-speed-surfaces.md` | Two-speed surfaces: provider-native and agnostic | **Proposed** (status preserved; text reconciled by M3 / D9) | DOCTRINE_CANDIDATE — acceptance not adjudicated |
| 030 | `ADR-030-standalone-and-integrated.md` | Standalone-and-integrated doctrine | **Proposed** (status preserved; text reconciled by M3 / D9) | DOCTRINE_CANDIDATE — acceptance not adjudicated |
| 031 | `ADR-031-coding-agent-surface.md` | Coding agents (Claude Code / Codex) as a first-class governed surface | **Accepted** (M3 / D10) — originally Proposed | ACCEPTED doctrine; Decision 2 (default-deny betas) superseded by M1; deliverables NOT implemented; validated only in the executed M2/M2A lanes |
| 032 | `ADR-032-openai-files-purpose-provider-truth.md` | OpenAI Files `purpose=assistants`: provider-truth correction | Accepted; `IMPLEMENTATION_STATUS=COMPLETE` (EP-11 / PR #126) | implemented; interim wording historical |

## Status counts (from the table above)

- Accepted family (baseline / accepted / accepted as doctrine or target decision / design constraint / superseded-in-part): **27** — ADR-001..014 (14) + ADR-018, 019, 020, 021, 022, 023, 024, 025, 026, 027, 028, 031, 032 (13). ADR-020 ("Superseded in part") is counted in this family.
- Candidate target architecture: **1** (ADR-016)
- Historical precursor: **1** (ADR-017)
- Proposed (not accepted): **2** (ADR-029, ADR-030)

27 + 1 + 1 + 2 = **31** files; ADR-015 has no file.
