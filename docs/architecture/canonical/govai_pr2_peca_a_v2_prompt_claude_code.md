# GovAI PR2 — Peça A v2 — Prompt Claude Code

**Versão:** v2 (substitui Peça A v1 integralmente)
**Data:** 2026-05-06
**Destinatário:** Claude Code (execução agêntica do PR2)
**Auditor:** arquiteto humano (revisão antes de autorizar execução)
**Status:** rascunho de auditoria. Não executar até aprovação explícita.

---

## 0. Pacote canônico de input — leitura obrigatória antes de iniciar

Claude Code DEVE ler todos os documentos abaixo na íntegra antes de tocar em qualquer arquivo do repositório:

| Documento | Hash | Papel |
|---|---|---|
| ADP v4.2 (Architecture Decision Package) | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` | base canônica conceitual; capability registry, Tier Policy Matrix, audit chain |
| Addendum ADP v4.2.2 — Macro Native Substrate | (gerado em 2026-05-06) | restringe v4.2; PR2 = Native Provider Substrate; Macro Native Substrate Contract |
| Provider Coverage Matrix v2 — Consolidated | `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777` | Matrix canônica de capabilities por provider |
| Provider Coverage Matrix v2.0.1 — Patch | `1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e` | 3 ajustes finais sobre Consolidated |

**Tudo que não está nos documentos acima ou nesta Peça A v2 é fora de escopo.**

Em conflito:

1. esta Peça A v2 prevalece sobre versões históricas dos prompts;
2. ADP v4.2, Addendum v4.2.2, Matrix v2 + patch v2.0.1 prevalecem sobre esta Peça A se houver conflito interpretativo (Peça A v2 é executora; canônicos são os contratos);
3. Princípios canônicos do Addendum v4.2.2 (§5) prevalecem sobre o que parecer expediente em código.

---

## 1. Objetivo do PR2

PR2 implementa o **Native Provider Substrate** do GovAI: a camada que permite clientes Anthropic e OpenAI usarem GovAI como gateway sem perder funcionalidade nativa, **com governança proporcional ao tier e ao risco**.

O contrato é **Macro Native Substrate Contract** (Addendum §6): a base do produto nasce como arquitetura macro consolidada; a implementação pode ser dividida em batches por volume, mas a base **não pode ser micro, provisória ou capada**.

**Princípios canônicos imutáveis** (do Addendum §5):

- O macro nasce como arquitetura. A implementação pode ser dividida em batches por volume de código e testes, mas a base não pode ser micro, provisória ou capada.
- Podemos dividir a execução. Não podemos dividir a arquitetura.
- Deep governance pode ser incremental. Native availability essencial não pode parecer capada.

**Tradução operacional para PR2:**

- 19 capabilities `supported` em PR2 (16 com endpoint + 3 tools), totalizando 28 endpoints obrigatórios funcionais (ver Matrix §27);
- 22 capabilities `planned` para PR3+ com `planned_phase` honesto;
- 2 capabilities `blocked` (apenas computer_use Anthropic + OpenAI por architectural prerequisite até PR8+);
- 5 capabilities/famílias `not_exposed` (admin Anthropic; assistants/threads/realtime_beta/completions_legacy OpenAI).

---

## 2. Estado inicial do repositório (verificar antes de começar)

Pré-condições que devem estar verdadeiras antes de qualquer commit. Se alguma falhar, **acionar Human Architect Escalation** (§4) — não tentar corrigir sozinho.

### 2.1 Estrutura

- pnpm monorepo, Node 24, Zod 4, Fastify, Postgres;
- 109 tests passando no baseline PR1;
- ADRs 001-013 aceitos;
- `core-audit/append.ts`, RLS multi-comando, advisory lock, DLP-BR baseline detectors — todos reais;
- `core-events/src/` exporta schemas Zod versionados.

### 2.2 SDKs já instalados

- `packages/provider-anthropic/package.json` declara `@anthropic-ai/sdk@0.92.0`;
- `packages/provider-openai/package.json` declara `openai@6.35.0`;
- `AnthropicProvider` preserva `Parameters<...>[0]` (sem normalização lossy);
- `OpenAIProvider` idem;
- ADR-003 (provider-native, sem GenericLLMRequest) está aceito.

### 2.3 Routes baseline (esperadas em 503 no estado pré-PR2)

- `/passthrough/anthropic/*` → 503 `pipeline_incomplete_in_baseline`;
- `/passthrough/openai/*` → 503 `pipeline_incomplete_in_baseline`;
- `/v1/runs` → 503 `pipeline_incomplete_in_baseline`;
- `/v1/audit-events` → 503 `pipeline_incomplete_in_baseline`.

PR2 substitui os 503 pelos endpoints funcionais conforme Macro Native Substrate Contract.

### 2.4 Registry baseline

- 8 capabilities registradas com `status: 'planned'`;
- `ANTHROPIC_BETA_ALLOWLIST` (constante TS) atualmente vazia;
- nenhum schema de capability tem `last_live_test_at` populado.

---

## 3. Princípios de execução (não-negociáveis)

### 3.1 Macro Native Substrate Contract — endpoints obrigatórios

Os endpoints da §6.2 e §6.3 do Addendum **devem** retornar comportamento nativo funcional ao final do PR2. Nenhum pode retornar 503/501 ou wrapper JSON. Lista canônica em Matrix §26.1.

### 3.2 Não-refatoração futura

Capabilities essenciais ao Macro Native Substrate **não podem** ser:

- marcadas `planned` silenciosamente para escapar do PR2;
- substituídas por wrapper temporário;
- entregar com 503/501 sob justificativa de "será implementado em PR3+";
- promovidas a `family_alias` em PR2 (status não existe em PR2 — Addendum + Matrix §7);
- ter SDK/streaming/tools[] quebrado.

Fallback declarável (deferível a PR3+) limita-se à lista do Matrix §2.5.

### 3.3 Tabelas de schema permitidas em PR2

Apenas **`govai.org_beta_overrides`** é tabela nova autorizada (Addendum §1; Matrix §5.1). Nenhuma outra tabela física pode ser criada em PR2:

- ❌ NÃO criar `govai.capability_decomposition_map` em PR2 (Matrix §7.3 — fica para PR de primeira decomposition real);
- ❌ NÃO introduzir `family_alias` no enum `CapabilityStatus`.

### 3.4 Provider-native, sem normalização

ADR-003 mantido: nenhum `GenericLLMRequest`. Tipos provider-nativos via `Parameters<OpenAI['responses']['create']>[0]` ou `Parameters<Anthropic['messages']['create']>[0]`. Sem normalização lossy entre providers.

### 3.5 Path do passthrough — diferença entre providers

| Provider | baseURL no SDK | Path completo via passthrough |
|---|---|---|
| Anthropic | `<govai>/passthrough/anthropic` | `<govai>/passthrough/anthropic/v1/messages` (SDK adiciona `/v1`) |
| OpenAI | `<govai>/passthrough/openai/v1` | `<govai>/passthrough/openai/v1/responses` (SDK não adiciona `/v1`) |

**Nunca duplicar `/v1/v1/...`.** ADR-013 (baseURL paths) já existe ou deve ser confirmado em PR2.

### 3.6 BetaTokenPolicy enum — 6 valores canônicos

Conforme Matrix §4: `'global_allowlist' | 'org_override_allowed' | 'hard_denied' | 'verification_required' | 'denied_until_decision' | 'removed_as_no_longer_needed'`.

`verification_required` é estado pré-merge; **antes do merge** todos os tokens marcados assim devem ser resolvidos para um dos cinco estados finais (Matrix §4.2).

### 3.7 Pre-merge gates

Os 9 gates de Matrix §28 são obrigatórios. Cada um vira test de integração no PR2 (§14 deste prompt).

### 3.8 Live tests

Suite live (`GOVAI_LIVE_TESTS=1`) é opt-in mas obrigatória para promoção de capability a `supported`. Cada capability `supported` precisa `last_live_test_at` populado (Matrix §16, §25). Suite total: <~8min, <~$4.20 por execução.

---

## 4. Human Architect Escalation — procedimento

Acionar quando uma das seguintes condições ocorrer:

### 4.1 Triggers obrigatórios

- endpoint do Macro Native Substrate descoberto como impossível de implementar com SDK atual;
- documentação do provider divergir do mapeamento da Matrix (campo, schema, status beta);
- live test falhar para capability `supported` obrigatória;
- conflito entre dois documentos canônicos do pacote;
- comportamento ambíguo entre Matrix e ADP v4.2;
- gate pré-merge não passa após esforço razoável e diagnóstico claro indica decisão arquitetural;
- token beta `verification_required` não pode ser resolvido por verificação técnica simples;
- nome canônico de tool ambíguo (ex.: `hosted_shell` vs `shell`);
- comportamento do SDK 0.92.0 / 6.35.0 incompatível com expectativa documentada.

### 4.2 Procedimento

1. **PARAR** o trabalho no batch corrente.
2. Não tentar workaround silencioso (wrapper, /501, marcação `planned` retroativa).
3. Não introduzir capability nova fora da Matrix.
4. Abrir `docs/architecture/escalations/PR2-ESC-NNN.md` com:
   - data e batch em execução;
   - descrição do impedimento;
   - referências aos documentos canônicos relevantes (linha/seção);
   - alternativas técnicas com prós/contras;
   - recomendação de Claude Code (se houver);
   - decisão pendente.
5. Reportar ao final da resposta com header `## ⚠️ HUMAN_ARCHITECT_ESCALATION_REQUIRED` listando o ID do documento de escalação.
6. Aguardar resolução por arquiteto humano antes de retomar.

### 4.3 NÃO acionar para

- decisões de implementação interna (estilo de código, organização de pastas dentro do batch);
- ajustes triviais de teste;
- correções de typo na documentação interna;
- escolhas de nome de variável.

---

## 5. Visão geral dos batches

PR2 é dividido em 7 batches. Ordem canônica:

| Batch | Nome | Conteúdo principal | Dependências |
|---|---|---|---|
| **F** | Foundation | tipos canônicos, schemas Zod (audit events), migration `org_beta_overrides`, `BetaTokenPolicy` enum, helpers compartilhados | nenhuma |
| **A** | Anthropic Provider Substrate | passthrough + tool classifier + ANTHROPIC_BETA_POLICY + 5 capabilities `supported` + tool capability `web_search` | F |
| **C** | OpenAI Provider Substrate | passthrough + tool classifier + OPENAI_BETA_POLICY + 9 capabilities `supported` (com 2 sub-DELETE de vector_stores) + tools `web_search` e `file_search` | F |
| **G** | Governed Run pipeline | DLP pre-scan, computeEffectiveRiskClass, computeEnforcement, audit emit, 6 capabilities `policy_governed` (Anthropic messages.create/stream + OpenAI responses.create/stream + chat.completions.create/stream) | F, A, C |
| **D** *(stretch)* | Batches API | `anthropic.message_batches` + `openai.batches` se Batch D for promovido em PR2 | F, A, C |
| **M** | Matrix consistency + pre-merge gates | 9 gates de Matrix §28 como tests integration; script de validação automática de capability counts; resolução de `verification_required` | F, A, C, G |
| **(L)** | Live tests opt-in | suite live por capability `supported`; popula `last_live_test_at` | A, C, G |

Cada batch tem critério de saída explícito. Próximo batch só começa após critério de saída do anterior atendido.

---

(continua nos batches detalhados §§6-12)


## 6. Batch F — Foundation

### 6.1 Objetivo

Estabelecer fundações compartilhadas entre providers: tipos canônicos, schemas de audit, migration de `org_beta_overrides`, `BetaTokenPolicy` enum, validators provider-agnostic.

### 6.2 Arquivos a criar / modificar

```
packages/core-types/src/
  capability.ts                          # CapabilityStatus, CapabilityLevel, RiskClass, Tier, EnforcementMode, EnforcementResolution, Capability, EndpointCoverage, BetaDependency
  beta-token-policy.ts                   # BetaTokenPolicy enum (6 valores), BetaTokenPolicyEntry interface
  
packages/core-events/src/
  passthrough-invoked.ts                 # PassthroughInvokedSchema schema_version 3 (ver §13)
  passthrough-beta-denied.ts             # PassthroughBetaDeniedSchema schema_version 1
  tool-validation-blocked.ts             # ToolValidationBlockedSchema schema_version 1
  org-beta-override-set.ts               # OrgBetaOverrideSetSchema schema_version 1
  org-beta-override-revoked.ts           # OrgBetaOverrideRevokedSchema schema_version 1
  index.ts                               # exporta tudo
  
packages/core-governance/src/
  beta-resolver.ts                       # algoritmo de resolução por policy (Matrix §4.1)
  effective-risk-class.ts                # computeEffectiveRiskClass(base, escalations) — usa max
  enforcement.ts                         # computeEnforcement(tier, effective_risk_class, operational_mode, tool_classification?)
  
db/migrations/
  0007_org_beta_overrides.sql            # tabela conforme Matrix §5.1
  
packages/core-governance/src/admin/
  create-org-beta-override.ts            # constraint impede hard_denied (Matrix §4.3)
  revoke-org-beta-override.ts            # via UPDATE de revoked_at
```

### 6.3 Especificações detalhadas

#### 6.3.1 `core-types/src/capability.ts`

```typescript
export type CapabilityStatus = 'not_exposed' | 'planned' | 'supported' | 'blocked';
// Note: 'family_alias' NÃO é introduzido em PR2 (Matrix §7.3).

export type CapabilityLevel = 'passthrough_audited' | 'policy_governed' | 'evidence_grade';
export type RiskClass = 'A' | 'B' | 'C' | 'D' | 'E';
export type Tier = 'starter' | 'business' | 'enterprise' | 'regulated';
export type OperationalMode = 'production' | 'pilot' | 'dev' | 'test';

export type EnforcementMode =
  | 'observe' | 'warn' | 'ask' | 'enforce' | 'sandbox_required' | 'blocked';

export interface EnforcementResolution {
  mode: EnforcementMode;
  side_effects?: SideEffect[];
  preconditions?: Precondition[];
}

export type SideEffect =
  | { audit_detail_level: 'high' }
  | { dlp_pre_scan_required: boolean };

export type Precondition =
  | { tenant_capability_acceptance_required: true; max_effective_risk_class_allowed_for_acceptance: RiskClass }
  | { approval_workflow_required: boolean }
  | { sandbox_environment_required: boolean };

export interface EndpointCoverage {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  streams: boolean;
  multipart: boolean;
  notes?: string;
}

export interface BetaDependency {
  header_token: string;
  required: 'always' | 'feature_flag';
  allowlist_treatment:
    | 'global_allowlist' | 'org_override_allowed' | 'hard_denied'
    | 'verification_required' | 'denied_until_decision' | 'removed_as_no_longer_needed';
  source_doc?: string;
}

export interface Capability {
  id: string;
  provider: 'anthropic' | 'openai';
  status: CapabilityStatus;
  level: CapabilityLevel;
  base_risk_class: RiskClass;
  tier_availability: Tier[];
  enforcement_default: EnforcementMode | EnforcementResolution;
  endpoint_coverage: EndpointCoverage[];
  beta_dependencies: BetaDependency[];
  facets?: Array<{ name: string; status: string; via?: string }>;
  planned_phase?: string;
  blocked_reason?: string;
  last_live_test_at?: string;
}
```

#### 6.3.2 `core-types/src/beta-token-policy.ts`

```typescript
export type BetaTokenPolicy =
  | 'global_allowlist'
  | 'org_override_allowed'
  | 'hard_denied'
  | 'verification_required'
  | 'denied_until_decision'
  | 'removed_as_no_longer_needed';

export interface BetaTokenPolicyEntry {
  beta_token: string;
  policy: BetaTokenPolicy;
  adr?: string;          // obrigatório se 'global_allowlist'
  reason: string;
  source_doc?: string;
  pinned_at: string;
  legacy?: boolean;
}
```

#### 6.3.3 Migration `db/migrations/0007_org_beta_overrides.sql`

Schema canônico em Matrix §5.1. Campos obrigatórios:

- `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`;
- `provider text NOT NULL CHECK (provider IN ('anthropic', 'openai'))`;
- `CHECK (expires_at > set_at)`;
- índice único parcial `WHERE revoked_at IS NULL` cobrindo `(org_id, provider, beta_token)`;
- RLS habilitada + FORCE;
- 3 policies: SELECT (govai_runtime), INSERT (govai_admin), UPDATE-revoke (govai_admin com `WITH CHECK (revoked_at IS NOT NULL)`);
- sem DELETE (revogação via `UPDATE revoked_at`).

#### 6.3.4 `core-governance/src/beta-resolver.ts`

```typescript
import type { BetaTokenPolicy, BetaTokenPolicyEntry } from '@govai/core-types';

export interface ResolutionResult {
  decision: 'allow' | 'deny';
  source: 'global_allowlist' | 'org_override' | 'legacy_no_longer_needed' | 'denied' | 'unknown_token';
  override_id?: string;
  policy_at_resolution: BetaTokenPolicy | 'unknown';
  audit_marker?: 'verification_pending' | 'decision_pending';
}

export async function resolveBeta(args: {
  provider: 'anthropic' | 'openai';
  org_id: string;
  beta_token: string;
  policy_table: ReadonlyArray<BetaTokenPolicyEntry>;
  active_overrides_loader: (org_id: string, provider: string) => Promise<Array<{ beta_token: string; id: string }>>;
}): Promise<ResolutionResult> {
  const entry = args.policy_table.find(e => e.beta_token === args.beta_token);
  
  if (!entry) {
    return { decision: 'deny', source: 'unknown_token', policy_at_resolution: 'unknown' };
  }
  
  switch (entry.policy) {
    case 'global_allowlist':
      return { decision: 'allow', source: 'global_allowlist', policy_at_resolution: 'global_allowlist' };
    
    case 'org_override_allowed': {
      const overrides = await args.active_overrides_loader(args.org_id, args.provider);
      const ov = overrides.find(o => o.beta_token === args.beta_token);
      if (ov) {
        return { decision: 'allow', source: 'org_override', override_id: ov.id, policy_at_resolution: 'org_override_allowed' };
      }
      return { decision: 'deny', source: 'denied', policy_at_resolution: 'org_override_allowed' };
    }
    
    case 'hard_denied':
      return { decision: 'deny', source: 'denied', policy_at_resolution: 'hard_denied' };
    
    case 'verification_required': {
      // comporta-se como org_override_allowed até resolução; audit marca verification_pending
      const overrides = await args.active_overrides_loader(args.org_id, args.provider);
      const ov = overrides.find(o => o.beta_token === args.beta_token);
      if (ov) {
        return {
          decision: 'allow', source: 'org_override', override_id: ov.id,
          policy_at_resolution: 'verification_required', audit_marker: 'verification_pending',
        };
      }
      return {
        decision: 'deny', source: 'denied',
        policy_at_resolution: 'verification_required', audit_marker: 'verification_pending',
      };
    }
    
    case 'denied_until_decision':
      return {
        decision: 'deny', source: 'denied',
        policy_at_resolution: 'denied_until_decision', audit_marker: 'decision_pending',
      };
    
    case 'removed_as_no_longer_needed':
      return {
        decision: 'allow', source: 'legacy_no_longer_needed',
        policy_at_resolution: 'removed_as_no_longer_needed',
      };
  }
}
```

#### 6.3.5 `core-governance/src/effective-risk-class.ts`

```typescript
import type { RiskClass } from '@govai/core-types';

export interface EscalationApplied {
  reason: string;
  base_to_effective: { from: RiskClass; to: RiskClass };
}

const RISK_ORDER: Record<RiskClass, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };

export function computeEffectiveRiskClass(
  base: RiskClass,
  escalations: EscalationApplied[],
): RiskClass {
  let max = base;
  for (const esc of escalations) {
    if (esc.base_to_effective.from === base) {
      const candidate = esc.base_to_effective.to;
      if (RISK_ORDER[candidate] > RISK_ORDER[max]) max = candidate;
    }
  }
  return max;
}
```

#### 6.3.6 `core-governance/src/admin/create-org-beta-override.ts`

```typescript
export async function createOrgBetaOverride(input: {
  org_id: string;
  provider: 'anthropic' | 'openai';
  beta_token: string;
  reason: string;
  set_by_user_id: string;
  expires_at: Date;
  policy_table: ReadonlyArray<BetaTokenPolicyEntry>;
  db: PoolClient;
}): Promise<{ id: string }> {
  const entry = input.policy_table.find(e => e.beta_token === input.beta_token);
  
  if (!entry) {
    throw new ApiError(403, 'unknown_beta_token', { beta_token: input.beta_token });
  }
  
  if (entry.policy === 'hard_denied') {
    throw new ApiError(403, 'beta_token_hard_denied', {
      message: 'This beta token cannot be enabled by org override; requires PR + ADR.',
      beta_token: input.beta_token,
    });
  }
  
  // CHECK constraint impede expires_at retroativo no DB nível
  // proceed with INSERT; gera audit event org.beta_override_set
  // ...
}
```

### 6.4 Tests do Batch F (herméticos)

```
packages/core-types/__tests__/capability.test.ts
packages/core-types/__tests__/beta-token-policy.test.ts
packages/core-events/__tests__/passthrough-invoked-schema.test.ts          # schema v3 com 5 superRefine rules (ver §13)
packages/core-events/__tests__/tool-validation-blocked-schema.test.ts
packages/core-governance/__tests__/effective-risk-class.test.ts             # max, casos múltiplas escalações
packages/core-governance/__tests__/beta-resolver.test.ts                    # 6 paths do switch + unknown
packages/core-governance/__tests__/admin/create-override-hard-denied.test.ts
db/__tests__/migrations/org-beta-overrides.test.ts                          # constraints, índice único parcial, RLS
```

### 6.5 Critério de saída do Batch F

- [ ] todos os schemas Zod compilam e exportados de `core-events`;
- [ ] migration `0007_org_beta_overrides.sql` aplicada em CI hermético;
- [ ] tests do Batch F passam (Testcontainers Postgres);
- [ ] tentativa de criar `org_beta_overrides` para token `hard_denied` retorna 403 estruturado;
- [ ] PassthroughInvokedSchema schema_version 3 valida casos canônicos (5 refines) — ver §13.

---

## 7. Batch A — Anthropic Provider Substrate

### 7.1 Objetivo

Implementar passthrough Anthropic com tool classifier, ANTHROPIC_BETA_POLICY, 5 capabilities `supported` cobrindo 10 endpoints + 1 capability tool `web_search`. Preservar Claude Code (Cenário A) sem capar.

### 7.2 Arquivos a criar / modificar

```
packages/provider-anthropic/src/
  beta-policy.ts                         # ANTHROPIC_BETA_POLICY constant
  tool-classifier.ts                     # classifyAnthropicTool (regra type:null em §13.5)
  tool-taxonomy-version.ts               # KNOWN_ANTHROPIC_TAXONOMY_VERSION constant
  capabilities/
    messages-create.ts                   # capability metadata
    messages-stream.ts
    messages-meta.ts                     # count_tokens
    models.ts                            # GET only
    files.ts                             # 5 endpoints; beta header global allowlist
    web-search-tool.ts                   # tool capability via classifier
  passthrough/
    forward.ts                           # raw forward; calcula native_response_hash sempre que body_forward_mode==='raw'
    stream-forward.ts                    # SSE chunks byte-preserved + stream_final_hash incremental
    beta-header-handler.ts               # extrai anthropic-beta header, chama beta-resolver
    tool-classifier-hook.ts              # se body tem tools[], classifica e bloqueia provider-hosted blocked
    files-multipart-handler.ts           # POST /v1/files; injeta beta header files-api-2025-04-14
    audit-emit.ts                        # emite passthrough.invoked v3 com tools_taxonomy_version se há tools
  routes/
    register-passthrough.ts              # registra rotas /passthrough/anthropic/v1/*
  
docs/architecture/adr/
  ADR-014-allow-files-beta.md            # OBRIGATÓRIO; allow files-api-2025-04-14 em ANTHROPIC_BETA_POLICY como global_allowlist
  ADR-015-not-needed.md                  # REGISTRO de cancelamento (cache_control nativo confirmado em verificação)
                                          # OU ADR-015-allow-prompt-caching.md se verificação live confirmar header ainda exigido
```

### 7.3 ANTHROPIC_BETA_POLICY canônica (Matrix §13)

Implementação literal da §13 da Matrix. Inclui:

- `files-api-2025-04-14` → `global_allowlist` + `adr: 'ADR-014'` (obrigatório);
- `prompt-caching-2024-07-31` → `verification_required` (resolver em PR2 antes do merge — ver §11.3);
- `message-batches-2024-09-24` → `verification_required` (resolver — depende de Batch D);
- `output-300k-2026-03-24` → `denied_until_decision`;
- 3 versões de `computer-use-*` → `hard_denied`;
- `managed-agents-2026-04-01` → `denied_until_decision`;
- `skills-2025-10-02` → `denied_until_decision`.

### 7.4 Tool classifier Anthropic (regra canônica do PR2 — incluindo type:null)

```typescript
// packages/provider-anthropic/src/tool-classifier.ts

export type AnthropicToolClassification =
  | 'client_defined'
  | 'anthropic_defined_client_executed_text_editor'
  | 'anthropic_defined_client_executed_bash'
  | 'anthropic_provider_hosted_web_search'
  | 'anthropic_provider_hosted_code_execution'
  | 'anthropic_provider_hosted_computer_use'
  | 'anthropic_typed_unknown';

const KNOWN_TYPED_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  classification: AnthropicToolClassification;
}> = Object.freeze([
  { pattern: /^text_editor_\d{8}$/,    classification: 'anthropic_defined_client_executed_text_editor' },
  { pattern: /^bash_\d{8}$/,           classification: 'anthropic_defined_client_executed_bash' },
  { pattern: /^web_search_\d{8}$/,     classification: 'anthropic_provider_hosted_web_search' },
  { pattern: /^code_execution_\d{8}$/, classification: 'anthropic_provider_hosted_code_execution' },
  { pattern: /^computer_\d{8}$/,       classification: 'anthropic_provider_hosted_computer_use' },
]);

export function classifyAnthropicTool(
  tool: { type?: unknown; [k: string]: unknown },
): AnthropicToolClassification {
  // Regra canônica (decisão arquitetural fixada — distingue type ausente de type null/malformado):
  
  // 1. Campo 'type' completamente ausente (chave NÃO existe no objeto) → client_defined
  if (!('type' in tool)) {
    return 'client_defined';
  }
  
  // 2. type === undefined explícito (raro, mas equivalente a chave ausente) → client_defined
  if (typeof tool.type === 'undefined') {
    return 'client_defined';
  }
  
  // 3. type === null explícito → anthropic_typed_unknown (input malformado, não tool legítima)
  if (tool.type === null) {
    return 'anthropic_typed_unknown';
  }
  
  // 4. type não-string → anthropic_typed_unknown
  if (typeof tool.type !== 'string') {
    return 'anthropic_typed_unknown';
  }
  
  // 5. type string vazia ou só whitespace → anthropic_typed_unknown
  if (tool.type.trim().length === 0) {
    return 'anthropic_typed_unknown';
  }
  
  // 6. type string válida — tenta casar com classes conhecidas
  for (const { pattern, classification } of KNOWN_TYPED_PATTERNS) {
    if (pattern.test(tool.type)) {
      return classification;
    }
  }
  
  // 7. String válida mas desconhecida → anthropic_typed_unknown
  return 'anthropic_typed_unknown';
}

export const KNOWN_ANTHROPIC_TAXONOMY_VERSION =
  'anthropic.tools_taxonomy:schema_version=2:bumped_for_typed_unknown_class';
```

### 7.5 Tests do Batch A (herméticos)

```
packages/provider-anthropic/__tests__/
  tool-classifier.test.ts                # 16 casos canônicos (incluindo type:null distinto de undefined)
  beta-policy.test.ts                    # cada policy retorna comportamento esperado
  beta-resolver-anthropic.test.ts        # passthrough.beta_denied para tokens hard_denied
  capabilities/
    messages-create.test.ts              # request básico, com tools, com vision, sem stream
    messages-stream.test.ts              # SSE byte-preserved, abort propagation, tool_use blocks no stream
    messages-meta.test.ts                # count_tokens
    models.test.ts                       # GET list + retrieve
    files.test.ts                        # 5 endpoints; beta header injection; multipart upload; multipart hash
    web-search-tool.test.ts              # tool com type web_search_<date> classificado e auditado
  passthrough/
    raw-forward-anthropic.test.ts        # paths /v1/messages, /v1/files etc.; sem duplicação /v1/v1/
    body-forward-mode.test.ts            # passthrough_audited 2xx → raw; 4xx/5xx → raw com hash
    audit-emit-anthropic.test.ts         # PassthroughInvokedSchema v3 com capability_level e tools_taxonomy_version
```

### 7.6 Tool classifier — casos de teste obrigatórios

`tool-classifier.test.ts` deve cobrir EXATAMENTE estes casos:

```
test cases (Anthropic):
  1.  tool sem campo 'type' (chave ausente)         → client_defined
  2.  type: undefined (chave presente)              → client_defined
  3.  type: null                                     → anthropic_typed_unknown ⚠️ DISTINTO de undefined
  4.  type: ''                                       → anthropic_typed_unknown
  5.  type: '   '                                    → anthropic_typed_unknown
  6.  type: 123 (número)                            → anthropic_typed_unknown
  7.  type: { foo: 'bar' } (objeto)                 → anthropic_typed_unknown
  8.  type: 'text_editor_20241029'                  → anthropic_defined_client_executed_text_editor
  9.  type: 'bash_20241022'                         → anthropic_defined_client_executed_bash
  10. type: 'web_search_20260209'                   → anthropic_provider_hosted_web_search
  11. type: 'code_execution_20250522'               → anthropic_provider_hosted_code_execution
  12. type: 'computer_20241022'                     → anthropic_provider_hosted_computer_use
  13. type: 'computer_20251124' (futuro)            → anthropic_provider_hosted_computer_use (forward-compat)
  14. type: 'web_fetch_20260101'                    → anthropic_typed_unknown (NÃO client_defined)
  15. type: 'tool_search_20260101'                  → anthropic_typed_unknown
  16. type: 'text_editor' (sem data, regex falha)   → anthropic_typed_unknown
```

### 7.7 Critério de saída do Batch A

- [ ] todos os 28 endpoints passthrough Anthropic da Matrix §26.1 funcionais (não retornam 503/501);
- [ ] `ANTHROPIC_BETA_POLICY` declarada e implementada;
- [ ] tool classifier passa nos 16 casos da §7.6;
- [ ] capability `anthropic.web_search_tool` `supported` via classifier;
- [ ] computer_use_tool e code_execution_tool retornam 403 `tool_pending_capability_promotion` ou `tool_blocked_until_governance_primitive`;
- [ ] body raw forward calcula `native_response_hash` para qualquer status non-stream raw;
- [ ] SDK Anthropic com `baseURL: <govai>/passthrough/anthropic` funciona end-to-end;
- [ ] ADR-014 criado e merged;
- [ ] tests herméticos do Batch A passam.

---

## 8. Batch C — OpenAI Provider Substrate

### 8.1 Objetivo

Implementar passthrough OpenAI: 9 capabilities `supported` (responses.create/stream + chat.completions.create/stream + models GET + models.delete + embeddings + files + vector_stores + 2 sub-DELETE) + 2 tools `supported` (web_search, file_search).

### 8.2 Arquivos a criar / modificar

```
packages/provider-openai/src/
  beta-policy.ts                         # OPENAI_BETA_POLICY (assistants=v2, realtime=v1 hard_denied)
  tool-classifier.ts                     # classifyOpenAITool (P3 da Matrix patch v2.0.1)
  tool-taxonomy-version.ts               # KNOWN_OPENAI_TAXONOMY_VERSION
  capabilities/
    responses-create.ts
    responses-stream.ts
    chat-completions-create.ts
    chat-completions-stream.ts
    models.ts                            # GET only
    models-delete.ts                     # capability separada Risk C
    embeddings.ts                        # DLP pre-scan, payload_storage_pr2: hash_only_plus_metadata
    files.ts                             # 5 endpoints; purpose=assistants warning + sunset
    vector-stores.ts                     # operações não-destrutivas
    vector-stores-delete.ts              # sub-capability DELETE store; tier_availability inclui starter (P1 patch v2.0.1)
    vector-stores-files-delete.ts        # sub-capability DELETE file from store; tier_availability inclui starter (P1)
    web-search-tool.ts
    file-search-tool.ts
  passthrough/
    forward.ts
    stream-forward.ts                    # SSE Responses + Chat Completions chunks byte-preserved
    beta-header-handler.ts
    tool-classifier-hook.ts
    files-purpose-validator.ts           # purpose=assistants warning + sunset cutoff (Matrix §18.8.1)
    audit-emit.ts
  routes/
    register-passthrough.ts              # /passthrough/openai/v1/*
  
docs/architecture/adr/
  (nenhum ADR obrigatório em Batch C; OPENAI_BETA_POLICY é apenas hard_denied de tokens deprecados)
```

### 8.3 OPENAI_BETA_POLICY canônica (Matrix §22)

```typescript
export const OPENAI_BETA_POLICY: ReadonlyArray<BetaTokenPolicyEntry> = Object.freeze([
  {
    beta_token: 'assistants=v2',
    policy: 'hard_denied',
    reason: 'Assistants API foi deprecada (sunset 26-ago-2026). GovAI não exposes endpoints; header bloqueia tentativa.',
    source_doc: 'https://platform.openai.com/docs/deprecations',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'realtime=v1',
    policy: 'hard_denied',
    reason: 'Realtime Beta API foi deprecada (sunset 07-mai-2026). Realtime GA é capability separada (planned PR6).',
    source_doc: 'https://platform.openai.com/docs/deprecations',
    pinned_at: '2026-05-06T00:00:00Z',
  },
]);
```

Tokens OpenAI desconhecidos → 403 `unknown_beta_token` por default.

### 8.4 Tool classifier OpenAI

```typescript
// packages/provider-openai/src/tool-classifier.ts

export type OpenAIApiContext = 'chat_completions' | 'responses';

export type OpenAIToolClassification =
  | 'function_chat_completions' | 'function_responses'
  | 'openai_provider_hosted_web_search' | 'openai_provider_hosted_file_search'
  | 'openai_provider_hosted_tool_search' | 'openai_provider_hosted_code_interpreter'
  | 'openai_provider_hosted_computer_use' | 'openai_provider_hosted_hosted_shell'
  | 'openai_provider_hosted_apply_patch' | 'openai_provider_hosted_mcp'
  | 'openai_typed_unknown';

const KNOWN_OPENAI_TOOL_PATTERNS: ReadonlyArray<{
  api: OpenAIApiContext | 'any';
  pattern: RegExp;
  classification: OpenAIToolClassification;
}> = Object.freeze([
  { api: 'responses', pattern: /^web_search(_preview)?$/, classification: 'openai_provider_hosted_web_search' },
  { api: 'responses', pattern: /^file_search$/,           classification: 'openai_provider_hosted_file_search' },
  { api: 'responses', pattern: /^tool_search$/,           classification: 'openai_provider_hosted_tool_search' },
  { api: 'responses', pattern: /^code_interpreter$/,      classification: 'openai_provider_hosted_code_interpreter' },
  { api: 'responses', pattern: /^computer_use_preview$/,  classification: 'openai_provider_hosted_computer_use' },
  { api: 'responses', pattern: /^(hosted_shell|shell)$/,  classification: 'openai_provider_hosted_hosted_shell' },
  { api: 'responses', pattern: /^apply_patch$/,           classification: 'openai_provider_hosted_apply_patch' },
  { api: 'responses', pattern: /^mcp$/,                   classification: 'openai_provider_hosted_mcp' },
]);

export function classifyOpenAITool(
  api: OpenAIApiContext,
  tool: { type?: unknown; [k: string]: unknown },
): OpenAIToolClassification {
  // OpenAI: ausência OU malformação → openai_typed_unknown (não há client_defined em OpenAI)
  if (typeof tool.type === 'undefined'
      || tool.type === null
      || typeof tool.type !== 'string'
      || tool.type.trim().length === 0) {
    return 'openai_typed_unknown';
  }
  
  if (tool.type === 'function') {
    return api === 'responses' ? 'function_responses' : 'function_chat_completions';
  }
  
  if (api === 'chat_completions') {
    return 'openai_typed_unknown';   // Chat Completions só aceita function
  }
  
  for (const { pattern, classification } of KNOWN_OPENAI_TOOL_PATTERNS) {
    if (pattern.test(tool.type)) {
      return classification;
    }
  }
  
  return 'openai_typed_unknown';
}

export const KNOWN_OPENAI_TAXONOMY_VERSION =
  'openai.tools_taxonomy:schema_version=2:bumped_for_skills_resource_split';
```

### 8.5 Files purpose validator (Matrix §18.8.1)

```typescript
// packages/provider-openai/src/passthrough/files-purpose-validator.ts

const ASSISTANTS_SUNSET_DATE = new Date('2026-08-26T23:59:59Z');

export function validateFilesPurpose(
  purpose: string,
  now: Date = new Date(),
): { allowed: boolean; warning?: string; reason?: string } {
  if (purpose === 'assistants') {
    if (now > ASSISTANTS_SUNSET_DATE) {
      return {
        allowed: false,
        reason: 'OpenAI Assistants API was removed on 2026-08-26; purpose=assistants is no longer accepted by GovAI default policy.',
      };
    }
    return {
      allowed: true,
      warning: 'x-govai-deprecation-warning: assistants_sunset=2026-08-26; migrate_to=responses_api+conversations_api',
    };
  }
  return { allowed: true };
}
```

`purpose_deprecated: true` no audit event quando warning é emitido.

### 8.6 Tests do Batch C (herméticos)

```
packages/provider-openai/__tests__/
  tool-classifier.test.ts                # 20+ casos (incluindo function context distinction)
  beta-policy.test.ts                    # assistants=v2, realtime=v1 hard_denied; unknown tokens 403
  capabilities/
    responses-create.test.ts             # com tools, vision, structured outputs
    responses-stream.test.ts             # SSE typed items, abort, tool_call preservation
    chat-completions-create.test.ts      # function calling; sem provider-hosted (bloqueia)
    chat-completions-stream.test.ts
    models.test.ts                       # GET only
    models-delete.test.ts                # ask flow per tier; regulated com aceite + approval
    embeddings.test.ts                   # DLP pre-scan; hash_only_plus_metadata
    files.test.ts                        # 5 endpoints; purpose=assistants warning antes do sunset
    files-purpose-sunset.test.ts         # mocked date > sunset → 403
    vector-stores.test.ts                # create, list, retrieve, add files (não-destrutivo)
    vector-stores-delete.test.ts         # starter ask; regulated aceite+approval
    vector-stores-files-delete.test.ts   # starter ask; regulated aceite+approval
    web-search-tool.test.ts              # tool com type=web_search → escalated allowed
    file-search-tool.test.ts             # tool com type=file_search → escalated allowed
  passthrough/
    raw-forward-openai.test.ts           # paths /v1/responses, /v1/chat/completions etc.
    baseurl-paths.test.ts                # nunca duplica /v1/v1/
    audit-emit-openai.test.ts            # PassthroughInvokedSchema v3 com tools_taxonomy_version
    purpose-warning.test.ts              # x-govai-deprecation-warning header injetado
```

### 8.7 Tool classifier OpenAI — casos de teste obrigatórios

```
test cases (OpenAI):
  1.  Chat Completions tool sem 'type'         → openai_typed_unknown (Chat Completions exige type)
  2.  Chat Completions type: null               → openai_typed_unknown
  3.  Chat Completions type: 'function'         → function_chat_completions
  4.  Chat Completions type: 'web_search'       → openai_typed_unknown (não disponível em CC)
  5.  Responses tool sem 'type'                 → openai_typed_unknown
  6.  Responses type: null                      → openai_typed_unknown
  7.  Responses type: ''                        → openai_typed_unknown
  8.  Responses type: '   '                     → openai_typed_unknown
  9.  Responses type: 123                       → openai_typed_unknown
  10. Responses type: 'function'                → function_responses
  11. Responses type: 'web_search'              → openai_provider_hosted_web_search
  12. Responses type: 'web_search_preview'      → openai_provider_hosted_web_search
  13. Responses type: 'file_search'             → openai_provider_hosted_file_search
  14. Responses type: 'tool_search'             → openai_provider_hosted_tool_search (blocked)
  15. Responses type: 'code_interpreter'        → openai_provider_hosted_code_interpreter (blocked)
  16. Responses type: 'computer_use_preview'    → openai_provider_hosted_computer_use (blocked)
  17. Responses type: 'hosted_shell'            → openai_provider_hosted_hosted_shell (blocked)
  18. Responses type: 'shell' (alias)           → openai_provider_hosted_hosted_shell (blocked)
  19. Responses type: 'apply_patch'             → openai_provider_hosted_apply_patch (blocked)
  20. Responses type: 'mcp'                     → openai_provider_hosted_mcp (blocked)
  21. Responses type: 'database_query' (futuro) → openai_typed_unknown (blocked)
  22. Responses type: 'skills'                  → openai_typed_unknown (skills é resource, não tool)
```

### 8.8 Critério de saída do Batch C

- [ ] todos os 18 endpoints passthrough OpenAI da Matrix §26.1 funcionais;
- [ ] `OPENAI_BETA_POLICY` implementada com 2 entradas hard_denied;
- [ ] tool classifier passa nos 22 casos da §8.7;
- [ ] capabilities `web_search_tool` e `file_search_tool` `supported` via classifier;
- [ ] vector_stores destrutivas (`vector_stores.delete`, `vector_stores.files.delete`) com `tier_availability` incluindo starter, enforcement `ask`;
- [ ] purpose=assistants antes de 2026-08-26 forwardado com warning header;
- [ ] purpose=assistants após 2026-08-26 (data mockada em test) → 403;
- [ ] embeddings com payload_storage hash+metadata;
- [ ] body raw forward calcula `native_response_hash` para qualquer status;
- [ ] SDK OpenAI com `baseURL: <govai>/passthrough/openai/v1` funciona end-to-end;
- [ ] tests herméticos do Batch C passam.

---

(continua nos batches G, D, M, L)


## 9. Batch G — Governed Run pipeline

### 9.1 Objetivo

Implementar pipeline de Governed Run com `level: policy_governed` para as 6 capabilities core. Cada request passa por DLP pre-scan, tool classifier, computeEffectiveRiskClass, computeEnforcement, credential rewrite, SDK invoke (provider-native), audit append.

As 6 capabilities `policy_governed`:

1. `anthropic.messages.create`
2. `anthropic.messages.stream`
3. `openai.responses.create`
4. `openai.responses.stream`
5. `openai.chat.completions.create`
6. `openai.chat.completions.stream`

### 9.2 Arquivos a criar / modificar

```
packages/core-governance/src/
  governed-run/
    pipeline.ts                          # ordem canônica de etapas
    dlp-pre-scan.ts                      # DLP-BR detectors integration
    tool-classifier-step.ts              # invoca classifier do provider correto
    enforcement-step.ts                  # decide allow/ask/warn/enforce/block
    credential-rewrite.ts                # tenant key resolution
    audit-emit-step.ts                   # emite passthrough.invoked v3 com capability_level: 'policy_governed'

packages/provider-anthropic/src/
  governed-run/
    messages-create.ts                   # invoca SDK provider-native
    messages-stream.ts                   # streaming com hash incremental

packages/provider-openai/src/
  governed-run/
    responses-create.ts
    responses-stream.ts
    chat-completions-create.ts
    chat-completions-stream.ts

packages/runtime/src/routes/
    runs.ts                              # POST /v1/runs (substitui 503 do baseline)
    audit-events.ts                      # GET /v1/audit-events (substitui 503 do baseline)
```

### 9.3 Pipeline canônica

```
POST /v1/runs (governed):
  1. authentication + tenant resolve
  2. body validation (provider, capability_id, request_body)
  3. DLP pre-scan (input)
       → registra dlp_decisions[]
  4. tool classifier (se body tem tools[])
       → registra detected_tool_classifications[]
       → contribui escalações de risk
       → bloqueia at_validation se tool é blocked_at_validation
  5. effective_risk_class = computeEffectiveRiskClass(base, escalations)
  6. enforcement_decision = computeEnforcement(tier, effective_risk_class, mode, classifications)
       → resolve preconditions (tenant_capability_acceptance, approval_workflow)
       → resolve side_effects (audit_detail_level: high)
  7. se enforcement_decision = 'blocked' → 403 com reason; emit audit; STOP
  8. se 'ask' sem confirmação → 403 ask_required; STOP
  9. credential rewrite: tenant_key resolved from KMS
  10. SDK invoke (provider-native) com input do cliente preservado
  11. response (stream OR non-stream)
  12. compute hashes:
       - is_stream → stream_final_hash incremental
       - non-stream → native_response_hash sobre body (qualquer status)
  13. emit passthrough.invoked v3 com capability_level: 'policy_governed'
  14. response ao cliente
```

### 9.4 Tests do Batch G (herméticos)

```
packages/core-governance/__tests__/governed-run/
  pipeline-anthropic-messages.test.ts        # request 2xx, 4xx provider, 5xx provider
  pipeline-openai-responses.test.ts
  enforcement-blocked-by-tier.test.ts        # regulated bash → blocked com reason
  ask-flow.test.ts                           # ask sem confirm → 403; com confirm → forward
  dlp-pii-escalation.test.ts                 # cpf no input → effective C → enforce
  tool-classification-escalation.test.ts     # tools=[bash] → effective D → enforcement por tier
  audit-emit-policy-governed.test.ts         # capability_level: 'policy_governed' emitido
  hash-rules.test.ts                         # 4xx/5xx provider response também tem native_response_hash
```

### 9.5 Critério de saída do Batch G

- [ ] `/v1/runs` aceita POST e processa as 6 capabilities core;
- [ ] `/v1/audit-events` retorna eventos para tenant autorizado;
- [ ] DLP pre-scan integrado e auditado;
- [ ] tool classifier integrado, com bloqueio at_validation para provider-hosted blocked;
- [ ] enforcement por tier funcional incluindo regulated com aceite/approval;
- [ ] hashes calculados corretamente (stream → stream_final_hash; non-stream → native_response_hash em qualquer status);
- [ ] tests herméticos do Batch G passam;
- [ ] nenhuma rota de Governed Run retorna 503/501.

---

## 10. Batch D — Batches API (stretch)

### 10.1 Decisão pré-execução

Antes de iniciar Batch D, Claude Code DEVE verificar:

1. Tempo/orçamento de PR2 disponível;
2. Status atual dos beta tokens `message-batches-2024-09-24` (Anthropic) e Batches OpenAI (verificar com chamada real ou doc fresca).

Se o orçamento permitir e os tokens estiverem resolvidos:

- promover `anthropic.message_batches` e `openai.batches` a `supported`;
- atualizar `ANTHROPIC_BETA_POLICY` (entry de message-batches passa para `global_allowlist` com ADR-016);
- gerar **ADR-016** documentando a decisão.

Se não:

- manter ambas como `planned planned_phase: PR4`;
- entry em `ANTHROPIC_BETA_POLICY` resolve para `denied_until_decision` ou `removed_as_no_longer_needed` conforme verificação;
- ADR-016 NÃO é gerado;
- registro em `docs/architecture/escalations/PR2-ESC-batch-d-deferred.md` documenta motivo.

### 10.2 Arquivos (se Batch D promovido)

```
packages/provider-anthropic/src/capabilities/message-batches.ts
packages/provider-openai/src/capabilities/batches.ts
docs/architecture/adr/ADR-016-allow-message-batches-beta.md (condicional)
tests/integration/anthropic/batches/*.test.ts
tests/integration/openai/batches/*.test.ts
```

### 10.3 Critério de saída do Batch D

**Se promovido:**

- [ ] 6 endpoints de `anthropic.message_batches` funcionais;
- [ ] 4 endpoints de `openai.batches` funcionais;
- [ ] ADR-016 criado;
- [ ] tests passam.

**Se diferido:**

- [ ] entry de policy resolvida para `denied_until_decision` ou `removed_as_no_longer_needed`;
- [ ] capability `planned_phase: PR4`;
- [ ] documento de escalação registrado.

---

## 11. Batch M — Matrix consistency + pre-merge gates

### 11.1 Objetivo

Implementar como tests integration os 9 pre-merge gates de Matrix §28; gerar script de validação automática de capability counts; resolver `verification_required` ainda pendente.

### 11.2 Arquivos a criar

```
tests/integration/schema/
  capability-schema-v4.2.test.ts                     # gate §28.1
tests/integration/governance/
  beta-policy-no-verification-pending.test.ts        # gate §28.2
  registry-matrix-consistency.test.ts                # gate §28.4
  unknown-endpoint.test.ts                           # gate §28.5
  no-temporary-routes.test.ts                        # gate §28.9
tests/integration/anthropic/
  tool-classifier.test.ts                            # gate §28.3 (Anthropic)
  sdk-baseurl.test.ts                                # gate §28.6 (Anthropic)
tests/integration/openai/
  tool-classifier.test.ts                            # gate §28.3 (OpenAI)
  sdk-baseurl.test.ts                                # gate §28.6 (OpenAI)
tests/integration/audit/
  passthrough-invoked-schema.test.ts                 # gate §28.7
tests/live/                                           # gate §28.8 (opt-in, GOVAI_LIVE_TESTS=1)
  anthropic/*.test.ts
  openai/*.test.ts

scripts/
  validate-matrix-counts.ts                          # script de count automático
```

### 11.3 Resolução de `verification_required` (pré-merge obrigatório)

Para cada entry com `policy: 'verification_required'` em `ANTHROPIC_BETA_POLICY`:

#### 11.3.1 `prompt-caching-2024-07-31`

Verificação técnica:

```bash
# Test live com chave Anthropic real:
# 1. Request a /v1/messages com cache_control nativo no body, sem header anthropic-beta
# 2. Se 2xx → header não exigido pela API
# 3. Se 4xx com mensagem sobre header beta → header ainda exigido
```

Resoluções possíveis:

- **se header NÃO mais exigido:** `policy: 'removed_as_no_longer_needed'`. Não gerar ADR-015. Documentar em comentário da entry.
- **se header AINDA exigido:** `policy: 'global_allowlist'` + `adr: 'ADR-015'`. Gerar `docs/architecture/adr/ADR-015-allow-prompt-caching.md`.

Se Claude Code não consegue verificar (sem chave live disponível em CI), acionar Human Architect Escalation com diagnóstico.

#### 11.3.2 `message-batches-2024-09-24`

Resolução depende de promoção do Batch D:

- **se Batch D promovido:** policy passa para `global_allowlist` + `adr: 'ADR-016'`;
- **se Batch D diferido:** policy passa para `denied_until_decision` ou `removed_as_no_longer_needed` conforme verificação técnica;
- **se inconclusivo:** acionar Human Architect Escalation.

### 11.4 Script de capability counts

```typescript
// scripts/validate-matrix-counts.ts
import { CAPABILITY_REGISTRY } from '@govai/registry';

const counts = {
  supported_with_endpoint: 0,
  supported_tool: 0,
  planned: 0,
  blocked: 0,
  not_exposed: 0,
  total_endpoints: 0,
};

for (const cap of CAPABILITY_REGISTRY) {
  if (cap.status === 'supported') {
    if (cap.endpoint_coverage.length > 0) {
      counts.supported_with_endpoint++;
      counts.total_endpoints += cap.endpoint_coverage.length;
    } else {
      counts.supported_tool++;
    }
  } else if (cap.status === 'planned') {
    counts.planned++;
  } else if (cap.status === 'blocked') {
    counts.blocked++;
  } else if (cap.status === 'not_exposed') {
    counts.not_exposed++;
  }
}

const expected = {
  supported_with_endpoint: 16,
  supported_tool: 3,
  planned: 22,
  blocked: 2,
  not_exposed: 5,
  total_endpoints: 28,
};

for (const [k, v] of Object.entries(expected)) {
  if (counts[k] !== v) {
    console.error(`MISMATCH: ${k} expected ${v}, got ${counts[k]}`);
    process.exit(1);
  }
}
console.log('Matrix counts validated:', counts);
```

Este script é executado em CI como parte do gate §28.4 (Provider Coverage Matrix consistency). Counts esperados são derivados da Matrix §27 — não hardcoded em prosa.

Se Batch D for promovido, counts esperados ajustam:

```diff
- supported_with_endpoint: 16
+ supported_with_endpoint: 18  // +2 (anthropic.message_batches + openai.batches)
- planned: 22
+ planned: 20
- total_endpoints: 28
+ total_endpoints: 38  // +10 endpoints
```

A constante de counts esperados deve ser **derivada do conjunto de capabilities** com `status: 'supported'`, não hardcoded como número.

### 11.5 Critério de saída do Batch M

- [ ] todos os 9 gates de Matrix §28 implementados como tests integration e passando;
- [ ] script de validação de counts executa em CI;
- [ ] `ANTHROPIC_BETA_POLICY.every(e => e.policy !== 'verification_required')` retorna true;
- [ ] `OPENAI_BETA_POLICY.every(e => e.policy !== 'verification_required')` retorna true;
- [ ] capability_decomposition_map NÃO existe no schema;
- [ ] `family_alias` NÃO existe no enum CapabilityStatus;
- [ ] nenhuma capability `supported` da Matrix tem `last_live_test_at` null (após Batch L).

---

## 12. Batch L — Live tests opt-in

### 12.1 Objetivo

Cada capability `supported` em PR2 precisa `last_live_test_at` populado por execução real de live test. Suite total estimada Matrix §16 + §25: <~8min, <~$4.20.

### 12.2 Variáveis de ambiente

- `GOVAI_LIVE_TESTS=1` → ativa suite live;
- `ANTHROPIC_LIVE_TEST_KEY` → chave Anthropic dedicada para testes;
- `OPENAI_LIVE_TEST_KEY` → chave OpenAI dedicada para testes.

Em CI público estas variáveis NÃO existem; suite é skipped. Em CI privado com secrets configurados, suite roda.

### 12.3 Tests live

Estrutura conforme Matrix §16 e §25. Cada test:

1. faz chamada real ao provider via passthrough GovAI;
2. valida byte-preservation (request body forwarded raw, response stream/body byte-preserved);
3. captura timestamp ISO e popula `last_live_test_at` da capability no registry.

### 12.4 Critério de saída do Batch L

- [ ] todas as 19 capabilities `supported` (16 com endpoint + 3 tools) têm `last_live_test_at` populado;
- [ ] suite total executa em <~8min, <~$4.20.

---

## 13. PassthroughInvokedSchema v3 — especificação detalhada

Schema obrigatório em `packages/core-events/src/passthrough-invoked.ts`. **Aplica regra P2 do patch v2.0.1** (hash para qualquer non-stream raw).

### 13.1 Schema completo

```typescript
import { z } from 'zod';

const TenantContextSchema = z.object({
  org_id: z.string().uuid(),
  tenant_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  tier: z.enum(['starter', 'business', 'enterprise', 'regulated']),
  operational_mode: z.enum(['production', 'pilot', 'dev', 'test']),
});

const UsageJsonSchema = z.object({
  input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
  cache_read_tokens: z.number().int().nonnegative().optional(),
  cache_creation_tokens: z.number().int().nonnegative().optional(),
}).passthrough();

export const PassthroughInvokedSchema = z.object({
  event_type: z.literal('passthrough.invoked'),
  schema_version: z.literal(3),
  
  tenant_context: TenantContextSchema,
  
  provider: z.enum(['anthropic', 'openai']),
  capability_id: z.string().min(1),
  capability_level: z.enum(['passthrough_audited', 'policy_governed', 'evidence_grade']),
  
  native_endpoint: z.string().min(1),
  native_method: z.enum(['GET','POST','PUT','DELETE','PATCH']),
  is_stream: z.boolean(),
  is_multipart: z.boolean(),
  
  base_risk_class: z.enum(['A','B','C','D','E']),
  effective_risk_class: z.enum(['A','B','C','D','E']),
  risk_escalation_reasons: z.array(z.string()).default([]),
  enforcement_decision: z.enum(['observe','warn','ask','enforce','sandbox_required','blocked']),
  
  native_request_hash: z.string().regex(/^[0-9a-f]{64}$/),
  native_response_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  stream_final_hash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  
  latency_ms: z.number().int().nonnegative(),
  status_code: z.number().int(),
  usage_json: UsageJsonSchema.optional(),
  credential_source: z.string().min(1),
  
  allowlist_version: z.string().min(1),
  provider_request_id: z.string().optional(),
  body_forward_mode: z.enum(['raw', 'redacted', 'blocked']),
  
  dlp_decisions: z.array(z.object({
    phase: z.enum([
      'pre_request', 'post_response', 'file_upload',
      'pre_response_content', 'file_addition_to_vector_store',
    ]),
    findings_count: z.number().int().nonnegative(),
    finding_classes: z.array(z.string()).default([]),
    action: z.enum(['none', 'warn', 'redact', 'block', 'ask']),
  })).default([]),
  
  beta_allowlist_sources: z.array(z.object({
    beta_token: z.string().min(1),
    source: z.enum(['global_allowlist', 'org_override', 'legacy_no_longer_needed']),
    override_id: z.string().uuid().optional(),
    policy_at_resolution: z.enum([
      'global_allowlist','org_override_allowed','hard_denied',
      'verification_required','denied_until_decision','removed_as_no_longer_needed',
    ]),
  })).default([]),
  
  detected_tool_classifications: z.array(z.object({
    tool_index: z.number().int().nonnegative(),
    tool_type: z.string().optional(),
    classification: z.enum([
      // Anthropic
      'client_defined',
      'anthropic_defined_client_executed_text_editor',
      'anthropic_defined_client_executed_bash',
      'anthropic_provider_hosted_web_search',
      'anthropic_provider_hosted_code_execution',
      'anthropic_provider_hosted_computer_use',
      'anthropic_typed_unknown',
      // OpenAI
      'function_chat_completions',
      'function_responses',
      'openai_provider_hosted_web_search',
      'openai_provider_hosted_file_search',
      'openai_provider_hosted_tool_search',
      'openai_provider_hosted_code_interpreter',
      'openai_provider_hosted_computer_use',
      'openai_provider_hosted_hosted_shell',
      'openai_provider_hosted_apply_patch',
      'openai_provider_hosted_mcp',
      'openai_typed_unknown',
    ]),
    contributed_risk_class: z.enum(['A','B','C','D','E']),
    decision: z.enum(['allowed', 'escalated', 'blocked_at_validation']),
  })).default([]),
  
  tools_taxonomy_version: z.string().optional(),
  
  // OpenAI Files specific
  purpose_deprecated: z.boolean().optional(),
  
  audit_event_id: z.string().uuid(),
  chain_id: z.literal('run'),
}).superRefine((data, ctx) => {
  // Regra 1 (P2 patch v2.0.1): stream → stream_final_hash; non-stream raw → native_response_hash em QUALQUER status
  if (data.is_stream && !data.stream_final_hash) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'is_stream=true requires stream_final_hash',
      path: ['stream_final_hash'],
    });
  }
  if (!data.is_stream
      && data.body_forward_mode === 'raw'
      && !data.native_response_hash) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'non-stream raw provider response requires native_response_hash for any provider status (2xx, 4xx, 5xx)',
      path: ['native_response_hash'],
    });
  }
  
  // Regra 2: blocked → body_forward_mode = blocked
  if (data.enforcement_decision === 'blocked' && data.body_forward_mode !== 'blocked') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'enforcement=blocked requires body_forward_mode=blocked',
      path: ['body_forward_mode'],
    });
  }
  
  // Regra 3: passthrough_audited NÃO permite redacted
  if (data.capability_level === 'passthrough_audited'
      && data.body_forward_mode === 'redacted') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'passthrough_audited capability_level does not allow redacted body_forward_mode',
      path: ['body_forward_mode'],
    });
  }
  
  // Regra 4: passthrough_audited com forward (não-blocked) → raw
  if (data.capability_level === 'passthrough_audited'
      && data.enforcement_decision !== 'blocked'
      && data.body_forward_mode !== 'raw') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'passthrough_audited forward requires body_forward_mode=raw',
      path: ['body_forward_mode'],
    });
  }
  
  // Regra 5: tools_taxonomy_version obrigatório se há tools classificadas
  if (data.detected_tool_classifications.length > 0
      && (!data.tools_taxonomy_version || data.tools_taxonomy_version.length === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'detected_tool_classifications.length > 0 requires tools_taxonomy_version to be populated',
      path: ['tools_taxonomy_version'],
    });
  }
});

export type PassthroughInvoked = z.infer<typeof PassthroughInvokedSchema>;
```

### 13.2 Tests do schema

```
packages/core-events/__tests__/passthrough-invoked-schema.test.ts:
  - schema_version 3 aceito; v1 e v2 também aceitos como histórico
  - is_stream=true sem stream_final_hash → recusa
  - non-stream raw 2xx sem native_response_hash → recusa
  - non-stream raw 4xx sem native_response_hash → recusa  ⚠️ CRÍTICO P2
  - non-stream raw 5xx sem native_response_hash → recusa  ⚠️ CRÍTICO P2
  - non-stream blocked sem native_response_hash → ACEITA (não há response)
  - blocked com body_forward_mode != 'blocked' → recusa
  - passthrough_audited com body_forward_mode='redacted' → recusa
  - passthrough_audited 2xx com body_forward_mode='raw' → aceita
  - policy_governed 2xx com body_forward_mode='redacted' → aceita
  - detected_tool_classifications com 1+ items mas tools_taxonomy_version ausente → recusa
  - sem tools, sem tools_taxonomy_version → aceita
```

---

## 14. ADRs a criar em PR2

### 14.1 ADR-014 — Allow `files-api-2025-04-14` em ANTHROPIC_BETA_POLICY como `global_allowlist`

**Status:** OBRIGATÓRIO. Sem este ADR, `anthropic.files` não funciona em PR2.

```
docs/architecture/adr/ADR-014-allow-files-beta.md

# ADR-014: Allow files-api-2025-04-14 in ANTHROPIC_BETA_POLICY as global_allowlist

## Status
Accepted (2026-05-06)

## Context
Anthropic Files API requires `anthropic-beta: files-api-2025-04-14` header.
GovAI commits to Files capability in PR2 Macro Native Substrate Contract (Addendum §6.2).
Without global allowlist, every org would need org_beta_overrides to use Files —
disproportionate friction for an obligatory capability.

## Decision
Add `files-api-2025-04-14` to ANTHROPIC_BETA_POLICY with `policy: 'global_allowlist'`.
Header is automatically forwarded for all orgs with appropriate tier.

## Consequences
- Files capability works out-of-box for all PR2 tenants;
- No fricción for starter/business clients;
- Audit event `passthrough.invoked` registers `beta_allowlist_sources[]` with `source: 'global_allowlist'`;
- If Anthropic deprecates the header in the future, this ADR is superseded by another ADR.

## References
- Addendum v4.2.2 §6.2
- Provider Coverage Matrix v2 Consolidated §13
- https://docs.claude.com/en/docs/build-with-claude/files
```

### 14.2 ADR-015 — Cancelado por default

```
docs/architecture/adr/ADR-015-not-needed.md

# ADR-015: Prompt caching beta header NOT NEEDED in PR2

## Status
Cancelled by verification (2026-05-06)

## Context
ADR-015 was reserved for the case that prompt-caching-2024-07-31 header
was still required by Anthropic API. Verification in Peça A v2 confirmed that
prompt caching has migrated to native parameter `cache_control` in body;
header is no longer required.

## Decision
Do NOT generate an ADR adding prompt-caching to global allowlist.
Instead, ANTHROPIC_BETA_POLICY entry for prompt-caching-2024-07-31 is
`policy: 'removed_as_no_longer_needed'` — header is forwarded naturally if
client sends it, but no global allowlist or org override is needed.

## Consequences
- Clients using cache_control in body work without needing any beta header;
- Legacy clients sending the old header continue to work (forwarded as-is);
- No ADR-015 dedicated allowance is generated.

## References
- Anthropic prompt caching documentation
- ANTHROPIC_BETA_POLICY entry for prompt-caching-2024-07-31
```

**Importante:** Se a verificação técnica em Batch M (§11.3.1) determinar que o header AINDA é exigido, gerar `ADR-015-allow-prompt-caching.md` em vez de `ADR-015-not-needed.md`.

### 14.3 ADR-016 — Condicional (apenas se Batch D promovido)

```
docs/architecture/adr/ADR-016-allow-message-batches-beta.md  (CONDICIONAL)

# ADR-016: Allow message-batches-2024-09-24 in ANTHROPIC_BETA_POLICY as global_allowlist

## Status
Accepted (only if Batch D is promoted to supported in PR2)

## Context
Anthropic Message Batches API may require `anthropic-beta: message-batches-2024-09-24` header.
If Batch D is promoted to supported in PR2, the header must be in global allowlist for
all tenants with batches access.

## Decision
If verification confirms header still required: add to global_allowlist.
If header no longer required: change ANTHROPIC_BETA_POLICY entry to `removed_as_no_longer_needed`
(no ADR needed).

## Consequences
- (depends on verification)
```

---

## 15. Checklist consolidada de saída (acceptance criteria PR2)

Antes de abrir PR de merge, todos os itens abaixo devem estar verdadeiros:

### 15.1 Architecture & schema

- [ ] `CapabilityStatus` enum exatamente com 4 valores: `'not_exposed' | 'planned' | 'supported' | 'blocked'`;
- [ ] `'family_alias'` NÃO existe no enum;
- [ ] `BetaTokenPolicy` enum com 6 valores;
- [ ] `EnforcementMode` enum com 6 valores canônicos;
- [ ] migrations apenas: `0007_org_beta_overrides.sql` (nada além);
- [ ] `govai.capability_decomposition_map` NÃO existe;
- [ ] `org_beta_overrides` com `id uuid PK`, índice único parcial sobre `revoked_at IS NULL`, RLS habilitada, `provider IN ('anthropic', 'openai')`.

### 15.2 Provider implementations

- [ ] Anthropic: 5 capabilities `supported` com endpoint próprio + 1 tool capability `supported`;
- [ ] OpenAI: 11 capabilities `supported` com endpoint próprio + 2 tool capabilities `supported`;
- [ ] todos os 28 endpoints obrigatórios funcionais (sem 503/501);
- [ ] tool classifiers Anthropic e OpenAI implementados conforme §7.4 e §8.4 — incluindo distinção `type: null` (Anthropic) → `anthropic_typed_unknown`;
- [ ] `ANTHROPIC_BETA_POLICY` com 9 entradas; `OPENAI_BETA_POLICY` com 2 entradas; nenhum `verification_required`;
- [ ] `org_beta_overrides` impede creation para token `hard_denied` via constraint;
- [ ] passthrough preserva tools[], tool_use blocks, streaming, vision, structured outputs.

### 15.3 Audit & schemas

- [ ] `PassthroughInvokedSchema` schema_version 3 com 5 regras `superRefine` ativas;
- [ ] regra P2: `native_response_hash` exigido para qualquer non-stream raw;
- [ ] `ToolValidationBlockedSchema` schema_version 1 com `tools_taxonomy_version` obrigatório;
- [ ] `OrgBetaOverrideSetSchema` e `OrgBetaOverrideRevokedSchema` implementados.

### 15.4 ADRs

- [ ] ADR-014 criado e merged;
- [ ] ADR-015-not-needed.md OU ADR-015-allow-prompt-caching.md (uma das duas conforme verificação);
- [ ] ADR-016 criado se Batch D promovido; senão, decisão registrada em escalation doc.

### 15.5 Tests

- [ ] tests herméticos de Batches F, A, C, G passam;
- [ ] tests Batch M (9 gates de Matrix §28) passam;
- [ ] script `validate-matrix-counts.ts` passa;
- [ ] tests live de Batch L populam `last_live_test_at` para todas as 19 capabilities supported;
- [ ] zero regressão dos 109 tests do baseline PR1.

### 15.6 Forbidden / antipatterns (devem ser zero ocorrências)

- [ ] zero rotas retornando 503 `pipeline_incomplete_*`;
- [ ] zero rotas retornando 501;
- [ ] zero wrappers JSON envolvendo native response;
- [ ] zero `GenericLLMRequest` ou normalização lossy;
- [ ] zero duplicação `/v1/v1/...`;
- [ ] zero placeholder/stub;
- [ ] zero capability essential marcada `planned` retroativamente para escapar de implementação;
- [ ] zero `family_alias` ou `capability_decomposition_map`.

---

## 16. Output esperado

### 16.1 Branch e commits

- branch: `feat/pr2-native-provider-substrate`;
- commits estruturados por batch (F, A, C, G, [D], M, L);
- mensagens de commit no formato Conventional Commits.

### 16.2 PR description

A PR de merge deve incluir:

- referência aos hashes do pacote canônico (ADP, Addendum, Matrix, patch);
- lista de batches executados;
- counts de capabilities (calculados pelo script `validate-matrix-counts.ts`);
- lista de gates passados;
- ADRs criados;
- escalations registradas;
- live tests results (timestamp + custo total);
- baseline tests count (deve ser 109 + N novos, com 0 regressão).

### 16.3 Documentos atualizados

- `docs/architecture/adr/` — ADR-014 obrigatório; ADR-015 (não-needed ou allow); ADR-016 (condicional);
- `docs/architecture/escalations/PR2-ESC-NNN.md` — para cada escalation acionada;
- `CHANGELOG.md` — entry para PR2.

---

## 17. Things to NEVER do (lista vermelha)

- ❌ NUNCA retornar 503 `pipeline_incomplete_*` ou 501 em endpoint do Macro Native Substrate;
- ❌ NUNCA introduzir tabela física nova além de `org_beta_overrides`;
- ❌ NUNCA introduzir `'family_alias'` no enum `CapabilityStatus` em PR2;
- ❌ NUNCA criar `govai.capability_decomposition_map` em PR2;
- ❌ NUNCA tratar `type: null` em tool Anthropic como `client_defined`;
- ❌ NUNCA permitir override de token `hard_denied` via `org_beta_overrides`;
- ❌ NUNCA marcar capability essencial como `planned` silenciosamente para escapar de implementação;
- ❌ NUNCA alterar enforcement modes canônicos (`observe | warn | ask | enforce | sandbox_required | blocked`);
- ❌ NUNCA introduzir `GenericLLMRequest` ou normalização lossy entre providers;
- ❌ NUNCA permitir `body_forward_mode='redacted'` em capability `passthrough_audited`;
- ❌ NUNCA emitir audit event sem `tools_taxonomy_version` se há tool classifications;
- ❌ NUNCA executar workaround silencioso quando o procedimento é Human Architect Escalation;
- ❌ NUNCA proceder com `verification_required` em `BETA_POLICY` em runtime production;
- ❌ NUNCA modificar ADP v4.2 ou Addendum v4.2.2 (são canônicos imutáveis);
- ❌ NUNCA introduzir capability fora dos universos Anthropic + OpenAI da Matrix.

---

## 18. Procedimento de escalation final (resumo)

Se ao final do PR2 algum item da §15 não estiver verde:

1. NÃO abrir PR de merge silenciosamente;
2. registrar `docs/architecture/escalations/PR2-ESC-final-NNN.md`;
3. listar:
   - itens da §15 não cumpridos;
   - razão técnica;
   - alternativas com prós/contras;
   - recomendação;
4. reportar com header `## ⚠️ HUMAN_ARCHITECT_ESCALATION_REQUIRED — PR2 final criteria not met`;
5. aguardar resolução do arquiteto humano.

---

## 19. Notas finais para Claude Code

### 19.1 Sequência operacional sugerida

1. Ler ADP v4.2, Addendum v4.2.2, Matrix v2 Consolidated, patch v2.0.1, e este Peça A v2 — íntegra;
2. Inspecionar repositório (estrutura `packages/`, `db/migrations/`, `tests/`, ADRs existentes);
3. Validar pré-condições da §2 desta Peça A v2;
4. Executar Batch F → testar → executar Batch A → testar → executar Batch C → testar → executar Batch G → testar;
5. Decidir Batch D (promoção ou diferimento);
6. Executar Batch M (gates + counts + verification_required resolution);
7. Executar Batch L (live tests opt-in);
8. Validar §15 (acceptance criteria);
9. Abrir PR de merge.

### 19.2 Comportamento autônomo vs escalation

Claude Code tem autonomia para:

- escolher organização interna de arquivos dentro dos batches;
- escolher nomes de variáveis e funções (desde que claros);
- escolher se usa `for...of`, `.map()`, etc.;
- escolher granularidade de commits internos;
- decidir entre estratégias hermético-equivalentes de teste.

Claude Code NÃO tem autonomia para:

- adicionar capability fora da Matrix;
- alterar enforcement modes;
- alterar BetaTokenPolicy enum;
- introduzir tabela nova além de `org_beta_overrides`;
- pular live tests;
- marcar capability essential como planned/blocked retroativamente;
- alterar audit event schemas além das versões especificadas;
- decidir promover Batch D sem verificação técnica e tempo orçamentário.

### 19.3 Estilo e qualidade de código

- TypeScript strict mode;
- Zod para todos os schemas em runtime;
- imports organizados (provider-native preferido);
- tests usando Testcontainers para Postgres;
- coverage não exigido como métrica, mas casos canônicos das listagens explícitas (ex.: §7.6, §8.7) DEVEM estar cobertos;
- erros estruturados com `error`, `reason`, `remediation_url`, `audit_event_id` quando aplicável;
- log estruturado JSON em runtime production code paths.

---

**Fim da Peça A v2 — PR2 Prompt Claude Code.**

---

## Apêndice A — Pacote canônico de input para execução

Quando o arquiteto humano autorizar execução, Claude Code recebe:

1. ADP v4.2 (hash `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254`)
2. Addendum ADP v4.2.2 — Macro Native Substrate
3. Provider Coverage Matrix v2 Consolidated (hash `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777`)
4. Provider Coverage Matrix v2.0.1 Patch (hash `1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e`)
5. Esta Peça A v2 (hash a ser calculado após auditoria)
6. Repositório `github.com/mauriciodesouzaads/govai-platform` no estado pós-PR1.

A autorização de execução virá em mensagem separada do arquiteto humano. **Esta Peça A v2 não é executável até essa autorização.**
