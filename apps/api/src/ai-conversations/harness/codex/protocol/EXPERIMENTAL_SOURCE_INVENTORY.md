# EXPERIMENTAL_SOURCE_INVENTORY — codex-app-server-protocol @ rust-v0.154.0

```text
GOVAI-PROVENANCE (CONT-P5-A)
PIN_RELEASE           = 0.154.0
PIN_TAG               = rust-v0.154.0
PIN_COMMIT            = 6b9826e3aa83b1a5947db50f4332cb9c65f1b340
SOURCE_PATH_OR_SCHEMA = every #[experimental("...")] string annotation under codex-rs/app-server-protocol/src/**
SOURCE_SHA256         = (per annotated source file)
  e2f0e4dbee5f0ddcb8c2a47f92df629ee02765c57348cbb4188e950dd1253889  codex-rs/app-server-protocol/src/experimental_api.rs
  6aa47ec984c9198ea797bf63b784cf6a88cc0ab85efb0a4ac75e01aabffc2cfa  codex-rs/app-server-protocol/src/protocol/common.rs
  22d4ec67a5979d33cbe2e40b53c7afbdd1bbed935a54b2284e9b2de11f4b590c  codex-rs/app-server-protocol/src/protocol/v2/account.rs
  e655da7da2984ad6ea198b55829b21db01e05993725dea0f11e9e3de7fb66784  codex-rs/app-server-protocol/src/protocol/v2/command_exec.rs
  51c06df16539283e97b6b472753f09d16712f9f1e682751ad6c03b779a0c493e  codex-rs/app-server-protocol/src/protocol/v2/config.rs
  4cb6190f253d18cafea1451a0b062fef891529757762a4ffe9ff3b0af25d00ff  codex-rs/app-server-protocol/src/protocol/v2/item.rs
  ae6dde792099d0df8bfc78fcf6d30e596b93f28f6af12f693fa87aeca84212ae  codex-rs/app-server-protocol/src/protocol/v2/mcp.rs
  11c704b5674ab5092ea6255ff3c8bb06f97567f1ff32d1dc09ad33f66277bb86  codex-rs/app-server-protocol/src/protocol/v2/shared.rs
  ffc2f432bc7d0dadf9ae10db832035c8b75d7b709462bfed3c83d33ea89c526a  codex-rs/app-server-protocol/src/protocol/v2/thread.rs
  c569abd0f1e3244a495a67da73a6b20ecd029a1184f8d6fd4c97a29c6fbc3ff4  codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs
  49098e1b594835e6376952c35a0b13cfacd1316eb68bd8a46553842534a86bb2  codex-rs/app-server-protocol/src/protocol/v2/turn.rs
GENERATOR_IDENTITY    = CONT-P5-A executor derivation (derive_inventory.py + materialize.py; SHA-256 in the execution report)
GENERATOR_VERSION     = CONT-P5-A (single derivation at PIN_COMMIT)
GENERATOR_CONFIG      = classification by presence in the vendored stable TypeScript (./generated/**)
DERIVATION_MODE       = VERBATIM_SOURCE_DERIVED
```

Mirror of `experimental-inventory.ts` (the code is authoritative; `experimental-inventory.test.ts` checks both against
`./generated/**`). Every `#[experimental("…")]` string annotation at the pin is listed once, with its commit-addressed
anchor, and placed MECHANICALLY in exactly one category by comparing the annotated item with the vendored
generated (`experimentalApi = false`) TypeScript — never by assumption:

- **(1) `EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE`** — annotated upstream and absent from the generated wire.
  GovAI claim: inexpressible in the selected generated types, unemittable by the safe builders.
- **(2) `EXPERIMENTAL_REPRESENTABLE_ON_GENERATED_WIRE`** — annotated upstream and present on the generated wire.
  Kept faithfully in the wire types (never edited out); rejected by GovAI policy; unselectable through the
  safe builder. The "cannot express it" claim is made ONLY for category (1).

Upstream-experimental and GovAI-forbidden are different axes. Values GovAI forbids that carry NO upstream
annotation — category (3) `NON_EXPERIMENTAL_UPSTREAM_BUT_GOVAI_FORBIDDEN` — are listed at the end, outside the
inventory.

