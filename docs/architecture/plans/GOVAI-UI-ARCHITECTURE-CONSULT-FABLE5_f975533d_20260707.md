> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_SNAPSHOT
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-07 at f975533d, Briefing #4)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D11B/D14=PRESERVE_HISTORY)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `d06c3f6ba6cef79e7e1f1efb27a74628af288841435d9859f0417754bae4ebc3` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL SNAPSHOT (D11b/D14 — HISTORY is more accurate per the document's own text: a "consulta"/parecer at f975533d, "consultar apenas para racional histórico das escolhas de UI"). Body byte-preserved. Its Part 1 data-contract inventory is the state at f975533d: at the Foundation V1 anchor `credential_source` is real (F1 corrected), the validation-block set is only provider-hosted computer-use (M1), and F2 is closed as an evidence-granularity residual; the architecture recommendation (native static SPA consuming Fastify directly, no BFF/SSR) was absorbed by the UI Master Plan and remains the recorded direction. No UI exists.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** REFERÊNCIA — parecer incorporado pelo UI Master Plan
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Consultar apenas para racional histórico das escolhas de UI.
> **ORIGEM:** handoff from-codex/
> ---

# Consulta de arquitetura de UI — GovAI @ `f975533d` (Fable 5, 2026-07-07)

**Método.** Li a fonte no checkout local, verificado exatamente no commit pinado (`git rev-parse HEAD` = `f975533d122afab251742c9459a12acc095dd8fb`, árvore limpa). Li: as 17 rotas de `apps/api/src/routes/`, o pipeline de evidência (`evidence-reports.ts`, `evidence-operator.ts`, `audit-bridge.ts`), o resolvedor de governança (`core-governance`), os handlers governed/passthrough dos dois provedores, o modelo de auth/tenancy (`auth.ts`, `core-tenant`, `core-identity`), migrações relevantes (0002, 0025), e os docs `19-build-vs-integrate-strategy.md`, `current-state.md`, `development-roadmap.md`, `workroom-governance-room.md`. **Não executei nada** — nenhum teste, servidor ou chamada HTTP; toda alegação abaixo é leitura estática, ancorada em `arquivo:linha`. Salvo indicação `[recomendação]`, tudo na Parte 1 é `[confirmado na fonte]`.

---

## PARTE 1 — Inventário do contrato de dados

### 1.1 O modelo de tenancy e autenticação (como a UI se situa)

**Identidade = chave de API; a org deriva da credencial, nunca de um parâmetro.**

- Toda rota extrai a chave de `x-govai-api-key` ou `Authorization: Bearer` e resolve `AuthIdentity { org_id, user_id, api_key_prefix, tier, operational_mode, roles }` — `apps/api/src/pipeline/auth.ts:15-28,40-92`. `tier ∈ {starter, business, enterprise, regulated}`, `operational_mode ∈ {production, pilot, dev, test}` vêm de `govai.orgs` via lookup `SECURITY DEFINER` (`auth.ts:76-83`).
- **RBAC por chave**: `Role = 'admin' | 'data_protection_officer' | 'dlp_admin' | 'developer' | 'auditor'` (`packages/core-identity/src/rbac.ts:1-8`); gate de admin em `pipeline/require-admin.ts:31-43`.
- **Isolamento por linha (RLS)**: todo acesso a dados roda `BEGIN → SET LOCAL app.org_id → query → COMMIT` (ex.: `routes/evidence.ts:80-87`; helper em `packages/core-tenant/src/index.ts`). Linha de outra org é **invisível** — cross-tenant vira `404`, nunca `403` (comentário e comportamento em `routes/workrooms.ts:410-414`). Os papéis de banco são fechados: `govai_app`, `govai_audit_writer`, `govai_audit_sealer NOLOGIN`, `govai_evidence_enumerator NOLOGIN` (`infra/postgres/bootstrap.sql:8,24,45,75`). Não existe leitura SQL cross-org em lugar nenhum; até o cockpit do operador é acumulação de N leituras single-org (`pipeline/evidence-operator.ts:1-22`).
- **JWT existe mas não é usado por nenhuma rota**: `packages/core-identity/src/jwt.ts` está presente e `auth.ts:2` diz "JWT path is wired but exercised via different middleware (out of scope)"; busca por uso de JWT em `routes/` e `pipeline/` retorna zero. Ou seja: **hoje não há sessão, login, cookie, nem gestão de usuários via API** — usuário é só um `user_id` carimbado na chave.
- **Emissão/gestão de chaves de API não tem rota HTTP** — é CLI (`apps/api/src/scripts/grant-api-key-role.ts:4` "bootstrap the first admin").
- **`operational_mode`/`tier` não são mutáveis por nenhuma rota** — busca por `UPDATE/INSERT govai.orgs` em `routes/`, `pipeline/` e `regulatory/` retorna zero. São controles de operador aplicados fora da API. Consequência dupla: (i) desligam o enforcement — `dev|test → observe` incondicional, `pilot` relaxa um degrau (`packages/core-governance/src/enforcement.ts:83-91`); (ii) comutam a origem da credencial — sem credencial de tenant, `production|pilot` falham e `dev|test` caem para chave de ambiente (`pipeline/provider-credentials.ts:146-177`).
- **CORS já é de primeira classe**: `API_CORS_ORIGINS` (CSV) + `API_CORS_CREDENTIALS`, com guarda que proíbe `*`+credentials em produção (`server.ts:94-98`; `packages/config/src/index.ts:29-30,144-146`). O backend já antecipa consumo por browser.
- **Rate limit: 100 req/min em produção**, in-memory, configurado globalmente (`server.ts:102-105`).

