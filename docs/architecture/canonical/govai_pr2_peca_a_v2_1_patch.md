# GovAI PR2 — Peça A v2.1 — Patch sobre Peça A v2

**Versão:** v2.1 — patch curto sobre Peça A v2 (PR2 Prompt Claude Code)
**Data:** 2026-05-06
**Status:** rascunho de auditoria. Aplicado, substitui as seções enumeradas; preserva tudo o que não for explicitamente patchado.

**Documentos referenciados:**

| Documento | Hash | Papel |
|---|---|---|
| Peça A v2 (PR2 Prompt Claude Code) | `5831418000c00a38a0204f24293748490b9dddb1d7fdb82afa8b6f9a185cefcc` | base patcheada por este v2.1 |
| Provider Coverage Matrix v2 Consolidated | `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777` | canônica (referência de counts) |
| Provider Coverage Matrix v2.0.1 Patch | `1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e` | canônica |
| Addendum ADP v4.2.2 | (gerado anteriormente) | canônico |
| ADP v4.2 | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` | canônico |

---

## Sumário do patch

1. Status e relação com Peça A v2
2. Bloqueador B1 — Batch A §7.7 corrigido (10 endpoints Anthropic, não 28)
3. Bloqueador B2 — Batch C §8.1 corrigido (11 endpoint capabilities + 2 tools)
4. Bloqueador B3 — Live test env vars padronizadas
5. Bloqueador B4 — `validate-matrix-counts` com fonte única estruturada
6. Bloqueador B5 — Batch D deferred por default; promoção apenas com autorização humana explícita
7. Ajuste J1 — `ADR-015-not-needed` apenas após verificação técnica real
8. Ajuste J2 — Lista vermelha §17 — frase sobre capability fora dos universos qualificada
9. Ajuste J3 — Revisão de "28 endpoints" para uso apenas no contexto consolidado
10. Critério de aceitação do patch
11. Não-objetivos
12. Próximo passo

---

## 1. Status e relação com Peça A v2

Este patch substitui em Peça A v2:

- §5 (visão geral dos batches) — linha de Batch C corrigida por **B2**;
- §7.7 (critério de saída do Batch A) — linha de "28 endpoints Anthropic" corrigida por **B1**;
- §8.1 (objetivo do Batch C) — corrigido por **B2**;
- §10 (Batch D) — substituído por **B5** (deferred por default);
- §11.4 (`validate-matrix-counts.ts`) — substituído por **B4**;
- §11.3.1 (resolução de prompt-caching) — clarificado por **J1**;
- §12.2 (variáveis de ambiente live tests) — substituído por **B3**;
- §14.2 (template ADR-015) — clarificado por **J1**;
- §17 (lista vermelha) — frase qualificada por **J2**;
- ocorrências adicionais de "28 endpoints" — revisadas por **J3**.

Tudo o que não for tocado nesta v2.1 permanece como em Peça A v2. Em caso de conflito, prevalece v2.1.

---

## 2. Bloqueador B1 — Batch A §7.7 corrigido (10 endpoints Anthropic, não 28)

**Problema resolvido:** Peça A v2 §7.7 listava como critério de saída "todos os 28 endpoints passthrough Anthropic". `28` é o total **consolidado** Anthropic + OpenAI. Anthropic isolado tem ~10 endpoints obrigatórios + 1 tool capability via classifier.

### 2.1 Substituição em §7.7 — Critério de saída do Batch A

Substituir o primeiro item por:

```diff
- [ ] todos os 28 endpoints passthrough Anthropic da Matrix §26.1 funcionais (não retornam 503/501);
+ [ ] todos os 10 endpoints Anthropic obrigatórios da Matrix §26.1 funcionais (não retornam 503/501),
+     mais a capability tool `anthropic.web_search_tool` `supported` via classifier:
+       - POST /v1/messages (`anthropic.messages.create` — non-stream)
+       - POST /v1/messages (`anthropic.messages.stream` — stream)
+       - POST /v1/messages/count_tokens (`anthropic.messages_meta`)
+       - GET  /v1/models (`anthropic.models`)
+       - GET  /v1/models/{model_id} (`anthropic.models`)
+       - POST /v1/files (`anthropic.files`)
+       - GET  /v1/files (`anthropic.files`)
+       - GET  /v1/files/{file_id} (`anthropic.files`)
+       - DELETE /v1/files/{file_id} (`anthropic.files`)
+       - GET  /v1/files/{file_id}/content (`anthropic.files`)
```

Resultado: 10 endpoints (5 capabilities com endpoints) + 1 tool capability `anthropic.web_search_tool` (sem endpoint próprio, classificada via tools[]).

Nota: contagem precisa de endpoints é apurada pelo script `validate-matrix-counts` (B4 abaixo) — não pelo critério em prosa.

---

## 3. Bloqueador B2 — Batch C §8.1 corrigido (11 endpoint capabilities + 2 tools)

**Problema resolvido:** Peça A v2 §8.1 e §5 (tabela de batches, linha de Batch C) diziam "9 capabilities `supported`". Mas a Matrix consolidada + patch v2.0.1 fixaram **11 capabilities OpenAI com endpoint próprio + 2 tool capabilities** `supported`. §15.2 (checklist final) já estava correto — havia inconsistência interna na Peça A v2.

### 3.1 Substituição em §8.1 — Objetivo do Batch C

Substituir por:

```yaml
Implementar passthrough OpenAI: 11 capabilities `supported` com endpoint próprio
+ 2 tool capabilities `supported`. Lista canônica:

