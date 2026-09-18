// CONT-P5-A — THE CODEX PIN (EP-AI-CONVERSATION-CONTINUITY-V1, CONT-P5 Codex runtime; dispatch §0/§0.1).
//
// PURE CONSTANTS. Every value is COPIED from the adjudicated dispatch §0 and RE-VERIFIED by the executor:
// tag → annotated tag object → commit through the GitHub git API; asset name/id/digest through the release
// API; archive and executable SHA-256 by independent hash implementations; every vendored schema file by
// its git blob SHA-1 against the tree of the pinned COMMIT. Nothing here is discovered at runtime — a value
// that differs from the pin is a different artifact, and every consumer fails closed on it.
//
// ★ GOVAI PIN AUTHORITY = TAG_OBJECT + TARGET_COMMIT + ASSET_ID + ASSET_NAME + CONTENT_DIGEST. The upstream
//   release object is MUTABLE (`immutable = false`), so a tag name proves nothing on its own: if the same
//   tag/asset ever serves bytes ≠ these digests, that is a failed attestation, never an "update".
// ★ SURFACE MATURITY ≠ PROTOCOL CAPABILITY. The app-server surface is `[experimental]` upstream (vendor
//   maturity). The protocol capability `experimentalApi` is a different axis and is ALWAYS false in GovAI
//   (see ../attestation/attest-runtime.ts and ../guard/experimental-lockout.ts).
// ★ ONE BINARY, NO FALLBACK. The STANDALONE `codex-app-server` executable is the only runtime identity.
//   There is no "use the multitool `codex app-server` if the standalone is missing" path anywhere, no $PATH
//   lookup and no other platform: a non-darwin-arm64 host is FAIL_CLOSED_NOT_YET_PINNED.

export const CODEX_PIN = Object.freeze({
  release: '0.154.0',
  tag: 'rust-v0.154.0',
  annotatedTagObject: '36eab01061df3cde5f95ec20a526777b430091ba',
  commit: '6b9826e3aa83b1a5947db50f4332cb9c65f1b340',
  binaryKind: 'STANDALONE codex-app-server',
  crate: 'codex-app-server',
  bin: 'codex-app-server',
  supportedPlatform: 'darwin-arm64',
  otherPlatforms: 'FAIL_CLOSED_NOT_YET_PINNED',
  assetName: 'codex-app-server-aarch64-apple-darwin.tar.gz',
  assetId: 553706534,
  assetApiDigestSha256: 'a88883f1d2b68379eac51bd22be869eb768482aa9dcc1f9a69be86ef71dc6abd',
  assetSizeBytes: 67_973_610,
  archiveSha256: 'a88883f1d2b68379eac51bd22be869eb768482aa9dcc1f9a69be86ef71dc6abd',
  executableMemberName: 'codex-app-server-aarch64-apple-darwin',
  executableSha256: '2fc485696e5df06fc492fb310599752775fde726585149eaa7aeadb9117d235a',
  executableSizeBytes: 171_099_968,
  /** `--listen stdio://` is passed EXPLICITLY although it is the upstream default. */
  listenUrl: 'stdio://',
  releaseObjectMutability: 'MUTABLE',
  vendorMaturity: 'EXPERIMENTAL_AT_PIN',
  govaiUse: 'PINNED / INERT / CONFORMANCE_GATED',
} as const);

export type CodexPinIdentity = typeof CODEX_PIN;

/**
 * The vendored schema, bound to the pin. `sourceSha256` values are the SHA-256 of the UPSTREAM bytes at
 * `commit` (the vendored TypeScript files carry a provenance header in front of those bytes; the JSON files
 * are byte-identical). Full per-file digests of every vendored and derived file live in `MANIFEST.sha256`.
 */
export const CODEX_PIN_SCHEMA = Object.freeze({
  retrievalUrlTemplate:
    'https://raw.githubusercontent.com/openai/codex/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/<UPSTREAM_PATH>',
  typescriptUpstreamRoot: 'codex-rs/app-server-protocol/schema/typescript/',
  typescriptVendoredRoot: 'protocol/generated/',
  typescriptFileCount: 711,
  /** SHA-256 over the sorted `<sha256>  <relative path>\n` lines of the 711 upstream TypeScript files. */
  typescriptTreeSha256: '6692fb00c906a2d87beb15af8ebc1f029320884b19a1b85cd96c20c6b5650b8c',
  typescriptSourceSha256: Object.freeze({
    'InitializeParams.ts': 'bfc13b4fc9e37f629ee67b42d6e7f342ba38668ff528e738a911de5ebcfd545f',
    'InitializeCapabilities.ts': '4abc3c8bf9f039c61a0ee0f92c21854e350ce9ef4ef6b770178040e47744cd7b',
    'InitializeResponse.ts': '4feabcb66d4bf01869d2780beaec1838d41b30213cdf57de175298aed01f5379',
    'ClientInfo.ts': 'c3f38c70ffff810867af87a536d915dadea9e4b547343611c4e14731bcb7c648',
    'v2/ThreadForkParams.ts': '0929c6464eef63b260b89dea161381698588e966b76ceb506ccd09cfba4a50cf',
    'v2/AskForApproval.ts': '81dd17defd9a7fd4785346d3ce54c14243353b43174c7417827210cbd3ef3c52',
  }),
  json: Object.freeze({
    'ClientRequest.json': Object.freeze({
      upstreamPath: 'codex-rs/app-server-protocol/schema/json/ClientRequest.json',
      vendoredPath: 'pin/vendor/json/ClientRequest.json',
      sha256: 'da767fedd73502ceb644f5d7974927e1a6b7f1917b092aaa029e81949abf0125',
    }),
    'codex_app_server_protocol.schemas.json': Object.freeze({
      upstreamPath: 'codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.schemas.json',
      vendoredPath: 'pin/vendor/json/codex_app_server_protocol.schemas.json',
      sha256: 'd71ddf3bf5484f8de2799f7a4793c2e66808a9ec1a330e2307accb088ab5948a',
    }),
  }),
  manifestPath: 'pin/MANIFEST.sha256',
} as const);

export type CodexHostPlatform = { readonly platform: string; readonly arch: string };

/** The ONLY host the §0 executable is pinned for. Every other (platform, arch) pair fails closed. */
export function isPinnedHostPlatform(host: CodexHostPlatform): boolean {
  return host.platform === 'darwin' && host.arch === 'arm64';
}
