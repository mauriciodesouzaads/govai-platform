> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** EXECUTION_HISTORY
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D16=APPROVED)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header and the unsigned owner signature line)
> **SOURCE_SHA256:** `5ca89d415cc40dbb30f047593e3ca010540ecd1ed4ca81b64137949e9f9329f5` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** EXECUTION HISTORY (D16 = APPROVED, formal promulgation record). This communiqué re-anchored the July 2026 roadmap at `ed18736a`; its verification table §2 (V1–V5), supersession table §3, in-flight triage §4 and ACK handshake §6 describe that moment and are HISTORICAL — sessions now resume via `docs/architecture/resume-playbook.md`, and current state lives in `docs/architecture/current-state.md` + `docs/architecture/foundation-v1-freeze.md`. The owner signature line at the end is left exactly as in the source (M3 does not sign on the owner's behalf); the formal promulgation act is recorded here:
> **PROMULGATION RECORD (D16):**
> `OWNER_DECISION_ID` = EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 REV2 §3 (D0–D16), D16=APPROVED
> `DECISION_DATE` = 2026-08-18 (owner dispatch transmission = explicit authorization of the frozen M3 decisions)
> `DECISION_SCOPE` = repository promulgation of the verified PR-0/D9 corpus (43-entry ledger 43/43; PR-0 26/26; v0.9 15; D9 11/11) with the D0–D16 authority classifications; this document classified EXECUTION_HISTORY
> `ARTIFACT_VERSION` = GOVAI-COMUNICADO-REANCORAGEM-FABLE5_ed18736a_20260712 (source SHA-256 above)
> `PROMOTED_BY_PR` = branch `docs/foundation-v1-m3-canonical-freeze` (PR number in `docs/architecture/foundation-v1-freeze.md`)
> `PROMOTION_COMMIT` = POPULATED_BY_EXTERNAL_POSTMERGE_MISSION_RECORD
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** VIGENTE APÓS PROMULGAÇÃO DO DONO (campo de assinatura no rodapé)
> **BASE DECLARADA PELO DOCUMENTO:** ed18736a · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Auto-verificável (§2 V1–V5); triagem de trabalho em voo (§4); handshake ACK (§6).
> **ORIGEM:** Gerado nesta operação, 2026-07-12
> ---

# GOVAI — COMUNICADO DE RE-ANCORAGEM DO ROADMAP (leitura obrigatória antes de qualquer tarefa nova)

**Data:** 2026-07-12 · **Vigência:** a partir da promulgação pelo dono (Maurício) · **Aplica-se a:** TODOS os papéis do protocolo (arquiteto, Opus, GPT, Fable5, CLU, Codex e qualquer sessão nova de Claude Code) · **Substitui:** a ordem de execução de todos os roadmaps anteriores (ver §3).

Este comunicado segue a regra do próprio protocolo: **não acredite nele — verifique-o**. A §2 contém os comandos; a verificação leva ~2 minutos.

---

## §1 — A mudança, em um parágrafo

O documento de topo do projeto passou a ser o **GOVAI-MAPA-MESTRE-DESENVOLVIMENTO v1.1** (base de código `ed18736a`; base de mercado 2026-07-12). A base de referência mudou de `f975533d` para **`ed18736a91c04ab585742d47385d177a109cb0a1`** (merge do PR #118 em 2026-07-11T17:58:47Z). O princípio ordenador do roadmap deixou de ser a lista de features das gerações anteriores e passou a ser a **tese única** — *GovAI permite usar as ferramentas de IA que quiser, com mínima fricção, enquanto DESCOBRE o uso não autorizado, PROTEGE o autorizado, GOVERNA o risco e PROVA o que aconteceu* — com a Workroom como ambiente opcional, integrações como princípio estrutural, e **gate duplo** para toda feature: (a) qual dos quatro verbos ela serve? (b) quem paga por ela em ≤90 dias? O corpus de arquitetura (os 19 documentos ancorados em `f975533d`) **permanece válido como visão-alvo e fonte de specs**; o que muda é o ESTADO (re-baseado) e a ORDEM (regida pelo Mapa §6).

## §2 — Verifique, não confie (execute antes de prosseguir)

```bash
git fetch origin && git rev-parse origin/main
# Esperado: ed18736a91c04ab585742d47385d177a109cb0a1 (ou descendente dele — se for
# descendente, reporte o HEAD encontrado e re-ancore as âncoras abaixo antes de usar)
```

| # | Afirmação deste comunicado | Como verificar na fonte |
|---|---|---|
| V1 | **F5/F6 (vazamento/contagem de DLP) está CONCLUÍDO** — o #118 mergeou o merge de spans com os 3 itens do FIXUP3 | `grep -n "mergeFindingSpans" packages/dlp-br/src/baseline-detectors.ts` (fusão, ~:175-217, idempotente — "Mudança C"); `grep -n "redactionSpans" apps/api/src/pipeline/run-orchestrator.ts` (redação seletiva por ação, ~:598); `grep -n "FIXUP3" apps/api/src/pipeline/run-orchestrator.ts` (dlp_findings persistidos no deny, ~:446-462) |
| V2 | **C-2 está ABERTO** (novo achado; não estava no corpus): o ramo governed-blocked grava `native_request_hash='\x00'` com o hash real disponível | `grep -n "governed-blocked" apps/api/src/pipeline/run-orchestrator.ts` e inspecionar ~:809-811 |
| V3 | **F1–F4 continuam ABERTOS** como especificados no corpus | F1: `grep -rn "credential_source: 'tenant_provider_credential'" packages/` (14 literais); F4: `grep -n "enterWith" apps/api/src/pipeline/request-identity-hook.ts` (~:63) |
| V4 | **EP-11 tem PRAZO EXTERNO 2026-08-26** (sunset OpenAI Files); falta o evento de auditoria do deny | `packages/provider-openai/src/passthrough/files-purpose-validator.ts` |
| V5 | O README ainda nega o estado (será corrigido na Fase 0) | `sed -n '13,15p' README.md` — não usar o README como fonte de estado |

Se qualquer verificação falhar, **pare e reporte** — não prossiga sobre premissas divergentes.

## §3 — Tabela de supersessão (o que muda de status; nada é apagado)

| Documento | Status a partir deste comunicado |
|---|---|
| **GOVAI-MAPA-MESTRE-DESENVOLVIMENTO v1.1** | **VIGENTE — o documento de topo.** Hierarquia de verdade, fila (§6), triagem (§7), validação de mercado com fontes datadas (§5). |
| Índice-Mestre (`f975533d`, 2026-07-10) | Válido como índice do corpus; o §3 dele ("construir primeiro = P0.1/F5+F6") está **SUPERADO** — P0.1 foi entregue pelo #118. |
| Implementation Queue (P0–P3) | Continua sendo a spec item-a-item; a **ORDEM** passa a ser a do Mapa §6. P0.1 = concluído. Âncoras de linha em `dlp.ts`/`baseline-detectors.ts`/`run-orchestrator.ts` mudaram — **re-ancorar antes de citar**. |
| Gap Register | G-05/G-06 = **FECHADOS** (#118). G-01..G-04 = abertos. **Adicionar G-30 = C-2** (hash placeholder no governed-blocked, P0). G-16/EP-11 = P0 com prazo 2026-08-26. |
| Plano de Consolidação 2026-06 (WS0–WS6) | WS1 (AuditBridge+B3) e WS2 (CNPJ alfanumérico) = **ENTREGUES** (verificáveis no código). WS0 = parcial. Ordem restante regida pelo Mapa §6. |
| development-roadmap.md (repo) + fases F0–F9 do Master Plan | Conteúdo válido; **sequência regida pelo Mapa §6** (Shadow AI e anchoring sobem; enforcement vira escada de degraus; Crosswalk seed antecipa; SOC 2 entra como trilho). |
| README, resume-playbook, governance-philosophy | **NÃO usar como fonte de estado** até a reescrita da Fase 0 (já listada). |
| Master Plan, Execution Manual, UI Plan, Specs+Anchoring, ADRs 029/030/031 | Válidos como visão-alvo e specs de construção. Nota única: onde afirmarem "F5/F6 pendente", prevalece V1. |

## §4 — Triagem do trabalho em voo (para agentes com tarefa aberta)

- **PARE** se a sua tarefa: implementa ou especifica F5/F6 (já mergeado); redige texto/documentação afirmando que a redação de DLP está quebrada; prepara qualquer material comercial com claims de "descoberta completa de Shadow AI" ou moat fundado no PL 2338 (ver Mapa §5.2).
- **RE-ANCORE** se a sua tarefa: cita números de linha de `f975533d` em arquivos tocados pelo #118 (`dlp.ts`, `baseline-detectors.ts`, `run-orchestrator.ts`, `scan-sensitive.ts`); ou audita estado a partir do Índice-Mestre §3.
- **CONTINUE sem mudança** se a sua tarefa: implementa F1, F2, F3(+dispatch_status) ou F4 (specs inalteradas no Execution Manual §23); trabalha a verdade documental (lista da Docs Consistency Review — agora com um item a mais: re-fundar o moat em LGPD+CNJ nos textos); ou é leitura/pesquisa sem âncora de linha.
- **NOVO na fila P0:** C-2/G-30 (correção pequena: gravar o `nativeRequestHash` real no ramo blocked) e o evento de auditoria do EP-11 (prazo 2026-08-26).

## §5 — Instruções por papel

- **Arquiteto (Fable/Claude Code):** abrir o **PR-0** — versionar no repo o Mapa v1.1, este comunicado e a doutrina do handoff (D9; fecha as 3 referências quebradas). Atualizar o OPERATION-STATE (próxima rev): re-baseline `ed18736a`, P0.1 concluído, G-30 aberto, fila = Mapa §6.
- **CLU / executores:** primeira leva de PRs = Fase 0 do Mapa §6 (F1+F2 · F3+dispatch · F4 · C-2 · EP-11 · docs). Cada PR cita a spec do corpus E a posição no Mapa §6; todo diff re-verifica âncoras na fonte (diff-verify), como sempre.
- **Opus (revisor adversarial):** o Mapa v1.1 e este comunicado são material NOVO — submetê-los à mesma leitura adversarial do resto; em particular, re-verificar V1–V5 de forma independente e atacar a §5 do Mapa (validação de mercado) onde as fontes pareçam fracas.
- **GPT (auditor externo, sem acesso a código):** auditar estrutura/mercado contra o Mapa v1.1, não contra as filas antigas; a §5.5 do Mapa lista as fontes de mercado com data — afirmações de mercado fora dela exigem fonte nova nomeada e datada.
- **Todos:** afirmações de mercado agora seguem a regra §0.6 do Mapa (fonte + data + validade trimestral; regulatórias BR re-verificadas antes de qualquer material comercial).

## §6 — Handshake de reconhecimento (obrigatório em toda sessão nova)

A primeira mensagem de trabalho de qualquer agente declara, em uma linha:
`ACK re-ancoragem: HEAD=<hash lido> · Mapa=v1.1 · tarefa=<item do §6/§7 do Mapa> · âncoras re-verificadas=<sim/não>`
Sem ACK, o dono deve presumir que a sessão opera no roadmap antigo e tratá-la como estacionada.

## §7 — A regra permanente

O código vence os documentos; o Mapa vence os roadmaps anteriores em ESTADO e ORDEM; o corpus permanece a fonte das specs; toda feature nova passa pelo gate duplo; e nenhum agente afirma — em código, doc, UI ou pitch — capacidade que o código não entrega nem demanda que a fonte não sustenta. Quem encontrar divergência entre este comunicado e a fonte: a fonte vence, e a divergência é reportada, não contornada.

— Fim do comunicado. Promulgação: ______________________ (dono, data). Após promulgado, este arquivo entra no PR-0 junto com o Mapa v1.1 e a doutrina D9.
