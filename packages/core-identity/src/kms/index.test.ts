import { describe, it, expect } from 'vitest';
import { DevKms, ProductionKmsRequired, createKmsFromEnv, KmsBootError } from './index.js';

describe('DevKms', () => {
  const seed = 'aa'.repeat(32);
  const kms = new DevKms(seed);

  it('rejects too-short seed in constructor', () => {
    expect(() => new DevKms('')).toThrow(/at least 16 bytes/);
    expect(() => new DevKms('aabbccdd')).toThrow(/at least 16 bytes/);
  });

  it('deriveKey is deterministic per (purpose, orgId, keyId, version)', async () => {
    const a = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    const b = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('deriveKey differs across purpose/version/org', async () => {
    const base = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    const purposeChanged = await kms.deriveKey({
      purpose: 'payload_dek',
      orgId: 'o',
      keyId: 'k',
      version: 1,
    });
    const versionChanged = await kms.deriveKey({
      purpose: 'audit_hmac',
      orgId: 'o',
      keyId: 'k',
      version: 2,
    });
    const orgChanged = await kms.deriveKey({
      purpose: 'audit_hmac',
      orgId: 'o2',
      keyId: 'k',
      version: 1,
    });
    expect(Buffer.from(base).equals(Buffer.from(purposeChanged))).toBe(false);
    expect(Buffer.from(base).equals(Buffer.from(versionChanged))).toBe(false);
    expect(Buffer.from(base).equals(Buffer.from(orgChanged))).toBe(false);
  });

  it('envelope encrypt/decrypt round-trips', async () => {
    const plaintext = Buffer.from('confidential data — não deve ser visível em log');
    const enc = await kms.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext });
    expect(enc.ciphertext.length).toBeGreaterThan(0);
    expect(enc.dekWrapped.length).toBeGreaterThan(0);
    const dec = await kms.envelopeDecrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      ciphertext: enc.ciphertext,
      dekWrapped: enc.dekWrapped,
    });
    expect(Buffer.from(dec).equals(plaintext)).toBe(true);
  });

  it('envelope decrypt with wrong key version fails', async () => {
    const plaintext = Buffer.from('x');
    const enc = await kms.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext });
    await expect(
      kms.envelopeDecrypt({
        orgId: 'o',
        keyId: 'k',
        version: 2,
        ciphertext: enc.ciphertext,
        dekWrapped: enc.dekWrapped,
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Purpose-aware envelope (EP-AI-CONVERSATION-CONTINUITY-V1 P0-A1).
// Contract: omitted purpose === explicit 'payload_dek' (byte-compatible with
// every pre-existing envelope); 'conversation_content' derives a DISTINCT
// wrapping KEK, so cross-purpose decryption fails closed.
// ---------------------------------------------------------------------------
describe('DevKms purpose-aware envelope', () => {
  const seed = 'aa'.repeat(32);
  const kms = new DevKms(seed);
  const plaintext = Buffer.from('conversation content fixture — never logged');

  it('legacy caller (no purpose) and explicit payload_dek are interchangeable', async () => {
    const legacyEnc = await kms.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext });
    const decExplicit = await kms.envelopeDecrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      ciphertext: legacyEnc.ciphertext,
      dekWrapped: legacyEnc.dekWrapped,
      purpose: 'payload_dek',
    });
    expect(Buffer.from(decExplicit).equals(plaintext)).toBe(true);

    const explicitEnc = await kms.envelopeEncrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      plaintext,
      purpose: 'payload_dek',
    });
    const decLegacy = await kms.envelopeDecrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      ciphertext: explicitEnc.ciphertext,
      dekWrapped: explicitEnc.dekWrapped,
    });
    expect(Buffer.from(decLegacy).equals(plaintext)).toBe(true);
  });

  it('conversation_content round-trips under its own purpose', async () => {
    const enc = await kms.envelopeEncrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      plaintext,
      purpose: 'conversation_content',
    });
    const dec = await kms.envelopeDecrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      ciphertext: enc.ciphertext,
      dekWrapped: enc.dekWrapped,
      purpose: 'conversation_content',
    });
    expect(Buffer.from(dec).equals(plaintext)).toBe(true);
  });

  it('conversation_content ciphertext cannot be decrypted as payload_dek (or by legacy callers)', async () => {
    const enc = await kms.envelopeEncrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      plaintext,
      purpose: 'conversation_content',
    });
    await expect(
      kms.envelopeDecrypt({
        orgId: 'o',
        keyId: 'k',
        version: 1,
        ciphertext: enc.ciphertext,
        dekWrapped: enc.dekWrapped,
        purpose: 'payload_dek',
      }),
    ).rejects.toThrow();
    await expect(
      kms.envelopeDecrypt({
        orgId: 'o',
        keyId: 'k',
        version: 1,
        ciphertext: enc.ciphertext,
        dekWrapped: enc.dekWrapped,
      }),
    ).rejects.toThrow();
  });

  it('payload_dek ciphertext cannot be decrypted as conversation_content', async () => {
    const enc = await kms.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext });
    await expect(
      kms.envelopeDecrypt({
        orgId: 'o',
        keyId: 'k',
        version: 1,
        ciphertext: enc.ciphertext,
        dekWrapped: enc.dekWrapped,
        purpose: 'conversation_content',
      }),
    ).rejects.toThrow();
  });

  it('cross-purpose decrypt failures never leak plaintext or key material', async () => {
    const enc = await kms.envelopeEncrypt({
      orgId: 'o',
      keyId: 'k',
      version: 1,
      plaintext,
      purpose: 'conversation_content',
    });
    let caught: unknown;
    try {
      await kms.envelopeDecrypt({
        orgId: 'o',
        keyId: 'k',
        version: 1,
        ciphertext: enc.ciphertext,
        dekWrapped: enc.dekWrapped,
        purpose: 'payload_dek',
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).not.toContain('conversation content fixture');
    expect((caught as Error).message).not.toContain(seed);
  });

  it('hmacSha256 digests differ across purposes for the same message', async () => {
    const message = Buffer.from('same low-entropy title');
    const integrity = await kms.hmacSha256({
      purpose: 'conversation_content_integrity',
      orgId: 'o',
      keyId: 'k',
      version: 1,
      message,
    });
    const audit = await kms.hmacSha256({
      purpose: 'audit_hmac',
      orgId: 'o',
      keyId: 'k',
      version: 1,
      message,
    });
    const contentPurpose = await kms.hmacSha256({
      purpose: 'conversation_content',
      orgId: 'o',
      keyId: 'k',
      version: 1,
      message,
    });
    expect(Buffer.from(integrity).equals(Buffer.from(audit))).toBe(false);
    expect(Buffer.from(integrity).equals(Buffer.from(contentPurpose))).toBe(false);
    // Deterministic under its own purpose (a keyed digest, not a random value).
    const again = await kms.hmacSha256({
      purpose: 'conversation_content_integrity',
      orgId: 'o',
      keyId: 'k',
      version: 1,
      message,
    });
    expect(Buffer.from(integrity).equals(Buffer.from(again))).toBe(true);
  });
});

