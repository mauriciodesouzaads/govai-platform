// OpenAI Files purpose=assistants validator — pre-sunset / post-sunset behavior.

import { describe, it, expect } from 'vitest';
import {
  validateFilesPurpose,
  extractMultipartPurpose,
  OPENAI_ASSISTANTS_SUNSET_AT,
  OPENAI_ASSISTANTS_MIGRATION_TARGET,
} from './files-purpose-validator.js';

describe('validateFilesPurpose', () => {
  it('purpose=undefined → allow (no signal)', () => {
    expect(validateFilesPurpose(undefined, new Date('2026-05-08T00:00:00Z'))).toEqual({
      kind: 'allow',
    });
  });

  it('purpose=fine-tune → allow', () => {
    expect(validateFilesPurpose('fine-tune', new Date('2026-05-08T00:00:00Z'))).toEqual({
      kind: 'allow',
    });
  });

  it('purpose=batch → allow', () => {
    expect(validateFilesPurpose('batch', new Date('2026-05-08T00:00:00Z'))).toEqual({
      kind: 'allow',
    });
  });

  it('purpose=vision → allow', () => {
    expect(validateFilesPurpose('vision', new Date('2026-05-08T00:00:00Z'))).toEqual({
      kind: 'allow',
    });
  });

  it('purpose=assistants pre-sunset (today 2026-05-08) → allow_with_warning', () => {
    const r = validateFilesPurpose('assistants', new Date('2026-05-08T00:00:00Z'));
    expect(r.kind).toBe('allow_with_warning');
    if (r.kind === 'allow_with_warning') {
      expect(r.sunset_at).toBe(OPENAI_ASSISTANTS_SUNSET_AT);
      expect(r.migration_target).toBe(OPENAI_ASSISTANTS_MIGRATION_TARGET);
      expect(r.warning_header_value).toContain('assistants_sunset=2026-08-26');
      expect(r.warning_header_value).toContain('migrate_to=');
    }
  });

  it('purpose=assistants ON sunset day boundary (2026-08-26 00:00:00Z) → allow_with_warning', () => {
    const r = validateFilesPurpose('assistants', new Date('2026-08-26T00:00:00.000Z'));
    expect(r.kind).toBe('allow_with_warning');
  });

  it('purpose=assistants 1 second after sunset → block_post_sunset 403', () => {
    const r = validateFilesPurpose('assistants', new Date('2026-08-26T00:00:01.000Z'));
    expect(r.kind).toBe('block_post_sunset');
    if (r.kind === 'block_post_sunset') {
      expect(r.error_code).toBe('purpose_deprecated_post_sunset');
      expect(r.reason).toMatch(/Assistants API was removed on 2026-08-26/);
      expect(r.sunset_at).toBe(OPENAI_ASSISTANTS_SUNSET_AT);
      expect(r.migration_target).toBe(OPENAI_ASSISTANTS_MIGRATION_TARGET);
    }
  });

  it('purpose=assistants well after sunset → block_post_sunset 403', () => {
    const r = validateFilesPurpose('assistants', new Date('2027-01-01T00:00:00Z'));
    expect(r.kind).toBe('block_post_sunset');
  });
});

describe('extractMultipartPurpose', () => {
  it('parses purpose from a typical multipart body', () => {
    const body = Buffer.from(
      '--boundary\r\n' +
        'Content-Disposition: form-data; name="purpose"\r\n' +
        '\r\n' +
        'assistants\r\n' +
        '--boundary\r\n' +
        'Content-Disposition: form-data; name="file"; filename="x.txt"\r\n' +
        'Content-Type: text/plain\r\n' +
        '\r\n' +
        'hello\r\n' +
        '--boundary--\r\n',
    );
    expect(extractMultipartPurpose(body)).toBe('assistants');
  });

  it('returns undefined when no purpose field is present', () => {
    const body = Buffer.from(
      '--boundary\r\nContent-Disposition: form-data; name="file"\r\n\r\nhello\r\n--boundary--\r\n',
    );
    expect(extractMultipartPurpose(body)).toBeUndefined();
  });
});
