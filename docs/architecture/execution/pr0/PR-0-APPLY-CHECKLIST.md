> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** EXECUTION_HISTORY
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; the outer package copy is byte-identical and excluded as a duplicate)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (SUPERSEDE_HISTORICALLY; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header)
> **SOURCE_SHA256:** `34ff3047f02c01eaa0a953e02f6ff47e3e5dc1396d5a1e3c7b060b2ca569f1e1` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** EXECUTION HISTORY — SUPERSEDED HISTORICALLY by EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2. Retained as the record of the original PR-0 apply procedure. Executed differently by M3: E1 (root README) was re-derived by CONTENT against the Foundation V1 anchor (its replacement text below is the July 2026 draft, not what landed); E2–E13 were NOT applied as prepends (the four canonicals were reconciled directly; `governance-philosophy.md`, `baseline-decisions.md`, `source-spec.md`, `workroom-governance-room.md` and the `docs/contracts/*` files were NOT edited by M3 — E11 [owner gate D8 of THIS checklist, i.e. the ADP-canonical declaration in `source-spec.md`] was never adjudicated and remains open); "Anexo A" is the historical PR-0 header model — M3 uses the promulgation header standard recorded in `docs/architecture/d9-promulgation-manifest.md`. Do not execute.
> ---

# PR-0 — CHECKLIST DE APLICAÇÃO (executor: CLU · revisor: Opus · gates: dono)

Executar em ordem. Cada passo tem verificação. Nada aqui toca código.

## 0. Pré-voo
- [ ] `git status` limpo · `git fetch origin`
- [ ] `git rev-parse origin/main` → `ed18736a…` **ou descendente**. Se descendente: rodar V1–V5 do Comunicado antes de prosseguir e anotar o HEAD real no PR.
- [ ] Confirmar que nenhum path do pacote existe no repo (esperado zero colisões): `unzip -l <pacote> | awk '{print $4}' | grep '^docs/' | while read f; do [ -e "$f" ] && echo "COLISÃO: $f"; done` → vazio.

## 1. Branch
- [ ] `git checkout -b docs/pr0-arvore-canonica`

## 2. Aplicar a árvore do pacote
- [ ] Descompactar o zip na **raiz do repo** (só cria arquivos novos sob `docs/`).
- [ ] `git add docs && git status` → apenas adições; conferir contagem: **27 novos** (22 do corpus + docs/README.md + 4 em execution/pr0/ — descrição, checklist, manifesto D9 e MANIFEST.sha256).

## 3. D9 — copiar a doutrina do espelho (11 arquivos)
- [ ] Seguir `execution/pr0/D9-DOCTRINE-MANIFEST.md` (origem→destino→STATUS/NOTAS); aplicar o cabeçalho padrão (Anexo A) a cada um.
- [ ] Criar dirs: `docs/security/`, `docs/architecture/specs/future/`.
- [ ] Verificar: `grep -rn "ADR-01[6-9]\|threat-model\|master-architecture" apps packages docs --include="*.ts" --include="*.sql" --include="*.md"` → toda citação com alvo existente. (Referências conhecidas: `0025_…sql`, `core-audit/src/capture.ts`, `provider-anthropic/src/beta-policy.ts`.)

## 4. Edições Tier-B (E1–E13) — âncoras literais; re-localizar por CONTEÚDO se linhas divergirem

### E1 — README.md (raiz): substituir o bloco de status falso
Localizar o bloco que começa em `**Status:** Active development. Implemented runtime surfaces include` e termina em `[resume playbook](docs/architecture/resume-playbook.md).` (≈ linhas 7–24) e **substituir integralmente** por:

```markdown
**Status:** Active development. Implemented and source-verified on `main`: provider-native
**passthrough** and **governed** surfaces (OpenAI + Anthropic), the `/v1/runs` governed
shortcut, the append-only audit chain + capability registry, Workroom Phases 1–4
(create/participants, transcript/tasks/evidence, workroom-owned runs, approvals),
regulatory foundational controls (PR-R1..R9, **evidence-only**, not runtime enforcement),
the AuditSealer **B0/B1/B2/B3** (capture outbox + capture adapter + sealer library + the
authorized **B3 runner**, `apps/audit-sealer/`), and the **AuditBridge wired** on the four
direct provider routes (runtime→capture-outbox dispatch, `best_effort` posture). DLP
overlapping-span merge (F5/F6) landed via PR #118 (2026-07-11). Two admin routes
(`/v1/admin/audit-events/:id/crypto-shred`, `/v1/admin/dlp-detectors`) remain
not-implemented stubs (reserved seats — see the master map).

Evidence-honesty fixes queued for Fase 0: F1 (credential_source), F2 (block trigger),
F3 (transaction boundary), F4 (request-identity ALS), C-2 (blocked-branch request hash),
EP-11 (OpenAI Files sunset audit event — external deadline **2026-08-26**).

GovAI does **not** claim regulatory compliance, certification, legal/judicial validity, or
runtime hard-deny completeness. Navigation starts at [`docs/README.md`](docs/README.md);
the governing document is the
[Master Development Map](docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md);
implementation state: [`docs/architecture/current-state.md`](docs/architecture/current-state.md).
```
Verificar: `grep -n "not implemented and is not authorized\|logger-only\|not yet wired" README.md` → vazio.

