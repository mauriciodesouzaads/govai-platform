// Org enumeration for the loop. The outbox is under FORCE RLS scoped by app.org_id, so a
// cross-tenant "find all orgs" SELECT is not available to the SEALER role. EP-SEALER-DEPLOY
// closes the silent-drop (a tenant left off a hand-maintained list would never get sealed, with
// no alarm) by making the DEFAULT source the DATABASE, discovered AS the least-privilege
// `govai_evidence_enumerator` role (PR #115: column-scoped `SELECT (id) ON govai.orgs`,
// registry-wide `USING true` — INV-1: it reads only `orgs.id`, no evidence, no EXECUTE). The
// enumerator connects via a RUNTIME URL (`AUDIT_SEALER_ENUMERATOR_DATABASE_URL`), NOT the
// migrate-time provision password. The `AUDIT_SEALER_ORG_IDS` CSV remains an optional override
// (testing/pinning). The per-org loop itself stays fully RLS-scoped under the sealer role. Tests
// inject `listOrgs` directly, so the loop logic is exercised independently of this seam.

import { Pool } from 'pg';
import { SealerConfigError, type SealerConfig } from './config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the `AUDIT_SEALER_ORG_IDS` CSV. Empty/whitespace-only segments (from the
 * split) are ignored, but a NON-EMPTY token that is not a UUID is a CONFIGURATION
 * ERROR — it is thrown (surfacing at boot via `main().catch → exit 1`) rather than
 * silently dropped, because a silently-dropped tenant would never get sealed and
 * readiness would still report healthy (EP-006 rev2 / Codex-bot P2).
 */
export function parseOrgIdsCsv(csv: string): string[] {
  const out: string[] = [];
  for (const raw of csv.split(',')) {
    const token = raw.trim();
    if (token.length === 0) continue; // empty segment from the split — ignore
    if (!UUID_RE.test(token)) {
      throw new SealerConfigError(
        `AUDIT_SEALER_ORG_IDS contains a malformed org id (must be a UUID): ${JSON.stringify(token)}`,
      );
    }
    out.push(token);
  }
  return out;
}

export function listOrgsFromEnv(source: NodeJS.ProcessEnv = process.env): () => Promise<string[]> {
  // Parse eagerly so a malformed token fails at boot, not silently at first scan.
  const ids = parseOrgIdsCsv(source['AUDIT_SEALER_ORG_IDS'] ?? '');
  return async () => ids;
}

/**
 * Discover the full tenant set from the SOURCE OF TRUTH (`govai.orgs`) via a pool connected AS
 * the `govai_evidence_enumerator` role. INV-1: the enumerator's only capability is `SELECT (id)`,
 * so this reads org UUIDs and nothing else. A query failure REJECTS (the caller drives readiness
 * fail-loud from that — never a silent empty set).
 */
export function listOrgsFromDb(pool: Pool): () => Promise<string[]> {
  return async () => {
    const r = await pool.query<{ id: string }>('SELECT id::text AS id FROM govai.orgs ORDER BY id');
    return r.rows.map((row) => row.id);
  };
}

/** Create the dedicated least-privilege enumerator discovery pool (runtime URL, small, capped). */
export function createEnumeratorPool(url: string): Pool {
  const pool = new Pool({
    connectionString: url,
    max: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'govai-audit-sealer:discovery',
  });
  // FIXUP6 lesson (PR #115): every long-lived pool needs an 'error' listener, else a dropped idle
  // connection surfaces as an unhandled error and crashes the process. The discovery QUERY path
  // (listOrgsFromDb) is what drives readiness; this async listener just absorbs idle-conn errors.
  pool.on('error', () => undefined);
  return pool;
}

export interface ResolvedOrgDiscovery {
  listOrgs: () => Promise<string[]>;
  /** Present only for DB discovery — the caller (main) closes it on shutdown. */
  enumeratorPool?: Pool;
  source: 'csv' | 'db';
}

/**
 * Resolve the org-discovery source. DEFAULT = the DB (via the enumerator runtime URL), so a tenant
 * absent from a hand-maintained list can no longer be silently dropped. The `AUDIT_SEALER_ORG_IDS`
 * CSV is honored ONLY when explicitly set (an override, for testing/pinning). With neither
 * configured, FAIL LOUD at boot rather than silently discovering nothing.
 */
export function resolveOrgDiscovery(
  config: SealerConfig,
  env: NodeJS.ProcessEnv = process.env,
  makePool: (url: string) => Pool = createEnumeratorPool,
): ResolvedOrgDiscovery {
  const csv = env['AUDIT_SEALER_ORG_IDS'];
  if (csv !== undefined && csv.trim() !== '') {
    // Explicit override (whitespace-only "   " never reaches here — the .trim() guard routes it to
    // DB discovery, the whitespace=unset policy). parseOrgIdsCsv throws on a malformed token; AND an
    // override that PASSES the trim guard but yields ZERO valid tokens (delimiters-only: "," / ",,,"
    // / " , , ") is a config error too — otherwise it silently resolves to zero orgs and, with the
    // readiness gate, reports ready-while-blind (the exact silent-drop this EP closes).
    const ids = parseOrgIdsCsv(csv);
    if (ids.length === 0) {
      throw new SealerConfigError(
        `AUDIT_SEALER_ORG_IDS is set (${JSON.stringify(csv)}) but resolves to zero org ids ` +
          '(only delimiters/empty segments). Provide at least one org UUID, or unset it to use DB discovery.',
      );
    }
    return { listOrgs: async () => ids, source: 'csv' };
  }
  if (config.enumeratorDatabaseUrl) {
    const enumeratorPool = makePool(config.enumeratorDatabaseUrl);
    return { listOrgs: listOrgsFromDb(enumeratorPool), enumeratorPool, source: 'db' };
  }
  throw new SealerConfigError(
    'org discovery is unconfigured: set AUDIT_SEALER_ENUMERATOR_DATABASE_URL (DB discovery as the ' +
      'enumerator role — the default) or AUDIT_SEALER_ORG_IDS (an explicit CSV override).',
  );
}
