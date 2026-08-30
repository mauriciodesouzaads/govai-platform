// Pure logic for the Native Experience Parity V2 manifest
// (EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01).
//
// V2 is a NEW versioned research baseline (docs/architecture/generated/
// native-experience-parity-v2.json). V1 and its validator are historical and byte-preserved:
// this module is ADDITIVE — it imports V1's exported vocabulary (surfaces, statuses,
// classifications, first-party host allowlists, the duplicate-key scanner) and implements the
// V2 row schema and invariants on top, so `parity-core.ts` keeps validating V1 exactly as it
// always did. The three small private helpers V1 does not export (calendar-date check,
// first-party https URL check) are deliberately re-implemented here rather than exported from
// the V1 module, so the V1 file is not touched at all.
//
// What V2 adds to the row schema, and the concrete question each field answers:
//
//   retirement_date    — "is there a first-party announced shutdown/retirement date?"
//                        (LAW NX-14: lifecycle is a first-class UX fact; OpenAI now serves
//                        machine-readable per-model `shutdown_date`, and both providers
//                        publish dated deprecation tables).
//   capability_source  — "if GovAI needed to resolve per-model/per-account support for this
//                        capability at runtime, what is the strongest source class?"
//                        `provider_machine_metadata` (e.g. Anthropic Models API `capabilities`)
//                        vs `provider_documentation` (e.g. OpenAI model detail pages).
//                        This encodes LAW NX-6's provider asymmetry mechanically.
//   state_nature       — "what does continuation state look like for this capability?"
//                        The P0-D axis: stateless replay vs provider-stored objects vs the
//                        coding agents' harness-owned/pluggable stores (continuity spec §11).
//   next_wave          — "which planned movement owns closing this row's principal gap?"
//                        (P0-D/P0-E/P0-F and the baseline-doc §9 waves P1–P9.)
//
// Dynamic tenant state (policy allow/block, entitlements, account-scoped catalogues) is
// deliberately NOT representable here: the baseline records capability/product truth, and the
// architecture that resolves dynamic state lives in the contract document, not in static rows.
//
// Everything here is deterministic and side-effect free: values in, strings/findings out.

import {
  APP_SURFACES,
  CLASSIFICATIONS,
  FIRST_PARTY_SOURCE_HOSTS,
  OFFICIAL_STATUSES,
  PROTOCOL_STABILITIES,
  RISK_CLASSES,
  SOURCE_TYPES,
  SURFACES,
  SURFACE_PROVIDER,
  findDuplicateJsonKeys,
  type Surface,
} from './parity-core.js';

export const PARITY_V2_SCHEMA_VERSION = 2;
export const PARITY_V2_BASELINE_VERSION = 2;
export const PARITY_V2_NAME = 'native-experience-parity-v2';

export const CAPABILITY_SOURCES = ['provider_machine_metadata', 'provider_documentation'] as const;

export const STATE_NATURES = [
  // Full context resent per call; continuation = stateless replay from durable items.
  'stateless',
  // Provider-held server-side state (OpenAI stored responses / conversation objects,
  // Anthropic Managed Agents sessions): creates provider-side deletion obligations (§19).
  'provider_stored',
  // The harness owns its own local persistence (Codex rollout JSONL/SQLite under CODEX_HOME);
  // an embedder references thread ids, it does not re-implement the store.
  'harness_owned_local',
  // Client-side persistence with a documented pluggable store (Claude Agent SDK SessionStore).
  'client_store_pluggable',
] as const;

/** The movements/waves that may own a row's next implementation step. P0-D/E/F are the
 *  continuity program's remaining movements; P1–P9 are the baseline doc §9 waves. */
export const NEXT_WAVES = [
  'P0-D',
  'P0-E',
  'P0-F',
  'P1',
  'P2',
  'P3',
  'P4',
  'P5',
  'P6',
  'P7',
  'P8',
  'P9',
] as const;

/** Fixed field order — the canonical rendering emits exactly these keys in this order.
 *  V1's 31 fields plus the four V2 fields, each placed next to the cluster it qualifies:
 *  `retirement_date` with the official-status/lifecycle cluster, `capability_source` and
 *  `state_nature` with the provider-fact cluster, `next_wave` with the verdict cluster. */
