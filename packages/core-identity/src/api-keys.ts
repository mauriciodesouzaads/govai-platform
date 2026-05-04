import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';

const PREFIX = 'govai_sk_';
const PREFIX_LOOKUP_LEN = 12;

export type GeneratedApiKey = {
  plaintext: string;
  prefix: string;
  hash: string;
};

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const raw = randomBytes(32).toString('base64url');
  const plaintext = `${PREFIX}${raw}`;
  const prefix = plaintext.slice(0, PREFIX_LOOKUP_LEN);
  const hash = await argon2.hash(plaintext, { type: argon2.argon2id });
  return { plaintext, prefix, hash };
}

export async function verifyApiKey(plaintext: string, hash: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

export function lookupPrefix(plaintext: string): string {
  return plaintext.slice(0, PREFIX_LOOKUP_LEN);
}
