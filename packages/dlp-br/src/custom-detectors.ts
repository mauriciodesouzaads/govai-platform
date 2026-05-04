import RE2 from 're2';
import safeRegex from 'safe-regex';
import { createHash } from 'node:crypto';
import type { DetectorAction, DetectorFinding } from './baseline-detectors.js';

export type CustomDetectorRecord = {
  id: string;
  org_id: string;
  name: string;
  version: number;
  pattern_re2: string;
  action: DetectorAction;
  input_max_chars: number;
  status: 'active' | 'disabled';
};

export type CompiledCustomDetector = {
  id: string;
  org_id: string;
  name: string;
  version: number;
  re: RE2;
  action: DetectorAction;
  input_max_chars: number;
  pattern_hash: string;
};

const MAX_PATTERN_LEN = 4096;

export class DetectorCompileError extends Error {
  public readonly causeDetail: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DetectorCompileError';
    this.causeDetail = cause;
  }
}

export function patternHash(pattern: string): string {
  return createHash('sha256').update(pattern, 'utf8').digest('hex');
}

export function lintRegex(pattern: string): { warning: boolean; safe: boolean } {
  // safe-regex roda sobre RegExp; tenta criar; se falhar, considera não-seguro mas continua.
  try {
    const safe = safeRegex(pattern);
    return { warning: !safe, safe };
  } catch {
    return { warning: true, safe: false };
  }
}

export function compileCustomDetector(rec: CustomDetectorRecord): CompiledCustomDetector {
  if (rec.pattern_re2.length === 0 || rec.pattern_re2.length > MAX_PATTERN_LEN) {
    throw new DetectorCompileError(`pattern length out of bounds: ${rec.pattern_re2.length}`);
  }
  let re: RE2;
  try {
    re = new RE2(rec.pattern_re2, 'g');
  } catch (err) {
    throw new DetectorCompileError(`RE2 compile failed for detector ${rec.name}`, err);
  }
  return {
    id: rec.id,
    org_id: rec.org_id,
    name: rec.name,
    version: rec.version,
    re,
    action: rec.action,
    input_max_chars: rec.input_max_chars,
    pattern_hash: patternHash(rec.pattern_re2),
  };
}

export class CustomDetectorCache {
  private byOrg = new Map<string, CompiledCustomDetector[]>();

  set(orgId: string, detectors: CompiledCustomDetector[]): void {
    this.byOrg.set(orgId, detectors);
  }

  get(orgId: string): ReadonlyArray<CompiledCustomDetector> {
    return this.byOrg.get(orgId) ?? [];
  }

  invalidate(orgId: string): void {
    this.byOrg.delete(orgId);
  }
}

export function runCustomDetectors(
  detectors: ReadonlyArray<CompiledCustomDetector>,
  text: string,
): DetectorFinding[] {
  const out: DetectorFinding[] = [];
  for (const d of detectors) {
    if (text.length > d.input_max_chars) continue;
    let m: RegExpExecArray | null;
    while ((m = d.re.exec(text)) !== null) {
      out.push({
        detector: `custom:${d.name}@${d.version}`,
        match: m[0],
        index: m.index,
        length: m[0].length,
      });
      if (d.re.lastIndex === m.index) d.re.lastIndex++;
    }
    d.re.lastIndex = 0;
  }
  return out;
}
