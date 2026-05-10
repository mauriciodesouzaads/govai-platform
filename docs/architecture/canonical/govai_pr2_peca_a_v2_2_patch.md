# GovAI PR2 — Peça A v2.2 — Patch sobre Peça A v2.1

**Versão:** v2.2 — patch curtíssimo sobre Peça A v2.1
**Data:** 2026-05-06
**Status:** rascunho de auditoria. Aplicado, substitui as seções enumeradas; preserva tudo o que não for explicitamente patchado.

**Documentos referenciados:**

| Documento | Hash | Papel |
|---|---|---|
| Peça A v2 | `5831418000c00a38a0204f24293748490b9dddb1d7fdb82afa8b6f9a185cefcc` | base original |
| Peça A v2.1 patch | `9d5825d6dc93fc13349a688b04a2e0cc319c35ee6932dc1d03c84c60f1b7d190` | base patcheada por este v2.2 |
| Provider Coverage Matrix v2 Consolidated | `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777` | canônica |
| Matrix v2.0.1 patch | `1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e` | canônica |
| ADP v4.2 | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` | canônico |
| Addendum v4.2.2 | (gerado) | canônico |

---

## Sumário do patch

1. Status e relação com v2.1
2. Patch F1 — Resolver discrepância 47/48: adicionar `anthropic.claude_agent.*` como `planned`
3. Patch F2 — `provider-coverage-expected.ts` usa `endpoint_count: number`, não `has_endpoints: boolean`
4. Patch F3 — Batch D autorização exclusivamente via `pr2-execution-config.yaml` versionado
5. Critério de aceitação do patch
6. Não-objetivos
7. Próximo passo

---

## 1. Status e relação com v2.1

Este patch substitui em Peça A v2.1:

- §5 (Bloqueador B4 — `provider-coverage-expected.ts`) — substituído por **F1** (entrada anthropic.claude_agent.*) + **F2** (endpoint_count);
- §6 (Bloqueador B5 — Batch D) — restringido por **F3** (apenas YAML versionado).

Tudo o que não for tocado nesta v2.2 permanece como em Peça A v2 + v2.1. Em caso de conflito, prevalece v2.2 nas seções enumeradas acima.

Documento canônico de execução PR2 a partir deste aceite: Peça A v2 + v2.1 + v2.2 lidas juntas.

---

## 2. Patch F1 — Resolver discrepância 47/48: adicionar `anthropic.claude_agent.*` como `planned`

**Problema resolvido:** Peça A v2.1 §5.2 (`EXPECTED_PR2_CAPABILITIES`) tinha 47 entries enquanto Matrix §27 declara 48 totais (16 + 3 + 22 + 2 + 5). A entrada faltante é a família futura **Claude Agent server-side** (Cenário B PR7+, descrita em ADP v4.2 §14.3, Addendum v4.2.2 §3.2 + §10, e Matrix consolidada §10.5).

### 2.1 Decisão canônica

- escolha **Opção A** (não reduzir Matrix): preservar a família como entry de roadmap macro;
- escolha de **id**: `anthropic.claude_agent.*` (com namespace `anthropic.`), por consistência com `anthropic.admin.*` e por evitar capability sem provider explícito;
- Matrix consolidada §10.5 usa o termo informal `claude_agent.*` em narrativa, mas o **id canônico** no registry e no expected.ts é `anthropic.claude_agent.*`.

### 2.2 Nota sobre normalização

Matrix consolidada §10.5 contém narrativa "Família mantida exatamente como em ADP v4.2 §14.3 e Addendum v4.2.2 §3.2 + §10" referindo-se a `claude_agent.*`. Esta narrativa **não muda** com este patch — é descritiva. O **id no registry** segue a convenção `anthropic.claude_agent.*`.

Recomendação para Matrix v2.0.2 futura (não escopo desta Peça A v2.2): atualizar §10.5 para usar `anthropic.claude_agent.*` literal e remover a divergência narrativa. **Não bloqueia execução do PR2.**

### 2.3 Entrada a adicionar em `provider-coverage-expected.ts`

Adicionar à lista `EXPECTED_PR2_CAPABILITIES` em §5.2 da v2.1, na seção `// === PLANNED (PR3+) ===`, sub-bloco `// Anthropic`:

