# GovAI Target Control Catalog

## Purpose

This doc defines the target GovAI control catalog that future implementation
PRs must build. It is the architectural bridge from regulatory requirements
(captured in `01-lgpd-anpd-mapping.md`, `04-marco-civil-mapping.md`,
`05-cnj-judiciary-mapping.md`, `08-sector-financial-mapping.md`,
`09-sector-health-mapping.md`, `10-sector-legal-mapping.md`, and future
ISO/NIST/GDPR/EU AI Act docs) to product capabilities GovAI will deliver.

The catalog separates target capability from current implementation. It does
not certify, guarantee compliance, guarantee judicial validity, or assert
admissibility.

## Control catalog principles

- Each control family has a defined target capability, expected evidence,
  and a path to `COVERED` status.
- Each control records its current implementation state using the
  capability taxonomy below.
- Each control is mapped to the regulatory frameworks it serves so that
  movement in one framework can propagate to others.
- No control is marked `COVERED` without concrete repository evidence.
- Future-only capabilities are recorded as `REQUIRED_NATIVE_CAPABILITY`,
  `NATIVE_ENHANCEMENT_REQUIRED`, `CONNECTOR_ENRICHMENT`,
  `EXTERNAL_SERVICE_REQUIRED`, `CUSTOMER_PROCESS_REQUIRED`, or
  `PROFESSIONAL_REVIEW_REQUIRED`.

## Capability taxonomy

| Token | Meaning |
|---|---|
| IMPLEMENTED_FOUNDATIONAL_CONTROL | Existing GovAI primitive backed by concrete repo evidence, may not be a full market-level product capability |
| REQUIRED_NATIVE_CAPABILITY | Must be built natively; external tools cannot be a prerequisite |
| NATIVE_ENHANCEMENT_REQUIRED | GovAI has a primitive but needs production-level depth |
| CONNECTOR_ENRICHMENT | Integrate external systems when present; not required for standalone safety |
| EXTERNAL_SERVICE_REQUIRED | External authority or service is inherently required |
| CUSTOMER_PROCESS_REQUIRED | Requires customer policy, legal decision, or organizational process |
| PROFESSIONAL_REVIEW_REQUIRED | Requires qualified human review (lawyer, DPO, auditor, perito, medical, financial) |
| SOURCE_VERIFICATION_REQUIRED | Source or applicability requires primary-source verification |

## Control lifecycle

- Defined — control specification recorded in this catalog.
- Designed — control mapped to GovAI primitives, schemas, or external
  services.
- Implemented — controls implemented in code and tests, evidence schemas
  recorded.
- Operating — control runs in production with evidence accumulation.
- Reviewed — control reviewed against current regulatory state and updated
  if needed.

## Control ownership and review

- Engineering owns implementation and tests.
- Product owns control definition, framework mapping, and capability state.
- Legal, DPO, and compliance review the regulatory mapping and obligation
  binding.
- Audit reviews the evidence sufficiency and dossier completeness.
- Customer owns its own policies, legal-basis decisions, and final
  acceptance of GovAI's controls in its environment.

## Control drift and regulatory re-review

- Control records must be re-reviewed when the regulatory source register
  records a change for a bound source.
- A control marked `COVERED` may be demoted to `PARTIAL`, `GAP`, or
  `NEEDS_SOURCE_VERIFICATION` based on regulatory change.
- Movement between states must be reflected in commit history.
- Drift detection is described in `21-regulatory-intelligence-operating-model.md`.

## How controls move from REQUIRED to IMPLEMENTED to COVERED

- `REQUIRED_NATIVE_CAPABILITY` becomes `IMPLEMENTED_FOUNDATIONAL_CONTROL`
  when the underlying primitive is implemented in code with tests.
- `IMPLEMENTED_FOUNDATIONAL_CONTROL` becomes `COVERED` in a mapping doc
  only when concrete evidence (file path, schema, route, event, test) ties
  the primitive to a specific regulatory requirement.
- A `CONNECTOR_ENRICHMENT` decision never makes a control `COVERED` alone;
  it complements a native control.
- An `EXTERNAL_SERVICE_REQUIRED` dependency cannot turn a control
  `COVERED` on its own; it complements native readiness.

## Control domains

