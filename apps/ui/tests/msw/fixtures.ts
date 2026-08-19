// Recorded-shape fixtures for the four U1 endpoints.
//
// Every field and every literal below comes from the CURRENT backend source, not from a plan
// document — see apps/api/src/routes/{evidence,audit-events,capabilities}.ts,
// apps/api/src/pipeline/evidence-reports.ts and packages/core-governance/src/registry.ts.
// In particular EC6_NOTE and EC3_DROP_BOUND are the backend's literal strings, so a test that
// asserts they are rendered verbatim actually asserts something.

export const ORG_ID = '2f0c1e4c-4a51-4d2e-9d6f-2a1f0b0e7d31';

/** evidence-reports.ts:466-469 — the literal EC6_NOTE. */
export const EC6_NOTE =
  'no persisted chain-verification status at this build (192161dd): verify.ts runs on-demand ' +
  'and is not persisted, and EP-008D does not re-run the KMS-keyed verification inline nor add a ' +
  'DB object — chains are surfaced as pending until a verifier-persistence surface lands';

/** evidence-reports.ts:431-433 — the literal EC3_DROP_BOUND. */
export const EC3_DROP_BOUND =
  'native capture loss in aggregate — includes, does not isolate, streams-without-terminal; ' +
  'covers received-then-dropped, not never-emitted';

export const EC6_EXCLUSION_REASON =
  'no persisted verification at this base — pending, not uncovered';
export const EC3DROP_EXCLUSION_REASON =
  'no in-process drop observations (the OTLP collector holds the authoritative signal)';

export const UNOBSERVED_DROP = {
  invariant: 'ec3drop' as const,
  label: 'EC-3 — native (drop)',
  drops: 0,
  captures: 0,
  drop_rate: null,
  observed: false,
  bound: EC3_DROP_BOUND,
};

/** A summary with a real population and real gaps — the everyday case. */
export const SUMMARY_WITH_GAPS = {
  org_id: ORG_ID,
  window_seconds: 86_400,
  t_seal_seconds: 300,
  counts: {
    ec1: { total: 1543, sealed: 1520, failed: 2, stalled_past_slo: 3 },
    ec2: { chains: 12, chains_with_gap: 1 },
    ec3seal: { native_total: 900, native_sealed: 895, native_unsealed_past_slo: 5 },
    ec4: { provider_invocations: 40, without_terminal: 1 },
    ec6: { chains: 4, verified_ok: 0, pending: 4 },
  },
  ec3drop: UNOBSERVED_DROP,
  ec6: {
    invariant: 'ec6' as const,
    label: 'EC-6 — chain integrity',
    total_chains: 4,
    verified_ok: 0,
    pending: 4,
    last_verified_at: null,
    note: EC6_NOTE,
  },
  coverage_ratio: {
    label: 'coverage_ratio',
    ratio: 0.9928,
    covered: 2483,
    total: 2501,
    terms: [
      { invariant: 'ec1', covered: 1538, total: 1543 },
      { invariant: 'ec2', covered: 11, total: 12 },
      { invariant: 'ec3seal', covered: 895, total: 900 },
      { invariant: 'ec4', covered: 39, total: 40 },
    ],
    excluded: [
      { invariant: 'ec6', reason: EC6_EXCLUSION_REASON },
      { invariant: 'ec3drop', reason: EC3DROP_EXCLUSION_REASON },
    ],
  },
};

/** An organization with no traffic in the window: every count zero and the ratio 1.0 by an
 *  EMPTY population. This is the case a careless UI renders as a green all-clear. */
export const SUMMARY_EMPTY = {
  ...SUMMARY_WITH_GAPS,
  counts: {
    ec1: { total: 0, sealed: 0, failed: 0, stalled_past_slo: 0 },
    ec2: { chains: 0, chains_with_gap: 0 },
    ec3seal: { native_total: 0, native_sealed: 0, native_unsealed_past_slo: 0 },
    ec4: { provider_invocations: 0, without_terminal: 0 },
    ec6: { chains: 0, verified_ok: 0, pending: 0 },
  },
  ec6: {
    invariant: 'ec6' as const,
    label: 'EC-6 — chain integrity',
    total_chains: 0,
    verified_ok: 0,
    pending: 0,
    last_verified_at: null,
    note: EC6_NOTE,
  },
  coverage_ratio: {
    label: 'coverage_ratio',
    ratio: 1,
    covered: 0,
    total: 0,
    terms: [
      { invariant: 'ec1', covered: 0, total: 0 },
      { invariant: 'ec2', covered: 0, total: 0 },
      { invariant: 'ec3seal', covered: 0, total: 0 },
      { invariant: 'ec4', covered: 0, total: 0 },
    ],
    excluded: [
      { invariant: 'ec6', reason: EC6_EXCLUSION_REASON },
      { invariant: 'ec3drop', reason: EC3DROP_EXCLUSION_REASON },
    ],
  },
};

