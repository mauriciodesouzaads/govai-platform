// CONT-P5-A — the pin, the vendored bytes and MANIFEST.sha256 bound together (dispatch §0, §0.1, §2 pin/).
//
// PIN.ts values are asserted against the dispatch §0 literals (copied, never discovered); every vendored file
// is re-hashed against MANIFEST.sha256; every vendored TypeScript file's header-stripped body must hash to its
// declared upstream SOURCE_SHA256; the manifest must cover exactly the vendored + derived files.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HARNESS_CODEX_DIR,
  PROVENANCE_FIELDS,
  listVendoredTypeScript,
  splitProvenance,
  VENDORED_TS_DIR,
} from '../protocol/vendored-schema.js';
import { CODEX_PIN, CODEX_PIN_SCHEMA, isPinnedHostPlatform } from './PIN.js';

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

type ManifestEntry = { readonly sha256: string; readonly path: string; readonly src: string };

function readManifest(): { meta: Map<string, string>; entries: ManifestEntry[] } {
  const text = readFileSync(join(HARNESS_CODEX_DIR, 'pin', 'MANIFEST.sha256'), 'utf8');
  const meta = new Map<string, string>();
  const entries: ManifestEntry[] = [];
  let src = '';
  for (const line of text.split('\n')) {
    const m = /^# ([A-Z_]+)\s+= (.*)$/.exec(line);
    if (m) meta.set(m[1] ?? '', m[2] ?? '');
    if (line.startsWith('# src ')) src = line.slice('# src '.length);
    const e = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
    if (e) {
      entries.push({ sha256: e[1] ?? '', path: e[2] ?? '', src });
      src = '';
    }
  }
  return { meta, entries };
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(relative(HARNESS_CODEX_DIR, full).split(sep).join('/'));
  }
  return out;
}

