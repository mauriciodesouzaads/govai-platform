// CONT-P5-A — OWNED UserInput for the GovAI outbound policy (remediation R2; dispatch §2 protocol/, GOVAI POLICY).
//
// VALIDATE → RECONSTRUCT → DETACH FROM CALLER → OWN SAFE VALUE. Every `UserInput` a GovAI request carries is rebuilt
// here, key by key, against the pinned generated union (./generated/v2/UserInput.ts, v2/TextElement.ts,
// v2/ByteRange.ts, ImageDetail.ts):
//   text{type,text,text_elements} · image{type,url,detail?} · localImage{type,path,detail?} · audio{type,url} ·
//   localAudio{type,path} · skill{type,name,path} · mention{type,name,path}
// ★ EXACT KEYS AT EVERY DEPTH. GovAI policy; upstream `additionalProperties` is not relied on. An unknown key is
//   `unexpected_input_key`, whatever its value.
// ★ CONTENT STRINGS (`text`, `url`, `path`, `name`): the property must exist and be a string. The empty string is
//   ALLOWED; no further content semantics are invented here.
// ★ `text_elements`: a required array (may be empty) of `{byteRange, placeholder}`. `placeholder`: key required,
//   value `string | null` ('' allowed). `byteRange` = `{start, end}`: safe integers, 0 ≤ start ≤ end ≤ the UTF-8
//   byte length of the SAME parent `text`, both offsets on UTF-8 character boundaries. No ordering, overlap or
//   span semantics are added.
// ★ SINGLE READ. Each source property is read exactly once; that value is the one validated and the one placed in
//   the output, so a getter cannot make the serialized value differ from the validated one.
// ★ OWNED OUTPUT. Fresh containers in generated key order holding primitives (and `null` for a null placeholder);
//   nothing of the caller is reachable from the result. The policy primitive deep-freezes it.
// ★ OPEN — NOT decided here, left to the first movement that feeds real content: URL scheme policy · local path
//   confinement · content size policy · semantic text policy.

import type { ImageDetail } from './generated/ImageDetail';
import type { ByteRange } from './generated/v2/ByteRange';
import type { TextElement } from './generated/v2/TextElement';
import type { UserInput } from './generated/v2/UserInput';
import { CODEX_USER_INPUT_TYPES } from './method-names.js';

type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
type VariantKeys<T extends UserInput['type']> = keyof Extract<UserInput, { type: T }>;

export const GOVAI_CODEX_IMAGE_DETAILS = ['auto', 'low', 'high', 'original'] as const;

/** Exact key set of each variant, in generated key order (`detail` is the only optional key). */
export const GOVAI_CODEX_USER_INPUT_KEYS = Object.freeze({
  text: ['type', 'text', 'text_elements'],
  image: ['type', 'detail', 'url'],
  localImage: ['type', 'detail', 'path'],
  audio: ['type', 'url'],
  localAudio: ['type', 'path'],
  skill: ['type', 'name', 'path'],
  mention: ['type', 'name', 'path'],
} as const satisfies Record<UserInput['type'], readonly string[]>);

// Every runtime list is the generated union, checked both ways at compile time (an upstream change breaks the build).
export const GOVAI_CODEX_USER_INPUT_SETS_ARE_GENERATED: [
  Exactly<(typeof GOVAI_CODEX_IMAGE_DETAILS)[number], ImageDetail>,
  Exactly<(typeof GOVAI_CODEX_USER_INPUT_KEYS.text)[number], VariantKeys<'text'>>,
  Exactly<(typeof GOVAI_CODEX_USER_INPUT_KEYS.image)[number], VariantKeys<'image'>>,
  Exactly<(typeof GOVAI_CODEX_USER_INPUT_KEYS.localImage)[number], VariantKeys<'localImage'>>,
  Exactly<(typeof GOVAI_CODEX_USER_INPUT_KEYS.audio)[number], VariantKeys<'audio'>>,
  Exactly<(typeof GOVAI_CODEX_USER_INPUT_KEYS.localAudio)[number], VariantKeys<'localAudio'>>,
  Exactly<(typeof GOVAI_CODEX_USER_INPUT_KEYS.skill)[number], VariantKeys<'skill'>>,
  Exactly<(typeof GOVAI_CODEX_USER_INPUT_KEYS.mention)[number], VariantKeys<'mention'>>,
  Exactly<'byteRange' | 'placeholder', keyof TextElement>,
  Exactly<'start' | 'end', keyof ByteRange>,
] = [true, true, true, true, true, true, true, true, true, true];

export type GovAICodexUserInputRule = 'required_field_missing' | 'invalid_field_value' | 'unexpected_input_key';

/** Raises the caller's typed violation for `rule` at the precise field `path` (e.g. `input[2].text`). */
export type GovAICodexUserInputFailure = (rule: GovAICodexUserInputRule, path: string) => never;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUserInputType(value: unknown): value is UserInput['type'] {
  return typeof value === 'string' && (CODEX_USER_INPUT_TYPES as readonly string[]).includes(value);
}

/** Own keys of `value`, refusing any key outside `allowed`. Reads no property value. */
function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  fail: GovAICodexUserInputFailure,
  path: string,
): ReadonlySet<string> {
  const own = Object.keys(value);
  for (const key of own) if (!allowed.includes(key)) return fail('unexpected_input_key', `${path}.${key}`);
  return new Set(own);
}

