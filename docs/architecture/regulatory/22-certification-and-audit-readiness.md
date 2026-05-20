# Certification and Audit Readiness

## Purpose

Define GovAI's target architecture for certification-readiness and
audit-readiness. The document captures what GovAI can prepare natively,
which external services or qualified human review are required, and what
GovAI explicitly does not claim.

## Non-goals

- Not a claim that GovAI is certified by any external body.
- Not a claim that GovAI is approved by any regulator.
- Not a claim that any control of GovAI's customers is certified.
- Not a claim of guaranteed compliance with LGPD, ANPD, CNJ, Bacen, CVM,
  SUSEP, ANS, CFM, OAB, EU AI Act, GDPR, ISO 42001, or NIST AI RMF.
- Not a claim that evidence prepared by GovAI is automatically admissible
  in court.
- Not a claim that GovAI substitutes a DPO, lawyer, auditor, perito,
  medical or financial professional, magistrate, or court staff.

## Legal and professional boundaries

- This document is technical and product architecture, not legal advice.
- Legal interpretation requires qualified counsel.
- Audit opinion is issued by qualified auditors, not by GovAI.
- Certification is issued by external certification bodies under the
  rules of the relevant scheme; GovAI does not issue certification.
- Sector-specific decisions (judicial, medical, financial) remain with
  qualified professionals and the relevant authorities.

## Certification-readiness versus certification

Certification-readiness means the customer can present documentation,
evidence, and controls to an external certification body in a structured,
defensible form. It does not mean the certification is granted.

A certification decision depends on:

- the external certification body and its scheme criteria;
- the customer's own organizational policies and processes;
- qualified professional review;
- factors outside GovAI's product scope.

## Audit-readiness versus audit opinion

Audit-readiness means the customer can give an external auditor a complete
and reproducible evidence package over a defined scope. It does not mean
that the auditor has issued an opinion.

An audit opinion depends on:

- the external auditor and its applicable standards;
- the auditor's own evidence evaluation and tests;
- qualified professional review of evidence;
- factors outside GovAI's product scope.

## CNJ and Sinapses readiness

- GovAI does not claim CNJ certification.
- GovAI does not claim that any tribunal has accepted a GovAI deployment.
- GovAI does not claim that evidence prepared by GovAI is automatically
  accepted by any court.
- GovAI does claim to prepare BR-judiciary-shaped controls, evidence,
  reports, and dossiers per `05-cnj-judiciary-mapping.md` and
  `25-cnj-sinapses-readiness.md`.

## ISO 42001 readiness

- GovAI does not claim ISO 42001 certification.
- GovAI does claim to support an ISO 42001-shaped management-system
  control mapping aligned with the catalog in
  `20-target-control-catalog.md`.
- ISO 42001 certification is issued by external certification bodies and
  remains outside GovAI's product scope.

## LGPD and ANPD accountability readiness

- GovAI does not guarantee LGPD compliance.
- GovAI does support ANPD-aligned accountability evidence, including
  legal-basis records, DSR workflow, RIPD records, incident workflow,
  retention engine, and sensitive-category controls.
- Final accountability for LGPD posture rests with the controller.

## EU AI Act readiness

- GovAI does not assert EU AI Act conformity assessment.
- GovAI does support EU AI Act-shaped controls as future overlays over the
  BR-first core.
- Conformity assessment, where applicable, is performed by external
  bodies under the EU regime.

## GDPR readiness

- GovAI does not assert GDPR adequacy or supervisory-authority acceptance.
- GovAI does support GDPR-aligned legal-basis, DSR, RIPD/DPIA, and
  cross-border-transfer evidence.

## ICP-Brasil and RFC 3161 readiness

- GovAI does not act as an ICP-Brasil certificate authority.
- GovAI does not act as an RFC 3161 timestamp authority.
- GovAI does integrate with ICP-Brasil providers and RFC 3161 TSAs as
  external services to strengthen evidence integrity.
- Acceptance of timestamped or signed evidence by a court, regulator, or
  auditor remains an external decision.

## Marco Civil and OAB readiness

- GovAI does support evidence-chain controls per
  `04-marco-civil-mapping.md` and `06-evidence-chain-custody.md`.
- GovAI does support OAB-sector-shaped controls per
  `10-sector-legal-mapping.md`.
- Judicial admissibility and professional-secrecy decisions remain with
  qualified counsel and the courts.

## Health and financial sector readiness

- GovAI does not act as a medical device, a health-record system, a
  telemedicine platform, or a clinical decision maker.
