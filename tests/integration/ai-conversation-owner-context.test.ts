// EP-AI-CONVERSATION-CONTINUITY-V1 P0-A1 — owner-context lifecycle against a
// real Postgres (dispatch §11/§22-K) + encrypted-row proof (§22-J).
//
// Proves: withOwnerContext sets BOTH GUCs transaction-locally; commit AND
// rollback clear them; a pooled connection reused across owners leaks
// nothing; withTenant keeps its org-only semantics; and a content row stored
// through the real DevKms purpose-aware envelope holds ciphertext (never the
// plaintext fixture) with a KEYED digest (never raw sha256).

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import {
  withOwnerContext,
  withTenant,
  setLocalAppOrgId,
  setLocalAppUserId,
} from '@govai/core-tenant';
import { DevKms } from '@govai/core-identity';
import { startPostgres, stopPostgres, freshSeedHex, type TestDb } from './setup.js';
import { freshOwner, seedFullChain } from './helpers/ai-conversation-seed.js';

let db: TestDb;
beforeAll(async () => {
  db = await startPostgres();
}, 240_000);
afterAll(async () => {
  if (db) await stopPostgres(db);
});

async function readGucs(c: import('pg').PoolClient): Promise<{ org: string; user: string }> {
  const r = await c.query<{ org: string; usr: string }>(
    `SELECT current_setting('app.org_id', true) AS org,
            current_setting('app.user_id', true) AS usr`,
  );
  return { org: r.rows[0]!.org ?? '', user: r.rows[0]!.usr ?? '' };
}

describe('owner context lifecycle (real Postgres)', () => {
  it('withOwnerContext sets both GUCs inside the transaction and commit clears them', async () => {
    const owner = freshOwner();
    const c = await db.appPool.connect();
    try {
      const inside = await withOwnerContext(c, owner.orgId, owner.ownerUserId, async (tx) =>
        readGucs(tx),
      );
      expect(inside.org).toBe(owner.orgId);
      expect(inside.user).toBe(owner.ownerUserId);
      // After COMMIT the transaction-local settings are gone on the SAME connection.
      const after = await readGucs(c);
      expect(after.org === '' || after.org === null).toBe(true);
      expect(after.user === '' || after.user === null).toBe(true);
    } finally {
      c.release();
    }
  });

  it('rollback clears the owner context', async () => {
    const owner = freshOwner();
    const c = await db.appPool.connect();
    try {
      await expect(
        withOwnerContext(c, owner.orgId, owner.ownerUserId, async () => {
          throw new Error('forced rollback');
        }),
      ).rejects.toThrow('forced rollback');
      const after = await readGucs(c);
      expect(after.org === '' || after.org === null).toBe(true);
      expect(after.user === '' || after.user === null).toBe(true);
    } finally {
      c.release();
    }
  });

  it('a pooled connection reused across owners leaks nothing (owner A → owner B)', async () => {
    const ownerA = freshOwner();
    const ownerB = freshOwner();
    const chainA = await seedFullChain(db.adminPool, ownerA);
    const c = await db.appPool.connect();
    try {
      // Owner A sees their conversation.
      const seenByA = await withOwnerContext(c, ownerA.orgId, ownerA.ownerUserId, async (tx) => {
        const r = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]);
        return r.rowCount ?? 0;
      });
      expect(seenByA).toBe(1);
      // SAME physical connection, owner B: A's rows are gone.
      const seenByB = await withOwnerContext(c, ownerB.orgId, ownerB.ownerUserId, async (tx) => {
        const r = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chainA.conversationId,
        ]);
        return r.rowCount ?? 0;
      });
      expect(seenByB).toBe(0);
      // And with NO context re-established, the connection sees nothing at all.
      const bare = await c.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
        chainA.conversationId,
      ]);
      expect(bare.rowCount).toBe(0);
    } finally {
      c.release();
    }
  });

  it('withTenant is unchanged: org-only context never satisfies the ai_* dual predicate', async () => {
    const owner = freshOwner();
    const chain = await seedFullChain(db.adminPool, owner);
    const c = await db.appPool.connect();
    try {
      const result = await withTenant(c, owner.orgId, async (tx) => {
        const gucs = await readGucs(tx);
        const r = await tx.query(`SELECT id FROM govai.ai_conversations WHERE id = $1::uuid`, [
          chain.conversationId,
        ]);
        return { gucs, rows: r.rowCount ?? 0 };
      });
      expect(result.gucs.org).toBe(owner.orgId);
      expect(result.gucs.user === '' || result.gucs.user === null).toBe(true);
      expect(result.rows).toBe(0);
    } finally {
      c.release();
    }
  });

  it('setLocalAppUserId outside a transaction does not persist on the connection', async () => {
    const owner = freshOwner();
    const c = await db.appPool.connect();
    try {
      // set_config(..., true) outside an explicit transaction is scoped to the
      // implicit statement transaction — it must not stick to the session.
      await setLocalAppOrgId(c, owner.orgId);
      await setLocalAppUserId(c, owner.ownerUserId);
      const after = await readGucs(c);
      expect(after.org === '' || after.org === null).toBe(true);
      expect(after.user === '' || after.user === null).toBe(true);
    } finally {
      c.release();
    }
  });
});

