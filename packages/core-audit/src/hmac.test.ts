import { describe, it, expect } from 'vitest';
import { DevKms } from '@govai/core-identity';
import { hmacSign, hmacVerify } from './hmac.js';

describe('hmac with DevKms', () => {
  const kms = new DevKms('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const ctx = { kms, orgId: '00000000-0000-0000-0000-000000000001', keyId: 'k', keyVersion: 1 };

  it('sign deterministically', async () => {
    const a = await hmacSign(ctx, Buffer.from('hello'));
    const b = await hmacSign(ctx, Buffer.from('hello'));
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it('verify true on identical', async () => {
    const sig = await hmacSign(ctx, Buffer.from('msg'));
    expect(await hmacVerify(ctx, Buffer.from('msg'), sig)).toBe(true);
  });

  it('verify false on tamper', async () => {
    const sig = await hmacSign(ctx, Buffer.from('msg'));
    expect(await hmacVerify(ctx, Buffer.from('msG'), sig)).toBe(false);
  });
});