- GovAI does not provide medical advice, financial advice, or legal
  advice.
- GovAI does support sector-shaped controls per
  `08-sector-financial-mapping.md` and `09-sector-health-mapping.md`.
- Sector regulators retain authority over acceptance of any specific
  customer posture.

## Evidence bundle readiness

- GovAI can prepare a verifiable evidence bundle that includes audit
  events, payload hashes, control records, approval evidence,
  classification events, and optional TSA and ICP-Brasil artifacts.
- Bundle readiness does not guarantee admissibility in court.
- Final admissibility decisions rest with the court and qualified
  counsel.

## Professional review model

- DPO review for legal-basis decisions, DSR, RIPD, and incident
  notifications.
- Legal counsel review for privilege, secrecy, evidence-bundle export,
  and litigation matters.
- Auditor review for evidence sufficiency and audit-opinion issuance.
- Perito review for forensic and court-bound evidence packages.
- Medical professional review for clinical decisions that touch health
  data; GovAI does not act as a clinical decision maker.
- Financial compliance specialist review for sector matters that touch
  Bacen, CVM, SUSEP, or ANS obligations.

## External auditor and perito model

- External auditor: independent qualified party with audit-opinion
  authority. GovAI prepares evidence packages but does not issue opinions.
- Perito: court-appointed or party-appointed expert; GovAI may produce
  evidence bundles and integrity proofs for perito review.
- Customer remains the data controller in LGPD terms and is responsible
  for selecting and engaging external auditors and peritos.

## Customer responsibility

- Define customer-specific policies, legal bases, jurisdictions, and
  sector overlays.
- Engage qualified professionals.
- Approve binding interpretations.
- Review readiness dossiers before submission to a certification body or
  regulator.
- Maintain custody of original records where applicable.

## GovAI responsibility

- Provide a native, BR-first regulatory core with cryptographic evidence
  and Workroom-mediated approvals.
- Produce structured readiness dossiers per target.
- Capture qualified-reviewer decisions and link them to evidence.
- Maintain source-disciplined regulatory mapping.
- Refrain from claims of certification, guaranteed compliance, or
  automatic admissibility.

## Provider responsibility

- Maintain documented governance posture for the AI provider service.
- Maintain documented data processing and retention behavior.
- Disclose policy and audit surfaces that customers can consume through
  connectors.
- Cooperate with customer audits where the contractual scope allows.

## Readiness table

Each row records a readiness target, the native GovAI capability required,
the external service or process required, the evidence artifacts produced,
the current state, the criteria under which the target becomes
audit-ready, the criteria under which the target becomes certification-
ready, and the external dependency.

