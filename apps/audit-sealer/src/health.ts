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

  setLive(live: boolean): void {
    this.live = live;
  }

  setStartup(result: StartupValidationResult): void {
    this.startup = result;
  }

  setBacklogHealthy(healthy: boolean): void {
    this.backlogHealthy = healthy;
  }

  liveness(): { live: boolean } {
    return { live: this.live };
  }

  readiness(): ReadinessReport {
    const probeReady = this.startup?.ready === true;
    const ready = probeReady && this.backlogHealthy;
    const base: ReadinessReport = {
      ready,
      scope: 'audit-sealer',
      provider_native_unaffected: true,
    };
    if (ready) return base;
    return {
      ...base,
      reason: !probeReady ? 'startup_probe_failed' : 'backlog_critical',
      ...(this.startup ? { checks: this.startup.checks } : {}),
    };
  }
}
