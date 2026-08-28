// THE DURABLE EXECUTION KERNEL (EP-AI-CONVERSATION-CONTINUITY-V1 P0-C; spec §7.7/§8/§9/§14).
//
// One claimed attempt, driven through the §8 FIVE-COMMIT protocol:
//
//   commit 1  RESERVE            — not here; the request plane committed it (`turn-service.ts`)
//   commit 2  CLAIM              — `claimQueuedHead` / a rotation arm
//   (build)   CONTEXT + CREDENTIAL, OUTSIDE every lock and every transaction
//   commit 3  DISPATCH BOUNDARY  — `accepted → dispatching`, BEFORE any POST, fenced on the claim
//   commit 4  CREDENTIAL PROVENANCE — a SEPARATE fenced commit, still before the POST
//   → PROVIDER POST
//   commit 5  FINALIZE           — terminal state, fenced on the same claim
//
// ═══════════════════════════════════════════════════════════════════════════════════════════
// THE THREE INVARIANTS THIS FILE IS RESPONSIBLE FOR
//
// 1. NO PROVIDER I/O INSIDE A DATABASE TRANSACTION. Every `db.withOwnerContext(...)` call below
//    contains database statements only, and each one COMMITS before the next step. The provider
//    call happens between commits with ZERO clients checked out. This is why the protocol has
//    five commits instead of one transaction: a single transaction spanning the POST would hold
//    the conversation root and the attempt row across an unbounded network wait.
//
// 2. THE PROVIDER CALL IS STRUCTURALLY UNREACHABLE UNTIL PROVENANCE IS DURABLE. Commit 4 runs
//    inside `beforeDispatch`, the gate the provider packages await IMMEDIATELY before `fetch`.
//    A gate rejection means the `fetch` is never invoked — not "was skipped by an if", but
//    unreachable on that path. That is what makes "commit 4 precedes EVERY POST" a proof rather
//    than a convention, and the whole §7.7 provenance-absent recovery arm rests on it.
//
// THE CONTEXT CONTRACT — what P0-C does NOT do, stated before anyone infers otherwise.
//
// The body this executor POSTs is the turn's OWN stored `native_request`, verbatim. GovAI does
// NOT assemble conversation history, does NOT replay earlier turns' output into the request, and
// does NOT carry provider continuation state. For the two P0-C surfaces that is coherent because
// both are STATELESS provider APIs whose request carries its own history: an Anthropic
// `/v1/messages` `messages[]` and an OpenAI `/v1/responses` `input` are supplied by the caller,
// exactly as they are on the direct `/governed/*` routes this executor shares a pipeline with.
//
// ★ THE BOUNDED CONSEQUENCE, NOT HIDDEN: a client that PIPELINES — sending turn N+1 before turn
// N has completed — composes N+1's history without N's answer, and the queue will still dispatch
// it in order afterwards. Nothing here detects that, and nothing here could: the only mechanism
// that would is §11's ProviderConversationAdapter building the request from durable branch
// context, which is P0-D and is deliberately excluded (§23). The honest position is that P0-C
// executes the request the client asked for, and that server-assembled continuity arrives with
// P0-D — not to imply continuity that does not exist.
//
// 3. AMBIGUITY IS REPRESENTED, NEVER GUESSED. `forwardStarted` flips inside `onDispatchStart`,
//    synchronously, immediately before `fetch`. If it is FALSE, no transmission was attempted
//    and the outcome is a KNOWN LOCAL failure. If it is TRUE and no provider RESPONSE arrived,
//    the fate is genuinely unprovable and the attempt ratchets to `outcome_unknown` — never to
//    `failed` (which would assert the provider did not process the request) and never to a
//    silent re-drive. NO PROVIDER EXACTLY-ONCE IS CLAIMED ANYWHERE.
// ═══════════════════════════════════════════════════════════════════════════════════════════

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Kms } from '@govai/core-identity';
import { detectAllBaseline, mergeFindingSpans } from '@govai/dlp-br';
import { resolveGovernance } from '@govai/core-governance';
import {
  ANTHROPIC_BETA_POLICY_VERSION,
  ANTHROPIC_MESSAGES_CREATE,
  ANTHROPIC_MESSAGES_STREAM,
  buildPassthroughInvoked as buildAnthropicPassthroughInvoked,
  forwardRaw as anthropicForwardRaw,
  forwardStream as anthropicForwardStream,
  handleAnthropicGovernedMessages,
} from '@govai/provider-anthropic';
import {
  OPENAI_BETA_POLICY_VERSION,
  OPENAI_RESPONSES_CREATE,
  OPENAI_RESPONSES_STREAM,
  buildPassthroughInvoked as buildOpenAIPassthroughInvoked,
  forwardRaw as openaiForwardRaw,
  forwardStream as openaiForwardStream,
  handleOpenAIGovernedResponses,
} from '@govai/provider-openai';
import type { ConversationWorkerDb, ConversationWorkerOwner } from '../../pipeline/ai-conversation-worker.js';
import { requestIdentityAls, type AuditBridgeRequestIdentity } from '../../pipeline/request-identity.js';
import { decryptConversationContent, encryptConversationContent } from '../crypto.js';
import { isStreamingNativeRequest, resolveDispatchPlan, type DispatchPlan } from '../dispatch-registry.js';
import { nativeRequestBytes } from '../send-intent.js';
import * as ex from './execution-store.js';

/** Minimal logging surface — the worker runner injects pino; tests inject a recorder. */
export type ExecutorLog = {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
};

export type ConversationExecutorDeps = {
  db: ConversationWorkerDb;
  kms: Kms;
  /**
   * Provider base URL, resolved PER PROVIDER.
   *
   * ★ NOT A SINGLE STRING. A worker sweeps candidates of BOTH providers from one discovery
   * function, so a fixed base URL would send an OpenAI conversation to `api.anthropic.com` the
   * moment the two hosts differ — i.e. in production, where `GOVAI_PROVIDER_BASE_URL` is unset.
   * The provider comes from DURABLE branch state, so the host must be chosen at the same place
   * the plan is: at dispatch.
   */
  upstreamBaseUrlFor: (provider: 'anthropic' | 'openai') => string;
  log: ExecutorLog;
  /** Identifies THIS worker in `claimant`. Never a secret. */
  claimant: string;
  /** Claim lease duration. The heartbeat renews it well inside this window. */
  leaseMs: number;
  /** §7.7 rule (2) recovery grace δ over the lease, for post-boundary sweep arms. */
  recoveryGraceMs: number;
  /** Heartbeat tick. MUST be comfortably below `leaseMs`. */
  heartbeatIntervalMs: number;
  /** Hard bound on the provider call. */
  dispatchTimeoutMs: number;
  /** Bytes buffered before a streaming prefix is flushed durably. */
  streamFlushBytes: number;
};

/**
 * What happened to one candidate. Returned for the runner's logs and for the tests to assert on a
 * real outcome rather than on incidental durable state.
 *
 * ★ EVERY MEMBER IS REACHABLE. Two earlier drafts — `not_branch_head` and
 * `restored_to_accepted` — were removed because nothing could ever return them: losing the
 * branch-order predicate is indistinguishable from losing any other claim predicate (the CAS is
 * one statement), so it reports `claim_lost`; and a successful provenance-absent restore
 * continues straight into the drive, so it reports that drive's own outcome. An enum member an
 * operator can never see in a log is a vocabulary that lies about what the executor can do.
 */
export type ExecutionOutcome =
  /** A claim/rotation CAS matched zero rows: another worker owns it, or a predicate (branch
   *  order, stop flag, state) no longer holds. The ORDINARY outcome of a race. */
  | 'claim_lost'
  /** The branch's durable (provider, surface) is not dispatchable by P0-C → `rejected`. */
  | 'surface_unsupported'
  /** No ACTIVE tenant credential for the provider → `failed` + `credential_unavailable`. */
  | 'credential_unavailable'
  /** The stored native request config could not be read or parsed → `rejected`. */
  | 'config_unreadable'
  /** The §8 commit-3 CAS lost: fenced out, lease-expired, stop-requested, not at head, or
   *  causally stale. The attempt is untouched and ordinarily reclaimable. NO POST HAPPENED. */
  | 'boundary_lost'
  /** Commit 4 lost its fence (rotation/stop) and the fenced restore returned it to `accepted`. */
  | 'provenance_lost_restored'
  /** Commit 4 lost its fence and the restore ALSO failed (expired lease) — the sweep's
   *  provenance-absent arm will reach it. NO POST HAPPENED. */
  | 'stopped_before_dispatch'
  | 'completed'
  | 'failed'
  | 'rejected'
  /** The forward was invoked and no provider RESPONSE arrived: the fate is unprovable. */
  | 'outcome_unknown'
  /** GovAI failed BEFORE any transmission — the provider provably did not process the request. */
  | 'local_error'
  /** The provider ANSWERED and GovAI then failed to durably record the result. NOT ambiguous,
   *  and NOT safe to blindly retry: the provider already did the work. */
  | 'persistence_error'
  /** A durable write lost its claim-token fence — the §7.7 zombie rule. The result is discarded. */
  | 'finalize_fenced_out'
  /** A stranded POST-BOUNDARY attempt WITH provenance was ratcheted terminal by recovery. */
  | 'ratcheted_outcome_unknown'
  /** Nothing lawful to do for this candidate (e.g. a discovery row that has since moved on). */
  | 'no_action';

