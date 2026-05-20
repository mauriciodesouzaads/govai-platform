# GovAI Build-vs-Integrate Strategy

## Doctrine

GovAI must be complete standalone and powerful when integrated.

GovAI must provide native, production-grade regulatory governance for
customers that do not run Microsoft Purview, OneTrust, ServiceNow,
AWS-native governance, Google governance, IBM, Vanta, Drata, BigID,
Securiti, Collibra, Fiddler, Arize, WhyLabs, Lakera, Protect AI, or any
other external platform.

When customers do already run those systems, GovAI must integrate, ingest,
normalize, correlate, govern, evidence, and report over them.

Native GovAI functionality is mandatory for critical regulatory governance,
sensitive-data handling, evidentiary controls, human oversight, hard-deny
floors, and BR-first legal posture.

External platforms are enrichment and interoperability layers. They are
never prerequisites for safe governance.

## Why native completeness matters

- Safety must not depend on a customer's procurement of any third-party
  platform.
- Brazil-first regulatory posture (LGPD, ANPD, CNJ, Marco Civil, Bacen,
  CVM, SUSEP, ANS, CFM, OAB) cannot rely on external products whose
  feature roadmaps are outside GovAI's control.
- Cryptographic evidence, append-only audit, Workroom-mediated approvals,
  and the hard-deny floor must be operated by GovAI, not delegated.
- A customer with no enterprise GRC, DLP, or AI governance stack must
  still receive a defensible governance posture.
- Customers in regulated sectors must be able to demonstrate native
  control ownership to regulators and auditors.

## Why integrations still matter

- Many customers already run extensive GRC, DLP, observability, AI-security,
  and audit-readiness stacks. GovAI must add value to that estate rather
  than ignore it.
- Provider-side audit logs, hyperscaler guardrails, model-monitoring drift,
  data-catalog lineage, and external DLP detections provide signal that
  enriches GovAI's evidence and risk view.
- Workflow integrations with ITSM, ticketing, identity, and source control
  fit GovAI into existing operational processes.
- External services such as RFC 3161 TSAs and ICP-Brasil providers cannot
  be replaced by GovAI; they must be integrated as external services.

## Why external tools cannot be prerequisites for safe governance

- Critical regulatory governance must not be conditional on the procurement
  of a non-GovAI tool.
- A customer that operates only through provider APIs and a small data
  footprint must still receive a usable regulatory core.
- A small or mid-market customer must not be forced into an enterprise GRC
  contract to obtain LGPD-shaped controls.
- A judiciary or public-sector customer must be able to evidence its
  controls without depending on commercial vendor uptime.
- An incident response, DSR, or legal hold must remain executable from
  GovAI even if external systems are unavailable.

## Customer profiles

- Small customer without an enterprise governance stack — GovAI provides
  the entire regulatory control plane natively, with provider-side
  enrichment optional.
- Mid-market customer using providers directly — GovAI provides native
  control plane and integrates the few SaaS surfaces in use as enrichment.
- Enterprise customer with Microsoft, AWS, Google, ServiceNow, OneTrust,
  IBM, BigID, Vanta, Drata, Securiti, Collibra, Fiddler, Arize, WhyLabs,
  Lakera, Protect AI, or similar — GovAI provides the native control plane
  and integrates these systems as enrichment, never as substitutes.
- Regulated customer (judiciary, legal, health, financial, public sector)
  — GovAI provides the native sector overlays in
  `05-cnj-judiciary-mapping.md`, `08-sector-financial-mapping.md`,
  `09-sector-health-mapping.md`, `10-sector-legal-mapping.md`, and
  `25-cnj-sinapses-readiness.md`, with conservative use of external
  services where unavoidable (for example, RFC 3161 TSAs and ICP-Brasil
  providers).

## Decision model

Each capability is assigned exactly one decision label:

- `BUILD_NATIVE_CORE` — must be implemented natively inside GovAI as part
  of the regulatory core. External tools cannot be a prerequisite.
- `BUILD_NATIVE_ENHANCED` — must be implemented natively, with deeper
  productization beyond a minimum primitive, to reach market-level depth.
- `CONNECTOR_ENRICHMENT` — must integrate external systems when present,
  without making them mandatory.