```typescript
// Adicionado em v2.2 — F1
{ id: 'anthropic.claude_agent.*', status: 'planned', endpoint_count: 0 },
```

### 2.4 Counts esperados após F1

| dimensão | total |
|---|---|
| supported_with_endpoint | 16 |
| supported_tool | 3 |
| planned | 22 *(era 21; +1 com claude_agent)* |
| blocked | 2 |
| not_exposed | 5 |
| **total capabilities** | **48** ✅ casa Matrix §27 |

### 2.5 Implicação para registry runtime

`CAPABILITY_REGISTRY` em `packages/registry/` deve registrar `anthropic.claude_agent.*` com `status: 'planned'`, `planned_phase: 'PR7+'`, `endpoint_coverage: []`, demais campos derivados de ADP v4.2 §14.3 + Addendum §3.2.

Capability não é exposta via API em PR2 (não há endpoint próprio nem tool detection). Está no registry apenas para coerência da Matrix macro e validação do gate `validate-matrix-counts`.

---

## 3. Patch F2 — `provider-coverage-expected.ts` usa `endpoint_count: number`, não `has_endpoints: boolean`

**Problema resolvido:** Peça A v2.1 §5.2 definiu `ExpectedCapability` com `has_endpoints: boolean`. Isso valida apenas presença de endpoints, não a contagem correta. Risco: registry pode declarar `anthropic.files` com 2 endpoints (em vez dos 5 obrigatórios) e o validador passa. Quebra a tese "native availability não capada".

### 3.1 Substituição da interface

Substituir em §5.2 da v2.1:

```diff
export interface ExpectedCapability {
  id: string;
  status: 'supported' | 'planned' | 'blocked' | 'not_exposed';
- has_endpoints: boolean;
+ endpoint_count: number;
}
```

### 3.2 Substituição da lista `EXPECTED_PR2_CAPABILITIES`

Substituir cada entrada para usar `endpoint_count` com valor exato derivado de Matrix consolidada `endpoint_coverage[].length`:

```typescript
// packages/registry/src/provider-coverage-expected.ts (v2.2 — substituição completa)
//
// Fonte única de capability counts esperados em PR2.
// Derivada de Matrix v2 Consolidated + patch v2.0.1 + Peça A v2.1/v2.2.
// Atualização exige PR explícito + revisão da Matrix.

export interface ExpectedCapability {
  id: string;
  status: 'supported' | 'planned' | 'blocked' | 'not_exposed';
  endpoint_count: number;
}

export const EXPECTED_PR2_CAPABILITIES: ReadonlyArray<ExpectedCapability> = Object.freeze([
  // === SUPPORTED com endpoint próprio (16) ===
  { id: 'anthropic.messages.create',         status: 'supported', endpoint_count: 1 },  // POST /v1/messages (non-stream)
  { id: 'anthropic.messages.stream',         status: 'supported', endpoint_count: 1 },  // POST /v1/messages (stream)
  { id: 'anthropic.messages_meta',           status: 'supported', endpoint_count: 1 },  // POST /v1/messages/count_tokens
  { id: 'anthropic.models',                  status: 'supported', endpoint_count: 2 },  // GET /v1/models, GET /v1/models/{id}
  { id: 'anthropic.files',                   status: 'supported', endpoint_count: 5 },  // POST, GET-list, GET-meta, DELETE, GET-content
  
  { id: 'openai.responses.create',           status: 'supported', endpoint_count: 1 },  // POST /v1/responses (non-stream)
  { id: 'openai.responses.stream',           status: 'supported', endpoint_count: 1 },  // POST /v1/responses (stream)
  { id: 'openai.chat.completions.create',    status: 'supported', endpoint_count: 1 },  // POST /v1/chat/completions (non-stream)
  { id: 'openai.chat.completions.stream',    status: 'supported', endpoint_count: 1 },  // POST /v1/chat/completions (stream)
  { id: 'openai.models',                     status: 'supported', endpoint_count: 2 },  // GET /v1/models, GET /v1/models/{id}
  { id: 'openai.models.delete',              status: 'supported', endpoint_count: 1 },  // DELETE /v1/models/{id}
  { id: 'openai.embeddings',                 status: 'supported', endpoint_count: 1 },  // POST /v1/embeddings
  { id: 'openai.files',                      status: 'supported', endpoint_count: 5 },  // POST, GET-list, GET-meta, DELETE, GET-content
  { id: 'openai.vector_stores',              status: 'supported', endpoint_count: 5 },  // POST, GET-list, GET-store, POST-files, GET-files (não-destrutivos)
  { id: 'openai.vector_stores.delete',       status: 'supported', endpoint_count: 1 },  // DELETE /v1/vector_stores/{id}
  { id: 'openai.vector_stores.files.delete', status: 'supported', endpoint_count: 1 },  // DELETE .../files/{id}
  
  // === SUPPORTED tools (sem endpoint próprio, via classifier) (3) ===
  { id: 'anthropic.web_search_tool',         status: 'supported', endpoint_count: 0 },
  { id: 'openai.web_search_tool',            status: 'supported', endpoint_count: 0 },
  { id: 'openai.file_search_tool',           status: 'supported', endpoint_count: 0 },
  
  // === BLOCKED (architectural prerequisite) (2) ===
  { id: 'anthropic.computer_use_tool',       status: 'blocked',   endpoint_count: 0 },
  { id: 'openai.computer_use_preview_tool',  status: 'blocked',   endpoint_count: 0 },
  
  // === PLANNED (PR3+) (22) ===
  // Anthropic (5)
  { id: 'anthropic.message_batches',         status: 'planned',   endpoint_count: 0 },
  { id: 'anthropic.code_execution_tool',     status: 'planned',   endpoint_count: 0 },
  { id: 'anthropic.managed_agents',          status: 'planned',   endpoint_count: 0 },
  { id: 'anthropic.skills',                  status: 'planned',   endpoint_count: 0 },
  { id: 'anthropic.claude_agent.*',          status: 'planned',   endpoint_count: 0 },  // F1 v2.2
  // OpenAI (17)
  { id: 'openai.batches',                    status: 'planned',   endpoint_count: 0 },
  { id: 'openai.moderations',                status: 'planned',   endpoint_count: 0 },
  { id: 'openai.uploads',                    status: 'planned',   endpoint_count: 0 },
  { id: 'openai.conversations',              status: 'planned',   endpoint_count: 0 },
  { id: 'openai.tool_search_tool',           status: 'planned',   endpoint_count: 0 },
  { id: 'openai.code_interpreter_tool',      status: 'planned',   endpoint_count: 0 },
  { id: 'openai.hosted_shell_tool',          status: 'planned',   endpoint_count: 0 },
  { id: 'openai.apply_patch_tool',           status: 'planned',   endpoint_count: 0 },
  { id: 'openai.mcp_tool',                   status: 'planned',   endpoint_count: 0 },
  { id: 'openai.skills',                     status: 'planned',   endpoint_count: 0 },
  { id: 'openai.fine_tuning',                status: 'planned',   endpoint_count: 0 },
  { id: 'openai.audio.transcriptions',       status: 'planned',   endpoint_count: 0 },
  { id: 'openai.audio.translations',         status: 'planned',   endpoint_count: 0 },
  { id: 'openai.audio.speech',               status: 'planned',   endpoint_count: 0 },
  { id: 'openai.images',                     status: 'planned',   endpoint_count: 0 },
  { id: 'openai.realtime',                   status: 'planned',   endpoint_count: 0 },
  { id: 'openai.videos',                     status: 'planned',   endpoint_count: 0 },
  
  // === NOT_EXPOSED (5) ===
  { id: 'anthropic.admin.*',                 status: 'not_exposed', endpoint_count: 0 },
  { id: 'openai.assistants.*',               status: 'not_exposed', endpoint_count: 0 },
  { id: 'openai.threads.*',                  status: 'not_exposed', endpoint_count: 0 },
  { id: 'openai.realtime_beta.*',            status: 'not_exposed', endpoint_count: 0 },
  { id: 'openai.completions_legacy',         status: 'not_exposed', endpoint_count: 0 },
]);

// Total: 48 capabilities; 30 endpoints supported.
```

