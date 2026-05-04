# ADR-004 — Capability registry com facets, code-defined

**Status:** accepted (baseline)

- Capability é code-defined em `@govai/core-governance`.
- Cada capability tem facets com level/status próprios.
- DB override por org permite **apenas downgrade** (validação em `resolveEffectiveLevel`).
- Não-registrada = default deny (Level 0).
