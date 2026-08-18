> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** NAVIGATION_AUTHORITY_GUIDE
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D0=APPROVED)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** NO — RECONCILED (§1/§2/§3/§5 rewritten to Foundation V1; §4/§6 preserved with minimal edits)
> **SOURCE_SHA256:** `1d705563493766611050cd66ab96450ec954eb84a8dd2ddf8530f7474c3b4da2` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** NAVIGATION / AUTHORITY GUIDE (D0 = APPROVED). Promulgated from the PR-0 `docs/README.md` with its baseline and hierarchy RECONCILED to Foundation V1: §1 (hierarchy of truth), §2 (reading order), §3 (tree/status) and §5 (D9 = promulgated) are rewritten; §4 (name map) and §6 (rules) are preserved with minimal edits. The former ACK/comunicado ceremony and the "Mapa vence" hierarchy are historical. This file is the documentation index; it is NOT the repository root `README.md`.
> ---

# GovAI — Índice da documentação (comece aqui)

**Toda sessão (humana ou IA) começa por este arquivo.** Ele diz onde a verdade mora, em que ordem ler, e as regras que valem para qualquer documento desta árvore.

## 1. Hierarquia de verdade (reconciliada — Foundation V1, 2026-08-18)
1. **O código + os testes + as migrações mergeados** (`git rev-parse HEAD` antes de qualquer afirmação de estado; a âncora de runtime da Foundation V1 é `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68`).
2. **O estado canônico** — `architecture/current-state.md` (SoT de implementação, evidence-first) + `architecture/foundation-v1-freeze.md` (baseline/limites/residuais da Foundation V1) + `architecture/development-roadmap.md` (fila) + `architecture/stale-docs-register.md` + `architecture/resume-playbook.md` (retomada).
3. **ADRs aceitas** — `architecture/adr/` (índice e status em `architecture/adr/ADR-INDEX.md`); registros verificados de aceitação real (M2/M2A, fora do repo) e decisões do dono registradas.
4. **O corpus de visão-alvo / doutrina candidata / planos** — `architecture/master-architecture-v0.9.md`, `architecture/plans/`, `architecture/specs/`, `architecture/registers/`, `architecture/GOVAI-MAPA-MESTRE…` (cada arquivo carrega o cabeçalho de promulgação com a sua classe de autoridade; corpo histórico preservado).
5. **Registros históricos** — `architecture/GOVAI-COMUNICADO…`, `architecture/execution/pr0/`, `architecture/consolidation-plan-2026-06.md`, `history/`.
6. **Docs comerciais fora do repo** — só para assunto comercial; claims seguem `architecture/claims-policy.md`.

Em conflito: o nível menor vence o maior. Afirmações de **mercado** carregam fonte+data e **expiram trimestralmente** (Mapa §0.6 / Dossiê §5); afirmações de **capacidade** seguem `architecture/claims-policy.md`. Nenhum documento afirma paridade universal de provedores, exactly-once, certificação ou conformidade regulatória.

## 2. Comece aqui, por tarefa
| Se você vai… | Leia nesta ordem |
|---|---|
| Iniciar qualquer sessão | `architecture/resume-playbook.md` (§1 obtém o HEAD atual dinamicamente; §5 checklist; §9 modelo de autorização) → `architecture/current-state.md` → `architecture/development-roadmap.md` |
| Implementar um item | `architecture/development-roadmap.md` (fila) → `architecture/current-state.md` (estado) → a spec do item em `architecture/specs/` ou `architecture/registers/GOVAI-IMPLEMENTATION-QUEUE…` (com o cabeçalho de status) → re-ancore âncoras na fonte |
| Auditar estado | `architecture/current-state.md` → `architecture/foundation-v1-freeze.md` (residuais R1–R16) → `architecture/stale-docs-register.md` |
| Entender o produto | Mapa Mestre §1/§4 (tese; visão-alvo) → `architecture/plans/GOVAI-MASTER-PLAN-APPLICATION…` → `architecture/master-architecture-v0.9.md` → Dossiê de Mercado |
| Trabalhar UI (não iniciada) | `architecture/development-roadmap.md` (próxima lane: UI/UX V1 Foundation, restrições) → `architecture/plans/GOVAI-UI-MASTER-PLAN…` |
| Comercial / pitch | `architecture/claims-policy.md` → Dossiê de Mercado (§3–§5, fontes expiram) |

