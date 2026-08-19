> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** PLAN_TARGET
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-07 at f975533d, Briefing #5)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D11B=APPROVED_AS_PLAN_TARGET)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `e87bf8c037b8b707c595827945c3431d2cc1fb0198de94bbb9164fdcd9e35683` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** PLAN TARGET (D11b) for a UI layer that does NOT exist at the Foundation V1 anchor (`apps/ui` absent; no human auth/session/API-key lifecycle for a production human UI). Body byte-preserved (large-document policy: no rewrite). KNOWN-STALE FAMILIES IN THE BODY, all superseded at the Foundation V1 anchor — read them as the July 2026 snapshot: (a) F1–F6 marked "pendente / até o fix" → F1, F3, F4, F5, F6 and C-2 are CORRECTED (PRs #118/#119/#120/#123) and F2 is CLOSED as an evidence-granularity residual (not a runtime defect); (b) the pre-M1 hard-deny floor ("3 tool validation classes + 3 hard_denied beta tokens", default-deny betas, `capability_planned`/`typed_unknown` 403s) → SUPERSEDED by the M1 native contract (ADR-021 Accepted): only provider-hosted computer-use is hard-denied, unknown/unresolved betas and non-computer tools are forwarded and observed; (c) EP-11 framed as "add the deny audit event / external deadline" → SUPERSEDED by ADR-032/EP-11 (the local deny was REMOVED, provider truth preserved); (d) `dispatch_status`/G-17 "coupled to F3" → realized by the P0.3-A durable dispatch layer (migration 0029) and P0.3-C run idempotency (0030) in a different shape; (e) D9 "pendente" → executed by M3; (f) migration/test/route counts and `arquivo:linha` anchors → current counts live in `docs/architecture/current-state.md`. Statements consistent with the anchor and still true: no UI exists; Phase 5 ask/sandbox/enforce primitives are NOT implemented (recommendation vs applied is honest over HTTP); no branch protection; hash-only capture. Note the namespace collision: "F1–F6" in Cap. 2.3 and later name USER FLOWS, not the P0 fixes.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** VISÃO-ALVO CANÔNICA — arquitetura de UI adotada sem reparo
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Faseamento comercial regido pelo Mapa §4.2 (U1 já; U2–U4 por demanda); vocabulário de redação LIBERADO pós-#118.
> **ORIGEM:** handoff to-chat/
> ---

# GOVAI — PLANO-MESTRE DA CAMADA DE INTERFACE (documento-mestre de execução)

**Base:** `github.com/mauriciodesouzaads/govai-platform` @ `f975533d122afab251742c9459a12acc095dd8fb` (tarball baixado e lido nesta sessão; toda âncora `arquivo:linha` abaixo foi verificada na fonte deste commit, salvo marcação em contrário).
**Briefing:** `to-codex/BRIEFING-5-FABLE5-UI-MASTER-PLAN_f975533d.md` (rev2).
**Autor:** Fable 5 / Claude Code, 2026-07-07.
**Método:** li a fonte (rotas, pipeline de evidência, resolvedor de governança, classificadores de ferramenta, registries de capacidade, auth/RLS, schema do evento selado, config, CI, infra) e os quatro pareceres anteriores da série (auditoria de correção F1–F6; decisões de design Q1–Q4; reconciliação documental; arquitetura de UI). Este documento é a **síntese executável** deles — não re-descobre, consolida e completa. **Não executei nada** (nenhum servidor, teste ou chamada HTTP); tudo é leitura estática.

**Convenções de marcação (valem para o documento inteiro):**
- `[confirmado na fonte]` — fato lido neste commit, com `arquivo:linha`.
- `[recomendação]` — decisão de design/arquitetura proposta, com o raciocínio.
- `[contrato corrigido — pendente do fix]` — campo/comportamento sob correção pela fase paralela de fixes (F1–F6); o plano descreve o **alvo pós-fix**, nunca o defeito como se fosse o alvo.
- `[lacuna]` — o que a UI precisaria e não existe no backend; vira EP (Cap. 5).
- `[do parecer X]` — fato herdado de um parecer anterior da série (verificado na fonte naquela sessão, no mesmo commit), que esta sessão não re-verificou linha a linha.

**★ A regra geral do contrato corrigido.** O commit `f975533d` é PRÉ-correção de seis defeitos confirmados (F1–F6, consolidado de 2026-07-06). Os que tocam o contrato da UI:
- **F1 `credential_source`** — hoje literal fixo `'tenant_provider_credential'` em todos os caminhos de evento (`packages/provider-anthropic/src/governed/handle-messages.ts:283,351,416` `[confirmado na fonte]`; equivalentes OpenAI e passthrough `[do parecer de correção]`; passthrough Anthropic `register-passthrough.ts:407,482` `[confirmado na fonte]`). Alvo: enum derivado do resolvedor — `tenant_provider_credential | platform_env_key | hermetic_placeholder | none`. **A UI não exibe este campo até o fix aterrissar.**
- **F2 `enforcement_decision` no caminho de bloqueio** — hoje o evento grava `'blocked'` fixo mesmo quando o gatilho foi validação de ferramenta (`handle-messages.ts:278` `[confirmado na fonte]`), enquanto o corpo HTTP ao cliente carrega a decisão real (`register-governed.ts:117-121` `[confirmado na fonte]`). Alvo: o evento grava a decisão REAL da matriz + `block_trigger ∈ {tool_validation, enforcement_matrix}` + `block_reason`. **A UI consome a decisão real + o gatilho; até lá, para eventos de bloqueio, trata `enforcement_decision` como não-confiável e deriva o rótulo do 403/`body_forward_mode='blocked'`.**
- **F5 redação de PII (`redactFindings`)** — QUEBRADA hoje: achados sobrepostos corrompem o texto e vazam PII em claro `[do parecer de correção]`. **Nenhuma tela ou indicador afirma "PII redigida/protegida/removida" como capacidade entregue até o fix; a redação é sempre "pendente do fix (F5)".**
- **F6 contagens infladas por sobreposição de detectores** — `findings_count`/`finding_classes` podem super-contar o mesmo span `[do parecer de correção]`. A UI rotula contagens de DLP como "detecções (podem sobrepor)" até o fix.
- (F3 transação-aberta-durante-fetch e F4 `enterWith` são correções de backend sem campo de UI; afetam a UI apenas via disponibilidade e completude de evidência.)

Além dos fixes, o parecer de design (Q1–Q4) fixou posturas que este plano adota como **direção**: (Q1) um futuro campo derivado-de-fato `enforcement_mode: 'enforcing'|'observational'` `[recomendação do parecer de design — não implementado]`; (Q2) a decisão de DLP converge (deny primeiro) entre `/governed/*` e `/v1/runs`; (Q3) campo de evento ou é derivado-por-construção ou não existe; (Q4) `tier`/`operational_mode` são plano de controle do OPERADOR — a UI de tenant **nunca** os expõe para mutação.

---
---

# Capítulo 1 — Visão de produto e arquitetura de sistema

## 1.1 O que o produto É

**Uma frase de posicionamento:** *GovAI é um plano de governança para chamadas de LLM — um gateway que registra cada invocação de provedor como evidência selada criptograficamente e verificável, aplica política onde ela é real, e diz a verdade sobre onde ainda não é.*

O centro de gravidade é **evidência com honestidade embutida**, não bloqueio: no runtime de hoje, a maioria das decisões de enforcement é observacional (anotada e encaminhada), o bloqueio material existe em vetores específicos (Cap. 3.4), e o registro regulatório inteiro é *evidência de governança, não enforcement de runtime* — "DENIED = evidence, not a runtime block" (`docs/architecture/current-state.md:152` `[confirmado na fonte]`; enforcement de runtime é a Fase 5 do roadmap, `docs/architecture/development-roadmap.md:74-81` `[confirmado na fonte]`). A UI nasce para tornar essa evidência **legível, navegável e honesta** — ela é a vitrine da tese, e por isso o vocabulário de honestidade (Cap. 3.4) é um artefato de primeira classe do produto, não um detalhe de copy.

## 1.2 Quem são os usuários (roles e eixos de autorização)

**Roles globais da chave de API** — `Role = 'admin' | 'data_protection_officer' | 'dlp_admin' | 'developer' | 'auditor'` (`packages/core-identity/src/rbac.ts:1` `[confirmado na fonte]`):

| Role | Persona | O que o backend permite hoje `[confirmado na fonte]` |
|---|---|---|
| `admin` | Operador do tenant | Tudo: admin de credenciais (`admin-provider-credentials.ts:8`), escrita regulatória (`regulatory.ts:1131-1141`), criação de workroom (`workrooms.ts:195`), subviews de auditoria (`workroom-transcript.ts:698`) |
| `data_protection_officer` | DPO / conformidade | Escrita regulatória (`regulatory.ts:1131-1141`) + toda leitura |
| `dlp_admin` | Admin de DLP | **Reservado** — nenhuma rota o consulta hoje (grep vazio em `routes/`); o CRUD de detectores DLP é stub 501 gated em `admin` (`admin-dlp.ts:26,40`). A UI não lhe dá navegação própria ainda |
| `developer` | Engenheiro do tenant | Criar workrooms (`workrooms.ts:195-197`) + toda leitura + execução |
| `auditor` | Auditor interno/externo | Subviews de auditoria de sala (`workroom-transcript.ts:697-700`), leitura de aprovações/runs de qualquer sala (`workroom-approvals.ts:476,589`; `workroom-runs.ts:500`) + todo o cockpit de evidência |

**Fato estrutural:** o cockpit de evidência **não tem gate de role** — "the auditor IS the tenant: no new role, the caller sees only its own org" (`routes/evidence.ts:3-4` `[confirmado na fonte]`). Qualquer chave válida da org lê `/v1/evidence/*`, `/v1/audit-events`, `/v1/capabilities`, leituras regulatórias.

**O segundo eixo: papel NA SALA (workroom).** Dentro de uma workroom a autorização é por **participação**, não por role global: decidir aprovação exige participante ativo `human_owner` ou `human_approver` (`workroom-approvals.ts:720-725` `[confirmado na fonte]`) — uma chave `admin` sem participação **não decide**; quem pediu **nunca** decide a própria aprovação (separação de deveres, `workroom-approvals.ts:757-764` `[confirmado na fonte]`). A UI modela os dois eixos separadamente (Cap. 2.4) para nunca prometer um botão que o backend negará.

**O terceiro rótulo: a org.** `tier ∈ {starter, business, enterprise, regulated}` e `operational_mode ∈ {production, pilot, dev, test}` são atributos da org resolvidos na autenticação (`apps/api/src/pipeline/auth.ts:12-13,76-89` `[confirmado na fonte]`), **imutáveis por qualquer rota** (grep vazio de mutação `[confirmado no parecer de design]`) e determinantes do enforcement (Cap. 3.4). São controle do operador da plataforma (Q4). Na UI: **badges read-only com consequência explicada** — e note a lacuna: **nenhuma rota devolve `tier`/`operational_mode`/`roles` ao cliente hoje** (grep em `routes/*.ts`: `tier`/`operational_mode` só aparecem como campos de dados regulatórios; `roles` só em gates — `[confirmado na fonte]`). Exibi-los exige o EP "whoami" (Cap. 5.2, EP-B2).

## 1.3 A arquitetura técnica escolhida e por quê

**Decisão (do parecer de UI, adotada como fundação):** **SPA estática (React + TypeScript + Vite) em `apps/ui` no monorepo pnpm, consumindo o Fastify diretamente. Sem BFF. Sem SSR.** `[recomendação]`

Recapitulando o porquê, ancorado no contrato:

1. **A fronteira de tenancy vive na API/RLS, não em um servidor de UI.** Toda leitura roda `BEGIN → SET LOCAL app.org_id → query → COMMIT` (ex.: `routes/evidence.ts:80-87` `[confirmado na fonte]`); linha de outra org é invisível — cross-tenant é `404`, "never a data leak" (`routes/workrooms.ts:410-411`; `admin-provider-credentials.ts:13-15` `[confirmado na fonte]`). Um BFF adicionaria um segundo lugar para errar autorização e nenhuma agregação que o Fastify não possa ganhar como rota (o padrão EP-008D).
2. **Auth por chave de API sem sessão/cookie** (`auth.ts:40-92`; JWT existe mas nenhuma rota o usa — `core-identity/src/jwt.ts` presente, `auth.ts:2` "JWT path is wired but exercised via different middleware (out of scope)" `[confirmado na fonte]`). SSR obrigaria um servidor que custodia a chave; a SPA mantém a chave no browser (memória), a mesma postura de confiança do `curl` de hoje.
3. **Zero conteúdo público** — tudo atrás de auth por org; os argumentos de SSR (SEO/first-paint anônimo) não se aplicam.
4. **O backend já antecipa browser:** CORS de primeira classe com guarda de produção (`server.ts:94-98`; `packages/config/src/index.ts:29-30,135-146` `[confirmado na fonte]`) e envelope de erro uniforme.
5. **Monorepo TS-source-only** (pacotes exportam `./src/*.ts`): `apps/ui` entra no workspace existente (`pnpm-workspace.yaml`: `packages/*`, `apps/*` `[confirmado na fonte]`) e importa tipos do futuro `@govai/api-contract` (EP-B7) — tipagem ponta-a-ponta sem gerador OpenAPI (não há OpenAPI no repo; shapes vivem em Zod inline `[confirmado na fonte — ex.: evidence.ts:32-41]`).
6. **A doutrina do repo concorda:** "Native reports and dashboards" = `BUILD_NATIVE_CORE`, "Audit-readiness cockpit" = `BUILD_NATIVE_ENHANCED` (`docs/architecture/regulatory/19-build-vs-integrate-strategy.md:139-140` `[confirmado na fonte]`), com framings proibidos que vetam ferramenta externa como pré-requisito (`:168-177` `[confirmado na fonte]`).

