// Unit tests for seed-provider-credential CLI parser + stdin reader.
// The end-to-end DB+KMS path is exercised by the helper unit tests; here we
// pin only the CLI surface contract:
//   1) argv-based secrets are refused;
//   2) stdin-only is required;
//   3) plaintext never appears in printed output.

import { describe, it, expect } from 'vitest';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { parseArgs, readKeyFromStdin } from './seed-provider-credential.js';

const CANARY = 'sk-ant-leak-canary-XYZABC123-DO-NOT-LEAK';

describe('seed-provider-credential / parseArgs', () => {
  const validBase = (extra: string[] = []) => [
    '--org-id',
    randomUUID(),
    '--provider',
    'anthropic',
    '--set-by-user-id',
    randomUUID(),
    '--key-stdin',
    ...extra,
  ];

  it('accepts valid argv', () => {
    const parsed = parseArgs(validBase());
    expect(parsed.provider).toBe('anthropic');
    expect(parsed.key_stdin).toBe(true);
  });

  it('refuses --key', () => {
    expect(() => parseArgs([...validBase(), '--key', CANARY])).toThrowError(
      /argv_secret_refused|--key is not accepted/,
    );
  });

  it('refuses --key=...', () => {
    let caught: Error | null = null;
    try {
      parseArgs([...validBase(), `--key=${CANARY}`]);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    // Critical: the error message must NOT echo the canary substring.
    expect(caught!.message).not.toContain('leak-canary');
    expect(caught!.message).not.toContain(CANARY);
  });

  it('refuses --api-key', () => {
    expect(() => parseArgs([...validBase(), '--api-key', CANARY])).toThrowError(
      /argv_secret_refused|--api-key is not accepted/,
    );
  });

  it('refuses --secret=...', () => {
    let caught: Error | null = null;
    try {
      parseArgs([...validBase(), `--secret=${CANARY}`]);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught!.message).not.toContain('leak-canary');
  });

  it('rejects missing --org-id', () => {
    expect(() =>
      parseArgs(['--provider', 'anthropic', '--set-by-user-id', randomUUID(), '--key-stdin']),
    ).toThrowError(/--org-id is required/);
  });

  it('rejects unknown provider', () => {
    expect(() =>
      parseArgs([
        '--org-id',
        randomUUID(),
        '--provider',
        'cohere',
        '--set-by-user-id',
        randomUUID(),
        '--key-stdin',
      ]),
    ).toThrowError(/--provider must be/);
  });

  it('requires --key-stdin', () => {
    expect(() =>
      parseArgs([
        '--org-id',
        randomUUID(),
        '--provider',
        'anthropic',
        '--set-by-user-id',
        randomUUID(),
      ]),
    ).toThrowError(/--key-stdin is required/);
  });
});

describe('seed-provider-credential / readKeyFromStdin', () => {
  it('reads key from stream and trims trailing LF', async () => {
    const s = Readable.from([Buffer.from(`${CANARY}\n`)]);
    const out = await readKeyFromStdin(s);
    expect(out).toBe(CANARY);
  });

  it('reads key from stream and trims CRLF', async () => {
    const s = Readable.from([Buffer.from(`${CANARY}\r\n`)]);
    const out = await readKeyFromStdin(s);
    expect(out).toBe(CANARY);
  });

  it('preserves internal newlines (only trims a single trailing one)', async () => {
    const s = Readable.from([Buffer.from(`abc\ndef\n`)]);
    const out = await readKeyFromStdin(s);
    expect(out).toBe('abc\ndef');
  });

  it('handles multi-chunk streams', async () => {
    const s = Readable.from([
      Buffer.from('sk-ant-'),
      Buffer.from('leak-'),
      Buffer.from('canary'),
      Buffer.from('\n'),
    ]);
    const out = await readKeyFromStdin(s);
    expect(out).toBe('sk-ant-leak-canary');
  });

  it('returns empty string on empty stdin', async () => {
    const s = Readable.from([]);
    const out = await readKeyFromStdin(s);
    expect(out).toBe('');
  });
});
