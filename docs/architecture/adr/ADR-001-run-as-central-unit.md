# ADR-001 — Run é a unidade central, não Chat

**Status:** accepted (baseline)
**Data:** 2026-05-03

Run cobre: chat, code, agent loop, tool call, MCP call, file analysis, batch,
computer use, shadow AI event. Chat é apenas um tipo de Run.

Schema `govai.runs` reflete isso com `mode ∈ {governed, passthrough, shadow}`.
