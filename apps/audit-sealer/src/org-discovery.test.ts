import { describe, it, expect } from 'vitest';
import { parseOrgIdsCsv, listOrgsFromEnv } from './org-discovery.js';
import { SealerConfigError } from './config.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('parseOrgIdsCsv — FIX 3: a malformed token is a config error, not a silent drop', () => {
  it('returns the ids for a clean CSV', () => {
    expect(parseOrgIdsCsv(`${A},${B}`)).toEqual([A, B]);
  });

  it('ignores empty / whitespace-only segments from the split', () => {
    expect(parseOrgIdsCsv(`${A}, ,,${B} ,`)).toEqual([A, B]);
    expect(parseOrgIdsCsv('')).toEqual([]);
    expect(parseOrgIdsCsv('   ')).toEqual([]);
  });

  it('THROWS a config error on a NON-EMPTY malformed token (the silent-drop fix)', () => {
    expect(() => parseOrgIdsCsv(`${A},not-a-uuid`)).toThrow(SealerConfigError);
    expect(() => parseOrgIdsCsv('zzzz')).toThrow(/malformed org id/);
  });

  it('listOrgsFromEnv parses eagerly so a bad token fails at boot, not at first scan', () => {
    expect(() =>
      listOrgsFromEnv({ AUDIT_SEALER_ORG_IDS: `${A},bad` } as NodeJS.ProcessEnv),
    ).toThrow(SealerConfigError);
  });
});
