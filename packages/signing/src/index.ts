import { createSign, createVerify, generateKeyPairSync, type KeyObject } from 'node:crypto';

export type SignatureMaterial = {
  signature: Uint8Array;
  algorithm: 'Ed25519';
  publicKeyDer: Uint8Array;
  keyId: string;
};

export interface Signer {
  readonly keyId: string;
  readonly algorithm: 'Ed25519';
  sign(message: Uint8Array): Promise<SignatureMaterial>;
  verify(message: Uint8Array, signature: Uint8Array): Promise<boolean>;
  publicKeyDer(): Uint8Array;
}

/**
 * DevSigner — gera par Ed25519 em memória. Não para production.
 */
export class DevSigner implements Signer {
  readonly algorithm = 'Ed25519' as const;
  readonly keyId: string;
  private readonly priv: KeyObject;
  private readonly pub: KeyObject;

  constructor(keyId = 'dev-ed25519-1') {
    this.keyId = keyId;
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    this.priv = privateKey;
    this.pub = publicKey;
  }

  async sign(message: Uint8Array): Promise<SignatureMaterial> {
    // Ed25519 em Node usa sign(null, ...). createSign('Ed25519') não é suportado.
    const { sign: edSign } = await import('node:crypto');
    const signature = edSign(null, Buffer.from(message), this.priv);
    return {
      signature: new Uint8Array(signature),
      algorithm: 'Ed25519',
      publicKeyDer: this.publicKeyDer(),
      keyId: this.keyId,
    };
  }

  async verify(message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const { verify: edVerify } = await import('node:crypto');
    return edVerify(null, Buffer.from(message), this.pub, Buffer.from(signature));
  }

  publicKeyDer(): Uint8Array {
    return new Uint8Array(this.pub.export({ type: 'spki', format: 'der' }));
  }
}

// Stubs dummy para evitar tree-shaking warnings dos imports defensivos.
export { createSign, createVerify };
