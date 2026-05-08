// Canonical tool-taxonomy version literal — emitted in passthrough.invoked v3
// `tools_taxonomy_version` and tool.validation_blocked v1. Bumped whenever the
// classifier rules change shape (Matrix v2.0.1 P3 introduced openai_typed_unknown
// distinct semantics for type:null vs type:undefined parity with Anthropic).

export const KNOWN_OPENAI_TAXONOMY_VERSION =
  'openai.tools_taxonomy:schema_version=2:bumped_for_typed_unknown_class';
