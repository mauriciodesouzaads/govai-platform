# Codex app-server harness (probe harness, not production runtime)

This directory holds the GovAI harness around the pinned standalone `codex-app-server`
(openai/codex `0.154.0`, commit `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`):

- `pin/`: the pin, the vendored upstream schema and `MANIFEST.sha256` (CONT-P5-A).
- `protocol/`: the wire fragment, the GovAI outbound policy and the vendored generated types.
- `client/` and `guard/`: the governed JSON-RPC client, the process handle and the experimental lockout.
- `attestation/attest-runtime.ts`: binary, version and handshake attestation (CONT-P5-A).
- `attestation/*` (everything else): the CONT-P5-E1 effective-feature admission modules described below.

Nothing here is production GovAI runtime code, and nothing here modifies the Codex binary under test.

## CONT-P5-E1 effective-feature admission (Dispatch v8, Architecture A)

Before every protected operation (`thread/start`, `thread/resume`, `thread/fork`) the harness proves that the Config
the pinned server will use has ShellSnapshot V1 = false and V2 = false:

1. `fixture-invariants.ts` checks INV-PATH, INV-PROJ and INV-REPO for the requested cwd, the launch cwd and every
   known history cwd, and checks that `CODEX_HOME/config.toml` is in `STATE_0` or `STATE_1`.
2. `operation-admission-token.ts` sends `experimentalFeature/list` with `{}` params. `effective-feature-list.ts` parses
   the single page strictly. Only `(false, false, complete)` results in an `OPERATION_ADMISSION_TOKEN`.
3. `operation-binder.ts` binds the token to the operation's feature context and to the exact frozen request object.
   The token is consumed once, in the same synchronous section as the governed send.
4. After a `thread/resume`, `resume-structural-validator.ts` validates the result against the frozen field contract
   (`resume-response-contract.ts`). The nested Thread is validated against the pinned schema, node by node.
   `resume-observation-classifier.ts` then derives three separate outputs:
   - `THREAD_SAFETY_STATE` (`thread-safety-state.ts`, with `runtime-provenance-registry.ts`)
   - `BRANCH_KNOWLEDGE`
   - `CONFORMANCE_RESULT`
5. `evidence-projection.ts` builds bounded evidence records only. It never persists raw pages, payloads, error text,
   instruction source paths, writable roots, cursor contents or experimental payloads.

Branch knowledge comes only from pre-send lifecycle evidence (`PRECONDITION_KNOWN_COLD`), never from response values.
A response in which the effective values equal the requested ones does not prove a cold path.

## E1_SAME_USER_EXTERNAL_WRITER_ASSUMPTION (writer C)

Writer C, an unrelated process running under the same ordinary user identity, is **out of scope for E1 by
explicit assumption**. The assumption covers every bounded admission interval, from the completion of the pre-attestation
invariant checks through the upstream consumption of the Config that initializes or reconstructs the protected runtime.
It covers these paths:

- `CODEX_HOME` and `CODEX_HOME/config.toml`;
- every `<dir>/.codex` and `<dir>/.codex/config.toml` candidate on a relevant cwd chain;
- the repository topology used to select those candidates (`.git` markers, worktree or gitdir indirections).

The harness does not implement same-UID locking and does not claim that other same-user processes are unable to write.
Executor-created directories, ownership or permissions are not presented as such a guarantee.

If a relevant mutation is observed, the run stops with `E1_INFRA_FAILURE` and is never reinterpreted as a conformance
result. The pre-checks gate token issue. The post-consume checks (`runPostConsumeDetector`) are **detectors**: they
report what they observe after the fact and cannot undo a session initialization.

## E1_CONTROLLED_ENVIRONMENT_ASSUMPTION (writer H)

No privileged, MDM or root actor mutates system, managed or cloud configuration relevant to `shell_snapshot` or
`shell_snapshot_v2` during any bounded admission interval of an E1 protected operation.

## Harness start

`OperationAdmissionService` refuses to start unless both assumptions are acknowledged explicitly, by a named party
(`assertE1ControlledEnvironmentAcknowledged`). This acknowledgement is a documented flag. It is not a detection claim:
nothing here observes other processes.

## Not a production security property

The E1 controlled-writer assumptions are not a production security property. E1 characterizes stock runtime
behavior under a bounded controlled environment. No product documentation may cite it as proof that GovAI stops
same-user or privileged host processes from modifying Codex configuration.

## Tests

Unit tests use only the unit-tier fake app-server (`client/fake-app-server.fixture.ts`), a small Node script with
canned `experimentalFeature/list` and `thread/*` answers. No test starts a Codex process. The pinned binary is exercised
only by the separate process tier (`vitest.process.config.ts`).
