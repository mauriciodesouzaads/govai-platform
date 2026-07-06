# EP-SEALER-DEPLOY — production image for the B3 AuditSealer.
# Build context = the REPO ROOT (the bundle inlines the @govai/* workspace deps from source):
#   docker build -f apps/audit-sealer/Dockerfile -t govai-audit-sealer .
#
# The runtime runs a SELF-CONTAINED esbuild bundle with plain `node` (NOT tsx): the monorepo is
# TypeScript-source-only (every @govai/* package `exports` → ./src/*.ts), so a tsc-compiled dist
# cannot resolve its workspace deps at runtime; esbuild bundles them into one file. KMS is imported
# via @govai/core-identity/kms (not the index), which keeps the native `argon2` — used only by the
# API-key path the sealer never touches — out of the bundle, so it stays free of native deps.

# ---- build stage: install the workspace + bundle the sealer ----
FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
# Copy the workspace (host node_modules/dist/.git excluded via .dockerignore) and install fresh.
COPY . .
RUN pnpm install --frozen-lockfile
# esbuild → dist/bundle.mjs (ESM, node24 target, createRequire banner for built-in dynamic requires).
RUN pnpm --filter @govai/audit-sealer build:bundle

# ---- runtime stage: minimal image, non-root, just the bundle ----
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
# Non-root runtime user.
RUN useradd --system --uid 10001 --home-dir /app --shell /usr/sbin/nologin sealer
WORKDIR /app
# ONLY the self-contained bundle — no workspace, no node_modules for the @govai/* packages.
COPY --from=build /repo/apps/audit-sealer/dist/bundle.mjs /app/bundle.mjs
# The sealer writes its readiness health-file here (AUDIT_SEALER_HEALTH_FILE overrides; default is
# /tmp/audit-sealer-health.json). /tmp is world-writable; /app is owned by the runtime user for an
# alternative writable location. The orchestrator readiness probe stats/reads this file.
RUN mkdir -p /app/health && chown -R sealer:sealer /app
USER sealer
ENV AUDIT_SEALER_HEALTH_FILE=/app/health/audit-sealer-health.json
# Self-contained readiness check: parse the health-file and exit 0 iff readiness.ready.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD node -e "const f=process.env.AUDIT_SEALER_HEALTH_FILE||'/tmp/audit-sealer-health.json';const j=JSON.parse(require('fs').readFileSync(f,'utf8'));process.exit(j.readiness&&j.readiness.ready?0:1)"
# Plain node on the bundle — never tsx in production.
CMD ["node", "/app/bundle.mjs"]
