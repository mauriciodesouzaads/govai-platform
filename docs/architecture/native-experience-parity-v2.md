# Native Experience Parity V2 — Current Baseline

STATUS: `CURRENT_BASELINE_COMPLETE — IMPLEMENTATION_PARTIAL — FULL_NATIVE_EXPERIENCE_PARITY_NOT_COMPLETE`
MISSION: EP-PROVIDER-NATIVE-PARITY-V1-NATIVE-EXPERIENCE-CONTRACT-AND-CURRENT-BASELINE-01
BASELINE_VERSION: 2 · RESEARCH SNAPSHOT: 2026-08-29
SOURCE ANCHOR: main `79bd71407830ef2ef244fba6c53ac57cdebd11a3` (tree `c73d1ff4`)
MACHINE ARTIFACT: `docs/architecture/generated/native-experience-parity-v2.json` (252 rows) —
validated by `pnpm docs:parity2:check` and the unit lane
(`scripts/native-experience-parity-v2-manifest.test.ts`); canonicalized by
`pnpm docs:parity2:format`.
PREDECESSOR: `native-experience-parity-v1.md` + `generated/native-experience-parity-v1.json`
— the 2026-08-21 baseline remains a BYTE-PRESERVED versioned historical snapshot (its 248
rows, counts, `verified_at`, `source_anchor` and `research_snapshot_date` are untouched by
this movement); V2 supersedes it as the CURRENT view without rewriting its history.
PRECEDENCE: `current-state.md` and `foundation-v1-freeze.md` prevail wherever they
conflict. COMPANIONS: `native-experience-contract-v1.md` (the normative laws this baseline
informs), `ai-conversation-continuity-v1.md`.

This movement implements NO provider capability and NO runtime. V2 is a fresh, deliberate
research snapshot: every row re-dated to 2026-08-29 under a first-party research pass
(external source ledger sealed in the mission handoff), with row content updated only
where evidence changed and GovAI axes updated only where merged source proves them.

---

## 1. Why a V2 exists

Two things made the V1 snapshot no longer the current truth, neither of which permits
editing V1:

1. **GovAI moved.** P0-A1/T1/P0-A2/P0-B/P0-C merged after the 2026-08-21 snapshot. The
   durable Send → server-owned execution → hydrate/reload path now EXISTS at API level for
   `anthropic_messages` and `openai_responses` (governed + passthrough), with fork durable
   since P0-B — so V1's conversation-level `persistence/resume/fork = false` on those four
   rows is stale as a CURRENT claim (while remaining true as a historical one).
2. **Providers moved.** Verified 2026-08-29: the Assistants sunset EXECUTED (2026-08-26);
   OpenAI's Models API now serves per-model `shutdown_date`; OpenAI's GA computer-use tool
   type is now the string `computer`; Anthropic's Models API serves a structured per-model
   `capabilities` descriptor (documented; added 2026-03-18; live-confirmed); Files/Skills/
   computer/browser toolsets GA'd with optional-or-no beta headers; Codex CLI moved from
   0.140.0-alpha.2 to 0.151.0 stable while the app-server's experimental wording is
   unchanged verbatim; Claude Code moved 2.1.233 → 2.1.251 and programmatic
   checkpoint/rewind became documented (it was UNKNOWN at V1).

## 2. Schema evolution (schema_version 2)

Four row fields were added; each answers a concrete architectural question the contract
needs mechanically answered. Nothing else about the row discipline changed — every V1
invariant (axis coherence, classification truth rules, PRODUCT_ONLY masquerade rules,
first-party-source enforcement, single-snapshot `verified_at`) is enforced over the wider
field set by the ADDITIVE V2 validator (`scripts/lib/parity-v2-core.ts`), which imports
V1's vocabulary so the two validators cannot disagree about surfaces, statuses or
first-party hosts. The V1 validator and its enforcement lane are untouched.

