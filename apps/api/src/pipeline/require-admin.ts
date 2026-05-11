// require-admin — PR3.1b (issue #22).
//
// Thin authorization gate on top of @govai/core-identity's requireRole. Any
// route that mutates or reveals tenant-administrative state must run this
// against the authenticated AuthIdentity before performing the work.
//
// Throws AdminAccessError with status=403 when the identity does not carry
// the 'admin' role. The error message is intentionally generic — it carries
// only safe metadata (status + role hint) and is suitable for HTTP responses
// without further sanitization.

import { requireRole, type Role } from '@govai/core-identity';
import type { AuthIdentity } from './auth.js';

export class AdminAccessError extends Error {
  public readonly status: number = 403;
  public readonly code: string = 'forbidden';
  public readonly required_role: Role = 'admin';
  constructor(message = 'admin role required') {
    super(message);
    this.name = 'AdminAccessError';
  }
}

/**
 * Require that the authenticated identity carries the 'admin' role. Throws
 * AdminAccessError (status=403) otherwise. The identity must have been
 * produced by authenticateApiKey (which validates roles against ALL_ROLES);
 * we re-validate here defensively to keep this helper safe in isolation.
 */
export function requireAdmin(identity: AuthIdentity): void {
  try {
    requireRole(identity.roles, ['admin']);
  } catch (err) {
    // Normalize the upstream FORBIDDEN error to our HTTP-mappable shape. We
    // intentionally do not propagate the upstream message because it lists
    // the actor's roles, which is fine for server logs but unnecessary for
    // the HTTP response; route-level handlers can choose to log identity
    // metadata separately if they want.
    void err;
    throw new AdminAccessError();
  }
}
