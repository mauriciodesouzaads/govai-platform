# GovAI Platform — Addendum ADP v4.2.2 — Macro Native Substrate

**Versão:** v4.2.2 (substitui v4.2.1)
**Data:** 2026-05-06
**Status:** canônico em conjunto com ADP v4.2. **Substitui** Addendum v4.2.1 integralmente.
**Hash do ADP v4.2 (base obrigatória):** `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254`
**Linhas do ADP v4.2:** 1881
**Hash do Addendum v4.2.1 (referência histórica, deprecado):** `b73fb55ae5c1c89556d6b896654e4ed897efcf2de95ea3c6afcbdea133dac242`
**Aplicabilidade:** PR2 e PRs subsequentes.

**Mudança conceitual em relação a v4.2.1:** "PR2 Minimum Native Gate" deixa de existir como conceito. É substituído por "PR2 Macro Native Substrate Contract". A virada não é cosmética. Reflete que **a base do produto nasce como arquitetura macro consolidada; a implementação pode ser dividida em batches por volume de código e testes, mas a arquitetura não pode ser dividida nem provisória nem capada**.

---

## Sumário

1. Status, relação com ADP v4.2 e supersedimento de v4.2.1
2. Decisão canônica A0 — Macro nasce como arquitetura; batches dividem execução
3. Decisão canônica A1 — Claude Code local client × Agent SDK server-side
4. Decisão canônica A2 — PR2 redefinido como Native Provider Substrate
5. Decisão canônica A3 — Deep governance incremental; native availability não capada
6. PR2 Macro Native Substrate Contract
7. Batches do PR2 — divisão de execução, não de arquitetura
8. `org_beta_overrides` — contrato e schema
9. Claude Code compatibility tests obrigatórios
10. Agent-probe — gate de instalação do Agent SDK
11. Agent Runtime Connector — categoria futura
12. Positioning calibration
13. Forward-compat — regra de não-refatoração futura
14. Human Architect Escalation — quando algo essencial é tecnicamente impossível
15. Critério de aceitação do Addendum
16. Não-objetivos do Addendum
17. Próximo passo
18. Changelog v4.2.2 vs v4.2.1

---

## 1. Status, relação com ADP v4.2 e supersedimento de v4.2.1

Este Addendum **não reabre** decisões pinadas em ADP v4.2. Ele:

- esclarece a aplicação de v4.2 §13 (Native Provider Experience), §14 (Agentic Safety) e §21 (Roadmap);
- restringe interpretações ambíguas de "passthrough_audited" e "PR2 escopo";
- adiciona contratos faltantes (`org_beta_overrides`, agent-probe gate, Agent Runtime Connector, Human Architect Escalation);
- fixa o **PR2 Macro Native Substrate Contract** como condição arquitetural e de merge.

Tudo o que não for tocado neste Addendum permanece como em v4.2. Em caso de conflito interpretativo entre v4.2 e v4.2.2, prevalece v4.2.2 estritamente nas seções enumeradas acima; tudo mais segue v4.2.

Este Addendum **não introduz novas tabelas além das já previstas em ADP v4.2 §8, exceto `org_beta_overrides`**, definida explicitamente no §8 deste Addendum como extensão necessária para o PR2 Native Provider Substrate. Nenhum outro objeto de schema novo é introduzido.

Este Addendum **não** introduz: rotas novas além das já implícitas em v4.2 §13/§21; capabilities novas no registry além das já mapeadas em v4.2 §12; nova classe de risco além das v4.2 §14.1; novo enforcement mode além dos já fixados (§5 deste Addendum).

**Supersedimento.** Addendum v4.2.1 é substituído integralmente por v4.2.2. Onde v4.2.1 dizia "Minimum Native Gate", lê-se "Macro Native Substrate Contract". A v4.2.1 fica como referência histórica (hash acima) e não deve ser citada em prompts de execução.

---

## 2. Decisão canônica A0 — Macro nasce como arquitetura; batches dividem execução

Esta é a decisão de mais alto nível deste Addendum. Todas as demais derivam dela.

### 2.1 Princípio

> O macro nasce como arquitetura. A implementação pode ser dividida em batches por volume de código e testes, mas a base não pode ser micro, provisória ou capada.

### 2.2 Reformulação operacional

> **Podemos dividir a execução. Não podemos dividir a arquitetura.**

### 2.3 Consequências práticas

- **Capability registry** em PR2 representa a superfície macro real do produto, não o subconjunto profundo do PR2. Capabilities essenciais para Anthropic e OpenAI aparecem no registry com `status` e `level` honestos (`supported`, `passthrough_audited`, `policy_governed`, etc.); apenas capabilities fora do escopo macro do produto aparecem como `not_exposed`.
- **Provider Coverage Matrix** em PR2 representa o universo Anthropic + OpenAI, com diferenciação clara entre "implementado em PR2", "planejado em PR concreto", "out of scope do produto".
- **Schema de dados** em PR2 contempla as estruturas necessárias para sustentar PR3-PR8 sem refatoração destrutiva: `organizations.tier`, `organizations.operational_mode`, `tenant_capability_acceptance` com `base_risk_class_at_acceptance` e `max_effective_risk_class_allowed`, audit chain, `org_beta_overrides`. Não criar coluna ou tabela que se sabe descartável depois.
- **Contratos de rota** em PR2 são os contratos finais. Não se cria endpoint provisório com semântica destinada a ser substituída em PR3-PR8.
- **Batches A/B/C/D** existem para organizar volume de código, separar review e permitir Codex normal + adversarial por bloco. Não existem para permitir que a arquitetura nasça pequena.

### 2.4 O que esta decisão proíbe explicitamente

- "Mínimo viável" como objetivo arquitetural do PR2.
- Endpoint provisório com retorno 503/501 para parte essencial da experiência nativa.
- Wrapper temporário sobre payload nativo para "destravar" implementação.
- Abstração genérica entre Anthropic e OpenAI que não seja `GovernanceEnvelope<TNativeRequest, TNativeResponse>` (já fixado em ADR-003).
- Marcar capability essencial como `planned` para escapar de implementação no PR2 sem decisão humana de arquiteto (§14 deste Addendum).
- Linguagem do tipo "se Batch X falhar, mergeia sem ele" aplicada a qualquer coisa essencial à experiência nativa.

### 2.5 Posicionamento de mercado embutido nesta decisão

