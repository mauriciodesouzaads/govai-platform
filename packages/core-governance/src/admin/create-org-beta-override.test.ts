import { describe, it, expect } from 'vitest';
import { ApiError, createOrgBetaOverride } from './create-org-beta-override.js';
import type { BetaTokenPolicyEntry } from '@govai/core-types';

const TABLE: BetaTokenPolicyEntry[] = [
  { beta_token: 'allowed', policy: 'org_override_allowed', reason: 'opt-in', pinned_at: '2026-05-04T00:00:00Z' },
  { beta_token: 'forbidden', policy: 'hard_denied',          reason: 'unsafe', pinned_at: '2026-05-04T00:00:00Z' },
];

// Stub PoolClient — only used when the function reaches the INSERT path.
const pool = {
  query: async () => ({ rows: [{ id: 'fake-id', set_at: new Date() }] }),
} as unknown as Parameters<typeof createOrgBetaOverride>[0]['db'];

import { randomUUID } from 'node:crypto';

const baseInput = {
  org_id: randomUUID(),
  provider: 'anthropic' as const,
  reason: 'tester',
  set_by_user_id: randomUUID(),
  expires_at: new Date(Date.now() + 86_400_000),
  policy_table: TABLE,
  db: pool,
};

describe('createOrgBetaOverride', () => {
  it('hard_denied token → ApiError 403 beta_token_hard_denied (no INSERT)', async () => {
    let captured: Error | null = null;
    try {
      await createOrgBetaOverride({ ...baseInput, beta_token: 'forbidden' });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(403);
    expect((captured as ApiError).code).toBe('beta_token_hard_denied');
  });

  it('unknown token → ApiError 403 unknown_beta_token', async () => {
    let captured: Error | null = null;
    try {
      await createOrgBetaOverride({ ...baseInput, beta_token: 'never-heard-of' });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(403);
    expect((captured as ApiError).code).toBe('unknown_beta_token');
  });

  it('expires_at in the past → ApiError 400 expires_at_not_in_future', async () => {
    let captured: Error | null = null;
    try {
      await createOrgBetaOverride({
        ...baseInput,
        beta_token: 'allowed',
        expires_at: new Date(Date.now() - 1_000),
      });
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(400);
    expect((captured as ApiError).code).toBe('expires_at_not_in_future');
  });

  it('valid token + future expires_at → returns insert RETURNING row', async () => {
    const r = await createOrgBetaOverride({
      ...baseInput,
      beta_token: 'allowed',
    });
    expect(r.id).toBe('fake-id');
    expect(r.set_at).toBeInstanceOf(Date);
  });
});