## 3. A árvore (o que mora onde)
| Caminho | Conteúdo | Status |
|---|---|---|
| `architecture/current-state.md` · `foundation-v1-freeze.md` · `development-roadmap.md` · `stale-docs-register.md` · `resume-playbook.md` | SoT de estado, baseline Foundation V1, fila, registro de defasagem, retomada | CANÔNICOS (nível 2) |
| `architecture/adr/` (+ `ADR-INDEX.md`) | ADR-001..014, 016..032 (status individual no índice); ADR-016..019 e 029..031 promulgadas por M3 | doutrina (status por arquivo) |
| `architecture/master-architecture-v0.9.md` | Arquitetura-alvo v0.9 (2026-05) | CANDIDATE_TARGET_ARCHITECTURE |
| `architecture/claims-policy.md` · `security/threat-model.md` · `operations/artifact-hygiene.md` | Doutrina D9 | ACCEPTED_ARCHITECTURAL_DOCTRINE |
| `architecture/specs/` | Specs: AuditBridge✅ e CNPJ✅ (registros de implementação); Shadow AI, MCP Gateway, Enterprise+Anchoring (target design aceito, não implementados); SPEC v2.1 (histórica); `future/` (visão-alvo); harness H1 v2 + coverage map; B3 | ver cabeçalhos |
| `architecture/plans/` | Master Plan, Execution Manual, UI Plan (PLAN_TARGET); UI Consult (histórico) | visão-alvo (corpo de jul/2026) |
| `architecture/registers/` | Índice-Mestre, Queue, Gap, Source, Catalog, Consistency | snapshots históricos / queue com adendo no cabeçalho |
| `architecture/GOVAI-MAPA-MESTRE…` | Mapa v1.1 (tese e plano de jul/2026; hierarquia/fila SUPERADAS por este README e pelo roadmap) | PLAN_TARGET / histórico |
| `architecture/GOVAI-COMUNICADO…` · `architecture/execution/pr0/` · `architecture/consolidation-plan-2026-06.md` · `history/prompts/` | Registros de execução/promulgação e história | HISTÓRICO |
| `architecture/GOVAI-DOSSIE-MERCADO…` | 4 líderes estudados; rótulos de claims no cabeçalho | COMMERCIAL_EVALUATION (fontes expiram trim.) |
| `architecture/d9-promulgation-manifest.md` | Proveniência do corpus promulgado (hashes de fonte/repo, classes) | PROVENIÊNCIA |
| `architecture/canonical/` · `execution/pr2/` · `regulatory/` · `contracts/` · `runbooks/` · `operations/admin-bridge-cli-tools.md` | Docs pré-existentes (ADP v4.2, PR2, regulatório, contratos, runbooks) | ver `stale-docs-register.md` |
| `codex-*` · `govai_runtime_patch_1_pre_merge_v2.md` (raiz de `docs/`) | Artefatos legados de revisão/prompt | LEGADO — inventariado; realocação = PR de higiene separado |

## 4. Mapa de nomes (handoff → repo)
`00-consolidation-plan…` → `architecture/consolidation-plan-2026-06.md` · `01..04-spec/design-…` → `architecture/specs/` (sem prefixo numérico) · `05..07-adr-…` → `architecture/adr/ADR-029/030/031-…` · `GOVAI-*-FABLE5_*` → `architecture/plans/` ou `architecture/registers/` (nomes originais) · `GOVAI-SPECS-ENTERPRISE_ANCHORING…` → `architecture/specs/specs-enterprise-anchoring.md`.

## 5. Doutrina D9 — PROMULGADA (M3, 2026-08-18)
Os 11 documentos do espelho estão nesta árvore nos destinos de `architecture/execution/pr0/D9-DOCTRINE-MANIFEST.md`, com as classes de autoridade D0–D16 registradas em cada cabeçalho e em `architecture/d9-promulgation-manifest.md`. As referências no código (`apps/api/src/db/migrations/0025_…sql`, `packages/core-audit/src/capture.ts`) resolvem. Mudanças futuras na doutrina D9 exigem um movimento dedicado de arquitetura/doutrina.

## 6. Regras para documentos novos
Nascem **nesta árvore** (nunca fora do VCS);  passam pelo **gate duplo** (Mapa §0.5 — princípio mantido) se propõem feature; carregam o cabeçalho de promulgação/estado (modelo em `architecture/d9-promulgation-manifest.md`); claims de capacidade seguem `architecture/claims-policy.md` e claims de mercado seguem Mapa §0.6. Regra A2: sem `Co-Authored-By`/`Generated-with` em commits/PRs/artefatos.
