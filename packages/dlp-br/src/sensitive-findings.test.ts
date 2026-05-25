import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  baselineFindingToSensitiveFinding,
  confidenceBandForScore,
  matchHash,
  mergeFindingsWithPrecedence,
  mergeFindingsWithPrecedenceDecisions,
  recommendedActionRank,
  redactPreview,
  sensitiveFindingToLegacyFinding,
  strictestFinding,
  strictestRecommendedAction,
  type SensitiveDataFinding,
} from './sensitive-findings.js';

const baseRich = (overrides: Partial<SensitiveDataFinding> = {}): SensitiveDataFinding => ({
  detector: 'cpf',
  detector_family: 'baseline_pii_br',
  category: 'personal_data',
  index: 0,
  length: 11,
  match_hash: matchHash('cpf', '11144477735'),
  match_preview_redacted: redactPreview('cpf'),
  confidence: 0.95,
  confidence_band: 'high',
  rationale_code: 'format_and_checksum',
  recommended_action: 'observe',
  origin: 'govai_native',
  source_surface: 'govai_runs',
  source_quality: 'primary_govai_evidence',
  redaction_hint: 'mask:cpf',
  professional_review_recommended: false,
  dpo_review_recommended: false,
  legal_review_recommended: false,
  security_review_recommended: false,
  sector_specialist_review_recommended: false,
  ...overrides,
});