- `EXTERNAL_SERVICE_REQUIRED` — external authority or provider is
  inherently required (for example, RFC 3161 TSA, ICP-Brasil issuer,
  external auditor).
- `CUSTOMER_PROCESS_REQUIRED` — requires a customer policy, organizational
  process, contractual term, or legal decision that GovAI cannot
  generate on the customer's behalf.
- `PROFESSIONAL_REVIEW_REQUIRED` — requires lawyer, DPO, compliance
  officer, auditor, perito, medical professional, financial compliance
  specialist, or equivalent qualified review.

The decision is orthogonal to current implementation state. A capability
labeled `BUILD_NATIVE_CORE` may still be `REQUIRED_NATIVE_CAPABILITY` or
`NATIVE_ENHANCEMENT_REQUIRED` until concrete implementation exists.

## Capability table

The table is organized by capability area. Each row records the native
GovAI requirement, the connector-enrichment opportunity, the decision
label, the evidence the capability must produce, the frameworks served,
and the future implementation priority. See
`23-regulatory-core-roadmap.md` for the priority semantics (P0, P1, P2,
P3).

| Capability | Native GovAI full-core requirement | Connector enrichment | Decision | Evidence produced | Frameworks served | Future implementation priority |
|---|---|---|---|---|---|---|
| AI system registry | Native registry of AI systems with tenant isolation, lifecycle states, and risk ties | Enrichment from CMDB, ServiceNow, IBM, OneTrust, hyperscaler inventories | BUILD_NATIVE_CORE | Registry records, change history, owner attestations | LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act, GDPR | P0 |
| Model registry | Native registry of model versions, providers, and approval state | Enrichment from ModelOps, Vertex, Bedrock, watsonx inventories | BUILD_NATIVE_CORE | Model lifecycle events, version provenance, approval evidence | LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act | P0 |
| Agent registry | Native registry of agents and capability sets | Enrichment from external agent platforms when present | BUILD_NATIVE_CORE | Agent identity, capability bindings, change history | CNJ 615, ISO 42001, NIST AI RMF, EU AI Act | P0 |
| Use-case registry | Native registry of AI use cases, owners, and intended purposes | Enrichment from GRC platforms when present | BUILD_NATIVE_CORE | Use-case definition records and reviews | LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act | P0 |
| Provider registry | Native registry of providers and credentials with envelope encryption | Enrichment from vendor logs and provider policy surfaces | BUILD_NATIVE_CORE | Provider records, credential lifecycle, governance posture | LGPD, ANPD, Marco Civil, CNJ 615 | P0 |
| Risk classification engine | Native engine to classify risk levels per AI system, model, and use case | Enrichment from external risk scoring where available | BUILD_NATIVE_CORE | Risk classification records and rationales | LGPD, ANPD, CNJ 615, ISO 42001, NIST AI RMF, EU AI Act | P0 |
| High-risk workflow | Native workflow for high-risk classification including approvals and evidence | Enrichment from ITSM and ticketing for task handoff | BUILD_NATIVE_CORE | High-risk approval records and supporting evidence | ANPD, CNJ 615, ISO 42001, EU AI Act | P0 |
| Prohibited-use workflow | Native workflow to block prohibited uses with hard-deny floor | Enrichment from runtime gateways and AI-security signals | BUILD_NATIVE_CORE | Hard-deny audit events, prohibited-use registry | LGPD, ANPD, CNJ 615, EU AI Act | P0 |
| Policy pack engine | Native policy pack engine to bind controls to AI systems | Enrichment from external policy registries | BUILD_NATIVE_CORE | Policy binding records, evaluation logs | LGPD, ANPD, ISO 42001, NIST AI RMF | P0 |
| Unified control catalog | Native, framework-agnostic control catalog as defined in `20-target-control-catalog.md` | Enrichment from external control taxonomies and audit-readiness platforms | BUILD_NATIVE_CORE | Control definitions, mappings, and state | All listed frameworks | P0 |
| Regulatory source registry | Native registry of regulatory sources with verification status | Enrichment from regulatory-intelligence vendors | BUILD_NATIVE_CORE | Source records, versioning, change diff | All listed frameworks | P0 |
| Regulatory change monitor | Native change-detection and review-queue engine | Enrichment from regulatory-intelligence vendors | BUILD_NATIVE_ENHANCED | Change events, diff records, review tasks | All listed frameworks | P0 |
| Sensitive Data OS | Native classification, redaction, encryption, retention, and hard-deny per the model in `24-sensitive-data-operating-model.md` | Enrichment from BigID, Securiti, Purview, Collibra, Immuta | BUILD_NATIVE_ENHANCED | Sensitive-data classification events and decisions | LGPD, ANPD, CNJ 615, sector overlays | P0 |
| Segredo de justiça classifier | Native classifier and access-control posture | Enrichment from court connectors when feasible | BUILD_NATIVE_CORE | Segredo de justiça classification and access events | CNJ 615, Marco Civil, OAB sector | P0 |
| Attorney-client privilege classifier | Native classifier with conservative defaults | Enrichment from legal-tech connectors when feasible | BUILD_NATIVE_CORE | Privilege classification and handling events | OAB sector, LGPD | P0 |
| Health, biometric, genetic, financial, criminal data classifiers | Native classifiers per LGPD sensitive categories | Enrichment from external DLP and discovery tools | BUILD_NATIVE_CORE | Sensitive-category classification events | LGPD, ANPD, health sector, financial sector | P0 |
| DSR workflow | Native data-subject-rights workflow with audit | Enrichment from CRM, identity, and ITSM connectors | BUILD_NATIVE_CORE | DSR request records, decisions, evidence | LGPD, ANPD, GDPR | P1 |
| RIPD, DPIA, AIA workflow | Native impact-assessment workflow with templates and evidence | Enrichment from GRC and AI-governance platforms | BUILD_NATIVE_CORE | Assessment records, approvals, and review evidence | LGPD, ANPD, GDPR, EU AI Act, CNJ 615 | P1 |
| Incident and adverse-event workflow | Native workflow for AI and data incidents with notifications | Enrichment from SIEM, ITSM, and ticketing | BUILD_NATIVE_CORE | Incident records, timelines, notifications, evidence | LGPD, ANPD, CNJ 615, sector overlays | P1 |
| Retention and legal hold engine | Native retention and legal-hold engine across data classes | Enrichment from storage and DLP connectors | BUILD_NATIVE_CORE | Retention decisions, legal-hold artifacts | LGPD, ANPD, Marco Civil, sector overlays | P1 |
| Evidence bundle and court export | Native court-export generation with cryptographic integrity | RFC 3161 TSAs and ICP-Brasil providers as external services | BUILD_NATIVE_CORE | Evidence bundles, integrity proofs, exports | Marco Civil, CNJ 615, OAB sector | P1 |
| Certification-readiness dossier | Native dossier generator covering readiness targets | Enrichment from external audit-readiness platforms | BUILD_NATIVE_CORE | Readiness dossiers and supporting evidence | All listed frameworks | P1 |
| Native reports and dashboards | Native reports and dashboards over the control catalog | Enrichment from external BI when desired | BUILD_NATIVE_CORE | Report and dashboard snapshots | All listed frameworks | P1 |
| Audit-readiness cockpit | Native cockpit for audit-readiness across frameworks | Enrichment from external audit-readiness automation | BUILD_NATIVE_ENHANCED | Cockpit views, readiness scores, evidence indexes | All listed frameworks | P1 |
| Microsoft connector family | Not native; integrates Purview, Defender, Entra, M365 audit | Native consumer of these signals | CONNECTOR_ENRICHMENT | Ingested signals, normalized into GovAI evidence | LGPD, ANPD, ISO 42001 | P2 |
| AWS connector family | Not native; integrates CloudTrail, CloudWatch, Security Hub, Bedrock Guardrails, Audit Manager class | Native consumer of these signals | CONNECTOR_ENRICHMENT | Ingested signals, normalized into GovAI evidence | LGPD, ANPD, ISO 42001, NIST AI RMF | P2 |
| Google connector family | Not native; integrates Vertex, Gemini Enterprise, Cloud Logging, Model Armor | Native consumer of these signals | CONNECTOR_ENRICHMENT | Ingested signals, normalized into GovAI evidence | LGPD, ANPD, ISO 42001 | P2 |
| ServiceNow connector | Not native; integrates AI Control Tower, GRC, CMDB | Native consumer for ITSM and GRC enrichment | CONNECTOR_ENRICHMENT | Tickets, attestations, CMDB records | ISO 42001, NIST AI RMF | P2 |
| OneTrust, IBM, Vanta, Drata optional connectors | Not native; integrates AI governance, GRC, and audit-readiness platforms | Native consumer of attestations and assessments | CONNECTOR_ENRICHMENT | Attestations and evidence records | ISO 42001, NIST AI RMF | P2 |
| BigID, Securiti, Collibra, Immuta optional connectors | Not native; integrates discovery, data governance, and access control | Native consumer of classification signals | CONNECTOR_ENRICHMENT | Classification and lineage signals | LGPD, ANPD, GDPR | P2 |
| Fiddler, Arize, WhyLabs, Arthur optional connectors | Not native; integrates model-monitoring | Native consumer of drift and quality signals | CONNECTOR_ENRICHMENT | Drift and quality signals | NIST AI RMF, EU AI Act | P2 |
| Lakera, Protect AI, Robust Intelligence optional connectors | Not native; integrates AI-security signal | Native consumer of detection signals | CONNECTOR_ENRICHMENT | Detection events | NIST AI RMF, EU AI Act | P2 |
| Jira, GitHub, GitLab, Slack, Teams, Salesforce, Notion connectors | Not native; integrates workflow and collaboration evidence | Native consumer of workflow evidence | CONNECTOR_ENRICHMENT | Workflow and conversation evidence | Cross-framework workflow evidence | P2 |
| RFC 3161 TSA providers | Not native; relies on external TSA authority | Native client of external TSA | EXTERNAL_SERVICE_REQUIRED | Timestamp tokens, integrity records | Marco Civil, evidence chain | P1 |
| ICP-Brasil certificate and signature providers | Not native; relies on ICP-Brasil ecosystem | Native client of ICP-Brasil providers | EXTERNAL_SERVICE_REQUIRED | Signature artifacts and chain-of-trust evidence | Marco Civil, ICP-Brasil-shaped evidence | P1 |
| Customer policy decisions | Not native; customer must define legal and organizational policies | GovAI captures and applies customer policies | CUSTOMER_PROCESS_REQUIRED | Customer policy records and applications | All listed frameworks | Customer-driven |
| Professional review for DPO, legal, audit, perito, medical, financial | Not native; qualified external reviewers required | GovAI captures review artifacts | PROFESSIONAL_REVIEW_REQUIRED | Review records, decisions, supporting context | All listed frameworks | Customer-driven |

