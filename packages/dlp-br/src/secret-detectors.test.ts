import { describe, it, expect } from 'vitest';
import { detectSecrets, SECRET_DETECTOR_NAMES } from './secret-detectors.js';

const ctx = { source_surface: 'govai_runs' as const };

function detectorsOf(text: string): string[] {
  return detectSecrets(text, ctx).map((f) => f.detector);
}

describe('detectSecrets / PEM private key', () => {
  it('detects an enclosed PEM block', () => {
    const text = '-----BEGIN PRIVATE KEY-----\nMIIBV...XYZ==\n-----END PRIVATE KEY-----';
    const out = detectSecrets(text, ctx);
    expect(out.map((f) => f.detector)).toEqual(['private_key_pem']);
    expect(out[0]?.category).toBe('authentication_credentials');
    expect(out[0]?.recommended_action).toBe('review');
    expect(out[0]?.security_review_recommended).toBe(true);
    expect(JSON.stringify(out[0])).not.toContain('MIIBV');
  });

  it('detects RSA / OPENSSH variants', () => {
    const rsa = '-----BEGIN RSA PRIVATE KEY-----\nABC\n-----END RSA PRIVATE KEY-----';
    expect(detectorsOf(rsa)).toContain('private_key_pem');
    const ossh = '-----BEGIN OPENSSH PRIVATE KEY-----\nXYZ\n-----END OPENSSH PRIVATE KEY-----';
    expect(detectorsOf(ossh)).toContain('private_key_pem');
  });

  it('does not match an unclosed PEM block', () => {
    const text = '-----BEGIN PRIVATE KEY-----\nABC';
    expect(detectorsOf(text)).not.toContain('private_key_pem');
  });
});

describe('detectSecrets / bearer token', () => {
  it('detects an Authorization-style bearer token of sufficient length', () => {
    const text = 'Authorization: Bearer abcDEF1234567890_-./+=xyz';
    const out = detectSecrets(text, ctx);
    expect(out.some((f) => f.detector === 'bearer_token')).toBe(true);
    expect(JSON.stringify(out)).not.toContain('abcDEF1234567890_-./+=xyz');
  });

  it('does not match the bare word "Bearer" without a long token', () => {
    expect(detectorsOf('Bearer short')).not.toContain('bearer_token');
  });
});

describe('detectSecrets / provider keys', () => {
  it('detects openai_api_key_candidate for classic sk-...', () => {
    const t = 'use this key sk-AbCdEfGhIjKlMnOpQrSt and ship';
    expect(detectorsOf(t)).toContain('openai_api_key_candidate');
  });

  it('detects openai_api_key_candidate for sk-proj-...', () => {
    const t = 'use this key sk-proj-AbCdEfGhIjKlMnOpQrSt and ship';
    expect(detectorsOf(t)).toContain('openai_api_key_candidate');
  });

  it('detects anthropic_api_key_candidate for sk-ant-...', () => {
    const t = 'export ANTHROPIC_API_KEY=sk-ant-api03_AbCdEfGhIjKlMnOpQrSt';
    expect(detectorsOf(t)).toContain('anthropic_api_key_candidate');
  });

  it('does not match short sk- prefixes that are obviously placeholders', () => {
    expect(detectorsOf('sk-short')).not.toContain('openai_api_key_candidate');
  });
});

describe('detectSecrets / AWS access key id', () => {
  it('detects AKIA-prefixed key IDs of exact length', () => {
    const t = 'creds: AKIAABCDEFGHIJKLMNOP -- 20 chars total';
    expect(detectorsOf(t)).toContain('aws_access_key_id_candidate');
  });

  it('detects ASIA and AROA prefixes', () => {
    expect(detectorsOf('ASIAABCDEFGHIJKLMNOP')).toContain('aws_access_key_id_candidate');
    expect(detectorsOf('AROAABCDEFGHIJKLMNOP')).toContain('aws_access_key_id_candidate');
  });

  it('does not match wrong prefix or wrong length', () => {
    expect(detectorsOf('AKBOABCDEFGHIJKLMNOP')).not.toContain('aws_access_key_id_candidate');
    expect(detectorsOf('AKIASHORTAB')).not.toContain('aws_access_key_id_candidate');
  });
});

