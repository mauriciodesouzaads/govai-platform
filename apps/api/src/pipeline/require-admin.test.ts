// Unit tests for requireAdmin gate.

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { requireAdmin, AdminAccessError } from './require-admin.js';
import type { AuthIdentity } from './auth.js';
import type { Role } from '@govai/core-identity';

function identity(roles: readonly Role[]): AuthIdentity {
  return {
    org_id: randomUUID(),
    user_id: randomUUID(),
    api_key_prefix: 'govai_sk_xx',
    tier: 'starter',
    operational_mode: 'test',
    roles,
  };
}

describe('requireAdmin', () => {
  it('passes when identity has admin role', () => {
    expect(() => requireAdmin(identity(['admin']))).not.toThrow();
  });

  it('passes when identity has admin alongside other roles', () => {
    expect(() => requireAdmin(identity(['developer', 'admin']))).not.toThrow();
  });

  it('throws AdminAccessError when identity has only developer role', () => {
    let captured: Error | null = null;
    try {
      requireAdmin(identity(['developer']));
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(AdminAccessError);
    expect((captured as AdminAccessError).status).toBe(403);
    expect((captured as AdminAccessError).code).toBe('forbidden');
    expect((captured as AdminAccessError).required_role).toBe('admin');
  });

  it('throws when identity has only auditor', () => {
    expect(() => requireAdmin(identity(['auditor']))).toThrowError(AdminAccessError);
  });

  it('throws when identity has only dlp_admin', () => {
    expect(() => requireAdmin(identity(['dlp_admin']))).toThrowError(AdminAccessError);
  });

  it('throws when identity has only data_protection_officer', () => {
    expect(() => requireAdmin(identity(['data_protection_officer']))).toThrowError(
      AdminAccessError,
    );
  });

  it('throws when roles is empty', () => {
    expect(() => requireAdmin(identity([]))).toThrowError(AdminAccessError);
  });

  it('error message does not echo identity org/user', () => {
    let captured: Error | null = null;
    const id = identity(['developer']);
    try {
      requireAdmin(id);
    } catch (err) {
      captured = err as Error;
    }
    expect(captured!.message).not.toContain(id.org_id);
    expect(captured!.message).not.toContain(id.user_id);
  });
});