**Stack de frontend** `[recomendação]`:
- **React 18 + TypeScript + Vite** — ecossistema de tabelas/formulários/a11y, contratabilidade; a escolha de framework é fraca/reversível, a escolha forte é "SPA estática contra a API direta".
- **TanStack Query** — o dado do produto é "agregações prontas do servidor + listas por cursor": fetch-and-render com cache por query-key, invalidação por mutação. Nada pede estado global pesado (sem Redux).
- **TanStack Table (headless) + componentes próprios estilo shadcn/ui (primitivas Radix + Tailwind CSS, componentes vendorizados no repo)** — justificativa: (i) controle total do sistema visual (os selos de honestidade e a densidade de dados são o produto — não podem brigar com um tema de biblioteca); (ii) componentes vendorizados = zero churn de dependência de runtime num produto de conformidade; (iii) Radix dá a11y (foco, aria, teclado) de fábrica; (iv) Tailwind casa com tokens em CSS custom properties (Cap. 3.1). Alternativas pesadas (MUI/Ant) rejeitadas pelo custo de sobrescrever tema e pela dependência visual; Mantine seria o segundo lugar aceitável se a velocidade inicial pesar mais que o controle.
- **Zod** no cliente — os mesmos schemas do contrato (quando o EP-B7 extrair) validam respostas em dev/test.
- **SSE nativo** (`fetch` + `ReadableStream`) se/quando o playground governado streaming for desejado — o backend repassa SSE (`register-governed.ts:124-160` `[confirmado na fonte]`).

**A regra de ouro (invariante herdado da spec da workroom):** *"the UI binds 1:1 to the API; no fields are invented client-side; no 'draft' state lives only in localStorage; the mode indicator is not dismissable in `audit_only`"* (`docs/architecture/workroom-governance-room.md:909` `[confirmado na fonte]`). Este plano a promove a invariante de TODA a interface: **a UI nunca inventa um campo, nunca guarda rascunho só em localStorage, e nunca exibe um estado que não veio de uma resposta da API.**

## 1.4 O modelo de tenancy na UI

- **A org NUNCA é escolhida.** Deriva da credencial apresentada (`auth.ts:40-92`). Não existe seletor de org. O `org_id` que as respostas carregam (ex.: `evidence.ts:88,155`) serve para exibição e sanity-check ("esta sessão é a org X"), jamais para filtrar.
- **A chave vive na memória do browser** (nunca `localStorage`/cookie até o EP de sessão JWT — Cap. 8 D2). Recarregar a página = colar a chave de novo. Fase 1 aceita esse atrito deliberadamente.
- **`tier`/`operational_mode` são rótulos read-only com consequência**: um badge `dev`/`test` diz "enforcement de matriz desligado neste modo (observe incondicional)"; `pilot` diz "matriz relaxada um degrau — nunca bloqueia por matriz" (`packages/core-governance/src/enforcement.ts:85-92,53-60` `[confirmado na fonte]`). Nenhum formulário os muta (Q4). Dependem do EP-B2 (whoami) para serem exibidos.
- **Autorização em dois eixos na navegação**: eixo 1 (role global) decide seções visíveis e botões de escrita; eixo 2 (papel na sala) decide ações dentro da workroom. Regra de UX: **esconder o que o role global nega; desabilitar-com-explicação o que o papel na sala nega** (ex.: o requerente vê o botão "Decidir" desabilitado com "separação de deveres: quem pediu não decide" — o estado é informativo, `workroom-approvals.ts:757-764`).
- **A UI não é camada de segurança; é camada de honestidade.** O backend continua a única fronteira (RLS + roles). A UI esconde/desabilita para UX e explica decisões para verdade.

## 1.5 O diagrama de arquitetura

```
                        ┌──────────────────────────── Browser do usuário ────────────────────────────┐
                        │  SPA estática (apps/ui — React+TS+Vite)                                     │
                        │  • chave de API em MEMÓRIA (nunca localStorage)          [Fase 1]           │
                        │  • TanStack Query (cache por query-key) + 3 adaptadores de cursor           │
                        │  • vocabulário de honestidade (honesty.ts) — mapa decisão→rótulo            │
                        └───────┬─────────────────────────────────────────────────────────────────────┘
                                │ HTTPS  x-govai-api-key: <chave>   (ou Authorization: Bearer)
                                ▼
        ┌─── reverse proxy (same-origin: /app → estáticos da UI; resto → API) ── [recomendado, Cap. 7] ───┐
        │                                                                                                  │
        ▼                                                                                                  │
┌──────────────────────────────── apps/api (Fastify 5, Node 24) ────────────────────────────────┐          │
│ helmet + CORS (API_CORS_ORIGINS) + rate-limit 100/min global (server.ts:93-105)               │          │
│ authenticateApiKey → AuthIdentity{org_id,user_id,tier,operational_mode,roles} (auth.ts:40-92) │          │
│                                                                                               │          │
│  Leitura de evidência        Execução governada             Workrooms / Regulatório / Admin   │          │
│  /v1/evidence/*              /governed/{anthropic,openai}/*  /v1/workrooms* /v1/regulatory/*  │          │
│  /v1/audit-events            /passthrough/{...}/* (observe)  /v1/admin/provider-credentials   │          │
│  /v1/capabilities            /v1/runs (orquestrador path-A)                                   │          │
│         │                            │                                │                       │          │
│         │   BEGIN → SET LOCAL app.org_id → query → COMMIT   (RLS por transação, FORCE RLS)    │          │
│         ▼                            ▼                                ▼                       │          │
│  ┌─────────────────────────── Postgres 16 (govai.*) ───────────────────────────┐              │          │
│  │ audit_events (cadeia HMAC) · audit_capture_outbox · provider_invocations    │              │          │
│  │ workrooms/participants/approvals/turns · regulatory_* · provider_credentials│              │          │
│  └──────────────────────────────────────────────────────────────────────────────┘             │          │
│         ▲                                              │ eventos OTel (observe-only)          │          │
│  apps/audit-sealer (sela o outbox; deploy próprio)     ▼                                      │          │
└────────────────────────────────────────────┬───────────────────────────────────────────────---┘          │
                                             │ OTLP                                                        │
                    ┌────────────────────────▼───────────────────────────┐                                 │
                    │ Plano do OPERADOR (fora do produto de tenant):     │                                 │
                    │ otel-collector → Prometheus → Grafana              │◄── operador (NÃO passa pela UI) │
                    │ (infra/docker-compose.observability.yml,           │                                 │
                    │  infra/otel/collector-config.yaml, infra/grafana/) │                                 │
                    └────────────────────────────────────────────────────┘                                 │
```
`[confirmado na fonte]`: CORS/rate-limit/gauges em `server.ts:93-154`; stack de observabilidade em `infra/` (listagem verificada); o cockpit cross-org do operador é acumulação per-org que alimenta gauges, sem rota HTTP (`apps/api/src/pipeline/evidence-operator.ts:1-23,62,115,159` `[confirmado na fonte]`).

**O que um agente implementa a partir daqui:** cria `apps/ui` no workspace pnpm (React+TS+Vite, TanStack Query/Table, Tailwind+Radix vendorizado), com sessão de chave em memória, cliente HTTP com os dois headers de auth suportados, e a regra de ouro (1:1 com a API, nada inventado client-side) como lint social do código — nenhuma tela ainda.

---
---

# Capítulo 2 — O mapa de telas e a jornada do usuário

## 2.1 Contagem exata e inventário de telas

**Total: 51 telas nominais** = **15 telas únicas** + **36 instâncias de 2 templates** (o template recurso-regulatório instanciado 17×2 vezes, + hub e simulador). Por área:

| Área | Telas | Contagem |
|---|---|---|
| A0 Acesso | Entrar (colar chave) | 1 |
| A1 Evidência | Cockpit; Lacunas por invariante; Cadeia de auditoria; Capacidades | 4 |
| A2 Workrooms | Lista; Detalhe com 5 abas (Visão geral, Runs, Aprovações, Evidência, Auditoria) | 6 (1 lista + 1 detalhe com 5 abas contadas como telas) |
| A3 Execução | Playground `/v1/runs` (U4, opcional) | 1 |
| A4 Regulatório | Hub; 17 recursos × (lista + detalhe) pelo template; Simulador de classificação | 1 + 34 + 1 = 36 |
| A5 Admin | Credenciais de provedor; Organização (whoami) | 2 |
| **Total** | | **50 + 1 (playground) = 51** |

### A0 — Entrar

| Campo | Valor |
|---|---|
| Rota frontend | `/enter` (redirect de qualquer rota sem sessão) |
| Role | todos (pré-auth) |
| Backend | `GET /v1/evidence/summary` como probe de validade da chave (`routes/evidence.ts:56` `[confirmado na fonte]`) — 200 = chave válida + org_id aprendido; 401 = `{error:'auth_error'}` (`evidence.ts:73-77`) |
| História | "Cole a sua chave de API. Ela fica só na memória deste tab — recarregar a página pede de novo." Um campo tipo password + aviso claro. Depois do EP-B2, a probe vira `GET /v1/me` e a tela também aprende roles/tier/modo. |

### A1 — Evidência (o coração; U1)

**1. Cockpit de evidência** — a primeira tela do produto (detalhes visuais no Cap. 4.1).

| Campo | Valor |
|---|---|
| Rota frontend | `/` (home autenticada) |
| Role | qualquer chave da org (sem gate — `evidence.ts:3-4`) |
| Backend | `GET /v1/evidence/summary?window=` (`routes/evidence.ts:56-96`) `[confirmado na fonte]` |
| História | "A minha evidência está completa?" — tiles por invariante (EC-1, EC-2, EC-3.seal, EC-3.drop, EC-4, EC-6) + o anel de `coverage_ratio` com `terms[]`/`excluded[]` sempre visíveis. Cada tile amarelo/vermelho é clicável → drill-down. |

**2. Lacunas por invariante (drill-down)**

| Campo | Valor |
|---|---|
| Rota frontend | `/evidence/gaps/:invariant` (`ec1\|ec2\|ec3seal\|ec3drop\|ec4` — o enum exato de `evidence.ts:37`) |
| Role | qualquer chave da org |
| Backend | `GET /v1/evidence/gaps?invariant=&window=&limit=&cursor=` (`routes/evidence.ts:98-168`; `limit≤500` default 100, janela ≤1 ano — `:29-41`) `[confirmado na fonte]` |
| História | "QUAIS capturas falharam/estagnaram; QUAL cadeia tem buraco de sequência; QUAIS invocações ficaram sem evento terminal." Tabela por invariante com os shapes exatos: `Ec1GapRow` (`evidence-reports.ts:197-205`), `Ec2GapRow` com **bigint como string decimal** (`:246-254`), `Ec3SealRow` (`:302-308`), `Ec4Row` (`:349-357`); `ec3drop` é um singleton agregado na página 0 (`evidence.ts:139-144`). Paginação por offset (`next_cursor`, `:150-153`). De uma linha EC-1/EC-3 o usuário pivota para a cadeia (chain_id) na tela 3. |

**3. Cadeia de auditoria**

| Campo | Valor |
|---|---|
| Rota frontend | `/audit-events?chain=run` (tabs por categoria) |
| Role | qualquer chave da org |
| Backend | `GET /v1/audit-events?chain_category=auth\|run\|policy\|admin&limit=&before_seq=` (`routes/audit-events.ts:7-11,14`; resposta `:79-98`) `[confirmado na fonte]` |
| História | "A cadeia HMAC crua, mais recente primeiro" — sequence_number, event_type, occurred_at, e os hashes (payload_hash, previous_hmac→hmac encadeados, canonical_hash) em fonte mono com truncamento+copy. **Só metadados e hashes; nunca payload** — e a tela DIZ isso ("conteúdo nunca é exposto por esta API; o que você vê prova integridade, não conteúdo"). Keyset `before_seq` (limit ≤200 default 50). |

**4. Capacidades**

| Campo | Valor |
|---|---|
| Rota frontend | `/capabilities` |
| Role | qualquer chave da org |
| Backend | `GET /v1/capabilities` (`routes/capabilities.ts:10,45-66`) `[confirmado na fonte]` |
| História | A matriz capability×facet com overrides da org aplicados: `status` vs `baseline_status`, `override_applied`, `evidence_strength`, `last_live_test_at`, `docs_url`. "O que posso chamar, em que nível (policy_governed vs passthrough_audited), e com que força de evidência." |

### A2 — Workrooms (U2)

**5. Lista de workrooms** — `/workrooms` · role: leitura para qualquer chave; botão "Criar" só `developer`/`admin` (`workrooms.ts:195-197`) · backend `GET /v1/workrooms?status=&workspace_id=&limit=` (`workrooms.ts:443`) e `POST /v1/workrooms` (`:179`) `[confirmado na fonte]`. História: salas com badge de modo (`governance_active`/`audit_only` — enum `workrooms.ts:46`); criação escolhe o modo (default `governance_active`, `:201`) e pode ser recusada por política da org (`audit_only_disallowed`, `:219-231`).

**6. Detalhe da workroom** — `/workrooms/:id` com **o banner de modo permanente e não-dismissível** (`workroom-governance-room.md:906,909` `[confirmado na fonte]`) e 5 abas:

