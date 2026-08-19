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
> **BOUNDED CORRECTION OF §4 (M3, Codex review round 3 — P1 + P2):** the original v0.9 §4 commands were `mkdir -p /tmp/govai-artifact-check` / `unzip -q govai-platform-src.zip -d /tmp/govai-artifact-check` / `gitleaks detect --no-git --source /tmp/govai-artifact-check --redact` and `find /tmp/govai-artifact-check -name '.env*' -o -name '.git' -o -name 'node_modules' -o -name 'coverage'`. They were replaced (not merely annotated) because a fixed reusable extraction directory lets a stale extraction survive between runs (`unzip` does not overwrite collisions non-interactively → a new secret could be skipped while gitleaks scans old contents) and because the forbidden-path check covered only 4 of the §1 categories. The corrected §4 extracts into a fresh `mktemp -d` directory with cleanup and checks every §1 category (with the `.env.example` exemption and dump-only database patterns that never match migration SQL). Doctrine intent unchanged; the §6 acceptance criteria remain targets. EDITORIAL (Codex round 4, non-substantive): §3 gained a one-line cwd note — the `tar … govai-platform` operand names the checkout directory, so the command runs from its PARENT directory (unlike §2, which runs inside the repository); no policy or command semantics changed. Codex round 5 (P2, on the round-3 text): the §4 scan is now ONE scoped subshell block so the cleanup trap fires when the block ends (also when pasted interactively) and repeated runs cannot orphan earlier extraction directories; the find expression is unchanged. Codex round 7 (2×P2): the §4 block now exits NON-ZERO when any forbidden path is printed (previously `find` returned 0 even with matches) and adds `*.db` to the local-database patterns; §1 policy unchanged. Codex round 8 (P2): §4 previously accepted an ordinary plain-SQL database export (`backup.sql`, `nightly-prod.sql`, `data.sql`) — the database patterns matched only compressed SQL and names containing `dump`, and such an export need not carry a gitleaks-detectable secret, so a §1-prohibited local database dump could pass the required scan. The block now rejects EVERY extracted `.sql` that is not a tracked source path of the packaged commit (the allowlist is recomputed with `git ls-tree` from `REPO_DIR`, never hard-coded), so `…/migrations/backup.sql` is rejected while the repository's own migration and bootstrap SQL pass; §1 policy unchanged. Codex round 9 (P2, on the round-8 text): path membership alone was still insufficient — §3 packages the WORKING TREE, so a dump written OVER a tracked path (e.g. `infra/postgres/bootstrap.sql`) satisfied a path-only allowlist. The allowlist now carries `%(objectname) %(path)` per tracked `.sql` and each extracted `.sql` must match by BOTH blob id and path (`git hash-object`, which needs no repository), so a locally modified or substituted `.sql` no longer passes; §1 policy unchanged.
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

Run a non-git secret scan AND the forbidden-path check — including the
tracked-source `.sql` allowlist — against the final artifact contents, in ONE
scoped subshell: every run extracts into an EMPTY, freshly created directory
(never a fixed reusable path — a stale extraction can survive between runs and
`unzip` will not overwrite collisions non-interactively, so a new secret could
go unscanned), and the directory is removed when the subshell ends — also when
the snippet is pasted into an interactive shell (an `EXIT` trap in the
interactive shell itself would only fire at logout, leaving extracted contents
in `/tmp`; the subshell parentheses are therefore part of the procedure, not
decoration):

