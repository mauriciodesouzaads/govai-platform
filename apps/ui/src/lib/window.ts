// The evidence measurement window.
//
// The window is not a cosmetic filter: it is the measurement context of every number on every
// evidence screen (`?window=` on /v1/evidence/summary and /v1/evidence/gaps). It is therefore
// always visible in the UI alongside T_seal, never hidden in a settings panel.
//
// The default is 24h, which is also the API's own default
// (EVIDENCE_DEFAULT_WINDOW_SECONDS = 86400, packages/config/src/index.ts:54). The UI sends the
// value explicitly anyway, so an export or a screenshot always records which window produced
// the numbers.

import type { MessageKey } from './i18n/catalogs/index.js';

export type WindowOption = {
  id: '1h' | '24h' | '7d' | '30d';
  seconds: number;
  labelKey: MessageKey;
};

export const WINDOW_OPTIONS: readonly WindowOption[] = [
  { id: '1h', seconds: 3_600, labelKey: 'window.1h' },
  { id: '24h', seconds: 86_400, labelKey: 'window.24h' },
  { id: '7d', seconds: 604_800, labelKey: 'window.7d' },
  { id: '30d', seconds: 2_592_000, labelKey: 'window.30d' },
] as const;

export const DEFAULT_WINDOW = WINDOW_OPTIONS[1]!; // 24h

export function windowById(id: string): WindowOption {
  return WINDOW_OPTIONS.find((w) => w.id === id) ?? DEFAULT_WINDOW;
}

export function windowBySeconds(seconds: number): WindowOption | null {
  return WINDOW_OPTIONS.find((w) => w.seconds === seconds) ?? null;
}
