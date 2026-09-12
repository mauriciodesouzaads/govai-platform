// Control-plane request contracts — pure parsing (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B §13).
//
// These schemas are the OUTER edge of the control plane, so the tests are mostly about what is
// REFUSED: the narrowest source-supported contract only earns that description if nothing wider
// gets through.

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_CODING_HARNESS_SURFACE,
  CODING_HARNESS_PROVIDERS,
  CONVERSATION_LIST_DEFAULT_LIMIT,
  CONVERSATION_LIST_MAX_LIMIT,
  CONVERSATION_PROVIDERS,
  CONVERSATION_TITLE_MAX_LEN,
  CreateConversationBody,
  CreateForkBody,
  FORK_BOUNDARY_MODES,
  ListConversationsQuery,
  PatchConversationBody,
  canonicalSurfaceFor,
  isAdmissibleNewConversationIdentity,
  isCodingHarnessProvider,
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

// ───────────────────────────────────────────────────────────────────────────────────────────────
// P0-D2 — the canonical coding-harness identity rule, as a PURE function.
//
// The rule is tested HERE, where it lives, and NOT through the body schemas — because it is
// deliberately not in them. The two suites below assert both halves of that: what the rule
// decides, and that the parsers stayed exactly as syntactic as they were.
// ───────────────────────────────────────────────────────────────────────────────────────────────

describe('canonical coding-harness identity (P0-D2)', () => {
  it('names exactly the two harness providers, and their one surface each', () => {
    expect([...CODING_HARNESS_PROVIDERS]).toEqual(['codex', 'claude_code']);
    expect(CANONICAL_CODING_HARNESS_SURFACE).toEqual({ codex: 'codex', claude_code: 'claude_code' });
    // The harness set is a SUBSET of 0031's four providers, never a fifth vocabulary.
    for (const p of CODING_HARNESS_PROVIDERS) {
      expect(CONVERSATION_PROVIDERS).toContain(p);
    }
    for (const p of CONVERSATION_PROVIDERS) {
      expect({ p, harness: isCodingHarnessProvider(p) }).toEqual({
        p,
        harness: p === 'codex' || p === 'claude_code',
      });
    }
  });

  it('admits each canonical pair', () => {
    for (const provider of CODING_HARNESS_PROVIDERS) {
      const surface = CANONICAL_CODING_HARNESS_SURFACE[provider];
      expect({ provider, surface, ok: isAdmissibleNewConversationIdentity(provider, surface) }).toEqual({
        provider,
        surface,
        ok: true,
      });
    }
  });

  it('★ REFUSES a near miss instead of repairing it — no trim, no case fold, no alias', () => {
    // Every token below is one a human might have MEANT as the canonical surface. Each is refused,
    // because 0031 freezes provider/surface/model for a branch's lifetime: an identity admitted by
    // a guess can never be corrected in place, and guessing is the silent substitution NX-5 bans.
    // (`' codex'` and `'codex '` are refused one layer earlier by SurfaceToken's whitespace rule;
    // they are listed to show the rule does not RESCUE them by trimming.)
    for (const surface of [
      'CODEX',
      'Codex',
      'codex_thread',
      'codex-thread',
      'codex_app_server',
      'codex_cli',
      'codex_sdk',
      ' codex',
      'codex ',
      'claude_code',      // ← the OTHER harness's canonical token: a pair, not a set
      'anthropic_api',
      'openai_responses',
      '',
    ]) {
      expect({ surface, ok: isAdmissibleNewConversationIdentity('codex', surface) }).toEqual({
        surface,
        ok: false,
      });
    }
    for (const surface of [
      'CLAUDE_CODE',
      'claude-code',
      'claude_code_session',
      'claudecode',
      'claude_code_agent_sdk',
      'codex', // ← likewise, crossed
      'anthropic_messages',
      '',
    ]) {
      expect({ surface, ok: isAdmissibleNewConversationIdentity('claude_code', surface) }).toEqual({
        surface,
        ok: false,
      });
    }
  });

  it('★ leaves the API providers exactly as free-form as they were', () => {
    // The narrowing is scoped to the two harness providers. `openai`/`anthropic` keep the
    // admission P0-B gave them; what they can EXECUTE is P0-C's dispatch registry's question,
    // and this rule must not quietly become a second, different answer to it.
    for (const provider of ['openai', 'anthropic'] as const) {
      expect(canonicalSurfaceFor(provider)).toBeNull();
      for (const surface of [
        'anthropic_api',
        'anthropic_messages',
        'openai_responses',
        'openai_chat_completions',
        'some_future_surface_nobody_has_shipped_yet',
        'codex', // even a harness-shaped token is still admissible on an API provider
      ]) {
        expect({ provider, surface, ok: isAdmissibleNewConversationIdentity(provider, surface) }).toEqual({
          provider,
          surface,
          ok: true,
        });
      }
    }
  });

  it('★ gates on NOTHING but the pair — the model vocabulary stays provider-owned (NX-2)', () => {
    // A provider shipping a model must never require a GovAI release. `model` is not an input to
    // the rule at all, which is the strongest form of that guarantee.
    expect(isAdmissibleNewConversationIdentity.length).toBe(2);
    for (const model of ['gpt-5-codex', 'claude-opus-5', 'a-model-released-tomorrow', 'x']) {
      expect(
        CreateConversationBody.safeParse({
          mode: 'governed',
          provider: 'codex',
          surface: 'codex',
          model,
        }).success,
      ).toBe(true);
    }
  });
});

describe('the body parsers stayed SYNTACTIC (P0-D2)', () => {
  it('★ the create parser is still provider-agnostic on `surface`', () => {
    // Asserted deliberately, and it is NOT a gap: the semantic rule is the SERVICE's, so that ONE
    // rule answers both create and fork — a fork's pair does not even exist until inheritance is
    // resolved against durable state, which no parser can see.
    for (const provider of CONVERSATION_PROVIDERS) {
      expect(
        CreateConversationBody.safeParse({ ...CONVERSATION, provider, surface: 'anthropic_api' }).success,
      ).toBe(true);
    }
    // ...while the SEMANTIC verdict on the very same pairs is the opposite for the harness two.
    expect(isAdmissibleNewConversationIdentity('codex', 'anthropic_api')).toBe(false);
    expect(isAdmissibleNewConversationIdentity('claude_code', 'anthropic_api')).toBe(false);
  });

  it('★ the FORK parser still leaves the triple optional — the replay path depends on it', () => {
    // A repeat of an already-committed fork re-sends its original body. If this parser refused a
    // now-noncanonical pair, that lawful historical request would fail at the outer edge, before
    // the service could ever consult its committed binding.
    const parsed = CreateForkBody.parse({ ...FORK, provider: 'codex', surface: 'codex_thread' });
    expect(parsed.provider).toBe('codex');
    expect(parsed.surface).toBe('codex_thread');
    expect(CreateForkBody.parse(FORK).surface).toBeUndefined();
  });
});
