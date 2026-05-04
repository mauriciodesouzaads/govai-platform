export type Role = 'admin' | 'data_protection_officer' | 'dlp_admin' | 'developer' | 'auditor';

export const ALL_ROLES: ReadonlyArray<Role> = [
  'admin',
  'data_protection_officer',
  'dlp_admin',
  'developer',
  'auditor',
];

export function hasAnyRole(actorRoles: readonly string[], required: readonly Role[]): boolean {
  for (const r of required) {
    if (actorRoles.includes(r)) return true;
  }
  return false;
}

export function requireRole(actorRoles: readonly string[], required: readonly Role[]): void {
  if (!hasAnyRole(actorRoles, required)) {
    const err = new Error(
      `forbidden: requires one of [${required.join(', ')}], actor has [${actorRoles.join(', ')}]`,
    );
    (err as Error & { code?: string }).code = 'FORBIDDEN';
    throw err;
  }
}
