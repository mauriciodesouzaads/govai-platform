// Pure formatting primitives. Every function here is total and side-effect free so it can be
// table-tested before any screen uses it.
//
// The load-bearing rule: a value the API sends as a decimal STRING because it can exceed
// Number.MAX_SAFE_INTEGER is never converted to a number anywhere in this application. There
// is deliberately no helper in this file that turns such a string into a number.

import type { Locale } from './i18n/locales.js';

/** True for a decimal integer string (optionally negative). Used BOTH as the contract-schema
 *  refinement for the bigint-valued fields and as the render-time guard, so a malformed value
 *  fails the parse instead of reaching an auditor's screen. */
export function isDecimalDigits(value: string): boolean {
  return /^-?\d+$/.test(value);
}

/**
 * Render a bigint-valued decimal string EXACTLY as received — no grouping, no rounding, no
 * Number(). `9007199254740993` renders as those sixteen digits, which is the whole point:
 * pointing an auditor at the wrong sequence number is a data-integrity failure, not a
 * cosmetic one. A non-digit value returns null so the caller can show an explicit
 * unreadable-value marker rather than silently printing something.
 */
export function exactDigits(value: string): string | null {
  return isDecimalDigits(value) ? value : null;
}

/** Lowercase hex, truncated head…tail for dense display. Values already short enough are
 *  returned untouched, so the ellipsis always means "there is more". */
export function truncateHex(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Integers in the reader's locale. Accepts bigint so a caller that legitimately holds one
 *  never has to narrow it. */
export function formatInteger(value: number | bigint, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}

const RATIO_DIGITS = 3;

/**
 * The coverage ratio as a fraction with three decimals, matching how the backend expresses it.
 * Deliberately NOT a percentage: the API's own unit is a ratio, and re-expressing it invites
 * rounding a 0.9996 into a reassuring "100%".
 *
 * ★ Rounding must never cross a boundary and change the FACT. At three decimals 0.9996 would
 * print as "1.000" — full coverage — while the panel beside it is simultaneously in an
 * attention state because covered < total. A ratio that is below 1 therefore renders as
 * "< 1.000", and a non-zero ratio that would round to zero renders as "> 0.000". The strict
 * inequality is the honest reading, and it keeps the headline consistent with the exact
 * covered/total counts printed next to it.
 */
export function formatRatio(value: number, locale: Locale): string {
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: RATIO_DIGITS,
    maximumFractionDigits: RATIO_DIGITS,
  });
  const factor = 10 ** RATIO_DIGITS;
  const rounded = Math.round(value * factor) / factor;
  if (rounded >= 1 && value < 1) return `< ${nf.format(1)}`;
  if (rounded <= 0 && value > 0) return `> ${nf.format(0)}`;
  return nf.format(value);
}

/** An ISO-8601 UTC instant rendered in the reader's locale and local time zone. Returns null
 *  for an unparseable value so the caller shows a marker instead of "Invalid Date". */
export function formatDateTime(iso: string, locale: Locale): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(ms));
}

/** A duration in seconds as a compact human string (`300 s`, `24 h`, `7 d`). Used for the
 *  window and T_seal context that must stay visible on every evidence screen. */
export function formatDurationSeconds(seconds: number, locale: Locale): string {
  const n = (v: number): string => new Intl.NumberFormat(locale).format(v);
  if (seconds % 86_400 === 0 && seconds >= 86_400) return `${n(seconds / 86_400)} d`;
  if (seconds % 3_600 === 0 && seconds >= 3_600) return `${n(seconds / 3_600)} h`;
  if (seconds % 60 === 0 && seconds >= 60) return `${n(seconds / 60)} min`;
  return `${n(seconds)} s`;
}

/** A drop rate as a percentage with two decimals. Only ever called when the API reported a
 *  non-null rate — an unobserved signal has no rate and must not be rendered as 0%. */
export function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