capabilities com endpoint próprio (11):
  1. openai.responses.create
  2. openai.responses.stream
  3. openai.chat.completions.create
  4. openai.chat.completions.stream
  5. openai.models                           (apenas GET endpoints; Risk A)
  6. openai.models.delete                    (capability separada; Risk C destrutivo)
  7. openai.embeddings
  8. openai.files
  9. openai.vector_stores                    (apenas operações não-destrutivas)
 10. openai.vector_stores.delete             (sub-capability destrutiva; tier_availability inclui starter por patch v2.0.1)
 11. openai.vector_stores.files.delete       (sub-capability destrutiva; tier_availability inclui starter por patch v2.0.1)

capabilities tool (2):
  12. openai.web_search_tool                 (via classifier; sem endpoint próprio)
  13. openai.file_search_tool                (via classifier; sem endpoint próprio)
```

### 3.2 Substituição na tabela §5 — linha de Batch C

```diff
- | **C** | OpenAI Provider Substrate | passthrough + tool classifier + OPENAI_BETA_POLICY + 9 capabilities `supported` (com 2 sub-DELETE de vector_stores) + tools `web_search` e `file_search` | F |
+ | **C** | OpenAI Provider Substrate | passthrough + tool classifier + OPENAI_BETA_POLICY + 11 capabilities `supported` com endpoint próprio (incluindo 2 sub-DELETE de vector_stores) + 2 tool capabilities `supported` (`web_search`, `file_search`) | F |
```

### 3.3 Atualização do critério de saída §8.8

Garantir consistência. Substituir o primeiro item:

```diff
- [ ] todos os 18 endpoints passthrough OpenAI da Matrix §26.1 funcionais;
+ [ ] todos os endpoints OpenAI obrigatórios da Matrix §26.1 funcionais (não retornam 503/501);
+     contagem precisa apurada pelo script `validate-matrix-counts` (§11.4 desta Peça A) —
+     não hardcoded em prosa.
```

A contagem total OpenAI é função do conjunto efetivo de endpoints declarados em `endpoint_coverage` de cada capability `supported`. O número exato deve sair do registro, não da Peça A.

---

## 4. Bloqueador B3 — Live test env vars padronizadas

**Problema resolvido:** Peça A v2 §12.2 usava `ANTHROPIC_LIVE_TEST_KEY` / `OPENAI_LIVE_TEST_KEY`. Padrão operacional consolidado da plataforma usa `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` mais variáveis adicionais para budget e modelo. Padrão deve ser único.

### 4.1 Substituição em §12.2 — variáveis de ambiente

```yaml
Variáveis de ambiente canônicas para live tests (Batch L):

# Trigger principal
GOVAI_LIVE_TESTS=1                 # ativa suite live; sem isso, suite é skipped