| Aba | Backend | Role | História |
|---|---|---|---|
| Visão geral | `GET /v1/workrooms/:id` → `{workroom, policy_profile{name, governance_mode, default_provider_surface, max_risk_without_approval}, governance_mode}` (`workrooms.ts:373-427`) `[confirmado na fonte]` | qualquer chave da org (404 se de outra org) | O contrato da sala: modo, perfil de política, status, retention_class. **`[lacuna]` participantes: não há GET de participantes** (só `POST :504` / `DELETE :704`) — o roster e "qual é o meu papel aqui" exigem o EP-B4; até lá a aba mostra o perfil e as ações de add/remove às cegas do roster |
| Runs | `GET /v1/workrooms/:id/runs` (`workroom-runs.ts:468`, cursor composto) + `POST` (`:232`) | participante (POST); participante ou `auditor`/`admin` (GET, `workroom-runs.ts:500`) | Cada linha: `status` (`queued\|running\|completed\|failed\|denied\|awaiting_approval`, `:47`) + **`mode_relation`** (`defaulted\|explicit\|upgrade\|override_approved\|override_denied` — a matriz `resolveRunMode`, `:155-190`) `[confirmado na fonte]` |
| Aprovações | `GET/POST /v1/workrooms/:id/approvals` (`workroom-approvals.ts:249,444`), `GET …/:approvalId` (`:557`), `POST …/decisions` (`:661`), `POST …/revoke` (`:901-902`) `[confirmado na fonte]` | pedir: participante ativo `[do parecer de UI]`; decidir: `human_owner`/`human_approver` participante (`:720-725`); ler: participante ou `auditor`/`admin` (`:476,589`) | A fila com status efetivo (expiry calculado em tempo de leitura, `:209-217,486-500`), `intended_action_hash` (hex), quem pediu, quem decidiu e por quê, `consumed_run_id` (one-time-use). Decidir exige razão na negação e respeita SoD (`:757-764`) |
| Evidência | `GET /v1/workrooms/:id/evidence?artifact_kind=&before_seq=` (`workroom-transcript.ts:554`) | participante ou `auditor`/`admin` (`:586-592`) | Os artefatos da sala pelos **11 `artifact_kind`s** (`prompt, agent_response, auditor_finding, external_artifact, human_approval, merge_decision, file_diff, commit, pr, ci_run, tool_invocation_result` — `workroom-transcript.ts:60-73` `[confirmado na fonte]`): metadados + `payload_ref` + `payload_hash` + `redaction_metadata`, keyset `before_seq`. A tela é honesta: "conteúdo cifrado at rest; o que se lê são metadados e hashes" (`:16`) |
| Auditoria | `GET /v1/workrooms/:id/audit?before_seq=` (`workroom-transcript.ts:679`) | **só** `auditor`/`admin` (`:697-700`) | A subview de auditoria: turnos → eventos da cadeia, com `turn_kind`/`turn_number` e `redaction_metadata` |

E as ações de transcript (escrita): `POST /v1/workrooms/:id/messages` e `POST …/tasks` (`workroom-transcript.ts:169,376`; roles de mensagem `user|assistant|auditor_note` `:45`; task com `risk_class`+`requires_approval` `:52-58`) — participante ativo. **A vista de conversa (ler mensagens) não existe** `[lacuna — Cap. 8 D1]`.

### A3 — Execução (U4, opcional)

**7. Playground `/v1/runs`** — `/runs/new` · qualquer chave · `POST /v1/runs` `{workspace_id, capability, model, input, mode?}` (`routes/runs.ts:19-26,29`); `mode` `governed|passthrough` (`shadow` → 400 `run_mode_not_supported`, `:47-54`); resposta com `policy_decision{kind, reasons[]}` (`pipeline/run-orchestrator.ts:77-87`), `denied→403`, `failed→502` (`runs.ts:69-76`) `[confirmado na fonte]`. História: "experimente uma chamada governada e VEJA a decisão" — o output é secundário; a decisão de política é o protagonista.

### A4 — Regulatório (U3)

**8. Hub regulatório** — `/regulatory` · cards de navegação para as 6 famílias (Fontes & Controles; Inventário de IA: sistemas/provedores/modelos/agentes; Casos de uso; Risco; Revisões de alto risco; Uso proibido). **Sem contagens** (não há rota de agregação `[lacuna]`; buscar page-1 de 17 recursos para contar estouraria o rate limit — Cap. 8 R1). Selo permanente da área: **"Registro de evidência — não bloqueia execução"** (`current-state.md:139-156` `[confirmado na fonte]`).

**9–42. As 17 telas-lista + 17 telas-detalhe do template** (rotas `/regulatory/<recurso>` e `/regulatory/<recurso>/:id`): sources (+versions +relationships no detalhe), controls (+source-links +framework-mappings), ai-systems, providers, models (+versions), ai-system-model-links, agents (+versions), agent-capability-bindings, use-cases (+asset-links +reviews), use-case-asset-links, risk-methods, risk-classifications (+factors), risk-classification-factors (read-only), reclassification-triggers, high-risk-reviews (+evidence +assignments +decisions + ações submit/cancel), prohibited-use-policies, prohibited-use-cases (+evidence +determinations + submit/cancel). Contagem real da superfície: **108 operações sobre 60 caminhos distintos** (Anexo 9.1 `[confirmado na fonte — contado por grep]`). Leitura: qualquer identidade do tenant (linhas `scope='tenant'` da org + `scope='system'`); escrita: `admin` ou `data_protection_officer` (`regulatory.ts:1-10,1131-1141` `[confirmado na fonte]`). Paginação: cursor composto `{before_created_at, before_id, limit}` → `{rows, nextCursor}` (`apps/api/src/regulatory/service.ts:98,448-468` `[confirmado na fonte]`). Os workflows (submit/cancel/decisions/determinations/assignments) vivem DENTRO do detalhe como painel de máquina de estados.

**43. Simulador de classificação de risco** — `/regulatory/risk-classifications/evaluate` · `POST …/evaluate` é **computação pura sem persistência** (`regulatory.ts:2737` `[confirmado na fonte]`) — "simule a classificação antes de registrar"; excelente para UX e zero risco.

### A5 — Admin (U4)

**44. Credenciais de provedor** — `/admin/credentials` · role `admin` (`requireAdmin`, `admin-provider-credentials.ts:8,70`; `pipeline/require-admin.ts:31-43` `[confirmado na fonte]`) · `GET /v1/admin/provider-credentials?status=active|revoked|all` (`:346,48`), `POST` (set/rotate, `:105`), `POST …/:id/revoke` (`:226`). História: "cole a chave do provedor (anthropic|openai — `:38`); ela **nunca** volta" (plaintext só entra; envelope-encrypted; `:9-14`); todo set/revoke emite evento na cadeia `admin` (`:15-17`) — a tela linka a cadeia (tela 3) como prova.

**45. Organização** — `/admin/org` (na verdade read-only para todos; nome "Organização") · exibe org_id, tier, operational_mode, roles da chave — **depende inteiramente do EP-B2 (whoami)** `[lacuna confirmada — 1.2]`. Inclui o texto de consequência de modo/tier (Cap. 3.4).

E os dois stubs 501 (`POST /v1/admin/dlp-detectors`, `POST /v1/admin/audit-events/:id/crypto-shred` — `admin-dlp.ts:21,40`; `admin-audit-shred.ts:22,41` `[confirmado na fonte]`): a UI **não** os oferece como ações; aparecem apenas como "planejado (501)" na página de capacidades/roadmap se desejado — shape do 501: `{error:'capability_not_implemented_in_runtime_patch_1', capability, status:'planned', planned_phase, tracker}` (`_not-implemented.ts:20-29` `[confirmado na fonte]`).

## 2.2 Estrutura de navegação

```
┌────────────────────────────────────────────────────────────────────────────────┐
│  GovAI   [Evidência] [Workrooms] [Regulatório] [Admin]      org: acme · ⬤ prod │  ← topo fixo
│                                              janela: [24h ▾]   chave: ●●●● sair │
└────────────────────────────────────────────────────────────────────────────────┘
Evidência (default)      Workrooms               Regulatório                Admin
├─ / (Cockpit)           ├─ /workrooms           ├─ /regulatory (hub)       ├─ /admin/credentials
├─ /evidence/gaps/:inv   └─ /workrooms/:id       ├─ …/sources … (17 pares   └─ /admin/org
├─ /audit-events            ├─ (Visão geral)     │   lista+detalhe)
└─ /capabilities            ├─ (Runs)            └─ …/risk-classifications/
                            ├─ (Aprovações)          evaluate (simulador)
                            ├─ (Evidência)
                            └─ (Auditoria)  ← só auditor/admin
```
- O item "Admin" só aparece com role `admin`; a aba "Auditoria" só com `auditor`/`admin`; botões de escrita regulatória só com `admin`/`data_protection_officer`; "Criar workroom" só `developer`/`admin`. (Até o EP-B2, a UI não sabe os roles — Fase U1 mostra só a área Evidência, que não tem gate; Cap. 5.1.)
- O seletor de janela (1h/24h/7d/30d) alimenta `?window=` das telas de evidência (default do backend: 86 400 s — `config/src/index.ts:54` `[confirmado na fonte]`).
- O rodapé exibe: SHA do build da UI + `org_id` da sessão.

## 2.3 Os fluxos de usuário centrais (passo a passo)

**F1 — O auditor verifica a completude da evidência (U1; o fluxo-vitrine).**
1. Cola a chave em `/enter` → probe 200 → `/`.
2. Cockpit: `coverage_ratio` 0.98 com `excluded[]` visível; tile EC-1 âmbar ("3 stalled past SLO").
3. Clica no tile → `/evidence/gaps/ec1` → tabela com as 3 capturas (`status`, `attempts`, `last_error`, `captured_at`).
4. Clica no `chain_id` de uma → `/audit-events?chain=run` posicionado na cadeia → vê a sequência HMAC em volta do evento.
5. Entende: "a captura existe, não selou dentro do SLO; a cadeia está íntegra até o seq N". Exporta a consulta (JSON) para o dossiê.

**F2 — O developer cria uma sala e roda governado (U2).**
1. `/workrooms` → "Criar" (developer) → modo `governance_active` (default) → sala criada com policy profile + ele como `human_owner` (`workrooms.ts:236-243,275`).
2. Na aba Runs → "Executar" sem modo → `mode_relation: defaulted`, mode `governed` (`workroom-runs.ts:171`).
3. A linha do run aparece com status e `mode_relation` — a história de governança do run em um badge.

**F3 — Override de passthrough com aprovação (U2; o fluxo com SoD — o "ask" real do produto).**
1. Participante A, sala `governance_active`, pede run `passthrough` SEM aprovação → erro `workroom_run_mode_override_requires_approval` (`workroom-runs.ts:173-180`) — a UI explica e oferece "Pedir aprovação".
2. A cria a aprovação (vinculada ao `intended_action_hash` da ação exata; o intended-run é cifrado at rest — `workroom-approvals.ts:17,337`).
3. B (`human_owner`/`human_approver`, ≠A) abre a fila → decide `granted` (o botão de A está desabilitado: "quem pediu não decide" `:757-764`; corrida/dupla decisão → 409 `:735-746`).
4. A executa o run com `approval_request_id` → `mode_relation: override_approved`; a aprovação é consumida (one-time) e a linha mostra `consumed_run_id`.
5. O auditor lê a trilha completa na aba Aprovações + Auditoria.

**F4 — O DPO conduz uma revisão de alto risco (U3).**
1. `/regulatory/high-risk-reviews` → "Nova" (role DPO) → preenche → `submit` (`regulatory.ts:3169`).
2. Adiciona `evidence` (`:3219`) e `assignments` (`:3330`); um segundo revisor registra `decision` (`:3417`).
3. O detalhe mostra a máquina de estados e o selo permanente: "APPROVED = evidência, não autorização de runtime" (`current-state.md:151` `[confirmado na fonte]`).

**F5 — O admin configura a credencial do provedor (U4).**
1. `/admin/credentials` → "Definir credencial" → provider `anthropic` + chave (campo password) → POST; a lista mostra a credencial ativa **sem nunca ecoar o valor**.
2. O painel linka o evento `ProviderCredentialSet` na cadeia `admin` (tela 3) — "a prova de quando e por quem".
3. Revogar exige confirmação com consequência: "runs em `production`/`pilot` sem credencial de tenant passam a falhar" (`pipeline/provider-credentials.ts:153-158` `[confirmado na fonte]`).

**F6 — O auditor audita uma sala (U2).**
1. `/workrooms` → sala → aba Auditoria (role auditor) → turnos com `turn_kind`/`turn_number` + eventos + `redaction_metadata`.
2. Pivota para a aba Evidência → filtra `artifact_kind=human_approval` → cruza com a fila de Aprovações.
3. Confere o `payload_hash` de um artefato contra o `payload_hash` do evento na cadeia (tela 3) — integridade ponta-a-ponta sem nunca ver conteúdo.

**O que um agente implementa a partir daqui:** o router com exatamente estas rotas de frontend, o shell de navegação com gating por role (atrás de flag até o EP-B2), e as 4 telas da área Evidência primeiro (elas não dependem de nenhum EP); os templates regulatórios ficam para U3 e recebem só a tabela de configuração por recurso.

---
---

# Capítulo 3 — O sistema de design

## 3.1 Direção visual

**Nome de trabalho: "Ledger"** — a estética de um livro-razão técnico: denso, sóbrio, tipografia funcional, cor usada quase exclusivamente para SEMÂNTICA de status (não decoração). Um produto de conformidade sério ganha confiança por precisão visual, não por exuberância. `[recomendação]`

**Paleta (light theme primeiro; dark theme fica atrás de tokens — ver nota):**

