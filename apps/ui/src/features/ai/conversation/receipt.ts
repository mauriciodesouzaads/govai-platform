// Reading facts off a provider response — the only place the receipt's values come from.
//
// Pure functions over `Headers` and already-parsed bodies, so the honesty rules are testable
// without driving a request. Nothing here derives, infers or defaults a governance value: a
// header that is absent produces null, and null renders as "not exposed in this response".

import { ENFORCEMENT_DECISIONS, type BlockTrigger, type EnforcementDecision } from '../../../lib/honesty.js';
import type { GovernanceFacts } from './types.js';
import type { ConsoleMode, ProviderAdapter } from '../providers/types.js';

/**
 * The provider's request id, by that provider's own header precedence.
 *
 * Returns null when the response carried none — which the receipt renders as an explicit
 * "not exposed in this response" rather than as an empty field that looks like a bug. The id
 * is NEVER scraped out of a response body or a stream payload: a value that is not in the
 * header the provider documents is not the provider's request id.
 */
export function readProviderRequestId(
  headers: Headers,
  adapter: Pick<ProviderAdapter, 'requestIdHeaders'>,
): string | null {
  for (const name of adapter.requestIdHeaders) {
    const value = headers.get(name);
    if (value !== null && value.trim().length > 0) return value.trim();
  }
  return null;
}

/** Narrow a raw `x-govai-enforcement-decision` value to the normative vocabulary. */
export function parseEnforcementDecision(raw: string | null): EnforcementDecision | null {
  if (raw === null) return null;
  const value = raw.trim();
  return (ENFORCEMENT_DECISIONS as readonly string[]).includes(value)
    ? (value as EnforcementDecision)
    : null;
}

/** Narrow a raw `x-govai-enforcement-applied` value. Only two values exist at source. */
export function parseEnforcementApplied(raw: string | null): 'forwarded' | 'blocked' | null {
  const value = raw?.trim();
  if (value === 'forwarded' || value === 'blocked') return value;
  return null;
}

/** `block_trigger` from a governed 403 body. */
export function parseBlockTrigger(body: unknown): BlockTrigger | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)['block_trigger'];
  return value === 'tool_validation' || value === 'governance_enforcement' ? value : null;
}

/**
 * Governance facts for a response.
 *
 * ★ RETURNS NULL FOR THE NATIVE/AUDITED ROUTE, ALWAYS. That surface resolves no per-request
 * enforcement and sets none of these headers; the console knows what its own internals record
 * there (`enforcement_decision: 'observe'`, in an audit event the browser never sees), and
 * printing that from implementation knowledge would be fabricating a response fact. The
 * receipt states the mode and says the surface exposes no per-request governance — which is
 * what actually happened.
 *
 * On the governed route the four headers are read verbatim, including a decision value this
 * build does not recognise: the raw string is kept so an unknown value shows up as an unknown
 * value rather than as silence.
 */
export function readGovernanceFacts(
  mode: ConsoleMode,
  headers: Headers,
  body: unknown,
): GovernanceFacts | null {
  if (mode !== 'governed') return null;

  const decisionRaw = headers.get('x-govai-enforcement-decision');
  const appliedRaw = headers.get('x-govai-enforcement-applied');
  const capabilityLevel = headers.get('x-govai-capability-level');
  const effectiveRiskClass = headers.get('x-govai-effective-risk-class');

  // A governed response that set none of them is a fact too — report nothing rather than
  // an object full of nulls that reads like a failed parse.
  if (
    decisionRaw === null &&
    appliedRaw === null &&
    capabilityLevel === null &&
    effectiveRiskClass === null
  ) {
    return null;
  }

  return {
    capabilityLevel: nonEmpty(capabilityLevel),
    effectiveRiskClass: nonEmpty(effectiveRiskClass),
    decisionRaw: nonEmpty(decisionRaw),
    decision: parseEnforcementDecision(decisionRaw),
    appliedRaw: nonEmpty(appliedRaw),
    applied: parseEnforcementApplied(appliedRaw),
    blockTrigger: parseBlockTrigger(body),
  };
}

function nonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** `Retry-After`, in seconds, when the server sent a usable one. */
export function readRetryAfterSeconds(headers: Headers): number | null {
  const raw = headers.get('retry-after');
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}
