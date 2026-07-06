// EP-SEALER-DEPLOY: readiness must be FAIL-LOUD on org discovery — never "healthy while blind".
import { describe, it, expect, vi } from 'vitest';
import { HealthState, withDiscoveryHealth } from './health.js';
import type { StartupValidationResult } from './startup-validation.js';

const OK_STARTUP: StartupValidationResult = { ready: true, checks: [{ name: 'db_connectivity', ok: true }] };

describe('HealthState — the discoveryHealthy / discoveryProbed dimensions + reason precedence', () => {
  it('Fix 2: NOT ready before the first discovery probe resolves (org_discovery_pending, not ready-while-blind)', () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP); // startup passed, but discovery has not been probed yet
    expect(h.readiness().ready).toBe(false);
    expect(h.readiness().reason).toBe('org_discovery_pending');
  });

  it('a startup-validated sealer with a RESOLVED healthy discovery + backlog is ready', () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP);
    h.setDiscoveryProbed(true);
    expect(h.readiness().ready).toBe(true);
    expect(h.readiness().reason).toBeUndefined();
  });

  it('discovery probed but unhealthy ⇒ NOT ready with reason org_discovery_failed', () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP);
    h.setDiscoveryProbed(true);
    h.setDiscoveryHealthy(false);
    expect(h.readiness().ready).toBe(false);
    expect(h.readiness().reason).toBe('org_discovery_failed');
  });

  it('recovers: a later healthy discovery flips readiness back to ready', () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP);
    h.setDiscoveryProbed(true);
    h.setDiscoveryHealthy(false);
    h.setDiscoveryHealthy(true);
    expect(h.readiness().ready).toBe(true);
  });

  it('precedence: a failed startup probe outranks discovery (startup_probe_failed wins)', () => {
    const h = new HealthState();
    h.setStartup({ ready: false, checks: [{ name: 'set_role_govai_audit_sealer', ok: false }] });
    h.setDiscoveryProbed(true);
    h.setDiscoveryHealthy(false);
    expect(h.readiness().reason).toBe('startup_probe_failed');
  });

  it('precedence: pending (not yet probed) outranks failed — a fresh sealer reads pending, not failed', () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP);
    // discoveryProbed still false; even if discoveryHealthy were toggled, pending wins until probed
    h.setDiscoveryHealthy(false);
    expect(h.readiness().reason).toBe('org_discovery_pending');
  });
});

describe('withDiscoveryHealth — every discovery call drives readiness fail-loud', () => {
  it('a rejection marks discovery unhealthy AND re-throws (so the caller still backs off)', async () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP);
    const tracked = withDiscoveryHealth(async () => { throw new Error('boom'); }, h);
    await expect(tracked()).rejects.toThrow('boom');
    expect(h.readiness().reason).toBe('org_discovery_failed');
  });

  it('a success marks discovery healthy and returns the ids', async () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP);
    const tracked = withDiscoveryHealth(async () => ['org-1'], h);
    expect(await tracked()).toEqual(['org-1']);
    expect(h.readiness().ready).toBe(true);
  });

  it('fail → recover: unhealthy on a throw, healthy again on the next success (startup AND loop share this)', async () => {
    const h = new HealthState();
    h.setStartup(OK_STARTUP);
    let fail = true;
    const onChange = vi.fn();
    const tracked = withDiscoveryHealth(async () => { if (fail) throw new Error('boom'); return ['org-1']; }, h, onChange);
    await expect(tracked()).rejects.toThrow(); // startup-probe-style failure
    expect(h.readiness().reason).toBe('org_discovery_failed');
    fail = false;
    await tracked(); // a later successful tick recovers
    expect(h.readiness().ready).toBe(true);
    // onChange fires only on the two TRANSITIONS (→unhealthy, →healthy), not on every call.
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
