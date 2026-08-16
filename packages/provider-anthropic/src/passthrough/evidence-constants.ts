// Evidence constants shared by the Native (passthrough) and Governed producers —
// Foundation V1 M1 (FB-4 §11.4).

/**
 * SHA-256 of zero bytes — the truthful `stream_final_hash` of a STREAMING request
 * that GovAI blocked before the provider was called: no stream was opened, zero
 * bytes were emitted, so the hash over the emitted stream bytes is SHA-256("").
 * The event carries NO `stream_outcome` (nothing started, so no outcome is
 * fabricated) and is otherwise a normal blocked v4 (`enforcement_decision` =
 * 'blocked', `body_forward_mode` = 'blocked', status 403). Kept as a literal so
 * evidence readers can recognise it.
 */
export const SHA256_EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
