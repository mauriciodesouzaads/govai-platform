// CONT-P5-A — GovAICodexExperimentalLockout (dispatch §2 guard/, §4 invariants).
//
// PURE. Every OUTBOUND client request passes this lockout before a byte is written — inside the mandatory GovAI
// outbound policy primitive (`enforceGovAICodexOutboundPolicy`, ../protocol/govai-policy.ts), which applies it to
// the caller's params and again to its own reconstruction — and it gives the verdict on every INBOUND
// notification before it reaches a typed handler. Its tables are the source-derived inventory
// (../protocol/experimental-inventory.ts) — nothing here is a hand-maintained list of "dangerous" names.
//
// ★ WHAT IT REFUSES (outbound):
//   * `initialize` whose `capabilities.experimentalApi` is anything but an explicit `false` — including a
//     missing or null `capabilities`: the RUST_SOURCE_IDENTIFIER `experimental_api` must be visibly false on
//     the wire, never defaulted by the server.
//   * a client method that is itself annotated experimental (method-level inventory entries).
//   * params carrying a category (1) or (2) FIELD of that method's generated params type (own key present,
//     whatever its value — `null` included, because presence is what the server gates on).
//   * params carrying a category (1) or (2) enum VARIANT at a position the inventory derived mechanically
//     from the generated params types (e.g. `askForApproval.granular` at `approvalPolicy`).
// ★ WHAT IT DOES NOT CLAIM. Category (1) items are already INEXPRESSIBLE in the generated types; this gate
//   is the runtime proof that an untyped caller cannot smuggle them in either. Category (2) items stay
//   faithfully present in the wire types — they are refused HERE, by GovAI policy, not deleted upstream.
// ★ INBOUND. A server notification whose method is an inventory item is never delivered to a typed handler:
//   it is surfaced as `reject_experimental`. (The pinned server is expected not to emit them to a client
//   that declared `experimentalApi: false`; if it does, GovAI still does not consume them.)

import {
  CODEX_EXPERIMENTAL_INVENTORY,
  type CodexExperimentalInventoryEntry,
} from '../protocol/experimental-inventory.js';

export type CodexExperimentalLockoutRule =
  | 'experimental_api_must_be_false'
  | 'experimental_method'
  | 'experimental_param_key'
  | 'experimental_variant';

export class CodexExperimentalLockoutViolation extends Error {
  readonly code = 'codex_experimental_lockout';
  constructor(
    readonly rule: CodexExperimentalLockoutRule,
    readonly method: string,
    /** The inventory entry that matched; `null` for the `experimentalApi` rule. */
    readonly entry: CodexExperimentalInventoryEntry | null,
  ) {
    super(
      entry === null
        ? `codex experimental lockout: ${rule} (${method})`
        : `codex experimental lockout: ${rule} (${method}: ${entry.reason} [${entry.category}])`,
    );
    this.name = 'CodexExperimentalLockoutViolation';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Does `value` carry the inventory variant `entry` in its wire representation? */
export function carriesExperimentalVariant(value: unknown, entry: CodexExperimentalInventoryEntry): boolean {
  if (entry.kind !== 'variant') return false;
  if (entry.tag !== null) return isRecord(value) && value[entry.tag] === entry.wire;
  // Externally tagged: a unit variant is the bare string, a struct/tuple variant is `{ "<wire>": … }`.
  if (value === entry.wire) return true;
  return isRecord(value) && Object.hasOwn(value, entry.wire);
}

const OUTBOUND_METHOD_ENTRIES = CODEX_EXPERIMENTAL_INVENTORY.filter(
  (e) => e.kind === 'method' && e.container === 'ClientRequest',
);
const INBOUND_NOTIFICATION_ENTRIES = CODEX_EXPERIMENTAL_INVENTORY.filter(
  (e) => e.kind === 'method' && e.container === 'ServerNotification',
);

/** Inventory FIELD entries that sit directly on the params of `method`. */
export function experimentalParamFieldsOf(method: string): readonly CodexExperimentalInventoryEntry[] {
  return CODEX_EXPERIMENTAL_INVENTORY.filter((e) => e.kind === 'field' && e.requestMethods.includes(method));
}

/** Inventory VARIANT entries reachable from the params of `method`, with the position they occupy. */
export function experimentalVariantPositionsOf(
  method: string,
): readonly { readonly entry: CodexExperimentalInventoryEntry; readonly field: string | null }[] {
  const out: { entry: CodexExperimentalInventoryEntry; field: string | null }[] = [];
  for (const entry of CODEX_EXPERIMENTAL_INVENTORY) {
    if (entry.kind !== 'variant') continue;
    for (const p of entry.positions) if (p.method === method) out.push({ entry, field: p.field });
  }
  return out;
}

/**
 * Throw `CodexExperimentalLockoutViolation` unless `(method, params)` is free of every category (1) and (2)
 * inventory item and — for `initialize` — declares `experimentalApi: false` explicitly.
 */
export function assertOutboundRequestAllowed(method: string, params: unknown): void {
  if (method === 'initialize') {
    const capabilities = isRecord(params) ? params['capabilities'] : undefined;
    if (!isRecord(capabilities) || capabilities['experimentalApi'] !== false) {
      throw new CodexExperimentalLockoutViolation('experimental_api_must_be_false', method, null);
    }
  }

  const methodEntry = OUTBOUND_METHOD_ENTRIES.find((e) => e.wire === method);
  if (methodEntry !== undefined) {
    throw new CodexExperimentalLockoutViolation('experimental_method', method, methodEntry);
  }

  if (!isRecord(params)) return;

  for (const entry of experimentalParamFieldsOf(method)) {
    if (Object.hasOwn(params, entry.wire)) {
      throw new CodexExperimentalLockoutViolation('experimental_param_key', method, entry);
    }
  }

  for (const { entry, field } of experimentalVariantPositionsOf(method)) {
    const value = field === null ? params : params[field];
    if (carriesExperimentalVariant(value, entry)) {
      throw new CodexExperimentalLockoutViolation('experimental_variant', method, entry);
    }
  }
}

export type CodexInboundNotificationVerdict =
  | { readonly verdict: 'deliver' }
  | { readonly verdict: 'reject_experimental'; readonly entry: CodexExperimentalInventoryEntry };

/** Verdict on an inbound server notification method (the generated-union check is the client's job). */
export function classifyInboundNotification(method: string): CodexInboundNotificationVerdict {
  const entry = INBOUND_NOTIFICATION_ENTRIES.find((e) => e.wire === method);
  return entry === undefined ? { verdict: 'deliver' } : { verdict: 'reject_experimental', entry };
}

/** §0.1 frozen capabilities: `capabilities` is always sent (never null) and both flags are explicitly false. */
export const GOVAI_CODEX_INITIALIZE_CAPABILITIES = Object.freeze({
  experimentalApi: false,
  requestAttestation: false,
} as const);

/** The dispatch's GOVAI POLICY name for this gate. */
export const GovAICodexExperimentalLockout = Object.freeze({
  assertOutboundRequestAllowed,
  classifyInboundNotification,
  carriesExperimentalVariant,
  experimentalParamFieldsOf,
  experimentalVariantPositionsOf,
});
