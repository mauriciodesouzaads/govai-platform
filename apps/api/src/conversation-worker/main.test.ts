// The detached worker's runtime configuration (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C).
//
// Config is where a background executor fails silently if it fails at all: a bad lease/heartbeat
// ratio does not crash, it just lets healthy work be recovered out from under a running worker.
// These are the checks that make that impossible to ship by accident.

import { describe, it, expect } from 'vitest';
import { loadEnv, type GovAIEnv } from '@govai/config';
import {
  ConversationWorkerRuntimeConfigError,
  buildExecutorDeps,
  loadConversationWorkerRuntimeConfig,
} from './main.js';
import type { ConversationWorkerDb } from '../pipeline/ai-conversation-worker.js';

const baseEnv = (overrides: Record<string, string> = {}): GovAIEnv =>
  loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://ignored/db',
    KMS_DEV_SEED: 'a'.repeat(64),
    GOVAI_KMS_PROVIDER: 'dev',
    JWT_ISSUER: 'https://govai.test',
    JWT_AUDIENCE: 'govai-api',
    ...overrides,
  });

describe('loadConversationWorkerRuntimeConfig — the lease/heartbeat safety ratio', () => {
  it('accepts the defaults, which leave the lease at four heartbeat ticks', () => {
    const c = loadConversationWorkerRuntimeConfig(baseEnv());
    expect(c.leaseMs).toBe(60_000);
    expect(c.heartbeatIntervalMs).toBe(15_000);
    // ★ The invariant, stated as arithmetic: the lease must survive two consecutive MISSED ticks.
    expect(c.heartbeatIntervalMs * 3).toBeLessThanOrEqual(c.leaseMs);
  });

  it('REJECTS a heartbeat that could fall outside its own lease', () => {
    // ★ WHY THIS IS A SAFETY CHECK AND NOT A TUNING PREFERENCE. If a tick can land after the
    // lease expires, a runner doing everything right loses its claim to recovery — and its
    // in-flight provider call becomes a zombie the fence has to catch. The failure mode is not a
    // crash; it is intermittent, load-dependent duplicate-looking work. It has to fail at BOOT.
    for (const [lease, beat] of [
      ['30000', '15000'], // exactly 2 ticks — not enough
      ['30000', '20000'], // beat > lease/2
      ['60000', '30000'],
      ['10000', '9000'],
    ] as const) {
      expect(() =>
        loadConversationWorkerRuntimeConfig(
          baseEnv({
            CONVERSATION_WORKER_LEASE_MS: lease,
            CONVERSATION_WORKER_HEARTBEAT_MS: beat,
          }),
        ),
      ).toThrow(ConversationWorkerRuntimeConfigError);
    }
    // The boundary case passes: exactly one third.
    expect(() =>
      loadConversationWorkerRuntimeConfig(
        baseEnv({
          CONVERSATION_WORKER_LEASE_MS: '30000',
          CONVERSATION_WORKER_HEARTBEAT_MS: '10000',
        }),
      ),
    ).not.toThrow();
  });

  it('the message names the two variables and their values, and carries no secret', () => {
    try {
      loadConversationWorkerRuntimeConfig(
        baseEnv({
          CONVERSATION_WORKER_LEASE_MS: '30000',
          CONVERSATION_WORKER_HEARTBEAT_MS: '25000',
        }),
      );
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('CONVERSATION_WORKER_HEARTBEAT_MS');
      expect(msg).toContain('CONVERSATION_WORKER_LEASE_MS');
      expect(msg).toContain('25000');
      expect(msg).toContain('30000');
      expect(msg).not.toContain('postgres://');
    }
  });
});

describe('loadConversationWorkerRuntimeConfig — provider hosts', () => {
  it('★ resolves each provider to its OWN host when no override is set', () => {
    // The defect this pins: a single base URL would send every OpenAI conversation to
    // api.anthropic.com in production — and the hermetic stack could never surface it, because
    // there GOVAI_PROVIDER_BASE_URL makes the two equal.
    const c = loadConversationWorkerRuntimeConfig(baseEnv());
    expect(c.upstreamBaseUrlAnthropic).toBe('https://api.anthropic.com');
    expect(c.upstreamBaseUrlOpenAI).toBe('https://api.openai.com');
    expect(c.upstreamBaseUrlAnthropic).not.toBe(c.upstreamBaseUrlOpenAI);

    const deps = buildExecutorDeps({
      db: {} as ConversationWorkerDb,
      kms: {} as never,
      log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      claimant: 'test',
      config: c,
    });
    expect(deps.upstreamBaseUrlFor('anthropic')).toBe('https://api.anthropic.com');
    expect(deps.upstreamBaseUrlFor('openai')).toBe('https://api.openai.com');
  });

  it('one override serves both, matching how the direct routes read it', () => {
    const c = loadConversationWorkerRuntimeConfig(
      baseEnv({ GOVAI_PROVIDER_BASE_URL: 'http://127.0.0.1:9999' }),
    );
    expect(c.upstreamBaseUrlAnthropic).toBe('http://127.0.0.1:9999');
    expect(c.upstreamBaseUrlOpenAI).toBe('http://127.0.0.1:9999');
  });
});

describe('loadConversationWorkerRuntimeConfig — the remaining knobs are validated, never defaulted silently', () => {
  it('carries the sweep and stream knobs through', () => {
    const c = loadConversationWorkerRuntimeConfig(
      baseEnv({
        CONVERSATION_WORKER_BATCH_SIZE: '7',
        CONVERSATION_WORKER_INTERVAL_MS: '2000',
        CONVERSATION_WORKER_MAX_PAGES_PER_SWEEP: '3',
        CONVERSATION_WORKER_STREAM_FLUSH_BYTES: '2048',
        CONVERSATION_WORKER_RECOVERY_GRACE_MS: '0',
      }),
    );
    expect(c.runner).toEqual({ batchSize: 7, intervalMs: 2_000, maxPagesPerSweep: 3 });
    expect(c.streamFlushBytes).toBe(2048);
    // A zero grace is a LAWFUL operational choice (§7.7 δ), which is why the schema needs the
    // ''→NaN preprocess to keep an exported-empty value from coercing to a silent 0.
    expect(c.recoveryGraceMs).toBe(0);
  });

  it('an exported-EMPTY knob fails LOUD instead of becoming a default', () => {
    for (const key of [
      'CONVERSATION_WORKER_LEASE_MS',
      'CONVERSATION_WORKER_HEARTBEAT_MS',
      'CONVERSATION_WORKER_RECOVERY_GRACE_MS',
      'CONVERSATION_WORKER_BATCH_SIZE',
      'CONVERSATION_WORKER_STREAM_FLUSH_BYTES',
    ]) {
      // None of these is an OFF-SWITCH, so '' must not read as "unset" (the RUN_DISPATCH_* rule).
      expect(() => baseEnv({ [key]: '' })).toThrow();
    }
  });

  it('out-of-range values are rejected at the schema, not clamped', () => {
    expect(() => baseEnv({ CONVERSATION_WORKER_BATCH_SIZE: '501' })).toThrow();
    expect(() => baseEnv({ CONVERSATION_WORKER_BATCH_SIZE: '0' })).toThrow();
    expect(() => baseEnv({ CONVERSATION_WORKER_LEASE_MS: '1000' })).toThrow(); // below min 5s
    expect(() => baseEnv({ CONVERSATION_WORKER_INTERVAL_MS: '999' })).toThrow();
  });
});