| Token | Hex | Uso |
|---|---|---|
| `--bg-app` | `#F8FAFC` | fundo da aplicação |
| `--bg-surface` | `#FFFFFF` | cartões, tabelas, modais |
| `--bg-inset` | `#F1F5F9` | células de código/hash, cabeçalhos de tabela |
| `--border` | `#E2E8F0` | bordas padrão |
| `--border-strong` | `#CBD5E1` | divisores fortes, inputs em foco-hover |
| `--text-primary` | `#0F172A` | texto principal |
| `--text-secondary` | `#475569` | rótulos, legendas |
| `--text-tertiary` | `#94A3B8` | metadados, placeholders |
| `--brand` | `#1E40AF` | ações primárias, navegação ativa |
| `--brand-hover` | `#1E3A8A` | hover de ação primária |
| `--link` | `#1D4ED8` | links, pivôs (chain_id, run_id) |
| `--focus-ring` | `#93C5FD` | anel de foco (a11y) |

**Cores semânticas de status** (texto / fundo / borda) — a espinha do vocabulário de honestidade:

| Semântica | Texto | Fundo | Borda | Exemplos |
|---|---|---|---|---|
| **ok / coberto / selado** | `#15803D` | `#F0FDF4` | `#BBF7D0` | `sealed`, `completed`, `granted`, coverage 1.0 |
| **atenção / pendente** | `#B45309` | `#FFFBEB` | `#FDE68A` | `stalled_past_slo`, `pending` (EC-6, aprovações), `awaiting_approval`, `ask`/`sandbox_required` |
| **falha / bloqueio / lacuna** | `#B91C1C` | `#FEF2F2` | `#FECACA` | `failed`, `denied`, `blocked (403)`, `chains_with_gap>0`, `revoked` (credencial) |
| **neutro / observacional** | `#475569` | `#F1F5F9` | `#E2E8F0` | `observe`, `warn`, `enforce` encaminhados; `expired`; metadados |
| **info / execução** | `#1D4ED8` | `#EFF6FF` | `#BFDBFE` | `queued`, `running`, `sealing`, links de pivô |
| **registro regulatório** | `#6D28D9` | `#F5F3FF` | `#DDD6FE` | o selo permanente "evidência, não enforcement" — um EIXO distinto do runtime, com cor própria para nunca se confundir |

Regras de aplicação: (i) **verde é reservado a fatos verificados/selados** — nunca para "nenhum problema encontrado por ausência de verificação" (EC-6 pending é âmbar, jamais verde); (ii) **vermelho é reservado a efeito material** (403, falha, lacuna) — decisões encaminhadas NUNCA são vermelhas; (iii) badges "pendente" usam **outline** (fundo claro + borda), badges de fato consumado usam fundo preenchido.

**Tipografia:** UI **Inter** (400/500/600); dados técnicos (hashes, ids, seq, cursors) **JetBrains Mono** 12–13px. Escala: 12 (metadados), 13 (células de tabela), 14 (base), 16 (títulos de seção), 18 (título de página), 22 (números de tile), 28 (o número do coverage_ratio). Números tabulares (`font-variant-numeric: tabular-nums`) em toda coluna numérica.

**Espaçamento e densidade:** grade de 4px (4/8/12/16/24/32). Produto de dados ⇒ **densidade alta**: linha de tabela 36px, célula com padding 8×12, formulários 8px de gap vertical. **Raio de borda:** 6px (controles), 8px (cartões), 999px (badges). Sombras mínimas (1 nível para modais; cartões usam borda, não sombra).

**Dark theme:** deferido; todos os usos passam pelos tokens acima (CSS custom properties), então é um segundo arquivo de tokens depois — nenhum hex hardcoded em componente. `[recomendação]`

## 3.2 Os componentes-base

1. **AppShell** — topo fixo (nav por área + org/modo + janela + sessão), conteúdo com max-width 1440 e padding 24.
2. **DataTable** (TanStack Table headless) — O componente central. Colunas tipadas, ordenação só quando o backend ordena (na prática: nunca client-side em dados paginados — a ordem vem do servidor), estados de loading (skeleton de 5 linhas)/vazio/erro embutidos, e **três adaptadores de paginação — os três estilos reais do backend** `[confirmado na fonte]`:
   - **Keyset `before_seq`** (audit-events `audit-events.ts:10`; workroom evidence/audit `workroom-transcript.ts:77,82`): botão "Carregar mais antigos" — passa o menor `sequence_number` da página como `before_seq`; acumula páginas (infinite list).
   - **Cursor composto `{before_created_at, before_id}`** (todo o regulatory `service.ts:98,448-468`; workroom runs/approvals `[do parecer de UI]`): "Carregar mais" com o `nextCursor` opaco da resposta; `null` = fim.
   - **Offset numérico `cursor`** (evidence/gaps `evidence.ts:40,150-153`): paginação "Carregar mais" com `next_cursor = cursor + limit`; `null` = fim (e o singleton `ec3drop` nunca pagina).
   - Contrato do hook: `usePaginated(queryKey, fetchPage, adapter)` devolve `{rows, loadMore, hasMore, isLoading}` — a tela não sabe qual cursor está por baixo.
3. **StatCard / IndicatorTile** — número grande + rótulo + badge de status + microtexto de ressalva (obrigatório quando a resposta carrega ressalva — Cap. 4.4). Clicável quando há drill-down.
4. **StatusBadge** — UM componente para todos os vocabulários de status; recebe `(domain, value)` e resolve rótulo+cor da tabela central `honesty.ts`/`vocab.ts`. Proibido badge ad-hoc em tela.
5. **HashText** — mono, truncado `ab12…f9` com copy-on-click e tooltip do valor completo; usado para todo hex (hashes/HMACs) e uuids. **Nunca** converte bigint-string para número (`Ec2GapRow.first_gap_seq/gap_count` ficam strings — `evidence-reports.ts:248-253` `[confirmado na fonte]`).
6. **Timeline** — para a subview de auditoria da sala e para a cadeia: entradas com seq, tipo, hora ISO local-formatada, hashes.
7. **FormSheet** — formulário lateral (sheet) gerado de schema Zod (do `@govai/api-contract` quando existir): campos tipados, erros de `issues[]` do 400 mapeados campo a campo (`{error:'invalid_request', issues:[{path,message}]}` — `runs.ts:38-42` `[confirmado na fonte]`).
8. **ConfirmModal com consequência** — toda ação de peso (decidir aprovação, revogar aprovação/credencial, submit de workflow) confirma exibindo a CONSEQUÊNCIA no corpo (ex.: revogar credencial → "runs em production/pilot passam a falhar").
9. **ModeBanner** — o banner de modo da workroom; em `audit_only` é permanente e **não-dismissível** (exigência da spec — `workroom-governance-room.md:909`).
10. **EmptyState honesto** — "nenhuma lacuna nesta janela" ≠ "tudo verificado"; o texto do vazio nunca sobre-afirma (EC-6!).

## 3.3 Padrões de UI

**Erros (o envelope uniforme, verificado):** todas as rotas respondem `{error: <código>, …}` com extras opcionais — `message` (auth), `issues[]` (Zod 400 — `evidence.ts:60`, `runs.ts:38-42`), `required_role` (`workrooms.ts:197`; `workroom-transcript.ts:700`), corpo de bloqueio `{error:'governed_blocked', reason, governance}` (`register-governed.ts:117-121`), 501 planejado (`_not-implemented.ts:20-29`) `[confirmado na fonte]`. Mapeamento na UI:
- `401 auth_error` → derruba a sessão → `/enter` com aviso.
- `403 forbidden/…` → mensagem com o `required_role`/motivo — e registro de telemetria interna da UI (um 403 num botão visível é bug de gating nosso).
- `404` → "não encontrado — ou fora da sua organização" (cross-tenant é 404 por RLS; a UI explica a semântica em tom neutro).
- `409` (aprovações: corrida/expiração — `workroom-approvals.ts:735-755`) → refetch automático + toast "o estado mudou; a fila foi atualizada".
- `429` (rate limit 100/min global — `server.ts:102-105`) → backoff exponencial no cliente + banner "limite de requisições atingido; aguardando" (e Cap. 5.2 EP-B1).
- `500/502` → estado de erro com retry; `502` em runs = "falha do provedor" (`runs.ts:73-76`).
**Carregamento:** skeletons (nunca spinner de página inteira); TanStack Query com `staleTime` 15s para leituras de evidência, invalidação por mutação nas escritas.
**Datas:** ISO do backend renderizada local `DD/MM/AAAA HH:mm:ss` com tooltip do ISO cru; durações em s/min legíveis.
**Vocabulário de status por domínio (tabela central única):** run (`queued/running/completed/failed/denied/awaiting_approval`), aprovação (`pending/granted/denied/expired/revoked`), captura EC-1 (`captured/sealing/sealed/failed`), credencial (`active/revoked`), capacidade (`status`/`baseline_status`), `mode_relation` (5 valores), `chain_category` (4), invariantes (6). Cada um com rótulo PT + cor da tabela 3.1.

## 3.4 ★ O vocabulário de honestidade da governança

**Primeiro, o conjunto EXATO de valores e sua alcançabilidade, confirmados na fonte nesta sessão:**

- O enum de `enforcement_decision` é `observe | warn | ask | enforce | sandbox_required | blocked` (`packages/core-governance/src/governed-native/resolve-governance.ts:48-54`; ranking em `enforcement.ts:44-51` `[confirmado na fonte]`).
- **O único efeito material (403) no caminho governado** é `toolBlock !== null || enforcement_decision === 'blocked'` (`provider-anthropic/src/governed/handle-messages.ts:258` `[confirmado na fonte]`). `warn`, `ask`, `enforce` e `sandbox_required` **encaminham ao provedor** com a decisão anotada nos headers `x-govai-capability-level` / `x-govai-effective-risk-class` / `x-govai-enforcement-decision` (`register-governed.ts:134-136,169-171`; OpenAI `:84-86,111-113` `[confirmado na fonte]`).
- `resolveGovernance` **descarta** os `side_effects`/`preconditions` que a matriz computa (retorna só `enf.mode` — `resolve-governance.ts:146-158`; a matriz os computa em `enforcement.ts:104-120`) `[confirmado na fonte]` — "DLP obrigatório" e "sandbox requerido" são intenção declarada, não verificada.
- **Base de risco no caminho governado é sempre A**: as capacidades `policy_governed` dos dois provedores são todas `base_risk_class:'A'` (`provider-anthropic/src/capabilities/index.ts:15,29`; `provider-openai/src/capabilities/index.ts:19,33,49,63` `[confirmado na fonte]`). PII forte (CPF/CNPJ) escala `A→C / B→C / C→D` (`resolve-governance.ts:77-94`), PII padrão `A→B` (`:96-100`) — **de base A, o teto por DLP é C; D não é alcançado por PII** (C→D exigiria base C, e as únicas capacidades base C — `anthropic.web_search_tool:97`, `openai.models.delete:94`, `openai.vector_stores[.files].delete:162-180`, `openai.web_search_tool:197-201` — são todas `passthrough_audited`, e o passthrough **não resolve governança**: fixa `enforcement_decision:'observe'` com comentário honesto, `register-passthrough.ts:360,401,476` `[confirmado na fonte]`). **E não é alcançado por E em lugar nenhum** (nenhuma capacidade base D/E; escalações máx. D).
- **Os vetores de 403 REAIS em produção** `[confirmado na fonte]`:
  1. **Ferramenta bloqueada na validação** (independe da matriz **e do modo** — dispara até em `dev`/`test`): `computer_use` (`capability_blocked_via_token`), `code_execution` (`capability_planned`), `typed_unknown` — `tool-classifier.ts:97-117`; razão no corpo: `tool_blocked:<classification>:<block_reason>` (`handle-messages.ts:259-261`).
  2. **Matriz**: ferramenta `bash_\d{8}` é permitida com contribuição de classe **D** (`tool-classifier.ts:26,93-94`) → risco efetivo D → produção+`starter` → `blocked` (`enforcement.ts:69`); razão: `enforcement_blocked:D`. **Este é o único bloqueio de matriz vivo.**
  3. O ramo `E → blocked` (`enforcement.ts:66`) é **inalcançável por construção** hoje.
- `dev|test` → `observe` incondicional na matriz (`enforcement.ts:85-87`); `pilot` relaxa um degrau e **nunca bloqueia por matriz** (`:90-92` + `relaxOneNotch: blocked→sandbox_required`, `:54`). O piso de computer-use (`:94-102`) na prática não gera `sandbox_required` no governado porque computer-use é bloqueado na validação antes (vetor 1).
- **CPF no caminho governado, org `starter` em produção**: `A→C` → `ask` → **encaminhado ao provedor com o CPF dentro**, header `x-govai-enforcement-decision: ask`, e o evento grava `dlp_decisions[].action:'warn'` fixo (`handle-messages.ts:230-240` `[confirmado na fonte]`) — ninguém foi perguntado, ninguém foi avisado; foi *detectado e registrado*. O vocabulário abaixo existe para essa verdade nunca virar "bloqueado" numa tela.

**A tabela normativa do vocabulário (a função `honesty.ts` implementa exatamente isto):**

| Valor no evento/header | Efeito HTTP real | Rótulo na UI (PT) | Cor (3.1) |
|---|---|---|---|
| `observe` | encaminhado | **"Observado — encaminhado ao provedor"** | neutro |
| `warn` | encaminhado | **"Alerta registrado — encaminhado ao provedor"** | neutro (ícone ⚠ discreto) |
| `ask` | encaminhado | **"Aprovação recomendada — encaminhado (ninguém foi consultado)"** | atenção (outline) |
| `enforce` | encaminhado | **"Política registrada — encaminhado (efeitos declarados não aplicados)"** | neutro |
| `sandbox_required` | encaminhado | **"Sandbox requerido — precondição declarada, não verificada; encaminhado"** | atenção (outline) |
| `blocked` (matriz) | **403** | **"Bloqueado (403) — matriz de enforcement"** | falha |
| bloqueio de ferramenta (`tool_blocked:*` no `reason`) | **403** | **"Bloqueado (403) — validação de ferramenta: `<classification>`"** | falha |
| passthrough (sempre `observe`) | encaminhado | **"Passthrough — observado, nunca aplica política"** | neutro |