### 3.3 Substituição do script `validate-matrix-counts.ts`

Substituir corpo do script em §5.3 da v2.1 por:

```typescript
// scripts/validate-matrix-counts.ts (v2.2)
//
// Compara CAPABILITY_REGISTRY runtime contra EXPECTED_PR2_CAPABILITIES.
// Valida id, status, e endpoint_count exato — não apenas presença.

import { CAPABILITY_REGISTRY } from '@govai/registry';
import { EXPECTED_PR2_CAPABILITIES } from '@govai/registry/provider-coverage-expected';

const expectedById = new Map(EXPECTED_PR2_CAPABILITIES.map(c => [c.id, c]));
const actualById = new Map(CAPABILITY_REGISTRY.map(c => [c.id, c]));

const errors: string[] = [];

// 1. Toda capability esperada existe no registry
for (const exp of EXPECTED_PR2_CAPABILITIES) {
  const actual = actualById.get(exp.id);
  if (!actual) {
    errors.push(`MISSING: capability ${exp.id} (expected status=${exp.status}, endpoint_count=${exp.endpoint_count}) not in registry`);
    continue;
  }
  if (actual.status !== exp.status) {
    errors.push(`STATUS_MISMATCH: ${exp.id} expected ${exp.status}, got ${actual.status}`);
  }
  const actualEndpointCount = actual.endpoint_coverage?.length ?? 0;
  if (actualEndpointCount !== exp.endpoint_count) {
    errors.push(
      `ENDPOINT_COUNT_MISMATCH: ${exp.id} expected ${exp.endpoint_count} endpoints, got ${actualEndpointCount}`
    );
  }
}

// 2. Nenhuma capability extra no registry sem estar no expected
for (const actual of CAPABILITY_REGISTRY) {
  if (!expectedById.has(actual.id)) {
    errors.push(`EXTRA: capability ${actual.id} (status=${actual.status}) in registry but not in EXPECTED_PR2_CAPABILITIES`);
  }
}

// 3. Counts derivados — para reporting; gate é por errors.length
const summary = {
  registry: {
    total: CAPABILITY_REGISTRY.length,
    supported_with_endpoint: CAPABILITY_REGISTRY.filter(c => c.status === 'supported' && (c.endpoint_coverage?.length ?? 0) > 0).length,
    supported_tool: CAPABILITY_REGISTRY.filter(c => c.status === 'supported' && (c.endpoint_coverage?.length ?? 0) === 0).length,
    planned: CAPABILITY_REGISTRY.filter(c => c.status === 'planned').length,
    blocked: CAPABILITY_REGISTRY.filter(c => c.status === 'blocked').length,
    not_exposed: CAPABILITY_REGISTRY.filter(c => c.status === 'not_exposed').length,
    total_endpoints: CAPABILITY_REGISTRY.reduce((sum, c) => sum + (c.endpoint_coverage?.length ?? 0), 0),
  },
  expected: {
    total: EXPECTED_PR2_CAPABILITIES.length,
    supported_with_endpoint: EXPECTED_PR2_CAPABILITIES.filter(c => c.status === 'supported' && c.endpoint_count > 0).length,
    supported_tool: EXPECTED_PR2_CAPABILITIES.filter(c => c.status === 'supported' && c.endpoint_count === 0).length,
    planned: EXPECTED_PR2_CAPABILITIES.filter(c => c.status === 'planned').length,
    blocked: EXPECTED_PR2_CAPABILITIES.filter(c => c.status === 'blocked').length,
    not_exposed: EXPECTED_PR2_CAPABILITIES.filter(c => c.status === 'not_exposed').length,
    total_endpoints: EXPECTED_PR2_CAPABILITIES.reduce((sum, c) => sum + c.endpoint_count, 0),
  },
};

console.log('Counts:', JSON.stringify(summary, null, 2));

if (errors.length > 0) {
  console.error('VALIDATION FAILED:');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log('Matrix consistency validated.');
```