A categoria "AI gateway / AI trust surface" já está consolidada no mercado (Databricks Unity AI Gateway, Palo Alto + Portkey/Prisma AIRS, Cequence, MintMCP, Bifrost, IBM ContextForge, Microsoft Purview DSPM for AI, Credo AI, Lakera, Protect AI). O GovAI **não inventa categoria**. O GovAI implementa a categoria com diferenciação concreta: native-first sem normalização lossy (ADR-003), LGPD-first, evidence layer cryptographically auditable, baixa fricção, baseURL-compatible com SDK oficial. Construir do micro para o macro contradiz essa tese — o usuário compara com competidores que já têm gateway maduro e percebe o produto como capado. Construir do macro para o micro permite competir desde o primeiro release, mesmo que governança profunda evolua por camadas.

---

## 3. Decisão canônica A1 — Claude Code local client × Agent SDK server-side

ADP v4.2 §14.3 trata `claude_agent.*` como capabilities `planned` para PR7+ e descreve o estado-alvo pós-sandbox. Esse texto continua válido para o **cenário server-side**, mas v4.2 não distingue formalmente esse cenário do cenário em que Claude Code roda no laptop do usuário e o GovAI atua como camada HTTP/proxy. Esta seção fixa a distinção.

### 3.1 Cenário A — Claude Code local client (laptop do usuário)

**Descrição.** Claude Code CLI, ou outro cliente equivalente, executa na máquina do usuário. As ações locais (leitura/edição de arquivos, execução de shell, controle do computador) ocorrem **fora** da infraestrutura GovAI. O cliente faz chamadas HTTP a endpoints Anthropic (`/v1/messages`, files, models, etc.) e o GovAI senta no caminho como camada de auth, audit, credential rewrite, DLP, policy e evidência.

**O que o GovAI precisa entregar:**

- passthrough HTTP byte-preserved sobre os endpoints Anthropic relevantes;
- preservação de `tools[]`, `tool_use`, `tool_result`, streaming SSE, erros nativos, beta headers permitidos;
- credential rewrite por tenant;
- audit chain por chamada;
- governance progressiva conforme v4.2 §14.2.

**O que o GovAI não precisa entregar para este cenário:**

- sandbox primitive server-side;
- execução de file_edit/bash/computer_use em compute do GovAI;
- runtime de agent loop server-side.

**Conclusão canônica.** Compatibilidade com Claude Code local **não depende** de Agent SDK instalado no GovAI nem de sandbox primitive. Depende de passthrough Anthropic robusto. Esta compatibilidade é **escopo arquitetural obrigatório** do PR2 (§6 e §9 deste Addendum).

### 3.2 Cenário B — Agent SDK server-side (compute do GovAI)

**Descrição.** GovAI executa um agente que usa `@anthropic-ai/claude-agent-sdk` ou equivalente como library, dentro de infraestrutura GovAI. As ações locais (file edit, bash, computer_use) ocorrem em compute GovAI.

**O que o cenário exige:**

- sandbox primitive (containers efêmeros, Landlock/seccomp/netns ou equivalente);
- approval workflows;
- enforcement modes `sandbox_required`, `ask`, `enforce` conforme v4.2 §14;
- evidence completa por ação local;
- aceite jurídico em `tenant_capability_acceptance` quando aplicável (v4.2 §8.2).

**Conclusão canônica.** Cenário B continua `planned` para PR7+ conforme v4.2 §21. Não entra no PR2. Não entra antes que exista sandbox primitive real ou módulo consumidor server-side com caso de uso concreto (§10 deste Addendum).

### 3.3 Implicação para `claude_agent.*` no registry

Os IDs `claude_agent.*` em v4.2 §14.3 referem-se ao **Cenário B**. Não devem ser usados para descrever o **Cenário A**. Compatibilidade Claude Code local em PR2 é entregue via capabilities `anthropic.messages.*` e `anthropic.files.*` em modo passthrough, não via capabilities `claude_agent.*`.

---

## 4. Decisão canônica A2 — PR2 redefinido como Native Provider Substrate

ADP v4.2 §21 nomeia o PR2 como "Native Provider Experience (Provider Completion Core)". Este Addendum redefine o nome e o escopo operacional.

### 4.1 Novo nome canônico

**PR2 — Native Provider Substrate.**

A palavra "Substrate" enfatiza fundação macro nativa que sustenta toda a evolução posterior. "Native" enfatiza preservação dos SDKs oficiais sem normalização lossy (já fixado por ADR-003).

### 4.2 Princípio operacional do PR2

> PR2 cria a base nativa que vai do micro ao macro. Governança profunda pode avançar por camadas; a disponibilidade nativa essencial não pode ficar para depois.

PR2 entrega simultaneamente:

- **largura nativa** via passthrough auditado de uma superfície relevante dos SDKs Anthropic e OpenAI;
- **profundidade governada** nas 6 capabilities core já listadas em v4.2 §21 como `supported + policy_governed`;
- **fundação contratual** (schema v4.2, `organizations.tier`, `operational_mode`, `tenant_capability_acceptance`, `computeEffectiveRiskClass`, `computeEnforcement`, tier policy matrix, `org_beta_overrides`);
- **pipeline real** (`/v1/runs`, `/v1/audit-events`, `/passthrough/{anthropic,openai}/*`) substituindo as cascas 503 do baseline atual;
- **Provider Coverage Matrix** com universo Anthropic + OpenAI mapeado e `last_live_test_at` populado para o subconjunto promovido.

### 4.3 O que o nome "Substrate" exclui

PR2 não é micro-PR. PR2 não é refator de fundação. PR2 não é "lib + 6 endpoints". PR2 não normaliza Anthropic ou OpenAI para shape comum. PR2 não substitui SDK oficial por wrapper próprio. Toda a superfície criada em PR2 deve ser **forward-compatible** (§13 deste Addendum).

---

## 5. Decisão canônica A3 — Deep governance incremental; native availability não capada

### 5.1 Frase canônica

> Deep governance pode ser incremental. Native availability essencial não pode parecer capada.

### 5.2 O que é aceitável (governança progressiva)

- Capability promovida hoje a `supported + passthrough_audited` e amanhã a `policy_governed` ou `evidence_grade` por PR sucessivo, com migração de level documentada.
- Facets internos de uma capability evoluindo de `planned` para `supported` em PRs distintos (já previsto em v4.2 §3.2).
- Capability declarada `planned` honestamente, com `planned_phase` referindo PR concreto, **desde que a capability não seja parte da experiência nativa essencial coberta pelo Macro Native Substrate Contract** (§6).

