// Org enumeration for the loop. The outbox is under FORCE RLS scoped by
// app.org_id, so a cross-tenant "find all orgs with work" SELECT is not available
// to the sealer role without a dedicated grant/view — which would be a migration
// (out of scope for EP-006). The org list is therefore a CONFIG seam:
// `AUDIT_SEALER_ORG_IDS` (CSV). The per-org loop itself is fully RLS-scoped. A
// future EP may add a granted discovery view; until then deployment supplies the
// tenant list. Tests inject `listOrgs` directly, so the loop logic is exercised
// independently of this seam.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseOrgIdsCsv(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && UUID_RE.test(s));
}

export function listOrgsFromEnv(source: NodeJS.ProcessEnv = process.env): () => Promise<string[]> {
  const ids = parseOrgIdsCsv(source['AUDIT_SEALER_ORG_IDS'] ?? '');
  return async () => ids;
}
