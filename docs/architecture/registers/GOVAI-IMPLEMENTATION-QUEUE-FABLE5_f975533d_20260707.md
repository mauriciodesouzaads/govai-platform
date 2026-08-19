> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** PLAN_TARGET
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-07 at f975533d + adendo 2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header + adendo retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (register; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `2cd3f27f670a126e10ae41c7b1000cadd40ea870223ec5b2742556d0b96f4656` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** PLAN TARGET (item-by-item specs) with a bounded CURRENT-STATUS ADDENDUM (in this header; body untouched). ORDER and STATE are governed by `docs/architecture/development-roadmap.md` and `current-state.md` (no longer by the Mapa §6). At the Foundation V1 anchor: P0.1 (F5+F6) DONE (#118); P0.2 (F1+F2) — F1 DONE (#119), F2 closed as an evidence-granularity residual (no v5); P0.2b (C-2) DONE (#119); P0.3 (F3 + dispatch-state) DONE (#123 durable dispatch, migration 0029) plus P0.3-C run idempotency (#129, 0030); P0.4 (F4) DONE (#120); P0.5 (EP-11) RESOLVED DIFFERENTLY — the local deny was removed under ADR-032 (#126), the "audit event for the deny" spec is void; P0.10 (Docs F0: README, D9) DONE by this movement. Not started: EP-1/EP-2/EP-6, U1 (`apps/ui`), P1–P3 items, `packages/governance-kernel`. Item specs remain the intended build spec where not superseded by merged source.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** REFERÊNCIA COM ADENDO — specs item-a-item VÁLIDAS; ORDEM regida pelo Mapa §6; P0.1 CONCLUÍDO
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** C-2 entra na fila P0 (ADENDO); EP-11 mantém prazo externo 2026-08-26.
> **ORIGEM:** handoff to-chat/
> ---

# GOVAI — IMPLEMENTATION QUEUE (o manual virado fila P0–P3)

**Base:** `f975533d`. **Autor:** Fable 5 / Claude Code, 2026-07-07. Cada item: `Objetivo · Por que importa · Arquivos prováveis · Schema novo · Endpoints novos · Eventos de auditoria · Testes de aceitação · Dependências · Riscos`. Prioridades: **P0** (antes de produto vendável) · **P1** (enterprise/integration) · **P2** (diferenciação estratégica) · **P3** (nice-to-have). Ordem dentro de cada P = ordem de execução recomendada.

---

## P0 — antes de um produto vendável

### P0.1 — F5+F6 (redação/contagem de DLP) — o mais grave
- **Objetivo/porquê:** parar o vazamento de PII em claro (F5) num produto LGPD; contagens honestas (F6). Bloqueia qualquer narrativa de "redação/proteção".
- **Arquivos:** `apps/api/src/pipeline/dlp.ts:87-94` (redactFindings); `packages/dlp-br/src/baseline-detectors.ts:121-123` (detectAllBaseline); `apps/api/src/pipeline/run-orchestrator.ts:540,563,575`; `handle-messages.ts:236`.
- **Schema:** nenhum. **Endpoints:** nenhum. **Eventos:** o `dlp_decisions`/`dlp_findings` deixam de super-contar.
- **Testes:** CPF nu (casa cpf+phone) → 1 marcador, 0 PII sobrevivente; email-com-CPF → 1 marcador; disjuntos inalterados; `finding_classes` reflete span.
- **Dependências:** nenhuma. **Riscos:** a fusão de intervalos precisa cobrir aninhamento total (email contém CPF) e parcial.

### P0.2 — F1+F2 (credential_source + block_trigger derivados-de-fato)
- **Objetivo/porquê:** o evento selado não pode mentir origem de credencial (F1) nem decisão no bloqueio (F2); destrava os campos na UI.
- **Arquivos:** `handle-messages.ts:278,283,351,416`; `handle-chat-completions.ts`/`handle-responses.ts` (6 literais); `register-passthrough.ts` (×4 ×2); `provider-credentials.ts:143-166` (retornar a origem); `core-events/passthrough-invoked.ts` (campos `block_trigger`/`block_reason`, `credential_source` como enum).
- **Schema:** nenhum (campos de evento; nova `schema_version`? — decidir: v5 aditivo OU v4 com campos derivados; a regra 0026 diz que campos observacionais podem ficar fora da âncora de idempotência).
- **Eventos:** `credential_source∈{tenant_provider_credential,platform_env_key,hermetic_placeholder,none}`; bloqueio grava decisão real + `block_trigger∈{tool_validation,enforcement_matrix}`.
- **Testes:** dev-sem-tenant → platform_env_key; tool-block → block_trigger=tool_validation + decisão real (≠'blocked'); bash+starter → enforcement_matrix.
- **Dependências:** decisão de versão de evento. **Riscos:** idempotência (ADR-028) — os campos novos precisam ficar do lado certo da âncora.

### P0.3 — F3 (fronteira de transação) + EP-DISPATCH-STATE (G-17)
- **Objetivo/porquê:** fechar a retenção de conexão durante o fetch (exaustão de pool) + readiness real; realizar os estados de dispatch da spec-v2.1 §7.
- **Arquivos:** `run-orchestrator.ts:467,471,647,999` (governed) + `:1090,1094,1193,1377` (passthrough); `packages/provider-*/src/passthrough/forward.ts` (AbortSignal+timeout); `routes/health.ts` (ou nova `/ready` com `SELECT 1`); migração ALTER `provider_invocations` (dispatch_status + idempotency_key + dispatched_at/finalized_at).
- **Schema:** `provider_invocations.dispatch_status∈{prepared,dispatching,completed,failed,failed_before_dispatch,unknown_after_dispatch,reconciled}` + colunas de idempotência.
- **Endpoints:** `/ready` (readiness real). **Eventos:** nenhum novo (reconciliação interna).
- **Testes:** provedor lento não retém conexão; timeout aborta; crash em prepared→failed_before_dispatch; crash em dispatching→unknown_after_dispatch; /ready reflete pool.
- **Dependências:** F4 (mesma vizinhança de identidade). **Riscos:** partir a transação sem perder a atomicidade do append (o padrão das rotas diretas é o guia).

### P0.4 — F4 (enterWith→als.run)
- **Objetivo/porquê:** parar a perda de captura em caminhos terminais. **Arquivos:** `request-identity-hook.ts:57-63`. **Schema/Endpoints:** nenhum. **Testes:** terminal de stream ainda tem getStore(); 0 drop `missing_request_identity` no caminho feliz. **Dependências:** nenhuma (1 linha). **Riscos:** garantir que `als.run` envolve TODA a cadeia async do handler.

### P0.5 — EP-11 (OpenAI Files pós-sunset) — ★ PRAZO EXTERNO 2026-08-26
- **Objetivo/porquê:** o deny `purpose_deprecated_post_sunset` (já implementado no validador) precisa de EVENTO DE AUDITORIA + teste da virada; ~7 semanas de prazo.
- **Arquivos:** `packages/provider-openai/src/passthrough/files-purpose-validator.ts:8-53`; o emissor de evento do passthrough OpenAI.
- **Schema:** nenhum. **Eventos:** evento de auditoria do deny (cadeia `run`), análogo ao `passthrough.beta_denied`.
- **Testes:** antes da data → warning header + forward; depois (clock injetado) → 403 + evento selado. **Dependências:** nenhuma. **Riscos:** a virada por data exige clock injetável no teste.

### P0.6 — EP-1 (rate-limit por chave/org)
- **Objetivo/porquê:** o global 100/min in-memory esfomeia tenants e inviabiliza a UI. **Arquivos:** `server.ts:102-105` (keyGenerator por prefixo/org); `REDIS_URL` (config:25) para multi-instância. **Schema:** nenhum. **Testes:** tenant A saturando não afeta B; teto por chave; Redis compartilha entre instâncias. **Dependências:** nenhuma. **Riscos:** não regredir o limite de produção; medir baseline antes.

### P0.7 — EP-2 (`GET /v1/me`)
- **Objetivo/porquê:** nenhuma rota expõe roles/tier/modo → sem nav por role nem badges. **Arquivos:** nova `routes/me.ts` (~30 linhas, serializa AuthIdentity). **Endpoints:** `GET /v1/me → {org_id, roles, tier, operational_mode, api_key_prefix}`. **Testes:** cada role/tier/modo reflete a chave; 401 sem chave. **Dependências:** nenhuma. **Riscos:** não vazar user_id até haver gestão de usuários (D5).

### P0.8 — EP-6 fase 1 (`@govai/api-contract`)
- **Objetivo/porquê:** amarra de contrato UI↔API; habilita contract-testing (14.5) e o typecheck cross-PR. **Arquivos:** novo `packages/api-contract/`; extrair Zod de `routes/{evidence,audit-events,capabilities}.ts`. **Schema:** nenhum (mecânico). **Testes:** as rotas validam com os schemas importados; a UI tipa com eles. **Dependências:** nenhuma. **Riscos:** mover schema sem mudar comportamento (PR puramente mecânico).

### P0.9 — U1 (Cockpit de evidência) + fundações da UI
- **Objetivo/porquê:** o produto ganha rosto; valida a arquitetura inteira em leitura pura (rotas 100% prontas). **Arquivos:** novo `apps/ui/` ([MP Cap. 5.3]); i18n desde o bootstrap (§14.2); interceptor com redactKey+auto-lock (§14.4). **Schema/Endpoints:** nenhum (consome os existentes). **Testes:** honestidade table-driven (P0 do [MP Cap. 10]); 3 cursores; bigint-string; estados tela×estado (§14.7); axe (§14.6); fixtures de contrato (§14.5). **Dependências:** EP-1 (produção), EP-2 (badges), EP-6 (tipos). **Riscos:** as 8 lacunas da auditoria — todas endereçadas no §14.

### P0.10 — Docs F0 (a verdade antes de vender)
- **Objetivo/porquê:** README/playbook/SoT negam o código; a doutrina está fora do VCS. **Arquivos:** trio de continuidade + README + resume-playbook + governance-philosophy (rotular TARGET) + baseline-decisions (4 pontos) + headers ADR-021..027 + source-spec (D8) + **versionar a doutrina (D9)** (master-arch/ADR-016/017/018/019/claims-policy/threat-model/spec-v2.1 → repo). **Testes:** n/a (docs). **Dependências:** nenhuma. **Riscos:** D9 fecha 3 referências quebradas no código de uma vez.

### P0.11 — N1 Policy Studio (o que materializa "standalone") — pode ser P0 tardio ou P1
- Spec densa: **Manual §21.1**. **Por que P0-limítrofe:** sem ele "standalone" continua `[ALVO]`; mas depende de U1/EP-2 prontos. **Recomendação:** F6 do roadmap (após o núcleo navegável), tratado como o primeiro grande diferencial.

---

## P1 — enterprise / integration

### P1.1 — EP-3 (`GET /v1/workrooms/:id/participants`) — destrava U2/SoD-UX. Arquivos: `workrooms.ts`. Testes: roster RLS-scoped; papel do caller.
### P1.2 — U2 (Console de Workroom) — o fluxo F3 (override+SoD) completo. Dependências: EP-3, EP-2. Testes: [MP Cap. 10] P1/e2e.
### P1.3 — EP-4 (chave→JWT httpOnly) — antes do 2º usuário humano. Arquivos: `jwt.ts` (já valida), nova rota de sessão, cookie. Eventos: `session.issued`. Riscos: custódia server-side mínima.
### P1.4 — EP-B5/D1 (transcript decrypt-read) — a vista de conversa da sala. Endpoints: `GET /v1/workrooms/:id/messages` (decrypt por participação; evento de acesso selado). Riscos: primeira rota que DEVOLVE conteúdo sensível.
### P1.5 — N2 Review Queue — spec densa **§21.2**. Dependências: o molde `workroom-approvals`. Eventos: review.item_created/decided/expired. Riscos: R11 (retenção — pós-hoc primeiro).
### P1.6 — EP-7 (verificação EC-6) — verificador persistido + `POST /v1/evidence/verify`. O gauge `chain_verification_ok` já espera. Testes: cadeia adulterada → verify falha; ok → timestamp.
### P1.7 — EP-5 (feed por-request) — decisão D4 (retenção/PII) antes. Endpoints: `GET /v1/activity` (join provider_invocations+policy_decisions OU projeção legível). Habilita o AI Usage Ledger.
### P1.8 — N3 Evidence Package — spec densa **§21.3**. Eventos: evidence_package.created/exported. Riscos: R12 (certificação).
### P1.9 — U3 (Bancada regulatória) — o template ×17 dirigido por config; simulador `evaluate`. Dependências: EP-6 fase 2 (schemas regulatórios). Esforço MECÂNICO (§14.1).
### P1.10 — EP-9 (audit hardening SQL-side) + corrigir pgcrypto (G-14) — reavaliar `digest()` (pgcrypto já é dependência); baseline-decisions.
### P1.11 — EP-10 (DLP single-source-of-truth) — convergir path-A/path-B (Q2 deny-primeiro); alimenta N1.
### P1.12 — Backup/DR (§18) + runbooks faltantes (§15.2) — PITR, restore drill com verify, key-rotation, incident-response.
### P1.13 — U4 (Admin/Playground) + gestão de chaves via API (fecha o break-glass, issue #27).

---

## P2 — diferenciação estratégica

### P2.1 — N4 Connector Framework — spec densa **§21.4**; export SIEM primeiro, ingestão depois (threat model T6). Diferencia "integrated".
### P2.2 — N5 Compliance Crosswalk — spec densa **§21.5**; base documental pronta (FL-9). "Prova de cobertura".
### P2.3 — EP-KERNEL (ADR-016) — extrair `packages/governance-kernel` QUANDO houver a 3ª superfície (connector/shadow). Critério: teste falha se superfície suportada faz bypass.
### P2.4 — EP-RUNTIME-ENFORCEMENT (Fase 5) — DENIED regulatório bloqueia o runtime; binding high-risk→execução; tool/MCP enforcement. Critério: determinação negada bloqueia com teste; paridade provider-native preservada.
### P2.5 — EP-ANCHOR (TSA/Merkle/ICP-Brasil) — o MOAT comercial do doc 01; `chain_anchor_id` reservado desde 0001; `evidence_strength` sobe de hmac_internal. Claims gated.
### P2.6 — Billing/plan-gating (G-25) — reconciliar doc 05 (preços/flags/quotas) com os tiers reais (incl. `regulated`, sem `Partner`); tabelas de billing não existem.
### P2.7 — Provider identity (ADR-019 impl) — `providerId: string` + migração de schema de evento; habilita Azure/Bedrock/Vertex.

---

## P3 — nice-to-have

### P3.1 — Shadow AI alpha (spec `shadow-ai-privacy.md` pronta; R2) — metadata-first + atestação.
### P3.2 — Agentic action governance (spec pronta; futuro) — o precursor (intended_action_hash+SoD) já existe na workroom.
### P3.3 — EP-B8 (cockpit de operador via HTTP) — só se o dono quiser operador NO produto (D3); senão Grafana.
### P3.4 — Dark theme da UI (tokens prontos — [MP Cap. 7.1]).
### P3.5 — SBOM/supply-chain + external security review (pré-regulated do threat-model §4).

---

## Dependências críticas (o grafo mínimo)
```
F5+F6, F1+F2, F3(+dispatch-state), F4  ── (P0, paralelos entre si)
EP-1 ─┐
EP-2 ─┼─► U1 ──► U2(needs EP-3) ──► U3(needs EP-6 f2) ──► U4
EP-6 ─┘         │
D4 ──► EP-5 ──► Usage Ledger          N1(needs U1+EP-2) ──► N2 ──► N3 ──► N4/N5
EP-11 ── (P0, prazo externo, independente)
Docs F0 (D8/D9) ── (P0, independente)
```

## Nota de honestidade final
EP-8 (evidence-gauges-boot-wiring) do briefing §7 foi REMOVIDO desta fila: **já entregue** (FL-8, PR #115). As 5 features novas e os EPs foram confirmados na fonte como inexistentes (grep vazio). As specs densas de N1/N2 (as de maior valor, pela regra de profundidade) estão completas no Manual §21.1/§21.2 com schema+endpoints+Zod+eventos+testes; N3/N4/N5 com schema+endpoints+eventos (spec densa suficiente para implementação).

— Fim da Implementation Queue. P0: os 6 fixes + EP-1/2/6 + U1 + docs-F0 + EP-11 (prazo externo) — o mínimo para um produto honesto e vendável. P1: workroom/regulatório/review/evidence-package/DR. P2: connectors/crosswalk/kernel/runtime-enforcement/anchoring/billing. P3: shadow-ai/agentic/operador/dark/SBOM.

---
## ADENDO DE RE-ANCORAGEM (2026-07-12 · base ed18736a · PR-0)
- **P0.1 — F5+F6: CONCLUÍDO** (PR #118, merge 2026-07-11). Evidências em `ed18736a`: fusão idempotente de spans `packages/dlp-br/src/baseline-detectors.ts:175-217` ("FIXUP3, Mudança C"); redação seletiva por ação `apps/api/src/pipeline/run-orchestrator.ts:598` (`filter((f) => f.action === 'redact')`); `dlp_findings` persistidos no deny `run-orchestrator.ts:446-462` ("FIXUP3, Mudança B"). Os testes de aceitação do item permanecem como suíte de regressão.
- **NOVO ITEM P0.2b — C-2 (G-30): hash real no ramo governed-blocked.**
  `Objetivo:` gravar o `nativeRequestHash` já computado em `provider_invocations.native_request_hash` no ramo `result.kind === 'blocked'` (hoje `'\x00'::bytea`). `Por quê:` evidência secundária que contradiz a ação num produto de evidência. `Arquivos:` `run-orchestrator.ts` (~:809-811 em ed18736a; re-ancorar). `Schema/Endpoints:` nenhum. `Testes:` run bloqueado → `native_request_hash = sha256(corpo nativo)` e `≠ '\x00'`; `native_response_hash IS NULL`; `status_code=403`; `error_class='governed_blocked'`. `Dependências:` nenhuma. `Riscos:` mínimos (troca de valor + teste).
- **Ordem geral:** regida pelo Mapa Mestre §6 (Shadow AI e anchoring sobem; enforcement em degraus; Crosswalk seed antecipa; SOC 2 trilho). Prioridades P0–P3 deste documento permanecem como especificação item-a-item.
- **★ Âncoras deslocadas pelo #118:** todo item que cita linhas de `run-orchestrator.ts`, `dlp.ts`, `baseline-detectors.ts` ou `scan-sensitive.ts` deve re-ancorar por conteúdo antes de editar.
- **EP-11:** prazo externo inalterado — **2026-08-26**.
