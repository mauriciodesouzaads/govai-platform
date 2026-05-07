# GovAI Platform — Arquitetura Definitiva Pinada (ADP) v4.2

**Versão:** v4.2 (patch de nomenclatura sobre v4.1 — alinhamento `base_risk_class` em todos os contratos canônicos)
**Data:** 2026-05-04
**Status:** canônico. Substitui ADP v4.1 como fonte de verdade arquitetural.
**Hash do v3 (referência histórica):** `a37669aecb273ff3e6c6f64f6445c88adb594ac53fa836e5b8ed4a094caa2f5f`
**Hash do v4 (referência histórica):** `b5e9d29eed42c236cbbc06b1a64dacd72dc2080d56e1023ca26934463bfe2c75`
**Hash do v4.1 (referência histórica):** `efdebadd9652c17396cb5c0efde917e185f8d21b962112c26b877e9654c7cb78`

**Patches aplicados em v4.2 (sobre v4.1):**

1. Substituição canônica de `risk_class` → `base_risk_class` em registry/compile-time (princípios, decisões de consenso, Provider Coverage Matrix, capability registry docs, acceptance gates).
2. Response de `GET /v1/capabilities` usa `base_risk_class` (registry estático). `effective_risk_class` aparece apenas em decisões de runtime (audit events, policy decisions).
3. Tabela `tenant_capability_acceptance`: coluna `risk_class` → `base_risk_class_at_acceptance` + nova coluna `max_effective_risk_class_allowed`. Aceite jurídico explícito sobre escalada permitida.
4. Tier Regulated: "Default level" → "Default target level" + reforço de que `evidence_grade + hmac_internal` é internal evidence enquanto `external_anchor`/`customer_signed`/`icp_brasil_tsa` não estiverem implementados.
5. Allowlist passthrough: campo `risk_class` → `base_risk_class` (consistência com registry).
6. PR2 acceptance gates: explicitar que **promoção inicial** executa live test opt-in dentro do próprio PR2 e populates `last_live_test_at` com o timestamp dessa execução. Regra "≤30 dias do PR" não exige live test prévio.

ADP v4.2 preserva 100% das decisões técnicas profundas do v3/v4/v4.1 (audit chain defense-in-depth, RLS multi-comando-multi-role, KMS, capability registry, DLP-BR, advisory lock por chain, append-only triggers, native-first, governance-around, três dimensões de coverage, tiers, progressive enforcement, tracks paralelos, Risk Classes A-E com base/effective). Apenas alinha nomenclatura.

Este documento é a fonte para o prompt PR2 (Native Provider Experience) e todos os PRs subsequentes.

---

## Sumário

1. Tese e filosofia
2. Decisões de consenso (consolidadas)
3. Três dimensões de coverage
4. Tiers comerciais
5. Tracks paralelos
6. ADRs canônicos (1-23)
7. Estrutura de monorepo
8. Modelo de dados
9. Append-only audit chain
10. Crypto-shredding (LGPD)
11. Pipeline
12. Capability registry com 3 dimensões
13. Native Provider Experience
14. Agentic Safety
15. DLP-BR
16. Segurança
17. Observability (OTel GenAI)
18. Testing strategy
19. Acceptance gates por capability
20. Forbidden absolutos
21. Roadmap de PRs (PR2-PR8+)
22. Open questions
23. Não-negociáveis para prompts Claude Code

---

## 1. Tese e filosofia

### 1.1 Tese central

**GovAI é uma superfície de confiança para IA.** Native-first, governance-around, provider-native, baixa fricção, com segurança e evidência forense invisíveis até precisarem aparecer.

A plataforma serve organizações de qualquer porte — da pequena empresa que precisa atender o mínimo de LGPD até instituição financeira regulada que exige evidence-grade auditável — através de um único motor técnico parametrizado por **tier**, **risk class** e **operational mode**.

A unidade central do produto é **Run** (não Chat). Cada chamada a um provider (Anthropic, OpenAI, futuros) atravessa uma máquina de estados auditável que decide enforcement em runtime, persiste evidência tamper-evident, e devolve a resposta nativa ao cliente com fricção mínima.

### 1.2 Headline canônica

> **"Native-first, governance-around."**

O cliente continua usando o SDK oficial do provider que já conhece. Nada é capado. Streaming é streaming. Tools são tools. Files são files. GovAI senta no caminho e:

1. autentica o cliente GovAI;
2. resolve credencial do tenant para o provider real;
3. reescreve `Authorization` / `x-api-key` antes do forward;
4. aplica DLP / policy / audit conforme tier × risk × mode;
5. preserva payload e response nativos;
6. registra audit event tamper-evident na chain.

### 1.3 Princípios operacionais (preservados de v3, reforçados)

- **Macro do dia 1.** Arquitetura macro + contratos macro + schema macro desde o commit 1. Não significa implementar tudo agora; significa não fragmentar fundação depois.
- **Run é a unidade.** Não Chat, não Conversation, não Session. Run é o que existe em audit chain, evidence record, cost attribution, policy decision.
- **Dual mode runtime.** Governed Run (DLP + policy + RBAC + mutation + ask/deny + audit + evidence) e Provider Passthrough (preserva shape nativo + credential rewrite + audit + tier-driven policy).
- **Provider-native, sem abstração lossy.** Nunca normalizar Anthropic e OpenAI para um shape comum. Cada provider com seu wrapper que preserva tipos, streaming, errors.
- **Capability registry code-defined com 3 dimensões.** SDK coverage + runtime support + governance support. Cada capability declara `status`, `level`, `enforcement_default`, `base_risk_class`, `tier_availability`. Runtime calcula `effective_risk_class` por chamada quando aplicável.
- **Default deny para capability não-registrada em production.** Discovery Mode admin-only é a única exceção controlada.
- **Zero placeholders públicos.** Permitido: contrato em `docs/contracts/`, capability `planned`. Proibido: rota `503`, package vazio, backend "fake but compiles".

### 1.4 Posicionamento de mercado

GovAI ocupa um quadrante que nenhum competidor cobre integralmente:

> Plataforma de **AI run governance** com **evidence layer**, **multi-tenant real**, **LGPD-first**, **dual-mode (governed + passthrough)**, **native-first**, **tier-aware**, sem commodity gateway nem GRC desconectado de runtime.

Comparação síntese:

- **LiteLLM:** denominador comum lossy (OpenAI shape forçado). GovAI é provider-native.
- **Portkey:** mistura concerns (prompt store + gateway + guardrails + governance). GovAI foca em governance + evidence.
- **Langfuse / Helicone:** observability. GovAI tem OTel mas o produto vende Level 2/3 (governance e evidence).
- **Credo AI / OneTrust AI:** GRC de tela, desconectado de runtime. GovAI gera evidence **na Run**, não retroativamente.
- **WitnessAI / Lakera / ProtectAI:** firewall standalone. GovAI tem segurança como capability dentro de governance envelope, não produto isolado.

**Moat defensável:** regulatório-BR + evidence verificável + enforcement em runtime + tenant isolation real + tier-aware UX + native-first low-friction.

---

## 2. Decisões de consenso (consolidadas)

### 2.1 Decisões base (preservadas de v3, 23 itens)

| # | Decisão |
|---|---|
| 1 | Macro do dia 1 com 10 packages: `core-events`, `core-audit`, `core-identity`, `core-tenant`, `core-governance`, `provider-anthropic`, `provider-openai`, `dlp-br`, `config`, `signing` |
| 2 | Dual mode: Governed Run primário + Provider Passthrough secundário; Anthropic e OpenAI juntos no baseline |
| 3 | Modelo de dados macro no commit 1: append-only defense-in-depth, separação `audit_events` / `audit_event_payloads`, `chain_anchor_id` nullable, `policy_version_id` composto, `usage_json.source`, capability facets, advisory lock por chain |
| 4 | MCP, ShadowAI, ICP-Brasil real, TSA, evidence-pack-generator, computer-use sandbox: `planned` em `docs/contracts/`. Sem rotas, packages vazios, tabelas vazias |
| 5 | Custom DLP detectors por org no baseline com hardening obrigatório (RBAC admin, audit, versioning, **engine RE2**, length limit, action `detect/redact/deny`, capability level 1) |
| 6 | TypeScript 5.9.x baseline; TS 6 como upgrade pós-baseline |
| 7 | `redis@5.12.1` (node-redis) como cliente principal; `ioredis` apenas se peer exigir |
| 8 | Live tests scheduled (gate **diário**; **horário** apenas em release window), não PR-blocker; release usa último green dentro de janela |
| 9 | Default deny para capabilities não registradas em production; promoção via PR explícito; Discovery Mode admin-only é exceção controlada (§14.6) |
| 10 | Endpoint público `GET /v1/capabilities` retornando `status`, `level`, `enforcement_default`, `effective_status` por org após overrides |
| 11 | **Node 24 LTS Active** primário. Node 22 LTS Maintenance fallback. Node 20 = EOL, fora |
| 12 | Zod 4 obrigatório. Nenhuma dependência ou wrapper pode forçar Zod 3 |
| 13 | Nenhuma chave de API real em prompt, código, log ou doc. Apenas nomes de env vars. `.env` no `.gitignore`. Secret scanning (gitleaks) em CI |
| 14 | Passthrough: GovAI autentica → resolve credencial provider do tenant → reescreve header de auth → forwarda → repassa headers permitidos → adiciona headers `x-govai-*` |
| 15 | Provider-protocol test server hermético existe para CI, mas **não substitui live tests** e **não valida provider readiness**. Aceitação exige execução live manual documentada (§18.3) |
| 16 | Owner isolado `govai_audit_writer` (sem `BYPASSRLS`, `LOGIN`, `SUPERUSER`). Schema `govai` criado com `AUTHORIZATION govai_audit_writer` |
| 17 | `payload_crypto_shredded` é audit event obrigatório na chain `admin`, com função SECURITY DEFINER dedicada e RBAC enforced no app |
| 18 | `KMS_DEV_SEED` per-developer, `.env.example` com instrução de gerar localmente, gitleaks rule, boot fail em production se setado |
| 19 | HMAC choreography: TS calcula HMAC sob lock; SQL valida `expected_prev_hmac` e `expected_sequence` antes do INSERT. Chave HMAC nunca toca o banco |
| 20 | UUIDs (`event_id`, `payload_id`, `Run.id`, etc.) gerados em TS via `crypto.randomUUID()`. Sem `gen_random_uuid()` em SQL. Sem dependência de `pgcrypto` |
| 21 | Advisory lock key 64-bit: `chainLockKey()` em TS = primeiros 8 bytes de SHA-256 lidos como `BigInt64` big-endian. Função SQL recebe `p_chain_lock_key bigint` |
| 22 | RLS policies explícitas por comando E por role (necessário porque `FORCE ROW LEVEL SECURITY` sujeita o owner a RLS) |
| 23 | Migration de bootstrap (roles, schema, grants base) separada de migrations da aplicação. Bootstrap roda com migrator/admin role; migrations da app rodam com role que pode `SET ROLE govai_audit_writer` |

### 2.2 Decisões novas em v4 (10 itens)