export const ROW_FIELDS_V2 = [
  'provider',
  'surface',
  'family',
  'capability_id',
  'capability_name',
  'official_status',
  'protocol_stability',
  'retirement_date',
  'official_source',
  'source_type',
  'verified_at',
  'model_constraints',
  'capability_source',
  'state_nature',
  'provider_exposed',
  'govai_registered',
  'native_route_available',
  'native_tested',
  'native_live_accepted',
  'governed_applicable',
  'governed_route_available',
  'governed_tested',
  'governed_live_accepted',
  'ui_exposed',
  'ui_tested',
  'ui_live_accepted',
  'evidence_wired',
  'exact_turn_evidence_correlation',
  'persistence_supported',
  'resume_supported',
  'fork_supported',
  'risk_class_if_known',
  'govai_product_equivalent_required',
  'next_wave',
  'classification',
  'notes',
] as const;

export interface ParityV2Row {
  provider: 'openai' | 'anthropic';
  surface: Surface;
  family: string;
  capability_id: string;
  capability_name: string;
  official_status: (typeof OFFICIAL_STATUSES)[number];
  protocol_stability: (typeof PROTOCOL_STABILITIES)[number] | null;
  retirement_date: string | null;
  official_source: string;
  source_type: (typeof SOURCE_TYPES)[number];
  verified_at: string;
  model_constraints: string | null;
  capability_source: (typeof CAPABILITY_SOURCES)[number] | null;
  state_nature: (typeof STATE_NATURES)[number] | null;
  provider_exposed: boolean;
  govai_registered: boolean;
  native_route_available: boolean;
  native_tested: boolean;
  native_live_accepted: boolean;
  governed_applicable: boolean;
  governed_route_available: boolean;
  governed_tested: boolean;
  governed_live_accepted: boolean;
  ui_exposed: boolean;
  ui_tested: boolean;
  ui_live_accepted: boolean;
  evidence_wired: boolean;
  exact_turn_evidence_correlation: boolean;
  persistence_supported: boolean;
  resume_supported: boolean;
  fork_supported: boolean;
  risk_class_if_known: (typeof RISK_CLASSES)[number] | null;
  govai_product_equivalent_required: boolean;
  next_wave: (typeof NEXT_WAVES)[number] | null;
  classification: (typeof CLASSIFICATIONS)[number];
  notes: string;
}

export interface ParityV2Manifest {
  schema_version: typeof PARITY_V2_SCHEMA_VERSION;
  baseline_version: typeof PARITY_V2_BASELINE_VERSION;
  name: string;
  description: string;
  predecessor: string;
  research_snapshot_date: string;
  source_anchor: string;
  verify: string;
  doc: string;
  capability_count: number;
  capabilities: ParityV2Row[];
}

const CAPABILITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/** Shape AND calendar validity (re-implemented from the V1 module's private helper). */
function isCalendarDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function oneOf<T extends string>(v: unknown, vocab: readonly T[]): v is T {
  return typeof v === 'string' && (vocab as readonly string[]).includes(v);
}

/** First-party https URL check (re-implemented; the allowlists themselves are imported from
 *  the V1 module so V1 and V2 can never disagree about what "first-party" means). */
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

const SHARED_HOST_ORG_PREFIXES: Record<'openai' | 'anthropic', Record<string, string>> = {
  openai: { 'github.com': '/openai/', 'raw.githubusercontent.com': '/openai/' },
  anthropic: { 'github.com': '/anthropics/', 'raw.githubusercontent.com': '/anthropics/' },
};

function isHttpsUrl(v: string, provider: 'openai' | 'anthropic'): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return false;
    const labels = u.hostname.split('.');
    if (labels.length < 2 || !labels.every((l) => HOST_LABEL_RE.test(l))) return false;
    if (FIRST_PARTY_SOURCE_HOSTS[provider].includes(u.hostname)) return true;
    const prefix = SHARED_HOST_ORG_PREFIXES[provider][u.hostname];
    return prefix !== undefined && u.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

export interface ParityV2Finding {
  code: 'invalid' | 'row-order' | 'key-order';
  message: string;
}

