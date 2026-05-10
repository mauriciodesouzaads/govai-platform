# GovAI PR2 — Provider Coverage Matrix v2 — Consolidated

**Versão:** v2 consolidada (canônica)
**Data:** 2026-05-06
**Status:** canônico em conjunto com ADP v4.2 + Addendum v4.2.2. **Substitui** todas as versões anteriores (Parte 1 v2.0 + v2.1 + v2.2 e Parte 2 v2.0 + v2.1).

**Documentos canônicos pinned (referência obrigatória):**

| Documento | Hash | Papel |
|---|---|---|
| ADP v4.2 | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` | base canônica conceitual |
| Addendum ADP v4.2.2 — Macro Native Substrate | (gerado em 2026-05-06) | restringe v4.2; PR2 = Native Provider Substrate; Macro Native Substrate Contract |

**Documentos históricos absorvidos (não citar como canônico de execução):**

| Documento | Hash | Status |
|---|---|---|
| Peça B v2.0 — Parte 1 Anthropic | `8e0a3a525e9d2dbcb5041965a0f02365f1ab0784daad346b8debc20481dfc76f` | base; absorvida nesta consolidação |
| Peça B v2.1 — Parte 1 Anthropic patch | `7814ef4e5488d289c49ff4e76585f38ad2ad80add5acb7d4a6a65209d65d3449` | absorvida |
| Peça B v2.2 — Parte 1 Anthropic patch | `61c0af1bab422ded9ef586e44e07dcd18bde335e6817613ded9daddb1429d9d2` | absorvida |
| Peça B v2.0 — Parte 2 OpenAI | `f06dc18db97f739a906ea19092d6de0ff20bfeb488beccc177b2ad7022aaa543` | absorvida |
| Peça B v2.1 — Parte 2 OpenAI patch | `153ce9b2d68a9abab56dbbac5b5aa192f328693a2fd0add24f5d6ffd6426239e` | absorvida |

**Aplicabilidade:** PR2 e PRs subsequentes. É o documento de referência único para Peça A v2 (PR2 Prompt Claude Code).

**Princípios canônicos (do Addendum v4.2.2):**

> O macro nasce como arquitetura. A implementação pode ser dividida em batches por volume de código e testes, mas a base não pode ser micro, provisória ou capada.

> Podemos dividir a execução. Não podemos dividir a arquitetura.

> Deep governance pode ser incremental. Native availability essencial não pode parecer capada.

---

## Sumário

**Parte I — Fundação (compartilhada entre providers)**

1. Status, supersedimento e relação com Addendum v4.2.2
2. Modelo conceitual: `capability_id` ≠ endpoint
3. Schemas TypeScript de referência
4. `BetaTokenPolicy` enum (compartilhado)
5. `org_beta_overrides` (compartilhado, `provider IN ('anthropic', 'openai')`)
6. Audit event schemas (compartilhados, provider-agnostic)
7. Forward-compat de area-level capabilities (contrato conceitual; sem tabela física em PR2)

**Parte II — Anthropic**

8. Universo Anthropic — visão consolidada
9. Capabilities `supported` em PR2 (Anthropic)
10. Capabilities `planned` (Anthropic)
11. Capabilities `blocked` (Anthropic)
12. Capabilities `not_exposed` (Anthropic)
13. `ANTHROPIC_BETA_POLICY`
14. `anthropic.tools_taxonomy`
15. Escalations A1–A4 e decisões fixadas
16. Live test plan Anthropic

**Parte III — OpenAI**

17. Universo OpenAI — visão consolidada
18. Capabilities `supported` em PR2 (OpenAI)
19. Capabilities `planned` (OpenAI)
20. Capabilities `blocked` (OpenAI)
21. Capabilities `not_exposed` (OpenAI)
22. `OPENAI_BETA_POLICY`
23. `openai.tools_taxonomy`
24. Escalations O1–O6 e decisões fixadas
25. Live test plan OpenAI

**Parte IV — Consolidação operacional**

26. Provider Coverage Matrix consolidada (tabela única)
27. Escopo numérico total em PR2
28. Pre-merge gates obrigatórios
29. Critério de aceitação consolidado
30. Não-objetivos
31. Próximo passo

---

# Parte I — Fundação (compartilhada entre providers)

## 1. Status, supersedimento e relação com Addendum v4.2.2

Este documento é a Provider Coverage Matrix canônica para PR2. Substitui integralmente:

- Peça B v1.2 (Provider Coverage Matrix Initial — descontinuada);
- Peça B v2.0 Parte 1 + Parte 2 (etapas iterativas de auditoria);
- Patches v2.1 e v2.2 (etapas iterativas).

Todas as decisões dos patches estão aplicadas in-line nas seções §8-§25.

Em conjunto com ADP v4.2 + Addendum v4.2.2, esta Matrix forma o **pacote canônico de design de PR2**. A próxima etapa é Peça A v2 (PR2 Prompt Claude Code) que materializa este design em instruções executáveis.

Em caso de conflito interpretativo entre esta Matrix e versões históricas, prevalece esta Matrix integralmente.

Em caso de conflito entre esta Matrix e ADP v4.2 / Addendum v4.2.2, prevalecem os documentos canônicos superiores.

---

## 2. Modelo conceitual: `capability_id` ≠ endpoint

### 2.1 Princípio canônico

`capability_id` e endpoint nativo do provider são objetos distintos:

- **Endpoint** é a unidade do provider (`POST /v1/messages`, `GET /v1/files/{id}`).
- **Capability** é a unidade do registry GovAI. Pode cobrir um único endpoint (governança profunda dedicada) ou múltiplos endpoints (mesma classificação de risco e tier).

### 2.2 Modelo híbrido com regra explícita

- **Method-level capability_id** — usado para capabilities em Governed Run com `level: policy_governed`. É o caso das 6 core de v4.2 §21 (`anthropic.messages.create/stream`, `openai.responses.create/stream`, `openai.chat.completions.create/stream`).
- **Area-level capability_id** — usado para capabilities em `level: passthrough_audited` onde os endpoints internos compartilham mesma classificação. Cada capability area-level expõe `endpoint_coverage` interno como lista de endpoints cobertos.

A escolha não é livre por endpoint:

- capability area-level é a forma padrão;
- method-level é exceção justificada quando há policy profunda dedicada por método;
- não se mistura os dois modelos para a mesma área de funcionalidade;
- operações destrutivas (DELETE) sobre área área-level **devem** ser separadas em sub-capabilities próprias quando a classificação de risco difere (ex.: `openai.models.delete`, `openai.vector_stores.delete`, `openai.vector_stores.files.delete` — ver §18).

### 2.3 Justificativa

Capability-level pura inflaria o registry com dezenas de IDs. Endpoint-level pura mistura o que tem governança profunda (`messages.create`) com o que tem passthrough auditado. Modelo híbrido com regra explícita preserva legibilidade da Provider Coverage Matrix e permite evolução de level por capability sem refatorar o registry.

### 2.4 Forward-compat

Promover uma capability area-level para `policy_governed` no futuro pode exigir desmembrá-la em method-level. Esta migração segue a regra de §7 (sem refatoração destrutiva de IDs ou audit history).

### 2.5 Categorias de fallback declarável

Para capabilities `supported`, fallback declarável (deferíveis a PR3+) limita-se estritamente a:

- hashing avançado de chunks em multipart;
- `evidence_strength` elevada para uploads grandes;
- output DLP em conteúdo de arquivos;
- otimizações avançadas de streaming multipart.

**Existência funcional do endpoint não é fallback declarável.** Se houver impedimento técnico real, dispara Human Architect Escalation (Addendum §14).

---

## 3. Schemas TypeScript de referência

### 3.1 Capability schema canônico

Compatível com ADP v4.2 §12.1 + Addendum v4.2.2 §6.1:

```typescript
type CapabilityStatus = 'not_exposed' | 'planned' | 'supported' | 'blocked';
// Note: 'family_alias' não é introduzido em PR2 — fica para PR de primeira decomposition real (§7).

type CapabilityLevel =
  | 'passthrough_audited'
  | 'policy_governed'
  | 'evidence_grade';

type RiskClass = 'A' | 'B' | 'C' | 'D' | 'E';
type Tier = 'starter' | 'business' | 'enterprise' | 'regulated';
type OperationalMode = 'production' | 'pilot' | 'dev' | 'test';

type EnforcementMode =
  | 'observe'
  | 'warn'
  | 'ask'
  | 'enforce'
  | 'sandbox_required'
  | 'blocked';

interface Capability {
  id: string;
  provider: 'anthropic' | 'openai';
  status: CapabilityStatus;
  level: CapabilityLevel;
  base_risk_class: RiskClass;
  tier_availability: Tier[];
  enforcement_default: EnforcementMode | EnforcementResolution;
  facets: Facet[];
  endpoint_coverage: EndpointCoverage[];
  beta_dependencies: BetaDependency[];
  planned_phase?: string;        // só quando status === 'planned'
  blocked_reason?: string;       // só quando status === 'blocked'
  last_live_test_at?: string;    // ISO 8601 datetime
}

interface EndpointCoverage {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  streams: boolean;
  multipart: boolean;
  notes?: string;
}

interface BetaDependency {
  header_token: string;
  required: 'always' | 'feature_flag';
  allowlist_treatment:
    | 'global_allowlist'
    | 'org_override_allowed'
    | 'hard_denied'
    | 'verification_required'
    | 'denied_until_decision'
    | 'removed_as_no_longer_needed';
  source_doc?: string;
}
```

### 3.2 EnforcementResolution (preconditions e side_effects ortogonais)

Modos canônicos de enforcement permanecem `observe | warn | ask | enforce | sandbox_required | blocked`. `risk_acceptance` **não é enforcement mode** — é artefato/registro de aceite via `tenant_capability_acceptance` (Addendum v4.2.2 §5.4).

Para capabilities cuja decisão depende de tier × effective_risk_class × side_effects:

```typescript
interface EnforcementResolution {
  mode: EnforcementMode;
  side_effects?: SideEffect[];
  preconditions?: Precondition[];
}

type SideEffect =
  | { audit_detail_level: 'high' }
  | { dlp_pre_scan_required: boolean };

type Precondition =
  | { tenant_capability_acceptance_required: true; max_effective_risk_class_allowed_for_acceptance: RiskClass }
  | { approval_workflow_required: boolean }
  | { sandbox_environment_required: boolean };
```

### 3.3 Convenção de paths

| Provider | baseURL no SDK oficial | Path completo via passthrough |
|---|---|---|
| Anthropic | `<govai>/passthrough/anthropic` | `<govai>/passthrough/anthropic/v1/messages` (SDK adiciona `/v1` internamente) |
| OpenAI | `<govai>/passthrough/openai/v1` | `<govai>/passthrough/openai/v1/responses` (SDK não adiciona `/v1`; é parte do baseURL) |

ADR explícito em Peça A v2 documenta a diferença para evitar duplicação `/v1/v1/...`.

---

## 4. `BetaTokenPolicy` enum (compartilhado)

Aplicável a tokens `anthropic-beta` (Anthropic) e `OpenAI-Beta` (OpenAI).

```typescript
export type BetaTokenPolicy =
  /** automaticamente permitido para qualquer org com tier compatível;
   *  modificação exige PR + ADR; auditoria global via allowlist_version */
  | 'global_allowlist'

  /** não permitido por default; admin de org pode habilitar via
   *  org_beta_overrides com motivo, expiry e audit; respeita Tier Policy Matrix */
  | 'org_override_allowed'

  /** nunca permitido em PR2; mudança exige PR + ADR + nova decisão arquitetural;
   *  org admin NÃO pode habilitar via org_beta_overrides (constraint impede) */
  | 'hard_denied'

  /** status pendente de verificação técnica em Peça A v2;
   *  é estado pré-merge — comporta-se como 'org_override_allowed' até resolução;
   *  NÃO pode existir em runtime production após merge */
  | 'verification_required'

  /** status pendente de decisão de produto/arquiteto;
   *  comporta-se como 'hard_denied' até resolução */
  | 'denied_until_decision'

  /** provider migrou para parametrização nativa; header é forwardado naturalmente
   *  sem alteração; útil para clientes legados */
  | 'removed_as_no_longer_needed';

export interface BetaTokenPolicyEntry {
  beta_token: string;
  policy: BetaTokenPolicy;
  adr?: string;          // obrigatório se 'global_allowlist'
  reason: string;
  source_doc?: string;
  pinned_at: string;     // ISO 8601 datetime
  legacy?: boolean;      // marca tokens legacy do provider mantidos para compat
}
```

### 4.1 Resolução em runtime

Algoritmo (em `provider-{anthropic,openai}/src/passthrough/beta-resolver.ts`):

```
para cada beta_token recebido em 'anthropic-beta' / 'OpenAI-Beta':
  policy = LOOKUP_POLICY(provider).find(beta_token).policy
  
  switch policy:
    'global_allowlist'         → forward; registrar em beta_allowlist_sources[source='global_allowlist']
    'org_override_allowed'     → check org_beta_overrides; se ativo, forward; se não, 403
    'hard_denied'              → 403; reason inclui 'requires PR + ADR'
    'verification_required'    → comporta-se como 'org_override_allowed'; audit marca verification_pending=true
    'denied_until_decision'    → comporta-se como 'hard_denied'; audit marca decision_pending=true
    'removed_as_no_longer_needed' → forward sem alteração; audit registra source=legacy_no_longer_needed
  
  beta_token desconhecido (não na policy) → 403 com reason='unknown_beta_token'
```

### 4.2 Pre-merge gate

Conforme Addendum + esta Matrix: **antes do merge do PR2**, nenhuma entrada em `ANTHROPIC_BETA_POLICY` ou `OPENAI_BETA_POLICY` pode ter `policy: 'verification_required'`. Resolução obrigatória para um dos cinco estados finais (`global_allowlist`, `org_override_allowed`, `hard_denied`, `denied_until_decision`, `removed_as_no_longer_needed`).

Test obrigatório (em Peça A v2):

```typescript
// tests/integration/governance/beta-policy-no-verification-pending.test.ts
import { ANTHROPIC_BETA_POLICY } from '@govai/provider-anthropic';
import { OPENAI_BETA_POLICY } from '@govai/provider-openai';

test('no verification_required in runtime policy', () => {
  expect(ANTHROPIC_BETA_POLICY.every(e => e.policy !== 'verification_required')).toBe(true);
  expect(OPENAI_BETA_POLICY.every(e => e.policy !== 'verification_required')).toBe(true);
});
```

### 4.3 Constraint de criação de override

A inserção em `org_beta_overrides` precisa validar a policy do token alvo:

```typescript
// provider-{anthropic,openai}/src/admin/create-override.ts
function createOrgBetaOverride(input: { provider, beta_token, ... }) {
  const policy = LOOKUP_POLICY(input.provider).find(input.beta_token);
  if (!policy) {
    throw new ApiError(403, 'unknown_beta_token', { ... });
  }
  if (policy.policy === 'hard_denied') {
    throw new ApiError(403, 'beta_token_hard_denied', {
      message: 'This beta token cannot be enabled by org override; requires PR + ADR.',
      beta_token: input.beta_token,
    });
  }
  // proceed with creation
}
```

---

## 5. `org_beta_overrides` (compartilhado)

Único objeto novo de schema introduzido em PR2 (autorizado pelo Addendum v4.2.2 §1).

### 5.1 Schema da tabela

```sql
-- migration: 0007_org_beta_overrides.sql (parte do Batch F do PR2)
CREATE TABLE govai.org_beta_overrides (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL,
  provider        text        NOT NULL CHECK (provider IN ('anthropic', 'openai')),
  beta_token      text        NOT NULL,
  reason          text        NOT NULL,
  set_by_user_id  uuid        NOT NULL,
  set_at          timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz NULL,
  CHECK (expires_at > set_at)
);

