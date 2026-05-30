import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AwsKms,
  AwsKmsError,
  type AwsKmsClient,
  type AwsKmsDecryptRequest,
} from './aws-kms.js';
import { createKmsFromEnv, KmsBootError, type Kms } from './index.js';

// ---------------------------------------------------------------------------
// Test helpers — a fake KMS client that NEVER reaches real AWS. It returns a
// fixed 32-byte "master seed" and records the Decrypt requests it received so
// tests can assert the encryption-context contract and call counts.
// ---------------------------------------------------------------------------

const FAKE_MASTER_SEED = Buffer.alloc(32, 7); // deterministic 32-byte seed
const FAKE_CIPHERTEXT = Buffer.from('fake-kms-ciphertext-blob-not-real');

function makeFakeClient(seed: Buffer = FAKE_MASTER_SEED): {
  client: AwsKmsClient;
  calls: AwsKmsDecryptRequest[];
} {
  const calls: AwsKmsDecryptRequest[] = [];
  const client: AwsKmsClient = {
    async decrypt(req: AwsKmsDecryptRequest) {
      calls.push(req);
      return { Plaintext: new Uint8Array(seed) };
    },
  };
  return { client, calls };
}

function newAwsKms(overrides?: Partial<{ ttlSeconds: number; keyId: string; seed: Buffer }>): {
  kms: AwsKms;
  calls: AwsKmsDecryptRequest[];
} {
  const { client, calls } = makeFakeClient(overrides?.seed);
  const kms = new AwsKms({
    client,
    keyId: overrides?.keyId ?? 'alias/test-key',
    masterCiphertext: FAKE_CIPHERTEXT,
    ttlSeconds: overrides?.ttlSeconds ?? 900,
  });
  return { kms, calls };
}

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------
describe('AwsKms constructor', () => {
  const base = { client: makeFakeClient().client, keyId: 'alias/k', masterCiphertext: FAKE_CIPHERTEXT };
  it('rejects empty master ciphertext', () => {
    expect(() => new AwsKms({ ...base, masterCiphertext: Buffer.alloc(0), ttlSeconds: 900 })).toThrow(
      AwsKmsError,
    );
  });
  it('rejects ttl <= 0', () => {
    expect(() => new AwsKms({ ...base, ttlSeconds: 0 })).toThrow(AwsKmsError);
    expect(() => new AwsKms({ ...base, ttlSeconds: -5 })).toThrow(AwsKmsError);
  });
  it('rejects non-integer ttl', () => {
    expect(() => new AwsKms({ ...base, ttlSeconds: 1.5 })).toThrow(AwsKmsError);
  });
});

// ---------------------------------------------------------------------------
// Encryption context contract + Decrypt invocation
// ---------------------------------------------------------------------------
describe('AwsKms KMS Decrypt contract', () => {
  it('calls Decrypt with exact encryption context and string version "1"', async () => {
    const { kms, calls } = newAwsKms();
    await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    expect(calls.length).toBe(1);
    const ctx = calls[0]!.EncryptionContext;
    expect(ctx).toEqual({ app: 'govai', purpose: 'master-seed', version: '1' });
    // version must be the STRING "1", never the number 1.
    expect(typeof ctx.version).toBe('string');
    expect(ctx.version).toBe('1');
    expect(calls[0]!.KeyId).toBe('alias/test-key');
    expect(Buffer.from(calls[0]!.CiphertextBlob).equals(FAKE_CIPHERTEXT)).toBe(true);
  });

  it('does not pass tenant/org data in the master-seed encryption context', async () => {
    const { kms, calls } = newAwsKms();
    await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'secret-org', keyId: 'k', version: 1 });
    expect(Object.keys(calls[0]!.EncryptionContext).sort()).toEqual(['app', 'purpose', 'version']);
    expect(JSON.stringify(calls[0]!.EncryptionContext)).not.toContain('secret-org');
  });
});