/** Validate the full V2 manifest. Same contract as V1's validator: typed findings, empty
 *  array = valid, repairability lives in `code`, never in message text. */
export function validateParityV2ManifestFindings(m: unknown): ParityV2Finding[] {
  const findings: ParityV2Finding[] = [];
  const push = (message: string, code: ParityV2Finding['code'] = 'invalid'): void => {
    findings.push({ code, message });
  };
  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    return [{ code: 'invalid', message: 'manifest root must be a JSON object' }];
  }
  const man = m as Record<string, unknown>;

  const ROOT_FIELDS = [
    'schema_version',
    'baseline_version',
    'name',
    'description',
    'predecessor',
    'research_snapshot_date',
    'source_anchor',
    'verify',
    'doc',
    'capability_count',
    'capabilities',
  ];
  const unknownRoot = Object.keys(man).filter((k) => !ROOT_FIELDS.includes(k));
  if (unknownRoot.length > 0) {
    push(`unknown root keys (formatting would delete them): ${unknownRoot.join(', ')}`);
  }

  if (man['schema_version'] !== PARITY_V2_SCHEMA_VERSION) {
    push(`schema_version must be ${PARITY_V2_SCHEMA_VERSION}`);
  }
  if (man['baseline_version'] !== PARITY_V2_BASELINE_VERSION) {
    push(`baseline_version must be ${PARITY_V2_BASELINE_VERSION}`);
  }
  if (man['name'] !== PARITY_V2_NAME) {
    push(`name must be "${PARITY_V2_NAME}"`);
  }
  const snap = man['research_snapshot_date'];
  if (typeof snap !== 'string' || !isCalendarDate(snap)) {
    push('research_snapshot_date must be a real YYYY-MM-DD calendar date');
  }
  if (typeof man['source_anchor'] !== 'string' || !SHA_RE.test(man['source_anchor'] as string)) {
    push('source_anchor must be a 40-hex commit sha');
  }
  for (const f of ['description', 'predecessor', 'verify', 'doc'] as const) {
    if (typeof man[f] !== 'string' || (man[f] as string).length === 0) {
      push(`${f} must be a non-empty string`);
    }
  }
  const caps = man['capabilities'];
  if (!Array.isArray(caps)) {
    push('capabilities must be an array');
    return findings;
  }
  if (man['capability_count'] !== caps.length) {
    push(
      `capability_count (${String(man['capability_count'])}) != capabilities.length (${caps.length})`
    );
  }

  const seen = new Set<string>();
  caps.forEach((raw, i) => {
    const where = () =>
      typeof (raw as Record<string, unknown>)?.['capability_id'] === 'string'
        ? `${String((raw as Record<string, unknown>)['surface'])}/${String((raw as Record<string, unknown>)['capability_id'])}`
        : `row[${i}]`;
    if (typeof raw !== 'object' || raw === null) {
      push(`row[${i}] must be an object`);
      return;
    }
    const r = raw as Record<string, unknown>;

    const keys = Object.keys(r);
    const keySet = new Set(keys);
    const missing = ROW_FIELDS_V2.filter((f) => !keySet.has(f));
    const extra = keys.filter((k) => !(ROW_FIELDS_V2 as readonly string[]).includes(k));
    if (missing.length > 0 || extra.length > 0 || keys.length !== ROW_FIELDS_V2.length) {
      push(
        `${where()}: keys must be exactly the ${ROW_FIELDS_V2.length} schema fields` +
          (missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '') +
          (extra.length > 0 ? ` (unknown: ${extra.join(', ')})` : '')
      );
    } else if (ROW_FIELDS_V2.some((f, j) => keys[j] !== f)) {
      push(`${where()}: keys out of canonical order — run \`pnpm docs:parity2:format\``, 'key-order');
    }

    if (!oneOf(r['surface'], SURFACES)) {
      push(`${where()}: invalid surface ${String(r['surface'])}`);
      return;
    }
    const surface = r['surface'];
    if (r['provider'] !== SURFACE_PROVIDER[surface]) {
      push(`${where()}: provider must be ${SURFACE_PROVIDER[surface]} for surface ${surface}`);
    }
    if (typeof r['capability_id'] !== 'string' || !CAPABILITY_ID_RE.test(r['capability_id'])) {
      push(`${where()}: capability_id must be kebab-case`);
    } else {
      const key = `${surface}/${r['capability_id']}`;
      if (seen.has(key)) push(`duplicate capability id: ${key}`);
      seen.add(key);
    }
    for (const f of ['family', 'capability_name'] as const) {
      if (typeof r[f] !== 'string' || (r[f] as string).length === 0) {
        push(`${where()}: ${f} must be a non-empty string`);
      }
    }
    if (typeof r['notes'] !== 'string') push(`${where()}: notes must be a string`);
    if (!oneOf(r['official_status'], OFFICIAL_STATUSES)) {
      push(`${where()}: invalid official_status ${String(r['official_status'])}`);
    }
    if (!oneOf(r['classification'], CLASSIFICATIONS)) {
      push(`${where()}: invalid classification ${String(r['classification'])}`);
      return;
    }
    if (!oneOf(r['source_type'], SOURCE_TYPES)) {
      push(`${where()}: invalid source_type ${String(r['source_type'])}`);
    }
    if (
      typeof r['official_source'] !== 'string' ||
      !isHttpsUrl(r['official_source'], SURFACE_PROVIDER[surface])
    ) {
      push(
        `${where()}: official_source must be a parseable FIRST-PARTY https URL owned by THIS row's provider (shared hosts need that provider's org path)`
      );
    }
    if (r['verified_at'] !== snap) {
      push(`${where()}: verified_at must equal research_snapshot_date (single-snapshot semantics)`);
    }
    if (r['model_constraints'] !== null && typeof r['model_constraints'] !== 'string') {
      push(`${where()}: model_constraints must be string or null`);
    }
    if (r['protocol_stability'] !== null) {
      if (!oneOf(r['protocol_stability'], PROTOCOL_STABILITIES)) {
        push(`${where()}: invalid protocol_stability ${String(r['protocol_stability'])}`);
      } else if (surface !== 'CODEX') {
        push(`${where()}: protocol_stability is only meaningful on the CODEX surface`);
      }
    }
    if (r['risk_class_if_known'] !== null && !oneOf(r['risk_class_if_known'], RISK_CLASSES)) {
      push(`${where()}: invalid risk_class_if_known ${String(r['risk_class_if_known'])}`);
    }

    // --- V2 field vocabulary + coherence ------------------------------------
    if (r['retirement_date'] !== null) {
      if (typeof r['retirement_date'] !== 'string' || !isCalendarDate(r['retirement_date'])) {
        push(`${where()}: retirement_date must be a real YYYY-MM-DD calendar date or null`);
      }
    }
    if (r['capability_source'] !== null && !oneOf(r['capability_source'], CAPABILITY_SOURCES)) {
      push(`${where()}: invalid capability_source ${String(r['capability_source'])}`);
    }
    if (r['state_nature'] !== null && !oneOf(r['state_nature'], STATE_NATURES)) {
      push(`${where()}: invalid state_nature ${String(r['state_nature'])}`);
    }
    if (r['next_wave'] !== null && !oneOf(r['next_wave'], NEXT_WAVES)) {
      push(`${where()}: invalid next_wave ${String(r['next_wave'])}`);
    }
    const isApp = (APP_SURFACES as readonly string[]).includes(surface);
    // Machine capability metadata is an API-plane fact; a product-reference row claiming it
    // would be the PRODUCT_ONLY masquerade in a new disguise.
    if (isApp && r['capability_source'] === 'provider_machine_metadata') {
      push(`${where()}: app-surface rows must not claim provider_machine_metadata`);
    }
    // NOT_APPLICABLE / PROVIDER_NOT_EXPOSED declare that no parity effort applies — a
    // next_wave owner on such a row would schedule work the row itself rules out.
    if (
      (r['classification'] === 'NOT_APPLICABLE' || r['classification'] === 'PROVIDER_NOT_EXPOSED') &&
      r['next_wave'] !== null
    ) {
      push(`${where()}: ${String(r['classification'])} rows must not carry next_wave`);
    }

    const boolFields = ROW_FIELDS_V2.filter(
      (f) =>
        f.endsWith('_exposed') ||
        f.endsWith('_registered') ||
        f.endsWith('_available') ||
        f.endsWith('_tested') ||
        f.endsWith('_accepted') ||
        f.endsWith('_applicable') ||
        f.endsWith('_wired') ||
        f.endsWith('_correlation') ||
        f.endsWith('_supported') ||
        f === 'govai_product_equivalent_required'
    );
    for (const f of boolFields) {
      if (!isBool(r[f])) push(`${where()}: ${f} must be boolean`);
    }
    if (boolFields.some((f) => !isBool(r[f]))) return;

    const b = (f: string): boolean => r[f] === true;
    const cls = r['classification'];

    // --- axis coherence (inherited unchanged from V1) -----------------------
    if (b('native_route_available') && !b('provider_exposed')) {
      push(
        `${where()}: native_route_available requires provider_exposed (a route to a capability the provider does not expose is a fiction)`
      );
    }
    if ((b('native_tested') || b('native_live_accepted')) && !b('native_route_available')) {
      push(`${where()}: native_tested/live_accepted require native_route_available`);
    }
    if (
      (b('governed_route_available') || b('governed_tested') || b('governed_live_accepted')) &&
      !b('governed_applicable')
    ) {
      push(`${where()}: governed_* axes require governed_applicable`);
    }
    if ((b('governed_tested') || b('governed_live_accepted')) && !b('governed_route_available')) {
      push(`${where()}: governed_tested/live_accepted require governed_route_available`);
    }
    if ((b('ui_tested') || b('ui_live_accepted')) && !b('ui_exposed')) {
      push(`${where()}: ui_tested/live_accepted require ui_exposed`);
    }
    if (b('exact_turn_evidence_correlation') && !b('evidence_wired')) {
      push(`${where()}: exact_turn_evidence_correlation requires evidence_wired`);
    }

    // --- product-only cannot masquerade as provider API (inherited) ---------
    const GOVAI_AXES = [
      'govai_registered',
      'native_route_available',
      'native_tested',
      'native_live_accepted',
      'governed_applicable',
      'governed_route_available',
      'governed_tested',
      'governed_live_accepted',
      'ui_exposed',
      'ui_tested',
      'ui_live_accepted',
      'evidence_wired',
      'exact_turn_evidence_correlation',
      'persistence_supported',
      'resume_supported',
      'fork_supported',
    ];
    if (isApp) {
      if (cls !== 'PRODUCT_ONLY') push(`${where()}: app-surface rows must classify PRODUCT_ONLY`);
      if (r['official_status'] !== 'PRODUCT_ONLY') {
        push(`${where()}: app-surface rows must carry official_status PRODUCT_ONLY`);
      }
      if (b('provider_exposed')) {
        push(`${where()}: app-surface rows must not claim provider_exposed (API) status`);
      }
      for (const f of GOVAI_AXES) {
        if (b(f)) push(`${where()}: app-surface rows must not set ${f}`);
      }
    } else {
      if (cls === 'PRODUCT_ONLY') {
        push(`${where()}: PRODUCT_ONLY classification is reserved for app surfaces`);
      }
      if (r['official_status'] === 'PRODUCT_ONLY') {
        push(`${where()}: official_status PRODUCT_ONLY is reserved for app surfaces`);
      }
    }

    // --- classification truth rules (inherited) -----------------------------
    if (cls === 'FULL') {
      const need = [
        'provider_exposed',
        'govai_registered',
        'native_route_available',
        'native_tested',
        'native_live_accepted',
        'ui_exposed',
        'ui_tested',
        'ui_live_accepted',
        'evidence_wired',
      ];
      for (const f of need) {
        if (!b(f)) push(`${where()}: FULL requires ${f}=true`);
      }
      if (
        b('governed_applicable') &&
        !(b('governed_route_available') && b('governed_tested') && b('governed_live_accepted'))
      ) {
        push(`${where()}: FULL with governed_applicable requires the governed axes proven`);
      }
    }
    if (cls === 'MISSING' && !b('provider_exposed')) {
      push(
        `${where()}: MISSING requires provider_exposed=true (a capability the provider does not expose is PROVIDER_NOT_EXPOSED, not MISSING)`
      );
    }
    if (cls === 'MISSING' || cls === 'PROVIDER_NOT_EXPOSED' || cls === 'NOT_APPLICABLE') {
      for (const f of GOVAI_AXES) {
        if (b(f)) push(`${where()}: ${cls} rows must not set ${f}`);
      }
    }
    if (cls === 'PROVIDER_NOT_EXPOSED' && b('provider_exposed')) {
      push(`${where()}: PROVIDER_NOT_EXPOSED contradicts provider_exposed=true`);
    }
    if ((cls === 'FULL' || cls === 'PARTIAL' || cls === 'BLOCKED_BY_GOVAI') && !b('provider_exposed')) {
      push(`${where()}: ${cls} requires provider_exposed=true`);
    }
    if (cls === 'PARTIAL' && !b('native_route_available')) {
      push(`${where()}: PARTIAL requires native_route_available (a GovAI path must exist)`);
    }
    if (cls === 'NOT_APPLICABLE' && !b('provider_exposed')) {
      push(
        `${where()}: NOT_APPLICABLE requires provider_exposed=true (a provider-unexposed capability is PROVIDER_NOT_EXPOSED)`
      );
    }
    if (cls === 'BLOCKED_BY_GOVAI' && !(b('govai_registered') && b('native_route_available'))) {
      push(
        `${where()}: BLOCKED_BY_GOVAI requires govai_registered and native_route_available (blocking needs a path to intercept)`
      );
    }
  });

  if (caps.some((c) => typeof c !== 'object' || c === null || Array.isArray(c))) {
    return findings;
  }
  const order = new Map<string, number>(SURFACES.map((s, i) => [s, i]));
  for (let i = 1; i < caps.length; i += 1) {
    const a = caps[i - 1] as Record<string, unknown>;
    const c = caps[i] as Record<string, unknown>;
    const ka: [number, string, string] = [
      order.get(String(a['surface'])) ?? 99,
      String(a['family']),
      String(a['capability_id']),
    ];
    const kc: [number, string, string] = [
      order.get(String(c['surface'])) ?? 99,
      String(c['family']),
      String(c['capability_id']),
    ];
    if (ka[0] > kc[0] || (ka[0] === kc[0] && (ka[1] > kc[1] || (ka[1] === kc[1] && ka[2] >= kc[2])))) {
      push(
        `rows out of canonical order at index ${i}: ${String(c['surface'])}/${String(c['capability_id'])} ` +
          'must sort by (surface, family, capability_id) — run `pnpm docs:parity2:format`',
        'row-order'
      );
      break;
    }
  }

  return findings;
}