### 5.3 O que não é aceitável (native availability capada)

- Endpoint pertencente à superfície essencial de Claude Code, Anthropic SDK ou OpenAI SDK retornando `503 pipeline_incomplete` ou `501` genérico em PR2.
- SDK oficial quebrando porque o GovAI não preservou protocolo, payload ou stream.
- Perda silenciosa de `tools[]`, `tool_use`, `tool_result`, file references, beta headers permitidos por override, ou erros nativos.
- Alteração de stream (buffering excessivo, mudança de formato SSE, perda de chunks, perda de trailers).
- Wrapper JSON em volta de payload nativo.
- Permissão solicitada pelo cliente (ex.: `anthropic-beta`) sem caminho explícito de aceitação ou negação auditada.
- Capability conhecida do GovAI sem categoria de status declarada.
- Marcar capability essencial como `planned` para escapar de implementação no PR2 sem passar por Human Architect Escalation (§14).

### 5.4 Enforcement modes canônicos

Os enforcement modes do GovAI são **exclusivamente**:

- `observe` — registra, não bloqueia;
- `warn` — registra com aviso ao cliente, não bloqueia;
- `ask` — exige confirmação explícita do usuário/runtime antes de prosseguir;
- `enforce` — aplica policy; nega quando viola;
- `sandbox_required` — exige execução em sandbox primitive (PR8+);
- `blocked` — nega incondicionalmente.

`risk_acceptance` **não é enforcement mode**. Risk acceptance é **artefato/registro de aceite jurídico**, materializado em `tenant_capability_acceptance` (v4.2 §8.2 e patch P3 v4.1) ou em audit event de aceite explícito. Pode ser **precondição** para que uma capability de Risk Class B+ saia de `enforce: ask` ou `sandbox_required` e progrida para `enforce: enforce`. Mas não é, ela mesma, modo de enforcement.

### 5.5 Categorias possíveis para uma capability conhecida

Toda capability conhecida do GovAI cai obrigatoriamente em **uma** destas categorias:

1. funciona nativamente via GovAI (`supported + passthrough_audited` ou `supported + policy_governed`);
2. funciona com enforcement progressivo (`observe`, `warn`, `ask`, `enforce`, `sandbox_required`) e, quando aplicável, exige `tenant_capability_acceptance` ou registro de risk acceptance auditável como precondição;
3. é bloqueada por razão técnica, legal ou de risco documentada (`status: blocked` ou `enforcement: blocked` conforme v4.2 §3.4);
4. está fora do roadmap atual por decisão explícita honesta (`not_exposed` ou `planned` com `planned_phase` declarado), **e não pertence ao Macro Native Substrate Contract**.

Não existe quinta categoria. "Implementação parcial não declarada" é proibida.

---

## 6. PR2 Macro Native Substrate Contract

Este é o contrato arquitetural do PR2. Substitui integralmente o conceito "PR2 Minimum Native Gate" de v4.2.1.

**Diferença conceitual.** "Minimum Gate" implicava patamar mínimo cumprido como condição de merge — linguagem que tende a cortar. "Macro Native Substrate Contract" implica que a arquitetura do PR2 **já é a arquitetura final do substrato nativo do produto**; o que pode variar é a fração de implementação por batch dentro do mesmo PR. Falha em qualquer item bloqueia merge **e** dispara Human Architect Escalation (§14) — não permite redução silenciosa de escopo.

### 6.1 Substrate de fundação — contrato arquitetural

Dependência blocante para o restante. Sem isto, o PR2 não tem fundação:

- `CapabilityStatus` migrado para `'not_exposed' | 'planned' | 'supported' | 'blocked'` conforme v4.2 §12.1;
- `Capability` schema com `level`, `base_risk_class`, `tier_availability`, `enforcement_default` no top-level (v4.2 §12.1);
- enums `EnforcementMode`, `RiskClass`, `Tier`, `OperationalMode` em `core-governance` e `core-events`;
- migration adicionando `organizations.tier`, `organizations.operational_mode`, `operational_mode_expires_at`;
- migration adicionando `tenant_capability_acceptance` com `base_risk_class_at_acceptance`, `max_effective_risk_class_allowed`, `expires_at` (índice parcial não-volátil — patch P3 v4.1);
- `computeEffectiveRiskClass` (TS) implementado e testado para cada `RiskEscalationReason` em v4.2 §12.1;
- `computeEnforcement` (TS) implementando a Tier × Risk × Mode matrix de v4.2 §4.3;
- migration de `org_beta_overrides` (§8 deste Addendum).

### 6.2 Anthropic native substrate — contrato arquitetural

Subseção alinhada a v4.2 §13 e §3.1 deste Addendum.

**Endpoints obrigatórios (entregues funcionais em PR2, sem 503/501):**

- `/v1/messages` POST passthrough real;
- `/v1/messages` streaming SSE byte-preserved;
- `/v1/messages/count_tokens` POST passthrough;
- `/v1/models` GET passthrough;
- `/v1/models/{id}` GET passthrough;
- `/v1/files` POST (upload);
- `/v1/files` GET (list);
- `/v1/files/{id}` GET (metadata);
- `/v1/files/{id}` DELETE;
- `/v1/files/{id}/content` GET (stream).

**Comportamento obrigatório:**

- `tools[]`, `tool_use`, `tool_result` preservados byte-a-byte (sem normalização);
- preservação de erros nativos Anthropic (`{ error: { type, message } }`);
- request abort / stream cancel propagado downstream para o provider e upstream para o cliente;
- `anthropic-beta` denied sem override explícito → 403 + audit `passthrough.beta_denied`;
- `anthropic-beta` allowed via `org_beta_overrides` válido → forward com header preservado;
- audit event por chamada (§6.6 deste Addendum);
- credential rewrite real por tenant (sem chave hardcoded);
- request hash e response/stream final hash conforme contrato v4.2 §13.5;
- sem buffering que destrua tempo até o primeiro token (raw body forward para non-stream; pass-through chunked para stream);
- raw body preservado: o passthrough **não** parseia e re-serializa o body para forward; usa o raw body para hash e forward; cópia separada pode ser feita para DLP/policy sem alterar bytes enviados.

**Fallback declarável (subfases de PR3+, não bloqueia PR2):**

- hashing avançado de chunks em multipart;
- `evidence_strength` elevada para uploads grandes;
- output DLP em conteúdo de arquivos;
- otimizações avançadas de streaming multipart.

**Não aceitável como fallback:**

