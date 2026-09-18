# Codex runtime pin V1 — CONT-P5-A foundation (candidate)

> **Movement:** `EP-AI-CONVERSATION-CONTINUITY-V1-01` — **CONT-P5-A · PIN + DRIVER PROTOCOL FOUNDATION (INERT)**
> **Status:** CANDIDATE note. It does not edit or supersede `current-state.md`, `development-roadmap.md`, `resume-playbook.md`, `stale-docs-register.md`, the coding-harness continuation contract or any ADR.
> **Runtime effect:** none. `ACTIVATES_CODEX = NO` — `resolveDispatchPlan` still refuses `codex`/`codex` with `provider_requires_p0d_continuation`; nothing in this movement can execute a Codex turn.
> **Precedence:** the code under `apps/api/src/ai-conversations/harness/codex/` and its executing tests prevail over this note.

## 1. The pin

| Field | Value |
|---|---|
| Release / tag | `0.154.0` · `rust-v0.154.0` |
| Annotated tag object | `36eab01061df3cde5f95ec20a526777b430091ba` |
| Target commit | `6b9826e3aa83b1a5947db50f4332cb9c65f1b340` |
| Upstream release object | MUTABLE (`immutable = false`) |
| GovAI pin authority | TAG_OBJECT + TARGET_COMMIT + ASSET_ID + ASSET_NAME + CONTENT_DIGEST — the same tag serving other bytes is a failed attestation, never an update |

## 2. Exact binary identity

| Field | Value |
|---|---|
| Binary kind | STANDALONE `codex-app-server` (crate `codex-app-server`, bin `codex-app-server`) — not the multitool `codex app-server`; no fallback between them |
| Supported executor platform | `darwin-arm64` only; every other host is `FAIL_CLOSED_NOT_YET_PINNED` |
| Release asset | `codex-app-server-aarch64-apple-darwin.tar.gz` · asset id `553706534` · 67,973,610 bytes |
| Archive SHA-256 | `a88883f1d2b68379eac51bd22be869eb768482aa9dcc1f9a69be86ef71dc6abd` |
| Sole member | `codex-app-server-aarch64-apple-darwin` (0755, 171,099,968 bytes, Mach-O arm64) |
| Executable SHA-256 | `2fc485696e5df06fc492fb310599752775fde726585149eaa7aeadb9117d235a` |
| Invocation | `"<absolute path>/codex-app-server-aarch64-apple-darwin" --listen stdio://` with an explicit environment `{CODEX_HOME, HOME, PATH}` of disposable directories; never via `$PATH` |
| Version attestation | `<absolute path> --version` → stdout recorded verbatim; exactly one semantic version parsed; must equal `0.154.0` |

The constants live in `harness/codex/pin/PIN.ts`; `harness/codex/pin/MANIFEST.sha256` binds every vendored and
derived file to its digest, its commit-addressed retrieval URL and its upstream source.

## 3. Vendored protocol

- `protocol/generated/**` — the 711 generated (`experimentalApi = false`) TypeScript files at the commit, each
  vendored verbatim after a provenance header (`SOURCE_SHA256` = the upstream bytes; ts-rs 11.1.0,
  `GenerateTsOptions::default()`). The tree is byte-identical to upstream's precomputed stable export.
  Hand-written wire types do not exist; `protocol/wire.ts` and `protocol/method-names.ts` are
  `VERBATIM_SOURCE_DERIVED` fragments (the JSON-RPC envelope, the method → response association, runtime mirrors
  of generated unions), each item anchored to its upstream source.
- `pin/vendor/json/` — `ClientRequest.json` and `codex_app_server_protocol.schemas.json` verbatim (schemars 0.8.22).
- The wire is NOT strict JSON-RPC 2.0: no `"jsonrpc"` field in either direction; one JSON message per line.
- Key digests (upstream bytes): `InitializeParams.ts` `bfc13b4f…`, `InitializeCapabilities.ts` `4abc3c8b…`,
  `InitializeResponse.ts` `4feabcb6…`, `ClientInfo.ts` `c3f38c70…`, `v2/ThreadForkParams.ts` `0929c646…`,
  `v2/AskForApproval.ts` `81dd17de…` (full values in `PIN.ts`).

## 4. Attestation law (`attestation/attest-runtime.ts`)

