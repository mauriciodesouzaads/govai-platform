// CONT-P5-A — owned UserInput (remediation R2): validate → reconstruct → detach → own, for every pinned variant,
// exercised at the real boundary (the outbound policy primitive) unless a test names the helper itself.

import { describe, expect, it } from 'vitest';

import type { UserInput } from './generated/v2/UserInput';
import { enforceGovAICodexOutboundPolicy, GovAICodexPolicyViolation } from './govai-policy.js';
import { GOVAI_CODEX_IMAGE_DETAILS, GOVAI_CODEX_USER_INPUT_KEYS, ownGovAICodexUserInputs } from './govai-user-input.js';
import { CODEX_USER_INPUT_TYPES } from './method-names.js';

function turn(input: unknown) {
  return enforceGovAICodexOutboundPolicy('turn/start', { threadId: 't', input });
}

function refusal(fn: () => unknown): GovAICodexPolicyViolation {
  try {
    fn();
  } catch (error) {
    if (error instanceof GovAICodexPolicyViolation) return error;
    throw error;
  }
  throw new Error('expected a GovAICodexPolicyViolation');
}

const refused = (input: unknown): GovAICodexPolicyViolation => refusal(() => turn(input));

function deeplyFrozen(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(deeplyFrozen);
}

/** One valid instance per variant, required keys only. */
const VALID: Record<UserInput['type'], Record<string, unknown>> = {
  text: { type: 'text', text: 'héllo', text_elements: [] },
  image: { type: 'image', url: 'https://example.invalid/i.png' },
  localImage: { type: 'localImage', path: '/tmp/i.png' },
  audio: { type: 'audio', url: 'https://example.invalid/a.wav' },
  localAudio: { type: 'localAudio', path: '/tmp/a.wav' },
  skill: { type: 'skill', name: 'review', path: '/tmp/skill' },
  mention: { type: 'mention', name: 'notes', path: '/tmp/notes.md' },
};

const CONTENT_STRINGS: Record<UserInput['type'], readonly string[]> = {
  text: ['text'],
  image: ['url'],
  localImage: ['path'],
  audio: ['url'],
  localAudio: ['path'],
  skill: ['name', 'path'],
  mention: ['name', 'path'],
};