### 3.4 Implicação para Batch F (criação de capabilities no registry)

Cada capability `supported` em PR2 é criada no registry com `endpoint_coverage[]` cuja `.length` deve ser exatamente o `endpoint_count` declarado em `provider-coverage-expected.ts`. O script falha o gate Matrix §28.4 se houver discrepância.

Exemplos críticos:

- `anthropic.files.endpoint_coverage.length === 5` (POST + GET-list + GET-meta + DELETE + GET-content);
- `openai.vector_stores.endpoint_coverage.length === 5` (POST + GET-list + GET-store + POST-files + GET-files — não-destrutivos);
- `openai.models.delete.endpoint_coverage.length === 1`;
- `openai.web_search_tool.endpoint_coverage.length === 0` (tool, sem endpoint próprio).

Capability com 5 endpoints declarando apenas 2 → `ENDPOINT_COUNT_MISMATCH` no gate. Capability com 0 endpoint declarando 5 → mesmo erro inverso.

### 3.5 Total de endpoints

Soma de `endpoint_count` em capabilities `supported` da `EXPECTED_PR2_CAPABILITIES` (esta v2.2):

```
Anthropic:        1 + 1 + 1 + 2 + 5                   = 10
OpenAI:           1 + 1 + 1 + 1 + 2 + 1 + 1 + 5 + 5 + 1 + 1 = 20
TOTAL ENDPOINTS                                       = 30
```

**Nota sobre discrepância de contagem:** Matrix consolidada §27 declarava 28 endpoints. A apuração exata derivada da soma de `endpoint_coverage[]` por capability resulta em **30**. A diferença vem de duas capabilities `.create` + `.stream` (Anthropic e OpenAI Chat Completions) compartilharem o mesmo path mas serem capabilities distintas com `endpoint_coverage[1]` cada uma:

- `anthropic.messages.create` (POST /v1/messages, streams: false) + `anthropic.messages.stream` (POST /v1/messages, streams: true) = 2 entries em endpoint_coverage agregadas;
- `openai.chat.completions.create` + `openai.chat.completions.stream` = 2 entries idem.

Matrix §27 deduplicava implicitamente; a v2.2 mantém a contagem exata por entrada de `endpoint_coverage[]`. **Isto não afeta funcionalidade** — apenas reporting. Recomendação para Matrix v2.0.2 futura: corrigir §27 para refletir 30 endpoints, ou explicitar critério de deduplicação. **Não bloqueia execução do PR2.**

---

## 4. Patch F3 — Batch D autorização exclusivamente via `pr2-execution-config.yaml` versionado

**Problema resolvido:** Peça A v2.1 §6.1 permitia autorização de Batch D por dois mecanismos (mensagem direta OU YAML config). Mensagem direta não deixa evidência no repo, dificultando auditoria de decisão de escopo.

### 4.1 Substituição em §6.1 da v2.1 — Política canônica de Batch D

Substituir o bloco `PROMOÇÃO` por:

