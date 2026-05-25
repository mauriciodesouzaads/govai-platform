// Sensitive Data OS — credential/secret detector family (PR-SD1).
//
// Deterministic, RE2-compiled detectors for the categories where SD1 commits
// to a real detector: authentication credentials, secrets / API keys, and
// model-provider credentials. Each detector returns rich
// `SensitiveDataFinding` records with `source_quality='primary_govai_evidence'`
// and `recommended_action='review'` (advisory only — see header note in
// `sensitive-findings.ts`).
//
// Design rules enforced here:
//
//  - RE2 only. No JS RegExp (no catastrophic backtracking, no lookbehinds).
//  - Anchored, bounded patterns. No `.*` or `(.+)+` style fragments.
//  - The generic key detector requires an explicit context term to fire — it
//    is intentionally narrow to keep precision high in SD1.
//  - We never claim a matched token is a VALID credential — only that it
//    matches a known credential SHAPE. The detector names use `_candidate`
//    where the format alone cannot prove issuance.
//  - Raw matches stay inside the detector function long enough to compute the
//    hash and length, then are dropped. They are NEVER returned in the rich
//    finding. The legacy adapter
//    (`sensitiveFindingToLegacyFinding`) is the only path that re-attaches a
//    raw match, and only for callers that already hold it for redaction.

import RE2 from 're2';
import {
  confidenceBandForScore,
  matchHash,
  redactPreview,
  type SensitiveDataFinding,
} from './sensitive-findings.js';
import {
  type SensitiveDataOrigin,
  type SensitiveDataSourceSurface,
} from './sensitive-provenance.js';
import { NO_REVIEW_FLAGS } from './sensitive-taxonomy.js';

export type SecretDetectorContext = {
  source_surface: SensitiveDataSourceSurface;
  origin?: SensitiveDataOrigin;
};

// ---------------------------------------------------------------------------
// Compiled RE2 patterns. Each pattern is bounded; no unbounded repetition.
// ---------------------------------------------------------------------------

// PEM-encoded private keys, including PGP / RSA / EC / OPENSSH variants.
// PEM bodies are base64 + newlines and contain NO `-` characters, so `[^-]+`
// stops at the first dash — which is the start of the closing `-----END`
// marker — and likewise prevents bridging across two distinct PEM blocks.
// RE2's NFA execution is linear-time even on long inputs, so an unbounded
// `+` here is safe against hostile inputs (no backtracking). The bounded
// `{1,4096}` on the BEGIN/END envelope label keeps the marker matcher
// strictly bounded.
const PRIVATE_KEY_PEM_RE = new RE2(
  /-----BEGIN[ A-Z]{0,32}PRIVATE KEY-----[^-]+-----END[ A-Z]{0,32}PRIVATE KEY-----/g,
);

// Bearer tokens in `Authorization: Bearer ...` or inline `Bearer ...` form.
// Token charset is the URL-safe base64 alphabet plus `.~_-` so JWTs match.
// Length floor (20) avoids matching the literal word "Bearer"; the
// RE2-compatible upper bound (≤1000) is more than enough for any real
// bearer/JWT token. Long JWTs near the upper bound stop at the token's
// natural word boundary, never at the regex cap.
const BEARER_TOKEN_RE = new RE2(
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,1000}\b/g,
);

// Provider-prefixed keys. The `_candidate` suffix makes it explicit that the
// detector matches the SHAPE only; validity is a provider-side property.
//
// OpenAI: classic `sk-...` and project keys `sk-proj-...`. Conservative 20-char
// floor on the secret body to skip short test strings; cap at 256 to bound the
// matcher.
const OPENAI_API_KEY_RE = new RE2(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,256}\b/g);

// Anthropic: `sk-ant-...`. Same length envelope as OpenAI.
const ANTHROPIC_API_KEY_RE = new RE2(/\bsk-ant-[A-Za-z0-9_-]{20,256}\b/g);

// AWS access key IDs: 20-char uppercase alphanumeric prefixed by one of the
// well-known AWS principal types. (Secret access keys are not detected here;
// they are unprefixed 40-char base64-ish strings and would require an entropy
// model to detect reliably — out of scope for SD1.)
const AWS_ACCESS_KEY_ID_RE = new RE2(/\b(?:AKIA|ASIA|AIDA|AROA|AGPA|ANPA|ANVA|APKA)[0-9A-Z]{16}\b/g);

// GitHub tokens (PAT classic `ghp_`, OAuth `gho_`, server-to-server `ghs_`,
// user-to-server `ghu_`, refresh `ghr_`). All ≥36 chars of base62 body.
const GITHUB_TOKEN_RE = new RE2(/\bgh[pousr]_[A-Za-z0-9]{36,80}\b/g);