/** A perfectly covered window — the only shape in which a term may render green. */
export const SUMMARY_FULLY_COVERED = {
  ...SUMMARY_WITH_GAPS,
  counts: {
    ec1: { total: 10, sealed: 10, failed: 0, stalled_past_slo: 0 },
    ec2: { chains: 2, chains_with_gap: 0 },
    ec3seal: { native_total: 10, native_sealed: 10, native_unsealed_past_slo: 0 },
    ec4: { provider_invocations: 5, without_terminal: 0 },
    ec6: { chains: 2, verified_ok: 0, pending: 2 },
  },
  coverage_ratio: {
    label: 'coverage_ratio',
    ratio: 1,
    covered: 27,
    total: 27,
    terms: [
      { invariant: 'ec1', covered: 10, total: 10 },
      { invariant: 'ec2', covered: 2, total: 2 },
      { invariant: 'ec3seal', covered: 10, total: 10 },
      { invariant: 'ec4', covered: 5, total: 5 },
    ],
    excluded: [
      { invariant: 'ec6', reason: EC6_EXCLUSION_REASON },
      { invariant: 'ec3drop', reason: EC3DROP_EXCLUSION_REASON },
    ],
  },
};

/** A live window whose captures are all still in flight: nothing failed, nothing late — and
 *  nothing sealed. The state a naive "no problems" rule would paint green. */
export const SUMMARY_ALL_IN_FLIGHT = {
  ...SUMMARY_WITH_GAPS,
  counts: {
    ec1: { total: 5, sealed: 0, failed: 0, stalled_past_slo: 0 },
    ec2: { chains: 1, chains_with_gap: 0 },
    ec3seal: { native_total: 5, native_sealed: 0, native_unsealed_past_slo: 0 },
    ec4: { provider_invocations: 0, without_terminal: 0 },
    ec6: { chains: 1, verified_ok: 0, pending: 1 },
  },
  coverage_ratio: {
    label: 'coverage_ratio',
    ratio: 1,
    covered: 6,
    total: 6,
    terms: [
      { invariant: 'ec1', covered: 5, total: 5 },
      { invariant: 'ec2', covered: 1, total: 1 },
      { invariant: 'ec3seal', covered: 5, total: 5 },
      { invariant: 'ec4', covered: 0, total: 0 },
    ],
    excluded: [
      { invariant: 'ec6', reason: EC6_EXCLUSION_REASON },
      { invariant: 'ec3drop', reason: EC3DROP_EXCLUSION_REASON },
    ],
  },
};

export const EC1_ROWS = [
  {
    capture_id: '8b0c9a1e-1f3d-4c2b-9a77-0d1e2f3a4b5c',
    chain_id: `org:${ORG_ID}:run:1a2b3c`,
    chain_category: 'run',
    status: 'failed',
    captured_at: '2026-08-19T11:02:03.000Z',
    attempts: 5,
    last_error: 'network_error: upstream reset while sealing',
  },
  {
    capture_id: '2c1d0b9a-8e7f-4a6b-9c5d-4e3f2a1b0c9d',
    chain_id: `org:${ORG_ID}:run:4d5e6f`,
    chain_category: 'run',
    status: 'sealing',
    captured_at: '2026-08-19T10:55:00.000Z',
    attempts: 1,
    last_error: null,
  },
];

/** ★ first_gap_seq exceeds Number.MAX_SAFE_INTEGER (2^53−1 = 9007199254740991). Rendering it
 *  through Number() would print 9007199254740992 and point an auditor at the wrong event. */