describe('matchHash', () => {
  it('is sha256(detector || ":" || match) in lowercase hex', () => {
    const expected = createHash('sha256').update('cpf:11144477735', 'utf8').digest('hex');
    expect(matchHash('cpf', '11144477735')).toBe(expected);
    expect(matchHash('cpf', '11144477735')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('binds to the detector so cross-detector collisions are impossible', () => {
    expect(matchHash('cpf', '11144477735')).not.toBe(matchHash('cnpj', '11144477735'));
  });

  it('is deterministic across calls', () => {
    expect(matchHash('email', 'a@b.com')).toBe(matchHash('email', 'a@b.com'));
  });
});

describe('redactPreview', () => {
  it('formats as [REDACTED:<detector>]', () => {
    expect(redactPreview('openai_api_key_candidate')).toBe('[REDACTED:openai_api_key_candidate]');
  });
});

describe('confidenceBandForScore', () => {
  it('maps to high / medium / low at the documented thresholds', () => {
    expect(confidenceBandForScore(1.0)).toBe('high');
    expect(confidenceBandForScore(0.85)).toBe('high');
    expect(confidenceBandForScore(0.84)).toBe('medium');
    expect(confidenceBandForScore(0.6)).toBe('medium');
    expect(confidenceBandForScore(0.59)).toBe('low');
    expect(confidenceBandForScore(0)).toBe('low');
  });

  it('clamps out-of-range and non-finite values rather than throwing', () => {
    expect(confidenceBandForScore(1.5)).toBe('high');
    expect(confidenceBandForScore(-1)).toBe('low');
    expect(confidenceBandForScore(Number.NaN)).toBe('low');
    expect(confidenceBandForScore(Number.POSITIVE_INFINITY)).toBe('high');
  });
});

describe('recommendedActionRank / strictestRecommendedAction', () => {
  it('orders observe < warn < review < approve_required < deny', () => {
    expect(recommendedActionRank('observe')).toBeLessThan(recommendedActionRank('warn'));
    expect(recommendedActionRank('warn')).toBeLessThan(recommendedActionRank('review'));
    expect(recommendedActionRank('review')).toBeLessThan(recommendedActionRank('approve_required'));
    expect(recommendedActionRank('approve_required')).toBeLessThan(recommendedActionRank('deny'));
  });

  it('strictestRecommendedAction returns the stricter of two', () => {
    expect(strictestRecommendedAction('observe', 'deny')).toBe('deny');
    expect(strictestRecommendedAction('approve_required', 'review')).toBe('approve_required');
    expect(strictestRecommendedAction('warn', 'warn')).toBe('warn');
  });
});

describe('baselineFindingToSensitiveFinding', () => {
  it('lifts a CPF baseline finding into a rich finding with hash and redacted preview only', () => {
    const lifted = baselineFindingToSensitiveFinding(
      { detector: 'cpf', match: '111.444.777-35', index: 4, length: 14 },
      { source_surface: 'govai_runs' },
    );
    expect(lifted.detector).toBe('cpf');
    expect(lifted.detector_family).toBe('baseline_pii_br');
    expect(lifted.category).toBe('personal_data');
    expect(lifted.index).toBe(4);
    expect(lifted.length).toBe(14);
    expect(lifted.match_hash).toBe(matchHash('cpf', '111.444.777-35'));
    expect(lifted.match_preview_redacted).toBe('[REDACTED:cpf]');
    expect(lifted.confidence_band).toBe('high');
    expect(lifted.rationale_code).toBe('format_and_checksum');
    expect(lifted.recommended_action).toBe('observe');
    expect(lifted.origin).toBe('govai_native');
    expect(lifted.source_quality).toBe('primary_govai_evidence');
    expect(lifted.redaction_hint).toBe('mask:cpf');
    // Hard guarantee: no raw match plaintext anywhere on the rich record.
    expect(JSON.stringify(lifted)).not.toContain('111.444.777-35');
    expect(JSON.stringify(lifted)).not.toContain('11144477735');
  });

  it('maps email / phone_br / cnpj to personal_data, with format rationale where checksum is N/A', () => {
    const e = baselineFindingToSensitiveFinding(
      { detector: 'email', match: 'a@b.com', index: 0, length: 7 },
      { source_surface: 'govai_runs' },
    );
    expect(e.category).toBe('personal_data');
    expect(e.rationale_code).toBe('format_match');
    expect(JSON.stringify(e)).not.toContain('a@b.com');

    const p = baselineFindingToSensitiveFinding(
      { detector: 'phone_br', match: '48998765432', index: 0, length: 11 },
      { source_surface: 'govai_runs' },
    );
    expect(p.category).toBe('personal_data');
    expect(p.rationale_code).toBe('format_match');
    expect(JSON.stringify(p)).not.toContain('48998765432');

    const c = baselineFindingToSensitiveFinding(
      { detector: 'cnpj', match: '11.444.777/0001-61', index: 0, length: 18 },
      { source_surface: 'govai_runs' },
    );
    expect(c.rationale_code).toBe('format_and_checksum');
    expect(JSON.stringify(c)).not.toContain('11.444.777/0001-61');
  });

  it('honors caller-supplied origin and source quality overrides', () => {
    const lifted = baselineFindingToSensitiveFinding(
      { detector: 'cpf', match: '11144477735', index: 0, length: 11 },
      {
        source_surface: 'connector_microsoft',
        origin: 'connector_ingested',
        source_quality: 'normalized_external',
      },
    );
    expect(lifted.origin).toBe('connector_ingested');
    expect(lifted.source_surface).toBe('connector_microsoft');
    expect(lifted.source_quality).toBe('normalized_external');
  });

  it('defaults unknown detector names to personal_data with format_match rationale', () => {
    const lifted = baselineFindingToSensitiveFinding(
      { detector: 'custom_thing', match: 'value', index: 0, length: 5 },
      { source_surface: 'govai_runs' },
    );
    expect(lifted.category).toBe('personal_data');
    expect(lifted.rationale_code).toBe('format_match');
    expect(lifted.confidence_band).toBe('medium');
  });
});

describe('sensitiveFindingToLegacyFinding', () => {
  it('re-attaches the raw match only when the caller passes it', () => {
    const legacy = sensitiveFindingToLegacyFinding(
      { detector: 'cpf', index: 3, length: 11 },
      '11144477735',
    );
    expect(legacy).toEqual({ detector: 'cpf', match: '11144477735', index: 3, length: 11 });
  });
});

describe('strictestFinding', () => {
  it('returns null on empty input', () => {
    expect(strictestFinding([])).toBeNull();
  });

  it('picks the stricter action when both findings are native primary', () => {
    const a = baseRich({ recommended_action: 'observe' });
    const b = baseRich({ detector: 'private_key_pem', recommended_action: 'deny' });
    expect(strictestFinding([a, b])?.detector).toBe('private_key_pem');
  });

  it('keeps a native primary even when a stricter non-native is present', () => {
    const native = baseRich({
      detector: 'cpf',
      recommended_action: 'observe',
      source_quality: 'primary_govai_evidence',
    });
    const external = baseRich({
      detector: 'cpf',
      recommended_action: 'deny',
      source_quality: 'unverified_external',
    });
    expect(strictestFinding([native, external])?.detector).toBe('cpf');
    expect(strictestFinding([native, external])?.source_quality).toBe('primary_govai_evidence');
  });
});

describe('mergeFindingsWithPrecedence', () => {
  it('coalesces native + external reports of the same hit, keeping the native one', () => {
    const same = baseRich();
    const externalSame = baseRich({
      source_quality: 'unverified_external',
      origin: 'external_import',
      source_surface: 'connector_other',
      recommended_action: 'deny',
    });
    const merged = mergeFindingsWithPrecedence([same], [externalSame]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source_quality).toBe('primary_govai_evidence');
    expect(merged[0]?.recommended_action).toBe('observe');
  });

  it('keeps distinct hits independent', () => {
    const a = baseRich();
    const b = baseRich({
      detector: 'private_key_pem',
      match_hash: matchHash('private_key_pem', '-----BEGIN PRIVATE KEY-----X-----END PRIVATE KEY-----'),
    });
    const merged = mergeFindingsWithPrecedence([a], [b]);
    expect(merged).toHaveLength(2);
  });
});

// Decision-preserving aggregator: the SD1 doctrine fix at the finding-set
// level. The selected-only `mergeFindingsWithPrecedence` above drops stricter
// external signals when a native finding wins; this variant keeps them as
// `escalation` so audit / review UIs in later SD slices can route on them
// without losing the doctrine. The output `decision.escalation` is metadata
// only — SD1 never consumes it for enforcement.
describe('mergeFindingsWithPrecedenceDecisions', () => {
  it('keeps the native finding selected AND preserves a stricter external signal as escalation', () => {
    const native = baseRich(); // primary_govai_evidence, observe
    const external = baseRich({
      source_quality: 'normalized_external',
      origin: 'connector_ingested',
      source_surface: 'connector_other',
      recommended_action: 'deny',
    });
    const decisions = mergeFindingsWithPrecedenceDecisions([native], [external]);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!.decision;
    expect(d.selected.source_quality).toBe('primary_govai_evidence');
    expect(d.selected.value.recommended_action).toBe('observe');
    expect(d.escalation?.source_quality).toBe('normalized_external');
    expect(d.escalation?.value.recommended_action).toBe('deny');
    expect(d.reason).toBe('external_escalation_preserved');
  });

  it('drops escalation when no external signal is stricter than the native finding', () => {
    const native = baseRich({ recommended_action: 'review' });
    const externalEqual = baseRich({
      source_quality: 'normalized_external',
      origin: 'connector_ingested',
      source_surface: 'connector_other',
      recommended_action: 'observe',
    });
    const decisions = mergeFindingsWithPrecedenceDecisions([native], [externalEqual]);
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!.decision;
    expect(d.selected.source_quality).toBe('primary_govai_evidence');
    expect(d.escalation).toBeUndefined();
    expect(d.reason).toBe('native_primary_selected');
  });

  it('selected-only `mergeFindingsWithPrecedence` matches `decisions[].selected` (no doctrine drift)', () => {
    const native = baseRich();
    const external = baseRich({
      source_quality: 'unverified_external',
      origin: 'external_import',
      source_surface: 'connector_other',
      recommended_action: 'deny',
    });
    const selected = mergeFindingsWithPrecedence([native], [external]);
    const decisions = mergeFindingsWithPrecedenceDecisions([native], [external]);
    expect(selected.map((f) => f.source_quality)).toEqual(
      decisions.map((d) => d.decision.selected.value.source_quality),
    );
  });

  it('reconciles the strictest external escalation across three sightings for the same key', () => {
    // Two external sightings arrive in addition to the native; the stricter
    // external must be preserved as escalation, not silently overwritten.
    const native = baseRich(); // observe
    const externalMild = baseRich({
      source_quality: 'normalized_external',
      origin: 'connector_ingested',
      source_surface: 'connector_other',
      recommended_action: 'warn',
    });
    const externalStrict = baseRich({
      source_quality: 'normalized_external',
      origin: 'connector_ingested',
      source_surface: 'connector_other',
      recommended_action: 'deny',
    });
    const decisions = mergeFindingsWithPrecedenceDecisions(
      [native],
      [externalMild, externalStrict],
    );
    expect(decisions).toHaveLength(1);
    const d = decisions[0]!.decision;
    expect(d.selected.source_quality).toBe('primary_govai_evidence');
    expect(d.escalation?.value.recommended_action).toBe('deny');
  });

  it('keeps distinct hits independent and surfaces them in input order', () => {
    const a = baseRich();
    const b = baseRich({
      detector: 'private_key_pem',
      match_hash: matchHash('private_key_pem', '-----BEGIN PRIVATE KEY-----X-----END PRIVATE KEY-----'),
    });
    const decisions = mergeFindingsWithPrecedenceDecisions([a], [b]);
    expect(decisions).toHaveLength(2);
    expect(decisions[0]!.decision.selected.value.detector).toBe('cpf');
    expect(decisions[1]!.decision.selected.value.detector).toBe('private_key_pem');
  });
});
