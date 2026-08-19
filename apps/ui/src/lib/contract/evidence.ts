// MIRROR of the GovAI evidence read API. Authoritative sources (re-read at main 88191a6f,
// NOT copied from any plan document):
//   apps/api/src/routes/evidence.ts            — routes, query schemas, envelopes, pagination
//   apps/api/src/pipeline/evidence-reports.ts  — every response shape below
//
// Mirrored here and NOWHERE else in the UI (mission §13). No business policy is duplicated:
// these are transport shapes only. When `@govai/api-contract` (EP-B7) exists, this file is
// replaced by a re-export — the change is mechanical because nothing else mirrors a shape.

import { z } from 'zod';
import { isDecimalDigits } from '../format.js';

/** apps/api/src/routes/evidence.ts:37 — the exact /gaps enum. EC-6 is deliberately absent
 *  (it is status-via-summary, not a gap list) and EC-5 is deferred (no queryable source). */
export const EVIDENCE_INVARIANTS = ['ec1', 'ec2', 'ec3seal', 'ec3drop', 'ec4'] as const;
export const EvidenceInvariant = z.enum(EVIDENCE_INVARIANTS);
export type EvidenceInvariant = z.infer<typeof EvidenceInvariant>;

/** apps/api/src/routes/evidence.ts:30 (MAX_LIMIT) and :39 (default). */
export const GAPS_MAX_LIMIT = 500;
export const GAPS_DEFAULT_LIMIT = 100;

/** apps/api/src/routes/evidence.ts:29 — an upper bound on the scan window (1 year). */
export const MAX_WINDOW_SECONDS = 31_536_000;

// --- /v1/evidence/summary ---------------------------------------------------------------

/** evidence-reports.ts:66-72 — every count is a JS number (the SQL bigints are already
 *  Number()-narrowed server-side, and these are bounded per-window aggregates). */
export const EvidenceCounts = z.object({
  ec1: z.object({
    total: z.number(),
    sealed: z.number(),
    failed: z.number(),
    stalled_past_slo: z.number(),
  }),
  ec2: z.object({ chains: z.number(), chains_with_gap: z.number() }),
  ec3seal: z.object({
    native_total: z.number(),
    native_sealed: z.number(),
    native_unsealed_past_slo: z.number(),
  }),
  ec4: z.object({ provider_invocations: z.number(), without_terminal: z.number() }),
  ec6: z.object({ chains: z.number(), verified_ok: z.number(), pending: z.number() }),
});
export type EvidenceCounts = z.infer<typeof EvidenceCounts>;

/** evidence-reports.ts:413-429. `observed:false` + `drop_rate:null` is the state the route
 *  ALWAYS produces today (it passes ZERO_DROP_SNAPSHOT, evidence.ts:86,143) — the shape
 *  admits observed:true, so the UI renders both without inventing either. */
export const DropEstimate = z.object({
  invariant: z.literal('ec3drop'),
  label: z.string(),
  drops: z.number(),
  captures: z.number(),
  drop_rate: z.number().nullable(),
  observed: z.boolean(),
  bound: z.string(),
});
export type DropEstimate = z.infer<typeof DropEstimate>;

/** evidence-reports.ts:455-464. `note` is rendered VERBATIM — it is the backend's own
 *  explanation of why every chain is pending, and paraphrasing it would soften it. */
export const ChainVerificationStatus = z.object({
  invariant: z.literal('ec6'),
  label: z.string(),
  total_chains: z.number(),
  verified_ok: z.number(),
  pending: z.number(),
  last_verified_at: z.string().nullable(),
  note: z.string(),
});
export type ChainVerificationStatus = z.infer<typeof ChainVerificationStatus>;

/** evidence-reports.ts:502-517. `terms[]` and `excluded[]` (with reasons) are first-class
 *  content in the UI, never a tooltip — they are what keeps the ratio honest. */
