> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_TARGET_DESIGN
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; drafted 2026-06)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D11=ACCEPT_AS_TARGET_DESIGN)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (body status line normalized; body otherwise byte-preserved incl. the PR-0 header)
> **SOURCE_SHA256:** `5ed164e17d212d4d5fa9679c5692119428a239a7c51b7a5d827b76841eb721ba` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED AS TARGET DESIGN (D11) — ONE status: *Accepted as target design; NOT implemented*. The PR-0 header's "ACEITA — NÃO IMPLEMENTADA (SPEC_ACCEPTED)" and the former body status `PROPOSED_MODULE_SPEC` were contradictory; the body status line is normalized below (bounded edit) and no other body text is changed. Nothing in this spec exists in the runtime at the Foundation V1 anchor (no `/v1/shadow/*` routes, no `shadow_ai_*` tables). Depends on the implemented AuditBridge (WS1 delivered) and on Phase 5 enforcement (not implemented). Elevates `docs/contracts/shadow-ai.md` in intent only — that contract file is untouched by M3.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** ACEITA — NÃO IMPLEMENTADA (SPEC_ACCEPTED)
> **BASE DECLARADA PELO DOCUMENTO:** main pós-e8aa632 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Escopo de descoberta re-calibrado pelo mercado (7 camadas de sinal; claims: Mapa §5.2-C2 e Dossiê §3); elevará docs/contracts/shadow-ai.md (edit E7).
> **ORIGEM:** handoff 03-spec-shadow-ai-v1.md
> ---

# SPEC — Shadow AI module v1

Status: `ACCEPTED_TARGET_DESIGN` — accepted as target design (M3 / owner decision D11, 2026-08-18; formerly `PROPOSED_MODULE_SPEC`), NOT implemented — elevates `docs/contracts/shadow-ai.md`
(currently a stub; `Run.mode = 'shadow'` is reserved in the schema per that
contract). Depends on AuditBridge/WS1 for evidence-grade observations and on
WS4 for disposition work items. Market grounding (2026-06 research): 80% of
orgs report moderate-to-pervasive shadow AI with only 25% having visibility;
47% of GenAI users go through personal accounts; sanctioned alternatives cut
unauthorized use by ~89% — which is why this module's differentiator is the
**discovery → regularization → governed-surface migration loop**, not
detection alone.

## 1. Product shape

Inputs: customer-supplied telemetry exports and self-reports (v1 is
push/import; pull connectors arrive with the Phase 8 connector framework).
Outputs: a tenant-scoped AI-usage inventory with risk classes, disposition
workflow (work items + approvals), evidence on the chain, and a section in
the Evidence Bundle / persona cockpits (TI: exposure; DPO: data classes;
Auditor: disposition trail).

## 2. Explicit non-goals (v1)

- No endpoint agent, no browser extension, no TLS interception, no packet
  capture. GovAI ingests logs the customer already lawfully possesses.
- No per-employee surveillance product: principals are pseudonymized by
  default (§6). GovAI surfaces *apps and flows*, not people, unless the org
  explicitly enables identified mode under its own legal basis.
- Not a CASB replacement; no blocking at the network layer (disposition
  `blocked` is a decision record + optional export to the customer's
  SWG/IdP, not enforcement by GovAI).

## 3. Ingestion sources (v1 source classes)

| `source_type` | Examples | Signal |
|---|---|---|
| `idp_oauth_grants` | Entra ID / Okta / Google Workspace app-grant exports | Highest precision: which AI apps have org-account consent |
| `gateway_logs` | SWG/DNS/firewall exports (Netskope, Zscaler, generic CSV) | Breadth: domains/categories hit, volumes |
| `saas_audit_logs` | M365 / Google Workspace audit (embedded AI features: Copilot, Gemini) | Covers the "AI inside sanctioned SaaS" majority case |
| `spend_data` | Finance/SaaS-spend CSV | Paid tools invisible to network logs |
| `self_report` | In-product register + amnesty-window form | Cultural signal; cheapest |

v1 transport: `POST /v1/shadow/observations` (authenticated, bulk ≤ 1000 per
batch, NDJSON or JSON array) + CSV import via the same normalizer. Each batch
carries a client-supplied `batch_id`; ingestion is idempotent via
`UUIDv5(SHADOW_BATCH_NAMESPACE, "org:{org_id}:batch:{batch_id}")` keyed
storage, mirroring the AuditBridge identity doctrine.

## 4. Data model (new migration; all tables RLS `ENABLE + FORCE`)

```
govai.shadow_ai_observations  (append-only; UPDATE/DELETE/TRUNCATE-blocking
                               triggers, same pattern as workroom timelines)
  id uuid PK, org_id uuid, batch_id uuid, source_type enum (§3),
  observed_at timestamptz, app_key text,            -- normalized catalog key
  category text,                                    -- chat|code_assistant|embedded_saas|api|agent|unknown
  principal_hash bytea NULL,                        -- §6 pseudonym, never raw
  metric jsonb,                                     -- counts/bytes/events, schema-validated
  provenance enum: self_reported|customer_log_export|connector_pull|inferred,
  confidence numeric(3,2), payload_hash bytea, created_at

govai.shadow_ai_assets        (mutable aggregate, one row per org+app_key)
  id, org_id, app_key, category, first_seen, last_seen,
  observation_count, distinct_principals_estimate,
  risk_class enum A..E,                             -- reuse existing classes
  status enum: discovered|under_review|approved_governed|
               tolerated_with_policy|blocked|retired,
  disposition_workroom_task_id uuid NULL,
  disposition_approval_id uuid NULL, updated_at

govai.shadow_ai_catalog       (global, non-tenant seed: app_key → vendor,
  default category, governed_migration_target NULL — e.g. 'openai_native',
  'anthropic_native', 'agnostic_runs', 'coding_agent_surface')
```

