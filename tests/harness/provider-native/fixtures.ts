// Provider-Native Compatibility Harness — H1 fixtures.
//
// Request bodies are HAND-AUTHORED raw JSON strings (NOT JSON.stringify of an
// object). They carry deliberate whitespace, deliberate (non-alphabetical) key
// order, unknown/future fields, nested vendor objects, and mixed arrays. The raw
// string is the canonical source of truth: the harness sends these exact bytes
// and asserts the upstream received the exact same bytes. Any invisible
// re-serialization changes whitespace/key-order and fails Buffer.compare.
//
// No secrets, no real API keys, no .env.

// --- OpenAI Chat Completions request -----------------------------------------
// Deliberately OMITS max_tokens / max_completion_tokens / temperature so the
// harness can prove GovAI injects no caps/defaults.
export const OPENAI_CHAT_REQUEST_RAW =
  '{\n' +
  '  "model":"gpt-4o-2024-11-20",\n' +
  '  "messages": [ {"role":"user","content":"hello native world"} ],\n' +
  '  "tool_choice":   "auto",\n' +
  '  "future_openai_field": "must-survive",\n' +
  '  "vendor_nested_object": { "z_first": 1, "a_second": [10, 20, 30] },\n' +
  '  "experimental_array": [ {"k":"v"}, "raw", 42 ],\n' +
  '  "stream": false\n' +
  '}';

// --- Anthropic Messages request ----------------------------------------------
// Client-supplied max_tokens is 777 (deliberately NOT 1024) so the harness can
// prove the /v1/runs shortcut's hardcoded max_tokens:1024 never leaks here.
export const ANTHROPIC_MESSAGES_REQUEST_RAW =
  '{\n' +
  '  "model":"claude-sonnet-4-5",\n' +
  '  "max_tokens": 777,\n' +
  '  "messages": [ {"role":"user","content":"hello native world"} ],\n' +
  '  "tool_choice":   "auto",\n' +
  '  "future_anthropic_field": "must-survive",\n' +
  '  "vendor_nested_object": { "z_first": 1, "a_second": [10, 20, 30] },\n' +
  '  "experimental_array": [ {"k":"v"}, "raw", 42 ],\n' +
  '  "stream": false\n' +
  '}';

// --- Provider success responses (raw, each with an unknown extra field) -------
export const OPENAI_CHAT_SUCCESS_RAW =
  '{"id":"chatcmpl-FAKE","object":"chat.completion","model":"gpt-4o-2024-11-20",' +
  '"choices":[{"index":0,"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}],' +
  '"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4},' +
  '"provider_unknown_future_field":"survive-response"}';

export const ANTHROPIC_MESSAGES_SUCCESS_RAW =
  '{"id":"msg_FAKE","type":"message","role":"assistant","model":"claude-sonnet-4-5",' +
  '"content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn",' +
  '"usage":{"input_tokens":3,"output_tokens":1},' +
  '"provider_unknown_future_field":"survive-response"}';

// --- Provider error responses (raw, provider-native error shapes) -------------
export const OPENAI_ERROR_429_RAW =
  '{"error":{"message":"Rate limit reached for requests","type":"requests",' +
  '"param":null,"code":"rate_limit_exceeded"}}';

export const ANTHROPIC_ERROR_529_RAW =
  '{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}';

// --- Provider response headers (custom; include rate-limit + request-id) ------
export const OPENAI_SUCCESS_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'x-request-id': 'req_FAKE_123',
  'openai-processing-ms': '42',
  'x-ratelimit-remaining-requests': '4999',
};

export const OPENAI_ERROR_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'x-request-id': 'req_FAKE_err',
  'x-ratelimit-remaining-requests': '0',
};

export const ANTHROPIC_SUCCESS_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'request-id': 'req_FAKE_456',
  'anthropic-ratelimit-requests-remaining': '49',
  'anthropic-ratelimit-tokens-remaining': '99000',
};

export const ANTHROPIC_ERROR_HEADERS: Record<string, string> = {
  'content-type': 'application/json',
  'request-id': 'req_FAKE_err2',
};
