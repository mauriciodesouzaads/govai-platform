import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  CAPABILITIES,
  EC1_ROWS,
  ME_PRINCIPAL,
  EC2_ROWS,
  EC3SEAL_ROWS,
  EC4_ROWS,
  ORG_ID,
  SUMMARY_WITH_GAPS,
  UNOBSERVED_DROP,
  auditEvent,
  RUN_CHAIN_ID,
} from './fixtures.js';

// The default handlers model the real API closely enough that a test which passes here would
// pass against the running service: the same auth header, the same envelopes, the same
// pagination rules. Individual tests override a handler when they need a specific response.

/** The key every default handler accepts. Anything else is answered exactly like the real
 *  routes answer a bad credential: 401 `{error:'auth_error', message}`. */
export const VALID_KEY = 'govai_sk_AAAtest-key-value-0123456789';

function requireKey(request: Request): Response | null {
  const header = request.headers.get('x-govai-api-key');
  const bearer = request.headers.get('authorization');
  const key = header ?? (bearer?.startsWith('Bearer ') ? bearer.slice(7) : null);
  if (key === VALID_KEY) return null;
  return HttpResponse.json({ error: 'auth_error', message: 'invalid api key' }, { status: 401 });
}

const GAP_ROWS: Record<string, unknown[]> = {
  ec1: EC1_ROWS,
  ec2: EC2_ROWS,
  ec3seal: EC3SEAL_ROWS,
  ec4: EC4_ROWS,
  ec3drop: [UNOBSERVED_DROP],
};

export const handlers = [
  // The sign-in probe (EP-B2). Every authenticated render goes through it, so it is first.
  http.get('*/v1/me', ({ request }) => {
    const denied = requireKey(request);
    if (denied) return denied;
    return HttpResponse.json(ME_PRINCIPAL);
  }),

  http.get('*/v1/evidence/summary', ({ request }) => {
    const denied = requireKey(request);
    if (denied) return denied;
    const window = new URL(request.url).searchParams.get('window');
    return HttpResponse.json({
      ...SUMMARY_WITH_GAPS,
      window_seconds: window ? Number(window) : SUMMARY_WITH_GAPS.window_seconds,
    });
  }),

  http.get('*/v1/evidence/gaps', ({ request }) => {
    const denied = requireKey(request);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const invariant = params.get('invariant') ?? 'ec1';
    const cursor = Number(params.get('cursor') ?? '0');
    const limit = Number(params.get('limit') ?? '100');
    // Page 0 only, mirroring the real rule: next_cursor is non-null only while a page came
    // back full, and the ec3drop singleton is never paginable.
    const items = cursor === 0 ? (GAP_ROWS[invariant] ?? []) : [];
    return HttpResponse.json({
      org_id: ORG_ID,
      invariant,
      window_seconds: Number(params.get('window') ?? '86400'),
      items,
      next_cursor: invariant === 'ec3drop' ? null : items.length === limit ? cursor + limit : null,
    });
  }),

  http.get('*/v1/audit-events', ({ request }) => {
    const denied = requireKey(request);
    if (denied) return denied;
    const params = new URL(request.url).searchParams;
    const limit = Number(params.get('limit') ?? '50');
    const beforeSeq = params.get('before_seq');
    // Descending sequence, strict `<` on before_seq — the real keyset contract.
    const highest = beforeSeq === null ? 5 : Number(beforeSeq) - 1;
    const events = [];
    for (let seq = highest; seq >= 1 && events.length < limit; seq -= 1) {
      events.push(auditEvent(seq));
    }
    return HttpResponse.json({ chain_id: `${RUN_CHAIN_ID}:${params.get('chain_category')}`, events });
  }),

  http.get('*/v1/capabilities', ({ request }) => {
    const denied = requireKey(request);
    if (denied) return denied;
    return HttpResponse.json(CAPABILITIES);
  }),
];

export const server = setupServer(...handlers);
