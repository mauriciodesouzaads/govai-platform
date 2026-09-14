# AI conversation — coding-harness continuation architecture V1

> **Movement:** `EP-AI-CONVERSATION-CONTINUITY-V1-01` — **P0-D2 · CODING HARNESS CONTINUATION**
> **Category:** B — DOCS + MINIMAL INERT STRUCTURAL CODE
> **Status in this tree:** architecture **PUBLISHED**; new-identity admission **IMPLEMENTED AND INERT**; coding-harness **RUNTIME NOT IMPLEMENTED** (P5 / P6).
> **Precedence:** merged executable source, migrations and executing tests prevail over this document. Where this document and a dated research snapshot disagree about *current* behaviour, this document and [current-state.md](./current-state.md) prevail; where it and the accepted design spec disagree, the disagreement is a defect to be reported, not resolved by preference.

This document is the canonical contract for continuing a conversation whose provider is a
**coding harness** — `codex` or `claude_code` — rather than an HTTP API. It is written to be read
from this repository alone: every decision below is stated here in full, with the source anchors
that constrain it. External sealed decision records are cited for provenance only; none of them is
required to understand or apply this contract.

---

## 1. What P0-D2 is, and what it is not

P0-D1 closed server-assembled durable context for the two **API** surfaces
(`anthropic_messages`, `openai_responses`). It explicitly did not close it for the coding
harnesses, whose continuation is not a request-shaping problem: a harness conversation lives in a
**native object** the provider owns — a thread, a session — and in a **workspace** on a machine.
Continuing one means reasoning about a live process, a filesystem, a credential and an external
object, none of which the API adapters ever had to touch.

P0-D2 therefore splits the problem in two, and delivers only the first half:

```text
P0-D2  ARCHITECTURE + INERT FOUNDATION   ← this movement
P5     CODEX RUNTIME                     ← not started
P6     CLAUDE CODING-HARNESS RUNTIME     ← not started
```

**Delivered here.** The identity, adoption, alignment, credential, fencing, disposal and
vocabulary contracts below; and one inert admission rule that decides which harness identities may
be **created**. Nothing else.

**Not delivered here, and not claimed.** No harness runtime, no native object is ever created, no
provider inference call, no `ai_conversation_provider_state` row, no worker privilege, no new
endpoint, no migration, no credential issuer, no supervisor, no delete protocol.

> **Admission is not capability.** Admitting `codex`/`codex` as a durable identity does **not**
> make it executable. The dispatch registry refuses every coding-harness conversation exactly as it
> did before this movement, canonical or not
> ([`dispatch-registry.ts`](../../apps/api/src/ai-conversations/dispatch-registry.ts)), and a
> regression test pins that specific non-consequence
> ([`dispatch-registry.test.ts`](../../apps/api/src/ai-conversations/dispatch-registry.test.ts)).

### 1.1 Scope matrix

| Concern | P0-D2 (here) | P5 (Codex runtime) | P6 (Claude harness runtime) | Elsewhere |
| --- | --- | --- | --- | --- |
| Identity contract | **Required** — branch / attempt / native separation | binds Codex | binds the Claude harness | no redundant durable id |
| Native-generation contract | **Required** — generation, boundary, provenance | implements threads | implements sessions | Managed Agents separate |
| `provider_state` semantics | **Required**, remains inactive | fenced Codex state | fenced Claude state | full delete orchestration P0-F |
| Adoption protocol | **Required** — two operations | atomic integration + failure tests | atomic integration + failure tests | no later unfenced promotion |
| Taint / rotation | **Required** — conservative recovery law | exact-pin proof | exact-pin proof | no blind reuse |
| Surface tokens | **Category-B minimum, implemented here** | consumes explicit identity | consumes explicit identity | no silent aliases |
| Credential mediation | **Required** — principles + provenance | implements / verifies | implements / verifies | broader lifecycle (R14) |
| Workspace ownership | **Required** — branch owns, attempt mutates | Codex resources | Claude resources | no universal worktree mandate |
| Process / resource fencing | **Required** — resource-authority invariant | implements / proves | implements / proves | P0-A2 A1/A4 not reopened |
| Codex maturity gate | **Defines** the required axes | discharges at its pin | — | no API-provider substitution |
| Claude persistence gate | **Defines** the constraints | — | discharges at its pin | no internal JSONL protocol |
| Disposal | **Contract + ownership** | minimal safe cleanup before activation | minimal safe cleanup before activation | full Delete is P0-F |
| Approvals / events | preserve native semantics (LAW NX-20) | complete Codex mapping | complete Claude mapping | common UI later, never a common denominator |
| Full parity / runtime | **out** | owns Codex | owns Claude | — |
| Persistent workspace UI | **out** | integrate later | integrate later | P0-E; Workroom is distinct |

