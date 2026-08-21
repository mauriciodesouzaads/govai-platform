// Request-header hygiene for the SERVER→PROVIDER hop of the OpenAI surfaces.
//
// GovAI is two HTTP hops, not one: client→GovAI, then GovAI→OpenAI. A header that
// describes the FIRST hop is not a statement about the second, and relaying it
// verbatim re-attributes the caller's transport context to a request the caller
// never made. This module owns the (small) set of inbound header names that are
// structurally false once re-sent upstream. It is the single definition for this
// package — the passthrough route and BOTH governed handlers (Responses and Chat
// Completions) import it, so the policy cannot drift between Native/Audited and
// Governed, between the two governed surfaces, or between the streaming and
// non-streaming variants (one outbound header set serves both).
//
// ─────────────────────────────────────────────────────────────────────────────
// AI-CONSOLE-ORIGIN-RELAY-01 — owner-adjudicated FIX_REQUIRED
// (EP-UIUX-V1-U1.5-AI-CONSOLE-CLOSEOUT-02 §2)
//
// The blocker was proven on the Anthropic surface: browser → GovAI → Anthropic,
// where a relayed `Origin` makes Anthropic read a server-side call as direct
// browser access and answer 401 ("CORS requests must set
// 'anthropic-dangerous-direct-browser-access' header"). OpenAI TOLERATES the same
// relay — every live OpenAI leg passed with the browser's `Origin` on the wire —
// so here the defect is latent, not absent: GovAI is still telling OpenAI that a
// request originated from a web page that did not make it.
//
// The dispatch requires the correction to be class-wide (§2: "OpenAI currently
// tolerates Origin, but its relay is the same semantic defect. Fix OpenAI too so
// behavior is class-wide"), so this package strips it under the same rule rather
// than waiting for a provider to start enforcing it.
//
// There is no client-side fix: `Origin` is a forbidden header name in the Fetch
// spec — page JavaScript can neither set nor remove it — and the browser sends it
// on same-origin POSTs too.
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