### E2..E13 — prepends de cabeçalho (usar o modelo do Anexo A, com estas NOTAS)
- [ ] **E2** `docs/architecture/current-state.md` — STATUS: `SoT DE ESTADO — DEFASADO EM PONTOS CONHECIDOS; reescrita = PR-Docs F0`. NOTAS: base `c3cd39f3`; migrações = **27** arquivos (0001..0028, sem 0006); F5/F6 = concluído (#118); "DLP scan-only" superado (path-A pode deny/redact — Gap §4).
- [ ] **E3** `development-roadmap.md` — STATUS: `VÁLIDO COM ORDEM REGIDA PELO MAPA §6`. NOTAS: Fase 2.5 e B3 = entregues; enforcement em degraus (Mapa §5.2-C3).
- [ ] **E4** `governance-philosophy.md` — STATUS: `DOUTRINA COM RÓTULO TARGET`. NOTAS: "hard-deny floor sempre ativo" é ALVO — código atual: dev/test→observe (enforcement.ts); reescrita F0.
- [ ] **E5** `resume-playbook.md` — STATUS: `SUPERADO — NÃO SEGUIR`. NOTAS: substituído por `docs/README.md` + Mapa §10 + ACK (Comunicado §6); reescrita F0.
- [ ] **E6** `baseline-decisions.md` — STATUS: `VÁLIDO COM PENDÊNCIA`. NOTAS: justificativa pgcrypto contrafactual (G-14) — decisão consciente pendente (EP-9).
- [ ] **E7** `docs/contracts/shadow-ai.md` — prepend: `> Elevado por docs/architecture/specs/spec-shadow-ai-v1.md (SPEC_ACCEPTED). Claims de descoberta seguem Mapa §5.2-C2 (nunca "descoberta completa").`
- [ ] **E8** `docs/contracts/mcp-security.md` — prepend: `> Elevado por docs/architecture/specs/design-mcp-gateway-v1.md (DESIGN_ACCEPTED).`
- [ ] **E9** `docs/contracts/passthrough-headers.md` — prepend: `> SUPERADO PELO CÓDIGO: a allowlist vive em packages/provider-*/src/beta-policy.ts (entradas pinadas, fail-closed). Este contrato permanece só como doutrina do mecanismo.`
- [ ] **E10** `docs/architecture/workroom-governance-room.md` — prepend: `> NOTA (PR-0): o trecho que canonizava o comportamento antigo de aprovação (§ perto de :246 na numeração f975533d — re-localizar por conteúdo) descreve defeito JÁ CORRIGIDO; reescrita = PR-Docs F0.`
- [ ] **E11 [GATE DO DONO — D8]** `docs/architecture/source-spec.md` — adicionar 1 linha declarando `canonical/govai_adp_v4_2.md` (+ addendum v4_2_2) como ADP canônico; o v3 externo = superseded.
- [ ] **E12** `docs/architecture/stale-docs-register.md` — adicionar entradas para todos os arquivos tocados por E1–E13 (data 2026-07-12, motivo "PR-0 re-baseline").
- [ ] **E13** `docs/contracts/{evidence-anchoring,tsa-rfc-3161,icp-brasil}.md` — prepend em cada: `> Mecanismo consolidado em docs/architecture/specs/specs-enterprise-anchoring.md (§D). Este contrato permanece como fonte dos CLAIMS permitidos por grau de evidência.`

## 5. Verificações finais
- [ ] `git diff --stat` → somente `docs/` e `README.md`.
- [ ] `pnpm typecheck && pnpm lint && pnpm test` (docs-only, mas o gate roda sempre).
- [ ] Diffs dos 22 promovidos = cabeçalho + conteúdo original (+ADENDO nos 3 registros) — **nada além** (revisor Opus confere por amostragem ≥6 arquivos, incluindo os 3 com ADENDO).
- [ ] `grep -rn "govai-handoff" docs/README.md docs/architecture/GOVAI-MAPA*` → apenas menções históricas rotuladas.

## 6. Commit & PR
Mensagem sugerida (1ª linha + corpo; **regra A2: sem Co-Authored-By/Generated-with**):
```
docs: PR-0 — árvore canônica de documentação (re-baseline ed18736a)

Promove o corpus de arquitetura para o repositório com cabeçalhos de
re-ancoragem (22 docs + 3 ADENDOS), versiona a doutrina D9 (11 docs,
fecha 3 referências quebradas no código), corrige o bloco de status do
README (B3/bridge) e estabelece docs/README.md como entrada única.
Gates do dono: promulgação do comunicado; aceite ADR-029/030/031; D8.
Docs-only; zero mudanças de código.
```
- [ ] Abrir PR com o corpo = `execution/pr0/PR-0-DESCRIPTION.md`; marcar os 3 gates do dono como itens de aprovação.

## 7. Pós-merge
- [ ] OPERATION-STATE: nova rev registrando o PR-0 (re-baseline; P0.1 done; G-30; fila = Mapa §6).
- [ ] Toda sessão nova inicia com o ACK (Comunicado §6). Sessões antigas: triagem do Comunicado §4 (parar/re-ancorar/continuar).

## Anexo A — Modelo do cabeçalho de re-ancoragem
```markdown
> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** <status>
> **BASE DECLARADA PELO DOCUMENTO:** <base> · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso.
> **NOTAS DE PROMOÇÃO:** <notas>
> **ORIGEM:** <origem>
> ---
```