- existência funcional de qualquer dos 10 endpoints listados acima retornando 503/501. Se houver impedimento técnico real, dispara §14 (Human Architect Escalation), não redução silenciosa.

### 6.3 OpenAI native substrate — contrato arquitetural

Subseção alinhada a v4.2 §13 e §9 deste Addendum.

**Endpoints obrigatórios (entregues funcionais em PR2, sem 503/501):**

- `/v1/responses` POST passthrough real;
- `/v1/responses` streaming preservado;
- `/v1/chat/completions` POST passthrough real;
- `/v1/chat/completions` streaming preservado;
- `/v1/models` GET passthrough;
- `/v1/embeddings` POST passthrough;
- `/v1/files` POST (upload);
- `/v1/files` GET (list);
- `/v1/files/{id}` GET (metadata);
- `/v1/files/{id}` DELETE;
- `/v1/files/{id}/content` GET.

**Comportamento obrigatório:**

- preservação de erros nativos OpenAI (`{ error: { message, type, param, code } }`);
- credential rewrite por tenant;
- audit event por chamada;
- raw body preservado (mesma regra de §6.2);
- request abort / stream cancel propagado;
- request/response hash conforme contrato.

**Fallback declarável:** mesmas categorias de §6.2 (hashing avançado, evidence_strength elevada, output DLP, otimizações de streaming multipart).

**Não aceitável como fallback:** existência funcional dos 11 endpoints. Se houver impedimento técnico real, dispara §14.

### 6.4 Governed Run profundo nas 6 core — contrato arquitetural

Mantém o escopo de v4.2 §21 sem alteração:

- `anthropic.messages.create` — `supported + policy_governed`;
- `anthropic.messages.stream` — `supported + policy_governed`;
- `openai.responses.create` — `supported + policy_governed`;
- `openai.responses.stream` — `supported + policy_governed`;
- `openai.chat.completions.create` — `supported + policy_governed`;
- `openai.chat.completions.stream` — `supported + policy_governed`.

`/v1/runs` real consumindo essas capabilities; pipeline DLP → policy → provider invoke → audit append → response.

Coexistência: a mesma capability pode ter, simultaneamente, rota Governed Run profunda e rota passthrough auditada. As duas não se substituem; complementam-se conforme tier × mode × tenant.

### 6.5 SDK baseURL compatibility — contrato arquitetural

PR2 deve garantir que SDK oficial de cada provider funcione apontando `baseURL` para o GovAI:

- Anthropic SDK: `new Anthropic({ baseURL: 'https://<govai-host>/passthrough/anthropic', apiKey: '<govai-tenant-token>' })` deve operar normalmente sobre os 10 endpoints obrigatórios da §6.2.
- OpenAI SDK: `new OpenAI({ baseURL: 'https://<govai-host>/passthrough/openai/v1', apiKey: '<govai-tenant-token>' })` deve operar normalmente sobre os 11 endpoints obrigatórios da §6.3.

O caminho exato (`/passthrough/anthropic`, `/passthrough/openai/v1`) é decisão de Peça A v2. PR2 não pode produzir paths inconsistentes (ex.: duplicação `/v1/v1/...`) nem exigir que o cliente reescreva paths.

### 6.6 Audit obrigatório em toda chamada que atravessa GovAI

Toda chamada — Governed Run ou passthrough — deve gerar registro com:

- `tenant_context` (`org_id`, `workspace_id`, `actor_user_id`);
- `provider`;
- `capability_id`;
- `native_endpoint`, `native_method`;
- `native_request_hash`;
- `native_response_hash` ou `stream_final_hash`;
- `latency_ms`, `status_code`;
- `usage_json` com `source` (`ProviderInvocation` v4.2 §8);
- `credential_source` (tenant key id resolvido);
- `policy_decision` quando aplicável;
- `base_risk_class` (do registry) e `effective_risk_class` (runtime) quando aplicável;
- `audit_event_id`;
- atualização da `chain_id` correta (`run` / `policy` / `admin`).

Quando crypto-shred E2E ainda não estiver implementado (PR3), payload encrypted pode ser omitido em favor de hash + metadata. Isso **não** dispensa o audit event nem o hash nem o registro do `audit_event_id`.

### 6.7 Unknown endpoints — contrato arquitetural

Production (qualquer tier):

- não há proxy cego;
- resposta `403 capability_not_registered` estruturada com `error`, `endpoint`, `reason`, `remediation_url`, `discovery_mode_path`, `audit_event_id`;
- audit event obrigatório.

Discovery Mode (admin-only, conforme v4.2 §11.4):

- tenant-scoped;
- time-boxed (`expires_at` obrigatório);
- audit-only;
- rate-limited;
- DLP pre-scan obrigatório (patch P5 v4.1);
- gera item de backlog em Provider Coverage Matrix;
- nunca promove capability para `supported` automaticamente.

### 6.8 Provider Coverage Matrix — contrato arquitetural

- artefato em `docs/architecture/provider-coverage-matrix.md` criado em PR2;
- universo Anthropic + OpenAI mapeado, com diferenciação clara entre `supported` (entregue em PR2), `planned` (com `planned_phase` referindo PR concreto) e `not_exposed` (fora do roadmap do produto);
- subconjunto promovido marcado como `supported` com `last_live_test_at` populado pelo próprio PR2;
- Registry ↔ Matrix consistency test obrigatório (patch P6 v4.1);
- Unknown passthrough endpoint test obrigatório (patch P7 v4.1).

---

## 7. Batches do PR2 — divisão de execução, não de arquitetura

> Batches são divisão de execução, não redução de escopo arquitetural.

PR2 pode ser dividido internamente em batches sequenciais para permitir auditoria, Codex normal + adversarial e review por bloco. A divisão em batches **não pode** ser usada para reduzir o Macro Native Substrate Contract (§6). A arquitetura do PR2 é integral. Os batches diferem apenas quanto à ordem de implementação dentro do mesmo PR.

### 7.1 Batches obrigatórios (arquitetura integral, implementação sequenciada)