describe('CODEX_PIN — the §0 identity, copied from the dispatch and frozen', () => {
  it('equals the adjudicated §0 values', () => {
    expect(CODEX_PIN).toEqual({
      release: '0.154.0',
      tag: 'rust-v0.154.0',
      annotatedTagObject: '36eab01061df3cde5f95ec20a526777b430091ba',
      commit: '6b9826e3aa83b1a5947db50f4332cb9c65f1b340',
      binaryKind: 'STANDALONE codex-app-server',
      crate: 'codex-app-server',
      bin: 'codex-app-server',
      supportedPlatform: 'darwin-arm64',
      otherPlatforms: 'FAIL_CLOSED_NOT_YET_PINNED',
      assetName: 'codex-app-server-aarch64-apple-darwin.tar.gz',
      assetId: 553706534,
      assetApiDigestSha256: 'a88883f1d2b68379eac51bd22be869eb768482aa9dcc1f9a69be86ef71dc6abd',
      assetSizeBytes: 67_973_610,
      archiveSha256: 'a88883f1d2b68379eac51bd22be869eb768482aa9dcc1f9a69be86ef71dc6abd',
      executableMemberName: 'codex-app-server-aarch64-apple-darwin',
      executableSha256: '2fc485696e5df06fc492fb310599752775fde726585149eaa7aeadb9117d235a',
      executableSizeBytes: 171_099_968,
      listenUrl: 'stdio://',
      releaseObjectMutability: 'MUTABLE',
      vendorMaturity: 'EXPERIMENTAL_AT_PIN',
      govaiUse: 'PINNED / INERT / CONFORMANCE_GATED',
    });
    expect(Object.isFrozen(CODEX_PIN)).toBe(true);
    expect(Object.isFrozen(CODEX_PIN_SCHEMA)).toBe(true);
    expect(CODEX_PIN.assetApiDigestSha256).toBe(CODEX_PIN.archiveSha256);
  });

  it('pins darwin-arm64 only; every other host fails closed', () => {
    expect(isPinnedHostPlatform({ platform: 'darwin', arch: 'arm64' })).toBe(true);
    for (const [platform, arch] of [
      ['darwin', 'x64'],
      ['linux', 'arm64'],
      ['linux', 'x64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ] as const) {
      expect(isPinnedHostPlatform({ platform, arch })).toBe(false);
    }
  });
});

describe('MANIFEST.sha256 — every vendored and derived file, digest-bound and commit-addressed', () => {
  const { meta, entries } = readManifest();

  it('records the tag, the annotated tag object, the commit and the commit-addressed retrieval rule', () => {
    expect(meta.get('PIN_RELEASE')).toBe(CODEX_PIN.release);
    expect(meta.get('PIN_TAG')).toBe(CODEX_PIN.tag);
    expect(meta.get('ANNOTATED_TAG_OBJECT')).toBe(CODEX_PIN.annotatedTagObject);
    expect(meta.get('PIN_COMMIT')).toBe(CODEX_PIN.commit);
    expect(meta.get('RETRIEVAL')).toContain(`https://raw.githubusercontent.com/openai/codex/${CODEX_PIN.commit}/`);
    expect(meta.get('RETRIEVAL')).not.toContain('rust-v0.154.0');
  });

  it('matches the committed bytes of every listed file', () => {
    expect(entries).toHaveLength(717);
    const mismatches = entries.filter((e) => sha256(readFileSync(join(HARNESS_CODEX_DIR, e.path))) !== e.sha256).map((e) => e.path);
    expect(mismatches).toEqual([]);
  });

  it('covers exactly the vendored tree plus every derived artifact (files that START with a provenance header)', () => {
    const all = walk(HARNESS_CODEX_DIR);
    const vendored = all.filter((p) => p.startsWith('pin/vendor/') || p.startsWith('protocol/generated/'));
    const derivedTs = all.filter(
      (p) => !p.startsWith('protocol/generated/') && p.endsWith('.ts') && splitProvenance(readFileSync(join(HARNESS_CODEX_DIR, p))) !== null,
    );
    expect(derivedTs.sort()).toEqual(['protocol/experimental-inventory.ts', 'protocol/method-names.ts', 'protocol/wire.ts']);
    const inventoryMd = 'protocol/EXPERIMENTAL_SOURCE_INVENTORY.md';
    expect(readFileSync(join(HARNESS_CODEX_DIR, inventoryMd), 'utf8')).toContain('\nGOVAI-PROVENANCE (CONT-P5-A)\n');
    const expected = [...vendored, ...derivedTs, inventoryMd].sort();
    expect(entries.map((e) => e.path).sort()).toEqual(expected);
    // The manifest itself is not in its own list (no self-hash fixed point).
    expect(entries.map((e) => e.path)).not.toContain('pin/MANIFEST.sha256');
  });

  it('binds each vendored entry to its commit-addressed upstream source', () => {
    for (const e of entries) {
      const m = /^(VENDORED_VERBATIM|VENDORED_WITH_PROVENANCE_HEADER|DERIVED) (\S+)(?: sha256=([0-9a-f]{64}) url=(\S+))?/.exec(e.src);
      expect(m, e.path).not.toBeNull();
      const [, kind, upstreamPath, upstreamSha, url] = m!;
      if (kind === 'DERIVED') {
        expect(upstreamPath).toBe('VERBATIM_SOURCE_DERIVED');
        continue;
      }
      expect(url).toBe(`https://raw.githubusercontent.com/openai/codex/${CODEX_PIN.commit}/${upstreamPath}`);
      const bytes = readFileSync(join(HARNESS_CODEX_DIR, e.path));
      if (kind === 'VENDORED_VERBATIM') {
        expect(sha256(bytes)).toBe(upstreamSha);
      } else {
        const split = splitProvenance(bytes);
        expect(split, e.path).not.toBeNull();
        expect(sha256(split!.body)).toBe(upstreamSha);
        expect(split!.fields.SOURCE_SHA256).toBe(upstreamSha);
        expect(split!.fields.SOURCE_PATH_OR_SCHEMA).toBe(upstreamPath);
      }
    }
  });
});

describe('vendored TypeScript — verbatim upstream bytes behind a complete provenance header', () => {
  const files = listVendoredTypeScript();

  it('vendors all 711 generated files, each with every provenance field and the pin', () => {
    expect(files).toHaveLength(CODEX_PIN_SCHEMA.typescriptFileCount);
    for (const rel of files) {
      const split = splitProvenance(readFileSync(join(VENDORED_TS_DIR, rel)));
      expect(split, rel).not.toBeNull();
      expect(Object.keys(split!.fields).sort()).toEqual([...PROVENANCE_FIELDS].sort());
      expect(split!.fields).toMatchObject({
        PIN_RELEASE: CODEX_PIN.release,
        PIN_TAG: CODEX_PIN.tag,
        PIN_COMMIT: CODEX_PIN.commit,
        SOURCE_PATH_OR_SCHEMA: `${CODEX_PIN_SCHEMA.typescriptUpstreamRoot}${rel}`,
        DERIVATION_MODE: 'GENERATED',
      });
      expect(split!.fields.GENERATOR_VERSION).toContain('ts-rs 11.1.0');
      expect(split!.fields.GENERATOR_CONFIG).toContain('experimental_api: false');
      expect(split!.headerText).not.toContain('GENERATED_OUTPUT_SHA256');
      expect(sha256(split!.body)).toBe(split!.fields.SOURCE_SHA256);
      expect(split!.body.toString('utf8').startsWith('// GENERATED CODE! DO NOT MODIFY BY HAND!')).toBe(true);
    }
  });

  it('reproduces the pinned tree digest over the header-stripped bytes', () => {
    const lines = files.map((rel) => `${sha256(splitProvenance(readFileSync(join(VENDORED_TS_DIR, rel)))!.body)}  ${rel}\n`);
    expect(sha256(lines.join(''))).toBe(CODEX_PIN_SCHEMA.typescriptTreeSha256);
  });

  it('carries the digests the dispatch cites for the §0.1 initialize schema and the §2 examples', () => {
    const cited: Record<string, string> = {
      'InitializeParams.ts': 'bfc13b4f',
      'InitializeCapabilities.ts': '4abc3c8b',
      'InitializeResponse.ts': '4feabcb6',
      'ClientInfo.ts': 'c3f38c70',
      'v2/ThreadForkParams.ts': '0929c646',
      'v2/AskForApproval.ts': '81dd17de',
    };
    for (const [rel, prefix] of Object.entries(cited)) {
      const full = CODEX_PIN_SCHEMA.typescriptSourceSha256[rel as keyof typeof CODEX_PIN_SCHEMA.typescriptSourceSha256];
      expect(full.startsWith(prefix), rel).toBe(true);
      expect(sha256(splitProvenance(readFileSync(join(VENDORED_TS_DIR, rel)))!.body)).toBe(full);
    }
  });

  it('keeps the vendored JSON byte-identical to the pinned digests', () => {
    for (const j of Object.values(CODEX_PIN_SCHEMA.json)) {
      expect(sha256(readFileSync(join(HARNESS_CODEX_DIR, j.vendoredPath)))).toBe(j.sha256);
    }
  });

  it('marks every derived fragment VERBATIM_SOURCE_DERIVED with its pin and anchors', () => {
    for (const rel of ['protocol/wire.ts', 'protocol/method-names.ts', 'protocol/experimental-inventory.ts']) {
      const split = splitProvenance(readFileSync(join(HARNESS_CODEX_DIR, rel)));
      expect(split, rel).not.toBeNull();
      expect(split!.fields).toMatchObject({
        PIN_RELEASE: CODEX_PIN.release,
        PIN_TAG: CODEX_PIN.tag,
        PIN_COMMIT: CODEX_PIN.commit,
        DERIVATION_MODE: 'VERBATIM_SOURCE_DERIVED',
      });
      expect(split!.headerText).not.toContain('GENERATED_OUTPUT_SHA256');
    }
  });
});
