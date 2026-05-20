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
- Current state: REQUIRED_NATIVE_CAPABILITY.
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
- Current state: REQUIRED_NATIVE_CAPABILITY.
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
- Current state: REQUIRED_NATIVE_CAPABILITY.
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
- Current state: REQUIRED_NATIVE_CAPABILITY.
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
  prohibited-use registry and high-risk workflow are
  `REQUIRED_NATIVE_CAPABILITY` and `NATIVE_ENHANCEMENT_REQUIRED`.
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
