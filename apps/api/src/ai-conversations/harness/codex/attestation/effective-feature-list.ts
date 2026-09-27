// CONT-P5-E1 — strict runtime validator + single-page parser of `experimentalFeature/list` (Dispatch v8 M2, carried
// from v1-v3; Correction 08 sections 2 and 12).
//
// The pinned server answers `experimentalFeature/list` with the POST-REQUIREMENTS effective feature state of the
// Config that request loaded (catalog_processor.rs 310-407 at the pin). GovAI reads exactly two bits out of it:
// `shell_snapshot` (ShellSnapshot, V1) and `shell_snapshot_v2` (ShellSnapshotV2, V2). Each is read independently;
// V2 is never inferred from V1.
//
// ★ PARSER LAW. `data` is an array; EVERY entry is an object with a string `name` and a boolean `enabled` (any other
//   type fails); both target keys appear EXACTLY once (missing or duplicate fails); `nextCursor` is JSON null (a
//   string cursor fails closed: bounded continuation is not part of the E1 contract); any other top-level shape
//   fails. A TypeScript cast is never treated as validation: every property is checked at runtime.
// ★ SINK LAW. The page is parsed transiently in process. The result carries ONLY the two bits (or a bounded failure
//   reason): no feature name other than the two targets, no description / announcement / display name, no raw page
//   and no malformed payload ever leaves this function.

export const EFFECTIVE_FEATURE_TARGETS = Object.freeze({
  /** ShellSnapshot (V1): features/src/lib.rs 963-967 at the pin, Stable, default true. */
  v1: 'shell_snapshot',
  /** ShellSnapshotV2 (V2): features/src/lib.rs 975-979 at the pin, UnderDevelopment, default false. */
  v2: 'shell_snapshot_v2',
} as const);

export const EFFECTIVE_FEATURE_LIST_FAILURE_REASONS = [
  'RESULT_NOT_AN_OBJECT',
  'UNKNOWN_TOP_LEVEL_KEY',
  'DATA_NOT_AN_ARRAY',
  'ENTRY_NOT_AN_OBJECT',
  'ENTRY_NAME_NOT_A_STRING',
  'ENTRY_ENABLED_NOT_A_BOOLEAN',
  'TARGET_MISSING',
  'TARGET_DUPLICATE',
  'NEXT_CURSOR_ABSENT',
  'UNEXPECTED_CONTINUATION_CURSOR',
  'NEXT_CURSOR_NOT_NULL',
] as const;

export type EffectiveFeatureListFailureReason = (typeof EFFECTIVE_FEATURE_LIST_FAILURE_REASONS)[number];

export type EffectiveFeatureListParse =
  | {
      readonly status: 'VALID';
      /** `enabled` of the single `shell_snapshot` entry. */
      readonly shellSnapshotEffective: boolean;
      /** `enabled` of the single `shell_snapshot_v2` entry. */
      readonly shellSnapshotV2Effective: boolean;
      /** One page, `nextCursor` null: the list is complete. */
      readonly complete: true;
    }
  | { readonly status: 'INVALID'; readonly reason: EffectiveFeatureListFailureReason };

const RESPONSE_KEYS = ['data', 'nextCursor'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(reason: EffectiveFeatureListFailureReason): EffectiveFeatureListParse {
  return Object.freeze({ status: 'INVALID', reason });
}

/** Parse one `experimentalFeature/list` result page. Total: every input yields VALID or one bounded reason. */
export function parseEffectiveFeatureListPage(result: unknown): EffectiveFeatureListParse {
  if (!isRecord(result)) return invalid('RESULT_NOT_AN_OBJECT');
  for (const key of Object.keys(result)) {
    if (!(RESPONSE_KEYS as readonly string[]).includes(key)) return invalid('UNKNOWN_TOP_LEVEL_KEY');
  }
  const data = result['data'];
  if (!Array.isArray(data)) return invalid('DATA_NOT_AN_ARRAY');

  let v1: boolean | undefined;
  let v2: boolean | undefined;
  for (const entry of data) {
    if (!isRecord(entry)) return invalid('ENTRY_NOT_AN_OBJECT');
    const name = entry['name'];
    const enabled = entry['enabled'];
    if (typeof name !== 'string') return invalid('ENTRY_NAME_NOT_A_STRING');
    if (typeof enabled !== 'boolean') return invalid('ENTRY_ENABLED_NOT_A_BOOLEAN');
    if (name === EFFECTIVE_FEATURE_TARGETS.v1) {
      if (v1 !== undefined) return invalid('TARGET_DUPLICATE');
      v1 = enabled;
    } else if (name === EFFECTIVE_FEATURE_TARGETS.v2) {
      if (v2 !== undefined) return invalid('TARGET_DUPLICATE');
      v2 = enabled;
    }
  }

  if (!Object.hasOwn(result, 'nextCursor')) return invalid('NEXT_CURSOR_ABSENT');
  const nextCursor = result['nextCursor'];
  if (typeof nextCursor === 'string') return invalid('UNEXPECTED_CONTINUATION_CURSOR');
  if (nextCursor !== null) return invalid('NEXT_CURSOR_NOT_NULL');
  if (v1 === undefined || v2 === undefined) return invalid('TARGET_MISSING');

  return Object.freeze({ status: 'VALID', shellSnapshotEffective: v1, shellSnapshotV2Effective: v2, complete: true });
}