### 1.2 The six deferred runtime gates

These are **OPEN**. They do not block this architecture; they block the corresponding runtime from
being activated or claimed.

| Gate | Owner | What must be proven |
| --- | --- | --- |
| `CODEX_P5_MATURITY` | P5 | at the selected pin: supported interface/transport, thread start/resume/read, exact-boundary fork, turn steer/interrupt, approvals incl. negative/default/timeout, sandbox/workspace semantics, native state placement and ownership-conflict semantics, teardown, schema compatibility |
| `CLAUDE_P6_PERSISTENCE` | P6 | at the selected pin: persistence completion and consistent read, chain completeness including required subagents, identity mapping, native local-fallback control, isolated writers, exact-boundary reconstruction, resource quiescence, delete authority |
| `RESOURCE_FENCING` | P5 / P6 | verified old-process termination, revoked authority, or genuinely isolated resources — before any successor mutates shared resources |
| `CREDENTIAL_MEDIATION` | P5 / P6 + the credential lifecycle work | issuance and revocation, immutable provenance, tenant isolation, per-call attribution, non-bypass |
| `NATIVE_DISPOSAL` | P5 / P6 before activation; P0-F for the full lifecycle | provisional/adoption settlement, orphan crash-window recovery, provable cleanup under the original provenance |
| `PROVIDER_STATE_PHYSICAL` | P5 / P6 | physical envelope/index/schema choice, targeted writer privilege and CAS, atomic terminal integration |

`R1_DURABLE_CONTEXT_P1` stays **OPEN for `codex` and `claude_code`**. Publishing this architecture
does not close it; the runtime that implements it does.

---

## 2. Identity model

The identities already in the tree are sufficient. **No new durable Agent Session id is
introduced**, and none may be introduced later without a concrete invariant the existing ones
provably cannot express.

