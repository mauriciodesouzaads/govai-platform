// Anthropic tool classifier — Matrix v2 §14.2 + v2.0.1 P3 + Peça A v2 §7.4.
//
// Canonical rules (16 cases enumerated in §7.6 + Matrix P3):
//   1. !('type' in tool)                         → client_defined
//   2. tool.type === undefined (explicit)        → client_defined
//   3. tool.type === null (explicit)             → anthropic_typed_unknown  ← DISTINCT from #2
//   4. tool.type non-string (number, bool, obj)  → anthropic_typed_unknown
//   5. tool.type empty/whitespace string         → anthropic_typed_unknown
//   6. tool.type matches a known pattern         → specific classification
//   7. tool.type is a valid string but unknown   → anthropic_typed_unknown

export type AnthropicToolClassification =
  | 'client_defined'
  | 'anthropic_defined_client_executed_text_editor'
  | 'anthropic_defined_client_executed_bash'
  | 'anthropic_provider_hosted_web_search'
  | 'anthropic_provider_hosted_code_execution'
  | 'anthropic_provider_hosted_computer_use'
  | 'anthropic_typed_unknown';

const KNOWN_TYPED_PATTERNS: ReadonlyArray<{
  pattern: RegExp;
  classification: AnthropicToolClassification;
}> = Object.freeze([
  { pattern: /^text_editor_\d{8}$/, classification: 'anthropic_defined_client_executed_text_editor' },
  { pattern: /^bash_\d{8}$/, classification: 'anthropic_defined_client_executed_bash' },
  { pattern: /^web_search_\d{8}$/, classification: 'anthropic_provider_hosted_web_search' },
  { pattern: /^code_execution_\d{8}$/, classification: 'anthropic_provider_hosted_code_execution' },
  { pattern: /^computer_\d{8}$/, classification: 'anthropic_provider_hosted_computer_use' },
]);

export function classifyAnthropicTool(
  tool: { type?: unknown; [k: string]: unknown },
): AnthropicToolClassification {
  // 1. Field absent (key not in object) → client_defined.
  if (!('type' in tool)) {
    return 'client_defined';
  }
  // 2. Explicit undefined → client_defined.
  if (typeof tool.type === 'undefined') {
    return 'client_defined';
  }
  // 3. Explicit null → typed_unknown (NOT client_defined; malformed input).
  if (tool.type === null) {
    return 'anthropic_typed_unknown';
  }
  // 4. Non-string → typed_unknown.
  if (typeof tool.type !== 'string') {
    return 'anthropic_typed_unknown';
  }
  // 5. Empty / whitespace → typed_unknown.
  if (tool.type.trim().length === 0) {
    return 'anthropic_typed_unknown';
  }
  // 6. Match a known pattern.
  for (const { pattern, classification } of KNOWN_TYPED_PATTERNS) {
    if (pattern.test(tool.type)) {
      return classification;
    }
  }
  // 7. Valid string but unknown → typed_unknown.
  return 'anthropic_typed_unknown';
}

/**
 * Decision for a classified tool against PR2 supported set.
 * - `allowed`: tool is supported (client_defined OR a known typed class supported in PR2).
 * - `blocked_at_validation`: tool is recognized but its capability is not supported in PR2,
 *   or tool is typed_unknown.
 */
export type AnthropicToolDecision = {
  classification: AnthropicToolClassification;
  decision: 'allowed' | 'blocked_at_validation';
  /** When blocked, which `tool.validation_blocked.reason` enum value should the emitter use. */
  block_reason?:
    | 'typed_unknown'
    | 'capability_planned'
    | 'capability_blocked_via_token'
    | 'hard_denied_beta';
  /** Risk class contribution for `effective_risk_class` rollup (Matrix §14.1). */
  contributed_risk_class: 'A' | 'B' | 'C' | 'D' | 'E';
};

export function decideAnthropicTool(
  tool: { type?: unknown; [k: string]: unknown },
): AnthropicToolDecision {
  const classification = classifyAnthropicTool(tool);
  switch (classification) {
    case 'client_defined':
      return { classification, decision: 'allowed', contributed_risk_class: 'B' };
    case 'anthropic_defined_client_executed_text_editor':
      return { classification, decision: 'allowed', contributed_risk_class: 'C' };
    case 'anthropic_defined_client_executed_bash':
      return { classification, decision: 'allowed', contributed_risk_class: 'D' };
    case 'anthropic_provider_hosted_web_search':
      return { classification, decision: 'allowed', contributed_risk_class: 'C' };
    case 'anthropic_provider_hosted_code_execution':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_planned',
        contributed_risk_class: 'C',
      };
    case 'anthropic_provider_hosted_computer_use':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'capability_blocked_via_token',
        contributed_risk_class: 'D',
      };
    case 'anthropic_typed_unknown':
      return {
        classification,
        decision: 'blocked_at_validation',
        block_reason: 'typed_unknown',
        contributed_risk_class: 'C',
      };
  }
}
