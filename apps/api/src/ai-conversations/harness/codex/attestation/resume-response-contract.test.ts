// CONT-P5-E1 — the resume FIELD CONTRACT (Dispatch v8 M7c, section 2; Correction 11 sections 5-13, 21): T-24 and the
// byte-level tie between the sealed FIELD_CONTRACT_TABLE_C11 block and the frozen code table.

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  COMPARE_FIELDS,
  EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS,
  FIELD_CONTRACT_NULLABLE_KEYS_ARE_GENERATED,
  FIELD_CONTRACT_REQUIRED_KEYS_ARE_GENERATED,
  FIELD_CONTRACT_TABLE_C11,
  fieldContractRow,
  KNOWN_TOP_LEVEL_RESPONSE_KEYS,
  NORMALIZATION_RULES,
  NORMALIZATION_RULES_COVER_COMPARE_FIELDS,
  normalizeRequestedValue,
  requestedConformanceFields,
  RESPONSE_NULLABLE_REQUIRED_FIELDS,
  RESPONSE_STRUCTURAL_REQUIRED_FIELDS,
  SANDBOX_MODE_PROJECTION,
  type FieldContractRow,
} from './resume-response-contract.js';

/** The sealed block, verbatim (Dispatch v8 section 2 == Correction 11 section 21; 21 lines, 3774 bytes). */
const SEALED_FIELD_CONTRACT_TABLE_C11 = `--- FIELD_CONTRACT_TABLE_C11 BEGIN ---
responseKey            structuralRequired  nullable  experimental  requestKey         requestedOnlyIfPresent  normalize                     conformanceRole       evidenceRole
thread                 YES                 NO        NO            -                  -                       -                             STRUCTURAL_ONLY       STRUCTURAL_STATUS (+ carried correlation status)
model                  YES                 NO        NO            model              YES                     identity                      COMPARE               REQUESTED_VS_EFFECTIVE_WHEN_COMPARED
modelProvider          YES                 NO        NO            -                  -                       -                             STRUCTURAL_ONLY       STRUCTURAL_STATUS
serviceTier            YES                 YES       NO            -                  -                       -                             STRUCTURAL_ONLY       STRUCTURAL_STATUS
cwd                    YES                 NO        NO            cwd                YES                     identity_in_INV_PATH_domain   COMPARE               REQUESTED_VS_EFFECTIVE_WHEN_COMPARED
instructionSources     YES                 NO        NO            -                  -                       -                             STRUCTURAL_ONLY       STRUCTURAL_STATUS (contents never persisted)
approvalPolicy         YES                 NO        NO            approvalPolicy     NO                      identity                      COMPARE               REQUESTED_VS_EFFECTIVE (discriminator only if granular)
approvalsReviewer      YES                 NO        NO            approvalsReviewer  NO                      identity                      COMPARE               REQUESTED_VS_EFFECTIVE
sandbox                YES                 NO        NO            sandbox            NO                      mode_projection               COMPARE               REQUESTED_MODE_VS_EFFECTIVE_DISCRIMINATOR (payload never persisted)
reasoningEffort        YES                 YES       NO            -                  -                       -                             STRUCTURAL_ONLY       STRUCTURAL_STATUS
turnsBackwardsCursor   YES                 YES       NO            -                  -                       -                             STRUCTURAL_ONLY       STRUCTURAL_STATUS (content never persisted)
itemsBackwardsCursor   YES                 YES       NO            -                  -                       -                             STRUCTURAL_ONLY       STRUCTURAL_STATUS (content never persisted)
runtimeWorkspaceRoots  NO                  NO        YES           -                  -                       -                             EXPERIMENTAL_OBSERVE  UNOBSERVED | OBSERVED_PRESENT (content never persisted)
activePermissionProfile NO                 YES       YES           -                  -                       -                             EXPERIMENTAL_OBSERVE  UNOBSERVED | OBSERVED_PRESENT (content never persisted)
multiAgentMode         NO                  NO        YES           -                  -                       -                             EXPERIMENTAL_OBSERVE  UNOBSERVED | OBSERVED_PRESENT (content never persisted)
initialTurnsPage       NO                  YES       YES           -                  -                       -                             EXPERIMENTAL_OBSERVE  UNOBSERVED | OBSERVED_PRESENT (content never persisted)
mode_projection      = request { "read-only" -> "readOnly", "workspace-write" -> "workspaceWrite" } ; effective = sandbox.type
STRUCTURAL_STATUS    = VALID | STRUCTURAL_FAILURE(bounded reason) ; never the value itself unless listed as recorded above
--- FIELD_CONTRACT_TABLE_C11 END ---
`;
const SEALED_BLOCK_SHA256 = 'da76edecae61b367f4fa3a792e6f05197dcd782e2b36f31e12cbb5a35ce17627';

