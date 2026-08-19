> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** PLAN_TARGET (owner governance map v1.1; state/queue/hierarchy portions HISTORICAL_SNAPSHOT)
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (v1.1, 2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision M3 §2 hierarchy + §16 large-document policy (no explicit D-item; see NOTES))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `0740365adee17e5ed7e99b57892b325551d46203cc1dbfdda03ad55f8228a358` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** PLAN TARGET + HISTORICAL governance snapshot — the owner's July 2026 "Mapa Mestre" v1.1 (product thesis, four verbs, double gate, phased queue, market validation). Its self-declared role as "O DOCUMENTO DE TOPO" and its §0 hierarchy of truth, §6 queue and §7 triage are SUPERSEDED as of this promulgation: the current hierarchy of truth is `docs/README.md` §1 (code + tests → `current-state.md` + `foundation-v1-freeze.md` → accepted ADRs → target/plan corpus), the current queue is `docs/architecture/development-roadmap.md`, and resumption follows `docs/architecture/resume-playbook.md`. §1/§4 (thesis, product principles) remain the recorded product direction (target); §5 market validation keeps its own labels and expiry (sources verified 2026-07-12, quarterly re-verification — stale after ~2026-10-12; not refreshed here). Body byte-preserved. KNOWN-STALE FAMILIES: F0 technical items (F1–F4, C-2, EP-11) are ALL resolved (PRs #118/#119/#120/#123/#126/#129; F2 closed as an evidence-granularity residual); the "beta hard-denied / validação de ferramenta bloqueante" enforcement rungs describe the pre-M1 Native model — now pass-and-observe with only the provider-hosted computer-use floor (ADR-021 Accepted); README/D9/resume-playbook items of F0-documental are done by this movement; migration counts are historical (`current-state.md`). Still true: no UI (`apps/ui` absent), Phase 5 ask/enforce/sandbox forward, anchoring absent. Classification note: no explicit D-item names this document; the class follows M3 §2 (source hierarchy) and §16 (large-document policy).
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** VIGENTE — O DOCUMENTO DE TOPO
> **BASE DECLARADA PELO DOCUMENTO:** ed18736a (código) + 2026-07-12 (mercado) · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Hierarquia de verdade, fila (§6), triagem (§7), validação de mercado (§5, expira trimestralmente).
> **ORIGEM:** Gerado nesta operação (Fable 5), 2026-07-12
> ---

# GOVAI — MAPA MESTRE DE DESENVOLVIMENTO (o índice-raiz que carrega a verdade do código E a verdade do mercado)

**Versão 1.1 (2026-07-12)** — incorpora a **§5 Validação de Mercado e Correções de Sequência** e a fila re-priorizada. A v1.0 carregava só a verdade do código; esta carrega as duas.

**Este é o documento de cima.** Qualquer sessão de IA (Claude Code ou equivalente) começa AQUI. Ele não substitui o corpus existente — declara a hierarquia de verdade, re-ancora tudo ao commit atual, valida a tese contra o mercado de 2026, dá o veredito de triagem (MANTER / ADAPTAR / REUTILIZAR / ARQUIVAR / CONSTRUIR) para cada ativo, pesa Workroom e UI, e sequencia curto/médio/longo prazo até a possível venda.