| Readiness target | Native GovAI capability required | External service or process required | Evidence artifacts | Current state | Turns audit-ready when | Turns certification-ready when | External dependency |
|---|---|---|---|---|---|---|---|
| CNJ and Sinapses readiness | Judiciary AI registry, risk classification, judicial-secrecy classifier, evidence bundle, periodic-review records | Court or tribunal adoption process, qualified-counsel and perito review | Registry records, risk classifications, judicial-secrecy events, evidence bundles, review tasks | REQUIRED_NATIVE_CAPABILITY for the judiciary registry and workflow; IMPLEMENTED_FOUNDATIONAL_CONTROL for audit-chain primitives | Native registries, risk engine, judicial-secrecy classifier, evidence bundle, and tests exist and are cited in `05-cnj-judiciary-mapping.md` and `25-cnj-sinapses-readiness.md` | External CNJ scheme or tribunal acceptance occurs through processes outside this product | External authority and qualified-counsel review |
| ISO 42001 readiness | AI management-system controls across `20-target-control-catalog.md` domains 1, 2, 3, 4, 5, 6, 7, and 18 | External certification body and scheme | Control records, evidence, lifecycle events, management reviews | REQUIRED_NATIVE_CAPABILITY for full management-system, IMPLEMENTED_FOUNDATIONAL_CONTROL for audit and Workroom primitives | All ISO 42001-mapped controls have schema, evidence, and tests cited | External certification body decision occurs outside this product | External certification body |
| LGPD and ANPD accountability readiness | DSR workflow, RIPD workflow, incident workflow, retention engine, sensitive-category controls, legal-basis records | DPO and qualified counsel | DSR records, RIPD records, incident records, retention decisions, legal-basis records | REQUIRED_NATIVE_CAPABILITY for the workflows; IMPLEMENTED_FOUNDATIONAL_CONTROL for audit, RLS, and envelope encryption | All LGPD-mapped controls have schema, evidence, and tests cited | External regulatory acceptance decisions occur outside this product | DPO and qualified counsel |
| Marco Civil and evidence readiness | HMAC-chained audit, canonical bytes, sequence-numbered chain, append-only triggers, payload hashing, evidence bundle, optional TSA integration | RFC 3161 TSA, ICP-Brasil providers when applicable, qualified counsel | Chained audit events, payload hashes, evidence bundles, timestamp tokens, signature artifacts | IMPLEMENTED_FOUNDATIONAL_CONTROL for the audit-chain primitives; NATIVE_ENHANCEMENT_REQUIRED for bundle and export | Bundle generation, court export, and TSA integration exist and are cited in `06-evidence-chain-custody.md` | Court acceptance is outside this product | RFC 3161 TSA and ICP-Brasil providers |
| OAB and legal-sector readiness | Privilege classifier, secrecy classifier, restricted access posture, evidence bundle | Qualified counsel, OAB-aware policies | Classification events, restricted-access decisions, evidence bundles | REQUIRED_NATIVE_CAPABILITY | Classifiers, access posture, and tests exist and are cited in `10-sector-legal-mapping.md` | External professional review is outside this product | Qualified counsel |
| Health-sector readiness | Sensitive-category controls for health, biometric, and genetic data, incident workflow | Medical professional review, ANS and CFM regulatory acceptance | Classification events, incident records, retention decisions | REQUIRED_NATIVE_CAPABILITY | Classifiers, schema, and tests exist and are cited in `09-sector-health-mapping.md` | External regulatory acceptance is outside this product | Medical professional review |
| Financial-sector readiness | Provider posture, prohibited-use and high-risk workflows, retention engine, incident workflow | Bacen, CMN, CVM, SUSEP regulatory acceptance, financial compliance specialist review | Provider records, workflow events, retention decisions, incident records | REQUIRED_NATIVE_CAPABILITY | Schema, evidence, and tests exist and are cited in `08-sector-financial-mapping.md` | External regulatory acceptance is outside this product | Financial compliance specialist review |
| EU AI Act readiness | Overlay mapping over the BR-first core, conformity-assessment-shaped evidence | EU notified body or competent authority | Overlay records, mapped obligations, evidence indexes | REQUIRED_NATIVE_CAPABILITY | Overlay schema, mapped obligations, and tests exist and are cited in the future EU AI Act mapping doc | External conformity assessment is outside this product | EU notified body or competent authority |
| GDPR readiness | Overlay mapping over the BR-first core, DSR, RIPD/DPIA workflows | Supervisory authority and DPO review | Overlay records, DSR records, DPIA records | REQUIRED_NATIVE_CAPABILITY | Overlay schema and tests exist and are cited in the future GDPR mapping doc | External supervisory-authority decisions are outside this product | Supervisory authority |
| ICP-Brasil and RFC 3161 readiness | Integration points, evidence binding, optional signature support | ICP-Brasil providers, RFC 3161 TSA, qualified counsel | Signature artifacts, timestamp tokens, integrity records | EXTERNAL_SERVICE_REQUIRED for the signing and timestamping authorities; NATIVE_ENHANCEMENT_REQUIRED for GovAI integration | Integration points and tests exist and are cited in `06-evidence-chain-custody.md` | External provider and external authority decisions are outside this product | ICP-Brasil providers and RFC 3161 TSAs |

## Forbidden framings in this document

- "Certified" claims about GovAI, customers, or providers.
- "Guaranteed" claims about compliance, judicial validity, or
  admissibility.
- "Automatic" claims about regulatory outcomes.
- Replacement framings for lawyers, DPOs, auditors, peritos, medical
  professionals, financial compliance specialists, magistrates, or court
  staff.
- "First", "leader", "FedRAMP", or "conformity-assessed" claims about
  GovAI without verified primary sources.

## Relationship to other docs

- `15-source-register.md` for source-quality posture.
- `20-target-control-catalog.md` for the control list.
- `21-regulatory-intelligence-operating-model.md` for monthly readiness
  scoring inputs.
- `23-regulatory-core-roadmap.md` for implementation sequencing.
- `25-cnj-sinapses-readiness.md` for the judiciary-specific posture.

## Relationship to issues

Relates to #59.

Relates to #33.

#59 remains open for implementation follow-up.

Umbrella tracker #33 remains active.