```yaml
PROMOÇÃO (apenas via YAML versionado):
  Batch D só pode ser promovido a `supported` em PR2 se existir o arquivo:
  
    docs/architecture/pr2-execution-config.yaml
  
  com conteúdo válido:
    pr2_execution:
      batch_d_promote: true
      reason: "<motivo do arquiteto humano>"
      authorized_by: "<identificador do arquiteto humano>"
      authorized_at: "<ISO 8601 datetime, ex.: 2026-05-06T12:00:00Z>"
  
  Validações operacionais:
    - arquivo deve existir no repositório no commit em que Batch D é executado;
    - schema Zod simples valida os 4 campos obrigatórios;
    - authorized_at deve estar no passado (não futuro);
    - reason deve ter ao menos 20 caracteres (evita autorização sem justificativa);
    - se qualquer validação falhar, Batch D é deferred (default).
  
  Mensagem direta NÃO é forma válida de autorização:
    - se o arquiteto humano enviar mensagem direta sobre Batch D no chat,
      ela deve ser transcrita para pr2-execution-config.yaml ANTES da execução;
    - Claude Code NÃO interpreta mensagem como autorização suficiente;
    - resposta de Claude Code à mensagem deve ser:
      "Promoção de Batch D requer pr2-execution-config.yaml versionado.
       Por favor crie o arquivo com a flag batch_d_promote: true e reason."
```

### 4.2 Schema Zod do `pr2-execution-config.yaml`

Adicionar em `packages/core-governance/src/admin/`:

```typescript
// pr2-execution-config-schema.ts
import { z } from 'zod';

export const Pr2ExecutionConfigSchema = z.object({
  pr2_execution: z.object({
    batch_d_promote: z.boolean(),
    reason: z.string().min(20, 'reason must be at least 20 characters'),
    authorized_by: z.string().min(1),
    authorized_at: z.string().datetime(),
  }).strict(),
}).strict();

export type Pr2ExecutionConfig = z.infer<typeof Pr2ExecutionConfigSchema>;

export function loadPr2ExecutionConfig(yamlContent: string | null): {
  batch_d_promote: boolean;
  raw?: Pr2ExecutionConfig;
} {
  if (!yamlContent) {
    return { batch_d_promote: false };
  }
  
  // YAML.parse externo, com captura de erros
  try {
    const parsed = parseYaml(yamlContent);   // pseudocode
    const validated = Pr2ExecutionConfigSchema.parse(parsed);
    
    const authorizedAt = new Date(validated.pr2_execution.authorized_at);
    if (authorizedAt > new Date()) {
      return { batch_d_promote: false };  // future date inválido
    }
    
    return {
      batch_d_promote: validated.pr2_execution.batch_d_promote,
      raw: validated,
    };
  } catch {
    return { batch_d_promote: false };  // qualquer erro → deferred
  }
}
```

### 4.3 Atualização do critério de saída do Batch D (§10.3 da Peça A v2)

Sem mudança estrutural — critério continua dual (promovido/deferred). Acrescentar:

```diff
**Se promovido (apenas via pr2-execution-config.yaml válido):**

- [ ] arquivo `docs/architecture/pr2-execution-config.yaml` existe;
- [ ] schema Zod valida os 4 campos obrigatórios;
- [ ] reason ≥ 20 caracteres;
- [ ] authorized_at no passado;
+ [ ] referência ao YAML incluída na PR description (commit hash, authorized_by, reason);
- [ ] 6 endpoints de `anthropic.message_batches` funcionais;
- ... (demais critérios mantidos)
```

### 4.4 Implicação para tests

```
tests/integration/governance/
  pr2-execution-config.test.ts:
    - YAML ausente → batch_d_promote: false
    - YAML com batch_d_promote: false explícito → batch_d_promote: false
    - YAML com batch_d_promote: true e todos os campos válidos → batch_d_promote: true
    - YAML com authorized_at no futuro → rejeitado (false)
    - YAML com reason < 20 chars → rejeitado (false)
    - YAML mal-formado → rejeitado (false)
    - YAML com campos extras (não-strict) → rejeitado (false)
```

### 4.5 Documento de autorização (template canônico)

Quando o arquiteto humano quiser promover Batch D, criar `docs/architecture/pr2-execution-config.yaml` com:

