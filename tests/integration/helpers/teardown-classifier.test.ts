// Unit tests for the testcontainers Postgres teardown-error classifier
// (issue #28). The classifier intentionally accepts ONLY the exact code +
// message pair emitted by Postgres when the container is shut down while a
// client connection is still open. Every other shape must be rejected so
// real DB errors during test execution remain visible.
//
// This test file lives in tests/integration/ because that's where the
// classifier is exported from (tests/integration/setup.ts). The setup
// module also bootstraps a real testcontainers Postgres on import; the
// unit test below does NOT exercise startPostgres/stopPostgres — it only
// imports the pure classifier function.

import { describe, it, expect } from 'vitest';
import { isExpectedPostgresTeardownError } from './setup.test-export.js';

describe('isExpectedPostgresTeardownError (issue #28)', () => {
  const canonical = {
    code: '57P01',
    message: 'terminating connection due to administrator command',
    severity: 'FATAL',
    file: 'postgres.c',
    routine: 'ProcessInterrupts',
  };

  it('returns true for the canonical teardown error shape', () => {
    expect(isExpectedPostgresTeardownError(canonical)).toBe(true);
  });

  it('returns true when message has the canonical substring with trailing context', () => {
    expect(
      isExpectedPostgresTeardownError({
        code: '57P01',
        message:
          'terminating connection due to administrator command at character 1',
      }),
    ).toBe(true);
  });

  it('returns false for same message but different code', () => {
    expect(
      isExpectedPostgresTeardownError({
        code: '08006',
        message: 'terminating connection due to administrator command',
      }),
    ).toBe(false);
  });

  it('returns false for same code but different message', () => {
    expect(
      isExpectedPostgresTeardownError({
        code: '57P01',
        message: 'connection reset by peer',
      }),
    ).toBe(false);
  });

  it('returns false for a generic Error instance', () => {
    expect(isExpectedPostgresTeardownError(new Error('boom'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isExpectedPostgresTeardownError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isExpectedPostgresTeardownError(undefined)).toBe(false);
  });

  it('returns false for a primitive string', () => {
    expect(
      isExpectedPostgresTeardownError(
        'terminating connection due to administrator command',
      ),
    ).toBe(false);
  });

  it('returns false for an object missing the message field', () => {
    expect(isExpectedPostgresTeardownError({ code: '57P01' })).toBe(false);
  });

  it('returns false for an object missing the code field', () => {
    expect(
      isExpectedPostgresTeardownError({
        message: 'terminating connection due to administrator command',
      }),
    ).toBe(false);
  });

  it('returns false for an object whose code is a number, not the string "57P01"', () => {
    expect(
      isExpectedPostgresTeardownError({
        code: 57_01,
        message: 'terminating connection due to administrator command',
      }),
    ).toBe(false);
  });

  it('returns false for another fatal Postgres error (administrator_shutdown family lookalike)', () => {
    expect(
      isExpectedPostgresTeardownError({
        code: '57P03',
        message: 'cannot connect now',
      }),
    ).toBe(false);
  });
});
