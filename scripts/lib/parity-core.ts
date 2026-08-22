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

// Strict kebab-case: hyphen-separated non-empty alphanumeric segments — no leading/trailing
// or doubled hyphens (the permissive form certified ids like `messages-` / `messages--create`).
const CAPABILITY_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SHA_RE = /^[0-9a-f]{40}$/;

/** Shape AND calendar validity — the regex alone accepts impossible dates like 2026-02-31. */
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

/**
 * A validation finding with a STRUCTURAL repairability class. `row-order` and `key-order`
 * are canonical-FORM violations the formatter repairs; everything else is `invalid` (hard).
 * Consumers must branch on `code`, never on message text — messages embed user-controlled
 * values, so substring matching would let a crafted value (e.g. an official_status of
 * "rows out of canonical order") misclassify a hard finding as repairable.
 */
export interface ParityFinding {
  code: 'invalid' | 'row-order' | 'key-order';
  message: string;
}

/**
 * Decode the escapes of a raw JSON string body (the text between the quotes) to the string
 * `JSON.parse` would produce. `\uXXXX` decodes per UTF-16 code unit — exactly parse semantics,
 * surrogate pairs included. A malformed escape is kept verbatim: such input cannot survive the
 * subsequent `JSON.parse` anyway, and keeping bytes is the conservative identity choice.
 */
const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
};

