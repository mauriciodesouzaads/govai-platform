import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, KeyObject } from 'node:crypto';
import { SignJWT, exportSPKI } from 'jose';
import { JwtVerifier } from './jwt.js';

async function pemFromKey(key: KeyObject): Promise<string> {
  return exportSPKI(key as unknown as Parameters<typeof exportSPKI>[0]);
}

describe('JwtVerifier — algorithm whitelist', () => {
  it('accepts EdDSA token', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pem = await pemFromKey(publicKey);
    const verifier = await JwtVerifier.fromPem(pem, 'iss', 'aud');
    const token = await new SignJWT({ org_id: '00000000-0000-0000-0000-000000000001' })
      .setProtectedHeader({ alg: 'EdDSA' })
      .setIssuer('iss')
      .setAudience('aud')
      .setSubject('user-1')
      .setExpirationTime('5m')
      .sign(privateKey as unknown as Parameters<typeof SignJWT.prototype.sign>[0]);
    const claims = await verifier.verify(token);
    expect(claims.sub).toBe('user-1');
  });

  it('rejects alg=none token', async () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const pem = await pemFromKey(publicKey);
    const verifier = await JwtVerifier.fromPem(pem, 'iss', 'aud');

    // Construct unsigned alg=none token by hand.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'iss',
        aud: 'aud',
        sub: 'user-x',
        org_id: '00000000-0000-0000-0000-000000000001',
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.`;
    await expect(verifier.verify(token)).rejects.toThrow();
  });
});
