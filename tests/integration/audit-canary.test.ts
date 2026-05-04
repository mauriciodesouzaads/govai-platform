// Canário do bug RLS-FORCE-sem-policy-writer.
// 1) bootstrap.sql + migrations rodam.
// 2) primeiro append em chain `<orgA>:run`.
// 3) segundo append na mesma chain.
// 4) verifyFullChain retorna válido com 2 eventos.
// Falha aqui = audit chain quebrada (regressão crítica).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPostgres, stopPostgres, freshSeedHex, type TestDb } from './setup.js';
import { auditAppend, verifyFullChain, sha256 } from '@govai/core-audit';
import { setLocalAppOrgId } from '@govai/core-tenant';
import { DevKms } from '@govai/core-identity';
import { chainIdFor } from '@govai/core-events';

let db: TestDb;
const seed = freshSeedHex();
const kms = new DevKms(seed);

beforeAll(async () => {
  db = await startPostgres();
}, 240_000);

afterAll(async () => {
  if (db) await stopPostgres(db);
});

describe('RLS-FORCE canary: append + append + verifyFullChain', () => {
  it('inserts two audit events and verifies the chain', async () => {
    const orgId = randomUUID();
    const chainId = chainIdFor(orgId, 'run');

    const client = await db.appPool.connect();
    try {
      await client.query('BEGIN');
      await setLocalAppOrgId(client, orgId);

      const first = await auditAppend(client, kms, {
        orgId,
        chainId,
        eventType: 'run.created',
        eventVersion: '1',
        subjectType: 'run',
        subjectId: randomUUID(),
        occurredAt: new Date('2026-05-03T12:00:00.000Z'),
        payloadHash: sha256(Buffer.from('payload-1')),
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: { actor: 'test' },
      });

      const second = await auditAppend(client, kms, {
        orgId,
        chainId,
        eventType: 'run.completed',
        eventVersion: '1',
        subjectType: 'run',
        subjectId: randomUUID(),
        occurredAt: new Date('2026-05-03T12:00:01.000Z'),
        payloadHash: sha256(Buffer.from('payload-2')),
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: { actor: 'test' },
      });

      await client.query('COMMIT');

      expect(first.sequenceNumber).toBe(1n);
      expect(second.sequenceNumber).toBe(2n);

      // Verificação em nova transação (também sob app role).
      const verifyClient = await db.appPool.connect();
      try {
        await verifyClient.query('BEGIN');
        await setLocalAppOrgId(verifyClient, orgId);
        const result = await verifyFullChain(verifyClient, kms, chainId);
        await verifyClient.query('COMMIT');
        expect(result.valid).toBe(true);
        expect(result.events).toBe(2);
        expect(result.firstInvalidSeq).toBeNull();
      } finally {
        verifyClient.release();
      }
    } finally {
      client.release();
    }
  }, 60_000);

  it('cross-tenant: org B cannot see org A events', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const chainA = chainIdFor(orgA, 'run');

    const cA = await db.appPool.connect();
    try {
      await cA.query('BEGIN');
      await setLocalAppOrgId(cA, orgA);
      await auditAppend(cA, kms, {
        orgId: orgA,
        chainId: chainA,
        eventType: 'run.created',
        eventVersion: '1',
        subjectType: 'run',
        subjectId: randomUUID(),
        occurredAt: new Date(),
        payloadHash: sha256(Buffer.from('a-payload')),
        keyId: 'audit-1',
        keyVersion: 1,
        redactionMetadata: {},
      });
      await cA.query('COMMIT');
    } finally {
      cA.release();
    }

    const cB = await db.appPool.connect();
    try {
      await cB.query('BEGIN');
      await setLocalAppOrgId(cB, orgB);
      const r = await cB.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM govai.audit_events WHERE chain_id = $1`,
        [chainA],
      );
      await cB.query('COMMIT');
      expect(r.rows[0]?.count).toBe('0');
    } finally {
      cB.release();
    }
  }, 30_000);
});