-- índice único parcial (apenas overrides ativos)
CREATE UNIQUE INDEX org_beta_overrides_active_unique
  ON govai.org_beta_overrides (org_id, provider, beta_token)
  WHERE revoked_at IS NULL;

-- RLS
ALTER TABLE govai.org_beta_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE govai.org_beta_overrides FORCE ROW LEVEL SECURITY;

-- policies (alinhadas a v4.2 §8: por comando × role)
CREATE POLICY org_beta_overrides_select ON govai.org_beta_overrides
  FOR SELECT TO govai_runtime
  USING (org_id = current_setting('govai.current_org_id', true)::uuid);

CREATE POLICY org_beta_overrides_insert ON govai.org_beta_overrides
  FOR INSERT TO govai_admin
  WITH CHECK (org_id = current_setting('govai.current_org_id', true)::uuid);

CREATE POLICY org_beta_overrides_update_revoke ON govai.org_beta_overrides
  FOR UPDATE TO govai_admin
  USING (org_id = current_setting('govai.current_org_id', true)::uuid)
  WITH CHECK (
    org_id = current_setting('govai.current_org_id', true)::uuid
    AND revoked_at IS NOT NULL  -- só permite update que define revoked_at
  );

-- DELETE não permitido (revogação via revoked_at)
```

### 5.2 Justificativa do design

- **`id uuid PRIMARY KEY`** permite recriar `(org_id, provider, beta_token)` após revogação preservando histórico. PRIMARY KEY composto seria bug semântico.
- **Índice único parcial sobre `WHERE revoked_at IS NULL`** garante no máximo um override ativo por `(org_id, provider, beta_token)`. Histórico revogado pode acumular livremente.
- **`expires_at > now()` NÃO entra no índice parcial** (predicado não-imutável; índice ficaria volátil). Filtro temporal é runtime.
- **`CHECK (expires_at > set_at)`** impede expires_at retroativo.
- **Sem DELETE; revogação via UPDATE de `revoked_at`** preserva audit-friendliness.

### 5.3 Query de runtime para resolver overrides ativos

```sql
SELECT beta_token
FROM govai.org_beta_overrides
WHERE org_id = $1
  AND provider = $2
  AND revoked_at IS NULL
  AND expires_at > now();
```

### 5.4 Regras operacionais

- criação exige role admin (RBAC);
- gera audit event `org.beta_override_set` na chain `admin`;
- revogação gera audit event `org.beta_override_revoked` na chain `admin`;
- audit event do passthrough registra qual override foi usado quando aplicável (via `beta_allowlist_sources[]`);
- override expirado é tratado como ausente (deny por filtro temporal).

### 5.5 Limites

- **`org_beta_overrides` cobre apenas headers `anthropic-beta` / `OpenAI-Beta`.** Não cobre body parameters (ex.: `purpose=assistants` em Files OpenAI — ver §18.6).
- não habilita endpoints fora da allowlist passthrough; só habilita header em endpoint já permitido;
- não substitui `tenant_capability_acceptance` quando o beta envolver capability de Risk Class B+ que exija aceite por tier;
- override de tokens `hard_denied` é impedido por constraint (§4.3).

---

## 6. Audit event schemas (compartilhados, provider-agnostic)

Schemas Zod a serem implementados em `core-events/src/`. Todos os schemas têm `schema_version` literal; mudanças de campo geram nova versão.

### 6.1 `passthrough.invoked` — schema_version 3

Evento principal de toda chamada passthrough ou Governed Run.

```typescript
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
  enforcement_decision: z.enum([
    'observe','warn','ask','enforce','sandbox_required','blocked',
  ]),
  
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
      'pre_request',
      'post_response',
      'file_upload',
      'pre_response_content',
      'file_addition_to_vector_store',
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
  
  // OpenAI Files specific (J1 v2.1 OpenAI patch)
  purpose_deprecated: z.boolean().optional(),
  
  audit_event_id: z.string().uuid(),
  chain_id: z.literal('run'),
}).superRefine((data, ctx) => {
  // Regra 1: stream → stream_final_hash; non-stream 2xx → native_response_hash
  if (data.is_stream && !data.stream_final_hash) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'is_stream=true requires stream_final_hash',
      path: ['stream_final_hash'],
    });
  }
  if (!data.is_stream
      && data.status_code >= 200
      && data.status_code < 300
      && !data.native_response_hash) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'non-stream 2xx response requires native_response_hash',
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
      message: 'passthrough_audited capability_level does not allow redacted body_forward_mode; only raw or blocked',
      path: ['body_forward_mode'],
    });
  }
  
  // Regra 4: passthrough_audited com forward de sucesso → raw
  if (data.capability_level === 'passthrough_audited'
      && data.enforcement_decision !== 'blocked'
      && data.body_forward_mode !== 'raw') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'passthrough_audited forward (any provider status) requires body_forward_mode=raw',
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
```

### 6.2 `passthrough.beta_denied` — schema_version 1

```typescript
export const PassthroughBetaDeniedSchema = z.object({
  event_type: z.literal('passthrough.beta_denied'),
  schema_version: z.literal(1),
  tenant_context: TenantContextSchema,
  provider: z.enum(['anthropic', 'openai']),
  native_endpoint: z.string(),
  beta_tokens_requested: z.array(z.string()).min(1),
  beta_tokens_denied: z.array(z.string()).min(1),
  beta_tokens_in_global_allowlist: z.array(z.string()),
  beta_tokens_in_org_overrides_active: z.array(z.string()),
  policy_for_denied_tokens: z.array(z.object({
    beta_token: z.string(),
    policy: z.enum([
      'hard_denied','denied_until_decision','unknown_beta_token',
    ]),
  })),
  http_status_returned: z.literal(403),
  audit_event_id: z.string().uuid(),
  chain_id: z.literal('run'),
});
```

### 6.3 `tool_validation.blocked` — schema_version 1

```typescript
export const ToolValidationBlockedSchema = z.object({
  event_type: z.literal('tool_validation.blocked'),
  schema_version: z.literal(1),
  tenant_context: TenantContextSchema,
  provider: z.enum(['anthropic', 'openai']),
  native_endpoint: z.string(),
  blocked_tools: z.array(z.object({
    tool_index: z.number().int().nonnegative(),
    tool_type: z.string(),
    classification: z.enum([
      'anthropic_provider_hosted_code_execution',
      'anthropic_provider_hosted_computer_use',
      'anthropic_typed_unknown',
      'openai_provider_hosted_code_interpreter',
      'openai_provider_hosted_computer_use',
      'openai_provider_hosted_hosted_shell',
      'openai_provider_hosted_apply_patch',
      'openai_provider_hosted_mcp',
      'openai_provider_hosted_tool_search',
      'openai_typed_unknown',
    ]),
    reason: z.string(),
  })).min(1),
  tools_taxonomy_version: z.string().min(1),
  http_status_returned: z.literal(403),
  audit_event_id: z.string().uuid(),
  chain_id: z.literal('run'),
});
```

### 6.4 `org.beta_override_set` / `org.beta_override_revoked` — schema_version 1

```typescript
export const OrgBetaOverrideSetSchema = z.object({
  event_type: z.literal('org.beta_override_set'),
  schema_version: z.literal(1),
  tenant_context: TenantContextSchema,
  override_id: z.string().uuid(),
  provider: z.enum(['anthropic', 'openai']),
  beta_token: z.string().min(1),
  reason: z.string().min(1).max(2000),
  set_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  audit_event_id: z.string().uuid(),
  chain_id: z.literal('admin'),
});

export const OrgBetaOverrideRevokedSchema = z.object({
  event_type: z.literal('org.beta_override_revoked'),
  schema_version: z.literal(1),
  tenant_context: TenantContextSchema,
  override_id: z.string().uuid(),
  provider: z.enum(['anthropic', 'openai']),
  beta_token: z.string().min(1),
  revoked_at: z.string().datetime(),
  revoked_by_user_id: z.string().uuid(),
  audit_event_id: z.string().uuid(),
  chain_id: z.literal('admin'),
});
```

### 6.5 `run.cancelled` — reutiliza schema de v4.2 §8

Disparado por request abort do cliente durante streaming. Inclui `cancelled_at`, `cancelled_by`, `bytes_streamed_before_cancel`. Sem mudança aqui.

### 6.6 Tabela mestra de eventos em PR2

| event_type | schema_version | chain | quando |
|---|---|---|---|
| `passthrough.invoked` | 3 (§6.1) | `run` | toda chamada passthrough ou Governed Run |
| `passthrough.beta_denied` | 1 (§6.2) | `run` | header beta negado |
| `tool_validation.blocked` | 1 (§6.3) | `run` | tool type bloqueado em validation |
| `org.beta_override_set` | 1 (§6.4) | `admin` | criação de override |
| `org.beta_override_revoked` | 1 (§6.4) | `admin` | revogação de override |
| `run.cancelled` | reutilizado v4.2 | `run` | request abort durante stream |

### 6.7 Convenções

- Cada schema versionado por `schema_version` literal; mudanças de campo geram nova versão.
- Todos os schemas exportados de `core-events/src/index.ts` para tipagem consistente downstream.
- `audit_event_id` é gerado pelo emitente; permite tracking idempotente.
- `chain_id` restrito por evento: `run` para operações de inferência/execução; `admin` para configuração; `policy` para decisões de policy isoladas.
- Schemas anteriores (PassthroughInvokedSchema v1, v2) permanecem aceitos para validação de eventos históricos; emissão nova usa v3.

---

## 7. Forward-compat de area-level capabilities (contrato conceitual)

### 7.1 Princípio

Capabilities area-level podem precisar ser desmembradas em method-level no futuro (ex.: quando um endpoint específico precisa de `policy_governed` enquanto o resto da área permanece `passthrough_audited`). A regra abaixo garante que esta evolução não quebre audit histórico ou consumidores externos.

### 7.2 Regra canônica

Quando uma capability area-level é desmembrada em PR futuro:

```yaml
forward_compat_area_level_decomposition:
  parent_capability:
    status: family_alias        # NOVO status, introduzido junto com a tabela em PR de decomposition
    keeps: id, base_risk_class, tier_availability
    adds: aliased_to: [child_capability_ids]
    audit_history_resolution: |
      audit events com capability_id == parent_id permanecem válidos;
      runtime resolve parent_id como "any of child_ids OR exact parent_id".
  
  child_capabilities:
    get_specific_ids: e.g. anthropic.files.upload, anthropic.files.list
    can_have:
      - different levels (passthrough_audited vs policy_governed)
      - different enforcement_default per tier
      - different facets
  
  registry_migration_map:
    table: govai.capability_decomposition_map
    columns:
      parent_capability_id: text
      child_capability_id: text
      decomposed_at: timestamptz
      decomposed_in_pr: text
      decomposition_reason: text
    use:
      runtime resolver consulta map para mapear request com parent_id ao child_id correto;
  
  proibições:
    - rename or repurpose parent capability_id
    - retroactively change historical audit's capability_id
    - delete child without preserving family_alias parent
    - decomposition that reduces tier_availability or upgrades risk_class without explicit ADR + customer notification
```

### 7.3 Implicação para PR2

**Em PR2:**

- nenhuma decomposition acontece;
- `CapabilityStatus` enum em PR2 permanece `'not_exposed' | 'planned' | 'supported' | 'blocked'` — `'family_alias'` **não** é introduzido em PR2;
- tabela `govai.capability_decomposition_map` **não** é criada em PR2;
- regra acima é contrato conceitual reservado para PRs futuros.

**Em PR de primeira decomposition (futuro):**

- migration cria `govai.capability_decomposition_map`;
- enum `CapabilityStatus` ganha `'family_alias'` em PR específico com migration de schema;
- ADR dedicado documenta primeira decomposition.

### 7.4 Capabilities area-level já criadas em PR2 que podem precisar decomposição futura

(informativo — não cria obrigação em PR2):

- `anthropic.files` (5 endpoints) — pode desmembrar em `.upload`, `.list`, `.retrieve`, `.delete`, `.content` em PR3+ com Governed Run para upload/delete;
- `openai.files` (5 endpoints) — análogo;
- `openai.vector_stores` (5 endpoints + 2 sub-DELETE — DELETEs já estão em sub-capabilities por §18) — pode evoluir;
- `openai.audio.*` — já planejada como múltiplas capabilities desde o início;
- `anthropic.message_batches` (6 endpoints) — pode desmembrar.

Não há obrigação de desmembrar; é registro de candidatos para evolução futura.

---

(continua na Parte II — Anthropic)


# Parte II — Anthropic

## 8. Universo Anthropic — visão consolidada

| capability_id | status PR2 | level | base_risk_class | tier_availability | beta? |
|---|---|---|---|---|---|
| `anthropic.messages.create` | supported | policy_governed | A (escala C com tools, B/C com PII) | starter, business, enterprise, regulated | nenhum (com facets) |
| `anthropic.messages.stream` | supported | policy_governed | A (escala C com tools, B/C com PII) | starter, business, enterprise, regulated | nenhum (com facets) |
| `anthropic.messages_meta` | supported | passthrough_audited | A | starter, business, enterprise, regulated | nenhum |
| `anthropic.models` | supported | passthrough_audited | A | starter, business, enterprise, regulated | nenhum |
| `anthropic.files` | supported | passthrough_audited | B (escala C com PII) | starter, business, enterprise, regulated | `files-api-2025-04-14` (global_allowlist via ADR-014) |
| `anthropic.web_search_tool` | supported | passthrough_audited | C | starter, business, enterprise, regulated | nenhum |
| `anthropic.message_batches` | planned (PR2 stretch / PR4) | passthrough_audited (target) | A (escala B/C conforme body) | starter, business, enterprise, regulated | header verification_required |
| `anthropic.code_execution_tool` | planned (PR4) | passthrough_audited (target) | C | enterprise, regulated com aceite | verificar |
| `anthropic.managed_agents` | planned (PR4-or-later) | passthrough_audited (target) | C | enterprise, regulated com aceite | `managed-agents-2026-04-01` (denied_until_decision) |
| `anthropic.skills` | planned (TBD) | n/a (avaliar) | n/a | n/a | `skills-2025-10-02` (denied_until_decision) |
| `claude_agent.*` (server-side Cenário B) | planned (PR7+) | n/a | varia | n/a | depende de sandbox |
| `anthropic.computer_use_tool` | blocked (PR8+) | n/a | D | (none) | `computer-use-*` (3 versões hard_denied) |
| `anthropic.admin.*` | not_exposed | n/a | n/a | n/a | fora de escopo |

**Resumo numérico Anthropic em PR2:**

- 6 capabilities `supported` cobrindo 10 endpoints obrigatórios + 1 capability tool `web_search` supported via classifier;
- `messages.create/stream` com 6 facets (prompt_caching, extended_thinking, tools, tool_use_blocks, tool_result_blocks, vision);
- 1 stretch (`anthropic.message_batches`);
- 4 capabilities `planned` para PR3+ com `planned_phase` honesto;
- 1 capability `blocked` (`computer_use_tool`) por architectural prerequisite (sandbox PR8+);
- 1 família `not_exposed` (`admin.*`).

---

## 9. Capabilities `supported` em PR2 (Anthropic)

### 9.1 `anthropic.messages.create` (method-level, deep policy_governed)

```yaml
id: anthropic.messages.create
provider: anthropic
status: supported
level: policy_governed
base_risk_class: A
risk_escalation:
  - reason: tools_present_in_request
    base_to_effective: A → C
    contribution_classifier: |
      Subclasses (taxonomia §14) podem aumentar:
      - client_defined: sem aumento adicional sobre C
      - anthropic_defined_client_executed_text_editor: A → C
      - anthropic_defined_client_executed_bash: A → D
      - anthropic_provider_hosted_web_search: A → C
      - anthropic_provider_hosted_code_execution: BLOCKED in PR2
      - anthropic_provider_hosted_computer_use: BLOCKED in PR2
      - anthropic_typed_unknown: BLOCKED in PR2
  
  - reason: file_payload_exceeding_threshold
    base_to_effective: A → C
    threshold: "presença de file reference em qualquer content block"
  
  - reason: dlp_pii_detected
    base_to_effective: A → B (PII fraca: email/telefone) ou A → C (PII forte: cpf/cnpj/passport/cartão)
  
  - reason: vision_image_with_pii_potential
    base_to_effective: A → B
    notes: "imagens com texto podem conter PII; output DLP em PR3+"