| New field | The question it answers |
|---|---|
| `retirement_date` | Is there a first-party announced shutdown/retirement date? (LAW NX-14; OpenAI now serves machine-readable per-model shutdown dates) |
| `capability_source` | If GovAI resolved per-model support for this capability at runtime, what is the strongest source class — `provider_machine_metadata` or `provider_documentation`? (LAW NX-6's asymmetry, mechanically encoded) |
| `state_nature` | What does continuation state look like — `stateless`, `provider_stored`, `harness_owned_local`, `client_store_pluggable`? (the P0-D axis, continuity spec §11) |
| `next_wave` | Which planned movement owns closing this row's principal gap (P0-D/P0-E/P0-F, P1–P9)? `null` = no wave claims it (validator forbids it on NOT_APPLICABLE / PROVIDER_NOT_EXPOSED rows) |

Root additions: `baseline_version: 2` and `predecessor` (lineage to the V1 artifact).

**`state_nature` is ROW-LOCAL, not adapter-exhaustive:** it describes the state
characteristic of THIS capability row (e.g. the Responses create row carries
`provider_stored` because `store` defaults true on that surface), and it is NOT an
exhaustive enumeration of every continuation strategy available to the provider adapter —
OpenAI's adapter alone spans conversation objects, `previous_response_id` chaining AND
stateless replay. The authoritative adapter strategy set remains
`native-experience-contract-v1.md` §18 + `ai-conversation-continuity-v1.md` §11.

**Dynamic tenant state is deliberately NOT representable.** Tenant policy verdicts,
per-account entitlements and account-scoped catalogue counts are runtime/projection
concerns (contract §5–§8) and evidence-file observations — never static baseline rows.
The mission's live account observations (both providers' model listings, 2026-08-29) live
in the external sealed observations artifact, bounded as
`ACCOUNT_OBSERVATION != UNIVERSAL_PROVIDER_CATALOGUE`.

## 3. Row inventory and honest deltas vs V1

Row counts at this snapshot: 252 (V1: 248). OPENAI_API 67 (+3) · ANTHROPIC_API 59 ·
CODEX 38 · CLAUDE_CODE 28 · CHATGPT_APP 25 (+1) · CLAUDE_APP 16 · CODEX_APP 7 ·
CLAUDE_CODE_APP 12.
Classification totals: FULL 3 · PARTIAL 85 · MISSING 91 · BLOCKED_BY_GOVAI 2 ·
PROVIDER_NOT_EXPOSED 3 · NOT_APPLICABLE 8 · PRODUCT_ONLY 60.

- **Added (4):** `OPENAI_API/admin/{admin-api, usage-cost-api, rate-limits-spend-api}` —
  the OpenAI admin/usage/cost/rate-limit surface existed at V1 but was not inventoried,
  while the Anthropic admin family was; V2 restores surface symmetry (all three MISSING,
  no GovAI route, independent-EP class). `CHATGPT_APP/extensions/plugins` — the new
  developer-facing plugins umbrella (skills + MCP + UI bundles spanning ChatGPT and
  Codex; directory migrated 2026-07-09), a market packaging convergence the GovAI
  extension architecture will be measured against.
- **Removed:** none. Retired product features (group chats, Pulse) keep their rows with
  RETIRED notes — they document expectation history, and deleting them would fake a
  cleaner past. Dying-but-still-served API surfaces remain NOT_APPLICABLE with their
  sourced `retirement_date`; a surface whose sunset has EXECUTED is reclassified
  PROVIDER_NOT_EXPOSED (Assistants, executed 2026-08-26 — a retired surface must not be
  certified `provider_exposed`), which is why the NOT_APPLICABLE/PROVIDER_NOT_EXPOSED
  totals shift 9→8 / 2→3 vs V1.
- **GovAI-axis flips (4 rows, P0-C/P0-B evidence):**
  `ANTHROPIC_API/messages-{create,stream}` and `OPENAI_API/responses-{create,stream}` now
  carry `persistence_supported / resume_supported / fork_supported = true` — durable Send,
  server-owned execution, hydrate-after-loss (live-accepted 4/4 on the merged tree) and
  the durable fork endpoint. Bounds stated in each row's notes: API level only; the UI
  transcript remains memory-only (P0-E); reattach-to-live-stream and public Retry absent;
  `exact_turn_evidence_correlation` remains false everywhere (P0-F). These axes are NOT
  part of FULL, so **FULL remains 3 rows, all on ANTHROPIC_API** — no classification was
  upgraded by this movement, and the enforcement lane still pins FULL to the one surface
  proven end-to-end.
- **Provider-fact updates (notes/constraints/status), the material set:** Assistants
  sunset executed; Sora/Videos `retirement_date: 2026-09-24`; OpenAI models rows carry the
  `shutdown_date` machine-lifecycle fact; OpenAI computer-use rows carry the current
  `computer` tool type + the finding-T drift note; realtime rewritten (GA transports
  WebRTC/WebSocket/SIP, client-secrets bootstrap, beta interface sunset 2026-05-12);
  images/audio model constraints refreshed; Conversations API rewritten (GA, no-TTL items
  vs 30-day stored responses); streaming-resumption mechanics (sequence_number +
  starting_after); webhooks (Standard Webhooks spec); Anthropic models rows carry the
  documented capability descriptor + the no-lifecycle-field fact; Files/Skills/computer/
  browser GA re-verifications with the R6 registry-staleness note preserved; web-tool
  version drift (`*_20260318`); server-side-fallback second header generation; Managed
  Agents memory-store header split; Codex app-server verbatim-experimental
  re-verification + 0.151.0 + cloud CLI scripting surface (still PROVIDER_NOT_EXPOSED for
  embedding); Claude Code checkpoint/rewind UNKNOWN→GA, SessionStore reference adapters,
  new permission modes and model-switch hooks; product-surface rewrites (ChatGPT Work,
  scheduled/event-triggered tasks, shared projects, plugins umbrella, Atlas deprecation,
  aggressive model-retirement auto-mapping ★ the explicit CONTRAST to LAW NX-14; Claude
  unified memory, Cowork built-in browser, model × effort picker, viewer-pays artifacts).
