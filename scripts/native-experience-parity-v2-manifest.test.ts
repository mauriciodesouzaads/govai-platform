// Enforcement lane for the tracked V2 parity manifest
// (EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01).
//
// Mirrors the V1 enforcement lane (native-experience-parity-manifest.test.ts) for the NEW
// versioned baseline: it reads ONE tracked artifact — docs/architecture/generated/
// native-experience-parity-v2.json — and validates it. Still hermetic (a single readFileSync
// of a committed file resolved relative to this module — no git, no child process, no
// network), and running it in the default unit lane is what makes `pnpm docs:parity2:check`
// an enforced gate without any CI change. The V1 lane keeps enforcing the byte-preserved V1
// baseline unchanged.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  renderParityV2Manifest,
  validateParityV2Manifest,
  type ParityV2Manifest,
} from './lib/parity-v2-core.js';

const MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/architecture/generated/native-experience-parity-v2.json'
);

describe('tracked native-experience-parity-v2.json', () => {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw) as ParityV2Manifest;

  it('satisfies every manifest invariant', () => {
    expect(validateParityV2Manifest(parsed)).toEqual([]);
  });

  it('is stored in canonical byte form', () => {
    expect(renderParityV2Manifest(parsed)).toBe(raw);
  });

  it('names V1 as its predecessor and carries the V2 identity', () => {
    expect(parsed.baseline_version).toBe(2);
    expect(parsed.predecessor).toBe('docs/architecture/generated/native-experience-parity-v1.json');
  });

  it('keeps the honest baseline shape: a non-trivial row count and no fabricated FULL rows', () => {
    expect(parsed.capabilities.length).toBeGreaterThan(100);
    // Every FULL row must live on a surface GovAI has actually proven end-to-end. At this
    // baseline that is still the Anthropic API lane only (P0-C flipped conversation-level
    // persistence axes, which are NOT part of FULL); growing this list requires the proofs
    // the FULL axes encode, at which point this expectation is updated deliberately.
    const fullSurfaces = new Set(
      parsed.capabilities.filter((r) => r.classification === 'FULL').map((r) => r.surface)
    );
    expect([...fullSurfaces]).toEqual(['ANTHROPIC_API']);
  });
});
