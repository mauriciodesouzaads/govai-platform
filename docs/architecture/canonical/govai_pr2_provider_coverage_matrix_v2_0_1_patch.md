# GovAI PR2 — Provider Coverage Matrix v2.0.1 — Patch sobre Consolidated v2.0

**Versão:** v2.0.1 — patch curto sobre Provider Coverage Matrix v2 Consolidated v2.0
**Data:** 2026-05-06
**Status:** rascunho de auditoria. Aplicado, substitui as seções enumeradas; preserva tudo o que não for explicitamente patchado.

**Documentos referenciados:**

| Documento | Hash | Papel |
|---|---|---|
| ADP v4.2 | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` | canônico |
| Addendum ADP v4.2.2 | (gerado anteriormente) | restringe v4.2; Macro Native Substrate Contract |
| Provider Coverage Matrix v2 Consolidated | `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777` | base patcheada por este v2.0.1 |

---

## Sumário do patch

1. Status e relação com Consolidated v2.0
2. Patch P1 — Starter pode deletar próprio `vector_store` e `vector_store_file` com `ask`
3. Patch P2 — `native_response_hash` obrigatório para qualquer provider response raw non-stream (não apenas 2xx)
4. Patch P3 — `type: ""` (vazio) NÃO é `client_defined`; é `typed_unknown → blocked_at_validation`
5. Critério de aceitação do patch
6. Não-objetivos
7. Próximo passo

---

## 1. Status e relação com Consolidated v2.0

Este patch substitui em Consolidated v2.0:

- §18.10 (`openai.vector_stores.delete`) — `tier_availability` e `enforcement_default` revistos por **P1**;
- §18.11 (`openai.vector_stores.files.delete`) — idem por **P1**;
- §17 e §26 (tabelas de `tier_availability`) — atualizadas para refletir P1;
- §6.1 (`PassthroughInvokedSchema` superRefine) — regra de hash revista por **P2**;
- §14.2 (`classifyAnthropicTool`) — algoritmo revisto por **P3**;
- §14.3 (tests herméticos Anthropic) — caso `type: ''` muda expected output;
- §23.2 (`classifyOpenAITool`) — algoritmo revisto por **P3** (já comportava-se quase corretamente; ajuste de explicitude);
- §23.3 (tests herméticos OpenAI) — sem mudança esperada (já cobria esses casos).

Tudo o que não for tocado nesta v2.0.1 permanece como em Consolidated v2.0. Em caso de conflito interpretativo, prevalece v2.0.1 nas seções enumeradas acima.

---

## 2. Patch P1 — Starter pode deletar próprio `vector_store` e `vector_store_file` com `ask`

**Problema resolvido:** Consolidated v2.0 §18.10 e §18.11 deixavam ambas as sub-capabilities destrutivas com `tier_availability: [business, enterprise, regulated]`, sem Starter. Justificativa anterior era "starter não pode deletar vector store/file". Mas Starter pode criar vector store, adicionar arquivos e usar `file_search` — não conseguir deletar próprios recursos cria fricção e produto capado.

### 2.1 Substituição em §18.10 — `openai.vector_stores.delete`

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
tier_availability: [starter, business, enterprise, regulated]   # P1: starter incluído
enforcement_default:
  starter:    ask                                                # P1: novo
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
notes:
  - "Operação destrutiva sobre recurso próprio do tenant."
  - "Starter recebe ask flow — confirmação explícita do usuário antes de deletar."
  - "Tenant pode bloquear via policy override; mas a base não capa Starter por arquitetura."
```

### 2.2 Substituição em §18.11 — `openai.vector_stores.files.delete`

```yaml
id: openai.vector_stores.files.delete
provider: openai
status: supported
level: passthrough_audited
base_risk_class: C
risk_escalation:
  - reason: file_referenced_by_active_run
    base_to_effective: C → D
tier_availability: [starter, business, enterprise, regulated]   # P1: starter incluído
enforcement_default:
  starter:    ask                                                # P1: novo
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
notes:
  - "Operação destrutiva sobre recurso próprio do tenant."
  - "Starter recebe ask flow — confirmação explícita."
```

### 2.3 Atualização das tabelas §17 e §26

Em §17 (universo OpenAI):