| # | Decisão |
|---|---|
| 24 | **Headline canônica:** "native-first, governance-around". Substitui qualquer formulação que sugira que GovAI é wrapper restritivo |
| 25 | **Três dimensões de coverage** (SDK / runtime / governance) viram vocabulário oficial do produto. Capability registry, response APIs, e dashboards usam esse vocabulário |
| 26 | **Distinção formal `status × level × enforcement`:** `status` responde "está implementado?"; `level` responde "qual a profundidade da governança?"; `enforcement` responde "qual a postura de runtime para esta tentativa?". `blocked` aparece em `status` e em `enforcement` com semânticas distintas (§3.4) |
| 27 | **Levels nominais:** `passthrough_audited`, `policy_governed`, `evidence_grade`. Numeração 0-3 preservada por compatibilidade com código v3, mas o nome canônico é o nominal. `0 = blocked` mantém-se como atalho |
| 28 | **Tiers comerciais:** enum interno `starter | business | enterprise | regulated`. Labels comerciais podem mudar sem renomear enum (§4) |
| 29 | **Risk Classes A-E** classificam toda capability conforme superfície de risco (§14.1). Determinam enforcement default cruzado com tier |
| 30 | **Operational Modes:** `production | pilot | discovery | test_harness | dev`. Modos transversais a tier que afetam enforcement (§11.4-11.5, §14.6-14.7) |
| 31 | **Provider Coverage Matrix obrigatória** como artefato em `docs/architecture/provider-coverage-matrix.md`. Atualizada a cada PR que toca provider. Fonte de verdade do progresso real (§12.2) |
| 32 | **Allowlist versionada para passthrough.** Unknown endpoints não são forwardados em production. Discovery Mode admin-only é a única exceção (§13.4) |
| 33 | **Tracks paralelos formalizados:** Backend / Frontend / Legal / Infra como tracks distintos. PR backend não cria pasta `apps/web` vazia; FE-PR1 instancia o track Frontend (§5) |

### 2.3 Decisões revisadas em v4 (correções de tese)

| # | Item | v3 | v4 |
|---|---|---|---|
| R1 | Postura agentic | "blocked por padrão para tudo perigoso" | Progressive Enforcement por Risk Class × Tier × Operational Mode (§14) |
| R2 | Levels | Numéricos 0-3 | Nominais (`passthrough_audited`, `policy_governed`, `evidence_grade`) com numeração preservada por compatibilidade |
| R3 | Capability response | `level + status + facets` | `status`, `level`, `enforcement_default`, `base_risk_class`, `tier_availability`, `effective_status` (§12.1). Runtime decisions adicionam `effective_risk_class` |
| R4 | Passthrough | "preserva shape nativo" | "preserva shape nativo + allowlist versionada + transparent vs governed modes" (§13) |
| R5 | UI | "fora do escopo" (implícito) | Track Frontend formalizado, FE-PR1 separado, contratos de UI canônicos (§5.2) |

### 2.4 Patches v4.1 (8 correções cirúrgicas sobre v4)

| # | Patch | Por que |
|---|---|---|
| P1 | Capabilities agentic em exemplos: `supported` → `planned`/`blocked` | v4 contradicia próprio roadmap (PR7+) marcando computer_use/file_edit/bash como supported |
| P2 | `risk_class` → `base_risk_class` + `effective_risk_class` runtime decision | v4 não modelava escalação dinâmica por DLP/tools/payload — perderia valor central de governance |
| P3 | Índice parcial sem `now()` em predicado | Postgres proíbe funções voláteis em predicados de índice; ainda seria semanticamente errado pelo tempo |
| P4 | Pilot Mode expira para `production` automaticamente + audit event + worker | v4 exigia `expires_at` mas não definia comportamento na expiração |
| P5 | Discovery Mode com DLP pre-scan obrigatório + ask em PII | v4 sem DLP em Discovery permitia exfiltração auditada por admin malicioso |
| P6 | Registry ↔ matrix consistency test obrigatório em PR2 | Sem teste, matriz vira documentação manual que desatualiza |
| P7 | Unknown passthrough endpoint test obrigatório em PR2 | Sem teste, allowlist pode ser violada silenciosamente |
| P8 | Tier Regulated: distinção explícita "internal cryptographic evidence" vs "external regulatory evidence" | v4 podia induzir overclaim de "regulatory-grade" antes de TSA/customer signing |

### 2.5 Patches v4.2 (alinhamento de nomenclatura sobre v4.1)

| # | Patch | Por que |
|---|---|---|
| N1 | Substituir `risk_class` → `base_risk_class` em registry/compile-time canônicos (princípios, decisões, matrix, capabilities response, allowlist) | Após v4.1 introduzir base/effective, sobrou nomenclatura legacy que confundiria implementação |
| N2 | `GET /v1/capabilities` retorna `base_risk_class` (estático); `effective_risk_class` aparece apenas em runtime decisions/audit | Endpoint estático não tem effective; mistura ambos quebraria semântica |
| N3 | `tenant_capability_acceptance.risk_class` → `base_risk_class_at_acceptance` + `max_effective_risk_class_allowed` | Aceite jurídico precisa especificar até qual escalada autoriza execução |
| N4 | Tier Regulated: "Default level" → "Default target level" + reforço sobre evidence interna vs externa | Eliminar ambiguidade que induziria overclaim contratual |
| N5 | Allowlist passthrough: campo `risk_class` → `base_risk_class` | Consistência com registry |
| N6 | PR2 acceptance gates: explicitar que promoção inicial executa live test no próprio PR2 e popula `last_live_test_at` | Sem isso, regra "≤30 dias" parece exigir live test prévio (chicken-and-egg) |

---

## 3. Três dimensões de coverage

### 3.1 SDK coverage

Mede **quanto da superfície oficial do provider** (Anthropic + OpenAI + futuros) está mapeada no GovAI Capability Registry.

Métrica: número de capabilities mapeadas no registry / número total de capabilities oficialmente expostas pelo provider naquela versão de SDK.

**100% SDK coverage** = toda capability oficialmente exposta pelo provider está registrada no GovAI, com algum `status` (não significa que está executável; significa que está mapeada).

Não mapear é dívida de produto. Mapear como `not_exposed` ou `planned` é honestidade.

### 3.2 Runtime support

Mede **o que efetivamente roda no GovAI**.

Métrica: número de capabilities com `status = supported` / número total no registry.

`supported` exige:

- código real (não wrapper vazio)
- teste hermético contra provider-protocol test server
- live test verde recente quando aplicável (`last_live_test_at` < 30 dias do PR de promoção)
- audit event gerado em cada execução
- registry entry com `level` declarado
- ADR ou contrato em `docs/`
- capability response inclui `effective_status` corretamente computado

Capability pode ser registrada no SDK coverage e ainda estar `planned` (mapeada mas não executável). É honestidade, não fraude.

### 3.3 Governance support

Mede **a profundidade de governança aplicada** quando a capability roda.

Métrica: distribuição das capabilities supported entre os três levels:

- `passthrough_audited` — autentica, troca credencial, audita, mede cost/latency, preserva payload nativo. **Sem inspeção semântica profunda**.
- `policy_governed` — tudo do anterior + DLP semântica + policy decision (allow/deny/redact/mutate) + audit detalhado da decisão.
- `evidence_grade` — tudo do anterior + evidence record + framework_refs (LGPD, EU AI Act, SOX) + attestation chain (TSA, customer signature, ICP-Brasil quando disponível).

Capability promovida a `supported` precisa declarar **um** level. Não há ambiguidade. Cliente vê pelo `level` exatamente o que está contratando.

### 3.4 Distinção formal `status × level × enforcement`

| Conceito | Pergunta que responde | Domínio | Onde aparece |
|---|---|---|---|
| `status` | "Está implementado e mapeado?" | `not_exposed`, `planned`, `supported`, `blocked` | Capability registry (compile-time) |
| `level` | "Qual a profundidade da governança aplicada quando supported?" | `passthrough_audited`, `policy_governed`, `evidence_grade` | Capability registry (compile-time) |
| `enforcement` | "Qual a postura de runtime para esta tentativa específica?" | `observe`, `warn`, `ask`, `enforce`, `sandbox_required`, `blocked` | Runtime decision (per-request) |

**Crítico — `blocked` em dois domínios:**

- `status.blocked` = capability conhecida pelo GovAI, mas decisão arquitetural ou de tier não permite execução em qualquer caminho. Resposta: `403 capability_blocked_by_policy` com `reason` explicando.
- `enforcement.blocked` = decisão de runtime para uma tentativa específica que falha alguma checagem (sandbox ausente, aceite jurídico expirado, classe de risco incompatível com tier atual, etc.). Resposta: `403 capability_blocked_by_runtime` com `reason` específico da decisão.

Exemplo concreto:

```typescript
// Capability registry (compile-time)
{
  id: 'anthropic.claude_agent.computer_use',
  status: 'planned',                    // PR7+ — código + sandbox + teste pendentes
  level: 'passthrough_audited',         // governança quando supported, futuro
  base_risk_class: 'D',
  enforcement_default: 'sandbox_required',
  tier_availability: ['enterprise', 'regulated'],
  planned_phase: 'PR7',
}
```

```http
POST /v1/runs (capability=anthropic.claude_agent.computer_use)
→ runtime decision: tenant=enterprise, mas capability ainda planned

Response 501:
{
  "error": "capability_not_implemented_in_current_release",
  "capability": "anthropic.claude_agent.computer_use",
  "status": "planned",
  "planned_phase": "PR7",
  "reason": "agentic computer-use awaits sandbox primitive and live tests in PR7+",
  "tracker": "docs/architecture/baseline-decisions.md#runtime-roadmap"
}
```

```http
POST /v1/runs (capability=some.unknown.endpoint)
→ não está em registry, em production mode

Response 403:
{
  "error": "capability_not_registered",
  "endpoint": "some.unknown.endpoint",
  "reason": "this capability is not yet in GovAI's coverage matrix. Discovery Mode (admin-only) can map it.",
  "remediation_url": "https://docs.govai.com.br/discovery-mode",
  "tracker": "docs/architecture/provider-coverage-matrix.md"
}
```

Os três casos retornam status diferentes (`501`, `403`, `403`) com `error` e `reason` específicos. Cliente e UX distinguem.

Exemplo adicional — capability `supported` mas `tier_availability` não inclui o tier do tenant:

```typescript
// Capability registry (futuro — PR4)
{
  id: 'anthropic.messages.tools',
  status: 'supported',                  // PR4 promove para supported
  level: 'policy_governed',
  base_risk_class: 'C',
  enforcement_default: 'ask',
  tier_availability: ['business', 'enterprise', 'regulated'],
}
```

```http
POST /v1/runs (capability=anthropic.messages.tools, tenant.tier=starter)

Response 403:
{
  "error": "capability_blocked_by_runtime",
  "capability": "anthropic.messages.tools",
  "reason": "tier 'starter' does not include risk class C capabilities (tool calling). Upgrade to business+ tier.",
  "remediation_url": "https://docs.govai.com.br/tiers/upgrade",
  "tracker": "docs/architecture/baseline-decisions.md#tier-policy-matrix"
}
```

---

## 4. Tiers comerciais

### 4.1 Enum interno

```typescript
type Tier = 'starter' | 'business' | 'enterprise' | 'regulated';
```

Esse enum é **interno**. Vai para schema do banco (`organizations.tier`), policy decision, capability response, audit event.

Labels comerciais podem mudar sem renomear enum:

```typescript
const TIER_LABELS: Record<Tier, string> = {
  starter: 'GovAI Essential',
  business: 'GovAI Team',
  enterprise: 'GovAI Enterprise',
  regulated: 'GovAI Regulated',
};
```

### 4.2 Características por tier

#### Starter

**Público-alvo:** pequena empresa (até ~50 usuários), sem time de DevOps, precisa do mínimo legal LGPD.

**Default operational mode:** `pilot` (low-friction).

**Default level:** `passthrough_audited` em tudo Risk Class A-B.

**Inclui:**
- Passthrough auditado de Anthropic + OpenAI completos (todas as capabilities A e B)
- DLP-BR baseline detect-only (CPF, CNPJ, email, telefone)
- Audit chain básica (`hmac_internal`)
- Cost dashboard
- Relatório LGPD pronto (1 botão)
- Self-service onboarding

**Não inclui:**
- Custom DLP detectors
- Policy enforcement
- Risk Class C/D capabilities
- Evidence-grade
- BYOK
- SSO

**Onboarding:** cadastra org, conecta chave Anthropic/OpenAI, distribui URL para usuários.

#### Business

**Público-alvo:** média empresa (50-500 usuários), tem time de TI, quer policy ativa.

**Default operational mode:** `production`.

**Default level:** `policy_governed` em Risk Class B, `passthrough_audited` em A.

