// Unit tests for createProviderCredential — verifies KMS round-trip path,
// safe metadata extraction, replace-active SQL ordering, and the critical
// invariant that no error path leaks the plaintext key.

import { describe, it, expect } from 'vitest';
import { randomUUID, createHmac, randomBytes } from 'node:crypto';
import {
  createProviderCredential,
  type CreateProviderCredentialInput,
} from './create-provider-credential.js';
import { ApiError } from './create-org-beta-override.js';
import type { Kms } from '@govai/core-identity';

const PLAINTEXT_CANARY_ANTHROPIC = 'sk-ant-leak-canary-XYZABC123-DO-NOT-LEAK';
const PLAINTEXT_CANARY_OPENAI = 'sk-proj-leak-canary-XYZABC123-DO-NOT-LEAK';

class StubKms implements Kms {
  readonly providerName = 'stub';
  encryptCalls = 0;
  shouldThrow = false;
  async deriveKey() {
    return new Uint8Array(32);
  }
  async hmacSha256(input: { message: Uint8Array }) {
    return new Uint8Array(createHmac('sha256', 'k').update(Buffer.from(input.message)).digest());
  }
  async envelopeEncrypt(input: { plaintext: Uint8Array }) {
    this.encryptCalls += 1;
    if (this.shouldThrow) throw new Error('forced kms failure');
    // Scramble bytes so the resulting ciphertext doesn't contain the plaintext
    // substring — mirrors the property real KMS guarantees and lets tests
    // assert "no plaintext substring" cleanly without depending on AES.
    const pad = randomBytes(input.plaintext.length);
    const scrambled = Buffer.alloc(input.plaintext.length);
    for (let i = 0; i < input.plaintext.length; i += 1) {
      scrambled[i] = (input.plaintext[i] ?? 0) ^ (pad[i] ?? 0);
    }
    return {
      // Tag with 'CT:' marker followed by IV/pad (so tests can spot the
      // marker) then the scrambled bytes. Plaintext substring never appears.
      ciphertext: new Uint8Array(Buffer.concat([Buffer.from('CT:'), pad, scrambled])),
      dekWrapped: new Uint8Array(randomBytes(32)),
    };
  }
  async envelopeDecrypt() {
    return new Uint8Array(0);
  }
}

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

function makeStubDb(rowsFor: (sql: string) => Array<Record<string, unknown>>): {
  client: CreateProviderCredentialInput['db'];
  captured: CapturedQuery[];
} {
  const captured: CapturedQuery[] = [];
  const client = {
    query: async (sql: string, params: unknown[]) => {
      captured.push({ sql, params });
      return { rows: rowsFor(sql) };
    },
  } as unknown as CreateProviderCredentialInput['db'];
  return { client, captured };
}

function basicInput(overrides: Partial<CreateProviderCredentialInput> = {}): CreateProviderCredentialInput {
  const { client } = makeStubDb(() => [{ id: randomUUID(), set_at: new Date() }]);
  return {
    db: client,
    kms: new StubKms(),
    org_id: randomUUID(),
    provider: 'anthropic',
    plaintext_key: PLAINTEXT_CANARY_ANTHROPIC,
    set_by_user_id: randomUUID(),
    ...overrides,
  };
}

