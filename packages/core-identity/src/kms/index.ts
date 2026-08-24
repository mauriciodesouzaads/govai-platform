import { createHmac, hkdfSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AwsKms, createRealAwsKmsClient, type AwsKmsClient } from './aws-kms.js';

export type KmsKeyId = string;

export type KmsPurpose =
  | 'audit_hmac'
  | 'payload_dek'
  | 'provider_credential'
  | 'jwt_refresh'
  | 'conversation_content'
  | 'conversation_content_integrity';

/**
 * Purposes admitted as an ENVELOPE wrapping-key derivation input. Deliberately a
 * NARROW subset of KmsPurpose: HMAC-only purposes (audit_hmac,
 * conversation_content_integrity) and non-envelope purposes must never select a
 * KEK, so passing them is a compile-time error rather than a silent new key
 * domain. `payload_dek` remains the default for every caller that omits the
 * field — existing ciphertext stays decryptable byte-for-byte.
 */
export type KmsEnvelopePurpose = 'payload_dek' | 'conversation_content';

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
   * `purpose` selects the wrapping-KEK derivation domain; omitted = 'payload_dek'
   * (the historical behavior — pre-existing callers and ciphertext are unchanged).
   */
  envelopeEncrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    plaintext: Uint8Array;
    purpose?: KmsEnvelopePurpose;
  }): Promise<{ ciphertext: Uint8Array; dekWrapped: Uint8Array }>;

  envelopeDecrypt(input: {
    orgId: string;
    keyId: KmsKeyId;
    version: number;
    ciphertext: Uint8Array;
    dekWrapped: Uint8Array;
    purpose?: KmsEnvelopePurpose;
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
    purpose?: KmsEnvelopePurpose;
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
        purpose: input.purpose ?? 'payload_dek',
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
    purpose?: KmsEnvelopePurpose;
  }): Promise<Uint8Array> {
    const kek = Buffer.from(
      await this.deriveKey({
        purpose: input.purpose ?? 'payload_dek',
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

/** Optional dependency injection for {@link createKmsFromEnv} (used by tests). */
export interface CreateKmsDeps {
  /** Inject a fake AWS KMS client so tests never reach real AWS. */
  awsKmsClientFactory?: (region: string) => AwsKmsClient;
}

export function createKmsFromEnv(
  env: {
    NODE_ENV: 'development' | 'test' | 'production';
    GOVAI_KMS_PROVIDER: 'dev' | 'aws' | 'gcp' | 'azure';
    KMS_DEV_SEED?: string | undefined;
    GOVAI_KMS_AWS_REGION?: string | undefined;
    GOVAI_KMS_AWS_KEY_ID?: string | undefined;
    GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE?: string | undefined;
    GOVAI_KMS_SEED_CACHE_TTL_SECONDS?: number | undefined;
  },
  deps?: CreateKmsDeps,
): Kms {
  // Production safety gates: never allow dev material in production.
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
  }
  // AWS production adapter (any NODE_ENV; requires full config + a readable, non-empty ciphertext file).
  if (env.GOVAI_KMS_PROVIDER === 'aws') {
    return createAwsKmsFromEnv(env, deps);
  }
  // DevKMS (dev/test only; production already rejected above).
  if (env.GOVAI_KMS_PROVIDER === 'dev') {
    if (!env.KMS_DEV_SEED) {
      throw new KmsBootError('DevKms requires KMS_DEV_SEED env var (hex 32+ chars).');
    }
    return new DevKms(env.KMS_DEV_SEED);
  }
  // gcp/azure not implemented — explicit fail on use.
  return new ProductionKmsRequired();
}

function createAwsKmsFromEnv(
  env: {
    GOVAI_KMS_AWS_REGION?: string | undefined;
    GOVAI_KMS_AWS_KEY_ID?: string | undefined;
    GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE?: string | undefined;
    GOVAI_KMS_SEED_CACHE_TTL_SECONDS?: number | undefined;
  },
  deps?: CreateKmsDeps,
): Kms {
  const region = env.GOVAI_KMS_AWS_REGION;
  const keyId = env.GOVAI_KMS_AWS_KEY_ID;
  const file = env.GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE;
  if (!region || !keyId || !file) {
    const missing: string[] = [];
    if (!region) missing.push('GOVAI_KMS_AWS_REGION');
    if (!keyId) missing.push('GOVAI_KMS_AWS_KEY_ID');
    if (!file) missing.push('GOVAI_KMS_AWS_MASTER_CIPHERTEXT_FILE');
    throw new KmsBootError(
      `GOVAI_KMS_PROVIDER=aws requires ${missing.join(', ')}. Runbook: docs/runbooks/kms-production.md`,
    );
  }
  const ttlSeconds = env.GOVAI_KMS_SEED_CACHE_TTL_SECONDS ?? 900;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new KmsBootError('GOVAI_KMS_SEED_CACHE_TTL_SECONDS must be a positive integer (seconds).');
  }

  let masterCiphertext: Buffer;
  try {
    masterCiphertext = readFileSync(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code ?? 'unknown';
    throw new KmsBootError(
      `unable to read master ciphertext file (${code}) at ${file}. Runbook: docs/runbooks/kms-production.md`,
    );
  }
  if (masterCiphertext.length === 0) {
    throw new KmsBootError(`master ciphertext file is empty at ${file}.`);
  }

  const client = deps?.awsKmsClientFactory
    ? deps.awsKmsClientFactory(region)
    : createRealAwsKmsClient(region);

  return new AwsKms({ client, keyId, masterCiphertext, ttlSeconds });
}

// Public KMS adapter surface (re-exported for consumers and tests).
export {
  AwsKms,
  AwsKmsError,
  createRealAwsKmsClient,
  MASTER_SEED_ENCRYPTION_CONTEXT,
} from './aws-kms.js';
export type { AwsKmsClient, AwsKmsDecryptRequest, AwsKmsOptions } from './aws-kms.js';