Regras invioláveis (testadas — Cap. 6):
1. **"Bloqueado" aparece se e somente se houve 403** (`blocked`/`tool_blocked`). `ask`/`enforce`/`sandbox_required` **nunca** são renderizados como "bloqueado", "aplicado", "retido" ou "enforçado". Quando a request foi ao provedor, a UI diz isso literalmente.
2. **PII**: `dlp_decisions` é exibido como **detecção** — "CPF detectado; a request foi encaminhada ao provedor" — com `risk_escalation_reasons[]` (formato `dlp:<detector>:pii_strong|pii_standard`, `tool:<classification>:<classe>`, `multipart_upload` — `resolve-governance.ts:81,108,129` `[confirmado na fonte]`) como trilha explicativa em tooltip/detalhe. Detectores baseline: `cpf`, `cnpj`, `email`, `phone_br` (`packages/dlp-br/src/baseline-detectors.ts:91-118` `[confirmado na fonte]`). Contagens rotuladas "detecções (podem sobrepor)" até o F6. **Nenhuma afirmação de redação** até o F5 (regra geral).
3. `[contrato corrigido — pendente do fix]` **Num evento de bloqueio**, o rótulo deriva do fato do 403 (`body_forward_mode:'blocked'`), NÃO do `enforcement_decision` do evento (que hoje mente `'blocked'` fixo). Pós-F2, a UI mostra a decisão real da matriz + o `block_trigger` (`tool_validation`|`enforcement_matrix`) como origem do bloqueio — os tipos do cliente já nascem com esses campos opcionais.
4. `[contrato corrigido — pendente do fix]` **`credential_source` não é exibido** até o F1; pós-fix, exibe o enum real (`tenant_provider_credential|platform_env_key|hermetic_placeholder|none`) — com destaque quando `platform_env_key` (a chamada saiu na credencial da plataforma).
5. **Dois eixos, dois selos**: runtime (a tabela acima) vs. **registro regulatório** (selo roxo permanente "registro de evidência — não bloqueia execução", `current-state.md:139-156`). Cores distintas por construção.
6. **Badges de modo com consequência**: `dev`/`test` → "enforcement de matriz desligado (observe)"; `pilot` → "matriz relaxada; não bloqueia por matriz"; `starter`+produção → "único tier com bloqueio de matriz vivo (D)". A nota inteira deriva de `enforcement.ts:62-92`.
7. **EC-6 nunca verde** enquanto `pending` (Cap. 4).

Trecho ilustrativo do mapa (o padrão, não o código completo):

```ts
// lib/honesty.ts — a função mais testada do app. Entrada: o fato HTTP + o evento.
export function enforcementLabel(i: {
  http403: boolean;                       // o fato material
  decision: EnforcementDecision;          // do header/evento (pós-F2: decisão real)
  blockTrigger?: 'tool_validation' | 'enforcement_matrix'; // pós-F2
  surface: 'governed' | 'passthrough';
}): { text: string; tone: Tone } {
  if (i.surface === 'passthrough') return { text: 'Passthrough — observado, nunca aplica política', tone: 'neutral' };
  if (i.http403) return { text: `Bloqueado (403) — ${i.blockTrigger === 'tool_validation' ? 'validação de ferramenta' : 'matriz de enforcement'}`, tone: 'danger' };
  // Encaminhado: NUNCA 'bloqueado'.
  return FORWARDED_LABELS[i.decision];    // a tabela normativa acima
}
```

**O que um agente implementa a partir daqui:** os tokens CSS (3.1) e os 10 componentes-base (3.2) como pacote interno de `apps/ui`, com `lib/honesty.ts` + `lib/vocab.ts` como módulos puros exportando as tabelas normativas — e os testes table-driven do 3.4 escritos ANTES da primeira tela que os use.

---
---

# Capítulo 4 — Dashboards, indicadores e relatórios

## 4.1 O cockpit de evidência (a primeira tela)

Fonte única: `GET /v1/evidence/summary` → `{org_id, window_seconds, t_seal_seconds, counts{ec1,ec2,ec3seal,ec4,ec6}, ec3drop, ec6, coverage_ratio}` (`routes/evidence.ts:88` + `pipeline/evidence-reports.ts:589-615` `[confirmado na fonte]`). Rótulos canônicos dos invariantes: `EC_LABELS` (`evidence-reports.ts:26-34`). Layout:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  Completude da evidência                     janela: 24h · T_seal: 300s        │
│                                                                                 │
│   ┌───────────────┐   ┌─────────┐ ┌─────────┐ ┌──────────┐ ┌─────────┐        │
│   │ coverage_ratio│   │ EC-1    │ │ EC-2    │ │ EC-3.seal│ │ EC-4    │        │
│   │     0.987     │   │ terminal│ │ contigui│ │ selagem  │ │ run-    │        │
│   │  ◔ anel       │   │ -state  │ │ -dade   │ │ nativa   │ │ lifecycle│       │
│   │ 1523/1543     │   │ ⬤ 3 ⚠  │ │ ⬤ ok    │ │ ⬤ ok     │ │ ⬤ 1 ⚠   │        │
│   └───────────────┘   └─────────┘ └─────────┘ └──────────┘ └─────────┘        │
│   termos: ec1 ec2 ec3seal ec4      ┌──────────────┐  ┌──────────────────────┐ │
│   excluídos: ec6 (pendente),       │ EC-3.drop    │  │ EC-6 integridade     │ │
│   ec3drop (não observado —         │ não observado│  │ 4 cadeias PENDENTES  │ │
│   coletor OTLP é a fonte) ← SEMPRE │ + bound      │  │ (nota do backend)    │ │
│   visível, nunca colapsado         └──────────────┘  └──────────────────────┘ │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Indicador a indicador (o que mede, como visualiza, drill-down):**

| Indicador | O que mede `[confirmado na fonte]` | Visualização | Drill-down |
|---|---|---|---|
| **coverage_ratio** | `Σcovered/Σtotal` sobre os invariantes OBSERVÁVEIS, com **paridade coverage↔gaps** (o não-coberto de cada termo = exatamente a população do `/gaps` daquele invariante — `evidence-reports.ts:519-536,537-583`) | Anel + número grande (28px) + a lista `terms[]` (invariant, covered, total) e `excluded[]` (invariant, reason) **sempre visíveis** — nunca atrás de tooltip | clicar num termo → `/evidence/gaps/<invariant>` |
| **EC-1 — terminal-state** | capturas do outbox na janela: `total/sealed/failed/stalled_past_slo` (stalled = `captured/sealing` além de T_seal — `evidence-reports.ts:77-100`) | tile com o total e sub-badges `failed` (vermelho) e `stalled` (âmbar); verde só com ambos zero | lista `Ec1GapRow` (status, attempts, `last_error` sanitizado ≤200 chars, captured_at — `:197-213`) |
| **EC-2 — contiguidade** | cadeias com buraco de `capture_seq` na janela (`chains`, `chains_with_gap` — `:102-121`) | tile "N cadeias, M com lacuna" | lista `Ec2GapRow` (chain_id, `first_gap_seq`, `gap_count` — **strings decimais, nunca `Number()`** — `:246-254`) |
| **EC-3.seal — selagem nativa** | capturas nativas (chain `run`) não seladas além do SLO (`:123-142`) | tile com `native_unsealed_past_slo` | lista `Ec3SealRow` (`:302-308`), ordenada mais antiga primeiro |
| **EC-3.drop — perda nativa** | proxy de perda do caminho B: `drops/captures` do snapshot in-process — que a rota fixa em **ZERO** ("a agregação autoritativa é o coletor OTLP" — `evidence.ts:83-86`; `ZERO_DROP_SNAPSHOT` `evidence-reports.ts:411`) | tile SEM número verde: mostra `observed: false` → "**não observado neste processo — o coletor OTLP detém o sinal autoritativo**" + o `bound` textual (`:431-433`: agrega, não isola streams-sem-terminal; cobre recebido-e-perdido, não nunca-emitido) | `/gaps?invariant=ec3drop` devolve o singleton agregado na página 0 (`evidence.ts:139-144`) — o drill-down é uma ficha, não uma lista |
| **EC-4 — run-lifecycle (path-A)** | invocações de provedor sem evento terminal `run.*` (view `evidence_provider_without_audit` — `:144-154`; "expected empty" `:361`) | tile "esperado: 0"; qualquer valor >0 é âmbar | lista `Ec4Row` (run_id, provider, native_endpoint, status_code, error_class — `:349-357`) |
| **EC-6 — integridade de cadeia** | **sempre `pending` neste build**: não há verificação persistida; a resposta carrega a `note` explicando (`:466-496`) | tile âmbar-outline "N cadeias pendentes de verificação" com a `note` do backend renderizada VERBATIM; **nunca verde**; excluído do ratio com razão exibida (`:560-562`) | sem drill-down (deliberadamente fora do enum de `/gaps` — `evidence.ts:9-12`); o CTA honesto é "verificação sob demanda: ainda não disponível" `[lacuna — parecer de UI 1.6.4]` |

**Semânticas de honestidade que o contrato JÁ entrega e a UI não pode esconder:** `terms[]`+`excluded[]` do ratio; a `note` do EC-6; o `bound` + `observed:false` do EC-3.drop; a janela e o T_seal explícitos no topo. O cockpit renderiza as ressalvas como **conteúdo de primeira classe**, não como asterisco.

## 4.2 Os outros dashboards

**Workroom (aba Runs + aba Aprovações como painéis):**
- **Fila de aprovações**: agrupada por status efetivo (pending — com contagem regressiva até `expires_at`; granted-não-consumida; consumida — com `consumed_run_id`; denied/revoked/expired). O status efetivo usa a MESMA semântica read-time do backend (pending além do prazo exibe "expirada" — `workroom-approvals.ts:209-217,486-500` `[confirmado na fonte]`).
- **Runs por status**: contadores por `status` (6 valores) + coluna `mode_relation` com badge; filtro por status. Sem rota de agregação, os contadores são da página carregada — o painel diz "nesta página" `[lacuna de agregação; aceitável em U2]`.

**Regulatório:** o hub (2.1 tela 8) é navegacional. Dentro de high-risk-reviews e prohibited-use-cases, o detalhe mostra o **workflow como linha do tempo de estados** (draft → submitted → assignments/decisions → outcome; determinations no prohibited-use), com o selo roxo permanente. Listas filtram por status via query dos endpoints de lista.

**Operador:** fica no **Grafana** (stack `infra/docker-compose.observability.yml` + `infra/grafana/provisioning` + `infra/otel/collector-config.yaml` `[confirmado na fonte]`); o produto de tenant NÃO tenta reproduzi-lo (o cockpit cross-org não tem rota HTTP e a decisão de trazê-lo para o produto é do dono — Cap. 8 D3).

## 4.3 Relatórios — hoje e no alvo

**Hoje `[confirmado na fonte]`:** não existe rota de relatório/dossiê. O que existe é: as superfícies de leitura (cap. 2), o export implícito da subview `/audit` por sala ("the underlying data is already exportable via the /audit endpoint" — `workroom-governance-room.md:979`), e a doutrina que classifica dossiês/certification-readiness como `DOCUMENTED_TARGET_ONLY` (`current-state.md:155`) e "Native reports and dashboards" como `BUILD_NATIVE_CORE` P1 (`19-build-vs-integrate-strategy.md:139`).

**O que a UI oferece em cada caso** `[recomendação]`:
1. **Primitiva universal "Exportar esta consulta (JSON)"** em toda tabela/cockpit: serializa exatamente o que a API devolveu (com window/cursor/params usados + timestamp + org_id + SHA do build) — um "recorte de evidência" honesto, sem pós-processamento. Barato e alinhado à tese.
2. **Nenhuma tela chamada "Dossiê"/"Relatório de conformidade"** até existir a rota nativa (é `DOCUMENTED_TARGET_ONLY`; prometê-la na UI violaria a regra geral). O hub regulatório pode listar "Dossiês — planejado" como item desabilitado com o selo "alvo documentado".
3. Quando o backend ganhar relatórios nativos (P1 da doutrina), eles entram como telas novas desta área — fora do escopo U1–U4.

## 4.4 A honestidade embutida (regra de design dos indicadores)

Toda ressalva que o backend publica é renderizada, com prioridade visual proporcional ao risco de má-leitura: (i) EC-6 `pending` + note; (ii) `coverage_ratio.excluded[]`; (iii) EC-3.drop `bound` + `observed:false` + "coletor OTLP é a fonte autoritativa"; (iv) janela/T_seal visíveis; (v) "expected empty" do EC-4 como baseline explícito. **E a redação de PII:** em qualquer lugar onde findings de DLP apareçam (runs, eventos, workroom), o texto normativo é "detecção registrada; conteúdo encaminhado" — **a capacidade 'redigir' é tratada como "pendente do fix (F5)"** e não aparece como opção/estado funcional em nenhuma tela `[contrato corrigido — pendente do fix]`.

**O que um agente implementa a partir daqui:** a tela do cockpit (tiles + anel + ressalvas como conteúdo), as 5 vistas de drill-down de `/gaps` com os shapes exatos de `evidence-reports.ts`, e a primitiva "Exportar esta consulta (JSON)" no DataTable — nesta ordem.

---
---

# Capítulo 5 — O plano de implementação

## 5.1 As fases U1→U4