```diff
- | `openai.vector_stores.delete` | supported | passthrough_audited | C | business, enterprise, regulated | nenhum |
+ | `openai.vector_stores.delete` | supported | passthrough_audited | C | starter, business, enterprise, regulated | nenhum |
- | `openai.vector_stores.files.delete` | supported | passthrough_audited | C | business, enterprise, regulated | nenhum |
+ | `openai.vector_stores.files.delete` | supported | passthrough_audited | C | starter, business, enterprise, regulated | nenhum |
```

Em §26.1 (tabela consolidada):

```diff
- | `openai.vector_stores.delete` | O | passthrough_audited | C→D | business+ | DELETE /v1/vector_stores/{id} | nenhum |
+ | `openai.vector_stores.delete` | O | passthrough_audited | C→D | starter+ | DELETE /v1/vector_stores/{id} | nenhum |
- | `openai.vector_stores.files.delete` | O | passthrough_audited | C→D | business+ | DELETE /v1/vector_stores/{id}/files/{file_id} | nenhum |
+ | `openai.vector_stores.files.delete` | O | passthrough_audited | C→D | starter+ | DELETE /v1/vector_stores/{id}/files/{file_id} | nenhum |
```

### 2.4 Tests herméticos atualizados

Adicionar à `tests/integration/openai/vector-stores-delete.test.ts`:

- DELETE em starter tier sem ack → 403 com `error: 'enforcement_ask_unconfirmed'`, `enforcement_decision: 'ask'`;
- DELETE em starter tier com ack → 2xx, audit registra `enforcement_decision: 'ask'`, `tier: 'starter'`;
- DELETE em regulated tier sem `tenant_capability_acceptance` ativo → 403 `tenant_acceptance_required`;
- DELETE em regulated tier com aceite + sem `approval_workflow` resolvido → 403 `approval_pending`.

Mesmo padrão para `vector-stores-files-delete.test.ts`.

---

## 3. Patch P2 — `native_response_hash` obrigatório para qualquer provider response raw non-stream

**Problema resolvido:** Consolidated v2.0 §6.1 (regra 1 do `superRefine`) exigia `native_response_hash` apenas quando `status_code` ∈ [200, 300). Erros nativos do provider (4xx/5xx) repassados raw ao cliente ficavam sem evidência criptográfica do corpo de erro recebido. Isso quebra forense — você preserva o erro nativo, mas não tem hash do que o provider retornou.

### 3.1 Substituição em §6.1 — regra 1 do `superRefine`

Substituir o segundo bloco da Regra 1 por:

```typescript
// Regra 1 (revisada P2):
// stream → stream_final_hash; non-stream com forward raw → native_response_hash (qualquer status)

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
```

### 3.2 Implicação semântica

Combinação canônica:

| `is_stream` | `body_forward_mode` | `enforcement_decision` | `status_code` (típico) | `native_response_hash` | `stream_final_hash` |
|---|---|---|---|---|---|
| false | `raw` | qualquer ≠ blocked | 2xx | obrigatório | n/a |
| false | `raw` | qualquer ≠ blocked | 4xx (provider error) | **obrigatório (P2)** | n/a |
| false | `raw` | qualquer ≠ blocked | 5xx (provider error) | **obrigatório (P2)** | n/a |
| false | `redacted` | (apenas em policy_governed) | 2xx-5xx | obrigatório se response foi recebida | n/a |
| false | `blocked` | `blocked` | 403 (do GovAI) | n/a (nenhuma response do provider) | n/a |
| true | `raw` | qualquer ≠ blocked | qualquer | n/a | obrigatório |
| true | `blocked` | `blocked` | 403 | n/a | n/a |

A regra anterior cobria apenas a primeira linha (2xx non-stream raw). Agora cobre as três primeiras linhas (qualquer non-stream raw).

### 3.3 Implementação no passthrough

O hash do response body é calculado **independentemente do status code**:

```typescript
// provider-{anthropic,openai}/src/passthrough/forward.ts (pseudo)
async function forwardAndHash(req: ForwardRequest): Promise<ForwardResult> {
  const upstreamResponse = await upstream.fetch(req);
  const bodyBuffer = await upstreamResponse.arrayBuffer();
  
  // hash sempre calculado em forward raw, independentemente do status
  const native_response_hash = sha256Hex(bodyBuffer);
  
  // forward bytes para o cliente
  await streamToClient(bodyBuffer);
  
  return {
    status_code: upstreamResponse.status,
    native_response_hash,
    body_forward_mode: 'raw',
    // ...
  };
}
```