# Credenciais reais (sem aliases dedicados)
ANTHROPIC_API_KEY=sk-ant-...       # chave Anthropic do ambiente live; obrigatória se live ativo
OPENAI_API_KEY=sk-...              # chave OpenAI do ambiente live; obrigatória se live ativo

# Configuração de modelos para live tests
ANTHROPIC_LIVE_MODEL=claude-...    # modelo a ser usado; default fixado no test code se não definido
OPENAI_LIVE_MODEL=gpt-...          # idem para OpenAI

# Controle de orçamento
GOVAI_LIVE_TEST_BUDGET_USD=10.00   # orçamento máximo por execução completa; teste falha se ultrapassado

# Aliases aceitos (apenas para compatibilidade; padrão é usar nomes acima)
ANTHROPIC_LIVE_TEST_KEY            # alias documentado de ANTHROPIC_API_KEY
OPENAI_LIVE_TEST_KEY               # alias documentado de OPENAI_API_KEY
```

### 4.2 Regras operacionais explícitas

```yaml
Live test policy (canônica):

1. CI hermético público sem secrets:
   - GOVAI_LIVE_TESTS não definido → toda suite live é skipped;
   - tests passam (skipped) sem falhar o CI;
   - last_live_test_at NÃO é populado neste run.

2. CI privado com secrets configurados:
   - GOVAI_LIVE_TESTS=1 + chaves disponíveis → suite live executa;
   - cada capability supported que requer live test popula last_live_test_at;
   - budget GOVAI_LIVE_TEST_BUDGET_USD respeitado (test framework para se ultrapassar).

3. Pre-merge gate (Matrix §28.8):
   - PR2 NÃO pode ser aceito/mergeado sem ao menos uma execução live documentada
     com GOVAI_LIVE_TESTS=1 e budget respeitado;
   - last_live_test_at deve estar populado para todas as 19 capabilities `supported`
     que requerem live test;
   - documentação no PR description deve incluir: timestamp da execução live,
     custo total observado, modelos usados.
```

### 4.3 Implicação para tests

Em `tests/live/setup.ts`:

```typescript
const LIVE_TESTS_ENABLED = process.env.GOVAI_LIVE_TESTS === '1';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_LIVE_TEST_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY ?? process.env.OPENAI_LIVE_TEST_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_LIVE_MODEL ?? 'claude-default-fallback';
const OPENAI_MODEL = process.env.OPENAI_LIVE_MODEL ?? 'gpt-default-fallback';
const BUDGET_USD = parseFloat(process.env.GOVAI_LIVE_TEST_BUDGET_USD ?? '10.00');

if (!LIVE_TESTS_ENABLED) {
  // skip all tests in this suite
  describe.skip('live tests', () => {});
}

if (LIVE_TESTS_ENABLED && (!ANTHROPIC_KEY || !OPENAI_KEY)) {
  throw new Error('GOVAI_LIVE_TESTS=1 but credentials not provided');
}
```

### 4.4 Atualização do critério de saída do Batch L (§12.4)

```diff
- [ ] todas as 19 capabilities `supported` (16 com endpoint + 3 tools) têm `last_live_test_at` populado;
+ [ ] em CI privado com GOVAI_LIVE_TESTS=1: todas as 19 capabilities `supported` têm `last_live_test_at` populado;
+ [ ] em CI público hermético sem secrets: tests live são skipped, sem falhar CI;
+ [ ] PR description documenta execução live (timestamp, custo total, modelos usados);
+ [ ] custo total da execução respeita GOVAI_LIVE_TEST_BUDGET_USD.
```

---

## 5. Bloqueador B4 — `validate-matrix-counts` com fonte única estruturada

**Problema resolvido:** Peça A v2 §11.4 incluía `const expected = { ... }` hardcoded dentro do script enquanto também afirmava "não hardcoded como número". Contradição.

### 5.1 Decisão canônica

Counts esperados ficam em fonte única estruturada versionada. Duas opções aceitas — patch padroniza pela **opção B** (TypeScript estruturado em registry).

### 5.2 Fonte única — `packages/registry/src/provider-coverage-expected.ts`

Criar arquivo derivado da Matrix consolidada, populado **uma única vez** a partir do conjunto de capabilities `supported`, `planned`, etc. O arquivo é versionado e revisado em PR; mas seu conteúdo é declarativo (não números mágicos):

```typescript
// packages/registry/src/provider-coverage-expected.ts
//
// Fonte única de capability counts esperados em PR2.
// Derivado da Provider Coverage Matrix v2 Consolidated + patch v2.0.1.
// Atualização desta lista exige PR explícito + revisão da Matrix.