```bash
(
  set -eu
  CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/govai-artifact-check.XXXXXX")"
  SQL_ALLOW="$(mktemp "${TMPDIR:-/tmp}/govai-artifact-sqlallow.XXXXXX")"
  trap 'rm -rf "$CHECK_DIR" "$SQL_ALLOW"' EXIT

  # The checkout the artifact was packaged from: §2 runs INSIDE it (default `.`),
  # §3 runs from its PARENT — prefix that invocation with REPO_DIR=govai-platform.
  REPO_DIR="${REPO_DIR:-.}"

  unzip -q govai-platform-src.zip -d "$CHECK_DIR"
  # tar alternative (§3): tar -xzf govai-platform-src.tgz -C "$CHECK_DIR"

  gitleaks detect --no-git --source "$CHECK_DIR" --redact

  # Authorized SQL: the blob id AND path of every `.sql` in the packaged commit,
  # recomputed here — never a hard-coded list (adding a migration would silently
  # invalidate one). A failure aborts the block under `set -e`; an empty list
  # rejects every `.sql`.
  TRACKED="$(git -C "$REPO_DIR" ls-tree -r HEAD --format='%(objectname) %(path)')"
  printf '%s\n' "$TRACKED" | sed -n '/\.sql$/p' | LC_ALL=C sort > "$SQL_ALLOW"

  # Forbidden paths (every §1 category). ZERO output = no forbidden path found;
  # ANY output = the artifact violates the policy and must not be shared — and the
  # block exits NON-ZERO so an automated invocation (CI, wrapper) fails.
  # `.env.example` (tracked, secret-free template) is the only accepted `.env*`.
  FORBIDDEN="$(find "$CHECK_DIR" \( \
       -name '.env' -o \( -name '.env.*' ! -name '.env.example' \) \
    -o -name '.git' -o -name 'node_modules' -o -name 'coverage' \
    -o -name 'dist' \
    -o -name '*.tsbuildinfo' -o -name '.DS_Store' -o -name '__MACOSX' -o -name '*.log' \
    -o -name '*.dump' -o -name '*.pgdump' -o -name '*.backup' \
    -o -name '*.sql.gz' -o -name '*.sql.bz2' -o -name '*.sql.xz' -o -name '*.sql.zst' \
    -o -name '*.db' -o -name '*.sqlite' -o -name '*.sqlite3' -o -name '*dump*.sql' \
  \) -print)"

  # Local database dumps, general case: a plain-SQL export needs neither a
  # dump-shaped name nor a gitleaks-detectable secret, and §3 packages the
  # WORKING TREE — so a dump can also be written OVER a tracked path. Every
  # extracted `.sql` must therefore match an authorized entry by BOTH blob id
  # and path: content, not a name heuristic, not directory trust
  # (`…/migrations/backup.sql`) and not path trust alone (a dump written over
  # `infra/postgres/bootstrap.sql`). Paths are compared repo-relative (`./` and
  # §3's `govai-platform/` wrapper stripped); `git hash-object` needs no
  # repository. `grep` exits 1 when nothing is unauthorized, hence `|| true`.
  UNAUTHORIZED_SQL="$(
    cd "$CHECK_DIR"
    find . -name '*.sql' -print | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s %s\n' "$(git hash-object "$f")" \
        "$(printf '%s' "$f" | sed -e 's|^\./||' -e 's|^govai-platform/||')"
    done | grep -F -x -v -f "$SQL_ALLOW" || true
  )"

  if [ -n "$FORBIDDEN" ] || [ -n "$UNAUTHORIZED_SQL" ]; then
    if [ -n "$FORBIDDEN" ]; then printf '%s\n' "$FORBIDDEN"; fi
    if [ -n "$UNAUTHORIZED_SQL" ]; then
      printf '%s\n' "$UNAUTHORIZED_SQL" | sed 's|^|unauthorized .sql (content/path not in the packaged commit): |'
    fi
    echo "FORBIDDEN PATHS FOUND — do not share this artifact" >&2
    exit 1
  fi
  echo "artifact hygiene check passed (no forbidden paths)"
)
```

Notes: the subshell exit runs the trap, so the extraction and the allowlist
file are deleted after all three checks whether the snippet is run from a
script or pasted interactively, and consecutive/concurrent runs never share or
orphan extraction directories; the block's exit status is the verdict (0 =
clean; non-zero = gitleaks finding, forbidden path or unauthorized `.sql`), so
CI/wrappers can rely on it; `-name 'dist'` covers both `dist/` and
`tests/dist/`; the dump / `.db` / SQLite / compressed-SQL `find` patterns keep
rejecting dump-shaped names outright, and the allowlist then rejects every
remaining `.sql` whose blob id and path are not both in the packaged commit —
so `apps/api/src/db/migrations/*.sql` and `infra/postgres/bootstrap.sql` pass
as committed, while any other `.sql` does not, whatever its name or directory,
**and neither does a dump written over one of those tracked paths** (§3
packages the working tree, so path alone would not have caught that).
`REPO_DIR` must be the checkout the artifact was packaged from (§2 runs inside
it, so the default `.` is correct; §3 runs from its parent, so use
`REPO_DIR=govai-platform`); if `git` cannot resolve it the block aborts
non-zero rather than accepting the artifact. Consequence to expect: a §3 tar
taken over a dirty checkout fails while a `.sql` differs from its committed
blob — commit the change (or use the §2 `git archive`) rather than relaxing
the check.

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
