// The Anthropic inbound-hop strip policy is a POLICY, so its contents are pinned here:
// widening it (a general browser-header purge) or narrowing it (reintroducing
// AI-CONSOLE-ORIGIN-RELAY-01) both have to be a deliberate edit to this test.
// The wire-level proofs live in the route/governed `*.inbound-hop-headers.test.ts`.
import { describe, it, expect } from 'vitest';
import { STRIP_INBOUND_BROWSER_HOP } from './outbound-header-policy.js';

describe('Anthropic STRIP_INBOUND_BROWSER_HOP', () => {
  it('is exactly {origin} — the one source-proven inbound-hop descriptor', () => {
    expect([...STRIP_INBOUND_BROWSER_HOP].sort()).toEqual(['origin']);
  });

  it('DELIBERATE BOUNDARY: it does not extend to headers that are merely browser-like', () => {
    for (const h of [
      'user-agent',
      'referer',
      'cookie',
      'accept',
      'accept-language',
      'sec-fetch-mode',
      'sec-fetch-site',
      'sec-fetch-dest',
      'sec-ch-ua',
    ]) {
      expect(STRIP_INBOUND_BROWSER_HOP.has(h)).toBe(false);
    }
  });

  it('holds lower-case names only, so a case-insensitive lookup is the caller contract', () => {
    for (const h of STRIP_INBOUND_BROWSER_HOP) {
      expect(h).toBe(h.toLowerCase());
    }
  });
});