/** String façade — human-readable messages only (mirrors the V1 validator's contract). */
export function validateParityV2Manifest(m: unknown): string[] {
  return validateParityV2ManifestFindings(m).map((f) => f.message);
}

/** Canonical byte rendering: fixed key order, canonical row sort, 2-space JSON, trailing \n. */
export function renderParityV2Manifest(m: ParityV2Manifest): string {
  const order = new Map<string, number>(SURFACES.map((s, i) => [s, i]));
  const rows = [...m.capabilities].sort((a, c) => {
    const sa = order.get(a.surface) ?? 99;
    const sc = order.get(c.surface) ?? 99;
    if (sa !== sc) return sa - sc;
    if (a.family !== c.family) return a.family < c.family ? -1 : 1;
    return a.capability_id < c.capability_id ? -1 : 1;
  });
  const canonicalRows = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of ROW_FIELDS_V2) out[f] = (row as unknown as Record<string, unknown>)[f];
    return out;
  });
  const root: Record<string, unknown> = {
    schema_version: m.schema_version,
    baseline_version: m.baseline_version,
    name: m.name,
    description: m.description,
    predecessor: m.predecessor,
    research_snapshot_date: m.research_snapshot_date,
    source_anchor: m.source_anchor,
    verify: m.verify,
    doc: m.doc,
    capability_count: canonicalRows.length,
    capabilities: canonicalRows,
  };
  return `${JSON.stringify(root, null, 2)}\n`;
}

export { findDuplicateJsonKeys };