// ---------------------------------------------------------------------------
// Cache TTL + zeroization
// ---------------------------------------------------------------------------
describe('AwsKms master-seed cache', () => {
  it('decrypts once within the TTL window', async () => {
    const { kms, calls } = newAwsKms({ ttlSeconds: 900 });
    await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    await kms.hmacSha256({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1, message: Buffer.from('m') });
    await kms.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext: Buffer.from('p') });
    expect(calls.length).toBe(1);
  });

  it('decrypts again after TTL expiry', async () => {
    vi.useFakeTimers();
    try {
      const { kms, calls } = newAwsKms({ ttlSeconds: 1 });
      await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
      expect(calls.length).toBe(1);
      vi.advanceTimersByTime(1500); // > 1s TTL
      await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
      expect(calls.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('zeroizes the cached seed Buffer on expiry (fill(0))', async () => {
    vi.useFakeTimers();
    try {
      const seed = Buffer.alloc(32, 9);
      const { client } = makeFakeClient(seed);
      // Capture the exact Buffer the adapter caches by spying on Buffer.prototype.fill.
      const fillSpy = vi.spyOn(Buffer.prototype, 'fill');
      const kms = new AwsKms({ client, keyId: 'alias/k', masterCiphertext: FAKE_CIPHERTEXT, ttlSeconds: 1 });
      await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
      fillSpy.mockClear();
      vi.advanceTimersByTime(1500);
      // Next use triggers clearSeedCache() -> fill(0) on the stale seed before re-decrypt.
      await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
      const zeroFills = fillSpy.mock.calls.filter((c) => c[0] === 0);
      expect(zeroFills.length).toBeGreaterThan(0);
      fillSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Determinism (internal only — no DevKms parity)
// ---------------------------------------------------------------------------
describe('AwsKms deriveKey/hmac determinism', () => {
  it('deriveKey is deterministic for same inputs', async () => {
    const { kms } = newAwsKms();
    const a = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    const b = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('deriveKey differs across purpose/version/org/keyId', async () => {
    const { kms } = newAwsKms();
    const base = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    const p = await kms.deriveKey({ purpose: 'payload_dek', orgId: 'o', keyId: 'k', version: 1 });
    const v = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 2 });
    const o = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o2', keyId: 'k', version: 1 });
    const kk = await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k2', version: 1 });
    for (const other of [p, v, o, kk]) {
      expect(Buffer.from(base).equals(Buffer.from(other))).toBe(false);
    }
  });

  it('hmacSha256 is deterministic and 32 bytes', async () => {
    const { kms } = newAwsKms();
    const a = await kms.hmacSha256({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1, message: Buffer.from('hello') });
    const b = await kms.hmacSha256({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1, message: Buffer.from('hello') });
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Envelope v1
// ---------------------------------------------------------------------------
const MAGIC = Buffer.from('GVK1', 'ascii');

describe('AwsKms envelope v1', () => {
  async function enc(kms: AwsKms, pt: Buffer) {
    return kms.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext: pt });
  }
  async function dec(kms: AwsKms, ciphertext: Uint8Array, dekWrapped: Uint8Array) {
    return kms.envelopeDecrypt({ orgId: 'o', keyId: 'k', version: 1, ciphertext, dekWrapped });
  }

  it('round-trips encrypt/decrypt', async () => {
    const { kms } = newAwsKms();
    const pt = Buffer.from('confidential — never logged');
    const e = await enc(kms, pt);
    const out = await dec(kms, e.ciphertext, e.dekWrapped);
    expect(Buffer.from(out).equals(pt)).toBe(true);
  });

  it('two encrypts of same plaintext produce different blobs', async () => {
    const { kms } = newAwsKms();
    const pt = Buffer.from('same');
    const e1 = await enc(kms, pt);
    const e2 = await enc(kms, pt);
    expect(Buffer.from(e1.ciphertext).equals(Buffer.from(e2.ciphertext))).toBe(false);
    expect(Buffer.from(e1.dekWrapped).equals(Buffer.from(e2.dekWrapped))).toBe(false);
  });

  it('IV_dek and IV_payload are both 12 bytes and different; tags 16 bytes', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const dw = Buffer.from(e.dekWrapped);
    const ct = Buffer.from(e.ciphertext);
    // dekWrapped = MAGIC(4) | IV_dek(12) | tag_dek(16) | wrapped_dek(32)
    expect(dw.length).toBe(64);
    const ivDek = dw.subarray(4, 16);
    const tagDek = dw.subarray(16, 32);
    expect(ivDek.length).toBe(12);
    expect(tagDek.length).toBe(16);
    // ciphertext = IV_payload(12) | tag_payload(16) | payload_ct
    const ivPayload = ct.subarray(0, 12);
    const tagPayload = ct.subarray(12, 28);
    expect(ivPayload.length).toBe(12);
    expect(tagPayload.length).toBe(16);
    expect(ivDek.equals(ivPayload)).toBe(false);
  });

  it('wrong magic fails closed', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const bad = Buffer.from(e.dekWrapped);
    bad[0] = bad[0]! ^ 0xff; // corrupt magic
    await expect(dec(kms, e.ciphertext, bad)).rejects.toThrow(AwsKmsError);
  });

  it('unknown version (valid-length but wrong magic bytes) fails closed', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const bad = Buffer.from(e.dekWrapped);
    Buffer.from('GVK9', 'ascii').copy(bad, 0); // same length, different version token
    await expect(dec(kms, e.ciphertext, bad)).rejects.toThrow(AwsKmsError);
  });

  it('truncation before IV_dek fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const bad = Buffer.from(e.dekWrapped).subarray(0, MAGIC.length + 4); // mid IV_dek
    await expect(dec(kms, e.ciphertext, bad)).rejects.toThrow(AwsKmsError);
  });

  it('truncation in wrapped_dek fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const bad = Buffer.from(e.dekWrapped).subarray(0, 50); // < 64
    await expect(dec(kms, e.ciphertext, bad)).rejects.toThrow(AwsKmsError);
  });

  it('truncation in IV_payload fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const badCt = Buffer.from(e.ciphertext).subarray(0, 6); // < IV_payload(12)
    await expect(dec(kms, badCt, e.dekWrapped)).rejects.toThrow(AwsKmsError);
  });

  it('truncation in authTag_payload fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const badCt = Buffer.from(e.ciphertext).subarray(0, 20); // within tag region (<28)
    await expect(dec(kms, badCt, e.dekWrapped)).rejects.toThrow(AwsKmsError);
  });

  it('truncation in payload ciphertext fails (GCM auth)', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('a longer payload to truncate'));
    const ct = Buffer.from(e.ciphertext);
    const badCt = ct.subarray(0, ct.length - 3); // drop ciphertext bytes
    await expect(dec(kms, badCt, e.dekWrapped)).rejects.toThrow(AwsKmsError);
  });

  it('one-byte mutation in authTag_dek fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const bad = Buffer.from(e.dekWrapped);
    bad[16] = bad[16]! ^ 0x01; // first byte of tag_dek
    await expect(dec(kms, e.ciphertext, bad)).rejects.toThrow(AwsKmsError);
  });

  it('one-byte mutation in wrapped_dek fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const bad = Buffer.from(e.dekWrapped);
    bad[40] = bad[40]! ^ 0x01; // inside wrapped_dek
    await expect(dec(kms, e.ciphertext, bad)).rejects.toThrow(AwsKmsError);
  });

  it('one-byte mutation in authTag_payload fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('x'));
    const bad = Buffer.from(e.ciphertext);
    bad[12] = bad[12]! ^ 0x01; // first byte of tag_payload
    await expect(dec(kms, bad, e.dekWrapped)).rejects.toThrow(AwsKmsError);
  });

  it('one-byte mutation in payload_ciphertext fails', async () => {
    const { kms } = newAwsKms();
    const e = await enc(kms, Buffer.from('payload-bytes-here'));
    const bad = Buffer.from(e.ciphertext);
    bad[bad.length - 1] = bad[bad.length - 1]! ^ 0x01;
    await expect(dec(kms, bad, e.dekWrapped)).rejects.toThrow(AwsKmsError);
  });
});