The catalog is organized into 21 control domains. Each domain section
captures the target, evidence, frameworks, current state, and the criteria
under which the control turns `COVERED`.

### 1. Governance and accountability

- Target controls: AI-governance policy, accountability roles, oversight
  evidence, escalation paths.
- Native target: tenant-scoped policy records, role assignments, oversight
  task logs, escalation events.
- Connector enrichment: GRC platforms, ITSM, identity providers.
- Evidence artifacts: policy records, role bindings, oversight events.
- Frameworks: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act,
  GDPR.
- Current state: REQUIRED_NATIVE_CAPABILITY.
- Turns COVERED when: a `governance_policies` schema, oversight role
  bindings, and oversight event types exist with tests and citation in the
  framework mapping docs.

### 2. AI inventory and registries

- Target controls: AI system registry, model registry, agent registry,
  use-case registry, provider registry.
- Native target: tenant-isolated registries with lifecycle states, change
  history, ownership, and risk ties.
- Connector enrichment: CMDB, ServiceNow, IBM, OneTrust, hyperscaler
  inventories.
- Evidence artifacts: registry records, change events, ownership history.
- Frameworks: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act,
  GDPR.
- Current state: the AI System Registry (PR-R2), the Provider Registry
  (PR-R3), the Model Registry (PR-R4), the Agent Registry (PR-R5), and the
  Use-case Registry (PR-R6) are all `IMPLEMENTED_FOUNDATIONAL_CONTROL` (see the
  PR-R2 through PR-R6 implementation evidence below). All five registry
  categories now have foundational schema, routes, audit events, and tests.
  This domain is still not `COVERED`: COVERED additionally requires these
  registries to be cited in the per-requirement framework mappings (the BR-core,
  judiciary/sector, and international mapping PRs), which remains future work.
- Turns COVERED when: schemas, routes, audit events, and tests for each
  registry exist and are cited in framework mappings.

### 3. Model and agent lifecycle

- Target controls: lifecycle states for models and agents, including
  proposal, evaluation, approval, retirement, and significant-change
  review.
- Native target: lifecycle events on model and agent records with
  attached approval evidence.
- Connector enrichment: ModelOps, Vertex, Bedrock, watsonx lifecycle
  signals.
- Evidence artifacts: lifecycle events, approval evidence, retirement
  records.
- Frameworks: ISO 42001, NIST AI RMF, EU AI Act, CNJ 615.
- Current state: both the model side (PR-R4) and the agent side (PR-R5) are
  `IMPLEMENTED_FOUNDATIONAL_CONTROL` for identity, version/config provenance,
  lifecycle/status transitions, and approval/retirement evidence (see the PR-R4
  and PR-R5 implementation evidence below). This is registry evidence only:
  runtime lifecycle enforcement is not implemented, so this domain is not
  `COVERED`.
- Turns COVERED when: lifecycle event types, schema fields, and tests
  exist and are cited in framework mappings.

### 4. Use-case governance

- Target controls: use-case definition, intended purpose, owner,
  jurisdiction, and review cadence.
- Native target: use-case records bound to AI systems with periodic-review
  evidence.
