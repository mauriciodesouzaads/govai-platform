import { createHmac, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { Kms, KmsKeyId, KmsPurpose, KmsEnvelopePurpose } from './index.js';

/**
 * AwsKms — production KMS adapter (Option B / Foundation Release).
 *
 * Design: AWS KMS is used ONLY to unwrap a 32-byte master seed (one `kms:Decrypt`
 * per cache window). All key derivation (HKDF) and HMAC happen LOCALLY in-process,
 * mirroring the DevKms cryptographic model. There is intentionally NO per-event
 * AWS call: `GenerateMac`/`VerifyMac` are NOT used and must not be added.
 *
 * The master seed never leaves this object. `deriveKey`/`hmacSha256` return derived
 * material (also sensitive); the raw seed is held only as a Buffer with a bounded
 * TTL and is zeroized (`.fill(0)`) on expiry.
 */

/** Request shape passed to the injected AWS KMS client. Mirrors DecryptCommandInput. */
export interface AwsKmsDecryptRequest {
  KeyId: string;
  CiphertextBlob: Uint8Array;
  EncryptionContext: Record<string, string>;
}

/**
 * Minimal injectable AWS KMS client boundary. Production uses a real KMSClient
 * (see {@link createRealAwsKmsClient}); tests inject a fake so no real AWS call
 * ever happens. The only operation needed by this adapter is Decrypt.
 */
export interface AwsKmsClient {
  decrypt(req: AwsKmsDecryptRequest): Promise<{ Plaintext?: Uint8Array | undefined }>;
}

/**
 * Fixed encryption-context contract for the master-seed Decrypt. Every value is a
 * STRING. `version` is the string "1", never the number 1. Never add tenant/org/path
 * data here — this context is bound to the master seed at provisioning time.
 */
export const MASTER_SEED_ENCRYPTION_CONTEXT: Readonly<Record<string, string>> = Object.freeze({
  app: 'govai',
  purpose: 'master-seed',
  version: '1',
});

/** Production HKDF salt. Distinct from DevKms ('govai-dev-kms') — outputs are NOT interchangeable. */
const AWS_KMS_HKDF_SALT = 'govai-aws-kms-v1';

/** Envelope v1 binary layout constants. */
const MAGIC = Buffer.from('GVK1', 'ascii'); // 4 bytes, version prefix
const IV_LEN = 12; // AES-256-GCM IV (96-bit)
const TAG_LEN = 16; // AES-256-GCM auth tag
const DEK_LEN = 32; // AES-256 data key
const WRAPPED_DEK_LEN = 32; // GCM is unpadded → wrapped DEK is exactly DEK_LEN
/** dekWrapped field = MAGIC ‖ IV_dek ‖ tag_dek ‖ wrapped_dek. */
const DEK_LAYER_LEN = MAGIC.length + IV_LEN + TAG_LEN + WRAPPED_DEK_LEN; // 64
/** ciphertext field header = IV_payload ‖ tag_payload, followed by variable payload ciphertext. */
const PAYLOAD_HEADER_LEN = IV_LEN + TAG_LEN; // 28

/** Sanitized adapter error. Messages are stable codes only — never secrets/plaintext/buffers. */
export class AwsKmsError extends Error {
  constructor(code: string) {
    super(code);
    this.name = 'AwsKmsError';
  }
}

export interface AwsKmsOptions {
  /** Injected KMS client (real or fake). */
  client: AwsKmsClient;
  /** KMS key id or alias (e.g. "alias/govai-foundation"). Non-secret. */
  keyId: string;
  /** KMS-encrypted master seed ciphertext, read from a file OUTSIDE the repo by the factory. */
  masterCiphertext: Buffer;
  /** Plaintext master-seed cache TTL in seconds. Must be a positive integer. */
  ttlSeconds: number;
}

export class AwsKms implements Kms {
  readonly providerName = 'aws';

  private readonly client: AwsKmsClient;
  private readonly keyId: string;
  private readonly masterCiphertext: Buffer;
  private readonly ttlMs: number;

  // Cached plaintext master seed. Stored as Buffer (never string — strings are
  // immutable and cannot be zeroized). Null when absent/expired.
  private seedCache: Buffer | null = null;
  private seedExpiresAtMs = 0;

  constructor(opts: AwsKmsOptions) {
    if (!opts.client) throw new AwsKmsError('aws_kms_client_required');
    if (!opts.keyId) throw new AwsKmsError('aws_kms_key_id_required');
    if (!Buffer.isBuffer(opts.masterCiphertext) || opts.masterCiphertext.length === 0) {
      throw new AwsKmsError('aws_kms_master_ciphertext_required');
    }
    if (!Number.isInteger(opts.ttlSeconds) || opts.ttlSeconds <= 0) {
      throw new AwsKmsError('aws_kms_ttl_invalid');
    }
    this.client = opts.client;
    this.keyId = opts.keyId;
    this.masterCiphertext = opts.masterCiphertext;
    this.ttlMs = opts.ttlSeconds * 1000;
  }

  /**
   * Returns the in-memory master seed, decrypting via AWS KMS on first use or after
   * TTL expiry. The returned Buffer is owned by this adapter — callers must read it
   * synchronously and must not mutate or retain it.
   */
  private async getMasterSeed(): Promise<Buffer> {
    const now = Date.now();
    if (this.seedCache && now < this.seedExpiresAtMs) {
      return this.seedCache;
    }
    // Expired or absent: zeroize any stale seed before fetching a fresh one.
    this.clearSeedCache();

    let out: { Plaintext?: Uint8Array | undefined };
    try {
      out = await this.client.decrypt({
        KeyId: this.keyId,
        CiphertextBlob: this.masterCiphertext,
        EncryptionContext: { ...MASTER_SEED_ENCRYPTION_CONTEXT },
      });
    } catch {
      // Do not leak ciphertext/plaintext/AWS internals.
      throw new AwsKmsError('master_seed_decrypt_failed');
    }
    const pt = out.Plaintext;
    if (!pt || pt.length === 0) {
      throw new AwsKmsError('master_seed_decrypt_empty');
    }
    const seed = Buffer.from(pt); // copy into an owned Buffer
    // Best-effort: zero the bytes the client handed us.
    try {
      if (pt instanceof Uint8Array) pt.fill(0);
    } catch {
      /* ignore — best effort */
    }
    this.seedCache = seed;
    this.seedExpiresAtMs = now + this.ttlMs;
    return seed;
  }

  /** Zeroize and drop the cached master seed. */
  private clearSeedCache(): void {
    if (this.seedCache) {
      this.seedCache.fill(0);
      this.seedCache = null;
    }
    this.seedExpiresAtMs = 0;
  }

  /**
   * Derive a deterministic symmetric key for (purpose, orgId, keyId, version) via
   * HKDF over the master seed.
   *
   * SECURITY: the returned bytes are sensitive key material. Do NOT log, serialize,
   * persist, or expose them. Prefer the higher-level {@link hmacSha256} /
   * {@link envelopeEncrypt} primitives; direct use should be restricted.
   */
  async deriveKey(input: {
    purpose: KmsPurpose;
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    length?: number;
  }): Promise<Uint8Array> {
    const length = input.length ?? 32;
    const seed = await this.getMasterSeed();
    const salt = Buffer.from(AWS_KMS_HKDF_SALT, 'utf8');
    const info = Buffer.from(
      `govai|${input.purpose}|${input.orgId}|${input.keyId}|v${input.version}`,
      'utf8',
    );
    const derived = hkdfSync('sha256', seed, salt, info, length);
    return new Uint8Array(derived);
  }

  /** HMAC-SHA256 under a locally derived key. Never uses AWS KMS GenerateMac/VerifyMac. */
  async hmacSha256(input: {
    purpose: KmsPurpose;
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    message: Uint8Array;
  }): Promise<Uint8Array> {
    const key = await this.deriveKey({
      purpose: input.purpose,
      orgId: input.orgId,
      keyId: input.keyId,
      version: input.version,
      length: 32,
    });
    const keyBuf = Buffer.from(key);
    const mac = createHmac('sha256', keyBuf);
    mac.update(Buffer.from(input.message));
    const digest = mac.digest();
    keyBuf.fill(0); // zeroize derived-key copy
    return new Uint8Array(digest);
  }

  /**
   * Envelope-encrypt v1 (two layers), returned split across the existing Kms fields:
   *   dekWrapped = MAGIC("GVK1") ‖ IV_dek(12) ‖ tag_dek(16) ‖ wrapped_dek(32)
   *   ciphertext = IV_payload(12) ‖ tag_payload(16) ‖ payload_ciphertext(var)
   * Layer 1: random 32-byte DEK encrypts the payload (AES-256-GCM).
   * Layer 2: a KEK derived from the master seed wraps the DEK (AES-256-GCM).
   * IV_payload and IV_dek are independent fresh 12-byte CSPRNG values.
   */
  async envelopeEncrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    plaintext: Uint8Array;
    purpose?: KmsEnvelopePurpose;
  }): Promise<{ ciphertext: Uint8Array; dekWrapped: Uint8Array }> {
    // Layer 1 — payload under a random DEK.
    const dek = randomBytes(DEK_LEN);
    const ivPayload = randomBytes(IV_LEN);
    const payloadCipher = createCipheriv('aes-256-gcm', dek, ivPayload);
    const payloadCt = Buffer.concat([
      payloadCipher.update(Buffer.from(input.plaintext)),
      payloadCipher.final(),
    ]);
    const tagPayload = payloadCipher.getAuthTag();

    // Layer 2 — wrap the DEK under a KEK derived from the master seed.
    const kekU8 = await this.deriveKey({
      purpose: input.purpose ?? 'payload_dek',
      orgId: input.orgId,
      keyId: input.keyId,
      version: input.version,
      length: 32,
    });
    const kek = Buffer.from(kekU8);
    const ivDek = randomBytes(IV_LEN);
    const wrapCipher = createCipheriv('aes-256-gcm', kek, ivDek);
    const wrappedDek = Buffer.concat([wrapCipher.update(dek), wrapCipher.final()]);
    const tagDek = wrapCipher.getAuthTag();

    // Zeroize sensitive temporaries.
    dek.fill(0);
    kek.fill(0);

    const dekWrapped = Buffer.concat([MAGIC, ivDek, tagDek, wrappedDek]);
    const ciphertext = Buffer.concat([ivPayload, tagPayload, payloadCt]);
    return { ciphertext: new Uint8Array(ciphertext), dekWrapped: new Uint8Array(dekWrapped) };
  }

  /** Decode + decrypt a v1 envelope. Validates magic/version first; fails closed (sanitized). */
  async envelopeDecrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    ciphertext: Uint8Array;
    dekWrapped: Uint8Array;
    purpose?: KmsEnvelopePurpose;
  }): Promise<Uint8Array> {
    const dw = Buffer.from(input.dekWrapped);
    const ct = Buffer.from(input.ciphertext);

    // Validate magic/version before any deep parse.
    if (dw.length < MAGIC.length || !dw.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new AwsKmsError('envelope_bad_magic_or_version');
    }
    if (dw.length !== DEK_LAYER_LEN) {
      throw new AwsKmsError('envelope_malformed_dek_layer');
    }
    if (ct.length < PAYLOAD_HEADER_LEN) {
      throw new AwsKmsError('envelope_malformed_payload');
    }

    const ivDek = dw.subarray(MAGIC.length, MAGIC.length + IV_LEN);
    const tagDek = dw.subarray(MAGIC.length + IV_LEN, MAGIC.length + IV_LEN + TAG_LEN);
    const wrappedDek = dw.subarray(MAGIC.length + IV_LEN + TAG_LEN, DEK_LAYER_LEN);

    const ivPayload = ct.subarray(0, IV_LEN);
    const tagPayload = ct.subarray(IV_LEN, PAYLOAD_HEADER_LEN);
    const payloadCt = ct.subarray(PAYLOAD_HEADER_LEN);

    const kekU8 = await this.deriveKey({
      purpose: input.purpose ?? 'payload_dek',
      orgId: input.orgId,
      keyId: input.keyId,
      version: input.version,
      length: 32,
    });
    const kek = Buffer.from(kekU8);
    let dek: Buffer | null = null;
    try {
      const unwrap = createDecipheriv('aes-256-gcm', kek, ivDek);
      unwrap.setAuthTag(tagDek);
      dek = Buffer.concat([unwrap.update(wrappedDek), unwrap.final()]);

      const dec = createDecipheriv('aes-256-gcm', dek, ivPayload);
      dec.setAuthTag(tagPayload);
      const plain = Buffer.concat([dec.update(payloadCt), dec.final()]);
      return new Uint8Array(plain);
    } catch {
      // GCM auth failure / corruption / tampering — do not leak any material.
      throw new AwsKmsError('envelope_decrypt_failed');
    } finally {
      kek.fill(0);
      if (dek) dek.fill(0);
    }
  }
}

/**
 * Build a real AWS KMS client wrapper. The AWS SDK is imported lazily on first
 * Decrypt so it is never loaded in tests (which inject a fake AwsKmsClient) and so
 * core-audit/config test runs incur no SDK load. The wrapper is a 1:1 forward —
 * the encryption context is built by {@link AwsKms}, keeping this untested surface
 * trivial.
 */
export function createRealAwsKmsClient(region: string): AwsKmsClient {
  let sdkClient: import('@aws-sdk/client-kms').KMSClient | null = null;
  return {
    async decrypt(req: AwsKmsDecryptRequest): Promise<{ Plaintext?: Uint8Array | undefined }> {
      const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
      if (!sdkClient) sdkClient = new KMSClient({ region });
      const out = await sdkClient.send(
        new DecryptCommand({
          KeyId: req.KeyId,
          CiphertextBlob: req.CiphertextBlob,
          EncryptionContext: req.EncryptionContext,
        }),
      );
      return { Plaintext: out.Plaintext };
    },
  };
}