// ---------------------------------------------------------------------------
// Error sanitization
// ---------------------------------------------------------------------------
describe('AwsKms error sanitization', () => {
  it('decrypt-failure error contains no plaintext/seed/buffer material', async () => {
    const failing: AwsKmsClient = {
      async decrypt() {
        throw new Error('AWS internal detail that must not leak');
      },
    };
    const kms = new AwsKms({ client: failing, keyId: 'alias/k', masterCiphertext: FAKE_CIPHERTEXT, ttlSeconds: 900 });
    let caught: unknown;
    try {
      await kms.deriveKey({ purpose: 'audit_hmac', orgId: 'o', keyId: 'k', version: 1 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(AwsKmsError);
    const msg = (caught as Error).message;
    expect(msg).toBe('master_seed_decrypt_failed');
    expect(msg).not.toContain('AWS internal detail');
  });

  it('envelope decrypt error message is a stable sanitized code', async () => {
    const { kms } = newAwsKms();
    const e = await kms.envelopeEncrypt({ orgId: 'o', keyId: 'k', version: 1, plaintext: Buffer.from('x') });
    const bad = Buffer.from(e.dekWrapped);
    bad[40] = bad[40]! ^ 0x01;
    let caught: unknown;
    try {
      await kms.envelopeDecrypt({ orgId: 'o', keyId: 'k', version: 1, ciphertext: e.ciphertext, dekWrapped: bad });
    } catch (e2) {
      caught = e2;
    }
    expect(caught).toBeInstanceOf(AwsKmsError);
    expect((caught as Error).message).toBe('envelope_decrypt_failed');
  });
});

// ---------------------------------------------------------------------------
// Factory: createKmsFromEnv with AWS provider (fake client injected)
// ---------------------------------------------------------------------------
describe('createKmsFromEnv (aws)', () => {
  let dir: string;
  let ctFile: string;
  let emptyFile: string;

  function setup() {
    dir = mkdtempSync(join(tmpdir(), 'govai-kms-test-'));
    ctFile = join(dir, 'master.ciphertext');
    emptyFile = join(dir, 'empty.ciphertext');
    writeFileSync(ctFile, FAKE_CIPHERTEXT);
    writeFileSync(emptyFile, Buffer.alloc(0));
  }
  function teardown() {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }

  const fakeDeps = () => ({ awsKmsClientFactory: () => makeFakeClient().client });

  it('creates AwsKms when provider=aws with full config (fake client)', () => {
    setup();
    try {
      const kms: Kms = createKmsFromEnv(
        {
          NODE_ENV: 'production',
          GOVAI_KMS_PROVIDER: 'aws',
          GOVAI_KMS_AWS_REGION: 'us-east-1',
          GOVAI_KMS_AWS_KEY_ID: 'alias/govai-foundation',
          GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE: ctFile,
          GOVAI_KMS_SEED_CACHE_TTL_SECONDS: 900,
        },
        fakeDeps(),
      );
      expect(kms.providerName).toBe('aws');
    } finally {
      teardown();
    }
  });

  it('fails closed when AWS envs missing', () => {
    expect(() =>
      createKmsFromEnv({ NODE_ENV: 'production', GOVAI_KMS_PROVIDER: 'aws' }, fakeDeps()),
    ).toThrow(KmsBootError);
  });

  it('fails closed when ciphertext file is missing', () => {
    expect(() =>
      createKmsFromEnv(
        {
          NODE_ENV: 'production',
          GOVAI_KMS_PROVIDER: 'aws',
          GOVAI_KMS_AWS_REGION: 'us-east-1',
          GOVAI_KMS_AWS_KEY_ID: 'alias/k',
          GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE: '/nonexistent/path/does-not-exist.ciphertext',
        },
        fakeDeps(),
      ),
    ).toThrow(KmsBootError);
  });

  it('fails closed when ciphertext file is empty', () => {
    setup();
    try {
      expect(() =>
        createKmsFromEnv(
          {
            NODE_ENV: 'production',
            GOVAI_KMS_PROVIDER: 'aws',
            GOVAI_KMS_AWS_REGION: 'us-east-1',
            GOVAI_KMS_AWS_KEY_ID: 'alias/k',
            GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE: emptyFile,
          },
          fakeDeps(),
        ),
      ).toThrow(KmsBootError);
    } finally {
      teardown();
    }
  });

  it('fails closed on invalid TTL (zero / negative)', () => {
    setup();
    try {
      for (const ttl of [0, -1]) {
        expect(() =>
          createKmsFromEnv(
            {
              NODE_ENV: 'production',
              GOVAI_KMS_PROVIDER: 'aws',
              GOVAI_KMS_AWS_REGION: 'us-east-1',
              GOVAI_KMS_AWS_KEY_ID: 'alias/k',
              GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE: ctFile,
              GOVAI_KMS_SEED_CACHE_TTL_SECONDS: ttl,
            },
            fakeDeps(),
          ),
        ).toThrow(KmsBootError);
      }
    } finally {
      teardown();
    }
  });

  it('production + dev provider fails closed', () => {
    expect(() =>
      createKmsFromEnv({ NODE_ENV: 'production', GOVAI_KMS_PROVIDER: 'dev', KMS_DEV_SEED: 'a'.repeat(64) }),
    ).toThrow(KmsBootError);
  });

  it('production + KMS_DEV_SEED with aws provider fails closed', () => {
    setup();
    try {
      expect(() =>
        createKmsFromEnv(
          {
            NODE_ENV: 'production',
            GOVAI_KMS_PROVIDER: 'aws',
            KMS_DEV_SEED: 'a'.repeat(64),
            GOVAI_KMS_AWS_REGION: 'us-east-1',
            GOVAI_KMS_AWS_KEY_ID: 'alias/k',
            GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE: ctFile,
          },
          fakeDeps(),
        ),
      ).toThrow(KmsBootError);
    } finally {
      teardown();
    }
  });
});
