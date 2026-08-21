// Request-header hygiene for the SERVER→PROVIDER hop of the Anthropic surfaces.
//
// GovAI is two HTTP hops, not one: client→GovAI, then GovAI→Anthropic. A header
// that describes the FIRST hop is not a statement about the second, and relaying
// it verbatim re-attributes the caller's transport context to a request the
// caller never made. This module owns the (small) set of inbound header names
// that are structurally false once re-sent upstream. It is the single definition
// for this package — the passthrough route and the governed handler both import
// it, so the policy cannot drift between Native/Audited and Governed, or between
// the streaming and non-streaming variants (one outbound header set serves both).
//
// ─────────────────────────────────────────────────────────────────────────────
// AI-CONSOLE-ORIGIN-RELAY-01 — owner-adjudicated FIX_REQUIRED
// (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §2)
//
// Proven by live acceptance of the AI Console: browser → GovAI → Anthropic. The
// browser sets `Origin` on the browser→GovAI hop; GovAI relayed it, and Anthropic
// reads an `Origin` on an API request as direct browser access:
//
//   HTTP 401
//   {"type":"error","error":{"type":"authentication_error",
//    "message":"CORS requests must set 'anthropic-dangerous-direct-browser-access' header"}}
//
// Isolated against the running API, same body four ways: baseline 200 · +Origin
// 401 · +Referer only 200 · +Sec-Fetch-Mode only 200. `Origin` is the trigger,
// and it is the only proven one.
//
// There is no client-side fix. `Origin` is a forbidden header name in the Fetch
// spec — page JavaScript can neither set nor remove it — and the browser sends it
// on same-origin POSTs too. The one client-side alternative,
// `anthropic-dangerous-direct-browser-access`, asserts that the provider key is
// exposed to the browser: false here, and the opposite of GovAI's architecture,
// where the key is resolved server-side and never leaves the API process.
//
// OpenAI tolerates the same relay today, so the defect is latent there rather
// than absent; the sibling policy in @govai/provider-openai strips it as well,
// making the correction class-wide rather than an Anthropic special case.
//
// ─────────────────────────────────────────────────────────────────────────────
// DELIBERATE BOUNDARY — this is NOT a general browser-header purge.
//
// `user-agent`, the `sec-fetch-*` / `sec-ch-ua*` families, `accept*` and every
// other header a browser happens to send are left INTACT: they are forwarded
// today, no provider rejects them, and stripping headers merely for being
// browser-like would trade a proven defect for an unproven behavior change on a
// provider-native surface.
//
// `referer` and `cookie` describe the inbound hop by the same reasoning and are
// the natural next members of this set. They are NOT folded in here, because the
// owner adjudicated `origin` and was explicit that the correction must not become
// a general browser-header purge — but the reason is scope, NOT absence of a
// defect, and the record must not read as the latter. Measured during the
// CLOSEOUT-02 acceptance, in a real browser on the GovAI origin: `Referer` does
// not trigger the Anthropic rejection (200), and the page carried **6 cookies /
// 229 bytes** that GovAI never set — `localhost` is shared by every dev server
// the operator has ever run, and cookies are host-scoped, not port-scoped. Those
// bytes are relayed upstream today, on every browser-originated provider call.
// Tracked as `PROVIDER-INBOUND-HOP-HEADER-RESIDUAL-01`, with that evidence, for
// owner adjudication.
export const STRIP_INBOUND_BROWSER_HOP: ReadonlySet<string> = new Set(['origin']);