function parseSealedRows(block: string): FieldContractRow[] {
  const lines = block.split('\n').filter((l) => l.length > 0);
  const rows = lines.slice(2, lines.findIndex((l) => l.startsWith('mode_projection')));
  return rows.map((line) => {
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line);
    if (m === null) throw new Error(`unparseable sealed row: ${line}`);
    const [, responseKey, required, nullable, experimental, requestKey, onlyIfPresent, normalize, role, evidenceRole] = m;
    const yes = (cell: string | undefined): boolean => cell === 'YES';
    return {
      responseKey: responseKey!,
      structuralRequired: yes(required),
      nullable: yes(nullable),
      experimental: yes(experimental),
      ...(requestKey === '-' ? {} : { requestKey }),
      ...(onlyIfPresent === '-' ? {} : { requestedOnlyIfPresent: yes(onlyIfPresent) }),
      ...(normalize === '-' ? {} : { normalize: normalize as FieldContractRow['normalize'] }),
      conformanceRole: role as FieldContractRow['conformanceRole'],
      evidenceRole: evidenceRole!,
    };
  });
}

describe('FIELD_CONTRACT_TABLE_C11 — one frozen table, literally the sealed block', () => {
  it('embeds the sealed block byte-identically (SHA-256 da76edec...)', () => {
    expect(Buffer.byteLength(SEALED_FIELD_CONTRACT_TABLE_C11, 'utf8')).toBe(3774);
    expect(createHash('sha256').update(SEALED_FIELD_CONTRACT_TABLE_C11).digest('hex')).toBe(SEALED_BLOCK_SHA256);
  });

  it('encodes every sealed row, in order, cell for cell', () => {
    expect(FIELD_CONTRACT_TABLE_C11.map((row) => ({ ...row }))).toEqual(parseSealedRows(SEALED_FIELD_CONTRACT_TABLE_C11));
  });

  it('is frozen, row by row', () => {
    expect(Object.isFrozen(FIELD_CONTRACT_TABLE_C11)).toBe(true);
    for (const row of FIELD_CONTRACT_TABLE_C11) expect(Object.isFrozen(row)).toBe(true);
  });

  it('T-24: the key set is exactly the 12 required + 4 experimental keys; COMPARE is exactly 5 keys', () => {
    expect(KNOWN_TOP_LEVEL_RESPONSE_KEYS).toEqual([
      'thread',
      'model',
      'modelProvider',
      'serviceTier',
      'cwd',
      'instructionSources',
      'approvalPolicy',
      'approvalsReviewer',
      'sandbox',
      'reasoningEffort',
      'turnsBackwardsCursor',
      'itemsBackwardsCursor',
      'runtimeWorkspaceRoots',
      'activePermissionProfile',
      'multiAgentMode',
      'initialTurnsPage',
    ]);
    expect(RESPONSE_STRUCTURAL_REQUIRED_FIELDS).toHaveLength(12);
    expect(EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS).toEqual(['runtimeWorkspaceRoots', 'activePermissionProfile', 'multiAgentMode', 'initialTurnsPage']);
    expect(COMPARE_FIELDS).toEqual(['model', 'cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox']);
    expect(RESPONSE_NULLABLE_REQUIRED_FIELDS).toEqual(['serviceTier', 'reasoningEffort', 'turnsBackwardsCursor', 'itemsBackwardsCursor']);
    expect(new Set([...RESPONSE_STRUCTURAL_REQUIRED_FIELDS, ...EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS]).size).toBe(16);
  });

  it('T-24: the derived constants are computed from the table, not hand-listed', () => {
    expect(RESPONSE_STRUCTURAL_REQUIRED_FIELDS).toEqual(FIELD_CONTRACT_TABLE_C11.filter((r) => r.structuralRequired).map((r) => r.responseKey));
    expect(EXPERIMENTAL_OPTIONAL_OBSERVABLE_FIELDS).toEqual(FIELD_CONTRACT_TABLE_C11.filter((r) => r.experimental).map((r) => r.responseKey));
    expect(COMPARE_FIELDS).toEqual(FIELD_CONTRACT_TABLE_C11.filter((r) => r.conformanceRole === 'COMPARE').map((r) => r.responseKey));
    for (const key of KNOWN_TOP_LEVEL_RESPONSE_KEYS) expect(fieldContractRow(key)?.responseKey).toBe(key);
    expect(fieldContractRow('unexpected')).toBeUndefined();
  });

  it('ties the required and nullable keys to the GENERATED ThreadResumeResponse at compile time', () => {
    expect(FIELD_CONTRACT_REQUIRED_KEYS_ARE_GENERATED).toBe(true);
    expect(FIELD_CONTRACT_NULLABLE_KEYS_ARE_GENERATED).toBe(true);
    expect(NORMALIZATION_RULES_COVER_COMPARE_FIELDS).toBe(true);
  });

  it('keeps the four layers disjoint in role: structural-only and experimental keys never compare', () => {
    for (const row of FIELD_CONTRACT_TABLE_C11) {
      if (row.conformanceRole === 'COMPARE') {
        expect(row.structuralRequired && !row.experimental, row.responseKey).toBe(true);
        expect(row.requestKey, row.responseKey).toBe(row.responseKey);
      } else {
        expect(row.requestKey, row.responseKey).toBeUndefined();
        expect(row.normalize, row.responseKey).toBeUndefined();
      }
      if (row.experimental) expect(row.conformanceRole).toBe('EXPERIMENTAL_OBSERVE');
    }
    expect(fieldContractRow('modelProvider')?.conformanceRole).toBe('STRUCTURAL_ONLY');
    expect(fieldContractRow('instructionSources')?.conformanceRole).toBe('STRUCTURAL_ONLY');
  });
});