export interface ExpectedCapability {
  id: string;
  status: 'supported' | 'planned' | 'blocked' | 'not_exposed';
  has_endpoints: boolean;
}

export const EXPECTED_PR2_CAPABILITIES: ReadonlyArray<ExpectedCapability> = Object.freeze([
  // === SUPPORTED com endpoint próprio (16) ===
  { id: 'anthropic.messages.create', status: 'supported', has_endpoints: true },
  { id: 'anthropic.messages.stream', status: 'supported', has_endpoints: true },
  { id: 'anthropic.messages_meta', status: 'supported', has_endpoints: true },
  { id: 'anthropic.models', status: 'supported', has_endpoints: true },
  { id: 'anthropic.files', status: 'supported', has_endpoints: true },
  { id: 'openai.responses.create', status: 'supported', has_endpoints: true },
  { id: 'openai.responses.stream', status: 'supported', has_endpoints: true },
  { id: 'openai.chat.completions.create', status: 'supported', has_endpoints: true },
  { id: 'openai.chat.completions.stream', status: 'supported', has_endpoints: true },
  { id: 'openai.models', status: 'supported', has_endpoints: true },
  { id: 'openai.models.delete', status: 'supported', has_endpoints: true },
  { id: 'openai.embeddings', status: 'supported', has_endpoints: true },
  { id: 'openai.files', status: 'supported', has_endpoints: true },
  { id: 'openai.vector_stores', status: 'supported', has_endpoints: true },
  { id: 'openai.vector_stores.delete', status: 'supported', has_endpoints: true },
  { id: 'openai.vector_stores.files.delete', status: 'supported', has_endpoints: true },
  
  // === SUPPORTED tools (sem endpoint próprio, via classifier) (3) ===
  { id: 'anthropic.web_search_tool', status: 'supported', has_endpoints: false },
  { id: 'openai.web_search_tool', status: 'supported', has_endpoints: false },
  { id: 'openai.file_search_tool', status: 'supported', has_endpoints: false },
  
  // === BLOCKED (architectural prerequisite) (2) ===
  { id: 'anthropic.computer_use_tool', status: 'blocked', has_endpoints: false },
  { id: 'openai.computer_use_preview_tool', status: 'blocked', has_endpoints: false },
  
  // === PLANNED (PR3+) (lista completa derivada da Matrix) ===
  // Anthropic
  { id: 'anthropic.message_batches', status: 'planned', has_endpoints: false },
  { id: 'anthropic.code_execution_tool', status: 'planned', has_endpoints: false },
  { id: 'anthropic.managed_agents', status: 'planned', has_endpoints: false },
  { id: 'anthropic.skills', status: 'planned', has_endpoints: false },
  // OpenAI
  { id: 'openai.batches', status: 'planned', has_endpoints: false },
  { id: 'openai.moderations', status: 'planned', has_endpoints: false },
  { id: 'openai.uploads', status: 'planned', has_endpoints: false },
  { id: 'openai.conversations', status: 'planned', has_endpoints: false },
  { id: 'openai.tool_search_tool', status: 'planned', has_endpoints: false },
  { id: 'openai.code_interpreter_tool', status: 'planned', has_endpoints: false },
  { id: 'openai.hosted_shell_tool', status: 'planned', has_endpoints: false },
  { id: 'openai.apply_patch_tool', status: 'planned', has_endpoints: false },
  { id: 'openai.mcp_tool', status: 'planned', has_endpoints: false },
  { id: 'openai.skills', status: 'planned', has_endpoints: false },
  { id: 'openai.fine_tuning', status: 'planned', has_endpoints: false },
  { id: 'openai.audio.transcriptions', status: 'planned', has_endpoints: false },
  { id: 'openai.audio.translations', status: 'planned', has_endpoints: false },
  { id: 'openai.audio.speech', status: 'planned', has_endpoints: false },
  { id: 'openai.images', status: 'planned', has_endpoints: false },
  { id: 'openai.realtime', status: 'planned', has_endpoints: false },
  { id: 'openai.videos', status: 'planned', has_endpoints: false },
  
  // === NOT_EXPOSED (5) ===
  { id: 'anthropic.admin.*', status: 'not_exposed', has_endpoints: false },
  { id: 'openai.assistants.*', status: 'not_exposed', has_endpoints: false },
  { id: 'openai.threads.*', status: 'not_exposed', has_endpoints: false },
  { id: 'openai.realtime_beta.*', status: 'not_exposed', has_endpoints: false },
  { id: 'openai.completions_legacy', status: 'not_exposed', has_endpoints: false },
]);
```

### 5.3 Script `scripts/validate-matrix-counts.ts` — revisado

```typescript
// scripts/validate-matrix-counts.ts
//
// Compara CAPABILITY_REGISTRY runtime com EXPECTED_PR2_CAPABILITIES (fonte única).
// Sem números hardcoded no script — counts são derivados de ambas as fontes
// e comparados estruturalmente.

