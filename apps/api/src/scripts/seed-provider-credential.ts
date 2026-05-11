// seed-provider-credential — PR3.1a (issue #13).
//
// BRIDGE CODE. This CLI exists ONLY to seed tenant provider credentials before
// the secure HTTP admin endpoint lands in PR3.1b (issue #22). It is NOT the
// permanent operational path. Operators should migrate to the HTTP admin
// endpoint as soon as PR3.1b is merged.
//
// Security properties:
//   - The plaintext key is read from stdin only. argv NEVER carries the secret.
//   - --key=<value> / --api-key=<value> are explicitly refused with a non-zero
//     exit and an error that does not echo the supplied value.
//   - No log path emits the plaintext.
//   - On success the script prints exactly one JSON line of safe metadata
//     (id, key_prefix, key_last4, set_at, kms_key_id, kms_key_version).
//   - On failure the error path emits a structured message that omits the key.
//
// Usage:
//   printf 'sk-ant-....' | pnpm --filter @govai/api seed:provider-credential -- \
//     --org-id <uuid> --provider anthropic --set-by-user-id <uuid> --key-stdin

import { Pool } from 'pg';
import { loadEnv } from '@govai/config';
import { createKmsFromEnv } from '@govai/core-identity';
import { createProviderCredential } from '@govai/core-governance';

interface ParsedArgs {
  org_id: string;
  provider: 'anthropic' | 'openai';
  set_by_user_id: string;
  key_stdin: boolean;
}

class CliRefusal extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CliRefusal';
  }
}

const FORBIDDEN_FLAGS = ['--key', '--api-key', '--apikey', '--secret', '--token'];

export function parseArgs(argv: string[]): ParsedArgs {
  for (const a of argv) {
    for (const forbidden of FORBIDDEN_FLAGS) {
      // Match `--key=...`, `--key`, `--key value`, `--api-key=...`, etc.
      // We refuse on the FLAG presence regardless of value to avoid echoing it.
      if (a === forbidden || a.startsWith(`${forbidden}=`)) {
        throw new CliRefusal(
          'argv_secret_refused',
          `flag ${forbidden} is not accepted; pass the key on stdin via --key-stdin instead`,
        );
      }
    }
  }
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) return undefined;
    return v;
  };
  const orgId = get('--org-id');
  const provider = get('--provider');
  const setByUserId = get('--set-by-user-id');
  const keyStdin = argv.includes('--key-stdin');
  if (!orgId) throw new CliRefusal('missing_flag', '--org-id is required');
  if (!provider) throw new CliRefusal('missing_flag', '--provider is required');
  if (provider !== 'anthropic' && provider !== 'openai') {
    throw new CliRefusal('invalid_provider', `--provider must be 'anthropic' or 'openai'`);
  }
  if (!setByUserId) throw new CliRefusal('missing_flag', '--set-by-user-id is required');
  if (!keyStdin) {
    throw new CliRefusal(
      'stdin_required',
      '--key-stdin is required; secrets must NEVER be passed via argv',
    );
  }
  return { org_id: orgId, provider, set_by_user_id: setByUserId, key_stdin: true };
}

export async function readKeyFromStdin(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  const buf = Buffer.concat(chunks);
  // Trim a single trailing newline (common from `echo` / `printf` pipelines).
  const len = buf.length;
  let end = len;
  if (end >= 2 && buf[end - 1] === 0x0a && buf[end - 2] === 0x0d) end -= 2;
  else if (end >= 1 && buf[end - 1] === 0x0a) end -= 1;
  const out = buf.subarray(0, end).toString('utf8');
  // Zero the underlying buffer once consumed.
  buf.fill(0);
  return out;
}

export async function runSeed(deps: {
  argv: string[];
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
}): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(deps.argv);
  } catch (err) {
    const msg = err instanceof CliRefusal ? err.message : 'invalid arguments';
    const code = err instanceof CliRefusal ? err.code : 'invalid_args';
    deps.stderr.write(`${JSON.stringify({ error: code, message: msg })}\n`);
    return 1;
  }

  if ((deps.stdin as { isTTY?: boolean }).isTTY) {
    deps.stderr.write(
      `${JSON.stringify({
        error: 'stdin_is_tty',
        message: 'refusing to prompt; pipe the key via stdin (printf ... | pnpm tsx ...)',
      })}\n`,
    );
    return 1;
  }

  const env = loadEnv(deps.env);
  if (!env.DATABASE_URL) {
    deps.stderr.write(
      `${JSON.stringify({ error: 'missing_database_url', message: 'DATABASE_URL is required' })}\n`,
    );
    return 1;
  }

  let plaintext = await readKeyFromStdin(deps.stdin);
  if (!plaintext || plaintext.length === 0) {
    deps.stderr.write(
      `${JSON.stringify({ error: 'stdin_empty', message: 'no key bytes received on stdin' })}\n`,
    );
    return 1;
  }

  const kms = createKmsFromEnv(env);
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL app.org_id = '${parsed.org_id.replace(/'/g, "''")}'`);
    const result = await createProviderCredential({
      db: client,
      kms,
      org_id: parsed.org_id,
      provider: parsed.provider,
      plaintext_key: plaintext,
      set_by_user_id: parsed.set_by_user_id,
    });
    await client.query('COMMIT');
    plaintext = '<consumed>';
    void plaintext;
    deps.stdout.write(
      `${JSON.stringify({
        id: result.id,
        provider: result.provider,
        key_prefix: result.key_prefix,
        key_last4: result.key_last4,
        kms_key_id: result.kms_key_id,
        kms_key_version: result.kms_key_version,
        set_at: result.set_at.toISOString(),
        replaced_credential_id: result.replaced_credential_id,
      })}\n`,
    );
    return 0;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    const safeName = err instanceof Error ? err.name : 'unknown';
    const safeCode = (err as { code?: string } | undefined)?.code ?? null;
    deps.stderr.write(
      `${JSON.stringify({
        error: 'seed_failed',
        cause_name: safeName,
        cause_code: safeCode,
      })}\n`,
    );
    return 1;
  } finally {
    plaintext = '<consumed>';
    void plaintext;
    client.release();
    await pool.end();
  }
}

const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isMain) {
  void runSeed({
    argv: process.argv.slice(2),
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
  }).then((code) => process.exit(code));
}
