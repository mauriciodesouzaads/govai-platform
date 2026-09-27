// CONT-P5-E1 — fixture and project invariants and the fixture config state validator (Dispatch v8 M5, carried from
// v1-v3; Correction 08 sections 6-7; Correction 09 section 4).
//
// ★ INV-PATH   the path is absolute, has no "." / ".." segment and realpath(path) == path (no symlink in any
//              component, canonical spelling). It is the ONLY cwd normalization in the harness and it runs at
//              admission — never at requested/effective comparison time.
// ★ INV-PROJ   for every lexical ancestor of the cwd, from the cwd to "/" INCLUSIVE, lstat of exactly
//              `<dir>/.codex/config.toml` must fail with ENOENT; any other result (the file exists, EACCES, ELOOP,
//              ENOTDIR on a component, anything unknown) fails closed. A fixture whose CODEX_HOME basename is
//              ".codex" is refused, so the loader's CODEX_HOME exception is never exercised.
// ★ INV-REPO   either (a) exactly one `.git` marker on the chain, at the workspace root W: a real directory (not a
//              symlink, not a `gitdir:` file) holding a regular HEAD file; or (b) no `.git` entry on the whole chain
//              to "/". Linked worktrees, separate git-dirs, ambiguous roots and aliases are rejected, not supported.
// ★ FIXTURE_CONFIG_STATE  a SEMANTIC validator of CODEX_HOME/config.toml (parsed structure, never bytes, except the
//              sealed STATE_0 byte identity checked before the first workspace-write start):
//                STATE_0 = { features = { shell_snapshot = false } } exactly (the sealed 34-byte E1 fixture config);
//                STATE_1 = STATE_0 plus exactly one entry projects.<K> = { trust_level = "trusted" }, K allowed;
//                anything else is UNAUTHORIZED (STOP). It reads exactly CODEX_HOME/config.toml (never auth.json,
//              never outside it), refuses a symlink there, and parses a fail-closed TOML subset: any construct
//              outside the subset is UNAUTHORIZED, never guessed.
// ★ DETECTORS, NOT PREVENTION. Post-consume checks are DETECTORS: they report an observed state after the fact and
//   can neither prove that nothing changed in between nor undo a session initialization. Nothing here claims
//   isolation from other same-user processes; that exclusion is the explicit E1 assumption below.

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, type Stats } from 'node:fs';
import { basename } from 'node:path';

// ---------------------------------------------------------------------------------------------------------
// The two explicit E1 assumptions and the harness-start acknowledgement (Correction 09 section 4; Correction 08 5.1)
// ---------------------------------------------------------------------------------------------------------

/**
 * Writer C (an unrelated process running as the same ordinary user) is OUT OF SCOPE for E1 by explicit assumption:
 * the harness neither implements nor claims same-user write isolation. An observed violation stops the run.
 */
export const E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION = Object.freeze({
  id: 'E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION',
  scope: 'E1_ONLY',
  writerCScope: 'OUT_OF_SCOPE_CONTROLLED_ASSUMPTION',
  statement:
    'During every bounded effective-feature admission interval (from the completion of the pre-attestation invariant ' +
    'checks through the upstream consumption of the Config that initializes or reconstructs the protected runtime), no ' +
    'unrelated process running under the same ordinary user identity mutates, replaces, renames, creates or removes ' +
    'CODEX_HOME, CODEX_HOME/config.toml, any <dir>/.codex or <dir>/.codex/config.toml candidate on a relevant cwd chain, ' +
    'or the repository topology (.git markers, worktree or gitdir indirections) used to select those candidates.',
  onObservedViolation: 'E1_INFRA_FAILURE_RUN_STOPS',
  isolationClaim: 'NONE',
  productionSecurityClaim: 'NONE',
});

/** Writer H (privileged administrator / MDM / root) is OUT OF SCOPE for E1 by explicit assumption. */
export const E1_CONTROLLED_ENVIRONMENT_ASSUMPTION = Object.freeze({
  id: 'E1_CONTROLLED_ENVIRONMENT_ASSUMPTION',
  scope: 'E1_ONLY',
  statement:
    'No privileged / MDM / root actor intentionally mutates system, managed or cloud configuration relevant to ' +
    'shell_snapshot or shell_snapshot_v2 during any bounded admission interval (ATTEST .. CONSUME) of an E1 protected ' +
    'operation.',
  privilegedConcurrentHostMutation: 'OUT_OF_SCOPE',
  productionSecurityClaim: 'NONE',
});