- **Base de código (a verdade do estado atual):** `ed18736a91c04ab585742d47385d177a109cb0a1` (branch `main`, pós-PR #118 mergeado em 2026-07-11T17:58:47Z).
- **Base de mercado (a verdade da demanda):** verificação independente por pesquisa web em **2026-07-12** (fontes na §5.5, cada uma com data e prazo de re-verificação).
- **Corpus de arquitetura (a visão-alvo):** 19 documentos ancorados em `f975533d122afab251742c9459a12acc095dd8fb` (pré-#118). Listados na §8.
- **Como usar:** leia §0 (as 6 regras), depois §1 (o que o produto é), depois §5 (o que o mercado exige), e então vá à sua tarefa via §6 (a fila) e §7 (a triagem). Toda afirmação de estado deve ser re-verificada com `git rev-parse HEAD` antes de agir.

---

## §0 — As 6 regras (a régua que governa todo o resto)

1. **O CÓDIGO é a verdade do estado atual.** O corpus dá a visão-alvo. Onde divergirem, o código vence e você sinaliza a divergência. Sempre confronte `git rev-parse HEAD` com a base declarada da tarefa.
2. **Verifique todo fato load-bearing na fonte, venha de quem vier** — inclusive deste mapa. Este documento foi verificado em `ed18736a`; se você trabalha em outro commit, re-ancore.
3. **A hierarquia de verdade (do mais forte ao mais fraco):** (a) o código + os testes; (b) este mapa mestre; (c) o corpus de arquitetura (§8); (d) os documentos comerciais fora do repo (doc 01, doc 05). Em conflito, o mais forte vence. Para decisões de **sequência e posicionamento**, a §5 (validação de mercado) tem precedência sobre a ordem sugerida pelo corpus.
4. **Distinga sempre "confirmei que o código faz X" de "X é a prioridade certa".** O primeiro é fato de fonte. O segundo é juízo — e juízo de prioridade deve citar a §5.
5. **Gate duplo para tudo que entra no roadmap:** toda feature responde (a) "qual dos quatro verbos — Descobrir/Proteger/Governar/Provar — ela serve?" E (b) "quem paga por isso em ≤90 dias?". Passou nos dois → fase comercial corrente. Só no primeiro → backlog da visão com data de revisão. Em nenhum → não se constrói.
6. **★ NOVA (v1.1) — Afirmações de MERCADO seguem a mesma disciplina das âncoras de código:** carregam fonte nomeada + data + prazo de validade, e **expiram**. As da §5.5 devem ser re-verificadas **trimestralmente** (as regulatórias brasileiras, **antes de qualquer material comercial novo**). O portão de claims cobre também claims de mercado: nenhum pitch afirma demanda que a fonte não sustenta.

---

## §1 — O que o produto é (a tese, em uma página)

**GovAI é a camada de confiança para uso corporativo de IA.** Fica entre a empresa e os provedores (Anthropic, OpenAI, …), deixa as pessoas continuarem usando as ferramentas que já usam com mínima fricção, e por baixo torna todo uso **visível, protegido, governado e — o diferencial — registrado como evidência criptográfica que nem a própria plataforma consegue adulterar.**

**Os quatro verbos** (a espinha de produto e o filtro de backlog):

- **DESCOBRIR** — revelar onde a IA já é usada sem controle (Shadow AI). É o cartão de visitas / a oferta de entrada. *(Escopo honesto obrigatório — ver §5.2-C2.)*
- **PROTEGER** — detectar e barrar/mascarar dados sensíveis brasileiros (CPF, CNPJ, saúde, segredos) antes de saírem ao provedor.
- **GOVERNAR** — política por empresa, aprovações com separação de deveres (quem pede ≠ quem autoriza), salas de trabalho humano+multi-agente sob supervisão.
- **PROVAR** — cada uso vira registro selado em cadeia HMAC; o passo seguinte é ancorar externamente (Merkle → carimbo RFC 3161 → ICP-Brasil) para verificação por terceiro, offline, sem confiar na plataforma. O "cartório digital do uso de IA".

**O diferencial defensável (o moat), re-fundado pela §5:** não é o gateway, o DLP nem o dashboard (todos existem no mercado). É a **combinação**: evidência verificável por terceiro + especificidade jurídica brasileira. **A fundação imediata do moat é o que já é exigível HOJE — LGPD (com a ANPD fiscalizando IA ativamente) e as normas do CNJ para o Judiciário — mais os frameworks internacionais que o procurement já pede (ISO/IEC 42001, NIST AI RMF, EU AI Act para multinacionais). O PL 2338 (marco legal de IA) é REFORÇO FUTURO do moat, não sua fundação: está adiado e sob risco de reinício (§5.2-C4).** Os concorrentes globais são genéricos e americanos no eixo jurídico brasileiro.

**A estratégia:** não competir com Anthropic/OpenAI/Microsoft/ServiceNow — **integrar** todos. Começar pequeno (mid-market brasileiro onde a dor já é lei), monetizar com serviço antes de o produto ser self-service, e construir um ativo raro para uma **venda** a um player maior em 2–3 anos.

**A disciplina inegociável:** o produto se vende como *honestidade + evidência*. Portanto: nada de "compliance garantido", "prova aceita em tribunal" (universal), "PII redigida" onde não é, "certificado", **nem "descoberta completa de Shadow AI" (§5.2-C2)**. O vocabulário correto é "evidência técnica verificável", "prontidão de conformidade", "carimbo do tempo RFC 3161/ICP-Brasil onde implementado", "descoberta via sinais que o cliente já possui". Esta regra vale para todo texto de UI e de marketing (o "portão de claims" do corpus).

---

## §2 — O que está construído (o núcleo, verificado em `ed18736a`)

Isto é o ativo. Confirmado na fonte neste commit. Monorepo pnpm/TypeScript, Fastify 5, Postgres 16, Node 24. **2 apps** (`api`, `audit-sealer`), **13 pacotes**, **27 migrações** (0001–0028, sem 0006).

| Capacidade | Estado | Âncora-chave |
|---|---|---|
| Cadeia de auditoria HMAC append-only (4 categorias/org: auth/run/policy/admin) | **Construído + testado** | `apps/api/src/db/migrations/0001_audit_chain.sql`; `packages/core-audit/src/append.ts` |
| Outbox durável + AuditSealer (worker deployable; descoberta de orgs pelo banco; INV-1) | **Construído + testado** | migrações 0025–0028; `apps/audit-sealer/` |
| RLS FORCE universal + tenancy por `SET LOCAL app.org_id`; cross-tenant = 404 | **Construído + testado** | `packages/core-tenant/src/index.ts`; toda migração |
| KMS real (AWS) com fail-closed em produção; envelope encryption | **Construído** (smoke AWS registrado) | `packages/core-identity/src/kms/` |
| Crypto-shred (LGPD art. 18) como primitivo de banco | **Construído** (função existe; rota é 501) | `0001` fn `audit_event_payload_crypto_shred` (:399) |
| Gateway provider-native: 3 governed + 2 passthrough (Anthropic/OpenAI), byte-perfeito, SSE | **Construído + testado** | `packages/provider-*/src/{governed,routes}/` |
| DLP-BR baseline (CPF/CNPJ com checksum; CNPJ alfanumérico; email/phone) + camada rica SD1 advisory | **Construído + testado** | `packages/dlp-br/src/` |
| **Merge de spans de DLP (F5/F6)** — a correção do vazamento de PII | **Construído pelo #118** | `apps/api/src/pipeline/dlp.ts`; `packages/dlp-br/src/baseline-detectors.ts:175-217` |
| Núcleo regulatório R1–R9: 108 operações, máquinas de estado no banco | **Construído + testado** (é *evidência*, não enforcement de runtime) | `apps/api/src/routes/regulatory.ts`; migrações 0016–0024 |
| Workroom: criação transacional, modo imutável, participantes, transcript cifrado, aprovações com SoD em trigger | **Construído + testado** | migrações 0012–0015; `apps/api/src/routes/workroom-*.ts` |
| Cockpit de evidência (leitura): summary/gaps/audit-events/capabilities, com honestidades embutidas | **Construído** (backend; sem UI) | `apps/api/src/routes/{evidence,audit-events,capabilities}.ts` |
| Validador OpenAI Files pós-sunset (2026-08-26) | **Construído** (falta só o evento de auditoria do deny — §6 F0) | `packages/provider-openai/src/passthrough/files-purpose-validator.ts` |
| Campos reservados para o anchoring externo (o moat) | **Reservados desde o dia 1** | `0001`: `chain_anchor_id` (:47), `evidence_strength` 5 graus (:48-51), guard `:317` |

**Leitura de risco:** o núcleo passaria numa diligência técnica. As lacunas concentram-se em (a) alguns campos de evidência que ainda "mentem" (F0), (b) o produto não ter rosto (UI), (c) as features de receita não existirem ainda, (d) o enforcement real ser estreito (§5.2-C3), e (e) não haver clientes.

---

## §3 — O que falta (as lacunas, por categoria)

**3.1 — Consertos de honestidade do evento (F0 técnico — pequenos, verificados como pendentes em `ed18736a`):**
- **F1** — `credential_source` é literal `'tenant_provider_credential'` em 14 pontos, mesmo quando a credencial veio de env. Alvo: derivar do resolvedor. Âncoras: `handle-messages.ts:283,351,416` + OpenAI + passthrough.
- **F2** — no bloqueio, o evento grava `enforcement_decision:'blocked'` fixo mesmo quando o gatilho foi validação de ferramenta. Alvo: decisão real + `block_trigger`. Âncora: `handle-messages.ts:278`.
- **F3** — transação aberta durante o fetch upstream no `/v1/runs` (exaustão de pool) + sem timeout no forward + `/health` estático. Alvo: fechar tx antes do fetch; AbortSignal+timeout; `/ready` real. Acopla o `dispatch_status` (G-17). Âncoras: `run-orchestrator.ts:467,471,647,999`.
- **F4** — identidade de request via `enterWith` (perda de captura em caminho terminal). Alvo: `als.run`. Uma linha. Âncora: `request-identity-hook.ts:63`.
- **C-2** *(achado da auditoria independente, NÃO no corpus original)* — no ramo governed-blocked, `provider_invocations` grava `native_request_hash = '\x00'` embora o hash real exista. Alvo: gravar o hash real. Âncora: `run-orchestrator.ts:809-811` (confirmado presente pós-#118).
- **EP-11** — o deny do OpenAI Files pós-sunset (2026-08-26) precisa do **evento de auditoria** + teste da virada. ★ Prazo externo. Âncora: `files-purpose-validator.ts`.

**3.2 — Verdade documental (F0 documental — a Docs Consistency Review mapeou tudo):**
- README nega o SoT (afirma "B3 não implementado" quando o sealer existe e roda). `README.md:13-15`.
- resume-playbook ~24 PRs atrás, instrui re-fazer decisões tomadas.
- governance-philosophy afirma "hard-deny floor sempre ativo" que o código contradiz.
- 3 referências no código apontam para ADRs inexistentes no repo (D9 — a doutrina não está versionada).
- ★ **(v1.1)** Os textos de posicionamento pendem o moat no PL 2338 — re-fundar em LGPD+CNJ (§5.2-C4).

**3.3 — O produto não tem rosto:** `apps/ui` não existe (confirmado: `apps/` só tem `api` e `audit-sealer`).

**3.4 — As 5 features de receita não existem** (grep vazio confirmado em `ed18736a`): Policy Studio, Review Queue, Evidence Package, Connector Framework, Compliance Crosswalk. Especificadas no corpus com schema+endpoints+testes; falta construir.

**3.5 — O moat não existe ainda:** anchoring externo (Merkle → RFC 3161 → ICP-Brasil). Os campos estão reservados; o mecanismo, não.

**3.6 — O enforcement real é estreito** (o mercado pune isso — §5.2-C3): hoje o caminho governado bloqueia poucos vetores; `ask/enforce/sandbox_required` encaminham; DENIED regulatório é evidência, não bloqueio.

**3.7 — Descoberta cobre 1 de 7 camadas de sinal** (§5.2-C2): o gateway vê só as chamadas de API que passam por ele.

**3.8 — Não há clientes.** Nenhum pagante. É a lacuna que domina as outras.

---

## §4 — Os dois pesos avaliados (Workroom e UI)

### 4.1 — O peso da Workroom
**Veredito: ADAPTAR o posicionamento, NÃO reconstruir; congelar a expansão de UI da sala; tratar como diferencial de nicho, não como produto principal.**
- O backend é forte e completo (participantes, turnos com lock, transcript cifrado, aprovações com SoD em **trigger de banco**, consumo one-time, expiry em leitura) — 40–60% de um produto de colaboração multi-agente governada já pronto.
- O risco é posicioná-la como "mais um chat multi-modelo" (competir com o quintal dos provedores). A adaptação certa: é o **ambiente opcional** ("Modo 2"); o que a diferencia é que **cada turno de cada agente é evidência selada e cada ação sensível exige aprovação humana registrada** — o precursor de governança agêntica, que a §5 mostra ser a fronteira do mercado.
- Peso no roadmap: **não é curto prazo**. Backend pronto, sem investimento agora; UI da sala em fase média, puxada por cliente.

### 4.2 — O tamanho da UI
**Veredito: FASEAR agressivamente. U1 (o cockpit, ~4 telas) no curto prazo; as ~64 telas restantes por demanda de cliente.**
- A arquitetura do corpus (SPA `apps/ui`, React+TS+Vite, sem BFF/SSR, design "Ledger", vocabulário de honestidade testável) é adotada como está — sem reparo técnico.
- 51→68 telas nominais = ~25 únicas + 1 template regulatório 17×2. Ainda assim: **U1 já** (4 telas, zero endpoint novo, read-only, é a vitrine e é dias de trabalho); U2 workroom em fase média; U3 regulatório mecânico por demanda; U4 fecha operações.
- A regra: a UI **segue** os primeiros clientes; para vender, o mínimo é U1 + pacote probatório + Diagnóstico (re-escopado, §5.2-C2).

---

## §5 — ★ VALIDAÇÃO DE MERCADO E CORREÇÕES DE SEQUÊNCIA (verificada em 2026-07-12)

Esta seção existe porque "arquitetura ideal" tem duas metades: coerência interna (verificada contra o código) e adequação ao que o mercado exige (verificada de fora). A v1.0 só tinha a primeira. Fontes nomeadas, datadas e com prazo de validade na §5.5.

### 5.1 — O que o mercado CONFIRMA (a tese sobrevive, e mais forte)

1. **A categoria foi consagrada.** Em 16/06/2026 a Gartner publicou o primeiro Magic Quadrant de AI Governance Platforms — a primeira vez que trata governança de IA como mercado de software distinto, com orçamento e comprador próprios. "Estou construindo algo que já existe" virou "estou construindo numa categoria recém-legitimada". *(Fonte M5.)*
2. **O critério que separa vencedores de "teatro de compliance" é exatamente a tese do GovAI.** A pergunta-teste de mercado para qualquer fornecedor em 2026: mostrar a trilha de auditoria **imutável** por trás de uma mudança de status de controle, com o item de evidência, quem aprovou e o timestamp. Quem não mostra, vende artefatos, não governança. A cadeia HMAC + aprovações com SoD + eventos selados do GovAI respondem a essa pergunta **hoje**. *(Fonte M5.)*
3. **Evidência automatizada e contínua (não auditoria periódica) é o diferencial declarado de 2026+.** Monitoramento em tempo real + geração automática de evidência + alinhamento regulatório proativo. É o Evidence Plane. *(Fonte M1.)*
4. **Governança agêntica é a fronteira** (traços de raciocínio, permissões de ferramenta, escalonamento, monitorar múltiplos agentes no mesmo ambiente) — e o precursor disso no GovAI (Workroom com intended_action_hash + SoD + classificação de ferramenta) já existe no backend. *(Fonte M6.)*

### 5.2 — As QUATRO CORREÇÕES (onde o corpus fechou cedo demais)

**C1 — As duas camadas do mercado: assumir explicitamente que o GovAI é AMBAS.**
O mercado de 2026 se organiza em duas camadas que os compradores **combinam**: plataformas de política/GRC acima da pilha (inventário, mapeamento a frameworks, evidência para auditor) e gateways de runtime dentro do caminho do dado (interceptam cada request, aplicam política, redigem PII). Para a maioria das empresas, a resposta é a pilha em camadas — as duas. *(Fonte M3.)* O GovAI tem o gateway **e** o núcleo regulatório — ele É as duas camadas, mas o corpus nunca declara isso como escolha. **Correção:** declarar. O pitch nomeia as duas camadas; o Crosswalk é a ponte entre elas (a decisão de runtime referenciada pelo requisito de framework); o risco de dispersão é gerenciado pelo gate duplo, não negado.

**C2 — Shadow AI: o padrão de mercado são SETE camadas de sinal; o gateway cobre UMA.**
Descoberta completa em 2026 = detectar IA em: tráfego de rede, atividade de navegador, comportamento de endpoint, repositórios de código, sistemas de identidade, aplicações SaaS e chamadas de API. A maioria das plataformas entrega visibilidade parcial — e o mercado pune quem vende "dashboards sobre a IA que você já perdeu". *(Fonte M2.)* **Correções:** (a) o Diagnóstico Shadow AI é **re-escopado honestamente**: "descoberta via sinais que o cliente já possui (logs de rede/proxy/SaaS/identidade) + o gateway" — nunca "descoberta completa"; o claim entra na lista proibida do portão. (b) O roadmap ganha uma **escada de sensores por camada** (custo crescente): logs que o cliente já tem → conectores SaaS/identidade → extensão de navegador read-only → endpoint **adiado** (é a camada mais cara e de maior atrito). (c) A integração com quem já cobre camadas (Purview/Netskope/SIEM) é caminho de produto, não vergonha — é o "standalone E integrada" do corpus, agora com razão de mercado.

**C3 — Enforcement real sobe de "Fase 5" para trilho contínuo com um degrau vendável por fase.**
O mercado distingue com desprezo monitoramento de enforcement, e exige bloqueio na camada de execução — ação impedida antes de concluir, não documentada depois. Fornecedores que confundem os dois são o alvo declarado dos guias de compra. *(Fontes M2, M3.)* O GovAI hoje é majoritariamente observacional (honesto internamente — o vocabulário de honestidade existe para isso — mas insuficiente como posição de venda). **Correção de sequência (não de arquitetura):** cada fase entrega um degrau de enforcement REAL e demonstrável:
- *Já existe:* deny de DLP configurável no `/v1/runs` (403 real); validação de ferramenta bloqueante; beta hard-denied.
- *Fase 1 (antecipado — era o EP-10/Q2 tardio):* **convergência deny-primeiro** — o caminho `/governed/*` passa a respeitar a config de DLP da org (hoje uma org com `deny` para CPF é bloqueada no `/v1/runs` e tem o MESMO CPF encaminhado no `/governed`). É o degrau mais barato de enforcement real e elimina a assimetria mais constrangedora do produto.
- *Fase 3:* Review Queue com modo retenção opt-in (o "ask" que segura de verdade).
- *Fase com data-alvo (não "algum dia"):* DENIED regulatório bloqueando o runtime (a Fase 5 do roadmap do corpus) — colocar data na fila, porque é o que o comprador enterprise testa no POC.

**C4 — Re-fundar o moat: LGPD+CNJ exigíveis HOJE; PL 2338 como reforço futuro; EU AI Act como relógio das multinacionais.**
Estado real verificado: o PL 2338 foi aprovado no Senado em 10/12/2024, está na Câmara (Comissão Especial), teve a votação **adiada para 2026** por impasses políticos, e o próprio Executivo apontou **vício de iniciativa** (o sistema de governança cria despesas e autoridades — matéria de iniciativa do Executivo), com risco de inconstitucionalidade/reinício. *(Fontes M7, M8.)* Pendurar o moat nele é pendurar em cronograma incerto. **O que é exigível AGORA:** a LGPD (com a ANPD tendo publicado em dez/2025 o Mapa de Temas Prioritários 2026-2027 com IA como eixo de fiscalização, e um sandbox regulatório de IA já em operação — ou seja, a autoridade já regula IA na prática via LGPD) *(Fonte M9)*; e o CNJ — citado como o único órgão de cúpula judiciária lusófono com regulação própria e estruturada de IA (transparência, rastreabilidade, auditoria, responsabilidade) *(Fonte M10)*. **E o relógio que move dinheiro agora é europeu:** o enforcement pleno do EU AI Act para sistemas de alto risco em **02/08/2026**, com multas de até €35M/7% do faturamento global — argumento de venda direto para subsidiárias e exportadoras brasileiras. *(Fontes M1, M4.)* **Correções:** (a) todo texto de posicionamento re-fundado em "LGPD + CNJ hoje; PL 2338 como reforço quando vier"; (b) o pitch para multinacionais ganha o ângulo EU AI Act; (c) monitorar o PL trimestralmente (regra §0.6) — se aprovar, é upgrade de moat; se reiniciar, nada quebra.

### 5.3 — Dois requisitos de mercado que SOBEM na fila

1. **Controles compartilhados / dedup entre frameworks decide shortlist.** Uma ação de controle, documentada uma vez, satisfazendo EU AI Act + ISO 42001 + NIST + LGPD simultaneamente — sem isso, o cliente se afoga em trabalho duplicado. *(Fonte M4.)* Isso É o Compliance Crosswalk (§C do corpus) — que estava na Fase F8. **Sobe:** seed LGPD na Fase 2 (a tabela curada de `regulatory/01` já existe); motor completo multi-framework na Fase 3.
2. **Paridade de deployment + SOC 2 Type II / ISO 27001 como baseline de procurement.** A plataforma de governança vê cada interação de IA — é alvo de alto valor e é avaliada como sistema crítico; a pergunta-teste é "o que não funciona on-premises, e por quê?". *(Fonte M2.)* **Sobe:** trilho de SOC 2 readiness inicia na Fase 2 (políticas, gestão de acesso, logging — muito já existe por construção); certificação Type II como pré-requisito do tier enterprise; ISO 42001 avaliada como credencial de procurement (decisão de orçamento do dono — §9). O deployment dedicado (células/BYOK) que o corpus já desenha ganha razão de mercado.

### 5.4 — O que o mercado NÃO exige (e o mapa mantém fora da frente)
Treinar modelo próprio; UI de usuário final competindo com os providers; agente de endpoint no curto prazo; certificações "de IA" auto-declaradas; clone de SIEM/GRC/BI. (Coerente com a matriz build/integrate do corpus — o mercado confirma a matriz.)

### 5.5 — AS FONTES (verificadas em 2026-07-12 · re-verificar trimestralmente · regulatórias BR: antes de qualquer material comercial)

| # | Afirmação-chave (parafraseada) | Fonte | Data |
|---|---|---|---|
| M1 | Evidência automatizada contínua como diferencial; EU AI Act pleno para alto risco em ago/2026; consolidação da categoria | adeptiv.ai — "Best AI Governance Platforms: Enterprise Buyer's Guide (2026)" | jul/2026 |
| M2 | 7 camadas de descoberta; enforcement na camada de execução vs monitoramento; paridade de deployment; SOC 2 Type II/ISO 27001 baseline; a plataforma é alvo de alto valor | airia.com — "Enterprise AI Governance Platform Buyer's Guide" | 06/07/2026 |
| M3 | Mercado em 2 camadas (policy/GRC + runtime gateway); a maioria precisa das duas | getmaxim.ai — "Best AI Governance Platforms in 2026: A Buyer's Guide" | abr/2026 |
| M4 | Controles compartilhados/dedup decide shortlist; EU AI Act 02/08/2026 com €35M/7%; governança agêntica ao vivo como critério | modulos.ai — "The buyer's checklist for AI governance platforms" | mai/2026 |
| M5 | 1º Gartner MQ de AI Governance Platforms (16/06/2026); teste do fornecedor = trilha imutável com evidência+aprovador+timestamp; preços típicos ~US$50k/ano (mid) a centenas de milhares (enterprise) | modulos.ai — "AI governance tools: the 2026 enterprise buyer's guide" | mai-jun/2026 |
| M6 | Governança agêntica (traços de raciocínio, permissões de ferramenta, multi-agente) como maior gap do mercado; ~40% das apps enterprise com agentes até fim de 2026 | modulos.ai (checklist, idem M4) | mai/2026 |
| M7 | PL 2338: aprovado no Senado 10/12/2024; na Câmara (Comissão Especial); votação adiada para 2026 por impasses; vício de iniciativa apontado (despesas/autoridades → iniciativa do Executivo; risco de inconstitucionalidade) | desinformante.com.br + fichas Câmara/Senado | dez/2025 + 2026 |
| M8 | Tramitação 2026: aguardando parecer do relator na Comissão Especial; cenário "urgente e incerto"; calendário eleitoral pesa | camara.leg.br; barbieriadvogados.com | mar-jul/2026 |
| M9 | ANPD: Mapa de Temas Prioritários 2026-2027 (dez/2025) com IA como um dos 4 eixos de fiscalização; sandbox regulatório de IA em operação — a ANPD já regula IA via LGPD na prática | barbieriadvogados.com — "Regulamentação da IA no Brasil 2026" | mar/2026 |
| M10 | CNJ: único órgão de cúpula judiciária lusófono com regulação própria estruturada de IA (transparência, rastreabilidade, auditoria, responsabilidade) | blog.cbrdoc.com.br — "Marco Legal da IA terá votação final em 2026" | jan/2026 |

*(Nota de método: M1–M6 são guias de compra de fornecedores/analistas — úteis para "o que o comprador pergunta", com viés comercial de cada autor; M7–M10 são estado regulatório factual. Nenhuma citação literal acima de frase curta; tudo parafraseado. Complementam — não substituem — a validação definitiva, que são os design partners da Fase 2.)*

---

## §6 — A FILA DE EXECUÇÃO RE-PRIORIZADA (curto → médio → longo prazo, até a venda)

Cada fase tem critério de saída. Não pular o critério de uma fase para começar a seguinte. Alterações da v1.1 marcadas com ★.

### FASE 0 — VERDADE (curto prazo; semanas). *"O núcleo precisa dizer a verdade."*
- **Técnico:** F1+F2 (campos do evento derivados-de-fato) · F3+dispatch_status · F4 (uma linha) · **C-2** (o `\x00` → hash real) · **EP-11** (evento do deny pós-sunset — ★ prazo externo 2026-08-26).
- **Documental (peso igual):** as 10 correções da Docs Consistency Review, começando por README + resume-playbook + **D9** (versionar a doutrina — fecha as 3 referências quebradas). ★ **Adicionado:** re-fundar o moat nos textos (README/posicionamento): LGPD+CNJ hoje, PL 2338 como reforço (§5.2-C4).
- **Re-baseline:** F5/F6 **CONCLUÍDO** pelo #118 (o corpus os lista como pendentes por ter sido escrito antes do merge) — libera o vocabulário de redação.
- **Critério de saída:** os eventos não mentem; os docs não contradizem o código nem o mercado; gates verdes.

### FASE 1 — NÚCLEO CONFIÁVEL + os primeiros degraus de PROVAR e de ENFORCEMENT (curto-médio).
- **U1** (o cockpit — 4 telas, sobre rotas prontas) + EP-1 (rate limit por chave) + EP-2 (whoami).
- **EP-V1** (verificação de cadeia operacionalizada — tira EC-6 de `pending`).
- **§D PR-A** (Merkle batching — 100% offline-testável). Eventos nascem `hmac_internal` e ganham grau pós-selagem; guard `:317` fica.
- ★ **Enforcement degrau 1 (antecipado de EP-10/Q2):** convergência **deny-primeiro** — `/governed/*` passa a respeitar a config de DLP da org (§5.2-C3). Elimina a assimetria `/v1/runs` vs `/governed`.
- ★ **Rota de crypto-shred** (a função de banco existe; a rota é 501): fecha o degrau LGPD art. 18 — barato e vendável.
- **Paralelo comercial (lead-time):** shortlist de ACTs ICP-Brasil + parecer de counsel sobre o claim jurídico.
- **Critério de saída:** colar-chave → cockpit real; a cadeia se verifica; um lote tem prova Merkle offline; um CPF com `deny` é bloqueado em AMBOS os caminhos; um titular pode ser crypto-shredded via API.

### FASE 2 — EMPACOTAR 3 OFERTAS + design partners (médio; ~90 dias). *A tese vira receita.*
- **Oferta A — Diagnóstico Shadow AI** ★ **re-escopado (§5.2-C2):** "descoberta via sinais que você já possui" (logs de rede/proxy/SaaS/identidade + o gateway) — serviço de entrada, preço fixo. NUNCA "descoberta completa".
- **Oferta B — Gateway GovAI** (núcleo + U1 + pacote probatório + enforcement degrau 1) — assinatura.
- **Oferta C — Relatórios de conformidade**: Evidence Package (§B) + ★ **Crosswalk seed LGPD antecipado de F8** (a tabela curada de `regulatory/01` vira células vivas) — add-on. Com o dedup de frameworks como argumento (§5.3.1).
- ★ **Trilho SOC 2 readiness inicia** (políticas, acesso, logging — §5.3.2); decisão ISO 42001 vai ao dono (§9).
- ★ **Pitch para multinacionais ganha o ângulo EU AI Act** (02/08/2026 — §5.2-C4).
- Reconciliação billing (doc 05 × tiers do código: "Partner" vs "regulated").
- **Alvo:** 3–5 design partners pagantes; ICP onde a dor já é lei (advocacia média — CNJ; contabilidade; saúde; quem tem DPO; ★ subsidiárias de multinacionais — EU AI Act). Canal: consultorias de LGPD.
- **Critério de saída:** contrato assinado com ≥1 design partner; o Diagnóstico rodando sobre logs reais; nenhum material comercial com claim fora do portão.

### FASE 3+ — O ROADMAP DO CORPUS sob o gate duplo (médio-longo).
- As features na ordem ajustada: **N2 Review Queue** (pós-hoc → retenção opt-in = enforcement degrau 2) → **N1 Policy Studio** (standalone real; o CRUD de DLP já tem assento no 501) → **§C Crosswalk motor completo multi-framework** ★ (antecipado; decide shortlist) → **N4 Connectors** (export SIEM primeiro; ingestão após threat-model T6) → demais.
- ★ **Escada de sensores de descoberta por camada** (§5.2-C2): conectores SaaS/identidade → extensão de navegador read-only → endpoint adiado.
- **§D** avança: PR-B (RFC 3161 genérico) → PR-C (ICP-Brasil quando a ACT fechar) → PR-D (verify estendido + pacote com prova).
- UI U2→U4 por demanda; Workroom UI mínima quando cliente pedir.
- ★ **Enforcement com data-alvo:** DENIED regulatório bloqueando o runtime (a "Fase 5" do corpus) entra no calendário — é o que o comprador enterprise testa no POC (§5.2-C3).
- **Longo prazo / pré-venda:** ★ SOC 2 Type II certificado (pré-enterprise) · kernel extraído (na 3ª superfície) · BYOK/`customer_signed` · células dedicadas · DR provado com verify · SBOM.
- **Critério de venda (exit-readiness):** receita recorrente + clientes no fluxo crítico + o moat verificável (evidência ancorada ICP-Brasil) + IP limpo (doutrina versionada) + ★ postura de segurança auditável (SOC 2) + este mapa e o corpus como o data-room técnico pronto.

---

## §7 — Triagem por ativo (MANTER / ADAPTAR / REUTILIZAR / ARQUIVAR / CONSTRUIR)

### 7.1 — Código existente
| Ativo | Veredito | Nota |
|---|---|---|
| Cadeia HMAC + outbox + sealer + RLS + KMS + tenancy | **MANTER** | O núcleo defensável — e a resposta ao teste-de-fornecedor do mercado (§5.1.2). |
| DLP-BR (incl. merge de spans do #118) | **MANTER + ADAPTAR** | ★ Convergência deny-primeiro sobe para Fase 1 (§5.2-C3). |
| Gateway provider-native | **MANTER** | Byte-perfeito, testado. A camada runtime do mercado (§5.2-C1). |
| Núcleo regulatório (108 ops) | **MANTER + REUTILIZAR** | A camada policy/GRC do mercado (§5.2-C1); base do Crosswalk. |
| Workroom (backend) | **MANTER + ADAPTAR posicionamento** | §4.1; precursor da governança agêntica que o mercado aponta como fronteira (§5.1.4). Congelar expansão. |
| Cockpit de evidência (backend) | **MANTER** | U1 consome direto. |
| F1–F4/C-2/EP-11 | **ADAPTAR (corrigir)** | Fase 0. |
| Rota crypto-shred (501) | **CONSTRUIR (fina)** ★ | Fase 1 — a função de banco já existe; degrau LGPD art. 18. |

### 7.2 — Documentação (o corpus)
| Ativo | Veredito | Nota |
|---|---|---|
| Master Plan, Execution Manual, UI Master Plan, 4 Specs+Anchoring | **REUTILIZAR como visão-alvo canônica** | Atualizar estado: F5/F6 concluído; C-2 aberto; ★ sequência corrigida pela §5. |
| Gap/Source Register, Implementation Queue, Índice-Mestre | **REUTILIZAR** | Re-ancorar ao `ed18736a`. |
| Docs Consistency Review + Doc Catalog | **REUTILIZAR como lista de trabalho F0** | + ★ o item novo de re-fundação do moat nos textos. |
| ADRs 029/030/031, specs shadow-ai/mcp-gateway, plano de consolidação | **REUTILIZAR + VERSIONAR** | D9, Fase 0. ★ A spec shadow-ai ganha o escopo de camadas da §5.2-C2. |
| Doutrina fora do repo (master-arch, ADR-016..019, claims-policy, threat-model, spec-v2.1) | **VERSIONAR (D9)** | Item nº 1 de F0-documental. |
| README, resume-playbook, governance-philosophy, baseline-decisions | **ADAPTAR (reescrever)** | F0-documental. |
| Doc 01 (comercial) e Doc 05 (tiers) | **REUTILIZAR com reconciliação** | ★ Doc 01 re-fundado em LGPD+CNJ (§5.2-C4); Doc 05 reconciliado com tiers do código; pricing sanity-check contra M5 (~US$50k/ano mid-market como referência de mercado). |
| Históricos (ADP v3/v4/v4.1, matrizes antigas, OPERATION-STATE rev1–42, backups) | **ARQUIVAR** | Trilha; não normativos. |

### 7.3 — O que CONSTRUIR (com a fase da fila re-priorizada)
| Ativo | Fase | Verbo(s) |
|---|---|---|
| `apps/ui` + U1 (cockpit) | 1 | PROVAR (vitrine) |
| §D PR-A (Merkle) → PR-B (RFC 3161) → PR-C (ICP) → PR-D | 1→3+ | PROVAR (moat) |
| ★ Convergência DLP deny-primeiro (`/governed` respeita config da org) | 1 | PROTEGER (enforcement degrau 1) |
| ★ Rota crypto-shred | 1 | PROVAR/PROTEGER (LGPD art. 18) |
| Diagnóstico Shadow AI (serviço, escopo honesto) | 2 | DESCOBRIR |
| Evidence Package (§B) | 2 | PROVAR |
| ★ Crosswalk seed LGPD (antecipado de F8) | 2 | PROVAR/GOVERNAR |
| ★ Trilho SOC 2 readiness | 2→ | (procurement) |
| Review Queue (N2; retenção opt-in = enforcement degrau 2) | 3 | GOVERNAR |
| Policy Studio (N1) | 3 | GOVERNAR (standalone real) |
| ★ Crosswalk motor multi-framework (dedup) | 3 | PROVAR/GOVERNAR |
| Connectors export SIEM (§A) → ingestão | 3 | integração |
| ★ Sensores de descoberta (SaaS/identidade → navegador → endpoint adiado) | 3+ | DESCOBRIR |
| ★ Enforcement regulatório com data-alvo (DENIED bloqueia) | 3+ (datado) | GOVERNAR |
| U2/U3/U4; Workroom UI mínima | 3+ | por demanda |
| SOC 2 Type II · kernel · BYOK · células · DR provado · SBOM | pré-venda | exit-readiness |

---

## §8 — O corpus (os 19 documentos que este mapa indexa)

Todos ancorados em `f975533d`. Ordem de leitura para entender: 1→2→3. Para construir: Implementation Queue + Specs.

**Visão e arquitetura:** (1) Master Plan da Aplicação (os 7 planos, o contrato de 140 rotas, F0–F9). (2) Execution Manual (banco completo, threat model, DR, specs densas, F1–F6 re-ancorados). (3) UI Master Plan. (4) UI Architecture Consult.
**Referência de estado:** (5) Doc Catalog. (6) Source Register. (7) Gap Register. (8) Docs Consistency Review. (9) Índice-Mestre.
**Construção:** (10) Implementation Queue (P0–P3). (11) Specs Enterprise+Anchoring (Connector, Evidence Package, Crosswalk, **Anchoring §D — o moat**).
**Handoff (a versionar):** (12) Plano de Consolidação. (13) Spec AuditBridge. (14) Spec DLP CNPJ alfanumérico. (15) Spec Shadow AI v1. (16) Design MCP Gateway v1. (17) ADR-029. (18) ADR-030. (19) ADR-031.

---

## §9 — Pendente de DECISÃO do dono (não são lacunas técnicas)

1. **Posicionamento dual-camada declarado** (§5.2-C1): assumir publicamente "runtime + policy/GRC numa plataforma" como a identidade — ou escolher uma âncora e tratar a outra como extensão.
2. **Ordem/ponta-de-lança das 3 ofertas** (recomendação: Diagnóstico re-escopado como entrada).
3. **Orçamento e timing de SOC 2 (Type I → II) e avaliação de ISO 42001** (§5.3.2) — são pré-requisitos de procurement enterprise, custam dinheiro e meses.
4. **Reconciliação billing** (doc 05 × tiers do código; sanity-check com M5).
5. **Leitura de transcript da Workroom** (D1) e **operador no produto ou Grafana** (D3).
6. **Claim jurídico ICP-Brasil** — parecer de counsel (§D.6), em paralelo desde a Fase 1; **qual tier inclui o anchoring ICP** (o preço premium).
7. **Data-alvo do enforcement regulatório** (§5.2-C3) — compromisso de calendário, não só de backlog.

---

## §10 — Instrução final para a IA implementadora

Você tem, entre este mapa e o corpus, a documentação de curto, médio e longo prazo — da correção de hoje até a venda — com a arquitetura **ideal e integral** já descrita e, a partir da v1.1, **validada contra o mercado** com fontes datadas. Isso é intencional: nenhuma sessão re-decide arquitetura no meio do caminho, e nenhuma sessão constrói na ordem que o mercado não paga.

Ao pegar uma tarefa: (1) confirme o commit; (2) ache a tarefa na fila (§6) e na triagem (§7); (3) abra a spec no corpus (§8); (4) re-ancore cada âncora de linha na fonte antes de editar; (5) implemente com o teste de aceitação junto; (6) respeite o portão de claims — **inclusive claims de mercado (§0.6)**; (7) re-ancore o SoT ao terminar. Se a §5 estiver com mais de um trimestre, re-verifique as fontes antes de decisões de sequência; se o PL 2338 mudar de status, atualize §5.2-C4 e os textos de posicionamento antes de qualquer material novo. Nunca afirme — na UI, em doc ou em pitch — capacidade que o código não entrega nem demanda que a fonte não sustenta. O produto é *honestidade + evidência*; a documentação e o comercial obedecem à mesma regra.

— Fim do mapa mestre v1.1. Base de código `ed18736a`; base de mercado 2026-07-12; indexa o corpus `f975533d`; re-baseia F5/F6 como concluído; adiciona C-2; pesa Workroom (adaptar/congelar) e UI (fasear); incorpora as 4 correções de mercado (dual-camada · Shadow AI honesto · enforcement por degraus · moat re-fundado em LGPD+CNJ) e os 2 requisitos que sobem (Crosswalk/dedup · SOC 2/deployment); e sequencia da verdade de hoje à venda de amanhã.