| Batch | Conteúdo | Status |
|---|---|---|
| **F — Fundação** | Substrate de fundação (§6.1): schema v4.2, enums, migrations, `computeEffectiveRiskClass`, `computeEnforcement`, `org_beta_overrides`. | Obrigatório, primeiro a mergear internamente. |
| **A — Anthropic Claude Code Compatibility** | Anthropic native substrate (§6.2): 10 endpoints, `tools[]`, `tool_use`/`tool_result`, beta override, errors, abort/cancel, SDK baseURL test, live opt-in. | Obrigatório. |
| **C — OpenAI native basics** | OpenAI native substrate (§6.3): 11 endpoints, streaming, errors, embeddings, files, models, SDK baseURL test, live opt-in. | Obrigatório. |
| **B — Files / documents** | Detalhes de hashing mínimo, estratégia de evidence_strength inicial, audit metadata para uploads/downloads. | Obrigatório (mínimo declarado em §6.2/§6.3). Otimizações de hashing avançado e output DLP são fallback declarável em PR3+. |
| **G — Governed Run** | `/v1/runs` real para as 6 capabilities core (§6.4); pipeline DLP → policy → provider invoke → audit append → response. | Obrigatório. |
| **M — Matrix & Registry** | Provider Coverage Matrix (§6.8) e Registry consistency tests. | Obrigatório. |

### 7.2 Batch stretch (apenas execução, não arquitetura)

| Batch | Conteúdo | Status |
|---|---|---|
| **D — Batches API** | Anthropic message batches, OpenAI batches. | Stretch. Arquitetura já decidida e mapeada na Provider Coverage Matrix; implementação pode ficar para PR4 se houver pressão de prazo, **desde que** a Matrix marque `planned` com `planned_phase` explícito e o registry seja consistente. |

### 7.3 Regras de batches

- Cada batch obrigatório passa por Codex normal + adversarial antes do próximo iniciar.
- Falha de batch obrigatório dispara **Human Architect Escalation** (§14). Não há corte silencioso. Não há "merge parcial sem o batch".
- Falha de Batch D (stretch) é admissível e fica como `planned` honestamente; PR2 prossegue.
- Linguagem do tipo "se Batch X falhar, mergeia sem ele" é proibida para batches obrigatórios. Permitida apenas para Batch D, e mesmo assim com decisão humana registrada.

### 7.4 Ordem de mergeabilidade interna recomendada

1. Batch F (Fundação) — desbloqueia tudo.
2. Batch A (Anthropic) — entrega máxima de valor de produto e desbloqueia teste Claude Code compatibility.
3. Batch C (OpenAI) — paridade de provider.
4. Batch B (Files) — junto com A/C; finalização mínima.
5. Batch G (Governed Run) — depois do passthrough sustentado.
6. Batch M (Matrix) — fechamento, consistência de registry e matrix.
7. Batch D (Batches API) — apenas se houver folga; do contrário, marcado como `planned`.

---

## 8. `org_beta_overrides` — contrato e schema

Esta seção operacionaliza a permissão controlada de `anthropic-beta` por org, sem alterar a allowlist global congelada. Este é o **único** novo objeto de schema introduzido por este Addendum; está explicitamente reconhecido na §1 como exceção autorizada.

### 8.1 Princípio

- Allowlist global hardcoded (`ANTHROPIC_BETA_ALLOWLIST`) permanece **deny-by-default** e modificável apenas por PR + ADR.
- Override por org é **aditivo** sobre a allowlist global; não pode remover um beta da global.
- Override por org **não** promove capability para `supported`; só altera o filtro de header em runtime.

### 8.2 Schema da tabela (a ser criado em migration do PR2, dentro do Batch F)

```
govai.org_beta_overrides
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  provider        text        NOT NULL CHECK (provider IN ('anthropic')),
  beta_token      text        NOT NULL,
  reason          text        NOT NULL,
  set_by_user_id  uuid        NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz NULL,
  CHECK (expires_at > set_at)
```

Índice único parcial (apenas overrides ativos):

```
CREATE UNIQUE INDEX org_beta_overrides_active_unique
  ON govai.org_beta_overrides (org_id, provider, beta_token)
  WHERE revoked_at IS NULL;
```

Justificativa do design:

- `id uuid PRIMARY KEY` permite que o mesmo `(org_id, provider, beta_token)` seja recriado depois de revogado, preservando histórico de aceitação. PRIMARY KEY composto seria bug semântico — após revogação, recriação ficaria bloqueada.
- Índice único **parcial** sobre `WHERE revoked_at IS NULL` garante que existe no máximo um override ativo por `(org_id, provider, beta_token)`. Histórico de overrides revogados pode acumular livremente.
- `expires_at > now()` **não** entra no índice parcial (não é predicado imutável; ficaria volátil). Filtro temporal é runtime.
- `CHECK (expires_at > set_at)` impede expires_at retroativo.
- RLS habilitado e forçado, policies por comando × role conforme padrão v4.2.
- Sem DELETE: revogação é via UPDATE de `revoked_at`. Idempotente: se já revogado, no-op.

### 8.3 Query de runtime para resolver overrides ativos

```
SELECT beta_token
FROM govai.org_beta_overrides
WHERE org_id = $1
  AND provider = $2
  AND revoked_at IS NULL
  AND expires_at > now();
```

### 8.4 Regras de uso

- criação exige role admin (RBAC);
- gera audit event `org.beta_override_set` na chain `admin`;
- revogação gera audit event `org.beta_override_revoked` na chain `admin`;
- runtime filtra `anthropic-beta` cruzando incoming ∩ (`ANTHROPIC_BETA_ALLOWLIST` ∪ overrides ativos para a org);
- override expirado é tratado como ausente (deny);
- audit event do passthrough registra qual override foi usado quando aplicável.

### 8.5 Limites

- `org_beta_overrides` não habilita endpoints fora da allowlist passthrough; só habilita header em endpoint já permitido;
- não substitui aceite jurídico (`tenant_capability_acceptance`) quando o beta envolver capability de Risk Class B+ que exija aceite por tier;
- override de `computer-use` ou similares de Risk Class D continua sujeito a v4.2 §14 (sandbox/approval);
- escopo restrito a `provider = 'anthropic'` no PR2. Se OpenAI exigir mecanismo análogo no futuro, a constraint é relaxada por PR específico com migration.

---

## 9. Claude Code compatibility tests obrigatórios

Subseção do Macro Native Substrate Contract (§6.2) com critérios numéricos. Cada teste herme é gate de merge para Batch A.

### 9.1 Testes herméticos (CI sempre)

Contra mock provider (server-protocol test server) ou fixtures. Bloqueiam PR2.

