> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_SNAPSHOT
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-10 at f975533d + adendo 2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header + adendo retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (register snapshot; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (two absolute local paths redacted per M3 §51; body otherwise byte-preserved incl. the PR-0 header)
> **SOURCE_SHA256:** `932e7714fdb2500a024d181409d914b46842f2413ff4423f330c0afa01bb6105` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL SNAPSHOT — the 2026-07-10 navigation index of the handoff corpus at f975533d (its entry-point role passed to the Mapa on 2026-07-12 and now to `docs/README.md`). §3 build order is superseded (all P0 fixes done; see the Implementation Queue addendum). The handoff deliverables it indexes are promoted in `docs/architecture/{plans,registers,specs}/` under their original names (adendo item 3). Two bounded privacy edits (M3 §51): the absolute local handoff-directory paths were replaced by a neutral label; home-relative (`~/`) mentions are unchanged.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** REFERÊNCIA COM ADENDO — o §3 está SUPERADO (P0.1 entregue pelo #118); ver ADENDO ao fim
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Paths de handoff citados no corpo foram promovidos para este repositório (mapa no ADENDO e em docs/README.md).
> **ORIGEM:** handoff to-chat/
> ---

# GOVAI — ÍNDICE-MESTRE DA DOCUMENTAÇÃO (o mapa de navegação de todo o conjunto)

**Base:** `f975533d122afab251742c9459a12acc095dd8fb`. **Autor:** arquiteto (Fable). **Data:** 2026-07-10. **Propósito:** o ponto de entrada único. Qualquer agente/humano que pegue este projeto começa AQUI — este índice diz o que existe, o que ler em que ordem, e onde cada assunto está. A fase de planejamento está ENCERRADA e verificada por dois leitores independentes; daqui é construção.

---

## 0. Leia isto primeiro (a régua)
- **O CÓDIGO é a verdade do estado atual** (commit `f975533d`); os documentos dão a visão-alvo. Onde divergem, o código vence — e o documento sinaliza.
- **Verifique todo fato load-bearing na fonte, venha de quem vier** — incluindo do coordenador. A lição central deste projeto: nenhum papel (arquiteto, modelo premium, revisor) acerta tudo sozinho; a leitura na fonte, feita e refeita por leitores diferentes, resolve. (Provado recursivamente: o Opus corrigiu o arquiteto no enforcement; o Fable5 corrigiu o arquiteto na proveniência; o Fable5 corrigiu o próprio briefing 3× na fonte; o Opus fechou confirmando e corrigindo 1 linha.)
- **Nunca confie num doc de estado sem confrontar o código.** Sempre `git rev-parse HEAD` vs a base declarada.

## 1. Os 8 documentos do conjunto (ordem de leitura recomendada)

Todos em `<owner local handoff dir>/to-chat/`, ancorados em `f975533d`.

### Para ENTENDER o produto e a arquitetura (leia nesta ordem):
1. **`GOVAI-MASTER-PLAN-APPLICATION-FABLE5_...`** (911 linhas) — o ÍNDICE ARQUITETURAL. O posicionamento, as 7 doutrinas, os 7 planos (visão×estado×lacuna), o contrato do backend (140 rotas, tenancy/RLS, o vocabulário de enforcement com os 19 pares base×level), o roadmap F0-F9, as 11 decisões do dono. **Comece aqui** para o quadro geral.
2. **`GOVAI-EXECUTION-MANUAL-FABLE5_...`** (678 linhas, 25 caps) — o MANUAL DE EXECUÇÃO, o documento principal. O dicionário do banco (55 tabelas/3 views/~25 funções + ERD Mermaid + política de evolução de schema), a API pública, o threat model T1-T10, DR, onboarding do-zero-ao-PR, a governança-da-própria-GovAI, os F1-F6 re-ancorados (§23), e as 5 specs densas dos módulos novos (§21). **O "como construir cada peça".**
3. **`GOVAI-UI-MASTER-PLAN-FABLE5_...`** (790 linhas) — o detalhamento da camada de UI (arquitetura SPA, o design system "Ledger", as telas por persona). Referenciado pelo master-plan; leia quando for tocar frontend.

### Para SABER O QUE EXISTE e o que falta (referência):
4. **`GOVAI-DOC-CATALOG-FABLE5_...`** (120 linhas) — o catálogo de TODA a documentação (repo + mirror + handoff + pastas locais), com status e relevância. O mapa de "o que existe e o que descartar".
5. **`GOVAI-SOURCE-REGISTER-FABLE5_...`** (41 linhas) — as fontes primárias tipadas ([CODE]/[TEST]/[DOC]/[MIRROR]/[LOCAL]/[HANDOFF]). O índice de "onde cada afirmação foi ancorada".
6. **`GOVAI-GAP-REGISTER-FABLE5_...`** (67 linhas) — as 10 falsas-lacunas corrigidas + 29 lacunas reais (com prioridade e EP) + 6 divergências doc-vs-código arbitradas. O mapa de "o que falta de verdade".

### Para CONSTRUIR (a ordem de execução):
7. **`GOVAI-IMPLEMENTATION-QUEUE-FABLE5_...`** (115 linhas) — a fila P0-P3, cada item com schema/endpoints/eventos/testes/dependências/riscos + o grafo de dependências. **A "ordem em que construir".**
8. **`GOVAI-SPECS-ENTERPRISE+ANCHORING-FABLE5_..._20260710.md`** (569 linhas) — as 4 specs de RECEITA aprofundadas: Connector Framework, Evidence Package, Compliance Crosswalk, Anchoring externo (o moat). Cada uma com schema SQL executável, PRs granulares, e o critério "Pronto-para-vender". **Leia quando for construir uma feature enterprise** (mas note: NÃO são o primeiro código — ver §3).

## 2. As auditorias e verificações do arquiteto (em `from-chat/`)
O registro do processo de verificação — útil para entender POR QUE cada decisão é como é:
- `AUDITORIA-CRITICA-MASTER-PLAN-APP-...` — as 8 lacunas do master-plan (todas fechadas no Manual §14).
- `AUDITORIA-COMPLETUDE-MANUAL-EXECUCAO-...` — a auditoria de completude do Manual (as 6 lacunas residuais).
- `CORRECAO-PROVENIENCIA-DOUTRINA-...` e `CORRECAO-PROVENIENCIA-REGULATORY-CANONICAL-NO-REPO-...` — as 2 vezes que o arquiteto errou na proveniência e foi corrigido na fonte.
- `CORRECAO-F2A-V3-...` e `VERIFICACAO-FONTE-AUDITORIA-OPUS-BRIEFING7-...` — o enforcement settled (7 verificações; o file_search_tool).
- `VERIFICACAO-AVALIACAO-FINAL-4-SPECS-BRIEFING8-...` e `FECHO-VERIFICACAO-OPUS-CONFIRMA-3-ACHADOS-...` — o fecho: o Fable5 corrigiu o briefing 3× na fonte; o Opus confirmou independentemente (nota da linha :318).

## 3. ★ O QUE CONSTRUIR PRIMEIRO (não é o que parece)
O primeiro código NÃO é nenhuma das 4 features enterprise (elas vendem, mas vêm depois). É o **P0**, que é quase todo CONSERTAR e DESTRAVAR, não construir:
- **P0.1 — F5+F6** (o vazamento de PII em claro — o mais grave num produto LGPD; spec pronta no Manual §23). **← O PRIMEIRO CÓDIGO.**
- **P0.2 — F1+F2** (o evento selado não pode mentir origem de credencial nem decisão de bloqueio).
- **P0.3 — F3 + dispatch-state** (a conexão retida durante o fetch; o único fix com um complemento técnico a produzir).
- **P0.4 — F4** (a linha que faz a captura não se perder).
- **P0.5 — EP-11** (o sunset do OpenAI Files — ★ PRAZO EXTERNO 2026-08-26; validador pronto, falta o evento).
- **P0.6-8** — rate-limit por chave, `GET /v1/me`, `@govai/api-contract` (as fundações que a UI precisa).
- **P0.9** — o Cockpit (U1) — o primeiro rosto; valida a arquitetura em leitura pura.
- **P0.10** — a verdade documental (README + versionar a doutrina, os ~11 docs — escopo menor porque regulatory/canonical JÁ estão no repo).
Princípio: o produto está construído no núcleo, mas MENTE em 6 pontos (F1-F6) e não tem ROSTO. O P0 conserta as 6 mentiras e dá o primeiro rosto. Só DEPOIS as features que vendem fazem sentido — vender evidência sobre um evento que vaza PII seria construir sobre areia.

## 4. Os mockups renderizados (a camada do arquiteto — a lacuna mais pedida)
Produzidos pelo arquiteto (não em arquivo — renderizados no chat, por disposição da auditoria crítica): **o Cockpit de Evidência (U1)**, **o Console de Workroom com aprovações+SoD (U2)**, e **o Policy Studio (N1)**. Base posicional: os wireframes ASCII do Manual §14.8. Materializam a honestidade do produto (o EC-6 pendente exibido; só 403 é "bloqueado"; a assimetria path-A/path-B visível no Policy Studio; o piso de hard-deny imutável). Servem para VENDER o piloto — um comprador vê a tela e entende o produto.

## 5. As decisões que faltam (do DONO, não são lacunas técnicas)
- **Billing/tiers** (Gap Register G-25): os tiers comerciais (doc 05: "Partner") divergem dos de runtime (código: "regulated"). Decidir se são a mesma dimensão ou ortogonais — é o mecanismo de cobrar. As tabelas de billing não existem.
- **As 11 decisões D1-D11** do master-plan (leitura de transcript, JWT, operador no produto, etc.) — aparecem como dependências de vários itens; são escolhas de produto.

## 6. Pontos ainda NÃO-verificados na fonte (para diff-verify na construção)
Honestidade sobre o que não foi confirmado literalmente (o filtro de output do arquiteto bloqueia corpos cripto; alguns pontos ficaram para o CLU):
- As linhas exatas do F3 (`run-orchestrator.ts` :467/:471/:647/:999) — lidas pelo Fable5-CC, aceitas com nota; o CLU re-ancora no diff.
- O guard do anchoring: a linha exata é **:318** (não o intervalo :317-319; corrigido pelo Opus na fonte).
- `regulatory/06:123-125` (as linhas de anchoring do crosswalk/§D) — não confirmadas literalmente por nenhum leitor; confirmar quando o §C/§D entrar.
- A base do crosswalk em `regulatory.ts:1474,1502` — diff-verify quando o §C for construído.
- Os 6 docs fundadores em `~/Downloads/govai-docs/` (comercial/billing) — fora do acesso do arquiteto; aceitos como reportados pelo Fable5-CC.

## 7. Acesso e papéis (o mínimo operacional)
- Repo: `github.com/mauriciodesouzaads/govai-platform` @ `f975533d`. pnpm 10.x / TS / Fastify 5 / Postgres 16 / Node 24 (re2 ABI).
- Handoff: `<owner local handoff dir>/` (to-chat/ = deliverables; from-chat/ = auditorias; to-codex/ = os briefings).
- Papéis do protocolo: arquiteto (specs/auditorias, dono dos erros de premissa), Opus (revisor adversarial, lê o que o filtro do arquiteto bloqueia), GPT (auditor externo, forte em estrutura/mercado, sem acesso a código), Fable5 (o modelo dos deliverables, lê a home do dono), CLU (executor, fail-closes, diff-verifica). Regra A2: sem Co-Authored-By/Generated-with em commits/PRs/artefatos.

— Fim do índice-mestre. A fase de planejamento está encerrada (8 documentos, da visão à spec PR-a-PR, verificados por dois leitores). Os mockups das 3 telas-âncora foram renderizados. Daqui: construção, começando pelo P0.1 (F5+F6, o vazamento de PII), com cada diff voltando ao diff-verify na fonte.

---
## ADENDO DE RE-ANCORAGEM (2026-07-12 · base ed18736a · PR-0)
1. **§3 SUPERADO em parte:** P0.1 (F5+F6) foi **ENTREGUE** pelo PR #118 (merge 2026-07-11T17:58:47Z). O "primeiro código" passa a ser **P0.2 (F1+F2)**, conforme Mapa Mestre §6 Fase 0. Um item novo entra em P0: **C-2/G-30** (ver ADENDO do Gap Register).
2. **Documento de topo:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1). Este índice permanece o mapa do corpus; o Mapa Mestre rege ESTADO e ORDEM.
3. **Promoção handoff→repo (este PR):** os 8 deliverables de `to-chat/` agora vivem em `docs/architecture/{plans,registers,specs}/` com os nomes originais (specs de junho renomeadas ao padrão da casa — ver `docs/README.md` §Mapa-de-nomes). As referências deste índice a `/Users/Shared/govai-handoff/...` devem ser lidas contra esses destinos.
4. **§6 (pontos não-verificados) — atualização:** as âncoras F3 (`run-orchestrator.ts:467/:471/:647/:999`) referem-se a **f975533d**; o #118 **inseriu linhas acima** (≈:446-462) — os offsets **deslocaram** em `ed18736a`. Re-ancorar por conteúdo (`BEGIN`, `forwardRaw`, `COMMIT`), nunca por número herdado. O guard do anchoring (`0001:317`) permanece válido (verificado em ed18736a).
