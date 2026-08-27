// P0-C PRE-ACTIVATION GATES — the deterministic proofs for P0A2-P3-A1 and P0A2-P3-A4.
//
// Both findings were recorded by P0-A2 as harmless-until-activation. P0-C is the activation, so
// these tests exist to show the closures are REAL and LOAD-BEARING, not merely present:
//
//   A1 — a checked-out client that emits `'error'` must be ABSORBED. Without the per-checkout
//        listener the `emit` throws (`ERR_UNHANDLED_ERROR`) and, in a real worker, kills the
//        process. Every A1 test below FAILS if the listener is removed — that is what makes them
//        proofs rather than documentation.
//   A4 — the exported capability must hand back NO general-purpose `query()` surface.
//
// Deterministic by construction: a fake pool/client lets `'error'` be emitted at a precisely
// chosen instant during a checkout. Racing a real backend teardown could not pin the instant.

import { EventEmitter } from 'node:events';
import { describe, it, expect, vi } from 'vitest';
import type { Pool, PoolClient, PoolConfig } from 'pg';
import {
  createConversationWorkerDb,
  loadConversationWorkerDbConfig,
  sanitizeWorkerDbError,
  ConversationWorkerConfigError,
  ConversationWorkerIdentityError,
  CONVERSATION_WORKER_DATABASE_URL_ENV,
  CONVERSATION_WORKER_ROLE,
  type ConversationWorkerDb,
} from './ai-conversation-worker.js';

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Parameters<typeof createConversationWorkerDb>[0]['log'];

/** The row `assertConversationWorkerIdentity` expects from a CORRECTLY wired worker connection. */
const ATTESTATION_OK = {
  current_role_name: CONVERSATION_WORKER_ROLE,
  session_role_name: CONVERSATION_WORKER_ROLE,
  rolsuper: false,
  rolbypassrls: false,
  rolinherit: false,
};

type FakeClient = EventEmitter & {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  releasedWith: unknown[];
};

function makeFakeClient(queryImpl?: (sql: string) => unknown): FakeClient {
  const client = new EventEmitter() as FakeClient;
  client.releasedWith = [];
  client.query = vi.fn(async (sql: unknown) => {
    const text = typeof sql === 'string' ? sql : String((sql as { text?: string })?.text ?? '');
    if (text.includes('pg_catalog.pg_roles')) return { rows: [ATTESTATION_OK], rowCount: 1 };
    const custom = queryImpl?.(text);
    if (custom !== undefined) return custom;
    return { rows: [], rowCount: 0 };
  });
  client.release = vi.fn((arg?: unknown) => {
    client.releasedWith.push(arg);
  });
  return client;
}

function makeFakePool(client: FakeClient): { pool: Pool; ended: { value: boolean } } {
  const ended = { value: false };
  const pool = {
    connect: async () => client as unknown as PoolClient,
    on: () => pool,
    end: async () => {
      ended.value = true;
    },
    query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
  } as unknown as Pool;
  return { pool, ended };
}

function makeDb(
  client: FakeClient,
  onDbError?: Parameters<typeof createConversationWorkerDb>[0]['onDbError'],
): { db: ConversationWorkerDb; ended: { value: boolean } } {
  const { pool, ended } = makeFakePool(client);
  const db = createConversationWorkerDb({
    config: { connectionString: 'postgres://ignored/by/the/fake', max: 1 },
    log: silentLog,
    poolFactory: (_c: PoolConfig) => pool,
    ...(onDbError ? { onDbError } : {}),
  });
  return { db, ended };
}

const owner = {
  orgId: '11111111-1111-4111-8111-111111111111',
  ownerUserId: '22222222-2222-4222-8222-222222222222',
};

