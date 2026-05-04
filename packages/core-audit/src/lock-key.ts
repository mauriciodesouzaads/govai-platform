import { createHash } from 'node:crypto';

/**
 * Deriva a chave para `pg_advisory_xact_lock(bigint)` a partir do chain_id.
 * Usa primeiros 8 bytes de SHA-256 lidos como BigInt64 big-endian.
 */
export function chainLockKey(chainId: string): bigint {
  const digest = createHash('sha256').update(chainId, 'utf8').digest();
  const view = new DataView(digest.buffer, digest.byteOffset, 8);
  return view.getBigInt64(0, false);
}