- Connector enrichment: GRC and AI-governance platforms.
- Evidence artifacts: use-case records, periodic-review events.
- Frameworks: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act.
- Current state: `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R6) for use-case
  identity, intended purpose, ownership/accountability, jurisdiction/regulatory-
  basis evidence, AI-system/asset linkage, lifecycle/status evidence, and
  periodic-review evidence (see the PR-R6 implementation evidence below). This
  domain is not `COVERED`: PR-R6 records review *evidence*, not a review
  *workflow engine*, and risk classification, high-risk approval workflow,
  prohibited-use enforcement, legal-basis automation, and runtime enforcement
  remain future work.
- Turns COVERED when: schema and review workflow exist with tests and
  citation in mappings.

### 5. Risk classification

- Target controls: risk classification engine with rationale, evidence,
  and re-classification triggers.
- Native target: rule and/or scoring engine producing class records and
  rationales bound to AI systems and use cases.
- Connector enrichment: external risk-scoring tools where available.
- Evidence artifacts: classification records, rationales, re-classification
  events.
- Frameworks: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act.
- Current state: deterministic technical risk classification engine
  (methodology records, classification records, per-factor evidence rows,
  reclassification triggers, audit events) is `IMPLEMENTED_FOUNDATIONAL_CONTROL`
  (PR-R7); see the PR-R7 evidence in `23-regulatory-core-roadmap.md` and the
  PR-R7 implementation section in `README.md`. Domain 5 is not `COVERED`
  (COVERED still requires per-requirement framework-mapping citations). In
  PR-R7 the residual risk tier and score always mirror the inherent risk tier
  and score (DB-enforced); mitigation_strength is recorded as an evidence-only
  factor and does not downgrade tier or score, because no methodology PR has
  yet defined and tested bounded downgrade rules. The review flags
  `requires_high_risk_review` and `requires_prohibited_use_review` are
  evidence flags that record that review attention is required — they do not
  create review workflows, assign reviewers, block execution, or enforce
  runtime decisions; a future PR is required before any approval workflow,
  hard-deny, or runtime enforcement may rely on them. Mitigation-weighted
  scoring/downgrading, high-risk approval workflow, prohibited-use hard-deny
  workflow, runtime enforcement, and external scoring-tool connectors remain
  future work.
- Turns COVERED when: classification engine, schema, audit events, and
  tests exist and are cited in mappings.

### 6. Prohibited-use and high-risk controls

- Target controls: prohibited-use registry, high-risk workflow, hard-deny
  floor.
- Native target: existing hard-deny floor and capability assertion
  primitives extended into a workflow.
- Connector enrichment: runtime gateways, AI-security signals.
- Evidence artifacts: prohibited-use registry, hard-deny audit events,
  high-risk approval records.
- Frameworks: LGPD, ANPD, CNJ 615, EU AI Act, NIST AI RMF.
- Current state: hard-deny floor is `IMPLEMENTED_FOUNDATIONAL_CONTROL`;
  the high-risk workflow portion is `IMPLEMENTED_FOUNDATIONAL_CONTROL`
  (PR-R8) for high-risk review cases, evidence records, reviewer
  assignments, append-only decisions, deterministic lifecycle transitions,
  service + DB-trigger separation-of-duties, terminal-state backstops, audit
  events, semantic DDL comments binding APPROVED/APPROVE to governance
  evidence only, and tenant RLS; see the PR-R8 evidence in
  `23-regulatory-core-roadmap.md` and the PR-R8 implementation section in
  `README.md`. APPROVED in PR-R8 means the high-risk governance review case
  has an approval decision recorded as governance evidence only; it does
  not mean legal approval; it does not mean compliance certification; it
  does not mean safety certification; and it does not authorize runtime
  execution. High-risk review approval is governance evidence only; it does
  not mutate the underlying risk classification, does not authorize runtime
  execution, and does not make the AI system legally compliant. The
  prohibited-use governance workflow portion is
  `IMPLEMENTED_FOUNDATIONAL_CONTROL` (PR-R9) for prohibited-use policy
  records, case records, evidence records, append-only determinations,
  deterministic lifecycle transitions, mandatory service + DB-trigger
  separation-of-duties for final determinations (PROHIBITED_CONFIRMED,
  FALSE_POSITIVE), terminal-state backstops, classification + capability-
  binding intake, semantic DDL comments binding DENIED /
  HARD_DENY_EXPECTED / PROHIBITED_CONFIRMED to governance evidence only,
  and tenant RLS; see the PR-R9 evidence in
  `23-regulatory-core-roadmap.md` and the PR-R9 implementation section in
  `README.md`. DENIED in PR-R9 means the prohibited-use governance case has
  a denial determination recorded as governance evidence only; it does not
  mean runtime execution was blocked, a provider call was intercepted,
  legal compliance was determined, or enforcement was executed.
  HARD_DENY_EXPECTED records an expected governance denial posture for
  future or adjacent enforcement systems; PR-R9 itself does not perform
  runtime hard-deny enforcement. The runtime hard-deny enforcement engine,
  runtime gateway blocking, live tool enforcement, connector enforcement,
  and provider-side blocking remain `REQUIRED_NATIVE_CAPABILITY` /
  `NATIVE_ENHANCEMENT_REQUIRED` — future work. Domain 6 is **not**
  `COVERED` (COVERED still requires per-framework, per-requirement mapping
  citations in a separate future PR; the prohibited-use governance
  workflow slice is shipped as `IMPLEMENTED_FOUNDATIONAL_CONTROL` only, and
  runtime enforcement primitives have not yet been implemented).
- Turns COVERED when: prohibited-use records, high-risk workflow events,
  and tests exist and are cited in mappings.

### 7. Human oversight and approval evidence

- Target controls: Workroom-mediated oversight, approval requests, SoD,
  one-time consumption, intended-action hash, semantic-expiry filtering.
- Native target: existing Workroom approval loop extended with broader
  case templates and audit dashboards.
- Connector enrichment: ITSM for handoff and notification.
- Evidence artifacts: approval request, approval decision, consumed-run
  record, intended-action-hash record, expiry events.
- Frameworks: LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act.
- Current state: foundational Workroom approval loop is
  `IMPLEMENTED_FOUNDATIONAL_CONTROL`; full case management is
  `NATIVE_ENHANCEMENT_REQUIRED`.
- Turns COVERED when: schema fields, routes, audit events, and tests for
  the extended workflow are cited in mappings.

### 8. Sensitive-data classification

- Target controls: full sensitive-data OS per `24-sensitive-data-operating-model.md`.
- Native target: native detectors, classifiers, redaction, encryption,
  retention, legal-hold, approval, and hard-deny bindings.
- Connector enrichment: BigID, Securiti, Purview, Collibra, Immuta.
- Evidence artifacts: classification events, redaction events, encryption
  metadata.
- Frameworks: LGPD, ANPD, CNJ 615, GDPR, sector overlays.
- Current state: baseline detectors for cpf, cnpj, email, and phone_br are
  `IMPLEMENTED_FOUNDATIONAL_CONTROL`; full categorical OS is
  `NATIVE_ENHANCEMENT_REQUIRED`.
- Turns COVERED when: classifiers, schema, audit events, and tests exist
  per the sensitive-data category list.

### 9. Judicial secrecy and professional secrecy

- Target controls: segredo de justiça and attorney-client privilege
  classifiers, restricted access, and evidence.
- Native target: classifiers, access decisions, audit events, and
  workflows.
- Connector enrichment: judicial-system connectors where feasible.
- Evidence artifacts: classification events, access decisions, restricted
  audit views.
- Frameworks: CNJ 615, OAB sector, LGPD, Marco Civil.
- Current state: REQUIRED_NATIVE_CAPABILITY.
- Turns COVERED when: classifiers and access posture exist with tests and
  citation in judiciary and legal mapping docs.

### 10. Legal basis, consent, and DSR

- Target controls: legal-basis tracking, consent records, and a full DSR
  workflow.
- Native target: native DSR workflow with audit, identity verification,
  and evidence.
- Connector enrichment: CRM, identity, ITSM, ticketing.
- Evidence artifacts: legal-basis records, consent events, DSR records,
  decisions, exports.
- Frameworks: LGPD, ANPD, GDPR.
- Current state: REQUIRED_NATIVE_CAPABILITY.
- Turns COVERED when: DSR schema, routes, evidence, and tests are cited
  in mappings.

### 11. RIPD, DPIA, AIA

- Target controls: native impact-assessment workflow covering data
  protection and AI impact dimensions.
- Native target: templated assessment workflow with versioning and
  approvals.
- Connector enrichment: GRC and AI-governance platforms.
- Evidence artifacts: assessment records, version history, approval and
  review events.
- Frameworks: LGPD, ANPD, GDPR, EU AI Act, CNJ 615.
- Current state: REQUIRED_NATIVE_CAPABILITY.
- Turns COVERED when: schema, routes, evidence, and tests exist and are
  cited in mappings.

### 12. Incident and adverse-event handling

- Target controls: AI and data incident workflow, severity classification,
  evidence preservation, notification.
- Native target: native incident workflow with timelines, severity, and
  notifications.
- Connector enrichment: SIEM, ITSM, ticketing.
- Evidence artifacts: incident records, timelines, notification events.
- Frameworks: LGPD, ANPD, CNJ 615, sector overlays.
- Current state: REQUIRED_NATIVE_CAPABILITY.
- Turns COVERED when: schema, routes, evidence, and tests exist and are
  cited in mappings.

### 13. Evidence and chain of custody

- Target controls: HMAC-chained audit, canonical bytes, sequence numbers,
  append-only triggers, payload hashing, evidence bundles, court export,
  optional TSA and ICP-Brasil integration.
- Native target: existing audit chain primitives extended to bundle
  generation and export workflows.
- Connector enrichment: ITSM and storage connectors for distribution.
- Evidence artifacts: chained audit events, payload hashes, bundles,
  timestamp tokens.
- Frameworks: Marco Civil, CNJ 615, LGPD, OAB sector.
- Current state: HMAC-chained audit, canonical bytes, sequence-numbered
  chain, append-only triggers, payload hashes, and envelope encryption
  are `IMPLEMENTED_FOUNDATIONAL_CONTROL`; bundle and export workflows are
  `NATIVE_ENHANCEMENT_REQUIRED`.
- Turns COVERED when: bundle schema, export routes, RFC 3161 integration
  point, and tests are cited in mappings.

### 14. Retention and legal hold

- Target controls: retention engine with policy bindings and legal-hold
  override.
- Native target: native retention and legal-hold engine.
- Connector enrichment: storage and DLP connectors.
- Evidence artifacts: retention decisions, hold artifacts, override
  events.
- Frameworks: LGPD, ANPD, Marco Civil, sector overlays.
- Current state: REQUIRED_NATIVE_CAPABILITY.
- Turns COVERED when: schema, routes, evidence, and tests exist and are
  cited in mappings.

### 15. Vendor and provider responsibility

- Target controls: provider registry, credential lifecycle, governance
  posture, shared-responsibility records.
- Native target: extension of `provider_credentials` and the
  shared-responsibility model in `16-shared-responsibility-model.md`.
- Connector enrichment: vendor logs and provider policy surfaces.
- Evidence artifacts: provider records, credential lifecycle events,
  posture attestations.
- Frameworks: LGPD, ANPD, Marco Civil, CNJ 615, sector overlays.
- Current state: provider-credential envelope encryption is
  `IMPLEMENTED_FOUNDATIONAL_CONTROL`; broader posture management is
  `NATIVE_ENHANCEMENT_REQUIRED`.
- Turns COVERED when: posture schema, evidence, and tests exist and are
  cited.

### 16. Connector evidence ingestion

- Target controls: connector-based evidence ingestion with normalization
  and correlation.
- Native target: connector framework with provenance, dedup, and
  normalization into the unified evidence layer.
- Connector enrichment: by definition the entire domain.
- Evidence artifacts: ingested events with provenance records.
- Frameworks: All listed frameworks for enrichment purposes.
- Current state: CONNECTOR_ENRICHMENT; the framework itself is
  `REQUIRED_NATIVE_CAPABILITY`.
- Turns COVERED when: connector framework, provenance schema, and tests
  exist and are cited in mappings.

### 17. Regulatory source monitoring

- Target controls: source registry, change detection, diff records,
  affected-controls propagation.
- Native target: extends `15-source-register.md` into an operating model
  per `21-regulatory-intelligence-operating-model.md`.
- Connector enrichment: regulatory-intelligence vendors.
- Evidence artifacts: source records, diff records, review tasks.
- Frameworks: All listed frameworks.
- Current state: source register is `IMPLEMENTED_FOUNDATIONAL_CONTROL`
  for the index function; change monitor is
  `REQUIRED_NATIVE_CAPABILITY`.
- Turns COVERED when: change monitor schema, diff events, and tests exist
  and are cited.

### 18. Reporting and audit-readiness

- Target controls: native reports, dashboards, readiness scoring, and
  audit cockpit.
- Native target: native report generation and dashboards over the
  control catalog.
- Connector enrichment: external BI when desired.
- Evidence artifacts: report snapshots, dashboard configurations,
  readiness scores.
- Frameworks: All listed frameworks.
- Current state: REQUIRED_NATIVE_CAPABILITY and NATIVE_ENHANCEMENT_REQUIRED.
- Turns COVERED when: reporting and dashboard schemas, routes, and tests
  exist and are cited.

### 19. Security, RBAC, RLS, encryption, hard-deny

- Target controls: RBAC, RLS, envelope encryption, DEK wrapping,
  crypto-shred, hard-deny floor, audit_only and governance_active modes.
- Native target: continued use and extension of these primitives.
- Connector enrichment: identity providers, key management services.
- Evidence artifacts: access decisions, encryption metadata,
  crypto-shred events, hard-deny events.
- Frameworks: LGPD, ANPD, Marco Civil, CNJ 615, sector overlays.
- Current state: RBAC, RLS, envelope encryption with DEK wrapping,
  crypto-shred primitive, hard-deny floor, and `audit_only` and
  `governance_active` modes are `IMPLEMENTED_FOUNDATIONAL_CONTROL`.
- Turns COVERED when: each requirement-level mapping cites these
  primitives concretely.

### 20. Bias, fairness, drift, and performance monitoring

- Target controls: bias evaluation, drift detection, performance
  monitoring, evaluation records.
- Native target: native evaluation framework with records and dashboards.
- Connector enrichment: Fiddler, Arize, WhyLabs, Arthur, ModelOp.
- Evidence artifacts: evaluation records, drift events, performance
  reports.
- Frameworks: ISO 42001, NIST AI RMF, EU AI Act, CNJ 615 (where
  applicable).
- Current state: REQUIRED_NATIVE_CAPABILITY and NATIVE_ENHANCEMENT_REQUIRED.
- Turns COVERED when: evaluation schema, drift records, tests, and
  connector ingestion exist and are cited.

### 21. International expansion overlays

- Target controls: GDPR and EU AI Act overlays, future jurisdiction
  overlays as needed.
- Native target: overlay layer over the BR-first core mapping.
- Connector enrichment: international regulatory feeds and external GRC.
- Evidence artifacts: overlay records, mapped obligations, and review
  events.
- Frameworks: GDPR, EU AI Act, future jurisdictions.
- Current state: REQUIRED_NATIVE_CAPABILITY.
- Turns COVERED when: overlay schema, mapping references, and tests
  exist and are cited.

## PR-R1 implementation evidence (foundational slice)

PR-R1 lands the first concrete repository evidence behind the registry
control domains above (notably domain 2, AI inventory and registries, and
domain 17, regulatory source monitoring). It is a PR-R1 foundational
implementation of the registry and catalog primitives, not full regulatory
automation, and on its own does not raise any framework requirement to
`COVERED`.

Capability status:

- Regulatory Source Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL
- Unified Control Catalog: IMPLEMENTED_FOUNDATIONAL_CONTROL

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0016_regulatory_source_control_catalog.sql`
- Validation: `apps/api/src/regulatory/validation.ts`
- Service: `apps/api/src/regulatory/service.ts`
- Routes: `apps/api/src/routes/regulatory.ts`
- Server wiring: `apps/api/src/server.ts`
- Tests: `tests/integration/regulatory-routes.test.ts`,
  `tests/integration/regulatory-rls.test.ts`,
  `tests/integration/regulatory-catalog.test.ts`

