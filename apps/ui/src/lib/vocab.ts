// The single status vocabulary. Every badge in the application resolves (domain, value)
// through this table; a screen may not invent a label or a colour for a status value.
//
// Two rules make it safe:
//   1. An UNRECOGNISED value never resolves to `ok`. It resolves to a neutral badge that says
//      the value was not recognised and renders the raw value verbatim, so a future backend
//      enum member shows up as an obvious unknown rather than as a reassuring green.
//   2. `ok` is reserved for facts the backend actually asserts (sealed, supported).
//      "No problem reported" is not `ok`.

import type { MessageKey } from './i18n/catalogs/index.js';

/** The semantic tones from the design system (see src/styles/tokens.css). */
export type Tone = 'ok' | 'attention' | 'failure' | 'neutral' | 'info';

export type VocabEntry = { messageKey: MessageKey; tone: Tone };

/** The status domains U1 actually renders. */
export type VocabDomain =
  | 'capture'
  | 'capability'
  | 'evidenceStrength'
  | 'chainCategory'
  | 'principalType';

/** `govai.audit_capture_outbox.status` — the EC-1 / EC-3.seal row status.
 *  `sealed` is the only sealed-fact value, so it is the only `ok`. `captured`/`sealing` are
 *  in flight (info), and a row is only a gap because it is failed or past T_seal — which the
 *  row-level tone cannot know, so the tone here describes the STATUS, not the verdict. */
const CAPTURE: Record<string, VocabEntry> = {
  captured: { messageKey: 'status.capture.captured', tone: 'info' },
  sealing: { messageKey: 'status.capture.sealing', tone: 'info' },
  sealed: { messageKey: 'status.capture.sealed', tone: 'ok' },
  failed: { messageKey: 'status.capture.failed', tone: 'failure' },
};

/** `CapabilityStatus` (packages/core-governance/src/capability.ts:3).
 *  `planned` is amber, never green: a planned capability is registered, not available. */
const CAPABILITY: Record<string, VocabEntry> = {
  supported: { messageKey: 'status.capability.supported', tone: 'ok' },
  planned: { messageKey: 'status.capability.planned', tone: 'attention' },
  blocked: { messageKey: 'status.capability.blocked', tone: 'failure' },
  experimental: { messageKey: 'status.capability.experimental', tone: 'attention' },
};

/** `EvidenceStrengthSchema` (capability.ts:6-12). Every member is NEUTRAL on purpose:
 *  evidence strength is a description of the signing mechanism, not a grade and never a
 *  certification (ADR-005 — the strong members are themselves planned in the baseline).
 *  Colouring `icp_brasil_tsa` green would read as "certified". It is not. */
const EVIDENCE_STRENGTH: Record<string, VocabEntry> = {
  hmac_internal: { messageKey: 'status.evidenceStrength.hmac_internal', tone: 'neutral' },
  dev_signed: { messageKey: 'status.evidenceStrength.dev_signed', tone: 'neutral' },
  external_anchor: { messageKey: 'status.evidenceStrength.external_anchor', tone: 'neutral' },
  customer_signed: { messageKey: 'status.evidenceStrength.customer_signed', tone: 'neutral' },
  icp_brasil_tsa: { messageKey: 'status.evidenceStrength.icp_brasil_tsa', tone: 'neutral' },
};

/** `chain_category` (apps/api/src/routes/audit-events.ts:8). Pure classification — neutral. */
const CHAIN_CATEGORY: Record<string, VocabEntry> = {
  auth: { messageKey: 'status.chainCategory.auth', tone: 'neutral' },
  run: { messageKey: 'status.chainCategory.run', tone: 'neutral' },
  policy: { messageKey: 'status.chainCategory.policy', tone: 'neutral' },
  admin: { messageKey: 'status.chainCategory.admin', tone: 'neutral' },
};

/** `principal_type` (apps/api/src/routes/me.ts). NEUTRAL, and the one domain whose UNKNOWN
 *  branch is a product-safety control rather than a cosmetic fallback: the label attached to
 *  `api_key` states that this is a controlled-pilot credential and not a human login, so a
 *  principal type this build has never seen must NOT inherit that wording. It falls through
 *  to `status.unknown` with the raw value rendered verbatim — the reader is told the API said
 *  something this interface does not recognise, which is the truth. */
const PRINCIPAL_TYPE: Record<string, VocabEntry> = {
  api_key: { messageKey: 'status.principalType.api_key', tone: 'neutral' },
};

const TABLES: Record<VocabDomain, Record<string, VocabEntry>> = {
  capture: CAPTURE,
  capability: CAPABILITY,
  evidenceStrength: EVIDENCE_STRENGTH,
  chainCategory: CHAIN_CATEGORY,
  principalType: PRINCIPAL_TYPE,
};

export type ResolvedStatus = VocabEntry & {
  /** The raw backend value, always rendered alongside the label so the technical value is
   *  never hidden behind a translation. */
  raw: string;
  /** True when the value is not in the table for this domain. */
  unknown: boolean;
};

export function resolveStatus(domain: VocabDomain, value: string): ResolvedStatus {
  const entry = TABLES[domain][value];
  if (entry) return { ...entry, raw: value, unknown: false };
  return { messageKey: 'status.unknown', tone: 'neutral', raw: value, unknown: true };
}

/** Exposed for the table-driven tests: the exact value set each domain recognises. */
export function knownValues(domain: VocabDomain): string[] {
  return Object.keys(TABLES[domain]);
}