In order, each step fail-closed with a typed `RuntimeAttestationFailed`: pinned host platform → the expected
digest and version ARE the pin → absolute, normalized path naming the §0 member → executable SHA-256 → canonical,
existing, disposable `CODEX_HOME` → `--version` (verbatim stdout, one parsed semver, equal to the pin) → spawn
in the child's own process group with the explicit environment → `initialize` with the frozen request
(`clientInfo = govai-cont-p5a-harness / GovAI CONT-P5-A inert foundation / <apps/api version>`,
`capabilities = { experimentalApi: false, requestAttestation: false }`, bytes asserted) →
`response.codexHome == CODEX_HOME` (userAgent / platformFamily / platformOs recorded) → `initialized` →
only then are thread methods unlocked. A failure after the spawn terminates the process group first. No
server-reported schema hash exists at the pin, and none is required.

## 5. Governance posture

- `VENDOR_MATURITY = EXPERIMENTAL_AT_PIN` (the app-server surface is `[experimental]` upstream) ·
  `GOVAI_USE = PINNED / INERT / CONFORMANCE_GATED`. The protocol capability `experimentalApi` is a separate
  axis and is always `false`.
- Wire contract ≠ GovAI allowed policy. `protocol/EXPERIMENTAL_SOURCE_INVENTORY.md` places all 155
  `#[experimental("…")]` annotations mechanically: 128 × `EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE` (inexpressible,
  unemittable) and 27 × `EXPERIMENTAL_REPRESENTABLE_ON_GENERATED_WIRE` (kept in the wire types, refused by
  GovAI — on the covered surface only `askForApproval.granular`). Separately, `NON_EXPERIMENTAL_UPSTREAM_BUT_GOVAI_FORBIDDEN`:
  `"auto_review"`/`"guardian_subagent"`, `"danger-full-access"`, `"never"`, `SandboxPolicy` `dangerFullAccess` /
  `externalSandbox`.
- GovAI allows: approval policy `on-request` | `untrusted`; approvals reviewer `user`; sandbox `read-only` |
  `workspace-write` (`readOnly` | `workspaceWrite` policies). `thread/fork` requires `lastTurnId`; `turn/steer`
  requires `expectedTurnId`.
- `PROCESS_GROUP_CONTROL = FOUNDATION_ONLY` (own group, in-group inventory, SIGTERM → SIGKILL to the managed
  group, direct-child reap). `RESOURCE_FENCING_GATE = OPEN`; `DESCENDANT_QUIESCENCE_PROOF` and `STALE_WRITER_PROOF`
  are DEFERRED (E1); `PROCESS_ESCAPE_DETECTION` is DEFERRED (C/E2). No claim of all-descendants-terminated,
  no-orphans or no-MCP-residue is made.

## 6. Recorded at the pin (CONT-P5-A executor evidence; no credential; observed, not normative)

- `initialize`, `thread/start`, `thread/read` and `thread/delete` succeed without any authentication.
- The server writes into `CODEX_HOME` from startup on — even for `--version` — so an isolated `CODEX_HOME` is
  mandatory for every invocation, not only for sessions.
- Its responses carry category (1) keys (for example `Thread.environments`) to an `experimentalApi = false`
  client; the generated types do not expose them, and this movement does not decide how later movements treat
  such inbound keys.
- The managed process group can hold server descendants (for example `git`) during a session — the reason the
  group control above is foundation-only.

## 7. E1 credential note

If E1 needs real authentication for its probes, that is a separate owner-authorized dispatch with a disposable
test identity, an isolated `CODEX_HOME`, zero credential material in the repository, logs or reports, and no
claim of equivalence to CONT-P5-C production credential mediation. The ordering A → E1 is unchanged.

## 8. Re-running the process tier

```sh
CODEX_PIN_BINARY=<absolute path of the extracted member> \
CODEX_PIN_ARCHIVE=<absolute path of codex-app-server-aarch64-apple-darwin.tar.gz> \
pnpm exec vitest run --config apps/api/src/ai-conversations/harness/codex/vitest.process.config.ts
```

The root unit tier (CI) collects the suite without running it; the process tier fails — never skips — on a
missing or wrong artifact, digest, version or `CODEX_HOME`, on `experimentalApi` enabled, or on any failed
attestation predicate.

## 9. What stays open

The six runtime gates (CODEX_P5, CLAUDE_P6, RESOURCE_FENCING, CREDENTIAL_MEDIATION, DISPOSAL,
PROVIDER_STATE_PHYSICAL_REPRESENTATION), F-01 and R1_DURABLE_CONTEXT_P1 remain OPEN; ADR-030 is PROPOSED;
PROVIDER_EXACTLY_ONCE is NOT_CLAIMED. The graph A → E1 → B → C → D → E2 → F is unchanged, and the dispatch-registry
denial remains the fail-closed activation boundary through E2.