/** A required content string: present and a string; '' allowed. An own key holding `undefined` is absent. */
function contentString(value: unknown, fail: GovAICodexUserInputFailure, path: string): string {
  if (value === undefined) return fail('required_field_missing', path);
  if (typeof value !== 'string') return fail('invalid_field_value', path);
  return value;
}

function optionalDetail(value: unknown, fail: GovAICodexUserInputFailure, path: string): ImageDetail | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(GOVAI_CODEX_IMAGE_DETAILS as readonly string[]).includes(value)) {
    return fail('invalid_field_value', path);
  }
  return value as ImageDetail;
}

/** One ByteRange offset into the parent text's UTF-8 bytes: safe integer, in range, on a character boundary. */
function byteOffset(value: unknown, bytes: Buffer, fail: GovAICodexUserInputFailure, path: string): number {
  if (value === undefined) return fail('required_field_missing', path);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > bytes.length) {
    return fail('invalid_field_value', path);
  }
  // A UTF-8 continuation byte (10xxxxxx) at the offset means it points inside a multi-byte character.
  if (value < bytes.length && ((bytes[value] ?? 0) & 0xc0) === 0x80) return fail('invalid_field_value', path);
  return value;
}

function ownByteRange(value: unknown, bytes: Buffer, fail: GovAICodexUserInputFailure, path: string): ByteRange {
  if (value === undefined) return fail('required_field_missing', path);
  if (!isRecord(value)) return fail('invalid_field_value', path);
  const keys = exactKeys(value, ['start', 'end'], fail, path);
  const start = byteOffset(keys.has('start') ? value['start'] : undefined, bytes, fail, `${path}.start`);
  const end = byteOffset(keys.has('end') ? value['end'] : undefined, bytes, fail, `${path}.end`);
  if (start > end) return fail('invalid_field_value', path);
  return { start, end };
}

function ownTextElement(value: unknown, bytes: Buffer, fail: GovAICodexUserInputFailure, path: string): TextElement {
  if (!isRecord(value)) return fail('invalid_field_value', path);
  const keys = exactKeys(value, ['byteRange', 'placeholder'], fail, path);
  const byteRange = ownByteRange(keys.has('byteRange') ? value['byteRange'] : undefined, bytes, fail, `${path}.byteRange`);
  const placeholder = keys.has('placeholder') ? value['placeholder'] : undefined;
  if (placeholder === undefined) return fail('required_field_missing', `${path}.placeholder`);
  if (placeholder !== null && typeof placeholder !== 'string') return fail('invalid_field_value', `${path}.placeholder`);
  return { byteRange, placeholder };
}

function ownTextElements(value: unknown, text: string, fail: GovAICodexUserInputFailure, path: string): TextElement[] {
  if (value === undefined) return fail('required_field_missing', path);
  if (!Array.isArray(value)) return fail('invalid_field_value', path);
  const bytes = Buffer.from(text, 'utf8');
  const length = value.length;
  const out: TextElement[] = [];
  for (let j = 0; j < length; j += 1) out.push(ownTextElement(value[j], bytes, fail, `${path}[${j}]`));
  return out;
}

function ownUserInput(item: unknown, fail: GovAICodexUserInputFailure, path: string): UserInput {
  if (!isRecord(item)) return fail('invalid_field_value', path);
  const own = Object.keys(item);
  const type = own.includes('type') ? item['type'] : undefined;
  if (!isUserInputType(type)) return fail('invalid_field_value', `${path}.type`);
  const keys = exactKeys(item, GOVAI_CODEX_USER_INPUT_KEYS[type], fail, path);
  // Each remaining property is read exactly once, here or not at all.
  const read = (key: string): unknown => (keys.has(key) ? item[key] : undefined);
  switch (type) {
    case 'text': {
      const text = contentString(read('text'), fail, `${path}.text`);
      return { type, text, text_elements: ownTextElements(read('text_elements'), text, fail, `${path}.text_elements`) };
    }
    case 'image':
    case 'localImage': {
      const detail = optionalDetail(read('detail'), fail, `${path}.detail`);
      if (type === 'image') {
        const url = contentString(read('url'), fail, `${path}.url`);
        return detail === undefined ? { type, url } : { type, detail, url };
      }
      const localPath = contentString(read('path'), fail, `${path}.path`);
      return detail === undefined ? { type, path: localPath } : { type, detail, path: localPath };
    }
    case 'audio':
      return { type, url: contentString(read('url'), fail, `${path}.url`) };
    case 'localAudio':
      return { type, path: contentString(read('path'), fail, `${path}.path`) };
    case 'skill':
    case 'mention': {
      const name = contentString(read('name'), fail, `${path}.name`);
      return { type, name, path: contentString(read('path'), fail, `${path}.path`) };
    }
  }
}

/**
 * The owned `input` of `turn/start` / `turn/steer`: a non-empty array of UserInput, every item validated and
 * reconstructed. Violations are raised through `fail` with the precise field path.
 */
export function ownGovAICodexUserInputs(value: unknown, fail: GovAICodexUserInputFailure, path = 'input'): UserInput[] {
  if (!Array.isArray(value) || value.length === 0) return fail('required_field_missing', path);
  const length = value.length;
  const out: UserInput[] = [];
  for (let i = 0; i < length; i += 1) out.push(ownUserInput(value[i], fail, `${path}[${i}]`));
  return out;
}