| Fase | Escopo (telas) | Rotas consumidas | Critério de "pronto" | Dependências |
|---|---|---|---|---|
| **U1 — Cockpit de evidência** | A0 Entrar; A1 completa (Cockpit, Gaps, Cadeia, Capacidades); shell+deploy | `/v1/evidence/summary`, `/v1/evidence/gaps`, `/v1/audit-events`, `/v1/capabilities` — **100% existentes hoje** | colar-chave → cockpit com dados reais E ressalvas renderizadas; adaptadores keyset+offset provados; `honesty.ts`/`vocab.ts` testados; build estático servido atrás do proxy; zero warning de console | nenhum EP obrigatório em dev; **EP-B1 (rate limit) antes de produção** |
| **U2 — Console de Workroom** | A2 completa (lista, detalhe 5 abas, aprovações com SoD, runs com mode_relation) | `/v1/workrooms*` (12 operações) | fluxo F3 (override aprovado com SoD) completo na UI; banner audit_only não-dismissível; adaptador de cursor composto provado; timeline de metadados honesta ("conteúdo cifrado") | **EP-B2 (whoami)** para nav por role; **EP-B4 (GET participantes)** para o roster/SoD-UX; transcript-view aguarda D1→EP-B5 |
| **U3 — Bancada regulatória** | A4 completa (hub, 17×2 template, simulador, workflows) | os 60 caminhos `/v1/regulatory/*` | os 17 recursos navegáveis com UM template dirigido por configuração; workflows high-risk/prohibited-use operáveis ponta-a-ponta; selo roxo em todas; `evaluate` como simulador | EP-B7 (contrato) já extraído para os schemas regulatórios (o template é gerado deles) |
| **U4 — Admin & execução** | A5 (Credenciais, Organização); A3 (Playground) | `/v1/admin/provider-credentials*`, `/v1/runs`, whoami | credencial set/revoke com consequência e link à cadeia admin; playground exibindo `policy_decision` como protagonista | EP-B2; gestão de chaves de API só quando houver rota `[lacuna — CLI hoje: grant-api-key-role.ts:1-8]` |

Ordem justificada (do parecer de UI, mantida): U1 valida a arquitetura inteira em leitura pura com custo de erro mínimo e é a vitrine; U2 é o coração interativo; U3 é volume sobre padrão provado; U4 fecha operações.

## 5.2 Os EPs de backend que a UI puxa (em ordem de dependência)

| EP | O quê | Por que a UI precisa | Envolve | Entra em |
|---|---|---|---|---|
| **EP-B1 — rate limit por chave/org** | trocar o global 100/min in-memory (`server.ts:102-105` `[confirmado na fonte]`) por limite por chave (e teto maior) | um dashboard com meia dúzia de painéis + navegação consome 100/min rápido; hoje um tenant esfomeia o outro | poucas linhas no registro do `@fastify/rate-limit` (keyGenerator por prefixo de chave/org) | antes de U1 em produção |
| **EP-B2 — whoami (`GET /v1/me`)** ★ novo (auditoria desta sessão) | devolver `{org_id, user_id?, roles, tier, operational_mode}` da `AuthIdentity` já resolvida | **nenhuma rota expõe roles/tier/modo hoje** `[confirmado na fonte — 1.2]`; sem isso a UI não faz nav por role nem badges de modo/tier (teria que "descobrir por 403") | ~30 linhas: autentica e serializa a identidade; zero query nova | U2 (gate); útil já em U1 |
| **EP-B3 — sessão chave→JWT** | troca de chave por JWT curto em cookie `httpOnly` | tirar a chave crua do browser quando houver mais de um usuário | `core-identity/src/jwt.ts` já existe (jose, claims sub/org_id/roles `[confirmado na fonte]`); `API_CORS_CREDENTIALS` já existe (`config:30`) | antes de multiusuário (D2) |
| **EP-B4 — GET participantes** ★ novo (auditoria desta sessão) | `GET /v1/workrooms/:id/participants` | **só existem POST/DELETE** (`workrooms.ts:504,704` `[confirmado na fonte]`); sem GET não há roster nem "qual é o meu papel na sala" (o SoD-UX do F3 depende disso) | select simples RLS-scoped na tabela de participantes | U2 |
| **EP-B5 — leitura de transcript (decrypt autorizado)** | `GET /v1/workrooms/:id/messages` com decrypt por participação/auditor | a vista de conversa é impossível hoje (`content_ref`+hash apenas — `workroom-transcript.ts:16` `[confirmado na fonte]`) | decisão de segurança própria (D1) + rota com evento de acesso selado | U2 fase 2, após D1 |
| **EP-B6 — feed por-request de governança** | persistir a projeção legível do capture (hoje `payloadEncrypted: null`, só hash — `pipeline/audit-bridge.ts:210` `[confirmado na fonte]`) ou expor join `provider_invocations`+`policy_decisions` | "o que a governança fez nas minhas últimas 100 chamadas?" não tem rota; separa "cockpit de invariantes" de "console de atividade" | decisão de plano de evidência (D4), não de UI | pós-U2, decisão do dono |
| **EP-B7 — pacote `@govai/api-contract`** | extrair os Zod schemas inline das rotas p/ um pacote importado dos dois lados | tipagem ponta-a-ponta; o template regulatório de U3 é GERADO dos schemas; congela contrato | mover schemas (mecânico), zero mudança de comportamento; começa por evidence/audit-events/capabilities | começa em U1, incremental |
| **EP-B8 — rota HTTP do cockpit de operador** | expor `buildOperatorCockpit` (`evidence-operator.ts:159-166` `[confirmado na fonte]`) via HTTP com autorização de operador | somente se o dono quiser operador no produto (D3); senão Grafana continua sendo a resposta | rota nova + modelo de autorização de operador (INV-1: enumerar ≠ ler) | condicional |
| **(pré-condição) F1–F6** | os seis fixes da fase paralela | F1/F2 destravam `credential_source`/`block_trigger` na UI; F5/F6 destravam qualquer narrativa de redação/contagem exata | — | os campos ficam atrás de flag `contractFixed` no cliente |

## 5.3 A estrutura de pastas do `apps/ui`

```
apps/ui/
├── package.json              # "@govai/ui", private, scripts: dev/build/test/typecheck/lint
├── vite.config.ts            # base '/app/' (same-origin atrás do proxy — Cap. 7.1)
├── tsconfig.json             # estende ../../tsconfig.base.json
├── index.html
├── src/
│   ├── main.tsx
│   ├── app/
│   │   ├── App.tsx           # providers (QueryClient, router, sessão)
│   │   ├── routes.tsx        # a tabela de rotas 1:1 com o Cap. 2
│   │   └── shell/            # AppShell, Nav (gating por role), WindowSelector
│   ├── lib/
│   │   ├── api/
│   │   │   ├── client.ts     # fetch: baseURL, header x-govai-api-key, envelope de erro, backoff 429
│   │   │   ├── keys.ts       # query-keys canônicos por recurso
│   │   │   └── pagination.ts # os 3 adaptadores (keyset before_seq / composto / offset)
│   │   ├── contract/         # re-export de @govai/api-contract (EP-B7); antes: tipos espelhados AQUI e só aqui
│   │   ├── session.ts        # chave em MEMÓRIA + org_id observado; nunca localStorage
│   │   ├── honesty.ts        # ★ a tabela normativa 3.4 (pura, table-driven-testada)
│   │   ├── vocab.ts          # vocabulários de status por domínio (3.3)
│   │   └── format.ts         # hex truncado, ISO→local, bigint-strings (NUNCA Number)
│   ├── components/           # shell/ table/ badges/ forms/ feedback/ (os 10 de 3.2)
│   └── features/
│       ├── auth/             # EnterKey
│       ├── evidence/         # Cockpit, GapsView (por invariante), AuditChain, Capabilities
│       ├── workrooms/        # List, Detail{Overview,Runs,Approvals,Evidence,Audit}, forms
│       ├── regulatory/       # ResourceTemplate (lista+detalhe) + resources/*.config.ts (17) + Evaluate
│       └── admin/            # Credentials, OrgPage
├── tests/                    # component tests (Vitest + Testing Library + MSW)
└── e2e/                      # Playwright (contra stack local)
```

## 5.4 A sequência de trabalho para um agente de IA

1. **Bootstrap** (½ dia): `apps/ui` no workspace; Vite+React+TS; tokens 3.1; CI job `ui` (typecheck/lint/test/build — ao lado dos jobs `unit`/`integration` existentes, `.github/workflows/ci.yml:11,54` `[confirmado na fonte]`).
2. **Fundações** (1 dia): `session.ts` → `client.ts` (com backoff 429 e mapeamento do envelope de erros 3.3) → `pagination.ts` (3 adaptadores) → `honesty.ts`/`vocab.ts` **com os testes table-driven primeiro**.
3. **U1** (2–4 dias): EnterKey → Cockpit → GapsView (5 invariantes) → AuditChain → Capabilities. Validação: contra a stack local (`infra/docker-compose.yml` + seeds do repo); conferir visualmente cada ressalva do Cap. 4.1; `pnpm --filter @govai/ui test && build`.
4. **EP-B7 fase 1** (paralelo): extrair schemas de evidence/audit-events/capabilities para `packages/api-contract`; a UI troca os tipos espelhados pelos importados (PR pequeno, mecânico).
5. **U2** (1–2 semanas): EPs B2+B4 no backend primeiro (pequenos); depois workrooms na ordem lista → detalhe/overview → runs → aprovações (F3 completo com SoD-UX) → evidência/auditoria.
6. **U3** (1–2 semanas): `ResourceTemplate` + 17 configs geradas dos schemas; workflows; simulador.
7. **U4** (2–4 dias): credenciais, org (whoami), playground.
Cada passo: PR próprio, gates verdes (`pnpm typecheck && lint && test` sob Node 24), e o teste de honestidade NUNCA enfraquecido para passar.

**O que um agente implementa a partir daqui:** os passos 1–2 integralmente (bootstrap + fundações com testes) e o início do passo 3 (EnterKey + Cockpit) — o resto do plano segue a sequência acima sem re-decidir nada.

---
---

# Capítulo 6 — O plano de testes

## 6.1 A estratégia por camada

| Camada | Ferramenta | Contra o quê | Cobre |
|---|---|---|---|
| Unidade/componente | **Vitest + Testing Library** (o repo já é Vitest — `vitest.config.ts` `[confirmado na fonte]`) | funções puras + componentes com dados fixos | `honesty.ts`, `vocab.ts`, `pagination.ts`, `format.ts`, badges, tiles, tabela |
| Integração de data-layer | **Vitest + MSW** (mock do contrato) | o cliente HTTP + hooks TanStack contra respostas gravadas do contrato real (fixtures versionadas por rota) | envelope de erros, 429/backoff, os 3 cursors, invalidação por mutação |
| End-to-end | **Playwright** | a stack real local (API + Postgres via `infra/docker-compose.yml` + seeds) | os fluxos F1–F6 do Cap. 2.3 |

## 6.2 O que testar, priorizado

**P0 — o vocabulário de honestidade (o teste mais importante do produto):**
- Table-driven sobre `enforcementLabel`: para TODA entrada sem 403, o rótulo contém "encaminhado" e NUNCA contém "bloqueado/aplicado/retido"; para 403, "Bloqueado (403)" com a origem; passthrough sempre "observado".
- EC-6 `pending` nunca renderiza verde; a `note` aparece verbatim; `excluded[]` do ratio sempre no DOM.
- Nenhum componente renderiza `credential_source` enquanto a flag `contractFixed.credentialSource` for falsa `[contrato corrigido — pendente do fix]`; nenhuma string "redigido/protegido" no bundle (teste de grep no build!) até o F5.

**P0 — o data-layer:**
- Os 3 adaptadores: keyset (`before_seq` decrescente, acumulação, fim quando página < limit), composto (`nextCursor` opaco até `null`), offset (`next_cursor=cursor+limit`, `null` no fim; `ec3drop` nunca pagina).
- **Bigint como string**: `Ec2GapRow.first_gap_seq='9007199254740993'` renderiza os 16 dígitos exatos (qualquer `Number()` no caminho quebra o teste).
- 401 derruba sessão; 404 usa a copy cross-tenant; 409 refetch; 429 backoff.

**P1 — autorização na UI:**
- Nav por roles (com whoami mockado): sem `admin` → sem menu Admin; sem `auditor`/`admin` → sem aba Auditoria; sem `developer`/`admin` → sem "Criar workroom"; sem `admin`/`dpo` → formulários regulatórios read-only.
- SoD: requester vê "Decidir" desabilitado com a explicação; um 403 real vindo do backend em botão habilitado falha o teste (bug de gating).

**P1 — fluxos críticos (e2e):**
- F3 completo (pedir → decidir com outra identidade → consumir → `consumed_run_id` na tela) — inclui o 409 de corrida com refetch.
- F1 (cockpit → gap → cadeia) com dados semeados contendo 1 falha real.
- F5: a credencial digitada NUNCA aparece em nenhuma resposta/DOM depois do submit (asserção de ausência).

**P2:** estados vazios honestos; export JSON com params; formatação de datas/hex; a11y básica (foco, aria em modais e tabelas — Radix ajuda).

## 6.3 O encaixe no pipeline existente

- Novo job `ui` no `.github/workflows/ci.yml` (padrão dos jobs `unit`/`integration` existentes — `:11-28,54-64` `[confirmado na fonte]`): `pnpm --filter @govai/ui typecheck && lint && test && build`. Playwright como job separado (`ui-e2e`) que sobe a stack local como o job `integration` faz.
- O pacote `@govai/api-contract` (EP-B7) entra no `typecheck` global: mudar uma rota sem atualizar o contrato quebra CI **no mesmo PR** — este é o mecanismo de sincronia (Cap. 7.3).
- Gates locais idênticos aos do repo (Node 24; `pnpm typecheck/lint/test`).

