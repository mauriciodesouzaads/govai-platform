# Changelog — @govai/dlp-br

All notable changes to the BR DLP detector package are documented here.
This project adheres to [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- **Alphanumeric CNPJ detection (IN RFB nº 2.229/2024).** `baseline-detectors.ts`
  now recognizes the alphanumeric CNPJ in addition to the legacy numeric format.
  The 12 base positions accept `[0-9A-Z]` (uppercase-only by design, D1) and the
  two check digits stay numeric. `isValidCnpj` computes the DV by mod-11 over each
  character's value `ASCII − 48` ('0'..'9'→0..9, 'A'→17 … 'Z'→42), matching the
  official Serpro/RFB reference algorithm. The implementation was verified
  checksum-identical to the official validator across every official reference
  case and all single-character mutations (EP-007 precondition #2).

### Changed

- `CNPJ_RE` widened to `[0-9A-Z]` on the 12 base positions (DV positions remain
  `\d{2}`). Numeric CNPJs are a strict subset of the new pattern, so there is no
  regression; existing numeric fixtures and tests are unchanged. The detector id
  stays `cnpj` (a `cnpj@2` versioned split is deferred, D2). RE2-only matching
  invariant preserved. The shared `digits()` helper and the CPF/email/phone
  detectors are untouched.

_Refs: EP-007, IN RFB nº 2.229/2024, `docs/architecture/regulatory/15-source-register.md` (BR-RFB-01)._