### 1.2 Superfícies de leitura (o que a UI pode mostrar)

**A. Evidência e auditoria (o cockpit do tenant — "o auditor É o tenant", `routes/evidence.ts:3-4`)**

| Rota | Retorna | Forma |
|---|---|---|
| `GET /v1/evidence/summary?window=` | Status por invariante + razão de cobertura | `{ org_id, window_seconds, t_seal_seconds, counts{ec1{total,sealed,failed,stalled_past_slo}, ec2{chains,chains_with_gap}, ec3seal{…}, ec4{…}, ec6{…}}, ec3drop, ec6, coverage_ratio{ratio,covered,total,terms[],excluded[]} }` — `routes/evidence.ts:56-96`; shapes em `pipeline/evidence-reports.ts:66-72,589-596,508-517` |
| `GET /v1/evidence/gaps?invariant=ec1\|ec2\|ec3seal\|ec3drop\|ec4&window=&limit=&cursor=` | Lista paginada de lacunas por invariante | `{ org_id, invariant, window_seconds, items[], next_cursor }` (cursor numérico por offset; `limit≤500`, janela ≤1 ano) — `routes/evidence.ts:29-41,98-168`. Tipos de item: `Ec1GapRow` (`:197-205`), `Ec2GapRow` com **bigint como string decimal** (`:246-254`), `Ec3SealRow` (`:302-308`), `Ec4Row` (`:349-357`), e `ec3drop` como singleton agregado na página 0 (`routes/evidence.ts:139-144`) |
| `GET /v1/audit-events?chain_category=auth\|run\|policy\|admin&limit=&before_seq=` | Cadeia HMAC crua, mais recente primeiro | `{ chain_id, events[{id, sequence_number, event_type, event_version, subject_type, subject_id, occurred_at, payload_hash(hex), previous_hmac(hex\|null), hmac(hex), canonical_hash(hex), evidence_strength, key_id, key_version}] }` — `routes/audit-events.ts:7-11,68-98`. **Só metadados e hashes; nunca o payload.** |
| `GET /v1/workrooms/:id/audit` (role `auditor`/`admin`) | Subview de auditoria por sala, via `workroom_turns → audit_events` | eventos + `redaction_metadata` + `turn_kind`/`turn_number`, keyset `before_seq` — `routes/workroom-transcript.ts:679-796` |
| `GET /v1/workrooms/:id/evidence` (participante ou `auditor`/`admin`) | Artefatos de evidência da sala (11 `artifact_kind`s) | metadados + `payload_ref` + `payload_hash(hex)` + `redaction_metadata`, keyset `before_seq` — `routes/workroom-transcript.ts:60-78,554-674` |

Semânticas de honestidade **embutidas no próprio contrato** (a UI deve preservá-las):
- `coverage_ratio` publica `terms[]` **e** `excluded[]` com a razão da exclusão (`evidence-reports.ts:560-571`).
- EC-6 (integridade de cadeia) é **sempre `pending`** neste build — não há verificação persistida; a resposta carrega uma `note` explicando isso (`evidence-reports.ts:466-469,476-496`).
- EC-3.drop carrega um `bound` textual: "perda nativa em agregado — inclui, não isola, streams-sem-terminal…" (`evidence-reports.ts:431-433`); a agregação autoritativa é o coletor OTLP, não a API (`routes/evidence.ts:83-86`).
- EC-5 (stream-terminal) está **deferido** — fora do enum de `/gaps` (`evidence-reports.ts:16-21`; `routes/evidence.ts:9-12`).

**B. Execução e estado do produto**