## How this doctrine binds future PRs

- A new GovAI feature must declare its decision label.
- A capability labeled `BUILD_NATIVE_CORE` or `BUILD_NATIVE_ENHANCED` cannot
  be gated on an external system.
- A capability labeled `CONNECTOR_ENRICHMENT` must remain optional and must
  degrade gracefully when the external system is absent.
- A capability labeled `EXTERNAL_SERVICE_REQUIRED` must be documented as
  not-a-GovAI-guarantee and must avoid claims of inherent admissibility or
  legal validity.
- A capability labeled `CUSTOMER_PROCESS_REQUIRED` or
  `PROFESSIONAL_REVIEW_REQUIRED` must capture the human decision and its
  evidence rather than simulate it.

## Forbidden framings

- "Minimum viable" framing for the regulatory core.
- "Stub" or "placeholder" framing for sensitive-data, judiciary,
  evidentiary, or human-oversight controls.
- Treating any external system as a default prerequisite for safe
  governance.
- Marking a capability as implemented based on connector availability
  rather than native code, schema, and evidence.

## Relationship to other docs

- `18-competitive-benchmark.md` provides the market analysis behind this
  doctrine.
- `20-target-control-catalog.md` records the target controls and their
  state.
- `23-regulatory-core-roadmap.md` records the priority and sequencing.
- `24-sensitive-data-operating-model.md` is the binding example of a
  `BUILD_NATIVE_ENHANCED` area.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