export const E1_ACKNOWLEDGED_ASSUMPTIONS = [
  E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION.id,
  E1_CONTROLLED_ENVIRONMENT_ASSUMPTION.id,
] as const;

/**
 * The documented acknowledgement an E1 harness must be started with. It is a flag, NOT a detection claim: nothing
 * observes other processes; the operator states that the controlled environment holds for the run.
 */
export type E1ControlledEnvironmentAcknowledgement = Readonly<{
  acknowledgedAssumptions: typeof E1_ACKNOWLEDGED_ASSUMPTIONS;
  /** Who states it for this run (e.g. the authorizing grant id). */
  acknowledgedBy: string;
}>;

export class E1ControlledEnvironmentNotAcknowledged extends Error {
  readonly code = 'e1_controlled_environment_not_acknowledged';
  constructor() {
    super('E1 harness start refused: the controlled-environment assumptions were not acknowledged');
    this.name = 'E1ControlledEnvironmentNotAcknowledged';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Harness-start gate: throws unless both E1 assumptions are acknowledged explicitly, by a named party. */
export function assertE1ControlledEnvironmentAcknowledged(ack: unknown): asserts ack is E1ControlledEnvironmentAcknowledgement {
  if (!isRecord(ack)) throw new E1ControlledEnvironmentNotAcknowledged();
  const assumptions = ack['acknowledgedAssumptions'];
  const by = ack['acknowledgedBy'];
  if (
    !Array.isArray(assumptions) ||
    assumptions.length !== E1_ACKNOWLEDGED_ASSUMPTIONS.length ||
    !E1_ACKNOWLEDGED_ASSUMPTIONS.every((id, i) => assumptions[i] === id) ||
    typeof by !== 'string' ||
    by.trim().length === 0
  ) {
    throw new E1ControlledEnvironmentNotAcknowledged();
  }
}

// ---------------------------------------------------------------------------------------------------------
// INV-PATH / INV-PROJ / INV-REPO
// ---------------------------------------------------------------------------------------------------------

export type FixtureInvariantName = 'INV-PATH' | 'INV-PROJ' | 'INV-REPO';

export type FixtureInvariantFailureReason =
  | 'INV_PATH_NOT_A_STRING'
  | 'INV_PATH_NOT_ABSOLUTE'
  | 'INV_PATH_DOT_SEGMENT'
  | 'INV_PATH_UNRESOLVABLE'
  | 'INV_PATH_REALPATH_DIFFERS'
  | 'INV_PROJ_CODEX_HOME_SHAPE_FORBIDDEN'
  | 'INV_PROJ_PROJECT_CONFIG_PRESENT'
  | 'INV_PROJ_LSTAT_NOT_ENOENT'
  | 'INV_REPO_CWD_INSIDE_GIT_DIRECTORY'
  | 'INV_REPO_AMBIGUOUS_ROOTS'
  | 'INV_REPO_MARKER_NOT_A_DIRECTORY'
  | 'INV_REPO_HEAD_MISSING'
  | 'INV_REPO_LSTAT_NOT_ENOENT';

export type FixtureInvariantFailure = Readonly<{
  ok: false;
  invariant: FixtureInvariantName;
  reason: FixtureInvariantFailureReason;
  /** The path concerned (in-process diagnostics; evidence records the bounded reason only). */
  at: string;
}>;

export type FixtureInvariantCheck = { readonly ok: true } | FixtureInvariantFailure;

/** Repository topology of a cwd chain (Correction 08 section 6, INV-REPO (a) / (b)). */
export type RepoTopology =
  | Readonly<{ topology: 'A_WORKSPACE_REPOSITORY'; workspaceRoot: string }>
  | Readonly<{ topology: 'B_NO_REPOSITORY' }>;

const OK: FixtureInvariantCheck = Object.freeze({ ok: true });

function fail(invariant: FixtureInvariantName, reason: FixtureInvariantFailureReason, at: string): FixtureInvariantFailure {
  return Object.freeze({ ok: false, invariant, reason, at });
}

function errorCode(error: unknown): string | undefined {
  return isRecord(error) && typeof error['code'] === 'string' ? error['code'] : undefined;
}

/** `/a/b/c` -> [`/a/b/c`, `/a/b`, `/a`, `/`]: lexical only, never resolved (INV-PATH makes lexical == physical). */
export function lexicalAncestorsInclusive(cwd: string): string[] {
  const out: string[] = [];
  let dir = cwd;
  for (;;) {
    out.push(dir);
    if (dir === '/') return out;
    const cut = dir.lastIndexOf('/');
    dir = cut <= 0 ? '/' : dir.slice(0, cut);
  }
}

function under(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

/** lstat that reports ENOENT as `absent` and never throws: any other failure is returned as its error code. */
function lstatOrAbsent(path: string): { readonly stats: Stats } | { readonly absent: true } | { readonly error: string } {
  try {
    return { stats: lstatSync(path) };
  } catch (error) {
    const code = errorCode(error);
    return code === 'ENOENT' ? { absent: true } : { error: code ?? 'UNKNOWN' };
  }
}

export function verifyInvPath(cwd: unknown): FixtureInvariantCheck {
  if (typeof cwd !== 'string' || cwd.length === 0) return fail('INV-PATH', 'INV_PATH_NOT_A_STRING', String(cwd));
  if (!cwd.startsWith('/')) return fail('INV-PATH', 'INV_PATH_NOT_ABSOLUTE', cwd);
  if (cwd.split('/').some((segment) => segment === '.' || segment === '..')) return fail('INV-PATH', 'INV_PATH_DOT_SEGMENT', cwd);
  let real: string;
  try {
    real = realpathSync.native(cwd);
  } catch {
    return fail('INV-PATH', 'INV_PATH_UNRESOLVABLE', cwd);
  }
  return real === cwd ? OK : fail('INV-PATH', 'INV_PATH_REALPATH_DIFFERS', cwd);
}

export function verifyInvProj(cwd: string, codexHome: string): FixtureInvariantCheck {
  if (basename(codexHome) === '.codex') return fail('INV-PROJ', 'INV_PROJ_CODEX_HOME_SHAPE_FORBIDDEN', codexHome);
  for (const dir of lexicalAncestorsInclusive(cwd)) {
    const candidate = under(under(dir, '.codex'), 'config.toml');
    const probe = lstatOrAbsent(candidate);
    if ('absent' in probe) continue;
    return 'stats' in probe
      ? fail('INV-PROJ', 'INV_PROJ_PROJECT_CONFIG_PRESENT', candidate)
      : fail('INV-PROJ', 'INV_PROJ_LSTAT_NOT_ENOENT', candidate);
  }
  return OK;
}

export type InvRepoResult = { readonly ok: true; readonly topology: RepoTopology } | FixtureInvariantFailure;

export function verifyInvRepo(cwd: string): InvRepoResult {
  if (cwd.split('/').includes('.git')) return fail('INV-REPO', 'INV_REPO_CWD_INSIDE_GIT_DIRECTORY', cwd);
  const markers: { readonly dir: string; readonly stats: Stats }[] = [];
  for (const dir of lexicalAncestorsInclusive(cwd)) {
    const marker = under(dir, '.git');
    const probe = lstatOrAbsent(marker);
    if ('absent' in probe) continue;
    if ('error' in probe) return fail('INV-REPO', 'INV_REPO_LSTAT_NOT_ENOENT', marker);
    markers.push({ dir, stats: probe.stats });
  }
  if (markers.length === 0) return Object.freeze({ ok: true, topology: Object.freeze({ topology: 'B_NO_REPOSITORY' }) });
  if (markers.length > 1) return fail('INV-REPO', 'INV_REPO_AMBIGUOUS_ROOTS', markers[1]?.dir ?? cwd);
  const root = markers[0]!;
  // A symlink (alias) or a `gitdir:` file (linked worktree / separate git-dir) is not a directory under lstat.
  if (!root.stats.isDirectory()) return fail('INV-REPO', 'INV_REPO_MARKER_NOT_A_DIRECTORY', under(root.dir, '.git'));
  const head = lstatOrAbsent(under(under(root.dir, '.git'), 'HEAD'));
  if ('error' in head) return fail('INV-REPO', 'INV_REPO_LSTAT_NOT_ENOENT', under(root.dir, '.git'));
  if (!('stats' in head) || !head.stats.isFile()) return fail('INV-REPO', 'INV_REPO_HEAD_MISSING', under(root.dir, '.git'));
  return Object.freeze({ ok: true, topology: Object.freeze({ topology: 'A_WORKSPACE_REPOSITORY', workspaceRoot: root.dir }) });
}

// ---------------------------------------------------------------------------------------------------------
// Trust key (Correction 08 section 7 ALLOWED_TRUST_KEYS)
// ---------------------------------------------------------------------------------------------------------

/**
 * The `projects` key of a trust target. PIN source reference (app-server/src/request_processors/thread_processor.rs):
 * the trust target is `resolve_root_git_project_for_trust(cwd)`, else the cwd (L1353-L1355); it is persisted by
 * `codex_core::config::set_project_trust_level(codex_home, trust_target, Trusted)` (L1358-L1362), and the in-memory
 * fallback keys `projects` with `project_trust_key(trust_target)` (L1375; the function lives in
 * codex-rs/config/src/loader/mod.rs and is imported at app-server/src/request_processors.rs L335). GovAI computes the
 * key from the ADMITTED path, never from the file, and only inside the INV-PATH domain (absolute, no dot segment,
 * realpath == lexical), where it is the path string itself. A key this validator does not recognise is never
 * accepted: STATE_1 with any other key is UNAUTHORIZED (STOP), so a divergent spelling fails closed.
 */
export function projectTrustKey(trustTarget: string): string {
  return trustTarget;
}

/** The trust target of an admitted thread/start cwd: W under INV-REPO (a), the cwd itself under (b). */
export function trustTargetOf(cwd: string, topology: RepoTopology): string {
  return topology.topology === 'A_WORKSPACE_REPOSITORY' ? topology.workspaceRoot : cwd;
}

// ---------------------------------------------------------------------------------------------------------
// FIXTURE_CONFIG_STATE — semantic validator over a fail-closed TOML subset
// ---------------------------------------------------------------------------------------------------------

/** The sealed E1 fixture config (STATE_0 by definition): 34 bytes. */
export const E1_FIXTURE_CONFIG_TEXT = '[features]\nshell_snapshot = false\n';
export const E1_FIXTURE_CONFIG_BYTE_COUNT = 34;
export const E1_FIXTURE_CONFIG_SHA256 = '4a34b508f14cca64f91c78ecc8dbbc3f4d728c9cc542698cce33f79d33f89e24';

/** Upper bound for the file read (a config beyond it is UNAUTHORIZED, never streamed). */
export const FIXTURE_CONFIG_MAX_BYTES = 64 * 1024;

export type FixtureConfigUnauthorizedReason =
  | 'FIXTURE_CODEX_HOME_NOT_CANONICAL'
  | 'FIXTURE_CONFIG_MISSING'
  | 'FIXTURE_CONFIG_NOT_A_REGULAR_FILE'
  | 'FIXTURE_CONFIG_UNREADABLE'
  | 'FIXTURE_CONFIG_TOO_LARGE'
  | 'FIXTURE_CONFIG_NOT_UTF8'
  | 'FIXTURE_CONFIG_UNPARSEABLE'
  | 'FIXTURE_CONFIG_FEATURES_CHANGED'
  | 'FIXTURE_CONFIG_UNEXPECTED_TOP_LEVEL_KEY'
  | 'FIXTURE_CONFIG_PROJECTS_MALFORMED'
  | 'FIXTURE_CONFIG_PROJECTS_ENTRY_COUNT'
  | 'FIXTURE_CONFIG_TRUST_KEY_NOT_ALLOWED'
  | 'FIXTURE_CONFIG_PROJECT_FIELDS_CHANGED'
  | 'FIXTURE_CONFIG_TRUST_LEVEL_NOT_TRUSTED';

export type FixtureConfigState =
  | Readonly<{ state: 'STATE_0' }>
  | Readonly<{ state: 'STATE_1'; trustKey: string }>
  | Readonly<{ state: 'UNAUTHORIZED'; reason: FixtureConfigUnauthorizedReason }>;

type TomlValue = boolean | string | TomlTable;
type TomlTable = Map<string, TomlValue>;

const BARE_KEY_CHAR = /[A-Za-z0-9_-]/;

/**
 * Line-oriented parser for the TOML subset this fixture can legitimately contain: comments, blank lines, `[table]`
 * headers with dotted bare / basic-string / literal-string keys, and `key = value` pairs whose value is a boolean, a
 * single-line basic string or a single-line literal string. Returns `null` for anything else (arrays of tables,
 * inline tables, arrays, numbers, dates, multi-line strings, duplicate definitions, reopened tables).
 */
function parseTomlSubset(text: string): TomlTable | null {
  const root: TomlTable = new Map();
  const headerDefined = new Set<TomlTable>();
  const dottedDefined = new Set<TomlTable>();
  let current = root;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    let i = 0;
    const skipWs = (): void => {
      while (line[i] === ' ' || line[i] === '\t') i += 1;
    };
    const atLineEnd = (): boolean => {
      skipWs();
      return i >= line.length || line[i] === '#';
    };
    const basicString = (): string | null => {
      if (line.startsWith('"""', i)) return null;
      i += 1;
      let out = '';
      while (i < line.length) {
        const c = line[i]!;
        if (c === '"') {
          i += 1;
          return out;
        }
        const code = c.charCodeAt(0);
        if ((code < 0x20 && c !== '\t') || code === 0x7f) return null;
        if (c === '\\') {
          const e = line[i + 1];
          const simple: Record<string, string> = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };
          if (e !== undefined && Object.hasOwn(simple, e)) {
            out += simple[e];
            i += 2;
            continue;
          }
          const width = e === 'u' ? 4 : e === 'U' ? 8 : 0;
          const hex = line.slice(i + 2, i + 2 + width);
          if (width === 0 || !new RegExp(`^[0-9A-Fa-f]{${width}}$`).test(hex)) return null;
          const scalar = Number.parseInt(hex, 16);
          if (scalar > 0x10ffff || (scalar >= 0xd800 && scalar <= 0xdfff)) return null;
          out += String.fromCodePoint(scalar);
          i += 2 + width;
          continue;
        }
        out += c;
        i += 1;
      }
      return null;
    };
    const literalString = (): string | null => {
      if (line.startsWith("'''", i)) return null;
      const end = line.indexOf("'", i + 1);
      if (end === -1) return null;
      const body = line.slice(i + 1, end);
      if ([...body].some((c) => (c.charCodeAt(0) < 0x20 && c !== '\t') || c.charCodeAt(0) === 0x7f)) return null;
      i = end + 1;
      return body;
    };
    const simpleKey = (): string | null => {
      skipWs();
      if (line[i] === '"') return basicString();
      if (line[i] === "'") return literalString();
      const start = i;
      while (i < line.length && BARE_KEY_CHAR.test(line[i]!)) i += 1;
      return i > start ? line.slice(start, i) : null;
    };
    const dottedKey = (): string[] | null => {
      const parts: string[] = [];
      for (;;) {
        const part = simpleKey();
        if (part === null) return null;
        parts.push(part);
        skipWs();
        if (line[i] !== '.') return parts;
        i += 1;
      }
    };

    if (atLineEnd()) continue;

    if (line[i] === '[') {
      if (line[i + 1] === '[') return null; // array of tables: outside the subset
      i += 1;
      const path = dottedKey();
      skipWs();
      if (path === null || line[i] !== ']') return null;
      i += 1;
      if (!atLineEnd()) return null;
      let table = root;
      for (let k = 0; k < path.length; k += 1) {
        const key = path[k]!;
        const existing = table.get(key);
        const last = k === path.length - 1;
        if (existing === undefined) {
          const created: TomlTable = new Map();
          table.set(key, created);
          table = created;
        } else if (existing instanceof Map && !dottedDefined.has(existing) && !(last && headerDefined.has(existing))) {
          table = existing;
        } else {
          return null;
        }
      }
      headerDefined.add(table);
      current = table;
      continue;
    }

    const path = dottedKey();
    skipWs();
    if (path === null || line[i] !== '=') return null;
    i += 1;
    skipWs();
    let value: TomlValue | null;
    if (line[i] === '"') value = basicString();
    else if (line[i] === "'") value = literalString();
    else if (line.startsWith('true', i) && !BARE_KEY_CHAR.test(line[i + 4] ?? ' ')) {
      value = true;
      i += 4;
    } else if (line.startsWith('false', i) && !BARE_KEY_CHAR.test(line[i + 5] ?? ' ')) {
      value = false;
      i += 5;
    } else value = null;
    if (value === null || !atLineEnd()) return null;
    let table = current;
    for (const key of path.slice(0, -1)) {
      const existing = table.get(key);
      if (existing === undefined) {
        const created: TomlTable = new Map();
        dottedDefined.add(created);
        table.set(key, created);
        table = created;
      } else if (existing instanceof Map && dottedDefined.has(existing)) {
        table = existing;
      } else {
        return null;
      }
    }
    const leaf = path.at(-1)!;
    if (table.has(leaf)) return null;
    table.set(leaf, value);
  }
  return root;
}

function unauthorized(reason: FixtureConfigUnauthorizedReason): FixtureConfigState {
  return Object.freeze({ state: 'UNAUTHORIZED', reason });
}

/** Semantic classification of config.toml TEXT into STATE_0 / STATE_1 / UNAUTHORIZED (pure; never compares bytes). */
export function classifyFixtureConfigText(text: string, allowedTrustKeys: readonly string[]): FixtureConfigState {
  const doc = parseTomlSubset(text);
  if (doc === null) return unauthorized('FIXTURE_CONFIG_UNPARSEABLE');
  const features = doc.get('features');
  if (!(features instanceof Map) || features.size !== 1 || features.get('shell_snapshot') !== false) {
    return unauthorized('FIXTURE_CONFIG_FEATURES_CHANGED');
  }
  for (const key of doc.keys()) {
    if (key !== 'features' && key !== 'projects') return unauthorized('FIXTURE_CONFIG_UNEXPECTED_TOP_LEVEL_KEY');
  }
  if (!doc.has('projects')) return Object.freeze({ state: 'STATE_0' });
  const projects = doc.get('projects');
  if (!(projects instanceof Map)) return unauthorized('FIXTURE_CONFIG_PROJECTS_MALFORMED');
  if (projects.size !== 1) return unauthorized('FIXTURE_CONFIG_PROJECTS_ENTRY_COUNT');
  const [trustKey, entry] = [...projects.entries()][0]!;
  if (!allowedTrustKeys.includes(trustKey)) return unauthorized('FIXTURE_CONFIG_TRUST_KEY_NOT_ALLOWED');
  if (!(entry instanceof Map) || entry.size !== 1 || !entry.has('trust_level')) {
    return unauthorized('FIXTURE_CONFIG_PROJECT_FIELDS_CHANGED');
  }
  if (entry.get('trust_level') !== 'trusted') return unauthorized('FIXTURE_CONFIG_TRUST_LEVEL_NOT_TRUSTED');
  return Object.freeze({ state: 'STATE_1', trustKey });
}

export type FixtureConfigObservation = Readonly<{
  classification: FixtureConfigState;
  /** The file is byte-identical to the sealed 34-byte STATE_0 fixture config. */
  sealedStateZeroBytes: boolean;
}>;

/**
 * Reads EXACTLY `<codexHome>/config.toml` (O_NOFOLLOW: a symlink there fails closed) and classifies it. CODEX_HOME must
 * itself be canonical. Nothing else is opened; auth.json is never read.
 */
export function readFixtureConfigState(codexHome: string, allowedTrustKeys: readonly string[]): FixtureConfigObservation {
  const observe = (classification: FixtureConfigState, sealedStateZeroBytes = false): FixtureConfigObservation =>
    Object.freeze({ classification, sealedStateZeroBytes });
  let canonical: string;
  try {
    canonical = realpathSync.native(codexHome);
  } catch {
    return observe(unauthorized('FIXTURE_CODEX_HOME_NOT_CANONICAL'));
  }
  if (canonical !== codexHome || !codexHome.startsWith('/')) return observe(unauthorized('FIXTURE_CODEX_HOME_NOT_CANONICAL'));
  const path = under(codexHome, 'config.toml');
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ENOENT') return observe(unauthorized('FIXTURE_CONFIG_MISSING'));
    if (code === 'ELOOP' || code === 'EMLINK') return observe(unauthorized('FIXTURE_CONFIG_NOT_A_REGULAR_FILE'));
    return observe(unauthorized('FIXTURE_CONFIG_UNREADABLE'));
  }
  let bytes: Buffer;
  try {
    const stats = fstatSync(fd);
    if (!stats.isFile()) return observe(unauthorized('FIXTURE_CONFIG_NOT_A_REGULAR_FILE'));
    if (stats.size > FIXTURE_CONFIG_MAX_BYTES) return observe(unauthorized('FIXTURE_CONFIG_TOO_LARGE'));
    const buffer = Buffer.alloc(FIXTURE_CONFIG_MAX_BYTES + 1);
    let length = 0;
    for (;;) {
      const n = readSync(fd, buffer, length, buffer.length - length, null);
      if (n === 0) break;
      length += n;
      if (length > FIXTURE_CONFIG_MAX_BYTES) return observe(unauthorized('FIXTURE_CONFIG_TOO_LARGE'));
    }
    bytes = buffer.subarray(0, length);
  } catch {
    return observe(unauthorized('FIXTURE_CONFIG_UNREADABLE'));
  } finally {
    closeSync(fd);
  }
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return observe(unauthorized('FIXTURE_CONFIG_NOT_UTF8'));
  }
  const sealed =
    bytes.length === E1_FIXTURE_CONFIG_BYTE_COUNT && createHash('sha256').update(bytes).digest('hex') === E1_FIXTURE_CONFIG_SHA256;
  return observe(classifyFixtureConfigText(text, allowedTrustKeys), sealed);
}