Audit events emitted:

- `regulatory_source.created`
- `regulatory_source.updated`
- `regulatory_source.version_created`
- `regulatory_source.relationship_created`
- `regulatory_control.created`
- `regulatory_control.updated`
- `regulatory_control.source_link_created`
- `regulatory_control.framework_mapping_created`

Limitations (remain future work or external):

- Automated source monitoring remains future work.
- Regulatory diff engine remains future work.
- Connectors remain future work.
- CNJ/Sinapses readiness remains future work.
- Sensitive Data OS remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

## PR-R2 implementation evidence (foundational slice)

PR-R2 lands the first concrete repository evidence behind domain 2 (AI
inventory and registries): a tenant-isolated AI System Registry. It is a PR-R2
foundational implementation of the AI-system inventory primitive, not the full
registry program, and on its own does not raise any framework requirement to
`COVERED`.

Capability status:

- AI System Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0017_regulatory_ai_system_registry.sql`
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
- Tests: `tests/integration/regulatory-ai-systems.test.ts`

Audit events emitted:

- `regulatory_ai_system.created`
- `regulatory_ai_system.updated`
- `regulatory_ai_system.lifecycle_changed`

Limitations (remain future work or external):

- Model registry remains future work.
- Agent registry remains future work.
- Use-case registry remains future work.
- Provider registry remains future work.
- Risk-classification engine remains future work.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

## PR-R3 implementation evidence (foundational slice)

PR-R3 adds the second concrete repository evidence behind domain 2 (AI
inventory and registries) and supports domain 15 (vendor and provider
responsibility): a tenant-isolated Provider Registry. It is a PR-R3
foundational implementation of the provider inventory/posture primitive, not
the full provider-governance program, and on its own does not raise any
framework requirement to `COVERED`.

Capability status:

- Provider Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0018_regulatory_provider_registry.sql`
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
- Tests: `tests/integration/regulatory-providers.test.ts`

