# Admin bridge CLI tools — policy and removal timeline

This document codifies the operational status of the two admin CLI tools that
ship in the `@govai/api` package and the policy governing their removal or
restriction. It is the source of truth referenced by issue
[#27](https://github.com/mauriciodesouzaads/govai-platform/issues/27).

## Tools

### `seed-provider-credential`

- **Path:** `apps/api/src/scripts/seed-provider-credential.ts`
- **Package script:** `pnpm --filter @govai/api seed:provider-credential`
- **Purpose:** insert or rotate a tenant provider API key in
  `govai.provider_credentials` (envelope-encrypted via KMS).
- **Status:** **bridge / break-glass only.** PR3.1b marked this CLI
  `@deprecated`. It emits a stderr deprecation notice on every invocation
  pointing operators back to `POST /v1/admin/provider-credentials`.
- **Introduced:** PR3.1a (issue #13).
- **Replaced by:** `POST /v1/admin/provider-credentials` (PR3.1b, issue #22).

### `grant-api-key-role`

- **Path:** `apps/api/src/scripts/grant-api-key-role.ts`
- **Package script:** `pnpm --filter @govai/api grant:api-key-role`
- **Purpose:** grant the `admin` role to an existing API key by public prefix
  so the first admin in a fresh environment can call
  `/v1/admin/provider-credentials` normally.
- **Status:** **bridge / bootstrap only.** Emits a stderr bridge notice on
  every invocation.
- **Introduced:** PR3.1b addendum (issue #22).
- **Replaced by:** future multi-user admin/RBAC management surface (not yet
  scoped — tracked separately as a follow-up to this issue).

## Canonical operational path today

For day-to-day operations, the canonical control plane is the HTTP admin
surface, not these CLI tools:

| Operation | Canonical | Bridge fallback |
| --- | --- | --- |
| Set / rotate provider credential | `POST /v1/admin/provider-credentials` | `seed:provider-credential` |
| Revoke provider credential | `POST /v1/admin/provider-credentials/:id/revoke` | n/a (direct SQL is the last resort) |
| List provider credentials | `GET /v1/admin/provider-credentials` | n/a |
| Grant admin role to an API key | (no HTTP surface yet) | `grant:api-key-role` |

The `grant:api-key-role` CLI is the only bridge that has no HTTP equivalent
in PR3.1b. It exists solely so the very first admin in a fresh environment
can be bootstrapped without resorting to direct SQL. As soon as a
multi-user admin surface lands, this CLI's role becomes break-glass only.

## Rules of use

Both CLIs share the same security contract. Any change must preserve all of
these properties:

- **Never accept a raw provider key in argv.** Both CLIs refuse `--key`,
  `--api-key`, `--apikey`, `--secret`, `--token` and their `=value` forms.
- **Stdin only for secrets.** `seed-provider-credential` reads the provider
  key from stdin; `grant-api-key-role` does not handle secrets at all (it
  operates on the public API-key prefix).
- **Metadata-only stdout.** Both CLIs print exactly one JSON line of safe
  metadata on success (id / key_prefix / key_last4 / kms_key_id / etc.).
- **No plaintext on stderr.** Stderr is reserved for the deprecation /
  bridge notice and structured error payloads. No request body is ever
  echoed.
- **Audit operationally.** Every invocation should be logged in the
  operator's runbook, including the human reason. The CLIs themselves do
  not write to the audit chain — that is the responsibility of the HTTP
  admin surface (which goes through `auditAppend` on `<orgId>:admin`).

## Removal / restriction timeline

The tools must not become the permanent operational path. The agreed
trajectory is:

1. **Now (PR3.1c → ongoing):** both CLIs remain available with bridge
   notices on every invocation. Document them as bridge / break-glass.
2. **After multi-user admin lands:** `grant-api-key-role` is restricted to
   a single-shot bootstrap mode or replaced by a dedicated HTTP admin
   endpoint. The first-admin-bootstrap path becomes part of the
   onboarding flow, not a CLI.
3. **Before production GA:** both CLIs are reviewed for removal or
   move-to-runbook-only status. If retained, they must be guarded by
   an explicit environment flag and require an operator-audited reason.

## Criteria for removal

A bridge CLI can be removed when **all** of the following are true:

- The HTTP admin surface covers the operation end-to-end with RBAC and
  audit chain integration.
- There is a documented, secure, audited path to bootstrap the first
  admin in a fresh environment (e.g. an onboarding flow, a managed
  provisioning step, or a guarded one-shot HTTP endpoint).
- A break-glass runbook exists for the operations the CLI used to cover.
- Removing the CLI does not block existing CI tests; tests that exercised
  it have either been retired (because the underlying flow is now
  end-to-end via HTTP) or migrated to call the HTTP admin endpoints
  directly.

## Related issues

- [#22](https://github.com/mauriciodesouzaads/govai-platform/issues/22) —
  PR3.1b admin HTTP endpoints (closed).
- [#26](https://github.com/mauriciodesouzaads/govai-platform/issues/26) —
  existing 501 admin placeholder routes must require admin RBAC. Closed
  by PR3.1c.
- [#27](https://github.com/mauriciodesouzaads/govai-platform/issues/27) —
  this document. Closed by PR3.1c.
- [#25](https://github.com/mauriciodesouzaads/govai-platform/issues/25) —
  safer governed-route operational_mode lookup optimization (open). Not
  related to CLI bridges, but listed here for cross-reference because
  PR3.1b touched the same area.