- `GET /v1/capabilities` → matriz capability×facet resolvida com overrides por org: `{org_id, capabilities[{id, provider, status, baseline_status, facets[{id, level, status, evidence_strength, reason, last_live_test_at, docs_url, override_applied}]}]}` — `routes/capabilities.ts:33-66`.
- `GET /v1/workrooms?status=&workspace_id=&limit=` e `GET /v1/workrooms/:id` → workroom + `policy_profile{governance_mode, default_provider_surface, max_risk_without_approval}` — `routes/workrooms.ts:373-499`.
- `GET /v1/workrooms/:id/runs` (participante ou `auditor`/`admin`) → runs da sala: `{run_id, status(queued|running|completed|failed|denied|awaiting_approval), mode, risk_level, provider, model, workroom_*, audit_event_id, created_at, completed_at}`, cursor composto — `routes/workroom-runs.ts:47,468-616`.
- `GET /v1/workrooms/:id/approvals` e `…/:approvalId` (participante ou `auditor`/`admin`) → fila de aprovações com `status` efetivo (expiry calculado em tempo de leitura, `routes/workroom-approvals.ts:208-222,493-498`), `intended_action_hash(hex)`, `consumed_run_id`, e a decisão (quem, quando, razão) — `:224-243,444-656`.
- `GET /v1/admin/provider-credentials?status=` (role `admin`) → credenciais sem nunca ecoar plaintext — `routes/admin-provider-credentials.ts:7-14,346`.
- `GET /health` → `{status:'ok'}` sem auth (`routes/health.ts:4`).

**C. Registros regulatórios (~61 caminhos, um padrão só)**

`/v1/regulatory/*` cobre: sources (+versions +relationships), controls (+source-links +framework-mappings), ai-systems, providers, models (+versions), ai-system-model-links, agents (+versions), agent-capability-bindings, use-cases (+asset-links +reviews), risk-methods, risk-classifications (+`/evaluate` +factors), reclassification-triggers, high-risk-reviews (+evidence +assignments +decisions +submit +cancel), prohibited-use-policies, prohibited-use-cases (+evidence +determinations +submit +cancel) — lista completa levantada por busca em `routes/regulatory.ts`. Padrões:
- **Leitura**: qualquer identidade autenticada do tenant; linhas `scope='tenant'` da org + linhas `scope='system'` (`routes/regulatory.ts:3-8`).
- **Escrita**: `admin` ou `data_protection_officer` (`routes/regulatory.ts:1131-1141`).
- **Paginação uniforme**: cursor composto `{before_created_at, before_id, limit}` → `{rows, nextCursor}` (`regulatory/service.ts:98,448`).
- `POST /v1/regulatory/risk-classifications/evaluate` é **computação pura sem persistência** (preview de classificação) — `routes/regulatory.ts:2737`.
- **Eixo crucial**: tudo isso é *evidência de governança, não enforcement de runtime* — "no runtime gateway block", `docs/architecture/current-state.md:139-156` (ex.: prohibited-use `DENIED` = evidência, `:152`).

### 1.3 Superfícies de escrita (o que o usuário FAZ)

| Ação | Rota | Quem pode | Observações de contrato |
|---|---|---|---|
| Executar um run governado/passthrough | `POST /v1/runs` | qualquer chave válida | `{workspace_id, capability, model, input, mode?}`; resposta `RunResponse{run_id, audit_chain_id, audit_event_id, policy_decision{kind,reasons[]}, output?, status}`; `denied→403`, `failed→502` (`routes/runs.ts:19-103`; `pipeline/run-orchestrator.ts:77-87`) |
| Chamar o provedor nativo governado | `POST /governed/anthropic/v1/messages`; `POST /governed/openai/v1/responses`; `POST /governed/openai/v1/chat/completions` | qualquer chave válida | corpo nativo byte-perfeito; resposta carrega `x-govai-capability-level`, `x-govai-effective-risk-class`, `x-govai-enforcement-decision` (`provider-anthropic/src/governed/register-governed.ts:69,134-136,169-171`; `provider-openai/src/governed/register-governed.ts:86,113,129,174`); suporta SSE streaming |
| Chamar o provedor nativo observado | `/passthrough/anthropic/*`, `/passthrough/openai/*` (wildcard) | qualquer chave válida | espelho da API nativa (messages, models, files…) — `provider-anthropic/src/routes/register-passthrough.ts:175`; `provider-openai:179` |
| Criar workroom | `POST /v1/workrooms` | `developer` ou `admin` (`workrooms.ts:195-198`) | cria policy profile + primeiro participante `human_owner` + evento `workroom.lifecycle`, tudo numa transação (`:179-368`); org pode proibir `audit_only` (`:220-233`) |
| Gerir participantes | `POST /v1/workrooms/:id/participants`; `DELETE …/:participantId` | add: `human_owner` ativo ou `admin` (`:543-562`); remove: só `human_owner` (`:739-756`) | duplicata ativa → `409` (`:604-612`) |
| Registrar transcript | `POST /v1/workrooms/:id/messages`; `POST …/tasks` | participante ativo | conteúdo **envelope-cifrado at rest**; a linha guarda só `content_ref`+`payload_hash` (`workroom-transcript.ts:15-18,215-222,298-317`); task tem `risk_class` + `requires_approval` (`:52-58`) |
| Rodar dentro da sala | `POST /v1/workrooms/:id/runs` | participante ativo | matriz de modo: `governance_active` default `governed`, override `passthrough` **só com aprovação** (`mode_relation: override_approved`); `audit_only` default `passthrough`, `governed` = upgrade sempre admitido (`workroom-runs.ts:145-191,301-342`) |
| Pedir aprovação | `POST /v1/workrooms/:id/approvals` | participante ativo | vinculada ao `intended_action_hash` da ação exata; intended-run cifrado at rest (`workroom-approvals.ts:15-19,249-439`) |
| Decidir aprovação | `POST …/approvals/:id/decisions` | `human_owner` ou `human_approver` **participante** (chave `admin`/`auditor` sozinha NÃO decide, `:709-727`) | grant/deny; negação exige razão (`:685-688`); **separação de deveres**: quem pediu não decide (`:759-766`); lock `FOR UPDATE` + `409` para corrida (`:729-756`) |
| Revogar aprovação | `POST …/approvals/:id/revoke` | requerente ou `human_owner` (`:971-980`) | |
| Registrar/gerir o núcleo regulatório | `POST/PUT` nos ~61 caminhos, incl. `submit`/`cancel`/`decisions`/`determinations` | `admin` ou `data_protection_officer` | workflows com máquina de estados (high-risk review; prohibited-use) |
| Credenciais de provedor | `POST /v1/admin/provider-credentials`; `POST …/:id/revoke` | `admin` | plaintext só entra, nunca sai; evento de auditoria em cada set/revoke (`admin-provider-credentials.ts:1-16,105,224-227`) |
| (stubs 501) | `POST /v1/admin/dlp-detectors`; `POST /v1/admin/audit-events/:id/crypto-shred` | `admin` | autenticam e exigem admin antes do 501; shape fixo de 501 (`_not-implemented.ts:20-29`) |