Audit events emitted:

- `regulatory_provider.created`
- `regulatory_provider.updated`
- `regulatory_provider.status_changed`
- `regulatory_provider.review_status_changed`

Limitations (remain future work or external):

- Posture/inventory only — no credential vault, and no API keys, client
  secrets, OAuth tokens, certificates, or passwords are stored.
- No live provider integration or connector.
- Model registry remains future work.
- Agent registry remains future work.
- Use-case registry remains future work.
- Risk-classification engine remains future work.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

## PR-R4 implementation evidence (foundational slice)

PR-R4 adds the next concrete repository evidence behind domain 2 (AI inventory
and registries) and the model side of domain 3 (model and agent lifecycle): a
production-focused Model Registry. It is a PR-R4 foundational implementation of
the model identity, version-provenance, and AI-system/model-version binding
primitives — not the full AI inventory program — and on its own does not raise
any framework requirement, nor domain 2 or domain 3, to `COVERED`.

Capability status:

- Model Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL for model identity, version
  provenance, lifecycle/status evidence, provider linkage, and
  AI-system/model-version binding.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0019_regulatory_model_registry.sql`
  (`govai.regulatory_models`, `govai.regulatory_model_versions`,
  `govai.regulatory_ai_system_model_links`; tenant-only, RLS ENABLE + FORCE,
  DB-enforced parent visibility and version-belongs-to-model guards).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
- Tests: `tests/integration/regulatory-models.test.ts`

Audit events emitted:

- `regulatory_model.created` / `.updated` / `.status_changed`
- `regulatory_model_version.created` / `.updated` / `.status_changed` /
  `.approved` / `.retired`
- `regulatory_ai_system_model_link.created` / `.updated` / `.status_changed`

Limitations (remain future work or external):

- Provenance/metadata only — no model artifact bytes, training data, evaluation
  datasets, credentials, API keys, secrets, tokens, or certificates are stored.
- Agent registry remains future work.
- Use-case registry remains future work.
- Risk-classification engine remains future work.
- No model runtime enforcement.
- No live provider integration or connector.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

## PR-R5 implementation evidence (foundational slice)

PR-R5 adds the next concrete repository evidence behind domain 2 (AI inventory
and registries) and the agent side of domain 3 (model and agent lifecycle): a
production-focused Agent Registry. It is a PR-R5 foundational implementation of
the agent identity, version/config-provenance, and capability-binding
primitives — not the full AI inventory program — and on its own does not raise
any framework requirement, nor domain 2 or domain 3, to `COVERED`.

Capability status:

- Agent Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL for agent identity,
  version/config provenance, lifecycle/status evidence, capability bindings,
  hard-deny-floor expectation tracking as registry evidence, and optional
  linkage to AI systems, models, model versions, and providers.

Agent capability bindings record declared governance expectations, including
whether the hard-deny floor is expected to apply, but PR-R5 does not implement
runtime enforcement, live tool invocation blocking, or gateway-level denial
behavior.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0020_regulatory_agent_registry.sql`
  (`govai.regulatory_agents`, `govai.regulatory_agent_versions`,
  `govai.regulatory_agent_capability_bindings`; tenant-only, RLS ENABLE + FORCE,
  DB-enforced parent visibility, version-requires-model CHECK, and
  version-belongs-to-model / agent-version-belongs-to-agent guards).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