## Counts

| Category | method | field | variant | total |
|---|---|---|---|---|
| (1) EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE | 61 | 63 | 4 | 128 |
| (2) EXPERIMENTAL_REPRESENTABLE_ON_GENERATED_WIRE | 22 | 1 | 4 | 27 |
| **All `#[experimental("…")]` string annotations** | | | | **155** |

4 of the category (1) entries are `#[cfg(test)]` derive-macro fixtures in `src/experimental_api.rs` (never exported; absent from both the stable and the experimental upstream exports). `#[experimental(nested)]` markers (16) carry no reason string: they propagate a nested type's reason and are not inventory items.

## Covered-surface view (§2 methods)

| Method | Category (1) items (by reason suffix) | Containers |
|---|---|---|
| `thread/start` | `activePermissionProfile`, `allowProviderModelFallback`, `dynamicTools`, `environments`, `experimentalRawEvents`, `historyMode`, `mockExperimentalField`, `multiAgentMode`, `permissions`, `projectId`, `runtimeWorkspaceRoots`, `selectedCapabilityRoots` | `ThreadStartParams`, `ThreadStartResponse` |
| `thread/resume` | `activePermissionProfile`, `history`, `initialTurnsPage`, `multiAgentMode`, `path`, `permissions`, `runtimeWorkspaceRoots` | `ThreadResumeParams`, `ThreadResumeResponse` |
| `thread/fork` | `activePermissionProfile`, `beforeTurnId`, `deferGoalContinuation`, `multiAgentMode`, `path`, `permissions`, `runtimeWorkspaceRoots` | `ThreadForkParams`, `ThreadForkResponse` |
| `turn/start` | `additionalContext`, `collaborationMode`, `cyberAccessProgram`, `environments`, `multiAgentMode`, `permissions`, `responsesapiClientMetadata`, `runtimeWorkspaceRoots` | `TurnStartParams` |
| `turn/steer` | `additionalContext`, `responsesapiClientMetadata` | `TurnSteerParams` |

Category (2) on the covered surface: `askForApproval.granular` only (`AskForApproval` variant, reachable through the `approvalPolicy` position of the covered params).

## Category (2) — EXPERIMENTAL_REPRESENTABLE_ON_GENERATED_WIRE (27)