tier_availability: [starter, business, enterprise, regulated]

enforcement_default:
  starter:    enforce
  business:   enforce
  enterprise: enforce
  regulated:  enforce

endpoint_coverage:
  - method: POST
    path:   /v1/messages
    streams: false      # quando body.stream !== true
    multipart: false

beta_dependencies: []   # core, sem beta header obrigatório

facets:
  - name: prompt_caching
    via_param: cache_control no body (parametrização nativa)
    via_header_legacy: anthropic-beta=prompt-caching-2024-07-31 (verification_required em §13; pode ser removed_as_no_longer_needed após Peça A)
    status: supported
  - name: extended_thinking
    via_param: thinking object no body
    status: supported
  - name: tools
    via_param: tools[] no body
    status: supported (preservação byte-a-byte é gate de merge)
  - name: tool_use_blocks
    via_response: blocks com type=tool_use no response/stream
    status: supported (preservação no stream — roundtrip)
  - name: tool_result_blocks
    via_request: blocks com type=tool_result em request seguinte
    status: supported
  - name: vision
    via_param: image content blocks
    status: supported

test_evidence:
  hermetic_suite: tests/integration/anthropic/messages/create.test.ts
  live_smoke: tests/live/anthropic/messages-create-live.test.ts

last_live_test_at: <populado pela suite live em PR2>
```

**Pipeline em Governed Run** (rota primária para `policy_governed`):

```
inbound POST /v1/runs
  → tenant resolve + auth
  → DLP pre-scan (input)
  → tool classifier (se body tem tools[])
  → policy decision (Tier × Risk × Mode):
      effective_risk_class = computeEffectiveRiskClass(base, escalations)
      enforcement = computeEnforcement(tier, effective_risk_class, operational_mode)
  → credential rewrite (tenant key)
  → SDK invoke @anthropic-ai/sdk (provider-native)
  → audit append (run chain) com PassthroughInvokedSchema
  → response return
```

**Pipeline em passthrough auditado** (rota alternativa, mesma capability):

```
inbound POST /passthrough/anthropic/v1/messages
  → tenant resolve + auth
  → header allowlist filter (anthropic-beta ∩ ANTHROPIC_BETA_POLICY active)
  → tool classifier (se body tem tools[])
  → raw body forward (sem parse/re-serialize)
  → credential rewrite (tenant key)
  → forward para api.anthropic.com
  → response/stream byte-preserved
  → audit append (run chain) com hashes + tools_taxonomy_version
```

### 9.2 `anthropic.messages.stream` (method-level, deep policy_governed)

Espelha §9.1 exceto:

```yaml
id: anthropic.messages.stream
endpoint_coverage:
  - method: POST
    path:   /v1/messages
    streams: true       # quando body.stream === true
    multipart: false
test_evidence:
  hermetic_suite: tests/integration/anthropic/messages/stream.test.ts
  live_smoke: tests/live/anthropic/messages-stream-live.test.ts
```

**Critérios específicos de stream Anthropic:**

- SSE byte-preserved chunk-a-chunk;
- hash incremental do stream para `stream_final_hash` calculado em paralelo, sem bloquear chunks;
- request abort do cliente → cancelamento upstream em ≤1s + audit `run.cancelled`;
- `tool_use` blocks no stream preservados;
- erro mid-stream do provider preservado como `event: error` SSE chunk, sem wrapping;
- trailers HTTP preservados quando provider os envia.

### 9.3 `anthropic.messages_meta` (area-level, passthrough_audited)

```yaml
id: anthropic.messages_meta
provider: anthropic
status: supported
level: passthrough_audited
base_risk_class: A
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:    enforce
  business:   enforce
  enterprise: enforce
  regulated:  enforce
endpoint_coverage:
  - method: POST
    path:   /v1/messages/count_tokens
    streams: false
    multipart: false
    notes: "Recebe body próximo a /v1/messages, retorna contagem de tokens. Não chama o modelo."
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/anthropic/messages-meta.test.ts
  live_smoke: tests/live/anthropic/count-tokens-live.test.ts
```

### 9.4 `anthropic.models` (area-level, passthrough_audited)

```yaml
id: anthropic.models
provider: anthropic
status: supported
level: passthrough_audited
base_risk_class: A
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:    enforce
  business:   enforce
  enterprise: enforce
  regulated:  enforce
endpoint_coverage:
  - method: GET
    path:   /v1/models
    streams: false
    multipart: false
  - method: GET
    path:   /v1/models/{model_id}
    streams: false
    multipart: false
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/anthropic/models.test.ts
  live_smoke: tests/live/anthropic/models-live.test.ts
```

### 9.5 `anthropic.files` (area-level, passthrough_audited com beta dependency obrigatória)

```yaml
id: anthropic.files
provider: anthropic
status: supported
level: passthrough_audited
base_risk_class: B
risk_escalation:
  - reason: dlp_pii_detected_in_upload
    base_to_effective: B → C

tier_availability: [starter, business, enterprise, regulated]

enforcement_default:
  # decisão é resolvida em runtime via computeEnforcement(tier, effective_risk_class, operational_mode);
  # tabela abaixo é o resultado esperado da matrix em casos típicos.
  
  starter:
    base_b_no_dlp_hit:           warn
    effective_c_dlp_pii_low:     ask
    effective_c_dlp_pii_strong:  enforce
    file_size_exceeds_50mb:      ask
  
  business:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce
  
  enterprise:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce + audit_detail_level: high
  
  regulated:
    base_b_no_dlp_hit:           enforce + tenant_capability_acceptance
    effective_c_dlp_pii_any:     enforce + tenant_capability_acceptance + approval_workflow_required

dlp_phases:
  - phase: file_upload
    required: true
    action_on_finding: depende de tier
  - phase: pre_response_content
    required: false
    target_pr: PR3   # output DLP em conteúdo de arquivos

endpoint_coverage:
  - method: POST
    path:   /v1/files
    streams: false
    multipart: true
    notes: "Upload via multipart/form-data. Field 'file' contém o binário."
  
  - method: GET
    path:   /v1/files
    streams: false
    multipart: false
    notes: "Listagem paginada de arquivos da org."
  
  - method: GET
    path:   /v1/files/{file_id}
    streams: false
    multipart: false
    notes: "Metadata (filename, mime_type, size_bytes, created_at, downloadable)."
  
  - method: DELETE
    path:   /v1/files/{file_id}
    streams: false
    multipart: false
  
  - method: GET
    path:   /v1/files/{file_id}/content
    streams: true
    multipart: false
    notes: "Stream do conteúdo. Apenas para arquivos com 'downloadable: true'."

beta_dependencies:
  - header_token: files-api-2025-04-14
    required: always
    allowlist_treatment: global_allowlist
    adr: ADR-014
    source_doc: https://docs.claude.com/en/docs/build-with-claude/files

test_evidence:
  hermetic_suite: tests/integration/anthropic/files.test.ts
  live_smoke: tests/live/anthropic/files-roundtrip-live.test.ts

fallback_declarable_for_pr3_plus:
  - hashing_chunked_multipart: PR3
  - evidence_strength_uploads_acima_de_50mb: PR3
  - output_dlp_conteudo_anthropic_files: PR3
  - otimizacoes_streaming_multipart: PR3
```

### 9.6 `anthropic.web_search_tool` (tool capability, supported)

```yaml
id: anthropic.web_search_tool
provider: anthropic
status: supported
level: passthrough_audited
base_risk_class: C   # output untrusted da web; risco de prompt injection downstream
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:    warn
  business:   warn
  enterprise: enforce
  regulated:  enforce + tenant_capability_acceptance
endpoint_coverage:
  flow_only:
    appears_in:
      - tools[] do request body de /v1/messages (com type=web_search_<date>)
      - tool_use blocks do response/stream
beta_dependencies: []   # GA em 2026
detection_via_taxonomy:
  classification: anthropic_provider_hosted_web_search
  type_pattern: '^web_search_\d{8}$'
  capability_id: anthropic.web_search_tool
test_evidence:
  hermetic_suite: tests/integration/anthropic/tools-web-search.test.ts
  live_smoke: tests/live/anthropic/web-search-live.test.ts
notes:
  - "web_search é tool, não endpoint dedicado. A capability registra a presença e classifica."
  - "Output DLP do conteúdo retornado pelo web_search recomendado para PR3+."
  - "Em starter: warn. Em regulated: tenant_capability_acceptance obrigatório."
```

---

## 10. Capabilities `planned` (Anthropic)

### 10.1 `anthropic.message_batches`

```yaml
id: anthropic.message_batches
status: planned
planned_phase: PR2_stretch_or_PR4   # Batch D Addendum §7.2
target_level: passthrough_audited
target_base_risk_class: A
target_risk_escalation:
  - reason: tools_or_pii_in_batch_inputs
    base_to_effective: A → C
target_tier_availability: [starter, business, enterprise, regulated]
target_endpoint_coverage:
  - POST /v1/messages/batches (create)
  - GET /v1/messages/batches/{batch_id} (retrieve)
  - GET /v1/messages/batches (list)
  - POST /v1/messages/batches/{batch_id}/cancel
  - GET /v1/messages/batches/{batch_id}/results (stream JSONL)
  - DELETE /v1/messages/batches/{batch_id}
beta_dependencies:
  - header_token: message-batches-2024-09-24
    required: ?         # verification_required em §13
    allowlist_treatment: verification_required
    source_doc: https://docs.anthropic.com/en/api/creating-message-batches
verification_needed_in_peca_a:
  - confirmar se message-batches-2024-09-24 ainda é exigido pela API
  - confirmar se output-300k-2026-03-24 entra como facet opcional
fallback_if_stretch_fails:
  status: planned
  planned_phase: PR4
  registry_marking: honest planned with this exact phase
```

### 10.2 `anthropic.code_execution_tool`

```yaml
id: anthropic.code_execution_tool
status: planned
planned_phase: PR4
target_level: passthrough_audited
target_base_risk_class: C
target_tier_availability: [enterprise, regulated com aceite]
detection_via_taxonomy:
  classification: anthropic_provider_hosted_code_execution
  type_pattern: '^code_execution_\d{8}$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_pending_capability_promotion"
    reason: "Capability anthropic.code_execution_tool is planned for PR4 with provider-hosted sandbox dependency and tenant acceptance."
notes:
  - "Tool nativo Anthropic; código executado em sandbox da Anthropic, não do GovAI."
  - "Bloqueio em PR2 é por timing/política, não por arquitetura ausente."
verification_needed_in_peca_a:
  - confirmar se exige beta header dedicado
```

### 10.3 `anthropic.managed_agents`

```yaml
id: anthropic.managed_agents
status: planned
planned_phase: PR4-or-later   # decisão fixada em §15 ESCALATION-A3
target_level: passthrough_audited
target_base_risk_class: C
target_tier_availability: [enterprise, regulated com aceite]
beta_dependencies:
  - header_token: managed-agents-2026-04-01
    required: always
    allowlist_treatment: denied_until_decision
notes:
  - "Anthropic-hosted managed agent harness. Anunciado em abril 2026."
  - "É Cenário A (HTTP proxy) — agent roda em compute Anthropic, não GovAI."
  - "Endpoints: /v1/agents, /v1/agents/{id}, /v1/agents/{id}/sessions etc. Mapeamento exato em Peça A se promovido."
  - "NÃO substitui Cenário B (claude_agent.* server-side em compute GovAI), que continua em PR7+ com sandbox primitive."
```

### 10.4 `anthropic.skills`

```yaml
id: anthropic.skills
status: planned
planned_phase: TBD
beta_dependencies:
  - header_token: skills-2025-10-02
    required: ?
    allowlist_treatment: denied_until_decision
notes:
  - "Skills carregamento (Anthropic). Fora de escopo PR2-PR4."
  - "Decisão pós-PR4."
```

### 10.5 `claude_agent.*` (Cenário B server-side)

Família mantida exatamente como em ADP v4.2 §14.3 e Addendum v4.2.2 §3.2 + §10. Não detalhada nesta seção porque não pertence a passthrough Anthropic — pertence a future server-side runtime do GovAI.

- `claude_agent.query` / `claude_agent.session` / `claude_agent.workspace_context`: planned PR7+ (Risk A, sem ação local server-side).
- `claude_agent.file_read`: planned PR7+ (Risk B).
- `claude_agent.file_edit`: planned PR7+ (Risk C-D, exige sandbox).
- `claude_agent.bash` / `claude_agent.computer_use`: planned PR8+ (Risk D, exige sandbox primitive).

Agent-probe gate aplicável conforme Addendum v4.2.2 §10.

---

## 11. Capabilities `blocked` (Anthropic)

### 11.1 `anthropic.computer_use_tool`

```yaml
id: anthropic.computer_use_tool
provider: anthropic
status: blocked
blocked_reason: |
  Risk Class D. Computer use server-side exige uma primitive de governança dedicada
  para computer use: sandbox/environment policy, tenant risk acceptance,
  approval workflow, action logging, egress controls e incident evidence.
  Esta primitive depende de PR8+ no roadmap atual.
target_unblock_phase: PR8+
detection_via_taxonomy:
  classification: anthropic_provider_hosted_computer_use
  type_pattern: '^computer_\d{8}$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_blocked_until_governance_primitive"
    reason: "computer_use is Risk Class D and requires dedicated computer-use governance primitive. Hard_denied until PR8+."
notes:
  - "Mesmo em Cenário A (Claude Code local executando computer_use no laptop), GovAI bloqueia em PR2."
  - "Justificativa: até existir taxonomia de Cenário A com risk acceptance dedicado, computer_use é tratado como Risk D unconditional."
  - "Org admin não pode liberar via org_beta_overrides (constraint impede)."
  - "Para liberar antes de PR8+, precisa de PR + ADR + tenant_capability_acceptance, não bypass via header."
notes_on_passthrough:
  - "Em request /v1/messages com tool computer_use no body: capability invocada é anthropic.messages.create/stream com facet 'tools', mas tool classifier rejeita o request."
  - "Header anthropic-beta=computer-use-* é hard_denied independentemente."
```

---

## 12. Capabilities `not_exposed` (Anthropic)

### 12.1 `anthropic.admin.*`

```yaml
id: anthropic.admin.*
status: not_exposed
not_exposed_reason: out_of_product_scope
notes:
  - "Endpoints administrativos da Anthropic Console (organizações, members, API keys management)."
  - "Fora de escopo do produto GovAI. Administração de chave Anthropic é feita pelo cliente direto na Console Anthropic."
  - "GovAI gerencia tenant credentials (resolve tenant → Anthropic key) mas não expõe endpoints administrativos da Anthropic via passthrough."
