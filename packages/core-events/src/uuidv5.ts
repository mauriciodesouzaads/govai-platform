// RFC 4122 §4.3 — name-based UUIDv5 (SHA-1). CLU audit E.3: the `uuid` package
// is not in the dependency tree and `node:crypto` exposes only v4
// (`randomUUID`), so this is a self-contained ~20-line implementation on the
// standard library. No new dependency is introduced (SPEC-01 §5 / D2-A3).
//
// `uuidv5(namespace, name)` = SHA-1 over (namespace-bytes ‖ name-utf8), then the
// 4-bit version is set to 5 and the 2-bit RFC 4122 variant is set. Deterministic
// for a given (namespace, name).

import { createHash } from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function namespaceToBytes(namespace: string): Buffer {
  if (!UUID_RE.test(namespace)) {
    throw new Error(`uuidv5: namespace must be a canonical UUID (got ${JSON.stringify(namespace)})`);
  }
  return Buffer.from(namespace.replace(/-/g, ''), 'hex');
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * RFC 4122 §4.3 version-5 (SHA-1) name-based UUID.
 *
 * @param namespace canonical UUID string identifying the namespace.
 * @param name the name within the namespace; hashed as its UTF-8 bytes.
 * @returns the lowercase canonical UUIDv5 string.
 */
export function uuidv5(namespace: string, name: string): string {
  const ns = namespaceToBytes(namespace);
  const nameBytes = Buffer.from(name, 'utf8');
  const digest = createHash('sha1').update(ns).update(nameBytes).digest(); // 20 bytes
  const out = Buffer.alloc(16);
  digest.copy(out, 0, 0, 16);
  out.writeUInt8((out.readUInt8(6) & 0x0f) | 0x50, 6); // version 5
  out.writeUInt8((out.readUInt8(8) & 0x3f) | 0x80, 8); // RFC 4122 variant (10xx)
  return bytesToUuid(out);
}
