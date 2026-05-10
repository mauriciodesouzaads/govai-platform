# GovAI PR2 — Provider Coverage Matrix v2.0.2 — Count Reconciliation Patch

**Versão:** v2.0.2 — patch mínimo de reconciliação de contagem sobre Matrix Consolidated v2.0 + patch v2.0.1
**Data:** 2026-05-06
**Status:** rascunho de auditoria. Aplicado, substitui apenas as seções enumeradas; preserva tudo o que não for explicitamente patchado.

**Escopo único:** reconciliar contagem de endpoints e normalizar narrativa de `claude_agent.*` para `anthropic.claude_agent.*`.

**Não-escopo:** nenhuma alteração de capabilities, statuses, batches, schemas, tool classifiers, ADRs, Peça A ou universo de PR2.

**Documentos referenciados:**

| Documento | Hash | Papel |
|---|---|---|
| ADP v4.2 | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` | canônico |
| Addendum v4.2.2 | (gerado) | canônico |
| Provider Coverage Matrix v2 Consolidated | `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777` | base patcheada por este v2.0.2 |
| Matrix v2.0.1 patch | `1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e` | preserva ajustes anteriores |
| Peça A v2.2 patch | `649e762c40edb15be0bb65f92596575ece13ac890394d7c2aeeb322e4c475c8e` | apura endpoint_count: 30 (motivou esta reconciliação) |

---

## Sumário do patch

1. Status e relação com Consolidated v2.0 + v2.0.1
2. Patch P1 — Reconciliar contagem de endpoints (28 → 30 endpoint_coverage entries)
3. Patch P2 — Normalizar `claude_agent.*` para `anthropic.claude_agent.*`
4. Critério de aceitação do patch
5. Não-objetivos
6. Próximo passo

---

## 1. Status e relação com Consolidated v2.0 + v2.0.1

Este patch substitui em Matrix Consolidated v2.0 (após patch v2.0.1):

- §8 (universo Anthropic — tabela com `claude_agent.*`) — id normalizado por **P2**;
- §10.5 (descrição da família server-side) — id normalizado por **P2**;
- §27 (escopo numérico total em PR2) — contagem reconciliada por **P1**;
- §26.1 (tabela consolidada — total de endpoints implícito) — clarificação por **P1**.

Tudo o que não for tocado nesta v2.0.2 permanece como em Consolidated v2.0 + patch v2.0.1. Em caso de conflito, prevalece v2.0.2 nas seções enumeradas.

**Pacote canônico Provider Coverage Matrix após este patch:** Consolidated v2.0 + v2.0.1 + v2.0.2 (lidos juntos).

---

## 2. Patch P1 — Reconciliar contagem de endpoints (28 → 30 endpoint_coverage entries)

**Problema resolvido:** Matrix Consolidated §27 declarava "endpoints obrigatórios funcionais em PR2 | 28". A apuração precisa derivada da soma de `endpoint_coverage[].length` por capability resulta em **30**, conforme apurado pela Peça A v2.2 §3.5 e refletido em `provider-coverage-expected.ts`.

A diferença vem de duas capabilities `.create` + `.stream` (Anthropic e OpenAI Chat Completions) compartilharem o mesmo path HTTP mas serem capabilities distintas com `endpoint_coverage[1]` cada uma:

- `anthropic.messages.create` (POST /v1/messages, `streams: false`) + `anthropic.messages.stream` (POST /v1/messages, `streams: true`) = 2 entries em endpoint_coverage agregadas;
- `openai.chat.completions.create` (POST /v1/chat/completions, `streams: false`) + `openai.chat.completions.stream` (POST /v1/chat/completions, `streams: true`) = 2 entries idem.

Matrix v2 Consolidated deduplicou implicitamente quando computou §27. A Peça A v2.2 mantém contagem por entrada de `endpoint_coverage[]`, que é a unidade que o **gate técnico** (`validate-matrix-counts.ts` comparando `actual.endpoint_coverage.length` contra `expected.endpoint_count`) usa.

**Decisão canônica:** o gate técnico de PR2 usa **endpoint_coverage entries**, não a contagem HTTP method/path deduplicada. Esse é o número autoritativo.

### 2.1 Substituição em §27 — Escopo numérico total em PR2

Substituir a tabela inteira de §27 por:

```diff
| dimensão | total |
|---|---|
| capabilities `supported` em PR2 (com endpoint próprio) | 16 |
| capabilities tool `supported` em PR2 (via classifier) | 3 |
| **total `supported` em PR2** | **19** |
- | endpoints obrigatórios funcionais em PR2 | 28 |
+ | endpoint_coverage entries (gate técnico) em PR2 | **30** |
+ | unique HTTP (method, path) pairs em PR2 (informativo) | 27 |
| capabilities `planned` (PR3+) | 22 |
| capabilities `blocked` (architectural prerequisite) | 2 |
| capabilities/famílias `not_exposed` | 5 |
- | **total registry universe Anthropic + OpenAI** | **48** |
+ | **total registry universe Anthropic + OpenAI** | **48** |
| **batches stretch (Batch D)** | 2 (`anthropic.message_batches` + `openai.batches`) |
```

Adicionar nota explicativa logo abaixo da tabela:

```yaml
Notas sobre contagem de endpoints (canônico):

