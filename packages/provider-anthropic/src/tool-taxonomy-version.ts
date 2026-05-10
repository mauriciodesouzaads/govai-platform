// Anthropic tools taxonomy version constant — Matrix v2 §14.1 + Peça A v2 §7.4.
// Bumped from v1 to v2 when `anthropic_typed_unknown` class was introduced.
// PassthroughInvokedSchema v3 (Rule 5) requires this string to be present in
// every event whose `detected_tool_classifications.length > 0`.
// ToolValidationBlockedSchema v1 requires it on every emit.
export const KNOWN_ANTHROPIC_TAXONOMY_VERSION =
  'anthropic.tools_taxonomy:schema_version=2:bumped_for_typed_unknown_class';
