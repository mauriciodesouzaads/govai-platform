import { describe, expect, it } from 'vitest';
import {
  exactDigits,
  formatDateTime,
  formatDurationSeconds,
  formatInteger,
  formatPercent,
  formatRatio,
  isDecimalDigits,
  truncateHex,
} from './format.js';

describe('bigint-valued decimal strings survive intact', () => {
  // 2^53 − 1 is 9007199254740991. Anything above it loses precision through Number(), and a
  // sequence number is exactly the kind of value an auditor follows to a specific event.
  const BEYOND_SAFE = '9007199254740993';
  const UINT64_MAX = '18446744073709551615';

  it('renders every digit of a value beyond Number.MAX_SAFE_INTEGER', () => {
    expect(exactDigits(BEYOND_SAFE)).toBe(BEYOND_SAFE);
    expect(exactDigits(UINT64_MAX)).toBe(UINT64_MAX);
  });

  it('demonstrates the precision loss the UI avoids', () => {
    // A guard against a future "simplification" that reintroduces Number().
    expect(String(Number(BEYOND_SAFE))).not.toBe(BEYOND_SAFE);
    expect(String(Number(UINT64_MAX))).not.toBe(UINT64_MAX);
  });

  it('refuses a non-integer string rather than rendering something plausible', () => {
    expect(exactDigits('12.5')).toBeNull();
    expect(exactDigits('1e21')).toBeNull();
    expect(exactDigits('')).toBeNull();
    expect(exactDigits('9007199254740993n')).toBeNull();
    expect(isDecimalDigits('-7')).toBe(true);
    expect(isDecimalDigits('0')).toBe(true);
  });
});

describe('truncateHex', () => {
  const HASH = 'a'.repeat(32) + 'b'.repeat(32);

  it('keeps the head and tail so two hashes can be told apart', () => {
    expect(truncateHex(HASH)).toBe(`${'a'.repeat(8)}…${'b'.repeat(6)}`);
  });

  it('leaves a value that already fits untouched, so an ellipsis always means "there is more"', () => {
    expect(truncateHex('abc123')).toBe('abc123');
    expect(truncateHex('abcdefghijklmno', 8, 6)).toBe('abcdefghijklmno');
  });
});

describe('locale-aware numbers', () => {
  it('formats integers in the reader’s locale', () => {
    expect(formatInteger(1543, 'en-US')).toBe('1,543');
    expect(formatInteger(1543, 'pt-BR')).toBe('1.543');
  });

  it('renders the ratio as a fraction with three decimals, not as a rounded percentage', () => {
    // 0.9996 must not become "100%".
    expect(formatRatio(0.9996, 'en-US')).toBe('1.000');
    expect(formatRatio(0.9928, 'en-US')).toBe('0.993');
    expect(formatRatio(0.9928, 'pt-BR')).toBe('0,993');
  });

  it('formats a measured drop rate as a percentage with two decimals', () => {
    expect(formatPercent(0.0325, 'en-US')).toBe('3.25%');
  });

  it('renders durations in the largest exact unit', () => {
    expect(formatDurationSeconds(300, 'en-US')).toBe('5 min');
    expect(formatDurationSeconds(3_600, 'en-US')).toBe('1 h');
    expect(formatDurationSeconds(86_400, 'en-US')).toBe('1 d');
    expect(formatDurationSeconds(604_800, 'en-US')).toBe('7 d');
    expect(formatDurationSeconds(45, 'en-US')).toBe('45 s');
    expect(formatDurationSeconds(0, 'en-US')).toBe('0 s');
  });
});

describe('timestamps', () => {
  it('renders a valid ISO instant', () => {
    expect(formatDateTime('2026-08-19T12:00:00.000Z', 'en-US')).not.toBeNull();
  });

  it('returns null for an unparseable value instead of printing "Invalid Date"', () => {
    expect(formatDateTime('not-a-date', 'en-US')).toBeNull();
  });
});