// ---------------------------------------------------------------------------------------------------------
// Admission pre-checks (gate token issue) and post-consume DETECTORS
// ---------------------------------------------------------------------------------------------------------

export type AdmissionPreconditionInput = Readonly<{
  codexHome: string;
  /** The app-server process working directory (launch workDir). */
  launchCwd: string;
  /** The exact cwd of the bound request. */
  requestedCwd: string;
  /** Persisted history cwds the harness knows could be selected (verified defensively). */
  knownHistoryCwds?: readonly string[];
  allowedTrustKeys: readonly string[];
  /** Before the first admitted workspace-write thread/start the config must also be the sealed STATE_0 bytes. */
  requireSealedStateZeroBytes: boolean;
}>;

export type AdmissionPreconditionProof = Readonly<{
  requestedCwd: string;
  verifiedCwds: readonly string[];
  requestedCwdTopology: RepoTopology;
  fixtureConfigState: 'STATE_0' | 'STATE_1';
  fixtureTrustKey: string | null;
  sealedStateZeroBytesVerified: boolean;
}>;

export type AdmissionPreconditionFailure =
  | FixtureInvariantFailure
  | Readonly<{ ok: false; invariant: 'FIXTURE_CONFIG_STATE'; reason: FixtureConfigUnauthorizedReason | 'FIXTURE_CONFIG_SEALED_STATE_ZERO_BYTES_MISMATCH'; at: string }>;

