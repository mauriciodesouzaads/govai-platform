> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** ACCEPTED_ARCHITECTURAL_DOCTRINE
> **ORIGINAL_SOURCE_VERSION:** v0.9 corpus (2026-05-27, Draft)
> **ORIGINAL_SOURCE_ANCHOR:** owner-supplied v0.9 architecture package
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision D6=ACCEPT_AS_DOCTRINE)
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; §4 validation commands replaced — see NOTES; body otherwise byte-preserved)
> **SOURCE_SHA256:** `de1b4e29dffdf9a57e8933c0202f8371c0bcbac35aca3336deb003ce0f488c31` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED as doctrine (D6). Operational rule for sharing artifacts; the §6 acceptance criteria (safe packaging script, CI/local forbidden-path check, README documentation) describe the target operating state and are not asserted as implemented by this promulgation — CI runs gitleaks; the safe-package script and README section are not verified present at the Foundation V1 anchor.
> **BOUNDED CLARIFICATION (M3, applies to this repository):** the repository tracks a secret-free template `.env.example` (used by the README quickstart: `cp .env.example .env`); it is NOT a secret-bearing `.env`/`.env.*` file and is exempt from the §1 prohibition. Consequently the preferred `git archive` artifact (§2) legitimately contains `.env.example`, and the §4 forbidden-path check exempts it explicitly (`-name '.env.*' ! -name '.env.example'`); no `.gitattributes` `export-ignore` rule exists at the anchor and none is required for the template. Real `.env`, `.env.local` and any secret-bearing variant remain forbidden.
> **BOUNDED CORRECTION OF §4 (M3, Codex review round 3 — P1 + P2):** the original v0.9 §4 commands were `mkdir -p /tmp/govai-artifact-check` / `unzip -q govai-platform-src.zip -d /tmp/govai-artifact-check` / `gitleaks detect --no-git --source /tmp/govai-artifact-check --redact` and `find /tmp/govai-artifact-check -name '.env*' -o -name '.git' -o -name 'node_modules' -o -name 'coverage'`. They were replaced (not merely annotated) because a fixed reusable extraction directory lets a stale extraction survive between runs (`unzip` does not overwrite collisions non-interactively → a new secret could be skipped while gitleaks scans old contents) and because the forbidden-path check covered only 4 of the §1 categories. The corrected §4 extracts into a fresh `mktemp -d` directory with cleanup and checks every §1 category (with the `.env.example` exemption and dump-only database patterns that never match migration SQL). Doctrine intent unchanged; the §6 acceptance criteria remain targets. EDITORIAL (Codex round 4, non-substantive): §3 gained a one-line cwd note — the `tar … govai-platform` operand names the checkout directory, so the command runs from its PARENT directory (unlike §2, which runs inside the repository); no policy or command semantics changed.
> ---

# Artifact Hygiene

**Status:** Accepted as doctrine (M3 / owner decision D6, 2026-08-18) — originally Draft 2026-05-27  
**Date:** 2026-05-27  
**Purpose:** Prevent accidental sharing of secrets, local state and unsafe artifacts.

## 1. Rule

Never share a full project folder ZIP. Only share a safe source artifact.

Forbidden in shared artifacts:
- `.env`
- `.env.*`
- `.git/`
- `node_modules/`
- `coverage/`
- `dist/`
- `tests/dist/`
- `*.tsbuildinfo`
- `.DS_Store`
- `__MACOSX/`
- `*.log`
- local database dumps
- provider API keys
- private keys
- secrets of any kind

## 2. Preferred packaging

Use `git archive` when possible:

```bash
git archive --format=zip --output govai-platform-src.zip HEAD
```

This includes tracked files only and avoids ignored local secrets.

## 3. Safe tar alternative

Run this from the PARENT directory of the checkout (the directory that contains
`govai-platform/`) — unlike §2, which runs inside the repository:

```bash
# cwd = parent directory of the checkout (contains govai-platform/)
tar \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='coverage' \
  --exclude='dist' \
  --exclude='tests/dist' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.tsbuildinfo' \
  --exclude='.DS_Store' \
  --exclude='__MACOSX' \
  --exclude='*.log' \
  -czf govai-platform-src.tgz govai-platform
```

## 4. Required scan before sharing

Run a non-git secret scan against the final artifact contents. Every scan
starts from an EMPTY, freshly created directory (never a fixed reusable path:
a stale extraction can survive between runs and `unzip` will not overwrite
collisions non-interactively, so a new secret could go unscanned), and the
directory is removed afterwards:

```bash
CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/govai-artifact-check.XXXXXX")"
trap 'rm -rf "$CHECK_DIR"' EXIT

unzip -q govai-platform-src.zip -d "$CHECK_DIR"
# tar alternative (§3): tar -xzf govai-platform-src.tgz -C "$CHECK_DIR"

gitleaks detect --no-git --source "$CHECK_DIR" --redact
```

Also verify EVERY path prohibited by §1 (zero output = no forbidden path found;
ANY output = the artifact violates the policy and must not be shared). The
secret-free tracked template `.env.example` is the only accepted `.env*` path;
repository migration `.sql` files are legitimate source and are not matched —
only dump/backup formats are:

```bash
find "$CHECK_DIR" \( \
     -name '.env' -o \( -name '.env.*' ! -name '.env.example' \) \
  -o -name '.git' -o -name 'node_modules' -o -name 'coverage' \
  -o -name 'dist' \
  -o -name '*.tsbuildinfo' -o -name '.DS_Store' -o -name '__MACOSX' -o -name '*.log' \
  -o -name '*.dump' -o -name '*.pgdump' -o -name '*.backup' \
  -o -name '*.sql.gz' -o -name '*.sql.bz2' -o -name '*.sql.xz' -o -name '*.sql.zst' \
  -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*dump*.sql' \
\)
```

Notes: `-name 'dist'` covers both `dist/` and `tests/dist/`; the last three
lines are the "local database dumps" patterns (pg_dump / SQLite / compressed
SQL dumps and `*dump*.sql`), chosen so that `apps/api/src/db/migrations/*.sql`
and `infra/postgres/bootstrap.sql` are never flagged.

## 5. Incident procedure

If a shared artifact includes secrets:
1. do not print or forward secret values;
2. revoke/rotate provider keys;
3. inspect provider usage/billing;
4. delete unsafe artifact from sharing location;
5. generate safe artifact;
6. record incident in internal notes.

## 6. Acceptance criteria

- Safe packaging script exists.
- CI or local check fails if forbidden paths appear in generated artifact.
- Secret scan runs against final artifact.
- README documents safe sharing command.