| # | Annotation (verbatim) | Kind | Container | Wire | Source anchor |
|---|---|---|---|---|---|
| 1 | `thread/queue/changed` | method | `ServerNotification` | `thread/queue/changed` | [src/protocol/common.rs#L1893](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1893) |
| 2 | `project/changed` | method | `ServerNotification` | `project/changed` | [src/protocol/common.rs#L1895](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1895) |
| 3 | `thread/project/updated` | method | `ServerNotification` | `thread/project/updated` | [src/protocol/common.rs#L1897](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1897) |
| 4 | `thread/environment/connected` | method | `ServerNotification` | `thread/environment/connected` | [src/protocol/common.rs#L1899](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1899) |
| 5 | `thread/environment/disconnected` | method | `ServerNotification` | `thread/environment/disconnected` | [src/protocol/common.rs#L1901](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1901) |
| 6 | `thread/settings/updated` | method | `ServerNotification` | `thread/settings/updated` | [src/protocol/common.rs#L1903](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1903) |
| 7 | `autoApprovalReview/strictReviewRequired` | method | `ServerNotification` | `autoApprovalReview/strictReviewRequired` | [src/protocol/common.rs#L1915](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1915) |
| 8 | `process/outputDelta` | method | `ServerNotification` | `process/outputDelta` | [src/protocol/common.rs#L1928](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1928) |
| 9 | `process/exited` | method | `ServerNotification` | `process/exited` | [src/protocol/common.rs#L1931](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1931) |
| 10 | `mcpServer/event/stream/notification` | method | `ServerNotification` | `mcpServer/event/stream/notification` | [src/protocol/common.rs#L1942](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1942) |
| 11 | `turn/moderationMetadata` | method | `ServerNotification` | `turn/moderationMetadata` | [src/protocol/common.rs#L1960](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1960) |
| 12 | `thread/realtime/started` | method | `ServerNotification` | `thread/realtime/started` | [src/protocol/common.rs#L1969](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1969) |
| 13 | `thread/realtime/itemAdded` | method | `ServerNotification` | `thread/realtime/itemAdded` | [src/protocol/common.rs#L1971](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1971) |
| 14 | `thread/realtime/item/started` | method | `ServerNotification` | `thread/realtime/item/started` | [src/protocol/common.rs#L1973](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1973) |
| 15 | `thread/realtime/item/transcript/delta` | method | `ServerNotification` | `thread/realtime/item/transcript/delta` | [src/protocol/common.rs#L1975](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1975) |
| 16 | `thread/realtime/item/completed` | method | `ServerNotification` | `thread/realtime/item/completed` | [src/protocol/common.rs#L1977](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1977) |
| 17 | `thread/realtime/transcript/delta` | method | `ServerNotification` | `thread/realtime/transcript/delta` | [src/protocol/common.rs#L1979](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1979) |
| 18 | `thread/realtime/transcript/done` | method | `ServerNotification` | `thread/realtime/transcript/done` | [src/protocol/common.rs#L1981](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1981) |
| 19 | `thread/realtime/outputAudio/delta` | method | `ServerNotification` | `thread/realtime/outputAudio/delta` | [src/protocol/common.rs#L1983](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1983) |
| 20 | `thread/realtime/sdp` | method | `ServerNotification` | `thread/realtime/sdp` | [src/protocol/common.rs#L1985](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1985) |
| 21 | `thread/realtime/error` | method | `ServerNotification` | `thread/realtime/error` | [src/protocol/common.rs#L1987](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1987) |
| 22 | `thread/realtime/closed` | method | `ServerNotification` | `thread/realtime/closed` | [src/protocol/common.rs#L1989](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1989) |
| 23 | `account/login/start.chatgptAuthTokens` | variant | `LoginAccountParams` | `type: chatgptAuthTokens` | [src/protocol/v2/account.rs#L88](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L88) |
| 24 | `account/login/start.amazonBedrock` | variant | `LoginAccountParams` | `type: amazonBedrock` | [src/protocol/v2/account.rs#L105](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L105) |
| 25 | `account/login/start.amazonBedrockAccessKeys` | variant | `LoginAccountParams` | `type: amazonBedrockAccessKeys` | [src/protocol/v2/account.rs#L110](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/account.rs#L110) |
| 26 | `config/read.approvalsReviewer` | field | `Config` | `approvals_reviewer` | [src/protocol/v2/config.rs#L289](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/config.rs#L289) |
| 27 | `askForApproval.granular` | variant | `AskForApproval` | `granular` | [src/protocol/v2/shared.rs#L181](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/shared.rs#L181) |

## Category (1) — EXPERIMENTAL_ABSENT_FROM_GENERATED_WIRE (128)

| # | Annotation (verbatim) | Kind | Container | Wire | Source anchor |
|---|---|---|---|---|---|
| 1 | `enum/unit` | variant (cfg(test) fixture) | `EnumVariantShapes` | `Unit` | [src/experimental_api.rs#L69](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/experimental_api.rs#L69) |
| 2 | `enum/tuple` | variant (cfg(test) fixture) | `EnumVariantShapes` | `Tuple` | [src/experimental_api.rs#L71](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/experimental_api.rs#L71) |
| 3 | `enum/named` | variant (cfg(test) fixture) | `EnumVariantShapes` | `Named` | [src/experimental_api.rs#L73](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/experimental_api.rs#L73) |
| 4 | `field/optionalCollection` | field (cfg(test) fixture) | `ExperimentalFieldShape` | `optional_collection` | [src/experimental_api.rs#L104](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/experimental_api.rs#L104) |
| 5 | `server/diagnostics` | method | `ClientRequest` | `server/diagnostics` | [src/protocol/common.rs#L513](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L513) |
| 6 | `userVerification/status` | method | `ClientRequest` | `userVerification/status` | [src/protocol/common.rs#L521](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L521) |
| 7 | `userVerification/enroll` | method | `ClientRequest` | `userVerification/enroll` | [src/protocol/common.rs#L528](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L528) |
| 8 | `userVerification/delete` | method | `ClientRequest` | `userVerification/delete` | [src/protocol/common.rs#L535](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L535) |
| 9 | `userVerification/verify` | method | `ClientRequest` | `userVerification/verify` | [src/protocol/common.rs#L542](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L542) |
| 10 | `thread/increment_elicitation` | method | `ClientRequest` | `thread/increment_elicitation` | [src/protocol/common.rs#L585](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L585) |
| 11 | `thread/decrement_elicitation` | method | `ClientRequest` | `thread/decrement_elicitation` | [src/protocol/common.rs#L595](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L595) |
| 12 | `thread/queue/add` | method | `ClientRequest` | `thread/queue/add` | [src/protocol/common.rs#L624](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L624) |
| 13 | `thread/queue/list` | method | `ClientRequest` | `thread/queue/list` | [src/protocol/common.rs#L630](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L630) |
| 14 | `thread/queue/update` | method | `ClientRequest` | `thread/queue/update` | [src/protocol/common.rs#L636](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L636) |
| 15 | `thread/queue/delete` | method | `ClientRequest` | `thread/queue/delete` | [src/protocol/common.rs#L642](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L642) |
| 16 | `thread/queue/reorder` | method | `ClientRequest` | `thread/queue/reorder` | [src/protocol/common.rs#L648](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L648) |
| 17 | `thread/queue/start` | method | `ClientRequest` | `thread/queue/start` | [src/protocol/common.rs#L654](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L654) |
| 18 | `thread/settings/update` | method | `ClientRequest` | `thread/settings/update` | [src/protocol/common.rs#L671](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L671) |
| 19 | `thread/memoryMode/set` | method | `ClientRequest` | `thread/memoryMode/set` | [src/protocol/common.rs#L678](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L678) |
| 20 | `memory/reset` | method | `ClientRequest` | `memory/reset` | [src/protocol/common.rs#L684](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L684) |
| 21 | `thread/backgroundTerminals/clean` | method | `ClientRequest` | `thread/backgroundTerminals/clean` | [src/protocol/common.rs#L710](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L710) |
| 22 | `thread/backgroundTerminals/list` | method | `ClientRequest` | `thread/backgroundTerminals/list` | [src/protocol/common.rs#L716](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L716) |
| 23 | `thread/backgroundTerminals/terminate` | method | `ClientRequest` | `thread/backgroundTerminals/terminate` | [src/protocol/common.rs#L722](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L722) |
| 24 | `project/list` | method | `ClientRequest` | `project/list` | [src/protocol/common.rs#L744](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L744) |
| 25 | `project/read` | method | `ClientRequest` | `project/read` | [src/protocol/common.rs#L750](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L750) |
| 26 | `project/create` | method | `ClientRequest` | `project/create` | [src/protocol/common.rs#L756](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L756) |
| 27 | `project/import` | method | `ClientRequest` | `project/import` | [src/protocol/common.rs#L762](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L762) |
| 28 | `project/update` | method | `ClientRequest` | `project/update` | [src/protocol/common.rs#L768](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L768) |
| 29 | `project/move` | method | `ClientRequest` | `project/move` | [src/protocol/common.rs#L774](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L774) |
| 30 | `project/delete` | method | `ClientRequest` | `project/delete` | [src/protocol/common.rs#L780](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L780) |
| 31 | `thread/search` | method | `ClientRequest` | `thread/search` | [src/protocol/common.rs#L806](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L806) |
| 32 | `thread/searchOccurrences` | method | `ClientRequest` | `thread/searchOccurrences` | [src/protocol/common.rs#L812](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L812) |
| 33 | `plugin/search` | method | `ClientRequest` | `plugin/search` | [src/protocol/common.rs#L882](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L882) |
| 34 | `turn/settings/update` | method | `ClientRequest` | `turn/settings/update` | [src/protocol/common.rs#L1016](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1016) |
| 35 | `thread/realtime/start` | method | `ClientRequest` | `thread/realtime/start` | [src/protocol/common.rs#L1033](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1033) |
| 36 | `thread/realtime/appendAudio` | method | `ClientRequest` | `thread/realtime/appendAudio` | [src/protocol/common.rs#L1039](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1039) |
| 37 | `thread/realtime/appendText` | method | `ClientRequest` | `thread/realtime/appendText` | [src/protocol/common.rs#L1045](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1045) |
| 38 | `thread/realtime/appendSpeech` | method | `ClientRequest` | `thread/realtime/appendSpeech` | [src/protocol/common.rs#L1051](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1051) |
| 39 | `thread/realtime/stop` | method | `ClientRequest` | `thread/realtime/stop` | [src/protocol/common.rs#L1057](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1057) |
| 40 | `thread/timeline/list` | method | `ClientRequest` | `thread/timeline/list` | [src/protocol/common.rs#L1063](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1063) |
| 41 | `thread/realtime/listVoices` | method | `ClientRequest` | `thread/realtime/listVoices` | [src/protocol/common.rs#L1069](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1069) |
| 42 | `remoteControl/enable` | method | `ClientRequest` | `remoteControl/enable` | [src/protocol/common.rs#L1106](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1106) |
| 43 | `remoteControl/disable` | method | `ClientRequest` | `remoteControl/disable` | [src/protocol/common.rs#L1112](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1112) |
| 44 | `remoteControl/status/read` | method | `ClientRequest` | `remoteControl/status/read` | [src/protocol/common.rs#L1118](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1118) |
| 45 | `remoteControl/pairing/start` | method | `ClientRequest` | `remoteControl/pairing/start` | [src/protocol/common.rs#L1124](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1124) |
| 46 | `remoteControl/pairing/status` | method | `ClientRequest` | `remoteControl/pairing/status` | [src/protocol/common.rs#L1130](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1130) |
| 47 | `remoteControl/client/list` | method | `ClientRequest` | `remoteControl/client/list` | [src/protocol/common.rs#L1136](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1136) |
| 48 | `remoteControl/client/revoke` | method | `ClientRequest` | `remoteControl/client/revoke` | [src/protocol/common.rs#L1142](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1142) |
| 49 | `collaborationMode/list` | method | `ClientRequest` | `collaborationMode/list` | [src/protocol/common.rs#L1148](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1148) |
| 50 | `mock/experimentalMethod` | method | `ClientRequest` | `mock/experimentalMethod` | [src/protocol/common.rs#L1155](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1155) |
| 51 | `environment/add` | method | `ClientRequest` | `environment/add` | [src/protocol/common.rs#L1162](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1162) |
| 52 | `environment/info` | method | `ClientRequest` | `environment/info` | [src/protocol/common.rs#L1169](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1169) |
| 53 | `environment/status` | method | `ClientRequest` | `environment/status` | [src/protocol/common.rs#L1176](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1176) |
| 54 | `mcpServer/event/stream/start` | method | `ClientRequest` | `mcpServer/event/stream/start` | [src/protocol/common.rs#L1208](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1208) |
| 55 | `mcpServer/event/stream/stop` | method | `ClientRequest` | `mcpServer/event/stream/stop` | [src/protocol/common.rs#L1215](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1215) |
| 56 | `account/bedrock/discover` | method | `ClientRequest` | `account/bedrock/discover` | [src/protocol/common.rs#L1246](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1246) |
| 57 | `account/bedrock/setup` | method | `ClientRequest` | `account/bedrock/setup` | [src/protocol/common.rs#L1253](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1253) |
| 58 | `process/spawn` | method | `ClientRequest` | `process/spawn` | [src/protocol/common.rs#L1333](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1333) |
| 59 | `process/writeStdin` | method | `ClientRequest` | `process/writeStdin` | [src/protocol/common.rs#L1340](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1340) |
| 60 | `process/kill` | method | `ClientRequest` | `process/kill` | [src/protocol/common.rs#L1347](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1347) |
| 61 | `process/resizePty` | method | `ClientRequest` | `process/resizePty` | [src/protocol/common.rs#L1354](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1354) |
| 62 | `fuzzyFileSearch/sessionStart` | method | `ClientRequest` | `fuzzyFileSearch/sessionStart` | [src/protocol/common.rs#L1436](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1436) |
| 63 | `fuzzyFileSearch/sessionUpdate` | method | `ClientRequest` | `fuzzyFileSearch/sessionUpdate` | [src/protocol/common.rs#L1442](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1442) |
| 64 | `fuzzyFileSearch/sessionStop` | method | `ClientRequest` | `fuzzyFileSearch/sessionStop` | [src/protocol/common.rs#L1448](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1448) |
| 65 | `currentTime/read` | method | `ServerRequest` | `currentTime/read` | [src/protocol/common.rs#L1775](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/common.rs#L1775) |
| 66 | `command/exec.permissionProfile` | field | `CommandExecParams` | `permissionProfile` | [src/protocol/v2/command_exec.rs#L106](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/command_exec.rs#L106) |
| 67 | `config/read.apps` | field | `Config` | `apps` | [src/protocol/v2/config.rs#L305](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/config.rs#L305) |
| 68 | `configRequirements/read.allowedApprovalsReviewers` | field | `ConfigRequirements` | `allowedApprovalsReviewers` | [src/protocol/v2/config.rs#L416](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/config.rs#L416) |
| 69 | `configRequirements/read.hooks` | field | `ConfigRequirements` | `hooks` | [src/protocol/v2/config.rs#L431](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/config.rs#L431) |
| 70 | `configRequirements/read.network` | field | `ConfigRequirements` | `network` | [src/protocol/v2/config.rs#L434](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/config.rs#L434) |
| 71 | `configRequirements/read.application` | field | `ConfigRequirements` | `application` | [src/protocol/v2/config.rs#L436](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/config.rs#L436) |
| 72 | `item/commandExecution/requestApproval.additionalPermissions` | field | `CommandExecutionRequestApprovalParams` | `additionalPermissions` | [src/protocol/v2/item.rs#L1578](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1578) |
| 73 | `item/commandExecution/requestApproval.availableDecisions` | field | `CommandExecutionRequestApprovalParams` | `availableDecisions` | [src/protocol/v2/item.rs#L1591](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/item.rs#L1591) |
| 74 | `mcpServer/elicitation/request.userVerification` | variant | `McpServerElicitationRequest` | `mode: openai/userVerification` | [src/protocol/v2/mcp.rs#L755](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/mcp.rs#L755) |
| 75 | `thread/start.allowProviderModelFallback` | field | `ThreadStartParams` | `allowProviderModelFallback` | [src/protocol/v2/thread.rs#L69](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L69) |
| 76 | `thread/start.runtimeWorkspaceRoots` | field | `ThreadStartParams` | `runtimeWorkspaceRoots` | [src/protocol/v2/thread.rs#L83](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L83) |
| 77 | `thread/start.permissions` | field | `ThreadStartParams` | `permissions` | [src/protocol/v2/thread.rs#L96](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L96) |
| 78 | `thread/start.multiAgentMode` | field | `ThreadStartParams` | `multiAgentMode` | [src/protocol/v2/thread.rs#L110](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L110) |
| 79 | `thread/start.historyMode` | field | `ThreadStartParams` | `historyMode` | [src/protocol/v2/thread.rs#L116](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L116) |
| 80 | `thread/start.projectId` | field | `ThreadStartParams` | `projectId` | [src/protocol/v2/thread.rs#L126](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L126) |
| 81 | `thread/start.environments` | field | `ThreadStartParams` | `environments` | [src/protocol/v2/thread.rs#L135](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L135) |
| 82 | `thread/start.dynamicTools` | field | `ThreadStartParams` | `dynamicTools` | [src/protocol/v2/thread.rs#L138](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L138) |
| 83 | `thread/start.selectedCapabilityRoots` | field | `ThreadStartParams` | `selectedCapabilityRoots` | [src/protocol/v2/thread.rs#L146](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L146) |
| 84 | `thread/start.mockExperimentalField` | field | `ThreadStartParams` | `mockExperimentalField` | [src/protocol/v2/thread.rs#L151](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L151) |
| 85 | `thread/start.experimentalRawEvents` | field | `ThreadStartParams` | `experimentalRawEvents` | [src/protocol/v2/thread.rs#L156](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L156) |
| 86 | `thread/start.runtimeWorkspaceRoots` | field | `ThreadStartResponse` | `runtimeWorkspaceRoots` | [src/protocol/v2/thread.rs#L189](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L189) |
| 87 | `thread/start.activePermissionProfile` | field | `ThreadStartResponse` | `activePermissionProfile` | [src/protocol/v2/thread.rs#L204](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L204) |
| 88 | `thread/start.multiAgentMode` | field | `ThreadStartResponse` | `multiAgentMode` | [src/protocol/v2/thread.rs#L209](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L209) |
| 89 | `thread/settings/update.permissions` | field | `ThreadSettingsUpdateParams` | `permissions` | [src/protocol/v2/thread.rs#L243](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L243) |
| 90 | `thread/settings/update.collaborationMode` | field | `ThreadSettingsUpdateParams` | `collaborationMode` | [src/protocol/v2/thread.rs#L269](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L269) |
| 91 | `thread/settings/update.multiAgentMode` | field | `ThreadSettingsUpdateParams` | `multiAgentMode` | [src/protocol/v2/thread.rs#L273](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L273) |
| 92 | `thread/settings.multiAgentMode` | field | `ThreadSettings` | `multiAgentMode` | [src/protocol/v2/thread.rs#L302](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L302) |
| 93 | `thread/resume.history` | field | `ThreadResumeParams` | `history` | [src/protocol/v2/thread.rs#L341](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L341) |
| 94 | `thread/resume.path` | field | `ThreadResumeParams` | `path` | [src/protocol/v2/thread.rs#L349](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L349) |
| 95 | `thread/resume.runtimeWorkspaceRoots` | field | `ThreadResumeParams` | `runtimeWorkspaceRoots` | [src/protocol/v2/thread.rs#L373](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L373) |
| 96 | `thread/resume.permissions` | field | `ThreadResumeParams` | `permissions` | [src/protocol/v2/thread.rs#L387](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L387) |
| 97 | `thread/resume.initialTurnsPage` | field | `ThreadResumeParams` | `initialTurnsPage` | [src/protocol/v2/thread.rs#L407](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L407) |
| 98 | `thread/resume.runtimeWorkspaceRoots` | field | `ThreadResumeResponse` | `runtimeWorkspaceRoots` | [src/protocol/v2/thread.rs#L423](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L423) |
| 99 | `thread/resume.activePermissionProfile` | field | `ThreadResumeResponse` | `activePermissionProfile` | [src/protocol/v2/thread.rs#L438](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L438) |
| 100 | `thread/resume.multiAgentMode` | field | `ThreadResumeResponse` | `multiAgentMode` | [src/protocol/v2/thread.rs#L443](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L443) |
| 101 | `thread/resume.initialTurnsPage` | field | `ThreadResumeResponse` | `initialTurnsPage` | [src/protocol/v2/thread.rs#L447](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L447) |
| 102 | `thread/fork.beforeTurnId` | field | `ThreadForkParams` | `beforeTurnId` | [src/protocol/v2/thread.rs#L530](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L530) |
| 103 | `thread/fork.path` | field | `ThreadForkParams` | `path` | [src/protocol/v2/thread.rs#L536](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L536) |
| 104 | `thread/fork.runtimeWorkspaceRoots` | field | `ThreadForkParams` | `runtimeWorkspaceRoots` | [src/protocol/v2/thread.rs#L560](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L560) |
| 105 | `thread/fork.permissions` | field | `ThreadForkParams` | `permissions` | [src/protocol/v2/thread.rs#L574](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L574) |
| 106 | `thread/fork.deferGoalContinuation` | field | `ThreadForkParams` | `deferGoalContinuation` | [src/protocol/v2/thread.rs#L598](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L598) |
| 107 | `thread/fork.runtimeWorkspaceRoots` | field | `ThreadForkResponse` | `runtimeWorkspaceRoots` | [src/protocol/v2/thread.rs#L614](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L614) |
| 108 | `thread/fork.activePermissionProfile` | field | `ThreadForkResponse` | `activePermissionProfile` | [src/protocol/v2/thread.rs#L629](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L629) |
| 109 | `thread/fork.multiAgentMode` | field | `ThreadForkResponse` | `multiAgentMode` | [src/protocol/v2/thread.rs#L634](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L634) |
| 110 | `thread/metadata/update.projectId` | field | `ThreadMetadataUpdateParams` | `projectId` | [src/protocol/v2/thread.rs#L983](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L983) |
| 111 | `thread/metadata/update.daybreakEnabled` | field | `ThreadMetadataUpdateParams` | `daybreakEnabled` | [src/protocol/v2/thread.rs#L994](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L994) |
| 112 | `thread/list.projectId` | field | `ThreadListParams` | `projectId` | [src/protocol/v2/thread.rs#L1416](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1416) |
| 113 | `thread/list.parentThreadId` | field | `ThreadListParams` | `parentThreadId` | [src/protocol/v2/thread.rs#L1438](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1438) |
| 114 | `thread/list.ancestorThreadId` | field | `ThreadListParams` | `ancestorThreadId` | [src/protocol/v2/thread.rs#L1443](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1443) |
| 115 | `thread.environments` | field | `Thread` | `environments` | [src/protocol/v2/thread_data.rs#L210](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L210) |
| 116 | `thread.extra` | field | `Thread` | `extra` | [src/protocol/v2/thread_data.rs#L214](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L214) |
| 117 | `thread.canAcceptDirectInput` | field | `Thread` | `canAcceptDirectInput` | [src/protocol/v2/thread_data.rs#L274](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L274) |
| 118 | `thread.daybreakEnabled` | field | `Thread` | `daybreakEnabled` | [src/protocol/v2/thread_data.rs#L287](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/thread_data.rs#L287) |
| 119 | `turn/start.responsesapiClientMetadata` | field | `TurnStartParams` | `responsesapiClientMetadata` | [src/protocol/v2/turn.rs#L174](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L174) |
| 120 | `turn/start.additionalContext` | field | `TurnStartParams` | `additionalContext` | [src/protocol/v2/turn.rs#L178](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L178) |
| 121 | `turn/start.environments` | field | `TurnStartParams` | `environments` | [src/protocol/v2/turn.rs#L186](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L186) |
| 122 | `turn/start.runtimeWorkspaceRoots` | field | `TurnStartParams` | `runtimeWorkspaceRoots` | [src/protocol/v2/turn.rs#L194](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L194) |
| 123 | `turn/start.permissions` | field | `TurnStartParams` | `permissions` | [src/protocol/v2/turn.rs#L210](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L210) |
| 124 | `turn/start.collaborationMode` | field | `TurnStartParams` | `collaborationMode` | [src/protocol/v2/turn.rs#L249](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L249) |
| 125 | `turn/start.multiAgentMode` | field | `TurnStartParams` | `multiAgentMode` | [src/protocol/v2/turn.rs#L254](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L254) |
| 126 | `turn/start.cyberAccessProgram` | field | `TurnStartParams` | `cyberAccessProgram` | [src/protocol/v2/turn.rs#L260](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L260) |
| 127 | `turn/steer.responsesapiClientMetadata` | field | `TurnSteerParams` | `responsesapiClientMetadata` | [src/protocol/v2/turn.rs#L289](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L289) |
| 128 | `turn/steer.additionalContext` | field | `TurnSteerParams` | `additionalContext` | [src/protocol/v2/turn.rs#L293](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/app-server-protocol/src/protocol/v2/turn.rs#L293) |

## Not in the inventory — category (3) `NON_EXPERIMENTAL_UPSTREAM_BUT_GOVAI_FORBIDDEN`

No `#[experimental]` annotation at the pin; present on the generated wire; forbidden by GovAI initial policy only
(`./govai-policy.ts`). Never labelled experimental.

| Value | Generated type | Upstream source |
|---|---|---|
| `"auto_review"` and compatibility spelling `"guardian_subagent"` | `v2/ApprovalsReviewer.ts` | `src/protocol/v2/shared.rs` L247 `#[serde(rename = "auto_review", alias = "guardian_subagent")] AutoReview` |
| `"danger-full-access"` | `v2/SandboxMode.ts` | `src/protocol/v2/shared.rs` L308 `DangerFullAccess` |
| `"never"` | `v2/AskForApproval.ts` | `src/protocol/v2/shared.rs` L191 `Never` |
| `{ "type": "dangerFullAccess" }`, `{ "type": "externalSandbox" }` (on `turn/start.sandboxPolicy`) | `v2/SandboxPolicy.ts` | `SandboxPolicy` |
