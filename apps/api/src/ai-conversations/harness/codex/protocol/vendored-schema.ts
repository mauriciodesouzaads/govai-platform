// CONT-P5-A — read-only access to the vendored pinned schema (conformance support for tests and later probes).
//
// Everything here READS the committed files next to this module; nothing fetches, generates or writes. The
// scanner applies the same rules the executor's derivation used, so a test can re-derive every inventory
// classification from ./generated/** instead of trusting the table:
//   * top-level object KEYS at depth 1 of a type alias (quoted or bare, `?` optional or not);
//   * string-literal union MEMBERS at depth 0;
//   * `(key, "literal")` PAIRS at depth 1 — the discriminators of internally-tagged enums (`"type": "readOnly"`,
//     `"mode": "openai/userVerification"`).
// Comments are stripped first, so a word inside a doc comment never counts as a key.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HARNESS_CODEX_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const VENDORED_TS_DIR = join(HARNESS_CODEX_DIR, 'protocol', 'generated');

export const PROVENANCE_BEGIN_PREFIX = '// GOVAI-PROVENANCE-BEGIN';
export const PROVENANCE_END_LINE = '// GOVAI-PROVENANCE-END';

export const PROVENANCE_FIELDS = [
  'PIN_RELEASE',
  'PIN_TAG',
  'PIN_COMMIT',
  'SOURCE_PATH_OR_SCHEMA',
  'SOURCE_SHA256',
  'GENERATOR_IDENTITY',
  'GENERATOR_VERSION',
  'GENERATOR_CONFIG',
  'DERIVATION_MODE',
] as const;

export type ProvenanceField = (typeof PROVENANCE_FIELDS)[number];

export type SplitProvenance = {
  /** First line of each `// FIELD = value` entry (continuation lines are not folded in). */
  readonly fields: Readonly<Partial<Record<ProvenanceField, string>>>;
  readonly headerText: string;
  /** Everything after the `GOVAI-PROVENANCE-END` line — for vendored files, the upstream bytes verbatim. */
  readonly body: Buffer;
};

/** Split a file into its GovAI provenance header and the bytes after it; `null` if the header is absent. */
export function splitProvenance(bytes: Buffer): SplitProvenance | null {
  const text = bytes.toString('utf8');
  if (!text.startsWith(PROVENANCE_BEGIN_PREFIX)) return null;
  const endMarker = `\n${PROVENANCE_END_LINE}\n`;
  const at = text.indexOf(endMarker);
  if (at === -1) return null;
  const headerText = text.slice(0, at + endMarker.length);
  const fields: Partial<Record<ProvenanceField, string>> = {};
  for (const line of headerText.split('\n')) {
    const m = /^\/\/ ([A-Z_0-9]+)\s+= (.*)$/.exec(line);
    if (m && (PROVENANCE_FIELDS as readonly string[]).includes(m[1] ?? '')) {
      fields[m[1] as ProvenanceField] = m[2] ?? '';
    }
  }
  return { fields, headerText, body: bytes.subarray(Buffer.byteLength(headerText, 'utf8')) };
}

/** Relative POSIX paths of every vendored TypeScript file under ./generated, sorted. */
export function listVendoredTypeScript(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(relative(VENDORED_TS_DIR, full).split(sep).join('/'));
    }
  };
  walk(VENDORED_TS_DIR);
  return out.sort();
}

/** The upstream bytes of a vendored file (provenance header removed), as UTF-8 text. */
export function readVendoredBody(relPath: string): string {
  const bytes = readFileSync(join(VENDORED_TS_DIR, relPath));
  const split = splitProvenance(bytes);
  if (split === null) throw new Error(`vendored file without provenance header: ${relPath}`);
  return split.body.toString('utf8');
}

/** Locate the generated file declaring `typeName` (v2/ first, then the root), or `null`. */
export function vendoredFileForType(typeName: string, files: readonly string[] = listVendoredTypeScript()): string | null {
  for (const candidate of [`v2/${typeName}.ts`, `${typeName}.ts`]) if (files.includes(candidate)) return candidate;
  return null;
}

export function stripTsComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** Text after `export type <name> =` (comments stripped), or `null` when the alias is not declared. */
export function aliasBody(text: string, typeName: string): string | null {
  const stripped = stripTsComments(text);
  const m = new RegExp(`export type ${typeName}\\s*=\\s*`).exec(stripped);
  return m === null ? null : stripped.slice(m.index + m[0].length);
}

export type AliasScan = {
  readonly keys: ReadonlySet<string>;
  readonly literals: ReadonlySet<string>;
  /** `${key}=${literal}` for depth-1 properties whose value is a string literal. */
  readonly pairs: ReadonlySet<string>;
};