// Generic api_key=... contextual detector. Two-step pattern:
//   1) the context term ("api_key" | "secret" | "token" | "credential" | "bearer"),
//   2) a small punctuation/whitespace bridge,
//   3) the candidate value (>=16 base64-ish chars).
// The context requirement keeps precision: it does not fire on standalone
// random strings. `[A-Za-z0-9_+/=.-]` excludes whitespace so the value never
// crosses a separator.
const GENERIC_API_KEY_CONTEXTUAL_RE = new RE2(
  /\b(?:api[_-]?key|secret|token|credential|bearer)\b["'\s:=]{1,8}[A-Za-z0-9_+/=.-]{16,256}\b/gi,
);

// ---------------------------------------------------------------------------
// Detector framework.
// ---------------------------------------------------------------------------

type CompiledSecretDetector = {
  detector: string;
  re: RE2;
  /** [0,1] heuristic confidence. */
  confidence: number;
  rationale_code: string;
  category: 'authentication_credentials' | 'secrets_api_keys' | 'model_provider_credentials';
};

const SECRET_DETECTORS: ReadonlyArray<CompiledSecretDetector> = [
  {
    detector: 'private_key_pem',
    re: PRIVATE_KEY_PEM_RE,
    confidence: 0.99,
    rationale_code: 'pem_envelope_match',
    category: 'authentication_credentials',
  },
  {
    detector: 'bearer_token',
    re: BEARER_TOKEN_RE,
    confidence: 0.85,
    rationale_code: 'bearer_prefix_match',
    category: 'authentication_credentials',
  },
  {
    detector: 'openai_api_key_candidate',
    re: OPENAI_API_KEY_RE,
    confidence: 0.9,
    rationale_code: 'openai_prefix_match',
    category: 'model_provider_credentials',
  },
  {
    detector: 'anthropic_api_key_candidate',
    re: ANTHROPIC_API_KEY_RE,
    confidence: 0.9,
    rationale_code: 'anthropic_prefix_match',
    category: 'model_provider_credentials',
  },
  {
    detector: 'aws_access_key_id_candidate',
    re: AWS_ACCESS_KEY_ID_RE,
    confidence: 0.9,
    rationale_code: 'aws_principal_prefix_match',
    category: 'secrets_api_keys',
  },
  {
    detector: 'github_token_candidate',
    re: GITHUB_TOKEN_RE,
    confidence: 0.9,
    rationale_code: 'github_prefix_match',
    category: 'secrets_api_keys',
  },
  {
    detector: 'generic_api_key_contextual',
    re: GENERIC_API_KEY_CONTEXTUAL_RE,
    confidence: 0.7,
    rationale_code: 'context_term_with_high_entropy_value',
    category: 'secrets_api_keys',
  },
];

const REVIEW_FLAGS_SECURITY = {
  ...NO_REVIEW_FLAGS,
  professional_review_recommended: true,
  security_review_recommended: true,
};

function findAll(re: RE2, text: string): Array<{ match: string; index: number }> {
  const out: Array<{ match: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ match: m[0], index: m.index });
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  re.lastIndex = 0;
  return out;
}

function compiledToFinding(
  d: CompiledSecretDetector,
  m: { match: string; index: number },
  context: SecretDetectorContext,
): SensitiveDataFinding {
  return {
    detector: d.detector,
    detector_family: 'secret',
    category: d.category,
    index: m.index,
    length: m.match.length,
    match_hash: matchHash(d.detector, m.match),
    match_preview_redacted: redactPreview(d.detector),
    confidence: d.confidence,
    confidence_band: confidenceBandForScore(d.confidence),
    rationale_code: d.rationale_code,
    // SD1 advisory only — does not alter highestAction or decidePolicy. The
    // existing baseline DLP path remains the sole input to enforcement.
    recommended_action: 'review',
    origin: context.origin ?? 'govai_native',
    source_surface: context.source_surface,
    source_quality: 'primary_govai_evidence',
    redaction_hint: `mask_full:${d.detector}`,
    ...REVIEW_FLAGS_SECURITY,
  };
}

/**
 * Run all secret detectors against `text`. Returns rich findings; raw matches
 * stay inside this function. The output ordering is detector-stable so two
 * scans of the same input produce identical finding sequences.
 */
export function detectSecrets(
  text: string,
  context: SecretDetectorContext,
): SensitiveDataFinding[] {
  const out: SensitiveDataFinding[] = [];
  for (const d of SECRET_DETECTORS) {
    for (const m of findAll(d.re, text)) {
      out.push(compiledToFinding(d, m, context));
    }
  }
  return out;
}

/**
 * Stable list of secret detector names this module implements. Exported so
 * tests and docs can pin the SD1 surface and so future SD slices can
 * intersect with this list when adding more.
 */
export const SECRET_DETECTOR_NAMES: ReadonlyArray<string> = SECRET_DETECTORS.map(
  (d) => d.detector,
);
