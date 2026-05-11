// grant-api-key-role — PR3.1b (issues #22, #27).
//
// BRIDGE / BREAK-GLASS CLI. Grants the 'admin' role to an existing API key in
// govai.api_keys. Used to bootstrap the first admin in a fresh environment so
// the operator can then call /v1/admin/provider-credentials normally.
//
// Why this is bridge code:
// - Until a multi-user admin/RBAC management story lands (tracked by #27),
//   there is no in-product path to grant the very first admin. SQL is the
//   only alternative; this CLI is safer than direct SQL because it:
//     * refuses to accept any raw API key (only the public prefix);
//     * validates the role against the canonical Role enum;
//     * returns only safe metadata;
//     * is idempotent.
// - This CLI MUST NOT become a permanent operational path. The HTTP admin
//   endpoint is the canonical control plane.
//
// Usage:
//   pnpm --filter @govai/api grant:api-key-role -- \
//     --api-key-prefix govai_sk_xxxx \
//     --role admin \
//     --reason "first admin bootstrap"

import { Pool } from 'pg';
import { loadEnv } from '@govai/config';
import { ALL_ROLES, type Role } from '@govai/core-identity';

export const GRANT_DEPRECATION_NOTICE =
  '[bridge] grant-api-key-role CLI: break-glass only. The canonical control plane is the HTTP admin surface; this CLI exists to bootstrap the first admin key and will be removed/restricted (see issue #27).';

class CliRefusal extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CliRefusal';
  }
}

interface ParsedArgs {
  api_key_prefix: string;
  role: 'admin';
  reason: string;
}

// Forbidden argv flags — explicitly refused before parsing the rest so a raw
// API key body can never reach the script's argv-parsing surface.
const FORBIDDEN_FLAGS = ['--api-key', '--key', '--secret', '--token', '--apikey'];

export function parseArgs(argv: string[]): ParsedArgs {
  for (const a of argv) {
    for (const forbidden of FORBIDDEN_FLAGS) {
      if (a === forbidden || a.startsWith(`${forbidden}=`)) {
        throw new CliRefusal(
          'argv_secret_refused',
          `flag ${forbidden} is not accepted; this CLI works on the public api-key-prefix only`,
        );
      }
    }
  }
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) return undefined;
    return v;
  };
  const prefix = get('--api-key-prefix');
  const roleArg = get('--role');
  const reason = get('--reason');
  if (!prefix) {
    throw new CliRefusal('missing_flag', '--api-key-prefix is required');
  }
  if (prefix.length < 8 || prefix.includes('=')) {
    throw new CliRefusal('invalid_prefix', '--api-key-prefix must be the public prefix');
  }
  if (!roleArg) {
    throw new CliRefusal('missing_flag', '--role is required');
  }
  // PR3.1b only supports granting 'admin'. Other roles are out of scope;
  // shipping a generic role grant would normalize a CLI that should not exist
  // for the long term.
  if (roleArg !== 'admin') {
    throw new CliRefusal(
      'unsupported_role',
      `--role must be 'admin' (only role supported by this bridge CLI)`,
    );
  }
  if (!reason || reason.length === 0) {
    throw new CliRefusal('missing_flag', '--reason is required');
  }
  return { api_key_prefix: prefix, role: 'admin', reason };
}

export interface GrantResult {
  api_key_prefix: string;
  roles: Role[];
  /** True if the grant changed the row; false if admin was already present. */
  updated: boolean;
}

export async function grantAdminRoleByPrefix(
  pool: Pool,
  apiKeyPrefix: string,
): Promise<GrantResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query<{ org_id: string; roles: string[] | null }>(
      `SELECT org_id, roles FROM govai.api_keys WHERE prefix = $1 AND status = 'active'`,
      [apiKeyPrefix],
    );
    const row = cur.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      throw new CliRefusal('api_key_prefix_not_found', 'no active api key with this prefix');
    }
    // Set tenant context for RLS (api_keys has app_select/app_update policies).
    await client.query("SELECT set_config('app.org_id', $1, true)", [row.org_id]);
    const existing = (row.roles ?? []).filter((r): r is Role =>
      (ALL_ROLES as readonly string[]).includes(r),
    );
    if (existing.includes('admin')) {
      await client.query('COMMIT');
      return { api_key_prefix: apiKeyPrefix, roles: existing, updated: false };
    }
    const nextRoles = [...existing, 'admin' as const];
    await client.query(
      `UPDATE govai.api_keys SET roles = $2::text[] WHERE prefix = $1`,
      [apiKeyPrefix, nextRoles],
    );
    await client.query('COMMIT');
    return { api_key_prefix: apiKeyPrefix, roles: nextRoles, updated: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function runGrant(deps: {
  argv: string[];
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
}): Promise<number> {
  // Operator-visible bridge warning on every invocation. Goes to stderr so it
  // doesn't pollute the metadata JSON on stdout.
  deps.stderr.write(`${GRANT_DEPRECATION_NOTICE}\n`);

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(deps.argv);
  } catch (err) {
    const msg = err instanceof CliRefusal ? err.message : 'invalid arguments';
    const code = err instanceof CliRefusal ? err.code : 'invalid_args';
    deps.stderr.write(`${JSON.stringify({ error: code, message: msg })}\n`);
    return 1;
  }

  const env = loadEnv(deps.env);
  if (!env.DATABASE_URL) {
    deps.stderr.write(
      `${JSON.stringify({ error: 'missing_database_url', message: 'DATABASE_URL is required' })}\n`,
    );
    return 1;
  }
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  try {
    const result = await grantAdminRoleByPrefix(pool, parsed.api_key_prefix);
    deps.stdout.write(
      `${JSON.stringify({
        api_key_prefix: result.api_key_prefix,
        roles: result.roles,
        updated: result.updated,
        reason: parsed.reason,
      })}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof CliRefusal) {
      deps.stderr.write(`${JSON.stringify({ error: err.code, message: err.message })}\n`);
      return 1;
    }
    const safeName = err instanceof Error ? err.name : 'unknown';
    deps.stderr.write(
      `${JSON.stringify({
        error: 'grant_failed',
        cause_name: safeName,
      })}\n`,
    );
    return 1;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  void runGrant({
    argv: process.argv.slice(2),
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  }).then((code) => process.exit(code));
}
