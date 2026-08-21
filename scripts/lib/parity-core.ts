// Pure logic for the Native Experience Parity V1 manifest
// (EP-PROVIDER-NATIVE-PARITY-V1-BASELINE-01).
//
// The manifest (docs/architecture/generated/native-experience-parity-v1.json) is a
// HAND-CURATED research artifact — a versioned baseline snapshot, not a derivation of the
// repository tree — so unlike the canonical source manifest there is no `write` mode that
// regenerates it from source. What this module provides instead:
//
//   validateParityManifest — the structural/semantic invariants a baseline row must satisfy
//                            (vocabulary, uniqueness, axis coherence, no-overclaim rules);
//   renderParityManifest   — the single canonical byte rendering (fixed key order, fixed row
//                            order, 2-space JSON, trailing newline), so `check` can enforce
//                            byte-determinism and `format` can restore it after hand edits.
//
// Everything here is deterministic and side-effect free: values in, strings/findings out.

export const PARITY_SCHEMA_VERSION = 1;

export const SURFACES = [
  'OPENAI_API',
  'ANTHROPIC_API',
  'CODEX',
  'CLAUDE_CODE',
  'CHATGPT_APP',
  'CLAUDE_APP',
  'CODEX_APP',
  'CLAUDE_CODE_APP',
] as const;
export type Surface = (typeof SURFACES)[number];

/** Product-experience reference surfaces: rows here are PRODUCT_ONLY by definition. */
export const APP_SURFACES: readonly Surface[] = [
  'CHATGPT_APP',
  'CLAUDE_APP',
  'CODEX_APP',
  'CLAUDE_CODE_APP',
];

/** Which provider owns each surface (validated, never inferred at read time). */
export const SURFACE_PROVIDER: Record<Surface, 'openai' | 'anthropic'> = {
  OPENAI_API: 'openai',
  ANTHROPIC_API: 'anthropic',
  CODEX: 'openai',
  CLAUDE_CODE: 'anthropic',
  CHATGPT_APP: 'openai',
  CLAUDE_APP: 'anthropic',
  CODEX_APP: 'openai',
  CLAUDE_CODE_APP: 'anthropic',
};

export const OFFICIAL_STATUSES = [
  'GA',
  'BETA',
  'EXPERIMENTAL',
  'DEPRECATED',
  'PRODUCT_ONLY',
  'UNKNOWN',
] as const;

export const CLASSIFICATIONS = [
  'FULL',
  'PARTIAL',
  'MISSING',
  'PRODUCT_ONLY',
  'PROVIDER_NOT_EXPOSED',
  'BLOCKED_BY_GOVAI',
  'NOT_APPLICABLE',
] as const;

export const SOURCE_TYPES = ['api-reference', 'guide', 'changelog', 'product-page'] as const;

export const PROTOCOL_STABILITIES = ['stable', 'experimental', 'unstable'] as const;

export const RISK_CLASSES = ['A', 'B', 'C', 'D', 'E'] as const;

/** Fixed field order — the canonical rendering emits exactly these keys in this order. */
export const ROW_FIELDS = [
  'provider',
  'surface',
  'family',
  'capability_id',
  'capability_name',
  'official_status',
  'protocol_stability',
  'official_source',
  'source_type',
  'verified_at',
  'model_constraints',
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
  'classification',
  'notes',
] as const;

export interface ParityRow {
  provider: 'openai' | 'anthropic';
  surface: Surface;
  family: string;
  capability_id: string;
  capability_name: string;
  official_status: (typeof OFFICIAL_STATUSES)[number];
  protocol_stability: (typeof PROTOCOL_STABILITIES)[number] | null;
  official_source: string;
  source_type: (typeof SOURCE_TYPES)[number];
  verified_at: string;
  model_constraints: string | null;
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
  classification: (typeof CLASSIFICATIONS)[number];
  notes: string;
}

export interface ParityManifest {
  schema_version: typeof PARITY_SCHEMA_VERSION;
  name: string;
  description: string;
  research_snapshot_date: string;
  source_anchor: string;
  verify: string;
  doc: string;
  capability_count: number;
  capabilities: ParityRow[];
}

const CAPABILITY_ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

function isBool(v: unknown): v is boolean {
  return typeof v === 'boolean';
}

function oneOf<T extends string>(v: unknown, vocab: readonly T[]): v is T {
  return typeof v === 'string' && (vocab as readonly string[]).includes(v);
}

/**
 * Validate the full manifest. Returns human-readable findings; empty array = valid.
 * Every finding names the offending row as `surface/capability_id` so a hand editor
 * can locate it without line numbers.
 */
