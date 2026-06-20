# Source Register

## Purpose

This file tracks the primary and official sources used by GovAI's regulatory
mapping. For each source it records the verification status, official
location, review state, limitations, and the next verification action.

It is a foundation register seeded from the CP1 read-only research/preflight.
It is not exhaustive. Every later detailed mapping PR must update this register
and may not map a requirement against a source that is not recorded here.

This is a technical document. It is not legal advice and not a compliance
guarantee.

## Source status taxonomy

- **CONFIRMED_PRIMARY_SOURCE** — the source was confirmed from a primary or
  official location and is current.
- **PARTIAL_PRIMARY_SOURCE** — an official source exists and is identified, but
  some detail (exact instrument URL, current consolidated text, or scope) was
  not fully confirmed.
- **NEEDS_SOURCE_VERIFICATION** — the source, its status, or its applicability
  could not be confirmed from a primary source.
- **NOT_CURRENT** — the instrument exists but is not in force (for example, a
  bill that has not been enacted).
- **HISTORICAL / REVOKED** — the instrument existed and is no longer in force.
- **REFERENCE_ONLY** — a foreign or external framework used for reference and
  readiness, not treated as automatically applicable Brazilian law.
- **PAYWALLED_LIMITED_DETAIL** — the official standard exists but its full text
  is paywalled; only title, status, and control-family-level relevance are used.

## Required fields for each source

Each source records: source id; family; title; authority; jurisdiction;
status; official URL; last reviewed date; CP1 finding; mapping relevance;
limitations; next verification action.

In this seed register the compact fields appear in the per-family tables; the
narrative fields (CP1 finding, mapping relevance, limitations, next
verification action) appear in the per-family notes below each table.
Jurisdiction is given by the family heading. Unless a row states otherwise,
the last reviewed date for every entry is **2026-05-19**.

## Seeded sources

### Brazil — data protection / ANPD

| ID | Source | Authority | Status | Official URL |
|---|---|---|---|---|
| BR-DP-01 | LGPD — Lei 13.709/2018 | Congresso Nacional / Planalto | CONFIRMED_PRIMARY_SOURCE | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm |
| BR-DP-02 | Resolução CD/ANPD nº 15/2024 — incident communication | ANPD | CONFIRMED_PRIMARY_SOURCE | https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-aprova-o-regulamento-de-comunicacao-de-incidente-de-seguranca |
| BR-DP-03 | Resolução CD/ANPD nº 2/2022 — small processing agents | ANPD | PARTIAL_PRIMARY_SOURCE | https://www.gov.br/anpd/ |
| BR-DP-04 | Resolução CD/ANPD nº 4/2023 — sanction dosimetry | ANPD | PARTIAL_PRIMARY_SOURCE | https://www.gov.br/anpd/ |
| BR-DP-05 | ANPD AI posture — regulatory sandbox and priority map | ANPD | PARTIAL_PRIMARY_SOURCE | https://www.gov.br/anpd/ |

Notes:

- **BR-DP-01** — CP1 finding: well-established public law; arts. 5, 6, 7, 9,
  11, 14, 18-22, 37, 38, 46, 48, 49, 50 are the mapping focus. Relevance: the
  central data-protection mapping (file 01). Limitations: exact article text
  not quoted in CP1. Next action: quote exact article text from Planalto in
  PR-B.
- **BR-DP-02** — CP1 finding: confirmed; ANPD and data-subject notification
  within 3 business days, doubled for small agents. Relevance: incident
  notification mapping (file 01). Next action: capture the DOU primary
  citation for the regulation in PR-B.
- **BR-DP-03 / BR-DP-04** — CP1 finding: identified but not freshly fetched.
  Relevance: small-agent obligations and sanction context. Next action:
  confirm exact instrument URLs and current text in PR-B.
- **BR-DP-05** — CP1 finding: ANPD runs an AI + data-protection regulatory
  sandbox and lists AI as a 2026-2027 enforcement priority; this is soft-law /
  supervisory activity, **not** a binding AI-specific regulation. Next action:
  re-verify before any mapping relies on it.

### Brazil — internet, digital evidence, and signatures