Normalizer maps raw rows (domains, app names, grant client-ids) → `app_key`
via the catalog; unmatched rows keep `app_key = 'unknown:<domain-or-name>'`
with `provenance = inferred` and lower confidence.

## 5. Evidence integration (the part that makes this GovAI)

- Every accepted batch produces ONE capture into the B0 outbox via
  `captureAuditEvent`: `eventType 'shadow.observations.batch_recorded'`,
  `eventVersion '1'`, `chainCategory 'policy'`, `subjectType 'shadow_batch'`,
  `subjectId = batch UUID`, `payloadHash = sha256(canonical_json(batch
  manifest))` where the manifest = `{batch_id, source_type, row_count,
  app_key histogram, min/max observed_at}` — never row-level personal data.
- Every asset **status transition** produces a capture
  (`'shadow.asset.disposition'` v1) carrying `{app_key, from, to,
  approval_id?, task_id?}`.
- `evidenceStrength` for shadow captures: `external_unverified` for
  `customer_log_export`/`inferred`, `customer_signed` reserved for future
  signed exports. **Vocabulary note:** if `external_unverified` is not yet in
  the evidence-strength enum, adding it is part of this work and must be
  reflected in `06-evidence-chain-custody.md`.
- `Run.mode = 'shadow'` is used only when a discovered flow is *replayed or
  proxied* through GovAI during migration pilots — not for raw observations.

## 6. LGPD posture (mandatory, not optional)

Shadow AI telemetry is personal data about workers. v1 requirements:
- Module activation requires an org-admin **legal-basis attestation**
  (free-text basis + responsible role), stored and captured as evidence
  (`'shadow.module.enabled'` event). GovAI does not validate the basis; it
  records that the controller asserted one (consistent with the
  shared-responsibility doctrine in `00-philosophy-and-positioning.md`).
- Principals are pseudonymized **before storage**: `principal_hash =
  HMAC-SHA256(k_org_shadow, normalized_principal)` with `k_org_shadow`
  derived via the existing KMS purpose-derivation (new purpose
  `'shadow-pseudonym'`, per-org). Irreversible from GovAI's side; the
  controller can re-derive on their side only by re-submitting a principal.
- Minimization: the observation schema rejects free-text fields; `metric` is
  schema-validated counts only.
- Retention: default 12 months for observations (configurable per org);
  assets persist. Retention deletes observations but never the chain captures
  (manifests contain no personal data).

## 7. Risk scoring v1 (deterministic, explainable)

`risk_class = f(category, data_exposure_flags, auth_mode, catalog defaults)`
— a table, not a model. Examples: `embedded_saas` with org SSO → C;
chat via personal account in a regulated org tier → E pending review. Every
class assignment carries `risk_reasons[]` (mirrors
`risk_escalation_reasons` style). ML scoring is explicitly v2+.

## 8. Regularization workflow

1. Asset reaches `under_review` (manual or auto when class ≥ threshold).
2. GovAI creates a **workroom task** (existing primitive,
   `0013_workroom_messages_tasks_evidence`) in the org's governance
   workroom: "Disposition for {app_key}", carrying the asset snapshot.
3. Disposition is executed through the **existing approvals mechanism**:
   `intended_action_hash = sha256(canonical_json({asset_id, app_key,
   proposed_status, catalog_version}))`; one-time consumption binds the
   decision to exactly that disposition (reuses the TOCTOU-safe pattern from
   `workroom-approvals` / `run-orchestrator` — no new approval code).
4. Terminal statuses: `approved_governed` (with a generated **migration
   plan** when `governed_migration_target` exists — e.g. ChatGPT usage →
   OpenAI native surface onboarding steps; Copilot-style coding usage →
   ADR-031 surface), `tolerated_with_policy` (records the policy reference),
   `blocked` (decision record + optional export artifact for the customer's
   IdP/SWG), `retired`.

## 9. API surface (v1)

- `POST /v1/shadow/observations` (role: `shadow_admin` or `admin`)
- `GET /v1/shadow/assets?status=&risk_class=` (roles: admin, auditor-read)
- `POST /v1/shadow/assets/{id}/review` → creates task (admin)
- `POST /v1/shadow/assets/{id}/disposition` → requires a consumable approval
  id (admin; SoD enforced by the approvals layer)
- `GET /v1/shadow/report` → JSON feeding the Evidence Bundle section

All endpoints follow the existing auth pipeline (`authenticateApiKey` +
RBAC), 501-free at launch (no public stubs — ADR-006 house rule).

## 10. Tests

Schema/normalizer unit tests per source class; batch idempotency (same
`batch_id` re-POST → no duplicates, same capture); RLS isolation (I-test);
append-only defense on observations; pseudonym stability (same principal →
same hash within org, different across orgs); disposition approval consume
(reuse the existing approval test pattern: replay → `approval_already_used`);
manifest contains no banned keys / no principal data (guard test);
catalog-miss path produces `inferred` low-confidence assets.

## 11. Phasing

- v1.0: ingestion + inventory + risk table + report JSON.
- v1.1: dispositions via workroom/approvals + migration plans.
- v1.2: pull connectors (Phase 8 framework) + signed export ingestion
  (`customer_signed` strength).

## 12. Exit criteria

A real export (any §3 class) ingests with provenance; assets aggregate with
risk reasons; one disposition completes end-to-end with an approval consumed
and both captures visible on the chain; LGPD attestation + pseudonymization
verified by tests; report JSON renders in the Evidence Bundle.
