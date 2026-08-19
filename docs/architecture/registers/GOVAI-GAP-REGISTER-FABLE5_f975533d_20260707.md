> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_SNAPSHOT
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-07 at f975533d + adendo 2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header + adendo retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (register snapshot; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `af94b4000f09ae0cfdf36018bc676e0bb84b68bcd570e5d465e9501edd3250b1` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL SNAPSHOT with a bounded CURRENT-STATUS ADDENDUM (in this header; body untouched). Row statuses are frozen at f975533d / ed18736a. At the Foundation V1 anchor: G-01 (F1) CLOSED (PR #119); G-02 (F2) RECLASSIFIED — evidence-granularity gap, closed with a registered residual (recommendation vs applied is honest over HTTP; `block_trigger` exposed on 403, not first-class in sealed v4); G-03 (F3) CLOSED (PR #123 durable dispatch outside DB transactions; `/health` readiness semantics unchanged by M3 — verify at source); G-04 (F4) CLOSED (PR #120 preventive hardening); G-05/G-06 CLOSED (#118, per adendo); G-16/FL-10 (EP-11) CLOSED DIFFERENTLY — the local Files-purpose deny was REMOVED (ADR-032 / PR #126), no deny audit event exists because no local deny exists; G-17 (`dispatch_status`) REALIZED IN A DIFFERENT SHAPE by the P0.3-A durable dispatch layer (migration 0029) and P0.3-C (0030); G-30 (C-2) CLOSED (PR #119). Still open/true: G-23 (no UI), G-26 (no runtime enforcement primitives), G-27 (no anchoring), G-19 (`ask` does not retain). Other rows: not re-adjudicated by M3. The v0.2 manifest's proposed `LOCAL_DENY_EVIDENCE_INCOMPLETENESS` class was NOT added: at this anchor every Native/Governed pre-provider block emits a durable blocked v4 capture; the narrow residuals are registered in `docs/architecture/foundation-v1-freeze.md`.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** REFERÊNCIA COM ADENDO — G-05/G-06 FECHADOS (#118); G-30 (C-2) ADICIONADO
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** —
> **ORIGEM:** handoff to-chat/
> ---

# GOVAI — GAP REGISTER (lacunas reais, falsas lacunas corrigidas, divergências)

**Base:** `f975533d`. **Autor:** Fable 5 / Claude Code, 2026-07-07. Campos: `ID · Título · Status · Fonte · Impacto · Prioridade · Recomendação · EP/PR sugerido`. Prioridades: P0 (antes de produto vendável) · P1 (enterprise/integration) · P2 (diferenciação) · P3 (nice-to-have).

## 1. ★ FALSAS LACUNAS CORRIGIDAS (o briefing §4.3 — todas confirmadas e fechadas)

| # | Falsa lacuna (onde foi afirmada) | Correção (fonte confirmada nesta sessão) |
|---|---|---|
| FL-1 | "ADR-019 não escrito" (plano-mestre D10) | **EXISTE** — `[MIRROR] adr/ADR-019-provider-identity-model.md` (Proposed 2026-05-27), LIDO: `providerId: string` no boundary do kernel/registry; curto prazo preserva unions literais nos eventos; longo prazo nova versão de evento validada contra registry; unknown providers fail-safe. ⇒ **D10 está DECIDIDA em doutrina** — o que falta é implementação (a migração de schema de evento), não decisão |
| FL-2 | "Shadow AI sem spec / diretório future não existe" (plano-mestre Cap. 2 P5) | **EXISTE** — `[MIRROR] specs/future/shadow-ai-privacy.md`: princípios fixados (metadata-first; conteúdo só por política+atestação de admin; redaction/hash default; sinais externos são lower-trust; aviso protege, não pune); schemas de ingestão deferidos a R2. A lacuna real é só a IMPLEMENTAÇÃO R2 |
| FL-3 | "Agentic action governance sem spec" | **EXISTE** — `[MIRROR] specs/future/agentic-action-governance.md`: princípio reservado (intended-action hash, risk class, least-privilege scope, policy decision, approval, post-action evidence, rollback metadata); claim proibido até `supported`. A Workroom JÁ implementa o precursor (intended_action_hash + SoD) |
| FL-4 | "ADP provenance ambígua" (D8) | **RESOLVIDA nos fatos**: o v3 EXTERNO existe em `~/Projects/GovAI GRC Platform/Docs/govai_adp_v3.md` (o alvo literal do source-spec) e o **v4.2 INTERNO está VERSIONADO** em `docs/architecture/canonical/` (+ addendum v4_2_2). Ação restante: reescrever `source-spec.md` declarando o v4.2 canônico (1 linha) — decisão do dono, execução trivial |
| FL-5 | "Regulatory docs = 20 no mirror que o repo não tem" (briefing §3.2) | **INVERTIDA**: os 20 regulatory (e os 8 canonical, e 5 specs) **ESTÃO no repo** @ f975533d; o delta real do mirror são só os 11 docs de doutrina (catálogo §2) |
| FL-6 | "Threat model não existe" (referência quebrada da migração 0025; plano-mestre §3-refs) | **EXISTE** — `[MIRROR] security/threat-model.md` (T1-T10 + controles), LIDO. Não-versionado; promover fecha a referência quebrada |
| FL-7 | "Competitive benchmark / build-vs-integrate / sensitive-data operating model / CNJ-Sinapses ausentes" | Todos EXISTEM e estão VERSIONADOS (`regulatory/18`, `19`, `24`, `25`) |
| FL-8 | "EP evidence-gauges-boot-wiring pendente" (briefing §7 item 8) | **JÁ ENTREGUE** — PR #115 (EP-EVIDENCE-GAUGE-WIRING): `[CODE] server.ts:118-154` (gate duplo OTLP+enumerator URL; INV-1); rev42/43. O EP-8 do briefing é [IMPLEMENTADO] |
| FL-9 | "Crosswalk parte do zero" (implícito no N5 do plano-mestre) | PARCIAL: a TAXONOMIA (COVERED/PARTIAL/GAP/NEEDS_SOURCE_VERIFICATION) já está normatizada em `regulatory/README`, os domínios de controle + evidências PR-R1..R6 em `regulatory/20`, e `controls`+`framework-mappings` no schema. O N5 constrói o MOTOR/API/UI sobre base documental pronta — escopo menor que o estimado |
| FL-10 | "OpenAI Files sunset não tratado" (briefing §7 item 11, implícito) | PARCIAL: o validador pré/pós-sunset EXISTE (`[CODE] provider-openai/src/passthrough/files-purpose-validator.ts:8-53` — warning antes, deny 403 `purpose_deprecated_post_sunset` depois de 2026-08-26). A lacuna REAL é o EVENTO DE AUDITORIA do deny pós-sunset (e o teste da virada de data) — EP-11 reescopado |

## 2. LACUNAS REAIS — produto/técnica (o que falta de verdade)

| ID | Título | Status | Fonte | Impacto | Prio | Recomendação / EP |
|---|---|---|---|---|---|---|
| G-01 | F1 credential_source hardcoded (14 literais) | CONFIRMADO | [CODE] handle-messages.ts:283,351,416 + openai + passthrough | evento selado afirma origem falsa de credencial | **P0** | fase F1–F6; enum derivado do resolvedor |
| G-02 | F2 blocked-branch morto + rótulo errado no bloqueio | CONFIRMADO | [CODE] enforcement.ts:66; handle-messages.ts:278 vs register-governed.ts:114-121 | evento diverge do corpo HTTP; E-branch dead code | **P0** | decisão real + block_trigger + block_reason |
| G-03 | F3 transação aberta durante fetch + /health estático | CONFIRMADO | [CODE] run-orchestrator.ts:467,471,999; health.ts:4 | exaustão de pool sob provedor lento; liveness cego | **P0** | fechar tx antes do fetch; AbortSignal+timeout; readiness `SELECT 1` |
| G-04 | F4 enterWith → captura descartável | CONFIRMADO | [CODE] request-identity-hook.ts:63; audit-bridge.ts:29,131 | perda de evidência (missing_request_identity) | **P0** | als.run() |
| G-05 | F5 redactFindings corrompe/vaza em sobreposição | CONFIRMADO LITERALMENTE | [CODE] dlp.ts:87-94; baseline-detectors.ts:121-123 | vazamento de PII num produto LGPD | **P0** | fundir intervalos; varredura L→R |
| G-06 | F6 contagens infladas por sobreposição | CONFIRMADO | [CODE] run-orchestrator.ts:540,563; handle-messages.ts:236 | evidência super-conta | **P0** | dedup por span (junto do F5) |
| G-07 | Rate limit global 100/min in-memory | CONFIRMADO | [CODE] server.ts:102-105 | 1 tenant esfomeia outro; UI inviável em prod; multi-instância inconsistente | **P0** | EP-1 (por chave/org; Redis p/ multi-instância — REDIS_URL já existe na config:25) |
| G-08 | Sem whoami — roles/tier/modo invisíveis ao cliente | CONFIRMADO | [CODE] grep routes | UI sem nav por role/badges | **P0** | EP-2 `GET /v1/me` |
| G-09 | Sem GET de participantes | CONFIRMADO | [CODE] workrooms.ts (só :504/:704) | roster/SoD-UX impossíveis | **P0** | EP-3 |
| G-10 | Sem sessão (chave crua no cliente) | CONFIRMADO | [CODE] auth.ts:2; jwt.ts não consumido | multiusuário inseguro | P1 | EP-4 chave→JWT httpOnly (JWT_* já na config:35-37) |
| G-11 | Sem feed por-request (captura hash-only; runs POST-only) | CONFIRMADO | [CODE] audit-bridge.ts:210; routes/runs.ts | "o que a governança fez?" sem rota; Usage Ledger bloqueado | P1 | EP-5 (decisão D4 de retenção primeiro) |
| G-12 | Sem @govai/api-contract (Zod inline; sem OpenAPI) | CONFIRMADO | [CODE] grep | contrato UI↔API sem amarra | **P0** (fase 1 junto de U1) | EP-6 |
| G-13 | EC-6 sempre pending (sem verificador persistido) | CONFIRMADO | [CODE] evidence-reports.ts:466-496 | integridade nunca demonstrada em produto | P1 | EP-7 verificador + `POST /v1/evidence/verify` |
| G-14 | Hardening SQL-side do audit (digest()/integridade em SQL) + justificativa pgcrypto contrafactual | CONFIRMADO | [DOC] baseline-decisions.md:77-79 vs 15× CREATE EXTENSION; rev43 fila #3 | mitigação incompleta; doc mente sobre o porquê | P1 | EP-9 (decisão consciente: usar digest() já que pgcrypto é dependência de fato) |
| G-15 | DLP dois regimes divergentes (path-A configurável deny/redact vs path-B warn fixo) + scan duplicado | CONFIRMADO | [CODE] dlp.ts vs routes/governed-anthropic.ts:60-71 | org config deny é bypassável via /governed | P1 | EP-10 single-source-of-truth (decisão Q2 deny-primeiro) |
| G-16 | Evento de auditoria do deny pós-sunset OpenAI Files | PARCIAL | [CODE] files-purpose-validator.ts | deny sem trilha após 2026-08-26 (**7 semanas**) | **P0 (prazo externo)** | EP-11 |
| G-17 | spec-v2.1 dispatch_status não implementado (`prepared/dispatching/unknown_after_dispatch...`) | CONFIRMADO | [MIRROR] spec-v2.1 §7 vs [CODE] 0002 (sem coluna) | crash-consistency do path-A não representada | P1 | EP futuro (com F3 — mesma fronteira de transação) |
| G-18 | Policy Studio inexistente (config só por SQL) | CONFIRMADO | [CODE] grep UPDATE govai.orgs/dlp_baseline_config; admin-dlp 501 | claim "standalone" bloqueado | **P0-P1** | Feature N1 (spec densa no manual §21.1) |
| G-19 | Review Queue inexistente (ask não retém nem enfileira) | CONFIRMADO | [CODE] grep review | fricção proporcional não vira produto | P1 | Feature N2 (spec densa §21.2) |
| G-20 | Evidence Package inexistente | CONFIRMADO | grep | diferenciação vs DLP genérico não demonstrável | P1 | Feature N3 |
| G-21 | Connector Framework inexistente (ingest+export SIEM/GRC) | CONFIRMADO | grep | doutrina "integrated" sem carne | P1-P2 | Feature N4 (export SIEM primeiro) |
| G-22 | Crosswalk engine/API inexistente | CONFIRMADO (base documental pronta — FL-9) | grep | "prova de cobertura" manual | P2 | Feature N5 |
| G-23 | UI inexistente (apps/ui ausente) | CONFIRMADO | [CODE] ls apps/ | produto sem rosto | **P0** | U1→U4 (plano de UI) |
| G-24 | Gestão de chaves/usuários só por CLI break-glass | CONFIRMADO | [CODE] scripts/; [DOC] admin-bridge-cli-tools (issue #27) | onboarding de tenant não self-service | P1 | EP pós-N1 |
| G-25 | Billing/plan-gating inexistente (tabelas do doc 05 não existem; tiers hardcoded em orgs) | CONFIRMADO | [LOCAL] 05-tier-system SQL vs [CODE] 0008 | monetização sem mecanismo; quotas sem enforcement | P2 | EP-BILLING (reconciliar doc 05 com tiers reais incl. `regulated`) |
| G-26 | Kernel (ADR-016) não extraído; enforcement runtime regulatório (Fase 5) ausente | CONFIRMADO | [CODE] packages/ | governança fica advisory | P2 (gatilho: 3ª superfície) | EP-KERNEL; EP-RUNTIME-ENFORCEMENT |
| G-27 | Anchoring externo (TSA/Merkle/ICP-Brasil) ausente (`chain_anchor_id` reservado desde 0001) | CONFIRMADO | [CODE] 0001; [DOC] contracts/ | grau de evidência "hmac_internal" apenas; o MOAT comercial do doc 01 depende disto | P2 | EP-ANCHOR (R2/R3) |
| G-28 | Backup/DR/RPO-RTO não documentados nem provados | CONFIRMADO | ausência de runbook | evidência selada sem prova de restauração | P1 | manual §18 + runbook novo |
| G-29 | Distributed rate limiting + SBOM/supply-chain + external security review (pré-regulated do threat-model) | CONFIRMADO | [MIRROR] threat-model §4 | pré-requisitos de tier Regulated | P1-P2 | itens do §4 do threat-model |

## 3. LACUNAS DE DOCUMENTAÇÃO (top-10 — detalhadas no catálogo §5.2)
trio de continuidade defasado (P0 doc) · README nega o código (P0 doc) · resume-playbook 24 PRs atrás · governance-philosophy sem rótulo TARGET · baseline-decisions 4 pontos · headers ADR-021..027 · passthrough-headers.md superado · workroom-governance-room §246 canoniza defeito · source-spec (D8) · doutrina fora do VCS (D9 — resolve 3 refs quebradas).

## 4. DIVERGÊNCIAS doc-vs-código arbitradas (formato §4.2 do briefing — as 6 maiores)
| Tema | Doc diz | Código diz | Vence | Ação |
|---|---|---|---|---|
| B3/bridge | README:13-16 "não implementado/logger-only" | sealer app + 4 rotas despacham ao outbox | CÓDIGO | reescrever README |
| Hard-deny floor | governance-philosophy "always on, não rebaixável por config" | dev/test→observe; pilot rebaixa (enforcement.ts:85-92) | CÓDIGO | rotular TARGET |
| Beta allowlist | contracts/passthrough-headers "vazia" | 9 entradas (beta-policy.ts) | CÓDIGO | atualizar contrato |
| DLP "scan-only" | current-state.md | path-A pode deny/redact (config por org) | CÓDIGO | corrigir SoT |
| Tiers comerciais | doc 05: Starter/Business/Enterprise/Partner | código: starter/business/enterprise/**regulated** (0008) | CÓDIGO (runtime) + doc 05 (preço/visão) | reconciliar no EP-BILLING |
| Operator role p/ cockpit | roadmap "needs cross-tenant role" | INV-1: acumulação per-org, sem role | CÓDIGO | corrigir roadmap |

— Fim do gap register. 10 falsas lacunas corrigidas; 29 lacunas reais registradas (6 são os fixes F1–F6; 1 tem prazo externo — sunset 2026-08-26); 10 de documentação; 6 divergências arbitradas (código venceu todas as de estado; o doc 05 mantém autoridade só no comercial).

---
## ADENDO DE RE-ANCORAGEM (2026-07-12 · base ed18736a · PR-0)
**Fechamentos:**
| ID | Novo status | Evidência (ed18736a) |
|---|---|---|
| G-05 (F5 redactFindings) | **FECHADO — PR #118 (2026-07-11)** | `baseline-detectors.ts:175-217` (mergeFindingSpans, idempotente); `dlp.ts` redige spans fundidos |
| G-06 (F6 contagens infladas) | **FECHADO — PR #118** | 1 linha em `govai.dlp_findings` por span fundido (`run-orchestrator.ts:446-462`) |

**Inclusão:**
| ID | Título | Status | Fonte | Impacto | Prio | Recomendação / EP |
|---|---|---|---|---|---|---|
| **G-30** | C-2: `native_request_hash='\x00'` no ramo governed-blocked com o hash real disponível | CONFIRMADO | [CODE] `run-orchestrator.ts:809-811` (ed18736a) | linha de `provider_invocations` contradiz a ação; comentário do próprio arquivo ("never a placeholder") violado só neste ramo | **P0** | gravar `nativeRequestHash` real; `NULL` no response permanece correto | Fase 0 (Mapa §6) — item P0.2b da Queue |

**Notas:** G-16/EP-11 com prazo **2026-08-26** (~6,5 semanas na data deste adendo). Âncoras de linha de G-01..G-04 referem-se a f975533d; G-03 (F3) teve offsets deslocados pelo #118 — re-ancorar por conteúdo.