**Inclui:**
- Tudo do Starter
- DLP detect/redact/deny configurável
- Budget caps por usuário/projeto
- Policy decision allow/deny/redact/mutate
- Tool allowlist por tenant
- Approval workflows básicos (Risk Class C)
- SSO básico (SAML)

**Não inclui:**
- Custom DLP RE2 detectors
- SIEM integration
- Evidence-grade
- BYOK
- Risk Class D sem aceite jurídico

#### Enterprise

**Público-alvo:** grande empresa, setor não-regulado, tem CISO.

**Default operational mode:** `production`.

**Default level:** `policy_governed` em A-C, `passthrough_audited` para passthrough específico.

**Inclui:**
- Tudo do Business
- Custom DLP RE2 detectors com versioning
- SIEM integration (eventos exportados)
- ShadowAI detection (planned PR8+)
- BYOK (chaves Anthropic/OpenAI próprias do cliente)
- Custom policy engine
- Approval workflows complexos
- Risk Class D liberável com aceite jurídico
- Evidence_grade opcional em capabilities críticas

#### Regulated

**Público-alvo:** banco, saúde, governo, telecom, seguros, advocacia.

**Default operational mode:** `production` com restrições adicionais.

**Default target level:** `evidence_grade` em capabilities críticas (alvo arquitetural; até `external_anchor`/`customer_signed`/`icp_brasil_tsa` estarem implementados, isso significa **internal cryptographic evidence** com `evidence_strength = hmac_internal`, não external regulatory-grade — ver detalhamento abaixo). `policy_governed` em todo o resto. `passthrough_audited` proibido para Risk Class B+.

**Inclui:**
- Tudo do Enterprise
- ICP-Brasil TSA anchoring (quando disponível, planned para PR8+)
- Customer signature em audit events (planned)
- Legal workflow integrado (jurídico interno do cliente + contratos)
- Sandbox real obrigatório para Risk Class D (pós-PR7+)
- Penetration testing report compartilhado
- Evidence_grade auditável

**Restrições obrigatórias:**
- `discovery_mode` indisponível por padrão (vai contra postura regulada)
- Risk Class D só com sandbox + approval workflow
- Live tests obrigatórios em release window

**⚠️ Reforço sobre evidence-grade — distinção crítica preservada de ADR-005:**

`evidence_grade` em si é um **level de governança**, não uma garantia de validade jurídica externa. O nível de evidência apresentável fora da relação cliente-GovAI depende do `evidence_strength` da capability:

| `evidence_grade + evidence_strength` | Classe de evidência | Apresentável a |
|---|---|---|
| `+ hmac_internal` | Internal cryptographic evidence | Investigações forenses **dentro** da relação cliente-GovAI |
| `+ dev_signed` | Internal cryptographic evidence (dev) | Mesmo escopo do anterior, com chave de desenvolvimento |
| `+ external_anchor` | External regulatory evidence (anchor TSA público) | Auditor externo, regulador |
| `+ customer_signed` | External regulatory evidence (chave do cliente) | Auditor externo, regulador, processo judicial |
| `+ icp_brasil_tsa` | External regulatory evidence (BR padrão jurídico) | Processo judicial brasileiro, fiscalização |

**No baseline (PR2-PR7):** GovAI Regulated entrega `evidence_grade + hmac_internal` para capabilities críticas. Isso é **Regulated-ready interno**, não **external regulatory-grade**.

**GovAI nunca:**
- Vende capability como "regulatory-grade externa" antes de `external_anchor`/`customer_signed`/`icp_brasil_tsa` estarem implementados.
- Permite que material de marketing, relatório técnico ou response API marque uma capability com `hmac_internal` como "auditável externamente".
- Confunde "auditável tecnicamente" (cliente pode validar via verifyFullChain) com "apresentável legalmente fora da relação contratual".

**Implementação obrigatória:** o capability response (§11.6) e a Provider Coverage Matrix exibem **explicitamente** o `evidence_strength` quando level é `evidence_grade`. UI Frontend deve renderizar badge distinguindo "internal evidence" de "external regulatory evidence".

Tier Regulated tem **roadmap declarado** para evidence externa em PR8+ (TSA anchoring) e PRs futuros (customer signing, ICP-Brasil). Cliente Regulated assina contrato sabendo que evidence externa é roadmap, não baseline.

### 4.3 Tier Policy Matrix (default)

Matriz Risk Class × Tier × Mode determinando enforcement default:

```
                       Starter        Business       Enterprise     Regulated
Risk Class A           observe        observe        observe        observe
(messages, streaming)

Risk Class B           warn           enforce        enforce        enforce
(PII payload)          (DLP detect)   (DLP redact)   (DLP custom)   (DLP custom)

Risk Class C           ask            ask            enforce        enforce
(tool calls)           (allowlist)    (allowlist)    (per-tool)     (per-tool)

Risk Class D           blocked*       blocked*       sandbox_req+   sandbox_req+
(file edit, command)                                 ask            approval

Risk Class E           blocked**      blocked**      blocked**      blocked
(unknown)              * override via tier upgrade or risk acceptance
                       ** override via Discovery Mode (admin, audit-only)
```

Tenant pode aceitar risco e mover capability específica para enforcement mais permissivo dentro do que o tier permite, registrando em `tenant_capability_acceptance` (§8 e §16.7).

---

## 5. Tracks paralelos

ADP v4 reconhece formalmente que **GovAI é mais de um track de engenharia simultâneo**. Tentar enfiar tudo em PRs sequenciais de backend leva a perda de qualidade.

### 5.1 Backend Track — Provider Completion + Governance

Owner técnico: backend engineer (Claude Code session via prompts curados).

**Escopo:** API server, audit chain, capability registry, providers, DLP, policy engine, KMS, tenant isolation.

**Sequência prevista:**
- PR1 (concluído): Runtime Phase 1 — Governed Run hermético E2E.
- PR2 (próximo): Native Provider Experience (Anthropic + OpenAI completos, 6 capabilities supported, passthrough allowlisted).
- PR3-PR8: hardening, tools, files, multimodal, agentic safety, sandbox.

### 5.2 Frontend Track — Native UX

Owner técnico: frontend engineer (Claude Code session distinta, com prompts próprios).

**Escopo:** UI nativa, chat shell, model picker, streaming visual, code workspace, file tree, audit drawer, approval modals, tier-aware UX.

**Princípio:** UI **espelho próprio** com fidelidade máxima às UIs oficiais. Não embeddar UI oficial (não é técnica nem licencialmente possível).

**Sequência prevista:**
- FE-PR1 (paralelo a PR2 backend): app shell + chat básico + model picker + run timeline drawer + audit drawer + capability badges. Consome `/v1/runs`, `/v1/audit-events`, `/v1/capabilities` reais.
- FE-PR2-PRn: streaming visual, code workspace, multimodal, approval flows, tier-aware features.

**Regra:** `apps/web/` **só nasce quando FE-PR1 começar**. PR2 backend não cria pasta vazia. Contratos de UI ficam em `docs/contracts/ui-*.md` enquanto track Frontend não está ativo.

### 5.3 Legal/Compliance Track

Owner: jurídico interno (não engenharia).

**Escopo:** termos de uso, DPIA/RIPD, contratos por tier, DPA, política interna, aceite de risco, integração com `tenant_capability_acceptance`.

**Princípio:** jurídico não substitui controles técnicos, **mas registra aceite formal quando cliente decide assumir risco** dentro do que tier permite. Cada aceite gera audit event.

### 5.4 Infra/SRE Track

Owner: SRE / DevOps.

**Escopo:** deployment, CI/CD, monitoring, OTel collector, Postgres replicas, KMS provider integration (AWS KMS / GCP KMS / Azure Key Vault), backup, disaster recovery.

**Princípio:** infra real desde o piloto. Sem "vai virar production depois".

### 5.5 Cross-track contracts

Onde tracks tocam, há contratos formais:

- Backend ↔ Frontend: OpenAPI spec gerado de `apps/api`, types compartilhados via package `@govai/contracts` (futuro).
- Backend ↔ Legal: schema `tenant_capability_acceptance` + audit event `tenant.risk_accepted`.
- Backend ↔ Infra: env vars contract (`docs/runbooks/*-production.md`), boot fail conditions documentadas.
- Frontend ↔ Legal: UI mostra aceite quando cliente tenta liberar capability blocked-by-tier; aceite passa por backend e fecha loop com audit event.

---

## 6. ADRs canônicos

ADRs 1-13 preservados de v3. ADRs 14-23 são novos em v4.

### ADR-001 — Run é a unidade central, não Chat

**Status:** preservado.

Run unifica governance, evidence, cost, audit. Chat é UI sobre Runs. SDK clients geram Runs. Provider invocations rolam dentro de Runs.

### ADR-002 — Dois modos de operação

**Status:** preservado e expandido.

- **Governed Run** (primário, premium): pipeline completo com DLP + policy + audit + evidence.
- **Provider Passthrough** (secundário, baixa fricção): preserva shape nativo, reescreve credencial, audita.

V4 adiciona: cada modo opera sob enforcement determinado por tier × risk class × operational mode.

### ADR-003 — Provider-native, sem abstração lossy

**Status:** preservado.

Nunca normalizar Anthropic e OpenAI para shape comum. Cada provider tem wrapper que preserva tipos nativos, streaming protocol, error semantics.

### ADR-004 — Capability registry com facets, code-defined

**Status:** preservado, expandido em ADR-015.

Capability não está em DB principal. Está em código (`packages/core-governance/src/registry.ts`). DB tem `capability_overrides` por org (downgrade-only).

### ADR-005 — Governance levels nominais + evidence_strength ortogonal

**Status:** revisado em v4.

**Levels nominais (v4 canônico):**

- `passthrough_audited` (= 1) — Auth + tenant + audit + cost + credential rewrite. Payload nativo preservado.
- `policy_governed` (= 2) — `passthrough_audited` + DLP semântica + policy allow/deny/redact/mutate + audit detalhado.
- `evidence_grade` (= 3) — `policy_governed` + evidence record + framework_refs + attestation chain.

`0 = blocked` mantém-se como atalho para `status = blocked`, mas v4 prefere distinguir `status` de `level` formalmente.

**Evidence strength (ortogonal ao level):**

| `evidence_strength` | Significado | Disponível no baseline |
|---|---|---|
| `hmac_internal` | HMAC chain GovAI | Sim |
| `dev_signed` | Assinatura DevSigner (dev) | Sim |
| `external_anchor` | Chain head ancorado externamente (TSA, Merkle public) | Não — `planned` |
| `customer_signed` | Evento assinado pela chave do cliente (KMS cliente) | Não — `planned` |
| `icp_brasil_tsa` | ICP-Brasil A3/HSM + TSA RFC 3161 | Não — `planned` |

Regra de claim:
- `evidence_grade` + `hmac_internal | dev_signed` = **internal cryptographic evidence** (uso interno, investigações forenses dentro da relação cliente-GovAI).
- `evidence_grade` + `external_anchor | customer_signed | icp_brasil_tsa` = **external regulatory evidence** (apresentável a auditor externo, regulador, processo judicial).
- No baseline, GovAI **não vende, descreve ou marca** capability como "regulatory-grade externo".

### ADR-006 — Zero placeholders públicos

**Status:** preservado.

- Permitido: contratos internos (interface `Signer`), docs (`docs/contracts/*.md`), capability `planned`.
- Proibido: rota retornando `503` ou texto genérico, package vazio, backend "fake but compiles", `TODO` silencioso em path crítico.

V4 adiciona: rotas deferidas devem retornar `501` com schema estruturado (consolidado pelo PR1 runtime patch). `apps/web/` vazio é proibido — só nasce com FE-PR1.

### ADR-007 — Real infrastructure desde commit 1

**Status:** preservado.

Postgres real, Redis real, Testcontainers, migrations reais, RLS na primeira migration. Sem in-memory baseline.

### ADR-008 — KMS correto desde o início

