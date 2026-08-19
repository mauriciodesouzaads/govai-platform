> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** HISTORICAL_SNAPSHOT
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; authored 2026-07-07 at f975533d)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (register snapshot; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `aed4f0b231a7788db591bb3333940be8ec9f7dad9df2563c0403502318eb5e0a` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORICAL SNAPSHOT — the provenance index of the July 2026 Fable5 series; every `[CODE]` anchor is pinned to f975533d and must be re-verified before use. §4 "Doutrina fora do repo [MIRROR]" is no longer outside the repository — the listed doctrine is promulgated in this tree (see `docs/architecture/d9-promulgation-manifest.md`); the "rev43" operation state and the file/migration counts are frozen at f975533d.
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** REFERÊNCIA — o índice de proveniência da série Fable5
> **BASE DECLARADA PELO DOCUMENTO:** base f975533d (2026-07-07/10) — anterior ao #118 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Âncoras [CODE] apontam para f975533d; re-verificar em uso.
> **ORIGEM:** handoff to-chat/
> ---

# GOVAI — SOURCE REGISTER (as fontes primárias do Manual de Execução)

**Base:** `f975533d`. **Autor:** Fable 5 / Claude Code, 2026-07-07. Formato tipado do briefing §1.3. Toda âncora `[CODE]`/`[TEST]` foi lida NESTA sessão ou na sessão do plano-mestre (mesmo contexto, mesmo snapshot); `[DOC]`/`[MIRROR]`/`[LOCAL]`/`[HANDOFF]` conforme o catálogo.

## 1. Código (o árbitro do estado atual) — `[CODE]`
| Área | Fontes-chave |
|---|---|
| Enforcement | `packages/core-governance/src/enforcement.ts` (matriz :62-102; MODE_RANK :44-51; relax :53-60; side-effects :104-120) · `governed-native/resolve-governance.ts` (enum :48-54; escalações :77-130; descarte :153-158) · `registry.ts` (:30,:73 planned) |
| Capacidades | `packages/provider-anthropic/src/capabilities/index.ts` (6 caps; pares :14-15,:28-29,:42-43,:56-57,:71-72,:96-97) · `provider-openai/src/capabilities/index.ts` (13 caps; :18-19,:32-33,:48-49,:62-63,:78-79,:93-94,:109-110,:125-126,:145-146,:165-166,:179-180,:200-201,:212-213) |
| Ferramentas/beta | `provider-anthropic/src/tool-classifier.ts` (:21-30,:84-119) · `beta-policy.ts` (9 entradas :6-72) |
| Handlers | `provider-anthropic/src/governed/handle-messages.ts` (block :258-303; eventos :263-294,:329-363,:395-428; dlp :219-240) · `register-governed.ts` (403 :114-121; headers :134-136,:169-171) · openai `register-governed.ts` (:69,:84-86,:111-113,:129,:174) · `handle-chat-completions.ts`/`handle-responses.ts` (F1 :185/244/308,:256/315/379) · passthrough ×2 (:174/:178 wildcards; observe/credential :401/407/476/482 e :461/467/537/543) · `passthrough/files-purpose-validator.ts` (sunset :8-53) |
| Rotas API | os 18 arquivos de `apps/api/src/routes/` (linhas por rota: plano-mestre Cap. 3.7/13.1; regulatory 108 ops re-derivadas) |
| Pipeline | `pipeline/auth.ts` (:15-92) · `require-admin.ts` · `dlp.ts` (:20-94 — F5 :87-94) · `policy.ts` · `run-orchestrator.ts` (:467,:471,:512,:540,:551,:563,:575,:715-999,:1090+) · `provider-credentials.ts` (:23-29,:68-73,:153-166) · `audit-bridge.ts` (:29,:40,:105-111,:131-133,:210,:236,:294) · `audit-bridge-metrics.ts` (:21-22) · `evidence-reports.ts` (:16-34,:74-191,:411,:422-442,:466-536) · `evidence-operator.ts` (:1-23) · `evidence-metrics.ts` (:28-35) · `request-identity-hook.ts` (:57-63) |
| Boot/config | `apps/api/src/server.ts` (INTEIRO — 215 linhas) · `packages/config/src/index.ts` (INTEIRO — 150 linhas) |
| DB | `apps/api/src/db/migrations/` 27 arquivos (inventário de objetos completo por grep; definições integrais lidas: 0001 :14-56, 0002 :5-55, 0005 :8-32, 0014 :22-28, 0025 :57-170, 0026 :1-40, 0027 :30-89) · `infra/postgres/bootstrap.sql` (:8,:24,:45,:61-117) |
| Pacotes | exports de todos os 13 `packages/*/src/index.ts` (grep integral) · `core-audit` (append :55,:144; capture :281; sealer-event-id :22,:81) · `core-identity` (api-keys :17; jwt :43-47; kms :60,:179,:215; aws-kms.ts existe) · `core-tenant` (:14-32) · `core-events/passthrough-invoked.ts` (:69,:129,:141,:145,:216-257) · `provider-stream-http` (StreamOutcome/pump/classify/arm) · `observability` (startTelemetry/metricsUrl/resolveServiceName) |
| Sealer | `apps/audit-sealer/` (config.ts :12,:85-95; org-discovery.ts :1-25; Dockerfile :5-9; package.json :9; árvore completa) |
| Infra/CI | `infra/docker-compose.yml` (:2,:23,:38) · `docker-compose.observability.yml` (:13,:26,:43) · `otel/collector-config.yaml` · `prometheus/` · `grafana/` · `.github/workflows/ci.yml` (:11,:54) · `vitest.config.ts` (:17,:63-65) |

## 2. Testes (contratos executáveis) — `[TEST]`
`tests/integration/` **65 arquivos** (lidos por listagem; nomes = mapa de contrato: append-only-defense, audit-bridge-wiring/idempotency, audit-capture-outbox-foundation, audit-sealer-core/discovery/runner, evidence-cockpit/completeness/enumerator/reports, governed-anthropic/openai, anthropic-passthrough, admin-provider-credentials-{audit,endpoints,plaintext-leak,rbac}, audit-events-{pagination,rls}, bootstrap-idempotent, canonical-reconstruction, capabilities-by-org, api-key-lookup-cleanup, admin-chain-mixed-events-integrity, governed-org-tier-lookup-count, + fixtures/) · `tests/live/` 5 (observability-collector, provider-live-{validation,passthrough,streaming}, user-e2e) · 176 `*.test.ts` no total (find). Execução NÃO feita nesta sessão.

## 3. Docs do repo — `[DOC]`
current-state.md · development-roadmap.md · stale-docs-register.md · baseline-decisions.md · governance-philosophy.md · workroom-governance-room.md (:909,:246) · source-spec.md · ADRs 001-014/020-028 · canonical/govai_adp_v4_2.md (estrutura §1-23) + coverage_matrix_v2 (§Assistants sunset ~:2003-2041) · regulatory/README (taxonomia) + 16 + 19 + 20 + 22 (+ demais catalogados) · specs/ (5) · contracts/ (7) · operations/admin-bridge-cli-tools.md · runbooks/ (6; user-e2e-local :14-17).

## 4. Doutrina fora do repo — `[MIRROR]` (lidos INTEGRALMENTE nesta sessão/série)
master-architecture-v0.9.md (320) · ADR-016/017/018/**019** · claims-policy.md · **spec-v2.1-governance-kernel-audit-bridge.md** (invariantes, estados de dispatch, posture, streaming, test-matrix) · **specs/future/shadow-ai-privacy.md** · **specs/future/agentic-action-governance.md** · **security/threat-model.md** (T1-T10 + controles Foundation/regulated) · operations/artifact-hygiene.md.

## 5. Handoff — `[HANDOFF]`
CONSOLIDADO F1–F6 (to-chat) · AUDITORIA-CRITICA-MASTER-PLAN (as 8 lacunas) · CORRECAO-PROVENIENCIA · CORRECAO-F2A-V3 (F2a settled 6 leituras) · VERIFICACAO-OPUS-BRIEFING7 (file_search_tool; ausência-visível) · **GOVAI-OPERATION-STATE rev43** (main pós-#117; fila pós-rev43) · GOVAI-MASTER-PLAN-APPLICATION (o plano que este manual expande) · GOVAI-UI-MASTER-PLAN · pareceres docs-consistency + UI-architecture (from-codex).

## 6. Docs locais do dono — `[LOCAL]`
`~/Downloads/govai-docs/01-raio-x` (posicionamento/M&A/fossos — comercial) · `05-tier-system` (preços R$4.9k/19.8k/60-300k; flags; quotas; SQL de billing INEXISTENTE no código) · `04-product-ux` (§11 WCAG 2.1 AA, §12 perf budget, §13 anti-patterns — aproveitados) · `~/Projects/GovAI GRC Platform/Docs/govai_adp_v3.md` (o alvo do source-spec — superseded).

## 7. Estado desatualizado-vs-atual (regra de arbitragem aplicada)
Em TODA divergência doc-vs-código deste manual, venceu o CÓDIGO @ f975533d. As divergências importantes estão no Gap Register §1 (falsas lacunas) e §4 (divergências documentais), e as correções documentais prescritas no catálogo §5.2.

## 8. `[INFERENCE]` declaradas (raciocínio explícito, não fato de fonte)
(i) A contagem de 55 tabelas = soma dos CREATE TABLE por migração (inventário grep; não executei o schema). (ii) "EP-8 evidence-gauges-boot-wiring já entregue" = inferido de server.ts:118-154 + PR #115 (rev42/43). (iii) Estimativas de esforço/fases no manual são recomendação, não medida. (iv) Números de teste "que rodam" não verificados por execução.

— Fim do source register.
