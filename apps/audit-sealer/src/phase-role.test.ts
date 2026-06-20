import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { roleForPhase, makeWithSealerPhaseRole, SEALER_PHASE_ROLE } from './phase-role.js';

describe('phase-role', () => {
  it('maps each phase to the role that holds EXECUTE on its SQL', () => {
    expect(SEALER_PHASE_ROLE.claim).toBe('govai_audit_sealer');
    expect(SEALER_PHASE_ROLE.append).toBe('govai_app');
    expect(SEALER_PHASE_ROLE.mark_sealed).toBe('govai_audit_sealer');
    expect(roleForPhase('claim')).toBe('govai_audit_sealer');
    expect(roleForPhase('append')).toBe('govai_app');
    expect(roleForPhase('mark_sealed')).toBe('govai_audit_sealer');
  });

  it('issues SET LOCAL ROLE then re-asserts app.org_id per phase', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: [] };
      }),
    } as unknown as PoolClient;
    const org = '11111111-1111-4111-8111-111111111111';
    const cb = makeWithSealerPhaseRole(client, org);

    await cb('append');
    expect(calls[0]!.sql).toBe('SET LOCAL ROLE govai_app');
    expect(calls[1]!.sql).toContain("set_config('app.org_id'");
    expect(calls[1]!.values).toEqual([org]);

    calls.length = 0;
    await cb('mark_sealed');
    expect(calls[0]!.sql).toBe('SET LOCAL ROLE govai_audit_sealer');
  });
});