| Identity | Allocated by | Authority it carries | Under fork / retry / rotation |
| --- | --- | --- | --- |
| `conversation_id` / `branch_id` | GovAI control plane | the stable continuation and correlation identity; the **branch** owns the durable execution triple and the causal lineage (0031 freezes `provider`/`surface`/`model` for a branch's life) | a fork creates a **child branch**; a retry stays within the same branch; native rotation never renames a branch |
| `turn_id` / `attempt_id` | GovAI durable execution | the causal and evidence units | a regenerate creates a new attempt or child per the canonical rules; an attempt id is never reused for a second execution |
| claim token / lease | GovAI execution authority | temporary authority to mutate — a secret, never a user-facing identifier | rotates on acquisition; a stale claim can neither adopt nor overwrite current state |
| **native generation + handle** | generation by GovAI integration; handle by the harness | an opaque, sensitive provider handle held inside the encrypted state envelope, bound to its branch and to the credential that created it | fork or rotation yields an explicit **new generation**; a historical generation is never overwritten |
| **resource / workspace generation** | the supervisor or resource manager, only where one is needed | an explicit locator and ownership fact | a new resource authority exists only after §7's invariant holds |

Three consequences are load-bearing:

1. **A native handle is not a scope.** Its spelling proves nothing about branch, owner or
   credential. Validate the whole composite lineage, never an identifier alone.
2. **Native identifiers and storage locators are sensitive.** They do not appear in logs, headers
   or projections as plaintext convenience. Branch and attempt ids remain the governance
   identifiers they already are, and are never quietly replaced by encrypted provider handles.
3. **Every native generation records immutable creation provenance** — selected runtime and
   schema, storage/resource generation, credential identity, and its seed or adoption
   relationship. The active pointer advances only through §4's protocol. A credential rotation
   never silently rebinds an existing generation to a different account.

Evidence correlates `branch → attempt → provider calls → native items` without pretending those
identities are interchangeable. One durable harness attempt may emit **many** model and tool
calls: each provider call keeps its own ADR-028 request identity, correlated to its parent attempt.
One request identity is never reused for all calls, and **provider exactly-once is never claimed.**

---

## 3. `provider_state` — what it means and what it may never become

`govai.ai_conversation_provider_state` exists in the schema (migration 0031) and **no production
code path in this tree writes it**. The only writes anywhere are migration-falsification test
fixtures, seeded through the admin role precisely to prove 0031's own guards; no runtime flow,
P0-D1's included, creates a row, and no role holds harness-adoption authority over the table.

Its semantic role, fixed here:

- It represents **native continuation state for one branch** — the native generation, the harness
  or provider state associated with it, the immutable credential provenance, the causal/adoption
  boundary, and taint/rotation/fencing facts.
- It is **opaque outside its adapter**. Nothing global assumes Codex state resembles Claude state
  or OpenAI state.
- It is **not a second causal truth** and **not a routing alias**. The GovAI durable projection
  decides what a branch means and what may execute; `provider_state` can never override the
  durable triple the dispatch registry reads, and can never make an excluded output eligible.

Future adoption authority is **targeted**: the compare-and-swap predicates and the privileges for
the adoption write must be created specifically for that operation, in its owning movement. Reusing
some other claim pattern is not proof that this write is fenced. Nothing about it is activated
here.

---

## 4. Seed installation versus terminal advancement

The single most consequential contract in this document: **installing a seed and advancing after
execution are different operations with different fences.** Collapsing them is how a system ends up
with native state that no longer corresponds to its own history.

### 4.1 Seed / generation installation, before dispatch

1. In short database phases, read the authorized branch projection, identity, credential
   provenance, current claim and the expected active generation. **Release the database client
   before any KMS or native I/O.**
2. Prepare, create or fork the native object **outside a transaction**, from an exactly admissible
   boundary. The existence of a handle does not grant authority to mutate anything.
3. **Immediately** append the canonical `PROVISIONAL` disposal record for the object just created
   (§8).
4. In one fenced local transaction, revalidate owner and root lifecycle, complete branch lineage,
   the current claim and database-time lease, the required causal sample and projection, the
   credential binding, the expected active generation and the resource authority — then install the
   seed anchor **and settle its provisional record in that same transaction**.
5. Settlement must win the cleanup-maturity / claim CAS. A loser publishes no active generation;
   its object stays eligible for authorized disposal.

The seed describes **the exact durable input projection prepared for the upcoming attempt**. It is
never a fabricated completed result.

### 4.2 Advancement, after native execution

Advancement **must happen inside the durable terminal transaction that makes the attempt causally
eligible.** A later, independently fenced promotion is explicitly **not accepted** by this
architecture: no crash-window or visibility argument makes it equivalent.

Before entering that transaction, obtain the native terminal evidence, the exact native boundary
identifiers, the relevant persistence and resource-quiescence evidence, and all encrypted
certificate bytes. Native output bytes may already be stored — **storage is not causal
eligibility.**

The terminal transaction atomically validates execution authority, lineage, attempt state and the
expected active generation; finalizes the attempt with the already-proven provider outcome; exposes
only canonically eligible output; advances the branch causal version under existing rules; installs
the generation's adopted-boundary certificate **or explicitly marks that generation unusable**; and
releases successor eligibility.

The certificate is a **semantic** relationship — state row and generation, branch lineage, adopted
attempt and output references (or the initial seed projection), native boundary, immutable
credential provenance, runtime/schema, and storage/resource generation. Whether it is persisted,
indexed or derived on demand is a P5/P6 decision; it mandates no table or column here.

### 4.3 Failure and visibility

| Failure point | Required result |
| --- | --- |
| native create succeeds; provisional append or adoption fails | the object is not active or reusable; cleanup responsibility is retained, including the unavoidable create-to-append crash window |
| native state advanced; terminal transaction did not commit | the advanced state is not reusable; recovery marks it unusable **before** successor queue visibility; the outcome classification stays truthful |
| durable output proven, native persistence or alignment not proven | the durable result may finalize with the generation atomically marked unusable; the next attempt reconstructs faithfully or refuses |
| claim / generation CAS lost | the loser cannot overwrite the successor; it records a fenced-out result and its orphan responsibility |
| crash after terminal commit | the committed certificate is necessary but **not sufficient** — the next reuse must re-prove compatibility, persistence and resource authority |
| cleanup claims the object while adoption is settling | exactly one CAS wins; adoption of an object already committed to cleanup is refused |

A known provider success with a local persistence failure is **not** relabelled as provider
uncertainty. Native reusability can be false while the provider outcome is perfectly well known;
the existing outcome taxonomy is preserved rather than collapsing every database failure into
`outcome_unknown`.

**What would falsify this design:** an inability to prepare the certificate inputs outside a
database checkout; an inability to expose eligibility and state disposition atomically; or a
provider that permits unseen mutation after the asserted quiescent boundary. Any of those requires
a bounded revision of this contract **before** that runtime activates — never a silent later
promotion.

---

## 5. Alignment with the durable projection

The GovAI durable branch projection is the causal truth, under its fork-pin and attempt-eligibility
rules. Native state is aligned or it is not reusable.

- A generation's immutable **seeded-at** binding records creation and race history. It is not a
  promise that the branch causal version will never change.
- **Reusable** means the native state represents exactly the admissible continuation projection and
  boundary adopted for that generation, with no unadopted and no excluded native tail.
- A persisted adoption certificate is an indexed or derived **representation** of that
  relationship. It cannot make excluded output eligible and cannot override lineage.
- A branch causal version is a **race-detection token**, not a transcript digest. Numeric equality
  alone does not establish alignment, and inequality alone does not prove that an ordinary
  successful continuation must reseed.
- **Fork-pin eligibility is preserved exactly as specified.** On a fork child the pinned attempt is
  a valid continuation root at the boundary even when it is superseded or `context_excluded` on the
  parent branch. A global "latest completed" filter that drops an otherwise eligible pinned
  ancestor is not a lawful substitute.
- **The stale-seed rule keeps its correct scope.** Stale-seed comparison belongs to the
  boundary-version-failure rebuild path — after a failure, the rebuild re-runs reconciliation and
  treats an anchor seeded at an older version as stale. It is **not** an unconditional per-turn
  comparison, and it does not mean an ordinary successful turn reseeds or forks.
- On disagreement, **fail closed**: proven exact-boundary recovery, else faithful fresh
  reconstruction, else refusal. Never an unverified latest-tail fork.

Whether alignment is derived on demand, persisted in the envelope or partially indexed is a P5/P6
schema and performance decision under these rules. No `aligned_at_*` column is mandated, and none
is forbidden — but if one is persisted, its writer passes the same authority, CAS and transaction
requirements as any other, and it is **not** independent causal truth.

---

## 6. Credentials and model traffic

```text
harness  →  GovAI-mediated credential/identity boundary  →  selected provider
```

**A shell-capable harness receives no raw tenant provider credential by default.** A coding harness
executes arbitrary commands on behalf of a user; handing it the tenant's provider key would place
that key inside the blast radius of everything the harness runs.

The mediator sits outside the harness's mutable trust domain and enforces tenant and owner scope,
branch identity, mode, the selected provider/model/surface, the actual credential provenance, and
revocation. Native model ids stay provider-owned strings — governed versus passthrough mode never
authorizes a silent switch and never means bypassing credential isolation.

The credential identity recorded in a native generation is **immutable provenance**, including
where mediated access was used. Each actual provider call records the credential selected for that
call. A rotation or withdrawal may make an old continuation unusable; it never permits adopting
another account's state as though nothing changed. Cleanup under the original provenance requires
separately authorized access — not ordinary inference dispatch.

**Deferred to P5/P6 and the applicable security lifecycle:** issuer, audience and scope, revocation,
egress and non-bypass, tenant isolation, and request attribution. Per-attempt credentials, JWTs and
brokers are *candidate mechanisms*, not this contract. Existing human and API-key lifecycle work
(R14) must not be misrepresented as already implementing runner authority.

Two standing couplings are restated because a harness runtime is exactly where they get violated:
**no provider I/O inside a database transaction**, and **no KMS network work while holding a
database client**.

---

## 7. Resources, processes and workspace ownership

> **A native identity fence is not a resource authority fence.**

A new native id, a new process, a new lease row or a new directory label does **not** revoke a
zombie's ability to write shared files or invoke external tools.

The **branch** owns logical mutable workspace continuity. A currently authorized **attempt/claim**
holds temporary authority to mutate its resources. A conversation groups branches; it does not
grant several of them concurrent unrestricted authority over one shared workspace.

Before a successor may mutate conflicting resources, **at least one** must hold:

1. the old process tree is terminated;
2. the old resource authority is revoked;
3. the successor receives a genuinely isolated resource generation; or
4. safe continuation is **refused**.

Isolation covers tools, external systems, network and credentials — not merely a new directory. The
mechanism (containers, cgroups, process groups, separate checkouts) is a P5/P6 implementation
choice to be proven, not a law here; in particular **no Git worktree mandate** is created.

The preferred topology is a supervisor coordinating isolated harness executions with durable
branch, native and resource ownership — not one long-lived conversation process acting as the
authority. Queue order comes from GovAI durable execution, never from process-local ordering.

**Side-effect honesty.** A fork is an exact *causal conversation* operation; it is **not** an
automatic filesystem rollback. Claiming an exact workspace fork requires a verified snapshot or
reconstruction at that boundary. Otherwise the persistent side effects are disclosed and operations
requiring equivalence are refused. A retry or regenerate must never present already-observed
filesystem or external actions as undone.

**Quiescence** must cover descendant and background activity that can still mutate relevant
resources; a model terminal event alone does not prove it. Cross-host continuation requires both
compatible persisted state and an authoritative resource transfer. Fresh seeding is permitted only
when it is faithful to the durable, context and resource contract — lossy recovery is never
silently treated as an equivalent resume.

P0-A2's `A1` and `A4` remain **CLOSED**. A new harness topology owes an applicability and
non-bypass proof of its own; it does not retroactively reopen those closeouts.

---

## 8. Native object lifecycle and disposal

The canonical sequence is, in this order:

```text
native create / fork
   → IMMEDIATE provisional disposal append
      → provider_state persist + provisional settlement (one transaction)
```

The provisional record is appended **after** the object exists — it is not a fictional pre-create
record. The small create-to-append crash window is acknowledged explicitly rather than papered
over: no transaction can span a provider-side creation and a local database write. A resource
reservation, a supervisor recovery inventory or an equivalent mechanism may narrow or reconcile it.
**Creation must not be enabled without a demonstrated recovery and retention plan.**

Adoption and provisional settlement are one local transaction, protected against cleanup-maturity
and claim races by the CAS pair in §4. Native deletion, filesystem cleanup and provider I/O happen
**outside** held database transactions. Cleanup authority uses the original tenant, credential and
resource provenance — never a guessed current credential.

Orphans are not cheap files. They can hold enterprise content, native transcripts, prompts, tool
data and provider-side objects. Retention, encryption, eventual reconciliation and provable cleanup
obligations cover both host-local and provider-side state. **P5 and P6 must supply the minimal safe
prerequisites before their own activation; P0-F retains the complete user-facing Delete and
lifecycle orchestration.** This movement implements neither.

---

## 9. Claude harness persistence and recovery — a P6 gate

The documented `SessionStore` interface is a **persistence** hook, not a durable causal-commit
oracle: it documents best-effort mirroring, possible local resume on a store miss, transformed fork
identities, and subagent restoration requirements.

```text
CLAUDE_SESSIONSTORE_CAUSAL_AUTHORITY = NO
RECOVERY_COMPOSITION                 = CANDIDATE, REQUIRES P6 CONFORMANCE
```

The rule for ambiguous native state: **no blind in-place resume** → proven exact adopted-boundary
recovery where it is supported → faithful fresh seeding → otherwise refusal.

P6 must prove the selected SDK/CLI pin **as a whole**: native and session identity mapping,
persistence completion and consistent read, chain completeness including required subagents,
control of native local fallback, isolated writers, exact boundary reconstruction, resource
quiescence, and delete/cleanup authority. A mirrored tail identifier or digest is not evidence
against gaps or unadopted content.

**Stored session data stays an opaque native persistence payload.** GovAI does not parse it as an
internal, version-unstable protocol of its own.

---

## 10. Codex supported-surface and maturity — a P5 gate

Codex exposes **four distinct interface levels**, and they are not interchangeable. The table
records what was verified at the audited source pin `rust-v0.153.1`. **This is a dated pin, not a
claim about the newest release**; P5 re-verifies at whatever pin it selects.

| Level | Approvals at that pin | Exact-boundary fork at that pin | Classification |
| --- | --- | --- | --- |
| A. High-level Python | constructor does not expose the low-level approval handler; high-level approval modes do exist | a fork operation exists, but exposes neither an inclusive nor an exclusive boundary selector nor a verified equivalent | public documented high-level SDK; **GovAI sufficiency NOT ESTABLISHED** |
| B. Low-level Python client / generated types | approval handler implemented | the client passes protocol parameters; generated fork parameters expose the inclusive selector, not the exclusive one | first-party source implemented; public production support and full semantic coverage not established |
| C. Direct App Server protocol | native approval request surfaces | inclusive selector supported; the exclusive selector is marked **experimental**; mutual-exclusion and boundary constraints apply | public documented + source implemented; support posture is a separate axis |
| D. High-level TypeScript SDK | no caller callback established in the inspected public classes | start/resume and turn runs; no fork operation exposed | **required capability NOT EXPOSED** at that pin |

Corrected conclusions, stated precisely because imprecision here is what produces a premature
activation: low-level callback support is **yes**; the same exposure at the high level is **no at
that pin**; public production suitability for GovAI's use is **not established**; full
point-of-action approval coverage is **not proven**. It is equally wrong to say "Python always
auto-approves everything" — high-level modes include deny-all and review options — and to say "a
fully suitable production seam certainly exists".

Passing a raw parameter dictionary through a low-level transport is **not** equivalent to a
documented high-level API or a validated production seam. A generic fork of *latest* state cannot
satisfy §4's exact adopted-boundary requirement.

For every operation, P5 records `PUBLIC DOCUMENTED / FIRST-PARTY SOURCE IMPLEMENTED / EXPERIMENTAL
/ INTERNAL / UNKNOWN`, then **separately** passes or fails its GovAI conformance case. An
experimental or lower-level dependency must be named as such. Activation may not be achieved by
flattening Codex into an API surface or by silently downgrading LAW NX-20 (user steering and
approval are first-class). **Owner risk acceptance never changes a vendor's support
classification.**

A generic protocol error code is not proof that an old owner is alive: at the audited pin the same
generic code also covers unrelated conditions. Recovery must identify the specific
ownership-conflict condition and reconcile native and resource ownership.

---

## 11. Surface vocabulary, admission, and the legacy policy

### 11.1 The problem this solves

Migration 0031 constrains `provider` with a `CHECK` and deliberately leaves `surface` and `model`
as unconstrained `NOT NULL` text, because no runtime surface registry existed at that anchor. The
control plane therefore accepted **any** bounded token as a harness surface — and 0031 also
**freezes** a branch's `provider`/`surface`/`model` for its lifetime. An ambiguous identity, once
written, is permanent.

### 11.2 Canonical identities for NEW rows — implemented in this tree

| Provider | Canonical surface | Meaning |
| --- | --- | --- |
| `codex` | `codex` | the provider-native Codex harness family |
| `claude_code` | `claude_code` | the provider-native Claude coding-harness family |

**Surface names the harness family.** It is not an SDK, language binding, transport, CLI build or
protocol schema version — those are compatibility facts of native state and deployment metadata,
and encoding them in a frozen identity column would make every harness upgrade an identity
migration.

Rules, as implemented:

- **Exact match, no repair.** A near-miss token is refused, never trimmed, case-folded, aliased or
  inferred from the provider. `CODEX`, `codex_thread`, `claude-code` and `claude_code_session` are
  all refused as **new** identities. Guessing is the silent surface substitution LAW NX-5 forbids,
  and a wrong guess is permanent.
- **API providers are untouched.** `openai` and `anthropic` keep the free-form surface admission
  P0-B gave them. What they may *execute* remains P0-C's dispatch-registry question.
- **No model gating anywhere.** Model ids stay provider-owned free-form tokens (LAW NX-2); the rule
  does not take `model` as an input at all.
- **Roots and resolved forks alike.** A fork's triple is inherited **per field**, so the rule is
  applied to the **resolved** pair. A provider-only switch does not cause a surface to be guessed:
  it resolves to the inherited surface and is refused if that pair is not admissible.
- **Refusal is a typed semantic answer**, not a parser error and never a database fault:
  `conversation_identity_not_admissible`, carrying the caller's own pair and the expected surface.

Source: the pure rule in
[`contracts.ts`](../../apps/api/src/ai-conversations/contracts.ts); enforcement at both admission
boundaries in [`service.ts`](../../apps/api/src/ai-conversations/service.ts); the typed error in
[`errors.ts`](../../apps/api/src/ai-conversations/errors.ts); the HTTP mapping in
[`routes/ai-conversations.ts`](../../apps/api/src/routes/ai-conversations.ts).

### 11.3 Existing rows — `PRESERVE_AND_EXPLICIT_NEW_DESTINATION`

The approved policy for an immutable legacy record whose historical `surface` has no independently
evidenced canonical meaning:

```text
LEGACY_RECORD_MUTATION                = FORBIDDEN
SILENT_ALIASING                       = FORBIDDEN
SILENT_REINTERPRETATION               = FORBIDDEN
SILENT_PROVIDER_BASED_INTERPRETATION  = FORBIDDEN
UNKNOWN_LEGACY_SURFACE                = PRESERVED_AS_UNKNOWN
SAME_RECORD_AUTOMATIC_CONTINUATION    = NOT_GUARANTEED
EXPLICIT_CANONICAL_DESTINATION        = REQUIRED
```

1. The original record is preserved unchanged and stays readable under existing owner and lifecycle
   rules.
2. Its historical `surface` is never reinterpreted, aliased, mutated or normalized. **Unknown
   remains unknown** — an unknown surface does not become `codex` merely because the provider is
   `codex`.
3. Automatic same-record continuation is **not guaranteed** for an unrecognized legacy surface.
4. When a user asks to continue one, the canonical surface must be **explicitly selected**, and the
   continuation proceeds through a **new lawful destination identity** rather than mutating the
   historical one.
5. Where a new destination derives from a legacy source, the applicable architecture requires an
   explicit **historical/provenance relationship**.
6. A historical alias may be supported **only** where its meaning is independently evidenced and
   explicitly documented. No wildcard or provider-based guessing. A test fixture spelling is not
   evidence of an alias, and none is activated by this document.

The actual count and content of deployed ambiguous rows is **UNKNOWN** — no deployment inventory
was performed, and the absence of a harness runtime is not evidence that no such control-plane rows
exist. The policy is deliberately correct whether that count is zero, non-zero, or discovered
later.

### 11.4 What was deliberately not built here

The general legacy-continuation UX or API, and any new persistent relation table, are **not** part
of this movement. An existing lawful `after_attempt` fork lineage may represent a new destination
where its real lineage and boundary requirements genuinely hold — an empty legacy root cannot be
given a fabricated attempt to make it forkable, and an incompatible native request configuration is
never translated just because a destination was chosen. A derived-continuation path that needs a
provenance representation existing lineage cannot express must provide it **in its owning
implementation, before that path is enabled**. An unrelated new root must never be advertised as
automatically preserving legacy causal context. `provider_state` may not act as a routing alias for
any of this.

### 11.5 Replay is not admission

This is a correctness constraint, not a detail. A client retrying a fork it already committed
re-sends its **original** body. Under a tightened rule, a validation placed ahead of the committed
binding would reject a request that lawfully succeeded — and the branch it refers to is already
durable and frozen, so there is nothing left to admit or refuse.

Therefore: the committed binding is consulted **first**, and the new-admission rule applies only
when the request is genuinely a new fork. The reservation remains the single concurrency arbiter; a
committed key whose intent diverges keeps its established conflict answer; a missing binding never
permits an inadmissible identity, on a retry or under concurrency. Proven in
[`ai-conversation-fork-control-plane.test.ts`](../../tests/integration/ai-conversation-fork-control-plane.test.ts)
(group M).

---

## 12. Status — implemented, contracted, deferred

| Claim | State in this tree | Owner |
| --- | --- | --- |
| Coding-harness continuation **architecture** | **PUBLISHED** (this document) | P0-D2 |
| Canonical NEW-identity admission (roots + resolved forks) | **IMPLEMENTED, INERT** | P0-D2 |
| Legacy preservation policy | **PUBLISHED + PROVEN BY TEST** | P0-D2 |
| Committed-fork replay preserved under the new rule | **IMPLEMENTED + PROVEN** | P0-D2 |
| Coding-harness **runtime** (create/resume/fork/execute) | **NOT IMPLEMENTED** | P5 / P6 |
| `provider_state` writes, privileges, physical representation | **NOT IMPLEMENTED** | P5 / P6 |
| Credential mediation implementation | **NOT IMPLEMENTED** | P5 / P6 + credential lifecycle |
| Resource/process fencing implementation | **NOT IMPLEMENTED** | P5 / P6 |
| Native disposal implementation | **NOT IMPLEMENTED** | P5 / P6; full Delete P0-F |
| `R1_DURABLE_CONTEXT_P1` for `codex`/`claude_code` | **OPEN** | P5 / P6 |
| Public Retry / Stop / Delete / events endpoints | **NOT IMPLEMENTED** | P0-D2 adds none |
| Persistent AI workspace UI | **NOT IMPLEMENTED** | P0-E |
| Managed Agents | **out of scope** — a distinct surface | separate movement |

Program status, stated honestly: `P0-A1`, `T1`, `P0-A2`, `P0-B`, `P0-C` and `P0-D1` are
**COMPLETE**. **`P0-D` remains `IN_PROGRESS`** — publishing this architecture does not close it.
`P0-E` and `P0-F` remain `NOT_STARTED`.

---

## 13. Forward-compatibility scope qualifications (FC-A – FC-D)

These bound what P0-D2 may be read to imply about future workloads. They add **no** deliverable,
schema, entity or gate.

**FC-A — intelligence capability is not organizational authority.** Provider, model, conversation,
branch, attempt, native thread/session, native generation, runner/process and resource/workspace
identities do **not** automatically confer organizational principal status, delegation, business
authority, enterprise authorization or actor authority. The existing branch continuation and
correlation role, the attempt/claim execution-fencing role, authenticated owner and tenant controls,
RLS and credential mediation all remain required — FC-A removes none of them. What it forbids is
inferring broader authority from possession of a harness or execution identifier. A future
organizational-authority principal may relate to these identities through a separately justified
design; **P0-D2 creates no such entity and adds no `authority_id`, `actor_id` or `delegation_id`.**

**FC-B — `provider_state` stays native-continuation scoped.** It is bounded to conversation/branch
continuation, native generation, provider or harness state, credential provenance, the
causal/adoption boundary, and taint/rotation/fencing. It is not generalized into universal agent,
organizational-authority, delegation, generic action, robot or workload state — and no speculative
actor or authority fields are inserted into its envelope for hypothetical reuse. §4's atomic
adoption and §5's alignment laws are unchanged. **A lease expiring is not a process dying**, and a
native identity change does not revoke resource authority.

**FC-C — evidence stays additively extensible.** Nothing here bars later **additive** evidence
classes for tool execution, external action, state-changing automation, delegation,
organizational-authority decisions, machine actions or MCP actions. Future movements may reuse the
lower-level durable, integrity and causal evidence primitives after proving their own meaning and
boundaries. FC-C does **not** relax a current validator, add a generic payload escape hatch, change
historical event meaning, or require a universal action table now.

**FC-D — this execution model is domain-specific.** `Conversation → Branch → Turn → Attempt` is the
correct execution architecture for *this* conversation and coding-harness continuity domain. It is
**not** declared the universal execution model for all future GovAI workloads. Future
non-conversational workloads may reuse lower-level governance and evidence primitives additively
without inheriting this schema; generalizing requires a real second use case that proves the common
abstraction.

**Explicit non-implications.** FC-A – FC-D authorize no migration, table, column, RLS policy,
`provider_state` grant, generic actor/action/agent-session entity, authority or delegation engine,
capability graph, agent registry, universal action runtime, robotics subsystem, MCP governance
platform, partner model, pricing model or regulatory runtime. They neither discharge the six
deferred gates nor create new ones.

**ADR-030** ([standalone and integrated](./adr/ADR-030-standalone-and-integrated.md)) remains
formally **Proposed** / doctrine-candidate. Repository publication of a candidate is not formal
acceptance, and P0-D2 is not the vehicle for promulgating it. Directional compatibility is
preserved; acceptance requires a separate owner-authorized movement.

---

## 14. Decision provenance

The decisions above were adjudicated externally and are reproduced here in full so that this
repository is self-sufficient. The external records are cited for provenance only and are **not**
required reading:

```text
P0-D2-CODING-HARNESS-ARCHITECTURE-ADJUDICATION-01        1a53402406840b66da7fdd6eeec4a96d53f3adc3480967748dd0ff4b3d5b8e37
  + FABLE5-INDEPENDENT-ARCHITECTURE-CHALLENGE-01-CORRECTION-01
                                                          af14a7599b79cfa3a23bb30edab139ed8ae45d155ff88d68702eabe70e7c58ed
  + LEGACY-SURFACE-COMPATIBILITY-OWNER-DECISION-01         52161979a2cea05df5ce4976f68636fcb1ee3b8b137bc72e0a11ff51fde9f80c
  + ARCHITECTURE-ADJUDICATION-01-READINESS-01              80db84cd82d864f79725e8248e57114bf2a02d6d10f5c088cf36bbfce535ccef
  + STRATEGIC-FORWARD-COMPATIBILITY-SUPPLEMENT-01          5160a11139dfbb742ff507e20251a86ffada74538ce2ddc0b66017890e7de3bb
```

The effective architecture is the original adjudication **as qualified by** the additive
correction, the owner legacy decision, the readiness supplement and FC-A – FC-D. The original
artifact's historical `NOT_READY` verdict is a dated record, superseded for readiness purposes by
the supplement; it is not restated here as a current verdict.

## 15. Related canonical documents

- [ai-conversation-continuity-v1.md](./ai-conversation-continuity-v1.md) — the accepted P0 design
  spec (a dated snapshot; §11 owns the adapter boundary and the taint discipline).
- [native-experience-contract-v1.md](./native-experience-contract-v1.md) — LAWs NX-1 … NX-26;
  §18.3 is qualified by §11.3 above.
- [current-state.md](./current-state.md) — the evidence-first source of truth.
- [development-roadmap.md](./development-roadmap.md) — movement sequencing.
- [adr/ADR-031-coding-agent-surface.md](./adr/ADR-031-coding-agent-surface.md) — coding agents as a
  governed **gateway** surface (a different concern from conversation continuity; see its P0-D2
  reconciliation note).