1. Unidade autoritativa para gate técnico:
   endpoint_coverage entries = soma de endpoint_coverage[].length sobre capabilities `supported`.
   Total em PR2 (sem Batch D) = 30.

2. Decomposição:
   Anthropic supported endpoints (5 capabilities):
     - anthropic.messages.create:        1 entry  (POST /v1/messages, streams: false)
     - anthropic.messages.stream:        1 entry  (POST /v1/messages, streams: true)
     - anthropic.messages_meta:          1 entry  (POST /v1/messages/count_tokens)
     - anthropic.models:                 2 entries (GET /v1/models, GET /v1/models/{id})
     - anthropic.files:                  5 entries (POST, GET-list, GET-meta, DELETE, GET-content)
     subtotal Anthropic:                10 entries
   
   OpenAI supported endpoints (11 capabilities):
     - openai.responses.create:                  1 entry  (POST /v1/responses, streams: false)
     - openai.responses.stream:                  1 entry  (POST /v1/responses, streams: true)
     - openai.chat.completions.create:           1 entry  (POST /v1/chat/completions, streams: false)
     - openai.chat.completions.stream:           1 entry  (POST /v1/chat/completions, streams: true)
     - openai.models:                            2 entries (GET /v1/models, GET /v1/models/{id})
     - openai.models.delete:                     1 entry  (DELETE /v1/models/{id})
     - openai.embeddings:                        1 entry  (POST /v1/embeddings)
     - openai.files:                             5 entries (POST, GET-list, GET-meta, DELETE, GET-content)
     - openai.vector_stores:                     5 entries (POST, GET-list, GET-store, POST-files, GET-files)
     - openai.vector_stores.delete:              1 entry  (DELETE /v1/vector_stores/{id})
     - openai.vector_stores.files.delete:        1 entry  (DELETE /v1/vector_stores/{id}/files/{file_id})
     subtotal OpenAI:                           20 entries
   
   TOTAL endpoint_coverage entries em PR2 (sem Batch D)     = 30

3. Métrica informativa (HTTP method/path deduplicados):
   Mesmas capabilities deduplicando por par (method, path):
     Anthropic:                  9 unique pairs
     OpenAI:                    18 unique pairs
     TOTAL unique HTTP pairs:   27
   
   Esta métrica é apenas informativa. Capabilities .create e .stream que
   compartilham path HTTP contam como 1 par único, mas são 2 capabilities
   distintas com endpoint_coverage[1] cada — o gate técnico usa entries, não pairs.

4. Em PR2 com Batch D promovido:
   - acrescenta endpoints de anthropic.message_batches (≈6) e openai.batches (≈4);
   - total endpoint_coverage entries = ~40;
   - unique HTTP method/path pairs = ~37;
   - apuração exata em momento de promoção via script `validate-matrix-counts.ts`.