- **Unchanged rows** carry their V1 content re-dated to 2026-08-29: the research pass
  covered every family; where no evidence changed, the row text stands and the new
  `verified_at` records that it was re-verified, not merely copied.

## 4. Status re-adjudications (the P0-C carry-forward labels, made precise)

Source-adjudicated at the anchor (runtime files + UI files + live reads; contract §5):

```text
NATIVE_PROVIDER_MODEL_DISCOVERY   = PARTIAL
  account-scoped live listing through the audited native route EXISTS and the AI Console
  consumes it (paginated, free-text-preserving, failure-truthful); a productized
  capability-aware/policy-aware catalogue does NOT exist.
USER_MODEL_CHOOSER                = PARTIAL
  free-text + provider suggestions EXIST (legacy AI Console); the product chooser of
  contract §9 does NOT exist.
CAPABILITY_AWARE_CATALOGUE        = NOT_IMPLEMENTED
POLICY_AWARE_MODEL_CHOOSER        = NOT_IMPLEMENTED
NATIVE_PROVIDER_FULL_PARITY       = OPEN — IMPLEMENTATION_PARTIAL
  (3/252 FULL at this snapshot, OpenAI 0 FULL; FULL still means "all applicable axes
  proven", so this is an axis statement, not "OpenAI does not work" — the six
  conversational lanes remain live-accepted and P0-C durable execution covers two of them.)
MODEL_ID_AGNOSTICISM              = PROVEN (unchanged; no allowlist anywhere)
```

## 5. Wave ownership view (from the `next_wave` field)

P0-D 20 rows (continuation-critical: the four conversational lanes, OpenAI
Conversations/storage/background/resumption family, caching/compaction/context-editing,
thinking signatures, mid-conversation system messages) · P0-E 25 (models/chooser rows,
control-panel features, workspace product-equivalents) · P1 10 (files/attachments) ·
P2 19 (search/citations/hosted tools) · P3 8 (MCP/connectors/skills/plugins) · P4 6
(projects/memory) · P5 44 (Codex) · P6 40 (Claude Code) · P7 9 (computer/browser class —
finding T precondition) · P8 11 (realtime/voice/media/websocket transport) · P9 6
(artifacts/work/scheduled) · unassigned 54 (NOT_APPLICABLE/PROVIDER_NOT_EXPOSED rows,
independent-EP families such as batch/embeddings/webhooks/admin, and body-level features
that already ride the lanes verbatim).

## 6. Machine manifest contract

Same doctrine as V1, additively: hand-curated versioned research baseline (no `write`
mode, no network in CI — research happens deliberately, the JSON is committed, the
validator enforces schema/coherence/canonical bytes). `pnpm docs:parity2:check` /
`pnpm docs:parity2:format` + the always-on unit lane
(`scripts/lib/parity-v2-core.test.ts` fixtures,
`scripts/native-experience-parity-v2-manifest.test.ts` tracked-artifact enforcement, which
keeps pinning "FULL rows exist only on surfaces proven end-to-end"). V1's validator,
tests and artifacts are byte-untouched; updating any V2 row's proof axes requires the
corresponding evidence class, exactly as before.

## 7. No-overclaim declarations (movement end state)

```text
NATIVE_EXPERIENCE_PARITY_V2         = CURRENT_BASELINE_COMPLETE
IMPLEMENTATION                      = PARTIAL (P0-C kernel for two surfaces; six lanes live)
FULL_NATIVE_EXPERIENCE_PARITY       = NOT_COMPLETE
V1_BASELINE                         = BYTE_PRESERVED_HISTORICAL_SNAPSHOT
NATIVE_EXPERIENCE_CONTRACT          = DRAFTED (native-experience-contract-v1.md)
RUNTIME_CHANGES_THIS_MOVEMENT       = NONE
P0-D / P0-E / P0-F                  = NOT_STARTED
PROVIDER_EXACTLY_ONCE               = NOT_CLAIMED (permanent)
UNIVERSAL_PROVIDER_PARITY           = NOT_CLAIMED
```

The V1 forbidden-claims list applies verbatim. The proven scope is exactly the manifest's
per-row axes — nothing more.

END OF BASELINE.