```yaml
# Authorization for PR2 Batch D promotion
# Created by human architect; required for Batch D to execute as `supported`.
# Read by Claude Code at start of PR2 execution.

pr2_execution:
  batch_d_promote: true
  reason: "Batch D promovido por demanda comercial confirmada (cliente X usa Batches API)."
  authorized_by: "mauricio_souza_ads"
  authorized_at: "2026-05-06T14:30:00Z"
```

Sem este arquivo (default), Batch D fica `deferred` conforme §6.1 da v2.1.

---

## 5. Critério de aceitação do patch

Esta v2.2 é aceita como insumo final para autorização de execução se, em conjunto com Peça A v2 + v2.1:

- [ ] **F1:** `EXPECTED_PR2_CAPABILITIES` tem 48 entries; entry `anthropic.claude_agent.*` (com namespace) presente como `planned`, `endpoint_count: 0`;
- [ ] **F2:** interface `ExpectedCapability` usa `endpoint_count: number` (não `has_endpoints: boolean`); cada capability tem valor exato derivado de Matrix `endpoint_coverage[].length`; script compara `actual.endpoint_coverage.length` contra `expected.endpoint_count` com erro estruturado `ENDPOINT_COUNT_MISMATCH`;
- [ ] **F3:** Batch D autorização **apenas** via `docs/architecture/pr2-execution-config.yaml` versionado; mensagem direta no chat **não** é forma válida de autorização; Claude Code recusa promoção sem o YAML e sugere criação;
- [ ] schema Zod `Pr2ExecutionConfigSchema` valida 4 campos com regras (reason ≥ 20 chars, authorized_at no passado, strict mode);
- [ ] tests `pr2-execution-config.test.ts` cobrem 7 casos canônicos (§4.4);
- [ ] nenhuma outra seção da Peça A v2/v2.1 alterada além das listadas.

---

## 6. Não-objetivos do patch

Esta v2.2 **não**:

- gera comando final de execução para Claude Code;
- altera ADP v4.2, Addendum v4.2.2, Matrix v2 Consolidated ou patch v2.0.1;
- altera `BetaTokenPolicy`, audit event schemas, tool classifiers, ou pipeline Governed Run;
- altera batches A, F, G, M, L (apenas Batch D ganha regra mais restrita de autorização);
- altera ADRs (ADR-014 obrigatório; ADR-015 condicional; ADR-016 condicional);
- altera narrativa da Matrix consolidada §10.5 (recomendação para Matrix v2.0.2 futura registrada em §2.2);
- altera contagem total da Matrix §27 (recomendação para Matrix v2.0.2 futura registrada em §3.5);
- altera Human Architect Escalation procedure;
- altera lista vermelha §17 da Peça A v2.

---

## 7. Próximo passo

Sequência canônica após aceite deste patch:

1. **Auditoria do patch v2.2** (você + GPT, opcional).
2. **Pacote canônico de execução PR2 fica completo:**
   - ADP v4.2 (`ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254`)
   - Addendum v4.2.2
   - Provider Coverage Matrix v2 Consolidated (`604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777`)
   - Matrix v2.0.1 patch (`1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e`)
   - Peça A v2 (`5831418000c00a38a0204f24293748490b9dddb1d7fdb82afa8b6f9a185cefcc`)
   - Peça A v2.1 patch (`9d5825d6dc93fc13349a688b04a2e0cc319c35ee6932dc1d03c84c60f1b7d190`)
   - Peça A v2.2 patch (este documento)

3. **Decisão arquitetural sobre Batch D antes da execução:**
   - default: nenhuma ação adicional → Batch D deferred;
   - promoção: criar `docs/architecture/pr2-execution-config.yaml` no repositório com flag `batch_d_promote: true` + reason + authorized_by + authorized_at.

4. **Autorização explícita de execução** pelo arquiteto humano via mensagem.

5. **Execução Claude Code** com pacote canônico — apenas após autorização explícita.

Em paralelo: **não gerar comando final de execução para Claude Code antes da autorização explícita.**

---

**Fim da Peça A v2.2 — Patch sobre Peça A v2.1.**