export function validateParityManifest(m: unknown): string[] {
  const errs: string[] = [];
  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    return ['manifest root must be a JSON object'];
  }
  const man = m as Record<string, unknown>;

  if (man['schema_version'] !== PARITY_SCHEMA_VERSION) {
    errs.push(`schema_version must be ${PARITY_SCHEMA_VERSION}`);
  }
  if (man['name'] !== 'native-experience-parity-v1') {
    errs.push('name must be "native-experience-parity-v1"');
  }
  const snap = man['research_snapshot_date'];
  if (typeof snap !== 'string' || !DATE_RE.test(snap)) {
    errs.push('research_snapshot_date must be a YYYY-MM-DD string');
  }
  if (typeof man['source_anchor'] !== 'string' || !SHA_RE.test(man['source_anchor'] as string)) {
    errs.push('source_anchor must be a 40-hex commit sha');
  }
  for (const f of ['description', 'verify', 'doc'] as const) {
    if (typeof man[f] !== 'string' || (man[f] as string).length === 0) {
      errs.push(`${f} must be a non-empty string`);
    }
  }
  const caps = man['capabilities'];
  if (!Array.isArray(caps)) {
    errs.push('capabilities must be an array');
    return errs;
  }
  if (man['capability_count'] !== caps.length) {
    errs.push(`capability_count (${String(man['capability_count'])}) != capabilities.length (${caps.length})`);
  }

  const seen = new Set<string>();
  caps.forEach((raw, i) => {
    const where = () =>
      typeof (raw as Record<string, unknown>)?.['capability_id'] === 'string'
        ? `${String((raw as Record<string, unknown>)['surface'])}/${String((raw as Record<string, unknown>)['capability_id'])}`
        : `row[${i}]`;
    if (typeof raw !== 'object' || raw === null) {
      errs.push(`row[${i}] must be an object`);
      return;
    }
    const r = raw as Record<string, unknown>;

    const keys = Object.keys(r);
    if (keys.length !== ROW_FIELDS.length || ROW_FIELDS.some((f, j) => keys[j] !== f)) {
      errs.push(`${where()}: keys must be exactly the ${ROW_FIELDS.length} schema fields in canonical order`);
    }

    if (!oneOf(r['surface'], SURFACES)) {
      errs.push(`${where()}: invalid surface ${String(r['surface'])}`);
      return;
    }
    const surface = r['surface'];
    if (r['provider'] !== SURFACE_PROVIDER[surface]) {
      errs.push(`${where()}: provider must be ${SURFACE_PROVIDER[surface]} for surface ${surface}`);
    }
    if (typeof r['capability_id'] !== 'string' || !CAPABILITY_ID_RE.test(r['capability_id'])) {
      errs.push(`${where()}: capability_id must be kebab-case`);
    } else {
      const key = `${surface}/${r['capability_id']}`;
      if (seen.has(key)) errs.push(`duplicate capability id: ${key}`);
      seen.add(key);
    }
    for (const f of ['family', 'capability_name'] as const) {
      if (typeof r[f] !== 'string' || (r[f] as string).length === 0) {
        errs.push(`${where()}: ${f} must be a non-empty string`);
      }
    }
    if (typeof r['notes'] !== 'string') errs.push(`${where()}: notes must be a string`);
    if (!oneOf(r['official_status'], OFFICIAL_STATUSES)) {
      errs.push(`${where()}: invalid official_status ${String(r['official_status'])}`);
    }
    if (!oneOf(r['classification'], CLASSIFICATIONS)) {
      errs.push(`${where()}: invalid classification ${String(r['classification'])}`);
      return;
    }
    if (!oneOf(r['source_type'], SOURCE_TYPES)) {
      errs.push(`${where()}: invalid source_type ${String(r['source_type'])}`);
    }
    if (
      typeof r['official_source'] !== 'string' ||
      !(r['official_source'] as string).startsWith('https://')
    ) {
      errs.push(`${where()}: official_source must be an https URL (required for every row)`);
    }
    if (r['verified_at'] !== snap) {
      errs.push(`${where()}: verified_at must equal research_snapshot_date (single-snapshot semantics)`);
    }
    if (r['model_constraints'] !== null && typeof r['model_constraints'] !== 'string') {
      errs.push(`${where()}: model_constraints must be string or null`);
    }
    if (r['protocol_stability'] !== null) {
      if (!oneOf(r['protocol_stability'], PROTOCOL_STABILITIES)) {
        errs.push(`${where()}: invalid protocol_stability ${String(r['protocol_stability'])}`);
      } else if (surface !== 'CODEX') {
        errs.push(`${where()}: protocol_stability is only meaningful on the CODEX surface`);
      }
    }
    if (r['risk_class_if_known'] !== null && !oneOf(r['risk_class_if_known'], RISK_CLASSES)) {
      errs.push(`${where()}: invalid risk_class_if_known ${String(r['risk_class_if_known'])}`);
    }
    const boolFields = ROW_FIELDS.filter(
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
      if (!isBool(r[f])) errs.push(`${where()}: ${f} must be boolean`);
    }
    if (boolFields.some((f) => !isBool(r[f]))) return;

    const b = (f: string): boolean => r[f] === true;
    const cls = r['classification'];
    const isApp = (APP_SURFACES as readonly string[]).includes(surface);

    // --- axis coherence -----------------------------------------------------
    if ((b('native_tested') || b('native_live_accepted')) && !b('native_route_available')) {
      errs.push(`${where()}: native_tested/live_accepted require native_route_available`);
    }
    if (
      (b('governed_route_available') || b('governed_tested') || b('governed_live_accepted')) &&
      !b('governed_applicable')
    ) {
      errs.push(`${where()}: governed_* axes require governed_applicable`);
    }
    if ((b('governed_tested') || b('governed_live_accepted')) && !b('governed_route_available')) {
      errs.push(`${where()}: governed_tested/live_accepted require governed_route_available`);
    }
    if ((b('ui_tested') || b('ui_live_accepted')) && !b('ui_exposed')) {
      errs.push(`${where()}: ui_tested/live_accepted require ui_exposed`);
    }

    // --- product-only cannot masquerade as provider API --------------------
    if (isApp) {
      if (cls !== 'PRODUCT_ONLY') errs.push(`${where()}: app-surface rows must classify PRODUCT_ONLY`);
      if (r['official_status'] !== 'PRODUCT_ONLY') {
        errs.push(`${where()}: app-surface rows must carry official_status PRODUCT_ONLY`);
      }
      if (b('provider_exposed')) {
        errs.push(`${where()}: app-surface rows must not claim provider_exposed (API) status`);
      }
      const apiAxes = [
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
      ];
      for (const f of apiAxes) {
        if (b(f)) errs.push(`${where()}: app-surface rows must not set ${f}`);
      }
    } else {
      if (cls === 'PRODUCT_ONLY') {
        errs.push(`${where()}: PRODUCT_ONLY classification is reserved for app surfaces`);
      }
      if (r['official_status'] === 'PRODUCT_ONLY') {
        errs.push(`${where()}: official_status PRODUCT_ONLY is reserved for app surfaces`);
      }
    }

    // --- classification truth rules ----------------------------------------
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
        if (!b(f)) errs.push(`${where()}: FULL requires ${f}=true`);
      }
      if (
        b('governed_applicable') &&
        !(b('governed_route_available') && b('governed_tested') && b('governed_live_accepted'))
      ) {
        errs.push(`${where()}: FULL with governed_applicable requires the governed axes proven`);
      }
    }
    if (cls === 'MISSING') {
      const govai = [
        'govai_registered',
        'native_route_available',
        'native_tested',
        'native_live_accepted',
        'governed_route_available',
        'ui_exposed',
        'evidence_wired',
      ];
      for (const f of govai) {
        if (b(f)) errs.push(`${where()}: MISSING rows must not set ${f}`);
      }
    }
    if (cls === 'PROVIDER_NOT_EXPOSED' && b('provider_exposed')) {
      errs.push(`${where()}: PROVIDER_NOT_EXPOSED contradicts provider_exposed=true`);
    }
    if ((cls === 'FULL' || cls === 'PARTIAL' || cls === 'BLOCKED_BY_GOVAI') && !b('provider_exposed')) {
      errs.push(`${where()}: ${cls} requires provider_exposed=true`);
    }
  });

  // Deterministic ordering: surface (declared order), then family, then capability_id.
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
      errs.push(
        `rows out of canonical order at index ${i}: ${String(c['surface'])}/${String(c['capability_id'])} ` +
          'must sort by (surface, family, capability_id) — run `pnpm docs:parity:format`'
      );
      break;
    }
  }

  return errs;
}

/** Canonical byte rendering: fixed key order, canonical row sort, 2-space JSON, trailing \n. */
export function renderParityManifest(m: ParityManifest): string {
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
    for (const f of ROW_FIELDS) out[f] = (row as unknown as Record<string, unknown>)[f];
    return out;
  });
  const root: Record<string, unknown> = {
    schema_version: m.schema_version,
    name: m.name,
    description: m.description,
    research_snapshot_date: m.research_snapshot_date,
    source_anchor: m.source_anchor,
    verify: m.verify,
    doc: m.doc,
    capability_count: canonicalRows.length,
    capabilities: canonicalRows,
  };
  return `${JSON.stringify(root, null, 2)}\n`;
}