```

---

## 13. `ANTHROPIC_BETA_POLICY`

```typescript
export const ANTHROPIC_BETA_POLICY: ReadonlyArray<BetaTokenPolicyEntry> = Object.freeze([
  {
    beta_token: 'files-api-2025-04-14',
    policy: 'global_allowlist',
    adr: 'ADR-014',
    reason: 'Files capability obrigatória em Macro Native Substrate Contract (Addendum §6.2)',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/files',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'prompt-caching-2024-07-31',
    policy: 'verification_required',  // RESOLVIDO em Peça A v2 antes do merge
    reason: 'Prompt caching pode ter migrado para parametrização nativa via cache_control no body. Peça A v2 verifica se header ainda é exigido pela API. Resolução provável: removed_as_no_longer_needed.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/prompt-caching',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'message-batches-2024-09-24',
    policy: 'verification_required',  // RESOLVIDO em Peça A v2 antes do merge
    reason: 'Batches API pode ter migrado para GA. Peça A v2 verifica. Se promovido a Batch obrigatório, vira global_allowlist por ADR-016.',
    source_doc: 'https://docs.anthropic.com/en/api/creating-message-batches',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'output-300k-2026-03-24',
    policy: 'denied_until_decision',
    reason: 'Beta de Batches para output longo. Decisão depende de promoção do Batch D.',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'computer-use-2025-11-24',
    policy: 'hard_denied',
    reason: 'Risk Class D. Computer Use exige primitive de governança dedicada (PR8+). NÃO habilitável via org_beta_overrides; mudança requer PR + ADR + governance primitive real.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/computer-use',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'computer-use-2025-01-24',
    policy: 'hard_denied',
    reason: 'Risk Class D. Mesmas restrições. Aplica a modelos Claude pré-4.5.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/computer-use',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'computer-use-2024-10-22',
    policy: 'hard_denied',
    reason: 'Risk Class D — legacy beta token. Mantido por compatibilidade histórica.',
    source_doc: 'https://docs.claude.com/en/docs/build-with-claude/computer-use',
    pinned_at: '2026-05-06T00:00:00Z',
    legacy: true,
  },
  {
    beta_token: 'managed-agents-2026-04-01',
    policy: 'denied_until_decision',
    reason: 'Anthropic-hosted managed agents (descoberto em validação). Decisão de produto pendente; ESCALATION-A3 → planned PR4-or-later.',
    source_doc: 'https://docs.claude.com/en/release-notes/api',
    pinned_at: '2026-05-06T00:00:00Z',
  },
  {
    beta_token: 'skills-2025-10-02',
    policy: 'denied_until_decision',
    reason: 'Skills carregamento. Fora de escopo PR2-PR4. Decisão pós-PR4.',
    pinned_at: '2026-05-06T00:00:00Z',
  },
]);
```

### 13.1 Forward-compat para versões futuras

Quando a Anthropic anunciar nova versão de tokens conhecidos (ex.: `computer-use-2026-XX-YY`), o token novo:

- por default **não está em `ANTHROPIC_BETA_POLICY`** → cai em `unknown_beta_token` → 403 com `reason: 'unknown_beta_token'`;
- adição como `hard_denied` exige PR pequeno (lista) sem ADR novo se mantiver semântica;
- promoção a `global_allowlist` sempre exige ADR.

### 13.2 Tokens desconhecidos

`anthropic-beta: <token>` que não está na policy → 403 `passthrough.beta_denied` com `reason: 'unknown_beta_token'`. Audit event obrigatório.

---

## 14. `anthropic.tools_taxonomy`

### 14.1 Versão e definição

```yaml
anthropic.tools_taxonomy:
  schema_version: 2   # bumped em v2.2 B1 por adição de anthropic_typed_unknown
  version_string: "anthropic.tools_taxonomy:schema_version=2:bumped_for_typed_unknown_class"
  
  classes:
    
    client_defined:
      description: "tool sem campo 'type'. Schema arbitrário fornecido pelo cliente. Execução fora do provider."
      detection_rule:
        when: "tool object NÃO possui campo 'type' (ou type é string vazia)"
      pr2_status: supported
      base_risk_class_contribution: B   # tools[] em geral escala C base; cliente-defined permanece em B individual
      enforcement_default_per_tier:
        starter: warn
        business: enforce
        enterprise: enforce
        regulated: enforce
    
    anthropic_defined_client_executed_text_editor:
      description: "tools com type=text_editor_<date> executadas pelo cliente."
      detection_rule:
        when: "tool.type matches '^text_editor_\\d{8}$'"
      pr2_status: supported
      base_risk_class_contribution: C
      enforcement_default_per_tier:
        starter:
          enforcement_mode: warn
        business:
          enforcement_mode: warn
        enterprise:
          enforcement_mode: warn
          side_effects:
            - audit_detail_level: high
            - dlp_pre_scan_required: true
        regulated:
          enforcement_mode: ask
          preconditions:
            - tenant_capability_acceptance_required: true
              max_effective_risk_class_allowed_for_acceptance: C
    
    anthropic_defined_client_executed_bash:
      description: "tools com type=bash_<date> executadas pelo cliente (laptop do usuário em Cenário A)."
      detection_rule:
        when: "tool.type matches '^bash_\\d{8}$'"
      pr2_status: supported
      base_risk_class_contribution: D
      enforcement_default_per_tier:
        starter:
          enforcement_mode: ask
        business:
          enforcement_mode: ask
        enterprise:
          enforcement_mode: ask
          preconditions:
            - tenant_capability_acceptance_required: true
              max_effective_risk_class_allowed_for_acceptance: D
        regulated:
          enforcement_mode: ask
          preconditions:
            - tenant_capability_acceptance_required: true
              max_effective_risk_class_allowed_for_acceptance: D
            - approval_workflow_required: true
      notes:
        - "regulated: blocked NÃO é default arquitetural. Tenant policy pode bloquear via override, mas a base não capa Claude Code."
    
    anthropic_provider_hosted_web_search:
      detection_rule:
        when: "tool.type matches '^web_search_\\d{8}$'"
      pr2_status: supported
      capability_id: anthropic.web_search_tool
      base_risk_class_contribution: C
      enforcement_default_per_tier:
        starter: warn
        business: warn
        enterprise: enforce
        regulated: enforce + tenant_capability_acceptance
    
    anthropic_provider_hosted_code_execution:
      detection_rule:
        when: "tool.type matches '^code_execution_\\d{8}$'"
      pr2_status: blocked_at_validation
      target_pr: PR4
      capability_id: anthropic.code_execution_tool
    
    anthropic_provider_hosted_computer_use:
      detection_rule:
        when: "tool.type matches '^computer_\\d{8}$'"
      pr2_status: blocked_at_validation
      target_pr: PR8+
      capability_id: anthropic.computer_use_tool
      rejection_response:
        status: 403
        error: "tool_blocked_until_governance_primitive"
    
    anthropic_typed_unknown:
      description: |
        tool com 'type' presente que não corresponde a nenhuma classe acima.
        Inclui server tools futuras (web_fetch, tool_search, image_generation, etc.)
        e qualquer tipo emitido pelo provider que ainda não foi explicitamente classificado.
      detection_rule:
        when: |
          tool object possui campo 'type' E
          'type' NÃO bate com nenhum padrão das classes anteriores.
      pr2_status: blocked_at_validation
      capability_id: n/a
      rejection_response:
        status: 403
        error: "tool_type_unknown"
        reason: |
          Tool type '{{type}}' is not classified in the GovAI taxonomy.
          Unknown typed tools are blocked by default to prevent accidental forwarding of
          provider-hosted tools without explicit governance policy.
      notes:
        - "Princípio: type presente sem classificação NUNCA cai em client_defined."
        - "Quando a Anthropic introduzir novo tipo, GovAI adiciona classe explícita por PR + ADR e bumpa schema_version."
```

### 14.2 Detection algorithm canônico

```typescript
// provider-anthropic/src/passthrough/tool-classifier.ts

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
  tool: { type?: string; [k: string]: unknown },
): AnthropicToolClassification {
  if (typeof tool.type !== 'string' || tool.type.length === 0) {
    return 'client_defined';
  }
  for (const { pattern, classification } of KNOWN_TYPED_PATTERNS) {
    if (pattern.test(tool.type)) {
      return classification;
    }
  }
  return 'anthropic_typed_unknown';
}

export const KNOWN_ANTHROPIC_TAXONOMY_VERSION =
  'anthropic.tools_taxonomy:schema_version=2:bumped_for_typed_unknown_class';
```

### 14.3 Tests herméticos obrigatórios (Batch A)

`tests/integration/anthropic/tool-classifier.test.ts`:

- tool sem `type` → `client_defined`;
- `type: 'text_editor_20241029'` → `anthropic_defined_client_executed_text_editor`;
- `type: 'bash_20241022'` → `anthropic_defined_client_executed_bash`;
- `type: 'web_search_20260209'` → `anthropic_provider_hosted_web_search`;
- `type: 'code_execution_20250522'` → blocked;
- `type: 'computer_20241022'` → blocked;
- `type: 'computer_20251124'` → blocked (forward-compat com versão futura);
- `type: 'web_fetch_20260101'` → `anthropic_typed_unknown` → blocked;
- `type: 'tool_search_20260101'` → `anthropic_typed_unknown` → blocked;
- `type: 'image_generation_20260301'` (hipotético) → `anthropic_typed_unknown` → blocked;
- `type: ''` (string vazia) → tratado como ausente → `client_defined`;
- `type: 'text_editor'` (sem data) → `anthropic_typed_unknown` (regex exige `_\d{8}`).

---

## 15. Escalations A1–A4 e decisões fixadas

| ID | Item | Decisão fixada |
|---|---|---|
| **A1** | Files API beta header | **Aprovado opção (A):** `files-api-2025-04-14` em `ANTHROPIC_BETA_POLICY` com `policy: 'global_allowlist'`, `adr: 'ADR-014'`. ADR-014 a ser criado em Peça A v2. |
| **A2** | Message Batches beta status | **Aprovado opção (B):** Batch D permanece stretch / `planned_phase: PR4`. Header `message-batches-2024-09-24` em `verification_required`. Resolução em Peça A v2: se Batch D promovido em PR2, vira `global_allowlist` por ADR-016; se não, vira `denied_until_decision` ou `removed_as_no_longer_needed`. |
| **A3** | Claude Managed Agents | **Aprovado planned PR4-or-later:** `anthropic.managed_agents` permanece `planned`, sem promover automaticamente para PR2/PR3. Reavaliação após Native Provider Substrate estabilizado. Header `managed-agents-2026-04-01` em `denied_until_decision`. |
| **A4** | Múltiplos beta headers Messages | **Aprovado abordagem conservadora:** apenas `files-api-2025-04-14` em `global_allowlist`. Prompt caching em `verification_required` (resolução provável: `removed_as_no_longer_needed`). Computer-use 3 versões em `hard_denied`. Demais em `denied_until_decision`. |

ADRs planejados (a serem criados em Peça A v2):

- **ADR-014:** Allow `files-api-2025-04-14` em `ANTHROPIC_BETA_POLICY` como `global_allowlist`. **Obrigatório.**
- **ADR-015 (cancelado por default):** Prompt caching allowlist. Não gerado se verificação confirmar que `cache_control` nativo é suficiente. Se confirmado nativo, registro em `ANTHROPIC_BETA_POLICY` muda para `removed_as_no_longer_needed`.
- **ADR-016 (condicional):** Allow `message-batches-2024-09-24` em `global_allowlist` se Batch D promovido em PR2.

---

## 16. Live test plan Anthropic

| capability | live test | duração estimada | custo estimado (USD) |
|---|---|---|---|
| `anthropic.messages.create` | 5 chamadas com tools, vision, streaming=false | <30s | <$0.50 |
| `anthropic.messages.stream` | 3 chamadas streaming com tools, abort no meio de uma | <60s | <$0.50 |
| `anthropic.messages_meta` | 3 chamadas count_tokens | <10s | $0 |
| `anthropic.models` | 1 list + 2 retrieve | <5s | $0 |
| `anthropic.files` | upload PDF 1MB, list, get-meta, get-content, delete (com beta header files-api-2025-04-14) | <30s | $0 |
| `anthropic.web_search_tool` | 2 chamadas com tool web_search_<current_date> | <30s | <$0.50 |
| **total Anthropic** | suite completa | <~3min | <~$1.50 |

Live test secrets: variável `ANTHROPIC_LIVE_TEST_KEY` em ambiente CI dedicado. Resultado popula `last_live_test_at` no registry.

Falha do live test não bloqueia o batch hermético; bloqueia apenas a promoção da capability para `supported`.

---

(continua na Parte III — OpenAI)


# Parte III — OpenAI

## 17. Universo OpenAI — visão consolidada

| capability_id | status PR2 | level | base_risk_class | tier_availability | beta? |
|---|---|---|---|---|---|
| `openai.responses.create` | supported | policy_governed | A (escala C com tools, B/C com PII) | starter, business, enterprise, regulated | nenhum |
| `openai.responses.stream` | supported | policy_governed | A (escala C com tools, B/C com PII) | starter, business, enterprise, regulated | nenhum |
| `openai.chat.completions.create` | supported | policy_governed | A (escala C com tools, B/C com PII) | starter, business, enterprise, regulated | nenhum |
| `openai.chat.completions.stream` | supported | policy_governed | A (escala C com tools, B/C com PII) | starter, business, enterprise, regulated | nenhum |
| `openai.models` | supported (apenas GET) | passthrough_audited | A | starter, business, enterprise, regulated | nenhum |
| `openai.models.delete` | supported | passthrough_audited | C (escala D com modelo em uso) | starter, business, enterprise, regulated | nenhum |
| `openai.embeddings` | supported | passthrough_audited | B (escala C com PII forte) | starter, business, enterprise, regulated | nenhum |
| `openai.files` | supported | passthrough_audited | B (escala C com PII) | starter, business, enterprise, regulated | nenhum |
| `openai.vector_stores` | supported | passthrough_audited | B (escala C com PII) | starter, business, enterprise, regulated | nenhum |
| `openai.vector_stores.delete` | supported | passthrough_audited | C | business, enterprise, regulated | nenhum |
| `openai.vector_stores.files.delete` | supported | passthrough_audited | C | business, enterprise, regulated | nenhum |
| `openai.web_search_tool` | supported | passthrough_audited | C | starter, business, enterprise, regulated | nenhum |
| `openai.file_search_tool` | supported | passthrough_audited | B | starter, business, enterprise, regulated | nenhum |
| `openai.batches` | planned (PR2 stretch / PR4) | passthrough_audited (target) | A (escala conforme body) | starter, business, enterprise, regulated | nenhum |
| `openai.moderations` | planned (PR3) | governed_run (target) | A | starter, business, enterprise, regulated | nenhum |
| `openai.uploads` | planned (PR3-PR4) | passthrough_audited (target) | B | starter, business, enterprise, regulated | nenhum |
| `openai.conversations` | planned (PR3) | passthrough_audited (target) | A→B com PII em estado | starter, business, enterprise, regulated | nenhum |
| `openai.tool_search_tool` | planned (PR4) | passthrough_audited (target) | B | starter, business, enterprise, regulated | nenhum |
| `openai.code_interpreter_tool` | planned (PR4) | passthrough_audited (target) | C | enterprise, regulated com aceite | nenhum |
| `openai.hosted_shell_tool` | planned (PR4-PR5) | passthrough_audited (target) | D | enterprise, regulated com aceite (starter/business via tier policy) | nenhum |
| `openai.apply_patch_tool` | planned (PR4) | passthrough_audited (target) | C | starter, business, enterprise, regulated | nenhum |
| `openai.mcp_tool` | planned (PR7+) | passthrough_audited (target) | D | enterprise, regulated com aceite | nenhum |
| `openai.skills` | planned (PR4) | passthrough_audited (target) | B | enterprise, regulated com aceite | nenhum |
| `openai.fine_tuning` | planned (PR6-or-later) | evidence_grade (target) | C (escala D com PII) | enterprise, regulated com aceite | nenhum |
| `openai.audio.transcriptions` | planned (PR6) | passthrough_audited (target) | B | starter, business, enterprise, regulated | nenhum |
| `openai.audio.translations` | planned (PR6) | passthrough_audited (target) | B | starter, business, enterprise, regulated | nenhum |
| `openai.audio.speech` | planned (PR6) | passthrough_audited (target) | A | starter, business, enterprise, regulated | nenhum |
| `openai.images` | planned (PR6) | passthrough_audited (target) | A→B | starter, business, enterprise, regulated | nenhum |
| `openai.realtime` (GA) | planned (PR6) | passthrough_audited (target) | C | enterprise, regulated com aceite | nenhum |
| `openai.videos` (Sora/post-Sora) | planned (TBD) | TBD | B→C | TBD | nenhum |
| `openai.computer_use_preview_tool` | blocked (PR8+) | n/a | D | (none) | n/a |
| `openai.assistants.*` | not_exposed (provider_deprecated) | n/a | n/a | n/a | n/a |
| `openai.threads.*` | not_exposed (provider_deprecated) | n/a | n/a | n/a | n/a |
| `openai.realtime_beta.*` | not_exposed (provider_sunset) | n/a | n/a | n/a | n/a |
| `openai.completions_legacy` | not_exposed (legacy) | n/a | n/a | n/a | n/a |

**Resumo numérico OpenAI em PR2:**

- 11 capabilities `supported` cobrindo 18 endpoints obrigatórios (Responses + Chat Completions + Models GET/DELETE + Embeddings + Files + Vector Stores) + 2 sub-capabilities destrutivas (`vector_stores.delete`, `vector_stores.files.delete`);
- 2 capabilities tool `supported` (`web_search_tool`, `file_search_tool`);
- 1 stretch (`openai.batches`);
- 14 capabilities `planned` para PR3+ (incluindo todas as built-in tools modernas exceto computer_use_preview e mcp);
- 1 capability `blocked` (apenas `computer_use_preview_tool` por architectural prerequisite);
- 4 capabilities `not_exposed` (3 provider-deprecated/sunset + 1 legacy completions).

---

## 18. Capabilities `supported` em PR2 (OpenAI)

### 18.1 `openai.responses.create` (method-level, deep policy_governed)

```yaml
id: openai.responses.create
provider: openai
status: supported
level: policy_governed
base_risk_class: A
risk_escalation:
  - reason: tools_present_in_request
    base_to_effective: A → C
    contribution_classifier: |
      Subclasses (taxonomia §23) podem aumentar:
      - function: C
      - openai_provider_hosted_web_search: C
      - openai_provider_hosted_file_search: C (supported PR2)
      - openai_provider_hosted_tool_search: C (planned PR4)
      - openai_provider_hosted_code_interpreter: BLOCKED in PR2 (planned PR4)
      - openai_provider_hosted_computer_use: BLOCKED in PR2 (blocked PR8+)
      - openai_provider_hosted_hosted_shell: BLOCKED in PR2 (planned PR4-PR5)
      - openai_provider_hosted_apply_patch: BLOCKED in PR2 (planned PR4)
      - openai_provider_hosted_mcp: BLOCKED in PR2 (planned PR7+)
      - openai_typed_unknown: BLOCKED in PR2
  
  - reason: file_payload_exceeding_threshold
    base_to_effective: A → C
    threshold: "presença de file reference no body"
  
  - reason: dlp_pii_detected
    base_to_effective: A → B (PII fraca) ou A → C (PII forte)
  
  - reason: vision_image_with_pii_potential
    base_to_effective: A → B
  
  - reason: stateful_conversation_chained
    base_to_effective: A → B
    classifier: |
      Quando 'previous_response_id' está presente, o estado anterior é puxado do storage OpenAI.

tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:    enforce
  business:   enforce
  enterprise: enforce
  regulated:  enforce

endpoint_coverage:
  - method: POST
    path:   /v1/responses
    streams: false      # quando body.stream !== true
    multipart: false

beta_dependencies: []

facets:
  - name: tools
    via_param: tools[] (ver taxonomia §23)
    status: supported (preservação byte-a-byte é gate de merge)
  - name: tool_calls
    via_response: output items com type=tool_call
    status: supported
  - name: structured_outputs
    via_param: text.format ou json_schema
    status: supported
  - name: previous_response_id
    via_param: previous_response_id
    status: supported
  - name: store
    via_param: store: true|false
    status: supported (cliente decide; GovAI registra escolha em audit)
  - name: vision
    via_param: input items com image content
    status: supported
  - name: prompt_caching
    via_param: prompt_cache_key (parâmetro nativo, sem header beta)
    status: supported

test_evidence:
  hermetic_suite: tests/integration/openai/responses/create.test.ts
  live_smoke: tests/live/openai/responses-create-live.test.ts
```

### 18.2 `openai.responses.stream`

Espelha §18.1 com `streams: true` em endpoint_coverage. SSE chunks com items typed (`response.output_item.added`, `response.output_text.delta`, `response.output_item.done`, `response.completed`, `response.error`) preservados em ordem e byte-idênticos.

```yaml
id: openai.responses.stream
endpoint_coverage:
  - method: POST
    path:   /v1/responses
    streams: true
    multipart: false
test_evidence:
  hermetic_suite: tests/integration/openai/responses/stream.test.ts
  live_smoke: tests/live/openai/responses-stream-live.test.ts
```

### 18.3 `openai.chat.completions.create`

```yaml
id: openai.chat.completions.create
provider: openai
status: supported
level: policy_governed
base_risk_class: A
risk_escalation:
  - reason: tools_present_in_request
    base_to_effective: A → C
    classifier: |
      Em Chat Completions, tools[] tem shape { type: "function", function: {...} }.
      Apenas type='function' é reconhecido. Provider-hosted tools modernas
      (web_search, file_search, computer_use, etc.) NÃO funcionam em Chat Completions.
  - reason: file_payload_exceeding_threshold
    base_to_effective: A → C
  - reason: dlp_pii_detected
    base_to_effective: A → B|C
  - reason: vision_image_with_pii_potential
    base_to_effective: A → B
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter: enforce
  business: enforce
  enterprise: enforce
  regulated: enforce
endpoint_coverage:
  - method: POST
    path:   /v1/chat/completions
    streams: false
    multipart: false
beta_dependencies: []
facets:
  - name: tools_function_calling
    via_param: tools[] com type=function
    status: supported
  - name: structured_outputs
    via_param: response_format
    status: supported
  - name: vision
    status: supported
  - name: prompt_caching
    via_param: prompt_cache_key
    status: supported
notes:
  - "Mantida em PR2 para compatibilidade com clientes em Chat Completions e SDKs legados."
  - "Recomendação OpenAI: Responses API é primária."
  - "Provider-hosted tools modernas NÃO disponíveis em Chat Completions; tool taxonomy bloqueia type desconhecido."
test_evidence:
  hermetic_suite: tests/integration/openai/chat/completions-create.test.ts
  live_smoke: tests/live/openai/chat-completions-create-live.test.ts
```

### 18.4 `openai.chat.completions.stream`

Espelha §18.3 com `streams: true`. Casos adicionais de SSE Chat Completions chunks (`choices[0].delta`, etc.).

### 18.5 `openai.models` (apenas GET — Risk A)

```yaml
id: openai.models
provider: openai
status: supported
level: passthrough_audited
base_risk_class: A
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter: enforce
  business: enforce
  enterprise: enforce
  regulated: enforce
endpoint_coverage:
  - method: GET
    path:   /v1/models
    streams: false
    multipart: false
  - method: GET
    path:   /v1/models/{model_id}
    streams: false
    multipart: false
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/openai/models.test.ts
  live_smoke: tests/live/openai/models-live.test.ts
notes:
  - "DELETE /v1/models/{model_id} é capability separada (openai.models.delete) por ser destrutiva (Risk C)."
```

### 18.6 `openai.models.delete` (capability separada — Risk C destrutivo)

```yaml
id: openai.models.delete
provider: openai
status: supported
level: passthrough_audited
base_risk_class: C
risk_escalation:
  - reason: model_in_active_use_by_other_run
    base_to_effective: C → D
    classifier: |
      Se o modelo a ser deletado está sendo referenciado por run/conversation ativos,
      escalar para D (operação pode interromper produção).
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:    ask
  business:   ask
  enterprise: ask + audit_detail_level: high
  regulated:  ask + tenant_capability_acceptance + approval_workflow_required
endpoint_coverage:
  - method: DELETE
    path:   /v1/models/{model_id}
    streams: false
    multipart: false
    notes: "Apenas para fine-tuned models do tenant. OpenAI rejeita DELETE de modelos base."
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/openai/models-delete.test.ts
  live_smoke: tests/live/openai/models-delete-live.test.ts (skipped se não houver fine-tuned model disponível)
fallback_declarable_for_pr3_plus:
  - reverse_lookup_active_runs: PR3
  - approval_workflow_full_ui: PR4
```

### 18.7 `openai.embeddings`

```yaml
id: openai.embeddings
provider: openai
status: supported
level: passthrough_audited
base_risk_class: B
risk_escalation:
  - reason: dlp_pii_detected
    base_to_effective: B → C
  - reason: input_array_size_large
    base_to_effective: B → C
    notes: "batch grande (>1000 items) amplifica risco de exposição em logs"
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:
    base_b_no_dlp_hit:           warn
    effective_c_dlp_pii_low:     warn
    effective_c_dlp_pii_strong:  enforce
  business:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce
  enterprise:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce + audit_detail_level: high
  regulated:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce + tenant_capability_acceptance
dlp_phases:
  - phase: pre_request
    required: true
    target: input field do request body
    action_on_finding: depende de tier
  - phase: pre_response_content
    required: false
    target_pr: n/a   # output é vetor; sem PII textual
payload_storage_pr2:
  request_body: hash_only_plus_metadata   # input não persistido em audit_event_payloads em PR2
  response_body: hash_only                # vetores grandes; persiste hash + metadata
  rationale: |
    Embeddings podem ter inputs com PII. Crypto-shred E2E só sai em PR3.
    Em PR2, persistir apenas hash + metadata preserva auditoria sem violação LGPD.
endpoint_coverage:
  - method: POST
    path:   /v1/embeddings
    streams: false
    multipart: false
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/openai/embeddings.test.ts
  live_smoke: tests/live/openai/embeddings-live.test.ts
fallback_declarable_for_pr3_plus:
  - chunked_input_dlp_for_arrays_above_1000_items: PR3
  - vector_storage_evidence_for_audit_review: PR3
```

### 18.8 `openai.files`

```yaml
id: openai.files
provider: openai
status: supported
level: passthrough_audited
base_risk_class: B
risk_escalation:
  - reason: dlp_pii_detected_in_upload
    base_to_effective: B → C
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:
    base_b_no_dlp_hit:           warn
    effective_c_dlp_pii_low:     ask
    effective_c_dlp_pii_strong:  enforce
    file_size_exceeds_50mb:      ask
  business:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce
  enterprise:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce + audit_detail_level: high
  regulated:
    base_b_no_dlp_hit:           enforce + tenant_capability_acceptance
    effective_c_dlp_pii_any:     enforce + tenant_capability_acceptance + approval_workflow_required
dlp_phases:
  - phase: file_upload
    required: true
    action_on_finding: depende de tier
  - phase: pre_response_content
    required: false
    target_pr: PR3
endpoint_coverage:
  - method: POST
    path:   /v1/files
    streams: false
    multipart: true
    notes: |
      Upload via multipart/form-data. Field 'file' contém o binário.
      Field 'purpose' obrigatório (assistants, fine-tune, batch, vision, etc.).
      purpose='assistants' tratado conforme política de deprecação (§18.8.1 abaixo).
  - method: GET
    path:   /v1/files
    streams: false
    multipart: false
  - method: GET
    path:   /v1/files/{file_id}
    streams: false
    multipart: false
  - method: DELETE
    path:   /v1/files/{file_id}
    streams: false
    multipart: false
  - method: GET
    path:   /v1/files/{file_id}/content
    streams: true
    multipart: false
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/openai/files.test.ts
  live_smoke: tests/live/openai/files-roundtrip-live.test.ts
fallback_declarable_for_pr3_plus:
  - hashing_chunked_multipart: PR3
  - evidence_strength_uploads_acima_de_50mb: PR3
  - output_dlp_conteudo_openai_files: PR3
```

#### 18.8.1 `purpose=assistants` — política de deprecação

OpenAI Assistants API tem sunset em **2026-08-26**. Política em PR2:

**Antes do sunset (até 2026-08-26 inclusive):**

- request com `purpose=assistants` é forwardado normalmente para OpenAI;
- response 2xx volta com header adicional injetado pelo GovAI:
  ```
  x-govai-deprecation-warning: assistants_sunset=2026-08-26; migrate_to=responses_api+conversations_api; doc=<govai-docs>/openai/assistants-deprecation
  ```
- audit event `passthrough.invoked` registra `purpose_deprecated: true`;
- `enforcement_decision` normal conforme tier.

**Após o sunset (a partir de 2026-08-27):**

- comportamento default: `enforcement_decision: 'blocked'`;
- response 403 com `error: 'purpose_deprecated_post_sunset'`, `reason: 'OpenAI Assistants API was removed on 2026-08-26'`;
- override por arquiteto humano explícito (via PR + ADR) pode mudar default;
- bypass via `org_beta_overrides` **NÃO** é permitido — `org_beta_overrides` cobre apenas headers, não body params.

Implementação:

```typescript
// provider-openai/src/passthrough/files-purpose-validator.ts
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

### 18.9 `openai.vector_stores` (operações não-destrutivas)

> **Ajuste obrigatório aplicado** (consolidação): operações destrutivas separadas em sub-capabilities (§18.10 e §18.11) para evitar mistura com Risk B em operações de leitura/criação.

```yaml
id: openai.vector_stores
provider: openai
status: supported
level: passthrough_audited
base_risk_class: B   # conteúdo do tenant; pode conter PII
risk_escalation:
  - reason: dlp_pii_detected_in_file_addition
    base_to_effective: B → C
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:
    base_b_no_dlp_hit:           warn
    effective_c_dlp_pii_strong:  enforce
  business:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce
  enterprise:
    base_b_no_dlp_hit:           enforce
    effective_c_dlp_pii_any:     enforce + audit_detail_level: high
  regulated:
    base_b_no_dlp_hit:           enforce + tenant_capability_acceptance
    effective_c_dlp_pii_any:     enforce + tenant_capability_acceptance + approval_workflow_required
dlp_phases:
  - phase: file_addition_to_vector_store
    required: true
    target: file content sendo associado ao vector store
    action_on_finding: depende de tier
  - phase: pre_response_content
    required: false
    target_pr: PR3   # output DLP em search results
endpoint_coverage:
  # apenas operações NÃO-destrutivas
  - method: POST
    path:   /v1/vector_stores
    streams: false
    multipart: false
    notes: "Cria vector store. JSON request."
  - method: GET
    path:   /v1/vector_stores
    streams: false
    multipart: false
  - method: GET
    path:   /v1/vector_stores/{vector_store_id}
    streams: false
    multipart: false
  - method: POST
    path:   /v1/vector_stores/{vector_store_id}/files
    streams: false
    multipart: false
    notes: "Adiciona file_id já existente ao vector store. DLP pre-scan obrigatório."
  - method: GET
    path:   /v1/vector_stores/{vector_store_id}/files
    streams: false
    multipart: false
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/openai/vector-stores.test.ts
  live_smoke: tests/live/openai/vector-stores-live.test.ts
fallback_declarable_for_pr3_plus:
  - output_dlp_search_results: PR3
  - evidence_strength_vector_content: PR3
notes:
  - "Backing para file_search_tool (§18.13)."
  - "Lifecycle de vector store é ortogonal ao lifecycle de file (em /v1/files)."
  - "Operações DELETE ficam em sub-capabilities §18.10 e §18.11 por classificação de risco diferenciada."
```

### 18.10 `openai.vector_stores.delete` (sub-capability destrutiva)