**O que um agente implementa a partir daqui:** os testes P0 (honestidade + data-layer) ANTES das telas que os usam, o job `ui` no CI no mesmo PR do bootstrap, e um fixture-set versionado de respostas reais das 4 rotas de U1.

---
---

# Capítulo 7 — Manutenção, operação e observação

## 7.1 Como a UI é implantada

- **Build estático**: `vite build` → `apps/ui/dist` (HTML+JS+CSS; zero runtime Node).
- **Topologia recomendada: same-origin atrás do reverse proxy** `[recomendação]` — o proxy serve `/app/*` do `dist` e repassa `/v1/*`, `/governed/*`, `/passthrough/*`, `/health` ao Fastify (`API_HOST/API_PORT`, default `0.0.0.0:8080` — `config/src/index.ts:27-28` `[confirmado na fonte]`). Same-origin ⇒ CORS nem entra em cena e o EP-B3 (cookie httpOnly) fica trivial depois.
- **Alternativa: origem própria** usando o CORS existente: `API_CORS_ORIGINS` (CSV) + `API_CORS_CREDENTIALS`, com a guarda de produção que proíbe `*`+credentials (`server.ts:94-98`; `config/src/index.ts:29-30,135-146` `[confirmado na fonte]`).
- **Empacotamento**: para compose/K8s, uma imagem nginx/caddy servindo `dist` (multi-stage: build pnpm → copy dist), no padrão de deployable que o repo já estabeleceu com o sealer (esbuild+Docker multi-stage) — aqui mais simples ainda por ser estático.
- CSP: a UI é autossuficiente (sem CDNs); o helmet do API já roda com CSP desligado para a API (`server.ts:93`) — a CSP da UI é definida no proxy (default-src 'self').

## 7.2 Como é operada e monitorada

- **A UI é estática e sem estado** — não há "operar a UI" além de servir arquivos; o que se monitora é o backend (que já exporta OTel quando configurado — `server.ts:116` — para o stack do operador em `infra/docker-compose.observability.yml` → Prometheus → Grafana `[confirmado na fonte]`). O Grafana de operador **continua** sendo o painel de operador (Cap. 4.2).
- Sinal de saúde para o usuário da UI: probe leve de `GET /health` (`routes/health.ts:4` — `{status:'ok', service:'govai-api'}` `[confirmado na fonte]`) com banner "API indisponível" no shell. (Nota: `/health` hoje é estático e não toca o pool — F3 propõe readiness real; quando existir, a UI aponta para ela.)
- Erros de frontend: console limpo como gate; opcionalmente um contador local de erros exibido no rodapé de dev. Sem telemetria externa de UI na fase 1 (produto de conformidade; nada de analytics de terceiros por default) `[recomendação]`.
- Rodapé sempre com: SHA do build da UI + org_id da sessão — o "carimbo" de qualquer screenshot de auditoria.

## 7.3 Como o contrato UI↔API se mantém em sincronia

- **A amarra é o pacote `@govai/api-contract`** (EP-B7): os Zod schemas de request/response saem das rotas (hoje inline — ex.: `evidence.ts:32-41`) para o pacote; a rota valida com eles, a UI tipa com eles. Monorepo TS-source-only ⇒ **uma mudança de rota sem atualizar o contrato quebra o typecheck do CI no mesmo PR** — a sincronia é estrutural, não processual.
- **Processo quando uma rota muda**: (1) o PR do backend altera schema no pacote; (2) o typecheck da UI aponta cada tela afetada; (3) o PR só fica verde com a UI ajustada (ou com o campo marcado deprecated no pacote). Regra: **a UI nunca "adivinha" um campo que o contrato não declara** (a regra de ouro 1.3).
- Campos sob fix (F1/F2) já nascem no pacote como opcionais com comentário `pending-fix` e flag `contractFixed` no cliente — ligar o campo é apagar a flag, não reescrever telas.
- Sem OpenAPI por ora (o repo não tem; Zod é a fonte). Se um dia consumidores externos exigirem OpenAPI, gera-se DO pacote (zod→openapi), nunca à mão.

## 7.4 Versões e processo de atualização

- **Lockstep com o monorepo**: a UI versiona com o repo (sem versionamento independente até existirem consumidores externos do contrato). Cada release = mesma revisão de API+UI; o rodapé exibe o SHA.
- Atualização = novo build estático substituído no proxy (atômico por diretório/refresh de tag de imagem); rollback = apontar o build anterior. Sem migração de estado (não há estado).
- Compatibilidade: como a UI e a API saem do mesmo commit, janelas de mistura são curtas (deploy da API primeiro, UI em seguida); o cliente trata 404 de rota nova com a mensagem padrão — sem feature-detection elaborada na fase 1.

**O que um agente implementa a partir daqui:** o `vite.config.ts` com `base:'/app/'`, um exemplo de config do reverse proxy (arquivo em `infra/`), o job de build no CI publicando o `dist` como artefato, e o rodapé com SHA+org.

---
---

# Capítulo 8 — Decisões em aberto e riscos

## 8.1 As decisões do dono

**D1 — Leitura de transcript: decrypt-read ou metadado-only?**
Hoje: conteúdo cifrado at rest, só `content_ref`+`payload_hash` (`workroom-transcript.ts:16` `[confirmado na fonte]`); a vista de conversa é impossível. Trade-off: decrypt-read por participação (+auditor) torna a sala usável como produto de colaboração, mas cria a primeira rota que DEVOLVE conteúdo sensível — precisa de autorização por participação, evento de acesso selado e decisão de retenção; metadado-only mantém a postura mínima e empobrece U2. **Recomendação:** decrypt-read autorizado por participação ativa (e `auditor` com evento de acesso registrado), como EP-B5 em U2 fase 2 — a spec da sala já previa replay/rehydration (`workroom-governance-room.md:976-978`). `[recomendação]`

**D2 — Sessão JWT vs. chave-no-browser permanente.**
Fase 1 (dono como único usuário): chave em memória é aceitável e igual à postura do `curl`. A partir de um segundo usuário humano: **EP-B3 vira prioridade** (o JWT já existe no repo, não usado — `jwt.ts` `[confirmado na fonte]`). **Recomendação:** U1/U2 com chave em memória; EP-B3 antes de qualquer usuário externo. `[recomendação]`

**D3 — Operador no produto ou no Grafana?**
O contrato atual decide Grafana (cockpit cross-org existe só como função que alimenta gauges — `evidence-operator.ts:1-23,159` `[confirmado na fonte]`; a separação produto/operador foi decisão de arquitetura com INV-1). Trazer para o produto = EP-B8 + modelo de autorização de operador. **Recomendação:** manter Grafana; só abrir EP-B8 se o dono quiser UMA superfície para os dois papéis — e mesmo então, como app/rota separada, nunca misturada à navegação do tenant. `[recomendação]`

**D4 — O feed por-request de governança.**
A pergunta "o que a governança fez nas minhas últimas N chamadas" não tem rota (`[confirmado na fonte]`: capture persiste só hash — `audit-bridge.ts:210`; `/v1/runs` é POST-only — Anexo 9.1). Envolve decidir persistir o que hoje é deliberadamente não-persistido — decisão de plano de evidência (retenção, PII, tamanho), não de UI. **Recomendação:** decidir depois de U2, com o dado real de uso do cockpit; se aprovado, EP-B6 vira a tela "Atividade" entre Evidência e Workrooms. `[recomendação]`

**D5 — O conteúdo do whoami (EP-B2).**
Novo, desta auditoria: sem whoami não há badges de tier/modo nem nav por role (1.2). Decidir se devolve também `user_id` e `api_key_prefix` (útil para "qual chave sou eu"; risco baixo). **Recomendação:** `{org_id, roles, tier, operational_mode, api_key_prefix}` — sem user_id até haver gestão de usuários. `[recomendação]`

## 8.2 Riscos de implementação e mitigações

| # | Risco | Mitigação |
|---|---|---|
| R1 | **Rate limit global 100/min** derruba a própria UI em produção (cockpit = 1×summary + k×gaps + navegação) | EP-B1 como pré-requisito de U1-produção; no cliente: cache TanStack agressivo (staleTime), backoff 429, e o hub regulatório sem contagens (2.1) |
| R2 | **Enunciar redação/proteção de PII antes do F5** — a asserção seria falsa hoje | regra geral aplicada: teste de build que faz grep por vocabulário proibido ("redigido", "protegido", "removido") até a flag do F5 ligar (6.2) |
| R3 | **Volume do regulatório** (17 recursos × 2 telas) estourar o orçamento de U3 | UM `ResourceTemplate` dirigido por config gerada dos schemas do contrato; nenhuma tela regulatória artesanal |
| R4 | **Divergência de contrato** (UI adivinhando shape) | EP-B7 + typecheck no mesmo PR (7.3); até lá, tipos espelhados vivem num único diretório (`lib/contract/`) para a troca ser mecânica |
| R5 | **Chave no browser** (vazamento por extensão/screenshot/etc.) | memória-apenas (nunca localStorage), campo password, aviso na entrada, sessão morre com o tab; D2/EP-B3 no primeiro multiusuário |
| R6 | **Gating de UI errado** (botão visível que o backend nega, ou o inverso) | os dois eixos modelados explicitamente (1.4); testes P1 de autorização; telemetria de 403-em-botão-habilitado como falha de teste |
| R7 | **Má leitura dos indicadores** (EC-6 verde, drop "zero", coverage sem exclusões) | as ressalvas são conteúdo de primeira classe (4.4) e testadas (6.2 P0) |
| R8 | **`Number()` num bigint** aponta o auditor para a seq errada | `format.ts` sem conversão; teste P0 com valor > 2^53 (6.2) |
| R9 | **Fix F1/F2 atrasar** e a UI ligar campos mentirosos | flags `contractFixed.*` no cliente; os campos nascem desligados e o teste garante que ficam invisíveis desligados |
| R10 | **SSE no playground** (se U4 incluir streaming) complicar o cliente | fase 1 do playground é não-stream; SSE só depois, com `fetch`+`ReadableStream` e o mesmo vocabulário de honestidade nos headers |

**O que um agente implementa a partir daqui:** nada — este capítulo é do dono; o agente apenas respeita as recomendações default (D1 decrypt-em-fase-2, D2 chave-em-memória, D3 Grafana, D4 adiado, D5 shape mínimo) até decisão em contrário.

---
---

# Capítulo 9 — Anexos acionáveis

## 9.1 O inventário completo das rotas de backend

**Contagens reais confirmadas nesta sessão `[confirmado na fonte — contado por find/grep no checkout]`:**
- **18 arquivos** em `apps/api/src/routes/` — **17 registram rotas HTTP** + 1 helper compartilhado (`_not-implemented.ts`, o shape 501).
- **135 registros diretos** de rota nos arquivos de `routes/` (27 fora do regulatório + **108 no `regulatory.ts`**), mais **3 endpoints governed** e **2 wildcards passthrough** registrados pelos pacotes de provedor via `server.ts:156-176`.
- **`/v1/regulatory/*`: 108 operações (método+caminho) sobre 60 caminhos distintos** — a estimativa anterior de ~61 caminhos era boa; a contagem exata é 60 caminhos/108 operações.

### A. Núcleo (não-regulatório) — 27 registros + provedores

