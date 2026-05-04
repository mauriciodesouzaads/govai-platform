import type { Kms } from '@govai/core-identity';

export type HmacContext = {
  kms: Kms;
  orgId: string;
  keyId: string;
  keyVersion: number;
};

export async function hmacSign(ctx: HmacContext, message: Uint8Array): Promise<Uint8Array> {
  return ctx.kms.hmacSha256({
    purpose: 'audit_hmac',
    orgId: ctx.orgId,
    keyId: ctx.keyId,
    version: ctx.keyVersion,
    message,
  });
}

export async function hmacVerify(
  ctx: HmacContext,
  message: Uint8Array,
  expected: Uint8Array,
): Promise<boolean> {
  const actual = await hmacSign(ctx, message);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= (actual[i] ?? 0) ^ (expected[i] ?? 0);
  }
  return diff === 0;
}