describe('P0A2-P3-A1 — a checked-out client carries an error listener for its whole checkout', () => {
  it('A1.1 — an async connection error DURING a checkout is absorbed, not thrown', async () => {
    // ★ THE LOAD-BEARING ASSERTION. `EventEmitter.emit('error', …)` with ZERO listeners THROWS
    // synchronously. So this `emit` — issued from inside the checkout, exactly where pg's
    // `_handleErrorEvent` issues it — would propagate out of `withOwnerContext` and, in the real
    // worker, terminate the process. It returns normally only because the listener exists.
    const client = makeFakeClient();
    const { db } = makeDb(client);
    const seen: Array<{ errorClass: string; code: string | null }> = [];
    const { db: db2 } = makeDb(client, (e) => seen.push(e));
    void db;

    const result = await db2.withOwnerContext(owner, async () => {
      const boom = Object.assign(new Error('connection terminated unexpectedly'), {
        name: 'Error',
        code: '57P01',
      });
      // If the listener were missing this line alone fails the test.
      expect(() => client.emit('error', boom)).not.toThrow();
      return 'survived';
    });

    expect(result).toBe('survived');
    expect(seen).toEqual([{ errorClass: 'Error', code: '57P01' }]);
  });

  it('A1.2 — a client that errored is DESTROYED on release, never returned to the pool', async () => {
    const client = makeFakeClient();
    const { db } = makeDb(client);

    await db.withOwnerContext(owner, async () => {
      client.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
      return null;
    });

    // `release(true)` is pg-pool's destroy signal (`_release` -> `_remove`). Returning a client
    // whose connection has failed to the HEALTHY pool would hand the next checkout a dead socket.
    expect(client.releasedWith).toEqual([true]);
  });

  it('A1.3 — a HEALTHY checkout releases normally (no destroy, no false positives)', async () => {
    const client = makeFakeClient();
    const { db } = makeDb(client);
    await db.withOwnerContext(owner, async () => 'fine');
    // `release()` with no argument: back to the pool. Destroying every client would silently
    // turn the pool into a connect-per-operation path.
    expect(client.releasedWith).toEqual([undefined]);
  });

  it('A1.4 — the listener does NOT leak across checkouts', async () => {
    // A listener left attached would accumulate one per checkout on a long-lived physical
    // connection (MaxListenersExceededWarning, then unbounded growth) AND would fire for a LATER
    // borrower's error, attributing it to the wrong operation.
    const client = makeFakeClient();
    const { db } = makeDb(client);
    for (let i = 0; i < 5; i += 1) {
      await db.withOwnerContext(owner, async () => i);
      expect(client.listenerCount('error')).toBe(0);
    }
  });

  it('A1.5 — the absorbed error is SANITIZED: no message, no connection string, no password', () => {
    const nasty = Object.assign(
      new Error('connect ECONNREFUSED postgres://govai_app:sup3rs3cret@db.internal:5432/govai'),
      { code: 'ECONNREFUSED' },
    );
    const safe = sanitizeWorkerDbError(nasty);
    expect(safe).toEqual({ errorClass: 'Error', code: 'ECONNREFUSED' });
    const serialized = JSON.stringify(safe);
    expect(serialized).not.toContain('sup3rs3cret');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('db.internal');
    // A hostile `name`/`code` cannot smuggle punctuation into a log field either.
    expect(
      sanitizeWorkerDbError(Object.assign(new Error('x'), { name: 'a b"c\nd', code: 'X;DROP' })),
    ).toEqual({ errorClass: 'abcd', code: 'XDROP' });
  });

  it('A1.6 — the ROLLBACK path is also covered, and preserves the ORIGINAL failure', async () => {
    const client = makeFakeClient();
    const { db } = makeDb(client);
    await expect(
      db.withOwnerContext(owner, async () => {
        client.emit('error', Object.assign(new Error('lost'), { code: '08006' }));
        throw new Error('the real cause');
      }),
    ).rejects.toThrow('the real cause'); // not a ROLLBACK error, and not the emitted one
    expect(client.releasedWith).toEqual([true]);
    expect(client.listenerCount('error')).toBe(0);
  });

  it('A1.7 — discovery checkouts are covered too, not just owner-context ones', async () => {
    const client = makeFakeClient((sql) =>
      sql.includes('ai_turn_recovery_candidates')
        ? { rows: [], rowCount: 0 }
        : undefined,
    );
    const seen: Array<{ errorClass: string; code: string | null }> = [];
    const { db } = makeDb(client, (e) => seen.push(e));
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : '';
      if (text.includes('pg_catalog.pg_roles')) return { rows: [ATTESTATION_OK], rowCount: 1 };
      // Emit mid-call, exactly as a socket failure would during the definer query.
      client.emit('error', Object.assign(new Error('reset'), { code: '08006' }));
      return { rows: [], rowCount: 0 };
    });
    await expect(
      db.discoverRecoveryCandidates({ recoveryGraceMs: 0, limit: 1 }),
    ).resolves.toEqual([]);
    expect(seen).toEqual([{ errorClass: 'Error', code: '08006' }]);
    expect(client.releasedWith).toEqual([true]);
  });

  it('A1.8 — attestation still precedes everything, and a failure still releases cleanly', async () => {
    const client = makeFakeClient();
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : '';
      if (text.includes('pg_catalog.pg_roles')) {
        return {
          rows: [{ ...ATTESTATION_OK, session_role_name: 'govai_app' }],
          rowCount: 1,
        };
      }
      throw new Error('no query may run after a failed attestation');
    });
    const { db } = makeDb(client);
    await expect(db.withOwnerContext(owner, async () => 'must not run')).rejects.toBeInstanceOf(
      ConversationWorkerIdentityError,
    );
    // No BEGIN, no set_config: the ONLY statement issued was the attestation itself.
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.listenerCount('error')).toBe(0);
    expect(client.releasedWith).toEqual([undefined]); // clean connection, just wrong identity
  });
});