describe('createProviderCredential', () => {
  it('happy path: extracts safe metadata and returns it', async () => {
    const insertedId = randomUUID();
    const setAt = new Date();
    const { client } = makeStubDb((sql) => {
      if (sql.startsWith('UPDATE')) return []; // no prior active
      return [{ id: insertedId, set_at: setAt }];
    });

    const result = await createProviderCredential(
      basicInput({ db: client, plaintext_key: PLAINTEXT_CANARY_ANTHROPIC, provider: 'anthropic' }),
    );

    expect(result.id).toBe(insertedId);
    expect(result.set_at).toBe(setAt);
    expect(result.provider).toBe('anthropic');
    expect(result.key_prefix).toBe('sk-ant-');
    expect(result.key_last4).toBe('LEAK'); // last 4 of canary
    expect(result.kms_key_id).toBe('tenant-provider-credential-v1');
    expect(result.kms_key_version).toBe(1);
    expect(result.replaced_credential_id).toBeNull();
  });

  it('extracts sk-proj- prefix for OpenAI project keys', async () => {
    const { client } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );

    const result = await createProviderCredential(
      basicInput({ db: client, provider: 'openai', plaintext_key: PLAINTEXT_CANARY_OPENAI }),
    );
    expect(result.key_prefix).toBe('sk-proj-');
    expect(result.key_last4).toBe('LEAK');
  });

  it('extracts sk- prefix for OpenAI standard keys', async () => {
    const { client } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );
    const result = await createProviderCredential(
      basicInput({ db: client, provider: 'openai', plaintext_key: 'sk-abcd1234efgh5678ZZZZ' }),
    );
    expect(result.key_prefix).toBe('sk-');
    expect(result.key_last4).toBe('ZZZZ');
  });

  it('falls back to unknown-prefix when plaintext does not start with expected provider tag', async () => {
    const { client } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );
    const result = await createProviderCredential(
      basicInput({ db: client, provider: 'anthropic', plaintext_key: 'totally-bogus-keyXYZW' }),
    );
    expect(result.key_prefix).toBe('unknown-prefix');
    expect(result.key_last4).toBe('XYZW');
  });

  it('replace-active: returns replaced_credential_id when prior active row exists', async () => {
    const priorId = randomUUID();
    const newId = randomUUID();
    const { client } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [{ id: priorId }] : [{ id: newId, set_at: new Date() }],
    );
    const result = await createProviderCredential(
      basicInput({ db: client, plaintext_key: PLAINTEXT_CANARY_ANTHROPIC }),
    );
    expect(result.id).toBe(newId);
    expect(result.replaced_credential_id).toBe(priorId);
  });

  it('SQL: revoke statement runs before insert and targets (org_id, provider, status=active)', async () => {
    const { client, captured } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );
    await createProviderCredential(basicInput({ db: client }));
    expect(captured).toHaveLength(2);
    expect(captured[0]!.sql).toContain('UPDATE govai.provider_credentials');
    expect(captured[0]!.sql).toContain("status   = 'active'");
    expect(captured[1]!.sql).toContain('INSERT INTO govai.provider_credentials');
    expect(captured[1]!.sql).toContain("'active'");
  });

  it('SQL: insert never has plaintext as a parameter', async () => {
    const { client, captured } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );
    await createProviderCredential(
      basicInput({ db: client, plaintext_key: PLAINTEXT_CANARY_ANTHROPIC }),
    );
    const insertCall = captured.find((c) => c.sql.startsWith('INSERT'));
    expect(insertCall).toBeDefined();
    for (const p of insertCall!.params) {
      const asString = typeof p === 'string' ? p : Buffer.isBuffer(p) ? p.toString('utf8') : '';
      expect(asString).not.toContain('leak-canary');
      expect(asString).not.toContain(PLAINTEXT_CANARY_ANTHROPIC);
    }
  });

  it('rejects empty plaintext_key with 400', async () => {
    let captured: Error | null = null;
    try {
      await createProviderCredential(basicInput({ plaintext_key: '' }));
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(400);
    expect((captured as ApiError).code).toBe('plaintext_key_empty');
  });

  it('KMS failure: thrown error does NOT contain plaintext in message/cause/stack', async () => {
    const kms = new StubKms();
    kms.shouldThrow = true;
    let captured: Error | null = null;
    try {
      await createProviderCredential(
        basicInput({ kms, plaintext_key: PLAINTEXT_CANARY_ANTHROPIC }),
      );
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).code).toBe('kms_envelope_encrypt_failed');

    // Walk message + stack + recursive cause chain — none may contain plaintext.
    const surfaces: string[] = [];
    let cur: unknown = captured;
    let depth = 0;
    while (cur instanceof Error && depth < 5) {
      surfaces.push(cur.message);
      if (cur.stack) surfaces.push(cur.stack);
      cur = (cur as { cause?: unknown }).cause;
      depth += 1;
    }
    const merged = surfaces.join('\n');
    expect(merged).not.toContain('leak-canary');
    expect(merged).not.toContain(PLAINTEXT_CANARY_ANTHROPIC);
  });

  it('KMS is called exactly once per setProviderCredential invocation', async () => {
    const kms = new StubKms();
    const { client } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );
    await createProviderCredential(basicInput({ db: client, kms }));
    expect(kms.encryptCalls).toBe(1);
  });

  it('ciphertext + dekWrapped from KMS are stored (not raw plaintext)', async () => {
    const { client, captured } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );
    await createProviderCredential(
      basicInput({ db: client, plaintext_key: PLAINTEXT_CANARY_ANTHROPIC }),
    );
    const insertCall = captured.find((c) => c.sql.startsWith('INSERT'));
    expect(insertCall).toBeDefined();
    const ciphertextParam = insertCall!.params[2];
    expect(Buffer.isBuffer(ciphertextParam)).toBe(true);
    // Stub prefixes ciphertext with 'CT:' — confirms the encrypted bytes,
    // not the raw plaintext, are what gets persisted.
    expect((ciphertextParam as Buffer).toString('utf8')).toContain('CT:');
  });

  it('insert RETURNING empty → 500 with safe error code', async () => {
    const { client } = makeStubDb(() => []);
    let captured: Error | null = null;
    try {
      await createProviderCredential(basicInput({ db: client }));
    } catch (err) {
      captured = err as Error;
    }
    expect(captured).toBeInstanceOf(ApiError);
    expect((captured as ApiError).status).toBe(500);
    expect((captured as ApiError).code).toBe('insert_returning_empty');
  });

  it('honors kms_key_id and kms_key_version overrides', async () => {
    const { client, captured } = makeStubDb((sql) =>
      sql.startsWith('UPDATE') ? [] : [{ id: randomUUID(), set_at: new Date() }],
    );
    const result = await createProviderCredential(
      basicInput({ db: client, kms_key_id: 'tenant-provider-credential-v2', kms_key_version: 7 }),
    );
    expect(result.kms_key_id).toBe('tenant-provider-credential-v2');
    expect(result.kms_key_version).toBe(7);
    const insertCall = captured.find((c) => c.sql.startsWith('INSERT'));
    expect(insertCall!.params[4]).toBe('tenant-provider-credential-v2');
    expect(insertCall!.params[5]).toBe(7);
  });
});
