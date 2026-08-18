> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** DOCTRINE_CANDIDATE (Proposed — acceptance not adjudicated by M3)
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; drafted 2026-06)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D9=UPDATE_NOW_AGAINST_IMPLEMENTED_PROVIDER_TRUTH)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled + bounded 'M3 reconciliation' section appended; body otherwise byte-preserved incl. the PR-0 header)
> **SOURCE_SHA256:** `5bfe7be250c8a9862d41c1012b94ecadd4e531988ca00c3aa3d8c59e72130fe7` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** DOCTRINE CANDIDATE — status PRESERVED as **Proposed** (D9 authorized text reconciliation only; acceptance NOT adjudicated by M3; the PR-0 header instruction below was never executed and is retained as history). Reconciled: item 5 ("interrupts only when the hard-deny floor or an approval requirement demands it") is consistent with the Foundation V1 native contract where, on the Native/Audited surface, the hard-deny floor is exactly provider-hosted computer-use (M1 OD-1=A, ADR-021 Accepted) — no broader default-deny is current; the "parity harness guards the second half" clause is realized by the H1 v2 harness plus the M1 native-contract suites and the M2/M2A live acceptance. Connector/ingestion provenance labeling remains TARGET (no connector or Shadow AI ingestion exists). See the "M3 reconciliation" section appended at the end.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** PROPOSTA → aceite do dono registrado neste PR
> **BASE DECLARADA PELO DOCUMENTO:** — · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Standalone-e-integrada; proveniência rotulada; validada pelo estudo de mercado (Dossiê §3.2).
> **ORIGEM:** handoff 06-adr-030-standalone-and-integrated.md (renomeado)
> ---

# ADR-030 — Standalone-and-integrated doctrine

Status: Proposed (drafted 2026-06; for acceptance review by Maurício). M3 (2026-08-18): status PRESERVED — acceptance not adjudicated; text reconciled (D9), see "M3 reconciliation" below.

## Context

- `00-philosophy-and-positioning.md` already states that GovAI "democratizes
  enterprise-grade governance for smaller companies" and "unifies evidence
  for larger enterprises" over existing platforms, and that GovAI
  "integrates, it does not compete".
- Roadmap Phase 8 already names the integration targets (ServiceNow,
  OneTrust, BigID/Securiti, M365/Google, SIEM/SOAR, AWS/Azure/GCP, legal/
  judiciary connectors) with the rule "connectors enrich; they are not the
  governance source of truth".
- The founder's formulation (2026-06) sharpens this into a product law:
  **"GovAI must be complete standalone and powerful when integrated."**
  GovAI must work alone — with native controls — for customers that have no
  Purview, OneTrust, ServiceNow, AWS/Google governance, BigID, or Securiti;
  and when those systems exist, GovAI must integrate, ingest, normalize,
  correlate, govern, evidence, and report over them.

## Decision

1. **Standalone completeness is a release gate.** No GovAI capability may
   *require* a third-party GRC/DSPM/ITSM system to deliver its core value.
   Connectors may enhance a capability; they may never be its only path.
2. **Ingestion with provenance.** External evidence enters the platform only
   through the normalization layer with mandatory provenance labels (the
   runtime analogue of the doc-side source-quality labels in
   `15-source-register.md` / `18-competitive-benchmark.md`):
   `self_reported | customer_log_export | connector_pull | vendor_attested |
   inferred`, mapped onto the evidence-strength ladder (e.g.
   `external_unverified` until verified). External evidence is **labeled,
   never silently merged** with GovAI-generated evidence.
3. **Precedence.** For actions executed through GovAI surfaces, the GovAI
   chain is authoritative. For actions observed only via external systems,
   GovAI reports them *as observed via X with strength Y* — it does not
   assert them as governed.
4. **Reciprocity (export side).** Integration is bidirectional by design:
   GovAI also exports — work items into ServiceNow/Jira, findings into
   SIEM, readiness summaries into OneTrust-class platforms — so that
   customers with incumbent stacks experience GovAI as a correlation and
   evidence layer, not a silo. Export artifacts carry chain references so
   anything exported remains verifiable against GovAI.
5. **Ambient governance restated as a testable invariant** (from
   `governance-philosophy.md`, confirmed as doctrine): the user uses AI
   normally; GovAI captures context and evidence, classifies risk,
   interrupts only when the hard-deny floor or an approval requirement
   demands it, creates a work item when review is needed, and feeds
   readiness/reporting without user-visible friction. Both halves bind:
   *interrupting when required* and *not interrupting when not required* are
   each release criteria (parity harness guards the second half).

## Consequences

- Shadow AI v1 (spec 03) and the connector framework (Phase 8) inherit the
  provenance enum and the labeled-never-merged rule.
- The Evidence Bundle and persona cockpits must render provenance and
  strength visibly — an auditor can always distinguish "GovAI governed this"
  from "GovAI observed this via a connector".
- Sales posture follows architecture: standalone for the mid-market,
  correlation layer for the enterprise — one codebase, two motions.

## Non-goals

No connector implementation; no change to Phase 8 scope; no claim that any
external system's records become GovAI evidence without labeling.

## M3 reconciliation (2026-08-18, Foundation V1 anchor `de80664a`)

- **Item 5, "interrupting when required":** on the Native/Audited surface the
  runtime hard-deny floor is exactly provider-hosted computer-use (M1
  OD-1=A; ADR-021 Accepted). Unknown/unresolved betas and non-computer tools
  are forwarded and observed, never silently discarded; the governed surface
  applies only the `blocked` outcome of the enforcement matrix, and exposes
  recommendation vs applied honestly over HTTP (`x-govai-enforcement-decision`
  / `x-govai-enforcement-applied`). Phase 5 ask/sandbox/enforce primitives are
  NOT implemented — "interrupting when required" is currently realized as
  explicit 403 blocks with durable blocked v4 evidence, nothing more.
- **"Not interrupting when not required":** guarded by the H1 v2 harness, the
  M1 native-contract suites and the M2/M2A live acceptance (real Anthropic +
  OpenAI, official SDKs, Claude Code and Codex CLI through GovAI).
- **Items 2–4 (ingestion provenance, precedence, export reciprocity):**
  TARGET — no connector framework, Shadow AI ingestion or export pipeline
  exists at this anchor. The provenance vocabulary that DOES exist in source is
  `packages/dlp-br/src/sensitive-provenance.ts` (`SensitiveDataSourceQuality`
  + `decideSourcePrecedence`), which the target specs map onto.
- **Status:** remains Proposed. Its acceptance is a separate owner decision;
  this reconciliation changes text only.