**Status:** preservado.

Dev/Test KMS estável fora de production. Production sem KMS real **falha no boot**. HKDF por purpose/org/key_version.

### ADR-009 — Audit chain é fundação, com defense-in-depth

**Status:** preservado.

Append-only triggers + RLS multi-comando-multi-role + advisory lock por chain + HMAC choreography + canonical_bytes preservation.

### ADR-010 — Observability não substitui audit

**Status:** preservado.

OTel para troubleshooting/dashboards. Audit chain tamper-evident para evidência forense. São coisas distintas.

### ADR-011 — Right-to-erasure compatível com append-only

**Status:** preservado.

Crypto-shred via DEK wrap removal. Audit event armazena hash, payload separado em `audit_event_payloads` com DEK envelope-encrypted. RBAC + audit denial obrigatórios.

### ADR-012 — Cost attribution com procedência

**Status:** preservado.

`usage_json.source` declara origem dos números (`provider_direct`, `provider_response`, `tokenizer_estimate`, `manual`). Sem mistura silenciosa.

### ADR-013 — Runtime patch lessons

**Status:** preservado de v3 atualizado pós-PR1.

Lições registradas:
- Foundation não é Baseline. Não tagar release até PR3 mínimo.
- Codex loop fechado obrigatório em todo PR (normal + adversarial enxuto pós-fixes).
- Acceptance criteria numéricos por PR.
- Coverage gate ativo, não zerado.
- 501 estruturado para deferred; 503 reservado para "service temporarily unavailable".

### ADR-014 — Native-first principle

**Status:** novo em v4.

GovAI prioriza compatibilidade máxima com SDKs oficiais. Cliente continua usando `@anthropic-ai/sdk`, `openai`, `@anthropic-ai/claude-agent-sdk` sem perda de funcionalidade. Governança aplicada em camada **around**, não substituindo.

**Implicações:**
- Nenhum wrapper lossy.
- Streaming preservado byte-by-byte quando enforcement permite.
- Errors preservados no shape do provider quando enforcement permite (com `x-govai-*` headers adicionais).
- UI espelho com fidelidade máxima, não substituição reduzida.

### ADR-015 — Three coverage dimensions as canonical vocabulary

**Status:** novo em v4.

SDK coverage / runtime support / governance support são vocabulário oficial. Aparecem em:
- Capability registry types
- Response de `GET /v1/capabilities`
- Provider Coverage Matrix (`docs/architecture/provider-coverage-matrix.md`)
- Dashboards internos
- Documentação de marketing técnico
- Reports de progress por PR

### ADR-016 — Tier-based enforcement

**Status:** novo em v4.

`organizations.tier` determina enforcement default da Tier Policy Matrix (§4.3). Tenant pode aceitar risco para mover capability específica para enforcement mais permissivo dentro do permitido pelo tier, via `tenant_capability_acceptance` com aceite jurídico registrado em audit chain.

### ADR-017 — Progressive Enforcement

**Status:** novo em v4.

Enforcement runtime opera em 6 modos: `observe`, `warn`, `ask`, `enforce`, `sandbox_required`, `blocked`. Determinados pela matriz Risk Class × Tier × Operational Mode. Não há "blocked por padrão" como postura geral — há postura específica por classe de risco.

### ADR-018 — Risk Classes A-E

**Status:** novo em v4.

Toda capability é classificada em uma das cinco classes de risco (§14.1). Classificação é compile-time, declarada no registry. Determina enforcement default e tier availability.

### ADR-019 — Operational Modes

**Status:** novo em v4.

Modos transversais a tier:
- `production` — enforcement conforme Tier Policy Matrix.
- `pilot` — enforcement reduzido para Risk Class A-B com expiração obrigatória.
- `discovery` — admin-only, time-boxed, audit-only, permite Risk Class E para mapeamento.
- `test_harness` — hermético, permite planned capabilities, nunca production.
- `dev` — ambiente local de desenvolvedor, sem cliente real.

### ADR-020 — Provider Coverage Matrix as artifact

**Status:** novo em v4.

`docs/architecture/provider-coverage-matrix.md` é artefato canônico atualizado a cada PR que toca provider. Lista exaustiva de capabilities Anthropic e OpenAI com colunas mínimas:

```
provider | capability_id | endpoint | sdk_method | status | level |
base_risk_class | tier_availability | enforcement_default | facets |
planned_phase | docs_url | last_live_test_at | test_evidence
```

Sem matriz, capability nova não pode ser merged.

### ADR-021 — Allowlist versionada para passthrough

**Status:** novo em v4.

Passthrough Anthropic/OpenAI opera sobre **allowlist explícita** de endpoints. Endpoint não-allowlisted retorna `403 capability_not_registered` em production, ou `200 + audit_only` em Discovery Mode. Allowlist tem versão (`allowlist_version` em audit event) para que mudanças sejam rastreáveis.

### ADR-022 — UI track separado do backend

**Status:** novo em v4.

Frontend é track próprio com sessões de Claude Code distintas, prompts próprios, sequência FE-PR1...FE-PRn. Backend não cria `apps/web/` vazio. Contratos de UI em `docs/contracts/ui-*.md` enquanto track Frontend não está ativo.

### ADR-023 — Lessons from Foundation Checkpoint to Runtime Phase 1

**Status:** novo em v4. Compila aprendizado dos 3 ciclos PR0-PR1-pre-merge.

**O que funcionou:**
- ADP como fonte de verdade canônica (não modificável dentro de execução).
- Prompts com critérios numéricos verificáveis.
- Codex normal + adversarial enxuto pós-fixes (loop fechado).
- Provider-protocol test server hermético.
- Defense-in-depth na audit chain (RLS + triggers + advisory lock + HMAC choreography).

**O que falhou:**
- Prompt grande sem gates por bloco → redução unilateral de escopo (PR0).
- Codex review único sem re-run → fixes não validados (PR0).
- "Promova uma capability" como gate → conservadorismo que contradiz tese.
- Senha hardcoded em bootstrap → falha de configuração (corrigido em pre-merge).

**Princípios derivados:**
- Cada PR tem critérios numéricos por bloco/capability, não overall.
- Codex loop fechado é não-negociável.
- Postura de produto (native-first) não pode ser revisada dentro de execução; só em ADP.
- Senhas, chaves, segredos vêm de env via GUC/secret manager. Bootstrap é idempotente mas exige injeção explícita.

---

## 7. Estrutura de monorepo

```
govai-platform/
├── apps/
│   ├── api/                  # Fastify + pipeline runtime
│   │   ├── src/
│   │   │   ├── db/           # migrations, client, migrate runner
│   │   │   ├── pipeline/     # auth, tenant, capability, dlp, policy, invoke, orchestrator
│   │   │   └── routes/       # /v1/runs, /v1/audit-events, /v1/capabilities, /passthrough/*, /admin/*
│   │   └── tests/            # unit
│   └── web/                  # APENAS quando FE-PR1 começar (não criar vazio)
│
├── packages/
│   ├── config/               # zod schemas para env vars + boot validation
│   ├── core-events/          # chain_id derivation + event types
│   ├── core-audit/           # canonical-json + sha256 + hmac + lock-key + append + verify
│   ├── core-tenant/          # setLocalAppOrgId + RLS helpers
│   ├── core-identity/        # KMS interface + DevKms + JWT verifier + API keys argon2 + RBAC
│   ├── core-governance/      # capability registry types + BASELINE_REGISTRY + resolveEffectiveLevel + risk classification + tier matrix
│   ├── provider-anthropic/   # SDK wrapper, capabilities, passthrough, agent-sdk integration
│   │   └── src/
│   │       ├── messages/
│   │       ├── streaming/
│   │       ├── tools/        # planned PR4
│   │       ├── files/        # planned PR5
│   │       ├── prompt-caching/
│   │       ├── thinking/
│   │       ├── computer-use/ # planned PR7, blocked default
│   │       ├── agent-sdk/    # planned PR7
│   │       ├── passthrough/  # PR2 — allowlist
│   │       ├── usage/
│   │       ├── errors/
│   │       └── capabilities.ts
│   ├── provider-openai/      # SDK wrapper, capabilities, passthrough
│   │   └── src/
│   │       ├── responses/
│   │       ├── chat-completions/
│   │       ├── streaming/
│   │       ├── tools/        # planned PR4
│   │       ├── files/        # planned PR5
│   │       ├── batches/      # planned PR5
│   │       ├── embeddings/   # planned PR5
│   │       ├── images/       # planned PR6
│   │       ├── audio/        # planned PR6
│   │       ├── realtime/     # planned PR6
│   │       ├── passthrough/  # PR2 — allowlist
│   │       ├── usage/
│   │       ├── errors/
│   │       └── capabilities.ts
│   ├── dlp-br/               # CPF, CNPJ, email, phone_br + custom RE2
│   └── signing/              # DevSigner Ed25519 + Signer interface (TSA/ICP-Brasil planned)
│
├── infra/
│   ├── docker-compose.yml    # POSTGRES_PASSWORD obrigatório (sem default)
│   └── postgres/
│       └── bootstrap.sql     # roles + schema, exige SET govai.app_password GUC
│
├── tests/
│   └── integration/
│       ├── fixtures/         # provider-protocol test server hermético
│       ├── helpers/          # server fixture, seed helpers
│       └── *.test.ts         # E2E, RLS, CAP, PCG, NI, CR, etc.
│
└── docs/
    ├── architecture/
    │   ├── adr/              # ADR-001 a ADR-023
    │   ├── baseline-decisions.md
    │   └── provider-coverage-matrix.md   # NOVO em v4 — artefato canônico
    ├── contracts/            # passthrough-headers, icp-brasil, tsa-rfc-3161, mcp-security, shadow-ai, evidence-anchoring, computer-use-sandbox, ui-* (futuro)
    └── runbooks/             # canonical-reconstruction-fallback, kms-production, planned-capability-guard, db-roles-production
```

`apps/web/` listado apenas para reserva semântica. **Não criar enquanto FE-PR1 não começar.**

---

## 8. Modelo de dados

### 8.1 Entidades preservadas de v3

`organizations`, `users`, `runs`, `provider_invocations`, `policy_decisions`, `audit_events`, `audit_event_payloads`, `capability_overrides`, `dlp_detector_custom`, `api_keys`, `dlp_baseline_config`.

### 8.2 Entidades novas em v4

#### `organizations.tier` (coluna nova)

```sql
ALTER TABLE govai.organizations
  ADD COLUMN tier text NOT NULL DEFAULT 'starter'
    CHECK (tier IN ('starter', 'business', 'enterprise', 'regulated'));
```

#### `organizations.operational_mode` (coluna nova)

```sql
ALTER TABLE govai.organizations
  ADD COLUMN operational_mode text NOT NULL DEFAULT 'production'
    CHECK (operational_mode IN ('production', 'pilot', 'discovery', 'test_harness', 'dev'));

ALTER TABLE govai.organizations
  ADD COLUMN operational_mode_expires_at timestamptz;
```

`operational_mode_expires_at` é obrigatório quando `operational_mode IN ('pilot', 'discovery')`. Validação: trigger ou check constraint condicional.

#### `tenant_capability_acceptance` (tabela nova)

Registra aceite formal quando cliente decide assumir risco para liberar capability blocked-by-tier dentro do permitido.

