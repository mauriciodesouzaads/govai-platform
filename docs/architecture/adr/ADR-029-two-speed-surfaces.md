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
> **SOURCE_SHA256:** `b9184ad380d62d9725df1436b19d7b5f92adeffce7383fee2aab2e2037fe569e` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** DOCTRINE CANDIDATE — status PRESERVED as **Proposed** (D9 authorized text reconciliation against implemented provider truth only; acceptance was NOT adjudicated by M3 — the PR-0 header instruction below to flip the status on merge was never executed because PR-0 was superseded by this movement, and it is retained as history). Reconciled: the "Non-goals" line "no claim that the AuditBridge is implemented" is historical — the AuditBridge IS implemented and wired on the four direct routes (PR-B / EP-004) and the B3 sealer runner exists (EP-006). Nothing in this ADR legitimizes silently discarded local decisions: at the Foundation V1 anchor every Native/Governed pre-provider block emits a durable blocked `passthrough.invoked` v4 capture (403, `body_forward_mode='blocked'`), the Native surface forwards unknown betas / non-computer tools with observed evidence (M1, ADR-021 Accepted), and the only local outcome without a durable v4 event is provider-credential-unresolvable (502, structured log — registered residual, see `foundation-v1-freeze.md`). See the "M3 reconciliation" section appended at the end.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** PROPOSTA → aceite do dono registrado neste PR (mudar Status interno para Accepted com data ao mergear)
> **BASE DECLARADA PELO DOCUMENTO:** — · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Doutrina dos dois planos; a convergência DLP deny-primeiro (Mapa §6 Fase 1) realiza a 'unity at verification'.
> **ORIGEM:** handoff 05-adr-029-two-speed-surfaces.md (renomeado ao padrão ADR-###)
> ---

# ADR-029 — Two-speed surfaces: provider-native and agnostic

Status: Proposed (drafted 2026-06; for acceptance review by Maurício). M3 (2026-08-18): status PRESERVED — acceptance not adjudicated; text reconciled against implemented provider truth (D9), see "M3 reconciliation" below.

## Context

- GovAI operates two runtime surface families today, source-verified:
  1. **Provider-native surfaces** — direct passthrough and governed-native
     routes for Anthropic and OpenAI, engineered for byte-for-byte fidelity
     (H1 v2 harness) so users keep a 100% native experience.
  2. **Agnostic surface** — `/v1/runs`, originally a legacy path, repurposed
     as the seed of a provider-agnostic execution surface for open-source and
     private models, workflows, and experimentation, deliberately isolated
     from the native path.
- The two families also differ on the evidence axis: `/v1/runs` is
  chain-authoritative via synchronous `auditAppend` (ADR-027 §"/v1/runs
  relationship"), while direct routes feed the B0/B1 capture outbox
  asynchronously via the AuditBridge (ADR-027/028).
- External review (2026-06-11) initially flagged this duality as debt. The
  product rationale — confirmed by the founder — is intentional: the native
  surface must never pay latency or regression risk for governance plumbing;
  the agnostic surface can afford strong-consistency evidence and absorbs
  experimentation without endangering native parity.

## Decision

1. The duality is **doctrine, not debt**. GovAI maintains two runtime surface
   families with different latency/consistency budgets:
   - *Native*: fidelity-first; evidence is captured asynchronously
     (AuditBridge → outbox → sealer); `best_effort` capture posture by
     default (ADR-028 §9); zero added friction for permitted traffic.
   - *Agnostic*: flexibility-first; evidence may be written synchronously to
     the chain; new model classes, workflows, and execution semantics land
     here first.
2. **Duality at ingestion, unity at verification.** Both families MUST
   converge on: the same chain format and canonicalization, the same
   `verify` tooling, the same evidence-strength vocabulary, and the same
   reporting/Evidence Bundle layer. A customer asking "prove what happened"
   receives one answer, regardless of surface.
3. Graduation rule: a capability proven on the agnostic surface may be
   promoted to a native-style surface only with its own fidelity evidence
   (harness) and capability-registry entries. Promotion is a PR + ADR-level
   decision, never an implicit drift.
4. `/v1/runs` is not migrated to the outbox by this ADR; any future
   unification requires its own decision (consistent with ADR-027).

## Consequences

- Future reviewers and auditors have a citable rationale for the two
  evidence ingress paths; "why two paths?" is answered by doctrine.
- Reporting and verification layers must be built surface-agnostic from the
  start (constraint on WS1 Phase 4 work).
- The agnostic surface is the designated home for open/self-hosted model
  adapters; the native allowlist stays small and proven.

## Non-goals

No code; no route changes; no `/v1/runs` migration; no claim that the
AuditBridge is implemented (tracked separately).

## M3 reconciliation (2026-08-18, Foundation V1 anchor `de80664a`)

- **AuditBridge / B3 status (supersedes the "Non-goals" wording above):** the
  AuditBridge is implemented and wired on the four direct provider routes
  (PR-B / EP-004, `apps/api/src/pipeline/audit-bridge.ts`), captures land in
  `govai.audit_capture_outbox`, and the B3 sealer runner (`apps/audit-sealer`,
  EP-006) seals them into the HMAC chain. Native = asynchronous `best_effort`
  capture; `/v1/runs` = chain-authoritative via `auditAppend` (P0.3-A durable
  dispatch layer). The two-speed doctrine described above matches the merged
  runtime.
- **No class-wide silent discard of local decisions:** at this anchor every
  Native/Governed pre-provider block (provider-hosted computer-use floor,
  `hard_denied` beta, governance matrix `blocked`) emits a durable blocked v4
  `passthrough.invoked` capture (HTTP 403, `enforcement_decision='blocked'`,
  `body_forward_mode='blocked'`, `credential_source='not_resolved_pre_provider_block'`);
  unknown/unresolved betas and non-computer tools are forwarded and observed
  (hashed markers / classifications in the v4 event; M1, ADR-021 Accepted,
  ADR-032/EP-11). The one known local outcome without a durable v4 event is
  provider-credential-unresolvable (HTTP 502 + structured log; registered
  residual R4 in `docs/architecture/foundation-v1-freeze.md`).
- **Status:** remains Proposed. Its acceptance is a separate owner decision;
  this reconciliation changes text only.
