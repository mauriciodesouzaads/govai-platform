import { describe, it, expect } from 'vitest';
import { generateApiKey, verifyApiKey, lookupPrefix } from './api-keys.js';

describe('api keys', () => {
  it('generated key has expected prefix and verifies', async () => {
    const key = await generateApiKey();
    expect(key.plaintext).toMatch(/^govai_sk_/);
    expect(key.prefix).toBe(key.plaintext.slice(0, 12));
    expect(key.hash).toMatch(/^\$argon2id\$/);
    expect(await verifyApiKey(key.plaintext, key.hash)).toBe(true);
  });

  it('verify fails on tampered plaintext', async () => {
    const key = await generateApiKey();
    expect(await verifyApiKey(key.plaintext + 'x', key.hash)).toBe(false);
  });

  it('verify returns false on invalid hash format', async () => {
    expect(await verifyApiKey('govai_sk_anything', 'not-a-hash')).toBe(false);
  });

  it('lookupPrefix returns first 12 chars', () => {
    expect(lookupPrefix('govai_sk_abcdefghijklmno')).toBe('govai_sk_abc');
  });
});