describe('R2 — every pinned UserInput variant', () => {
  it('covers exactly the 7 generated variants', () => {
    expect(Object.keys(VALID).sort()).toEqual([...CODEX_USER_INPUT_TYPES].sort());
    expect(Object.keys(GOVAI_CODEX_USER_INPUT_KEYS).sort()).toEqual([...CODEX_USER_INPUT_TYPES].sort());
  });

  for (const type of CODEX_USER_INPUT_TYPES) {
    describe(type, () => {
      const valid = VALID[type];
      const required = GOVAI_CODEX_USER_INPUT_KEYS[type].filter((k) => k !== 'type' && k !== 'detail');

      it('valid → accepted, rebuilt in generated key order', () => {
        const owned = turn([valid]).input[0];
        expect(owned).toEqual(valid);
        expect(owned).not.toBe(valid);
        expect(Object.keys(owned ?? {})).toEqual(GOVAI_CODEX_USER_INPUT_KEYS[type].filter((k) => k in valid));
      });

      it('each required property missing (absent or undefined) → required_field_missing', () => {
        for (const key of required) {
          const rest = Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
          expect(refused([rest])).toMatchObject({ rule: 'required_field_missing', field: `input[0].${key}` });
          expect(refused([{ ...valid, [key]: undefined }])).toMatchObject({ rule: 'required_field_missing', field: `input[0].${key}` });
        }
      });

      it('wrong runtime type → invalid_field_value', () => {
        for (const key of required) {
          for (const bad of [42, true, null, {}]) {
            expect(refused([{ ...valid, [key]: bad }]), `${key}=${JSON.stringify(bad)}`).toMatchObject({
              rule: 'invalid_field_value',
              field: `input[0].${key}`,
            });
          }
        }
      });

      it('empty content strings are ACCEPTED and preserved', () => {
        for (const key of CONTENT_STRINGS[type]) {
          expect(turn([{ ...valid, [key]: '' }]).input[0]).toEqual({ ...valid, [key]: '' });
        }
      });

      it('an unknown key → unexpected_input_key, whatever its value', () => {
        for (const value of ['x', null, undefined, 0, {}]) {
          expect(refused([{ ...valid, extra: value }])).toMatchObject({ rule: 'unexpected_input_key', field: 'input[0].extra' });
        }
        if (type !== 'image' && type !== 'localImage') {
          expect(refused([{ ...valid, detail: 'low' }])).toMatchObject({ rule: 'unexpected_input_key', field: 'input[0].detail' });
        }
      });

      if (type === 'image' || type === 'localImage') {
        it('detail: optional, one of the generated ImageDetail values; a bad literal or null is refused', () => {
          for (const detail of GOVAI_CODEX_IMAGE_DETAILS) {
            const owned = turn([{ ...valid, detail }]).input[0];
            expect(owned).toEqual({ ...valid, detail });
            expect(Object.keys(owned ?? {})).toEqual(['type', 'detail', type === 'image' ? 'url' : 'path']);
          }
          for (const bad of ['ultra', null, 1, '']) {
            expect(refused([{ ...valid, detail: bad }])).toMatchObject({ rule: 'invalid_field_value', field: 'input[0].detail' });
          }
          expect(turn([{ ...valid, detail: undefined }]).input[0]).toEqual(valid);
        });
      }
    });
  }

  it('input itself: a non-empty array of records with a generated discriminant', () => {
    for (const bad of [undefined, null, [], 'x', { 0: VALID.text }]) {
      expect(refused(bad)).toMatchObject({ rule: 'required_field_missing', field: 'input' });
    }
    for (const bad of [null, 'x', 1, [VALID.text]]) {
      expect(refused([bad])).toMatchObject({ rule: 'invalid_field_value', field: 'input[0]' });
    }
    for (const bad of [{}, { type: 'hologram' }, { type: 7 }, { type: null }]) {
      expect(refused([bad])).toMatchObject({ rule: 'invalid_field_value', field: 'input[0].type' });
    }
  });
});

