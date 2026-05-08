// OpenAI tool classifier hook — runs before forwarding. Returns either:
//   - { decision: 'allow', classifications: [...] }    : forward continues
//   - { decision: 'block', blocked: [...] }            : 403 + tool.validation_blocked

import {
  decideOpenAITool,
  type OpenAIToolClassification,
  type OpenAIToolDecision,
  type OpenAISurface,
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
        classification: OpenAIToolClassification;
        reason: NonNullable<OpenAIToolDecision['block_reason']>;
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

export function classifyOpenAITools(
  tools: ReadonlyArray<unknown>,
  surface: OpenAISurface,
): ToolHookResult {
  const classifications: PassthroughInvoked['detected_tool_classifications'] = [];
  const blocked: Extract<ToolHookResult, { decision: 'block' }>['blocked'] = [];

  for (let i = 0; i < tools.length; i++) {
    const tool = (tools[i] ?? {}) as Record<string, unknown>;
    const decided = decideOpenAITool(tool, surface);
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
        reason_detail:
          decided.block_reason === 'typed_unknown'
            ? `tool.type ${JSON.stringify(tool.type)} is not classified in the GovAI OpenAI taxonomy`
            : decided.block_reason === 'capability_planned'
              ? `tool classified as ${decided.classification} maps to a planned capability (target PR4+)`
              : `tool classified as ${decided.classification} is hard_denied until governance primitive (target PR8+)`,
      });
    }
  }

  if (blocked.length > 0) {
    return { decision: 'block', blocked, classifications };
  }
  return { decision: 'allow', classifications };
}