import { CAPABILITY_REGISTRY } from '@govai/registry';
import { EXPECTED_PR2_CAPABILITIES } from '@govai/registry/provider-coverage-expected';

// Index by id
const expectedById = new Map(EXPECTED_PR2_CAPABILITIES.map(c => [c.id, c]));
const actualById = new Map(CAPABILITY_REGISTRY.map(c => [c.id, c]));

const errors: string[] = [];

// 1. Toda capability esperada existe no registry
for (const exp of EXPECTED_PR2_CAPABILITIES) {
  const actual = actualById.get(exp.id);
  if (!actual) {
    errors.push(`MISSING: capability ${exp.id} (expected status=${exp.status}) not in registry`);
    continue;
  }
  if (actual.status !== exp.status) {
    errors.push(`STATUS_MISMATCH: ${exp.id} expected ${exp.status}, got ${actual.status}`);
  }
  const actualHasEndpoints = actual.endpoint_coverage && actual.endpoint_coverage.length > 0;
  if (actualHasEndpoints !== exp.has_endpoints) {
    errors.push(`ENDPOINTS_MISMATCH: ${exp.id} expected has_endpoints=${exp.has_endpoints}, got ${actualHasEndpoints}`);
  }
}

// 2. Nenhuma capability extra no registry sem estar no expected
for (const actual of CAPABILITY_REGISTRY) {
  if (!expectedById.has(actual.id)) {
    errors.push(`EXTRA: capability ${actual.id} (status=${actual.status}) in registry but not in EXPECTED_PR2_CAPABILITIES`);
  }
}

// 3. Counts derivados — apenas para reporting, não como gate
const counts = computeCounts(CAPABILITY_REGISTRY);
const expectedCounts = computeCounts(EXPECTED_PR2_CAPABILITIES.map(e => ({
  status: e.status,
  endpoint_coverage: e.has_endpoints ? [{}] : [],   // proxy para has_endpoints
})) as any);

console.log('Registry counts:', counts);
console.log('Expected counts:', expectedCounts);