### 1.4 Convenções do contrato que o data-layer da UI precisa absorver

- **Três estilos de paginação coexistem**: keyset por `before_seq` (audit-events, workroom audit/evidence), cursor composto `{before_created_at, before_id}` (workrooms, approvals, runs, todo o regulatory), e offset numérico `cursor` (evidence/gaps). `[recomendação]` normalizar num único hook de paginação client-side com três adaptadores.
- **Números**: `Ec2GapRow.first_gap_seq/gap_count` são **strings decimais** de propósito (bigint pode exceder 2^53; `evidence-reports.ts:248-253`) — a UI nunca deve `Number()`-coagir esses campos.
- **Binário como hex**: todos os hashes/HMACs chegam hex; datas em ISO-8601.
- **Erros**: envelope uniforme `{error: <código>, …}` + `issues[]` de Zod para 400; `auth_error` para 401; cross-tenant é 404.
- **Headers de governança** na resposta governed (1.3) — é o único lugar onde a decisão por request chega ao cliente.
- **Streaming**: governed/passthrough repassam SSE (`forwardStream`, `handle-messages.ts:312-383`).
- **Não há OpenAPI/Swagger** no repo (busca vazia); os shapes vivem em Zod inline nas rotas.

### 1.5 O que a governança REALMENTE faz hoje (verificação independente da nota do briefing)

Confirmei na fonte, item por item, a nota F2a do briefing — e ela está correta, com uma precisão extra:

1. **O único caminho de bloqueio real (403) no fluxo governado** é `toolBlock !== null || enforcement_decision === 'blocked'` (`provider-anthropic/src/governed/handle-messages.ts:258-303`). Todos os outros modos — `observe`, `warn`, `ask`, **e também `enforce` e `sandbox_required`** — resultam em **encaminhamento ao provedor** com a decisão anotada no evento e nos headers. A precisão extra: `resolveGovernance` **descarta** `side_effects`/`preconditions` do `computeEnforcement` (retorna só `enforcement_decision`, `resolve-governance.ts:146-158`) — ou seja, nem "DLP obrigatório" nem "sandbox requerido" têm efeito de runtime hoje; são intenção declarada, não verificada.
2. **Matriz de produção** (`enforcement.ts:62-81`): `blocked` só para risco efetivo `E` (qualquer tier) ou `D`+`starter`. `D`+`business` → `sandbox_required` (encaminha); `D`+`enterprise/regulated` → `enforce` (encaminha); `C`+`starter` → `ask` (encaminha); `C`+demais → `enforce` (encaminha). `dev/test` → `observe` sempre; `pilot` relaxa um degrau (`:83-91`).
3. **PII forte não bloqueia no caminho governado**: capacidades governadas de mensagens têm `base_risk_class:'A'` (`provider-anthropic/src/capabilities/index.ts:15,29`; OpenAI idem, `provider-openai/src/capabilities/index.ts:19-79`); CPF/CNPJ escala `A→C`, `B→C`, `C→D` (`resolve-governance.ts:77-101`) — de base A o teto é C. Org `starter` em produção mandando CPF: `C`+`starter` → `ask` → **encaminhado**, com header `x-govai-enforcement-decision: ask` e `dlp_decisions[].action:'warn'` no evento (`handle-messages.ts:230-240`). O CPF vai ao provedor.
4. **O que de fato dá 403 em produção**: (a) ferramenta `bash_\d{8}` (classe D, `tool-classifier.ts:26,93-94`) numa org `starter` → `enforcement_blocked:D`; (b) ferramentas bloqueadas na validação (`blocked_at_validation` → `tool_blocked:…`, `tool-classifier-hook.ts:2-3,49-69`); (c) risco efetivo E. Há ainda um piso: computer-use hospedado nunca desce de `sandbox_required` (`enforcement.ts:94-102`) — que, como visto, encaminha.
5. **Os campos fixos que a revisão de correção vai corrigir**: `credential_source: 'tenant_provider_credential'` é literal em TODOS os caminhos de evento — governed Anthropic (`handle-messages.ts:283,351,416`), governed OpenAI (`handle-chat-completions.ts:185,244,308`; `handle-responses.ts:256,315,379`), passthrough dos dois (`provider-anthropic/src/routes/register-passthrough.ts:401,407,476,482`; `provider-openai/src/routes/register-passthrough.ts:461,467,537,543`) — mesmo quando a credencial real veio de env (`dev/test`, `provider-credentials.ts:161-177`). `enforcement_decision: 'observe'` é literal no passthrough. A UI deve ser desenhada contra o **contrato corrigido** (valor real da origem da credencial e da decisão), e não exibir esses dois campos como verdade enquanto a correção não aterrissar.
6. **Regulatório é evidência, não enforcement** (`current-state.md:133,139-156`): um `DENIED` de prohibited-use não bloqueia request nenhuma hoje. Runtime enforcement é a Fase 5 do roadmap (`development-roadmap.md:74-81`).

