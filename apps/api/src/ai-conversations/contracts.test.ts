// Control-plane request contracts — pure parsing (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B §13).
//
// These schemas are the OUTER edge of the control plane, so the tests are mostly about what is
// REFUSED: the narrowest source-supported contract only earns that description if nothing wider
// gets through.

import { describe, it, expect } from 'vitest';
import {
  CONVERSATION_LIST_DEFAULT_LIMIT,
  CONVERSATION_LIST_MAX_LIMIT,
  CONVERSATION_PROVIDERS,
  CONVERSATION_TITLE_MAX_LEN,
  CreateConversationBody,
  CreateForkBody,
  FORK_BOUNDARY_MODES,
  ListConversationsQuery,
  PatchConversationBody,
} from './contracts.js';

const CONVERSATION = {
  mode: 'governed',
  provider: 'anthropic',
  surface: 'anthropic_api',
  model: 'claude-test',
};

const FORK = {
  client_fork_id: '3f8b1a52-2c4d-4e7a-9b10-6d5f2e8c1a44',
  parent_branch_id: '9c1e7d30-51aa-4b62-8f03-2e4d6b8a0c71',
  forked_from_turn_id: 'b7d24f18-0e35-4a9c-bd61-7f0a2c53e9d8',
  forked_from_attempt_id: '5a0c93e7-8d21-4f56-a3b8-1c9e4d70f265',
};

describe('create conversation body', () => {
  it('accepts the four required fields and mirrors 0031 exactly', () => {
    expect(CreateConversationBody.parse(CONVERSATION)).toEqual(CONVERSATION);
    // The provider mirror is a CHECK mirror, not an independent vocabulary.
    expect([...CONVERSATION_PROVIDERS]).toEqual(['openai', 'anthropic', 'codex', 'claude_code']);
    for (const provider of CONVERSATION_PROVIDERS) {
      expect(CreateConversationBody.safeParse({ ...CONVERSATION, provider }).success).toBe(true);
    }
  });

  it('requires every field: none has a safe server-owned default', () => {
    for (const missing of ['mode', 'provider', 'surface', 'model'] as const) {
      const body: Record<string, unknown> = { ...CONVERSATION };
      delete body[missing];
      expect({ missing, ok: CreateConversationBody.safeParse(body).success }).toEqual({
        missing,
        ok: false,
      });
    }
  });

  it('rejects an unknown field rather than silently dropping it', () => {
    // `title`, `retention_class`, `project_id` and `workroom_id` are all deliberately absent
    // from the P0-B create contract; a client that sends one must learn that, not be told
    // "created" while its intent was discarded.
    for (const extra of ['title', 'retention_class', 'project_id', 'workroom_id', 'status']) {
      expect({
        extra,
        ok: CreateConversationBody.safeParse({ ...CONVERSATION, [extra]: 'x' }).success,
      }).toEqual({ extra, ok: false });
    }
  });

  it('rejects unknown enum values and malformed tokens', () => {
    expect(CreateConversationBody.safeParse({ ...CONVERSATION, mode: 'hybrid' }).success).toBe(
      false,
    );
    expect(CreateConversationBody.safeParse({ ...CONVERSATION, provider: 'gemini' }).success).toBe(
      false,
    );
    for (const surface of ['', '   ', ' anthropic_api', 'anthropic_api ', 'a\u0000b', 'a\nb']) {
      expect({ surface, ok: CreateConversationBody.safeParse({ ...CONVERSATION, surface }).success })
        .toEqual({ surface, ok: false });
    }
    expect(
      CreateConversationBody.safeParse({ ...CONVERSATION, surface: 'x'.repeat(65) }).success,
    ).toBe(false);
    expect(CreateConversationBody.safeParse({ ...CONVERSATION, model: 'x'.repeat(129) }).success).toBe(
      false,
    );
  });
});