- Tests: `tests/integration/regulatory-agents.test.ts`

Audit events emitted:

- `regulatory_agent.created` / `.updated` / `.status_changed`
- `regulatory_agent_version.created` / `.updated` / `.status_changed` /
  `.approved` / `.retired`
- `regulatory_agent_capability_binding.created` / `.updated` /
  `.status_changed` / `.risk_posture_changed`

Limitations (remain future work or external):

- Registry evidence / provenance only — no prompts, tool-manifest bodies,
  model artifacts, training data, credentials, API keys, secrets, tokens, or
  certificates are stored.
- `hard_deny_floor_expected` is a declared governance expectation only; it does
  not enforce runtime hard-deny behavior. Runtime agent enforcement, live tool
  invocation, and gateway-level denial remain future work.
- Use-case registry remains future work.
- Risk-classification engine remains future work.
- CNJ/Sinapses readiness remains future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

## PR-R6 implementation evidence (foundational slice)

PR-R6 adds the final registry category behind domain 2 (AI inventory and
registries) and the foundational layer of domain 4 (use-case governance): a
production-focused Use-case Registry. It is a PR-R6 foundational implementation
of the use-case identity, asset-linkage, and periodic-review-evidence
primitives — not a risk engine, high-risk workflow, or review workflow engine —
and on its own does not raise any framework requirement, nor domain 2, 4, 5, or
6, to `COVERED`.

