// OpenAI Files `purpose=assistants` deprecation validator — Matrix §18.8.1.
//
// Pre-sunset (≤ 2026-08-26): forward + warning header injection + audit flag.
// Post-sunset (≥ 2026-08-27): block before forward; 403 with structured error
// body. Audit-event semantics for the locally-blocked case is intentionally
// deferred (see Issue [PR3/pre-sunset]); Batch C does NOT improvise an event.

export const OPENAI_ASSISTANTS_SUNSET_AT = '2026-08-26T00:00:00.000Z';
export const OPENAI_ASSISTANTS_MIGRATION_TARGET = 'responses_api+conversations_api';

const SUNSET_DATE = new Date(OPENAI_ASSISTANTS_SUNSET_AT);

export type FilesPurposeValidationResult =
  | {
      kind: 'allow_with_warning';
      sunset_at: string;
      migration_target: string;
      warning_header_value: string;
    }
  | {
      kind: 'allow';
    }
  | {
      kind: 'block_post_sunset';
      sunset_at: string;
      migration_target: string;
      error_code: 'purpose_deprecated_post_sunset';
      reason: string;
    };

/**
 * Inspect a Files request body for `purpose` and apply Matrix §18.8.1 policy.
 * `now` defaults to `new Date()` but is mockable for testing both branches.
 */
export function validateFilesPurpose(
  purpose: string | undefined,
  now: Date = new Date(),
): FilesPurposeValidationResult {
  if (purpose !== 'assistants') {
    return { kind: 'allow' };
  }
  if (now > SUNSET_DATE) {
    return {
      kind: 'block_post_sunset',
      sunset_at: OPENAI_ASSISTANTS_SUNSET_AT,
      migration_target: OPENAI_ASSISTANTS_MIGRATION_TARGET,
      error_code: 'purpose_deprecated_post_sunset',
      reason: 'OpenAI Assistants API was removed on 2026-08-26',
    };
  }
  return {
    kind: 'allow_with_warning',
    sunset_at: OPENAI_ASSISTANTS_SUNSET_AT,
    migration_target: OPENAI_ASSISTANTS_MIGRATION_TARGET,
    warning_header_value: `assistants_sunset=2026-08-26; migrate_to=${OPENAI_ASSISTANTS_MIGRATION_TARGET}`,
  };
}

/**
 * Best-effort extraction of `purpose` from a multipart/form-data body. The
 * /v1/files endpoint uses multipart by spec; we don't fully parse the body —
 * we just look for the literal field marker. False negatives are safe (request
 * forwards normally and OpenAI does its own validation); false positives are
 * not possible because the marker is precise.
 */
export function extractMultipartPurpose(body: Buffer): string | undefined {
  // Match `name="purpose"\r\n\r\n<value>\r\n` defensively.
  const text = body.toString('utf8');
  const match = text.match(/name="purpose"\s*\r?\n\s*\r?\n([^\r\n]+)\r?\n/);
  return match?.[1]?.trim();
}
