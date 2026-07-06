import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HealthState } from './health.js';
import { createHealthFilePublisher } from './health-file.js';

describe('health-file publisher — FIX 1: readiness is EXPOSED (not in-memory only)', () => {
  const path = join(tmpdir(), `audit-sealer-health-${randomUUID()}.json`);
  afterEach(() => {
    try {
      rmSync(path);
    } catch {
      /* ignore */
    }
  });

  it('writes a NOT-READY surface (ready:false + reason) when the startup probe failed', () => {
    const health = new HealthState();
    health.setStartup({ ready: false, checks: [{ name: 'fn_claim_for_seal', ok: false }] });
    const pub = createHealthFilePublisher(health, { path });
    pub.publish();
    const surface = JSON.parse(readFileSync(path, 'utf8')) as {
      readiness: { ready: boolean; reason?: string; scope: string; provider_native_unaffected: boolean };
      liveness: { live: boolean };
    };
    expect(surface.readiness.ready).toBe(false);
    expect(surface.readiness.reason).toBe('startup_probe_failed');
    expect(surface.readiness.scope).toBe('audit-sealer');
    expect(surface.readiness.provider_native_unaffected).toBe(true);
    expect(surface.liveness.live).toBe(true);
  });

  it('writes a READY surface when the probe passed', () => {
    const health = new HealthState();
    health.setStartup({ ready: true, checks: [] });
    health.setDiscoveryProbed(true); // Fix 2: readiness is not ready until the first discovery probe resolves
    const pub = createHealthFilePublisher(health, { path });
    pub.publish();
    const surface = JSON.parse(readFileSync(path, 'utf8')) as { readiness: { ready: boolean } };
    expect(surface.readiness.ready).toBe(true);
  });

  it('a write error is surfaced via onError (never swallowed silently)', () => {
    const health = new HealthState();
    let errored = false;
    const pub = createHealthFilePublisher(health, {
      path: '/no-such-dir-xyz-audit-sealer/health.json',
      onError: () => {
        errored = true;
      },
    });
    pub.publish();
    expect(errored).toBe(true);
  });
});
