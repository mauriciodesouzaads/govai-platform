// Liveness + readiness state (SPEC-B3 §5). Liveness = process alive. Readiness
// fails when the sealer cannot seal (startup probe failed, or backlog critical),
// but a readiness failure is SEALER-SCOPED — it never implies the provider-native
// endpoints are down (they live in apps/api, a different deploy unit).

import type { StartupValidationResult } from './startup-validation.js';

export interface ReadinessReport {
  ready: boolean;
  scope: 'audit-sealer';
  provider_native_unaffected: true;
  reason?: string;
  checks?: StartupValidationResult['checks'];
}

export class HealthState {
  private live = true;
  private startup: StartupValidationResult | null = null;
  private backlogHealthy = true;
  // EP-SEALER-DEPLOY: org discovery must be FAIL-LOUD. A discovery failure (startup probe or a
  // loop tick) flips this false so readiness reports NOT ready with reason `org_discovery_failed`
  // — the sealer is never "healthy while blind" to a tenant. Recoverable: a later success flips
  // it back true. Defaults true (CSV discovery, which never fails at runtime, stays healthy).
  private discoveryHealthy = true;

  setLive(live: boolean): void {
    this.live = live;
  }

  setStartup(result: StartupValidationResult): void {
    this.startup = result;
  }

  setBacklogHealthy(healthy: boolean): void {
    this.backlogHealthy = healthy;
  }

  setDiscoveryHealthy(healthy: boolean): void {
    this.discoveryHealthy = healthy;
  }

  liveness(): { live: boolean } {
    return { live: this.live };
  }

  readiness(): ReadinessReport {
    const probeReady = this.startup?.ready === true;
    const ready = probeReady && this.discoveryHealthy && this.backlogHealthy;
    const base: ReadinessReport = {
      ready,
      scope: 'audit-sealer',
      provider_native_unaffected: true,
    };
    if (ready) return base;
    // Precedence: a failed startup probe is the most fundamental; then blind discovery; then
    // backlog. `org_discovery_failed` is surfaced distinctly so the silent-drop is observable.
    const reason = !probeReady
      ? 'startup_probe_failed'
      : !this.discoveryHealthy
        ? 'org_discovery_failed'
        : 'backlog_critical';
    return {
      ...base,
      reason,
      ...(this.startup ? { checks: this.startup.checks } : {}),
    };
  }
}

/**
 * Wrap an org-discovery function so every call drives readiness fail-loud: a success marks
 * discovery healthy, a rejection marks it unhealthy (and re-throws so the caller's own
 * error/backoff path still runs). Shared by the runner's startup probe AND the claim loop, so a
 * failure at EITHER makes readiness `org_discovery_failed`, and a later success recovers it.
 * `onChange` (e.g. re-publish the health file) fires only on a health TRANSITION, not every call.
 */
export function withDiscoveryHealth(
  inner: () => Promise<string[]>,
  health: HealthState,
  onChange?: () => void,
): () => Promise<string[]> {
  let healthy: boolean | null = null; // null = unknown until the first call
  const set = (next: boolean): void => {
    health.setDiscoveryHealthy(next);
    if (healthy !== next) {
      healthy = next;
      onChange?.();
    }
  };
  return async () => {
    try {
      const ids = await inner();
      set(true);
      return ids;
    } catch (err) {
      set(false);
      throw err;
    }
  };
}
