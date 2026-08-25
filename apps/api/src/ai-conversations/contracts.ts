// Conversation control-plane request contracts and owner-visible projections
// (EP-AI-CONVERSATION-CONTINUITY-V1 P0-B; spec §13).
//
// PURE. Parsing and shaping only — no database, no KMS, no identity, no I/O.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// SOURCE BASIS OF EVERY EXTERNALLY VISIBLE FIELD (the §5.1 obligation: the NARROWEST
// source-supported contract, and no field admitted because it "might be useful later").
//
//  CREATE — `POST /v1/ai/conversations`
//   mode      REQUIRED. `govai.ai_conversations.mode` is NOT NULL with no DEFAULT (0031:86) and
//             is IMMUTABLE from creation (spec §3): a detached dispatch and a post-reload resume
//             must choose governed vs passthrough from durable state ALONE. There is therefore
//             no safe server-owned default — a guess would durably mislane the conversation.
//   provider  REQUIRED. Mirrors 0031's CHECK exactly (openai|anthropic|codex|claude_code). The
//             mirror exists so an unknown provider is a clean 400 instead of a CHECK violation
//             surfacing as a 500; the DATABASE remains the authority.
//   surface   REQUIRED, free-form token. ★ ADJUDICATED: NO runtime surface registry exists at
//             this anchor. 0031 constrains `provider` and leaves `surface`/`model` as NOT NULL
//             text; the only surface vocabulary in the tree is the parity manifest's research
//             artifact (`docs/architecture/generated/native-experience-parity-v1.json`,
//             uppercase OPENAI_API/CODEX/…), whose `provider` axis is a DIFFERENT vocabulary
//             from 0031's four-value column. Pinning an enum here would invent a mapping the
//             accepted architecture did not fix and would have to be migrated when the real
//             registry lands. So the validation is exactly what source supports: a bounded,
//             control-character-free, non-empty token.
//   model     REQUIRED, same reasoning; the model vocabulary is provider-owned and changes
//             without a GovAI release.
//   ★ NOT accepted at create: `title` (spec §18 derives it from the first user message, or a
//     manual rename — neither exists at creation, so the field would be speculative);
//     `retention_class` (server-owned, 0031 DEFAULT 'standard'; P0-B exposes no retention
//     control and §9 forbids widening PATCH to it without independent source proof);
//     `project_id` / `workroom_id` (0031 recorded both as DEFERRED — the columns do not exist).
//
//  PATCH — `PATCH /v1/ai/conversations/:id`
//   title     §13's first guarded field. §18: manual rename always wins; never a
//             provider-generated title (that would cost a paid call and send content to the
//             provider). Bounded at 200 characters because §18 already specifies the default
//             title is a CLIENT-SIDE TRUNCATION of the first message, and because the list
//             surface decrypts up to a full page of titles per request (§6/§13 page <= 50) —
//             an unbounded title makes that bounded work unbounded.
//   archived  §13's second guarded field, mapped onto §19's lifecycle: `true` =>
//             `active -> archived` + `archived_at`; `false` => `archived -> active` and
//             `archived_at` cleared (the column names a CURRENT state, not a history).
//             Both edges are lawful under 0031's ratchet; deletion is NOT reachable from here.
//
//  LIST — `GET /v1/ai/conversations`
//   status    `active` (default) | `archived`. §19: archiving HIDES a conversation from the
//             default list, so a filter is required for archived ones to be reachable at all.
//             The deleted states are deliberately not offered (see the projection note below).
//   limit     1..50, default 25. The hard 50 is spec §13's page cap, restated here because it
//             also bounds the per-page title decryption (§6).
//   cursor    opaque keyset position (see cursor.ts). No OFFSET anywhere.
//
//  FORK — `POST /v1/ai/conversations/:id/branches`
//   client_fork_id         REQUIRED (§13 idempotency; a fork is not deduplicable from its
//                          ancestry — several forks from one pinned attempt are legitimate).
//   parent_branch_id,
//   forked_from_turn_id,
//   forked_from_attempt_id REQUIRED. §3: a fork pins a SPECIFIC IMMUTABLE ATTEMPT, never a turn
//                          alone, because retry makes a turn's eligible attempt mutable.
//   boundary_mode          OPTIONAL, default `after_attempt` (§13 names it the default).
//   provider/surface/model OPTIONAL, each independently inheriting the PARENT BRANCH's value
//                          (§13: "omitted means inherit the parent branch's"). Per-field rather
//                          than all-or-nothing so a §17 model switch need not restate the
//                          provider it is not changing; resolution is deterministic and the
//                          RESOLVED triple is what is stored and hashed.
//
// Every body schema is `.strict()`: an unrecognized field is a 400, never a silent drop. On a
// control plane whose fork operation is idempotent, silently ignoring an unknown field is how
// two DIFFERENT client intents come to hash identically.

import { z } from 'zod';

/** 0031:86 — `CHECK (mode IN ('governed','passthrough'))`. */
export const CONVERSATION_MODES = ['governed', 'passthrough'] as const;
/** 0031:88 — `CHECK (provider IN ('openai','anthropic','codex','claude_code'))`. */
export const CONVERSATION_PROVIDERS = ['openai', 'anthropic', 'codex', 'claude_code'] as const;
/** 0031:144 — `CHECK (boundary_mode IN ('after_attempt','before_attempt_output'))`. */
export const FORK_BOUNDARY_MODES = ['after_attempt', 'before_attempt_output'] as const;