| Método e caminho | Fonte | Auth/Role | Paginação | Retorna |
|---|---|---|---|---|
| GET `/health` | `health.ts:4` | nenhuma | — | `{status:'ok', service:'govai-api'}` |
| GET `/v1/capabilities` | `capabilities.ts:10` | chave válida | — | matriz capability×facet com overrides (`:45-66`) |
| POST `/v1/runs` | `runs.ts:29` | chave válida | — | `RunResponse` com `policy_decision{kind,reasons[]}`; `denied→403`, `failed→502`; `shadow→400` |
| GET `/v1/audit-events` | `audit-events.ts:14` | chave válida | keyset `before_seq` (≤200) | cadeia HMAC: metadados + hashes hex, nunca payload (`:79-98`) |
| GET `/v1/evidence/summary` | `evidence.ts:56` | chave válida | — | `{org_id, window_seconds, t_seal_seconds, counts, ec3drop, ec6, coverage_ratio}` |
| GET `/v1/evidence/gaps` | `evidence.ts:98` | chave válida | offset `cursor` (≤500) | `{org_id, invariant, window_seconds, items[], next_cursor}` |
| POST `/v1/admin/provider-credentials` | `admin-provider-credentials.ts:105` | `admin` | — | credencial criada/rotacionada; plaintext nunca ecoa; evento na cadeia `admin` |
| POST `/v1/admin/provider-credentials/:id/revoke` | `admin-provider-credentials.ts:226` | `admin` | — | revogação + evento |
| GET `/v1/admin/provider-credentials?status=` | `admin-provider-credentials.ts:346` | `admin` | — | lista sem plaintext (`status: active\|revoked\|all`, `:48`) |
| POST `/v1/admin/dlp-detectors` | `admin-dlp.ts:21` | `admin` | — | **501** shape `_not-implemented.ts:20-29` |
| POST `/v1/admin/audit-events/:id/crypto-shred` | `admin-audit-shred.ts:22` | `admin` | — | **501** idem |
| POST `/v1/workrooms` | `workrooms.ts:179` | `developer`/`admin` | — | sala + policy_profile + 1º participante `human_owner` (transacional) |
| GET `/v1/workrooms/:id` | `workrooms.ts:373` | chave válida (404 cross-org) | — | `{workroom, policy_profile, governance_mode}` (`:415-427`) — **sem participantes** |
| GET `/v1/workrooms?status=&workspace_id=&limit=` | `workrooms.ts:443` | chave válida | — | lista de salas da org |
| POST `/v1/workrooms/:id/participants` | `workrooms.ts:504` | `human_owner` ativo ou `admin` `[do parecer de UI]` | — | participante; duplicata ativa → 409 |
| DELETE `/v1/workrooms/:id/participants/:participantId` | `workrooms.ts:704` | `human_owner` `[do parecer de UI]` | — | remoção |
| POST `/v1/workrooms/:id/messages` | `workroom-transcript.ts:169` | participante ativo | — | turno registrado; conteúdo cifrado (`content_ref`+`payload_hash`) |
| POST `/v1/workrooms/:id/tasks` | `workroom-transcript.ts:376` | participante ativo | — | task com `risk_class`+`requires_approval` (`:52-58`) |
| GET `/v1/workrooms/:id/evidence?artifact_kind=` | `workroom-transcript.ts:554` | participante ou `auditor`/`admin` (`:586-592`) | keyset `before_seq` | artefatos (11 kinds) + `payload_ref/hash` + `redaction_metadata`, `next_before_seq` |
| GET `/v1/workrooms/:id/audit` | `workroom-transcript.ts:679` | `auditor`/`admin` (`:697-700`) | keyset `before_seq` | subview turnos→eventos |
| POST `/v1/workrooms/:id/runs` | `workroom-runs.ts:232` | participante ativo | — | run com `mode_relation` (matriz `:155-190`) |
| GET `/v1/workrooms/:id/runs` | `workroom-runs.ts:468` | participante ou `auditor`/`admin` (`:500`) | cursor composto | runs da sala (status 6 valores, `:47`) |
| POST `/v1/workrooms/:id/approvals` | `workroom-approvals.ts:249` | participante ativo `[do parecer de UI]` | — | aprovação vinculada a `intended_action_hash` |
| GET `/v1/workrooms/:id/approvals?status=` | `workroom-approvals.ts:444` | participante ou `auditor`/`admin` (`:476`) | cursor composto `[do parecer de UI]` | fila com expiry read-time (`:486-500`) |
| GET `/v1/workrooms/:id/approvals/:approvalId` | `workroom-approvals.ts:557` | idem (`:589`) | — | detalhe |
| POST `/v1/workrooms/:id/approvals/:approvalId/decisions` | `workroom-approvals.ts:661` | `human_owner`/`human_approver` participante (`:720-725`); SoD (`:757-764`) | — | grant/deny (deny exige razão); corrida → 409 (`:735-755`) |
| POST `/v1/workrooms/:id/approvals/:approvalId/revoke` | `workroom-approvals.ts:901` | requerente ou `human_owner` `[do parecer de UI]` | — | revogação |
| POST `/governed/anthropic/v1/messages` | `provider-anthropic/src/governed/register-governed.ts:69` (via `routes/governed-anthropic.ts`) | chave válida | — (SSE quando stream) | corpo nativo byte-perfeito + headers `x-govai-*`; 403 = `{error:'governed_blocked', reason, governance}` (`:114-121`) |
| POST `/governed/openai/v1/responses` | `provider-openai/src/governed/register-governed.ts:129` | chave válida | — | idem |
| POST `/governed/openai/v1/chat/completions` | `provider-openai/src/governed/register-governed.ts:174` | chave válida | — | idem |
| ALL `/passthrough/anthropic/*` | `provider-anthropic/src/routes/register-passthrough.ts:174` | chave válida | — | espelho da API nativa (messages/count_tokens/models/files); `enforcement_decision:'observe'` sempre (`:360`) |
| ALL `/passthrough/openai/*` | `provider-openai/src/routes/register-passthrough.ts:178-179` | chave válida | — | idem (responses/chat/models/embeddings/files/vector_stores) |

### B. Regulatório — 108 operações / 60 caminhos (`regulatory.ts`; linhas confirmadas por grep)

Convenções da área inteira: leitura = qualquer identidade do tenant (`scope='tenant'` da org + `scope='system'`); escrita = `admin`/`data_protection_officer` (`:1131-1141`); cursor composto uniforme; toda mutação emite evento na cadeia `policy` (`:1-10`).

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
| use-cases (+asset-links +reviews) | GET:2335 · POST:2367 · GET/:id:2386 · PATCH/:id:2409 · GET use-case-asset-links:2433 · POST use-case-asset-links:2470 · GET use-case-asset-links/:id:2489 · PATCH use-case-asset-links/:id:2512 · POST/:id/reviews:2536 · GET/:id/reviews:2559 · GET use-case-reviews/:reviewId:2594 · PATCH use-case-reviews/:reviewId:2617 |
| risk-methods | POST:2641 · GET:2660 · GET/:id:2688 · PATCH/:id:2711 |
| risk-classifications (+factors) | **POST evaluate:2737 (computação pura, sem persistência)** · POST:2755 · GET:2777 · GET/:id:2820 · PATCH/:id:2843 · GET/:id/factors:2865 · GET risk-classification-factors:2901 · GET risk-classification-factors/:id:2933 |
| reclassification-triggers | POST:2958 · GET:2977 · GET/:id:3012 · PATCH/:id:3035 |
| high-risk-reviews (workflow) | POST:3067 · GET:3086 · GET/:id:3122 · PATCH/:id:3145 · POST/:id/submit:3169 · POST/:id/cancel:3193 · POST/:id/evidence:3219 · GET/:id/evidence:3244 · GET high-risk-review-evidence/:id:3279 · PATCH high-risk-review-evidence/:id:3304 · POST/:id/assignments:3330 · GET/:id/assignments:3355 · PATCH high-risk-review-assignments/:id:3391 · POST/:id/decisions:3417 · GET/:id/decisions:3445 · GET high-risk-review-decisions/:id:3481 |
| prohibited-use-policies | POST:3515 · GET:3534 · GET/:id:3565 · PATCH/:id:3588 |
| prohibited-use-cases (workflow) | POST:3614 · GET:3633 · GET/:id:3671 · PATCH/:id:3694 · POST/:id/submit:3718 · POST/:id/cancel:3742 · POST/:id/evidence:3768 · GET/:id/evidence:3793 · GET prohibited-use-evidence/:id:3828 · PATCH prohibited-use-evidence/:id:3853 · POST/:id/determinations:3879 · GET/:id/determinations:3907 · GET prohibited-use-determinations/:id:3944 |

## 9.2 O glossário do domínio

- **Path-A / Path-B**: os dois caminhos de execução — A = `/v1/runs` (orquestrador transacional, persiste `provider_invocations`+`policy_decisions`); B = `/governed/*` e `/passthrough/*` (proxy nativo; evidência via AuditBridge → capture outbox → sealer).
- **Invariantes EC-\*** (rótulos canônicos `evidence-reports.ts:26-34`): **EC-1** terminal-state (toda captura termina `sealed`/`failed`; estagnada além de T_seal = lacuna); **EC-2** contiguidade de `capture_seq` por cadeia; **EC-3.seal** selagem das capturas nativas dentro do SLO; **EC-3.drop** perda nativa em agregado (proxy; coletor OTLP autoritativo; carrega `bound`); **EC-4** invocação path-A sem evento terminal `run.*` (esperado vazio); **EC-5** stream-terminal — **deferido** (`:16-21`); **EC-6** integridade da cadeia HMAC — **sempre `pending`** neste build (sem verificação persistida); **coverage_ratio** — a conjunção com paridade coverage↔gaps.
- **`enforcement_decision`**: `observe|warn|ask|enforce|sandbox_required|blocked` (Cap. 3.4). **`blocked_at_validation` reasons**: `typed_unknown|capability_planned|capability_blocked_via_token|hard_denied_beta` (`tool-classifier.ts:75-79`).
- **Classes de risco `A..E`**: A base das capacidades governadas é sempre A; escalações: PII forte A→C/B→C/C→D, PII padrão A→B, ferramenta até a classe contribuída (bash=D), multipart B→C.
- **`capability_level`**: `policy_governed` (resolve governança) vs `passthrough_audited` (observa e audita, nunca aplica).
- **`mode_relation` (workroom run)**: `defaulted|explicit|upgrade|override_approved|override_denied`.
- **`governance_mode` (workroom)**: `governance_active` (default governed; passthrough só com aprovação) | `audit_only` (default passthrough; governed sempre admitido como upgrade; banner não-dismissível).
- **Status**: run `queued|running|completed|failed|denied|awaiting_approval`; aprovação `pending|granted|denied|expired|revoked` (expiry avaliado em leitura); captura `captured|sealing|sealed|failed`; credencial `active|revoked`.
- **`artifact_kind` (11)**: `prompt, agent_response, auditor_finding, external_artifact, human_approval, merge_decision, file_diff, commit, pr, ci_run, tool_invocation_result`.
- **`chain_category`**: `auth|run|policy|admin` — quatro cadeias HMAC por org (`chainIdFor(org_id, category)`).
- **`body_forward_mode`**: `raw|redacted|blocked` (evento v4; Regra 2: `blocked`→`body_forward_mode='blocked'` — `passthrough-invoked.ts:145,227-231`). `redacted` é reservado — nenhum caminho o emite hoje (redação pendente F5).
- **`stream_outcome`**: `complete|upstream_error|client_disconnect` (`passthrough-invoked.ts:129`).
- **`credential_source`** `[contrato corrigido — pendente do fix]`: alvo `tenant_provider_credential|platform_env_key|hermetic_placeholder|none`.
- **`dlp_decisions`**: fases `pre_request|post_response|file_upload|pre_response_content|file_addition_to_vector_store`; ações declaradas `none|warn|redact|block|ask` — hoje o governado emite `warn` fixo (rótulo de detecção, não ação).
- **Detectores DLP baseline**: `cpf`, `cnpj` (pii_strong), `email`, `phone_br` (pii_standard).
- **`tier` / `operational_mode`**: `starter|business|enterprise|regulated` / `production|pilot|dev|test` — controle do operador (Q4); consequências no Cap. 3.4.
- **`scope` regulatório**: `tenant` (linhas da org) | `system` (globais, read-only para o tenant).
- **Headers de governança** (resposta governed): `x-govai-capability-level`, `x-govai-effective-risk-class`, `x-govai-enforcement-decision` — o único lugar onde a decisão por-request chega ao cliente hoje.

## 9.3 Âncoras e convenções que um agente precisa para não adivinhar

- **Auth**: header `x-govai-api-key: <chave>` OU `Authorization: Bearer <chave>` (extração idêntica em toda rota — ex.: `evidence.ts:43-50`). 401 = `{error:'auth_error', message}`.
- **Convenções de dados**: bigint → string decimal (NUNCA `Number()` — `Ec2GapRow`); binário → hex; datas → ISO-8601 UTC; envelope de erro `{error, …}`; cross-tenant → 404.
- **Env vars relevantes à UI/deploy**: `API_HOST`/`API_PORT` (`config:27-28`), `API_CORS_ORIGINS`/`API_CORS_CREDENTIALS` (`:29-30`), `EVIDENCE_T_SEAL_SECONDS=300`/`EVIDENCE_DEFAULT_WINDOW_SECONDS=86400` (`:53-54`).
- **Rate limit**: 100/min global em produção (`server.ts:102-105`) até o EP-B1.
- **Gestão de chaves de API**: CLI apenas (`apps/api/src/scripts/grant-api-key-role.ts:1-8` — "BRIDGE / BREAK-GLASS"); nenhuma rota HTTP.
- **Os 6 fixes (F1–F6)** e o que destravam na UI: F1 → exibir `credential_source`; F2 → confiar em `enforcement_decision`+`block_trigger` de eventos de bloqueio; F3/F4 → confiabilidade operacional (readiness real; evidência não descartada); F5 → qualquer narrativa de redação; F6 → contagens exatas de findings.
- **Arquivos-fonte de referência rápida**: contrato do cockpit `apps/api/src/pipeline/evidence-reports.ts`; rotas de leitura `apps/api/src/routes/{evidence,audit-events,capabilities}.ts`; vocabulário `packages/core-governance/src/{enforcement.ts,governed-native/resolve-governance.ts}` + `packages/provider-*/src/tool-classifier.ts`; workroom `apps/api/src/routes/workroom-*.ts`; regulatório `apps/api/src/routes/regulatory.ts` + `apps/api/src/regulatory/service.ts`; evento selado `packages/core-events/src/passthrough-invoked.ts`; config `packages/config/src/index.ts`.

**O que um agente implementa a partir daqui:** nada de novo — este capítulo é a referência; o agente o mantém atualizado a cada EP que alterar contrato (a tabela 9.1 é regenerável pelo mesmo grep que a produziu: `grep -nE "app\.(get|post|put|patch|delete)" apps/api/src/routes/*.ts`).

---

## Fecho

Este plano-mestre está ancorado no commit `f975533d` com contagens reais confirmadas (**17 arquivos de rota ativos + 1 helper; 108 operações/60 caminhos regulatórios; 3 endpoints governed + 2 wildcards passthrough**), projeta cada campo sob correção contra o contrato corrigido (F1/F2/F5/F6 marcados onde tocam a UI), consolida os quatro pareceres da série (correção, design Q1–Q4, docs, arquitetura de UI) e adiciona duas lacunas de contrato descobertas nesta auditoria (**sem GET de participantes; sem whoami — nenhuma rota expõe roles/tier/modo**). A ordem de execução é U1→U4 com os EPs de backend enumerados por dependência; o vocabulário de honestidade do Cap. 3.4 é normativo e testado; e a regra de ouro vale para tudo: **a UI liga 1:1 à API, não inventa campos, e só chama de "bloqueado" o que retornou 403.**

— Fim do plano-mestre (GOVAI-UI-MASTER-PLAN-FABLE5 @ f975533d, 2026-07-07).
