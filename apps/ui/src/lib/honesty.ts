// ★ THE HONESTY ENGINE — a product-safety primitive, not a formatting helper.
//
// Every function here is pure and table-driven, and each one exists to make a specific
// misreading impossible. They are unit-tested before any screen consumes them.
//
// The invariants these functions encode (mission §15, UI Master Plan §3.4 / §4.1, Foundation
// V1 freeze record §3 and §10):
//
//   1. GREEN IS A FACT, NOT AN ABSENCE. `ok` is returned only when the backend asserts that
//      something was verified, covered or sealed. "Nothing was reported" is never `ok`.
//   2. EC-6 IS NEVER GREEN WHILE PENDING. This build persists no chain verification, so
//      pending is the normal state and it is amber, with the backend's own note rendered
//      verbatim next to it.
//   3. AN UNOBSERVED SIGNAL IS NOT A ZERO. EC-3.drop reports `observed:false` with a zero
//      count; that is the absence of a measurement in this process, not proof of no loss.
//   4. AN EMPTY POPULATION IS NOT FULL COVERAGE. coverage_ratio returns 1.0 when the total is
//      zero; that is "nothing in scope", and it is neutral, not green.
//   5. BLOCKED IF AND ONLY IF 403. A governance decision that was forwarded to the provider is
//      never labelled blocked, applied, protected or withheld — in any language.
//
// ── Scope note for `enforcementLabel` (read before deleting it as unused) ──────────────────
// U1 renders no per-request enforcement decision, because at this base no route exposes one:
// the direct-route capture persists a hash-only projection and there is no per-request
// governance feed (the named backend follow-up EP-B6). The normative table nevertheless ships
// here, fully translated and fully tested, because both master plans require it to exist and
// be tested BEFORE the first screen that uses it — so that screen cannot invent a label. It is
// a tested pure function with no UI consumer in U1, deliberately.

import type { MessageKey } from './i18n/catalogs/index.js';
import type { Tone } from './vocab.js';
import { EVIDENCE_INVARIANTS } from './contract/evidence.js';
import type {
  ChainVerificationStatus,
  CoverageRatio,
  DropEstimate,
  EvidenceCounts,
  EvidenceInvariant,
} from './contract/evidence.js';

export type HonestyVerdict = { messageKey: MessageKey; tone: Tone };

// ---------------------------------------------------------------------------------------
// 1. Enforcement decision vocabulary (normative table)
// ---------------------------------------------------------------------------------------

/** `enforcement_decision` — packages/core-governance/src/governed-native/resolve-governance.ts. */
export const ENFORCEMENT_DECISIONS = [
  'observe',
  'warn',
  'ask',
  'enforce',
  'sandbox_required',
  'blocked',
] as const;
export type EnforcementDecision = (typeof ENFORCEMENT_DECISIONS)[number];

/** What actually caused a 403, when the runtime told us. */
export type BlockTrigger = 'tool_validation' | 'governance_enforcement';

/** The decisions that FORWARD the request to the provider. Every one of them reached the
 *  provider; none of them stopped anything. `blocked` is deliberately absent. */
const FORWARDED_LABELS: Record<Exclude<EnforcementDecision, 'blocked'>, MessageKey> = {
  observe: 'enforcement.observe',
  warn: 'enforcement.warn',
  ask: 'enforcement.ask',
  enforce: 'enforcement.enforce',
  sandbox_required: 'enforcement.sandbox_required',
};

/** Amber for the two decisions a reader is most likely to over-read as an applied control
 *  (`ask` — nobody was asked; `sandbox_required` — no sandbox was created), neutral for the
 *  rest. NEVER red: red is reserved for a material effect, and nothing was stopped. */
const FORWARDED_TONES: Record<Exclude<EnforcementDecision, 'blocked'>, Tone> = {
  observe: 'neutral',
  warn: 'neutral',
  ask: 'attention',
  enforce: 'neutral',
  sandbox_required: 'attention',
};

export type EnforcementInput = {
  /** The material fact: did the request actually return 403? */
  http403: boolean;
  decision: EnforcementDecision;
  blockTrigger?: BlockTrigger | undefined;
  surface: 'governed' | 'passthrough';
};

/**
 * The label for a governance decision. The 403 fact — not the recorded decision — decides
 * whether the word "blocked" may appear.
 */
