# GovAI Competitive and Market Benchmark

## Purpose

Benchmark the categories of vendors and platforms most adjacent to GovAI's
mission — AI governance, GRC, audit-readiness, model monitoring, AI security,
data governance and DLP, cloud-native guardrails, runtime enforcement, and
regulatory intelligence — and derive what GovAI must build natively versus
integrate as enrichment.

The benchmark is for product architecture and strategy. It is not a marketing
claim, not a competitive ranking, and not a legal or commercial opinion about
any vendor.

## Non-goals

- Not a ranking of vendors.
- Not a claim of market leadership.
- Not a claim that GovAI is superior or inferior to any specific vendor.
- Not a claim about exact vendor pricing, release dates, certifications, or
  conformity assessments.
- Not a legal opinion about whether any vendor satisfies LGPD, ANPD, CNJ,
  Bacen, CVM, SUSEP, ANS, CFM, OAB, EU AI Act, GDPR, ISO 42001, NIST AI RMF,
  or any other framework.
- Not a substitute for due diligence on any specific vendor.

## Source discipline

Every comparison row in this document uses one source-quality label drawn from
the set defined in `15-source-register.md` and below:

- `PRIMARY_VENDOR_DOC` — direct, currently accessible vendor documentation.
- `PRIMARY_REGULATORY_SOURCE` — official regulator or legislature text.
- `PRIMARY_OFFICIAL_SOURCE` — official standards body, court, or government
  publication.
- `ANALYST_REPORT` — third-party analyst commentary, e.g., research firms.
- `NEWS_SOURCE` — reputable news media coverage.
- `SECONDARY_BLOG` — third-party blogs, community write-ups, or partner notes.
- `INTERNAL_ARCHITECTURE_ANALYSIS` — GovAI internal architecture reasoning
  about the category, not a vendor-specific factual claim.
- `SOURCE_VERIFICATION_REQUIRED` — claim that needs primary-source
  verification before it can be relied on for any binding mapping or product
  decision.

The default posture for any vendor capability whose evidence is not
independently verified is `SOURCE_VERIFICATION_REQUIRED`.

## Benchmark honesty

This benchmark prioritizes architectural and product reasoning over
unverified vendor-specific claims.

Rules followed throughout this doc:

- Vendor marketing language is not adopted as fact.
- Claims of being "first", "leader", "certified", "FedRAMP", "conformity
  assessment", exact pricing, or rankings are not asserted unless the source
  is identified and labeled.
