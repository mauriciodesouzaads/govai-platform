**Verdict: NEEDS_FIXES**

I did not run tests.

**Findings**

1. **MEDIUM, Capability execution authorization:** `LOCAL_PROVIDER_RE` can be bypassed with userinfo + port syntax.
Evidence: [capability-resolution.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/capability-resolution.ts:30>) checks only a string prefix, and [assertCapabilityExecutable](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/capability-resolution.ts:40>) accepts planned execution when that regex matches.

Repro:
- Call `assertCapabilityExecutable(findCapability('anthropic.messages.create')!, { NODE_ENV: 'test', GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:80@evil.com', GOVAI_ALLOW_PLANNED_CAPABILITY_EXECUTION: false, ... })`.
- Expected: reject as non-loopback.
- Actual: regex matches `http://127.0.0.1:` and the guard allows execution to proceed.
- Current `fetch` may reject credentialed URLs later, but the authorization guard has already made the wrong decision.

Fix: parse with `new URL()`, reject `username/password`, and check `url.hostname` against exact loopback values.

2. **MEDIUM, Capability execution authorization:** org-level `status_override='blocked'` is computed but discarded before execution.
Evidence: `resolveEffectiveLevel` returns override status at [capability.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/core-governance/src/capability.ts:42>), but `resolveCapability` only keeps `effectiveLevel` and drops `eff.status` at [capability-resolution.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/capability-resolution.ts:96>). `/v1/runs` then calls `assertCapabilityExecutable(resolved.capability, ...)` using only baseline capability status at [run-orchestrator.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/pipeline/run-orchestrator.ts:67>). `/v1/capabilities` also reports baseline facet status, not the effective override status, at [capabilities.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/capabilities.ts:51>).

Repro:
- Insert `govai.capability_overrides` for org A: `capability_id='anthropic.messages.create'`, `facet_id='pre_dlp'`, `level_override=0`, `status_override='blocked'`.
- Start hermetic/test env where planned caps are otherwise allowed.
- POST `/v1/runs` as org A with `capability='anthropic.messages.create'`.
- Expected: blocked override prevents execution.
- Actual: guard sees baseline `planned`; hermetic guard allows it.

Fix: carry effective status into `ResolvedCapability`, return it from `/v1/capabilities`, and have execution deny if any required facet or capability is effectively `blocked`/`experimental`.

3. **MEDIUM, Audit chain integrity:** `audit_append_locked` stores caller-supplied `canonical_hash`, `canonical_bytes`, and `hmac` without SQL-side consistency validation.
Evidence: the SQL explicitly says canonical validation is TS-only at [0001_audit_chain.sql](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/db/migrations/0001_audit_chain.sql:334>), then inserts supplied values at [0001_audit_chain.sql](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/db/migrations/0001_audit_chain.sql:364>). TS constructs canonical bytes and hashes correctly at [append.ts](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/core-audit/src/append.ts:75>), but the `SECURITY DEFINER` function itself does not enforce `sha256(canonical_bytes) == canonical_hash`.

Repro:
- As `govai_app`, `BEGIN`, then `SELECT set_config('app.org_id', '<orgA>', true)`.
- Call `govai.audit_append_locked(...)` directly with correct `p_org_id`, fresh chain, `p_expected_prev_hmac=NULL`, `p_expected_sequence=1`, but mismatched `p_canonical_hash`, `p_canonical_bytes`, and arbitrary `p_hmac`.
- Expected: SQL function rejects inconsistent canonical material.
- Actual: insert succeeds; later verification fails.

Fix: install/use `pgcrypto.digest(p_canonical_bytes, 'sha256')` for canonical hash validation, or remove direct `EXECUTE` exposure and wrap with a narrower app-owned append API. HMAC cannot be verified in SQL by design, but canonical hash can.

**Controls Checked OK**

No tenant isolation gap found in `/v1/runs`, `/v1/audit-events`, or `/v1/capabilities`. The routes authenticate, open a transaction, call `setLocalAppOrgId`, then query RLS-bound tables. `GET /v1/audit-events` derives chain ID from authenticated org via `chainIdFor(orgId, category)`, so clients cannot request another org’s chain directly.

For audit race invariants, TS and SQL both take `pg_advisory_xact_lock` before reading the chain head, and SQL validates `previous_hmac` plus `expected_sequence` before insert.