if (errors.length > 0) {
  console.error('VALIDATION FAILED:');
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

console.log('Matrix consistency validated.');

function computeCounts(caps: any[]) {
  return {
    supported_with_endpoint: caps.filter(c => c.status === 'supported' && c.endpoint_coverage?.length > 0).length,
    supported_tool: caps.filter(c => c.status === 'supported' && (!c.endpoint_coverage || c.endpoint_coverage.length === 0)).length,
    planned: caps.filter(c => c.status === 'planned').length,
    blocked: caps.filter(c => c.status === 'blocked').length,
    not_exposed: caps.filter(c => c.status === 'not_exposed').length,
    total_endpoints: caps.reduce((sum, c) => sum + (c.endpoint_coverage?.length ?? 0), 0),
  };
}
```

### 5.4 Update flow

Quando a Matrix é atualizada por PR (ex.: promoção de Batch D), `provider-coverage-expected.ts` é atualizado **no mesmo PR**, junto com a mudança de status no registry. Mismatches geram falha de CI.

Se Batch D for promovido, dois itens passam de `'planned'` para `'supported'` em ambos arrays simultaneamente (`anthropic.message_batches`, `openai.batches` com `has_endpoints: true`).

---

## 6. Bloqueador B5 — Batch D deferred por default

**Problema resolvido:** Peça A v2 §10.1 delegava decisão de promoção do Batch D a Claude Code com base em "tempo/orçamento de PR2 disponível". Decisão de escopo não pode ser de Claude Code; é decisão arquitetural humana.

### 6.1 Substituição em §10.1 — Decisão pré-execução do Batch D

```yaml
Batch D — Política canônica:

DEFAULT (sem instrução adicional):
  Batch D fica DEFERRED.
  - anthropic.message_batches → status: 'planned', planned_phase: 'PR4'
  - openai.batches → status: 'planned', planned_phase: 'PR4'
  - ADR-016 NÃO é gerado
  - registrar `docs/architecture/escalations/PR2-ESC-batch-d-deferred.md`
    com motivo: "deferred por default; promoção exige autorização humana explícita"
  - resolver beta tokens de Batches conforme verificação técnica:
      - se header ainda exigido pela API → policy 'denied_until_decision' em ANTHROPIC_BETA_POLICY
      - se header não mais exigido → policy 'removed_as_no_longer_needed'
  - NÃO acionar Human Architect Escalation por isso (deferred é o comportamento padrão)

PROMOÇÃO (apenas com autorização humana explícita):
  Batch D só pode ser promovido a `supported` em PR2 se houver instrução
  explícita do arquiteto humano antes da execução, em uma das formas:
  
  a) instrução em mensagem direta ao Claude Code: "promover Batch D em PR2";
  b) flag em `docs/architecture/pr2-execution-config.yaml` (criado pelo arquiteto antes do start):
     ```yaml
     pr2_execution:
       batch_d_promote: true
       reason: "..."
       authorized_by: <user_id>
       authorized_at: <ISO timestamp>
     ```
  
  Se nenhuma das formas estiver presente, default deferred prevalece.

Se promovido:
  - anthropic.message_batches → status: 'supported'
  - openai.batches → status: 'supported'
  - implementar endpoints conforme Matrix §10.1 e §19.1
  - ADR-016 obrigatório (anthropic message-batches header global allowlist se ainda exigido)
  - update de provider-coverage-expected.ts (ambos passam a has_endpoints: true)
  - tests herméticos + live tests obrigatórios (parte do gate de promoção)
```

### 6.2 Atualização do §10.3 — Critério de saída do Batch D

```diff
**Se promovido (apenas com autorização explícita):**

- [ ] 6 endpoints de `anthropic.message_batches` funcionais;
- [ ] 4 endpoints de `openai.batches` funcionais;
- [ ] ADR-016 criado e merged;
- [ ] tests herméticos + live tests passam;
- [ ] `provider-coverage-expected.ts` atualizado consistentemente.

**Se deferred (default):**

- [ ] entry de `anthropic.message_batches` em `ANTHROPIC_BETA_POLICY` resolvida (não em verification_required);
- [ ] capabilities de batches permanecem `planned planned_phase: PR4`;
- [ ] documento `PR2-ESC-batch-d-deferred.md` registrado;
- [ ] ADR-016 NÃO criado.
```

### 6.3 Implicação para counts em B4

`provider-coverage-expected.ts` por default reflete deferred (batches como `'planned'`). Promoção altera ambos arrays simultaneamente em PR específico (Claude Code não pode mexer apenas no registry sem atualizar expected, ou o gate falha).

---

## 7. Ajuste J1 — `ADR-015-not-needed` apenas após verificação técnica real

**Problema resolvido:** Peça A v2 §14.2 trazia template de `ADR-015-not-needed.md` afirmando "verification confirmed that prompt caching has migrated to native parameter `cache_control`". Mas a verificação só acontece em Batch M (§11.3.1). O template não pode estar pre-redigido como conclusão.

### 7.1 Substituição em §14.2 — ADR-015

```yaml
ADR-015 — duas variantes possíveis. A escolha depende da verificação técnica
em Batch M (§11.3.1).

