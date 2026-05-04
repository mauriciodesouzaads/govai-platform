import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import { canonicalize } from './canonical-json.js';
import { sha256 } from './hash.js';
import { chainLockKey } from './lock-key.js';
import { hmacSign } from './hmac.js';

export type AuditAppendInput = {
  orgId: string;
  chainId: string;
  eventType: string;
  eventVersion: string;
  subjectType: string;
  subjectId: string;
  occurredAt: Date;
  payloadHash: Uint8Array;
  payloadEncrypted?: Uint8Array;
  dekWrapped?: Uint8Array;
  keyId: string;
  keyVersion: number;
  redactionMetadata: Record<string, unknown>;
  evidenceStrength?: 'hmac_internal' | 'dev_signed';
};

export type AuditAppendOutput = {
  eventId: string;
  payloadId: string | null;
  sequenceNumber: bigint;
  hmac: Uint8Array;
  canonical: string;
  canonicalBytes: Uint8Array;
  canonicalHash: Uint8Array;
};

/**
 * Append idempotente-protegido: assume transação já aberta e tenant já setado.
 * O caller deve estar dentro de uma transação com `app.org_id` setado em LOCAL.
 */
export async function auditAppend(
  client: PoolClient,
  kms: Kms,
  input: AuditAppendInput,
): Promise<AuditAppendOutput> {
  // Validação de tenant context.
  const sessionRes = await client.query<{ v: string | null }>(
    "SELECT current_setting('app.org_id', true) AS v",
  );
  const sessionOrg = sessionRes.rows[0]?.v ?? null;
  if (!sessionOrg || sessionOrg !== input.orgId) {
    throw new Error(
      `auditAppend: tenant context mismatch (session=${sessionOrg ?? 'NULL'} input=${input.orgId})`,
    );
  }

  const lockKey = chainLockKey(input.chainId);
  // Dentro da transação corrente.
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey.toString()]);

  const headRes = await client.query<{ hmac: Buffer | null; sequence_number: string | null }>(
    `SELECT hmac, sequence_number
       FROM govai.audit_events
      WHERE chain_id = $1
      ORDER BY sequence_number DESC
      LIMIT 1`,
    [input.chainId],
  );
  const head = headRes.rows[0];
  const prevHmac: Buffer | null = head?.hmac ?? null;
  const nextSeq: bigint = (head?.sequence_number ? BigInt(head.sequence_number) : 0n) + 1n;

  const eventId = randomUUID();
  const payloadId = input.payloadEncrypted ? randomUUID() : null;

  const canonical = canonicalize({
    event_id: eventId,
    org_id: input.orgId,
    chain_id: input.chainId,
    sequence_number: nextSeq.toString(),
    previous_hmac: prevHmac ? prevHmac.toString('hex') : null,
    event_type: input.eventType,
    event_version: input.eventVersion,
    subject_type: input.subjectType,
    subject_id: input.subjectId,
    occurred_at: input.occurredAt.toISOString(),
    payload_hash: Buffer.from(input.payloadHash).toString('hex'),
    payload_ref: payloadId,
    key_id: input.keyId,
    key_version: input.keyVersion,
    evidence_strength: input.evidenceStrength ?? 'hmac_internal',
    redaction_metadata: input.redactionMetadata,
  });
  const canonicalBytes = Buffer.from(canonical, 'utf8');
  const canonicalHash = sha256(canonicalBytes);

  const hmac = await hmacSign(
    { kms, orgId: input.orgId, keyId: input.keyId, keyVersion: input.keyVersion },
    canonicalBytes,
  );

  await client.query(
    `SELECT govai.audit_append_locked(
       $1::uuid, $2::uuid, $3::text, $4::bigint, $5::bytea, $6::bigint,
       $7::bytea, $8::bytea, $9::bytea,
       $10::text, $11::text, $12::text, $13::uuid, $14::timestamptz,
       $15::bytea, $16::uuid, $17::bytea, $18::bytea,
       $19::text, $20::integer, $21::jsonb, $22::text
     )`,
    [
      eventId,
      input.orgId,
      input.chainId,
      lockKey.toString(),
      prevHmac,
      nextSeq.toString(),
      Buffer.from(canonicalHash),
      Buffer.from(canonicalBytes),
      Buffer.from(hmac),
      input.eventType,
      input.eventVersion,
      input.subjectType,
      input.subjectId,
      input.occurredAt.toISOString(),
      Buffer.from(input.payloadHash),
      payloadId,
      input.payloadEncrypted ? Buffer.from(input.payloadEncrypted) : null,
      input.dekWrapped ? Buffer.from(input.dekWrapped) : null,
      input.keyId,
      input.keyVersion,
      JSON.stringify(input.redactionMetadata),
      input.evidenceStrength ?? 'hmac_internal',
    ],
  );

  return {
    eventId,
    payloadId,
    sequenceNumber: nextSeq,
    hmac,
    canonical,
    canonicalBytes: new Uint8Array(canonicalBytes),
    canonicalHash,
  };
}
