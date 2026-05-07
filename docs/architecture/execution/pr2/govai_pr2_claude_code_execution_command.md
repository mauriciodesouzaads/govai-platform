# GovAI PR2 — Comando Final de Execução Claude Code

**Versão:** comando final de execução (canônico)
**Data de autorização:** 2026-05-06
**Autorizador:** arquiteto humano (Mauricio de Souza, GovAI)
**Destinatário:** Claude Code (instância de execução agêntica)
**Status:** **AUTORIZADO PARA EXECUÇÃO**

---

## 0. Comando

Você (Claude Code) está autorizado a executar **PR2 — Native Provider Substrate** do GovAI, conforme o pacote canônico verificado abaixo, **sem promover Batch D**, na branch `feat/pr2-native-provider-substrate`, com auto-verificação obrigatória de pré-condições antes de qualquer alteração.

Esta autorização é **operacional** (cobre execução do PR2 conforme especificação), não é blanket. Modificações fora do escopo explicitado nos documentos canônicos exigem **Human Architect Escalation** (procedimento em Peça A v2 §4) — você **não tem autonomia para alterar escopo, capabilities, ou pacote canônico**.

---

## 1. Pacote canônico — verificação obrigatória de hashes

Antes de qualquer ação no repositório, calcule SHA-256 dos 8 documentos canônicos abaixo e confirme bit-a-bit. Se algum hash divergir, **PARE imediatamente** e reporte com `## ⚠️ HUMAN_ARCHITECT_ESCALATION_REQUIRED — canonical package hash mismatch`.