### 1.6 Lacunas do contrato (o que a UI precisaria e ainda não existe)

Em ordem do que mais dói para uma interface:

1. **Não há leitura de conteúdo de transcript.** `POST /messages` cifra o conteúdo e guarda `content_ref`; não existe `GET /messages` nem endpoint de decrypt-read (`workroom-transcript.ts:6-10,15-18`). Uma vista de conversa da sala é impossível hoje; só a timeline de metadados via `/audit` + `/evidence`. (O doc da sala já prevê "replay/rehydration" e "transcript export" como futuros — `workroom-governance-room.md:976-978`.)
2. **Não há feed por-request de governança.** A decisão por request (`enforcement_decision`, classes de risco, latência) vive no evento de runtime, mas o capture outbox persiste **só o hash** da projeção (`payloadEncrypted: null`, `pipeline/audit-bridge.ts:210`; `redaction_metadata` mínimo `:214-223`; latência etc. vão para log, `:241-251`). `/v1/audit-events` devolve hashes, não campos. Para runs path-A existe `govai.policy_decisions` persistida (`migrations/0002:43-54`), mas **não há GET de runs standalone** (`routes/runs.ts` é POST-only) — só o list por workroom. Resultado: a pergunta "o que a governança fez nas minhas últimas 100 chamadas?" não tem rota hoje.
3. **O cockpit cross-org do operador não tem rota HTTP.** `buildOperatorCockpit`/`OperatorCockpitView` existem como funções (`evidence-operator.ts:103-166`) mas alimentam apenas gauges OTel no boot (`server.ts:118-154`) → Grafana. Coerente com o desenho (operador ≠ tenant), mas se o dono quiser operador *no produto*, é rota nova + autorização de operador.
4. **Verificação de cadeia sob demanda**: EC-6 é sempre `pending` (sem verificação persistida nem rota que dispare `verify`) — `evidence-reports.ts:466-469`. Um botão "verificar cadeia agora" exigiria EP backend.
5. **Gestão de usuários/chaves**: inexistente via API (1.1). Uma UI multi-usuário de verdade precisa disso — hoje o modelo é "uma chave por pessoa/função, emitida por CLI".
6. **Dossiês/relatórios de prontidão**: `DOCUMENTED_TARGET_ONLY` (`current-state.md:155`); relatórios nativos são P1 na doutrina (`19-build-vs-integrate-strategy.md:139-140`) mas não existem como rota.
7. **Contrato tipado para o cliente**: sem OpenAPI e com Zod inline nas rotas, não há hoje artefato importável de tipos para um frontend.
8. **Rate limit hostil a browser**: 100/min global em produção (`server.ts:102-105`) — um dashboard com meia dúzia de painéis + navegação consome isso rápido.
9. Stubs 501 (DLP CRUD, crypto-shred) e o run `shadow` rejeitado (`runs.ts:47-54`) — a UI não deve prometê-los.

---

## PARTE 2 — Recomendação de arquitetura

### 2.1 Construir vs. integrar → **construir a interface própria; manter Grafana só para o operador** `[recomendação]`

O doc `19-build-vs-integrate-strategy.md` já rotula "Native reports and dashboards" como `BUILD_NATIVE_CORE` e o "Audit-readiness cockpit" como `BUILD_NATIVE_ENHANCED` (`:139-140`), proibindo ferramenta externa como pré-requisito (`:169-177`) — mas, como o briefing pede, confrontei a doutrina com o contrato, e o contrato **independentemente** decide na mesma direção, por três razões:

1. **O centro de gravidade do contrato é workflow interativo, não visualização.** Aprovações com separação de deveres, TOCTOU e consumo one-time (`workroom-approvals.ts:729-766`), matriz de modo com override aprovado (`workroom-runs.ts:145-191`), máquinas de estado regulatórias (submit/cancel/decisions), credenciais set/revoke. Ferramenta de BI é read-only por natureza; nenhuma cobre isso.
2. **A fronteira de tenancy vive na API, não no banco acessível.** Todo o desenho impede leitura SQL cross-org (RLS FORCE; até o operador acumula leituras single-org, `evidence-operator.ts:1-22`). BI clássico quer SQL direto — plugá-lo criaria exatamente o bypass que a arquitetura gastou os EP-008D/EVIDENCE-GAUGE-WIRING evitando. E os dados via Prometheus (gauges `govai_evidence_*` por `org_hash` de todas as orgs) são **cross-org por construção** — servem ao operador, jamais podem virar painel de tenant.
3. **A separação produto/operador já foi decidida e implementada**: tenant lê `/v1/evidence/*` por chave RLS; operador lê gauges no Grafana (stack OTLP/Prometheus/Grafana já existente no repo, `server.ts:116-154` + `deploy/`). Integrar BI para tenant duplicaria a superfície de leitura com semântica de segurança pior.

Trade-off explícito: construir custa telas (o regulatory sozinho são ~16 recursos CRUD). Mitigação em 2.2 (padrão único de tabela+formulário reaproveitado) e em 2.6 (ordem que entrega valor antes do volume).

### 2.2 Tecnologia → **SPA estática (React + TypeScript + Vite) num `apps/ui` do monorepo, sem servidor de UI** `[recomendação]`

O que o contrato favorece, ponto a ponto:

