import type { PoolClient } from 'pg';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Define `app.org_id` no escopo da transação corrente. RLS exige presença.
 * Se chamado fora de transação, o setting persiste pela conexão (LOCAL false),
 * por isso forçamos sempre `is_local = true`.
 */
export async function setLocalAppOrgId(client: PoolClient, orgId: string): Promise<void> {
  if (!isUuid(orgId)) {
    throw new Error(`setLocalAppOrgId: org_id is not a UUID: ${orgId}`);
  }
  // set_config(name, value, is_local). Quoting via parametros não funciona em SET,
  // mas funciona em set_config().
  await client.query("SELECT set_config('app.org_id', $1, true)", [orgId]);
}

export async function clearAppOrgId(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.org_id', '', true)");
}

export async function withTenant<T>(
  client: PoolClient,
  orgId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await setLocalAppOrgId(client, orgId);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}
