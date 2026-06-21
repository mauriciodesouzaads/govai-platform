# Changelog — @govai/api

All notable changes to the API app are documented here.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **AuditBridge persists `provider` + `capability_id` into `redaction_metadata.audit_bridge`
  (EP-008-PRE).** The AuditBridge now writes the two origin-stable envelope fields
  `e.provider` and `e.capability_id` — already in hand for the captureId — into the
  existing `redaction_metadata` jsonb, nested under `audit_bridge`, so the EC-3
  native-evidence gap list can attribute each gap to a provider/capability. This is
  the lone Phase-4 write: no migration, off the hot path.

### Invariants preserved

- **Replay-stable (EP-003 P1).** `provider`/`capability_id` are origin-stable, so the
  enriched `redaction_metadata` stays byte-identical across a faithful idempotent
  replay; `audit_capture_insert_locked` still REUSES the capture (no SQLSTATE 23505).
  Asserted by log-absence of `evidence_idempotency_conflict` + capture_seq reuse for
  both identity scopes.
- **captureId / payload_hash unchanged.** Both are independent of `redaction_metadata`;
  pinned golden fixtures prove byte-invariance, and the U2 captureId vectors stay green.
- **CHECK-safe.** The two fields nest under `audit_bridge` (not top-level), so the 0025
  `redaction_metadata` guard (which blocks only `prompt`/`response`/`raw_input`/`raw_output`
  at the top level) is satisfied. No schema/migration change.

_Refs: EP-008-PRE, ADR-027 (AuditBridge), ADR-028 (identity & payload-hash), EC-3._