| ID | Source | Authority | Status | Official URL |
|---|---|---|---|---|
| BR-NET-01 | Marco Civil da Internet — Lei 12.965/2014 | Congresso Nacional / Planalto | CONFIRMED_PRIMARY_SOURCE | https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2014/lei/l12965.htm |
| BR-NET-02 | Lei 11.419/2006 — electronic judicial process | Congresso Nacional / Planalto | CONFIRMED_PRIMARY_SOURCE | https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2006/lei/l11419.htm |
| BR-NET-03 | MP 2.200-2/2001 — ICP-Brasil | Presidência / Planalto | CONFIRMED_PRIMARY_SOURCE | https://www.planalto.gov.br/ccivil_03/mpv/antigas_2001/2200-2.htm |
| BR-NET-04 | Lei 14.063/2020 — electronic signatures | Congresso Nacional / Planalto | CONFIRMED_PRIMARY_SOURCE | https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2020/lei/l14063.htm |
| BR-NET-05 | CPC — Lei 13.105/2015 — civil procedure evidence | Congresso Nacional / Planalto | CONFIRMED_PRIMARY_SOURCE | https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2015/lei/l13105.htm |
| BR-NET-06 | RFC 3161 — trusted timestamping | IETF | CONFIRMED_PRIMARY_SOURCE | https://www.rfc-editor.org/rfc/rfc3161 |
| BR-NET-07 | ABNT NBR ISO/IEC 27037 — digital evidence handling | ABNT | PAYWALLED_LIMITED_DETAIL | https://www.abnt.org.br/ |
| BR-NET-08 | ABNT NBR ISO/IEC 27042 — digital evidence analysis | ABNT | PAYWALLED_LIMITED_DETAIL | https://www.abnt.org.br/ |

Notes:

- **BR-NET-01 to BR-NET-05** — CP1 finding: well-established public law.
  Relevance: records/logs, digital signatures, electronic documents, and the
  evidence framework (files 04 and 06). CPC evidence provisions are used for
  technical mapping only, not procedural legal opinion. Next action: quote
  exact provisions from Planalto in PR-B.
- **BR-NET-06** — CP1 finding: freely available IETF RFC. Relevance: trusted
  timestamping for the evidence chain (file 06).
- **BR-NET-07 / BR-NET-08** — CP1 finding: standards exist; full text is
  paywalled. Limitations: clause text must not be fabricated. Next action: map
  at control-family level only, citing the official ABNT catalogue.

### Brazil — taxpayer registry (CNPJ)

| ID | Source | Authority | Status | Official URL |
|---|---|---|---|---|
| BR-RFB-01 | IN RFB nº 2.229/2024 — alphanumeric CNPJ | Receita Federal do Brasil | CONFIRMED_PRIMARY_SOURCE | https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj |

Notes:

- **BR-RFB-01** — CONFIRMED_PRIMARY_SOURCE. Instrução Normativa RFB nº 2.229,
  de 15 de outubro de 2024, introduces the **alphanumeric CNPJ**: the 12 base
  positions become `[0-9A-Z]` while the 2 check digits stay numeric, with the DV
  computed by mod-11 over each character's value `ASCII − 48`. The algorithm was
  confirmed against the official Serpro/RFB technical material — the CNPJ
  documents page above plus the official reference-implementation bundle
  (`codigos-cnpj.zip`, `src/typescript/cnpj.ts` + `src/typescript/test.ts`).
  `packages/dlp-br/src/baseline-detectors.ts` (`isValidCnpj`) was verified
  **checksum-identical** to that official validator across every official
  reference case and all single-character mutations (EP-007 precondition #2).
  Relevance: the `cnpj` baseline DLP detector (files 07 and 24). Detection is
  uppercase-only by design (D1); legacy numeric CNPJs remain a strict subset.

### CNJ / judiciary

| ID | Source | Authority | Status | Official URL |
|---|---|---|---|---|
| BR-JUD-01 | CNJ Resolução 332/2020 — AI in the Judiciary | CNJ | HISTORICAL / REVOKED | https://atos.cnj.jus.br/atos/detalhar/3429 |
| BR-JUD-02 | CNJ Resolução 615/2025 — AI development, use, governance | CNJ | CONFIRMED_PRIMARY_SOURCE | https://atos.cnj.jus.br/atos/detalhar/6001 |
| BR-JUD-03 | CNJ Resolução 674/2026 — amendment to Resolução 615/2025 | CNJ | PARTIAL_PRIMARY_SOURCE | https://atos.cnj.jus.br/ |
| BR-JUD-04 | "CNJ 605" — claimed CNJ act | CNJ (claimed) | NEEDS_SOURCE_VERIFICATION | https://atos.cnj.jus.br/ |
| BR-JUD-05 | CNIAJ — National Committee on Judiciary AI | CNJ | CONFIRMED_PRIMARY_SOURCE | https://www.cnj.jus.br/sistemas/plataforma-sinapses/comite-nacional-de-inteligencia-artificial-do-judiciario-cniaj/ |
| BR-JUD-06 | Judiciary AI ecosystem — DataJud, Codex, Sinapses, PJe, Justiça 4.0 | CNJ | PARTIAL_PRIMARY_SOURCE | https://www.cnj.jus.br/ |

Notes:

- **BR-JUD-01** — CP1 finding: confirmed and **revoked** by Resolução
  615/2025; treat as a historical baseline only.
- **BR-JUD-02** — CP1 finding: confirmed current judiciary AI governance
  baseline; de 11 March 2025, in force 14 July 2025; covers risk
  classification, mandatory audits, generative-AI rules, human supervision,
  transparency, privacy by design and by default, impact assessments, and the
  CNIAJ. Relevance: the judiciary mapping (file 05). Next action: cite the
  official CNJ resolution text in PR-C.
- **BR-JUD-03** — CP1 finding: existence and amendment relationship to
  Resolução 615/2025 identified; de 25 March 2026; changes the CNIAJ
  composition. Limitations: the CNJ atos detail URL and the exact amended
  article number were not confirmed. Next action: confirm the CNJ atos detail
  URL and the exact amended article in PR-C before downstream judiciary
  mapping treats this source as fully verified.
- **BR-JUD-04** — CP1 finding: no CNJ act numbered 605 was confirmed as an
  AI-governance norm. It must not be treated as applicable AI-governance law.
  Next action: search the CNJ atos system for any act numbered 605 and confirm
  or discard relevance.
- **BR-JUD-05 / BR-JUD-06** — CP1 finding: CNIAJ and the judiciary-tech
  programs are real; "Codex" needs independent confirmation of its exact role.
  Next action: verify each program against a CNJ primary source in PR-C.

### Sector

| ID | Source | Authority | Status | Official URL |
|---|---|---|---|---|
| BR-SEC-01 | Resolução CMN nº 4.893/2021 — financial cybersecurity / cloud | Bacen / CMN | PARTIAL_PRIMARY_SOURCE | https://www.bcb.gov.br/ |
| BR-SEC-02 | Resolução BCB nº 85/2021 — cybersecurity policy | Bacen | PARTIAL_PRIMARY_SOURCE | https://www.bcb.gov.br/ |
| BR-SEC-03 | Resolução CVM nº 35/2021 — suitability | CVM | PARTIAL_PRIMARY_SOURCE | https://www.gov.br/cvm/ |
| BR-SEC-04 | Circular SUSEP nº 638/2021 — insurer cybersecurity | SUSEP | PARTIAL_PRIMARY_SOURCE | https://www.gov.br/susep/ |
| BR-SEC-05 | Resolução CFM nº 2.314/2022 — telemedicine | CFM | CONFIRMED_PRIMARY_SOURCE | https://portal.cfm.org.br/ |
| BR-SEC-06 | CFM AI-specific norm | CFM | NEEDS_SOURCE_VERIFICATION | https://portal.cfm.org.br/ |
| BR-SEC-07 | ANS health-data / governance rules | ANS | NEEDS_SOURCE_VERIFICATION | https://www.gov.br/ans/ |
| BR-SEC-08 | Recomendação CFOAB nº 001/2024 — AI in legal practice | OAB (Conselho Federal) | CONFIRMED_PRIMARY_SOURCE | https://www.oab.org.br/noticia/62704/oab-aprova-recomendacoes-para-uso-de-ia-na-pratica-juridica |
| BR-SEC-09 | Lei 8.906/1994 and Código de Ética e Disciplina da OAB | OAB / Congresso Nacional | PARTIAL_PRIMARY_SOURCE | https://www.oab.org.br/ |

Notes:

- **BR-SEC-01 to BR-SEC-04** — CP1 finding: identified from established
  knowledge, not freshly fetched. Relevance: financial-sector profile (file
  08). Next action: confirm exact instrument URLs, current text, and cloud /
  outsourcing scope in PR-C.
- **BR-SEC-05** — CP1 finding: telemedicine resolution confirmed.
- **BR-SEC-06** — CP1 finding: a binding AI-specific CFM norm was not
  confirmed. Next action: verify whether one exists before health-sector
  mapping relies on it.
- **BR-SEC-07** — CP1 finding: ANS health-data and governance scope not
  confirmed. Next action: verify in PR-C.
- **BR-SEC-08** — CP1 finding: confirmed; a recommendation (soft-law) covering
  applicable legislation, confidentiality and privacy, ethical practice, and
  client communication on generative-AI use. Relevance: legal-sector profile
  (file 10).
- **BR-SEC-09** — CP1 finding: the statute and code underpin professional
  secrecy; not freshly verified. Next action: confirm current text in PR-C.

### International reference frameworks

| ID | Source | Authority | Status | Official URL |
|---|---|---|---|---|
| INT-01 | ISO/IEC 42001 — AI management system | ISO/IEC | PAYWALLED_LIMITED_DETAIL | https://www.iso.org/ |
| INT-02 | ISO/IEC 27001 — information security management | ISO/IEC | PAYWALLED_LIMITED_DETAIL | https://www.iso.org/ |
| INT-03 | ISO/IEC 27701 — privacy information management | ISO/IEC | PAYWALLED_LIMITED_DETAIL | https://www.iso.org/ |
| INT-04 | ISO/IEC 23894 — AI risk management guidance | ISO/IEC | PAYWALLED_LIMITED_DETAIL | https://www.iso.org/ |
| INT-05 | NIST AI RMF 1.0 — AI Risk Management Framework | NIST | CONFIRMED_PRIMARY_SOURCE | https://www.nist.gov/itl/ai-risk-management-framework |
| INT-06 | NIST AI 600-1 — Generative AI Profile | NIST | CONFIRMED_PRIMARY_SOURCE | https://www.nist.gov/itl/ai-risk-management-framework |
| INT-07 | GDPR — Regulation (EU) 2016/679 | European Union | REFERENCE_ONLY | https://eur-lex.europa.eu/eli/reg/2016/679/oj |
| INT-08 | EU AI Act — Regulation (EU) 2024/1689 | European Union | REFERENCE_ONLY | https://eur-lex.europa.eu/eli/reg/2024/1689/oj |
| INT-09 | PL 2338/2023 — proposed Brazilian AI legal framework | Congresso Nacional | NOT_CURRENT | https://www25.senado.leg.br/web/atividade/materias/-/materia/157233 |

Notes:

- **INT-01 to INT-04** — CP1 finding: the standards exist; full clause text is
  paywalled. Limitations: clause text must not be fabricated. Next action: map
  at management-system / control-family level using official ISO catalogue
  pages; confirm each standard's exact catalogue URL and edition year in PR-D.
- **INT-05 / INT-06** — CP1 finding: confirmed; freely available from NIST.
  Relevance: the NIST mapping (file 03), including the Govern / Map / Measure /
  Manage functions and the generative-AI risk profile.
- **INT-07 / INT-08** — CP1 finding: confirmed as foreign law; treated as
  reference and readiness only, not automatically applicable Brazilian law.
- **INT-09** — CP1 finding: PL 2338/2023 is a bill, Senate-approved in
  December 2024 and pending in the Câmara dos Deputados as of 2026; it is not
  enacted law. Relevance: the readiness file (file 12). Next action: re-verify
  status before each PR that references it.

## Source maintenance rules

- Every detailed regulatory mapping PR must update this register.
- Every source must carry a last reviewed date; stale dates trigger
  re-verification before the source is relied upon.
- If a source is uncertain, dependent mapped requirements must use the
  `NEEDS_SOURCE_VERIFICATION` status.
- No paywalled standard clause text may be invented; only official title,
  status, and control-family-level relevance may be used.
- A regulatory requirement may not be mapped against a source that is absent
  from this register.

Relates to #59.

Relates to #33.

Umbrella tracker #33 remains active.