Capability status:

- Use-case Registry: IMPLEMENTED_FOUNDATIONAL_CONTROL for use-case identity,
  intended purpose, prohibited/restricted-use boundaries, ownership and
  accountability, jurisdiction and regulatory/legal-basis evidence, AI-system
  and optional model/model-version/agent/agent-version linkage, lifecycle/status
  evidence, and periodic-review evidence.

Use-case records and reviews capture governance evidence about intended purpose,
ownership, jurisdiction, regulatory/legal-basis summaries, and review cadence,
but PR-R6 does not implement risk classification, high-risk approval workflow,
prohibited-use hard-deny workflow, legal advice, or runtime enforcement.

Implementation evidence:

- Migration: `apps/api/src/db/migrations/0021_regulatory_use_case_registry.sql`
  (`govai.regulatory_use_cases`, `govai.regulatory_use_case_asset_links`,
  `govai.regulatory_use_case_reviews`; tenant-only, RLS ENABLE + FORCE,
  DB-enforced parent visibility, version-requires-parent CHECKs, table-qualified
  version-belongs-to-parent guards, and partial unique indexes for nullable
  version columns).
- Validation / service / routes: `apps/api/src/regulatory/validation.ts`,
  `apps/api/src/regulatory/service.ts`, `apps/api/src/routes/regulatory.ts`