export type ConversationMode = (typeof CONVERSATION_MODES)[number];
export type ConversationProvider = (typeof CONVERSATION_PROVIDERS)[number];
export type ForkBoundaryMode = (typeof FORK_BOUNDARY_MODES)[number];

/** §13 page cap. */
export const CONVERSATION_LIST_MAX_LIMIT = 50;
export const CONVERSATION_LIST_DEFAULT_LIMIT = 25;
export const CONVERSATION_TITLE_MAX_LEN = 200;
const SURFACE_MAX_LEN = 64;
const MODEL_MAX_LEN = 128;

/** True if `s` contains any ASCII control character (C0 range or DEL). Mirrors the
 *  `run-idempotency.ts` header guard: control characters in a durable identity column are
 *  never intentional and corrupt logs, headers and diagnostics downstream. */
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const code = s.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

const boundedToken = (max: number, label: string) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((v) => v.trim().length > 0, `${label} must not be blank`)
    .refine((v) => v === v.trim(), `${label} must not have leading or trailing whitespace`)
    .refine((v) => !hasControlChars(v), `${label} must not contain control characters`);

export const SurfaceToken = boundedToken(SURFACE_MAX_LEN, 'surface');
export const ModelToken = boundedToken(MODEL_MAX_LEN, 'model');

export const ConversationTitle = z
  .string()
  .min(1)
  .max(CONVERSATION_TITLE_MAX_LEN)
  .refine((v) => v.trim().length > 0, 'title must not be blank')
  .refine((v) => !hasControlChars(v), 'title must not contain control characters');

export const CreateConversationBody = z
  .object({
    mode: z.enum(CONVERSATION_MODES),
    provider: z.enum(CONVERSATION_PROVIDERS),
    surface: SurfaceToken,
    model: ModelToken,
  })
  .strict();
export type CreateConversationInput = z.infer<typeof CreateConversationBody>;

export const PatchConversationBody = z
  .object({
    title: ConversationTitle.optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (b) => b.title !== undefined || b.archived !== undefined,
    'at least one guarded field (title, archived) must be supplied',
  );
export type PatchConversationInput = z.infer<typeof PatchConversationBody>;

export const ListConversationsQuery = z
  .object({
    status: z.enum(['active', 'archived']).default('active'),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONVERSATION_LIST_MAX_LIMIT)
      .default(CONVERSATION_LIST_DEFAULT_LIMIT),
    cursor: z.string().optional(),
  })
  .strict();
export type ListConversationsInput = z.infer<typeof ListConversationsQuery>;

export const CreateForkBody = z
  .object({
    client_fork_id: z.string().uuid(),
    parent_branch_id: z.string().uuid(),
    forked_from_turn_id: z.string().uuid(),
    forked_from_attempt_id: z.string().uuid(),
    boundary_mode: z.enum(FORK_BOUNDARY_MODES).default('after_attempt'),
    provider: z.enum(CONVERSATION_PROVIDERS).optional(),
    surface: SurfaceToken.optional(),
    model: ModelToken.optional(),
  })
  .strict();
export type CreateForkInput = z.infer<typeof CreateForkBody>;

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Owner-visible projections.
//
// ★ WHAT THESE MUST NEVER CARRY (spec §21/§25 + dispatch §6.1/§25): no turn hydration, no
// execution status, no evidence status, no provider continuation state, no encrypted blob
// material (ciphertext, wrapped DEK, key id/version, keyed digest), no credential provenance,
// no worker/discovery information, no provider identifiers. A conversation projection in P0-B
// is metadata plus a DECRYPTED title, and nothing else exists to disclose.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/** Sidebar row (§15's title / provider badge / mode badge / last activity). */
export type ConversationListItem = {
  id: string;
  mode: ConversationMode;
  provider: ConversationProvider;
  surface: string;
  model: string;
  status: 'active' | 'archived';
  /** Decrypted server-side for the page; null until a rename lands (§18). */
  title: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** The root branch — created ATOMICALLY with the conversation and the durable owner of the
 *  executing triple (§3). Returned on create and on get-one so a client that reloads can still
 *  name the branch a later fork must descend from; it is the conversation's own root, not a
 *  branch COLLECTION surface (which §13 does not define for P0-B). */
export type ConversationRootBranch = {
  id: string;
  provider: ConversationProvider;
  surface: string;
  model: string;
};

export type ConversationDetail = ConversationListItem & {
  root_branch: ConversationRootBranch;
};

export type ForkBranchProjection = {
  id: string;
  conversation_id: string;
  parent_branch_id: string;
  forked_from_turn_id: string;
  forked_from_attempt_id: string;
  boundary_mode: ForkBoundaryMode;
  provider: ConversationProvider;
  surface: string;
  model: string;
  created_at: string;
  /** Present only for `before_attempt_output`, whose fork transaction mints the regeneration
   *  child turn + its fresh initial attempt (§3). `null` for `after_attempt`, where no child
   *  rows are minted at fork time. Neither is claimed, dispatched or queued (§17). */
  child_turn: { id: string; attempt_id: string } | null;
};
