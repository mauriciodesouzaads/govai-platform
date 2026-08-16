// Canonical tool-taxonomy version literal — emitted in passthrough.invoked
// `tools_taxonomy_version` and tool.validation_blocked v1. Bumped whenever the
// classifier rules or decision semantics change shape.
// v2: Matrix v2.0.1 P3 introduced openai_typed_unknown (type:null vs
// type:undefined parity with Anthropic).
// v3 (Foundation V1 M1, OD-1=A): DECISION semantics changed — every non-computer
// tool (tool_search, code_interpreter, hosted_shell/shell, apply_patch, mcp,
// typed_unknown) is classified + forwarded; ONLY `computer_use_preview`
// remains blocked_at_validation. The v4 ToolClassificationEnum is unchanged.

export const KNOWN_OPENAI_TAXONOMY_VERSION =
  'openai.tools_taxonomy:schema_version=3:m1_noncomputer_forward_computer_use_floor';