export function enforcementLabel(input: EnforcementInput): HonestyVerdict {
  if (input.surface === 'passthrough') {
    // The passthrough surface never resolves the enforcement matrix; it records `observe`
    // literally. Saying anything else would attribute a decision that was never made.
    return { messageKey: 'enforcement.passthrough', tone: 'neutral' };
  }
  if (input.http403) {
    return {
      messageKey:
        input.blockTrigger === 'tool_validation'
          ? 'enforcement.blocked.toolValidation'
          : 'enforcement.blocked.matrix',
      tone: 'failure',
    };
  }
  // Not a 403 ⇒ the request reached the provider, whatever the matrix recommended.
  // `blocked` with no 403 is a contradiction we resolve toward the observable fact.
  const forwarded = input.decision === 'blocked' ? 'observe' : input.decision;
  return { messageKey: FORWARDED_LABELS[forwarded], tone: FORWARDED_TONES[forwarded] };
}

// ---------------------------------------------------------------------------------------
// 2. Evidence-invariant tones
// ---------------------------------------------------------------------------------------

/** EC-1 — a failed capture is a material gap (red); a stalled one needs attention (amber);
 *  an empty window is neutral, because nothing was measured. */
export function ec1Tone(ec1: EvidenceCounts['ec1']): Tone {
  if (ec1.failed > 0) return 'failure';
  if (ec1.stalled_past_slo > 0) return 'attention';
  if (ec1.total === 0) return 'neutral';
  return 'ok';
}

/** EC-2 — a hole in a sealed chain's sequence is a material gap. */
export function ec2Tone(ec2: EvidenceCounts['ec2']): Tone {
  if (ec2.chains_with_gap > 0) return 'failure';
  if (ec2.chains === 0) return 'neutral';
  return 'ok';
}

/** EC-3.seal — native captures still unsealed past the SLO need attention; they are not yet
 *  a failure (the sealer may still advance them). */
export function ec3SealTone(ec3seal: EvidenceCounts['ec3seal']): Tone {
  if (ec3seal.native_unsealed_past_slo > 0) return 'attention';
  if (ec3seal.native_total === 0) return 'neutral';
  return 'ok';
}

/** EC-4 — the expected result is zero; anything above zero is an attention state. An empty
 *  window is neutral (no path-A invocations happened, so nothing was checked). */
export function ec4Tone(ec4: EvidenceCounts['ec4']): Tone {
  if (ec4.without_terminal > 0) return 'attention';
  if (ec4.provider_invocations === 0) return 'neutral';
  return 'ok';
}

/**
 * EC-3.drop. `observed:false` is the state this build always produces, and it is NEUTRAL:
 * the in-process snapshot is fixed at zero and the OTLP collector holds the authoritative
 * signal. Rendering that as green would turn "not measured here" into "no loss".
 */
export function ec3DropTone(drop: DropEstimate): Tone {
  if (!drop.observed) return 'neutral';
  if (drop.drops > 0) return 'failure';
  return 'ok';
}

/**
 * EC-6. Returns `ok` only if every known chain is actually verified AND at least one chain
 * exists. At this base `verified_ok` is hardcoded to 0 and `pending` equals the chain count,
 * so this can only ever return `attention` (chains present) or `neutral` (none in window).
 * The `ok` branch exists so that a future verifier-persistence surface lights it up honestly
 * — it is not reachable by any response this build can produce.
 */
export function ec6Tone(ec6: Pick<ChainVerificationStatus, 'total_chains' | 'verified_ok' | 'pending'>): Tone {
  if (ec6.total_chains === 0) return 'neutral';
  if (ec6.pending > 0) return 'attention';
  return ec6.verified_ok === ec6.total_chains ? 'ok' : 'attention';
}

/**
 * Whether an invariant has a gap list at all — i.e. whether the API's own `/gaps` enum accepts
 * it (apps/api/src/routes/evidence.ts:37). EC-6 is deliberately outside that enum: it is
 * status-via-summary, a per-organization state rather than a population of rows. Deriving the
 * drill-down decision from the enum, instead of hard-coding one exception, means a tile can
 * never link to a gap list the API would reject.
 */
export function hasGapList(invariant: string): invariant is EvidenceInvariant {
  return (EVIDENCE_INVARIANTS as readonly string[]).includes(invariant);
}

// ---------------------------------------------------------------------------------------
// 3. coverage_ratio
// ---------------------------------------------------------------------------------------

/** True when the ratio was computed over an actual population. When false the backend's 1.0
 *  means "no units in scope", and the UI must say so instead of showing full coverage. */
export function isCoverageInScope(coverage: Pick<CoverageRatio, 'total'>): boolean {
  return coverage.total > 0;
}

/** Tone for the headline ratio. No invented thresholds and no risk score: either every unit
 *  in scope is covered, or some are not, or nothing was in scope. */
export function coverageTone(coverage: Pick<CoverageRatio, 'covered' | 'total'>): Tone {
  if (coverage.total === 0) return 'neutral';
  return coverage.covered === coverage.total ? 'ok' : 'attention';
}