```yaml
id: openai.vector_stores.delete
provider: openai
status: supported
level: passthrough_audited
base_risk_class: C
risk_escalation:
  - reason: vector_store_in_active_use_by_run
    base_to_effective: C → D
    classifier: |
      Se vector_store tem reference em run/conversation ativos, escalar para D
      (delete pode interromper produção).
tier_availability: [business, enterprise, regulated]   # starter NÃO tem acesso a destrutivo de vector store
enforcement_default:
  business:   ask
  enterprise: ask + audit_detail_level: high
  regulated:  ask + tenant_capability_acceptance + approval_workflow_required
endpoint_coverage:
  - method: DELETE
    path:   /v1/vector_stores/{vector_store_id}
    streams: false
    multipart: false
    notes: "Destrutivo. Deleta o vector store inteiro com todos os files associados."
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/openai/vector-stores-delete.test.ts
  live_smoke: tests/live/openai/vector-stores-delete-live.test.ts
fallback_declarable_for_pr3_plus:
  - reverse_lookup_active_runs: PR3
  - approval_workflow_full_ui: PR4
```

### 18.11 `openai.vector_stores.files.delete` (sub-capability destrutiva)

```yaml
id: openai.vector_stores.files.delete
provider: openai
status: supported
level: passthrough_audited
base_risk_class: C
risk_escalation:
  - reason: file_referenced_by_active_run
    base_to_effective: C → D
tier_availability: [business, enterprise, regulated]
enforcement_default:
  business:   ask
  enterprise: ask + audit_detail_level: high
  regulated:  ask + tenant_capability_acceptance + approval_workflow_required
endpoint_coverage:
  - method: DELETE
    path:   /v1/vector_stores/{vector_store_id}/files/{file_id}
    streams: false
    multipart: false
    notes: "Remove arquivo específico do vector store (não deleta o file em /v1/files)."
beta_dependencies: []
test_evidence:
  hermetic_suite: tests/integration/openai/vector-stores-files-delete.test.ts
```

### 18.12 `openai.web_search_tool`

```yaml
id: openai.web_search_tool
provider: openai
status: supported
level: passthrough_audited
base_risk_class: C   # output untrusted da web
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:    warn
  business:   warn
  enterprise: enforce
  regulated:  enforce + tenant_capability_acceptance
endpoint_coverage:
  flow_only:
    appears_in:
      - tools[] do request body de /v1/responses (com type='web_search' ou 'web_search_preview')
      - output items do response/stream com web_search results
beta_dependencies: []
detection_via_taxonomy:
  classification: openai_provider_hosted_web_search
  type_pattern: '^(web_search|web_search_preview)$'
test_evidence:
  hermetic_suite: tests/integration/openai/tools-web-search.test.ts
  live_smoke: tests/live/openai/web-search-live.test.ts
notes:
  - "web_search é tool da Responses API. Não disponível em Chat Completions."
  - "Output treated as untrusted — output DLP recomendado para PR3+."
```

### 18.13 `openai.file_search_tool`

```yaml
id: openai.file_search_tool
provider: openai
status: supported
level: passthrough_audited
base_risk_class: B
risk_escalation:
  - reason: dlp_pii_in_search_results
    base_to_effective: B → C
    notes: "PR2 emite warn-only se PII forte detectada em search result; output DLP completo em PR3+"
tier_availability: [starter, business, enterprise, regulated]
enforcement_default:
  starter:    warn
  business:   warn
  enterprise: enforce
  regulated:  enforce + tenant_capability_acceptance
endpoint_coverage:
  flow_only:
    appears_in:
      - tools[] do request body de /v1/responses (com type='file_search')
      - output items do response/stream com tool_call e file_search results
beta_dependencies: []
detection_via_taxonomy:
  classification: openai_provider_hosted_file_search
  type_pattern: '^file_search$'
test_evidence:
  hermetic_suite: tests/integration/openai/tools-file-search.test.ts
  live_smoke: tests/live/openai/file-search-live.test.ts
notes:
  - "Tool da Responses API que pesquisa em vector_stores do tenant (§18.9)."
  - "Output são chunks de documentos do tenant — possíveis PII."
fallback_declarable_for_pr3_plus:
  - output_dlp_search_results_full: PR3
  - vector_content_evidence_strength_elevation: PR3
```

---

## 19. Capabilities `planned` (OpenAI)

Detalhe abreviado por brevidade — cada uma com `planned_phase` honesto e `verification_needed_in_peca_a` quando aplicável.

### 19.1 `openai.batches`

```yaml
id: openai.batches
status: planned
planned_phase: PR2_stretch_or_PR4
target_level: passthrough_audited
target_base_risk_class: A (escala C com tools/PII em batch inputs)
target_tier_availability: [starter, business, enterprise, regulated]
target_endpoint_coverage:
  - POST /v1/batches (create)
  - GET /v1/batches/{batch_id} (retrieve)
  - GET /v1/batches (list)
  - POST /v1/batches/{batch_id}/cancel
notes:
  - "Suporta múltiplos endpoints (/v1/responses, /v1/chat/completions, /v1/embeddings, /v1/moderations) via JSONL."
  - "Resultado em /v1/files/{output_file_id} após processamento."
beta_dependencies: []
verification_needed_in_peca_a:
  - confirmar lista atual de endpoints suportados pela Batches API
```

### 19.2 `openai.moderations`

```yaml
id: openai.moderations
status: planned
planned_phase: PR3
target_level: governed_run
target_base_risk_class: A
target_tier_availability: [starter, business, enterprise, regulated]
target_endpoint_coverage:
  - POST /v1/moderations
notes:
  - "API de classificação de conteúdo da OpenAI."
  - "Pode ser usada pelo GovAI internamente como sinal de DLP/policy em pipelines Governed Run."
beta_dependencies: []
```

### 19.3 `openai.uploads`

```yaml
id: openai.uploads
status: planned
planned_phase: PR3-PR4
target_level: passthrough_audited
target_base_risk_class: B
target_endpoint_coverage:
  - POST /v1/uploads (create)
  - POST /v1/uploads/{upload_id}/parts (add part)
  - POST /v1/uploads/{upload_id}/complete
  - POST /v1/uploads/{upload_id}/cancel
notes:
  - "Para arquivos > 25MB. Multipart em chunks."
  - "Distinto de /v1/files (single-shot)."
  - "Implementação requer hashing de chunks."
beta_dependencies: []
```

### 19.4 `openai.conversations`

```yaml
id: openai.conversations
status: planned
planned_phase: PR3
target_level: passthrough_audited
target_base_risk_class: A→B com PII em estado
target_endpoint_coverage:
  - POST /v1/conversations
  - GET /v1/conversations/{conversation_id}
  - DELETE /v1/conversations/{conversation_id}
  - POST /v1/conversations/{conversation_id}/items
notes:
  - "API stateful para persistir conversas Responses no compute OpenAI."
  - "Risco: dados de tenant em storage OpenAI."
  - "Tier regulated pode exigir tenant_capability_acceptance específico para data residency."
beta_dependencies: []
```

### 19.5 `openai.tool_search_tool`

```yaml
id: openai.tool_search_tool
status: planned
planned_phase: PR4
target_level: passthrough_audited
target_base_risk_class: B
detection_via_taxonomy:
  classification: openai_provider_hosted_tool_search
  type_pattern: '^tool_search$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_pending_capability_promotion"
    reason: "Capability openai.tool_search_tool is planned for PR4."
notes:
  - "Tool nova introduzida com GPT-5.5 — busca catálogo de tools."
  - "Suportada em Responses com modelos GPT-5.5+, GPT-5.4 mini."
verification_needed_in_peca_a:
  - confirmar shape exato e GA status
```

### 19.6 `openai.code_interpreter_tool`

```yaml
id: openai.code_interpreter_tool
status: planned
planned_phase: PR4
target_level: passthrough_audited
target_base_risk_class: C   # provider-hosted sandbox; output pode incluir arquivos
target_tier_availability: [enterprise, regulated com aceite]
target_enforcement_default:
  starter:    ask
  business:   ask
  enterprise: ask + tenant_capability_acceptance
  regulated:  ask + tenant_capability_acceptance + approval_workflow_required
detection_via_taxonomy:
  classification: openai_provider_hosted_code_interpreter
  type_pattern: '^code_interpreter$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_pending_capability_promotion"
    reason: "Capability openai.code_interpreter_tool is planned for PR4 with provider-hosted sandbox dependency and tenant acceptance."
notes:
  - "Sandbox é provider-hosted (OpenAI). GovAI não precisa primitive próprio."
  - "Bloqueio em PR2 é por timing/política, não por arquitetura ausente."
```

### 19.7 `openai.hosted_shell_tool`

> **Nota canônica (consolidação):** `starter: blocked` em PR4-PR5 quando promovido **é default de tier policy comercial**, não limitação técnica/protocolar. Business/Enterprise/Regulated têm caminho explícito de habilitação via ask/acceptance/approval. A primitive de sandbox é provider-hosted (OpenAI) — GovAI não exige sandbox próprio para esta capability.

```yaml
id: openai.hosted_shell_tool
status: planned
planned_phase: PR4-PR5
target_level: passthrough_audited
target_base_risk_class: D   # shell em compute provider-hosted
target_tier_availability: [enterprise, regulated com aceite]
target_enforcement_default:
  starter:
    enforcement_mode: blocked
    rationale: "tier policy commercial default; not a technical/protocol limitation; provider-hosted sandbox available but governance/cost policy denies in starter tier"
  business:
    enforcement_mode: ask
    preconditions:
      - tenant_capability_acceptance_required: true
        max_effective_risk_class_allowed_for_acceptance: D
  enterprise:
    enforcement_mode: ask
    preconditions:
      - tenant_capability_acceptance_required: true
        max_effective_risk_class_allowed_for_acceptance: D
      - approval_workflow_required: true
  regulated:
    enforcement_mode: ask
    preconditions:
      - tenant_capability_acceptance_required: true
        max_effective_risk_class_allowed_for_acceptance: D
      - approval_workflow_required: true
      - dlp_audit_detailed: true
detection_via_taxonomy:
  classification: openai_provider_hosted_hosted_shell
  type_pattern: '^(hosted_shell|shell)$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_pending_capability_promotion"
    reason: "Capability openai.hosted_shell_tool is planned for PR4-PR5. The provider hosts the execution sandbox; the dependency is governance/risk policy (tenant acceptance + approval workflow), not GovAI sandbox primitive."
verification_needed_in_peca_a:
  - confirmar nome canônico (hosted_shell vs shell); regex casa ambos defensivamente
notes:
  - "Shell executado em sandbox provider-hosted (não em compute GovAI)."
  - "starter blocked = tier policy default, não limitação arquitetural."
```

### 19.8 `openai.apply_patch_tool`

```yaml
id: openai.apply_patch_tool
status: planned
planned_phase: PR4
target_level: passthrough_audited
target_base_risk_class: C
target_tier_availability: [starter, business, enterprise, regulated]
target_enforcement_default:
  starter:    ask
  business:   ask
  enterprise: ask + audit_detail_level: high
  regulated:  ask + tenant_capability_acceptance
detection_via_taxonomy:
  classification: openai_provider_hosted_apply_patch
  type_pattern: '^apply_patch$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_pending_capability_promotion"
    reason: "Capability openai.apply_patch_tool is planned for PR4 with ask/approval workflow."
notes:
  - "Tool de patch de código em GPT-5.5+."
  - "Análoga a anthropic_defined_client_executed_text_editor mas provider-hosted."
```

### 19.9 `openai.mcp_tool`

```yaml
id: openai.mcp_tool
status: planned
planned_phase: PR7+
target_level: passthrough_audited
target_base_risk_class: D
target_tier_availability: [enterprise, regulated com aceite]
detection_via_taxonomy:
  classification: openai_provider_hosted_mcp
  type_pattern: '^mcp$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_pending_capability_promotion"
    reason: "Capability openai.mcp_tool requires GovAI MCP control plane (planned PR7+ as Agent Runtime Connector — Addendum §11)."
notes:
  - "Tool da Responses API que conecta a remote MCP servers."
  - "Risk D: arbitrary remote code execution potencial."
  - "GovAI integra como Agent Runtime Connector com control plane próprio."
```

### 19.10 `openai.skills`

> **Resource, não tool type.** Skills é criada via `/v1/skills` e usada dentro do hosted shell via `tools[].environment.skills`, não como tool autônomo.

```yaml
id: openai.skills
provider: openai
status: planned
planned_phase: PR4
target_level: passthrough_audited
target_base_risk_class: B
target_tier_availability: [enterprise, regulated com aceite]
target_enforcement_default:
  starter:    blocked   # skill não disponível em starter por dependência de hosted_shell
  business:   ask
  enterprise: ask + audit_detail_level: high
  regulated:  ask + tenant_capability_acceptance
target_endpoint_coverage:
  - POST /v1/skills (verification_needed: confirm method, multipart vs JSON)
  - GET /v1/skills
  - GET /v1/skills/{skill_id}
  - DELETE /v1/skills/{skill_id}
relationship:
  used_by: openai.hosted_shell_tool
  via: tools[].environment.skills (mounted into hosted shell session)
beta_dependencies: []
verification_needed_in_peca_a:
  - confirmar exact endpoints (method, path, multipart vs JSON)
  - confirmar shape do field environment.skills em hosted shell tool
  - confirmar se há tool type='skills' autônomo OU se skills só aparece como sub-config de shell
notes:
  - "Skills NÃO é tool type autônomo até validação contrária."
  - "GovAI trata como resource CRUD com endpoints próprios."
  - "Conexão a hosted_shell_tool é via tools[].environment.skills."
```

### 19.11 `openai.fine_tuning`

```yaml
id: openai.fine_tuning
provider: openai
status: planned
planned_phase: PR6-or-later
target_level: evidence_grade   # candidato: training data merece evidence layer mais forte
target_base_risk_class: C
target_risk_escalation:
  - reason: training_data_with_pii
    base_to_effective: C → D
    notes: "training data com PII pode internalizar PII no modelo fine-tuned"
target_tier_availability: [enterprise, regulated com aceite]
target_enforcement_default:
  starter:    blocked   # fine-tuning não disponível em starter
  business:   ask + tenant_capability_acceptance
  enterprise: ask + tenant_capability_acceptance + approval_workflow_required
  regulated:  ask + tenant_capability_acceptance + approval_workflow_required + dlp_audit
required_preconditions:
  - training_data_evidence_policy: |
      Política específica de evidence chain para training data.
      Define: (a) hash de cada training file usado, (b) evidence trail por
      job de fine-tuning, (c) audit de inferência usando modelo fine-tuned
      até reverter para training set conforme retention policy.
  - tenant_capability_acceptance: obrigatório
target_endpoint_coverage:
  - POST /v1/fine_tuning/jobs
  - GET  /v1/fine_tuning/jobs
  - GET  /v1/fine_tuning/jobs/{job_id}
  - POST /v1/fine_tuning/jobs/{job_id}/cancel
  - GET  /v1/fine_tuning/jobs/{job_id}/events
  - GET  /v1/fine_tuning/jobs/{job_id}/checkpoints
  - DELETE /v1/fine_tuning/checkpoints/{fine_tuned_model_checkpoint}/permissions/{permission_id}
beta_dependencies: []
notes:
  - "Training data é um dos ativos mais sensíveis de tenant."
  - "Compromisso arquitetural: evidence_grade — não apenas passthrough_audited."
  - "Diferenciação de mercado: poucos AI gateways oferecem evidence layer dedicado para training data."
positioning_implication:
  - "Materializa o claim 'Native-first AI trust surface with cryptographic evidence for regulated environments' do Addendum §12."
verification_needed_in_peca_a_or_later:
  - definir schema completo de TrainingDataEvidencePolicy
  - mapear endpoints completos
  - decidir se fine_tuning entra como PR6 dedicado ou track paralelo
```

### 19.12 `openai.audio.*`

Três capabilities separadas, todas `planned PR6`:

- `openai.audio.transcriptions` — Risk B (áudio pode conter PII falada); endpoint `POST /v1/audio/transcriptions`; multipart upload.
- `openai.audio.translations` — Risk B; endpoint `POST /v1/audio/translations`; multipart upload.
- `openai.audio.speech` — Risk A (síntese a partir de texto); endpoint `POST /v1/audio/speech`; output: audio binário stream.

