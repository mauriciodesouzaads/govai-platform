// Anthropic tools taxonomy version constant — Matrix v2 §14.1 + Peça A v2 §7.4.
// v2: `anthropic_typed_unknown` class introduced.
// v3 (Foundation V1 M1, OD-1=A): DECISION semantics changed — every non-computer
// tool (incl. code_execution, typed_unknown and the explicit `type:"custom"`
// client-defined form) is classified + forwarded; ONLY provider-hosted computer
// use remains blocked_at_validation. The v4 ToolClassificationEnum is unchanged;
// this string lets evidence readers tell which decision semantics produced an
// event's `detected_tool_classifications[].decision`.
// PassthroughInvokedSchema (Rule 5) requires this string to be present in
// every event whose `detected_tool_classifications.length > 0`.
// ToolValidationBlockedSchema v1 requires it on every emit.
export const KNOWN_ANTHROPIC_TAXONOMY_VERSION =
  'anthropic.tools_taxonomy:schema_version=3:m1_noncomputer_forward_computer_use_floor';