describe('Layer B — REQUESTED_CONFORMANCE_FIELDS(q), total over key presence', () => {
  const governed = { threadId: 't', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' };

  it('is exactly one of four sets, decided by key presence in the bound request only', () => {
    expect(requestedConformanceFields(governed)).toEqual(['approvalPolicy', 'approvalsReviewer', 'sandbox']);
    expect(requestedConformanceFields({ ...governed, model: 'm' })).toEqual(['model', 'approvalPolicy', 'approvalsReviewer', 'sandbox']);
    expect(requestedConformanceFields({ ...governed, cwd: '/w' })).toEqual(['cwd', 'approvalPolicy', 'approvalsReviewer', 'sandbox']);
    expect(requestedConformanceFields({ ...governed, model: 'm', cwd: '/w' })).toEqual([
      'model',
      'cwd',
      'approvalPolicy',
      'approvalsReviewer',
      'sandbox',
    ]);
  });

  it('never adds a response-only key (modelProvider, serviceTier, reasoningEffort, cursors, thread) whatever q carries', () => {
    const q = { ...governed, modelProvider: 'x', serviceTier: 'x', reasoningEffort: 'x', thread: {}, instructionSources: [] };
    expect(requestedConformanceFields(q)).toEqual(['approvalPolicy', 'approvalsReviewer', 'sandbox']);
  });
});

describe('Layer D — NORMALIZATION_RULES (identity x4, sandbox mode projection)', () => {
  it('is exactly the sealed rule set', () => {
    expect(NORMALIZATION_RULES).toEqual({
      model: 'identity',
      cwd: 'identity_in_INV_PATH_domain',
      approvalPolicy: 'identity',
      approvalsReviewer: 'identity',
      sandbox: { 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite' },
    });
    expect(SANDBOX_MODE_PROJECTION).toEqual({ 'read-only': 'readOnly', 'workspace-write': 'workspaceWrite' });
    expect(Object.isFrozen(NORMALIZATION_RULES)).toBe(true);
  });

  it('projects the governed request domain exactly and refuses anything outside it (no alias, no folding, no trimming)', () => {
    expect(normalizeRequestedValue('sandbox', 'read-only')).toBe('readOnly');
    expect(normalizeRequestedValue('sandbox', 'workspace-write')).toBe('workspaceWrite');
    expect(normalizeRequestedValue('sandbox', 'danger-full-access')).toBeNull();
    expect(normalizeRequestedValue('sandbox', 'readOnly')).toBeNull();
    expect(normalizeRequestedValue('sandbox', 'Read-Only')).toBeNull();
    expect(normalizeRequestedValue('approvalPolicy', 'on-request')).toBe('on-request');
    expect(normalizeRequestedValue('approvalPolicy', 'never')).toBeNull();
    expect(normalizeRequestedValue('approvalsReviewer', 'user')).toBe('user');
    expect(normalizeRequestedValue('approvalsReviewer', 'auto_review')).toBeNull();
    expect(normalizeRequestedValue('model', ' m ')).toBe(' m ');
    expect(normalizeRequestedValue('cwd', '/w/')).toBe('/w/');
    expect(normalizeRequestedValue('cwd', '')).toBeNull();
    expect(normalizeRequestedValue('modelProvider', 'openai')).toBeNull();
  });
});
