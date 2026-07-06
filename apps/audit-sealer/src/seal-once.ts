// Shape S — ONE committed transaction per seal (SPEC-B3 §1.1), the NORMAL
// captured→sealed path. The runner owns BEGIN/COMMIT/ROLLBACK + SET LOCAL
// app.org_id; the library's `sealNextAuditCapture` runs claim→append→mark_sealed
// on the SAME client, switching role per phase via `withSealerPhaseRole`. On any
// throw the runner ROLLBACKs — the captured→sealing flip is undone, the row
// returns to `captured` (re-claimable next pass), with NO orphan append and NO
// stuck `sealing` row. This path advances `captured` rows ONLY: `claim_for_seal`
// never touches a `sealing` row (that is the SEPARATE stale-recovery path).

import type { Pool } from 'pg';
import type { Kms } from '@govai/core-identity/kms';
import { sealNextAuditCapture, type SealNextAuditCaptureResult } from '@govai/core-audit';
import { setLocalAppOrgId } from './tenant-context.js';
import { makeWithSealerPhaseRole } from './phase-role.js';

export interface SealOnceInput {
  orgId: string;
  chainId: string;
  workerId: string;
}

export async function sealOnce(
  pool: Pool,
  kms: Kms,
  input: SealOnceInput,
): Promise<SealNextAuditCaptureResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await setLocalAppOrgId(client, input.orgId);
    const result = await sealNextAuditCapture(client, {
      orgId: input.orgId,
      chainId: input.chainId,
      kms,
      workerId: input.workerId,
      withSealerPhaseRole: makeWithSealerPhaseRole(client, input.orgId),
    });
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
