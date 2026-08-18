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
> **HISTORICAL_BODY_PRESERVED:** YES_WITH_BOUNDED_EDITS (status line reconciled; body otherwise byte-preserved)
> **SOURCE_SHA256:** `de1b4e29dffdf9a57e8933c0202f8371c0bcbac35aca3336deb003ce0f488c31` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** ACCEPTED as doctrine (D6). Operational rule for sharing artifacts; the §6 acceptance criteria (safe packaging script, CI/local forbidden-path check, README documentation) describe the target operating state and are not asserted as implemented by this promulgation — CI runs gitleaks; the safe-package script and README section are not verified present at the Foundation V1 anchor.
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

```bash
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

Run a non-git secret scan against the final artifact contents:

```bash
mkdir -p /tmp/govai-artifact-check
unzip -q govai-platform-src.zip -d /tmp/govai-artifact-check
gitleaks detect --no-git --source /tmp/govai-artifact-check --redact
```

Also verify forbidden paths:

```bash
find /tmp/govai-artifact-check -name '.env*' -o -name '.git' -o -name 'node_modules' -o -name 'coverage'
```

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
