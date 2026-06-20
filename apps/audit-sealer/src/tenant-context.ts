// Tenant-context helper. Sets the request-scoped `app.org_id` GUC the B0 RLS
// policies + SECURITY DEFINER functions read (`current_setting('app.org_id',
// true)`), exactly as `@govai/core-tenant.setLocalAppOrgId` does — inlined here
// so the runner takes no dependency beyond the authorized set. `SET LOCAL`-style
// (transaction-scoped) via set_config(..., is_local := true).

import type { PoolClient } from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setLocalAppOrgId(client: PoolClient, orgId: string): Promise<void> {
  if (typeof orgId !== 'string' || !UUID_RE.test(orgId)) {
    throw new Error(`setLocalAppOrgId: org_id is not a UUID: ${JSON.stringify(orgId)}`);
  }
  await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
}
