import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import { sha256 } from './hash.js';
import { hmacVerify } from './hmac.js';

export type VerifyResult = {
  valid: boolean;
  events: number;
  firstInvalidSeq: bigint | null;
  reason: string | null;
};

type Row = {
  id: string;
  sequence_number: string;
  previous_hmac: Buffer | null;
  hmac: Buffer;
  canonical_hash: Buffer;
  canonical_bytes: Buffer;
  key_id: string;
  key_version: number;
  org_id: string;
};

/**
 * Verifica a chain inteira. Caller deve já ter setado `app.org_id`.
 */
export async function verifyFullChain(
  client: PoolClient,
  kms: Kms,
  chainId: string,
): Promise<VerifyResult> {
  const res = await client.query<Row>(
    `SELECT id, sequence_number, previous_hmac, hmac, canonical_hash, canonical_bytes,
            key_id, key_version, org_id
       FROM govai.audit_events
      WHERE chain_id = $1
      ORDER BY sequence_number ASC`,
    [chainId],
  );

  if (res.rows.length === 0) {
    return { valid: true, events: 0, firstInvalidSeq: null, reason: null };
  }

  let expectedSeq = 1n;
  let prev: Buffer | null = null;
  for (const row of res.rows) {
    const seq = BigInt(row.sequence_number);
    if (seq !== expectedSeq) {
      return {
        valid: false,
        events: res.rows.length,
        firstInvalidSeq: seq,
        reason: `sequence gap: expected ${expectedSeq}, got ${seq}`,
      };
    }
    // previous_hmac coerência
    if ((prev === null) !== (row.previous_hmac === null)) {
      return {
        valid: false,
        events: res.rows.length,
        firstInvalidSeq: seq,
        reason: `previous_hmac null mismatch at seq ${seq}`,
      };
    }
    if (prev && row.previous_hmac && !prev.equals(row.previous_hmac)) {
      return {
        valid: false,
        events: res.rows.length,
        firstInvalidSeq: seq,
        reason: `previous_hmac chain break at seq ${seq}`,
      };
    }

    // canonical_hash deve casar SHA-256(canonical_bytes)
    const computedHash = sha256(new Uint8Array(row.canonical_bytes));
    if (Buffer.from(computedHash).compare(row.canonical_hash) !== 0) {
      return {
        valid: false,
        events: res.rows.length,
        firstInvalidSeq: seq,
        reason: `canonical_hash mismatch at seq ${seq}`,
      };
    }

    // hmac deve casar HMAC(canonical_bytes)
    const ok = await hmacVerify(
      { kms, orgId: row.org_id, keyId: row.key_id, keyVersion: row.key_version },
      new Uint8Array(row.canonical_bytes),
      new Uint8Array(row.hmac),
    );
    if (!ok) {
      return {
        valid: false,
        events: res.rows.length,
        firstInvalidSeq: seq,
        reason: `hmac mismatch at seq ${seq}`,
      };
    }

    prev = row.hmac;
    expectedSeq += 1n;
  }

  return { valid: true, events: res.rows.length, firstInvalidSeq: null, reason: null };
}

export async function verifyTailWindow(
  client: PoolClient,
  kms: Kms,
  chainId: string,
  windowSize = 32,
): Promise<VerifyResult> {
  const tailRes = await client.query<Row>(
    `SELECT id, sequence_number, previous_hmac, hmac, canonical_hash, canonical_bytes,
            key_id, key_version, org_id
       FROM govai.audit_events
      WHERE chain_id = $1
      ORDER BY sequence_number DESC
      LIMIT $2`,
    [chainId, windowSize],
  );

  if (tailRes.rows.length === 0) {
    return { valid: true, events: 0, firstInvalidSeq: null, reason: null };
  }

  // Reverter para ordem ascendente.
  const rows = tailRes.rows.slice().reverse();
  let prev: Buffer | null = rows[0]?.previous_hmac ?? null;
  for (const row of rows) {
    const computedHash = sha256(new Uint8Array(row.canonical_bytes));
    if (Buffer.from(computedHash).compare(row.canonical_hash) !== 0) {
      return {
        valid: false,
        events: rows.length,
        firstInvalidSeq: BigInt(row.sequence_number),
        reason: `canonical_hash mismatch at seq ${row.sequence_number}`,
      };
    }
    const ok = await hmacVerify(
      { kms, orgId: row.org_id, keyId: row.key_id, keyVersion: row.key_version },
      new Uint8Array(row.canonical_bytes),
      new Uint8Array(row.hmac),
    );
    if (!ok) {
      return {
        valid: false,
        events: rows.length,
        firstInvalidSeq: BigInt(row.sequence_number),
        reason: `hmac mismatch at seq ${row.sequence_number}`,
      };
    }
    if (prev !== null && row.previous_hmac && !prev.equals(row.previous_hmac)) {
      return {
        valid: false,
        events: rows.length,
        firstInvalidSeq: BigInt(row.sequence_number),
        reason: `previous_hmac chain break at seq ${row.sequence_number}`,
      };
    }
    prev = row.hmac;
  }

  return { valid: true, events: rows.length, firstInvalidSeq: null, reason: null };
}