```sql
CREATE TABLE govai.tenant_capability_acceptance (
  id                                 uuid        PRIMARY KEY,
  org_id                             uuid        NOT NULL REFERENCES govai.organizations(id),
  capability_id                      text        NOT NULL,
  enforcement_override               text        NOT NULL
    CHECK (enforcement_override IN ('observe', 'warn', 'ask', 'enforce', 'sandbox_required')),
  scope                              jsonb       NOT NULL,  -- {users: [...], projects: [...], ...}
  -- Aceite jurídico se refere ao base_risk_class declarado no registry no momento.
  -- Se uma execução escalar para effective_risk_class > max_effective_risk_class_allowed,
  -- o aceite NÃO se aplica e a chamada é avaliada pelo default da tier policy matrix.
  base_risk_class_at_acceptance      text        NOT NULL CHECK (base_risk_class_at_acceptance IN ('A','B','C','D','E')),
  max_effective_risk_class_allowed   text        NOT NULL CHECK (max_effective_risk_class_allowed IN ('A','B','C','D','E')),
  tier_at_acceptance                 text        NOT NULL,
  accepted_by_user_id                uuid        NOT NULL,
  accepted_by_role                   text        NOT NULL,  -- 'admin', 'data_protection_officer', 'cto', etc.
  approved_by_user_id                uuid,                   -- separação de quem solicita vs quem aprova
  approved_by_role                   text,
  legal_basis                        text        NOT NULL,  -- 'lgpd_art_7', 'consent', 'legitimate_interest', 'contract', etc.
  terms_version                      text        NOT NULL,  -- versão dos termos aceitos
  reason                             text        NOT NULL,
  expires_at                         timestamptz NOT NULL,  -- aceite SEMPRE expira
  review_required_at                 timestamptz NOT NULL,
  audit_event_id                     uuid        NOT NULL REFERENCES govai.audit_events(id),  -- fecha loop com chain
  revoked_at                         timestamptz,
  revoked_by_user_id                 uuid,
  revoked_reason                     text,
  created_at                         timestamptz NOT NULL DEFAULT now(),
  -- Garante que o teto de escalada é >= base (aceite só amplia ou mantém)
  CHECK (max_effective_risk_class_allowed >= base_risk_class_at_acceptance)
);

-- Índice parcial cobre apenas o predicado estável (revoked_at IS NULL).
-- O filtro temporal (expires_at > now()) fica na query, NÃO no predicado do
-- índice — Postgres proíbe funções voláteis como now() em predicados de índice
-- parcial (a definição precisa ser IMMUTABLE), e o resultado também ficaria
-- semanticamente errado: linhas mudariam de status conforme o relógio.
CREATE INDEX idx_tca_org_capability_unrevoked
  ON govai.tenant_capability_acceptance (org_id, capability_id, expires_at)
  WHERE revoked_at IS NULL;
```

Query típica para buscar acceptances ativas (filtra `expires_at > now()` no WHERE da query, não no índice):

```sql
SELECT * FROM govai.tenant_capability_acceptance
WHERE org_id = $1
  AND capability_id = $2
  AND revoked_at IS NULL
  AND expires_at > now();
```

Postgres usa o índice parcial `idx_tca_org_capability_unrevoked` para satisfazer `revoked_at IS NULL` e o ordering por `expires_at` permite descarte rápido das expiradas.

RLS: governada por `org_id` (mesma policy de outras tabelas tenant-scoped). FORCE ROW LEVEL SECURITY.

INSERT exige role admin via SECURITY DEFINER function que valida tier compatibility (`base_risk_class_at_acceptance` vs `tier`) e garante `max_effective_risk_class_allowed >= base_risk_class_at_acceptance`. Cada INSERT gera audit event `tenant.risk_accepted` na chain admin.

#### `provider_endpoint_allowlist` (tabela nova ou code-defined?)

**Decisão:** code-defined em `packages/provider-anthropic/src/passthrough/allowlist.ts` e `packages/provider-openai/src/passthrough/allowlist.ts`. Versão semântica (`allowlist_version`). DB tem apenas `allowlist_version` no audit event para rastreabilidade.

Razão: allowlist muda com release de produto, não por configuração de cliente. Tratada como capability registry — code-defined.

---

## 9. Append-only audit chain

**Sem mudanças em relação a v3.** Toda a defense-in-depth (bootstrap separado, owner role isolado, RLS multi-comando-multi-role, FORCE RLS, triggers append-only, função `audit_append_locked` SECURITY DEFINER, advisory lock por chain, HMAC choreography, canonical_bytes preservation) permanece canônica.

V4 adiciona apenas: novos tipos de audit event (`tenant.risk_accepted`, `tenant.risk_revoked`, `tier.changed`, `operational_mode.changed`) na chain `admin`.