### 3.4 Casos preservados (sem mudança)

- `enforcement_decision: 'blocked'` → `body_forward_mode: 'blocked'` → não há response do provider → `native_response_hash` não exigido (a regra 2 do `superRefine` já garante coerência);
- `is_stream: true` → `stream_final_hash` substitui `native_response_hash` (a regra anterior é mantida);
- `policy_governed` com `body_forward_mode: 'redacted'` (futuro) → response foi modificada antes do client; ainda assim `native_response_hash` deve ser registrado se a response do provider foi recebida (mesmo que a versão repassada ao cliente seja diferente). Esse caso é tratado em PR3+ com schema/regra específica.

### 3.5 Tests herméticos obrigatórios atualizados

Em `tests/integration/audit/passthrough-invoked-schema.test.ts`:

- non-stream 2xx raw sem `native_response_hash` → Zod recusa (já existe);
- **non-stream 4xx (provider error) raw sem `native_response_hash` → Zod recusa (NOVO P2);**
- **non-stream 5xx (provider error) raw sem `native_response_hash` → Zod recusa (NOVO P2);**
- non-stream blocked sem `native_response_hash` → Zod aceita (a regra fica neutra para blocked);
- stream com `stream_final_hash` mas sem `native_response_hash` → Zod aceita.

### 3.6 Migration de eventos históricos

Eventos com `schema_version: 1` ou `schema_version: 2` permanecem válidos sob seus schemas históricos (sem regra P2). Apenas eventos novos com `schema_version: 3` aplicam a regra P2.

---

## 4. Patch P3 — `type: ""` (vazio) NÃO é `client_defined`; é `typed_unknown → blocked_at_validation`

**Problema resolvido:** Consolidated v2.0 §14.2 (Anthropic classifier) tratava `tool.type === ''` como ausente, retornando `client_defined`. Isso é input malformado, não tool client-defined legítima. Plataforma de governança não deve tratar input inválido como válido.

OpenAI classifier (§23.2) já comportava-se quase corretamente (string vazia → `openai_typed_unknown`), mas regra de whitespace não estava explícita.

### 4.1 Substituição em §14.2 — `classifyAnthropicTool`

```typescript
// provider-anthropic/src/passthrough/tool-classifier.ts

export function classifyAnthropicTool(
  tool: { type?: string; [k: string]: unknown },
): AnthropicToolClassification {
  // Campo 'type' totalmente ausente (undefined ou null) → tool client-defined legítima
  if (typeof tool.type === 'undefined' || tool.type === null) {
    return 'client_defined';
  }
  
  // Campo presente mas inválido (não-string, vazio, ou só whitespace) → typed_unknown
  if (typeof tool.type !== 'string' || tool.type.trim().length === 0) {
    return 'anthropic_typed_unknown';
  }
  
  // Campo presente e válido → tenta casar com classes conhecidas
  for (const { pattern, classification } of KNOWN_TYPED_PATTERNS) {
    if (pattern.test(tool.type)) {
      return classification;
    }
  }
  
  // String válida mas não-reconhecida → typed_unknown
  return 'anthropic_typed_unknown';
}
```

**Princípio canônico:**

- **ausência total de `type`** (`undefined` / `null` / chave não-presente) → `client_defined`;
- **`type` presente mas malformado** (string vazia, whitespace, não-string) → `anthropic_typed_unknown` → `blocked_at_validation`;
- **`type` presente válido mas desconhecido** → `anthropic_typed_unknown` → `blocked_at_validation`;
- **`type` presente válido e em pattern conhecido** → classificação específica.

### 4.2 Substituição em §23.2 — `classifyOpenAITool`

```typescript
// provider-openai/src/passthrough/tool-classifier.ts

export function classifyOpenAITool(
  api: OpenAIApiContext,
  tool: { type?: string; [k: string]: unknown },
): OpenAIToolClassification {
  // OpenAI tool shapes modernos exigem campo 'type'.
  // Ausência OU malformação (string vazia, whitespace) → typed_unknown.
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
```

