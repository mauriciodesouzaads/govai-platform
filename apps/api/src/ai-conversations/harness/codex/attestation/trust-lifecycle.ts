// CONT-P5-E1 — the fixture trust lifecycle (Dispatch v8 M6, carried from v1-v3; Correction 08 section 7).
//
// A workspace-write thread/start makes the pinned server persist project trust into CODEX_HOME/config.toml (writer B,
// thread_processor.rs 1349-1399 at the pin). Under INV-PROJ that mutation is FEATURE-NEUTRAL: there is no project
// layer for trust to enable. The lifecycle below admits exactly that mutation and nothing else:
//   STATE_0 -> STATE_1   only immediately after an admitted thread/start whose bound sandbox is workspace-write,
//                        with the trust key of THAT start's trust target (W under INV-REPO (a), else the cwd);
//   STATE_1 -> STATE_1   idempotent (same key);
//   STATE_0 -> STATE_0   always accepted (read-only starts; the in-memory trust fallback keeps the bytes);
//   STATE_1 -> STATE_0   never within a fixture generation;
//   UNAUTHORIZED         STOP.
// The harness never relies on trust state for anything else, and an admitted 0 -> 1 transition retires NO runtime
// provenance (it is on the do-not-retire list of thread-safety-state.ts).

import type { GovAICodexAllowedSandboxMode } from '../protocol/govai-policy.js';
import { projectTrustKey, trustTargetOf, type FixtureConfigState, type RepoTopology } from './fixture-invariants.js';

export type TrustLifecycleStopReason =
  | 'UNAUTHORIZED_FIXTURE_CONFIG_STATE'
  | 'STATE_0_TO_STATE_1_WITHOUT_ADMITTED_WORKSPACE_WRITE_START'
  | 'STATE_1_TRUST_KEY_CHANGED'
  | 'STATE_1_TO_STATE_0_WITHIN_FIXTURE_GENERATION';

export type TrustLifecycleObservation =
  | { readonly status: 'ACCEPTED'; readonly transition: 'NONE' | 'STATE_0_TO_STATE_1' | 'STATE_1_IDEMPOTENT' }
  | { readonly status: 'STOP'; readonly reason: TrustLifecycleStopReason };

type TrackedState = Readonly<{ state: 'STATE_0' }> | Readonly<{ state: 'STATE_1'; trustKey: string }>;

export class FixtureTrustLifecycle {
  private current: TrackedState = Object.freeze({ state: 'STATE_0' });
  private readonly allowed: string[] = [];
  /** The trust key an admitted workspace-write start may have just persisted (cleared by the next observation). */
  private pendingWorkspaceWriteTrustKey: string | null = null;
  private workspaceWriteStartAdmitted = false;

  /** ALLOWED_TRUST_KEYS: the trust keys of the admitted thread/start contexts, computed from admitted paths only. */
  allowedTrustKeys(): readonly string[] {
    return Object.freeze([...this.allowed]);
  }

  /** The sealed STATE_0 bytes are required until the first admitted workspace-write thread/start. */
  get requiresSealedStateZeroBytes(): boolean {
    return !this.workspaceWriteStartAdmitted;
  }

  get state(): TrackedState {
    return this.current;
  }

  /** Record an ADMITTED thread/start (called once its token was consumed), before the post-consume observation. */
  noteAdmittedThreadStart(start: Readonly<{ cwd: string; sandbox: GovAICodexAllowedSandboxMode; topology: RepoTopology }>): void {
    const key = projectTrustKey(trustTargetOf(start.cwd, start.topology));
    if (!this.allowed.includes(key)) this.allowed.push(key);
    this.pendingWorkspaceWriteTrustKey = start.sandbox === 'workspace-write' ? key : null;
    if (start.sandbox === 'workspace-write') this.workspaceWriteStartAdmitted = true;
  }

  /** Validate an observed FIXTURE_CONFIG_STATE against the lifecycle; closes the post-start window. */
  observe(observed: FixtureConfigState): TrustLifecycleObservation {
    const pending = this.pendingWorkspaceWriteTrustKey;
    this.pendingWorkspaceWriteTrustKey = null;
    const stop = (reason: TrustLifecycleStopReason): TrustLifecycleObservation => Object.freeze({ status: 'STOP', reason });
    const accept = (transition: 'NONE' | 'STATE_0_TO_STATE_1' | 'STATE_1_IDEMPOTENT'): TrustLifecycleObservation =>
      Object.freeze({ status: 'ACCEPTED', transition });
    if (observed.state === 'UNAUTHORIZED') return stop('UNAUTHORIZED_FIXTURE_CONFIG_STATE');
    if (this.current.state === 'STATE_0') {
      if (observed.state === 'STATE_0') return accept('NONE');
      if (pending === null || observed.trustKey !== pending) return stop('STATE_0_TO_STATE_1_WITHOUT_ADMITTED_WORKSPACE_WRITE_START');
      this.current = Object.freeze({ state: 'STATE_1', trustKey: observed.trustKey });
      return accept('STATE_0_TO_STATE_1');
    }
    if (observed.state === 'STATE_0') return stop('STATE_1_TO_STATE_0_WITHIN_FIXTURE_GENERATION');
    return observed.trustKey === this.current.trustKey ? accept('STATE_1_IDEMPOTENT') : stop('STATE_1_TRUST_KEY_CHANGED');
  }
}