1. **SDK baseURL test:** instanciar `new Anthropic({ baseURL: '<govai>/passthrough/anthropic', apiKey: 'govai_token_dev' })` e executar chamada simples a `/v1/messages` com sucesso.
2. **`tools[]` byte-preserved:** payload com `tools: [...]` no body do request enviado ao provider deve ser byte-idêntico ao recebido pelo GovAI (após DLP/policy approval), modulo apenas headers de auth.
3. **`tool_use` / `tool_result` roundtrip:** stream contendo blocos `tool_use` chega ao cliente sem alteração; subsequente request com `tool_result` é forwardado preservando estrutura.
4. **SSE byte-preserved:** stream SSE do provider é repassado chunk-a-chunk; nenhum chunk é alterado, omitido ou adicionado. Hash incremental pode ser calculado em paralelo, sem bloquear stream.
5. **Provider errors preservados:** erro 4xx/5xx do provider chega ao cliente com `{ error: { type, message } }` original; GovAI pode adicionar header `x-govai-error-class`, sem alterar body.
6. **Request abort:** quando o cliente fecha conexão durante streaming, GovAI cancela request upstream para o provider em até 1s e gera audit event `run.cancelled`.
7. **Beta header denied sem override:** header `anthropic-beta: <token>` não presente em allowlist global nem em override ativo → 403 `passthrough.beta_denied` com `reason` listando o token denegado.
8. **Beta header allowed com override:** mesmo header com override ativo válido → forward com header preservado; audit event registra `beta_override_used`.

### 9.2 Testes opt-in live

Atrás de `GOVAI_LIVE_TESTS=1`. Não bloqueiam CI, mas o PR2 só promove capability para `supported` se a suite live executar verde uma vez no contexto do próprio PR (regra v4.2 patch N6).

9. SDK baseURL test contra Anthropic real.
10. `tools[]` + `tool_use` + `tool_result` real com modelo capaz.
11. SSE real durante streaming longo.
12. Beta header real (ex.: prompt caching) com override ativo válido.
13. Para promoção de capability a `supported`, popular `last_live_test_at` com timestamp da execução live.

### 9.3 Equivalente OpenAI

Aplicar o mesmo conjunto contra OpenAI SDK apontando `baseURL` para GovAI passthrough, com adaptação aos endpoints `/v1/responses`, `/v1/chat/completions`, e ao formato de erro OpenAI.

---

## 10. Agent-probe — gate de instalação do Agent SDK

Esta seção define quando `@anthropic-ai/claude-agent-sdk` ou equivalentes podem ser instalados.

### 10.1 Regra

`@anthropic-ai/claude-agent-sdk` **não** é instalado em PR2 nem em qualquer PR posterior, salvo se o PR que adiciona a dependência satisfizer **uma** das condições:

- **Condição A — caso de uso server-side concreto:** existe demanda contratada ou solicitada de cliente para Cenário B (§3.2), com módulo consumidor real implementado **no mesmo PR**, testes herméticos e sem claim production se sandbox primitive ainda não existir.
- **Condição B — spike técnico formal:** PR2.5 ou PR3-agent-probe explicitamente declarado como spike, time-boxed, com módulo consumidor real, testes herméticos, sem expor capability como `supported` em production, sem dependência morta, sem sandbox falso.

### 10.2 O que o agent-probe nunca pode fazer

- instalar dependência sem módulo consumidor real (violação ADR-006);
- expor `claude_agent.*` como `supported` antes de sandbox primitive existir, exceto Risk Class A (`agent.query` / `agent.session` sem ação local);
- prometer `file_edit`, `bash` ou `computer_use` em production;
- reaproveitar Cenário A para alegar suporte ao Cenário B;
- consumir orçamento de PR2 obrigatório.

### 10.3 Implicação para a Provider Coverage Matrix

`claude_agent.*` permanece como em v4.2 §14.3: `planned` com `planned_phase: 'PR7'` (ou `PR2.5`/`PR3-agent-probe` se Condição A/B for ativada). `claude_agent.computer_use` permanece `blocked` até sandbox primitive em PR8+ — **mesmo em condição de agent-probe**, `computer_use` server-side continua bloqueado.

---

## 11. Agent Runtime Connector — categoria futura

Este Addendum reconhece formalmente uma categoria futura de integração que **não** entra em PR2 mas precisa ser nominada para evitar reabrir taxonomia depois.

### 11.1 Definição

**Agent Runtime Connector.** Modo de integração em que GovAI atua como camada de confiança/audit/policy sobre runtimes de agentes que executam fora do compute GovAI (laptop do usuário, infraestrutura do cliente, dispositivo controlado), e cujo tráfego para LLM providers e/ou tools é roteado por GovAI.

Cobre, no estado-alvo:

- Claude Code (já coberto operacionalmente em PR2 via Cenário A);
- Codex CLI;
- OpenClaw e variantes hardenizadas (NemoClaw + OpenShell);
- agentes locais customizados;
- agentes enterprise on-prem;
- runtimes que usam MCP/tools, com possível integração delegada de MCP gateway externo ou MCP gateway próprio em PRs futuros.

### 11.2 Princípio canônico

> GovAI governa o que consegue rotear, controla o que consegue hospedar, audita o que consegue observar, e registra exceções e shadow usage para o que escapa — com evidence forensicamente auditável e baixa fricção.

Esta frase descreve o estado-alvo, não o estado atual. Em PR2, GovAI cobre apenas "rotear" + "auditar" para Anthropic e OpenAI nos endpoints da Provider Coverage Matrix. As demais dimensões evoluem em PRs subsequentes.

### 11.3 MCP — política inicial

Aceitável: começar com integração delegada a MCP gateway externo (Bifrost, ContextForge, Cequence ou equivalente) se acelerar entrega.

Não aceitável: terceirizar o moat de evidência e governança. Independente de quem proxia o tráfego MCP, GovAI mantém control plane próprio para:

- audit chain e evidence record por `tool_call` / `tool_result`;
- tenant policy e RBAC;
- risk decision (`computeEffectiveRiskClass` aplicado a payload de tool);
- DLP hooks pre-call e post-call;
- approval / risk acceptance;
- legal / compliance records.

Essa decisão é canônica para PRs futuros; não cria escopo em PR2.

### 11.4 Não-objetivo

Agent Runtime Connector **não** é compromisso de implementação em prazo definido. É reserva de taxonomia. Cada integração específica (OpenClaw, NemoClaw, Codex, MCP gateway próprio) entra como PR separado quando houver demanda comercial concreta ou decisão estratégica explícita.

---

## 12. Positioning calibration

Esta seção fixa a régua de claim público para evitar overclaim regulatório.

### 12.1 Claim interno (ambição arquitetural)

Permitido em ADRs, prompts internos, documentação técnica de visão e materiais não-públicos:

> A forma mais segura e confiável de usar IA em ambiente regulado.

### 12.2 Claim externo até auditoria + clientes + testes adversariais públicos

Forma defensável para site, materiais comerciais, propostas e contratos:

- PT: **"Superfície de confiança native-first para uso governado de IA com evidência criptográfica em ambientes regulados."**
- EN: **"Native-first AI trust surface with cryptographic evidence for regulated environments."**

### 12.3 Régua de evolução

| Marco | Claim adicional permitido |
|---|---|
| PR2-PR6 entregues + 1-2 clientes pilot | "Designed for LGPD-first regulated environments" |
| Auditoria externa + ICP-Brasil TSA implementado + 5+ clientes regulados | "Evidence-grade AI usage governance for regulated industries" |
| Auditoria externa pública + comparativos quantitativos + certificações relevantes | superlativos ("the safest", "the most", etc.) |

### 12.4 Restrições

Antes da régua acima, **proibido** em material público:

- "the most secure";
- "the safest way to use AI";
- "regulatory-grade" sem qualificador `evidence_strength`;
- claims de equivalência com TSA ICP-Brasil enquanto não estiver implementado;
- comparações quantitativas com competidores sem fonte verificável.

---

## 13. Forward-compat — regra de não-refatoração futura

Toda superfície criada em PR2 deve ser base compatível com PRs futuros.

### 13.1 Proibições

- criar rota cuja semântica precisará ser substituída em PR3-PR7;
- criar payload temporário (request shape, response shape) que não seja exatamente o do provider nativo;
- criar wrapper de erro proprietário em volta do erro nativo;
- criar protocolo de streaming intermediário (proto, JSON wrapping, chunking custom) entre provider e cliente;
- criar abstração de "request normalizado" entre Anthropic e OpenAI;
- emitir audit event com schema que se sabe insuficiente para evolução previsível em PRs já mapeados (PR3-PR7);
- criar capability ID que conflite com taxonomia de v4.2 §12 / §14;
- introduzir coluna ou tabela que se sabe descartável em PR posterior.

### 13.2 Tratamento de implementação parcial

Quando uma capability não puder ser entregue completa em PR2:

- **se a capability faz parte do Macro Native Substrate Contract (§6):** dispara §14 (Human Architect Escalation). Não pode ser declarada `planned` silenciosamente.
- **se a capability não faz parte do Macro Native Substrate Contract:** marcar honestamente como `planned` no registry com `planned_phase` referindo PR concreto; documentar o gap em ADR ou em `docs/contracts/`.

Em qualquer caso, não introduzir comportamento em PR2 que precise ser revertido em PR posterior.

### 13.3 Compatibilidade de migração

Migrations adicionadas em PR2 devem:

- ser idempotentes;
- ser forward-compatible com PR3-PR7 conforme roadmap v4.2 §21;
- não criar coluna ou tabela que se sabe descartável em PR posterior;
- preservar semântica de v4.2 §8 (modelo de dados macro).

---

## 14. Human Architect Escalation — quando algo essencial é tecnicamente impossível

Esta seção é nova em v4.2.2. Substitui qualquer mecanismo implícito de "redução silenciosa de escopo" que existisse em v4.2.1.

### 14.1 Princípio

> Se algum item essencial do Macro Native Substrate Contract for tecnicamente impossível no PR2, a decisão volta para o arquiteto humano. **Não** se reduz escopo silenciosamente. **Não** se marca como `planned` para escapar de implementação.

### 14.2 Quando dispara

A escalação dispara quando:

- um endpoint listado em §6.2 ou §6.3 não pode ser entregue funcional em PR2 por impedimento técnico real;
- um teste hermético da §9 não pode ser implementado;
- um item de §6.1 (Substrate de fundação), §6.4 (Governed Run profundo), §6.5 (SDK baseURL), §6.6 (Audit), §6.7 (Unknown endpoints) ou §6.8 (Provider Coverage Matrix) tem impedimento técnico que o PR2 não consegue resolver dentro do prazo.

### 14.3 Procedimento

1. **Não** alterar registry para `planned` ou `not_exposed` no item afetado.
2. **Não** introduzir 503/501 no endpoint.
3. **Não** introduzir wrapper temporário, abstração intermediária ou rota de bypass.
4. Documentar em comentário no PR (ou em arquivo `escalation/<item>.md` no branch):
   - item afetado;
   - impedimento técnico real (não conveniência);
   - alternativa proposta sem capar o usuário;
   - opção A: estender PR2 com tempo adicional;
   - opção B: dividir o PR2 em PR2a/PR2b mantendo arquitetura integral entre os dois;
   - opção C: redefinir escopo do produto (decisão de produto, não de implementação).
5. Aguardar decisão do arquiteto humano (Mauricio ou equivalente designado).
6. Só então atualizar o roadmap, ADP e registry conforme decisão.

### 14.4 O que esta seção proíbe

- Claude Code (a IA executora) reduzindo escopo unilateralmente.
- "Falhei em X, marquei como planned, segui em frente."
- "Vou implementar wrapper temporário e refatorar depois."
- "Vou usar `passthrough_audited` minimal e o resto fica para PR3."
- Qualquer interpretação criativa do escopo do Macro Native Substrate Contract que reduza superfície nativa essencial.

### 14.5 Histórico do projeto que motiva esta seção

O arquiteto humano já viveu, em iterações anteriores deste produto, o efeito de redução silenciosa de escopo: rotas provisórias, wrappers temporários, abstrações intermediárias e marcações `planned` aplicadas a itens essenciais. O resultado foi colcha de retalhos: integrações que não conversam, refatorações sucessivas, mais tempo corrigindo do que desenvolvendo. v4.2.2 codifica que esse padrão não se repete.

---

## 15. Critério de aceitação do Addendum

Este Addendum é aceito como canônico se, ao ser referenciado em conjunto com ADP v4.2 (hash pinned acima), deixar inequívoco para qualquer leitor (humano ou Claude Code):