describe('encrypted content at rest (real DevKms, purpose-aware)', () => {
  const PLAINTEXT = 'segredo do usuário: relatório confidencial P0-A1';

  it('a stored content row holds ciphertext + a keyed digest — never the plaintext, never raw sha256', async () => {
    const kms = new DevKms(freshSeedHex());
    const owner = freshOwner();
    const keyId = 'ai-conversation-content-v1';
    const version = 1;
    const plaintextBytes = Buffer.from(PLAINTEXT, 'utf8');

    // Wire order per §6: hash (keyed) → encrypt → store.
    const digest = await kms.hmacSha256({
      purpose: 'conversation_content_integrity',
      orgId: owner.orgId,
      keyId,
      version,
      message: plaintextBytes,
    });
    const enc = await kms.envelopeEncrypt({
      orgId: owner.orgId,
      keyId,
      version,
      plaintext: plaintextBytes,
      purpose: 'conversation_content',
    });

    // Store through govai_app under the owner context.
    const { conversationId } = await (async () => {
      const conv = await db.adminPool.query<{ id: string }>(
        `INSERT INTO govai.ai_conversations (org_id, owner_user_id, mode, provider, surface, model)
         VALUES ($1::uuid, $2::uuid, 'governed', 'anthropic', 'anthropic_api', 'm') RETURNING id`,
        [owner.orgId, owner.ownerUserId],
      );
      return { conversationId: conv.rows[0]!.id };
    })();
    const c = await db.appPool.connect();
    let contentId = '';
    try {
      contentId = await withOwnerContext(c, owner.orgId, owner.ownerUserId, async (tx) => {
        const r = await tx.query<{ id: string }>(
          `INSERT INTO govai.ai_conversation_content
             (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped, kms_key_id,
              kms_key_version, content_hmac)
           VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::text, $7::int, $8::bytea)
           RETURNING id`,
          [
            owner.orgId,
            owner.ownerUserId,
            conversationId,
            Buffer.from(enc.ciphertext),
            Buffer.from(enc.dekWrapped),
            keyId,
            version,
            Buffer.from(digest),
          ],
        );
        return r.rows[0]!.id;
      });
    } finally {
      c.release();
    }

    // RAW row inspection (admin, RLS bypassed): the fixture is not there.
    const raw = await db.adminPool.query<{
      ciphertext: Buffer;
      dek_wrapped: Buffer;
      content_hmac: Buffer;
    }>(`SELECT ciphertext, dek_wrapped, content_hmac FROM govai.ai_conversation_content
         WHERE id = $1::uuid`, [contentId]);
    const row = raw.rows[0]!;
    expect(row.ciphertext.includes(plaintextBytes)).toBe(false);
    expect(row.ciphertext.toString('latin1')).not.toContain(PLAINTEXT);
    expect(row.dek_wrapped.includes(plaintextBytes)).toBe(false);

    // The operational digest is the KEYED HMAC — and provably NOT sha256(plaintext).
    const rawSha256 = createHash('sha256').update(plaintextBytes).digest();
    expect(row.content_hmac.equals(rawSha256)).toBe(false);
    expect(row.content_hmac.equals(Buffer.from(digest))).toBe(true);

    // Round-trip under the correct purpose; cross-purpose decrypt fails closed.
    const dec = await kms.envelopeDecrypt({
      orgId: owner.orgId,
      keyId,
      version,
      ciphertext: row.ciphertext,
      dekWrapped: row.dek_wrapped,
      purpose: 'conversation_content',
    });
    expect(Buffer.from(dec).toString('utf8')).toBe(PLAINTEXT);
    await expect(
      kms.envelopeDecrypt({
        orgId: owner.orgId,
        keyId,
        version,
        ciphertext: row.ciphertext,
        dekWrapped: row.dek_wrapped,
        purpose: 'payload_dek',
      }),
    ).rejects.toThrow();
  });

  it('same title under conversation_content_integrity vs audit_hmac yields different digests (purpose isolation)', async () => {
    const kms = new DevKms(freshSeedHex());
    const owner = freshOwner();
    const message = Buffer.from('Reunião com jurídico', 'utf8');
    const a = await kms.hmacSha256({
      purpose: 'conversation_content_integrity',
      orgId: owner.orgId,
      keyId: 'k',
      version: 1,
      message,
    });
    const b = await kms.hmacSha256({
      purpose: 'audit_hmac',
      orgId: owner.orgId,
      keyId: 'k',
      version: 1,
      message,
    });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });
});
