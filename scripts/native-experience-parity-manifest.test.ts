// Enforcement lane for the tracked parity manifest (EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01).
//
// Unlike the fixture tests in lib/parity-core.test.ts, this file reads ONE tracked artifact —
// docs/architecture/generated/native-experience-parity-v1.json — and validates it. This is a
// deliberate, narrow exception to the fixtures-only norm for scripts/ tests: it is still
// hermetic (a single readFileSync of a committed file resolved relative to this module — no
// git, no child process, no network, no repository discovery), and running it in the default
// unit lane is what makes `pnpm docs:parity:check` an enforced gate without any CI change.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  renderParityManifest,
  validateParityManifest,
  type ParityManifest,
} from './lib/parity-core.js';

const MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../docs/architecture/generated/native-experience-parity-v1.json'
);

describe('tracked native-experience-parity-v1.json', () => {
  const raw = readFileSync(MANIFEST_PATH, 'utf8');
  const parsed = JSON.parse(raw) as ParityManifest;

  it('satisfies every manifest invariant', () => {
    expect(validateParityManifest(parsed)).toEqual([]);
  });

  it('is stored in canonical byte form', () => {
    expect(renderParityManifest(parsed)).toBe(raw);
  });

  it('keeps the honest baseline shape: a non-trivial row count and no fabricated FULL rows', () => {
    expect(parsed.capabilities.length).toBeGreaterThan(100);
    // Every FULL row must live on a surface GovAI has actually proven end-to-end. At this
    // baseline that is the Anthropic API lane only; growing this list requires the proofs
    // the FULL axes encode, at which point this expectation is updated deliberately.
    const fullSurfaces = new Set(
      parsed.capabilities.filter((r) => r.classification === 'FULL').map((r) => r.surface)
    );
    expect([...fullSurfaces]).toEqual(['ANTHROPIC_API']);
  });
});
