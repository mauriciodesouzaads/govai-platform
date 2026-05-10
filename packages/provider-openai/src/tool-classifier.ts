// OpenAI tool classifier — Matrix v2 §23.2 + Peça A v2 §8.4 + Matrix v2.0.1 P3.
//
// Differs from Anthropic in one structural way: OpenAI has NO `client_defined`
// fallback. Modern OpenAI tools require an explicit `type` field; absence or
// malformed type is `openai_typed_unknown` and is blocked at validation.
//
// Canonical rules:
//   1. !('type' in tool)                        → openai_typed_unknown   (no client_defined)
//   2. tool.type === undefined (explicit)       → openai_typed_unknown
//   3. tool.type === null (explicit)            → openai_typed_unknown
//   4. tool.type non-string (number, bool, obj) → openai_typed_unknown
//   5. tool.type empty/whitespace               → openai_typed_unknown
//   6. tool.type === 'function'                 → context-dependent:
//        - on /v1/responses          → function_responses (allowed, Risk C)
//        - on /v1/chat/completions   → function_chat_completions (allowed, Risk C)
//   7. tool.type matches a known pattern        → specific classification
//   8. valid string but unknown                 → openai_typed_unknown

export type OpenAIToolClassification =
  | 'function_responses'
  | 'function_chat_completions'
  | 'openai_provider_hosted_web_search'
  | 'openai_provider_hosted_file_search'
  | 'openai_provider_hosted_tool_search'
  | 'openai_provider_hosted_code_interpreter'
  | 'openai_provider_hosted_computer_use'
  | 'openai_provider_hosted_hosted_shell'
  | 'openai_provider_hosted_apply_patch'
  | 'openai_provider_hosted_mcp'
  | 'openai_typed_unknown';

export type OpenAISurface = 'responses' | 'chat_completions';

const KNOWN_TYPED_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  classification: OpenAIToolClassification;
}> = Object.freeze([
  // Provider-hosted tools — Responses API only (Chat Completions only accepts function).
  { pattern: /^(web_search|web_search_preview)$/, classification: 'openai_provider_hosted_web_search' },
  { pattern: /^file_search$/, classification: 'openai_provider_hosted_file_search' },
  { pattern: /^tool_search$/, classification: 'openai_provider_hosted_tool_search' },
  { pattern: /^code_interpreter$/, classification: 'openai_provider_hosted_code_interpreter' },
  { pattern: /^computer_use_preview$/, classification: 'openai_provider_hosted_computer_use' },
  { pattern: /^(hosted_shell|shell)$/, classification: 'openai_provider_hosted_hosted_shell' },
  { pattern: /^apply_patch$/, classification: 'openai_provider_hosted_apply_patch' },
  { pattern: /^mcp$/, classification: 'openai_provider_hosted_mcp' },
]);

export function classifyOpenAITool(
  tool: { type?: unknown; [k: string]: unknown },
  surface: OpenAISurface,
): OpenAIToolClassification {
  // 1+2. Field absent or explicit undefined → openai_typed_unknown (NO client_defined fallback).
  if (!('type' in tool) || typeof tool.type === 'undefined') {
    return 'openai_typed_unknown';
  }
  // 3. Explicit null.
  if (tool.type === null) {
    return 'openai_typed_unknown';
  }
  // 4. Non-string.
  if (typeof tool.type !== 'string') {
    return 'openai_typed_unknown';
  }
  // 5. Empty / whitespace.
  if (tool.type.trim().length === 0) {
    return 'openai_typed_unknown';
  }
  // 6. function — context-dependent surface.
  if (tool.type === 'function') {
    return surface === 'responses' ? 'function_responses' : 'function_chat_completions';
  }
  // 7. Known typed patterns. NOTE: Chat Completions API only accepts `function`;
  //    any other type on chat_completions is malformed input.
  if (surface === 'chat_completions') {
    return 'openai_typed_unknown';
  }
  for (const { pattern, classification } of KNOWN_TYPED_PATTERNS) {
    if (pattern.test(tool.type)) {
      return classification;
    }
  }
  // 8. Valid string but unknown.
  return 'openai_typed_unknown';
}

/**
 * Decision for a classified OpenAI tool against PR2 supported set.
 * - `allowed`: tool is supported in PR2 (function on either surface, web_search, file_search).
 * - `blocked_at_validation`: tool is recognized but its capability is not supported in PR2,
 *   or the tool is typed_unknown.
 *
 * Reuses the same 4-value `block_reason` enum as Anthropic (HAE-001):
 *   typed_unknown | capability_planned | capability_blocked_via_token | hard_denied_beta.
 */
export type OpenAIToolDecision = {
  classification: OpenAIToolClassification;
  decision: 'allowed' | 'blocked_at_validation';
  block_reason?:
    | 'typed_unknown'
    | 'capability_planned'
    | 'capability_blocked_via_token'
    | 'hard_denied_beta';
  contributed_risk_class: 'A' | 'B' | 'C' | 'D' | 'E';
};

export function decideOpenAITool(
  tool: { type?: unknown; [k: string]: unknown },
  surface: OpenAISurface,
): OpenAIToolDecision {
  const classification = classifyOpenAITool(tool, surface);
  switch (classification) {
    case 'function_responses':
    case 'function_chat_completions':
      // Risk C escalation when functions are used (Matrix §23.2).
      return { classification, decision: 'allowed', contributed_risk_class: 'C' };
    case 'openai_provider_hosted_web_search':
      return { classification, decision: 'allowed', contributed_risk_class: 'C' };
    case 'openai_provider_hosted_file_search':
      return { classification, decision: 'allowed', contributed_risk_class: 'B' };
    case 'openai_provider_hosted_tool_search':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_planned',
        contributed_risk_class: 'B',
      };
    case 'openai_provider_hosted_code_interpreter':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_planned',
        contributed_risk_class: 'C',
      };
    case 'openai_provider_hosted_computer_use':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_blocked_via_token',
        contributed_risk_class: 'D',
      };
    case 'openai_provider_hosted_hosted_shell':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_planned',
        contributed_risk_class: 'D',
      };
    case 'openai_provider_hosted_apply_patch':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_planned',
        contributed_risk_class: 'C',
      };
    case 'openai_provider_hosted_mcp':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_planned',
        contributed_risk_class: 'D',
      };
    case 'openai_typed_unknown':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'typed_unknown',
        contributed_risk_class: 'C',
      };
  }
}