describe('detectSecrets / GitHub tokens', () => {
  it('detects ghp_, gho_, ghs_, ghu_, ghr_ tokens of sufficient body length', () => {
    const samples = [
      'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'gho_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'ghs_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'ghu_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'ghr_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
    ];
    for (const s of samples) {
      expect(detectorsOf(s)).toContain('github_token_candidate');
    }
  });

  it('does not match the wrong prefix or short body', () => {
    expect(detectorsOf('ghx_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).not.toContain(
      'github_token_candidate',
    );
    expect(detectorsOf('ghp_short')).not.toContain('github_token_candidate');
  });
});

describe('detectSecrets / generic_api_key_contextual', () => {
  it('requires an explicit context term to fire', () => {
    expect(detectorsOf('AbCdEfGhIjKlMnOpQrStUvWxYz12345')).not.toContain(
      'generic_api_key_contextual',
    );
  });

  it('fires when api_key=<value> is present', () => {
    expect(detectorsOf('api_key=AbCdEfGhIjKlMnOpQrStUvWxYz12345')).toContain(
      'generic_api_key_contextual',
    );
  });

  it('fires on secret/token/credential/bearer context terms', () => {
    expect(detectorsOf('secret: AbCdEfGhIjKlMnOpQr')).toContain('generic_api_key_contextual');
    expect(detectorsOf('token=AbCdEfGhIjKlMnOpQr')).toContain('generic_api_key_contextual');
    expect(detectorsOf('credential: "AbCdEfGhIjKlMnOpQr"')).toContain(
      'generic_api_key_contextual',
    );
  });

  it('is case-insensitive on the context term', () => {
    expect(detectorsOf('API_KEY: AbCdEfGhIjKlMnOpQr')).toContain('generic_api_key_contextual');
    expect(detectorsOf('Token=AbCdEfGhIjKlMnOpQr')).toContain('generic_api_key_contextual');
  });
});

describe('detectSecrets / safety + invariants', () => {
  it('exposes the documented SD1 secret detector list', () => {
    expect([...SECRET_DETECTOR_NAMES].sort()).toEqual(
      [
        'private_key_pem',
        'bearer_token',
        'generic_api_key_contextual',
        'aws_access_key_id_candidate',
        'github_token_candidate',
        'openai_api_key_candidate',
        'anthropic_api_key_candidate',
      ].sort(),
    );
  });

  it('every finding carries match_hash and redacted preview, never plaintext', () => {
    const t = [
      'sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv',
      'sk-AbCdEfGhIjKlMnOpQrStUvWxYz',
      'AKIAABCDEFGHIJKLMNOP',
      'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
      'api_key=AbCdEfGhIjKlMnOpQr',
      'Authorization: Bearer abcDEF1234567890_-./+=xyz',
    ].join('\n');
    const findings = detectSecrets(t, ctx);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.match_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(f.match_preview_redacted).toBe(`[REDACTED:${f.detector}]`);
      // The rich finding shape never carries the raw match field.
      expect(f).not.toHaveProperty('match');
    }
    // The serialized finding stream must not contain any of the raw inputs.
    const serialized = JSON.stringify(findings);
    expect(serialized).not.toContain('sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv');
    expect(serialized).not.toContain('AKIAABCDEFGHIJKLMNOP');
    expect(serialized).not.toContain('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
  });

  it('SD1 advisory recommended_action is never higher than `review` for secret findings', () => {
    const t = 'api_key=AbCdEfGhIjKlMnOpQr and sk-ant-api03_AbCdEfGhIjKlMnOpQrStUv';
    for (const f of detectSecrets(t, ctx)) {
      expect(['observe', 'warn', 'review']).toContain(f.recommended_action);
    }
  });

  it('regex safety: long pathological input does not hang', () => {
    const t = 'a'.repeat(200_000) + ' Bearer ' + 'b'.repeat(100);
    const start = Date.now();
    const out = detectSecrets(t, ctx);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(2000);
    // The bearer token is still detected.
    expect(out.some((f) => f.detector === 'bearer_token')).toBe(true);
  });
});
