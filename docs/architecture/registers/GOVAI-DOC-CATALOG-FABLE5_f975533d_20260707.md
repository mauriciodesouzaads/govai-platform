> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_SNAPSHOT
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-07 at f975533d)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (register snapshot; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (two absolute local paths redacted per M3 §51; body otherwise byte-preserved incl. the PR-0 header)
> **SOURCE_SHA256:** `911d49c9a53e32811b7930416482c54b70033ab0750644fd2fce57013bc3a789` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL SNAPSHOT — the 2026-07-07 total documentation catalogue at f975533d ("Fase A do briefing #7"). Its dispositions were consumed: the D9 doctrine it lists as "[MIRROR] — versionar" is promulgated in this tree; the README status block, the four canonicals and the resume playbook have since been rewritten (this movement and PRs #121/#122/#124/#127/#130); the "rev43" operation-state reference is superseded by later state rolls. Line-count and location facts are frozen at f975533d. Two bounded privacy edits (M3 §51): the two absolute local paths of the owner's audit checkout and handoff directory were replaced by neutral labels; home-relative (`~/`) mentions are unchanged.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** REFERÊNCIA — disposições de catálogo permanecem (arquivar/atualizar/promover)
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Este PR executa as promoções (D9 e handoff→repo) que o catálogo prescreve.
> **ORIGEM:** handoff to-chat/
> ---

# GOVAI — CATÁLOGO TOTAL DE DOCUMENTAÇÃO (Fase A do briefing #7)

**Base de código:** `f975533d122afab251742c9459a12acc095dd8fb` (snapshot `git archive` verificado). **Autor:** Fable 5 / Claude Code, 2026-07-07. **Método:** descoberta por `find`/`ls`/`wc`/`diff` reais em 4 locais + leitura triada (§1.5 privacidade aplicada — nenhum documento pessoal irrelevante foi aberto). Classificação: `[VISÃO-ALVO AUTORITATIVA]` · `[IMPLEMENTAÇÃO ATUAL]` · `[HISTÓRICO — NÃO NORMATIVO]` · `[DESATUALIZADO — CÓDIGO É ÁRBITRO]` · `[REDUNDANTE]` · `[PRECISA DE VERIFICAÇÃO]`. Leitura: `LIDO` (integral), `LIDO-PARCIAL` (estrutura+seções-chave), `CATALOGADO` (só inventariado).

## 0. Locais vasculhados — o mapa com ausências visíveis (§1.4)

| Local | Resultado |
|---|---|
| 1. Repo `docs/` @ f975533d | **85 .md** (contagem real) — inventário §1 |
| 2. Mirror `<owner local audit checkout>/docs/` | **109 .md** — checkout STALE em `6fc7900` + docs de doutrina NÃO-RASTREADOS; delta exato no §2 |
| 3. Handoff `<owner local handoff dir>/` | to-chat 9 · to-clu 79 · to-codex 17 · from-chat **415** · from-clu 72 · from-codex 33 arquivos — §3 |
| 4a. `~/projects/docs/` | **vasculhado — NÃO EXISTE** (o dono indicou; não há tal pasta) |
| 4b. `~/projects/` (≡ `~/Projects/`, FS case-insensitive) | existe: `GovAI GRC Platform/` com `Docs/` (3 docs canônicos EXTERNOS — §4.1) + o repo vivo + um .zip |
| 4c. `~/Downloads/` | `govai-docs/` (os **6 documentos fundadores**, 2026-05-01 — §4.2) + variantes soltas de master-arch/ADP/matrix (§4.3) |
| 4d. `~/Documents/` | **vasculhado — VAZIO** (nenhum arquivo listável) |
| 4e. `~/` raiz | `GovAI-PR-R1-backups/`, `govai-pr3-1h-backup/` (backups de código, CATALOGADO, não lidos), `bin/` (2 scripts de sync de auditoria), `code-tests/` (irrelevante — codex-setup-test) |
| 4f. `~/Desktop/TRABALHO/GovAI - Enterprise AI GRC /` | imagens de marca (GovAI D-01..06 + Gemini), `Arquivos de Auditoria do Código/` (4 zips + final_audit.pdf), `GitHub /GovAI GRC Platform` (árvore V0 antiga), `Documentos Diversos/` (.docx) — tudo `[HISTÓRICO]`, CATALOGADO |
| ADR-015 | **vasculhado em todos os locais — NÃO EXISTE em lugar nenhum** (numeração salta 014→016 até no mirror) |
| ADR-029/030/031 | **NÃO EXISTEM como arquivos em lugar nenhum** — aparecem apenas como itens PLANEJADOS em dispatches/RRs do handoff ("intake ADR-029/030/031", rev43 fila #4) |
| Segredos/pessoais | nenhum reproduzido; nenhum arquivo pessoal irrelevante aberto; `~/.govai/secrets` (ciphertext KMS, conhecido do projeto) **não aberto** `[SKIPPED — privacy/security]` |

## 1. LOCAL 1 — Repo `docs/` @ f975533d (85 .md; 22.244 linhas)

### 1.1 `docs/architecture/` raiz (8) — os docs de continuidade
| Doc | Linhas | Status | Leitura |
|---|---|---|---|
| `current-state.md` | 176 | `[DESATUALIZADO — CÓDIGO É ÁRBITRO]` — gerado @ c3cd39f3 (2026-06-27), **5 merges atrás**; contagens/âncoras divergem (rotas 17→18 arquivos, migrações, server.ts:93-112→156-176); ainda assim é o MELHOR doc de estado do repo | LIDO (sessões da série) |
| `development-roadmap.md` | 125 | `[DESATUALIZADO]` — Phase 4 "Remaining" descreve como pendente o que EP-008D entregou e prescreve design REJEITADO ("needs operator/cross-tenant role" — INV-1 proíbe); Phase 5 (runtime enforcement) continua válida como alvo | LIDO |
| `stale-docs-register.md` | 96 | `[DESATUALIZADO]` — o próprio guardião da staleness está @ c3cd39f3; precisa de seção de reconciliação (EP-008D/#114/#115/#117/#116) | LIDO |
| `resume-playbook.md` | 104 | `[DESATUALIZADO — GRAVE]` — ~24 PRs atrás; instrui re-fazer decisões tomadas ("B3 not authorized") | LIDO (série) |
| `governance-philosophy.md` | 139 | `[DESATUALIZADO/CONTRADITO]` — "hard-deny floor always on / cannot be lowered by configuration" contradiz `enforcement.ts:85-92` (dev/test→observe; pilot rebaixa); rotular TARGET | LIDO (série) |
| `baseline-decisions.md` | 120 | `[DESATUALIZADO em 4 pontos]` — runtime-roadmap descreve PR1; beta-allowlist "vazia" (há 9 entradas); justificativa pgcrypto contrafactual (15 CREATE EXTENSION); coverage 70→real 80 | LIDO (série) |
| `source-spec.md` | 10 | `[PRECISA DE VERIFICAÇÃO/DECISÃO]` — aponta ADP **v3 EXTERNO** como fonte exclusiva; o repo tem v4.2 INTERNO em `canonical/` → ambiguidade D8 (resolução: §4.1) | LIDO |
| `workroom-governance-room.md` | 1029 | `[VISÃO-ALVO AUTORITATIVA]` para a Workroom (espec + regra de ouro da UI :909); §246 canoniza literais defeituosos (F1/F2) — reescrever como contrato semântico pós-fix | LIDO-PARCIAL (série) |

### 1.2 `docs/architecture/adr/` (23) — ADR-001..014 + 020..028 (SEM 015-019)
- 001–013 (7-14 linhas cada): decisões fundadoras curtas `[IMPLEMENTAÇÃO ATUAL]` — run central, dual-mode, provider-native, registry+facets, levels/evidence-strength, zero-placeholders (006 com nota honesta DESATUALIZADA: fala de 503s que não existem; o gap real são os dois 501), real-infra, KMS-first, audit defense-in-depth, OTel≠audit, right-to-erasure (crypto-shred — o primitivo SQL existe desde a 0001), cost-attribution, Node 24. CATALOGADO/LIDO-PARCIAL.
- 014 (110): files beta allowlist — `[IMPLEMENTAÇÃO ATUAL]` (beta-policy.ts).
- 020–028: o arco do sealer/evidence — 020 runtime model (header já atualizado "B3 IMPLEMENTED"), 021 provider-native preservation (**ainda "Proposed"** apesar de implementado — atualizar), 022 roles, 023 stale-recovery, 024 backpressure, 025 health/metrics, 026 deploy unit, 027 runtime-to-evidence (header "not implemented" **FALSO** — implementado+testado), 028 identity/idempotency (347 linhas, o mais denso). Status headers de 022-027 dizem "future/does not authorize" — `[DESATUALIZADO]`; conteúdo técnico `[IMPLEMENTAÇÃO ATUAL]`. LIDO-PARCIAL (série + esta sessão).

### 1.3 `docs/architecture/canonical/` (8; 9.486 linhas) — o ADP e a Peça A/Matrix ★ resolve D8
| Doc | Linhas | Status |
|---|---|---|
| `govai_adp_v4_2.md` | 1881 | `[VISÃO-ALVO AUTORITATIVA]` (o packet arquitetural pinado v4.2: tese, decisões, 3 dimensões de coverage, tiers, ADRs canônicos, monorepo, modelo de dados, audit chain, crypto-shred, pipeline, registry, provider matrix, native experience, agentic safety §14, DLP-BR §15, segurança §16, OTel §17, testing §18, gates §19, forbidden §20, roadmap de PRs §21) — LIDO-PARCIAL (estrutura completa + seções-chave) |
| `govai_adp_v4_2_2_addendum.md` | 788 | `[VISÃO-ALVO AUTORITATIVA]` (addendum vigente) — CATALOGADO |
| `govai_pr2_peca_a_v2_prompt_claude_code.md` + patches v2_1/v2_2 | 1694+609+486 | `[HISTÓRICO — execução PR2]` (a Peça A §6.2 é a origem da matriz de enforcement) — CATALOGADO |
| `govai_pr2_provider_coverage_matrix_v2.md` + patches 2_0_1/2_0_2 | 3290+459+279 | `[VISÃO-ALVO AUTORITATIVA]` para cobertura de provedor (incl. §files/Assistants **sunset 2026-08-26** → EP-11) — LIDO-PARCIAL |

### 1.4 `docs/architecture/regulatory/` (20; ~5.5k linhas) — ouro para negócio/compliance
README (494 — define a taxonomia COVERED/PARTIAL/GAP/NEEDS_SOURCE_VERIFICATION — a BASE do Crosswalk N5), 00-philosophy (com hard-deny já rotulado TARGET — a correção que a governance-philosophy raiz regrediu), 01-lgpd-anpd, 04-marco-civil, 05-cnj-judiciary, 06-evidence-chain-custody, 07-sensitive-data, 08-financial, 09-health, 10-legal, 15-source-register, 16-shared-responsibility (matriz nativo-vs-connector — base do N4 e da governança §5.12), 18-competitive-benchmark, 19-build-vs-integrate (LIDO na série), 20-target-control-catalog (810 — domínios de controle + evidências PR-R1..R6 — base do N5), 21-regulatory-intelligence-operating-model, 22-certification-and-audit-readiness (readiness ≠ certificação — vocabulário de claims), 23-regulatory-core-roadmap (1524), 24-sensitive-data-operating-model, 25-cnj-sinapses. **Status geral: `[VISÃO-ALVO AUTORITATIVA]` no método/mapeamento; onde citam estado de runtime, `[PRECISA DE VERIFICAÇÃO]` contra o código.** LIDO-PARCIAL (README+estruturas+16/20/22; demais CATALOGADO).

### 1.5 `docs/architecture/specs/` (5) + `execution/pr2/` (2)
| Doc | Status |
|---|---|
| `audit-sealer-b3-technical-plan.md` (150) | `[IMPLEMENTAÇÃO ATUAL]` — header já diz "IMPLEMENTED by EP-006; Shape S" — LIDO-PARCIAL |
| `aws-kms-adapter.md` (139) | `[IMPLEMENTAÇÃO ATUAL]` — "Status: Implemented (Foundation Release)" — LIDO-PARCIAL |
| `h1v2-coverage-map.md` (285) | `[IMPLEMENTAÇÃO ATUAL/HISTÓRICO]` — mapa de cobertura do harness H1v2 — CATALOGADO |
| `pre-b3-audit-sealer-runtime-decision-pack.md` (188) | `[HISTÓRICO]` (decisão consumida) — CATALOGADO |
| `provider-native-compatibility-harness.md` (243) | `[VISÃO-ALVO AUTORITATIVA]` (contrato de fidelidade byte-level) — LIDO-PARCIAL |
| `execution/pr2/*` (442+260) | `[HISTÓRICO — execução]` — CATALOGADO |

### 1.6 `docs/contracts/` (7) + `docs/operations/` (1) + `docs/runbooks/` (6) + raiz (5)
- contracts: `passthrough-headers.md` (47) `[DESATUALIZADO]` (allowlist "vazia"; símbolo legado; status "planned" para rotas vivas — MAS as tabelas de strip/add de headers continuam corretas e são o único doc disso); 6 stubs `planned` de 3-10 linhas (computer-use-sandbox, evidence-anchoring, icp-brasil, mcp-security, shadow-ai, tsa-rfc-3161) `[VISÃO-ALVO curta]`. LIDO (todos).
- operations: `admin-bridge-cli-tools.md` (114) `[IMPLEMENTAÇÃO ATUAL]` — os 2 CLIs break-glass + política de remoção (issue #27). LIDO-PARCIAL.
- runbooks (6): observability-local (137), user-e2e-local (90 — contém a ÚNICA descrição honesta do enforcement real), kms-production (92), db-roles-production (86), planned-capability-guard (71), canonical-reconstruction-fallback (48) — `[IMPLEMENTAÇÃO ATUAL]`. LIDO-PARCIAL (série).
- raiz: README (bloco de status `[DESATUALIZADO — GRAVE]`: nega B3/bridge que existem), `govai_runtime_patch_1_pre_merge_v2.md` (475) + 3 `codex-review-*.md` `[HISTÓRICO]`.

## 2. LOCAL 2 — Mirror (109 .md) — o delta exato vs repo

**Só no mirror (26 docs):**
| Grupo | Docs | Status |
|---|---|---|
| ★ Doutrina não-versionada | `draft/govai-ai-trust-layer-master-architecture-v0.9.md` (320); `adr/ADR-016` (kernel), `ADR-017` (bridge/evidence — descreve como futuro o que foi implementado), `ADR-018` (7 planos), **`ADR-019` (provider identity — EXISTE; Proposed 2026-05-27)**; `product/claims-policy.md` (70); `specs/spec-v2.1-governance-kernel-audit-bridge.md` (170); **`specs/future/shadow-ai-privacy.md` (17)**; **`specs/future/agentic-action-governance.md` (21)**; `security/threat-model.md` (94); `operations/artifact-hygiene.md` (87) | `[VISÃO-ALVO AUTORITATIVA — FORA DO REPO]` — LIDOS INTEGRALMENTE nesta sessão (exceto artifact-hygiene LIDO-PARCIAL). ★ Candidatos nº 1 a VERSIONAR (decisão D9) |
| Histórico de ADP/matrix | `govai_adp_v4.md`, `v4_1.md`, `v4_2_1_addendum.md`; matrix `initial/v1_1/v1_2/v2_part1/part2/v2_1_*/v2_2_*`; `govai_pr2_prompt*.md` | `[HISTÓRICO — REDUNDANTE]` (superseded pelo v4_2+patches do repo) — CATALOGADO |
| Auditoria | `audits/claude-code-full-audit-2026-05-26.md` | `[HISTÓRICO]` — CATALOGADO |

**Só no repo (o mirror não tem):** `runbooks/observability-local.md`, `runbooks/user-e2e-local.md` (mais novos que o checkout do mirror). **Todo o resto do mirror é cópia STALE do repo** (`[REDUNDANTE — usar o repo]`).

## 3. LOCAL 3 — Handoff (625 arquivos)

- **to-chat (9):** o plano-mestre da aplicação (este arco), o UI-master-plan, o consolidado F1–F6, pacotes de auditoria, pedidos a Opus — `[IMPLEMENTAÇÃO ATUAL/ARCO VIVO]`. LIDOS (série).
- **from-chat (415):** 44 OPERATION-STATE (rev1..rev43 — **só o rev43 é vigente**; os demais `[HISTÓRICO]`), centenas de RRs/EPs/SPECs/dispatches `[HISTÓRICO — NÃO NORMATIVO]` (catalogados por contagem; amostrados). **Lidos integralmente os 5 prioritários:** AUDITORIA-CRITICA (as 8 lacunas do plano-mestre), CORRECAO-PROVENIENCIA, CORRECAO-F2A-V3 (F2a settled), VERIFICACAO-OPUS-BRIEFING7 (file_search_tool; ausência-visível), OPERATION-STATE rev43.
- **to-clu (79) / from-clu (72):** dispatches de execução e relatórios do implementador — `[HISTÓRICO]`, CATALOGADO.
- **to-codex (17) / from-codex (33):** os briefings 1–7 + auditorias codex + pareceres da série (docs-consistency, UI-architecture) — LIDOS os da série; demais CATALOGADO.

## 4. LOCAL 4 — Pastas locais do dono

### 4.1 `~/Projects/GovAI GRC Platform/Docs/` — as fontes EXTERNAS do source-spec ★ resolve D8
| Doc | Linhas | Status |
|---|---|---|
| `govai_adp_v3.md` | 1451 | `[HISTÓRICO — SUPERSEDED]` pelo v4.2 in-repo; é o alvo literal de `source-spec.md` ("../docs/govai_adp_v3.md") — **a resolução D8: declarar o v4.2 interno canônico e reescrever o source-spec** |
| `govai_claude_code_prompt_v2.md` | 544 | `[HISTÓRICO]` |
| `govai_runtime_patch_1_prompt_v2.md` | 474 | `[HISTÓRICO]` |

### 4.2 ★ `~/Downloads/govai-docs/` — os 6 DOCUMENTOS FUNDADORES (2026-05-01, "decisões finais P0")
| Doc | KB | Status | Valor |
|---|---|---|---|
| `01-raio-x-competitivo-e-posicionamento.md` | 40 | `[VISÃO-ALVO AUTORITATIVA — COMERCIAL]` (auto-declara: "fonte de verdade da estratégia comercial; quando outros docs divergirem, este vence") | posicionamento ("única com âncora regulatória brasileira / ICP-Brasil"), competidores, matriz de fossos, tese M&A/exit (24-36m; Palo Alto etc.), riscos — NENHUM outro doc cobre isto. LIDO-PARCIAL |
| `02-blueprint-arquitetura.md` | 52 | `[HISTÓRICO — v1; a arquitetura real evoluiu]` | ADRs fundadores — CATALOGADO |
| `03-plano-de-desenvolvimento.md` | 29 | `[HISTÓRICO]` (P0→P5 original) | CATALOGADO |
| `04-product-ux-architecture.md` | 117 | `[HISTÓRICO com PARTES APROVEITÁVEIS]` — o UX v1 (layout "Claude Desktop", Operator Workspace) foi SUPERSEDED pela série atual (Ledger/plano de UI), MAS: §11 a11y WCAG 2.1 AA, §12 performance budget, §6 atalhos, §13 anti-patterns alimentam as lacunas 6/8 da auditoria crítica | LIDO-PARCIAL |
| `05-tier-system.md` | 50 | `[VISÃO-ALVO COMERCIAL com DIVERGÊNCIA]` — preços (Starter R$4.9k/mês, Business R$19.8k/mês, Enterprise R$60-300k/mês, Partner), feature-flags JSON, quotas, SQL (plan_definitions/org_subscriptions/quota_usage/plan_change_history/trial_accounts — **nenhuma dessas tabelas existe no código**); ⚠ diverge dos tiers do código (`starter\|business\|enterprise\|regulated` — sem Partner, com regulated) | LIDO-PARCIAL |
| `06-audit-manual.md` | 76 | `[HISTÓRICO — processo v1]` (o processo real evoluiu para o protocolo multi-modelo do handoff) | CATALOGADO |

### 4.3 `~/Downloads/` soltos
`govai-ai-trust-layer-master-architecture-v0.9.md` `[REDUNDANTE — byte-idêntico ao do mirror]`; `govai-ai-trust-layer-master-architecture.md` (1040 — o draft LONGO de 2026-05-27, pré-v0.9) `[HISTÓRICO]`; `govai_architecture_decision_packet_prompt_mestre*.md`, `govai_opus_briefing.md`, `04-product-ux-architecture.md` (dup), `govai_pr2_provider_coverage_matrix_v1_2.md` (dup), zips de repo antigos, `govai-audit-logs-*.{csv,ndjson}` — `[HISTÓRICO/REDUNDANTE]`, CATALOGADO.

## 5. Disposições (o veredito por grupo)

**5.1 Devem virar FONTE NORMATIVA VERSIONADA (D9 — promover ao repo, na regra de promoção do próprio master-arch §17):** master-architecture v0.9 → `docs/architecture/` (canônico), ADR-016/017/018/019 (com headers atualizados ANTES: o 017 descreve como futuro o que existe), claims-policy → `docs/product/`, threat-model → `docs/security/` (resolve a referência quebrada da migração 0025), spec-v2.1 + specs/future/ → `docs/architecture/specs/`, artifact-hygiene → `docs/operations/`. **Bônus:** versionar resolve as 3 referências quebradas no código (`capture.ts:54`→ADR-017; `beta-policy.ts:28`→ADR-016; `0025:35-37`→spec-v2.1/ADR-017/threat-model).

**5.2 Devem ser ATUALIZADOS porque o código avançou (ordem da revisão documental da série):** trio de continuidade (current-state/roadmap/stale-register — regenerar @ HEAD), README (bloco de status), resume-playbook, governance-philosophy (rotular TARGET), baseline-decisions (4 pontos), headers de ADR-021..027, passthrough-headers.md, workroom-governance-room §246, source-spec.md (D8).

**5.3 ARQUIVAR como histórico (não apagar — trilha):** mirror ADP v4/v4.1/matrix antigas/prompts; Downloads soltos e zips; govai-docs 02/03/06; Desktop TRABALHO; backups `~/GovAI-PR-R1-backups`/`govai-pr3-1h-backup`; OPERATION-STATE rev1..42; a massa de RRs/dispatches do handoff.

**5.4 ESSENCIAIS vivos (a biblioteca mínima de quem chega):** o código; este catálogo + os 4 outputs irmãos; o plano-mestre da aplicação + UI-plan; rev43; consolidado F1–F6; master-arch v0.9 + ADR-016/017/018/019 + claims-policy + threat-model + spec-v2.1; ADP v4.2+addendum; coverage-matrix v2+patches; regulatory README/16/19/20/22; workroom-governance-room; runbooks; govai-docs 01+05 (comercial).

**5.5 Docs comerciais sem casa:** 01-raio-x e 05-tier-system não têm equivalente no repo — recomendação: criar `docs/business/` (ou manter fora do repo por sensibilidade comercial — decisão do dono; o catálogo apenas registra que são únicos e valiosos).

— Fim do catálogo. 4 locais vasculhados (com 3 ausências explícitas: ~/projects/docs, ~/Documents vazio, ADR-015/029/030/031 inexistentes), 85 docs no repo + 26 exclusivos do mirror + 625 arquivos de handoff catalogados + 6 fundadores e 3 canônicos externos descobertos nas pastas do dono.
