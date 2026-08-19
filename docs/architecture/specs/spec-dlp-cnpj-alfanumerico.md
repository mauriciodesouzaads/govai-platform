> ---
> **REPOSITORY PROMULGATION HEADER — EP-FOUNDATION-V1-M3 (2026-08-18) · do not remove**
> **REPOSITORY_PROMULGATION_STATUS:** PROMULGATED
> **DOCUMENT_AUTHORITY_CLASS:** IMPLEMENTATION_RECORD
> **ORIGINAL_SOURCE_VERSION:** PR-0 tree ed18736a (2026-07-12; spec drafted 2026-06)
> **ORIGINAL_SOURCE_ANCHOR:** PR-0 document tree (owner-supplied package; PR-0 header retained below as history)
> **FOUNDATION_V1_RUNTIME_ANCHOR:** `de80664a6d2f6ce9312b4bcc6e27c0ea4eba4e68` (tree `0174a5c5b2e74c80b904d035b4f8ddc10abbbd69`, post-M2A, 2026-08-17)
> **CURRENT_CANONICAL_PRECEDENCE:** where this document conflicts with the current canonical runtime state, `docs/architecture/current-state.md` and `docs/architecture/foundation-v1-freeze.md` prevail; merged executable source, migrations and executing tests prevail over every document.
> **PROMULGATED_BY:** EP-FOUNDATION-V1-M3-CANONICAL-FREEZE-AND-PR0-D9-V2 (owner decision PR-0 27-tree disposition (NOT_REQUIRED — implementation fact, source-verified))
> **PROMULGATION_PR:** branch `docs/foundation-v1-m3-canonical-freeze` (PR number recorded in `docs/architecture/foundation-v1-freeze.md`; the merge commit is recorded only in the external post-merge mission record)
> **HISTORICAL_BODY_PRESERVED:** YES (byte-identical below this header, incl. the PR-0 header)
> **SOURCE_SHA256:** `3bc01556c3a680c2137cf7800c1a11e97efeb8ff0878d8ee2f2f1378524414b4` (owner-supplied source bytes, verified against the 43-entry corpus ledger; see `docs/architecture/d9-promulgation-manifest.md`)
> **NOTES:** IMPLEMENTATION RECORD / regression contract. Corrected wording (v0.2 manifest §2.2): `CNPJ_ALPHANUMERIC_DETECTOR=IMPLEMENTED_BEFORE_PR118` — the alphanumeric CNPJ detector (IN RFB 2.229/2024) landed in EP-007 (2026-06-20, `packages/dlp-br/src/baseline-detectors.ts`; see `docs/architecture/stale-docs-register.md` "EP-007 reconciliation"); `PR118_EFFECT=OVERLAPPING_SPAN_MERGE_AND_COUNT_CORRECTION` (PR #118 = P0.1 F5/F6, not the detector itself). The body's `Status: PROPOSED_IMPLEMENTATION_SPEC` and "current state" (§2, digits-only regex) are HISTORICAL. §4 vectors and §5 benchmark remain the regression contract; the D2 `cnpj@2` versioned-detector split noted in EP-007 is deferred (no detector-id/version change).
> ---

> ---
> **CABEÇALHO DE RE-ANCORAGEM — PR-0 (2026-07-12) · não remover**
> **STATUS:** IMPLEMENTADA — CNPJ alfanumérico (IN RFB 2.229/2024) presente em packages/dlp-br/src/baseline-detectors.ts no main
> **BASE DECLARADA PELO DOCUMENTO:** main pós-e8aa632 · **CÓDIGO NO MOMENTO DA PROMOÇÃO:** `ed18736a` (main, pós-#118, 2026-07-11)
> **REGIDO POR:** `docs/architecture/GOVAI-MAPA-MESTRE-DESENVOLVIMENTO_ed18736a.md` (v1.1) — em conflito de ESTADO ou ORDEM, o Mapa vence; em conflito com o CÓDIGO, o código vence (regra §0 do Mapa).
> **ÂNCORAS `arquivo:linha`:** re-verificar na fonte antes de qualquer uso (o código evolui; este cabeçalho não re-valida âncoras).
> **NOTAS DE PROMOÇÃO:** Vetores e benchmark da §4/§5 permanecem como contrato de regressão.
> **ORIGEM:** handoff 02-spec-dlp-cnpj-alfanumerico.md
> ---

# SPEC — dlp-br: alphanumeric CNPJ support (IN RFB 2.229/2024)

Status: `PROPOSED_IMPLEMENTATION_SPEC` — calendar deadline. Receita Federal
begins issuing alphanumeric CNPJ for **new registrations from July 2026**
(Instrução Normativa RFB nº 2.229/2024). Existing numeric CNPJs remain valid
and unchanged. Source register update required: add IN RFB 2.229/2024 as
`CONFIRMED_PRIMARY_SOURCE`
(https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/cnpj-alfanumerico).

## 1. Format (regulatory facts)

- 14 positions total, mask `AA.AAA.AAA/AAAA-DV`:
  - positions 1–8 (root) and 9–12 (establishment order): alphanumeric
    `[0-9A-Z]`;
  - positions 13–14 (check digits): **numeric only**.
- Check-digit algorithm: identical mod-11 weighting to the current numeric
  CNPJ, with character valuation `value = ascii(char) - 48` (so `'0'..'9'` →
  0..9, `'A'` → 17, `'B'` → 18, … `'Z'` → 42). Weights are unchanged:
  - DV1 over 12 chars: `[5,4,3,2,9,8,7,6,5,4,3,2]`;
  - DV2 over 13 chars: `[6,5,4,3,2,9,8,7,6,5,4,3,2]`;
  - `dv = sum % 11; dv = dv < 2 ? 0 : 11 - dv` (same rule as the existing
    `isValidCnpj`).
- Purely numeric CNPJs remain a strict subset of the new rule (ASCII−48 of a
  digit is the digit), so a single validator covers both.

## 2. Current state (source-verified)

`packages/dlp-br/src/baseline-detectors.ts`:
- `CNPJ_RE = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g` (RE2) — digits only.
- `isValidCnpj` — `digits()` strips non-digits; requires length 14; numeric
  DV math (weights as above).

Consequence: from 2026-07, newly issued alphanumeric CNPJs are **false
negatives** for the `cnpj` detector and for the `pii_strong` signal class used
by the governed DLP scan (`apps/api/src/routes/governed-*.ts` `dlpScan`).

## 3. Changes

### 3.1 Detector regex (RE2)

Replace `CNPJ_RE` with both-format matching, keeping RE2-only execution
(repository invariant — no native RegExp for matching):

```ts
// 12 alphanumeric (upper) + 2 numeric DV, with optional canonical separators.
const CNPJ_RE = new RE2(
  /\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\/?[0-9A-Z]{4}-?\d{2}\b/g,
);
```

Notes:
- Uppercase-only per the official format. To catch lowercase occurrences in
  free text, normalize the *candidate window* with `toUpperCase()` before
  validation (do not make the regex case-insensitive globally — it widens
  false positives on ordinary words; measure before changing this stance).
- The alphanumeric pattern necessarily matches more candidate strings than
  the numeric one (e.g., uppercase codes shaped like `AB.CDE.FGH/IJKL-12`).
  The checksum validator is the precision gate — this mirrors the existing
  CPF/CNPJ design where the regex proposes and the checksum disposes.
  Acceptance requires the FP benchmark in §5.

### 3.2 Validator

```ts
function cnpjCharValue(c: string): number {
  return c.charCodeAt(0) - 48; // '0'..'9' → 0..9, 'A' → 17 … 'Z' → 42
}

export function isValidCnpj(raw: string): boolean {
  const s = raw.replace(/[^0-9A-Za-z]+/g, '').toUpperCase();
  if (s.length !== 14) return false;
  if (!/^[0-9A-Z]{12}\d{2}$/.test(s)) return false;     // DVs must be numeric
  if (/^([0-9A-Z])\1{13}$/.test(s)) return false;        // repeated-char guard
  const vals = [...s].map(cnpjCharValue);
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += vals[i]! * w1[i]!;
  let dv1 = sum % 11; dv1 = dv1 < 2 ? 0 : 11 - dv1;
  if (dv1 !== vals[12]) return false;
  sum = 0;
  for (let i = 0; i < 13; i++) sum += vals[i]! * w2[i]!;
  let dv2 = sum % 11; dv2 = dv2 < 2 ? 0 : 11 - dv2;
  return dv2 === vals[13];
}
```

Behavioral guarantees:
- Every CNPJ that validated before continues to validate (numeric subset).
- `digits()`-based callers must be audited: the new sanitizer keeps letters.
  Repo-wide grep for `isValidCnpj` callers and update accordingly.

### 3.3 Detector metadata

- Keep detector id `cnpj` (downstream `signal_class: 'pii_strong'` mapping in
  the governed routes keys off the id; no change needed there).
- Add `detector_version` bump in whatever versioning the findings carry
  (`tools_taxonomy_version`-style); if findings currently carry no detector
  version, add `cnpj@2` to the finding metadata so evidence records which
  rule matched — cheap now, valuable in audits later.

## 4. Test vectors

- All existing numeric fixtures stay green (regression suite).
- Alphanumeric worked example (computed per §1; **confirm against the
  Serpro/RFB public validator before pinning as a fixture** — the tooling was
  announced for external testing):
  - base `12ABC34501DE` → DV1: sum 459 → 459 % 11 = 8 → dv1 = 3;
    with dv1 appended, DV2: sum 424 → 424 % 11 = 6 → dv2 = 5;
    full: `12ABC34501DE35`, formatted `12.ABC.345/01DE-35`.
- Property tests:
  - generate random `[0-9A-Z]{12}`, compute DVs with an independent inline
    implementation, assert `isValidCnpj` accepts; mutate any single char,
    assert reject (except documented mod-11 collisions — assert ≥ 99% reject
    rate over N=10k instead of universally).
  - lowercase input accepted after normalization; DV positions with letters
    rejected.
- Detection tests: alphanumeric CNPJ embedded in prose, with and without
  separators; overlap with the financial/court detectors unaffected
  (precedence/merge tests in `scan-sensitive` stay green).

## 5. False-positive benchmark (acceptance gate)

Run the existing DLP benchmark corpus (or, if none exists, assemble ≥ 5k
lines of mixed PT-BR business text containing uppercase codes, invoice ids,
license plates Mercosul `AAA1A11`, order numbers) and require:
- numeric-CNPJ precision/recall unchanged;
- alphanumeric candidates surviving checksum: report the count; expected
  near-zero on text containing no real alphanumeric CNPJs (checksum filters
  1/121 ≈ 0.8% of random shaped strings at most — two check digits).

## 6. Docs to update

`docs/architecture/regulatory/15-source-register.md` (new source),
`07-sensitive-data-handling.md` and `24` (detector behavior),
stale-docs register entry, CHANGELOG.

## 7. Non-goals

No CPF change (CPF remains numeric); no custom-detector engine change
(RE2-only invariant untouched); no attempt to validate CNPJ existence against
Receita services (checksum only — existence checks are a future connector).