export function scanAlias(body: string): AliasScan {
  const keys = new Set<string>();
  const literals = new Set<string>();
  const pairs = new Set<string>();
  let depth = 0;
  let i = 0;
  const n = body.length;
  const lastNonSpace = (end: number): string => {
    for (let k = end - 1; k >= 0; k -= 1) if (!/\s/.test(body[k] ?? '')) return body[k] ?? '';
    return '';
  };
  const valueLiteral = (from: number): string | null => {
    const m = /^\s*\??\s*:\s*"([^"]+)"/.exec(body.slice(from));
    return m === null ? null : (m[1] ?? null);
  };
  while (i < n) {
    const c = body[i] ?? '';
    if (c === '"') {
      let j = i + 1;
      while (j < n && body[j] !== '"') j += body[j] === '\\' ? 2 : 1;
      const lit = body.slice(i + 1, j);
      const rest = body.slice(j + 1).trimStart();
      if (depth === 1 && (rest.startsWith(':') || rest.startsWith('?:'))) {
        keys.add(lit);
        const v = valueLiteral(j + 1);
        if (v !== null) pairs.add(`${lit}=${v}`);
      } else if (depth === 0) {
        literals.add(lit);
      }
      i = j + 1;
      continue;
    }
    if ('{([<'.includes(c)) depth += 1;
    else if ('})]>'.includes(c)) depth -= 1;
    else if (c === ';' && depth === 0) break;
    else if (depth === 1 && /[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(body[j] ?? '')) j += 1;
      const word = body.slice(i, j);
      const rest = body.slice(j).trimStart();
      if ('{,;'.includes(lastNonSpace(i)) && (rest.startsWith(':') || rest.startsWith('?:'))) {
        keys.add(word);
        const v = valueLiteral(j);
        if (v !== null) pairs.add(`${word}=${v}`);
      }
      i = j;
      continue;
    }
    i += 1;
  }
  return { keys, literals, pairs };
}

/** `"method"` arms of a generated union alias, in declaration order. */
export function unionMethods(text: string, typeName: string): string[] {
  const body = aliasBody(text, typeName);
  if (body === null) return [];
  return [...body.matchAll(/"method":\s*"([^"]+)"/g)].map((m) => m[1] ?? '');
}

/** `method -> params type name` of the generated `ClientRequest` union (`params?:` arms included). */
export function clientRequestParamsTypes(clientRequestText: string): Map<string, string> {
  const body = aliasBody(clientRequestText, 'ClientRequest') ?? '';
  const out = new Map<string, string>();
  for (const m of body.matchAll(/\{\s*"method":\s*"([^"]+)",\s*id:\s*RequestId,\s*params\??:\s*([A-Za-z0-9_]+)/g)) {
    out.set(m[1] ?? '', m[2] ?? '');
  }
  return out;
}

/** Top-level `(name, typeText)` properties of the object literal(s) of an alias body. */
export function topLevelProperties(body: string): { readonly name: string; readonly type: string }[] {
  const props: { name: string; type: string }[] = [];
  let depth = 0;
  let i = 0;
  const n = body.length;
  while (i < n) {
    const c = body[i] ?? '';
    if (c === '"' && depth !== 1) {
      let j = i + 1;
      while (j < n && body[j] !== '"') j += 1;
      i = j + 1;
      continue;
    }
    if ('{([<'.includes(c)) {
      depth += 1;
      i += 1;
      continue;
    }
    if ('})]>'.includes(c)) {
      depth -= 1;
      i += 1;
      continue;
    }
    if (c === ';' && depth === 0) break;
    if (depth === 1) {
      const m = /^\s*(?:"([^"]+)"|([A-Za-z_$][A-Za-z0-9_$]*))\s*\??\s*:/.exec(body.slice(i));
      const prev = body.slice(0, i).trimEnd().slice(-1);
      if (m !== null && (prev === '{' || prev === ',' || prev === '')) {
        const name = m[1] ?? m[2] ?? '';
        let k = i + m[0].length;
        const start = k;
        let d = 0;
        while (k < n) {
          const ch = body[k] ?? '';
          if (ch === '"') {
            k += 1;
            while (k < n && body[k] !== '"') k += 1;
          } else if ('{([<'.includes(ch)) d += 1;
          else if ('})]>'.includes(ch)) {
            if (d === 0) break;
            d -= 1;
          } else if (ch === ',' && d === 0) break;
          k += 1;
        }
        props.push({ name, type: body.slice(start, k).trim() });
        i = k;
        continue;
      }
    }
    i += 1;
  }
  return props;
}
