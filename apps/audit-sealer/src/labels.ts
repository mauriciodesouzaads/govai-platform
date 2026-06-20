// Cardinality-safe label helpers. The org_id is never emitted raw (metrics or
// logs); only a short SHA-256 prefix. No capture/run/request ids, no payload.

import { createHash } from 'node:crypto';

export function orgHash(orgId: string): string {
  return createHash('sha256').update(orgId).digest('hex').slice(0, 16);
}
