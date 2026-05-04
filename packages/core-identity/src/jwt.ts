import { jwtVerify, importSPKI, type JWTPayload } from 'jose';

export type JwtClaims = JWTPayload & {
  sub: string;
  org_id: string;
  roles?: string[];
  scopes?: string[];
};

const ALLOWED_ALGS = ['EdDSA', 'RS256'] as const;
type AllowedAlg = (typeof ALLOWED_ALGS)[number];

// jose@6 dropped the public `KeyLike` symbol; we accept whatever importSPKI returns.
type CryptoKeyLike = Awaited<ReturnType<typeof importSPKI>>;

export class JwtVerifier {
  private constructor(
    private readonly key: CryptoKeyLike,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly denylist: Set<string>,
  ) {}

  static async fromPem(pem: string, issuer: string, audience: string): Promise<JwtVerifier> {
    // Tenta EdDSA primeiro, fallback RS256.
    let key: CryptoKeyLike;
    try {
      key = await importSPKI(pem, 'EdDSA');
    } catch {
      key = await importSPKI(pem, 'RS256');
    }
    return new JwtVerifier(key, issuer, audience, new Set());
  }

  addDenied(jti: string): void {
    this.denylist.add(jti);
  }

  async verify(token: string): Promise<JwtClaims> {
    const { payload, protectedHeader } = await jwtVerify(token, this.key, {
      issuer: this.issuer,
      audience: this.audience,
      algorithms: [...ALLOWED_ALGS] as AllowedAlg[],
    });

    if (!ALLOWED_ALGS.includes(protectedHeader.alg as AllowedAlg)) {
      throw new Error(`jwt: alg ${protectedHeader.alg} not in allowlist`);
    }
    if (payload.jti && this.denylist.has(payload.jti)) {
      throw new Error('jwt: jti revoked');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('jwt: sub missing');
    }
    if (typeof payload.org_id !== 'string') {
      throw new Error('jwt: org_id claim missing');
    }
    return payload as JwtClaims;
  }
}
