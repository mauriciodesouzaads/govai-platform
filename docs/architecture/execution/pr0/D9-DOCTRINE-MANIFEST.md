> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** EXECUTION_HISTORY
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (CARRY_INTEGRITY; NOT_REQUIRED))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header)
> **SOURCE_SHA256:** `860e3d3ed295b7094393a8ca18935989dbe5608d2f0e33a7620e31d5b4ff53a4` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** EXECUTION HISTORY — the owner's D9 destination map, EXECUTED by M3 (CARRY-V2 in the v0.2 reconciliation manifest). Every one of the 11 destinations below now exists in this tree; the STATUS column ("DOUTRINA-VIGENTE" / "VISÃO-ALVO") is the July 2026 proposal and is superseded by the D0–D16 authority classes recorded in each promoted file's header and in `docs/architecture/d9-promulgation-manifest.md` (ADR-016 candidate target; ADR-017 historical precursor; ADR-018 accepted doctrine; ADR-019 accepted target decision; master architecture candidate target; claims-policy/threat-model/artifact-hygiene accepted doctrine; SPEC v2.1 historical pre-Foundation runtime; the two futures target vision). Note item 1's "hard-deny floor" divergence label (E4) is now realized differently: on the Native surface the floor is exactly provider-hosted computer-use (M1 / ADR-021).
> ---

# D9 — Manifesto da doutrina a versionar (cópia pelo dono; origem: espelho local, rótulo [MIRROR] do Doc Catalog §2)

Aplicar o cabeçalho padrão (modelo no fim do APPLY-CHECKLIST) a cada arquivo, com o STATUS/NOTAS abaixo.

| # | Arquivo (nome no espelho) | Destino no repo | STATUS | NOTAS do cabeçalho |
|---|---|---|---|---|
| 1 | master-architecture-v0.9.md | docs/architecture/master-architecture-v0.9.md | DOUTRINA-VIGENTE | Divergência "hard-deny floor" rotulada TARGET (ver E4); kernel extraído só na 3ª superfície (P2.3) |
| 2 | ADR-016-*.md | docs/architecture/adr/ | DOUTRINA-VIGENTE | Governance-kernel: gatilho de extração = 3ª superfície |
| 3 | ADR-017-*.md | docs/architecture/adr/ | DOUTRINA-VIGENTE | — |
| 4 | ADR-018-*.md | docs/architecture/adr/ | DOUTRINA-VIGENTE | — |
| 5 | ADR-019-provider-identity-model.md | docs/architecture/adr/ | DOUTRINA-VIGENTE (decidida; implementação = P2.7) | Fecha a "falsa lacuna" FL-1 |
| 6 | claims-policy.md | docs/architecture/claims-policy.md | DOUTRINA-VIGENTE | Estendida por Mapa §0.6 (claims de mercado com fonte+data+validade) |
| 7 | spec-v2.1-governance-kernel-audit-bridge.md | docs/architecture/specs/ | DOUTRINA-VIGENTE | dispatch-states = alvo do F3/G-17 (P0.3) |
| 8 | security/threat-model.md | docs/security/threat-model.md *(criar dir)* | DOUTRINA-VIGENTE | Fecha a referência quebrada da migração 0025 |
| 9 | operations/artifact-hygiene.md | docs/operations/artifact-hygiene.md | DOUTRINA-VIGENTE | — |
| 10 | specs/future/shadow-ai-privacy.md | docs/architecture/specs/future/ *(criar dir)* | VISÃO-ALVO | Princípios privacy-first herdados pela spec-shadow-ai-v1 |
| 11 | specs/future/agentic-action-governance.md | docs/architecture/specs/future/ | VISÃO-ALVO | Precursor já implementado na Workroom (intended_action_hash + SoD) |

**Verificação pós-cópia:** `grep -rn "ADR-01[6-9]\|threat-model\|master-architecture" apps packages docs --include="*.ts" --include="*.sql" --include="*.md"` → cada citação deve ter alvo existente em `docs/`.
