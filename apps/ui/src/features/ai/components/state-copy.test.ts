// Every turn state must be able to SPEAK: a badge label, and — unless it genuinely has nothing
// to explain — a note telling the reader what happened and what, if anything, they can do.
//
// This exists because the opposite happened. `request_too_large` was added with its label, its
// note copy in all three catalogs, and no entry in `STATE_NOTE` — which was `Partial`, so it
// compiled, and the one line of guidance the state exists to give never rendered. Both maps are
// now total, and this file asserts the property rather than trusting that they stay that way.
import { describe, expect, it } from 'vitest';
import { STATE_LABEL } from './InteractionReceipt.js';
import { STATE_NOTE } from './MessageTurn.js';
import { TERMINAL_STATES, type TurnState } from '../conversation/types.js';
import { CATALOGS } from '../../../lib/i18n/catalogs/index.js';
import { DEFAULT_LOCALE } from '../../../lib/i18n/locales.js';

/** Every state the union declares, taken from the label map — which the compiler forces to be
 *  total, so this list cannot silently fall behind the union. */
const ALL_STATES = Object.keys(STATE_LABEL) as TurnState[];

/** The states with deliberately no note: the two in-flight phases, and a completed answer,
 *  which speaks for itself. Anything else must explain itself. */
const NO_NOTE_BY_DESIGN: readonly TurnState[] = ['submitting', 'streaming', 'completed'];

describe('turn-state copy is complete', () => {
  it('every state has a label, and every label key exists in the catalog', () => {
    for (const state of ALL_STATES) {
      const key = STATE_LABEL[state].key;
      expect(key, state).toBeTruthy();
      expect(CATALOGS[DEFAULT_LOCALE][key], `${state} → ${key}`).toBeTruthy();
    }
  });

  it('★ every state that is not deliberately silent has a note, and the key exists', () => {
    for (const state of ALL_STATES) {
      const key = STATE_NOTE[state];
      if (NO_NOTE_BY_DESIGN.includes(state)) {
        expect(key, `${state} should have no note`).toBeNull();
        continue;
      }
      expect(key, `${state} has no STATE_NOTE entry — the reader is told nothing`).toBeTruthy();
      expect(CATALOGS[DEFAULT_LOCALE][key as never], `${state} → ${String(key)}`).toBeTruthy();
    }
  });

  it('every TERMINAL state except `completed` explains itself', () => {
    for (const state of TERMINAL_STATES) {
      if (state === 'completed') continue;
      expect(STATE_NOTE[state], `terminal state ${state} renders no explanation`).toBeTruthy();
    }
  });

  it('the note map is TOTAL over the state union — a new state cannot be added silently', () => {
    expect(Object.keys(STATE_NOTE).sort()).toEqual(ALL_STATES.slice().sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// `request_too_large` is decided from a RELAYED body. The direct routes pass an upstream status
// and body through verbatim, so a 413 carrying Fastify's envelope from an upstream or an
// intermediary is indistinguishable here from GovAI's own rejection — the missing non-forgeable
// GovAI-origin signal is the open residual `EP-PROVIDER-RESPONSE-HEADER-PROVENANCE`.
//
// The state earns its place on its REMEDY (shorten the request, which is right either way) and
// on not saying "the provider answered with an error" about a call the provider may never have
// received. What it must never do is convert a forgeable hint into a claim about billing or
// about which hop ran. This test pins that boundary in every locale, because the tempting
// wording — "GovAI rejected this, nothing was billed" — is precisely what the browser cannot
// stand behind, and it is what the copy said before this was caught.
describe('★ the oversized-request copy claims only what the browser can prove', () => {
  const NOTE_KEY = 'ai.state.requestTooLarge.note' as const;
  const LABEL_KEY = 'ai.state.requestTooLarge' as const;

  /** Claims that require knowing WHICH hop rejected the request, in the three shipped locales. */
  const UNPROVABLE = [
    /nothing was billed/i,
    /no provider call was made/i,
    /nada foi cobrado/i,
    /nenhuma chamada foi feita/i,
    /no se factur/i,
    /no se hizo ninguna llamada/i,
  ];

  it('no locale asserts that the provider was not called, or that nothing was billed', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const note = catalog[NOTE_KEY];
      expect(note, locale).toBeTruthy();
      for (const pattern of UNPROVABLE) {
        expect(pattern.test(note), `${locale} note asserts ${String(pattern)}`).toBe(false);
      }
    }
  });

  it('the badge names the fact (a size rejection), not an origin', () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      expect(catalog[LABEL_KEY], locale).not.toMatch(/GovAI/);
    }
  });

  it('every locale still gives the reader the remedy', () => {
    // pt-BR / es / en-US all name shortening the message and starting a new conversation.
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      const note = catalog[NOTE_KEY];
      expect(/shorten|encurte|acorta/i.test(note), `${locale} omits the remedy`).toBe(true);
      expect(
        /new conversation|nova conversa|conversación nueva/i.test(note),
        `${locale} omits the second remedy`,
      ).toBe(true);
    }
  });
});
