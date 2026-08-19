> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** PLAN_TARGET
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-07 at f975533d, Briefing #6)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D11B=APPROVED_AS_PLAN_TARGET)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (one private absolute local path redacted per M3 §51; body otherwise byte-preserved incl. the PR-0 header)
> **SOURCE_SHA256:** `e15eb00730fb80051f54f1ed388484152405963f5c3f9f0e51983d44ef2e4102` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** PLAN TARGET (D11b) — the July 2026 master plan of the whole application (7 planes, backend→UI). Body byte-preserved (large-document policy: no rewrite). KNOWN-STALE FAMILIES IN THE BODY, all superseded at the Foundation V1 anchor — read them as the July 2026 snapshot: (a) F1–F6 marked "pendente / até o fix" → F1, F3, F4, F5, F6 and C-2 are CORRECTED (PRs #118/#119/#120/#123) and F2 is CLOSED as an evidence-granularity residual (not a runtime defect); (b) the pre-M1 hard-deny floor ("3 tool validation classes + 3 hard_denied beta tokens", default-deny betas, `capability_planned`/`typed_unknown` 403s) → SUPERSEDED by the M1 native contract (ADR-021 Accepted): only provider-hosted computer-use is hard-denied, unknown/unresolved betas and non-computer tools are forwarded and observed; (c) EP-11 framed as "add the deny audit event / external deadline" → SUPERSEDED by ADR-032/EP-11 (the local deny was REMOVED, provider truth preserved); (d) `dispatch_status`/G-17 "coupled to F3" → realized by the P0.3-A durable dispatch layer (migration 0029) and P0.3-C run idempotency (0030) in a different shape; (e) D9 "pendente" → executed by M3; (f) migration/test/route counts and `arquivo:linha` anchors → current counts live in `docs/architecture/current-state.md`. Statements consistent with the anchor and still true: no UI exists; Phase 5 ask/sandbox/enforce primitives are NOT implemented (recommendation vs applied is honest over HTTP); no branch protection; hash-only capture. ONE bounded body edit for privacy (M3 §51): the absolute local filesystem path of the owner's audit checkout in the "Nota de proveniência" table (item on the v0.9 master architecture) was replaced by a neutral label; nothing else in the body changed. The v0.9 doctrine that table reports as "NÃO versionada" is now promulgated in this tree (`docs/architecture/master-architecture-v0.9.md`, `docs/architecture/adr/ADR-016..019`, `docs/architecture/claims-policy.md`).
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** VISÃO-ALVO CANÔNICA
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Delta conhecido: F5/F6 = CONCLUÍDO (#118); C-2 = novo achado aberto; sequência de fases regida pelo Mapa §6.
> **ORIGEM:** handoff to-chat/
> ---

# GOVAI — PLANO-MESTRE DA APLICAÇÃO INTEIRA (os 7 planos, backend→UI: visão-alvo + caminho de execução)

**Base:** `github.com/mauriciodesouzaads/govai-platform` @ `f975533d122afab251742c9459a12acc095dd8fb` (árvore extraída por `git archive` do checkout local verificado em exatamente este commit; toda âncora `arquivo:linha` abaixo foi lida nesta sessão nessa árvore, salvo marcação em contrário).
**Briefing:** `to-codex/BRIEFING-6-FABLE5-MASTER-PLAN-APPLICATION_f975533d.md` (rev2).
**Autor:** Fable 5 / Claude Code, 2026-07-07.
**Posição na série:** este é o documento-mestre DEFINITIVO da aplicação inteira. Consolida e completa os cinco pareceres anteriores da série (auditoria de correção F1–F6; decisões de design Q1–Q4; reconciliação documental; arquitetura de UI; plano-mestre de UI) — não os re-descobre; re-verificou nesta sessão tudo o que é load-bearing (Cap. 3 e Cap. 6, Regra #4 do briefing) e herda o resto com marcação explícita.

**Método (o que foi feito nesta sessão):** li a fonte no commit pinado — o resolvedor de governança inteiro (`enforcement.ts`, `resolve-governance.ts`), os DOIS registries de capacidade completos, o classificador de ferramentas, o handler governado Anthropic integral, os literais dos handlers OpenAI e do passthrough, `auth.ts`, `server.ts`, `runs.ts`, `dlp.ts` + `baseline-detectors.ts` (F5 verificado literalmente), o pipeline de evidência (`audit-bridge.ts`, `evidence-reports.ts`, `evidence-operator.ts`, métricas), o schema do evento (`passthrough-invoked.ts`), `core-audit`, `core-tenant`, `core-identity` (KMS/JWT/api-keys/RBAC), o sealer (config/discovery/Dockerfile/bundle), `bootstrap.sql`, as 27 migrações (listagem), o CI e o `vitest.config.ts` — e **contei as rotas com grep real** (a contagem exata está no Cap. 3 e o comando regenerável no Cap. 13). Li os docs de doutrina para a visão-alvo (ver a nota de proveniência). **Não executei nada** — nenhum teste, servidor ou chamada HTTP; tudo é leitura estática.

**Convenções de marcação (valem para o documento inteiro):**
- Vocabulário de status de capacidade (Regra #2 do briefing): `[IMPLEMENTADO — fonte+teste]` · `[IMPLEMENTADO — fonte, teste não localizado]` · `[FUNDACIONAL]` (primitivo existe mas não está ligado ao runtime) · `[ALVO DOCUMENTADO]` (na visão-alvo, não no código) · `[NOVO — proposto]` (nem docs nem código; proposto nesta síntese) · `[LACUNA]` (o que falta para uma camada funcionar).
- `[confirmado na fonte]` — fato lido NESTA sessão neste commit, com `arquivo:linha`.
- `[da série]` — fato verificado por um parecer anterior da série, no MESMO commit, que esta sessão não re-leu linha a linha.
- `[recomendação]` — decisão proposta, com raciocínio; distinta de fato.
- `[contrato corrigido — pendente do fix]` — campo/comportamento sob correção (F1–F6); descreve-se o ALVO, nunca o defeito como alvo.
- `[fora do repo @ f975533d]` — documento de doutrina do dono que NÃO está versionado neste commit (ver nota de proveniência).

## ★ NOTA DE PROVENIÊNCIA DA DOUTRINA (verificada nesta sessão — leia antes de citar qualquer doc de visão)

O briefing lista 6 documentos de arquitetura como fonte da visão-alvo. Verifiquei a existência de cada um NO COMMIT `f975533d`:

| Documento | No commit? | Onde existe |
|---|---|---|
| `docs/architecture/regulatory/19-build-vs-integrate-strategy.md` | **SIM** (197 linhas) | versionado no repo `[confirmado na fonte]` |
| `docs/architecture/draft/govai-ai-trust-layer-master-architecture-v0.9.md` | **NÃO** (o diretório `draft/` não existe no commit) | cópia do dono em `~/Downloads` e como arquivo NÃO-RASTREADO no checkout de auditoria (`<owner local audit checkout>/docs/architecture/draft/` — absolute local path redacted at promulgation, M3 §51) — as duas cópias são byte-idênticas (verificado por `diff`) |
| `docs/architecture/adr/ADR-016-governance-kernel.md` | **NÃO** (os ADRs do repo saltam de 014 para 020) | não-rastreado no checkout de auditoria |
| `docs/architecture/adr/ADR-017-audit-bridge-evidence-plane.md` | **NÃO** | idem |
| `docs/architecture/adr/ADR-018-seven-planes-ai-trust-layer.md` | **NÃO** | idem |
| `docs/product/claims-policy.md` | **NÃO** (`docs/product/` não existe no commit) | não-rastreado no checkout de auditoria |

**Consequências normativas para este plano:** (i) a visão-alvo abaixo cita esses cinco documentos como **doutrina do dono `[fora do repo @ f975533d]`** — status `v0.9-draft`/`Proposed`, datados de 2026-05-27; eu os li integralmente nas cópias externas; (ii) o CÓDIGO continua sendo a única verdade do estado atual (Regra #1) — e note que o "current state" descrito DENTRO desses docs também está desatualizado (escrito em maio; o Evidence Plane que o ADR-017 descreve como futuro foi desde então implementado via ADR-027/EP-004/EP-006/EP-008\*); (iii) fica registrada uma **decisão em aberto D11 (Cap. 12): versionar a doutrina no repo** — hoje a arquitetura-alvo do produto não está no controle de versão do produto, e três referências quebradas no código apontam para ela (`capture.ts:54` "See ADR-017"; `beta-policy.ts:28` "por ADR-016"; migração `0025:35-37` — achado herdado da revisão documental `[da série]`).

## ★ A REGRA GERAL DO CONTRATO PRÉ-CORREÇÃO (F1–F6)

O commit `f975533d` é PRÉ-correção de seis defeitos confirmados (consolidado de 2026-07-06, `to-chat/CONSOLIDADO-FABLE5-6-ACHADOS…`). Todos os seis foram re-ancorados na fonte nesta sessão:

- **F1 — `credential_source` hardcoded** `[confirmado na fonte]`: literal `'tenant_provider_credential'` em TODOS os 14 pontos de emissão — governed Anthropic (`packages/provider-anthropic/src/governed/handle-messages.ts:283,351,416`), governed OpenAI (`handle-chat-completions.ts:185,244,308`; `handle-responses.ts:256,315,379`), passthrough Anthropic (`register-passthrough.ts:407,482`) e OpenAI (`:467,543`) — mesmo quando a credencial real veio de env em `dev`/`test` (`apps/api/src/pipeline/provider-credentials.ts:153-166`). **Alvo:** enum derivado do resolvedor — `tenant_provider_credential | platform_env_key | hermetic_placeholder | none`. O schema hoje só exige string não-vazia (`packages/core-events/src/passthrough-invoked.ts:141`).
- **F2 — ramo `blocked` morto + rótulo errado no bloqueio** `[confirmado na fonte]`: (a) `enforcement.ts:66` (`E→blocked`) é inalcançável por construção (prova no Cap. 3.4); (b) no caminho de bloqueio o evento grava `enforcement_decision:'blocked'` fixo (`handle-messages.ts:278`) mesmo quando o gatilho foi validação de ferramenta e a decisão real da matriz era outra — enquanto o corpo HTTP ao cliente carrega a decisão real (`register-governed.ts:114-121`). **Alvo:** o evento grava a decisão REAL + `block_trigger ∈ {tool_validation, enforcement_matrix}` + `block_reason`.
- **F3 — transação aberta durante o fetch upstream no `/v1/runs`** `[confirmado na fonte]`: `run-orchestrator.ts:467` `pool.connect()` → `:471` `BEGIN` → fetch dentro da transação → `COMMIT` só em `:999`; sem timeout no `forwardRaw`; `/health` é resposta estática (`routes/health.ts:4`) que não toca o pool. **Alvo:** fechar a transação antes do fetch; `AbortSignal`+timeout; readiness real.
- **F4 — identidade de request via `enterWith`** `[confirmado na fonte]`: `request-identity-hook.ts:63` usa `requestIdentityAls.enterWith(identity)`; se `getStore()` devolver `undefined` num caminho terminal, a captura é descartada como `missing_request_identity` (`audit-bridge.ts:29,131-133`) — perda de evidência, não bleed cross-tenant. **Alvo:** `als.run(...)`.
- **F5 — `redactFindings` corrompe e vaza PII em achados sobrepostos** `[confirmado LITERALMENTE na fonte nesta sessão]`: `apps/api/src/pipeline/dlp.ts:87-94` ordena por índice DECRESCENTE (`:88`) e aplica `slice` com índices do texto ORIGINAL sobre uma string que muda de tamanho (`:91`), SEM fundir intervalos sobrepostos; e `detectAllBaseline` (`packages/dlp-br/src/baseline-detectors.ts:121-123`) concatena 4 detectores independentes que podem casar o MESMO span (um CPF nu de 11 dígitos casa `CPF_RE` `:14` e `PHONE_BR_RE` `:24-26`; um e-mail com local-part CPF casa os três). A aplicação direita→esquerda é segura para achados disjuntos; com sobreposição, o marcador aplicado depois "come" através do marcador anterior → texto corrompido E PII sobrevivendo em claro. Escopo: só `/v1/runs` com `action='redact'` configurado (`run-orchestrator.ts:575`); os `/governed/*` não redigem (`handle-messages.ts:219-221`). **Alvo:** fundir intervalos `[index, index+length)` antes de redigir. **Regra do plano: NENHUMA tela/indicador afirma "PII redigida/protegida" até o fix.**
- **F6 — sobreposição infla contagens** `[confirmado na fonte]`: mesma raiz do F5 — o mesmo span contado por 2 detectores infla `dlp_finding_count` (`run-orchestrator.ts:540`), as linhas de `govai.dlp_findings` (`:563`) e `finding_classes` (`handle-messages.ts:236`). **Alvo:** de-duplicar por span. Até lá, contagens de DLP rotuladas "detecções (podem sobrepor)".

---
---

# PARTE I — A VISÃO (o produto inteiro)

# Capítulo 1 — Posicionamento e doutrina

## 1.1 O que o GovAI É

**GovAI AI Trust Layer** — a camada que torna o uso corporativo de IA **controlável, auditável e produtor-de-evidência sem destruir a experiência provider-native**. Posicionamento canônico (master-architecture §1.2 `[fora do repo @ f975533d]`): *"GovAI is the AI Trust Layer that helps organizations use AI with proportional controls, auditability, evidence and governance across native providers, APIs, external connectors, agents and Workrooms — without breaking the native experience."*

Em uma frase operacional, ancorada no que o código já faz hoje: **um gateway de governança que registra cada invocação de provedor como evidência selada criptograficamente e verificável, aplica política onde ela é real, e diz a verdade sobre onde ainda não é.** O centro de gravidade do produto atual é **evidência com honestidade embutida**, não bloqueio: a maioria das decisões de enforcement é observacional (anotada e encaminhada — Cap. 3.4), e o registro regulatório inteiro é evidência de governança, não enforcement de runtime (`docs/architecture/current-state.md` §4: "DENIED = evidence, not a runtime block" `[confirmado na fonte]`).

**O que o GovAI NÃO é** (master-arch §1.3, alinhado à claims-policy): não é um gateway de IA genérico, não é oráculo jurídico, não substitui DPO/advogado/auditor/regulador, não é provedor de modelo, não é "compliance automático".

## 1.2 As 7 doutrinas — e o teste de realidade de cada uma

Da master-architecture §1.4 `[fora do repo @ f975533d]`, cada doutrina com o seu estado REAL no código:

| # | Doutrina | Estado real em `f975533d` |
|---|---|---|
| 1 | **Experiência provider-native preservada** | `[IMPLEMENTADO — fonte+teste]` corpo nativo byte-perfeito, SDKs apontam via baseURL, streaming SSE repassado, headers de auth do cliente nunca encaminhados (`handle-messages.ts:143-165`) |
| 2 | **Fricção proporcional ao risco** (observe→warn→ask→redact→sandbox→approve→block) | **PARCIAL**: a matriz existe e é pura (`enforcement.ts:62-102`), mas `ask`/`enforce`/`sandbox_required` só ANOTAM (encaminham); `redact` está quebrado (F5) e só no path-A; `approve` só existe DENTRO de workroom; o bloqueio real é estreito (Cap. 3.4). A proporcionalidade plena é `[ALVO DOCUMENTADO]` |
| 3 | **Evidência independentemente verificável** (HMAC é o piso; Merkle/TSA/ICP-Brasil é grau futuro) | HMAC chain + outbox + sealer `[IMPLEMENTADO — fonte+teste]`; verificação EC-6 ainda não persistida (sempre `pending` — `evidence-reports.ts:466-496`); Merkle/TSA/ICP-Brasil `[ALVO DOCUMENTADO]` |
| 4 | **Honestidade de fonte e anti-overclaim** | operacionalizada no próprio SoT (taxonomia `IMPLEMENTED_*`/`DOCUMENTED_TARGET_ONLY` em `current-state.md`) e na claims-policy `[fora do repo]`; a UI herdará como vocabulário normativo (Cap. 7) |
| 5 | **Standalone E integrada** | ★ ver 1.3 — **standalone é `[ALVO DOCUMENTADO]`, não capacidade entregue** |
| 6 | **Brasil-first, global-ready** | detectores CPF/CNPJ (com CNPJ alfanumérico IN RFB 2.229/2024 — `baseline-detectors.ts:15-21,58-76`) + famílias SD1/SD2A (segredos, CNJ, financeiro, saúde — `packages/dlp-br/src/index.ts`) `[IMPLEMENTADO]`; núcleo regulatório R1–R9 `[IMPLEMENTADO — FUNDACIONAL]`; packs LGPD/EU-AI-Act assinados `[ALVO DOCUMENTADO]` |
| 7 | **Trust é operacional** (toda superfície de execução produz evidência completa) | as 4 rotas diretas + `/v1/runs` despacham para o capture outbox `[IMPLEMENTADO — fonte+teste]`; completude MONITORADA (EC-1..EC-4, coverage_ratio); captura é best-effort com detecção de perda, não "mandatória" (`audit-bridge.ts:105-111,294`) — a redação honesta é "capturada best-effort com completude monitorada" |

## 1.3 ★ Standalone vs. integrado — a verdade de status

A doutrina #5 promete: funciona sozinha para clientes sem stack de governança; vira camada de evidência/normalização quando o cliente já tem Purview/OneTrust/ServiceNow/SIEM. **Hoje:**

- **"Integrável" tem primeiro tijolo real**: export OTel/OTLP para o stack do operador `[IMPLEMENTADO — fonte]` (`server.ts:116`; `infra/docker-compose.observability.yml`); conectores de ingestão/export SIEM/GRC são `[NOVO — proposto]` (Feature N4, Cap. 4).
- **"Standalone" é `[ALVO DOCUMENTADO]`, NÃO `[IMPLEMENTADO]`.** Um produto standalone-operável pressupõe que o tenant configure a própria política sem SQL. Hoje: `operational_mode`/`tier` — os dois interruptores-mestre do enforcement e da origem de credencial — **não são mutáveis por NENHUMA rota** (busca por `UPDATE/INSERT govai.orgs` em `apps/api/src`: zero `[confirmado na fonte]`); a config de DLP por org (`govai.dlp_baseline_config`) não tem CRUD (o stub é 501 — `admin-dlp.ts:21,40`); e a emissão de chaves de API é CLI break-glass (`apps/api/src/scripts/grant-api-key-role.ts:1-8`). **O que fecha esse gap é o Policy Studio (Feature N1, `[NOVO — proposto]`)** + whoami + gestão de chaves. Nenhum material comercial ou tela deve posicionar "standalone" como propriedade presente — é a direção-alvo, gated pela claims-policy.

## 1.4 As personas (para quem tudo é desenhado) e por que pagam

Mapeamento role-técnico→persona (roles reais: `Role = 'admin' | 'data_protection_officer' | 'dlp_admin' | 'developer' | 'auditor'` — `packages/core-identity/src/rbac.ts:1-8` `[confirmado na fonte]`):

| Persona | Role(s) | O que precisa | Motivo de compra |
|---|---|---|---|
| **DPO / Encarregado (LGPD)** | `data_protection_officer` | provar controle sobre dados pessoais em IA: relatórios de PII, trilha de decisão, exposição | "eu consigo demonstrar à ANPD/comitê o que passou, o que foi detectado e o que foi decidido" |
| **CISO / Segurança** | `dlp_admin` (reservado — nenhuma rota o consulta hoje `[confirmado na fonte: grep vazio em routes/]`), leituras | visibilidade de uso, risco por capability, export SOC/SIEM | "IA sem ponto cego no meu SOC" |
| **Jurídico / Compliance** | leituras + workflows regulatórios | evidência para o comitê de IA, pacote por incidente, crosswalk | "evidência técnica verificável por caso, sem overclaim jurídico" |
| **Auditor (interno/externo)** | `auditor` | cadeia verificável, completude, integridade | "a trilha existe, é íntegra e eu consigo auditá-la sozinho" |
| **Owner / Gestor de área** | `admin` do tenant | "quem usou IA, quando, com que risco" no departamento | accountability sem fricção para o time |
| **Operador da plataforma** | NÃO é role de tenant — plano de controle próprio (SQL/Grafana/env) | tiers, modos, credenciais, saúde da evidência | operar a plataforma multi-tenant com isolamento provado (INV-1) |
| **Desenvolvedor / Engenheiro** | `developer` | superfície provider-native drop-in, playground, workrooms | "uso o SDK nativo de sempre; a governança vem de graça" |

**A regra de UX (a chave para "leigos e experts"):** compliance invisível por padrão — o usuário usa IA normalmente; a GovAI captura contexto e evidência, classifica risco, só interrompe se necessário, cria work-item quando precisa revisão (hoje `[NOVO — proposto]` — Feature N2), e alimenta reporting sem o usuário perceber. A UI fala a língua da PERSONA: o DPO vê "dados pessoais e exposição", não "dlp_findings".

## 1.5 A disciplina de claims (o portão de tudo o que a UI e o comercial podem afirmar)

Da `claims-policy.md` `[fora do repo @ f975533d]` + operacionalizada no SoT do repo:

- **Estados de capacidade** que gateiam claims: `planned` (proibido, só roadmap interno) · `foundational` (só como fundação técnica) · `partial` (só com escopo e limitações) · `supported` (permitido no escopo documentado) · `deprecated`.
- **Permitido hoje** (preciso): "constrói uma AI Trust Layer Brazil-first"; "evidência técnica onde a capability é supported"; "políticas configuráveis onde implementadas" (⚠ escopo real: DLP baseline por org no path-A; NÃO há Policy Studio); "registra eventos técnicos auditáveis onde a Audit Bridge cobre" (hoje: as 4 rotas diretas + `/v1/runs` + workroom).
- **Qualificado**: "forensic review" só nas superfícies cobertas pela bridge; "LGPD workflows" só os implementados; "compliance readiness" só como suporte de prontidão; "Shadow AI" PROIBIDO até existir ingestão; "agentic governance" PROIBIDO até estar em release.
- **Proibido sempre**: garante conformidade LGPD; certifica uso legal; substitui DPO/advogado/auditor; previne todo vazamento; elimina risco; "certificado ISO/EU/LGPD" sem certificação real.
- **Vocabulário de UI/relatório**: usar "blocked by configured policy", "risk signal detected", "requires review under organization policy", "technical evidence bundle", "governance readiness support"; evitar "illegal", "LGPD violation", "certified compliant", "legally safe", "guaranteed secure".
- **Duas adições deste plano** `[recomendação]`: (i) "PII redigida/protegida" entra na lista PROIBIDA até o F5 aterrissar; (ii) "standalone" entra na lista QUALIFICADA (só como direção-alvo) até o Policy Studio existir.

**O que um agente implementa a partir daqui:** nada de código — este capítulo vira dois artefatos: (1) o checklist de claims no template de PR/tela (todo texto voltado a usuário passa pelo portão §1.5); (2) o mapa persona→linguagem que o Cap. 7 codifica em `honesty.ts`/`vocab.ts`.
# Capítulo 2 — Os 7 planos (a arquitetura-alvo × o estado real)

A doutrina dos Sete Planos vem do ADR-018 + master-architecture §4 `[fora do repo @ f975533d]` (status `Proposed`, 2026-05-27). Regra do ADR-018 que este plano adota como invariante: *"No plane may bypass Kernel or Evidence Plane when executing or ingesting AI events."* Para CADA plano: responsabilidade → visão-alvo → **estado atual lido do código** → lacuna → onde toca a UI. ⚠ O "current state" descrito DENTRO da master-architecture está desatualizado (maio/2026); o estado abaixo é o do código em `f975533d`.

## Plano 1 — Native Experience / Data Plane

**Responsabilidade:** receber o tráfego de IA preservando a forma provider-native: `/governed/{provider}/*`, `/passthrough/{provider}/*`, `/v1/runs`, streaming, tools/function calling.

**Visão-alvo:** toda superfície chama Governance Kernel e Audit Bridge; compatibilidade SDK-nativa de primeira classe; `/v1/runs` como Governed Execution API; identidade de provedor além de Anthropic/OpenAI hardcoded (ADR-019, não escrito).

**Estado atual `[confirmado na fonte]`:**
- **3 endpoints governados**: `POST /governed/anthropic/v1/messages` (`provider-anthropic/src/governed/register-governed.ts:69`), `POST /governed/openai/v1/responses` (`provider-openai/…/register-governed.ts:129`), `POST /governed/openai/v1/chat/completions` (`:174`) — corpo byte-perfeito, auth do cliente destripada e chave do provedor injetada (`handle-messages.ts:143-165`), resposta com os 3 headers `x-govai-*` (`register-governed.ts:134-136,169-171`; OpenAI `:84-86,111-113`), SSE repassado com `finalize(outcome)` pós-drenagem (`handle-messages.ts:322-371`). `[IMPLEMENTADO — fonte+teste]` (suíte integração citada no SoT).
- **2 wildcards passthrough**: `app.all('/passthrough/anthropic/*')` (`register-passthrough.ts:174`) e OpenAI (`:178`) espelhando os endpoints suportados dos registries (messages/count_tokens/models/files; responses/chat/embeddings/files/vector_stores — matchers em `capabilities/index.ts:153-172` e `:302-330`). Sempre `enforcement_decision:'observe'` literal (`register-passthrough.ts:401,476`; OpenAI `:461,537`) — o passthrough NUNCA resolve governança.
- **`/v1/runs`** (path-A): `runs.ts:29`; modos `governed|passthrough` (`shadow` → 400 `run_mode_not_supported`, `:47-54`); orquestrador transacional persiste `provider_invocations` + `policy_decisions` (`run-orchestrator.ts:715,779,859,926`; migração `0002`).
- **Streaming com evidência terminal** (EP-008C): `stream_outcome ∈ complete|upstream_error|client_disconnect` no evento (`passthrough-invoked.ts:129`) via `@govai/provider-stream-http`. `[IMPLEMENTADO — fonte+teste]`.
- **Classificação de ferramentas**: taxonomia Anthropic 7 classes com decisão allowed/blocked_at_validation e contribuição de risco (`tool-classifier.ts:84-119`; bash=D `:94`, computer_use/code_execution/typed_unknown bloqueados `:97-117`).
- **Política de beta-tokens**: `ANTHROPIC_BETA_POLICY` com 9 entradas — 1 `global_allowlist` (files, por ADR-014), 2 `verification_required`, 3 `denied_until_decision`, 3 `hard_denied` (`beta-policy.ts:6-72` `[confirmado na fonte]`).
- **Registro de capacidades**: 6 Anthropic + 13 OpenAI, cada uma com `(level, base_risk_class)` — a tabela completa está no Cap. 3.4, porque é o contrato de que TODO o enforcement depende.

**Lacunas:** F3 (timeout/AbortSignal no forward não-stream; transação aberta no path-A); F5 (redação quebrada); harness de compatibilidade SDK como artefato próprio `[ALVO DOCUMENTADO — master-arch §9]`; provider além dos 2 hardcoded `[ALVO DOCUMENTADO — ADR-019 não escrito]`.

**Toca a UI em:** playground (`/v1/runs`), a matriz de capacidades (`GET /v1/capabilities`), e os headers `x-govai-*` — o único canal por-request de decisão que o cliente vê hoje.

## Plano 2 — Governance Kernel / Policy Plane

**Responsabilidade:** ponto de decisão central — capability, risco, DLP, policy binding, modo de fricção, hard-deny floor.

**Visão-alvo (ADR-016 `[fora do repo]`):** `packages/governance-kernel` puro (GovernanceContext → GovernanceDecision + AuditIntent), consumido por `/v1/runs`, `/governed/*`, `/passthrough/*`, workroom-runs, Shadow AI e conectores; DLP RT-bridge (classes ricas → warn/redact/block/ask por política do tenant).

**Estado atual `[confirmado na fonte]`:**
- O kernel COMO PACOTE não existe (`packages/governance-kernel`: ausente) — a lógica vive coesa mas dispersa: `packages/core-governance` (matriz pura `enforcement.ts`, resolvedor `resolve-governance.ts`, `computeEffectiveRiskClass`, `BASELINE_REGISTRY` com 2 facetas `tool_call_audit` ainda `planned` — `registry.ts:30,73`), consumida pelos handlers governados e pelo orquestrador; a decisão de DLP do path-A vive em `pipeline/policy.ts` (`decidePolicy`/`persistPolicyDecision` — `run-orchestrator.ts:53-54,512`). `[FUNDACIONAL]` como kernel; `[IMPLEMENTADO]` como funções.
- **A matriz real** (Cap. 3.4 tem a prova completa): `dev|test`→observe incondicional; `pilot` relaxa um degrau (nunca bloqueia por matriz); produção: E→blocked (inalcançável), D+starter→blocked, D+business→sandbox_required, D+demais→enforce, C+starter→ask, C+demais→enforce, B→warn, A→observe (`enforcement.ts:62-102`).
- **`side_effects`/`preconditions` da matriz são DESCARTADOS** pelo resolvedor (`resolve-governance.ts:153-158` devolve só `enf.mode`; a matriz os computa em `enforcement.ts:104-120`) — "DLP pre-scan obrigatório" e "sandbox requerido" são intenção declarada sem efeito de runtime.
- **Dois regimes de DLP** (a assimetria completa no Cap. 3.5): path-A lê config por org e pode negar/redigir; path-B (governado) só detecta-e-escala com `action:'warn'` literal.
- **Hard-deny floor real**: os 3 bloqueios de validação de ferramenta + os beta-tokens `hard_denied` — válidos em TODOS os modos (a validação de ferramenta dispara antes da matriz). O floor "por categoria de dano" da filosofia é `[ALVO DOCUMENTADO]` (o próprio SoT diz "evidence only — no runtime gateway block", `current-state.md` §3).
- **Policy Studio**: NÃO existe (nenhuma rota muta `govai.orgs` nem `dlp_baseline_config` `[confirmado na fonte]`) — `[NOVO — proposto]` (Feature N1).

**Lacunas:** extração do kernel (`[ALVO DOCUMENTADO]` — o gatilho certo é a chegada de novas superfícies: conectores/Shadow AI/workroom-decisões, não antes `[recomendação]`); DLP RT-bridge (uma classe não-baseline policy-bound → warn/redact/block — deliverable da Foundation Release); convergência Q2 (deny-primeiro entre path-A e path-B `[da série — decisão de design]`); F2 (block_trigger); Policy Studio.

**Toca a UI em:** Policy Studio (a área inteira é este plano), o vocabulário de honestidade (Cap. 7), os badges de modo/tier com consequência.

## Plano 3 — Evidence Plane

**Responsabilidade:** capturar, selar, verificar e exportar evidência.

**Visão-alvo (ADR-017 `[fora do repo]`):** outbox durável → chain state → sealer → posturas strict/best_effort → completude monitorada → export de bundles; Merkle/TSA/ICP-Brasil como grau futuro.

**Estado atual — o plano que mais andou desde a doutrina `[confirmado na fonte]`:**
- **Cadeia HMAC**: `auditAppend` (`packages/core-audit/src/append.ts:55`) → função SQL `govai.audit_append_locked` (`:144`) com lock por cadeia (`chainLockKey`), canonical JSON, HMAC encadeado, 4 categorias de cadeia por org (`auth|run|policy|admin`). `[IMPLEMENTADO — fonte+teste]`.
- **Capture outbox** (migrações `0025`/`0026`): `captureAuditEvent` (`capture.ts:281`), idempotência ADR-028 (uuid5 determinístico — `sealer-event-id.ts:22,81`), conteúdo imutável, `payloadEncrypted: null` no despacho das rotas diretas — **só o hash da projeção é persistido** (`audit-bridge.ts:210`).
- **AuditBridge** (ADR-027/028): as 4 rotas diretas despacham via ALS-identity (`routes/governed-anthropic.ts:73-81` — log + `await auditBridge(event, requestIdentityAls.getStore())`; hook de ingresso `server.ts:170`); best_effort NUNCA falha a request (`audit-bridge.ts:105-111,294`); quedas contadas (`govai_audit_bridge_drops_total`/`captures_total` — `audit-bridge-metrics.ts:21-22`).
- **Sealer como app E deployable**: `apps/audit-sealer/` completo (claim-loop, seal-once, stale-recovery, backoff, health-file, métricas, startup-validation) + **descoberta de orgs pelo BANCO como role enumerator** (fechando o silent-drop de lista manual — `org-discovery.ts:1-10`), bundle esbuild autossuficiente (`package.json:9`) rodando `node dist/bundle.mjs` em Docker multi-stage não-root (`Dockerfile:5-9`), serviço no compose (`infra/docker-compose.yml:38`). `[IMPLEMENTADO — fonte+teste]`.
- **Completude monitorada**: views `0027`; relatórios EC-1/EC-2/EC-3.seal/EC-3.drop/EC-4/EC-6 + `coverage_ratio` com paridade coverage↔gaps (`evidence-reports.ts:519-536`); read API do tenant (`GET /v1/evidence/summary|gaps` — `evidence.ts:56,98`); gauges de operador `govai_evidence_*` (8 nomes — `evidence-metrics.ts:28-35`) por acumulação per-org sob INV-1 (`evidence-operator.ts:1-23`); stack OTLP/Prometheus/Grafana local (`infra/docker-compose.observability.yml`).
- **Honestidades embutidas no contrato**: EC-5 (stream-terminal) DEFERIDO explicitamente (`evidence-reports.ts:16-21`); EC-6 sempre `pending` com nota (não há verificação persistida — `:466-496`); EC-3.drop com `bound` textual e "o coletor OTLP é a fonte autoritativa" (`:422-442`; `evidence.ts:139-144`).

**Lacunas:** EC-5; verificador EC-6 persistido + verificação sob demanda `[LACUNA — vira EP]`; **Evidence Package/bundle exportável `[NOVO — proposto]` (Feature N3)**; Merkle/TSA/ICP-Brasil `[ALVO DOCUMENTADO]`; F4 (enterWith) e a projeção legível por-request (hoje hash-only) `[LACUNA — decisão D4]`.

**Toca a UI em:** o cockpit de evidência inteiro (a primeira tela do produto), a cadeia de auditoria, o Evidence Package.

## Plano 4 — Identity / Secrets / KMS Plane

**Responsabilidade:** identidade humana/máquina, API keys, SSO/SCIM futuro, RBAC/ABAC, credenciais de provedor, KMS/BYOK, crypto-shred.

**Visão-alvo:** AWS KMS primeiro, rotação, verificação de versão de chave HMAC, BYOK, células dedicadas/soberanas.

**Estado atual `[confirmado na fonte]`:**
- **API keys**: argon2id (`core-identity/src/api-keys.ts:17`), lookup por prefixo via `govai.api_key_lookup_v2` SECURITY DEFINER + verify (`pipeline/auth.ts:48-63`), roles com filtro defensivo (`:68-71`), `AuthIdentity{org_id,user_id,api_key_prefix,tier,operational_mode,roles}` (`:15-28`). Emissão/gestão SEM rota HTTP — CLI break-glass (`scripts/grant-api-key-role.ts:1-8`).
- **RBAC**: 5 roles (`rbac.ts:1-8`); `requireAdmin` para admin; escrita regulatória `admin|data_protection_officer` (`regulatory.ts:1131-1141`); segundo eixo de autorização por PARTICIPAÇÃO na workroom (`workroom-approvals.ts:720-725`).
- **JWT**: verificação com allowlist de algoritmos via jose (`jwt.ts:43-47`) — **presente e não consumido por nenhuma rota** (`auth.ts:2` "out of scope"; grep vazio em routes/pipeline) `[FUNDACIONAL]`.
- **KMS**: `GOVAI_KMS_PROVIDER ∈ dev|aws|gcp|azure` (`config/src/index.ts:7`); DevKms HKDF por-org (`kms/index.ts:60`) com **fail-closed em produção** (BootError se DevKMS/KMS_DEV_SEED em prod — `config/src/index.ts:109-118`; probe de boot `server.ts:61-68`); **adaptador AWS KMS real** (`kms/aws-kms.ts`) `[IMPLEMENTADO — fonte+teste; smoke real-AWS passado em 2026-05-30 (registro do projeto)]`; GCP/Azure enums reservados `[ALVO]`.
- **Envelope encryption**: credenciais de provedor (plaintext só entra, nunca sai — `admin-provider-credentials.ts:9-14`), conteúdo de transcript de workroom (`workroom-transcript.ts:15-16,217`), intended-actions de aprovação (`workroom-approvals.ts:17`).
- **Papéis de banco fechados** (`infra/postgres/bootstrap.sql`): `govai_audit_writer` NOINHERIT (`:8`), `govai_audit_sealer` NOINHERIT NOLOGIN (`:24`), `govai_app` LOGIN sem BYPASSRLS (`:45`), `govai_evidence_enumerator` NOINHERIT NOLOGIN com lifecycle de cinco estados (`:61-82,117`) — INV-1: nenhuma identidade única de DB detém enumerar+ler.
- **Crypto-shred**: primitivo previsto, rota é stub 501 (`admin-audit-shred.ts:22,41`) `[FUNDACIONAL]`.

**Lacunas:** sessão (chave→JWT) `[LACUNA — EP-B3]`; whoami `[LACUNA — EP-B2]`; gestão de chaves/usuários via API `[LACUNA]`; SSO/OIDC/SCIM `[ALVO DOCUMENTADO — INTEGRAR]`; rotação de chave HMAC + runbooks `[ALVO]`; BYOK/células `[ALVO]`.

**Toca a UI em:** entrar/sessão, tela Organização (whoami), admin de credenciais, futura gestão de chaves.

## Plano 5 — Integration / Shadow AI Plane

**Responsabilidade:** ingerir sinais externos, descobrir shadow AI, normalizar conectores, correlacionar identidade/qualidade de fonte, privacy-by-design.

**Visão-alvo:** ingestão metadata-first; precedência de qualidade de fonte; connector SDK; telemetria externa; fluxos de aceitação/atestado. Shadow AI com doutrina fixa: conteúdo só por política explícita do tenant + atestado de admin; redaction/hash por default; aviso como proteção, não punição (master-arch §11).

**Estado atual `[confirmado na fonte]`:** é o plano mais vazio — deliberadamente:
- O modo `shadow` está RESERVADO e rejeitado com erro específico (`runs.ts:47-54` — 400 `run_mode_not_supported` com `supported_modes`).
- O **vocabulário de proveniência/qualidade de fonte JÁ existe** (`packages/dlp-br/src/sensitive-provenance.ts` — "provenance / source-quality vocabulary (PR-SD1)"; a regra "ingerido nunca sobrepõe evidência primária" está no próprio arquivo `:162`) `[FUNDACIONAL]`.
- Export de telemetria ao operador via OTLP `[IMPLEMENTADO]` — mas isso é observabilidade, não o connector framework.
- Ingestão de conectores, `ExternalEvidenceEvent`, export SIEM/GRC: **inexistentes** (grep vazio) — `[NOVO — proposto]` (Feature N4).

**Lacunas:** tudo além do vocabulário: SPEC de Shadow AI (`docs/architecture/specs/future/shadow-ai-privacy.md` — nem o diretório existe no commit), threat model de conector, API de ingestão, correlação de identidade.

**Toca a UI em:** área Connectors (ingestão + export) e futura área Shadow-AI — ambas `[ALVO]`/`[NOVO]`.

## Plano 6 — Regulatory Intelligence / Update Plane

**Responsabilidade:** mapeamento regulatório, catálogo de controles, registro de fontes, packs assinados (policy/detector/regulatory/provider/connector/report).

**Visão-alvo:** packs pull-based assinados, canais canary/beta/stable, workflow de revisão/promoção, evento de auditoria por ativação, rollback.

**Estado atual `[confirmado na fonte]`:**
- **Núcleo regulatório R1–R9 COMPLETO como controle fundacional**: 9 migrações (`0016`–`0024`), **108 operações sobre 60 caminhos** em `regulatory.ts` (contagem própria — Cap. 3.1): sources(+versions+relationships), controls(+source-links+framework-mappings), ai-systems, providers, models(+versions), ai-system-model-links, agents(+versions), agent-capability-bindings, use-cases(+asset-links+reviews), risk-methods, risk-classifications(+factors+`/evaluate` puro — `:2737`), reclassification-triggers, high-risk-reviews (workflow completo: submit/cancel/evidence/assignments/decisions), prohibited-use-policies, prohibited-use-cases (workflow: submit/cancel/evidence/determinations). Leitura: qualquer identidade do tenant (`scope='tenant'` da org + `scope='system'`); escrita: `admin|data_protection_officer` (`requireWriteRole`, `regulatory.ts:1131-1141`); toda mutação emite evento na cadeia `policy`. `[IMPLEMENTADO — fonte+teste (suíte regulatory-*.test.ts, citada no SoT)]`.
- **★ O eixo crucial (não-negociável do SoT):** tudo isso é *evidência de governança, NÃO enforcement de runtime* — "APPROVED = evidence, not runtime authorization"; "DENIED = evidence, not a runtime block" (`current-state.md` §4 `[confirmado na fonte]`). Enforcement de runtime é a Fase 5 do roadmap (`development-roadmap.md` — "a denied determination actually blocks the runtime path, with tests" como critério de saída).
- **Update Plane**: não existe além de overrides diretos por org (`0003_capabilities_overrides.sql`; `GET /v1/capabilities` resolve overrides — `capabilities.ts:10`). Packs assinados `[ALVO DOCUMENTADO]`.
- **Compliance Crosswalk** (Requirement→Control→Evidence→Status→Gap): as PONTAS existem — `framework-mappings` de controls (`regulatory.ts:1474,1502`) mapeia controle↔framework, e o plano de evidência tem os artefatos — mas a travessia completa até "prova de cobertura" com status COVERED/PARTIAL/GAP é `[NOVO — proposto]` (Feature N5).

**Lacunas:** update plane; crosswalk; enforcement de runtime (Fase 5); motor de diff/monitor regulatório (`DOCUMENTED_TARGET_ONLY` no SoT).

**Toca a UI em:** a bancada regulatória inteira (17 recursos), o simulador de classificação, a futura matriz de crosswalk.

## Plano 7 — Cockpit / Workroom / Reporting Plane

**Responsabilidade:** tornar o valor visível a DPO, jurídico, CISO, auditores, owners e operadores; Workroom para governança humano/multi-agente; Reporting para bundles de evidência.

**Visão-alvo:** Cockpit Alpha read-only; vista de completude; status de runs/policy/DLP/audit; Reporting v1 HTML/CSV/JSON; extensões de Workroom.

**Estado atual `[confirmado na fonte]`:**
- **Workroom backend FORTE**: criação transacional com policy profile + primeiro participante `human_owner` (`workrooms.ts:179-243`; `governance_mode` default `governance_active` `:201`; `max_risk_without_approval` default 'C' `:205`; org pode proibir `audit_only` `:221`); participantes (add/remove — `:504,704`); transcript cifrado at rest (mensagens/tasks — `workroom-transcript.ts:169,376`); runs com matriz de modo (`resolveRunMode` — `workroom-runs.ts:16-30`: `defaulted|explicit|upgrade|override_approved|override_denied`); aprovações com hash de ação pretendida, expiry read-time, decisão com SoD, consumo one-time, revogação (`workroom-approvals.ts:249,444,557,661,901`; SoD `:757-764`; roles de decisão `:720-725`); subviews de evidência (11 artifact_kinds — `workroom-transcript.ts:60-75`) e auditoria (só auditor/admin — `:679,697-700`). `[IMPLEMENTADO — fonte+teste]`.
- **Cockpit de leitura do tenant**: `GET /v1/evidence/summary|gaps` + `GET /v1/audit-events` + `GET /v1/capabilities` `[IMPLEMENTADO]` (Plano 3).
- **Cockpit do operador**: gauges → Grafana `[IMPLEMENTADO — infra]`; SEM rota HTTP (por desenho INV-1).
- **UI**: **NÃO existe** (`apps/` contém só `api` e `audit-sealer` `[confirmado na fonte]`) — `[ALVO]`; o plano executável é o Cap. 5–8 (e o GOVAI-UI-MASTER-PLAN da série).
- **Reporting/dossiês**: nenhuma rota de relatório; `DOCUMENTED_TARGET_ONLY` no SoT; "Native reports and dashboards" = `BUILD_NATIVE_CORE` P1 (`19-build-vs-integrate-strategy.md:139-140` `[confirmado na fonte]`) — Feature N3 + Cap. 8.

**Lacunas:** a UI inteira; leitura de transcript (decrypt-read — D1); GET de participantes; Reporting v1; AI Usage Ledger (Cap. 8.4).

**O que um agente implementa a partir daqui:** nada diretamente — este capítulo é o mapa de status; cada lacuna nomeada tem seu EP no Cap. 4 e sua(s) tela(s) no Cap. 6. A regra de leitura: quando um doc de visão contradisser este capítulo, vale o código; quando o código mudar, regenere as âncoras (comando no Cap. 13).
---
---

# PARTE II — A ARQUITETURA TÉCNICA (backend)

# Capítulo 3 — O backend atual (o contrato de que TODA tela depende) ★ PRIORIDADE DE RIGOR

Tudo neste capítulo é `[confirmado na fonte]` NESTA sessão, salvo marcação `[da série]`. As contagens foram feitas por grep/find reais (comandos regeneráveis no Cap. 13.4).

## 3.1 Os números exatos

- **Arquivos de rota**: 18 em `apps/api/src/routes/` — **17 registram rotas HTTP** + 1 helper (`_not-implemented.ts`, o shape do 501).
- **Registros de rota em `routes/*.ts`: 135** = **27 não-regulatórios + 108 em `regulatory.ts`** (contados com padrão tolerante a generics `app\.(get|post|put|patch|delete|all)\s*[<(]` — o grep ingênuo sem `<` conta 46 e ERRA, porque Fastify com generics registra como `app.get<{...}>(…)`).
- **Mais os registros feitos pelos pacotes de provedor** via `server.ts:156-176`: **3 endpoints governed + 2 wildcards passthrough** → **140 pontos de registro HTTP no total**.
- **`/v1/regulatory/*`: 108 operações (método+caminho) sobre 60 caminhos distintos** (60 confirmado por extração dos literais de caminho).
- **Migrações**: 27 arquivos, numerados `0001`–`0028` **sem `0006`** (`apps/api/src/db/migrations/`).
- **Workspace**: 2 apps (`api`, `audit-sealer`) + **13 pacotes** (`config, core-audit, core-events, core-governance, core-identity, core-tenant, core-types, dlp-br, observability, provider-anthropic, provider-openai, provider-stream-http, signing`).
- **Testes**: **176 arquivos `*.test.ts`** no disco (contagem própria; a execução não foi verificada nesta sessão).

## 3.2 O modelo de tenancy, autenticação e autorização

1. **Identidade = chave de API; a org deriva da credencial, nunca de parâmetro.** Toda rota extrai a chave de `x-govai-api-key` OU `Authorization: Bearer` (ex.: `runs.ts:30-34`) e resolve `AuthIdentity {org_id, user_id, api_key_prefix, tier, operational_mode, roles}` (`pipeline/auth.ts:15-28`): lookup por prefixo `govai.api_key_lookup_v2` → verify argon2 → filtro defensivo de roles → `govai.org_tier_lookup` SECURITY DEFINER para `tier`/`operational_mode` (`auth.ts:40-92`). 401 = `{error:'auth_error', message}`.
2. **RBAC em dois eixos**: (eixo 1, global) `Role = 'admin'|'data_protection_officer'|'dlp_admin'|'developer'|'auditor'` (`rbac.ts:1-8`) — `admin` gateia admin de credenciais e os stubs; `admin|data_protection_officer` gateiam escrita regulatória (`regulatory.ts:1131-1141`); `developer|admin` criam workroom (`workrooms.ts:195-198` `[da série]`); `auditor|admin` leem subviews de auditoria. `dlp_admin` é RESERVADO (nenhuma rota o consulta). (eixo 2, por sala) participação `human_owner|human_approver`: decidir aprovação exige participante com um desses papéis (`workroom-approvals.ts:720-725`); **uma chave `admin` sem participação NÃO decide**; quem pediu nunca decide (SoD — `:757-764`).
3. **RLS por transação**: `BEGIN → SELECT set_config('app.org_id', $1, true) → query → COMMIT` (`packages/core-tenant/src/index.ts:14-32` — `setLocalAppOrgId`/`withTenant`); FORCE RLS nas tabelas; **cross-tenant é 404, nunca 403** (linha de outra org é invisível). Papéis de banco fechados (Cap. 2 Plano 4; `bootstrap.sql:8,24,45,61-82`).
4. **`tier` e `operational_mode` são plano de controle do OPERADOR**: mutáveis só por SQL direto (nenhuma rota muta `govai.orgs`); consequências — `dev|test` desligam a matriz (observe incondicional), `pilot` relaxa um degrau, e o modo comuta a origem de credencial (`provider-credentials.ts:23-29`: produção/pilot SEM credencial de tenant → THROW; dev → env; test+loopback → hermetic).
5. **Nenhuma rota devolve `roles`/`tier`/`operational_mode` ao cliente** — a lacuna whoami (3.8).

## 3.3 As convenções do contrato

- **Três estilos de paginação coexistem**: keyset `before_seq` (audit-events `audit-events.ts:9-10`, limit ≤200 default 50; workroom evidence/audit); cursor composto `{before_created_at, before_id, limit}` → `{rows, nextCursor}` (workrooms/approvals/runs + todo o regulatório — `regulatory/service.ts` `[da série]`); offset numérico `cursor` (evidence/gaps — `evidence.ts:39-40`, `next_cursor = cursor+limit` quando página cheia `:150-153`, limit ≤500 default 100, janela ≤1 ano `:29-33`).
- **Números**: bigint SEMPRE como string decimal (`Ec2GapRow.first_gap_seq/gap_count` — projetado assim de propósito; a UI nunca aplica `Number()`).
- **Binário**: todo hash/HMAC chega em hex; datas ISO-8601 UTC.
- **Envelope de erro uniforme**: `{error: <código>, …}` (+ `issues[]` de Zod nos 400 — `runs.ts:38-42`; + `message`; + `required_role` nos 403 de role). 501 com shape fixo `{error:'capability_not_implemented_in_runtime_patch_1', capability, status:'planned', planned_phase, tracker}` (`_not-implemented.ts:20-29` `[da série]`).
- **CORS de primeira classe**: `API_CORS_ORIGINS` CSV + `API_CORS_CREDENTIALS` com guarda de produção (`server.ts:94-98`; `config/src/index.ts:29-30,143+`).
- **Rate limit: 100 req/min GLOBAL por processo em produção** (`server.ts:102-105`; teste = 1M) — pré-requisito de UI em produção é o EP-B1.
- **Sem OpenAPI/Swagger** (grep vazio); os shapes vivem em Zod inline nas rotas.

## 3.4 ★ O vocabulário de honestidade do enforcement (o conjunto EXATO e a alcançabilidade — verificado par a par)

**O enum:** `enforcement_decision ∈ observe | warn | ask | enforce | sandbox_required | blocked` (`resolve-governance.ts:48-54`; ranking `enforcement.ts:44-51`).

**A tabela (base_risk_class, level) COMPLETA dos dois registries — o par que decide tudo** (ler o `level` ADJACENTE à base é obrigatório; ignorá-lo é o erro clássico):

| Capability | level | base | Âncora |
|---|---|---|---|
| `anthropic.messages.create` | **policy_governed** | **A** | `provider-anthropic/src/capabilities/index.ts:14-15` |
| `anthropic.messages.stream` | **policy_governed** | **A** | `:28-29` |
| `anthropic.messages_meta` | passthrough_audited | A | `:42-43` |
| `anthropic.models` | passthrough_audited | A | `:56-57` |
| `anthropic.files` | passthrough_audited | B | `:71-72` |
| `anthropic.web_search_tool` | passthrough_audited | **C** | `:96-97` |
| `openai.responses.create` | **policy_governed** | **A** | `provider-openai/src/capabilities/index.ts:18-19` |
| `openai.responses.stream` | **policy_governed** | **A** | `:32-33` |
| `openai.chat.completions.create` | **policy_governed** | **A** | `:48-49` |
| `openai.chat.completions.stream` | **policy_governed** | **A** | `:62-63` |
| `openai.models` | passthrough_audited | A | `:78-79` |
| `openai.models.delete` | passthrough_audited | **C** | `:93-94` |
| `openai.embeddings` | passthrough_audited | B | `:109-110` |
| `openai.files` | passthrough_audited | B | `:125-126` |
| `openai.vector_stores` | passthrough_audited | B | `:145-146` |
| `openai.vector_stores.delete` | passthrough_audited | **C** | `:165-166` |
| `openai.vector_stores.files.delete` | passthrough_audited | **C** | `:179-180` |
| `openai.web_search_tool` | passthrough_audited | **C** | `:200-201` |
| `openai.file_search_tool` | passthrough_audited | B | `:212-213` |

**A conclusão verificada (a nota de fato do briefing, re-derivada nesta sessão):** as **6** capacidades `policy_governed` — as ÚNICAS que o caminho governado exercita (`handle-messages.ts:172-174` seleciona create/stream; idem OpenAI) — são **TODAS base A**. TODAS as capacidades base C são `passthrough_audited`, e o passthrough **não resolve a matriz** (fixa `observe` literal — `register-passthrough.ts:401,476`; OpenAI `:461,537`). Escalações de DLP: PII forte (CPF/CNPJ) `A→C / B→C / C→D`; PII padrão `A→B` (`resolve-governance.ts:77-101`). Logo, **no caminho governado a base é sempre A e PII forte escala no máximo A→C → `ask`; C→D exigiria base C, que o caminho governado nunca tem; nenhuma capacidade tem base D/E e nenhuma escalação produz E ⇒ `E→blocked` (`enforcement.ts:66`) é inalcançável (F2a).**

**A matriz de produção** (`enforcement.ts:62-81`) e os modificadores (`:85-102`):

| effective_risk | starter | business | enterprise/regulated |
|---|---|---|---|
| E | blocked (inalcançável) | blocked (inalc.) | blocked (inalc.) |
| D | **blocked (403)** | sandbox_required (encaminha) | enforce (encaminha) |
| C | ask (encaminha) | enforce (encaminha) | enforce (encaminha) |
| B | warn (encaminha) | warn | warn |
| A | observe | observe | observe |

`dev|test` → `observe` incondicional (`:85-87`). `pilot` → relaxa um degrau (`:90-92`; `blocked→sandbox_required` `:54`) — **pilot nunca bloqueia por matriz**. Piso de computer-use hospedado ≥ sandbox_required (`:95-102`) — na prática inerte no governado, porque computer-use é bloqueado na VALIDAÇÃO antes (abaixo). `side_effects`/`preconditions` (audit detail, DLP obrigatório, sandbox — `:104-120`) são **descartados** pelo resolvedor (`resolve-governance.ts:153-158`) — sem efeito de runtime.

**Os vetores REAIS de 403 no caminho governado** (`handle-messages.ts:258` — `toolBlock !== null || decision === 'blocked'`):
1. **Validação de ferramenta** (dispara em QUALQUER modo, inclusive dev/test — roda antes da matriz): `computer_\d{8}` → `capability_blocked_via_token`; `code_execution_\d{8}` → `capability_planned`; `typed_unknown` (type nulo/não-string/vazio/desconhecido) → `typed_unknown` (`tool-classifier.ts:97-117`). Razão no corpo: `tool_blocked:<classification>:<block_reason>` (`handle-messages.ts:259-261`).
2. **Matriz**: ferramenta `bash_\d{8}` é PERMITIDA com contribuição D (`tool-classifier.ts:26,93-94`) → efetivo D → produção + `starter` → `blocked`; razão `enforcement_blocked:D`. **É o único bloqueio de matriz vivo.**
3. Fora do enforcement: beta-token `hard_denied` no gate de headers (3 tokens — `beta-policy.ts:41-56`), e os 403 de autorização (role/participação).

Corpo do 403 governado: `{error:'governed_blocked', reason, governance}` (`register-governed.ts:114-121`; OpenAI `:69`). Resposta encaminhada carrega SEMPRE os headers `x-govai-capability-level` / `x-govai-effective-risk-class` / `x-govai-enforcement-decision` (`:134-136,169-171`; OpenAI `:84-86,111-113`) — **o único canal por-request da decisão ao cliente hoje**.

**Prova de sanidade ponta-a-ponta** (confirma o runbook `docs/runbooks/user-e2e-local.md:14-17`): org `starter` em produção mandando CPF → base A → efetivo C → `ask` → **encaminhado ao provedor com o CPF dentro**, header `x-govai-enforcement-decision: ask`, evento com `dlp_decisions[].action:'warn'` (`handle-messages.ts:230-240`) — ninguém foi consultado; foi *detectado e registrado*. O 403 determinístico por risco é a ferramenta `bash` + tier `starter` em produção.

## 3.5 A assimetria de DLP entre os dois caminhos (ninguém documenta; a UI precisa saber)

| | **Path-A `/v1/runs` (governed)** | **Path-B `/governed/*`** |
|---|---|---|
| Scan | `dlpPreScan` lê config POR ORG `govai.dlp_baseline_config` (`pipeline/dlp.ts:44-57`) | closure chama `detectAllBaseline` DIRETO — **ignora a config da org** (`routes/governed-anthropic.ts:60-71`) |
| Pode negar? | SIM — `decidePolicy` → run `denied` → **403** (`run-orchestrator.ts:512`; persistido em `policy_decisions`) | NÃO — achado vira só escalação de risco |
| Pode redigir? | SIM em tese — `action='redact'` → `redactFindings` sobre o input (`:575`) — **QUEBRADO (F5)** | NÃO — "We do not redact in this initial governed-native delivery" (`handle-messages.ts:219-221`) |
| Registro | `dlp_findings` por detector (`:563`) + `dlp_finding_count` (`:540`) — inflados por sobreposição (F6) | `dlp_decisions[]` no evento com `action:'warn'` LITERAL (`:230-240`) |
| Consequência | uma org com `action=deny` para CPF é bloqueada AQUI… | …e tem o MESMO CPF encaminhado AQUI. Decisão de design Q2 (convergir deny-primeiro) `[da série]` pendente de implementação |

Camada rica adicional (SD1): `scanSensitiveData` produz achados com taxonomia/proveniência/`match_hash`+`match_preview_redacted` (sem plaintext), famílias credenciais/segredos, CNJ, financeiro, saúde — **advisory only**, nada os consome em decisão (`pipeline/dlp.ts:29-35,75-78`; `packages/dlp-br/src/index.ts`). É a matéria-prima do futuro DLP RT-bridge.

## 3.6 O contrato do evento selado e da captura

- **Evento**: `PassthroughInvoked` **schema_version 4** (`core-events/src/passthrough-invoked.ts:69`) — identifica tenant, provider, capability (+`capability_level` operacional vs `capability_canonical_level` do registry), endpoint/método nativos, `is_stream/is_multipart`, riscos (base/efetivo/razões), `enforcement_decision`, hashes (`native_request_hash`, `native_response_hash` OU `stream_final_hash`), `stream_outcome ∈ complete|upstream_error|client_disconnect` (`:129`), `latency_ms`, `status_code`, `occurred_at` estável para idempotência (âncora única — `handle-messages.ts:256`), `credential_source` (hoje string≥1 — F1), `body_forward_mode ∈ raw|redacted|blocked` (`:145`), `dlp_decisions[]`, beta sources, classificações de ferramenta, `audit_event_id`, `chain_category`. **Regras (superRefine)**: blocked→body_forward_mode='blocked' (`:227-232`); passthrough_audited nunca 'redacted' (`:239-245`) e forward não-bloqueado → 'raw' (`:253-257`); Regra 8 guarda stream quebrado. ⚠ `redacted` é RESERVADO — nenhum caminho o emite hoje (F5).
- **Captura**: o despacho das rotas diretas persiste **`payloadEncrypted: null` — só o hash da projeção** (`audit-bridge.ts:210`); posture `best_effort` nunca falha a request (`:105-111,294`); razões de queda tipadas (ex.: `missing_request_identity` `:29`) contadas em OTel. Consequência de produto: **não há "feed por-request" legível hoje** (D4).
- **Cadeias**: 4 por org (`auth|run|policy|admin` — `audit-events.ts:8`, `chainIdFor` `:43`); `GET /v1/audit-events` devolve metadados+hashes, **nunca payload**.

## 3.7 O inventário de rotas (núcleo — cada linha re-verificada nesta sessão)

| Método e caminho | Fonte | Auth/Role | Paginação | Nota de contrato |
|---|---|---|---|---|
| GET `/health` | `health.ts:4` | nenhuma | — | `{status:'ok',service:'govai-api'}` estático (F3: não toca o pool) |
| GET `/v1/capabilities` | `capabilities.ts:10` | chave válida | — | matriz capability×facet com overrides por org |
| POST `/v1/runs` | `runs.ts:29` | chave válida | — | body `{workspace_id, capability, model, input≤50k, mode?, metadata?}` (`:19-26`); `denied→403`, `failed→502` (`:69-76`); `shadow→400` (`:47-54`); `capability_not_supported→403` (`:84-93`), não-registrada→404 (`:95-98`) |
| GET `/v1/audit-events` | `audit-events.ts:14` | chave válida | keyset `before_seq` ≤200 | `chain_category` obrigatório (enum `:8`); hashes hex, nunca payload |
| GET `/v1/evidence/summary` | `evidence.ts:56` | chave válida (sem gate de role — "o auditor É o tenant") | — | `?window=` (≤1 ano); shape com counts+ec3drop+ec6+coverage_ratio |
| GET `/v1/evidence/gaps` | `evidence.ts:98` | chave válida | offset `cursor` ≤500 | `invariant ∈ ec1\|ec2\|ec3seal\|ec3drop\|ec4` (`:37`); ec3drop = singleton página 0 (`:139-144`) |
| POST `/v1/admin/provider-credentials` | `admin-provider-credentials.ts:105` | `admin` | — | set/rotate; plaintext nunca ecoa; evento na cadeia `admin` |
| POST `…/provider-credentials/:id/revoke` | `:226` | `admin` | — | revogação + evento |
| GET `/v1/admin/provider-credentials` | `:346` | `admin` | — | `?status=active\|revoked\|all` |
| POST `/v1/admin/dlp-detectors` | `admin-dlp.ts:21` | `admin` | — | **501** (shape `_not-implemented.ts`) |
| POST `/v1/admin/audit-events/:id/crypto-shred` | `admin-audit-shred.ts:22` | `admin` | — | **501** |
| POST `/v1/workrooms` | `workrooms.ts:179` | `developer`/`admin` | — | mode default `governance_active` (`:201`), `max_risk_without_approval` default C (`:205`); `audit_only` pode ser proibido pela org (`:221`) |
| GET `/v1/workrooms/:id` | `workrooms.ts:373` | chave válida (404 cross-org) | — | `{workroom, policy_profile, governance_mode}`; **sem participantes** |
| GET `/v1/workrooms` | `workrooms.ts:443` | chave válida | filtros `status/workspace_id/limit` | lista da org |
| POST `/v1/workrooms/:id/participants` | `workrooms.ts:504` | `human_owner` ativo ou `admin` `[da série]` | — | duplicata ativa → 409 |
| DELETE `…/participants/:participantId` | `workrooms.ts:704` | `human_owner` `[da série]` | — | **não há GET de participantes** (lacuna) |
| POST `/v1/workrooms/:id/messages` | `workroom-transcript.ts:169` | participante ativo | — | conteúdo envelope-cifrado; linha só `content_ref`+`payload_hash` (`:15-16,217`) |
| POST `/v1/workrooms/:id/tasks` | `workroom-transcript.ts:376` | participante ativo | — | `risk_class` + `requires_approval` |
| GET `/v1/workrooms/:id/evidence` | `workroom-transcript.ts:554` | participante ou `auditor`/`admin` | keyset `before_seq` | 11 `artifact_kind`s (`:60-75`); metadados+hashes |
| GET `/v1/workrooms/:id/audit` | `workroom-transcript.ts:679` | **só** `auditor`/`admin` (`:697-700`) | keyset `before_seq` | turnos→eventos com `redaction_metadata` |
| POST `/v1/workrooms/:id/runs` | `workroom-runs.ts:232` | participante ativo | — | matriz `resolveRunMode` (`:16-30`): override passthrough exige aprovação |
| GET `/v1/workrooms/:id/runs` | `workroom-runs.ts:468` | participante ou `auditor`/`admin` | cursor composto | status 6 valores + `mode_relation` |
| POST `/v1/workrooms/:id/approvals` | `workroom-approvals.ts:249` | participante ativo | — | vincula `intended_action_hash`; intended-run cifrado (`:17`) |
| GET `/v1/workrooms/:id/approvals` | `:444` | participante ou `auditor`/`admin` | cursor composto | expiry semântico em tempo de leitura (`:209-217`) |
| GET `…/approvals/:approvalId` | `:557` | idem | — | detalhe com `consumed_run_id` |
| POST `…/approvals/:approvalId/decisions` | `:661` | `human_owner`/`human_approver` participante (`:720-725`) | — | SoD (`:757-764`); corrida → 409 |
| POST `…/approvals/:approvalId/revoke` | `:901` | requerente ou `human_owner` (`:971-978`) | — | — |
| POST `/governed/anthropic/v1/messages` | `register-governed.ts:69` (via `routes/governed-anthropic.ts`) | chave válida | SSE quando stream | headers `x-govai-*`; 403 `governed_blocked` |
| POST `/governed/openai/v1/responses` | `register-governed.ts:129` | chave válida | SSE | idem |
| POST `/governed/openai/v1/chat/completions` | `register-governed.ts:174` | chave válida | SSE | idem |
| ALL `/passthrough/anthropic/*` | `register-passthrough.ts:174` | chave válida | — | espelho nativo; `observe` sempre |
| ALL `/passthrough/openai/*` | `register-passthrough.ts:178` | chave válida | — | idem |

**Regulatório (108 operações / 60 caminhos)**: a tabela por-operação com TODAS as linhas (re-derivadas nesta sessão) está no Anexo 13.1-B. Convenções da área: leitura = qualquer identidade do tenant; escrita = `admin|data_protection_officer` (`requireWriteRole` — `regulatory.ts:1131-1141`); cursor composto uniforme; `POST /v1/regulatory/risk-classifications/evaluate` (`:2737`) é computação pura sem persistência; toda a área é **evidência, não enforcement**.

## 3.8 As lacunas de contrato (o que a UI/features novas precisam e não existe)

1. **Sem whoami** — nenhuma rota expõe `roles/tier/operational_mode` (→ EP-B2).
2. **Sem GET de participantes** de workroom (→ EP-B4).
3. **Sem leitura de transcript** — conteúdo cifrado, nenhuma rota de decrypt-read (→ D1/EP-B5).
4. **Sem feed por-request de governança** — captura hash-only; `/v1/runs` é POST-only; não há GET de runs standalone (→ D4/EP-B6).
5. **Rate limit global 100/min** hostil a dashboard (→ EP-B1); a master-arch pede distribuído/Redis para multi-instância `[ALVO DOCUMENTADO]`.
6. **Sem OpenAPI/pacote de contrato** (→ EP-B7).
7. **Sem sessão** — chave crua no cliente (→ EP-B3).
8. **Sem rota de verificação de cadeia** — EC-6 sempre pending (→ EP-V1).
9. **Stubs 501**: CRUD de detectores DLP; crypto-shred.
10. **Sem rotas das 5 features novas** (review-items, policy studio, evidence packages, connectors, crosswalk — grep vazio; → Cap. 4).

**O que um agente implementa a partir daqui:** nada — este capítulo é o CONTRATO. Regra de uso: toda tela do Cap. 6 e todo EP do Cap. 4 citam uma linha desta seção ou declaram-se `[ALVO]`; se uma âncora divergir do código no commit em que você trabalha, PARE e regenere (Cap. 13.4).

---

# Capítulo 4 — O backend a construir (os EPs, por dependência)

## 4.1 Pré-condição de tudo: a fase de correção F1–F6

Os seis fixes (cabeçalho deste documento) vêm ANTES de qualquer campo novo de UI que os toque: F1/F2 destravam `credential_source`/`block_trigger`; F5/F6 destravam narrativa de redação/contagens exatas; F3/F4 são confiabilidade (readiness real; evidência não descartada). Na UI, os campos nascem atrás de flag `contractFixed.*`.

## 4.2 Os EPs de fundação que a UI puxa (pequenos, independentes)

| EP | O quê | Por quê | Envolve | Quando |
|---|---|---|---|---|
| **EP-B1 — rate limit por chave/org** | trocar o global 100/min in-memory (`server.ts:102-105`) por limite por chave + teto maior | um cockpit consome 100/min rápido; um tenant esfomeia o outro | keyGenerator no `@fastify/rate-limit`; Redis quando multi-instância (master-arch §6.2) | antes de U1 em produção |
| **EP-B2 — whoami `GET /v1/me`** | devolver `{org_id, roles, tier, operational_mode, api_key_prefix}` da `AuthIdentity` já resolvida | lacuna 3.8.1 — sem isso não há nav por role nem badge de modo com consequência | ~30 linhas; zero query nova | U1/U2 |
| **EP-B4 — `GET /v1/workrooms/:id/participants`** | roster + "qual é o meu papel aqui" | lacuna 3.8.2 — o SoD-UX depende disso | select RLS-scoped | U2 |
| **EP-B7 — pacote `@govai/api-contract`** | extrair os Zod schemas inline para pacote importado dos dois lados | tipagem ponta-a-ponta sem OpenAPI; o template regulatório da U3 é GERADO dele | mover schemas (mecânico) | começa em U1, incremental |
| **EP-B3 — sessão chave→JWT (cookie httpOnly)** | troca de chave por JWT curto | tirar a chave crua do browser em multiusuário | `jwt.ts` já existe `[FUNDACIONAL]`; `API_CORS_CREDENTIALS` já existe | antes do 2º usuário humano |
| **EP-B5 — leitura de transcript (decrypt autorizado)** | `GET /v1/workrooms/:id/messages` com decrypt por participação (+auditor com evento de acesso selado) | a vista de conversa é impossível hoje | decisão D1 + rota + evento de acesso | U2 fase 2 |
| **EP-B6 — feed por-request de governança** | persistir projeção legível do capture OU expor join `provider_invocations`+`policy_decisions` | "o que a governança fez nas minhas últimas 100 chamadas?" não tem rota | decisão de plano de evidência (D4: retenção/PII/tamanho) | pós-U2 |
| **EP-B8 — rota HTTP do cockpit de operador** | expor `buildOperatorCockpit` com autorização de operador | SÓ se o dono quiser operador no produto (D3); senão Grafana | rota + modelo de authz de operador (INV-1: enumerar ≠ ler) | condicional |
| **EP-V1 — verificação EC-6 persistida + sob demanda** | verificador de cadeia com resultado persistido; `POST /v1/evidence/verify` bounded | EC-6 hoje é sempre `pending` honesto; o botão "verificar agora" é a promessa natural do cockpit | tabela de verificação + job/rota; muda `ec6` de pending→ok/fail com timestamp (o gauge `govai_evidence_chain_verification_ok` já existe para recebê-lo) | pós-U1 |

## 4.3 As 5 features de produto novas — `[NOVO — proposto]` (confirmado nesta sessão que NENHUMA existe no código)

### N1 — Policy Studio (Plano 2 → a tela que sustenta o claim "standalone")
**O quê:** configurar governança sem SQL: tiers/modos (leitura sempre; mutação SÓ para operador — Q4), regras por detector/dado-sensível → ação (`detect|redact|deny` hoje; `warn/ask` no alvo), regras por provider/capability/tool, hard-deny floor visível (read-only: os 3 bloqueios de validação + beta hard_denied), limiar de aprovação, modo audit-only vs enforcing por sala/org, exceções temporárias com expiração e trilha.
**API-alvo (esboço):** `GET/PUT /v1/policy/dlp-baseline` (CRUD da `govai.dlp_baseline_config` — hoje só via SQL; o stub 501 `admin-dlp.ts` é o assento reservado); `GET /v1/policy/effective` (a matriz efetiva da org, derivada — NUNCA editável no tenant); `POST /v1/policy/simulate` (dry-run: dado um request hipotético, qual seria a decisão — computação pura como o `evaluate` regulatório); mutação de `operational_mode`/`tier` fica em superfície de OPERADOR separada com evento na cadeia `admin` (hoje nem o operador tem trilha — lacuna real).
**Regra de segurança:** o Policy Studio NUNCA permite ao tenant relaxar o hard-deny floor nem mudar o próprio modo/tier — só o operador; toda mutação emite evento na cadeia `admin`/`policy`.

### N2 — Review Queue / Work Item (o "ask" virar produto)
**O quê:** hoje `ask` encaminha sem reter (3.4). A feature cria o work-item: risco C → item na fila → revisor decide → decisão entra na cadeia.
**★ Decisão de produto embutida (D7):** (a) **pós-hoc** (não retém; o item é criado com o evento e revisado depois — zero latência adicionada, honesto: "revisão a posteriori") ou (b) **retenção** (segura a request até decisão — muda o SLA do caminho governado; a master-arch §10 já diz "Approval required: human workflow; no low-latency promise"). `[recomendação]`: começar por (a) pós-hoc em U-N2a (só backend de fila + UI), e (b) como modo opt-in por org depois — o mecanismo de aprovação com SoD/expiry/one-time da workroom (`workroom-approvals.ts`) é o molde a generalizar.
**API-alvo:** `GET/POST /v1/review-items`; `POST /v1/review-items/:id/approve|deny|request-info`; `GET /v1/review-items/:id/evidence` (o evento + trilha). Reusar a semântica provada: expiry read-time, SoD, decisão com razão, consumo one-time.

### N3 — Evidence Package / Case Export (o que diferencia de um DLP genérico)
**O quê:** pacote auditável por incidente/caso: timeline, metadados de request, decisão de política, sinais de DLP, IDs de eventos da cadeia, hashes, status de selagem, decisões de revisor, export JSON (e PDF depois) + instruções de verificação de integridade. Alinha com "Reporting v1: HTML/CSV/JSON evidence bundle without TSA; marked technical evidence bundle, not certification" (master-arch §6.2).
**API-alvo:** `POST /v1/evidence-packages` (composição: janela + filtros + itens explícitos); `GET /v1/evidence-packages/:id` (manifesto com hashes); `GET /v1/evidence-packages/:id/export` (bundle). Regra de claims: o pacote se autodenomina "technical evidence bundle" e carrega as ressalvas (EC-6 pending, bounds) DENTRO do export.
**Base pronta:** a primitiva universal "Exportar esta consulta (JSON)" da UI (Cap. 8.3) é o degrau 0 sem backend novo.

### N4 — Connector Framework (ingestão + export) (Plano 5)
**O quê:** o schema `ExternalEvidenceEvent` (source_system, occurred_at, actor, provider, action, classification, policy_decision, native_risk_signal, trust_level, evidence_hash) para ingerir sinais (Purview/BigID/cloud-logs) e exportar para SIEM (Sentinel/Splunk) e GRC (ServiceNow/OneTrust). **Regra de proveniência** (o vocabulário JÁ existe — `sensitive-provenance.ts` `[FUNDACIONAL]`): GovAI-executou = evidência primária; terceiro-executou = ingerida; terceiro-reportou = derivada; usuário-informou = declarativa — ingerido NUNCA sobrepõe evidência primária.
**API-alvo:** `POST /v1/connectors/:id/events` (ingestão idempotente, metadata-first); `GET/POST /v1/connectors` (config); export como sink assíncrono (outbox → destino), NÃO como query síncrona.
**Ordem:** export SIEM primeiro (menor risco, alto valor CISO), ingestão depois (traz o threat model de conector — master-arch: "sealer role/outbox attack surface" análogo).

### N5 — Compliance Crosswalk (Plano 6 → "prova de cobertura")
**O quê:** Requirement→Control→Evidence→Status→Gap→Remediation com status `COVERED|PARTIAL|GAP|NEEDS_SOURCE_VERIFICATION`, mapeando requisitos (LGPD/NIST AI RMF/ISO 42001/EU AI Act) às primitivas concretas (audit_events, payload hashes, RLS, approvals, evidence artifacts). Transforma o núcleo regulatório de "registro de evidência" em "prova de cobertura" — sempre gated pela claims-policy (nunca "certified").
**Base pronta:** `controls` + `framework-mappings` (`regulatory.ts:1474,1502`) já ligam controle↔framework; falta a ponta Evidence (ligar controle→consulta de evidência executável) e o motor de status.
**API-alvo:** `GET /v1/crosswalk?framework=` (a matriz computada); `PUT /v1/crosswalk/mappings` (curadoria); cada célula referencia a QUERY de evidência que a sustenta (auditável, não opinião).

## 4.4 EPs de arquitetura (gatilho-condicionados, do plano-alvo)

- **EP-KERNEL (ADR-016)**: extrair `packages/governance-kernel`. Gatilho certo: a 3ª superfície de decisão (conectores N4 ou Shadow AI) — extrair antes é refactor sem consumidor `[recomendação]`. Critério de aceitação do ADR: testes falham se uma superfície suportada fizer bypass.
- **EP-RT-BRIDGE (DLP policy binding)**: uma classe não-baseline (ex.: segredos do SD1) policy-bound a warn/redact/block — deliverable da Foundation Release; depende do F5 (redação correta) e conversa com N1.
- **EP-RUNTIME-ENFORCEMENT (Fase 5 do roadmap)**: determinations DENIED bloqueando o runtime; binding de high-risk approval à execução; enforcement de tool/MCP. Critério: "a denied determination actually blocks the runtime path, with tests".
- **EP-ANCHOR (Merkle/TSA/ICP-Brasil)**: grau de evidência futuro (R2/R3).

**O que um agente implementa a partir daqui:** os EPs na ordem do Cap. 9; cada EP nasce com: contrato no `@govai/api-contract` (pós-B7), evento(s) de auditoria definidos, teste de integração, e a linha correspondente atualizada na tabela 13.1.
---
---

# PARTE III — A INTERFACE (o Plano 7)

# Capítulo 5 — Arquitetura de UI

**A decisão (consolidada da série, fatos re-verificados):** **SPA estática (React + TypeScript + Vite) em `apps/ui` no monorepo pnpm, consumindo o Fastify DIRETAMENTE. Sem BFF. Sem SSR.** `[recomendação — fundada em fatos confirmados]`

O raciocínio, ancorado no contrato:
1. **A fronteira de tenancy vive na API/RLS, não num servidor de UI** — toda leitura roda `BEGIN → set_config('app.org_id') → query → COMMIT` (`core-tenant/src/index.ts:14-32`); cross-tenant é 404. Um BFF adicionaria um segundo lugar para errar autorização e nenhuma agregação que o Fastify não ganhe como rota (o padrão EP-008D já provou isso).
2. **Auth por chave sem sessão/cookie** (`auth.ts:40-92`; JWT presente e não consumido) — SSR obrigaria um servidor a custodiar a chave; a SPA mantém a chave na MEMÓRIA do browser (nunca localStorage), mesma postura de confiança do `curl` atual. Com multiusuário, o lugar da sessão é o `apps/api` (EP-B3), não um servidor de UI.
3. **Zero conteúdo público** — os argumentos de SSR (SEO/first-paint anônimo) não se aplicam.
4. **O backend já antecipa browser**: CORS de primeira classe com guarda de produção (`server.ts:94-98`), envelope de erro uniforme, SSE repassado.
5. **Monorepo TS-source-only**: `apps/ui` entra no workspace e importa tipos do `@govai/api-contract` (EP-B7) — sincronia estrutural (typecheck quebra no MESMO PR que mudar uma rota), sem gerador OpenAPI.
6. **A doutrina concorda**: "Native reports and dashboards" = `BUILD_NATIVE_CORE`; "Audit-readiness cockpit" = `BUILD_NATIVE_ENHANCED` (`19-build-vs-integrate-strategy.md:139-140` `[confirmado na fonte]`).

**Stack** `[recomendação]`: React 18 + TS + Vite; TanStack Query (cache por query-key; o dado é "agregações prontas + listas por cursor"); TanStack Table headless + componentes próprios estilo shadcn (Radix + Tailwind, vendorizados — controle total do sistema visual num produto de conformidade); Zod no cliente (os schemas do contrato); SSE nativo (`fetch`+`ReadableStream`) para o playground streaming.

**A regra de ouro (invariante, herdada da spec e promovida a toda a interface):** *"the UI binds 1:1 to the API; no fields are invented client-side; no 'draft' state lives only in localStorage; the mode indicator is not dismissable in `audit_only`"* (`docs/architecture/workroom-governance-room.md:909` `[confirmado na fonte]`).

**Tenancy na UI:** a org NUNCA é escolhida (deriva da credencial); `org_id` das respostas serve para exibição/sanity-check; `tier`/`operational_mode` são badges read-only COM CONSEQUÊNCIA explicada (dependem do EP-B2); autorização em dois eixos na navegação — esconder o que o role global nega, desabilitar-com-explicação o que o papel na sala nega. **A UI não é camada de segurança; é camada de honestidade.**

**O que um agente implementa a partir daqui:** `apps/ui` no workspace (Vite+React+TS; tokens do Cap. 7; TanStack; sessão de chave em memória; cliente HTTP com os dois headers de auth, backoff de 429 e o mapa de erros 3.3) — nenhuma tela ainda. O plano executável detalhado de U1→U4 é o GOVAI-UI-MASTER-PLAN da série (mesmo commit); este documento o incorpora e o estende com as áreas novas (Cap. 6.3).

# Capítulo 6 — O mapa de telas por PERSONA e ÁREA ★ PRIORIDADE DE RIGOR

Organização: as áreas que os 7 planos geram. Cada tela: rota frontend, persona, rota de backend com status — `[✓ arquivo:linha]` = existe (re-verificado nesta sessão, Cap. 3.7) e a tela é **[IMPLEMENTÁVEL HOJE]**; `[ALVO — EP-x]` = precisa de EP. Baseline herdada da série: **51 telas nominais** (15 únicas + 36 instâncias de 2 templates); este plano adiciona **+17 telas das 5 features novas** → **68 telas nominais no alvo completo**.

## 6.0 A0 — Acesso (transversal)

| Tela | Rota | Persona | Backend | Status |
|---|---|---|---|---|
| Entrar (colar chave) | `/enter` | todas | probe `GET /v1/evidence/summary` `[✓ evidence.ts:56]`; vira `GET /v1/me` pós-EP-B2 | [IMPLEMENTÁVEL HOJE] |

## 6.1 Evidência — o cockpit (Plano 3) — U1, primeira entrega

Persona-âncora: **Auditor** e **DPO** (com o Owner como leitor secundário). Todas [IMPLEMENTÁVEL HOJE]; sem gate de role ("o auditor É o tenant").

| # | Tela | Rota | Backend |
|---|---|---|---|
| 1 | Cockpit de evidência (home) | `/` | `GET /v1/evidence/summary?window=` `[✓ evidence.ts:56]` |
| 2 | Lacunas por invariante (drill-down ×5) | `/evidence/gaps/:invariant` | `GET /v1/evidence/gaps?invariant=&cursor=` `[✓ evidence.ts:98]` (enum exato `:37`) |
| 3 | Cadeia de auditoria | `/audit-events?chain=` | `GET /v1/audit-events?chain_category=&before_seq=` `[✓ audit-events.ts:14]` |
| 4 | Capacidades | `/capabilities` | `GET /v1/capabilities` `[✓ capabilities.ts:10]` |

História (F1 do fluxo-vitrine): cola a chave → coverage_ratio com `terms[]`/`excluded[]` SEMPRE visíveis → tile EC-1 âmbar → drill-down nas capturas → pivô pelo `chain_id` para a cadeia → "a captura existe, não selou no SLO; a cadeia está íntegra até o seq N" → exporta a consulta (JSON).

## 6.2 Workrooms (Plano 7) — U2, o coração interativo

Personas: **Desenvolvedor** (opera), **Owner/gestor** (decide), **Auditor** (audita).

| # | Tela | Rota | Backend | Status |
|---|---|---|---|---|
| 5 | Lista de salas | `/workrooms` | `GET /v1/workrooms` `[✓ workrooms.ts:443]`; criar: `POST` `[✓ :179]` (`developer`/`admin`) | [IMPLEMENTÁVEL HOJE] |
| 6 | Detalhe — Visão geral | `/workrooms/:id` | `GET /v1/workrooms/:id` `[✓ :373]`; roster: `[ALVO — EP-B4]` (hoje só POST `:504`/DELETE `:704`) | banner de modo não-dismissível em `audit_only` |
| 6a | Aba Runs | idem | `GET/POST /v1/workrooms/:id/runs` `[✓ workroom-runs.ts:468/:232]` — `mode_relation` em badge | [IMPLEMENTÁVEL HOJE] |
| 6b | Aba Aprovações (fila com SoD) | idem | `[✓ workroom-approvals.ts:249/:444/:557/:661/:901]` — requerente vê "Decidir" desabilitado ("quem pediu não decide", `:757-764`) | [IMPLEMENTÁVEL HOJE] |
| 6c | Aba Evidência | idem | `GET …/evidence?artifact_kind=` `[✓ workroom-transcript.ts:554]` — 11 kinds; "conteúdo cifrado at rest; o que se lê são metadados e hashes" | [IMPLEMENTÁVEL HOJE] |
| 6d | Aba Auditoria | idem | `GET …/audit` `[✓ :679]` — SÓ `auditor`/`admin` (`:697-700`) | [IMPLEMENTÁVEL HOJE] |
| 6e | Vista de conversa (transcript legível) | idem | `[ALVO — EP-B5, decisão D1]` — hoje impossível por construção | [ALVO] |

Fluxo central F3 (o "ask" REAL do produto hoje): override de passthrough → erro `workroom_run_mode_override_requires_approval` → pedir aprovação (hash da ação) → OUTRO participante decide (SoD; corrida→409) → run `override_approved` → aprovação consumida (`consumed_run_id`) → o auditor lê a trilha completa.

## 6.3 ★ As áreas NOVAS (as 5 features — todas `[NOVO — proposto]`, telas [ALVO])

### Review Queue (Plano 2 → o "ask" como produto) — persona: Owner/gestor + DPO
| # | Tela | Rota | Backend |
|---|---|---|---|
| 7 | Fila de revisão | `/review` | `GET /v1/review-items?status=` `[ALVO — EP-N2]` |
| 8 | Item de revisão (decidir) | `/review/:id` | `GET /v1/review-items/:id` + `POST …/approve\|deny\|request-info` `[ALVO — EP-N2]` — reusa a semântica SoD/expiry/razão-na-negação provada na workroom |
| 9 | Config da fila (pós-hoc vs retenção) | `/review/settings` | `[ALVO — EP-N2 + decisão D7]` — enquanto pós-hoc, a tela DIZ "revisão a posteriori; a request foi encaminhada" |

### Policy Studio (Plano 2 → o claim standalone) — persona: Owner/admin (+ operador na parte dele)
| # | Tela | Rota | Backend |
|---|---|---|---|
| 10 | Visão de política efetiva | `/policy` | `GET /v1/policy/effective` `[ALVO — EP-N1]` — a matriz derivada, read-only, com o hard-deny floor visível |
| 11 | Regras de dados sensíveis | `/policy/dlp` | `GET/PUT /v1/policy/dlp-baseline` `[ALVO — EP-N1]` (CRUD da `govai.dlp_baseline_config`; hoje o assento é o stub 501 `admin-dlp.ts:21`) — NENHUMA opção "redigir" oferecida antes do F5 |
| 12 | Exceções temporárias | `/policy/exceptions` | `[ALVO — EP-N1]` — com expiração e trilha |
| 13 | Simulador de decisão | `/policy/simulate` | `POST /v1/policy/simulate` `[ALVO — EP-N1]` — dry-run puro, espelho do `evaluate` regulatório |
| 14 | (Operador, superfície separada) Tiers & modos | fora da nav do tenant | mutação com evento na cadeia `admin` `[ALVO — EP-N1/OPERADOR]`; para o tenant são badges read-only |

### Evidence Package / Case Export (Plano 3) — persona: Jurídico/Compliance + Auditor
| # | Tela | Rota | Backend |
|---|---|---|---|
| 15 | Casos/Pacotes | `/cases` | `GET /v1/evidence-packages` `[ALVO — EP-N3]` |
| 16 | Compor pacote (janela+filtros+itens) | `/cases/new` | `POST /v1/evidence-packages` `[ALVO — EP-N3]` |
| 17 | Pacote (manifesto+export+verificação) | `/cases/:id` | `GET …/:id` + `…/export` `[ALVO — EP-N3]` — o export se autodenomina "technical evidence bundle" e carrega as ressalvas DENTRO |

### Connectors (Plano 5) — persona: CISO/Segurança
| # | Tela | Rota | Backend |
|---|---|---|---|
| 18 | Conectores (lista+config) | `/connectors` | `GET/POST /v1/connectors` `[ALVO — EP-N4]` |
| 19 | Export SIEM/GRC (destinos+saúde) | `/connectors/exports` | `[ALVO — EP-N4]` — export primeiro |
| 20 | Ingestão (fontes+proveniência) | `/connectors/ingest` | `POST /v1/connectors/:id/events` `[ALVO — EP-N4]` — cada evento exibido com o selo de proveniência (primária/ingerida/derivada/declarativa) |

### Compliance Crosswalk (Plano 6) — persona: Jurídico/Compliance + DPO
| # | Tela | Rota | Backend |
|---|---|---|---|
| 21 | Matriz de cobertura | `/crosswalk` | `GET /v1/crosswalk?framework=` `[ALVO — EP-N5]` — células COVERED/PARTIAL/GAP/NEEDS_SOURCE_VERIFICATION; cada célula referencia a query de evidência |
| 22 | Requisito (gap+remediação) | `/crosswalk/:requirementId` | `[ALVO — EP-N5]` |

### Shadow-AI (Plano 5, futura) — persona: CISO
| 23 | Shadow-AI (placeholder honesto) | `/shadow` | `[ALVO DOCUMENTADO — master-arch §11; PROIBIDO claim até ingestão existir]` — a tela só existe quando a ingestão existir; até lá, item de nav desabilitado "planejado" |

## 6.4 Execução/Playground (Plano 1) — U4 — persona: Desenvolvedor

| # | Tela | Rota | Backend | Status |
|---|---|---|---|---|
| 24 | Playground `/v1/runs` | `/runs/new` | `POST /v1/runs` `[✓ runs.ts:29]` — a `policy_decision{kind,reasons[]}` é o protagonista; `denied→403`, `failed→502`, `shadow→400` | [IMPLEMENTÁVEL HOJE] |

## 6.5 Regulatório + Crosswalk (Plano 6) — U3 — personas: DPO + Jurídico

| # | Tela | Rota | Backend | Status |
|---|---|---|---|---|
| 25 | Hub regulatório | `/regulatory` | navegacional; SEM contagens (sem rota de agregação; rate limit) | [IMPLEMENTÁVEL HOJE] |
| 26–59 | 17 recursos × (lista + detalhe) pelo template | `/regulatory/<recurso>[/:id]` | as 108 operações `[✓ regulatory.ts — tabela 13.1-B]`; escrita `admin\|dpo` | [IMPLEMENTÁVEL HOJE] |
| 60 | Simulador de classificação de risco | `/regulatory/risk-classifications/evaluate` | `POST …/evaluate` `[✓ regulatory.ts:2737]` — computação pura | [IMPLEMENTÁVEL HOJE] |

**Selo permanente da área inteira (cor própria — Cap. 7):** "Registro de evidência — não bloqueia execução" (`current-state.md` §4) — até a Fase 5 existir. Workflows (high-risk, prohibited-use) como linha do tempo de estados DENTRO do detalhe.

## 6.6 Admin/Operador (Plano 4) — U4 — persona: Owner/admin (tenant); operador FORA do produto

| # | Tela | Rota | Backend | Status |
|---|---|---|---|---|
| 61 | Credenciais de provedor | `/admin/credentials` | `[✓ admin-provider-credentials.ts:105/:226/:346]` — "a chave nunca volta"; link ao evento na cadeia `admin`; revogar exibe consequência ("runs em production/pilot passam a falhar" — `provider-credentials.ts:23-24`) | [IMPLEMENTÁVEL HOJE] |
| 62 | Organização (whoami) | `/admin/org` | `[ALVO — EP-B2]` — org_id, tier, modo, roles, com o texto de consequência de modo | [ALVO] |
| 63 | Gestão de chaves de API | `/admin/keys` | `[ALVO — sem rota; hoje CLI break-glass `grant-api-key-role.ts:1-8`]` | [ALVO] |
| — | Cockpit do operador | **Grafana** (`infra/docker-compose.observability.yml` + `infra/grafana/`) | gauges `govai_evidence_*` — NÃO passa pela UI de tenant (D3) | [IMPLEMENTADO — infra] |

## 6.7 A navegação e as jornadas por persona

```
GovAI  [Evidência] [Atividade*] [Workrooms] [Revisão*] [Política*] [Regulatório] [Casos*] [Conectores*] [Admin]
        org: acme · ⬤ production · janela [24h ▾] · chave ●●●● sair          (*novas — aparecem com a feature)
```
- **Auditor** entra em Evidência (cockpit→gaps→cadeia); cruza com Workroom/Auditoria; exporta pacotes (Casos).
- **DPO** entra num "Início do DPO" `[recomendação]`: exposição de dados pessoais (detecções por detector/janela — do cockpit + futuro feed), fila de revisão, workflows regulatórios, crosswalk LGPD.
- **CISO** vê uso por capability/risco (capacidades + futuro feed/ledger) e configura o export SIEM.
- **Jurídico** vive em Casos + Regulatório (workflows) + Crosswalk.
- **Owner** vê o departamento (workrooms + revisão + ledger).
- **Desenvolvedor** vive em Workrooms + Playground (+ os headers `x-govai-*` explicados no detalhe do run).
- **Operador** NÃO usa esta UI (Grafana + superfície própria) — a não ser que D3 mude.
- Gating: menu Admin só `admin`; aba Auditoria só `auditor|admin`; escrita regulatória só `admin|dpo`; criar workroom só `developer|admin`; até o EP-B2 a UI não conhece roles → Fase U1 mostra só Evidência (sem gate).

**O que um agente implementa a partir daqui:** o router com exatamente estas rotas; o shell com gating por role atrás de flag até o EP-B2; as 4 telas de Evidência primeiro (zero EP novo); as áreas novas só entram quando o EP delas existir — cada tela [ALVO] no router aponta o EP que a destrava.

# Capítulo 7 — O sistema de design

## 7.1 Direção visual — "Ledger" `[recomendação]`

A estética de um livro-razão técnico: denso, sóbrio, tipografia funcional, cor quase exclusivamente para SEMÂNTICA de status. Um produto de conformidade ganha confiança por precisão visual, não por exuberância.

**Paleta (light primeiro; dark atrás de tokens CSS):**

| Token | Hex | Uso |
|---|---|---|
| `--bg-app` / `--bg-surface` / `--bg-inset` | `#F8FAFC` / `#FFFFFF` / `#F1F5F9` | fundo / cartões-tabelas / células de hash e cabeçalhos |
| `--border` / `--border-strong` | `#E2E8F0` / `#CBD5E1` | bordas / divisores |
| `--text-primary` / `--text-secondary` / `--text-tertiary` | `#0F172A` / `#475569` / `#94A3B8` | texto / rótulos / metadados |
| `--brand` / `--brand-hover` / `--link` / `--focus-ring` | `#1E40AF` / `#1E3A8A` / `#1D4ED8` / `#93C5FD` | ação primária / hover / links-pivôs / a11y |

**Cores semânticas (texto/fundo/borda) — a espinha do vocabulário de honestidade:**

| Semântica | Texto | Fundo | Borda | Exemplos |
|---|---|---|---|---|
| ok / selado / verificado | `#15803D` | `#F0FDF4` | `#BBF7D0` | `sealed`, `completed`, `granted` |
| atenção / pendente | `#B45309` | `#FFFBEB` | `#FDE68A` | `stalled_past_slo`, EC-6 `pending`, `awaiting_approval`, `ask`/`sandbox_required` |
| falha / bloqueio / lacuna | `#B91C1C` | `#FEF2F2` | `#FECACA` | `failed`, `denied`, `blocked (403)`, `chains_with_gap>0` |
| neutro / observacional | `#475569` | `#F1F5F9` | `#E2E8F0` | `observe`, `warn`, `enforce` encaminhados; `expired` |
| info / execução | `#1D4ED8` | `#EFF6FF` | `#BFDBFE` | `queued`, `running`, `sealing`, pivôs |
| registro regulatório | `#6D28D9` | `#F5F3FF` | `#DDD6FE` | o selo "evidência, não enforcement" — EIXO com cor própria |
| proveniência ingerida `[novo — N4]` | `#0E7490` | `#ECFEFF` | `#A5F3FC` | evidência ingerida/derivada/declarativa — nunca a cor da primária |

Regras: (i) **verde é reservado a fatos verificados/selados** — nunca "nenhum problema por ausência de verificação" (EC-6 pending é âmbar, jamais verde); (ii) **vermelho é reservado a efeito material** (403/falha/lacuna) — decisões encaminhadas NUNCA são vermelhas; (iii) pendente = outline, fato consumado = preenchido.

**Tipografia:** Inter (400/500/600); dados técnicos (hashes, ids, seq) JetBrains Mono 12–13px; escala 12/13/14/16/18/22/28; `tabular-nums` em toda coluna numérica. **Densidade:** grade 4px; linha de tabela 36px. **Raio:** 6/8/999px. Sombras mínimas.

## 7.2 Componentes-base (os 10 + 2)

1 **AppShell** · 2 **DataTable** (TanStack headless; estados loading/vazio/erro; **três adaptadores de paginação** — keyset `before_seq`, cursor composto, offset; contrato `usePaginated(queryKey, fetchPage, adapter)`) · 3 **StatCard/IndicatorTile** (número + badge + microtexto de ressalva OBRIGATÓRIO quando a resposta carrega ressalva) · 4 **StatusBadge** (UM componente; `(domain, value)` → rótulo+cor da tabela central; proibido badge ad-hoc) · 5 **HashText** (mono truncado `ab12…f9`, copy-on-click; NUNCA `Number()` em bigint-string) · 6 **Timeline** · 7 **FormSheet** (gerado de schema Zod; `issues[]` do 400 mapeados campo a campo) · 8 **ConfirmModal com consequência** (toda ação de peso exibe a CONSEQUÊNCIA no corpo) · 9 **ModeBanner** (não-dismissível em `audit_only`) · 10 **EmptyState honesto** ("nenhuma lacuna nesta janela" ≠ "tudo verificado") · +11 **ProvenanceBadge** (N4) · +12 **CoverageCell** (N5: COVERED/PARTIAL/GAP com a query de evidência linkada).

## 7.3 ★ A tabela normativa do vocabulário de honestidade (sobre os valores REAIS do Cap. 3.4)

| Valor no evento/header | Efeito HTTP real | Rótulo na UI (PT) | Cor |
|---|---|---|---|
| `observe` | encaminhado | "Observado — encaminhado ao provedor" | neutro |
| `warn` | encaminhado | "Alerta registrado — encaminhado ao provedor" | neutro (⚠ discreto) |
| `ask` | encaminhado | "Aprovação recomendada — encaminhado (ninguém foi consultado)" → com a Review Queue (N2) vira "— item de revisão criado" | atenção (outline) |
| `enforce` | encaminhado | "Política registrada — encaminhado (efeitos declarados não aplicados)" | neutro |
| `sandbox_required` | encaminhado | "Sandbox requerido — precondição declarada, não verificada; encaminhado" | atenção (outline) |
| `blocked` (matriz) | **403** | "Bloqueado (403) — matriz de enforcement" | falha |
| `tool_blocked:*` (validação) | **403** | "Bloqueado (403) — validação de ferramenta: `<classification>`" | falha |
| passthrough (sempre `observe`) | encaminhado | "Passthrough — observado, nunca aplica política" | neutro |

Regras invioláveis (testadas — Cap. 10): (1) **"Bloqueado" aparece SE E SOMENTE SE houve 403**; quando a request foi ao provedor, a UI diz isso literalmente. (2) **PII é DETECÇÃO**: "CPF detectado; a request foi encaminhada ao provedor", com `risk_escalation_reasons[]` (`dlp:<detector>:pii_strong|pii_standard`, `tool:<classification>:<classe>`, `multipart_upload`) como trilha em tooltip; contagens "detecções (podem sobrepor)" até o F6; **nenhuma afirmação de redação até o F5**. (3) `[contrato corrigido]` em evento de BLOQUEIO o rótulo deriva do fato 403/`body_forward_mode='blocked'`, não do `enforcement_decision` (que hoje mente); pós-F2 exibe decisão real + `block_trigger`. (4) `[contrato corrigido]` `credential_source` invisível até o F1; pós-fix, destaque quando `platform_env_key`. (5) Dois eixos, dois selos: runtime × regulatório (roxo). (6) Badges de modo com consequência: `dev/test` → "enforcement de matriz desligado (observe)"; `pilot` → "matriz relaxada; não bloqueia por matriz"; `starter`+produção → "único tier com bloqueio de matriz vivo (D)". (7) EC-6 nunca verde em `pending`. (8) Linguagem por persona SEM mudar o fato: o DPO vê "dados pessoais detectados e encaminhados", o auditor vê "dlp:cpf:pii_strong → ask → encaminhado" — mesmos dados, camadas de detalhe diferentes, mesma verdade.

**O que um agente implementa a partir daqui:** tokens CSS + os componentes-base como pacote interno de `apps/ui`, com `lib/honesty.ts` + `lib/vocab.ts` puros e **testados table-driven ANTES da primeira tela**; um teste de build faz grep por vocabulário proibido ("redigido", "protegido", "certificado") no bundle.
# Capítulo 8 — Dashboards, indicadores e relatórios

## 8.1 O cockpit de evidência, indicador a indicador (fonte única: `GET /v1/evidence/summary`)

Rótulos canônicos: `EC_LABELS` (`evidence-reports.ts:26-34` `[confirmado na fonte]`). Layout: anel de coverage + tiles por invariante + as ressalvas como CONTEÚDO de primeira classe (nunca asterisco).

| Indicador (rótulo canônico) | O que mede `[confirmado na fonte]` | Visualização | Drill-down |
|---|---|---|---|
| **coverage_ratio** | `Σcovered/Σtotal` sobre os invariantes OBSERVÁVEIS, com **paridade coverage↔gaps** (o não-coberto de cada termo = exatamente a população do `/gaps` daquele invariante — `evidence-reports.ts:519-536`) | anel + número 28px + `terms[]` E `excluded[]` (com razão) SEMPRE visíveis | clicar num termo → `/evidence/gaps/<invariant>` |
| **EC-1 — terminal-state** | capturas do outbox na janela: total/sealed/failed/stalled_past_slo (estagnada além de T_seal) | tile com sub-badges `failed` (vermelho) e `stalled` (âmbar); verde só com ambos zero | lista com status, attempts, `last_error` sanitizado, captured_at |
| **EC-2 — seal coverage** (rótulo canônico; semântica: contiguidade de `capture_seq` por cadeia) | cadeia com buraco iff contagem-na-janela ≠ (maxseq−minseq+1) (`evidence-reports.ts:102-120`) | "N cadeias, M com lacuna" | `Ec2GapRow{chain_id, first_gap_seq, gap_count}` — **bigint como string, NUNCA `Number()`** |
| **EC-3 — native (seal)** | capturas nativas (cadeia `run`) não seladas além do SLO | tile com o count | lista mais-antiga-primeiro |
| **EC-3 — native (drop)** | proxy de perda do path-B; a rota fixa snapshot ZERO — "**a agregação autoritativa é o coletor OTLP**" (`ZERO_DROP_SNAPSHOT` `evidence-reports.ts:411`; `evidence.ts:139-144`) | tile SEM número verde: `observed:false` + o `bound` textual (agrega, não isola streams-sem-terminal; cobre recebido-e-perdido, não nunca-emitido — `:422-433`) | singleton agregado na página 0 (ficha, não lista) |
| **EC-4 — run-lifecycle / path-A** | invocações sem evento terminal `run.*` (view `evidence_provider_without_audit`, migração `0027`) — "esperado: 0" | tile baseline-explícito; >0 é âmbar | run_id, provider, native_endpoint, status_code, error_class |
| **EC-6 — chain integrity** | **sempre `pending` neste build** — não há verificação persistida; a resposta carrega a `note` explicando (`:466-496`) | tile âmbar-outline com a `note` VERBATIM; **nunca verde**; excluído do ratio com razão exibida | sem drill-down (fora do enum de `/gaps`); CTA honesto "verificação sob demanda: ainda não disponível" → EP-V1 |
| (EC-5 — stream-terminal) | **DEFERIDO** (`evidence-reports.ts:16-21`) | não aparece como tile; nota no rodapé do cockpit | — |

## 8.2 Os dashboards por área

- **Workroom**: fila de aprovações agrupada por status efetivo (pending com contagem regressiva; granted-não-consumida; consumida com `consumed_run_id`; denied/revoked/expired — a MESMA semântica read-time do backend); runs por status + `mode_relation`; contadores "desta página" (sem rota de agregação — honesto).
- **Regulatório**: workflows como linha do tempo de estados; selo roxo permanente.
- **Review Queue (N2)**: aging da fila, tempo-até-decisão, decisões por revisor — nasce com a feature.
- **Crosswalk (N5)**: a matriz é o dashboard — % COVERED por framework, com a regra de claims no título ("prova de cobertura técnica; não certificação").
- **Operador**: **Grafana** (stack `infra/docker-compose.observability.yml` + `infra/otel/collector-config.yaml` + `infra/grafana/` + `infra/prometheus/prometheus.yml` `[confirmado na fonte]`), sobre os 8 gauges `govai_evidence_*` (`evidence-metrics.ts:28-35`) e os contadores `govai_audit_bridge_{drops,captures}_total` (`audit-bridge-metrics.ts:21-22`). O produto de tenant NÃO o reproduz (D3).

## 8.3 Relatórios — hoje e no alvo

**Hoje `[confirmado na fonte]`**: NENHUMA rota de relatório/dossiê (`DOCUMENTED_TARGET_ONLY` no SoT). **Degrau 0 (sem backend):** a primitiva universal **"Exportar esta consulta (JSON)"** em toda tabela/cockpit — serializa exatamente o que a API devolveu + params + timestamp + org_id + SHA do build: um "recorte de evidência" honesto. **Degrau 1 (EP-N3):** o Evidence Package. **Regra:** nenhuma tela chamada "Dossiê/Relatório de conformidade" até existir rota nativa.

**Relatórios por persona (alvo, sobre N3 + EP-B6):**
- **DPO — Relatório LGPD**: janela → detecções por detector (com a ressalva F6 até o fix) → decisões → encaminhamentos → itens de revisão → export com hashes. Linguagem: "dados pessoais detectados/encaminhados", NUNCA "violação LGPD" (claims §5).
- **CISO — Export SIEM**: fluxo contínuo (N4), não relatório — eventos normalizados com proveniência.
- **Jurídico — Pacote por caso**: N3 (timeline + decisões + hashes + instruções de verificação).
- **Auditor — Recorte de completude**: cockpit + gaps + cadeia exportados juntos com a janela pinada.

## 8.4 O AI Usage Ledger `[NOVO — proposto, consolidação]`

"Quem usou IA, quando, com que risco, a que custo" — o livro-razão do Owner/CISO. **Hoje os ingredientes existem espalhados**: `provider_invocations` (path-A, com tokens/latência — `run-orchestrator.ts:715+`), eventos v4 (path-B, com latency/status/risco — mas capture hash-only), `workroom_runs`. **O ledger é a VISTA unificada** — depende do EP-B6 (feed por-request) e de decisão de retenção; ADR-012 (cost attribution) é o ancestral doutrinário. Não prometer na UI antes do EP.

**O que um agente implementa a partir daqui:** o cockpit (tiles + anel + ressalvas como conteúdo), as 5 vistas de `/gaps` com os shapes exatos, e "Exportar esta consulta (JSON)" no DataTable — nesta ordem; dashboards novos só nascem com o EP da sua área.

---
---

# PARTE IV — EXECUÇÃO, TESTES, OPERAÇÃO

# Capítulo 9 — O roadmap de execução (agora → alvo)

## 9.1 O princípio de ordenação

(1) Corrigir o que mente (F1–F6) antes de exibir; (2) entregar valor onde o backend JÁ está pronto (U1 cockpit — zero EP novo); (3) EPs pequenos antes de telas que dependem deles; (4) features novas na ordem que converte a tese em produto vendável (Review Queue e Policy Studio primeiro — são o "ask real" e o "standalone real"); (5) kernel/enforcement de runtime quando houver consumidor.

## 9.2 As fases (alinhadas a Foundation Release → R2 → R3 da master-arch + U1→U4 da série)

| Fase | Conteúdo | Critério de saída | Mapeia a |
|---|---|---|---|
| **F0 — Verdade** | fixes F1–F6 + reconciliação documental (a lista de 10 itens da revisão da série: README/playbook/SoT/filosofia rotulada TARGET/doc "enforcement e DLP — comportamento atual") | eventos não mentem; docs não contradizem o código | pré-condição da Foundation |
| **F1 — Fundação de consumo** | EP-B1 (rate limit) + EP-B2 (whoami) + EP-B7 fase 1 (contrato de evidence/audit/capabilities) + **U1 cockpit** | colar-chave → cockpit real com ressalvas renderizadas; gates verdes; deploy estático atrás do proxy | **Cockpit Alpha** da Foundation Release (master-arch §6.2) |
| **F2 — Interativo** | EP-B4 (participantes) + **U2 workrooms** (fluxo F3 com SoD completo) + decisão D1 → EP-B5 (transcript) + EP-B3 (JWT) antes do 2º usuário | override aprovado ponta-a-ponta na UI; banner audit_only não-dismissível | Workroom da Foundation |
| **F3 — Volume** | **U3 regulatório** (template ×17 + workflows + simulador) + EP-B7 fase 2 (schemas regulatórios) | 17 recursos navegáveis por UM template dirigido a config | — |
| **F4 — Operações** | **U4 admin/playground** + EP-V1 (verificação EC-6) | credencial set/revoke com consequência; "verificar cadeia agora" | — |
| **F5 — O "ask" real** | **N2 Review Queue** (modo pós-hoc primeiro; retenção como opt-in depois — D7) | risco C cria item; decisão entra na cadeia; UI da fila | "proportional friction" vira produto |
| **F6 — Standalone real** | **N1 Policy Studio** (DLP CRUD + effective + simulate; superfície de operador com trilha) + EP-RT-BRIDGE (1ª classe não-baseline policy-bound) | tenant configura política sem SQL; claim "standalone" desbloqueado (claims §1.5) | **DLP RT-bridge** da Foundation |
| **F7 — Evidência vendável** | **N3 Evidence Package** + EP-B6 (feed) + AI Usage Ledger | pacote por caso exportável e verificável | **Reporting v1** da Foundation |
| **F8 — Integrada** | **N4 Connectors** (export SIEM primeiro; ingestão depois) + **N5 Crosswalk** | primeiro destino SIEM vivo; matriz LGPD com células ancoradas em evidência | **R2** (connector SDK v0) |
| **F9 — Enforcement & grau de evidência** | EP-KERNEL (com o 3º consumidor) + Fase 5 do roadmap (runtime enforcement: DENIED bloqueia, com testes) + EP-ANCHOR (TSA/Merkle; ICP-Brasil em R3) + Shadow AI alpha | "a denied determination actually blocks the runtime path, with tests" | **R2/R3** |

Deliverables da Foundation Release já ENTREGUES antes deste plano `[confirmado na fonte]`: AWS KMS adapter (+fail-closed), Audit Bridge + outbox + sealer (as 5 superfícies persistem evidência), streaming/tools no harness real. Pendentes da Foundation: Cockpit Alpha (F1), DLP RT-bridge (F6), Reporting v1 (F7), rate-limit distribuído (EP-B1/Redis), README/status update (F0).

## 9.3 A matriz Build / Integrate / Partner / Defer (por capacidade)

Regra de decisão (master-arch §5 + `19-build-vs-integrate-strategy.md` `[confirmado na fonte]`): **DESENVOLVER quando preserva a diferenciação trust/evidência/kernel; INTEGRAR quando é infraestrutura madura ou sistema-de-registro do cliente.**

| DESENVOLVER (núcleo defensável) | INTEGRAR (commodity/maduro) | PARCEIRIZAR | ADIAR |
|---|---|---|---|
| gateway de governança runtime multi-provider · Evidence Plane/AuditBridge/outbox/sealer · motor de política/risco · evidência→compliance (crosswalk) · AI Usage Ledger · isolamento multi-tenant (RLS/INV-1) · APIs governadas provider-native · Workroom · DLP-BR (CPF/CNPJ/sigilo + SD1) · dashboard/cockpit mínimo · Review Queue · Policy Studio · Evidence Package | modelos (OpenAI/Anthropic/Azure/Bedrock/Vertex) · content-safety genérico (Bedrock Guardrails/Azure Content Safety/Model Armor) · DLP corporativo amplo (Purview/Netskope/BigID/Securiti) · SIEM (Sentinel/Splunk/Elastic/Datadog) · KMS/secrets (AWS já feito; GCP/Azure/Vault) · observabilidade (OTel/Prometheus/Grafana — já adotado) · GRC pesado (ServiceNow/OneTrust/Archer) · identity/SSO (Entra/Okta/Google) · BI avançado (Power BI/Looker/Tableau) | policy packs jurídicos (escritórios) · financeiro (consultoria Bacen) · saúde (CFM/ANS) · setor público · packs ISO/NIST/EU-AI-Act (consultorias GRC) | treinar LLM próprio · criar SIEM/DLP/GRC/BI/IAM próprios · parecer jurídico automático |

Framings proibidos pelo doc em-repo (`:168-177` `[da série]`): posicionar ferramenta externa como pré-requisito do produto; o cockpit de tenant NUNCA vira BI plugado no banco (a fronteira de tenancy vive na API).

## 9.4 Os pacotes comerciais como contexto de priorização (deployment models — master-arch §14)

| Pacote | Modelo de deploy | O que o roadmap tem que entregar |
|---|---|---|
| **Standalone** (Starter/Business) | SaaS pooled com RLS FORCE, KMS gerenciado | F1+F5+F6 (cockpit + review + policy studio) — o produto que se opera sozinho |
| **Enterprise Evidence Layer** | pooled ou célula dedicada; KMS do tenant opcional | F7+F8 (packages + connectors/SIEM + crosswalk) — a camada de evidência sobre o stack existente |
| **Regulated** | célula dedicada; BYOK recomendado/exigido; postura de evidência mais estrita | F9 (anchoring TSA/ICP-Brasil; enforcement de runtime; postura strict) |
| **Workroom** | módulo em qualquer pacote | F2 (console) + extensões (transcript-read D1; multi-agente futuro) |

**O que um agente implementa a partir daqui:** a fase corrente do topo para baixo; NUNCA pular o critério de saída de uma fase; toda entrega re-ancora a tabela 13.1 e o SoT.

# Capítulo 10 — O plano de testes

## 10.1 O harness existente `[confirmado na fonte]`

- **Vitest** com gate real de integração: `tests/integration/**` só entra no `include` com `GOVAI_INTEGRATION=1` (`vitest.config.ts:17`); coverage thresholds **80/80** lines/branches (`:63-65`).
- **CI em dois jobs**: `unit` (rápido, todo push/PR — `.github/workflows/ci.yml:11`) e `integration` (Postgres de serviço + `GOVAI_INTEGRATION=1` — `:54`). Branch protection: decisão do dono foi NÃO ativar (registro do projeto) — a segurança do merge é processual (dois leitores + bot + dual-verify).
- **176 arquivos de teste** no disco; a suíte integração usa docker/colima local (runbooks em `docs/runbooks/`). Node 24 obrigatório (re2 ABI).

## 10.2 O que testar, priorizado

**P0 — o vocabulário de honestidade (o teste mais importante do produto):** table-driven sobre `enforcementLabel`: para TODA entrada sem 403 o rótulo contém "encaminhado" e NUNCA "bloqueado/aplicado/retido"; para 403, "Bloqueado (403)" com a origem; passthrough sempre "observado". EC-6 `pending` nunca verde; `note` verbatim; `excluded[]` no DOM. Nenhum componente renderiza `credential_source` com a flag desligada; grep de build por vocabulário proibido até F5.

**P0 — o data-layer:** os 3 adaptadores de cursor (keyset/composto/offset; `ec3drop` nunca pagina); **bigint como string** (um valor > 2^53 renderiza dígito a dígito; `Number()` no caminho quebra o teste); 401 derruba sessão; 404 copy cross-tenant; 409 refetch; 429 backoff.

**P1 — autorização na UI:** nav por roles (whoami mockado); SoD (requester vê "Decidir" desabilitado COM explicação); um 403 real em botão habilitado é bug de gating e FALHA o teste.

**P1 — fluxos e2e (Playwright contra a stack local):** F3 completo (pedir→decidir com outra identidade→consumir→`consumed_run_id`), F1 (cockpit→gap→cadeia com 1 falha semeada), credencial NUNCA ecoada no DOM pós-submit.

**P0 backend (por EP novo, DoD):** todo EP nasce com unit + integração (RLS: cross-tenant 404; role-gate; evento de auditoria emitido) + linha no contrato; os EPs N1/N2 herdam a suíte de semântica de aprovação (SoD/expiry/one-time) como spec executável.

**P2:** estados vazios honestos; export JSON com params; datas/hex; a11y (Radix ajuda).

## 10.3 O encaixe no pipeline

Job `ui` novo ao lado de `unit`/`integration` (`pnpm --filter @govai/ui typecheck && lint && test && build`); `ui-e2e` como job separado que sobe a stack como o `integration` faz; `@govai/api-contract` no typecheck global — mudar rota sem atualizar contrato quebra o MESMO PR. Gates locais idênticos (Node 24).

**O que um agente implementa a partir daqui:** os testes P0 ANTES das telas; o job `ui` no PR do bootstrap; fixtures versionadas das 4 rotas de U1.
# Capítulo 11 — Manutenção, operação e observação

## 11.1 Deploy (o padrão já estabelecido + o que a UI adiciona)

- **API**: Fastify em `API_HOST:API_PORT` (default `0.0.0.0:8080` — `config/src/index.ts:27-28`); boot fail-closed em produção (DevKMS/KMS_DEV_SEED → BootError `:109-118`; probe KMS no boot `server.ts:61-68`; `DATABASE_URL` obrigatório `:56-58`).
- **Sealer**: o padrão de deployable do repo `[confirmado na fonte]` — bundle esbuild autossuficiente (`apps/audit-sealer/package.json:9`), Docker multi-stage rodando `node dist/bundle.mjs` (NUNCA tsx — o monorepo é TS-source-only; `Dockerfile:5-9`), serviço no compose com profile (`infra/docker-compose.yml:38`), env própria (`AUDIT_SEALER_DATABASE_URL` + `AUDIT_SEALER_ENUMERATOR_DATABASE_URL` runtime — `config.ts:85-86`), readiness que NUNCA fica saudável às cegas (descoberta de orgs falhou → `org_discovery_failed`).
- **UI**: `vite build` → estático; topologia recomendada same-origin atrás do reverse proxy (`/app/*` → dist; `/v1/*`, `/governed/*`, `/passthrough/*`, `/health` → Fastify) — CORS nem entra em cena e o cookie httpOnly do EP-B3 fica trivial `[recomendação]`; alternativa: origem própria com o CORS existente. Empacotamento: imagem nginx/caddy servindo dist, no padrão do sealer.
- **Observabilidade**: stack local pronto (`infra/docker-compose.observability.yml`: otel-collector + prometheus + grafana; config do coletor em `infra/otel/collector-config.yaml`); a API exporta quando `OTEL_EXPORTER_OTLP_ENDPOINT` está setado (gate duplo dos gauges: + `GOVAI_EVIDENCE_ENUMERATOR_URL` — `server.ts:126`). ⚠ Apple Silicon: coletor pinado 0.119.0 (o 0.116.0 arm64 é quebrado — registro do projeto).

## 11.2 A amarra de contrato e a coordenação com os fixes

- **`@govai/api-contract` (EP-B7)** é a amarra: rota valida com os schemas do pacote, a UI tipa com eles; mudança de rota sem contrato quebra typecheck no MESMO PR. A UI nunca "adivinha" campo.
- **Campos sob fix**: nascem no pacote como opcionais com comentário `pending-fix` + flag `contractFixed.*` no cliente; ligar o campo = apagar a flag, não reescrever telas. Durante a construção da UI, a fase de correção F1–F6 corre em paralelo — o ponto de sincronização é o pacote de contrato, não avisos verbais.
- **Docs**: cada fase re-gera o trio de continuidade (current-state/roadmap/stale-register) — a revisão documental da série é o gabarito do que corrigir primeiro.

## 11.3 Operar e observar

- A UI é estática e sem estado — opera-se o backend. Sinal de saúde no shell via `GET /health` (`{status:'ok'}`) com a ressalva F3 (hoje é estático; quando a readiness real existir, apontar para ela).
- **Operador**: Grafana sobre `govai_evidence_*` (8 gauges — EC-1..EC-6+coverage por `org_hash`) + `govai_audit_bridge_{drops,captures}_total` + as métricas do sealer. O runbook local é `docs/runbooks/observability-local.md` `[confirmado na fonte — arquivo listado]`; produção do coletor é item aberto de F8/F9.
- **Runbooks existentes** (`docs/runbooks/`): `observability-local`, `user-e2e-local`, `kms-production`, `db-roles-production`, `planned-capability-guard`, `canonical-reconstruction-fallback` — cada EP operacional novo adiciona o seu.
- Sem telemetria de terceiros na UI (produto de conformidade); rodapé com SHA do build + org_id — o carimbo de qualquer screenshot de auditoria.
- **Versão**: UI em lockstep com o monorepo (mesmo commit API+UI); rollback = apontar o build anterior.

**O que um agente implementa a partir daqui:** `vite.config.ts` com `base:'/app/'`; exemplo de config do reverse proxy em `infra/`; job de build publicando o dist; rodapé com SHA+org.

# Capítulo 12 — Decisões em aberto e riscos

## 12.1 As decisões do dono (cada uma muda o desenho de algo)

| # | Decisão | Contexto | Recomendação `[recomendação]` |
|---|---|---|---|
| D1 | **Leitura de transcript** — decrypt-read ou metadado-only? | hoje impossível por construção; muda a tela principal da sala | decrypt-read por participação ativa (+auditor com evento de acesso selado), EP-B5 em F2-fase-2 |
| D2 | **Sessão JWT vs. chave-no-browser** | chave em memória é aceitável para o dono-único | EP-B3 antes de QUALQUER segundo usuário humano |
| D3 | **Operador no produto ou no Grafana** | cockpit cross-org não tem rota HTTP por desenho (INV-1) | manter Grafana; EP-B8 só se o dono quiser UMA superfície — e como app/rota separada |
| D4 | **Feed por-request** — persistir a projeção legível do capture? | decisão de plano de evidência (retenção/PII/tamanho), não de UI; destrava "Atividade" + Ledger | decidir depois de U2 com dado real de uso do cockpit |
| D5 | **Shape do whoami** | incluir `user_id`? | `{org_id, roles, tier, operational_mode, api_key_prefix}` — sem user_id até haver gestão de usuários |
| D6 | **Ordem das 5 features novas** | o Cap. 9 propõe N2→N1→N3→N4→N5 | manter: Review Queue e Policy Studio são a tese virando produto; connectors/crosswalk vendem melhor COM evidência exportável (N3) pronta |
| D7 | **Semântica do "ask" na Review Queue** — pós-hoc ou retenção? | retenção muda o SLA do caminho governado (master-arch §10: approval = human workflow, sem promessa de latência) | pós-hoc primeiro; retenção como opt-in por org |
| D8 | **Proveniência do ADP** — v3 externo vs v4.2 interno | `source-spec.md` aponta o v3 EXTERNO como fonte exclusiva; `docs/architecture/canonical/` contém um v4.2 INTERNO; qual governa não está declarado `[da série]` | declarar o v4.2 interno como canônico e aposentar a referência externa |
| D9 | **Versionar a doutrina no repo** (a nota de proveniência deste doc) | master-arch/ADR-016/017/018/claims-policy estão FORA do controle de versão; 3 referências no código apontam para eles | promover ao repo (o próprio master-arch §17 define a regra de promoção); resolve as referências quebradas |
| D10 | **Identidade de provedor** (ADR-019, não escrito) | hoje Anthropic/OpenAI hardcoded; o 3º provedor força a decisão | escrever ADR-019 antes do 3º provedor OU do kernel (o que vier primeiro) |
| D11 | **Posição comercial EU AI Act** para multinacionais Brasil | master-arch §15 | fora do escopo técnico; gate de claims aplica |

## 12.2 Riscos e mitigações

| # | Risco | Mitigação |
|---|---|---|
| R1 | Rate limit global 100/min derruba a própria UI | EP-B1 pré-U1-produção; cache agressivo; hub regulatório sem contagens |
| R2 | Enunciar redação/proteção de PII antes do F5 | grep de vocabulário proibido no build; claims §1.5 |
| R3 | Volume do regulatório (17×2 telas) estourar U3 | UM ResourceTemplate dirigido por config gerada dos schemas |
| R4 | Divergência de contrato (UI adivinhando shape) | EP-B7 + typecheck no mesmo PR; até lá, tipos espelhados num único diretório |
| R5 | Chave no browser | memória-apenas; aviso; D2/EP-B3 no 1º multiusuário |
| R6 | Gating de UI errado (botão que o backend nega) | dois eixos modelados; testes P1; 403-em-botão-habilitado = falha de teste |
| R7 | Má leitura dos indicadores (EC-6 "verde", drop "zero") | ressalvas como conteúdo de 1ª classe, testadas |
| R8 | `Number()` num bigint | format.ts sem conversão; teste P0 com valor > 2^53 |
| R9 | Fix F1/F2 atrasar e a UI ligar campos mentirosos | flags `contractFixed.*`; campos nascem desligados |
| R10 | **Policy Studio como arma** — tenant relaxando a própria governança | mutação de modo/tier NUNCA no tenant (Q4); hard-deny floor imutável na UI; toda mutação com evento selado; simulador antes de aplicar |
| R11 | **Review Queue com retenção** virando gargalo/SLA quebrado | começar pós-hoc (D7); retenção opt-in com limite e expiry |
| R12 | **Crosswalk lido como certificação** | status NEEDS_SOURCE_VERIFICATION como default honesto; claims §1.5 no título da tela; célula sempre ancorada na query de evidência |
| R13 | **Conector ingerindo lixo/PII** | metadata-first; proveniência explícita; ingerido nunca sobrepõe primária; threat model antes da ingestão (export primeiro) |
| R14 | Doutrina fora do repo divergir do produto (D9) | versionar; até lá, este documento é o snapshot citável |

**O que um agente implementa a partir daqui:** nada — capítulo do dono; o agente respeita os defaults recomendados até decisão em contrário.

---
---

# PARTE V — ANEXOS

# Capítulo 13 — Anexos acionáveis

## 13.1-A A tabela de rotas — núcleo (31 superfícies + health; status: todas existem)

A tabela completa com auth/paginação/notas está no Cap. 3.7 (mesmas âncoras). Sumário posicional: `health.ts:4` · `capabilities.ts:10` · `runs.ts:29` · `audit-events.ts:14` · `evidence.ts:56,98` · `admin-provider-credentials.ts:105,226,346` · `admin-dlp.ts:21` (501) · `admin-audit-shred.ts:22` (501) · `workrooms.ts:179,373,443,504,704` · `workroom-transcript.ts:169,376,554,679` · `workroom-runs.ts:232,468` · `workroom-approvals.ts:249,444,557,661,901` · governed `register-governed.ts:69` (anthropic), `:129,:174` (openai) · passthrough `register-passthrough.ts:174` (anthropic), `:178` (openai).

## 13.1-B A tabela de rotas — regulatório (108 operações / 60 caminhos; linhas re-derivadas nesta sessão em `apps/api/src/routes/regulatory.ts`)

| Recurso | Operações (método:linha) |
|---|---|
| sources | GET:1153 · POST:1184 · GET/:id:1203 · PATCH/:id:1226 · POST/:id/versions:1248 · GET/:id/versions:1273 · POST/:id/relationships:1296 |
| controls | GET:1325 · POST:1356 · GET/:id:1375 · PATCH/:id:1398 · POST/:id/source-links:1420 · GET/:id/source-links:1448 · POST/:id/framework-mappings:1474 · GET/:id/framework-mappings:1502 |
| ai-systems | GET:1540 · POST:1569 · GET/:id:1588 · PATCH/:id:1611 |
| providers | GET:1637 · POST:1669 · GET/:id:1688 · PATCH/:id:1711 |
| models (+versions) | GET:1737 · POST:1767 · GET/:id:1786 · PATCH/:id:1809 · POST/:id/versions:1833 · GET/:id/versions:1856 · GET model-versions/:versionId:1884 · PATCH model-versions/:versionId:1907 |
| ai-system-model-links | GET:1931 · POST:1964 · GET/:id:1983 · PATCH/:id:2006 |
| agents (+versions) | GET:2032 · POST:2065 · GET/:id:2084 · PATCH/:id:2107 · POST/:id/versions:2131 · GET/:id/versions:2154 · GET agent-versions/:versionId:2182 · PATCH agent-versions/:versionId:2205 |
| agent-capability-bindings | GET:2229 · POST:2265 · GET/:id:2284 · PATCH/:id:2307 |
| use-cases (+asset-links +reviews) | GET:2335 · POST:2367 · GET/:id:2386 · PATCH/:id:2409 · GET use-case-asset-links:2433 · POST:2470 · GET/:id:2489 · PATCH/:id:2512 · POST/:id/reviews:2536 · GET/:id/reviews:2559 · GET use-case-reviews/:reviewId:2594 · PATCH use-case-reviews/:reviewId:2617 |
| risk-methods | POST:2641 · GET:2660 · GET/:id:2688 · PATCH/:id:2711 |
| risk-classifications (+factors) | **POST evaluate:2737 (puro, sem persistência)** · POST:2755 · GET:2777 · GET/:id:2820 · PATCH/:id:2843 · GET/:id/factors:2865 · GET risk-classification-factors:2901 · GET/:id:2933 |
| reclassification-triggers | POST:2958 · GET:2977 · GET/:id:3012 · PATCH/:id:3035 |
| high-risk-reviews (workflow) | POST:3067 · GET:3086 · GET/:id:3122 · PATCH/:id:3145 · POST/:id/submit:3169 · POST/:id/cancel:3193 · POST/:id/evidence:3219 · GET/:id/evidence:3244 · GET high-risk-review-evidence/:id:3279 · PATCH:3304 · POST/:id/assignments:3330 · GET/:id/assignments:3355 · PATCH high-risk-review-assignments/:id:3391 · POST/:id/decisions:3417 · GET/:id/decisions:3445 · GET high-risk-review-decisions/:id:3481 |
| prohibited-use-policies | POST:3515 · GET:3534 · GET/:id:3565 · PATCH/:id:3588 |
| prohibited-use-cases (workflow) | POST:3614 · GET:3633 · GET/:id:3671 · PATCH/:id:3694 · POST/:id/submit:3718 · POST/:id/cancel:3742 · POST/:id/evidence:3768 · GET/:id/evidence:3793 · GET prohibited-use-evidence/:id:3828 · PATCH:3853 · POST/:id/determinations:3879 · GET/:id/determinations:3907 · GET prohibited-use-determinations/:id:3944 |

## 13.2 O glossário do domínio

- **Os 7 planos**: 1 Native/Data · 2 Governance Kernel/Policy · 3 Evidence · 4 Identity/Secrets/KMS · 5 Integration/Shadow-AI · 6 Regulatory Intelligence/Update · 7 Cockpit/Workroom/Reporting (ADR-018 `[fora do repo]`).
- **Path-A / Path-B**: `/v1/runs` (orquestrador transacional; persiste `provider_invocations`+`policy_decisions`) / `/governed/*`+`/passthrough/*` (proxy nativo; evidência via AuditBridge→outbox→sealer).
- **Invariantes EC-\*** (rótulos canônicos `evidence-reports.ts:26-34`): EC-1 terminal-state · EC-2 seal coverage (contiguidade de `capture_seq`) · EC-3 native seal/drop · EC-4 run-lifecycle path-A ("expected empty") · EC-5 stream-terminal (**deferido**) · EC-6 chain integrity (**sempre `pending`** neste build) · coverage_ratio (conjunção com paridade coverage↔gaps).
- **`enforcement_decision`**: `observe|warn|ask|enforce|sandbox_required|blocked`; só `blocked`/`tool_blocked` produzem 403 (Cap. 3.4). **`block_reason` de validação**: `typed_unknown|capability_planned|capability_blocked_via_token|hard_denied_beta`.
- **Classes de risco A..E**: base das governadas é sempre A; escalações: PII forte A→C/B→C/C→D, PII padrão A→B, ferramenta até a classe contribuída (bash=D), multipart B→C.
- **`capability_level`**: `policy_governed` (resolve a matriz) vs `passthrough_audited` (observa e audita; nunca aplica). `capability_canonical_level` = o valor do registry, distinto do modo operacional da rota.
- **Workroom**: `governance_mode ∈ governance_active|audit_only`; `mode_relation ∈ defaulted|explicit|upgrade|override_approved|override_denied`; papéis NA SALA `human_owner|human_approver`; 11 `artifact_kind`s (`prompt, agent_response, auditor_finding, external_artifact, human_approval, merge_decision, file_diff, commit, pr, ci_run, tool_invocation_result`).
- **Status**: run `queued|running|completed|failed|denied|awaiting_approval`; aprovação `pending|granted|denied|expired|revoked` (expiry avaliado em leitura); captura `captured|sealing|sealed|failed`; credencial `active|revoked`.
- **Evento v4**: `body_forward_mode ∈ raw|redacted|blocked` (`redacted` reservado — F5); `stream_outcome ∈ complete|upstream_error|client_disconnect`; `credential_source` `[contrato corrigido]` alvo `tenant_provider_credential|platform_env_key|hermetic_placeholder|none`; `chain_category ∈ auth|run|policy|admin`.
- **DLP**: baseline `cpf, cnpj` (pii_strong) / `email, phone_br` (pii_standard); ações configuráveis path-A `detect|redact|deny`; SD1 = camada rica advisory (segredos, CNJ, financeiro, saúde; `match_hash`+preview redigido); proveniência = primária/ingerida/derivada/declarativa.
- **Tiers/modos**: `starter|business|enterprise|regulated` × `production|pilot|dev|test` — plano de controle do OPERADOR.
- **Claims states**: `planned|foundational|partial|supported|deprecated` (claims-policy `[fora do repo]`); taxonomia do SoT: `IMPLEMENTED_RUNTIME_SOURCE_AND_TEST_VERIFIED`, `IMPLEMENTED_FOUNDATIONAL_CONTROL_…`, `DOCUMENTED_TARGET_ONLY`.
- **Personas**: DPO · CISO · Jurídico/Compliance · Auditor · Owner/gestor · Operador · Desenvolvedor (mapa role→persona no Cap. 1.4).
- **INV-1**: nenhuma identidade única de banco detém enumerar+ler; o cross-org do operador é acumulação de N leituras single-org.

## 13.3 Âncoras e convenções para um agente não adivinhar

- **Auth**: `x-govai-api-key: <chave>` OU `Authorization: Bearer <chave>`; 401 `{error:'auth_error'}`; cross-tenant 404.
- **Dados**: bigint→string decimal (NUNCA `Number()`); binário→hex; datas ISO-8601 UTC; envelope `{error, …}`.
- **Env (config `packages/config/src/index.ts`)**: `API_HOST:28`/`API_PORT:27` · `API_CORS_ORIGINS:29`/`API_CORS_CREDENTIALS:30` · `EVIDENCE_T_SEAL_SECONDS:53` (300) / `EVIDENCE_DEFAULT_WINDOW_SECONDS` (86400) · `GOVAI_KMS_PROVIDER:7` (+AWS `:13-15`) · `OTEL_EXPORTER_OTLP_ENDPOINT:42` · `GOVAI_EVIDENCE_ENUMERATOR_URL:24`. Sealer: `AUDIT_SEALER_DATABASE_URL` + `AUDIT_SEALER_ENUMERATOR_DATABASE_URL` + `AUDIT_SEALER_ORG_IDS` (override).
- **Arquivos-fonte de referência rápida**: matriz/resolvedor `packages/core-governance/src/{enforcement.ts, governed-native/resolve-governance.ts}` · registries `packages/provider-*/src/capabilities/index.ts` · classificador `packages/provider-anthropic/src/tool-classifier.ts` · handler governado `packages/provider-anthropic/src/governed/handle-messages.ts` · evento `packages/core-events/src/passthrough-invoked.ts` · cockpit `apps/api/src/pipeline/evidence-reports.ts` · bridge `apps/api/src/pipeline/audit-bridge.ts` · DLP `apps/api/src/pipeline/dlp.ts` + `packages/dlp-br/src/baseline-detectors.ts` · auth `apps/api/src/pipeline/auth.ts` · boot `apps/api/src/server.ts` · roles de DB `infra/postgres/bootstrap.sql` · migrações `apps/api/src/db/migrations/`.
- **Gotchas de ambiente** (registros do projeto): Node 24.15.0 obrigatório (re2 ABI); `command grep` no shell deste repo (grep é função que trava); coletor OTLP ≥0.119.0 em Apple Silicon.

## 13.4 Como regenerar as contagens (os comandos desta sessão)

```bash
# registros de rota (tolerante a generics — o grep sem [<(] ERRA):
grep -cE "app\.(get|post|put|patch|delete|all)\s*[<(]" apps/api/src/routes/*.ts
# a tabela por-linha:
grep -nE "app\.(get|post|put|patch|delete|all)\s*[<(]" apps/api/src/routes/*.ts
# caminhos regulatórios distintos:
grep -oE "'/v1/regulatory[^']*'" apps/api/src/routes/regulatory.ts | sort -u | wc -l
# provedores:
grep -nE "app\.(all|post)\s*[<(]" packages/provider-*/src/{governed/register-governed.ts,routes/register-passthrough.ts}
# migrações / testes:
ls apps/api/src/db/migrations/ | wc -l ; find . -name "*.test.ts" -not -path "*/node_modules/*" | wc -l
```

## 13.5 Proveniência dos documentos de doutrina (o registro)

No commit: `19-build-vs-integrate-strategy.md`, `current-state.md`, `development-roadmap.md`, `stale-docs-register.md`, `workroom-governance-room.md`, 23 ADRs (001–014, 020–028), runbooks. Fora do commit (doutrina do dono, 2026-05-27, lida nas cópias externas): master-architecture v0.9, ADR-016/017/018, claims-policy. Decisão D9 pendente.

---

## Fecho

Este é o plano-mestre da aplicação inteira em `f975533d`: **a visão** (a AI Trust Layer dos 7 planos, com "standalone" honestamente marcado como alvo), **o contrato real** (140 pontos de registro HTTP contados e ancorados; o vocabulário de enforcement verificado par a par — base sempre A no governado, PII forte teto C→ask, 403 real = validação de ferramenta + bash/D/starter + beta hard-denied; a assimetria de DLP entre os dois caminhos; o evento v4 e a captura hash-only), **o caminho** (F0 verdade → F1 cockpit → F2 workroom → F3 regulatório → F4 operações → F5 Review Queue → F6 Policy Studio → F7 Evidence Package → F8 Connectors/Crosswalk → F9 kernel/enforcement/anchoring), **as 5 features novas** especificadas com API-alvo e telas, **a matriz build/integrate**, e **a UI por persona** com o vocabulário de honestidade como artefato normativo. Os seis defeitos F1–F6 estão re-ancorados e tratados como contrato corrigido; a doutrina não-versionada está flagrada (D9); e cada capítulo termina no ponto exato onde uma futura sessão de IA pega o trabalho — sem adivinhar nada que este documento já ancore.

— Fim do plano-mestre (GOVAI-MASTER-PLAN-APPLICATION-FABLE5 @ `f975533d`, 2026-07-07).