DLP pre-scan no resultado de transcriptions é PR6+ por complexidade.

### 19.13 `openai.images`

```yaml
id: openai.images
status: planned
planned_phase: PR6
target_level: passthrough_audited
target_base_risk_class: A   # geração; escala B se input image contém PII
target_endpoint_coverage:
  - POST /v1/images/generations
  - POST /v1/images/edits   # multipart com image input
  - POST /v1/images/variations  # multipart com image input
beta_dependencies: []
notes:
  - "DALL·E model snapshots deprecados em 12-mai-2026."
  - "GPT Image 2 é o modelo atual."
```

### 19.14 `openai.realtime`

```yaml
id: openai.realtime
status: planned
planned_phase: PR6
target_level: passthrough_audited
target_base_risk_class: C
target_tier_availability: [enterprise, regulated com aceite]
target_endpoint_coverage:
  - POST /v1/realtime/calls (WebRTC SDP exchange)
  - WebSocket /v1/realtime
notes:
  - "Realtime GA — distinto de Realtime Beta (deprecada, sunset 07-mai-2026)."
  - "Audio bidirecional em tempo real. Risk C porque PII falada."
  - "Implementação WebSocket no passthrough é desafio próprio."
beta_dependencies: []
```

### 19.15 `openai.videos`

```yaml
id: openai.videos
status: planned
planned_phase: TBD
target_endpoint_coverage:
  - POST /v1/videos (Batches-only endpoint atualmente)
notes:
  - "Sora 2 model aliases deprecados em 24-set-2026."
  - "Aguardar estabilização da família para promover."
beta_dependencies: []
```

---

## 20. Capabilities `blocked` (OpenAI)

### 20.1 `openai.computer_use_preview_tool`

> **Wording neutralizado (consolidação):** Risk D não é apenas "GovAI sandbox absent"; computer use exige primitive completa de governança que pode ou não envolver sandbox GovAI próprio (parte da execução pode ser provider-hosted).

```yaml
id: openai.computer_use_preview_tool
provider: openai
status: blocked
blocked_reason: |
  Risk Class D. Computer Use requires a dedicated computer-use governance primitive:
  sandbox/environment policy, tenant risk acceptance, approval workflow,
  action logging, egress controls, and incident evidence.
  Not enableable via beta/feature override.
target_unblock_phase: PR8+
detection_via_taxonomy:
  classification: openai_provider_hosted_computer_use
  type_pattern: '^computer_use_preview$'
runtime_behavior_pr2:
  tool_classifier_decision: blocked_at_validation
  rejection_response:
    status: 403
    error: "tool_blocked_until_governance_primitive"
    reason: "computer_use_preview is Risk Class D and requires dedicated computer-use governance primitive. Hard_denied until PR8+."
notes:
  - "Análogo a anthropic.computer_use_tool — mesmo tratamento arquitetural."
  - "Escolha de status='blocked' (não 'planned') porque o desbloqueio depende de primitive não previsto antes de PR8+."
```

---

## 21. Capabilities `not_exposed` (OpenAI)

### 21.1 `openai.assistants.*` (provider_deprecated)

```yaml
id: openai.assistants.*
status: not_exposed
not_exposed_reason: provider_deprecated
provider_sunset_date: 2026-08-26
endpoints_universe:
  - POST /v1/assistants, GET /v1/assistants, GET /v1/assistants/{id}
  - POST /v1/assistants/{id}, DELETE /v1/assistants/{id}
  - similares para /v1/assistants/{id}/files etc.
notes:
  - "OpenAI anunciou em 26-ago-2025 a deprecação com sunset em 26-ago-2026."
  - "Migration target: Responses API + Conversations API."
  - "Cliente recebe 403 capability_not_registered com migration_url para Responses."
  - "OpenAI-Beta header 'assistants=v2' é hard_denied (§22)."
```

### 21.2 `openai.threads.*` (provider_deprecated)

```yaml
id: openai.threads.*
status: not_exposed
not_exposed_reason: provider_deprecated
provider_sunset_date: 2026-08-26
notes:
  - "Threads são parte da Assistants API; mesma deprecação."
  - "Migration target: Conversations API."
```

### 21.3 `openai.realtime_beta.*` (provider_sunset)

```yaml
id: openai.realtime_beta.*
status: not_exposed
not_exposed_reason: provider_sunset
provider_sunset_date: 2026-05-07
notes:
  - "Realtime Beta API sunset em 07-mai-2026."
  - "Realtime GA continua disponível como capability planned (§19.14)."
  - "OpenAI-Beta header 'realtime=v1' é hard_denied."
```

### 21.4 `openai.completions_legacy`

```yaml
id: openai.completions_legacy
status: not_exposed
not_exposed_reason: legacy_completions
endpoints:
  - POST /v1/completions
notes:
  - "Endpoint /v1/completions (não chat) é considerado legacy."
  - "Modelos GPT-3.5-turbo-instruct, babbage-002, davinci-002."
  - "GovAI não suporta. Cliente recebe 403 com remediation para chat.completions ou responses."
```

---

## 22. `OPENAI_BETA_POLICY`

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

OpenAI usa `OpenAI-Beta` header em poucos casos modernos; a maioria das features é parâmetro nativo no body. Allowlist global vazia em PR2 não cria fricção significativa para clientes OpenAI modernos.

Tokens desconhecidos → 403 `passthrough.beta_denied` com `reason: 'unknown_beta_token'`.

---

## 23. `openai.tools_taxonomy`

### 23.1 Versão e definição

```yaml
openai.tools_taxonomy:
  schema_version: 2   # bumped pela remoção de openai_provider_hosted_skills (skills é resource, não tool)
  version_string: "openai.tools_taxonomy:schema_version=2:bumped_for_skills_resource_split"
  
  classes:
    
    function_chat_completions:
      detection_rule:
        api: chat_completions
        when: "tool.type === 'function'"
      pr2_status: supported
      base_risk_class_contribution: C
      enforcement_default_per_tier:
        starter: warn
        business: enforce
        enterprise: enforce
        regulated: enforce
    
    function_responses:
      detection_rule:
        api: responses
        when: "tool.type === 'function'"
      pr2_status: supported
      base_risk_class_contribution: C
      enforcement_default_per_tier: same as function_chat_completions
    
    openai_provider_hosted_web_search:
      detection_rule:
        api: responses
        when: "tool.type ∈ {'web_search', 'web_search_preview'}"
      pr2_status: supported
      capability_id: openai.web_search_tool
      base_risk_class_contribution: C
      enforcement_default_per_tier:
        starter: warn
        business: warn
        enterprise: enforce
        regulated: enforce + tenant_capability_acceptance
    
    openai_provider_hosted_file_search:
      detection_rule:
        api: responses
        when: "tool.type === 'file_search'"
      pr2_status: supported
      capability_id: openai.file_search_tool
      base_risk_class_contribution: B
      enforcement_default_per_tier:
        starter: warn
        business: warn
        enterprise: enforce
        regulated: enforce + tenant_capability_acceptance
    
    openai_provider_hosted_tool_search:
      detection_rule:
        api: responses
        when: "tool.type === 'tool_search'"
      pr2_status: blocked_at_validation
      target_pr: PR4
      capability_id: openai.tool_search_tool
    
    openai_provider_hosted_code_interpreter:
      detection_rule:
        api: responses
        when: "tool.type === 'code_interpreter'"
      pr2_status: blocked_at_validation
      target_pr: PR4
      capability_id: openai.code_interpreter_tool
    
    openai_provider_hosted_computer_use:
      detection_rule:
        api: responses
        when: "tool.type === 'computer_use_preview'"
      pr2_status: blocked_at_validation
      target_pr: PR8+
      capability_id: openai.computer_use_preview_tool
    
    openai_provider_hosted_hosted_shell:
      detection_rule:
        api: responses
        when: "tool.type ∈ {'hosted_shell', 'shell'}"
      pr2_status: blocked_at_validation
      target_pr: PR4-PR5
      capability_id: openai.hosted_shell_tool
    
    openai_provider_hosted_apply_patch:
      detection_rule:
        api: responses
        when: "tool.type === 'apply_patch'"
      pr2_status: blocked_at_validation
      target_pr: PR4
      capability_id: openai.apply_patch_tool
    
    openai_provider_hosted_mcp:
      detection_rule:
        api: responses
        when: "tool.type === 'mcp'"
      pr2_status: blocked_at_validation
      target_pr: PR7+
      capability_id: openai.mcp_tool
    
    openai_typed_unknown:
      description: |
        tool com 'type' presente que não corresponde a nenhuma classe acima.
        Inclui types desconhecidos pela taxonomia atual (futuras built-in tools OpenAI).
      detection_rule:
        when: "tool.type presente AND tool.type não bate com nenhum padrão conhecido"
      pr2_status: blocked_at_validation
      rejection_response:
        status: 403
        error: "tool_type_unknown"
        reason: |
          Tool type '{{type}}' is not classified in GovAI's OpenAI taxonomy.
          Unknown typed tools are blocked by default; future OpenAI built-in tools
          require explicit classification.
```

### 23.2 Detection algorithm canônico

```typescript
// provider-openai/src/passthrough/tool-classifier.ts

export type OpenAIApiContext = 'chat_completions' | 'responses';

export type OpenAIToolClassification =
  | 'function_chat_completions'
  | 'function_responses'
  | 'openai_provider_hosted_web_search'
  | 'openai_provider_hosted_file_search'
  | 'openai_provider_hosted_tool_search'
  | 'openai_provider_hosted_code_interpreter'
  | 'openai_provider_hosted_computer_use'
  | 'openai_provider_hosted_hosted_shell'
  | 'openai_provider_hosted_apply_patch'
  | 'openai_provider_hosted_mcp'
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
  tool: { type?: string; [k: string]: unknown },
): OpenAIToolClassification {
  const type = typeof tool.type === 'string' ? tool.type : '';
  
  if (type === '') {
    return 'openai_typed_unknown';   // tool sem type não é válido em OpenAI shapes modernos
  }
  
  if (type === 'function') {
    return api === 'responses' ? 'function_responses' : 'function_chat_completions';
  }
  
  if (api === 'chat_completions') {
    return 'openai_typed_unknown';   // Chat Completions só aceita function
  }
  
  for (const { pattern, classification } of KNOWN_OPENAI_TOOL_PATTERNS) {
    if (pattern.test(type)) {
      return classification;
    }
  }
  
  return 'openai_typed_unknown';
}

export const KNOWN_OPENAI_TAXONOMY_VERSION =
  'openai.tools_taxonomy:schema_version=2:bumped_for_skills_resource_split';
```

### 23.3 Tests herméticos obrigatórios (Batch C)

- Chat Completions com `tool.type='function'` → `function_chat_completions`, allowed;
- Chat Completions com `tool.type='web_search'` → `openai_typed_unknown`, blocked (não em Chat Completions);
- Responses com `tool.type='function'` → `function_responses`, allowed;
- Responses com `tool.type='web_search'` → `openai_provider_hosted_web_search`, allowed;
- Responses com `tool.type='web_search_preview'` → `openai_provider_hosted_web_search`, allowed;
- Responses com `tool.type='file_search'` → `openai_provider_hosted_file_search`, allowed (Risk B);
- Responses com `tool.type='code_interpreter'` → blocked;
- Responses com `tool.type='computer_use_preview'` → blocked;
- Responses com `tool.type='hosted_shell'` → blocked;
- Responses com `tool.type='shell'` → blocked (alias);
- Responses com `tool.type='mcp'` → blocked;
- Responses com `tool.type='apply_patch'` → blocked;
- Responses com `tool.type='database_query'` (hipotético) → `openai_typed_unknown`, blocked;
- Responses com `tool.type=''` → `openai_typed_unknown`, blocked;
- Responses com tool sem campo `type` → `openai_typed_unknown`, blocked;
- Chat Completions com tool sem `type` → `openai_typed_unknown`, blocked.

---

## 24. Escalations O1–O6 e decisões fixadas

| ID | Item | Decisão fixada |
|---|---|---|
| **O1** | `purpose=assistants` em Files | **Aprovado: warning + sunset cutoff.** Antes de 2026-08-26: forward + warning header + audit `purpose_deprecated: true`. Após 2026-08-27: blocked default com remediation. Implementação em §18.8.1. |
| **O2** | `hosted_shell` vs `shell` regex | **Aprovado: regex casa ambos defensivamente.** Peça A v2 valida canonical e remove alias se confirmado. Suspeita: canonical é `shell`. |
| **O3** | Conversations API timeline | **Aprovado: manter `planned PR3`.** Conversations stateful tem implicações de data residency que merecem PR dedicado. Em PR2, cliente que precisa de stateful pode usar `previous_response_id` em Responses (facet supported). |
| **O4** | Realtime GA WebSocket | **Aprovado: manter `planned PR6`.** WebSocket no passthrough é desafio técnico próprio. |
| **O5** | `/v1/videos` pós-Sora | **Aprovado: manter `planned TBD`.** Revisar pós-set/2026 quando estabilização ocorrer. |
| **O6** | Fine-tuning strategy | **Decidido: `planned PR6-or-later`, `target_level: evidence_grade`,** com `required_preconditions: training_data_evidence_policy + tenant_capability_acceptance`. Diferenciador estratégico. Detalhe em §19.11. |

---

## 25. Live test plan OpenAI

| capability | live test | duração estimada | custo estimado (USD) |
|---|---|---|---|
| `openai.responses.create` | 5 chamadas com tools, vision, structured outputs, streaming=false | <30s | <$0.50 |
| `openai.responses.stream` | 3 chamadas streaming; abort no meio | <60s | <$0.50 |
| `openai.chat.completions.create` | 3 chamadas com tool=function, structured outputs | <20s | <$0.30 |
| `openai.chat.completions.stream` | 3 chamadas streaming | <30s | <$0.30 |
| `openai.models` | 1 list + 2 retrieve | <5s | $0 |
| `openai.models.delete` | tentar delete em modelo fine-tuned (skipped se não disponível) | <10s | $0 |
| `openai.embeddings` | 5 chamadas com inputs variados | <15s | <$0.10 |
| `openai.files` | upload PDF 1MB, list, get-meta, get-content, delete | <30s | $0 |
| `openai.vector_stores` | criar store, adicionar file, list files, get | <30s | $0 |
| `openai.vector_stores.delete` | delete file from store + delete store | <15s | $0 |
| `openai.web_search_tool` | 2 chamadas Responses com tool web_search | <30s | <$0.50 |
| `openai.file_search_tool` | 1 chamada Responses com tool file_search apontando para vector store de teste | <30s | <$0.50 |
| **total OpenAI** | suite completa | <~5min | <~$2.70 |

Combinado com Anthropic (§16): suite live total <~8min, <~$4.20 por execução. Aceitável.

---

(continua na Parte IV — Consolidação operacional)


# Parte IV — Consolidação operacional

## 26. Provider Coverage Matrix consolidada (tabela única)

Tabela única integrando Anthropic + OpenAI com classificação canônica.

### 26.1 Capabilities `supported` em PR2 (com endpoint próprio)

