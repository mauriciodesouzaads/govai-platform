> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** EXECUTION_HISTORY
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package (package path `prompts/claude-code-save-architecture-docs.md`)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D13=PRESERVE_AS_HISTORY)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header)
> **SOURCE_SHA256:** `a4e20b7e24ed2094357f9c7ed016bd06ff76095bc479c948166ea47a22d5e937` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** HISTORY ONLY (D13 = PRESERVE_AS_HISTORY). Operational prompt used to save the v0.9 architecture package; it is NOT canonical doctrine and must not be executed as an instruction against the current tree (its path list predates the D9 destination manifest and this promulgation).
> ---

# Prompt for Claude Code — Save GovAI Architecture Docs

You are operating in the root of the `govai-platform` repository.

Goal: save the provided architecture documents into the repository exactly as provided.

Rules:
- Do not modify application code.
- Do not modify package.json, migrations, tests, source files, or lockfiles.
- Only create/update Markdown files under:
  - `docs/architecture/draft/`
  - `docs/architecture/adr/`
  - `docs/architecture/specs/`
  - `docs/architecture/specs/future/`
  - `docs/security/`
  - `docs/product/`
  - `docs/operations/`
- Preserve the content exactly.
- Do not add secrets.
- Do not read or print `.env.local`.
- After writing files, run:
  - `git status --short`
  - `find docs/architecture docs/security docs/product docs/operations -type f | sort | grep -E '(govai-ai-trust-layer|ADR-016|ADR-017|ADR-018|ADR-019|spec-v2.1|aws-kms|provider-native|threat-model|claims-policy|artifact-hygiene|agentic-action|shadow-ai)'`
- Do not run tests unless explicitly asked.
- Report only created/modified paths and any errors.
