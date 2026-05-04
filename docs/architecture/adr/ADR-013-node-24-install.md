# ADR-013 — Node 24 instalado on-the-fly no início da execução

**Status:** accepted (baseline, decisão automática)
**Data:** 2026-05-03

Ambiente original tinha apenas Node 22.22.2 (apesar de ter sido afirmado que Node 24
já estava ativo). Foi rodado `nvm install 24` que trouxe `v24.15.0`. pnpm 10.33.2
instalado globalmente sob Node 24.

Fallback (não usado): cair para Node 22.22.2 e documentar — Node 22 LTS Maintenance
ainda está em janela de suporte e os módulos nativos (`re2`, `argon2`) compilam em ambos.