type TenantFacts = {
  org_id: string;
  user_id: string;
  tier: 'starter' | 'business' | 'enterprise' | 'regulated';
  operational_mode: 'production' | 'pilot' | 'dev' | 'test';
};

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Entry point: one discovered candidate
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type ExecutableCandidate = {
  orgId: string;
  ownerUserId: string;
  conversationId: string;
  attemptId: string;
  state: 'accepted' | 'dispatching' | 'streaming';
  reason: string;
  claimToken: string | null;
  isBranchHead: boolean;
};

/**
 * Process ONE recovery candidate: select its lawful arm, take/rotate the claim, and — when the
 * arm ends with a claimed `accepted` attempt — drive it to a terminal state.
 *
 * Every arm's authority change is a single CAS; losing one is the ORDINARY outcome of a race and
 * is reported, never thrown.
 */
export async function processCandidate(
  deps: ConversationExecutorDeps,
  candidate: ExecutableCandidate,
): Promise<ExecutionOutcome> {
  const owner: ConversationWorkerOwner = {
    orgId: candidate.orgId,
    ownerUserId: candidate.ownerUserId,
  };

  // ── ARM SELECTION + the claim/rotation CAS, in ONE short transaction ────────────────────
  const armed = await deps.db.withOwnerContext(owner, async (tx) => {
    switch (candidate.reason) {
      case 'queued_head':
        return {
          kind: 'drive' as const,
          claim: await ex.claimQueuedHead(tx, {
            attemptId: candidate.attemptId,
            claimant: deps.claimant,
            leaseMs: deps.leaseMs,
          }),
        };
      case 'accepted_lease_expired':
        if (candidate.claimToken === null) return { kind: 'none' as const };
        return {
          kind: 'drive' as const,
          claim: await ex.rotateExpiredAcceptedClaim(tx, {
            attemptId: candidate.attemptId,
            expectedToken: candidate.claimToken,
            claimant: deps.claimant,
            leaseMs: deps.leaseMs,
          }),
        };
      case 'dispatching_lease_expired': {
        if (candidate.claimToken === null) return { kind: 'none' as const };
        // §7.7: try the PROVENANCE-ABSENT reclaim FIRST. Its CAS carries the durable no-POST
        // proof as a predicate, so if commit 4 landed concurrently this matches zero rows and
        // the ambiguity arm below governs — the two orderings serialize on the attempt row.
        const restored = await ex.restoreProvenanceAbsentDispatching(tx, {
          attemptId: candidate.attemptId,
          expectedToken: candidate.claimToken,
          claimant: deps.claimant,
          leaseMs: deps.leaseMs,
          graceMs: deps.recoveryGraceMs,
        });
        if (restored) return { kind: 'drive' as const, claim: restored };
        return {
          kind: 'ambiguous' as const,
          ratcheted: await ratchetAndWake(tx, {
            attemptId: candidate.attemptId,
            expectedToken: candidate.claimToken,
            graceMs: deps.recoveryGraceMs,
          }),
        };
      }
      case 'streaming_lease_expired': {
        if (candidate.claimToken === null) return { kind: 'none' as const };
        // `streaming` NEVER returns to `accepted` (0031's graph has no such edge, and §7 is
        // explicit): a stream proves a POST happened. The only honest arm is the ratchet.
        return {
          kind: 'ambiguous' as const,
          ratcheted: await ratchetAndWake(tx, {
            attemptId: candidate.attemptId,
            expectedToken: candidate.claimToken,
            graceMs: deps.recoveryGraceMs,
          }),
        };
      }
      default:
        return { kind: 'none' as const };
    }
  });

  if (armed.kind === 'none') return 'no_action';
  if (armed.kind === 'ambiguous') {
    if (armed.ratcheted) {
      // The branch was released in the SAME transaction as the ratchet (§8: outcome_unknown is
      // QUEUE-TERMINAL), so there is no window in which the head is claimable against a stale
      // causal version, and no second commit that a crash could omit.
      return 'ratcheted_outcome_unknown';
    }
    return 'no_action';
  }
  if (!armed.claim) return 'claim_lost';

  return driveClaimedAttempt(deps, owner, candidate.attemptId, armed.claim);
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Driving a claimed `accepted` attempt
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function driveClaimedAttempt(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  attemptId: string,
  claim: ex.ClaimGrant,
): Promise<ExecutionOutcome> {
  // ── STEP 3 (part 1): read everything the dispatch needs, from DURABLE state ─────────────
  // One short transaction; it commits BEFORE any decrypt so no client is held across a KMS
  // round trip (the AWS adapter is real in this repository).
  const loaded = await deps.db.withOwnerContext(owner, async (tx) => {
    const context = await ex.readExecutionContext(tx, attemptId);
    if (!context) return null;
    const tenant = await readTenantFacts(tx, owner);
    const config = await ex.readNativeRequestConfig(tx, context.nativeRequestConfigContentId);
    const resolution = resolveDispatchPlan({
      provider: context.provider as never,
      surface: context.surface,
      mode: context.mode,
    });
    const credential = resolution.supported
      ? await ex.readActiveProviderCredential(tx, resolution.plan.provider)
      : null;
    return { context, tenant, config, resolution, credential };
  });

  if (!loaded || !loaded.tenant) {
    deps.log.error({ attempt_id: attemptId }, 'conversation executor: attempt vanished under its owner context');
    return 'no_action';
  }
  const { context, tenant, config, resolution, credential } = loaded;

  // ── Fail-closed classification, BEFORE the boundary ─────────────────────────────────────
  // Each of these finalizes from `accepted`, so no boundary was crossed, no provenance exists,
  // and no provider was contacted. `rejected` carries NO error_class (0031 enforces
  // `error_class ⟹ failed` in both directions), which is exactly right: these are GovAI-side
  // validation refusals, not provider failures, and asserting a provider taxonomy for them
  // would be a lie.
  if (!resolution.supported) {
    return finalizeAndWake(deps, owner, context, attemptId, claim.claimToken, 'rejected', null, 'surface_unsupported');
  }
  if (!config || config.status !== 'active' || config.dek_wrapped === null) {
    return finalizeAndWake(deps, owner, context, attemptId, claim.claimToken, 'rejected', null, 'config_unreadable');
  }
  if (!credential) {
    // ★ THE ENV-KEY AND HERMETIC FALLBACKS OF THE DIRECT ROUTES ARE NOT AVAILABLE HERE, and
    // that is FORCED BY THE SCHEMA, not chosen: 0031 requires `streaming|completed ⟹
    // provider_credential_id IS NOT NULL` and binds the column through an ORG-COMPOSITE FK to
    // a real `provider_credentials` row. A `platform_env` or `hermetic_test_placeholder`
    // credential has NO durable identity, so an attempt dispatched under one could never
    // record which account owns the resulting provider object — and could never reach
    // `completed`. A conversation therefore requires a real tenant credential, and says so
    // through the taxonomy's existing `credential_unavailable`.
    return finalizeAndWake(deps, owner, context, attemptId, claim.claimToken, 'failed', 'credential_unavailable', 'credential_unavailable');
  }
  const plan = resolution.plan;

  // ── STEP 3 (part 2): decrypt OUTSIDE the transaction ────────────────────────────────────
  //
  // ★ TWO SEPARATE FAILURES, TWO SEPARATE VERDICTS. These were once one try block, which meant a
  // corrupt CONFIG was durably recorded as `credential_unavailable` while the runner reported
  // `config_unreadable` — the durable taxonomy and the operational outcome named different
  // components, and each was wrong half the time. §29 requires the taxonomy to be honest, so the
  // two operations are classified where they actually fail.
  //
  // Neither catch chains or logs its cause: a KMS error can carry key identifiers, and a JSON
  // error can carry a fragment of the decrypted plaintext.
  let nativeRequest: unknown;
  try {
    const configBytes = await decryptConversationContent(deps.kms, owner.orgId, config);
    nativeRequest = JSON.parse(configBytes.toString('utf8'));
  } catch {
    // A config that cannot be read or parsed is a VALIDATION failure before any provider
    // processing — `rejected`, which carries no error_class, because no provider taxonomy value
    // truthfully describes a GovAI-side storage fault.
    return finalizeAndWake(deps, owner, context, attemptId, claim.claimToken, 'rejected', null, 'config_unreadable');
  }

  let apiKey: string;
  try {
    const keyBytes = await deps.kms.envelopeDecrypt({
      orgId: owner.orgId,
      keyId: credential.kms_key_id,
      version: credential.kms_key_version,
      ciphertext: new Uint8Array(credential.ciphertext),
      dekWrapped: new Uint8Array(credential.dek_wrapped),
    });
    apiKey = Buffer.from(keyBytes).toString('utf8');
  } catch {
    // An undecryptable credential IS a credential outage, and the taxonomy has a value for it.
    return finalizeAndWake(deps, owner, context, attemptId, claim.claimToken, 'failed', 'credential_unavailable', 'credential_unavailable');
  }

  const isStream = isStreamingNativeRequest(nativeRequest);
  const requestBody = nativeRequestBytes(nativeRequest);

  // ── COMMIT 3: THE DISPATCH BOUNDARY ─────────────────────────────────────────────────────
  const candidateRequestId = randomUUID();
  const boundary = await deps.db.withOwnerContext(owner, async (tx) => {
    // LAW 16 (1) FIRST — the root share lock, before any level-(3) attempt write.
    const root = await ex.lockRootForDispatch(tx, context.conversationId);
    if (!root || !ex.isRootExecutionEligible(root.status)) return { ok: false as const };
    return ex.commitDispatchBoundary(tx, {
      attemptId,
      claimToken: claim.claimToken,
      leaseMs: deps.leaseMs,
      causalVersionAtBuild: context.causalVersion,
      candidateRequestId,
    });
  });
  if (!boundary.ok) {
    // Fenced out, lease-expired, stop-requested, not at head, or causally stale. The attempt is
    // untouched and still `accepted`; ordinary recovery re-drives it. NO POST HAPPENED.
    return 'boundary_lost';
  }

  // ── §14.1: ENTER THE REQUEST IDENTITY SCOPE with the PERSISTED id ───────────────────────
  // Neither `/v1/ai/*` requests nor detached workers pass the ingress identity hook, so the
  // executor constructs the identity itself and wraps the pipeline call in `requestIdentityAls
  // .run()`. Without this the AuditBridge would find no identity and DROP the capture —
  // worker-driven dispatch would be a silent evidence gap.
  const identity: AuditBridgeRequestIdentity = {
    govaiRequestId: boundary.govaiRequestId,
    identityScope: 'govai_request_id',
  };

  return requestIdentityAls.run(identity, async () =>
    dispatchAndFinalize(deps, owner, {
      attemptId,
      claim,
      context,
      tenant,
      plan,
      isStream,
      requestBody,
      apiKey,
      credentialId: credential.id,
      identity,
    }),
  );
}

type DispatchArgs = {
  attemptId: string;
  claim: ex.ClaimGrant;
  context: ex.ExecutionContext;
  tenant: TenantFacts;
  plan: DispatchPlan;
  isStream: boolean;
  requestBody: Buffer;
  apiKey: string;
  credentialId: string;
  identity: AuditBridgeRequestIdentity;
};

async function dispatchAndFinalize(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  args: DispatchArgs,
): Promise<ExecutionOutcome> {
  // ── §7.7: TIMER-DRIVEN heartbeat, started at the boundary and stopped in `finally` ──────
  const heartbeat = startHeartbeat(deps, owner, args.attemptId, args.claim.claimToken);
  let forwardStarted = false;
  let provenanceRejected = false;

  /**
   * COMMIT 4 + the §7.7 rule-(1) PRE-POST RE-VALIDATION, awaited by the provider package
   * IMMEDIATELY before `fetch`.
   *
   * ★ NEVER REASON "the boundary committed, so I am still authoritative." Context construction,
   * decryption and credential resolution all happen between commit 3 and here; the lease can
   * lapse in that window and recovery can rotate the token. The read below asks the DATABASE,
   * and commit 4's own predicates re-assert the same facts as a WRITE — which is what actually
   * fences a concurrent claimant.
   */
  const beforeDispatch = async (): Promise<void> => {
    const ok = await deps.db.withOwnerContext(owner, async (tx) => {
      const authority = await ex.readPrePostAuthority(tx, {
        attemptId: args.attemptId,
        claimToken: args.claim.claimToken,
      });
      if (!authority || authority.state !== 'dispatching' || !authority.leaseValid) return false;
      // A Stop that linearized after the boundary is honored here — with NO POST sent.
      if (authority.stopRequested) return false;
      return ex.commitCredentialProvenance(tx, {
        attemptId: args.attemptId,
        claimToken: args.claim.claimToken,
        providerCredentialId: args.credentialId,
        provider: args.plan.provider,
      });
    });
    if (!ok) {
      provenanceRejected = true;
      // Fail CLOSED: throwing here makes the `fetch` structurally unreachable.
      throw new ProvenanceGateRejected();
    }
  };
  const onDispatchStart = (): void => {
    forwardStarted = true;
  };

  try {
    const emitAuditEvent = async (event: unknown): Promise<void> => {
      // ★ AN AUDIT-WRITE FAILURE HERE IS A KNOWN-RESULT FAILURE, NEVER AN UNPROVABLE ONE. Every
      // emit this executor makes describes a COMPLETED provider interaction: `invoked` carries the
      // status code and response hash, and the stream finalizer runs after the drain. So if the
      // capture fails, the provider's fate is PROVEN and only our record of it is missing.
      //
      // Without this marker the outer catch saw an ordinary error with `forwardStarted` true and
      // recorded `outcome_unknown` — discarding a response already in hand AND asserting
      // ambiguity about a fate we could prove, in the one state whose entire value is that it is
      // reserved for genuine unknowns.
      //
      // Wrapping it HERE rather than at each call site is what makes it cover the GOVERNED path
      // too: the provider handlers emit through this very function, so their post-response audit
      // writes are classified identically without forking the provider pipeline.
      //
      // ★ GATED ON `forwardStarted`, BECAUSE NOT EVERY EMIT IS POST-RESPONSE. The governed
      // handlers also emit when GOVERNANCE REFUSES — before any POST exists. Marking a capture
      // failure there as `persistence_error` would assert that the provider answered a request it
      // never received.
      //
      // ★ THIS GATE IS DEFENCE IN DEPTH, NOT A BUG FIX, AND SAYING SO IS THE POINT. The outer
      // catch ALREADY reaches the right answer without it, because it tests `!forwardStarted`
      // BEFORE it tests this marker — so a pre-POST failure classifies as `local_error` either
      // way (`R7-4` passes with or without this line, and is a characterization test, not a
      // falsification one). The gate exists so the property is LOCAL to the classification rather
      // than an emergent consequence of the order of two branches thirty lines apart, which is
      // the kind of coupling a later edit silently breaks.
      try {
        await deps.db.captureAuditEvent(event, args.identity);
      } catch (err) {
        if (forwardStarted) throw new OutputPersistenceFailed(err);
        throw err;
      }
    };
    const result =
      args.plan.mode === 'governed'
        ? await dispatchGoverned(deps, args, { beforeDispatch, onDispatchStart, emitAuditEvent })
        : await dispatchPassthrough(deps, args, { beforeDispatch, onDispatchStart, emitAuditEvent });

    if (result.kind !== 'stream') return await recordResult(deps, owner, args, result);

    // ─────────────────────────────────────────────────────────────────────────────────────────
    // ★ THE PRE-DRAIN GUARD — STRUCTURAL, NOT A PAIR OF POINT FIXES.
    //
    // A stream result owns a LIVE provider connection from the moment `forwardStream` returns:
    // its pump starts eagerly and reads ahead whether or not anyone consumes it. Every exit
    // between here and the drain therefore has two obligations — stop the provider, and emit the
    // terminal stream evidence — and `recordStream`'s own `finally` discharges them ONLY once
    // iteration has begun.
    //
    // Two such exits exist today (`markStreaming` throwing, and the fence rejecting it), and
    // patching those two sites would leave the NEXT one to be found in review, which is exactly
    // how this class of defect has recurred. So the obligation is enforced here, at the single
    // place every path must pass through, keyed on the only fact that matters: whether terminal
    // evidence was emitted at all.
    //
    // `finalize` is wrapped rather than tracked with a "did we drain" flag because the wrapper
    // makes double-emission impossible: `recordStream` always finalizes (its own `finally`
    // guarantees it), so a discharged obligation is self-evident and the guard stays silent.
    // ─────────────────────────────────────────────────────────────────────────────────────────
    let terminalEmitted = false;
    const guarded: DispatchResult = {
      ...result,
      finalize: async (outcome: StreamTerminalOutcome) => {
        terminalEmitted = true;
        await result.finalize(outcome);
      },
    };
    try {
      return await recordResult(deps, owner, args, guarded);
    } finally {
      if (!terminalEmitted) {
        // Never drained. Cancel FIRST — that settles the pump, which is what lets `finalize()`
        // resolve instead of waiting for an EOF that will never come.
        await result.cancel().catch(() => undefined);
        // `upstream_error` is the honest outcome: no terminal frame was ever observed. Recording
        // `complete` here would hash a prefix and assert completion over it.
        await result.finalize('upstream_error').catch(() => undefined);
      }
    }
  } catch (err) {
    if (provenanceRejected) {
      // Commit 4 lost its fence, or a Stop/rotation landed. NO POST HAPPENED — the gate is what
      // the `fetch` is gated on. Try the §9 step-4 FENCED RESTORE so the attempt becomes
      // ordinarily reclaimable instead of stranding in `dispatching` until the sweep.
      const restored = await deps.db.withOwnerContext(owner, (tx) =>
        ex.restoreDispatchingToAccepted(tx, {
          attemptId: args.attemptId,
          claimToken: args.claim.claimToken,
          leaseMs: deps.leaseMs,
        }),
      );
      deps.log.warn(
        { attempt_id: args.attemptId, restored },
        'conversation executor: provenance gate rejected before any provider call',
      );
      return restored ? 'provenance_lost_restored' : 'stopped_before_dispatch';
    }
    if (!forwardStarted) {
      // (1) NOTHING WAS TRANSMITTED. Request construction rejected a malformed URL or an invalid
      // header byte, or the pipeline raised before the forward. The provider provably did not
      // process this request — so it is `failed` with a GOVAI-LOCAL class, not `provider_error`
      // (which would blame a provider that was never contacted) and not `outcome_unknown`
      // (which would invent ambiguity where there is proof).
      deps.log.warn(
        { attempt_id: args.attemptId, err_class: errClass(err) },
        'conversation executor: local failure before the provider forward started',
      );
      return finalizeAndWake(deps, owner, args.context, args.attemptId, args.claim.claimToken, 'failed', 'local_error', 'local_error');
    }
    if (err instanceof OutputPersistenceFailed) {
      // (2) THE PROVIDER ANSWERED AND WE FAILED TO RECORD IT — a KMS encryption fault, a
      // database write error, a fenced append that threw. The fate is PROVEN, so
      // `outcome_unknown` would be a lie in the one place this codebase most needs it to be
      // true. It is also NOT safe to blindly retry: the provider already did the work.
      //
      // ★ THE MARKER CARRIES THE FACT, RATHER THAN A FLAG INFERRING IT. That distinction is
      // load-bearing for STREAMS specifically: a stream whose upstream dies mid-drain has also
      // "had a response" (headers + status arrived), yet its terminal frame never did — so its
      // fate IS unprovable and it must fall through to (3). Only a durable-WRITE failure is
      // wrapped in this marker, so the two cannot be confused.
      deps.log.error(
        { attempt_id: args.attemptId, err_class: errClass(err) },
        'conversation executor: provider responded but the result could not be persisted',
      );
      return finalizeAndWake(deps, owner, args.context, args.attemptId, args.claim.claimToken, 'failed', 'persistence_error', 'persistence_error');
    }
    // (3) TRANSMITTED, NO TERMINAL PROOF. Whether the provider completed is genuinely unknowable
    // — a connection reset looks identical before and after the request was processed, and a
    // stream without its terminal frame proves nothing about completion. THIS is what
    // `outcome_unknown` is for: `failed` would assert non-processing, and an automatic re-drive
    // would risk a SECOND execution.
    deps.log.warn(
      { attempt_id: args.attemptId, err_class: errClass(err) },
      'conversation executor: provider fate unprovable after forward started',
    );
    return finalizeAndWake(deps, owner, args.context, args.attemptId, args.claim.claimToken, 'outcome_unknown', null, 'outcome_unknown');
  } finally {
    // Awaited: a tick still holding a client must not outlive the dispatch that started it.
    await heartbeat.stop();
  }
}

/**
 * Raised when a durable write FAILS after the provider already answered.
 *
 * ★ IT EXISTS TO KEEP `outcome_unknown` HONEST. Without it, every post-dispatch exception looked
 * identical to "the provider never replied", so a KMS blip while persisting a successful answer
 * was recorded as an unprovable provider fate — losing a known result AND diluting the one state
 * whose entire value is that it means something specific.
 */
class OutputPersistenceFailed extends Error {
  constructor(readonly reason: unknown) {
    super('failed to persist provider output');
    this.name = 'OutputPersistenceFailed';
  }
}

/** Raised by the durable gate so the provider packages abort BEFORE `fetch`. Carries no detail:
 *  it is control flow, and the executor already knows why. */
class ProvenanceGateRejected extends Error {
  constructor() {
    super('credential provenance gate rejected the dispatch');
    this.name = 'ProvenanceGateRejected';
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Provider dispatch — the SAME pipeline the direct routes use, entered from a second door
// ─────────────────────────────────────────────────────────────────────────────────────────────

type DispatchHooks = {
  beforeDispatch: () => Promise<void>;
  onDispatchStart: () => void;
  emitAuditEvent: (event: unknown) => Promise<void>;
};

/**
 * How a provider stream ENDED, in the vocabulary `@govai/provider-stream-http` already uses.
 *
 * ★ `client_disconnect` is deliberately absent from the worker's vocabulary: there is no client.
 * The server owns the drain, so a stream either completes or the UPSTREAM failed.
 */
type StreamTerminalOutcome = 'complete' | 'upstream_error';

type DispatchResult =
  | { kind: 'blocked' }
  | { kind: 'response'; status: number; bodyBytes: Buffer }
  | {
      kind: 'stream';
      status: number;
      chunks: AsyncIterable<Uint8Array>;
      /**
       * Stop the provider body WITHOUT iterating `chunks`.
       *
       * ★ WHY THIS CANNOT BE FOLDED INTO THE ITERATOR. `chunks` is an async GENERATOR, and a
       * generator body does not run until its first `next()`. An exit that never begins the
       * drain therefore never acquires the reader and never reaches the iterator's cancelling
       * `finally` — while the wrapper still holds a LIVE provider connection open. (Since
       * R16-2 its pump is demand-driven, so it reads ahead only a bounded amount rather than
       * buffering the whole body — but nothing closes the socket, and by the wrapper's
       * documented contract `finalize()` stays pending until the body is drained, cancelled
       * or aborted.) Calling `return()` on the generator does not help either: a
       * suspended-start generator completes without executing its body.
       */
      cancel: () => Promise<void>;
      /** MUST be invoked exactly once, on EVERY path — including a throwing drain. */
      finalize: (outcome: StreamTerminalOutcome) => Promise<void>;
    };

/**
 * GOVERNED mode — `handleAnthropicGovernedMessages` / `handleOpenAIGovernedResponses`, the very
 * functions `/governed/*` and `/v1/runs` call.
 *
 * ★ ONE EXECUTION SEMANTICS, THREE ENTRY PATHS. Nothing about DLP, tool classification, the
 * enforcement matrix, outbound header policy, transport encoding or the v4 evidence envelope is
 * re-implemented here. The handler is HTTP-independent by construction (the run orchestrator was
 * already its second caller), so the conversation executor is simply its third. A worker-driven
 * dispatch is therefore not a second-class path and cannot drift from the direct one.
 *
 * `resolveProviderKey` returns the ALREADY-RESOLVED in-memory credential: no PostgreSQL, no pool
 * client, no KMS, no network inside the handler — the resolution happened before the boundary,
 * as §9 step 3 requires.
 */
async function dispatchGoverned(
  deps: ConversationExecutorDeps,
  args: DispatchArgs,
  hooks: DispatchHooks,
): Promise<DispatchResult> {
  const dispatchSignal = AbortSignal.timeout(deps.dispatchTimeoutMs);
  const input = {
    tenant: args.tenant,
    rawBody: args.requestBody,
    // The worker has no inbound HTTP request, so there are no client headers to relay. Passing
    // only `content-type` is not a simplification — it is the STRONGEST form of "GovAI metadata
    // never reaches the provider": there is nothing to leak, by construction.
    inboundHeaders: { 'content-type': 'application/json' },
    isStream: args.isStream,
    // ★ BOTH CHANNELS, DELIBERATELY. The handler threads `dispatchSignal` into the NON-stream
    // forward and `signal` into the STREAM one, and it is the only abort channel each path has.
    // For the direct routes `signal` means "the client disconnected"; the worker has no client,
    // so here it carries OUR dispatch bound — without it a governed stream would be unbounded.
    dispatchSignal,
    signal: dispatchSignal,
    beforeDispatch: hooks.beforeDispatch,
    onDispatchStart: hooks.onDispatchStart,
  };
  const providerDeps = {
    upstreamBaseUrl: deps.upstreamBaseUrlFor(args.plan.provider),
    resolveProviderKey: async () => ({
      apiKey: args.apiKey,
      source: 'tenant_provider_credential' as const,
    }),
    dlpScan: async (text: string) => ({
      // Byte-identical to the direct governed routes' scan (`governed-anthropic.ts:63-77`):
      // merged spans, not raw matches, so a bare CPF counts as ONE finding.
      findings: mergeFindingSpans(detectAllBaseline(text)).map((f) => ({
        detector: f.detector,
        signal_class: f.signal_class,
      })),
    }),
    emitAuditEvent: hooks.emitAuditEvent as (e: never) => Promise<void>,
    preResolvedCredentialSource: 'tenant_provider_credential' as const,
  };

  const result =
    args.plan.provider === 'anthropic'
      ? await handleAnthropicGovernedMessages(input as never, providerDeps as never)
      : await handleOpenAIGovernedResponses(input as never, providerDeps as never);

  if (result.kind === 'blocked') return { kind: 'blocked' };
  if (result.kind === 'non_stream') {
    return { kind: 'response', status: result.status_code, bodyBytes: result.response_body_raw };
  }
  const streamResult = result;
  return {
    kind: 'stream',
    status: streamResult.status_code,
    chunks: readableToAsyncIterable(streamResult.body),
    cancel: async () => {
      // Unlocked on every pre-drain path (the generator never took the reader), so this reaches
      // the wrapper's `cancel` handler and closes the upstream connection.
      await streamResult.body.cancel().catch(() => undefined);
    },
    // The handler owns the terminal evidence emit. The outcome is REPORTED, not assumed:
    // `complete` only when the server actually drained to the end.
    finalize: async (outcome: StreamTerminalOutcome) => {
      await streamResult.finalize(outcome);
    },
  };
}

/**
 * PASSTHROUGH mode — `forwardRaw` / `forwardStream` plus the shared v4 evidence builder.
 *
 * ★ NATIVE FIDELITY IS PRESERVED AND GOVERNANCE IS NOT APPLIED, which is what `passthrough`
 * MEANS as a durable conversation lane (§3). The request body is forwarded exactly as stored;
 * `enforcement_decision` is `observe`, matching `/passthrough/*` (`register-passthrough.ts:625`)
 * — this surface audits, it does not enforce.
 *
 * ★ THE OUTBOUND HEADERS ARE SYNTHESIZED, NOT REWRITTEN. `rewritePassthroughHeaders` exists to
 * STRIP a browser's inbound headers; the worker has none, so there is nothing to strip. Emitting
 * exactly the provider's auth + version headers is both minimal and the strongest possible form
 * of the "provider never sees GovAI metadata" rule.
 */
async function dispatchPassthrough(
  deps: ConversationExecutorDeps,
  args: DispatchArgs,
  hooks: DispatchHooks,
): Promise<DispatchResult> {
  const isAnthropic = args.plan.provider === 'anthropic';
  const headers: Record<string, string> = isAnthropic
    ? {
        'content-type': 'application/json',
        'x-api-key': args.apiKey,
        'anthropic-version': '2023-06-01',
      }
    : { 'content-type': 'application/json', authorization: `Bearer ${args.apiKey}` };

  const capability = isAnthropic
    ? args.isStream
      ? ANTHROPIC_MESSAGES_STREAM
      : ANTHROPIC_MESSAGES_CREATE
    : args.isStream
      ? OPENAI_RESPONSES_STREAM
      : OPENAI_RESPONSES_CREATE;
  const governance = resolveGovernance({
    capability,
    tenant_tier: args.tenant.tier,
    operational_mode: args.tenant.operational_mode,
    tool_classifications: [],
    dlp_findings: [],
    is_multipart: false,
  });
  const buildInvoked = isAnthropic
    ? buildAnthropicPassthroughInvoked
    : buildOpenAIPassthroughInvoked;
  const allowlistVersion = isAnthropic ? ANTHROPIC_BETA_POLICY_VERSION : OPENAI_BETA_POLICY_VERSION;
  const occurredAt = new Date();
  const commonEvidence = {
    tenant: args.tenant,
    capability_id: capability.id,
    capability_level: 'passthrough_audited' as const,
    capability_canonical_level: args.plan.canonicalLevel,
    native_endpoint: args.plan.nativePath,
    native_method: 'POST' as const,
    is_multipart: false,
    base_risk_class: governance.base_risk_class,
    effective_risk_class: governance.effective_risk_class,
    risk_escalation_reasons: governance.risk_escalation_reasons,
    enforcement_decision: 'observe' as const,
    occurred_at: occurredAt,
    credential_source: 'tenant_provider_credential',
    allowlist_version: allowlistVersion,
    body_forward_mode: 'raw' as const,
  };

  if (args.isStream) {
    const forwardStream = isAnthropic ? anthropicForwardStream : openaiForwardStream;
    const fwd = await forwardStream({
      baseUrl: deps.upstreamBaseUrlFor(args.plan.provider),
      concretePath: args.plan.nativePath,
      method: 'POST',
      headers,
      body: args.requestBody,
      signal: AbortSignal.timeout(deps.dispatchTimeoutMs),
      beforeDispatch: hooks.beforeDispatch,
      onDispatchStart: hooks.onDispatchStart,
    });
    return {
      kind: 'stream',
      status: fwd.status,
      chunks: readableToAsyncIterable(fwd.body),
      cancel: async () => {
        await fwd.body.cancel().catch(() => undefined);
      },
      finalize: async (outcome: StreamTerminalOutcome) => {
        const final = await fwd.finalize();
        await hooks.emitAuditEvent(
          buildInvoked({
            ...commonEvidence,
            is_stream: true,
            native_request_hash: fwd.native_request_hash,
            stream_final_hash: final.stream_final_hash,
            stream_outcome: outcome,
            latency_ms: final.latency_ms,
            status_code: fwd.status,
            ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
          } as never),
        );
      },
    };
  }

  const forwardRaw = isAnthropic ? anthropicForwardRaw : openaiForwardRaw;
  const fwd = await forwardRaw({
    baseUrl: deps.upstreamBaseUrlFor(args.plan.provider),
    pathTemplate: args.plan.nativePath,
    concretePath: args.plan.nativePath,
    method: 'POST',
    headers,
    body: args.requestBody,
    signal: AbortSignal.timeout(deps.dispatchTimeoutMs),
    beforeDispatch: hooks.beforeDispatch,
    onDispatchStart: hooks.onDispatchStart,
  });
  await hooks.emitAuditEvent(
    buildInvoked({
      ...commonEvidence,
      is_stream: false,
      native_request_hash: fwd.native_request_hash,
      native_response_hash: fwd.native_response_hash,
      latency_ms: fwd.latency_ms,
      status_code: fwd.status,
      ...(fwd.provider_request_id ? { provider_request_id: fwd.provider_request_id } : {}),
    } as never),
  );
  return { kind: 'response', status: fwd.status, bodyBytes: fwd.responseBody };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Durable output + COMMIT 5
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function recordResult(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  args: DispatchArgs,
  result: DispatchResult,
): Promise<ExecutionOutcome> {
  if (result.kind === 'blocked') {
    // GovAI governance refused BEFORE the provider was contacted: the gate is inside the
    // forward, and a blocked result never reaches it. No POST, no provenance — `dispatching →
    // rejected`, which 0031's graph admits and which carries no error_class by design.
    return finalizeAndWake(deps, owner, args.context, args.attemptId, args.claim.claimToken, 'rejected', null, 'rejected');
  }

  // ★ EVERY SUCCESSFUL DISPATCH PASSES THROUGH `streaming`, non-stream included: 0031's forward
  // graph (and §7's own diagram) admit `completed` ONLY from `streaming`. `streaming` is the
  // schema's POST-POST RECEIVING state, not an SSE-only one.
  const entered = await deps.db
    .withOwnerContext(owner, (tx) =>
      ex.markStreaming(tx, { attemptId: args.attemptId, claimToken: args.claim.claimToken }),
    )
    // A DB failure HERE is a durable-write failure after the provider answered, not provider
    // ambiguity. `false` (the fence rejecting) is a different thing and stays a normal return.
    .catch((err: unknown) => {
      throw new OutputPersistenceFailed(err);
    });
  if (!entered) {
    // Fenced out between the POST and here — recovery already owns this attempt. The response is
    // discarded with a diagnostic; it never becomes durable and never becomes context (§7.7's
    // zombie rule). No provider exactly-once is claimed: the provider DID process this request.
    deps.log.warn(
      { attempt_id: args.attemptId },
      'conversation executor: fenced out after the provider call; result discarded',
    );
    return 'finalize_fenced_out';
  }

  if (result.kind === 'stream') {
    return recordStream(deps, owner, args, result);
  }

  const persisted = await persistOutputItem(
    deps,
    owner,
    args,
    'native_response',
    result.bodyBytes,
  ).catch((err: unknown) => {
    throw new OutputPersistenceFailed(err);
  });
  if (!persisted) return 'finalize_fenced_out';
  const { state, errorClass, outcome } = classifyStatus(result.status);
  return finalizeKnownResult(deps, owner, args, state, errorClass, outcome);
}

/**
 * SERVER-OWNED STREAM DRAIN (§9 step 5 / §27).
 *
 * ★ THE SERVER OWNS THE DRAIN, AND NO BROWSER IS INVOLVED AT ALL. In P0-C the executor is a
 * detached process with no client connection, so "the browser disconnects" is not a case that
 * can arise here — the stronger property holds trivially: execution never depended on a client.
 * (The live relay endpoint that lets a client TAIL this stream is P0-E's; §10's minimum bar —
 * "the server persists/drains the terminal result and a subsequent GET hydrates it" — is what
 * P0-C implements, and it is met.)
 *
 * ★ THE DURABLE PREFIX ALWAYS REFLECTS WHAT WAS RECEIVED. Chunks are flushed at a byte
 * threshold, in order, each through the FENCED append. Concatenating an attempt's chunks in
 * `item_seq` order reproduces the provider's byte stream exactly — no reframing, no parsing, no
 * normalization of provider SSE.
 *
 * ★ NO RESUMABILITY IS CLAIMED. Anthropic Messages streams are not re-cursorable (§10), so a
 * lost stream is drained-and-persisted, never replayed.
 */
async function recordStream(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  args: DispatchArgs,
  result: Extract<DispatchResult, { kind: 'stream' }>,
): Promise<ExecutionOutcome> {
  let buffer: Buffer[] = [];
  let buffered = 0;
  let fenced = false;

  const flush = async (): Promise<void> => {
    if (buffered === 0 || fenced) return;
    const bytes = Buffer.concat(buffer);
    buffer = [];
    buffered = 0;
    // ★ ONLY THE WRITE IS WRAPPED. An exception from `result.chunks` — the upstream dying — must
    // NOT be marked as a persistence failure: that stream has no terminal frame, so its fate is
    // genuinely unprovable and belongs in `outcome_unknown`. Wrapping the whole drain would
    // silently convert every upstream reset into a false "we know what happened".
    const ok = await persistOutputItem(deps, owner, args, 'native_stream_chunk', bytes).catch(
      (err: unknown) => {
        throw new OutputPersistenceFailed(err);
      },
    );
    if (!ok) fenced = true;
  };

  // ★ THE TERMINAL EVIDENCE EMIT MUST HAPPEN ON EVERY PATH, INCLUDING A THROWING DRAIN.
  // A provider stream that resets or times out AFTER response headers makes `for await` throw.
  // Before this `finally`, that threw straight past the finalizer to the `outcome_unknown`
  // handler: the attempt terminalized, but the governed/passthrough finalizer never emitted its
  // audit event — an evidence gap precisely for FAILED provider calls, which is when evidence
  // matters most. The outcome is REPORTED (`upstream_error`), never assumed to be `complete`.
  // ★ EOF IS NOT THE SAME AS "THE LOOP ENDED", and conflating them made the evidence lie. The
  // loop has exactly ONE `break` — the fenced exit — so reaching the line after it with `fenced`
  // set means WE stopped reading early, not that the provider finished. An earlier revision set
  // a single `drained` flag right after the loop, so a fenced exit reported
  // `stream_outcome: complete` while the terminal frame had never been observed: an affirmative
  // false claim in an audit record, which is worse than recording nothing.
  let reachedUpstreamEof = false;
  // Distinguishes "the finalizer failed while an error was already on its way up" from "the
  // finalizer failed and is therefore the ONLY thing wrong" — see the `finally`.
  let drainFailure: unknown = null;
  try {
    for await (const chunk of result.chunks) {
      const bytes = Buffer.from(chunk);
      buffer.push(bytes);
      buffered += bytes.byteLength;
      if (buffered >= deps.streamFlushBytes) await flush();
      // A fenced-out writer STOPS reading: continuing would spend memory draining a stream whose
      // output can never be persisted. The upstream connection closes with the reader.
      if (fenced) break;
    }
    // The only `break` above is the fenced one, so arriving here UNFENCED means the iterator ran
    // to completion — the provider's terminal frame was observed.
    //
    // ★ SET BEFORE THE FINAL FLUSH, DELIBERATELY. `stream_outcome` describes the STREAM; the
    // attempt's own state describes our persistence. They are independent facts and each must be
    // recorded truthfully. If the last flush fences or throws, the upstream still reached EOF —
    // so the evidence correctly says `complete` while the attempt correctly becomes
    // `finalize_fenced_out` / `persistence_error`. Moving this line after the flush would
    // conflate the two and report a stream failure that did not happen.
    reachedUpstreamEof = !fenced;
    await flush();
  } catch (err) {
    drainFailure = err;
    throw err;
  } finally {
    // ★ FLUSH WHAT ACTUALLY ARRIVED, EVEN ON A THROW. Bytes already received are durable truth;
    // discarding them because the stream later died would make the prefix describe less than the
    // server really got. The append is fenced, so this is safe on a rotated claim too.
    if (!reachedUpstreamEof) await flush().catch(() => undefined);
    // The evidence describes the PROVIDER CALL, not our durable-write authority, so it is emitted
    // whether or not the fence held and whether or not the drain completed. A finalizer that
    // itself fails must not mask the original drain error.
    //
    // ★ A RESIDUAL IMPRECISION, RECORDED RATHER THAN HIDDEN. `stream_outcome` is the v4 evidence
    // enum {complete | upstream_error | client_disconnect} and widening it is an evidence-plane
    // change far outside this movement. On the FENCED path the upstream may have been perfectly
    // healthy — we stopped consuming — so `upstream_error` is imprecise about the CAUSE. It is
    // chosen because the only alternatives are worse: `complete` asserts a terminal frame that
    // was never seen, and `client_disconnect` names a client this worker does not have. What the
    // value does say truthfully is "this stream did not finish normally", which is the fact an
    // evidence reader must not be misled about.
    const terminal = result.finalize(reachedUpstreamEof ? 'complete' : 'upstream_error');
    if (drainFailure !== null) {
      // Something is already propagating. A finalizer failure must not MASK it — the original
      // drain error is the more informative fact, and swallowing it to report this one would
      // lose the reason the stream died.
      await terminal.catch((err: unknown) =>
        deps.log.warn(
          { attempt_id: args.attemptId, err_class: errClass(err) },
          'conversation executor: stream terminal evidence emit failed',
        ),
      );
    } else {
      // ★ NOTHING IS PROPAGATING, SO THIS FAILURE IS THE ONLY SIGNAL THAT EVIDENCE IS MISSING.
      // Swallowing it here let a stream that reached EOF be durably marked `completed` while its
      // required terminal event was never recorded — a permanent evidence gap opened exactly
      // during an audit-database failure, and invisible afterwards because the attempt looks
      // perfectly healthy. "Must not mask the original error" is the right rule; applying it when
      // there IS no original error was the defect.
      await terminal.catch((err: unknown) => {
        deps.log.error(
          { attempt_id: args.attemptId, err_class: errClass(err) },
          'conversation executor: stream terminal evidence could not be recorded',
        );
        // The provider answered and we drained it; only the durable record failed. That is
        // `persistence_error` by definition — never `outcome_unknown`.
        throw new OutputPersistenceFailed(err);
      });
    }
  }

  if (fenced) {
    deps.log.warn(
      { attempt_id: args.attemptId },
      'conversation executor: fenced out mid-stream; durable prefix stopped',
    );
    return 'finalize_fenced_out';
  }
  const { state, errorClass, outcome } = classifyStatus(result.status);
  return finalizeKnownResult(deps, owner, args, state, errorClass, outcome);
}

/** Encrypt (outside the transaction) then append, FENCED (inside one short transaction). */
/** Internal signal: the fenced append matched zero rows, so the whole write must roll back. */
class OutputFenceLost extends Error {
  constructor() {
    super('output append lost its claim-token fence');
    this.name = 'OutputFenceLost';
  }
}

/**
 * Encrypt (outside the transaction) then append, FENCED (inside one short transaction).
 *
 * ★ THE FENCE LOSS MUST ROLL THE CONTENT ROW BACK, NOT JUST REPORT ITSELF. The content INSERT
 * happens first, and if `appendFencedOutputItem` then matches zero rows — the claim was rotated
 * between the encryption and this transaction — returning `false` NORMALLY would COMMIT, leaving
 * an encrypted blob that no item references. Every fence loss during response or stream
 * persistence would accumulate one, for the lifetime of the conversation. Throwing makes
 * `withOwnerContext` roll the whole write back; the signal is caught here and reported as the
 * ordinary `false` the callers already handle.
 */
async function persistOutputItem(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  args: DispatchArgs,
  itemType: 'native_response' | 'native_stream_chunk',
  bytes: Buffer,
): Promise<boolean> {
  const enc = await encryptConversationContent(deps.kms, owner.orgId, bytes);
  try {
    await deps.db.withOwnerContext(owner, async (tx) => {
      const itemSeq = await ex.nextAttemptItemSeq(tx, args.attemptId);
      const contentId = await insertWorkerContent(tx, owner, args.context.conversationId, enc);
      const appended = await ex.appendFencedOutputItem(tx, {
        attemptId: args.attemptId,
        claimToken: args.claim.claimToken,
        itemSeq,
        itemType,
        contentId,
      });
      if (!appended) throw new OutputFenceLost();
    });
    return true;
  } catch (err) {
    if (err instanceof OutputFenceLost) return false;
    throw err;
  }
}

async function insertWorkerContent(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
  conversationId: string,
  enc: Awaited<ReturnType<typeof encryptConversationContent>>,
): Promise<string> {
  const r = await tx.query<{ id: string }>(
    `INSERT INTO govai.ai_conversation_content
       (org_id, owner_user_id, conversation_id, ciphertext, dek_wrapped,
        kms_key_id, kms_key_version, content_hmac)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::bytea, $5::bytea, $6::text, $7::integer, $8::bytea)
     RETURNING id`,
    [
      owner.orgId,
      owner.ownerUserId,
      conversationId,
      enc.ciphertext,
      enc.dekWrapped,
      enc.kmsKeyId,
      enc.kmsKeyVersion,
      enc.contentHmac,
    ],
  );
  return r.rows[0]!.id;
}

/**
 * The §7.4 taxonomy, applied to a DEFINITE provider response.
 *
 * A response — of ANY status — proves the provider processed the request, so nothing here is
 * ever `outcome_unknown`. That state is reserved for the case where no response arrived at all.
 */
function classifyStatus(status: number): {
  state: 'completed' | 'failed';
  errorClass: ex.AttemptErrorClass | null;
  outcome: ExecutionOutcome;
} {
  if (status >= 200 && status < 300) {
    return { state: 'completed', errorClass: null, outcome: 'completed' };
  }
  if (status === 401 || status === 403) {
    return { state: 'failed', errorClass: 'auth_rejected', outcome: 'failed' };
  }
  if (status === 413) {
    return { state: 'failed', errorClass: 'request_too_large', outcome: 'failed' };
  }
  if (status === 429) {
    return { state: 'failed', errorClass: 'rate_limited', outcome: 'failed' };
  }
  return { state: 'failed', errorClass: 'provider_error', outcome: 'failed' };
}

/**
 * COMMIT 5 + the §8 QUEUE WAKE.
 *
 * Terminalization must ACTIVELY release the branch: "a queued turn never waits for luck". The
 * causal-version bump is what makes a concurrently-building sibling detect that its context is
 * stale (§7.8), and the branch's next `accepted` head becomes claimable in the same instant.
 */
async function finalizeAndWake(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  context: ex.ExecutionContext,
  attemptId: string,
  claimToken: string,
  state: 'completed' | 'failed' | 'stopped' | 'rejected' | 'outcome_unknown',
  errorClass: ex.AttemptErrorClass | null,
  outcome: ExecutionOutcome,
): Promise<ExecutionOutcome> {
  const finalized = await deps.db.withOwnerContext(owner, async (tx) => {
    const ok = await ex.finalizeAttempt(tx, { attemptId, claimToken, state, errorClass });
    if (ok) {
      await ex.bumpBranchCausalVersion(tx, {
        conversationId: context.conversationId,
        branchId: context.branchId,
      });
    }
    return ok;
  });
  if (!finalized) {
    deps.log.warn({ attempt_id: attemptId, state }, 'conversation executor: finalize fenced out');
    return 'finalize_fenced_out';
  }
  return outcome;
}

/**
 * COMMIT 5 for a KNOWN provider result: `finalizeAndWake`, with its FAILURES classified by what
 * is already PROVEN rather than by which branch of the outer catch they happen to land in.
 *
 * ★ THE DISTINCTION THIS RESTORES IS THE ONE THIS EXECUTOR IS BUILT ON. When these two calls
 * run, the provider has answered, the status has been classified and the response (or the whole
 * drained stream) is already durable. If the terminal transaction then throws — a deadlock on
 * the attempt row, a lost connection between the `finalizeAttempt` UPDATE and the branch bump,
 * any transient fault — the fate is not ambiguous in the slightest; only OUR record of it
 * failed. Before this wrapper such a throw arrived at the outer catch as an ordinary error with
 * `forwardStarted` true and terminalized as `outcome_unknown`: an affirmative claim of
 * ambiguity, made at the one moment the outcome was fully proven, in the one state whose entire
 * value is that it is reserved for genuine unknowns (§7.7 builds real behaviour on it — no
 * automatic re-drive, only a probe may resolve it).
 *
 * ★ A WRAPPER, NOT TWO POINT FIXES. The non-stream and the stream paths terminalize from two
 * different functions, and this codebase has already had to re-fix the second one a round after
 * fixing the first (`R7-2` after `R7-3`, `R8-1b` after `R8-1`). One call site for both means the
 * classification cannot diverge again.
 *
 * ★ WHAT IS DELIBERATELY *NOT* WRAPPED. A `false` from the terminal CAS — the fence rejecting a
 * rotated claim — is a NORMAL RETURN, not an exception, so it still reports
 * `finalize_fenced_out`; a fencing miss is not a persistence fault and must not be recoloured as
 * one. And the PRE-DISPATCH callers keep calling `finalizeAndWake` directly: no provider was
 * contacted there, so a write failure is GovAI-local, and marking it `persistence_error` would
 * assert that a provider answered a request it never received.
 */
async function finalizeKnownResult(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  args: DispatchArgs,
  state: 'completed' | 'failed',
  errorClass: ex.AttemptErrorClass | null,
  outcome: ExecutionOutcome,
): Promise<ExecutionOutcome> {
  try {
    return await finalizeAndWake(
      deps,
      owner,
      args.context,
      args.attemptId,
      args.claim.claimToken,
      state,
      errorClass,
      outcome,
    );
  } catch (err) {
    throw new OutputPersistenceFailed(err);
  }
}

/**
 * Ratchet a stranded attempt to `outcome_unknown` AND release its branch, in ONE transaction.
 *
 * ★ THE BUMP BELONGS INSIDE THE RATCHET'S TRANSACTION, EXACTLY AS `finalizeAndWake` ALREADY DOES
 * IT. Committing the ratchet first and bumping in a SECOND transaction opens two failure modes,
 * both silent. In the gap, the branch's newly released head is claimable while `causal_version`
 * still reads pre-ratchet — so a concurrently-building sibling cannot detect that its context is
 * stale (§7.8), which is the entire purpose of the bump. And if the process dies or the second
 * transaction fails, the branch keeps the stale version PERMANENTLY, with nothing left to retry
 * it: the attempt is already terminal, so no later sweep revisits it.
 *
 * Terminalization must ACTIVELY release the branch, and "actively" has to mean atomically.
 */
async function ratchetAndWake(
  tx: PoolClient,
  input: { attemptId: string; expectedToken: string; graceMs: number },
): Promise<boolean> {
  const ratcheted = await ex.ratchetStrandedToOutcomeUnknown(tx, input);
  if (ratcheted) {
    const context = await ex.readExecutionContext(tx, input.attemptId);
    if (context) {
      await ex.bumpBranchCausalVersion(tx, {
        conversationId: context.conversationId,
        branchId: context.branchId,
      });
    }
  }
  return ratcheted;
}


// ─────────────────────────────────────────────────────────────────────────────────────────────
// Heartbeat
// ─────────────────────────────────────────────────────────────────────────────────────────────

export type HeartbeatHandle = {
  /** Disarms the timer AND settles the in-flight tick, so no checkout outlives the candidate. */
  stop(): Promise<void>;
};

/**
 * §7.7 — the TIMER-DRIVEN lease renewal, running for the whole post-boundary window.
 *
 * ★ TIMER, NOT EVENT. A slow non-stream response, or a slow time-to-first-byte, produces NO pump
 * iterations — so an event-driven renewal would let a perfectly healthy runner lose its lease and
 * be ratcheted out from under itself. The timer keeps the lease alive precisely when there is
 * nothing to observe.
 *
 * ★ CHAINED, NOT PERIODIC — AND THAT IS A POOL-SAFETY PROPERTY, NOT A STYLE CHOICE. Each tick
 * checks out a client from a pool whose worker default is `max: 2`. Under `setInterval`, a tick
 * slower than the interval does not delay the next one: ticks overlap, and a database slowdown
 * lets renewals — the least important work in the process — occupy every checkout, starving the
 * stream persistence and finalization that actually carry the result. The next tick is therefore
 * scheduled only after the previous one SETTLES, which makes overlap structurally impossible
 * instead of merely unlikely.
 *
 * ★ `stop()` SETTLES THE IN-FLIGHT TICK, it does not merely disarm the timer. Clearing the timer
 * ends future ticks but leaves a running one holding its checkout, which then outlives the
 * candidate it was renewing — a leak that only appears under the slow-database conditions where
 * checkouts are already scarce. Because ticks are chained, at most ONE can be in flight, so
 * awaiting it is bounded by that single operation. `unref()` additionally prevents a pending
 * timer from holding the process open during shutdown.
 *
 * ★ IT CANNOT THROW INTO ANYTHING. Each tick is fully guarded: a database blip must not become an
 * unhandled rejection on a timer callback, which has no caller to catch it. A tick that loses the
 * fence stops the timer — the runner has no authority left to extend.
 */
function startHeartbeat(
  deps: ConversationExecutorDeps,
  owner: ConversationWorkerOwner,
  attemptId: string,
  claimToken: string,
): HeartbeatHandle {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** The single tick currently in flight, or null. Chaining keeps this at most one. */
  let inFlight: Promise<void> | null = null;

  // ★ THE SUCCESSOR IS DUE AT A FIXED CADENCE, NOT ONE INTERVAL AFTER THE LAST TICK FINISHED.
  // Chaining alone (delay = interval, measured from settlement) silently ADDS each tick's runtime
  // to every period, which breaks the `heartbeatIntervalMs * 3 <= leaseMs` guarantee that config
  // validation enforces at boot. Worked example on the defaults (60s lease, 15s interval): a tick
  // due at 15s that settles at 65s commits a deadline near 75s from PostgreSQL's transaction
  // clock, while a settlement-relative delay would not even ATTEMPT the next renewal until 80s —
  // leaving a window in which recovery can rotate the claim out from under a live provider call.
  //
  // So the due time advances by exactly one period from the PREVIOUS DUE TIME, and an already-past
  // due time fires immediately. Clamping to `now` is what prevents the other failure mode: a
  // naively accumulating schedule would fire a BURST of catch-up ticks after one slow tick, and
  // each of those takes a pool checkout — reintroducing the starvation this chaining exists to
  // prevent.
  // ★ MONOTONIC, NOT WALL CLOCK. `Date.now()` jumps when NTP or a VM host corrects the clock, and
  // a BACKWARD correction is the dangerous direction: `nextDueAt` would still hold the old epoch,
  // so the computed delay absorbs the entire correction and renewals stall — potentially past the
  // database lease, letting recovery rotate a claim out from under a live provider call. The lease
  // deadline itself is committed from PostgreSQL's clock and is unaffected; only OUR cadence would
  // drift, which is exactly the asymmetry that makes it dangerous. `performance.now()` is
  // monotonic and immune to both directions of adjustment.
  const monotonicNow = (): number => performance.now();
  let nextDueAt = monotonicNow() + deps.heartbeatIntervalMs;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(
      () => {
        timer = null;
        const tick = run();
        inFlight = tick;
        void tick.finally(() => {
          if (inFlight === tick) inFlight = null;
          nextDueAt = Math.max(monotonicNow(), nextDueAt + deps.heartbeatIntervalMs);
          // Re-arm only now, so a tick can never overlap its own successor.
          schedule();
        });
      },
      Math.max(0, nextDueAt - monotonicNow()),
    );
    timer.unref?.();
  };

  const run = async (): Promise<void> => {
      if (stopped) return;
      try {
        const beat = await deps.db.withOwnerContext(owner, (tx) =>
          ex.heartbeatClaim(tx, { attemptId, claimToken, leaseMs: deps.leaseMs }),
        );
        if (stopped) return;
        if (!beat.extended) {
          // The token was rotated, the lease already lapsed, or the attempt is terminal. There
          // is nothing left to renew.
          //
          // ★ `disarm()`, NOT `stop()`. Inside a tick the in-flight promise IS this tick, so a
          // settling stop would be waiting on itself. Keeping the two operations as separate
          // functions makes that deadlock unexpressible rather than merely commented against.
          disarm();
          return;
        }
        if (beat.stopRequested) {
          // P0-C exposes no public Stop endpoint, so this is reachable today only via a durable
          // flag written directly to the row. It is READ here because the authority model must
          // be complete before the command exists — and because the §13 contract requires Stop
          // observation to be bounded by the heartbeat even when the provider emits nothing.
          deps.log.info(
            { attempt_id: attemptId },
            'conversation executor: durable stop observed on the heartbeat tick',
          );
        }
      } catch (err) {
        deps.log.warn(
          { attempt_id: attemptId, err_class: errClass(err) },
          'conversation executor: heartbeat tick failed',
        );
      }
  };

  /** End future ticks. Safe from anywhere, including from inside a tick. */
  function disarm(): void {
    if (stopped) return;
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  /** Disarm AND settle the at-most-one running tick, so no checkout outlives the caller. */
  function stop(): Promise<void> {
    disarm();
    // `run()` swallows its own failures, so this settles rather than rejecting into a `finally`.
    return inFlight ?? Promise.resolve();
  }

  schedule();
  return { stop };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────────────────────

async function readTenantFacts(
  tx: PoolClient,
  owner: ConversationWorkerOwner,
): Promise<TenantFacts | null> {
  const r = await tx.query<{ tier: TenantFacts['tier']; operational_mode: TenantFacts['operational_mode'] }>(
    `SELECT tier, operational_mode FROM govai.orgs WHERE id = $1::uuid`,
    [owner.orgId],
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    org_id: owner.orgId,
    user_id: owner.ownerUserId,
    tier: row.tier,
    operational_mode: row.operational_mode,
  };
}

/** Error CLASS only — never the message. A provider/KMS/pg error message can carry a URL, a key
 *  identifier or a fragment of a decrypted body, and these lines reach worker logs. */
function errClass(err: unknown): string {
  return err instanceof Error && typeof err.name === 'string' ? err.name : 'unknown';
}

/**
 * Adapt a `ReadableStream` to an async iterable, CANCELLING the body if the consumer abandons it.
 *
 * ★ `releaseLock()` IS NOT CANCELLATION, and the difference is a live provider stream. When a
 * mid-drain append loses its fence the consumer `break`s, which runs this `finally` — and
 * releasing the lock merely detaches the reader. The underlying fetch body keeps streaming, so the
 * provider goes on generating and we go on downloading for a response nobody can persist, until
 * the dispatch timeout. Cancelling closes it at once.
 *
 * The EOF path deliberately does NOT cancel: the stream is already closed, and calling `cancel()`
 * on a completed body is pointless noise.
 */
async function* readableToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  let reachedEof = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        reachedEof = true;
        break;
      }
      if (value) yield value;
    }
  } finally {
    // Abandoned by the consumer (a `break`, a `throw`, or a `return`) ⇒ stop the provider.
    if (!reachedEof) await reader.cancel().catch(() => undefined);
    try {
      reader.releaseLock();
    } catch {
      // `cancel()` can already have closed and released it; a double release is not an error
      // worth propagating out of a cleanup path.
    }
  }
}
