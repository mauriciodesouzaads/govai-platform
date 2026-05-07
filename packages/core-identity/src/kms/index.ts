import { createHmac, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export type KmsKeyId = string;

export type KmsPurpose =
  | 'audit_hmac'
  | 'payload_dek'
  | 'provider_credential'
  | 'jwt_refresh';

export interface Kms {
  readonly providerName: string;
  /**
   * Deriva uma chave simétrica determinística per (purpose, orgId, keyId, version).
   */
  deriveKey(input: {
    purpose: KmsPurpose;
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    length?: number;
  }): Promise<Uint8Array>;

  /**
   * HMAC-SHA256 sob chave derivada.
   */
  hmacSha256(input: {
    purpose: KmsPurpose;
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    message: Uint8Array;
  }): Promise<Uint8Array>;

  /**
   * Envelope-encrypt: gera DEK, criptografa data com DEK (AES-256-GCM), retorna ciphertext + dekWrapped.
   */
  envelopeEncrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    plaintext: Uint8Array;
  }): Promise<{ ciphertext: Uint8Array; dekWrapped: Uint8Array }>;

  envelopeDecrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    ciphertext: Uint8Array;
    dekWrapped: Uint8Array;
  }): Promise<Uint8Array>;
}

/**
 * DevKMS — deriva todas as chaves de KMS_DEV_SEED via HKDF.
 * NUNCA usar em production. Boot-fail enforced em config.
 */
export class DevKms implements Kms {
  readonly providerName = 'dev';
  private readonly seed: Buffer;

  constructor(seedHex: string) {
    if (!seedHex || seedHex.length < 32) {
      throw new Error('DevKms: KMS_DEV_SEED must be at least 16 bytes hex (32 chars)');
    }
    this.seed = Buffer.from(seedHex, 'hex');
    if (this.seed.length < 16) {
      throw new Error('DevKms: KMS_DEV_SEED hex decoded to fewer than 16 bytes');
    }
  }

  async deriveKey(input: {
    purpose: KmsPurpose;
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    length?: number;
  }): Promise<Uint8Array> {
    const length = input.length ?? 32;
    const info = Buffer.from(
      `govai|${input.purpose}|${input.orgId}|${input.keyId}|v${input.version}`,
      'utf8',
    );
    const salt = Buffer.from('govai-dev-kms', 'utf8');
    const derived = hkdfSync('sha256', this.seed, salt, info, length);
    return new Uint8Array(derived);
  }

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
    const mac = createHmac('sha256', Buffer.from(key));
    mac.update(Buffer.from(input.message));
    return new Uint8Array(mac.digest());
  }

  async envelopeEncrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    plaintext: Uint8Array;
  }): Promise<{ ciphertext: Uint8Array; dekWrapped: Uint8Array }> {
    // Gera DEK aleatório de 32 bytes.
    const dek = randomBytes(32);
    // Criptografa plaintext com AES-256-GCM (IV 12 bytes).
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', dek, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(input.plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();
    const ciphertext = Buffer.concat([iv, tag, enc]);

    // Embrulha DEK com chave derivada (AES-256-GCM).
    const kek = Buffer.from(
      await this.deriveKey({
        purpose: 'payload_dek',
        orgId: input.orgId,
        keyId: input.keyId,
        version: input.version,
      }),
    );
    const wrapIv = randomBytes(12);
    const wrap = createCipheriv('aes-256-gcm', kek, wrapIv);
    const wrapped = Buffer.concat([wrap.update(dek), wrap.final()]);
    const wrapTag = wrap.getAuthTag();
    const dekWrapped = Buffer.concat([wrapIv, wrapTag, wrapped]);

    return { ciphertext: new Uint8Array(ciphertext), dekWrapped: new Uint8Array(dekWrapped) };
  }

  async envelopeDecrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    ciphertext: Uint8Array;
    dekWrapped: Uint8Array;
  }): Promise<Uint8Array> {
    const kek = Buffer.from(
      await this.deriveKey({
        purpose: 'payload_dek',
        orgId: input.orgId,
        keyId: input.keyId,
        version: input.version,
      }),
    );
    const wrappedBuf = Buffer.from(input.dekWrapped);
    const wrapIv = wrappedBuf.subarray(0, 12);
    const wrapTag = wrappedBuf.subarray(12, 28);
    const wrappedCt = wrappedBuf.subarray(28);
    const unwrap = createDecipheriv('aes-256-gcm', kek, wrapIv);
    unwrap.setAuthTag(wrapTag);
    const dek = Buffer.concat([unwrap.update(wrappedCt), unwrap.final()]);

    const ctBuf = Buffer.from(input.ciphertext);
    const iv = ctBuf.subarray(0, 12);
    const tag = ctBuf.subarray(12, 28);
    const enc = ctBuf.subarray(28);
    const dec = createDecipheriv('aes-256-gcm', dek, iv);
    dec.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([dec.update(enc), dec.final()]));
  }
}

/**
 * Production KMS interface — placeholder. Boot fail se usado sem provider real configurado.
 */
export class ProductionKmsRequired implements Kms {
  readonly providerName = 'production_required';
  private fail(): never {
    throw new Error(
      'Production KMS provider not configured. Set GOVAI_KMS_PROVIDER and provide credentials. Runbook: docs/runbooks/kms-production.md',
    );
  }
  async deriveKey(_input: Parameters<Kms['deriveKey']>[0]): Promise<Uint8Array> {
    this.fail();
  }
  async hmacSha256(_input: Parameters<Kms['hmacSha256']>[0]): Promise<Uint8Array> {
    this.fail();
  }
  async envelopeEncrypt(
    _input: Parameters<Kms['envelopeEncrypt']>[0],
  ): Promise<{ ciphertext: Uint8Array; dekWrapped: Uint8Array }> {
    this.fail();
  }
  async envelopeDecrypt(_input: Parameters<Kms['envelopeDecrypt']>[0]): Promise<Uint8Array> {
    this.fail();
  }
}

export class KmsBootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KmsBootError';
  }
}

export function createKmsFromEnv(env: {
  NODE_ENV: 'development' | 'test' | 'production';
  GOVAI_KMS_PROVIDER: 'dev' | 'aws' | 'gcp' | 'azure';
  KMS_DEV_SEED?: string | undefined;
}): Kms {
  if (env.NODE_ENV === 'production') {
    if (env.GOVAI_KMS_PROVIDER === 'dev') {
      throw new KmsBootError(
        'DevKMS detected in production. Configure GOVAI_KMS_PROVIDER. Runbook: docs/runbooks/kms-production.md',
      );
    }
    if (env.KMS_DEV_SEED && env.KMS_DEV_SEED.length > 0) {
      throw new KmsBootError(
        'KMS_DEV_SEED set in production. Remove env var. Runbook: docs/runbooks/kms-production.md',
      );
    }
    return new ProductionKmsRequired();
  }
  if (env.GOVAI_KMS_PROVIDER === 'dev') {
    if (!env.KMS_DEV_SEED) {
      throw new KmsBootError('DevKms requires KMS_DEV_SEED env var (hex 32+ chars).');
    }
    return new DevKms(env.KMS_DEV_SEED);
  }
  return new ProductionKmsRequired();
}
