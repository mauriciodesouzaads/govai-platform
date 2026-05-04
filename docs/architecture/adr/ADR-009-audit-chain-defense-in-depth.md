# ADR-009 — Audit chain é fundação, com defense-in-depth

**Status:** accepted (baseline)

Append-only via 3 camadas:
1. `REVOKE ALL` da `govai_app` + função `audit_append_locked` `SECURITY DEFINER`.
2. RLS policies por comando E por role (incluindo `audit_events_select_writer`).
3. Triggers `BEFORE UPDATE OR DELETE` (row-level) e `BEFORE TRUNCATE` (statement-level).

HMAC computado em TS sob `pg_advisory_xact_lock(chain_lock_key)`.
SQL valida `expected_prev_hmac` e `expected_sequence`.
Chave HMAC nunca toca o banco.

`canonical_bytes bytea NOT NULL` armazenado por padrão (fallback §14.5 aplicado preventivamente).