| capability_id | provider | level | base_risk | tier_availability | endpoints | beta? |
|---|---|---|---|---|---|---|
| `anthropic.messages.create` | A | policy_governed | A→C | starter+ | POST /v1/messages | nenhum |
| `anthropic.messages.stream` | A | policy_governed | A→C | starter+ | POST /v1/messages (stream) | nenhum |
| `anthropic.messages_meta` | A | passthrough_audited | A | starter+ | POST /v1/messages/count_tokens | nenhum |
| `anthropic.models` | A | passthrough_audited | A | starter+ | GET /v1/models, GET /v1/models/{id} | nenhum |
| `anthropic.files` | A | passthrough_audited | B→C | starter+ | POST/GET/DELETE /v1/files (5 endpoints) | files-api-2025-04-14 (global) |
| `openai.responses.create` | O | policy_governed | A→C | starter+ | POST /v1/responses | nenhum |
| `openai.responses.stream` | O | policy_governed | A→C | starter+ | POST /v1/responses (stream) | nenhum |
| `openai.chat.completions.create` | O | policy_governed | A→C | starter+ | POST /v1/chat/completions | nenhum |
| `openai.chat.completions.stream` | O | policy_governed | A→C | starter+ | POST /v1/chat/completions (stream) | nenhum |
| `openai.models` | O | passthrough_audited | A | starter+ | GET /v1/models, GET /v1/models/{id} | nenhum |
| `openai.models.delete` | O | passthrough_audited | C→D | starter+ | DELETE /v1/models/{id} | nenhum |
| `openai.embeddings` | O | passthrough_audited | B→C | starter+ | POST /v1/embeddings | nenhum |
| `openai.files` | O | passthrough_audited | B→C | starter+ | POST/GET/DELETE /v1/files (5 endpoints) | nenhum |
| `openai.vector_stores` | O | passthrough_audited | B→C | starter+ | POST/GET /v1/vector_stores + files (5 endpoints) | nenhum |
| `openai.vector_stores.delete` | O | passthrough_audited | C→D | business+ | DELETE /v1/vector_stores/{id} | nenhum |
| `openai.vector_stores.files.delete` | O | passthrough_audited | C→D | business+ | DELETE /v1/vector_stores/{id}/files/{file_id} | nenhum |

**Total `supported` com endpoints: 16 capabilities cobrindo 28 endpoints.**

### 26.2 Capabilities `supported` em PR2 (tools — via classifier, sem endpoint próprio)

| capability_id | provider | level | base_risk | tier_availability | classifier rule |
|---|---|---|---|---|---|
| `anthropic.web_search_tool` | A | passthrough_audited | C | starter+ | tool.type matches `^web_search_\d{8}$` |
| `openai.web_search_tool` | O | passthrough_audited | C | starter+ | tool.type ∈ `{web_search, web_search_preview}` |
| `openai.file_search_tool` | O | passthrough_audited | B | starter+ | tool.type === `file_search` |

**Total `supported` tools: 3 capabilities.**

### 26.3 Capabilities `planned` em PR2 (com `planned_phase`)

| capability_id | provider | planned_phase | target_level | target_risk | observação |
|---|---|---|---|---|---|
| `anthropic.message_batches` | A | PR2_stretch / PR4 | passthrough_audited | A→C | Batch D stretch |
| `anthropic.code_execution_tool` | A | PR4 | passthrough_audited | C | provider-hosted sandbox |
| `anthropic.managed_agents` | A | PR4-or-later | passthrough_audited | C | Anthropic-hosted agents |
| `anthropic.skills` | A | TBD | n/a | n/a | pós-PR4 |
| `claude_agent.*` | A | PR7+ | varia | varia | Cenário B server-side |
| `openai.batches` | O | PR2_stretch / PR4 | passthrough_audited | A→C | Batch D stretch |
| `openai.moderations` | O | PR3 | governed_run | A | uso interno DLP/policy |
| `openai.uploads` | O | PR3-PR4 | passthrough_audited | B | multipart > 25MB |
| `openai.conversations` | O | PR3 | passthrough_audited | A→B | stateful Responses |
| `openai.tool_search_tool` | O | PR4 | passthrough_audited | B | tool catalog search |
| `openai.code_interpreter_tool` | O | PR4 | passthrough_audited | C | provider-hosted sandbox |
| `openai.hosted_shell_tool` | O | PR4-PR5 | passthrough_audited | D | provider-hosted; starter blocked = tier policy |
| `openai.apply_patch_tool` | O | PR4 | passthrough_audited | C | code patch tool |
| `openai.mcp_tool` | O | PR7+ | passthrough_audited | D | requires MCP control plane |
| `openai.skills` | O | PR4 | passthrough_audited | B | resource (não tool type) |
| `openai.fine_tuning` | O | PR6-or-later | evidence_grade | C→D | candidato evidence_grade |
| `openai.audio.transcriptions` | O | PR6 | passthrough_audited | B | multipart audio in |
| `openai.audio.translations` | O | PR6 | passthrough_audited | B | multipart audio in |
| `openai.audio.speech` | O | PR6 | passthrough_audited | A | text-to-speech |
| `openai.images` | O | PR6 | passthrough_audited | A→B | generations/edits/variations |
| `openai.realtime` | O | PR6 | passthrough_audited | C | WebSocket GA |
| `openai.videos` | O | TBD | TBD | B→C | post-Sora deprecation |

**Total `planned`: 22 capabilities.**

### 26.4 Capabilities `blocked` em PR2 (architectural prerequisite)

| capability_id | provider | blocked_reason | target_unblock_phase |
|---|---|---|---|
| `anthropic.computer_use_tool` | A | Risk D; requires dedicated computer-use governance primitive | PR8+ |
| `openai.computer_use_preview_tool` | O | Risk D; requires dedicated computer-use governance primitive | PR8+ |

**Total `blocked`: 2 capabilities.**

### 26.5 Capabilities `not_exposed`

| capability_id | provider | not_exposed_reason | provider_sunset_date |
|---|---|---|---|
| `anthropic.admin.*` | A | out_of_product_scope | n/a |
| `openai.assistants.*` | O | provider_deprecated | 2026-08-26 |
| `openai.threads.*` | O | provider_deprecated | 2026-08-26 |
| `openai.realtime_beta.*` | O | provider_sunset | 2026-05-07 |
| `openai.completions_legacy` | O | legacy_completions | n/a |

**Total `not_exposed`: 5 capabilities/famílias.**

---

## 27. Escopo numérico total em PR2

| dimensão | total |
|---|---|
| capabilities `supported` em PR2 (com endpoint próprio) | 16 |
| capabilities tool `supported` em PR2 (via classifier) | 3 |
| **total `supported` em PR2** | **19** |
| endpoints obrigatórios funcionais em PR2 | 28 |
| capabilities `planned` (PR3+) | 22 |
| capabilities `blocked` (architectural prerequisite) | 2 |
| capabilities/famílias `not_exposed` | 5 |
| **total registry universe Anthropic + OpenAI** | **48** |
| **batches stretch (Batch D)** | 2 (`anthropic.message_batches` + `openai.batches`) |

---

## 28. Pre-merge gates obrigatórios

Antes do merge do PR2, todos os pre-merge gates abaixo devem passar.

### 28.1 Gate de schema

```
test: tests/integration/schema/capability-schema-v4.2.test.ts
behavior:
  - CapabilityStatus enum tem exatamente 4 valores: 'not_exposed', 'planned', 'supported', 'blocked'
  - Capability schema tem campos: level, base_risk_class, tier_availability, enforcement_default
  - EnforcementMode enum tem 6 valores canônicos
  - 'family_alias' status NÃO existe no enum em PR2
```

### 28.2 Gate de BetaTokenPolicy

```
test: tests/integration/governance/beta-policy-no-verification-pending.test.ts
behavior:
  ANTHROPIC_BETA_POLICY.every(e => e.policy !== 'verification_required') === true
  OPENAI_BETA_POLICY.every(e => e.policy !== 'verification_required') === true
```

### 28.3 Gate de tool taxonomy

```
test: tests/integration/anthropic/tool-classifier.test.ts
behavior:
  todos os 12 casos da §14.3 passam
  classifier nunca retorna 'client_defined' para tool com type presente

test: tests/integration/openai/tool-classifier.test.ts
behavior:
  todos os 16 casos da §23.3 passam
  classifier nunca retorna function_* para tool sem type='function'
```

### 28.4 Gate de Provider Coverage Matrix consistency

```
test: tests/integration/governance/registry-matrix-consistency.test.ts
behavior:
  toda capability em registry está na Provider Coverage Matrix consolidada
  toda capability na Matrix está no registry
  status, level, base_risk_class consistentes entre ambos
  capabilities supported têm last_live_test_at populado
```

### 28.5 Gate de unknown endpoint

```
test: tests/integration/governance/unknown-endpoint.test.ts
behavior:
  request a endpoint fora da allowlist passthrough → 403 capability_not_registered
  audit event obrigatório
  resposta tem reason, remediation_url, discovery_mode_path, audit_event_id
```

### 28.6 Gate de baseURL compatibility

```
test: tests/integration/anthropic/sdk-baseurl.test.ts
behavior:
  new Anthropic({ baseURL: '<govai>/passthrough/anthropic', apiKey: 'govai_token_dev' })
    .messages.create({...}) funciona

test: tests/integration/openai/sdk-baseurl.test.ts
behavior:
  new OpenAI({ baseURL: '<govai>/passthrough/openai/v1', apiKey: 'govai_token_dev' })
    .responses.create({...}) funciona
  paths nunca têm duplicação /v1/v1/...
```

### 28.7 Gate de PassthroughInvokedSchema

```
test: tests/integration/audit/passthrough-invoked-schema.test.ts
behavior:
  schema_version 3 é aceito
  superRefine rules todas pegam erros esperados:
    - is_stream sem stream_final_hash → erro
    - non-stream 2xx sem native_response_hash → erro
    - blocked sem body_forward_mode=blocked → erro
    - passthrough_audited 2xx com body_forward_mode=redacted → erro
    - passthrough_audited com body_forward_mode≠raw (não-blocked) → erro
    - detected_tool_classifications.length>0 sem tools_taxonomy_version → erro
```

### 28.8 Gate de live tests (opt-in)

```
test: tests/live/* (atrás de GOVAI_LIVE_TESTS=1)
behavior:
  cada capability supported que requer live test tem last_live_test_at populado pelo PR2
  Anthropic: 6 capabilities supported com live tests
  OpenAI: 11 capabilities supported com live tests
```

### 28.9 Gate de não-refatoração futura

```
test: tests/integration/governance/no-temporary-routes.test.ts
behavior:
  nenhuma rota /passthrough/* retorna 503 'pipeline_incomplete'
  nenhum endpoint do Macro Native Substrate retorna 501
  capabilities essenciais (§26.1) não são marcadas 'planned' silenciosamente
```

---

## 29. Critério de aceitação consolidado

Esta Provider Coverage Matrix v2 consolidada é aceita como insumo para Peça A v2 se:

- [ ] Modelo `capability_id ≠ endpoint` (§2) está claro e o modelo híbrido (method-level + area-level) está justificado;
- [ ] Schemas TypeScript (§3) cobrem `Capability`, `EndpointCoverage`, `BetaDependency`, `EnforcementResolution`;
- [ ] `BetaTokenPolicy` enum (§4) tem 6 valores; constraint de `org_beta_overrides` impede override para `hard_denied`;
- [ ] `org_beta_overrides` (§5) com `id uuid` PK, índice único parcial sobre `WHERE revoked_at IS NULL`, sem `expires_at` no índice parcial, RLS habilitada, `provider IN ('anthropic', 'openai')`;
- [ ] `PassthroughInvokedSchema` (§6.1) versão 3 com `capability_level`, `body_forward_mode`, `dlp_decisions[]`, `beta_allowlist_sources[]`, `detected_tool_classifications[]`, `tools_taxonomy_version`, `purpose_deprecated`, e todas as 5 regras `superRefine`;
- [ ] `tool_validation.blocked` (§6.3) com `tools_taxonomy_version` obrigatório;
- [ ] Forward-compat (§7) preservado como contrato conceitual; tabela `capability_decomposition_map` NÃO criada em PR2;
- [ ] Anthropic: 6 capabilities `supported` com endpoint próprio + 1 capability tool supported; tool taxonomy v2 com `anthropic_typed_unknown`; `ANTHROPIC_BETA_POLICY` com 9 entradas (incluindo 3 versões hard_denied de computer-use);
- [ ] OpenAI: 10 capabilities `supported` com endpoint próprio (incluindo 2 sub-DELETEs de vector_stores) + 2 capabilities tool supported; tool taxonomy v2 com `openai_typed_unknown`; `OPENAI_BETA_POLICY` com 2 entradas hard_denied (assistants=v2, realtime=v1);
- [ ] Decisões A1-A4 (Anthropic §15) e O1-O6 (OpenAI §24) explícitas;
- [ ] Macro Native Substrate Contract (Addendum §6) integralmente coberto: nenhum endpoint da §26.1 retorna 503/501; fallback declarável estritamente delimitado;
- [ ] Live test plan total (§16 + §25): <~8min, <~$4.20 por execução;
- [ ] Pre-merge gates (§28) implementáveis como tests integration; nenhum `verification_required` em runtime production após merge;
- [ ] Wording de `computer_use_*` (Anthropic §11.1, OpenAI §20.1) usa "dedicated computer-use governance primitive", não "GovAI sandbox";
- [ ] `openai.hosted_shell_tool` starter:blocked está documentado como tier policy commercial, não limitação técnica (§19.7);
- [ ] `openai.skills` é resource com endpoint coverage CRUD (§19.10), não tool type;
- [ ] `openai.models` cobre apenas GET; `openai.models.delete` é capability separada com Risk C (§18.5, §18.6);
- [ ] `openai.vector_stores` cobre apenas operações não-destrutivas; DELETE em sub-capabilities `.delete` e `.files.delete` (§18.9, §18.10, §18.11);
- [ ] `openai.fine_tuning` definido como `planned PR6-or-later`, `target_level: evidence_grade`, com required_preconditions (§19.11);
- [ ] `purpose=assistants` em Files com warning + sunset cutoff (§18.8.1);
- [ ] regex `hosted_shell|shell` mantido defensivamente; verificação em Peça A.

---

## 30. Não-objetivos

Esta Matrix consolidada **não**:

- gera Peça A v2 (PR2 Prompt Claude Code);
- gera prompt Claude Code de execução;
- decide unilateralmente sobre escalations não cobertas no §15 / §24;
- introduz capability fora dos universos Anthropic + OpenAI;
- altera ADP v4.2 ou Addendum v4.2.2;
- altera enforcement modes canônicos;
- introduz tabela física nova além de `org_beta_overrides`;
- altera Risk Classes A-E;
- introduz `family_alias` status em PR2;
- compromete prazos para PRs além do roadmap declarado.

---

## 31. Próximo passo

Sequência canônica após aceite desta consolidação:

1. **Auditoria desta consolidação** (você + GPT, opcional).
2. **Geração da Peça A v2** (PR2 Prompt Claude Code) integrando:
   - referência ao Macro Native Substrate Contract (Addendum §6);
   - procedimento de Human Architect Escalation (Addendum §14);
   - batches A/B/C/D/F/G/M com gates numéricos (Addendum §7);
   - todos os pre-merge gates (§28 desta Matrix) implementados como tests integration;
   - resolução de `verification_required` (Anthropic A2, prompt-caching, message-batches) antes do merge;
   - geração de ADRs: ADR-014 (Files beta global allowlist) obrigatório; ADR-015 cancelado por default; ADR-016 condicional;
   - implementação de `org_beta_overrides` com schema canônico §5;
   - implementação de `PassthroughInvokedSchema` schema_version 3 com 5 regras `superRefine`;
   - implementação de tool classifiers Anthropic (§14.2) e OpenAI (§23.2) com taxonomia versionada;
   - decisões fixadas A1-A4 + O1-O6 (§15 + §24).
3. **Auditoria da Peça A v2.**
4. **Execução Claude Code** com pacote canônico:
   - ADP v4.2 (hash `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254`)
   - Addendum v4.2.2 (Macro Native Substrate)
   - Provider Coverage Matrix v2 (este documento)
   - Peça A v2
5. **Codex normal + adversarial** por batch interno ao PR2.
6. **Track Frontend (FE-PR1)** em paralelo conforme v4.2 §5.

---

**Fim da Provider Coverage Matrix v2 — Consolidated.**