- Tests: `tests/integration/regulatory-use-cases.test.ts`

Audit events emitted:

- `regulatory_use_case.created` / `.updated` / `.status_changed` /
  `.review_due_changed`
- `regulatory_use_case_asset_link.created` / `.updated` / `.status_changed` /
  `.retired`
- `regulatory_use_case_review.created` / `.updated` / `.status_changed` /
  `.completed` / `.outcome_changed`

Limitations (remain future work or external):

- Governance evidence only — no prompts, credentials, secrets, legal opinions,
  medical records, financial-advice outputs, or raw sensitive data are stored.
- Risk-classification engine remains future work (domain 5 not `COVERED`).
- High-risk approval and prohibited-use hard-deny workflows remain future work
  (domain 6 not `COVERED`).
- Review evidence only — no review/approval workflow engine, no legal sign-off
  workflow, no legal-basis automation.
- Runtime enforcement remains future work.
- Connectors, UI, dashboards, reports, and CNJ/Sinapses readiness remain future work.
- Certification/legal interpretation remains external.
- GovAI does not guarantee compliance.
- GovAI does not provide legal advice.
- GovAI does not guarantee judicial validity or evidence admissibility.

## Cross-domain decisions

- No domain may treat a `CONNECTOR_ENRICHMENT` capability as a substitute
  for its `REQUIRED_NATIVE_CAPABILITY`.
- No domain may treat `EXTERNAL_SERVICE_REQUIRED` as a GovAI-controlled
  outcome.
- No domain may treat `CUSTOMER_PROCESS_REQUIRED` or
  `PROFESSIONAL_REVIEW_REQUIRED` as automatable.

## Forbidden claims

- The catalog does not certify customers.
- The catalog does not guarantee LGPD, ANPD, CNJ, sector, ISO, NIST,
  GDPR, or EU AI Act outcomes.
- The catalog does not guarantee judicial validity or admissibility of
  evidence.
- The catalog does not replace lawyers, DPOs, auditors, peritos, medical
  professionals, financial compliance specialists, magistrates, or court
  staff.
- The catalog does not assert that GovAI is CNJ-approved, ICP-Brasil
  certified, ISO certified, or otherwise externally certified.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