describe('P0A2-P3-A4 — the exported capability has no raw-pool escape', () => {
  it('A4.1 — the capability exposes ONLY named operations; no pool, no query, no connect', () => {
    const client = makeFakeClient();
    const { db } = makeDb(client);
    // Own + inherited enumerable surface, so a `pool` slipped onto a prototype would show up.
    const surface = new Set<string>();
    for (let o: object | null = db; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) {
      for (const k of Object.getOwnPropertyNames(o)) surface.add(k);
    }
    expect([...surface].sort()).toEqual([
      'captureAuditEvent',
      'close',
      'discoverRecoveryCandidates',
      'withOwnerContext',
    ]);
    for (const forbidden of ['pool', 'query', 'connect', 'end', '_pool', 'getPool']) {
      expect({ forbidden, present: forbidden in (db as object) }).toEqual({
        forbidden,
        present: false,
      });
    }
  });

  it('A4.2 — the module no longer EXPORTS a pool factory at all', async () => {
    const mod = (await import('./ai-conversation-worker.js')) as Record<string, unknown>;
    // The P0-A2 raw-pool constructor is gone by name, so no caller can reach one through it.
    expect('createConversationWorkerPool' in mod).toBe(false);
    expect('withAttestedConversationWorkerClient' in mod).toBe(false);
    // Nothing exported returns a Pool-shaped object.
    for (const [name, value] of Object.entries(mod)) {
      if (typeof value !== 'function') continue;
      expect({ name, isPoolCtor: value === (globalThis as never) }).toEqual({
        name,
        isPoolCtor: false,
      });
    }
  });

  it('A4.3 — a PoolClient is reachable ONLY inside an attested, owner-scoped callback', async () => {
    const client = makeFakeClient();
    const { db } = makeDb(client);
    const statements: string[] = [];
    client.query.mockImplementation(async (sql: unknown) => {
      const text = typeof sql === 'string' ? sql : String((sql as { text?: string })?.text ?? '');
      statements.push(text);
      if (text.includes('pg_catalog.pg_roles')) return { rows: [ATTESTATION_OK], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    let handed: unknown = null;
    await db.withOwnerContext(owner, async (tx) => {
      handed = tx;
      return null;
    });
    expect(handed).toBe(client); // a client IS handed over — inside the callback, and only there

    // And the order that makes it safe: ATTEST -> reset -> BEGIN -> BOTH GUCs -> DateStyle.
    expect(statements[0]).toContain('pg_catalog.pg_roles');
    expect(statements[1]).toContain("set_config('app.org_id', ''");
    expect(statements[2]).toBe('BEGIN');
    const joined = statements.join('\n');
    expect(joined).toContain('app.org_id');
    expect(joined).toContain('app.user_id');
    expect(joined).toContain("SET LOCAL DateStyle = 'ISO, MDY'");
    expect(statements[statements.length - 1]).toBe('COMMIT');
  });

  it('A4.4 — close() is idempotent and ends the private pool', async () => {
    const client = makeFakeClient();
    const { db, ended } = makeDb(client);
    await db.close();
    expect(ended.value).toBe(true);
    await expect(db.close()).resolves.toBeUndefined(); // second call is a no-op, never a throw
  });
});

describe('worker DB config still fails CLOSED (unchanged P0-A2 contract)', () => {
  it('rejects a missing worker URL rather than falling back to DATABASE_URL', () => {
    expect(() => loadConversationWorkerDbConfig({ DATABASE_URL: 'postgres://app@h/db' })).toThrow(
      ConversationWorkerConfigError,
    );
    expect(() =>
      loadConversationWorkerDbConfig({ [CONVERSATION_WORKER_DATABASE_URL_ENV]: '' }),
    ).toThrow(ConversationWorkerConfigError);
    // The message names the ENV VAR, never a credential.
    try {
      loadConversationWorkerDbConfig({});
    } catch (err) {
      expect((err as Error).message).toContain(CONVERSATION_WORKER_DATABASE_URL_ENV);
      expect((err as Error).message).not.toContain('postgres://');
    }
  });
});