Variante A: ADR-015-not-needed.md
  - criar APENAS APÓS verificação técnica em Batch M ter confirmado que
    o header anthropic-beta=prompt-caching-2024-07-31 NÃO é mais exigido pela API;
  - ANTHROPIC_BETA_POLICY entry para prompt-caching-2024-07-31 → 'removed_as_no_longer_needed';
  - conteúdo do ADR documenta o resultado da verificação (data, método, evidência);
  - NÃO criar este ADR sem ter executado a verificação primeiro.

Variante B: ADR-015-allow-prompt-caching.md
  - criar APENAS APÓS verificação técnica em Batch M ter confirmado que o header
    AINDA é exigido pela API;
  - ANTHROPIC_BETA_POLICY entry → policy: 'global_allowlist' + adr: 'ADR-015';
  - conteúdo do ADR documenta a decisão e o motivo da inclusão na allowlist global.

Sequência operacional canônica:
  1. Batch M §11.3.1: executar verificação técnica (live test ou doc fresca);
  2. registrar resultado em `docs/architecture/verifications/PR2-VER-prompt-caching.md`;
  3. com base no resultado, criar a variante apropriada de ADR-015;
  4. atualizar ANTHROPIC_BETA_POLICY entry coerentemente.

NÃO permitido:
  - criar ADR-015-not-needed.md preventivamente;
  - criar ADR-015-allow-prompt-caching.md sem verificação;
  - manter prompt-caching-2024-07-31 como 'verification_required' em runtime production
    (o pre-merge gate Matrix §28.2 falha).
```

### 7.2 Implicação para o template de Peça A v2

O template incluído em Peça A v2 §14.2 (ADR-015-not-needed.md) é **rascunho pre-formato**, não conteúdo a ser commitado sem execução. Claude Code preenche os campos de verificação e data após executar §11.3.1.

---

## 8. Ajuste J2 — Lista vermelha §17 — frase qualificada

**Problema resolvido:** Peça A v2 §17 incluía:

```
❌ NUNCA introduzir capability fora dos universos Anthropic + OpenAI da Matrix
```

Frase soa como regra eterna. Foco da Peça A é PR2 — não bloqueia evolução futura via PR + ADR + atualização da Matrix.

### 8.1 Substituição em §17

```diff
- ❌ NUNCA introduzir capability fora dos universos Anthropic + OpenAI da Matrix;
+ ❌ NUNCA introduzir capability fora dos universos Anthropic + OpenAI da Matrix durante PR2.
+    Capabilities de outros providers (futuro) exigem PR + ADR + atualização da Matrix +
+    Human Architect Escalation explícita. Em PR2, escopo é fixado.
```

### 8.2 Princípio canônico

A frase original era para impedir Claude Code de adicionar uma terceira capability provider em PR2. A versão revista mantém esse impedimento sem soar como proibição arquitetural eterna do produto.

---

## 9. Ajuste J3 — Revisão de "28 endpoints" para uso apenas no contexto consolidado

**Problema resolvido:** verificar todas as ocorrências de "28 endpoints" na Peça A v2 e garantir que se referem ao **total consolidado Anthropic + OpenAI**, não a um provider específico.

### 9.1 Ocorrências identificadas em Peça A v2

| Linha | Contexto original | Ação |
|---|---|---|
| 46 | "19 capabilities `supported` em PR2 (16 com endpoint + 3 tools), totalizando 28 endpoints obrigatórios funcionais (ver Matrix §27)" | OK — explicitamente "PR2" total. **Manter.** |
| 657 | "todos os 28 endpoints passthrough Anthropic" | **Errado — corrigido por B1 (§2 deste patch).** |
| 1527 | "todos os 28 endpoints obrigatórios funcionais (sem 503/501)" | OK — está em §15.2 (checklist consolidado de PR2 inteiro). **Manter.** |

### 9.2 Substituição em §15.2 — clarificar escopo

Para evitar ambiguidade, ajustar §15.2:

```diff
- [ ] todos os 28 endpoints obrigatórios funcionais (sem 503/501);
+ [ ] todos os 28 endpoints obrigatórios funcionais (sem 503/501) — total consolidado Anthropic + OpenAI conforme Matrix §27;
```

Adicionar à §15.2 nota:

> Counts em prosa (28 endpoints, 19 capabilities) são informativos. Validação efetiva é feita pelo script `validate-matrix-counts.ts` (§5 deste patch / §11.4 + B4) comparando registry runtime contra `provider-coverage-expected.ts`.

---

## 10. Critério de aceitação do patch

Esta v2.1 é aceita como insumo final para autorização de execução se, em conjunto com Peça A v2:

- [ ] **B1:** §7.7 corrigido — Batch A trabalha com 10 endpoints Anthropic + 1 tool capability, não 28;
- [ ] **B2:** §5 (tabela de batches) e §8.1 corrigidos — Batch C trabalha com 11 endpoint capabilities + 2 tool capabilities; lista canônica explícita;
- [ ] **B3:** §12.2 padroniza env vars (`GOVAI_LIVE_TESTS`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_LIVE_MODEL`, `OPENAI_LIVE_MODEL`, `GOVAI_LIVE_TEST_BUDGET_USD`); aliases dedicados documentados; regras CI hermético skippa, merge exige live execution;
- [ ] **B4:** §11.4 substituído por script que compara `CAPABILITY_REGISTRY` contra `provider-coverage-expected.ts` (fonte única estruturada); zero números hardcoded no corpo do script de validação;
- [ ] **B5:** §10 substituído — Batch D deferred por default; promoção apenas com autorização humana explícita (mensagem direta OU `pr2-execution-config.yaml` com flag); registro de escalation se deferred;
- [ ] **J1:** §14.2 — ADR-015 só criado após verificação técnica em §11.3.1; template em Peça A v2 é rascunho pre-formato, não pré-conclusão;
- [ ] **J2:** §17 — frase sobre capability fora dos universos qualificada com "durante PR2" + caminho via PR + ADR + HAE para extensões futuras;
- [ ] **J3:** §15.2 ajustada para clarificar que 28 endpoints é total consolidado; nota sobre script de validação como fonte autoritativa;
- [ ] nenhuma outra seção da Peça A v2 alterada além das listadas.

