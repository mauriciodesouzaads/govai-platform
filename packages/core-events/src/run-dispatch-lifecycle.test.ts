// Smoke tests for the run dispatch lifecycle event schemas v1 (EP-P03A-A / F3).

import { describe, it, expect } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import {
  DispatchErrorClass,
  RunDispatchPreparedSchema,
  RunDispatchClaimedSchema,
  RunOutcomeUnknownSchema,
  RunOutcomeReconciledSchema,
} from './run-dispatch-lifecycle.js';

const hex64 = (s: string) => createHash('sha256').update(s).digest('hex');

function prepared(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'run.dispatch_prepared',
    schema_version: 1,
    org_id: randomUUID(),
    run_id: randomUUID(),
    mode: 'governed',
    provider: 'anthropic',
    capability_id: 'anthropic.messages.create',
    model: 'claude-fixture-1',
    native_request_hash: hex64('body'),
    occurred_at: new Date().toISOString(),
    chain_category: 'run',
    ...overrides,
  };
}

function claimed(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date();
  return {
    event_type: 'run.dispatch_claimed',
    schema_version: 1,
    org_id: randomUUID(),
    run_id: randomUUID(),
    dispatch_token: randomUUID(),
    dispatch_timeout_ms: 300_000,
    dispatch_claimed_at: now.toISOString(),
    dispatch_deadline_at: new Date(now.getTime() + 300_000).toISOString(),
    occurred_at: now.toISOString(),
    chain_category: 'run',
    ...overrides,
  };
}

function unknown(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'run.outcome_unknown',
    schema_version: 1,
    org_id: randomUUID(),
    run_id: randomUUID(),
    dispatch_token: randomUUID(),
    dispatch_error_class: 'provider_timeout',
    forward_started: true,
    outcome_unknown_at: new Date().toISOString(),
    occurred_at: new Date().toISOString(),
    chain_category: 'run',
    ...overrides,
  };
}

function reconciled(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    event_type: 'run.outcome_reconciled',
    schema_version: 1,
    org_id: randomUUID(),
    run_id: randomUUID(),
    previous_status: 'outcome_unknown',
    final_status: 'completed',
    dispatch_token: randomUUID(),
    provider_invocation_id: randomUUID(),
    native_request_hash: hex64('req'),
    native_response_hash: hex64('res'),
    occurred_at: new Date().toISOString(),
    chain_category: 'run',
    ...overrides,
  };
}

describe('RunDispatchPreparedSchema v1', () => {
  it('canonical event accepts', () => {
    expect(RunDispatchPreparedSchema.safeParse(prepared()).success).toBe(true);
  });
  it('passthrough with approval + workroom accepts', () => {
    expect(
      RunDispatchPreparedSchema.safeParse(
        prepared({ mode: 'passthrough', approval_request_id: randomUUID(), workroom_id: randomUUID() }),
      ).success,
    ).toBe(true);
  });
  it('shadow mode → rejects', () => {
    expect(RunDispatchPreparedSchema.safeParse(prepared({ mode: 'shadow' })).success).toBe(false);
  });
  it('non-hex request hash → rejects', () => {
    expect(
      RunDispatchPreparedSchema.safeParse(prepared({ native_request_hash: 'not-hex' })).success,
    ).toBe(false);
  });
  it('schema_version other than 1 → rejects', () => {
    expect(RunDispatchPreparedSchema.safeParse(prepared({ schema_version: 2 })).success).toBe(false);
  });
});

describe('RunDispatchClaimedSchema v1', () => {
  it('canonical event accepts', () => {
    expect(RunDispatchClaimedSchema.safeParse(claimed()).success).toBe(true);
  });
  it('timeout below 1000ms → rejects', () => {
    expect(RunDispatchClaimedSchema.safeParse(claimed({ dispatch_timeout_ms: 999 })).success).toBe(
      false,
    );
  });
  it('timeout above 900000ms → rejects', () => {
    expect(
      RunDispatchClaimedSchema.safeParse(claimed({ dispatch_timeout_ms: 900_001 })).success,
    ).toBe(false);
  });
  it('non-uuid token → rejects', () => {
    expect(RunDispatchClaimedSchema.safeParse(claimed({ dispatch_token: 'tok' })).success).toBe(
      false,
    );
  });
});

describe('RunOutcomeUnknownSchema v1', () => {
  it('canonical event accepts', () => {
    expect(RunOutcomeUnknownSchema.safeParse(unknown()).success).toBe(true);
  });
  it('recovery stale claim (forward_started=false) accepts', () => {
    expect(
      RunOutcomeUnknownSchema.safeParse(
        unknown({ dispatch_error_class: 'stale_dispatch_claim', forward_started: false }),
      ).success,
    ).toBe(true);
  });
  it('free-text error class → rejects (closed enum)', () => {
    expect(
      RunOutcomeUnknownSchema.safeParse(unknown({ dispatch_error_class: 'ECONNRESET: raw' }))
        .success,
    ).toBe(false);
  });
});

describe('RunOutcomeReconciledSchema v1', () => {
  it('canonical completed reconciliation accepts', () => {
    expect(RunOutcomeReconciledSchema.safeParse(reconciled()).success).toBe(true);
  });
  it('failed reconciliation without response hash accepts', () => {
    const e = reconciled({ final_status: 'failed' });
    delete (e as Record<string, unknown>)['native_response_hash'];
    expect(RunOutcomeReconciledSchema.safeParse(e).success).toBe(true);
  });
  it('previous_status other than outcome_unknown → rejects', () => {
    expect(
      RunOutcomeReconciledSchema.safeParse(reconciled({ previous_status: 'running' })).success,
    ).toBe(false);
  });
  it('final_status outcome_unknown → rejects', () => {
    expect(
      RunOutcomeReconciledSchema.safeParse(reconciled({ final_status: 'outcome_unknown' })).success,
    ).toBe(false);
  });
});

describe('DispatchErrorClass', () => {
  it('is a closed set of safe codes', () => {
    expect(DispatchErrorClass.options).toEqual([
      'dispatch_preclaim_failed',
      'dispatch_never_claimed',
      'stale_dispatch_claim',
      'dispatch_pre_forward_failed',
      'provider_timeout',
      'provider_io_unknown',
    ]);
  });
});
