> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** EXECUTION_HISTORY
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (SUPERSEDE_HISTORICALLY; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header)
> **SOURCE_SHA256:** `c29ff7963ff5f7bb4287e970df891ffda8cf7bae682d93127ade0f9fc8c36ab8` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** EXECUTION HISTORY — SUPERSEDED HISTORICALLY by EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (the dedicated movement that promulgated the corpus). Retained as the record of the original PR-0 intent (re-baseline `ed18736a`, 2026-07-12). Its scope statements (edits E1–E13, "22 documents", the three owner gates) describe the ORIGINAL plan; what M3 actually did is recorded in `docs/architecture/d9-promulgation-manifest.md`, `docs/architecture/foundation-v1-freeze.md` and the external M3 disposition ledger. Do not execute.
> ---

# PR-0 — Árvore canônica de documentação (re-baseline ed18736a)

**Tipo:** docs-only (zero mudanças de código). **Branch sugerido:** `docs/pr0-arvore-canonica`. **Revisor:** Opus (adversarial). **Regra A2 aplicada.**

## Por quê (3 objetivos)
1. **A verdade acessível:** o Mapa Mestre v1.1, o Comunicado de Re-ancoragem e o Dossiê de Mercado passam a viver no repositório — o único lugar que toda sessão de IA é obrigada a consultar. Fim da doutrina em pasta de handoff.
2. **O corpus promovido com estado correto:** os 19 documentos de arquitetura entram com **cabeçalhos de re-ancoragem** individuais (status, base, deltas) e **ADENDOS** nos 3 registros (P0.1 concluído; G-30 aberto; âncoras deslocadas pelo #118).
3. **D9 executado:** os 11 documentos de doutrina do espelho entram no VCS, fechando as 3 referências quebradas no código (`0025`, `capture.ts`, `beta-policy.ts`).

## Escopo
- **Adiciona:** 22 documentos com cabeçalho (árvore deste pacote) + `docs/README.md` + os 4 arquivos de `execution/pr0/` + 11 docs D9 (cópia do dono, ver manifest).
- **Edita (Tier-B, E1–E13 do checklist):** README raiz (bloco de status falso → verdadeiro), cabeçalhos de defasagem em `current-state`, `development-roadmap`, `governance-philosophy`, `resume-playbook`, `baseline-decisions`, 6 contracts, `workroom-governance-room`, `stale-docs-register`; **[GATE DO DONO]** `source-spec.md` (D8, 1 linha).
- **NÃO faz:** nenhuma mudança de código; nenhuma reescrita integral (as 10 reescritas = PR-Docs da Fase 0, worklist na Consistency Review).

## Gates do dono (marcar no merge)
[ ] Promulgação do Comunicado (assinatura no rodapé) · [ ] Aceite dos ADR-029/030/031 (Status→Accepted + data) · [ ] D8 (E11).

## Verificação (resumo; detalhes no checklist)
`git diff --stat` só `docs/` · greps de referências D9 resolvem · CI verde · diffs dos 22 = conteúdo original + cabeçalho (+ADENDO nos 3) — nada além.