A questão pendente sobre `audit_append_locked` validar `canonical_hash` SQL-side (Issue #1 do PR1) continua aberta para PR3.

---

## 10. Crypto-shredding (LGPD)

**Sem mudanças em relação a v3.** Preservado.

---

## 11. Pipeline

### 11.1 Governed Run

Preservado de v3 com adição: pipeline lê `org.tier`, `org.operational_mode`, `capability.base_risk_class`, `tenant_capability_acceptance` ativos, e calcula `effective_risk_class` via `computeEffectiveRiskClass` (§12.1) para computar `enforcement` final via Tier Policy Matrix.

```
1. Auth (API key ou JWT)
2. Tenant context (SET LOCAL app.org_id)
3. Load tier + operational_mode
4. Capability resolution (registry + overrides + acceptance)
5. Compute enforcement = TierPolicyMatrix(tier, effective_risk_class, operational_mode, acceptance)
   onde effective_risk_class vem de computeEffectiveRiskClass(capability, body, dlpFindings)
6. Apply enforcement:
   - observe   → audit-only, prossegue
   - warn      → audit + warning header, prossegue
   - ask       → 202 + ask_id, aguarda aprovação humana
   - enforce   → DLP + policy decision (allow/deny/redact/mutate)
   - sandbox_required → check sandbox availability; sem sandbox → blocked
   - blocked   → 403 + reason
7. Provider invoke (se enforcement permitiu)
8. Capture (usage, latency, request_id)
9. Audit append (run.completed | run.denied | run.failed | run.asked)
10. Persist (runs, provider_invocations)
11. Response
```

### 11.2 Provider Passthrough

Preservado de v3 com adições:

- **Allowlist check** antes do forward. Endpoint não-allowlisted retorna `capability_not_registered` em production.
- **Modo Transparent vs Governed:** Transparent (`passthrough_audited`, baixa fricção, audit por fora) e Governed (`policy_governed`, DLP/policy aplicados ao body antes do forward).
- **Tier-aware:** Starter default Transparent; Business+ default Governed; Regulated proíbe Transparent para Risk Class B+.

### 11.3 Passthrough credential rewrite

Preservado de v3.

### 11.4 Discovery Mode pipeline (novo em v4)

Ativação:
- Apenas `tenant.operational_mode = 'discovery'`
- Apenas usuários com role admin
- Tier Regulated **não permite** Discovery por padrão
- `operational_mode_expires_at` obrigatório (≤ 30 dias)
- Rate limit dedicado (low cap)

Comportamento canônico (com defesa contra exfiltração):

1. **DLP pre-scan obrigatório** sobre o body do request, mesmo em Discovery Mode.
2. **Se DLP detectar PII (CPF/CNPJ/email/phone) ou padrões de secret** (chaves de API, tokens, certificados):
   - `enforcement` mínimo é elevado para `ask`.
   - Audit event `discovery.sensitive_payload_detected` gerado.
   - Endpoint **não** é forwardado sem aprovação explícita do admin.
   - Aprovação admin gera audit event `discovery.sensitive_payload_approved` com `accepted_by_user_id`, `legal_basis`, `reason`.
   - Sem aprovação dentro do timeout (default 5 min) ou com negação explícita: response `403 capability_blocked_by_runtime` com `error: 'discovery.denied_sensitive_payload'`.
3. **Se DLP não detectar nada sensível:**
   - Endpoint não-allowlisted é forwardado para o provider em modo `audit_only`.
   - Response retorna 200 com `x-govai-discovery: true` header.
   - Audit event `discovery.endpoint_observed` na chain admin.
   - Backlog item criado automaticamente (issue ou ticket interno) para registrar a capability formalmente.
4. **Capability não é promovida automaticamente** — apenas observada. Promoção exige PR explícito que cumpra os 8 acceptance gates (§19).

**Por que DLP em Discovery:** sem DLP pre-scan, Discovery Mode vira vetor de exfiltração auditada. Admin malicioso ou conta admin comprometida poderia usar Discovery Mode para enviar payload sensível para endpoint arbitrário do provider, gerando audit (que prova exfiltração depois) mas sem prevenir o vazamento. DLP pre-scan + ask transforma Discovery em **observação controlada**, não em bypass.

### 11.5 Test Harness Mode pipeline (novo em v4)

Ativação:
- Apenas `tenant.operational_mode = 'test_harness'`
- `NODE_ENV='test'` ou flag explícita `GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION=1`
- Provider URL deve ser loopback (capability guard preservado de PR1)
- Nunca em production

Comportamento:
- Capabilities `planned` podem executar contra fixture
- Capabilities `supported` rodam normalmente
- Não promove capability automaticamente
- Audit event normal

### 11.6 GET /v1/capabilities (atualizado)

Response shape em v4:

```json
{
  "org_id": "...",
  "tier": "business",
  "operational_mode": "production",
  "capabilities": [
    {
      "id": "anthropic.messages.create",
      "provider": "anthropic",
      "status": "supported",
      "level": "policy_governed",
      "baseline_status": "supported",
      "base_risk_class": "A",
      "enforcement_default": "enforce",
      "tier_availability": ["starter", "business", "enterprise", "regulated"],
      "facets": [
        {
          "id": "pre_dlp",
          "level": "policy_governed",
          "status": "supported",
          "evidence_strength": "hmac_internal",
          "override_applied": false
        }
      ],
      "last_live_test_at": "2026-05-15T10:30:00Z",
      "docs_url": "docs/architecture/adr/ADR-014-anthropic-provider.md",
      "active_acceptances": []
    }
  ],
  "coverage_summary": {
    "anthropic": {
      "sdk_total": 31,
      "supported": 6,
      "planned": 18,
      "blocked_by_tier": 4,
      "not_exposed": 3
    },
    "openai": {
      "sdk_total": 37,
      "supported": 6,
      "planned": 22,
      "blocked_by_tier": 5,
      "not_exposed": 4
    }
  }
}
```

`coverage_summary` é o **painel de progresso** do produto. Cliente consulta para saber exatamente onde GovAI está em relação ao SDK do provider.

**Nota canônica sobre risk class no response:**

`GET /v1/capabilities` retorna apenas `base_risk_class` (estático, do registry compile-time). **Não** retorna `effective_risk_class` — esse só existe em decisões de runtime (audit events, policy_decisions, response do `POST /v1/runs`). Endpoint estático não tem informação de payload para calcular escalada.

Para uma decisão runtime sobre uma chamada específica, o response do `POST /v1/runs` (e o audit event correspondente) carrega o objeto `RuntimeRiskDecision` completo com `base_risk_class`, `effective_risk_class`, `escalation_reasons` e `dlp_findings` resumidos.

---

## 12. Capability registry com 3 dimensões

### 12.1 Schema TypeScript v4.1

```typescript
type CapabilityStatus = 'not_exposed' | 'planned' | 'supported' | 'blocked';
type CapabilityLevel = 'passthrough_audited' | 'policy_governed' | 'evidence_grade';
type EnforcementMode = 'observe' | 'warn' | 'ask' | 'enforce' | 'sandbox_required' | 'blocked';
type RiskClass = 'A' | 'B' | 'C' | 'D' | 'E';
type Tier = 'starter' | 'business' | 'enterprise' | 'regulated';
type RiskEscalationReason =
  | 'static_registry'      // sem escalada — usa base_risk_class
  | 'dlp_escalation'       // DLP detectou PII no payload (A → B)
  | 'tool_detected'        // body contém tools array (A → C)
  | 'file_payload'         // request inclui file upload/reference (A → B; ou C se executable)
  | 'agentic_action'       // chamada implica file_edit/bash/computer_use (→ D)
  | 'custom_rule';         // regra de tenant custom

type CapabilityFacet = {
  id: string;
  level: CapabilityLevel;
  status: CapabilityStatus;
  evidence_strength?: 'hmac_internal' | 'dev_signed' | 'external_anchor' | 'customer_signed' | 'icp_brasil_tsa';
  reason?: string;
  last_live_test_at?: string;
  docs_url?: string;
};

type Capability = {
  id: string;
  provider: 'anthropic' | 'openai';
  status: CapabilityStatus;
  level: CapabilityLevel;
  base_risk_class: RiskClass;            // compile-time, declarado no registry
  enforcement_default: EnforcementMode;
  tier_availability: Tier[];
  facets: CapabilityFacet[];
  // Numeric level (legacy v3 compat) derivado nominalmente
  // 0=blocked, 1=passthrough_audited, 2=policy_governed, 3=evidence_grade
};

// Decisão runtime que materializa effective_risk_class por chamada
type RuntimeRiskDecision = {
  capability_id: string;
  base_risk_class: RiskClass;            // do registry
  effective_risk_class: RiskClass;       // calculado em runtime
  escalation_reasons: RiskEscalationReason[];  // pode haver várias (DLP + tools)
  dlp_findings?: Array<{ detector: string; matches: number }>;  // resumo, não conteúdo
  decided_at: string;                    // timestamp
};
```

Validação Zod no boot:
- `level === 'evidence_grade'` → pelo menos um facet com `evidence_strength` definido.
- `base_risk_class === 'D' || 'E'` → `tier_availability` não inclui `starter` nem `business` (a menos que `enforcement_default = 'observe'` em modo observação para discovery).
- Capability `supported` → `last_live_test_at` < 30 dias do PR de promoção (validado em CI release window, não PR-blocker).

**Risk class effective vs base — regra de runtime:**

A capability declara `base_risk_class` no registry (compile-time). Em runtime, o pipeline pode **escalar** o risco baseado em sinais do payload:

```typescript
function computeEffectiveRiskClass(input: {
  capability: Capability;
  requestBody: unknown;
  dlpFindings: DlpScanResult;
}): RuntimeRiskDecision {
  let effective = input.capability.base_risk_class;
  const reasons: RiskEscalationReason[] = ['static_registry'];

  // DLP detectou PII → escala A para B
  if (input.dlpFindings.findings.length > 0 && effective === 'A') {
    effective = 'B';
    reasons.push('dlp_escalation');
  }

  // Body contém tools array → escala para C (se ainda A ou B)
  if (hasTools(input.requestBody) && (effective === 'A' || effective === 'B')) {
    effective = 'C';
    reasons.push('tool_detected');
  }

  // Body referencia arquivos (file IDs, file_search) → escala para B mínimo
  if (hasFileReference(input.requestBody) && effective === 'A') {
    effective = 'B';
    reasons.push('file_payload');
  }

  // Body contém ação agentic detectável → escala para D
  if (hasAgenticAction(input.requestBody) && effective !== 'D' && effective !== 'E') {
    effective = 'D';
    reasons.push('agentic_action');
  }

  return {
    capability_id: input.capability.id,
    base_risk_class: input.capability.base_risk_class,
    effective_risk_class: effective,
    escalation_reasons: reasons,
    dlp_findings: input.dlpFindings.findings.map(f => ({ detector: f.detector, matches: f.count })),
    decided_at: new Date().toISOString(),
  };
}
```

A Tier Policy Matrix (§4.3 e §12.4) opera sobre **`effective_risk_class`**, não `base_risk_class`. Audit event registra ambos (`base_risk_class` para diagnóstico, `effective_risk_class` para decisão).

Exemplo:
- `anthropic.messages.create` declara `base_risk_class: 'A'`.
- Cliente Starter envia prompt com CPF → DLP detecta → `effective_risk_class: 'B'`.
- Tier Starter × Risk B = `warn` → audit event registra warning, prossegue.
- Cliente Business envia o mesmo → Tier Business × Risk B = `enforce` → DLP redact aplicado.

Sem essa distinção, `base_risk_class` puramente estático perderia a escalada por DLP — bug de produto que eliminaria o valor central do GovAI.

### 12.2 Provider Coverage Matrix obrigatória

Artefato canônico: `docs/architecture/provider-coverage-matrix.md`.

Formato:

```markdown
# Provider Coverage Matrix

Versão: <PR atual>
Última atualização: <timestamp>

## Anthropic (SDK @anthropic-ai/sdk vX.Y.Z)

| capability_id | endpoint | sdk_method | status | level | base_risk_class | tier_availability | enforcement_default | facets | planned_phase | docs_url | last_live_test_at |
|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic.messages.create | POST /v1/messages | client.messages.create | supported | policy_governed | A | all | enforce | pre_dlp,provider_invoke,usage_capture,final_audit_hash | n/a | adr/ADR-014 | 2026-05-15 |
| anthropic.messages.stream | POST /v1/messages (stream) | client.messages.stream | supported | policy_governed | A | all | enforce | ... | n/a | adr/ADR-014 | 2026-05-15 |
| anthropic.messages.tools | POST /v1/messages with tools | client.messages.create | planned | policy_governed | C | business+ | ask | tool_allowlist,tool_call_audit | PR4 | contracts/tools.md | n/a |
| anthropic.files.upload | POST /v1/files | client.files.create | planned | policy_governed | B | business+ | enforce | dlp_pre_upload,file_metadata_audit | PR5 | contracts/files.md | n/a |
| anthropic.computer_use | POST /v1/messages with computer use | client.messages.create | supported | passthrough_audited | D | enterprise,regulated | sandbox_required | sandbox_check,command_audit | PR7 | contracts/computer-use-sandbox.md | n/a |
| anthropic.agent.query | claude-agent-sdk query() | agent.query | planned | policy_governed | A | all | enforce | session_audit,tool_inventory | PR7 | contracts/claude-agent.md | n/a |
| anthropic.agent.file_edit | claude-agent-sdk file_edit | agent.file_edit | supported | policy_governed | D | business+ | ask | diff_review,approval_workflow | PR7 | contracts/claude-agent.md | n/a |
| anthropic.agent.command_execution | claude-agent-sdk bash | agent.bash | supported | passthrough_audited | D | enterprise,regulated | sandbox_required | sandbox_check,command_allowlist | PR7 | contracts/claude-agent.md | n/a |
... (continuação completa)

## OpenAI (SDK openai vX.Y.Z)

| ... | ... |
```

Cada PR que toca provider **deve** atualizar a matriz. Sem matriz atualizada, PR não é aceito.

PR2 cria a matriz inicial com universo completo (Anthropic + OpenAI), maioria como `planned` ou `not_exposed`, e populates `supported` para as 6 capabilities do PR2 + universo passthrough conforme allowlist.

### 12.3 Risk classification por capability

Toda capability tem `base_risk_class` declarado em `capabilities.ts`. Classificação é compile-time. Runtime escala via `computeEffectiveRiskClass` (§12.1):

- **A — Geração textual / leitura / streaming sem tool.** Default low enforcement.
- **B — Payload com PII potencial.** DLP semântica obrigatória em Business+.
- **C — Tool calls / ações externas.** Allowlist + ask.
- **D — Execução local / agentic perigoso.** Sandbox + approval.
- **E — Unknown / unregistered.** Discovery Mode only.

Detalhado em §14.1.

### 12.4 Tier × enforcement matrix

Implementada em `packages/core-governance/src/tier-policy.ts`:

```typescript
export function computeEnforcement(input: {
  tier: Tier;
  riskDecision: RuntimeRiskDecision;       // contém effective_risk_class
  operationalMode: OperationalMode;
  capability: Capability;
  acceptances: TenantCapabilityAcceptance[];
}): EnforcementMode {
  // 1. Se capability.tier_availability não inclui tier → 'blocked'
  // 2. Acceptance ativa para esta capability nesta org?
  //    → usa acceptance.enforcement_override (se mais permissivo que default)
  // 3. Senão, lookup TierPolicyMatrix[tier][riskDecision.effective_risk_class]
  // 4. operational_mode adjustments:
  //    - pilot pode downgrade de 'enforce' para 'warn' em A-B
  //    - discovery pode adicionar 'audit_only' wrapping
  //    - test_harness preserva mas marca como hermético
  // 5. Se capability.enforcement_default = 'sandbox_required' AND sandbox indisponível
  //    → retorna 'blocked'
  // 6. Retorna EnforcementMode final
}
```

**Crítico:** `riskDecision.effective_risk_class` é o que entra na matriz, não `base_risk_class`. Audit event registra ambos para diagnóstico.

---

## 13. Native Provider Experience

### 13.1 Transparent Passthrough

**Objetivo:** máxima compatibilidade. Cliente percebe latência, mas não comportamento alterado.

```
preserva payload completo
preserva response completo (incluindo headers do provider relevantes)
preserva streaming SSE/chunk byte-by-byte
mínima transformação
audit por fora (request_hash, response_hash, status_code, latency)
sem DLP semântica
sem policy decision
```

Level: `supported + passthrough_audited`.

Tiers: `starter` default. `business` opcional. `enterprise/regulated` apenas para Risk Class A.

### 13.2 Governed Passthrough

**Objetivo:** compatibilidade + controles.

```
pre-DLP no body do request
policy decision (allow/deny/redact/mutate)
budget/rate limits per tenant
tool allowlist
audit detalhado da decisão
risk score
preserva response do provider quando enforcement = allow
```

Level: `supported + policy_governed`.

Tiers: `business+` default. `regulated` obrigatório para Risk Class B+.

### 13.3 Allowlist versionada

```typescript
// packages/provider-anthropic/src/passthrough/allowlist.ts

export const ANTHROPIC_PASSTHROUGH_ALLOWLIST = {
  version: '2026-05-04.1',
  endpoints: [
    { path: '/v1/messages', methods: ['POST'], base_risk_class: 'A', mode: 'transparent' },
    { path: '/v1/messages', methods: ['POST'], base_risk_class: 'C', mode: 'governed', condition: 'has_tools' },
    { path: '/v1/files', methods: ['POST', 'GET', 'DELETE'], base_risk_class: 'B', mode: 'governed' },
    // ...
  ],
};
```

Versão muda com release. Audit event do passthrough registra `allowlist_version` para rastreabilidade.

### 13.4 Unknown endpoint behavior

```
production (any tier):
  → 403 capability_not_registered
  → audit denial event

discovery mode (admin, time-boxed):
  → 200 forward + x-govai-discovery: true
  → audit event discovery.endpoint_observed
  → backlog item para mapeamento
```

### 13.5 Stream/error/payload preservation contract

Para capabilities `passthrough_audited`:

- **Streaming:** GovAI repassa cada chunk SSE/JSON do provider sem buffering completo. Apenas adiciona header `x-govai-run-id` no início do stream e calcula hash incremental para audit final.
- **Errors:** mantém shape do provider (`{ error: { type, message, code } }` para Anthropic; idem OpenAI). Adiciona header `x-govai-error-class` para mapeamento interno.
- **Payload:** request body é forwardado byte-a-byte após DLP/policy approval. Response body idem.

Para capabilities `policy_governed`:

- Streaming pode ser interrompido por policy decision (e.g. PII detectado mid-stream → fim do stream + audit record). Cliente recebe `x-govai-policy-action: redact|deny|allow` no trailer.
- Errors podem ter campos adicionais GovAI (mantendo shape original).
- Payload pode ser mutado (redaction) antes do forward.

---

## 14. Agentic Safety

### 14.1 Risk Classes

#### Classe A — Geração textual / leitura / streaming

**Default:** `observe` (Starter), `enforce` com policy permissiva (Business+).

**Exemplos:**
- `messages.create` (sem tools)
- `responses.create`
- `chat.completions.create`
- `messages.stream`
- `agent.query` (sem tool calls)
- `embeddings.create`

**Características:** payload textual, output textual ou stream de texto, sem efeito externo, sem ação local.

#### Classe B — Payload com PII potencial

**Default:** `warn` (Starter, DLP detect-only), `enforce` com DLP + policy (Business+).

**Exemplos:**
- `files.upload` (file metadata + content) — declarado base B no registry
- `files.list`, `files.retrieve`, `files.delete` — declarado base B

**Escalação dinâmica para B:**
- Qualquer capability declarada `base_risk_class: 'A'` cujo body do request contenha PII detectada por DLP-BR — escala para `effective_risk_class: 'B'` em runtime via `computeEffectiveRiskClass` (§12.1).

**Características:** dados pessoais ou empresariais sensíveis no payload. DLP-BR baseline aplica em Business+. **Atenção:** o registry declara o **base**; runtime escala dinamicamente.

#### Classe C — Tool calls / ações externas

**Default:** `ask` (Starter/Business com allowlist), `enforce` per-tool (Enterprise+).

**Exemplos:**
- `messages.create` com `tools: [...]`
- `responses.create` com tools
- `chat.completions.create` com function calling
- MCP tools
- Webhooks
- Browser tool (web search, file search)

**Características:** modelo pode invocar ação externa. Cada tool tem ID e classificação própria.

#### Classe D — Execução local / agentic perigoso

**Default:** `sandbox_required` (todos os tiers), `ask` adicional em Enterprise/Regulated.

**Exemplos:**
- `claude_agent.file_edit` — modifica arquivos reais
- `claude_agent.bash` / `command_execution` — executa shell
- `claude_agent.computer_use` — controla mouse/teclado/screenshot
- Equivalentes OpenAI quando existirem

**Características:** efeito local persistente. Sandbox isolation primitive obrigatório. Sem sandbox: `enforcement = blocked`.

#### Classe E — Unknown / unregistered

**Default:** `blocked` em production. `audit_only` em discovery (admin only).

**Exemplos:**
- Qualquer endpoint do provider que GovAI ainda não mapeou no registry
- Capability nova lançada pelo provider entre release de GovAI

**Características:** desconhecida ao GovAI. Risco indeterminado. Não forwarda em production.

### 14.2 Progressive Enforcement Modes

Detalhamento dos 6 modos:

| Mode | Comportamento | Use case típico |
|---|---|---|
| `observe` | Permite, audita, calcula risco. Não interrompe. | Discovery + Pilot Starter |
| `warn` | Permite + warning visível (header + UI badge). Audita. | Starter Risk Class B; Pilot |
| `ask` | Pausa execução. Audit event `run.asked`. UI mostra modal de aprovação. Aprovador é user com role apropriado. Aprovação ou negação geram audit. | Risk Class C/D; Approval workflows |
| `enforce` | Aplica policy decision: allow / deny / redact / mutate. Sem prompt humano. | Production default Risk Class B-C |
| `sandbox_required` | Verifica disponibilidade de sandbox primitive. Sem sandbox → `blocked`. Com sandbox → executa em isolamento + audit. | Risk Class D em qualquer tier que permita |
| `blocked` | Negação total. `403 capability_blocked_by_runtime` + reason. | Risk Class E em production; Risk Class D sem sandbox; capability fora de tier |

### 14.3 Claude Agent SDK governance

**Status atual (v4.1):** Claude Agent SDK e suas capabilities estão **`planned` para PR7**. Nenhuma é `supported` no PR2 ou anterior. A tabela abaixo mostra o **estado-alvo pós-PR7**, não o estado atual.

Mapeamento canônico (estado-alvo PR7+):

```
claude_agent.query              → status: supported    | base_risk_class: A | enforcement_default: enforce
claude_agent.session            → status: supported    | base_risk_class: A | enforcement_default: enforce
claude_agent.tool_call          → status: supported    | base_risk_class: C | enforcement_default: ask (com allowlist)
claude_agent.file_read          → status: supported    | base_risk_class: A | enforcement_default: enforce + DLP no output
claude_agent.file_edit          → status: supported    | base_risk_class: D | enforcement_default: ask (Business+)
                                                                              ask + sandbox (Enterprise)
                                                                              ask + sandbox + approval (Regulated)
claude_agent.bash               → status: supported    | base_risk_class: D | enforcement_default: sandbox_required (todos os tiers)
claude_agent.computer_use       → status: blocked      | base_risk_class: D | enforcement_default: sandbox_required
                                   reason: 'no sandbox primitive available pre-PR8'
                                   tier_availability: ['enterprise', 'regulated']
claude_agent.web_search         → status: supported    | base_risk_class: C | enforcement_default: enforce com allowlist de domínios
claude_agent.workspace_context  → status: supported    | base_risk_class: A | enforcement_default: enforce + DLP no payload
```

**Estado em PR2 (atual):** todas estão como `status: 'planned'` no registry, com `planned_phase: 'PR7'` (exceto `claude_agent.computer_use` que continua `blocked` mesmo após PR7 até existir sandbox primitive em PR8).

Cliente Enterprise/Regulated pode aceitar risco para mover `bash` para `enforce` se tiver sandbox próprio configurado em PR7+. Aceite vai para `tenant_capability_acceptance` (§8.2).

### 14.4 Sandbox requirements

`sandbox_required` exige primitive de isolamento. Implementação default GovAI (PR8+):

- Container efêmero (Docker/Podman) por execução
- Filesystem isolado (read-only base + tmpfs writable)
- Network egress allowlist
- Seccomp profile restritivo
- Resource limits (CPU, memory, time)
- Output capture com redaction
- Snapshot do diff de filesystem para audit

Cliente Enterprise pode trazer sandbox próprio (e.g. AWS Firecracker, Kubernetes Job com PSP) registrando como `external_sandbox_provider` no tenant config.

### 14.5 Approval workflows

`ask` mode requer:

- Audit event `run.asked` na chain run com payload do que será executado
- UI modal para aprovador (role configurável por capability)
- Timeout configurável (default 5 minutos)
- Aprovação ou negação → audit event + run prossegue ou termina como `denied`
- Notificação (email/Slack) opcional, configurável por tenant

---

## 15. DLP-BR

**Sem mudanças em relação a v3.** Detectores baseline (CPF, CNPJ, email, telefone) + custom RE2 com hardening. Aplicação varia por tier (detect-only em Starter, redact/deny configurável em Business+, custom em Enterprise+, obrigatório em Regulated).

---

## 16. Segurança

### 16.1-16.6 Preservados de v3.

### 16.7 Tenant-level capability override + acceptance

Override de capability vai para `capability_overrides` (downgrade-only, preservado de v3).

Aceite para upgrade temporário de enforcement vai para `tenant_capability_acceptance` (§8.2). Aceite **expira sempre**. Aceite **gera audit event** na chain admin.

Validação:
- Acceptance.enforcement_override deve ser **mais permissivo** que TierPolicyMatrix default (downgrade de risco controlado).
- Acceptance.expires_at obrigatório.
- Acceptance.legal_basis obrigatório.
- Acceptance.audit_event_id deve referenciar evento real na chain admin.

### 16.8 Operational mode boundaries

`operational_mode` controlado por SECURITY DEFINER function. Mudança gera audit event `operational_mode.changed` na chain admin. Validação:

- `discovery` exige `tier IN ('starter', 'business', 'enterprise')` (regulated proibido por padrão; pode liberar com aceite explícito).
- `discovery` e `pilot` exigem `expires_at` (≤ 30 dias).
- `test_harness` exige `NODE_ENV != 'production'`.
- Mudança requer role admin.

### 16.9 Pilot Mode expiração — regra canônica

Quando `operational_mode_expires_at` é atingido para uma org em `pilot`:

1. **Transição automática para `production`** com defaults do tier vigente.
2. **Audit event** `operational_mode.expired` na chain admin com:
   - `previous_mode: 'pilot'`
   - `new_mode: 'production'`
   - `expired_at: <timestamp>`
   - `org_id`
   - `tier_at_transition`
3. **Notificação** ao admin do tenant (email/webhook) 7 dias antes da expiração.
4. **Renovação explícita** disponível via endpoint admin `POST /v1/admin/operational-mode/renew` que:
   - Exige role admin
   - Cria nova janela `pilot` ≤ 30 dias
   - Gera audit event `operational_mode.renewed`
   - Não auto-renova; cada renovação é decisão consciente

A transição automática para `production` (não bloqueio) é **deliberada**: pilot que expira não deve quebrar a operação do cliente. Apenas eleva o enforcement para os defaults do tier. UI deve mostrar aviso visível pós-expiração para que cliente tenha ciência.

**Job que processa expirações:** worker periódico (a cada 5 minutos em production) que faz scan de orgs em `pilot` ou `discovery` com `operational_mode_expires_at < now()`, executa transição, gera audit event, dispara notificação. Falha do worker não é crítica para segurança (próxima execução pega).

Mesma regra para `discovery`:
- Expiração → transição automática para `production` (modo anterior do tenant)
- Audit event `operational_mode.expired` com `previous_mode: 'discovery'`
- Renovação explícita exigida; não auto-renova

---

## 17. Observability (OTel GenAI)

**Sem mudanças em relação a v3.** OTel para troubleshooting/dashboards. Spans com semantic conventions OpenTelemetry GenAI + GovAI custom attributes.

---

## 18. Testing strategy

### 18.1 CI default (preservado de v3)

- Unit tests todos os pacotes
- Integration tests Testcontainers (Postgres real)
- E2E hermetic Governed Run
- RLS canary
- Append-only defense
- Bootstrap idempotency
- Coverage gate ativo (atualmente 80% lines/statements/functions, 70% branches; Issue #2 eleva para 80% em PR3)

### 18.2 Live tests scheduled (preservado de v3)

Gate diário em release window. Não PR-blocker.

### 18.3 Test Harness Mode formalizado (novo em v4)

Modo operacional dedicado para testes que precisam de capabilities `planned`. Características:
- `NODE_ENV='test'` ou `GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION=1` (preservado de PR1).
- Provider URL deve ser loopback (preservado de PR1).
- Capabilities `planned` rodam em pipeline real.
- Usado por testes de integração que precisam exercitar o pipeline antes da promoção.

### 18.4 Tier-aware integration tests (novo em v4)

Cada tier gera matriz de testes:
- Starter org: Risk Class A passa, B `warn`, C `ask`, D `blocked`.
- Business org: A passa, B `enforce`, C `ask`, D `blocked` ou `sandbox_required` se acceptance.
- Enterprise org: A-C passam, D `sandbox_required`.
- Regulated org: A passa, B-C `enforce`, D `sandbox_required + approval`.

CI roda subset representativo. Live tests cobrem casos selecionados.

### 18.5 Registry ↔ Provider Coverage Matrix consistency test (novo em v4.1)

Teste obrigatório em todo PR que toca capability registry ou matrix. Roda em CI.

```typescript
// tests/integration/registry-matrix-consistency.test.ts

describe('Registry ↔ Coverage Matrix consistency', () => {
  it('every capability in registry appears in provider-coverage-matrix.md', () => {
    const registryIds = BASELINE_REGISTRY.map(c => c.id);
    const matrixIds = parseProviderCoverageMatrix();
    for (const id of registryIds) {
      expect(matrixIds).toContain(id);
    }
  });

  it('every capability in matrix appears in registry', () => {
    const registryIds = new Set(BASELINE_REGISTRY.map(c => c.id));
    const matrixIds = parseProviderCoverageMatrix();
    for (const id of matrixIds) {
      expect(registryIds.has(id)).toBe(true);
    }
  });

  it('status, level, base_risk_class match between registry and matrix', () => {
    const matrix = parseProviderCoverageMatrixDetailed();
    for (const cap of BASELINE_REGISTRY) {
      const matrixEntry = matrix.find(m => m.id === cap.id);
      expect(matrixEntry?.status).toBe(cap.status);
      expect(matrixEntry?.level).toBe(cap.level);
      expect(matrixEntry?.base_risk_class).toBe(cap.base_risk_class);
    }
  });
});
```

Sem este teste, a matriz vira documentação manual que desatualiza (drift) entre PRs.

### 18.6 Unknown passthrough endpoint behavior test (novo em v4.1)

Teste obrigatório para validar §11.4 (Discovery Mode) e §13.4 (allowlist):

```typescript
// tests/integration/unknown-passthrough-endpoint.test.ts

describe('Unknown passthrough endpoint behavior', () => {
  it('production mode + unknown endpoint → 403 capability_not_registered', async () => {
    const org = await seedOrg({ tier: 'business', operational_mode: 'production' });
    const res = await passthroughCall(org, 'GET', '/passthrough/anthropic/v1/some-new-endpoint');
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('capability_not_registered');
  });

  it('discovery mode + unknown endpoint + clean payload → 200 forward + audit_only', async () => {
    const org = await seedOrg({
      tier: 'enterprise',
      operational_mode: 'discovery',
      operational_mode_expires_at: addDays(new Date(), 7),
    });
    const res = await passthroughCall(org, 'GET', '/passthrough/anthropic/v1/some-new-endpoint');
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-govai-discovery']).toBe('true');
    // audit event discovery.endpoint_observed should exist
  });

  it('discovery mode + unknown endpoint + PII payload → 403 discovery.denied_sensitive_payload', async () => {
    const org = await seedOrg({
      tier: 'enterprise',
      operational_mode: 'discovery',
      operational_mode_expires_at: addDays(new Date(), 7),
    });
    const res = await passthroughCall(org, 'POST', '/passthrough/anthropic/v1/some-new-endpoint', {
      body: { content: 'Meu CPF é 111.444.777-35' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('discovery.denied_sensitive_payload');
    // audit event discovery.sensitive_payload_detected should exist
  });

  it('regulated tier + discovery mode → boot fail or runtime denial', async () => {
    // Regulated tier não permite discovery por padrão
    await expect(
      seedOrg({ tier: 'regulated', operational_mode: 'discovery' }),
    ).rejects.toThrow();
  });
});
```

### 18.7-18.9 Preservados de v3 (forbidden tests, canonical reconstruction, baseline acceptance).

---

## 19. Acceptance gates por capability

Para mover capability de `planned` para `supported`:

1. **Código real** em `packages/provider-{anthropic|openai}/src/{module}/` ou equivalente.
2. **Teste hermético** em `tests/integration/` ou pacote-local contra provider-protocol test server.
3. **Live test verde** executado durante o próprio PR de promoção (`last_live_test_at` populado com timestamp da execução). Para PRs subsequentes, regra "≤30 dias" aplica para revalidação periódica em release window.
4. **Capability registry entry** com `status`, `level`, `base_risk_class`, `enforcement_default`, `tier_availability`.
5. **ADR ou contrato** em `docs/architecture/adr/` ou `docs/contracts/`.
6. **Provider Coverage Matrix atualizada** com a capability promovida.
7. **Audit event gerado** em cada execução, com `policy_decision_id` quando enforcement != observe, e `RuntimeRiskDecision` completo (`base_risk_class` + `effective_risk_class` + `escalation_reasons`).
8. **Tier × enforcement matrix testada** para os tiers em `tier_availability`.

PR que promove capability sem cumprir os 8 gates é rejeitado.

**Nota sobre promoção inicial (PR2 e novos PRs de promoção):**

Promoção inicial de uma capability **não exige** live test prévio — exige que o próprio PR execute o live test (com `GOVAI_LIVE_TESTS=1`) e popule `last_live_test_at` com o timestamp dessa execução documentada. Sem isso, o gate se tornaria circular (não pode promover sem live test prévio; não pode rodar live test sem capability supported).

A regra "≤30 dias" se aplica para **revalidação contínua** pós-promoção: live test scheduled deve rodar dentro da janela de 30 dias para que `last_live_test_at` permaneça válido. Se passar de 30 dias, capability é marcada como `supported_stale` (ou similar) até nova execução verde.

---

## 20. Forbidden absolutos

Mantém v3 + adições v4:

**Mantidos:**
- Sem rota `503 pipeline_incomplete_in_baseline` ou texto genérico em rota deferida.
- Sem package vazio.
- Sem in-memory baseline.
- Sem ADR retroativo justificando lacuna de escopo.
- Sem chave/segredo em código, log, prompt, doc.
- Sem `pgcrypto` (decisão preservada; Issue #1 propõe revisão para PR3).
- Sem `gen_random_uuid()` SQL — UUIDs em TS.

**Adicionados em v4:**
- **Sem proxy cego** de unknown endpoints em production. Sempre verificar allowlist; unknown vai para `capability_not_registered` ou Discovery Mode.
- **Sem "blocked por padrão"** como postura geral. Postura é per Risk Class × Tier × Mode (§14).
- **Sem UI no mesmo PR que backend integration**. Track Frontend é separado (FE-PR1+).
- **Sem `apps/web/` vazio** em PR backend. Pasta nasce com FE-PR1.
- **Sem promoção automática** de capability em Discovery Mode. Discovery observa; promoção é PR explícito.
- **Sem aceite de risco sem expiração**. `tenant_capability_acceptance.expires_at` obrigatório.
- **Sem capability `supported`** sem `last_live_test_at` < 30 dias quando aplicável.
- **Sem coverage gate zerado**. Threshold ativo, ajustável com justificativa em ADR.

---

## 21. Roadmap de PRs

### PR2 — Native Provider Experience (Provider Completion Core)

**Objetivo:** estabelecer fundação provider-native real com cobertura ampla via passthrough e governed run para core capabilities.

**Entrega:**
- SDKs oficiais Anthropic + OpenAI instalados e usados (não fixture)
- 6 capabilities runtime promovidas para `supported + policy_governed`:
  - `anthropic.messages.create`
  - `anthropic.messages.stream`
  - `openai.responses.create`
  - `openai.responses.stream`
  - `openai.chat.completions.create`
  - `openai.chat.completions.stream`
- Streaming end-to-end real (SSE Anthropic, chunked OpenAI) chegando ao cliente
- Passthrough Anthropic + OpenAI com allowlist versionada (`supported + passthrough_audited` para A; `policy_governed` para B+ conforme tier)
- Live tests opt-in via `GOVAI_LIVE_TESTS=1`
- Capability registry populado com matriz completa
- **Provider Coverage Matrix criada** em `docs/architecture/provider-coverage-matrix.md`
- **Registry ↔ Matrix consistency test** (§18.5) — obrigatório
- **Unknown passthrough endpoint test** (§18.6) — obrigatório
- **`computeEffectiveRiskClass` implementado** (§12.1) com testes cobrindo escalações DLP, tools, file payload, agentic
- **Pilot Mode expiration worker** (§16.9) implementado e testado
- **Discovery Mode DLP pre-scan** (§11.4) implementado com teste de PII rejection
- ADRs 014-017 (Native-first, Three dimensions, Tier-based enforcement, Progressive enforcement)
- Schema migration: `organizations.tier`, `organizations.operational_mode`, `operational_mode_expires_at`, `tenant_capability_acceptance` (com índice parcial corrigido §8.2)

**Não-objetivo PR2:**
- UI completa (FE-PR1 paralelo)
- Tools/function calling (PR4)
- Files/batches (PR5)
- Multimodal/realtime (PR6)
- Claude Agent SDK file_edit/bash (PR7)
- Sandbox (PR7+)
- Crypto-shred E2E (PR3)
- Custom DLP CRUD (PR3)
- Concurrency stress (PR3)
- OTel boot completo (PR3)

### PR3 — Hardening + governance depth

- Issue #1 (`audit_append_locked` SQL-side validation)
- Issue #2 (branches coverage ≥80%)
- Crypto-shred E2E route
- Custom DLP CRUD route
- Concurrency stress 10×1000
- OTel boot completo
- Output DLP nas 6 capabilities (move facets `output_dlp` de `planned` para `supported`)

### PR4 — Tools / function calling

- Anthropic tools (`tool_use`, `tool_result`)
- OpenAI tools (function calling, parallel tool calls)
- Tool registry + allowlist por tenant
- Policy decision per tool
- Risk Class C enforcement (ask/enforce per tier)

### PR5 — Files / batches / embeddings

- Anthropic files API
- OpenAI files + batches + embeddings
- DLP pre-upload
- Hashing + retention policy

### PR6 — Multimodal / realtime

- Audio (Anthropic + OpenAI quando disponível)
- Vision (image input)
- OpenAI Realtime API
- Streamed media audit

### PR7 — Agentic Safety + Claude Agent SDK

- Claude Agent SDK integration
- file_edit + approval workflow
- bash + sandbox primitive
- computer_use blocked até sandbox real
- Risk Class D enforcement completo

### PR8+ — Conforme demanda

- Sandbox real (containers efêmeros)
- ICP-Brasil TSA anchoring
- MCP tools governance
- Provider adicional (Gemini, Bedrock) se houver demanda
- ShadowAI detection

### Tracks paralelos

- **FE-PR1** (paralelo a PR2 backend): app shell + chat + model picker + audit drawer
- **FE-PR2-PRn**: streaming visual, code workspace, multimodal UI, approval modals
- **Legal/Compliance**: contínuo, fora dos PRs de engenharia
- **Infra/SRE**: contínuo

---

## 22. Open questions

Questões pendentes para resolução em PRs futuros:

1. **`audit_append_locked` SQL-side validation** (Issue #1) — opção a/b/c em PR3.
2. **Branch coverage** (Issue #2) — escolha de threshold final em PR3.
3. **Sandbox primitive** — implementação interna vs delegação para sandbox externo do cliente. Decisão em PR7.
4. **ICP-Brasil TSA** — quando e como implementar. Depende de demanda de cliente Regulated.
5. **MCP tools governance** — policy granular ou tratamento como opaco. Decisão em PR7+.
6. **Tier upgrade/downgrade flow** — produto, não engenharia pura. Coordenar com Legal track.
7. **BYOK key rotation** — operacional. Runbook em PR3+.
8. **ShadowAI detection** — escopo e sinal. Decisão em PR8+.

---

## 23. Não-negociáveis para prompts Claude Code

Toda sessão Claude Code que recebe prompt baseado neste ADP deve respeitar:

1. **ADP é fonte canônica imutável durante execução.** Não modificar dentro de uma sessão. Mudanças passam por ADP vN+1.
2. **Prompts têm critérios numéricos.** Cada bloco do PR tem gate testável objetivo.
3. **Codex loop fechado obrigatório.** Normal + adversarial enxuto, ambos pós-fixes.
4. **Sem redução unilateral de escopo.** Se executor acha escopo grande demais, pára e reporta. Não corta.
5. **Sem ADR retroativo** justificando lacuna de escopo.
6. **501 estruturado** para deferred routes (consolidado por PR1 runtime patch). 503 reservado para downtime.
7. **Coverage gate ativo**, threshold em ADR ou justificativa explícita.
8. **Provider Coverage Matrix atualizada** em todo PR que toca provider.
9. **Live tests opt-in** via flag explícita; chaves nunca em repo.
10. **Tier × Risk × Mode matrix** consultada para todo enforcement decision.

---

## Próximo passo

Este ADP v4.2 substitui v4.1, v4 e v3 como fonte de verdade. Hash deste documento será pinado no próximo prompt PR2.

Sequência:

1. **Auditoria deste ADP v4.2** (você + GPT). Foco: consistência de nomenclatura `base_risk_class`/`effective_risk_class` em todos os contratos.
2. **Ajustes finos** se necessário (eu produzo v4.3 cirúrgica).
3. **Geração do prompt PR2** baseado em ADP v4.2 canônico.
4. **Geração do prompt FE-PR1** em paralelo.
5. **Execução** Claude Code (backend) + Claude Code (frontend).
6. **Auditoria** dos outputs.
7. **Merge** em main quando 4 e 6 fecharem.

ADP v4.2 não tem placeholder. Todas as decisões são pinadas. Toda referência a PR futuro tem a entrega explicitada. Toda capability tem `base_risk_class` (compile-time) e `tier_availability` declaráveis. Todo enforcement tem matriz determinística sobre `effective_risk_class` (runtime). Toda capability `planned` aparece como `planned`, nunca `supported`. Toda evidência é qualificada (`internal cryptographic` vs `external regulatory`).

**Fim do ADP v4.2.**
