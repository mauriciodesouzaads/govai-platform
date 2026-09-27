// CONT-P5-E1 — static guards over the harness sources (Dispatch v8 section 4 T-18 and T-19 static tests, C13-R3-I, and
// the Dispatch v3 section 6 static acceptance rows: THREE_DIMENSIONS_SEPARATED, SAFE_DISJUNCTION_RECURSION (no
// per-runtime tuple type), NAMING, the retired contradiction class, FORCED_BRANCH_SELECTION, no production claim).

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GOVAI_CODEX_INITIALIZE_CAPABILITIES } from '../guard/experimental-lockout.js';
import { enforceGovAICodexOutboundPolicy, GovAICodexPolicyViolation } from '../protocol/govai-policy.js';
import { HARNESS_CODEX_DIR, stripTsComments } from '../protocol/vendored-schema.js';
import * as effectiveFeatureList from './effective-feature-list.js';
import * as evidenceProjection from './evidence-projection.js';
import * as fixtureInvariants from './fixture-invariants.js';
import * as operationAdmissionToken from './operation-admission-token.js';
import * as operationBinder from './operation-binder.js';
import * as classifier from './resume-observation-classifier.js';
import * as contract from './resume-response-contract.js';
import * as validator from './resume-structural-validator.js';
import * as runtimeProvenance from './runtime-provenance-registry.js';
import * as threadSafety from './thread-safety-state.js';
import * as trustLifecycle from './trust-lifecycle.js';

const E1_MODULES = [
  'attestation/effective-feature-list.ts',
  'attestation/evidence-projection.ts',
  'attestation/fixture-invariants.ts',
  'attestation/operation-admission-token.ts',
  'attestation/operation-binder.ts',
  'attestation/resume-observation-classifier.ts',
  'attestation/resume-response-contract.ts',
  'attestation/resume-structural-validator.ts',
  'attestation/runtime-provenance-registry.ts',
  'attestation/thread-safety-state.ts',
  'attestation/trust-lifecycle.ts',
] as const;

const read = (rel: string): string => readFileSync(join(HARNESS_CODEX_DIR, rel), 'utf8');
const code = (rel: string): string => stripTsComments(read(rel));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(relative(HARNESS_CODEX_DIR, full).split(sep).join('/'));
  }
  return out;
}

const ALL_TS = walk(HARNESS_CODEX_DIR).filter((p) => p.endsWith('.ts'));
const HAND_WRITTEN_TS = ALL_TS.filter((p) => !p.startsWith('protocol/generated/'));

/** A word assembled at run time, so this file never carries the literal it searches for. */
const word = (...parts: string[]): string => parts.join('');
const identifier = (name: string): RegExp => new RegExp(`(?<![A-Za-z0-9_$])${name}(?![A-Za-z0-9_$])`);

describe('T-18 — approvalsReviewer is the single identifier of the approvals role', () => {
  it('no bare synonym of it exists as an identifier anywhere under harness/codex/** (comments excluded; generated files included)', () => {
    const bare = identifier(word('review', 'er'));
    expect(ALL_TS.filter((p) => bare.test(code(p)))).toEqual([]);
  });
});