export type AdmissionPreconditionResult =
  | { readonly status: 'VERIFIED'; readonly proof: AdmissionPreconditionProof }
  | { readonly status: 'FAILED'; readonly failure: AdmissionPreconditionFailure };

/** INV-PATH, then INV-PROJ, then INV-REPO for one cwd (INV-PROJ / INV-REPO only on an INV-PATH-valid path). */
export function verifyCwdInvariants(cwd: string, codexHome: string): InvRepoResult {
  const path = verifyInvPath(cwd);
  if (!path.ok) return path;
  const proj = verifyInvProj(cwd, codexHome);
  if (!proj.ok) return proj;
  return verifyInvRepo(cwd);
}

/**
 * The pre-checks that gate token issue: INV-PATH / INV-PROJ / INV-REPO for the requested cwd, the launch cwd and every
 * known history cwd, then FIXTURE_CONFIG_STATE in {STATE_0, STATE_1} (plus the sealed STATE_0 bytes when required).
 */
export function verifyAdmissionPreconditions(input: AdmissionPreconditionInput): AdmissionPreconditionResult {
  const cwds = [...new Set([input.requestedCwd, input.launchCwd, ...(input.knownHistoryCwds ?? [])])];
  let requestedTopology: RepoTopology | undefined;
  for (const cwd of cwds) {
    const check = verifyCwdInvariants(cwd, input.codexHome);
    if (!check.ok) return Object.freeze({ status: 'FAILED', failure: check });
    if (cwd === input.requestedCwd) requestedTopology = check.topology;
  }
  const config = readFixtureConfigState(input.codexHome, input.allowedTrustKeys);
  const at = under(input.codexHome, 'config.toml');
  if (config.classification.state === 'UNAUTHORIZED') {
    return Object.freeze({
      status: 'FAILED',
      failure: Object.freeze({ ok: false, invariant: 'FIXTURE_CONFIG_STATE', reason: config.classification.reason, at }),
    });
  }
  if (input.requireSealedStateZeroBytes && (config.classification.state !== 'STATE_0' || !config.sealedStateZeroBytes)) {
    return Object.freeze({
      status: 'FAILED',
      failure: Object.freeze({ ok: false, invariant: 'FIXTURE_CONFIG_STATE', reason: 'FIXTURE_CONFIG_SEALED_STATE_ZERO_BYTES_MISMATCH', at }),
    });
  }
  return Object.freeze({
    status: 'VERIFIED',
    proof: Object.freeze({
      requestedCwd: input.requestedCwd,
      verifiedCwds: Object.freeze(cwds),
      requestedCwdTopology: requestedTopology!,
      fixtureConfigState: config.classification.state,
      fixtureTrustKey: config.classification.state === 'STATE_1' ? config.classification.trustKey : null,
      sealedStateZeroBytesVerified: config.sealedStateZeroBytes,
    }),
  });
}

