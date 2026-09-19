// CONT-P5-A — GovAICodexExperimentalLockout (dispatch §2 guard/, §4): every inventory item refused outbound,
// experimentalApi never true, experimental notifications never delivered.

import { describe, expect, it } from 'vitest';

import { CODEX_EXPERIMENTAL_INVENTORY } from '../protocol/experimental-inventory.js';
import {
  assertOutboundRequestAllowed,
  carriesExperimentalVariant,
  classifyInboundNotification,
  CodexExperimentalLockoutViolation,
  experimentalParamFieldsOf,
  experimentalVariantPositionsOf,
  GovAICodexExperimentalLockout,
} from './experimental-lockout.js';

function lockout(method: string, params: unknown): CodexExperimentalLockoutViolation | null {
  try {
    assertOutboundRequestAllowed(method, params);
    return null;
  } catch (error) {
    if (error instanceof CodexExperimentalLockoutViolation) return error;
    throw error;
  }
}

const FROZEN_INITIALIZE = {
  clientInfo: { name: 'govai-cont-p5a-harness', title: 'GovAI CONT-P5-A inert foundation', version: '0.1.0' },
  capabilities: { experimentalApi: false, requestAttestation: false },
};

describe('initialize — experimentalApi is never true, never defaulted', () => {
  it('accepts only an explicit experimentalApi: false', () => {
    expect(lockout('initialize', FROZEN_INITIALIZE)).toBeNull();
    for (const capabilities of [
      { experimentalApi: true, requestAttestation: false },
      { requestAttestation: false },
      { experimentalApi: 'false', requestAttestation: false },
      { experimentalApi: 0, requestAttestation: false },
      null,
      undefined,
    ]) {
      const v = lockout('initialize', { ...FROZEN_INITIALIZE, capabilities });
      expect(v).toMatchObject({ rule: 'experimental_api_must_be_false', method: 'initialize', entry: null });
    }
    expect(lockout('initialize', undefined)).toMatchObject({ rule: 'experimental_api_must_be_false' });
  });
});

describe('outbound — every category (1) and (2) inventory item is refused', () => {
  it('refuses every experimental client METHOD', () => {
    const methods = CODEX_EXPERIMENTAL_INVENTORY.filter((e) => e.kind === 'method' && e.container === 'ClientRequest');
    expect(methods).toHaveLength(60);
    for (const e of methods) expect(lockout(e.wire, {})).toMatchObject({ rule: 'experimental_method', entry: e });
  });

  it('refuses every experimental params FIELD by presence, whatever its value (null included)', () => {
    let refused = 0;
    for (const e of CODEX_EXPERIMENTAL_INVENTORY.filter((x) => x.kind === 'field')) {
      for (const method of e.requestMethods) {
        for (const value of ['x', null, false, 0, [], {}]) {
          expect(lockout(method, { [e.wire]: value })).toMatchObject({ rule: 'experimental_param_key', entry: e });
          refused += 1;
        }
      }
    }
    // Every request-side field entry (all containers, all categories) was exercised.
    const requestSide = CODEX_EXPERIMENTAL_INVENTORY.filter((x) => x.kind === 'field').flatMap((x) => x.requestMethods);
    expect(refused).toBe(requestSide.length * 6);
    expect(requestSide.length).toBeGreaterThanOrEqual(31);
  });

  it('refuses category (2) askForApproval.granular at every derived position', () => {
    const granular = CODEX_EXPERIMENTAL_INVENTORY.find((e) => e.reason === 'askForApproval.granular')!;
    expect(granular.positions.map((p) => `${p.method}.${p.field}`)).toEqual([
      'thread/fork.approvalPolicy',
      'thread/resume.approvalPolicy',
      'thread/start.approvalPolicy',
      'turn/start.approvalPolicy',
    ]);
    const value = {
      granular: { sandbox_approval: true, rules: true, skill_approval: false, request_permissions: false, mcp_elicitations: true },
    };
    for (const p of granular.positions) {
      expect(lockout(p.method, { [p.field!]: value })).toMatchObject({ rule: 'experimental_variant', entry: granular });
      // The non-experimental spellings at the same position pass the LOCKOUT (policy is a separate gate).
      expect(lockout(p.method, { [p.field!]: 'on-request' })).toBeNull();
      expect(lockout(p.method, { [p.field!]: 'never' })).toBeNull();
    }
  });

  it('refuses every experimental variant at every position (tagged, root-level and nested)', () => {
    let checked = 0;
    for (const e of CODEX_EXPERIMENTAL_INVENTORY.filter((x) => x.kind === 'variant')) {
      for (const p of e.positions) {
        const representation = e.tag !== null ? { [e.tag]: e.wire } : { [e.wire]: {} };
        const params = p.field === null ? representation : { [p.field]: representation };
        expect(lockout(p.method, params)).toMatchObject({ rule: 'experimental_variant', entry: e });
        checked += 1;
      }
    }
    // granular × 4 positions + the three account/login/start LoginAccountParams arms at the params root.
    expect(checked).toBe(7);
    expect(lockout('account/login/start', { type: 'apiKey', apiKey: 'redacted' })).toBeNull();
  });

  it('passes clean covered requests untouched', () => {
    expect(lockout('thread/start', { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'read-only' })).toBeNull();
    expect(lockout('thread/fork', { threadId: 't', lastTurnId: 'u' })).toBeNull();
    expect(lockout('turn/steer', { threadId: 't', input: [], expectedTurnId: 'u' })).toBeNull();
    expect(lockout('thread/delete', { threadId: 't' })).toBeNull();
  });

  it('exposes its tables as derived from the inventory, not hand-maintained', () => {
    expect(experimentalParamFieldsOf('thread/fork').map((e) => e.wire).sort()).toEqual([
      'beforeTurnId',
      'deferGoalContinuation',
      'path',
      'permissions',
      'runtimeWorkspaceRoots',
    ]);
    expect(experimentalVariantPositionsOf('thread/start').map((x) => `${x.entry.reason}@${x.field}`)).toEqual([
      'askForApproval.granular@approvalPolicy',
    ]);
    expect(carriesExperimentalVariant({ granular: {} }, CODEX_EXPERIMENTAL_INVENTORY.find((e) => e.wire === 'granular')!)).toBe(true);
    expect(Object.keys(GovAICodexExperimentalLockout).sort()).toEqual([
      'assertOutboundRequestAllowed',
      'carriesExperimentalVariant',
      'classifyInboundNotification',
      'experimentalParamFieldsOf',
      'experimentalVariantPositionsOf',
    ]);
  });
});

describe('inbound — experimental notifications are rejected, never delivered', () => {
  it('rejects all 22 category (2) server notification methods and delivers the rest', () => {
    const experimental = CODEX_EXPERIMENTAL_INVENTORY.filter((e) => e.kind === 'method' && e.container === 'ServerNotification');
    expect(experimental).toHaveLength(22);
    for (const e of experimental) {
      expect(classifyInboundNotification(e.wire)).toEqual({ verdict: 'reject_experimental', entry: e });
    }
    for (const method of ['thread/started', 'thread/status/changed', 'thread/deleted', 'remoteControl/status/changed']) {
      expect(classifyInboundNotification(method)).toEqual({ verdict: 'deliver' });
    }
  });
});
