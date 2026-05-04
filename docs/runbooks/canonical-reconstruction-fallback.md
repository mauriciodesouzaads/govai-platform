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