export type PostConsumeDetectorOutcome = 'NO_UNEXPECTED_RELEVANT_MUTATION_DETECTED' | 'UNEXPECTED_RELEVANT_MUTATION_DETECTED';

/** A DETECTOR report: it states what was observed after the fact. It never claims that anything was prevented. */
export type PostConsumeDetectorReport = Readonly<{
  detector: 'POST_CONSUME_DETECTOR';
  outcome: PostConsumeDetectorOutcome;
  observedFixtureConfigState: FixtureConfigState;
  /** Set when the outcome is UNEXPECTED_RELEVANT_MUTATION_DETECTED (the run stops with E1_INFRA_FAILURE). */
  failure: AdmissionPreconditionFailure | null;
}>;

export type PostConsumeDetectorInput = Readonly<{
  codexHome: string;
  cwds: readonly string[];
  allowedTrustKeys: readonly string[];
}>;

/**
 * Post-consume DETECTOR: re-checks INV-PATH / INV-PROJ / INV-REPO on the relevant cwds and that the fixture config is
 * still STATE_0 or STATE_1 (whether an observed transition was the admitted one is the trust lifecycle's decision).
 */
export function runPostConsumeDetector(input: PostConsumeDetectorInput): PostConsumeDetectorReport {
  const observed = readFixtureConfigState(input.codexHome, input.allowedTrustKeys).classification;
  const report = (failure: AdmissionPreconditionFailure | null): PostConsumeDetectorReport =>
    Object.freeze({
      detector: 'POST_CONSUME_DETECTOR',
      outcome: failure === null ? 'NO_UNEXPECTED_RELEVANT_MUTATION_DETECTED' : 'UNEXPECTED_RELEVANT_MUTATION_DETECTED',
      observedFixtureConfigState: observed,
      failure,
    });
  for (const cwd of new Set(input.cwds)) {
    const check = verifyCwdInvariants(cwd, input.codexHome);
    if (!check.ok) return report(check);
  }
  if (observed.state === 'UNAUTHORIZED') {
    return report(
      Object.freeze({ ok: false, invariant: 'FIXTURE_CONFIG_STATE', reason: observed.reason, at: under(input.codexHome, 'config.toml') }),
    );
  }
  return report(null);
}
