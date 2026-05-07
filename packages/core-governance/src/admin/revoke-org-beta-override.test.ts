import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { revokeOrgBetaOverride } from './revoke-org-beta-override.js';
import { ApiError } from './create-org-beta-override.js';

describe('revokeOrgBetaOverride', () => {
  it('returns RETURNING row when UPDATE affects exactly one row', async () => {
    const overrideId = randomUUID();
    const orgId = randomUUID();
    const userId = randomUUID();
    const now = new Date();
    const stub = {
      query: async (_sql: string, _params: unknown[]) => ({
        rows: [{ id: overrideId, revoked_at: now }],
      }),
    } as unknown as Parameters<typeof revokeOrgBetaOverride>[0]['db'];

    const result = await revokeOrgBetaOverride({
      override_id: overrideId,
      org_id: orgId,
      revoked_by_user_id: userId,
      db: stub,
    });
    expect(result.override_id).toBe(overrideId);
    expect(result.revoked_at).toBe(now);
  });

  it('throws ApiError 404 when no row is updated (already revoked or wrong org)', async () => {
    const overrideId = randomUUID();
    const orgId = randomUUID();
    const userId = randomUUID();
    const stub = {
      query: async () => ({ rows: [] }),
    } as unknown as Parameters<typeof revokeOrgBetaOverride>[0]['db'];

    let captured: Error | null = null;
    try {
      await revokeOrgBetaOverride({
        override_id: overrideId,
        org_id: orgId,
        revoked_by_user_id: userId,
        db: stub,
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(404);
    expect((captured as ApiError).code).toBe('override_not_found_or_already_revoked');
    expect((captured as ApiError).details?.['override_id']).toBe(overrideId);
  });

  it('passes correct parameters to UPDATE statement', async () => {
    const overrideId = randomUUID();
    const orgId = randomUUID();
    const userId = randomUUID();
    let capturedSql = '';
    let capturedParams: unknown[] = [];
    const stub = {
      query: async (sql: string, params: unknown[]) => {
        capturedSql = sql;
        capturedParams = params;
        return { rows: [{ id: overrideId, revoked_at: new Date() }] };
      },
    } as unknown as Parameters<typeof revokeOrgBetaOverride>[0]['db'];

    await revokeOrgBetaOverride({
      override_id: overrideId,
      org_id: orgId,
      revoked_by_user_id: userId,
      db: stub,
    });
    expect(capturedSql).toContain('UPDATE govai.org_beta_overrides');
    expect(capturedSql).toContain('SET revoked_at = now()');
    expect(capturedSql).toContain('revoked_at IS NULL');
    expect(capturedParams).toEqual([overrideId, orgId]);
  });
});