export const CoverageRatio = z.object({
  label: z.string(),
  ratio: z.number(),
  covered: z.number(),
  total: z.number(),
  terms: z.array(
    z.object({ invariant: z.string(), covered: z.number(), total: z.number() }),
  ),
  excluded: z.array(z.object({ invariant: z.string(), reason: z.string() })),
});
export type CoverageRatio = z.infer<typeof CoverageRatio>;

/** evidence.ts:88 spreads `{org_id, ...EvidenceSummary}` (evidence-reports.ts:589-596). */
export const EvidenceSummaryResponse = z.object({
  org_id: z.string(),
  window_seconds: z.number(),
  t_seal_seconds: z.number(),
  counts: EvidenceCounts,
  ec3drop: DropEstimate,
  ec6: ChainVerificationStatus,
  coverage_ratio: CoverageRatio,
});
export type EvidenceSummaryResponse = z.infer<typeof EvidenceSummaryResponse>;

// --- /v1/evidence/gaps ------------------------------------------------------------------

/** evidence-reports.ts:197-205. `last_error` is the sanitized ≤200-char text (null while
 *  merely stalled) — never a payload. */
export const Ec1GapRow = z.object({
  capture_id: z.string(),
  chain_id: z.string(),
  chain_category: z.string(),
  status: z.string(),
  captured_at: z.string(),
  attempts: z.number(),
  last_error: z.string().nullable(),
});
export type Ec1GapRow = z.infer<typeof Ec1GapRow>;

/** evidence-reports.ts:246-254. BOTH sequence fields are bigint DECIMAL STRINGS: they can
 *  exceed Number.MAX_SAFE_INTEGER, and the backend deliberately keeps the driver's string.
 *  The regex refinement means a malformed value FAILS the parse (an honest error state)
 *  instead of silently rendering something an auditor would trust. Never Number() these. */
export const Ec2GapRow = z.object({
  chain_id: z.string(),
  first_gap_seq: z.string().refine(isDecimalDigits, 'not a decimal integer string'),
  gap_count: z.string().refine(isDecimalDigits, 'not a decimal integer string'),
});
export type Ec2GapRow = z.infer<typeof Ec2GapRow>;

/** evidence-reports.ts:302-308. */
export const Ec3SealRow = z.object({
  capture_id: z.string(),
  chain_id: z.string(),
  chain_category: z.string(),
  status: z.string(),
  captured_at: z.string(),
});
export type Ec3SealRow = z.infer<typeof Ec3SealRow>;

/** evidence-reports.ts:349-357. */
export const Ec4Row = z.object({
  run_id: z.string(),
  provider_invocation_id: z.string(),
  provider: z.string(),
  native_endpoint: z.string(),
  status_code: z.number().nullable(),
  error_class: z.string().nullable(),
  created_at: z.string(),
});
export type Ec4Row = z.infer<typeof Ec4Row>;

/** evidence.ts:154-160. NOTE: unlike /summary this body carries NO `t_seal_seconds` —
 *  the T_seal in scope comes from /summary and nowhere else. */
function gapsResponse<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    org_id: z.string(),
    invariant: EvidenceInvariant,
    window_seconds: z.number(),
    items: z.array(item),
    next_cursor: z.number().nullable(),
  });
}

export const Ec1GapsResponse = gapsResponse(Ec1GapRow);
export const Ec2GapsResponse = gapsResponse(Ec2GapRow);
export const Ec3SealGapsResponse = gapsResponse(Ec3SealRow);
export const Ec4GapsResponse = gapsResponse(Ec4Row);
/** evidence.ts:139-144 — a SINGLETON aggregate emitted on page 0 only; next_cursor is
 *  always null for this invariant, so it can never loop. */
export const Ec3DropGapsResponse = gapsResponse(DropEstimate);

export type GapsResponse<T> = {
  org_id: string;
  invariant: EvidenceInvariant;
  window_seconds: number;
  items: T[];
  next_cursor: number | null;
};

export type EvidenceGapRow = Ec1GapRow | Ec2GapRow | Ec3SealRow | Ec4Row | DropEstimate;