- Class-level statements (for example, "model-monitoring tools typically
  provide drift and performance dashboards") are framed as
  `INTERNAL_ARCHITECTURE_ANALYSIS`, not as a vendor-specific factual claim.
- Vendors whose detailed capability is not verified for this PR are listed
  with `SOURCE_VERIFICATION_REQUIRED` so that an architecture decision does
  not silently rely on unverified vendor copy.
- GovAI is not described as inferior to a vendor merely because the vendor
  has an unverified claim.
- GovAI is not described as possessing a capability merely because target
  architecture says it should be built; the capability taxonomy in
  `20-target-control-catalog.md` separates target capability from
  implemented capability.

## Market categories

The benchmark organizes adjacent tools into eight categories. The goal is to
clarify which functional layer each tool occupies and where GovAI must build
versus integrate.

### Policy-first AI governance and GRC

Tools whose primary value is policy authoring, AI-system inventory, risk
classification, control attestation, and reporting against frameworks such as
ISO 42001, NIST AI RMF, EU AI Act, or sector regulations. Sales motion is
typically GRC-team-led.

### Hyperscaler-native AI governance and guardrails

Cloud-vendor surfaces that ship near or inside their AI runtime: content and
safety guardrails, audit logs, IAM-integrated policies, and inventory tied to
the vendor's own platform.

### Runtime enforcement and AI gateways

Inline policy enforcement at request/response time for prompts, tools,
outputs, and tool/agent traffic. Typically a proxy or sidecar.

### Model monitoring and observability

Drift, performance, output-quality, evaluation, and ML-experiment tracking.
Frequently used by ML engineering and SRE.

### AI security, red-team, and prompt-injection defense

Adversarial testing, jailbreak detection, prompt-injection filters,
exfiltration detectors, and AI-specific runtime defenses.

### Privacy, data governance, and DLP

Sensitive-data discovery, classification, and access control across stores,
SaaS, endpoints, and pipelines.

### Audit-readiness and compliance automation

Continuous control monitoring, evidence collection, framework-aligned
dashboards, and audit packaging for SOC 2, ISO 27001, HIPAA, and analogous
controls. Increasingly extending into AI governance.

### Regulatory intelligence and legal-change monitoring

Curated regulatory feeds, change diff, and obligation libraries. Typically
sold to legal/compliance teams as a knowledge source rather than a control
plane.

## Competitive implications for GovAI

The cross-category analysis surfaces a few load-bearing implications:

- No single category provides a complete BR-first regulatory core with
  judiciary, sensitive-data, evidence-chain, Workroom/human-oversight, and
  audit-readiness coverage. GovAI must build that core natively.
- Hyperscaler surfaces are powerful inside their own clouds but do not unify
  cross-cloud or cross-provider AI governance, and are not BR-regulation-
  shaped by default. GovAI must remain provider-agnostic and BR-first.
- Policy-first GRC tools tend to emphasize framework alignment and
  workflow over cryptographic evidence and runtime hard-deny floors. GovAI
  must keep cryptographic audit and runtime guardrails native.
- DLP and data-governance leaders address general-purpose sensitive-data
  workflows but rarely encode segredo de justiça, attorney-client privilege,
  and BR-specific health/financial categories with first-class workflows.
  GovAI must own those natively.
- Model-monitoring tools are strong on quality and drift but are not
  sufficient to discharge regulatory obligations alone. GovAI must integrate
  their signals into a unified evidence/control layer.
- Audit-readiness automation accelerates evidence collection but does not
  replace a control catalog mapped to BR regulators or to Workroom-level
  human-oversight evidence. GovAI must remain the control authority.

## What GovAI should build

- BR-first regulatory core: source registry, control catalog, mapping
  layer, sensitive-data OS, evidence chain, Workroom audit, approvals,
  hard-deny floor, and BR-shaped readiness dossiers.
- Native registries for AI systems, models, agents, use-cases, and
  providers.
- Native risk classification, prohibited-use, and high-risk workflows.
- Native DSR/RIPD/AIA/DPIA, incident, retention, and legal-hold workflows.
- Native court-export and evidence-bundle generation.
- Native regulatory intelligence ingest, diff, and review queues.

## What GovAI should integrate

- Hyperscaler audit logs and guardrail signals.
- Policy-first GRC and audit-readiness systems as enrichment sources.
- Model-monitoring drift and evaluation signals.
- AI-security and runtime-defense signals.
- DLP and data-governance classification signals from external systems.
- ITSM, ticketing, source control, and collaboration tools for evidence and
  workflow handoff.
- RFC 3161 TSAs and ICP-Brasil signature providers as external services.

## What GovAI should observe for future parity

- Evolution of EU AI Act conformity-assessment patterns.
- Evolution of CNJ atos and CNIAJ-style monitoring expectations.
- Maturation of AI-specific certification and assurance schemes.
- Maturation of cross-cloud AI inventory and lineage standards.

## Benchmark table

The table below uses class-level architecture analysis for category-typical
capabilities and labels each row with a source-quality label. Specific vendor
claims that were not verified for this PR are recorded as
`SOURCE_VERIFICATION_REQUIRED`.

GovAI-relevance and build/integrate decisions are architecture choices, not
vendor judgments.

| Vendor or platform | Category | Publicly described or class-analyzed capabilities | Source quality | GovAI relevance | Build, integrate, both, or observe | Notes and verification limits |
|---|---|---|---|---|---|---|
| Microsoft Purview, Defender, Entra, M365 audit | Privacy, DLP, audit | Sensitive-data discovery and DLP across M365 estates, identity-tied policies, audit log surfaces | INTERNAL_ARCHITECTURE_ANALYSIS | Strong enrichment source where customers run on M365 | CONNECTOR_ENRICHMENT | Vendor-specific feature mapping not verified for this PR; treat detailed claims as SOURCE_VERIFICATION_REQUIRED |
| AWS Bedrock Guardrails | Hyperscaler runtime guardrails | Content filtering and policy controls around AWS Bedrock invocations | INTERNAL_ARCHITECTURE_ANALYSIS | Useful guardrail signal source for AWS-resident workloads | CONNECTOR_ENRICHMENT | Exact policy primitives, coverage scope, and limits SOURCE_VERIFICATION_REQUIRED |
| AWS CloudTrail, CloudWatch, Security Hub | Hyperscaler audit and security | Cloud-native audit logging, metric and event aggregation, posture findings | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment of AWS-side audit and posture evidence | CONNECTOR_ENRICHMENT | Field-level mapping SOURCE_VERIFICATION_REQUIRED |
| AWS Audit Manager class | Audit-readiness in AWS | Continuous control mapping to AWS-relevant frameworks, evidence collection | INTERNAL_ARCHITECTURE_ANALYSIS | Useful evidence source for AWS-resident control sets | CONNECTOR_ENRICHMENT | Successor product names and AI-coverage SOURCE_VERIFICATION_REQUIRED |
| Google Model Armor | AI security and guardrails | Class-level AI prompt and content protection around Google AI surfaces | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for Google-resident AI workloads | CONNECTOR_ENRICHMENT | Specific coverage and policy semantics SOURCE_VERIFICATION_REQUIRED |
| Google Vertex AI, Gemini Enterprise, Cloud Logging | Hyperscaler AI and audit | Hosted models, enterprise AI surfaces, cloud audit logging | INTERNAL_ARCHITECTURE_ANALYSIS | Provider-side runtime and audit signal | CONNECTOR_ENRICHMENT | Field-level mapping and AI-specific governance hooks SOURCE_VERIFICATION_REQUIRED |
| ServiceNow AI Control Tower, GRC, CMDB | Policy-first GRC and ITSM | AI inventory, control attestation, GRC workflows, CMDB integration | INTERNAL_ARCHITECTURE_ANALYSIS | Strong ITSM and GRC enrichment where customers already use ServiceNow | CONNECTOR_ENRICHMENT | Detailed AI Control Tower scope SOURCE_VERIFICATION_REQUIRED |
| IBM watsonx.governance, OpenPages | Policy-first GRC | AI-system inventory, risk workflows, control attestation in IBM stack | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment in IBM-heavy enterprises | CONNECTOR_ENRICHMENT | Feature coverage and AI-specific surfaces SOURCE_VERIFICATION_REQUIRED |
| OneTrust AI Governance | Policy-first AI governance | AI inventory, framework mapping, assessment workflows in OneTrust suite | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for customers who run OneTrust as the GRC source of truth | CONNECTOR_ENRICHMENT | Specific control surface and BR-regulator coverage SOURCE_VERIFICATION_REQUIRED |
| Credo AI | Policy-first AI governance | Risk-assessment and policy workflows oriented to AI use cases | INTERNAL_ARCHITECTURE_ANALYSIS | Useful enrichment for assessment workflows | CONNECTOR_ENRICHMENT | Specific feature set SOURCE_VERIFICATION_REQUIRED |
| Holistic AI | Policy-first AI governance | AI risk-management and assessment platform class | INTERNAL_ARCHITECTURE_ANALYSIS | Useful enrichment for assessment workflows | CONNECTOR_ENRICHMENT | Specific coverage SOURCE_VERIFICATION_REQUIRED |
| Vanta | Audit-readiness automation | Continuous control monitoring and evidence collection for SOC 2, ISO 27001, and adjacent frameworks | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for general security compliance evidence | CONNECTOR_ENRICHMENT | AI-specific coverage and BR-regulator support SOURCE_VERIFICATION_REQUIRED |
| Drata | Audit-readiness automation | Continuous compliance evidence and framework mappings | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for general security compliance evidence | CONNECTOR_ENRICHMENT | AI-specific coverage SOURCE_VERIFICATION_REQUIRED |
| Trustible | Policy-first AI governance | AI-focused governance and obligation tracking | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for obligation libraries | CONNECTOR_ENRICHMENT | Specific feature set SOURCE_VERIFICATION_REQUIRED |
| ModelOp | Model governance and operations | Model inventory, lifecycle workflows, deployment governance | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for ModelOps-heavy customers | CONNECTOR_ENRICHMENT | Specific feature coverage SOURCE_VERIFICATION_REQUIRED |
| Fiddler | Model monitoring | Drift, performance, and explainability monitoring | INTERNAL_ARCHITECTURE_ANALYSIS | Strong enrichment for monitoring signals | CONNECTOR_ENRICHMENT | Specific scope of GenAI coverage SOURCE_VERIFICATION_REQUIRED |
| Arize | Model monitoring | Drift, evaluation, and observability for ML and LLM systems | INTERNAL_ARCHITECTURE_ANALYSIS | Strong enrichment for monitoring signals | CONNECTOR_ENRICHMENT | Specific feature coverage SOURCE_VERIFICATION_REQUIRED |
| Arthur AI | Model monitoring | Performance, drift, and quality monitoring including LLM-oriented coverage | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for monitoring signals | CONNECTOR_ENRICHMENT | Specific feature coverage SOURCE_VERIFICATION_REQUIRED |
| WhyLabs | Model monitoring | Data and model quality observability | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for monitoring signals | CONNECTOR_ENRICHMENT | Specific feature coverage SOURCE_VERIFICATION_REQUIRED |
| Lakera | AI security | Prompt-injection and adversarial-input defense | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for AI-security signals | CONNECTOR_ENRICHMENT | Specific detector coverage SOURCE_VERIFICATION_REQUIRED |
| Protect AI, including Palo Alto Prisma AIRS | AI security | AI/ML supply chain and runtime defense class | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for AI-security signals | CONNECTOR_ENRICHMENT | Specific feature set SOURCE_VERIFICATION_REQUIRED |
| Robust Intelligence, including Cisco | AI security | AI risk and runtime defense class | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for AI-security signals | CONNECTOR_ENRICHMENT | Specific feature set SOURCE_VERIFICATION_REQUIRED |
| Securiti | Privacy and data governance | Sensitive-data discovery, DSR workflows, AI governance modules | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for DLP and DSR | CONNECTOR_ENRICHMENT | BR-regulator-specific coverage SOURCE_VERIFICATION_REQUIRED |
| BigID | Privacy and data governance | Sensitive-data discovery and classification | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for DLP signals | CONNECTOR_ENRICHMENT | Specific feature coverage SOURCE_VERIFICATION_REQUIRED |
| Collibra | Data governance and catalog | Data catalog, lineage, and governance workflows | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for data-catalog evidence | CONNECTOR_ENRICHMENT | AI-specific governance modules SOURCE_VERIFICATION_REQUIRED |
| Immuta | Data access governance | Data access policies and audit for analytics platforms | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for access-governance signals | CONNECTOR_ENRICHMENT | Specific feature coverage SOURCE_VERIFICATION_REQUIRED |
| Regology | Regulatory intelligence | Curated regulatory content and change tracking | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for regulatory feeds | CONNECTOR_ENRICHMENT | Coverage of BR regulators SOURCE_VERIFICATION_REQUIRED |
| Compliance.ai | Regulatory intelligence | Curated regulatory feeds and obligation mapping | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for regulatory feeds | CONNECTOR_ENRICHMENT | Coverage of BR regulators SOURCE_VERIFICATION_REQUIRED |
| TrueFoundry and AI gateway class | Runtime enforcement and AI gateways | Inline AI traffic mediation, policy enforcement, and observability | INTERNAL_ARCHITECTURE_ANALYSIS | Enrichment for runtime policy signal, complementary to GovAI hard-deny floor | CONNECTOR_ENRICHMENT | Specific feature set SOURCE_VERIFICATION_REQUIRED |
| NVIDIA NeMo Guardrails class | Runtime enforcement | Programmable conversation rails and policy hooks for LLM applications | INTERNAL_ARCHITECTURE_ANALYSIS | Useful as an in-app guardrail layer alongside native GovAI guardrails | CONNECTOR_ENRICHMENT | Specific policy semantics SOURCE_VERIFICATION_REQUIRED |
| OpenAI and Anthropic provider logs and policy surfaces | Provider-side governance | Provider-managed safety, policy, and audit surfaces around managed APIs | INTERNAL_ARCHITECTURE_ANALYSIS | Connector targets for provider-side audit and policy correlation | CONNECTOR_ENRICHMENT | Field-level mapping and retention semantics SOURCE_VERIFICATION_REQUIRED |

## Conclusion

The benchmark supports five architectural conclusions:

- GovAI's core differentiation must come from native regulatory governance,
  cryptographic evidence, Workroom-mediated human oversight, approvals, the
  hard-deny floor, BR-first legal and sensitive-data posture, and a unified
  evidence and control layer.
- Vendor stacks are enrichment connectors. They are not prerequisites for
  safe governance and are not replacements for the native core.
- GovAI must remain useful and safe without any external enterprise GRC,
  DLP, AI-security, model-monitoring, or hyperscaler governance stack.
- GovAI should not attempt to rebuild every feature of every vendor; it
  should build a focused, BR-shaped Regulatory Core and integrate signals
  from external platforms via connectors.
- Where customers already run vendor stacks, GovAI's value is to unify,
  normalize, govern, and evidence those signals inside one BR-first
  regulatory control plane, rather than displacing them.

## Relationship to other docs

- `19-build-vs-integrate-strategy.md` formalizes the build-vs-integrate
  doctrine that this benchmark supports.
- `20-target-control-catalog.md` captures the native controls the benchmark
  recommends GovAI must own.
- `21-regulatory-intelligence-operating-model.md` defines how GovAI
  monitors regulatory and vendor sources over time.
- `15-source-register.md` remains the authoritative source register for
  regulatory citations; vendor sources are tracked here at category level.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