describe('ProductionKmsRequired', () => {
  const k = new ProductionKmsRequired();
  it('all methods throw', async () => {
    await expect(k.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 })).rejects.toThrow(
      /Production KMS provider not configured/,
    );
    await expect(
      k.hmacSha256({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1, message: new Uint8Array(0) }),
    ).rejects.toThrow();
    await expect(
      k.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext: new Uint8Array(0) }),
    ).rejects.toThrow();
    await expect(
      k.envelopeDecrypt({
        orgId: 'o',
        keyId: 'k',
        version: 1,
        ciphertext: new Uint8Array(0),
        dekWrapped: new Uint8Array(0),
      }),
    ).rejects.toThrow();
  });
});

describe('createKmsFromEnv', () => {
  it('production + DevKms → KmsBootError', () => {
    expect(() =>
      createKmsFromEnv({ NODE_ENV: 'production', GOVAI_KMS_PROVIDER: 'dev', KMS_DEV_SEED: 'a'.repeat(64) }),
    ).toThrow(KmsBootError);
  });
  it('production + KMS_DEV_SEED set + non-dev provider → KmsBootError', () => {
    expect(() =>
      createKmsFromEnv({ NODE_ENV: 'production', GOVAI_KMS_PROVIDER: 'aws', KMS_DEV_SEED: 'a'.repeat(64) }),
    ).toThrow(KmsBootError);
  });
  it('production + aws provider + missing AWS config → KmsBootError (fail closed)', () => {
    // The aws provider path is now handled by the AwsKms adapter (see aws-kms.test.ts
    // for the full configured/fake-client behavior). Without region/keyId/ciphertext
    // file it must fail closed rather than returning the legacy ProductionKmsRequired
    // placeholder.
    expect(() => createKmsFromEnv({ NODE_ENV: 'production', GOVAI_KMS_PROVIDER: 'aws' })).toThrow(
      KmsBootError,
    );
  });
  it('development + DevKms with seed → DevKms instance', () => {
    const k = createKmsFromEnv({
      NODE_ENV: 'development',
      GOVAI_KMS_PROVIDER: 'dev',
      KMS_DEV_SEED: 'a'.repeat(64),
    });
    expect(k.providerName).toBe('dev');
  });
  it('development + DevKms without seed → KmsBootError', () => {
    expect(() => createKmsFromEnv({ NODE_ENV: 'development', GOVAI_KMS_PROVIDER: 'dev' })).toThrow(
      KmsBootError,
    );
  });
});
