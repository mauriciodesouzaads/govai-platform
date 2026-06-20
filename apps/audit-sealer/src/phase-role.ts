// The `withSealerPhaseRole` callback (Shape S §1.1). Before each library phase
// the runner switches the session role to the one holding EXECUTE on that
// phase's SQL: `govai_audit_sealer` for claim/mark_sealed, `govai_app` for the
// append path. The library NEVER switches role; this is the only place it
// happens. The runner identity must be a MEMBER of both roles (ADR-022).

import type { PoolClient } from 'pg';
import type { AuditSealerPhase } from '@govai/core-audit';
import { setLocalAppOrgId } from './tenant-context.js';

/** Phase → the role that holds EXECUTE on that phase's SQL function. */
export const SEALER_PHASE_ROLE = Object.freeze({
  claim: 'govai_audit_sealer',
  append: 'govai_app',
  mark_sealed: 'govai_audit_sealer',
} as const);

export function roleForPhase(phase: AuditSealerPhase): string {
  // Only ever one of the two fixed identifiers below — never user input — so the
  // interpolation into SET LOCAL ROLE (which cannot be parameterized) is safe.
  return phase === 'append' ? SEALER_PHASE_ROLE.append : SEALER_PHASE_ROLE.claim;
}

/**
 * Build the per-phase role switcher for one seal transaction. After each
 * `SET LOCAL ROLE` it re-asserts `app.org_id` for the org (defensive: SET LOCAL
 * settings do survive a role change in the same tx, but this documents the
 * invariant the SECURITY DEFINER tenant guards depend on).
 */
export function makeWithSealerPhaseRole(
  client: PoolClient,
  orgId: string,
): (phase: AuditSealerPhase) => Promise<void> {
  return async (phase: AuditSealerPhase) => {
    await client.query(`SET LOCAL ROLE ${roleForPhase(phase)}`);
    await setLocalAppOrgId(client, orgId);
  };
}