| # | Documento | Hash SHA-256 esperado | Papel |
|---|---|---|---|
| 1 | `govai_adp_v4_2.md` | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` | base canônica conceitual (capability registry, Tier Policy Matrix, audit chain) |
| 2 | `govai_adp_v4_2_2_addendum.md` | (gerado em 2026-05-06; verificar disponibilidade) | restringe v4.2; **Macro Native Substrate Contract**; PR2 = Native Provider Substrate |
| 3 | `govai_pr2_provider_coverage_matrix_v2.md` | `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777` | Matrix Consolidated v2.0 |
| 4 | `govai_pr2_provider_coverage_matrix_v2_0_1_patch.md` | `1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e` | Matrix v2.0.1 (Starter destrutivos, P2 hash, P3 type:null OpenAI) |
| 5 | `govai_pr2_provider_coverage_matrix_v2_0_2_patch.md` | `5b59ccd40bd9baddaef65ed1c76e665d680929da6bec6f59127c0be1ae336c15` | Matrix v2.0.2 (count 30, namespace anthropic.claude_agent.*) |
| 6 | `govai_pr2_peca_a_v2_prompt_claude_code.md` | `5831418000c00a38a0204f24293748490b9dddb1d7fdb82afa8b6f9a185cefcc` | Peça A v2 — base operacional |
| 7 | `govai_pr2_peca_a_v2_1_patch.md` | `9d5825d6dc93fc13349a688b04a2e0cc319c35ee6932dc1d03c84c60f1b7d190` | Peça A v2.1 (5 blockers + 3 minor) |
| 8 | `govai_pr2_peca_a_v2_2_patch.md` | `649e762c40edb15be0bb65f92596575ece13ac890394d7c2aeeb322e4c475c8e` | Peça A v2.2 (47→48, endpoint_count, YAML-only Batch D) |

### 1.1 Regra de precedência canônica

Em conflito interpretativo entre documentos:

1. **Matrix v2 Consolidated + v2.0.1 + v2.0.2** prevalece para: coverage, contagem, nomenclatura de capabilities, status, endpoint_coverage, beta tokens.
2. **ADP v4.2 + Addendum v4.2.2** prevalece para: arquitetura geral (capability registry, Tier Policy Matrix, audit chain, Macro Native Substrate Contract).
3. **Peça A v2 + v2.1 + v2.2** é o prompt operacional para você. Em conflito interpretativo entre Peça A e os canônicos superiores, prevalecem os canônicos.

Se você detectar contradição interna entre os documentos do pacote canônico que **não** seja resolvida pela regra acima, **acione Human Architect Escalation**.

---

## 2. Decisão canônica sobre Batch D — DEFERRED

**Batch D está EXPLICITAMENTE DIFERIDO neste PR2.** Você **NÃO promove Batch D**.

Implicações operacionais imutáveis para esta execução:

- ❌ **NÃO criar** `docs/architecture/pr2-execution-config.yaml`;
- ❌ **NÃO** alterar status de `anthropic.message_batches` ou `openai.batches` para `supported` — ambas permanecem `planned`, `planned_phase: 'PR4'`;
- ❌ **NÃO gerar** `ADR-016`;
- ✅ **Resolver** entries de `ANTHROPIC_BETA_POLICY` para `message-batches-2024-09-24` e `output-300k-2026-03-24` em estado final (`denied_until_decision` ou `removed_as_no_longer_needed` conforme verificação técnica em Batch M §11.3);
- ✅ **Registrar** `docs/architecture/escalations/PR2-ESC-batch-d-deferred.md` documentando o diferimento como decisão arquitetural explícita do arquiteto humano.

Se você for tentado a promover Batch D por qualquer motivo (ex.: "havia tempo orçamentário"), **PARE**. Promoção exige `pr2-execution-config.yaml` versionado **criado pelo arquiteto humano** — neste PR2, o arquivo **não foi criado** e **não deve ser criado**.

---

## 3. Branch e ambiente de trabalho

### 3.1 Branch canônica

```
feat/pr2-native-provider-substrate
```

Todos os commits do PR2 devem estar nesta branch. Convenção de mensagens: Conventional Commits, em inglês ou português conforme convenção do repositório.

### 3.2 Repositório

```
github.com/mauriciodesouzaads/govai-platform
```

Estado inicial esperado: pós-PR1 (109 tests passando, ADRs 001-013 aceitos, baseline estabelecido — verificar conforme Peça A v2 §2).

### 3.3 Stack confirmada (verificar)

- pnpm monorepo, Node 24, Zod 4, Fastify, Postgres
- `@anthropic-ai/sdk@0.92.0` em `packages/provider-anthropic/`
- `openai@6.35.0` em `packages/provider-openai/`
- ADR-003 (provider-native, sem GenericLLMRequest) em vigor

### 3.4 Variáveis de ambiente para live tests

Conforme Peça A v2.1 §B3:

```
GOVAI_LIVE_TESTS=1                 # ativa suite live; sem isso, tests live são skipped
ANTHROPIC_API_KEY=sk-ant-...       # chave Anthropic live
OPENAI_API_KEY=sk-...              # chave OpenAI live
ANTHROPIC_LIVE_MODEL=...           # modelo Anthropic para tests live
OPENAI_LIVE_MODEL=...              # modelo OpenAI para tests live
GOVAI_LIVE_TEST_BUDGET_USD=10.00   # orçamento máximo por execução; default sugerido $10
```

Aliases aceitos (apenas compatibilidade): `ANTHROPIC_LIVE_TEST_KEY`, `OPENAI_LIVE_TEST_KEY`. Padrão é usar nomes canônicos acima.

---

## 4. Sequência operacional canônica

Execute na ordem exata abaixo. **Não pule etapas.** Cada batch tem critério de saída em Peça A v2; não inicie o próximo batch sem o critério do anterior atendido.

### 4.1 Pré-flight (obrigatório antes de qualquer commit)

1. **Ler integralmente** os 8 documentos do pacote canônico (§1).
2. **Verificar hashes** SHA-256 dos 8 documentos.
3. **Inspecionar repositório:**
   - estrutura `packages/`, `db/migrations/`, `tests/`;
   - ADRs existentes (`docs/architecture/adr/ADR-001` a `ADR-013`);
   - SDKs instalados nos package.json;
   - rotas baseline retornando 503 conforme esperado (Peça A v2 §2.3);
   - registry baseline (8 capabilities `planned`, `ANTHROPIC_BETA_ALLOWLIST` vazia).
4. **Confirmar pré-condições da Peça A v2 §2.** Se alguma falhar → Human Architect Escalation.
5. **Confirmar Batch D = deferred** lendo este comando final + verificando ausência de `docs/architecture/pr2-execution-config.yaml`.

Após pré-flight bem-sucedido, criar branch `feat/pr2-native-provider-substrate` e iniciar Batch F.

### 4.2 Sequência de batches (sem Batch D)

```
F → A → C → G → M → L
```

| Batch | Objetivo | Critério de saída | Ref Peça A |
|---|---|---|---|
| **F** | Foundation: tipos, schemas, migration `0007_org_beta_overrides`, BetaTokenPolicy enum, helpers | §6.5 | Peça A v2 §6 |
| **A** | Anthropic Substrate: 5 capabilities supported + `web_search_tool` + ANTHROPIC_BETA_POLICY + tool classifier (com regra `type:null` distinta de `undefined`) + ADR-014 obrigatório | §7.7 | Peça A v2 §7 + v2.1 §B1 |
| **C** | OpenAI Substrate: 11 capabilities supported (incluindo `vector_stores.delete` e `.files.delete` com Starter via `ask`) + 2 tool capabilities + OPENAI_BETA_POLICY + tool classifier + purpose=assistants warning/sunset | §8.8 | Peça A v2 §8 + v2.1 §B2 |
| **G** | Governed Run pipeline para 6 capabilities `policy_governed` (anthropic.messages.create/stream + openai.responses.create/stream + chat.completions.create/stream) | §9.5 | Peça A v2 §9 |
| **M** | Matrix consistency + 9 pre-merge gates + `validate-matrix-counts.ts` (com `endpoint_count: number`, não `has_endpoints`) + resolução de `verification_required` (prompt-caching → ADR-015 condicional) | §11.5 | Peça A v2 §11 + v2.1 §B4 + v2.2 §F2 |
| **L** | Live tests opt-in: popular `last_live_test_at` para 19 capabilities `supported` | §12.4 | Peça A v2 §12 + v2.1 §B3 |

### 4.3 Decisões já fixadas no pacote canônico (não reabrir)

- `EXPECTED_PR2_CAPABILITIES` em `packages/registry/src/provider-coverage-expected.ts` tem 48 entries com `endpoint_count: number`. Total endpoint_coverage entries esperado em PR2 = **30**.
- ID canônico da família server-side futura é **`anthropic.claude_agent.*`** (com namespace), conforme Matrix v2.0.2.
- Tool classifier Anthropic: `type:null` explícito → `anthropic_typed_unknown`; `type` ausente (chave não existe) → `client_defined`. Distinção obrigatória.
- Tool classifier OpenAI: ausência, `null`, vazio, whitespace, não-string → `openai_typed_unknown`.
- `PassthroughInvokedSchema` schema_version 3 com regra P2: `native_response_hash` obrigatório para qualquer non-stream raw, incluindo 4xx/5xx do provider.
- `org_beta_overrides` é a **única tabela física nova** autorizada em PR2. Constraint impede override para token `hard_denied`.
- ADR-014 (Allow `files-api-2025-04-14` global) **obrigatório**.
- ADR-015: condicional bilateral, criar **apenas após** verificação técnica em §11.3.1.
- ADR-016 (Batches global allowlist): **NÃO criar** — Batch D deferred.

---

## 5. Critérios de qualidade durante execução

Em cada batch, antes de marcar como concluído:

- [ ] `pnpm typecheck` passa sem erros;
- [ ] `pnpm lint` passa sem erros;
- [ ] `pnpm test` (suite hermético) passa em 100%;
- [ ] coverage não regride do baseline PR1 (109 tests);
- [ ] commits em Conventional Commits, mensagens claras;
- [ ] nenhum arquivo deletado fora do escopo do batch;
- [ ] nenhuma rota retornando 503/501 para endpoint do Macro Native Substrate;
- [ ] nenhuma rota retornando wrapper JSON envolvendo native response.

Em Batch L (live tests, opt-in):

- [ ] se `GOVAI_LIVE_TESTS=1` definido + chaves disponíveis: suite live executa, popula `last_live_test_at` para 19 capabilities `supported`, custo total ≤ `GOVAI_LIVE_TEST_BUDGET_USD`;
- [ ] se variáveis não definidas: suite live skipped (não falha CI público);
- [ ] PR description deve documentar execução live (timestamp, custo total, modelos usados).

---

## 6. Forbidden actions — lista vermelha consolidada

Você **NUNCA** pode fazer qualquer ação abaixo durante esta execução. Tentativa = falha do PR2.

- ❌ NUNCA promover Batch D (independentemente de "tempo disponível" ou qualquer raciocínio interno);
- ❌ NUNCA criar `docs/architecture/pr2-execution-config.yaml`;
- ❌ NUNCA gerar ADR-016;
- ❌ NUNCA introduzir tabela física nova além de `org_beta_overrides`;
- ❌ NUNCA introduzir `'family_alias'` no enum `CapabilityStatus`;
- ❌ NUNCA criar `govai.capability_decomposition_map`;
- ❌ NUNCA tratar `type: null` em tool Anthropic como `client_defined`;
- ❌ NUNCA permitir override de token `hard_denied` via `org_beta_overrides`;
- ❌ NUNCA marcar capability essential como `planned` silenciosamente para escapar de implementação;
- ❌ NUNCA retornar 503 `pipeline_incomplete_*` ou 501 em endpoint do Macro Native Substrate;
- ❌ NUNCA introduzir wrapper JSON envolvendo native response;
- ❌ NUNCA introduzir `GenericLLMRequest` ou normalização lossy entre providers;
- ❌ NUNCA permitir `body_forward_mode='redacted'` em capability `passthrough_audited`;
- ❌ NUNCA emitir audit event sem `tools_taxonomy_version` quando há classificações de tool;
- ❌ NUNCA executar workaround silencioso quando o procedimento é Human Architect Escalation;
- ❌ NUNCA proceder com `verification_required` em `BETA_POLICY` em runtime production após o merge;
- ❌ NUNCA modificar ADP v4.2 ou Addendum v4.2.2 (canônicos imutáveis);
- ❌ NUNCA introduzir capability fora dos universos Anthropic + OpenAI da Matrix durante PR2;
- ❌ NUNCA duplicar paths `/v1/v1/...` no passthrough;
- ❌ NUNCA pular live tests se as variáveis de ambiente estiverem disponíveis;
- ❌ NUNCA fazer commit direto na branch `main` ou em qualquer branch que não seja `feat/pr2-native-provider-substrate`;
- ❌ NUNCA force-push em branch compartilhada;
- ❌ NUNCA executar destruição de dados (truncate, drop) em ambiente de teste sem isolation explícito (Testcontainers).

---

## 7. Pre-merge gates obrigatórios (Batch M)

Implementar todos os 9 gates de Matrix §28 como integration tests:

| # | Gate | Test path |
|---|---|---|
| 28.1 | Schema canônico (`CapabilityStatus` 4 valores; sem `family_alias`) | `tests/integration/schema/capability-schema-v4.2.test.ts` |
| 28.2 | BetaTokenPolicy sem `verification_required` em runtime | `tests/integration/governance/beta-policy-no-verification-pending.test.ts` |
| 28.3 | Tool taxonomy (Anthropic + OpenAI; com regra `type:null`) | `tests/integration/{anthropic,openai}/tool-classifier.test.ts` |
| 28.4 | Provider Coverage Matrix consistency (script `validate-matrix-counts`) | `tests/integration/governance/registry-matrix-consistency.test.ts` |
| 28.5 | Unknown endpoint → 403 `capability_not_registered` | `tests/integration/governance/unknown-endpoint.test.ts` |
| 28.6 | baseURL compatibility SDK (sem `/v1/v1/`) | `tests/integration/{anthropic,openai}/sdk-baseurl.test.ts` |
| 28.7 | PassthroughInvokedSchema v3 (5 regras superRefine) | `tests/integration/audit/passthrough-invoked-schema.test.ts` |
| 28.8 | Live tests opt-in para capabilities supported | `tests/live/**` |
| 28.9 | No temporary routes (zero 503/501 em endpoints supported) | `tests/integration/governance/no-temporary-routes.test.ts` |

`pr2-execution-config.test.ts` (7 casos canônicos de Peça A v2.2 §F3) entra como teste auxiliar mesmo com Batch D deferred — valida o schema Zod do YAML hipotético.

---

## 8. Relatório final exigido

Ao concluir o PR2 (independentemente de sucesso completo ou parcial), gerar `docs/architecture/PR2-EXECUTION-REPORT.md` com **todas** as seções abaixo. **Sem este relatório, PR2 não é considerado concluído.**

### 8.1 Estrutura mínima do relatório

```markdown
# GovAI PR2 — Execution Report

## 1. Metadados
- branch: feat/pr2-native-provider-substrate
- commit final: <SHA>
- início: <ISO timestamp>
- fim: <ISO timestamp>
- pacote canônico verificado (8 hashes confirmados): sim/não
- Batch D: deferred (canônico) / não promovido

## 2. Arquivos alterados
- contagem total: <N>
- por package: provider-anthropic (<N>), provider-openai (<N>), core-types (<N>), ...
- migrations adicionadas: 0007_org_beta_overrides.sql
- arquivos removidos: <lista> (se houver)

## 3. Capabilities implementadas
- supported (com endpoint próprio): <count>
- supported (tools via classifier): <count>
- planned: <count>
- blocked: <count>
- not_exposed: <count>
- TOTAL: <count> capabilities (esperado: 48)
- endpoint_coverage entries totais: <count> (esperado em PR2 sem Batch D: 30)
- diff vs EXPECTED_PR2_CAPABILITIES: nenhum / <lista de divergências>

## 4. Testes
- baseline PR1: 109 tests
- novos tests adicionados: <count>
- total tests passando: <count>
- coverage: <%>
- regressões: nenhuma / <lista>

## 5. Live evidence (se executado)
- GOVAI_LIVE_TESTS: 1 / unset
- timestamp da execução: <ISO>
- custo total observado: USD <valor>
- budget configurado: USD <valor>
- modelos usados:
  - ANTHROPIC_LIVE_MODEL: <id>
  - OPENAI_LIVE_MODEL: <id>
- last_live_test_at populado para: <count> de 19 capabilities supported

## 6. ADRs criados
- ADR-014 (allow files-api-2025-04-14 global): SIM (obrigatório)
- ADR-015: variante <not-needed | allow-prompt-caching> conforme verificação em §11.3.1
- ADR-016: NÃO criado (Batch D deferred — canônico)

## 7. Pre-merge gates (Matrix §28)
| Gate | Status |
|---|---|
| 28.1 schema | passou / falhou |
| 28.2 beta_policy_no_verification_pending | passou / falhou |
| 28.3 tool_taxonomy | passou / falhou |
| 28.4 matrix_consistency | passou / falhou |
| 28.5 unknown_endpoint | passou / falhou |
| 28.6 sdk_baseurl | passou / falhou |
| 28.7 passthrough_invoked_schema | passou / falhou |
| 28.8 live_tests_optin | passou / skipped / falhou |
| 28.9 no_temporary_routes | passou / falhou |

## 8. Verification_required resolução
- prompt-caching-2024-07-31: <removed_as_no_longer_needed | global_allowlist via ADR-015>
  - método de verificação: <doc + live test + descrição>
  - referência: docs/architecture/verifications/PR2-VER-prompt-caching.md
- message-batches-2024-09-24: <denied_until_decision | removed_as_no_longer_needed>
  - método de verificação: <descrição>

## 9. Decisões fixadas durante execução
- listar com link ao ADR/comentário/escalation correspondente

## 10. Gaps e fallback declarável (deferido para PR3+)
- listar conforme Matrix §2.5 (escopo restrito): hashing chunked multipart, evidence_strength, output DLP em conteúdo de arquivos, otimizações streaming multipart

## 11. Escalations acionadas
- listar arquivos `docs/architecture/escalations/PR2-ESC-NNN.md` criados, com motivo e status

## 12. Itens Forbidden — verificação
| Item | OK / Violação |
|---|---|
| Batch D promovido | OK (deferred) |
| pr2-execution-config.yaml criado | OK (não criado) |
| ADR-016 gerado | OK (não gerado) |
| 503/501 em supported | OK / violação |
| capability fora da Matrix | OK / violação |
| ... (todos os 23 itens da §6 deste comando) ... | OK / violação |

## 13. Acceptance criteria (Peça A v2 §15)
| Categoria | Status |
|---|---|
| §15.1 Architecture & schema | passou / falhou |
| §15.2 Provider implementations | passou / falhou |
| §15.3 Audit & schemas | passou / falhou |
| §15.4 ADRs | passou / falhou |
| §15.5 Tests | passou / falhou |
| §15.6 Forbidden | passou / falhou |

## 14. Próximos passos sugeridos (informativos)
- recomendações para PR3+, sem comprometer escopo do PR2;
- ex.: implementar moderations API, output DLP em files content, evidence chain criptográfica E2E.

## 15. Pendências e bloqueios
- listar qualquer item do critério de aceitação que não foi cumprido, com:
  - motivo;
  - alternativas técnicas avaliadas;
  - recomendação;
  - estado: aguardando arquiteto humano / pode ser resolvido em PR3.
```

### 8.2 Critério para abrir PR de merge

Você só deve abrir PR de merge se:

1. todos os 9 pre-merge gates passam;
2. todos os itens da §15 da Peça A v2 estão verde;
3. Batch D explicitamente **não promovido**;
4. nenhum item da lista vermelha (§6 deste comando) violado;
5. live tests executados com `GOVAI_LIVE_TESTS=1` e budget respeitado (se variáveis disponíveis);
6. relatório final completo gerado.

Se algum dos critérios não estiver atendido, **NÃO abra PR de merge**. Em vez disso, registre escalation final conforme Peça A v2 §18.

---

## 9. Procedimento de escalation durante execução

Acionar Human Architect Escalation conforme Peça A v2 §4 quando:

- endpoint do Macro Native Substrate descoberto como impossível de implementar com SDK 0.92.0 / 6.35.0;
- documentação do provider divergir do mapeamento da Matrix em ponto material;
- live test falhar para capability `supported` obrigatória após retry razoável;
- conflito interpretativo entre dois documentos canônicos não resolvido pela §1.1 deste comando;
- gate pré-merge não passa após esforço razoável e diagnóstico aponta decisão arquitetural;
- token beta `verification_required` não pode ser resolvido por verificação técnica simples;
- comportamento do SDK incompatível com expectativa documentada;
- dúvida material sobre escopo (lembrete: a resposta nunca é "promover Batch D").

Procedimento (Peça A v2 §4.2):

1. **PARAR** o trabalho no batch corrente.
2. Não tentar workaround silencioso.
3. Abrir `docs/architecture/escalations/PR2-ESC-NNN.md` com data, batch, descrição, referências, alternativas, recomendação, decisão pendente.
4. Reportar com header `## ⚠️ HUMAN_ARCHITECT_ESCALATION_REQUIRED` no fim da sua resposta.
5. **Aguardar resolução** antes de retomar.

---

## 10. Confirmação inicial obrigatória

Antes de iniciar qualquer batch, sua **primeira resposta** após receber este comando deve ser uma **confirmação de leitura** estruturada:

```
## PR2 Execution — Pre-flight confirmation

1. Pacote canônico (8 documentos):
   - hashes verificados: <sim/não>
   - hashes divergentes: <lista, se houver>

2. Princípios canônicos confirmados:
   - O macro nasce como arquitetura. <sim/não>
   - Podemos dividir a execução. Não podemos dividir a arquitetura. <sim/não>
   - Deep governance pode ser incremental. Native availability essencial não pode parecer capada. <sim/não>

3. Decisão sobre Batch D:
   - Batch D = deferred (canônico). <confirmado>
   - pr2-execution-config.yaml NÃO existe e NÃO será criado. <confirmado>
   - ADR-016 NÃO será gerado. <confirmado>

4. Pré-condições do repositório (Peça A v2 §2):
   - branch base: <branch atual>
   - tests baseline (109): <passando/regredidos>
   - SDKs instalados: anthropic@<ver>, openai@<ver>
   - rotas baseline em 503: <confirmado/divergente>
   - registry baseline (8 capabilities planned): <confirmado/divergente>

5. Variáveis de ambiente live tests:
   - GOVAI_LIVE_TESTS: <set/unset>
   - chaves disponíveis: <sim/não>
   - budget configurado: USD <valor>

6. Sequência operacional autorizada:
   F → A → C → G → M → L (sem Batch D)

7. Lista vermelha (§6 deste comando) — total 23 itens:
   - lida e compreendida. <sim/não>

8. Procedimento de Human Architect Escalation:
   - lido e compreendido. <sim/não>

9. Branch de trabalho:
   - feat/pr2-native-provider-substrate. <confirmado>

10. Início autorizado:
    - <PROSSEGUIR PARA BATCH F>
    OU
    - <ESCALATION REQUIRED — motivo: ...>
```

Após esta confirmação, e somente após, inicie Batch F.

---

## 11. Encerramento

Este comando é canônico para o PR2. Após geração e merge bem-sucedidos do PR2, gere o relatório final (§8) e aguarde sinal do arquiteto humano para PR3.

Não inicie PR3 sob nenhuma circunstância sem autorização explícita separada.

---

**FIM DO COMANDO FINAL DE EXECUÇÃO PR2.**

**Autorização concedida — Mauricio de Souza, GovAI Architect — 2026-05-06.**