- [ ] A frase canônica A0 ("Macro nasce como arquitetura; batches dividem execução") é regra de design e não slogan;
- [ ] Claude Code local compatibility (Cenário A) é escopo arquitetural obrigatório de PR2;
- [ ] Agent SDK server-side (Cenário B) pode ficar para agent-probe / PR futuro com gate de §10;
- [ ] PR2 chama-se "Native Provider Substrate" e implementa o Macro Native Substrate Contract de §6;
- [ ] Native availability essencial não é cortada por conveniência;
- [ ] Deep governance pode ser progressiva camada-por-camada, mas isto não autoriza redução de superfície nativa essencial;
- [ ] Enforcement modes canônicos são `observe | warn | ask | enforce | sandbox_required | blocked`. `risk_acceptance` é artefato/registro, não enforcement mode;
- [ ] Batch F (Fundação), Batch A (Anthropic), Batch C (OpenAI), Batch B (Files mínimo), Batch G (Governed Run) e Batch M (Matrix) são obrigatórios; Batch D (Batches API) é stretch;
- [ ] Files Anthropic e Files OpenAI têm 5+ endpoints mínimos cada, todos obrigatórios em PR2; fallback declarável aplica-se apenas a hashing avançado, evidence_strength elevada, output DLP e otimizações de streaming multipart;
- [ ] Discovery Mode não é proxy cego;
- [ ] Unknown production endpoint nunca é forwardado;
- [ ] GovAI não normaliza Anthropic e OpenAI de forma lossy (ADR-003 preservado);
- [ ] Não há dependência morta (ADR-006 preservado);
- [ ] Não há placeholder público;
- [ ] PR2 cria base macro forward-compat conforme §13;
- [ ] `org_beta_overrides` é a única via de habilitar beta header não-listado, com `id uuid` PK, índice único parcial sobre `WHERE revoked_at IS NULL`, sem `expires_at` no índice parcial, admin/audit/expiry;
- [ ] Agent Runtime Connector é reservado como taxonomia futura sem compromisso de prazo;
- [ ] Positioning público respeita §12;
- [ ] Falha de batch obrigatório dispara Human Architect Escalation (§14), nunca redução silenciosa de escopo;
- [ ] Este Addendum supersede integralmente Addendum v4.2.1.

---

## 16. Não-objetivos do Addendum

Este Addendum **não**:

- gera Peça B v2 (Provider Coverage Matrix Initial);
- gera Peça A v2 (PR2 Prompt Claude Code);
- gera prompt Claude Code de execução;
- altera ADRs 001-013 já aceitos;
- altera o modelo de dados macro de v4.2 §8 (apenas adiciona `org_beta_overrides`, exceção declarada na §1);
- introduz capability nova além das já mapeadas em v4.2 §12;
- altera a Tier Policy Matrix de v4.2 §4.3;
- altera enums de v4.2 §12.1;
- redefine Risk Classes A-E de v4.2 §14.1;
- introduz enforcement mode novo;
- compromete prazos de implementação para Agent Runtime Connector, MCP gateway próprio, OpenClaw/NemoClaw integration ou ICP-Brasil TSA.

---

## 17. Próximo passo

Sequência canônica após aceite deste Addendum:

1. **Auditoria deste Addendum** (você + GPT, opcional).
2. **Geração da Peça B v2** (Provider Coverage Matrix Initial alinhada a §6 e §7 deste Addendum, com `base_risk_class` + `tier_availability` por endpoint promovido, e marcação clara de stretch para Batch D).
3. **Auditoria da Peça B v2.**
4. **Geração da Peça A v2** (PR2 Prompt Claude Code para Native Provider Substrate, com gates numéricos por batch, referência ao Macro Native Substrate Contract e procedimento de Human Architect Escalation).
5. **Auditoria da Peça A v2.**
6. **Execução Claude Code (backend)** com pacote canônico: ADP v4.2 + Addendum v4.2.2 + Peça B v2 + Peça A v2.
7. **Codex normal + adversarial** por batch interno ao PR2.
8. **Track Frontend (FE-PR1)** em paralelo conforme v4.2 §5.

Em paralelo: **não gerar prompt Claude Code antes de Peça B v2 e Peça A v2 estarem geradas e auditadas.**

---

## 18. Changelog v4.2.2 vs v4.2.1

1. **Conceito "Minimum Native Gate" eliminado.** Substituído por "Macro Native Substrate Contract". Mudança não é cosmética: reflete que a arquitetura do PR2 já é a arquitetura final do substrato; batches diferem apenas quanto à implementação dentro do mesmo PR.
2. **Decisão canônica A0 adicionada (§2):** "Macro nasce como arquitetura; batches dividem execução." É a decisão de mais alto nível; todas as demais derivam dela.
3. **§1 corrigida:** declara explicitamente `org_beta_overrides` como única exceção autorizada ao princípio de não introduzir tabelas novas. Resolve contradição interna de v4.2.1 §1 vs §7/§14.
4. **§5.4 fixada:** enforcement modes canônicos são `observe | warn | ask | enforce | sandbox_required | blocked`. `risk_acceptance` é artefato/registro de aceite via `tenant_capability_acceptance`, não enforcement mode. Corrige confusão presente em v4.2.1 §4.3.
5. **§6.2 e §6.3 reforçadas:** 10 endpoints Anthropic e 11 endpoints OpenAI listados como obrigatórios funcionais em PR2; sem 503/501. Fallback declarável estritamente delimitado a hashing avançado, evidence_strength elevada, output DLP e otimizações de streaming multipart. Fecha brecha de v4.2.1 §5.2 que permitia marcar endpoint mínimo como `planned` com ADR.
6. **§6.5 nova:** SDK baseURL compatibility como contrato arquitetural; paths exatos para evitar duplicação como `/v1/v1/...`.
7. **§6.2/§6.3 raw body preservation:** explicitada regra de não parsear/re-serializar body para forward.
8. **§7 reorganizada:** batches obrigatórios incluem F (Fundação), A (Anthropic), C (OpenAI), B (Files), G (Governed Run), M (Matrix). Apenas D (Batches API) é stretch. Linguagem "se Batch X falhar, mergeia sem ele" proibida para batches obrigatórios.
9. **§8.2 corrigida:** schema de `org_beta_overrides` com `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, índice único parcial sobre `WHERE revoked_at IS NULL`, sem `expires_at` no índice parcial. Resolve bug semântico de v4.2.1 §7.2 (recriação após revogação).
10. **§14 nova:** Human Architect Escalation. Mecanismo formal para tratar impossibilidades técnicas reais sem redução silenciosa de escopo. Codifica a lição do histórico do projeto: produto colcha de retalhos não se repete.
11. **§13.2 atualizada:** capability essencial ao Macro Native Substrate Contract não pode ser declarada `planned` silenciosamente; dispara §14.
12. **§11.3 ampliada:** Cequence adicionada à lista de MCP gateways externos potencialmente delegáveis.

---

**Fim do Addendum ADP v4.2.2.**
