// Org enumeration for the loop. The outbox is under FORCE RLS scoped by
// app.org_id, so a cross-tenant "find all orgs with work" SELECT is not available
// to the sealer role without a dedicated grant/view — which would be a migration
// (out of scope for EP-006). The org list is therefore a CONFIG seam:
// `AUDIT_SEALER_ORG_IDS` (CSV). The per-org loop itself is fully RLS-scoped. A
// future EP may add a granted discovery view; until then deployment supplies the
// tenant list. Tests inject `listOrgs` directly, so the loop logic is exercised
// independently of this seam.

import { SealerConfigError } from './config.js';

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