export const EC2_ROWS = [
  {
    chain_id: `org:${ORG_ID}:run:huge`,
    first_gap_seq: '9007199254740993',
    gap_count: '18446744073709551615',
  },
  { chain_id: `org:${ORG_ID}:policy:small`, first_gap_seq: '42', gap_count: '3' },
];

export const EC3SEAL_ROWS = [
  {
    capture_id: '7f6e5d4c-3b2a-4190-8877-665544332211',
    chain_id: `org:${ORG_ID}:run:aabbcc`,
    chain_category: 'run',
    status: 'captured',
    captured_at: '2026-08-19T09:00:00.000Z',
  },
];

export const EC4_ROWS = [
  {
    run_id: 'd1e2f3a4-b5c6-4d7e-8f90-1a2b3c4d5e6f',
    provider_invocation_id: 'aa11bb22-cc33-4d44-8e55-ff6677889900',
    provider: 'anthropic',
    native_endpoint: '/v1/messages',
    status_code: 200,
    error_class: null,
    created_at: '2026-08-19T08:30:00.000Z',
  },
  {
    run_id: 'e2f3a4b5-c6d7-4e8f-9012-3a4b5c6d7e8f',
    provider_invocation_id: 'bb22cc33-dd44-4e55-8f66-001122334455',
    provider: 'openai',
    native_endpoint: '/v1/responses',
    status_code: null,
    error_class: 'timeout',
    created_at: '2026-08-19T08:20:00.000Z',
  },
];

const H = (c: string) => c.repeat(64);

export const RUN_CHAIN_ID = `org:${ORG_ID}:run`;

export function auditEvent(seq: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    chain_id: RUN_CHAIN_ID,
    sequence_number: seq,
    event_type: 'passthrough.invoked',
    event_version: '4',
    subject_type: 'runtime_event',
    subject_id: `11111111-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    occurred_at: '2026-08-19T12:00:00.000Z',
    payload_hash: H('a'),
    previous_hmac: seq === 1 ? null : H('b'),
    hmac: H('c'),
    canonical_hash: H('d'),
    evidence_strength: 'hmac_internal',
    key_id: 'audit-1',
    key_version: 1,
    ...overrides,
  };
}

/** The registry this route actually serves (packages/core-governance/src/registry.ts): two
 *  `planned` tool capabilities, `hmac_internal` on the level-3 facets, and null optional
 *  fields — plus one facet carrying an org override so the effective-vs-baseline distinction
 *  is exercised with a real downgrade. */
export const CAPABILITIES = {
  org_id: ORG_ID,
  capabilities: [
    {
      id: 'anthropic.messages.create',
      provider: 'anthropic',
      status: 'supported',
      baseline_status: 'supported',
      facets: [
        {
          id: 'pre_dlp',
          level: 2,
          status: 'supported',
          baseline_status: 'supported',
          evidence_strength: null,
          reason: null,
          last_live_test_at: null,
          docs_url: null,
          override_applied: false,
        },
        {
          id: 'final_hash',
          level: 3,
          status: 'supported',
          baseline_status: 'supported',
          evidence_strength: 'hmac_internal',
          reason: null,
          last_live_test_at: '2026-08-17T00:00:00.000Z',
          docs_url: 'https://example.invalid/docs/final-hash',
          override_applied: false,
        },
      ],
    },
    {
      id: 'anthropic.messages.tools',
      provider: 'anthropic',
      status: 'planned',
      baseline_status: 'planned',
      facets: [
        {
          id: 'tool_call_audit',
          level: 2,
          status: 'planned',
          baseline_status: 'planned',
          evidence_strength: null,
          reason: null,
          last_live_test_at: null,
          docs_url: null,
          override_applied: false,
        },
      ],
    },
    {
      id: 'openai.responses.create',
      provider: 'openai',
      status: 'blocked',
      baseline_status: 'supported',
      facets: [
        {
          id: 'pre_dlp',
          level: 0,
          status: 'blocked',
          baseline_status: 'supported',
          evidence_strength: null,
          reason: null,
          last_live_test_at: null,
          docs_url: null,
          override_applied: true,
        },
        {
          id: 'final_hash',
          level: 3,
          status: 'supported',
          baseline_status: 'supported',
          evidence_strength: 'hmac_internal',
          reason: null,
          last_live_test_at: null,
          docs_url: null,
          override_applied: false,
        },
      ],
    },
  ],
};
