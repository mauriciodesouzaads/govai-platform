# Canonical reconstruction — fallback aplicado preventivamente

ADP §14.5 prevê fallback se a reconstrução do canonical a partir do row do DB falhar
(jsonb reordering, timestamp encoding, normalização Unicode).

**Decisão de baseline:** aplicar o fallback **preventivamente**. A coluna
`canonical_bytes bytea NOT NULL` foi adicionada em `audit_events` desde a migration
`0001`. `audit_append_locked` recebe `p_canonical_bytes` e armazena. `verifyFullChain`
reconstrói SHA-256 e HMAC a partir de `canonical_bytes`, sem depender de
re-serialização do row.

**Custo:** ~2-3× armazenamento de `audit_events`. Aceitável dada a fragilidade
de canonical roundtrips em jsonb/timestamptz/bytea.

**Como verificar:** verifyFullChain compara `sha256(canonical_bytes)` vs `canonical_hash`
e `hmac_canonical_bytes` vs `hmac` em cada row.

## CR.1 status (runtime-patch-1)

`tests/integration/canonical-reconstruction.test.ts` (CR.1) reconstrói o canonical
a partir dos campos do row e compara contra `canonical_bytes` armazenado.

- Em runtime-patch-1, a reconstrução nativa **PASSOU** consistentemente.
- `canonical_bytes` permanece como defense-in-depth — ainda é o caminho load-bearing
  do `verifyFullChain` (mais barato e à prova de divergências futuras de driver
  pg/jsonb).
- O teste só append nesta seção em caso de **falha** futura, sinalizando que algo
  no roundtrip do row mudou e merece investigação.
## CR.1 outcome (run on 2026-05-04T05:58:35.950Z)

**Native reconstruction PASSED.** `canonical_bytes` is redundant but kept as defense.

## CR.1 outcome (run on 2026-05-04T06:01:22.781Z)

**Native reconstruction PASSED.** `canonical_bytes` is redundant but kept as defense.

## CR.1 outcome (run on 2026-05-04T06:41:02.125Z)

**Native reconstruction PASSED.** `canonical_bytes` is redundant but kept as defense.

## CR.1 outcome (run on 2026-05-04T06:44:03.567Z)

**Native reconstruction PASSED.** `canonical_bytes` is redundant but kept as defense.

## CR.1 outcome (run on 2026-05-04T06:44:20.135Z)

**Native reconstruction PASSED.** `canonical_bytes` is redundant but kept as defense.

