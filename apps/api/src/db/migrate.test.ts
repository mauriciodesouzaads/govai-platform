// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A2 remediation W2 — the post-commit session sweep's
// NEVER-FAIL contract, enforced rather than merely declared.
//
// `pg_terminate_backend` RAISES `42501 insufficient_privilege` whenever the migrator can ALTER a
// role but is not a member of `pg_signal_backend` or of the target role — the ordinary shape of a
// managed/production migrator. Because the sweep runs AFTER bootstrap has already COMMITTED the
// NOLOGIN, an uncaught exception there would make the runner report failure and SKIP every
// remaining schema migration. Session reaping is best-effort operational cleanup, never a
// schema-migration success condition.
//
// These are pure contract tests against a stubbed client — no container, fully deterministic —
// and they cover BOTH roles, because `sweepRoleSessions` is shared and the pre-existing
// enumerator path carried the same latent defect. The real-privilege reproduction (an actual
// non-superuser hitting a real 42501 against a real live backend) lives in
// tests/integration/ai-conversation-worker-trust.test.ts.

import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { sweepRoleSessions, sweepEnumeratorSessions } from './migrate.js';

const ROLES = ['govai_evidence_enumerator', 'govai_conversation_worker'] as const;

/** Minimal client stub: one queued outcome per query, in order. */
function stubClient(outcomes: ReadonlyArray<{ rows?: unknown[]; rowCount?: number } | Error>): {
  client: PoolClient;
  queries: string[];
} {
  const queries: string[] = [];
  let i = 0;
  const client = {
    query: (sql: string) => {
      queries.push(sql);
      const next = outcomes[Math.min(i, outcomes.length - 1)];
      i += 1;
      if (next instanceof Error) return Promise.reject(next);
      return Promise.resolve({ rows: next?.rows ?? [], rowCount: next?.rowCount ?? 0 });
    },
  } as unknown as PoolClient;
  return { client, queries };
}

function pgError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('sweepRoleSessions — post-commit best-effort contract', () => {
  for (const role of ROLES) {
    it(`${role}: a 42501 on pg_terminate_backend is logged, not thrown`, async () => {
      const { client, queries } = stubClient([
        pgError('42501', 'permission denied to terminate process'),
      ]);
      const log = vi.fn();
      // ★ The load-bearing assertion: it RESOLVES. Before this fix the rejection propagated
      // through applyPrivilegedRoleLifecycles into migrate() and aborted the remaining migrations
      // after the NOLOGIN had already committed.
      await expect(sweepRoleSessions(client, role, log)).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      const msg = String(log.mock.calls[0]![0]);
      expect(msg).toContain('WARNING');
      expect(msg).toContain(role);
      expect(msg).toContain('42501'); // sanitized SQLSTATE label, not a raw driver message body
      expect(msg).toContain('Migration continues.');
      // It gave up immediately rather than retrying a call that cannot start succeeding.
      expect(queries).toHaveLength(1);
    });

    it(`${role}: a failure on the survivor COUNT is also logged, not thrown`, async () => {
      // Three terminate rounds each report survivors, then the COUNT itself fails.
      const { client } = stubClient([
        { rowCount: 2 },
        { rowCount: 2 },
        { rowCount: 2 },
        pgError('57P01', 'terminating connection due to administrator command'),
      ]);
      const log = vi.fn();
      await expect(sweepRoleSessions(client, role, log)).resolves.toBeUndefined();
      const msg = String(log.mock.calls.at(-1)![0]);
      expect(msg).toContain('WARNING');
      expect(msg).toContain('57P01');
      expect(msg).toContain('Migration continues.');
    });

    it(`${role}: an error with no SQLSTATE is labelled by NAME, never by raw message body`, async () => {
      const bare = new Error('connection string postgres://user:SUPERSECRET@host/db failed');
      bare.name = 'AggregateError';
      const { client } = stubClient([bare]);
      const log = vi.fn();
      await expect(sweepRoleSessions(client, role, log)).resolves.toBeUndefined();
      const msg = String(log.mock.calls[0]![0]);
      expect(msg).toContain('AggregateError');
      // The sanitizer must never splice a driver message (which can carry connection material)
      // into the log line.
      expect(msg).not.toContain('SUPERSECRET');
      expect(msg).not.toContain('postgres://');
    });

    it(`${role}: the clean path still terminates and logs nothing`, async () => {
      const { client, queries } = stubClient([{ rowCount: 0 }]);
      const log = vi.fn();
      await expect(sweepRoleSessions(client, role, log)).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();
      expect(queries).toHaveLength(1);
      expect(queries[0]).toContain('pg_terminate_backend');
      expect(queries[0]).toContain(role);
    });

    it(`${role}: surviving sessions after the cap warn without throwing`, async () => {
      const { client } = stubClient([
        { rowCount: 1 },
        { rowCount: 1 },
        { rowCount: 1 },
        { rows: [{ n: 1 }], rowCount: 1 },
      ]);
      const log = vi.fn();
      await expect(sweepRoleSessions(client, role, log)).resolves.toBeUndefined();
      const msg = String(log.mock.calls.at(-1)![0]);
      expect(msg).toContain('still present after 3 sweeps');
      expect(msg).toContain('NOLOGIN');
    });
  }

  it('sweepEnumeratorSessions delegates to the shared implementation (no second code path)', async () => {
    const { client, queries } = stubClient([
      pgError('42501', 'permission denied to terminate process'),
    ]);
    const log = vi.fn();
    await expect(sweepEnumeratorSessions(client, log)).resolves.toBeUndefined();
    expect(queries[0]).toContain('govai_evidence_enumerator');
    expect(String(log.mock.calls[0]![0])).toContain('42501');
  });
});
