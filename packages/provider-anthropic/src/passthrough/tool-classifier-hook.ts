// Tool classifier hook — runs before forwarding. Returns either:
//   - { decision: 'allow', classifications: [...] }    : forward continues
//   - { decision: 'block', blocked: [...] }            : 403 + tool.validation_blocked
//
// Foundation V1 M1 (OD-1=A): every NON-computer tool is classified, contributes
// risk, is recorded and forwarded (`decision: 'allowed'`). The ONLY block this
// hook can produce is the explicit provider-hosted computer-use floor
// (`capability_blocked_via_token`); typed_unknown / former "planned" tools no
// longer block. Governed callers still route the classifications through
// `resolveGovernance` — a governed block for such tools is a matrix outcome.

import {
  decideAnthropicTool,
  type AnthropicToolClassification,
  type AnthropicToolDecision,
} from '../tool-classifier.js';
import type { PassthroughInvoked, ToolValidationBlocked } from '@govai/core-events';

export type ToolHookResult =
  | {
      decision: 'allow';
      classifications: PassthroughInvoked['detected_tool_classifications'];
    }
  | {
      decision: 'block';
      blocked: Array<{
        tool_index: number;
        tool_type?: string | undefined;
        tool_type_observed?: ToolValidationBlocked['tool_type_observed'];
        classification: AnthropicToolClassification;
        reason: NonNullable<AnthropicToolDecision['block_reason']>;
        reason_detail: string;
      }>;
      classifications: PassthroughInvoked['detected_tool_classifications'];
    };

function observeToolType(t: unknown): ToolValidationBlocked['tool_type_observed'] | undefined {
  if (t === undefined) return 'missing';
  if (t === null) return 'null';
  if (typeof t === 'string' && t === '') return 'empty_string';
  return 'other_typed_unknown';
}

export function classifyTools(tools: ReadonlyArray<unknown>): ToolHookResult {
  const classifications: PassthroughInvoked['detected_tool_classifications'] = [];
  const blocked: Extract<ToolHookResult, { decision: 'block' }>['blocked'] = [];

  for (let i = 0; i < tools.length; i++) {
    const tool = (tools[i] ?? {}) as Record<string, unknown>;
    const decided = decideAnthropicTool(tool);
    classifications.push({
      tool_index: i,
      tool_type: typeof tool.type === 'string' ? tool.type : undefined,
      classification: decided.classification,
      contributed_risk_class: decided.contributed_risk_class,
      decision: decided.decision === 'allowed' ? 'allowed' : 'blocked_at_validation',
    });
    if (decided.decision === 'blocked_at_validation' && decided.block_reason) {
      blocked.push({
        tool_index: i,
        tool_type: typeof tool.type === 'string' ? tool.type : undefined,
        tool_type_observed: observeToolType(tool.type),
        classification: decided.classification,
        reason: decided.block_reason,
        // M1: the sole validation block is the explicit computer-use high-risk floor.
        reason_detail: `tool classified as ${decided.classification} is provider-hosted computer use — the explicit Native high-risk floor (OD-1=A); requires a dedicated governance primitive`,
      });
    }
  }

  if (blocked.length > 0) {
    return { decision: 'block', blocked, classifications };
  }
  return { decision: 'allow', classifications };
}
