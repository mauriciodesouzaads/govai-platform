import { createHash } from 'node:crypto';

export function sha256(data: Uint8Array): Uint8Array {
  const h = createHash('sha256');
  h.update(Buffer.from(data));
  return new Uint8Array(h.digest());
}

export function sha256Hex(data: Uint8Array): string {
  return Buffer.from(sha256(data)).toString('hex');
}