function decodeJsonStringBody(body: string): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c !== '\\') {
      out += c;
      i += 1;
      continue;
    }
    const next = body[i + 1];
    if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(body.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(body.slice(i + 2, i + 6), 16));
      i += 6;
    } else if (next !== undefined && next in SIMPLE_ESCAPES) {
      out += SIMPLE_ESCAPES[next];
      i += 2;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/**
 * Detect duplicate keys inside JSON OBJECT literals in raw text. `JSON.parse` silently keeps
 * the last occurrence, so a duplicated key would survive validation while `format` rewrote the
 * file without the earlier value — silent content loss. A tiny string/escape-aware scanner:
 * tracks object vs array contexts and collects each object's keys. Key identity is the DECODED
 * string — the same identity `JSON.parse` uses — so an escaped alias of a literal key (e.g.
 * `"\u006eotes"` aliasing `"notes"`) is detected as the duplicate it becomes at parse time.
 */
export function findDuplicateJsonKeys(raw: string): string[] {
  const dups: string[] = [];
  // Object contexts carry a key set; array contexts push null.
  const stack: Array<Set<string> | null> = [];
  let expectKey = false;
  let i = 0;
  while (i < raw.length) {
    const c = raw[i];
    if (c === '"') {
      let j = i + 1;
      let body = '';
      while (j < raw.length && raw[j] !== '"') {
        if (raw[j] === '\\') {
          body += raw.slice(j, j + 2);
          j += 2;
        } else {
          body += raw[j];
          j += 1;
        }
      }
      const top = stack[stack.length - 1];
      if (top instanceof Set && expectKey) {
        const key = decodeJsonStringBody(body);
        if (top.has(key)) dups.push(key);
        top.add(key);
        expectKey = false;
      }
      i = j + 1;
    } else if (c === '{') {
      stack.push(new Set());
      expectKey = true;
      i += 1;
    } else if (c === '[') {
      stack.push(null);
      i += 1;
    } else if (c === '}' || c === ']') {
      stack.pop();
      i += 1;
    } else if (c === ',') {
      if (stack[stack.length - 1] instanceof Set) expectKey = true;
      i += 1;
    } else if (c === ':') {
      expectKey = false;
      i += 1;
    } else {
      i += 1;
    }
  }
  return dups;
}

function oneOf<T extends string>(v: unknown, vocab: readonly T[]): v is T {
  return typeof v === 'string' && (vocab as readonly string[]).includes(v);
}

/**
 * A row's source must be a REAL https URL, not merely https-prefixed text: every baseline row
 * relies on official_source for traceability. URL parsing alone is not enough either — the
 * WHATWG constructor accepts junk hosts like `https://-` and `https://.` — so the hostname must
 * be dot-separated valid DNS labels (LDH: alphanumeric edges, hyphens inside), and at least two
 * of them: every legitimate first-party doc source is a registered domain, never a bare label.
 */
const HOST_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/**
 * The baseline's research contract is FIRST-PARTY sources only, so the validator enforces it:
 * a syntactically fine URL on example.com would otherwise let a hand edit "support" a
 * classification with an arbitrary page. The allowlist is PER PROVIDER — an Anthropic row
 * citing an OpenAI property (or vice versa) cannot support that row's provider fact — and
 * shared hosts (github.com) additionally require the row's provider-owned organization path.
 */
export const FIRST_PARTY_SOURCE_HOSTS: Record<'openai' | 'anthropic', readonly string[]> = {
  openai: [
    'developers.openai.com',
    'platform.openai.com',
    'openai.com',
    'help.openai.com',
    'chatgpt.com',
    'learn.chatgpt.com',
  ],
  anthropic: [
    'platform.claude.com',
    'docs.anthropic.com',
    'docs.claude.com',
    'anthropic.com',
    'claude.com',
    'support.anthropic.com',
    'support.claude.com',
    'code.claude.com',
  ],
};

const SHARED_HOST_ORG_PREFIXES: Record<'openai' | 'anthropic', Record<string, string>> = {
  openai: { 'github.com': '/openai/', 'raw.githubusercontent.com': '/openai/' },
  anthropic: { 'github.com': '/anthropics/', 'raw.githubusercontent.com': '/anthropics/' },
};

function isFirstPartySource(u: URL, provider: 'openai' | 'anthropic'): boolean {
  if (FIRST_PARTY_SOURCE_HOSTS[provider].includes(u.hostname)) return true;
  const prefix = SHARED_HOST_ORG_PREFIXES[provider][u.hostname];
  return prefix !== undefined && u.pathname.startsWith(prefix);
}

function isHttpsUrl(v: string, provider: 'openai' | 'anthropic'): boolean {
  try {
    const u = new URL(v);
    if (u.protocol !== 'https:') return false;
    const labels = u.hostname.split('.');
    if (labels.length < 2 || !labels.every((l) => HOST_LABEL_RE.test(l))) return false;
    return isFirstPartySource(u, provider);
  } catch {
    return false;
  }
}

/**
 * Validate the full manifest. Returns typed findings (empty array = valid); every finding
 * names the offending row as `surface/capability_id` so a hand editor can locate it without
 * line numbers. Repairability lives in `code` (§ParityFinding), never in message text.
 */
export function validateParityManifestFindings(m: unknown): ParityFinding[] {
  const findings: ParityFinding[] = [];
  const push = (message: string, code: ParityFinding['code'] = 'invalid'): void => {
    findings.push({ code, message });
  };
  if (typeof m !== 'object' || m === null || Array.isArray(m)) {
    return [{ code: 'invalid', message: 'manifest root must be a JSON object' }];
  }
  const man = m as Record<string, unknown>;

  // Unknown root keys are hard errors for the same reason unknown row keys are: the canonical
  // renderer emits a FIXED root object, so `format` would silently delete anything else —
  // violating its content-preserving contract. Reject before any formatting can happen.
  const ROOT_FIELDS = [
    'schema_version',
    'name',
    'description',
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

  if (man['schema_version'] !== PARITY_SCHEMA_VERSION) {
    push(`schema_version must be ${PARITY_SCHEMA_VERSION}`);
  }
  if (man['name'] !== 'native-experience-parity-v1') {
    push('name must be "native-experience-parity-v1"');
  }
  const snap = man['research_snapshot_date'];
  if (typeof snap !== 'string' || !isCalendarDate(snap)) {
    push('research_snapshot_date must be a real YYYY-MM-DD calendar date');
  }
  if (typeof man['source_anchor'] !== 'string' || !SHA_RE.test(man['source_anchor'] as string)) {
    push('source_anchor must be a 40-hex commit sha');
  }
  for (const f of ['description', 'verify', 'doc'] as const) {
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
    push(`capability_count (${String(man['capability_count'])}) != capabilities.length (${caps.length})`);
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

    // Key-SET violations (missing/extra fields) are hard errors — rendering such a row would
    // fabricate or drop data. A wrong key ORDER over the complete set is merely non-canonical
    // form: renderParityManifest rebuilds rows in ROW_FIELDS order, so the formatter repairs it.
    const keys = Object.keys(r);
    const keySet = new Set(keys);
    const missing = ROW_FIELDS.filter((f) => !keySet.has(f));
    const extra = keys.filter((k) => !(ROW_FIELDS as readonly string[]).includes(k));
    if (missing.length > 0 || extra.length > 0 || keys.length !== ROW_FIELDS.length) {
      push(
        `${where()}: keys must be exactly the ${ROW_FIELDS.length} schema fields` +
          (missing.length > 0 ? ` (missing: ${missing.join(', ')})` : '') +
          (extra.length > 0 ? ` (unknown: ${extra.join(', ')})` : '')
      );
    } else if (ROW_FIELDS.some((f, j) => keys[j] !== f)) {
      push(`${where()}: keys out of canonical order — run \`pnpm docs:parity:format\``, 'key-order');
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
      push(`${where()}: official_source must be a parseable FIRST-PARTY https URL owned by THIS row's provider (shared hosts need that provider's org path)`);
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
      if (!isBool(r[f])) push(`${where()}: ${f} must be boolean`);
    }
    if (boolFields.some((f) => !isBool(r[f]))) return;

    const b = (f: string): boolean => r[f] === true;
    const cls = r['classification'];
    const isApp = (APP_SURFACES as readonly string[]).includes(surface);

    // --- axis coherence -----------------------------------------------------
    if (b('native_route_available') && !b('provider_exposed')) {
      push(`${where()}: native_route_available requires provider_exposed (a route to a capability the provider does not expose is a fiction)`);
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

    // --- product-only cannot masquerade as provider API --------------------
    if (isApp) {
      if (cls !== 'PRODUCT_ONLY') push(`${where()}: app-surface rows must classify PRODUCT_ONLY`);
      if (r['official_status'] !== 'PRODUCT_ONLY') {
        push(`${where()}: app-surface rows must carry official_status PRODUCT_ONLY`);
      }
      if (b('provider_exposed')) {
        push(`${where()}: app-surface rows must not claim provider_exposed (API) status`);
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
        // Continuity proof fields are GovAI-owned axes too — a PRODUCT_ONLY reference row must
        // not claim persistence/resume/fork/correlation work gated on the continuity mission.
        'exact_turn_evidence_correlation',
        'persistence_supported',
        'resume_supported',
        'fork_supported',
      ];
      for (const f of apiAxes) {
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
        if (!b(f)) push(`${where()}: FULL requires ${f}=true`);
      }
      if (
        b('governed_applicable') &&
        !(b('governed_route_available') && b('governed_tested') && b('governed_live_accepted'))
      ) {
        push(`${where()}: FULL with governed_applicable requires the governed axes proven`);
      }
    }
    if (cls === 'MISSING') {
      // EVERY GovAI-owned axis, including the continuity fields — the baseline doc states
      // `MISSING ⇒ no GovAI axes` as a mechanically enforced invariant, so the allowlist must
      // be complete, not merely the axes the implication rules would catch transitively.
      const govai = [
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
      for (const f of govai) {
        if (b(f)) push(`${where()}: MISSING rows must not set ${f}`);
      }
    }
    if (cls === 'PROVIDER_NOT_EXPOSED') {
      if (b('provider_exposed')) {
        push(`${where()}: PROVIDER_NOT_EXPOSED contradicts provider_exposed=true`);
      }
      // Same complete axis discipline as MISSING: a capability the provider does not expose
      // cannot carry any GovAI proof axis — otherwise the baseline mechanically "proves" a
      // provider-native path to something that does not exist.
      const govai = [
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
      for (const f of govai) {
        if (b(f)) push(`${where()}: PROVIDER_NOT_EXPOSED rows must not set ${f}`);
      }
    }
    if ((cls === 'FULL' || cls === 'PARTIAL' || cls === 'BLOCKED_BY_GOVAI') && !b('provider_exposed')) {
      push(`${where()}: ${cls} requires provider_exposed=true`);
    }
    // PARTIAL must be distinguishable from MISSING by an actual GovAI capability path — every
    // legitimate PARTIAL row reaches the capability through a registered native route (directly
    // or as a body/tool feature riding one). Without this, flipping a route-less MISSING row to
    // PARTIAL would certify partial support with every proof axis false.
    if (cls === 'PARTIAL' && !b('native_route_available')) {
      push(`${where()}: PARTIAL requires native_route_available (a GovAI path must exist)`);
    }
    // BLOCKED_BY_GOVAI is a claim that GovAI actively intercepts the capability — impossible
    // without a registered route to receive it on. Both legitimate rows carry registration and
    // the route; a route-less row can be MISSING, never "blocked".
    if (cls === 'BLOCKED_BY_GOVAI' && !(b('govai_registered') && b('native_route_available'))) {
      push(
        `${where()}: BLOCKED_BY_GOVAI requires govai_registered and native_route_available (blocking needs a path to intercept)`
      );
    }
  });

  // Deterministic ordering: surface (declared order), then family, then capability_id.
  // Runs only once every row is narrowed to an object — a structurally invalid row is already
  // reported above, and dereferencing it here would throw instead of returning findings
  // (the validator's contract on unknown input is findings, never exceptions).
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
          'must sort by (surface, family, capability_id) — run `pnpm docs:parity:format`',
        'row-order'
      );
      break;
    }
  }

  return findings;
}

/**
 * String façade over validateParityManifestFindings — human-readable messages only.
 * Kept as the simple assertion surface for tests and callers that don't branch on
 * repairability; anything deciding what `format` may repair MUST use the typed function.
 */
export function validateParityManifest(m: unknown): string[] {
  return validateParityManifestFindings(m).map((f) => f.message);
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
