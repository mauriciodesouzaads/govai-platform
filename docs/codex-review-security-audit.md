**Findings**

1. **HIGH** Crypto-shred trigger allows non-shred transition  
   Evidence: [0001_audit_chain.sql](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/db/migrations/0001_audit_chain.sql:239>) permits `crypto_shredded` or `tombstoned`; the CHECK also allows `tombstoned` with only `shredded_at` set at [line 76](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/db/migrations/0001_audit_chain.sql:76>).  
   Impact: an `active -> tombstoned` update can bypass the intended LGPD crypto-shred invariant and may leave `dek_wrapped` non-NULL.  
   Fix: remove `tombstoned` from this trigger path, or create a separate tightly controlled tombstone path. Enforce only `active -> crypto_shredded`, with `dek_wrapped IS NULL`, `shredded_at IS NOT NULL`, and `shredded_by_event IS NOT NULL`.

2. **HIGH** Crypto-shred SECURITY DEFINER function lacks RBAC enforcement  
   Evidence: function is granted to `govai_app` at [0001_audit_chain.sql:498](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/db/migrations/0001_audit_chain.sql:498>), but app route is only a 503 placeholder at [admin-audit-shred.ts:3](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/routes/admin-audit-shred.ts:3>) and `requireRole` is not used there.  
   Impact: any app SQL execution path can call the definer function for the current tenant; tenant is checked, authorization role is not.  
   Fix: implement route auth with `requireRole(['admin', 'data_protection_officer'])` before calling the function, and add a DB guard using a trusted session setting such as `app.crypto_shred_authorized=true`.

3. **MEDIUM** DLP custom detector module still imports native-RegExp linting path  
   Evidence: `safe-regex` dependency/import at [custom-detectors.ts:2](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/dlp-br/src/custom-detectors.ts:2>) and lint helper at [line 43](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/dlp-br/src/custom-detectors.ts:43>); dependency is declared at [package.json:16](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/dlp-br/package.json:16>).  
   Impact: violates the “RE2 engine only, no native RegExp” control for custom detectors.  
   Fix: remove `safe-regex` and `lintRegex`, or replace with RE2-only compile validation. Keep `new RE2(...)` as the sole pattern engine.

4. **MEDIUM** KMS factory does not itself fail production + `KMS_DEV_SEED`  
   Evidence: `createKmsFromEnv` checks production `GOVAI_KMS_PROVIDER === 'dev'` but not `KMS_DEV_SEED` at [kms/index.ts:203](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/core-identity/src/kms/index.ts:203>). `loadEnv` does enforce it separately at [config/index.ts:57](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/config/src/index.ts:57>).  
   Impact: callers that use the KMS package directly can bypass the boot-fail invariant; it also throws generic `Error`, not `BootError`.  
   Fix: add the production `KMS_DEV_SEED` check inside `createKmsFromEnv` too, preferably using a shared boot error type or package-local `KmsBootError`.

5. **MEDIUM** Capability override downgrade check trusts unvalidated numeric input  
   Evidence: `level_override?: number` is accepted and cast at [capability.ts:44](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/core-governance/src/capability.ts:44>) and [line 57](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/core-governance/src/capability.ts:57>).  
   Impact: non-integer or out-of-range values can enter if this resolver is called outside the DB constraint path.  
   Fix: validate `Number.isInteger(level_override) && level_override >= 0 && level_override <= baselineLevel` before assignment; avoid the unchecked cast.

6. **LOW** Integration coverage does not exercise RLS for `0002` tables  
   Evidence: `runs`, `provider_invocations`, and `policy_decisions` are RLS/FORCE tables at [0002_runs_and_invocations.sql:56](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/apps/api/src/db/migrations/0002_runs_and_invocations.sql:56>), but the cross-tenant canary only checks `audit_events` at [audit-canary.test.ts:89](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/tests/integration/audit-canary.test.ts:89>).  
   Fix: add org A/org B integration tests for SELECT and UPDATE/INSERT constraints on all three `0002` tables.

7. **LOW** Canonical JSON silently drops object properties with `undefined`  
   Evidence: comment says `undefined -> erro` at [canonical-json.ts:10](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/core-audit/src/canonical-json.ts:10>), but implementation skips object properties at [line 48](</Users/mauriciodesouza/Projects/GovAI GRC Platform/govai-platform/packages/core-audit/src/canonical-json.ts:48>).  
   Fix: reject `undefined` recursively in objects, or update the canonicalization contract and tests to explicitly allow omission.

Controls that looked correct: RLS is enabled/FORCEd with writer SELECT policies in `0001`/`0002`; append uses TS-side HMAC, advisory lock before head read, expected prev/sequence checks, and stored `canonical_bytes`; append-only has revoke/grant discipline plus UPDATE/DELETE and TRUNCATE triggers; JWT allowlist/issuer/audience/denylist support is present.

I did not run tests, per instruction.

**Verdict: NEEDS_FIXES**