- **Auth por header de chave, sem cookie/sessão** `[confirmado, 1.1]` → SSR/full-stack (Next/Remix/SvelteKit) obrigaria a UI a ter um servidor que **custodia a chave** para renderizar no server — uma peça de segurança nova que hoje não existe em lugar nenhum do sistema. Uma SPA mantém a chave no browser do usuário (memória), mesma postura de confiança do `curl` atual.
- **Zero conteúdo público** `[confirmado — tudo atrás de auth por org]` → os dois argumentos clássicos de SSR (SEO, first-paint anônimo) não se aplicam.
- **Dados = agregações já computadas no servidor + listas keyset** `[confirmado, 1.2]` → o padrão é fetch-and-render com cache por query (TanStack Query ou equivalente), invalidação por mutação, e os três adaptadores de cursor (1.4). Nada aqui pede estado global pesado nem renderização no servidor.
- **Monorepo pnpm TS-source-only** `[confirmado — pacotes exportam `./src/*.ts`]` → um `apps/ui` importa tipos direto de um pacote de contrato. Passo habilitador barato: extrair os Zod schemas de resposta/corpo das rotas para `packages/api-contract` (hoje estão inline, ex.: `evidence.ts:32-41`) e importá-los dos dois lados. Isso dá tipagem ponta-a-ponta **sem** gerador OpenAPI. (Alternativa: `@fastify/swagger` + geração de client — mais tooling, menos aderente ao estilo do repo.)
- **Deploy**: o repo já tem o padrão esbuild+Docker multi-stage do sealer (EP-SEALER-DEPLOY); a UI compila para estático e é servida pelo mesmo reverse proxy da API (same-origin → CORS nem entra em cena) ou por origem própria usando o CORS já existente (`server.ts:94-98`).
- **SSE**: streaming governado chega como SSE — `fetch` + `ReadableStream` no browser cobre, sem intermediário, se/quando um "playground" for desejado.
- A escolha **forte e cara de reverter** é "SPA estática consumindo a API direta". A escolha de framework é **fraca e reversível**: recomendo React pelo ecossistema de tabelas/formulários/a11y e pela contratabilidade, mas Svelte/Vue não mudariam a arquitetura. O doc da sala já previa `apps/ui-*` e fixa a regra de ouro: "a UI liga 1:1 à API; nenhum campo é inventado client-side; nenhum estado 'draft' vive só em localStorage" (`workroom-governance-room.md:907-909`) — adoto como invariante.

Trade-offs explícitos considerados e rejeitados:
- **Next/Remix (SSR/full-stack)**: ganharia streaming de HTML e cookies httpOnly de fábrica; perde por criar custódia server-side de credencial e um segundo runtime Node para operar — sem benefício de SEO/first-paint que o justifique. Se um dia a sessão-por-cookie virar requisito (2.3), o lugar dela é o `apps/api`, não um servidor de UI.
- **Ferramenta de admin low-code (Retool/Appsmith) como produto**: viola a doutrina (pré-requisito externo) e não representa honestidade de governança nem SoD de aprovação. No máximo, uso interno do dono para depuração.

### 2.3 Fronteira com o backend → **consumir as rotas Fastify diretamente; não criar BFF** `[recomendação]`

- O backend **já é** o "backend-for-frontend": agregações prontas (`evidence-reports.ts`), paginação, RBAC e RLS na transação. Um BFF adicionaria um salto de rede, um segundo lugar para errar autorização e nenhuma agregação que o Fastify não possa ganhar como rota nova (como foi feito em EP-008D).
- Três atritos reais existem e têm resposta mais barata que um BFF `[confirmado na fonte + recomendação]`:
  1. **Custódia da chave no browser.** Fase 1: chave em memória (nunca `localStorage`), campo de colar chave, aviso claro — aceitável para o dono/operador como primeiro usuário. Cedo (antes de multiusuário): EP pequeno no `apps/api` de **troca chave→JWT curto** com cookie `httpOnly` — `core-identity/src/jwt.ts` já existe e `auth.ts:2` indica o caminho previsto; `API_CORS_CREDENTIALS` já existe para isso (`config/src/index.ts:30`).
  2. **Rate limit 100/min por processo** (`server.ts:102-105`): para uma UI real, mudar para limite por chave/org e/ou subir o teto — mudança backend de poucas linhas, anotar como pré-requisito da Fase U1 em produção.
  3. **N+1 do cockpit**: a página de evidência faz 1×`summary` + k×`gaps`. Dentro do limite ajustado, aceitável; se doer, a resposta é uma rota agregadora nova no Fastify, não um BFF.
- **Nunca** dar à UI acesso a Postgres, Prometheus ou Grafana de tenant (2.1, razão 2).

### 2.4 Multi-tenancy e permissões na interface `[recomendação, sobre fatos de 1.1]`

- **A org nunca é escolhida na UI** — deriva da credencial apresentada. Não existe (e não deve existir) seletor de org; o `org_id` presente nas respostas (`evidence.ts:88`) serve para exibição e sanity-check ("esta sessão é a org X"), não para filtrar.
- **Navegação e ações derivam de `roles` da chave**: `admin` → admin + tudo; `data_protection_officer` → escrita regulatória; `auditor` → subviews de auditoria e leitura de aprovações; `developer` → criação de workroom. Importante: dentro da sala a autorização é **por participação** (`human_owner`/`human_approver`), não por role global — uma chave `admin` sem participação não decide aprovação (`workroom-approvals.ts:709-727`). A UI deve modelar esses dois eixos separadamente (role global × papel na sala) para não prometer botões que o backend negará.
- **`tier` e `operational_mode` são rótulos read-only** (badges), jamais formulário. Confirmado que nenhuma rota os muta (1.1) — são controle de OPERADOR que desliga enforcement e comuta credencial; expô-los a tenant para mutação seria dar ao tenant o interruptor da própria governança. A UI deve, isso sim, **exibi-los com consequência**: um badge `pilot`/`dev` deve dizer "enforcement relaxado/desligado neste modo" (`enforcement.ts:83-91`).
- **A UI não é camada de segurança; é camada de honestidade.** O backend continua a única fronteira (RLS + roles); a UI esconde o que seria negado (para UX) e explica o que foi decidido (para verdade). Cross-tenant já chega como 404 — a UI não precisa (nem consegue) filtrar org.

### 2.5 Apresentação honesta da governança `[recomendação, sobre fatos de 1.5]`

Regra central: **a UI mostra a decisão como ela é — anotação observacional na maioria dos níveis; bloqueio só onde houve 403.** Concretamente:

1. **Vocabulário fixo por `enforcement_decision`** (do evento/headers), sem sinônimos criativos:
   - `observe` → "Observado — encaminhado ao provedor"
   - `warn` → "Alerta registrado — encaminhado"
   - `ask` → "Aprovação recomendada — **encaminhado** (não retido)" — hoje `ask` não segura a request no caminho direto
   - `enforce` → "Política registrada — **encaminhado**" (não "aplicada": os side-effects são descartados hoje, `resolve-governance.ts:153-158`)
   - `sandbox_required` → "Sandbox requerido — **encaminhado**; precondição declarada, não verificada em runtime"
   - `blocked` / `tool_blocked:*` → "Bloqueado (403)" — os únicos casos com efeito material (`handle-messages.ts:258-303`)
   Nunca renderizar "enforced/bloqueado" para `ask`/`enforce`/`sandbox_required`. Sempre que a request foi ao provedor, dizer isso literalmente.
2. **PII**: exibir `dlp_decisions` como *detecção* (`action:'warn'`, `handle-messages.ts:230-240`) com a frase dura: "CPF detectado; a request foi encaminhada ao provedor". `risk_escalation_reasons[]` (`dlp:cpf:pii_strong`, `tool:…`) é a trilha explicativa pronta para tooltip/detalhe.
3. **Dois eixos, duas cores de selo**: "runtime" (enforcement acima) vs. "evidência regulatória" — telas do `/v1/regulatory/*` carregam selo permanente "registro de evidência; não bloqueia execução" (`current-state.md:139-156`), até a Fase 5 do roadmap existir.
4. **Workroom `audit_only`**: indicador de modo permanente e **não-dismissível**, exigência da própria spec (`workroom-governance-room.md:906-909`); `mode_relation` (`defaulted/explicit/upgrade/override_approved`) aparece na linha do run.
5. **Cockpit de evidência**: EC-6 renderiza `pending` com a `note` do backend (nunca verde por ausência de verificação); `coverage_ratio` sempre com `terms[]` e `excluded[]` visíveis; `ec3drop` com o `bound` textual e "coletor OTLP é a fonte autoritativa". O contrato já entrega essas ressalvas prontas (1.2) — a UI só não pode escondê-las.
6. **Campos em correção**: não exibir `credential_source` (e não confiar em `enforcement_decision` de passthrough) até a correção aterrissar (1.5.5); construir os tipos da UI já contra o contrato corrigido, com os dois campos marcados como "aguardando fix" no pacote de contrato.

### 2.6 Ordem de construção `[recomendação]`

**U1 — Cockpit de evidência do tenant (primeira entrega; rotas 100% prontas).** Colar-chave → `summary` (tiles por invariante + coverage com exclusões) → drill-down `gaps` por invariante → `audit-events` por categoria de cadeia → `capabilities`. Por quê primeiro: valida a arquitetura inteira (auth por chave, data-layer com os três cursores, vocabulário de honestidade, deploy) sem nenhuma escrita e sem nenhum EP backend novo; é read-only, então o custo de errar é mínimo; e é a vitrine do produto ("governança com evidência") com o menor caminho até demonstrável. Pré-requisito de produção: ajuste do rate limit (2.3).

**U2 — Console de Workroom (o coração interativo).** Lista/criação/detalhe da sala, participantes, runs com `mode_relation`, e a fila de aprovações (pending → decidir com SoD → revogar → ver consumo `consumed_run_id`). A timeline da sala nasce de `/audit` + `/evidence` (metadados) — honesta sobre "conteúdo cifrado at rest". A vista de conversa de verdade espera o EP backend de leitura de mensagens (lacuna 1.6.1) — decisão do dono, com peso de segurança próprio (decrypt-read autorizado por participação).

**U3 — Bancada regulatória.** Os ~16 recursos CRUD + workflows high-risk/prohibited-use, sobre UM padrão de tabela-com-cursor + formulário gerado dos schemas do pacote de contrato; `risk-classifications/evaluate` vira "simular classificação" (compute puro, ótimo para UX). Volume alto de telas, mecânica repetitiva — por isso vem depois do padrão estar provado em U1/U2.

**U4 — Admin.** Credenciais de provedor (set/rotate/revoke/list); depois gestão de chaves/usuários **quando** houver rota (lacuna 1.6.5).

**EPs backend que a UI vai puxar, em ordem de dor** (todos pequenos e independentes): (1) rate limit por chave; (2) sessão chave→JWT; (3) `GET` de transcript com decrypt autorizado; (4) feed por-request de governança — persistir a projeção legível do capture (hoje só hash, `audit-bridge.ts:210`) ou expor um join `provider_invocations`+`runs`+`policy_decisions`; (5) pacote `@govai/api-contract`; (6) rota HTTP do cockpit de operador **somente se** o dono quiser operador no produto — senão Grafana segue sendo a resposta certa.

### 2.7 Decisões em aberto para o dono

1. **Leitura de conteúdo de transcript** (U2): expor decrypt-read por participação/auditor, ou manter o produto metadado-only? Muda o desenho da tela principal da sala.
2. **Sessão JWT vs. chave-no-browser permanente**: quando a UI sair do "dono como único usuário", a troca chave→JWT vira prioridade.
3. **Operador no produto ou no Grafana**: o contrato atual diz Grafana; trazer para o produto é rota nova + modelo de autorização de operador (INV-1 já aponta o caminho: enumeração ≠ leitura).
4. **Feed por-request**: é a lacuna que separa "cockpit de invariantes" de "console de atividade". Envolve decidir persistir campos hoje deliberadamente não-persistidos — decisão de plano de evidência, não de UI.

---

**Resumo executivo.** O contrato real é: leitura agregada de evidência pronta e honesta por construção; um workflow interativo rico (workroom/aprovações) com autorização em dois eixos; um registro regulatório CRUD extenso e uniforme; auth por chave de API com org derivada da credencial e RLS na transação; e lacunas nítidas (transcript ilegível, sem feed por-request, sem cockpit HTTP de operador, sem gestão de chaves, sem OpenAPI). Esse contrato pede **UI própria** (doutrina e contrato concordam), como **SPA estática em `apps/ui` consumindo o Fastify direto** com tipos compartilhados pelo monorepo, tenancy herdada da credencial (nunca selecionada), `tier`/`operational_mode` como rótulos de operador read-only, um vocabulário fixo que só chama de "bloqueado" o que retornou 403 — e a ordem de construção começa pelo cockpit de evidência do tenant, porque é onde as rotas já existem e onde a honestidade do produto se prova primeiro.