describe('patch conversation body', () => {
  it('accepts each guarded field alone and both together', () => {
    expect(PatchConversationBody.parse({ title: 'Quarterly risk review' })).toEqual({
      title: 'Quarterly risk review',
    });
    expect(PatchConversationBody.parse({ archived: true })).toEqual({ archived: true });
    expect(PatchConversationBody.parse({ archived: false })).toEqual({ archived: false });
    expect(PatchConversationBody.safeParse({ title: 'x', archived: true }).success).toBe(true);
  });

  it('rejects an empty patch — a no-op mutation would bump updated_at for nothing', () => {
    expect(PatchConversationBody.safeParse({}).success).toBe(false);
  });

  it('rejects every field §13 does NOT make guarded', () => {
    for (const field of [
      'mode',
      'provider',
      'surface',
      'model',
      'status',
      'org_id',
      'owner_user_id',
      'id',
      'created_at',
      'retention_class',
      'deleted',
    ]) {
      expect({
        field,
        ok: PatchConversationBody.safeParse({ [field]: 'x' }).success,
      }).toEqual({ field, ok: false });
    }
  });

  it('bounds and cleans the title (§18: client-truncated; §13: a page decrypts <= 50 of them)', () => {
    expect(PatchConversationBody.safeParse({ title: '' }).success).toBe(false);
    expect(PatchConversationBody.safeParse({ title: '   ' }).success).toBe(false);
    expect(PatchConversationBody.safeParse({ title: 'ab' }).success).toBe(false);
    expect(
      PatchConversationBody.safeParse({ title: 'x'.repeat(CONVERSATION_TITLE_MAX_LEN) }).success,
    ).toBe(true);
    expect(
      PatchConversationBody.safeParse({ title: 'x'.repeat(CONVERSATION_TITLE_MAX_LEN + 1) }).success,
    ).toBe(false);
  });
});

describe('list query', () => {
  it('defaults to the ACTIVE page (§19: archiving hides from the default list)', () => {
    expect(ListConversationsQuery.parse({})).toEqual({
      status: 'active',
      limit: CONVERSATION_LIST_DEFAULT_LIMIT,
    });
  });

  it('enforces the §13 page cap and rejects a non-positive page', () => {
    expect(ListConversationsQuery.parse({ limit: '50' }).limit).toBe(CONVERSATION_LIST_MAX_LIMIT);
    expect(ListConversationsQuery.safeParse({ limit: '51' }).success).toBe(false);
    expect(ListConversationsQuery.safeParse({ limit: '0' }).success).toBe(false);
    expect(ListConversationsQuery.safeParse({ limit: '-1' }).success).toBe(false);
    expect(ListConversationsQuery.safeParse({ limit: '2.5' }).success).toBe(false);
  });

  it('offers only the two archive-semantics statuses, and no query DSL', () => {
    expect(ListConversationsQuery.safeParse({ status: 'archived' }).success).toBe(true);
    for (const status of ['deleted', 'deleted_pending', 'all']) {
      expect({ status, ok: ListConversationsQuery.safeParse({ status }).success }).toEqual({
        status,
        ok: false,
      });
    }
    for (const extra of ['offset', 'order_by', 'q', 'search', 'provider', 'include_turns']) {
      expect({ extra, ok: ListConversationsQuery.safeParse({ [extra]: 'x' }).success }).toEqual({
        extra,
        ok: false,
      });
    }
  });
});

describe('fork body', () => {
  it('defaults boundary_mode to after_attempt (§13) and inherits an omitted triple', () => {
    const parsed = CreateForkBody.parse(FORK);
    expect(parsed.boundary_mode).toBe('after_attempt');
    expect(parsed.provider).toBeUndefined();
    expect(parsed.surface).toBeUndefined();
    expect(parsed.model).toBeUndefined();
    expect([...FORK_BOUNDARY_MODES]).toEqual(['after_attempt', 'before_attempt_output']);
  });

  it('requires the client fork id AND the full pinned lineage — never a turn alone', () => {
    for (const missing of [
      'client_fork_id',
      'parent_branch_id',
      'forked_from_turn_id',
      'forked_from_attempt_id',
    ] as const) {
      const body: Record<string, unknown> = { ...FORK };
      delete body[missing];
      expect({ missing, ok: CreateForkBody.safeParse(body).success }).toEqual({
        missing,
        ok: false,
      });
    }
  });

  it('accepts a per-field triple override', () => {
    expect(CreateForkBody.parse({ ...FORK, model: 'other-model' }).model).toBe('other-model');
    expect(CreateForkBody.parse({ ...FORK, provider: 'openai' }).provider).toBe('openai');
  });

  it('rejects unknown fields — including a native request config this movement cannot honour', () => {
    for (const extra of [
      'native_request_config',
      'replacement_config',
      'client_turn_id',
      'input',
      'messages',
      'dispatch',
    ]) {
      expect({ extra, ok: CreateForkBody.safeParse({ ...FORK, [extra]: {} }).success }).toEqual({
        extra,
        ok: false,
      });
    }
  });

  it('rejects a non-uuid lineage id and an unknown boundary mode', () => {
    expect(CreateForkBody.safeParse({ ...FORK, forked_from_attempt_id: 'nope' }).success).toBe(
      false,
    );
    expect(CreateForkBody.safeParse({ ...FORK, boundary_mode: 'terminal_ish' }).success).toBe(
      false,
    );
  });
});