**Diferença vs Anthropic:** OpenAI **não tem `client_defined`** como classe — todas as tools OpenAI modernas exigem `type` field, então ausência é input malformado. OpenAI's "function calling" usa `type === 'function'`; ausência de `type` não é uma forma legítima.

### 4.3 Atualização de §14.3 — tests herméticos Anthropic

Substituir os dois últimos casos:

```diff
- `type: ''` (string vazia) → tratado como ausente → `client_defined`;
+ `type: ''` (string vazia) → `anthropic_typed_unknown` (P3) → blocked_at_validation;
+ `type: '   '` (whitespace only) → `anthropic_typed_unknown` (P3) → blocked_at_validation;
+ `type: null` (null explícito) → tratado como ausente → `client_defined`;
+ tool sem campo `type` (chave undefined) → `client_defined`;
- `type: 'text_editor'` (sem data) → `anthropic_typed_unknown` (regex exige `_\d{8}`).
+ `type: 'text_editor'` (sem data) → `anthropic_typed_unknown` (regex exige `_\d{8}`).
```

Lista completa de casos da test suite após P3:

- tool sem campo `type` (chave undefined) → `client_defined`;
- `type: null` (explicit null) → `client_defined`;
- `type: undefined` (explicit undefined) → `client_defined`;
- `type: ''` (string vazia) → `anthropic_typed_unknown` → blocked;
- `type: '   '` (whitespace only) → `anthropic_typed_unknown` → blocked;
- `type: 123` (não-string) → `anthropic_typed_unknown` → blocked;
- `type: 'text_editor_20241029'` → `anthropic_defined_client_executed_text_editor`;
- `type: 'bash_20241022'` → `anthropic_defined_client_executed_bash`;
- `type: 'web_search_20260209'` → `anthropic_provider_hosted_web_search`;
- `type: 'code_execution_20250522'` → blocked;
- `type: 'computer_20241022'` → blocked;
- `type: 'computer_20251124'` → blocked (forward-compat);
- `type: 'web_fetch_20260101'` → `anthropic_typed_unknown` → blocked;
- `type: 'tool_search_20260101'` → `anthropic_typed_unknown` → blocked;
- `type: 'image_generation_20260301'` (hipotético) → `anthropic_typed_unknown` → blocked;
- `type: 'text_editor'` (sem data) → `anthropic_typed_unknown` (regex exige `_\d{8}`).

### 4.4 Atualização de §23.3 — tests herméticos OpenAI

Adicionar casos que tornam a regra explícita:

- Responses com `tool.type=null` → `openai_typed_unknown` → blocked;
- Responses com `tool.type=undefined` (explicit) → `openai_typed_unknown` → blocked;
- Responses com `tool.type='   '` (whitespace) → `openai_typed_unknown` → blocked;
- Responses com `tool.type=123` (não-string) → `openai_typed_unknown` → blocked.

Casos já cobertos em §23.3 da Consolidated v2.0 permanecem.

### 4.5 Implicação no `tool_validation.blocked` event

Quando classifier retorna `anthropic_typed_unknown` ou `openai_typed_unknown` por motivo de `type` malformado (não apenas desconhecido), o audit event registra:

```yaml
tool_validation.blocked:
  blocked_tools:
    - tool_index: 0
      tool_type: ''           # registra exatamente o que foi recebido
      classification: anthropic_typed_unknown
      reason: |
        Tool type field is empty or malformed (received: '').
        Empty/whitespace type is treated as malformed input, not as client_defined.
```

Isso permite forense: distinguir "tool desconhecida porque é nova capability" vs "tool malformada porque cliente enviou input ruim".

### 4.6 Schema_version da taxonomia

P3 não bumpa `schema_version` da taxonomia em si — a lista de classes (`KNOWN_TYPED_PATTERNS`, `KNOWN_OPENAI_TOOL_PATTERNS`) não muda. O que muda é o **algoritmo do classifier** (decisão sobre type vazio/malformado).

Logo:

- `KNOWN_ANTHROPIC_TAXONOMY_VERSION` permanece `'anthropic.tools_taxonomy:schema_version=2:bumped_for_typed_unknown_class'`.
- `KNOWN_OPENAI_TAXONOMY_VERSION` permanece `'openai.tools_taxonomy:schema_version=2:bumped_for_skills_resource_split'`.

