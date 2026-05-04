import { describe, it, expect } from 'vitest';
import {
  compileCustomDetector,
  CustomDetectorCache,
  DetectorCompileError,
  lintRegex,
  patternHash,
  runCustomDetectors,
  type CustomDetectorRecord,
} from './custom-detectors.js';

const baseRecord: Omit<CustomDetectorRecord, 'pattern_re2'> = {
  id: '00000000-0000-0000-0000-000000000001',
  org_id: '00000000-0000-0000-0000-000000000010',
  name: 'card-number',
  version: 1,
  action: 'redact',
  input_max_chars: 50_000,
  status: 'active',
};

describe('custom detectors', () => {
  it('patternHash is deterministic and 64 hex chars', () => {
    const h1 = patternHash('abc');
    const h2 = patternHash('abc');
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
    expect(patternHash('abd')).not.toBe(h1);
  });

  it('lintRegex flags catastrophic backtracking patterns', () => {
    const safe = lintRegex('hello');
    expect(safe.warning).toBe(false);
    const dangerous = lintRegex('(a+)+$');
    expect(dangerous.warning).toBe(true);
  });

  it('compileCustomDetector rejects empty pattern', () => {
    expect(() => compileCustomDetector({ ...baseRecord, pattern_re2: '' })).toThrow(DetectorCompileError);
  });

  it('compileCustomDetector rejects oversized pattern', () => {
    const huge = 'a'.repeat(5000);
    expect(() => compileCustomDetector({ ...baseRecord, pattern_re2: huge })).toThrow(DetectorCompileError);
  });

  it('compileCustomDetector rejects invalid regex syntax', () => {
    expect(() => compileCustomDetector({ ...baseRecord, pattern_re2: '(unclosed' })).toThrow(
      DetectorCompileError,
    );
  });

  it('compileCustomDetector returns compiled detector for valid pattern', () => {
    const c = compileCustomDetector({ ...baseRecord, pattern_re2: '\\b\\d{4}-\\d{4}\\b' });
    expect(c.id).toBe(baseRecord.id);
    expect(c.org_id).toBe(baseRecord.org_id);
    expect(c.action).toBe('redact');
    expect(c.pattern_hash).toHaveLength(64);
  });

  it('runCustomDetectors finds matches', () => {
    const c = compileCustomDetector({ ...baseRecord, pattern_re2: 'TOKEN_[A-Z]+' });
    const findings = runCustomDetectors([c], 'leak: TOKEN_ABCDEF and TOKEN_X');
    expect(findings.length).toBe(2);
    expect(findings[0]?.detector).toContain('custom:card-number@1');
  });

  it('runCustomDetectors skips when input exceeds input_max_chars', () => {
    const c = compileCustomDetector({ ...baseRecord, pattern_re2: 'X', input_max_chars: 5 });
    expect(runCustomDetectors([c], 'X is here, way over the cap')).toEqual([]);
  });

  it('CustomDetectorCache get/set/invalidate', () => {
    const cache = new CustomDetectorCache();
    const c = compileCustomDetector({ ...baseRecord, pattern_re2: 'x' });
    expect(cache.get('00000000-0000-0000-0000-000000000010')).toEqual([]);
    cache.set('00000000-0000-0000-0000-000000000010', [c]);
    expect(cache.get('00000000-0000-0000-0000-000000000010').length).toBe(1);
    cache.invalidate('00000000-0000-0000-0000-000000000010');
    expect(cache.get('00000000-0000-0000-0000-000000000010')).toEqual([]);
  });
});
