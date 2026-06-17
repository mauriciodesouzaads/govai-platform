import { describe, it, expect } from 'vitest';

import { uuidv5 } from './uuidv5.js';

// SPEC-01 §5(c) / RR-000 A3 independence rule: every expected value below is a
// PRECOMPUTED constant produced by an INDEPENDENT RFC 4122 reference
// (Python 3 `uuid.uuid5`), NOT by calling the implementation under test. The
// test asserts our `uuidv5()` reproduces these externally-sourced constants, so
// a regression in our implementation cannot silently "define correct".

// (a) RFC 4122 §4.3 canonical vector — DNS namespace + "www.example.com".
const RFC_DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const RFC_VECTOR = '2ed6657d-e927-568b-95e1-2665a8aea6a2';

// (b)+(c) captureId name→uuid vectors under the PINNED AuditBridge namespace
// (audit-bridge.ts AUDIT_BRIDGE_CAPTURE_NAMESPACE_UUID). Names mirror ADR-028 §4.
// Expected values precomputed via `python3 -c "import uuid; uuid.uuid5(...)"`.
const NS = '2ce65cb8-4e28-42e2-b7cd-0be36d6e6f7b';
const VECTORS: ReadonlyArray<{ readonly name: string; readonly expected: string }> = [
  {
    name: 'org:11111111-1111-1111-1111-111111111111:provider:anthropic:capability:anthropic.messages.create:method:POST:endpoint:/passthrough/anthropic/v1/messages:idempotency:0000000000000000000000000000000000000000000000000000000000000000',
    expected: '581882d0-ab1b-5623-b841-891b3005d929',
  },
  {
    name: 'org:11111111-1111-1111-1111-111111111111:provider:anthropic:capability:anthropic.messages.create:method:POST:endpoint:/passthrough/anthropic/v1/messages:request:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    expected: '308da174-0eb9-51d7-8e7a-0ee03651aae6',
  },
  {
    name: 'org:22222222-2222-2222-2222-222222222222:provider:openai:capability:openai.responses.create:method:POST:endpoint:/passthrough/openai/v1/responses:idempotency:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    expected: '6bddb7a9-f010-5b23-bc14-223ec87d45de',
  },
  {
    name: 'org:22222222-2222-2222-2222-222222222222:provider:openai:capability:openai.responses.create:method:POST:endpoint:/passthrough/openai/v1/responses:request:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    expected: '594c5ed2-cb79-5eee-965d-b9a26fa7060a',
  },
  {
    name: 'org:33333333-3333-3333-3333-333333333333:provider:anthropic:capability:anthropic.messages.create:method:POST:endpoint:/governed/anthropic/v1/messages:idempotency:1111111111111111111111111111111111111111111111111111111111111111',
    expected: '698ae3f5-d833-56f5-bd1e-35def4b9d82c',
  },
  {
    name: 'org:33333333-3333-3333-3333-333333333333:provider:anthropic:capability:anthropic.messages.create:method:POST:endpoint:/governed/anthropic/v1/messages:request:cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    expected: '7f50f320-7621-5a50-abee-01c73a627a19',
  },
];

describe('uuidv5 (RFC 4122 §4.3)', () => {
  it('(a) reproduces the canonical RFC DNS vector for "www.example.com"', () => {
    expect(uuidv5(RFC_DNS_NAMESPACE, 'www.example.com')).toBe(RFC_VECTOR);
  });

  it('(b) sets version 5 and the RFC 4122 variant bits', () => {
    const u = uuidv5(RFC_DNS_NAMESPACE, 'www.example.com');
    expect(u[14]).toBe('5'); // version nibble
    expect(['8', '9', 'a', 'b']).toContain(u[19]); // variant nibble (10xx)
  });

  it('(c) reproduces the 6 namespace-pinned captureId vectors (independent Python reference)', () => {
    for (const v of VECTORS) {
      expect(uuidv5(NS, v.name)).toBe(v.expected);
    }
  });

  it('is deterministic and namespace-sensitive', () => {
    expect(uuidv5(NS, 'x')).toBe(uuidv5(NS, 'x'));
    expect(uuidv5(NS, 'x')).not.toBe(uuidv5(RFC_DNS_NAMESPACE, 'x'));
  });

  it('rejects a non-UUID namespace', () => {
    expect(() => uuidv5('not-a-uuid', 'x')).toThrow(/namespace/);
  });
});