P3 é correção de implementação, não evolução semântica da taxonomia.

---

## 5. Critério de aceitação do patch

Esta v2.0.1 é aceita como insumo final para Peça A v2 se, em conjunto com Consolidated v2.0:

- [ ] **P1:** `openai.vector_stores.delete` e `openai.vector_stores.files.delete` ambas com `tier_availability` incluindo `starter`; enforcement em starter é `ask` (não `blocked`); regulated mantém `tenant_capability_acceptance + approval_workflow_required`; tabelas §17 e §26 atualizadas.
- [ ] **P2:** `superRefine` em `PassthroughInvokedSchema` regra 1 revista para exigir `native_response_hash` em qualquer non-stream com `body_forward_mode === 'raw'`, independentemente de status code; tests herméticos cobrem casos 2xx, 4xx, 5xx; eventos com schema_version anterior permanecem válidos.
- [ ] **P3:** `classifyAnthropicTool` distingue `type` ausente (`client_defined`) de `type` malformado (`anthropic_typed_unknown`); `classifyOpenAITool` trata ausência E malformação como `openai_typed_unknown`; tests herméticos cobrem casos `null`, `undefined`, `''`, whitespace, e `123` (não-string); audit events de tool_validation.blocked diferenciam reason por motivo de bloqueio.
- [ ] Nenhuma outra seção da Consolidated v2.0 alterada além das listadas em §1.
- [ ] Counts de §27 (Consolidated v2.0) permanecem corretos: P1 não muda contagem de capabilities (apenas tier_availability); P2 não muda schema_version do PassthroughInvokedSchema (continua 3); P3 não muda taxonomy version (continua schema_version=2 em ambos providers).

---

## 6. Não-objetivos do patch

Esta v2.0.1 **não**:

- gera Peça A v2 (PR2 Prompt Claude Code);
- gera prompt Claude Code de execução;
- altera ADP v4.2 ou Addendum v4.2.2;
- introduz capability nova;
- altera `BetaTokenPolicy` enum ou `ANTHROPIC_BETA_POLICY`/`OPENAI_BETA_POLICY`;
- altera Risk Classes;
- altera enforcement modes canônicos;
- introduz tabela física nova além de `org_beta_overrides`;
- altera o modelo de dados macro de v4.2 §8.

---

## 7. Próximo passo

Sequência canônica após aceite deste patch:

1. **Auditoria do patch v2.0.1** (você + GPT, opcional).
2. **Provider Coverage Matrix v2 considerada canônica em sua versão consolidada (`Consolidated v2.0` + `v2.0.1`)** — pacote canônico de design para PR2.
3. **Geração da Peça A v2** (PR2 Prompt Claude Code) integrando:
   - referência ao Macro Native Substrate Contract (Addendum §6);
   - procedimento de Human Architect Escalation (Addendum §14);
   - batches A/B/C/D/F/G/M com gates numéricos (Addendum §7);
   - todos os 9 pre-merge gates de Consolidated §28 implementados como tests integration;
   - resolução obrigatória de `verification_required` antes do merge (prompt-caching, message-batches);
   - ADRs: ADR-014 obrigatório (Files Anthropic global allowlist); ADR-015 cancelado por default; ADR-016 condicional (Batches);
   - implementação de `org_beta_overrides` com schema canônico §5;
   - implementação de `PassthroughInvokedSchema` schema_version 3 com 5 regras `superRefine` (incluindo regra P2 desta v2.0.1);
   - implementação de tool classifiers Anthropic (§14.2 + P3) e OpenAI (§23.2 + P3) com taxonomia versionada;
   - script/test de validação automática de capability counts (sem contagem manual hardcoded — pedido do arquiteto);
   - decisões fixadas A1-A4 + O1-O6.
4. **Auditoria da Peça A v2.**
5. **Execução Claude Code** com pacote canônico:
   - ADP v4.2 (`ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254`)
   - Addendum v4.2.2 (Macro Native Substrate)
   - Provider Coverage Matrix v2 Consolidated v2.0 + patch v2.0.1
   - Peça A v2

Em paralelo: **não gerar prompt Claude Code antes da Peça A v2 estar gerada e auditada.**

---

**Fim da Provider Coverage Matrix v2.0.1 — Patch sobre Consolidated v2.0.**
