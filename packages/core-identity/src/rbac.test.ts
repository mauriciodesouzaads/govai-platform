import { describe, it, expect } from 'vitest';
import { hasAnyRole, requireRole, ALL_ROLES } from './rbac.js';

describe('rbac', () => {
  it('hasAnyRole returns true when actor has at least one required role', () => {
    expect(hasAnyRole(['developer', 'admin'], ['admin'])).toBe(true);
    expect(hasAnyRole(['admin'], ['data_protection_officer', 'admin'])).toBe(true);
  });

  it('hasAnyRole returns false when no overlap', () => {
    expect(hasAnyRole(['developer'], ['admin'])).toBe(false);
    expect(hasAnyRole([], ['admin'])).toBe(false);
  });

  it('requireRole throws FORBIDDEN with informative message when missing', () => {
    let captured: Error | null = null;
    try {
      requireRole(['developer'], ['admin']);
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).not.toBeNull();
    expect((captured as Error & { code?: string }).code).toBe('FORBIDDEN');
    expect((captured as Error).message).toContain('admin');
    expect((captured as Error).message).toContain('developer');
  });

  it('requireRole returns silently when authorized', () => {
    expect(() => requireRole(['admin'], ['admin'])).not.toThrow();
  });

  it('ALL_ROLES contains expected roles', () => {
    expect(ALL_ROLES).toContain('admin');
    expect(ALL_ROLES).toContain('data_protection_officer');
    expect(ALL_ROLES).toContain('dlp_admin');
    expect(ALL_ROLES).toContain('developer');
    expect(ALL_ROLES).toContain('auditor');
  });
});