describe('R2 — text_elements, byteRange and placeholder', () => {
  const el = (start: unknown, end: unknown, placeholder: unknown = null) => ({ byteRange: { start, end }, placeholder });
  const text = (value: string, elements: unknown) => [{ type: 'text', text: value, text_elements: elements }];

  it('text_elements: a required array (may be empty) of records with exactly {byteRange, placeholder}', () => {
    expect(turn(text('x', [])).input).toEqual(text('x', []));
    expect(refused([{ type: 'text', text: 'x' }])).toMatchObject({ rule: 'required_field_missing', field: 'input[0].text_elements' });
    for (const bad of [null, {}, 'x', 1]) {
      expect(refused(text('x', bad))).toMatchObject({ rule: 'invalid_field_value', field: 'input[0].text_elements' });
    }
    for (const bad of [null, 'x', 1, []]) {
      expect(refused(text('x', [bad]))).toMatchObject({ rule: 'invalid_field_value', field: 'input[0].text_elements[0]' });
    }
    expect(refused(text('x', [{ ...el(0, 1), extra: 1 }]))).toMatchObject({
      rule: 'unexpected_input_key',
      field: 'input[0].text_elements[0].extra',
    });
    expect(refused(text('x', [{ byteRange: { start: 0, end: 1, extra: 1 }, placeholder: null }]))).toMatchObject({
      rule: 'unexpected_input_key',
      field: 'input[0].text_elements[0].byteRange.extra',
    });
  });

  it('byteRange: required, safe integers, 0 ≤ start ≤ end ≤ the UTF-8 byte length of the same text', () => {
    const at = 'input[0].text_elements[0].byteRange';
    expect(refused(text('abc', [{ placeholder: null }]))).toMatchObject({ rule: 'required_field_missing', field: at });
    for (const bad of [null, 'x', [0, 1]]) {
      expect(refused(text('abc', [{ byteRange: bad, placeholder: null }]))).toMatchObject({ rule: 'invalid_field_value', field: at });
    }
    expect(refused(text('abc', [{ byteRange: { end: 1 }, placeholder: null }]))).toMatchObject({
      rule: 'required_field_missing',
      field: `${at}.start`,
    });
    expect(refused(text('abc', [{ byteRange: { start: 0 }, placeholder: null }]))).toMatchObject({
      rule: 'required_field_missing',
      field: `${at}.end`,
    });
    for (const bad of [1.5, -1, '1', null, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
      expect(refused(text('abc', [el(bad, 2)])), String(bad)).toMatchObject({ rule: 'invalid_field_value', field: `${at}.start` });
      expect(refused(text('abc', [el(0, bad)])), String(bad)).toMatchObject({ rule: 'invalid_field_value', field: `${at}.end` });
    }
    expect(refused(text('abc', [el(2, 1)]))).toMatchObject({ rule: 'invalid_field_value', field: at });
    expect(refused(text('abc', [el(0, 4)]))).toMatchObject({ rule: 'invalid_field_value', field: `${at}.end` });
    expect(refused(text('abc', [el(4, 4)]))).toMatchObject({ rule: 'invalid_field_value', field: `${at}.start` });
    expect(turn(text('abc', [el(0, 3), el(3, 3)])).input).toEqual(text('abc', [el(0, 3), el(3, 3)]));
  });

  it('both offsets must sit on UTF-8 character boundaries of the parent text', () => {
    // 'héllo' = 68 c3a9 6c 6c 6f (6 bytes); offset 2 is inside 'é'. '👍' is 4 bytes.
    expect(Buffer.byteLength('héllo', 'utf8')).toBe(6);
    const at = 'input[0].text_elements[0].byteRange';
    expect(refused(text('héllo', [el(2, 3)]))).toMatchObject({ rule: 'invalid_field_value', field: `${at}.start` });
    expect(refused(text('héllo', [el(0, 2)]))).toMatchObject({ rule: 'invalid_field_value', field: `${at}.end` });
    expect(turn(text('héllo', [el(1, 3), el(0, 6), el(6, 6)])).input).toEqual(text('héllo', [el(1, 3), el(0, 6), el(6, 6)]));
    for (const inside of [1, 2, 3]) {
      expect(refused(text('👍', [el(inside, 4)]))).toMatchObject({ rule: 'invalid_field_value', field: `${at}.start` });
    }
    expect(turn(text('👍', [el(0, 4)])).input).toEqual(text('👍', [el(0, 4)]));
  });

  it("with text '' only {start: 0, end: 0} is a valid range", () => {
    expect(turn(text('', [el(0, 0)])).input).toEqual(text('', [el(0, 0)]));
    expect(refused(text('', [el(0, 1)]))).toMatchObject({ rule: 'invalid_field_value' });
    expect(refused(text('', [el(1, 1)]))).toMatchObject({ rule: 'invalid_field_value' });
  });

  it('adds no ordering, overlap or span semantics between elements', () => {
    const elements = [el(3, 5), el(0, 4), el(0, 4), el(2, 2)];
    expect(turn(text('abcdef', elements)).input).toEqual(text('abcdef', elements));
  });

  it("placeholder: key required, value string | null; '' and null are ACCEPTED and preserved", () => {
    const at = 'input[0].text_elements[0].placeholder';
    for (const placeholder of ['', null, 'label']) {
      expect(turn(text('ab', [el(0, 1, placeholder)])).input).toEqual(text('ab', [el(0, 1, placeholder)]));
    }
    expect(refused(text('ab', [{ byteRange: { start: 0, end: 1 } }]))).toMatchObject({ rule: 'required_field_missing', field: at });
    expect(refused(text('ab', [{ byteRange: { start: 0, end: 1 }, placeholder: undefined }]))).toMatchObject({
      rule: 'required_field_missing',
      field: at,
    });
    for (const bad of [1, true, {}, []]) {
      expect(refused(text('ab', [el(0, 1, bad)]))).toMatchObject({ rule: 'invalid_field_value', field: at });
    }
  });
});

describe('R2 — ownership: reconstruct, detach, deep-freeze, read once', () => {
  it('rebuilds every container, and later caller mutation cannot change the owned result', () => {
    const element = { byteRange: { start: 0, end: 1 }, placeholder: 'p' as string | null };
    const elements = [element];
    const item = { type: 'text', text: 'ab', text_elements: elements };
    const input = [item];
    const owned = turn(input).input;
    const ownedItem = owned[0] as unknown as { text_elements: { byteRange: object }[] };
    expect(owned).not.toBe(input);
    expect(ownedItem).not.toBe(item);
    expect(ownedItem.text_elements).not.toBe(elements);
    expect(ownedItem.text_elements[0]).not.toBe(element);
    expect(ownedItem.text_elements[0]?.byteRange).not.toBe(element.byteRange);
    item.text = 'changed';
    element.byteRange.end = 2;
    element.placeholder = null;
    elements.push({ byteRange: { start: 0, end: 0 }, placeholder: 'x' });
    input.push(item);
    expect(owned).toEqual([{ type: 'text', text: 'ab', text_elements: [{ byteRange: { start: 0, end: 1 }, placeholder: 'p' }] }]);
  });

  it('the owned result is deep-frozen', () => {
    const owned = turn([VALID.text, { ...VALID.image, detail: 'high' }, { type: 'text', text: 'ab', text_elements: [{ byteRange: { start: 0, end: 1 }, placeholder: null }] }]);
    expect(deeplyFrozen(owned)).toBe(true);
    expect(() => {
      (owned.input as unknown as unknown[]).push(VALID.audio);
    }).toThrow();
  });

  it('a getter answering differently on successive reads cannot desynchronize validation from serialization', () => {
    let urlReads = 0;
    const image = {
      type: 'image',
      get url(): unknown {
        urlReads += 1;
        return urlReads === 1 ? 'https://ok.invalid/i.png' : 42;
      },
    };
    expect(JSON.stringify(turn([image]).input)).toBe('[{"type":"image","url":"https://ok.invalid/i.png"}]');
    expect(urlReads).toBe(1);

    let typeReads = 0;
    const audio = {
      get type(): unknown {
        typeReads += 1;
        return typeReads === 1 ? 'audio' : 'image';
      },
      url: 'u',
    };
    expect(turn([audio]).input).toEqual([{ type: 'audio', url: 'u' }]);
    expect(typeReads).toBe(1);

    let rangeReads = 0;
    const range = {
      start: 0,
      get end(): unknown {
        rangeReads += 1;
        return rangeReads === 1 ? 1 : 99;
      },
    };
    const owned = turn([{ type: 'text', text: 'ab', text_elements: [{ byteRange: range, placeholder: null }] }]);
    expect(JSON.stringify(owned.input)).toBe('[{"type":"text","text":"ab","text_elements":[{"byteRange":{"start":0,"end":1},"placeholder":null}]}]');
    expect(rangeReads).toBe(1);
  });

  it('violations name the precise field path; the helper reports through the callback it is given', () => {
    const bad = { ...VALID.text, text_elements: [{ byteRange: { start: -1, end: 0 }, placeholder: null }] };
    expect(refused([VALID.text, VALID.image, bad])).toMatchObject({
      method: 'turn/start',
      rule: 'invalid_field_value',
      field: 'input[2].text_elements[0].byteRange.start',
    });
    const seen: string[] = [];
    expect(() =>
      ownGovAICodexUserInputs([{ type: 'audio' }], (rule, path) => {
        seen.push(`${rule} ${path}`);
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(seen).toEqual(['required_field_missing input[0].url']);
  });

  it('turn/steer owns its input through the same rules', () => {
    const steer = (input: unknown) => enforceGovAICodexOutboundPolicy('turn/steer', { threadId: 't', input, expectedTurnId: 'u' });
    expect(steer([{ type: 'mention', name: '', path: '' }]).input).toEqual([{ type: 'mention', name: '', path: '' }]);
    expect(refusal(() => steer([{ ...VALID.skill, extra: true }]))).toMatchObject({
      method: 'turn/steer',
      rule: 'unexpected_input_key',
      field: 'input[0].extra',
    });
  });
});