describe('T-19 — the comparison path cannot normalize paths', () => {
  it('the classifier imports no filesystem or path API and never calls realpath', () => {
    const source = read('attestation/resume-observation-classifier.ts');
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    for (const banned of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'path', 'node:path', 'node:url', 'url']) expect(imports).not.toContain(banned);
    expect(imports.every((specifier) => specifier?.startsWith('./'))).toBe(true);
    expect(code('attestation/resume-observation-classifier.ts')).not.toMatch(/realpath|readFileSync|lstat|toLowerCase|toUpperCase|normalize\(|\.trim\(/);
  });
});

describe('C13-R3-I — the nested Thread check is exactly one call into the baseline pinned-schema validator', () => {
  const source = read('attestation/resume-structural-validator.ts');

  it('introduces no additionalProperties literal, no keyof-derived requiredness and no nested key list', () => {
    expect(source).not.toContain(word('additional', 'Properties'));
    expect(source).not.toMatch(identifier('keyof'));
    expect(source).not.toMatch(/generated\/v2\/Thread'/);
    for (const nested of ['cliVersion', 'sessionId', 'createdAt', 'ephemeral', 'projectId', 'environments', 'daybreakEnabled', 'canAcceptDirectInput']) {
      expect(source, nested).not.toContain(nested);
    }
  });

  it('delegates to json-schema-subset.ts once, against #/definitions/v2/Thread of the vendored bundle', () => {
    const stripped = stripTsComments(source);
    expect(stripped.match(/validateAgainstSchema\(/g)).toHaveLength(1);
    expect(stripped.match(/'#\/definitions\/v2\/Thread'/g)).toHaveLength(1);
    expect(source).toContain("from '../protocol/json-schema-subset.js'");
    expect(source).toContain("'codex_app_server_protocol.schemas.json'");
  });

  it('keeps json-schema-subset.ts and the vendored bundle byte-identical to the baseline', () => {
    const sha = (rel: string): string => createHash('sha256').update(readFileSync(join(HARNESS_CODEX_DIR, rel))).digest('hex');
    expect(sha('protocol/json-schema-subset.ts')).toBe('709ed823f6b29b31a37e97a054655490e8db534d3f20a394cd5248163a1d85d3');
    expect(sha('pin/vendor/json/codex_app_server_protocol.schemas.json')).toBe('d71ddf3bf5484f8de2799f7a4793c2e66808a9ec1a330e2307accb088ab5948a');
  });
});

describe('THREE_DIMENSIONS_SEPARATED — no merged enum anywhere', () => {
  const safety = new Set<string>(threadSafety.THREAD_SAFETY_STATES);
  const branch = new Set<string>(classifier.BRANCH_KNOWLEDGE_VALUES);
  const conformance = new Set<string>(classifier.CONFORMANCE_RESULTS);

  it('the three value sets are disjoint', () => {
    for (const v of safety) expect(branch.has(v) || conformance.has(v)).toBe(false);
    for (const v of branch) expect(conformance.has(v)).toBe(false);
  });

  it('no exported constant of an E1 module mixes values of two dimensions', () => {
    const modules = [
      effectiveFeatureList,
      evidenceProjection,
      fixtureInvariants,
      operationAdmissionToken,
      operationBinder,
      classifier,
      contract,
      validator,
      runtimeProvenance,
      threadSafety,
      trustLifecycle,
    ];
    for (const module of modules) {
      for (const [name, value] of Object.entries(module)) {
        if (!Array.isArray(value)) continue;
        const touched = [safety, branch, conformance].filter((set) => value.some((v) => typeof v === 'string' && set.has(v)));
        expect(touched.length, name).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('SAFE_DISJUNCTION_RECURSION — proofs are enumerated, runtimes are not', () => {
  it('no per-runtime tuple type or lookup exists in the safety / branch / conformance / evidence modules', () => {
    const banned = new RegExp(word('candi', 'date'), 'i');
    for (const rel of [
      'attestation/thread-safety-state.ts',
      'attestation/runtime-provenance-registry.ts',
      'attestation/resume-observation-classifier.ts',
      'attestation/resume-response-contract.ts',
      'attestation/resume-structural-validator.ts',
      'attestation/evidence-projection.ts',
    ]) {
      expect(read(rel), rel).not.toMatch(banned);
    }
  });
});

describe('the retired contradiction class is absent from code', () => {
  it('no source under harness/codex/** carries it (no retirement event, no result value, no test)', () => {
    const retired = word('CLASSIFICATION', '_', 'CONTRADICTION');
    expect(HAND_WRITTEN_TS.filter((p) => read(p).includes(retired))).toEqual([]);
    expect(read('README.md')).not.toContain(retired);
  });
});

describe('NAMING — GovAI proof identities are never named as upstream identifiers', () => {
  it('no identifier names an upstream / codex session, runtime or incarnation id', () => {
    const upstreamish = /(upstream|codex)_?(session|runtime|incarnation)_?id/i;
    for (const rel of HAND_WRITTEN_TS) expect(code(rel), rel).not.toMatch(upstreamish);
  });

  it('documents both GovAI proof identities as such', () => {
    const provenance = read('attestation/runtime-provenance-registry.ts');
    expect(provenance).toContain('RUNTIME_PROVENANCE_ID and HARNESS_RUNTIME_INCARNATION_ID are GovAI PROOF IDENTITIES');
    expect(provenance).toContain('GovAI proof identity of the runtime incarnation');
  });
});

describe('FORCED_BRANCH_SELECTION — no E1 code path restarts, unloads or re-subscribes to obtain a branch', () => {
  it('the E1 modules never send a lifecycle method, never signal a process and never read loaded-thread state', () => {
    for (const rel of E1_MODULES) {
      const source = code(rel);
      for (const banned of ['thread/unsubscribe', 'thread/loaded', 'thread/archive', 'thread/delete', '.terminate(', 'process.kill', 'SIGKILL', 'SIGTERM']) {
        expect(source.includes(banned), `${rel}: ${banned}`).toBe(false);
      }
    }
  });
});

describe('no isolation or production security claim; the writer-C assumption is documented', () => {
  it('neither the E1 modules nor the README claim prevention or isolation', () => {
    const claims = /isolation achieved|mutation prevented|prevents? (the )?mutation|isolated from other same-user processes/i;
    for (const rel of [...E1_MODULES, 'README.md']) expect(read(rel), rel).not.toMatch(claims);
  });

  it('the README documents E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION and the harness-start acknowledgement', () => {
    const readme = read('README.md');
    expect(readme).toContain('E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION');
    expect(readme).toContain('E1_CONTROLLED_ENVIRONMENT_ASSUMPTION');
    expect(readme).toContain('assertE1ControlledEnvironmentAcknowledged');
    expect(readme).toMatch(/not a production security (property|claim)/i);
  });
});

describe('carried M1 invariants — lockout untouched, experimentalApi false, resume allowlist exact', () => {
  it('experimentalApi stays false in the frozen initialize capabilities', () => {
    expect(GOVAI_CODEX_INITIALIZE_CAPABILITIES).toEqual({ experimentalApi: false, requestAttestation: false });
  });

  it('thread/resume admits exactly threadId, approvalPolicy, approvalsReviewer, sandbox, model, cwd (no requested provider / tier / effort)', () => {
    const governed = { threadId: 't', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' };
    expect(Object.keys(enforceGovAICodexOutboundPolicy('thread/resume', { ...governed, model: 'm', cwd: '/w' })).sort()).toEqual(
      ['approvalPolicy', 'approvalsReviewer', 'cwd', 'model', 'sandbox', 'threadId'],
    );
    for (const key of ['modelProvider', 'serviceTier', 'reasoningEffort']) {
      expect(() => enforceGovAICodexOutboundPolicy('thread/resume', { ...governed, [key]: 'x' }), key).toThrow(GovAICodexPolicyViolation);
    }
  });
});
