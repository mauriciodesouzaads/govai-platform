// T4 (EP-P03A-A / F3 §13) — architectural contract for dlpPreScan.
//
// dlpPreScan is allowed to stay inside TX-A because its directly-controlled
// graph runs local detectors and queries configuration through the RECEIVED
// PoolClient only. This test combines (a) a source-graph scan over the exact
// modules dlpPreScan reaches and (b) a directed runtime test, so the contract
// fails loudly if the graph ever grows network, provider-SDK, KMS or
// pool-acquisition reach. A textual grep alone is NOT the proof — the runtime
// half instruments fetch and the client.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PoolClient } from 'pg';
import { dlpPreScan } from './dlp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

// Tokens that must NEVER appear in the dlpPreScan graph. Import specifiers and
// call-shapes, kept concrete to avoid false positives on prose comments.
const FORBIDDEN_TOKENS = [
  "from 'node:http'",
  "from 'node:https'",
  "from 'node:net'",
  "from 'node:tls'",
  "from 'undici'",
  'fetch(',
  'http.request',
  'https.request',
  'pool.connect',
  '.envelopeDecrypt',
  '.envelopeEncrypt',
  '@govai/provider-anthropic',
  '@govai/provider-openai',
  '@govai/core-identity',
  '@aws-sdk',
  'new WebSocket',
] as const;

async function nonTestSources(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(dir, f));
}

describe('T4 — dlpPreScan graph scan (source)', () => {
  it('dlp.ts and every @govai/dlp-br module it reaches carry no network / KMS / provider / pool tokens', async () => {
    // The direct graph: apps/api/src/pipeline/dlp.ts imports only `pg` types
    // and @govai/dlp-br. Scan dlp.ts itself plus ALL non-test dlp-br sources
    // (superset of what mergeFindingSpans/detectAllBaseline/scanSensitiveData
    // can reach inside the package — dlp-br has no internal package deps).
    const targets = [
      join(REPO_ROOT, 'apps', 'api', 'src', 'pipeline', 'dlp.ts'),
      ...(await nonTestSources(join(REPO_ROOT, 'packages', 'dlp-br', 'src'))),
    ];
    expect(targets.length).toBeGreaterThan(5);
    for (const file of targets) {
      const src = await readFile(file, 'utf8');
      for (const token of FORBIDDEN_TOKENS) {
        expect(src.includes(token), `${file} must not contain "${token}"`).toBe(false);
      }
    }
  });

  it('dlp.ts imports only pg types and @govai/dlp-br', async () => {
    const src = await readFile(join(REPO_ROOT, 'apps', 'api', 'src', 'pipeline', 'dlp.ts'), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['@govai/dlp-br', 'pg']);
  });
});

describe('T4 — dlpPreScan directed runtime contract', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses ONLY the received client; zero fetch; zero pool acquisition', async () => {
    const queries: string[] = [];
    // A client stub that records every query and answers the single config
    // SELECT the scan is allowed to make. Any other SQL fails the test.
    const client = {
      query: async (sql: string) => {
        queries.push(sql);
        if (sql.includes('FROM govai.dlp_baseline_config')) {
          return { rows: [{ detector: 'cpf', action: 'deny' }] };
        }
        throw new Error(`dlpPreScan issued an unexpected query: ${sql}`);
      },
      connect: () => {
        throw new Error('dlpPreScan must not acquire connections');
      },
    } as unknown as PoolClient;

    vi.stubGlobal('fetch', () => {
      throw new Error('dlpPreScan must not reach the network');
    });

    // Real detectors over a CPF-bearing text — the full in-scope compute path.
    const result = await dlpPreScan(client, 'cpf: 111.444.777-35 e email a@b.com');

    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('FROM govai.dlp_baseline_config');
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.highestAction).toBe('deny');
  });
});