```

### 2.2 Substituição em §26.1 — clarificação na tabela consolidada

Atualizar a linha-resumo final de §26.1 substituindo:

```diff
- **Total `supported` com endpoints: 16 capabilities cobrindo 28 endpoints.**
+ **Total `supported` com endpoints: 16 capabilities cobrindo 30 endpoint_coverage entries
+   (27 unique HTTP method/path pairs).**
```

### 2.3 Implicação para o gate técnico

`validate-matrix-counts.ts` (Peça A v2.2 §3.3) compara `actual.endpoint_coverage.length` por capability contra `expected.endpoint_count`. Esta soma agregada é **30** em PR2 (sem Batch D). O reporting do script alinha-se canonicamente com Matrix v2.0.2.

Não há alteração de código necessária no script — ele já está correto. Esta v2.0.2 alinha a Matrix narrativa à apuração já implementada em Peça A v2.2.

---

## 3. Patch P2 — Normalizar `claude_agent.*` para `anthropic.claude_agent.*`

**Problema resolvido:** Matrix Consolidated §8 (universo Anthropic) e §10.5 (descrição) usavam `claude_agent.*` sem namespace. `provider-coverage-expected.ts` em Peça A v2.2 §3.2 usa `anthropic.claude_agent.*` com namespace, por consistência com `anthropic.admin.*`. Divergência puramente narrativa, mas pode confundir Claude Code se Matrix é a fonte de verdade.

**Decisão canônica:** id padrão em registry, expected.ts e narrativa Matrix é `anthropic.claude_agent.*` (com namespace).

### 3.1 Substituição em §8 — universo Anthropic

Atualizar a linha da tabela:

```diff
- | `claude_agent.*` (server-side Cenário B) | planned (PR7+) | n/a | varia | n/a | depende de sandbox |
+ | `anthropic.claude_agent.*` (server-side Cenário B) | planned (PR7+) | n/a | varia | n/a | depende de sandbox |
```

### 3.2 Substituição em §10.5 — heading e referências

Substituir título da subseção:

```diff
- ### 10.5 `claude_agent.*` (Cenário B server-side)
+ ### 10.5 `anthropic.claude_agent.*` (Cenário B server-side)
```

Substituir parágrafo introdutório:

```diff
- Família mantida exatamente como em ADP v4.2 §14.3 e Addendum v4.2.2 §3.2 + §10.
- Não detalhada nesta seção porque não pertence a passthrough Anthropic — pertence
- a future server-side runtime do GovAI.
+ Família server-side Cenário B (Agent SDK em compute GovAI), conforme ADP v4.2 §14.3
+ e Addendum v4.2.2 §3.2 + §10. Não detalhada nesta seção porque não pertence a
+ passthrough Anthropic — pertence a future server-side runtime do GovAI.
+
+ Id canônico no registry: `anthropic.claude_agent.*` (com namespace por consistência
+ com `anthropic.admin.*` e demais capabilities Anthropic).
```

Atualizar referências aos sub-ids dentro da família:

```diff
- - `claude_agent.query` / `claude_agent.session` / `claude_agent.workspace_context`: planned PR7+ (Risk A, sem ação local server-side).
- - `claude_agent.file_read`: planned PR7+ (Risk B).
- - `claude_agent.file_edit`: planned PR7+ (Risk C-D, exige sandbox).
- - `claude_agent.bash` / `claude_agent.computer_use`: planned PR8+ (Risk D, exige sandbox primitive).
+ - `anthropic.claude_agent.query` / `anthropic.claude_agent.session` / `anthropic.claude_agent.workspace_context`: planned PR7+ (Risk A, sem ação local server-side).
+ - `anthropic.claude_agent.file_read`: planned PR7+ (Risk B).
+ - `anthropic.claude_agent.file_edit`: planned PR7+ (Risk C-D, exige sandbox).
+ - `anthropic.claude_agent.bash` / `anthropic.claude_agent.computer_use`: planned PR8+ (Risk D, exige sandbox primitive).
```

### 3.3 Outras ocorrências em Matrix

Revisão das outras ocorrências de `claude_agent.*` na Matrix Consolidated:

- §7.4 (forward-compat de area-level) — não menciona claude_agent.* explicitamente; sem alteração;
- §9.x (capabilities supported Anthropic) — não menciona; sem alteração;
- §10.1-§10.4 (planned Anthropic outros) — sem referência cruzada; sem alteração.

### 3.4 Sem mudança em ADP v4.2 nem Addendum v4.2.2

ADP v4.2 §14.3 e Addendum v4.2.2 §3.2 + §10 podem manter referência a `claude_agent.*` em narrativa de roadmap conceitual. Esses documentos são canônicos imutáveis e não são patcheados. A normalização ocorre apenas nas camadas operacionais (Matrix runtime mapping + registry + expected.ts).

Em conflito interpretativo entre ADP/Addendum (`claude_agent.*` em narrativa) e Matrix v2.0.2 + Peça A v2.2 (`anthropic.claude_agent.*` como id canônico de registry), a Matrix v2.0.2 prevalece para fins de implementação e gate técnico.

---

## 4. Critério de aceitação do patch

Esta v2.0.2 é aceita como reconciliação final do pacote canônico se, em conjunto com Consolidated v2.0 + patch v2.0.1:

- [ ] **P1:** §27 reflete 30 endpoint_coverage entries como número canônico do gate técnico; 27 unique HTTP method/path pairs como métrica informativa; nota explicativa com decomposição por capability presente;
- [ ] **P1:** §26.1 linha-resumo final atualizada para "16 capabilities cobrindo 30 endpoint_coverage entries (27 unique HTTP method/path pairs)";
- [ ] **P2:** §8 (universo Anthropic) usa `anthropic.claude_agent.*`;
- [ ] **P2:** §10.5 heading e parágrafo introdutório usam `anthropic.claude_agent.*`; sub-ids da família atualizados (`anthropic.claude_agent.query`, etc.);
- [ ] nenhuma outra seção da Matrix alterada além das listadas;
- [ ] Peça A v2.2 (`provider-coverage-expected.ts` com `anthropic.claude_agent.*` e `endpoint_count: 30 total`) e Matrix v2.0.2 ficam consistentes lado a lado.

Após aceite, o pacote canônico de execução PR2 fica internamente consistente e **pronto para autorização explícita de execução**.

---

## 5. Não-objetivos

Esta v2.0.2 **não**:

- altera capabilities (status, level, base_risk_class, tier_availability, enforcement_default);
- altera batches da Peça A (F/A/C/G/D/M/L);
- altera schemas Zod (`PassthroughInvokedSchema`, `Pr2ExecutionConfigSchema`, etc.);
- altera tool classifiers (Anthropic ou OpenAI);
- altera `BetaTokenPolicy` enum, `ANTHROPIC_BETA_POLICY` ou `OPENAI_BETA_POLICY`;
- altera ADRs (ADR-014 obrigatório; ADR-015 condicional; ADR-016 condicional);
- altera Peça A v2 / v2.1 / v2.2 (todas mantidas como são);
- altera ADP v4.2 ou Addendum v4.2.2 (canônicos imutáveis);
- altera escopo de PR2 (capabilities `supported`, `planned`, `blocked`, `not_exposed` permanecem);
- altera Human Architect Escalation procedure;
- altera regra de autorização de Batch D (apenas via `pr2-execution-config.yaml` versionado).

---

## 6. Próximo passo

Sequência canônica após aceite deste patch:

1. **Auditoria do patch v2.0.2** (você + GPT, opcional).
2. **Pacote canônico de execução PR2 fica completo e consistente:**
   - ADP v4.2 (`ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254`)
   - Addendum v4.2.2
   - Provider Coverage Matrix v2 = Consolidated v2.0 (`604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777`) + patch v2.0.1 (`1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e`) + patch v2.0.2 (este documento)
   - Peça A v2 (`5831418000c00a38a0204f24293748490b9dddb1d7fdb82afa8b6f9a185cefcc`)
   - Peça A v2.1 patch (`9d5825d6dc93fc13349a688b04a2e0cc319c35ee6932dc1d03c84c60f1b7d190`)
   - Peça A v2.2 patch (`649e762c40edb15be0bb65f92596575ece13ac890394d7c2aeeb322e4c475c8e`)

3. **Decisão arquitetural sobre Batch D antes da execução:**
   - default: nenhuma ação adicional → Batch D deferred;
   - promoção: criar `docs/architecture/pr2-execution-config.yaml` no repositório com flag `batch_d_promote: true` + reason (≥20 chars) + authorized_by + authorized_at (passado, ISO).

4. **Autorização explícita de execução** pelo arquiteto humano via mensagem (após aceite global do pacote canônico de 7 documentos hashados).

5. **Geração do comando final de execução Claude Code** — apenas após (4).

6. **Execução Claude Code** com pacote canônico — apenas após comando explícito gerado e aprovado.

Em paralelo: **não gerar comando final de execução para Claude Code antes da autorização explícita.**

---

**Fim da Provider Coverage Matrix v2.0.2 — Count Reconciliation Patch.**
