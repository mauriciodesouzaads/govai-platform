# GovAI PR2 — Comando Final de Execução Claude Code — Patch v1.1

**Versão:** v1.1 — patch curto sobre Comando Final v1.0
**Data:** 2026-05-07
**Status:** rascunho de auditoria. Aplicado, substitui apenas as seções enumeradas; preserva tudo o que não for explicitamente patchado.

**Escopo único:** corrigir 3 inconsistências operacionais detectadas após preflight no repositório real (pós-merge PR #4). Nenhuma alteração de escopo, Batch D, gates, forbidden list, branch, Matrix, Peça A, ou sequência F → A → C → G → M → L.

**Documentos referenciados:**

| Documento | Hash | Papel |
|---|---|---|
| Comando Final v1.0 | `3572d96b24224fa9fe95d7758073c503405b1f165466ef9cfb7a5b77f3024204` | base patcheada por este v1.1 |
| Addendum ADP v4.2.2 | `36d40e716d7fd63d8628e0b6af0ce78893b3117f9980a2f7af0b6acde30cc85b` | hash fixado em C1 |

---

## Sumário do patch

1. Status e relação com Comando Final v1.0
2. Patch C1 — Fixar hash do Addendum v4.2.2 na tabela dos 8 documentos canônicos
3. Patch C2 — Corrigir instrução stale sobre "rotas baseline retornando 503"
4. Patch C3 — Adicionar regra explícita sobre preservação dos 8 documentos canônicos no PR2
5. Patch C4 — Atualizar data e status
6. Critério de aceitação
7. Não-objetivos
8. Próximo passo

---

## 1. Status e relação com Comando Final v1.0

Este patch substitui em Comando Final v1.0:

- §0 cabeçalho — data e status revistos por **C4**;
- §1 tabela dos 8 documentos canônicos — linha do Addendum v4.2.2 revista por **C1**;
- §1 nova subseção §1.2 adicionada por **C3** (preservação dos documentos);
- §4.1 pré-flight (item 3) — substituído por **C2**;
- §10 confirmação inicial obrigatória (item 4 do checklist) — alinhado a **C2**.

Tudo o que não for tocado nesta v1.1 permanece como em Comando Final v1.0. Em caso de conflito, prevalece v1.1 nas seções enumeradas. **Após este patch, o comando final fica pronto para colar no Claude Code (após GPT audit e aceite humano final).**

---

## 2. Patch C1 — Fixar hash do Addendum v4.2.2

**Problema resolvido:** Comando Final v1.0 §1 (tabela dos 8 documentos canônicos) deixava o hash do Addendum v4.2.2 como "(gerado em 2026-05-06; verificar disponibilidade)". Hash real foi calculado em preflight do repositório.

### 2.1 Substituição em §1 — linha do Addendum

```diff
- | 2 | `govai_adp_v4_2_2_addendum.md` | (gerado em 2026-05-06; verificar disponibilidade) | restringe v4.2; **Macro Native Substrate Contract**; PR2 = Native Provider Substrate |
+ | 2 | `govai_adp_v4_2_2_addendum.md` | `36d40e716d7fd63d8628e0b6af0ce78893b3117f9980a2f7af0b6acde30cc85b` | restringe v4.2; **Macro Native Substrate Contract**; PR2 = Native Provider Substrate |
```

### 2.2 Implicação

O pacote canônico fica **integralmente pinado** com hashes SHA-256 verificáveis. Qualquer divergência durante verificação Claude Code aciona escalation imediata (conforme §1 do Comando Final v1.0).

Tabela completa dos 8 hashes pós-C1:

| # | Documento | Hash SHA-256 |
|---|---|---|
| 1 | `govai_adp_v4_2.md` | `ec850e2ef2c423e1cc25661f277edb6d5d2d6ff9c123001ab5d4dc3812a86254` |
| 2 | `govai_adp_v4_2_2_addendum.md` | `36d40e716d7fd63d8628e0b6af0ce78893b3117f9980a2f7af0b6acde30cc85b` |
| 3 | `govai_pr2_provider_coverage_matrix_v2.md` | `604d485af4497836f7c92e3bf38b866af68fd45dbe7c32961fef6ed7cb64a777` |
| 4 | `govai_pr2_provider_coverage_matrix_v2_0_1_patch.md` | `1190184692db29e83dde39f55db1663864137c96bfef9793e26550e14680721e` |
| 5 | `govai_pr2_provider_coverage_matrix_v2_0_2_patch.md` | `5b59ccd40bd9baddaef65ed1c76e665d680929da6bec6f59127c0be1ae336c15` |
| 6 | `govai_pr2_peca_a_v2_prompt_claude_code.md` | `5831418000c00a38a0204f24293748490b9dddb1d7fdb82afa8b6f9a185cefcc` |
| 7 | `govai_pr2_peca_a_v2_1_patch.md` | `9d5825d6dc93fc13349a688b04a2e0cc319c35ee6932dc1d03c84c60f1b7d190` |
| 8 | `govai_pr2_peca_a_v2_2_patch.md` | `649e762c40edb15be0bb65f92596575ece13ac890394d7c2aeeb322e4c475c8e` |

---

## 3. Patch C2 — Corrigir instrução stale sobre "rotas baseline retornando 503"

**Problema resolvido:** Comando Final v1.0 §4.1 (pré-flight, item 3) instruía verificar "rotas baseline retornando 503 conforme esperado (Peça A v2 §2.3)". Após o merge do PR #4 no repositório real, este estado **não é mais verdadeiro** — `/v1/runs` já tem pipeline real (`executeGovernedRun`), e deferred routes retornam **501 estruturado**, não 503.

Se esta instrução stale permanecer, Claude Code pode interpretar incorretamente o estado pós-PR1 e tentar "restaurar" 503 em rotas que já têm pipeline real, ou marcar como problema o 501 estruturado em deferred routes.

### 3.1 Substituição em §4.1 — item 3 do pré-flight

Substituir o item completo por:

```diff
- 3. **Inspecionar repositório:**
-    - estrutura `packages/`, `db/migrations/`, `tests/`;
-    - ADRs existentes (`docs/architecture/adr/ADR-001` a `ADR-013`);
-    - SDKs instalados nos package.json;
-    - rotas baseline retornando 503 conforme esperado (Peça A v2 §2.3);
-    - registry baseline (8 capabilities `planned`, `ANTHROPIC_BETA_ALLOWLIST` vazia).
+ 3. **Inspecionar repositório:**
+    - estrutura `packages/`, `db/migrations/`, `tests/`;
+    - ADRs existentes (`docs/architecture/adr/ADR-001` a `ADR-013`);
+    - SDKs instalados nos package.json;
+    - estado pós-PR1 verificado:
+      - `/v1/runs` possui pipeline real (`executeGovernedRun` ou equivalente). Não retorna 503;
+      - rotas deferred (capabilities `planned`/`blocked`/`not_exposed`) retornam **501 estruturado**
+        (com `error`, `reason`, `remediation_url`, `audit_event_id` quando aplicável);
+      - **não há 503 `pipeline_incomplete_*`** em rotas supported nem em baseline crítico do PR1;
+    - registry baseline (8 capabilities `planned`, `ANTHROPIC_BETA_ALLOWLIST` vazia ou com entradas iniciais conforme estado pós-PR1).
```

### 3.2 Substituição em §10 — item 4 do checklist de confirmação inicial

```diff
4. Pré-condições do repositório (Peça A v2 §2):
   - branch base: <branch atual>
   - tests baseline (109): <passando/regredidos>
   - SDKs instalados: anthropic@<ver>, openai@<ver>
-  - rotas baseline em 503: <confirmado/divergente>
+  - /v1/runs com pipeline real (não 503): <confirmado/divergente>
+  - deferred routes em 501 estruturado: <confirmado/divergente>
+  - ausência de 503 pipeline_incomplete em supported/baseline: <confirmado/divergente>
   - registry baseline (8 capabilities planned): <confirmado/divergente>
```

### 3.3 Implicação semântica

PR2 mantém a regra: **nenhuma rota do Macro Native Substrate pode retornar 503 ou 501 ao final do PR2** (Peça A v2 §3.1). A diferença operacional é apenas que o **estado inicial** observado em pré-flight não é mais "503 esperado" — é "pipeline real para `/v1/runs` + 501 estruturado para deferred routes".

A regra de **forbidden actions** (§6 do Comando Final v1.0) permanece intacta:

- ❌ NUNCA retornar 503 `pipeline_incomplete_*` ou 501 em endpoint do Macro Native Substrate `supported`.

Ou seja: 501 só é aceitável em `planned`/`blocked`/`not_exposed` deferred routes; **nunca em supported**.

---

## 4. Patch C3 — Adicionar regra explícita sobre preservação dos 8 documentos canônicos

**Problema resolvido:** Preflight no repositório real revelou múltiplos `.md` untracked em `docs/`. Comando Final v1.0 não tornava explícito o tratamento dos 8 documentos canônicos do pacote PR2 — Claude Code poderia tratá-los como sujeira local e omiti-los do PR de merge, deixando o PR sem o pacote documental que justificou a execução.

### 4.1 Adição de §1.2 logo após §1.1 — Preservação dos documentos canônicos

```yaml
### 1.2 Preservação dos documentos canônicos do PR2

Os 8 documentos do pacote canônico (§1) DEVEM ser preservados e versionados
no PR2 se ainda estiverem untracked no repositório.

Regras canônicas:

- Se documentos estão em docs/ ou em outro path do repo como untracked
  (ex.: govai_adp_v4_2_2_addendum.md, govai_pr2_*.md), incluir no commit do PR2
  em path canônico:
    docs/architecture/canonical/<filename>.md
  ou path equivalente já adotado pelo repositório.
  
- NÃO apagar, renomear, mover ou modificar conteúdo de qualquer dos 8
  documentos canônicos sem Human Architect Escalation explícita.
  
- Após adição ao git tracking, hashes SHA-256 devem permanecer idênticos aos
  declarados em §1. Qualquer mudança de hash → escalation.
  
- O commit que adiciona os documentos canônicos pode ser parte do Batch F
  (foundation), com mensagem clara: "docs: add canonical PR2 package".
  
- Se algum dos 8 documentos JÁ estiver tracked, não é necessário re-adicionar
  ou mover; apenas confirmar hash e seguir.

Implicação para o relatório final (§8):

- §8.2 (Arquivos alterados) deve listar os documentos canônicos adicionados
  como entradas explícitas, com hash de cada um confirmado.
- §8.12 (Itens forbidden) deve incluir verificação adicional:
  "documentos canônicos preservados (sem alteração de conteúdo)": OK / violação.
```

### 4.2 Princípio canônico

O PR2 **não pode existir sem o pacote documental que o justifica**. Se Claude Code abrir PR de merge sem os 8 documentos canônicos versionados (quando aplicável), o PR é incompleto — falha o critério §8.2 do Comando Final v1.0.

---

## 5. Patch C4 — Atualizar data e status do cabeçalho

**Problema resolvido:** Cabeçalho do Comando Final v1.0 ainda registrava 2026-05-06; estado real pós-preflight é 2026-05-07. Atualização documental para evitar drift.

### 5.1 Substituição no cabeçalho §0

```diff
- **Versão:** comando final de execução (canônico)
- **Data de autorização:** 2026-05-06
- **Autorizador:** arquiteto humano (Mauricio de Souza, GovAI)
- **Destinatário:** Claude Code (instância de execução agêntica)
- **Status:** **AUTORIZADO PARA EXECUÇÃO**
+ **Versão:** comando final de execução (canônico) v1.1
+ **Data de autorização:** 2026-05-07
+ **Autorizador:** arquiteto humano (Mauricio de Souza, GovAI)
+ **Destinatário:** Claude Code (instância de execução agêntica)
+ **Status:** **AUTORIZADO PARA EXECUÇÃO APÓS GPT AUDIT E ACEITE HUMANO FINAL**
```

### 5.2 Substituição na linha de assinatura final

```diff
- **Autorização concedida — Mauricio de Souza, GovAI Architect — 2026-05-06.**
+ **Autorização concedida — Mauricio de Souza, GovAI Architect — 2026-05-07.**
```

### 5.3 Implicação operacional

Status atualizado é mais honesto: o comando v1.1 só passa a "AUTORIZADO PARA EXECUÇÃO" definitivo após (1) GPT audit deste patch v1.1, e (2) aceite explícito humano final em mensagem.

Após esse aceite, o status pode ser atualizado para "AUTORIZADO PARA EXECUÇÃO" via mensagem direta ou novo patch trivial v1.2 (apenas a linha do status), conforme preferência operacional.

---

## 6. Critério de aceitação do patch

Esta v1.1 é aceita como ajuste final do Comando se, em conjunto com Comando Final v1.0:

- [ ] **C1:** §1 tabela dos 8 documentos canônicos contém o hash literal `36d40e716d7fd63d8628e0b6af0ce78893b3117f9980a2f7af0b6acde30cc85b` para `govai_adp_v4_2_2_addendum.md`; nenhum documento canônico permanece com hash placeholder;
- [ ] **C2:** §4.1 item 3 substituído pela versão pós-PR1 (sem instrução stale sobre 503 baseline); §10 item 4 do checklist de confirmação alinhado a C2;
- [ ] **C3:** §1.2 adicionado com regra explícita de preservação dos 8 documentos canônicos no PR2; §8.2 e §8.12 do relatório final ajustados para incluir verificação de preservação;
- [ ] **C4:** §0 cabeçalho atualizado para 2026-05-07 + status "AUTORIZADO PARA EXECUÇÃO APÓS GPT AUDIT E ACEITE HUMANO FINAL"; linha de assinatura final atualizada;
- [ ] nenhuma outra seção do Comando Final v1.0 alterada além das listadas (escopo, Batch D, gates, forbidden list, branch, Matrix, Peça A, sequência F → A → C → G → M → L permanecem intactas).

---

## 7. Não-objetivos do patch

Esta v1.1 **não**:

- altera escopo de PR2;
- altera decisão sobre Batch D (permanece deferred);
- altera os 9 pre-merge gates (§7 do Comando v1.0);
- altera lista vermelha de forbidden actions (§6 do Comando v1.0);
- altera branch (`feat/pr2-native-provider-substrate`);
- altera Matrix v2 + patches v2.0.1/v2.0.2;
- altera Peça A v2 + patches v2.1/v2.2;
- altera sequência operacional F → A → C → G → M → L;
- altera procedimento de Human Architect Escalation;
- altera relatório final exigido (§8 do Comando v1.0) além das duas linhas em §8.2/§8.12 alinhadas a C3;
- altera ADP v4.2 ou Addendum v4.2.2 (canônicos imutáveis);
- altera env vars de live tests ou budget.

---

## 8. Próximo passo

Sequência canônica após aceite deste patch:

1. **Auditoria do patch v1.1** (você + GPT, opcional).
2. **Aceite humano final explícito** em mensagem para mudar status de "AUTORIZADO PARA EXECUÇÃO APÓS GPT AUDIT E ACEITE HUMANO FINAL" para "AUTORIZADO PARA EXECUÇÃO".
3. **Pacote canônico de execução fica completamente fechado:**
   - 8 documentos canônicos (§1 + C1 desta v1.1) com hashes confirmados;
   - Comando Final v1.0 + patch v1.1 (este documento) — comando operacional final.
4. **Operação no Claude Code:**
   - colar Comando Final v1.0 + patch v1.1 + 8 documentos canônicos;
   - aguardar resposta de confirmação inicial estruturada (§10 do v1.0 + ajustes de C2);
   - acompanhar execução batch por batch.
5. **Não criar `docs/architecture/pr2-execution-config.yaml`** — Batch D permanece deferred.

Em paralelo: **não modificar nenhum dos 8 documentos canônicos após este aceite, exceto via patch explícito numerado (v1.2, v1.3, etc.) com motivo registrado.**

---

**Fim do Comando Final de Execução PR2 — Patch v1.1.**
