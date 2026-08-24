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

/**
 * Define `app.user_id` no escopo da transação corrente (owner-scoped domains:
 * as tabelas `ai_*` exigem AMBOS `app.org_id` E `app.user_id` na policy).
 * Sempre `is_local = true`: commit/rollback limpam o contexto, então uma
 * conexão de pool nunca vaza o owner A para o owner B. O valor vem SEMPRE de
 * identidade autenticada (AuthIdentity) ou de um candidato descoberto sob a
 * autoridade do worker — nunca de valor bruto fornecido pelo end-user.
 */
export async function setLocalAppUserId(client: PoolClient, userId: string): Promise<void> {
  if (!isUuid(userId)) {
    throw new Error(`setLocalAppUserId: user_id is not a UUID: ${userId}`);
  }
  await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
}

export async function clearAppUserId(client: PoolClient): Promise<void> {
  await client.query("SELECT set_config('app.user_id', '', true)");
}

/**
 * Owner-scoped transaction: BEGIN → set `app.org_id` + `app.user_id`
 * (transaction-local) → fn → COMMIT (rollback on error). Additive alongside
 * withTenant — org-only domains keep their existing semantics untouched.
 */
export async function withOwnerContext<T>(
  client: PoolClient,
  orgId: string,
  userId: string,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  await client.query('BEGIN');
  try {
    await setLocalAppOrgId(client, orgId);
    await setLocalAppUserId(client, userId);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  }
}