---

## 11. Não-objetivos do patch

Esta v2.1 **não**:

- gera comando final de execução para Claude Code;
- altera ADP v4.2, Addendum v4.2.2, Matrix v2 Consolidated ou patch v2.0.1;
- introduz capability nova;
- altera enforcement modes canônicos;
- altera schemas Zod ou rules `superRefine`;
- altera tool classifiers ou suas regras (incluindo `type: null` Anthropic);
- altera ADRs canônicos (ADR-014 obrigatório; ADR-015 condicional; ADR-016 condicional);
- altera batches A, F, G, M, L (apenas Batch D ganha regra de deferral);
- altera Human Architect Escalation procedure;
- altera lista vermelha §17 além da frase específica em J2.

---

## 12. Próximo passo

Sequência canônica após aceite deste patch:

1. **Auditoria do patch v2.1** (você + GPT, opcional).
2. **Pacote canônico de execução PR2 considerado pronto** após este aceite, composto por:
   - ADP v4.2 (`ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254`)
   - Addendum ADP v4.2.2
   - Provider Coverage Matrix v2 Consolidated (`604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777`)
   - Matrix v2.0.1 patch (`1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e`)
   - Peça A v2 (`5831418000c00a38a0204f24293748490b9dddb1d7fdb82afa8b6f9a185cefcc`)
   - Peça A v2.1 patch (este documento)
3. **Decisão arquitetural sobre Batch D:**
   - default: deferred. Sem ação adicional.
   - promoção: criar `docs/architecture/pr2-execution-config.yaml` com flag, ou enviar instrução direta ao Claude Code antes da execução.
4. **Autorização explícita de execução** pelo arquiteto humano via mensagem.
5. **Execução Claude Code** com pacote canônico.

Em paralelo: **não gerar comando final de execução para Claude Code antes da autorização explícita.**

---

**Fim da Peça A v2.1 — Patch sobre Peça A v2.**
