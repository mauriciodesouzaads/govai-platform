// GOVAI-PROVENANCE-BEGIN CONT-P5-A (verbatim-source-derived fragment: runtime mirror of generated literal unions)
// PIN_RELEASE           = 0.154.0
// PIN_TAG               = rust-v0.154.0
// PIN_COMMIT            = 6b9826e3aa83b1a5947db50f4332cb9c65f1b340
// SOURCE_PATH_OR_SCHEMA = the `"method"` arms of ./generated/ServerNotification.ts, ./generated/ServerRequest.ts and
//                         ./generated/ClientNotification.ts; the literal unions of ./generated/v2/UserInput.ts ("type"),
//                         ./generated/v2/SortDirection.ts and ./generated/v2/TurnItemsView.ts
// SOURCE_SHA256         = (the vendored files above; their upstream digests are in their own provenance headers and
//                         in ../pin/MANIFEST.sha256)
// GENERATOR_IDENTITY    = NONE (transcribed; exactness against the generated unions is enforced BOTH WAYS by `tsc`)
// GENERATOR_VERSION     = N/A
// GENERATOR_CONFIG      = N/A
// DERIVATION_MODE       = VERBATIM_SOURCE_DERIVED
// GOVAI-PROVENANCE-END
//
// WHY. The generated TypeScript is types only; the client needs the same literal sets at RUNTIME to tell a
// known method from an unknown one (the `unknown method` arm of the error taxonomy) and to validate enum
// inputs. Each list below is checked against its generated union in both directions at compile time, so a
// list can neither miss an arm nor invent one.

import type { ClientNotification } from './generated/ClientNotification';
import type { ServerNotification } from './generated/ServerNotification';
import type { ServerRequest } from './generated/ServerRequest';
import type { SortDirection } from './generated/v2/SortDirection';
import type { TurnItemsView } from './generated/v2/TurnItemsView';
import type { UserInput } from './generated/v2/UserInput';

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

export const CODEX_SERVER_NOTIFICATION_METHODS = [
  'error',
  'thread/started',
  'thread/status/changed',
  'thread/archived',
  'thread/deleted',
  'thread/unarchived',
  'thread/closed',
  'thread/reverted',
  'skills/changed',
  'thread/name/updated',
  'thread/goal/updated',
  'thread/goal/cleared',
  'thread/queue/changed',
  'project/changed',
  'thread/project/updated',
  'thread/environment/connected',
  'thread/environment/disconnected',
  'thread/settings/updated',
  'thread/tokenUsage/updated',
  'turn/started',
  'hook/started',
  'turn/completed',
  'hook/completed',
  'turn/diff/updated',
  'turn/plan/updated',
  'item/started',
  'item/autoApprovalReview/started',
  'item/autoApprovalReview/completed',
  'autoApprovalReview/strictReviewRequired',
  'item/completed',
  'rawResponseItem/completed',
  'rawResponse/completed',
  'item/agentMessage/delta',
  'item/plan/delta',
  'command/exec/outputDelta',
  'process/outputDelta',
  'process/exited',
  'item/commandExecution/outputDelta',
  'item/commandExecution/terminalInteraction',
  'item/fileChange/outputDelta',
  'item/fileChange/patchUpdated',
  'serverRequest/resolved',
  'item/mcpToolCall/progress',
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
  'mcpServer/event/stream/notification',
  'account/updated',
  'account/rateLimits/updated',
  'app/list/updated',
  'remoteControl/status/changed',
  'externalAgentConfig/import/progress',
  'externalAgentConfig/import/completed',
  'fs/changed',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/summaryPartAdded',
  'item/reasoning/textDelta',
  'thread/compacted',
  'model/rerouted',
  'model/verification',
  'modelProvider/authRecoveryStarted',
  'modelProvider/authRecoveryCompleted',
  'turn/moderationMetadata',
  'model/safetyBuffering/updated',
  'warning',
  'guardianWarning',
  'deprecationNotice',
  'configWarning',
  'fuzzyFileSearch/sessionUpdated',
  'fuzzyFileSearch/sessionCompleted',
  'thread/realtime/started',
  'thread/realtime/itemAdded',
  'thread/realtime/item/started',
  'thread/realtime/item/transcript/delta',
  'thread/realtime/item/completed',
  'thread/realtime/transcript/delta',
  'thread/realtime/transcript/done',
  'thread/realtime/outputAudio/delta',
  'thread/realtime/sdp',
  'thread/realtime/error',
  'thread/realtime/closed',
  'windows/worldWritableWarning',
  'windowsSandbox/setupCompleted',
  'account/login/completed',
] as const;

export const CODEX_SERVER_REQUEST_METHODS = [
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/tool/requestUserInput',
  'mcpServer/elicitation/request',
  'item/permissions/requestApproval',
  'item/tool/call',
  'account/chatgptAuthTokens/refresh',
  'attestation/generate',
  'applyPatchApproval',
  'execCommandApproval',
] as const;

export const CODEX_CLIENT_NOTIFICATION_METHODS = ['initialized'] as const;

export const CODEX_USER_INPUT_TYPES = [
  'text',
  'image',
  'localImage',
  'audio',
  'localAudio',
  'skill',
  'mention',
] as const;

export const CODEX_SORT_DIRECTIONS = ['asc', 'desc'] as const;

export const CODEX_TURN_ITEMS_VIEWS = ['notLoaded', 'summary', 'full'] as const;

export const CODEX_SERVER_NOTIFICATION_METHODS_EXACT: Exactly<
  (typeof CODEX_SERVER_NOTIFICATION_METHODS)[number],
  ServerNotification['method']
> = true;
export const CODEX_SERVER_REQUEST_METHODS_EXACT: Exactly<(typeof CODEX_SERVER_REQUEST_METHODS)[number], ServerRequest['method']> =
  true;
export const CODEX_CLIENT_NOTIFICATION_METHODS_EXACT: Exactly<
  (typeof CODEX_CLIENT_NOTIFICATION_METHODS)[number],
  ClientNotification['method']
> = true;
export const CODEX_USER_INPUT_TYPES_EXACT: Exactly<(typeof CODEX_USER_INPUT_TYPES)[number], UserInput['type']> = true;
export const CODEX_SORT_DIRECTIONS_EXACT: Exactly<(typeof CODEX_SORT_DIRECTIONS)[number], SortDirection> = true;
export const CODEX_TURN_ITEMS_VIEWS_EXACT: Exactly<(typeof CODEX_TURN_ITEMS_VIEWS)[number], TurnItemsView> = true;

export function isGeneratedServerNotificationMethod(method: string): method is ServerNotification['method'] {
  return (CODEX_SERVER_NOTIFICATION_METHODS as readonly string[]).includes(method);
}

export function isGeneratedServerRequestMethod(method: string): method is ServerRequest['method'] {
  return (CODEX_SERVER_REQUEST_METHODS as readonly string[]).includes(method);
}
