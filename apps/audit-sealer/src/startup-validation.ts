// Startup readiness probe (SPEC-B3 §3). In a probe transaction, verify the
// runner identity can switch to BOTH phase roles, that the four B0/B1 functions
// exist and are EXECUTE-able under the correct role, and DB connectivity.
// Returns a structured result; NEVER throws to liveness (a failed probe fails
// READINESS only — it does not crash the process).

import type { Pool } from 'pg';
import { sanitizeSealerError } from '@govai/core-audit';

export interface StartupCheck {
  name: string;
  ok: boolean;
  detail?: string;
}

export interface StartupValidationResult {
  ready: boolean;
  checks: StartupCheck[];
}

const APPEND_SIG =
  'govai.audit_append_locked(uuid, uuid, text, bigint, bytea, bigint, bytea, bytea, bytea, ' +
  'text, text, text, uuid, timestamptz, bytea, uuid, bytea, bytea, text, integer, jsonb, text)';

const FUNCTION_CHECKS: ReadonlyArray<{ role: string; sig: string; label: string }> = [
  { role: 'govai_audit_sealer', sig: 'govai.audit_capture_claim_for_seal(uuid, text, bigint)', label: 'fn_claim_for_seal' },
  { role: 'govai_audit_sealer', sig: 'govai.audit_capture_mark_sealed(uuid, uuid, uuid, bigint)', label: 'fn_mark_sealed' },
  { role: 'govai_audit_sealer', sig: 'govai.audit_capture_mark_failed(uuid, uuid, text, text)', label: 'fn_mark_failed' },
  { role: 'govai_app', sig: APPEND_SIG, label: 'fn_audit_append_locked' },
];

export async function validateStartup(pool: Pool): Promise<StartupValidationResult> {
  const checks: StartupCheck[] = [];
  let client;
  try {
    client = await pool.connect();
  } catch (err) {
    return {
      ready: false,
      checks: [{ name: 'db_connectivity', ok: false, detail: sanitizeSealerError(err).errorMessage }],
    };
  }
  try {
    await client.query('SELECT 1');
    checks.push({ name: 'db_connectivity', ok: true });

    // Both phase-role switches must succeed (the runner identity is a MEMBER of
    // both). Each in its own probe tx that is rolled back.
    for (const role of ['govai_audit_sealer', 'govai_app']) {
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL ROLE ${role}`);
        await client.query('ROLLBACK');
        checks.push({ name: `set_role_${role}`, ok: true });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        checks.push({ name: `set_role_${role}`, ok: false, detail: sanitizeSealerError(err).errorMessage });
      }
    }

    // Each B0/B1 function must EXIST and be EXECUTE-able by the right role.
    for (const fc of FUNCTION_CHECKS) {
      try {
        const r = await client.query<{ exists: boolean; can_exec: boolean }>(
          `SELECT to_regprocedure($1) IS NOT NULL AS exists,
                  COALESCE(
                    to_regprocedure($1) IS NOT NULL
                    AND has_function_privilege($2, $1, 'EXECUTE'),
                    false
                  ) AS can_exec`,
          [fc.sig, fc.role],
        );
        const row = r.rows[0];
        const ok = row?.exists === true && row?.can_exec === true;
        checks.push({
          name: fc.label,
          ok,
          ...(ok ? {} : { detail: `${fc.role} cannot EXECUTE ${fc.sig} (exists=${row?.exists ?? false})` }),
        });
      } catch (err) {
        checks.push({ name: fc.label, ok: false, detail: sanitizeSealerError(err).errorMessage });
      }
    }
  } catch (err) {
    checks.push({ name: 'probe', ok: false, detail: sanitizeSealerError(err).errorMessage });
  } finally {
    client.release();
  }

  return { ready: checks.every((c) => c.ok), checks };
}
