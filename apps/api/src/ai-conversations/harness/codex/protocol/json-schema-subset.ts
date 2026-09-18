// CONT-P5-A — minimal JSON-Schema (draft-07 subset) validator for the vendored pinned schema.
//
// Scope is exactly what schemars 0.8.22 emits in ../pin/vendor/json/*.json: local `$ref` (JSON pointer into the
// same document), `type` (string or array), `enum`, `const`, `properties`, `required`, `additionalProperties`,
// `items`, `anyOf`, `oneOf` (exactly one), `allOf`, `minimum`/`maximum`, `minLength`/`maxLength`; `format`,
// `title`, `description`, `default` and `$schema` are annotations. Any OTHER keyword makes validation fail loudly
// (`unsupported keyword`) instead of silently passing — a subset validator must never over-accept.
// No dependency is added: the repository's package manifests are outside this movement's scope.

export type JsonSchemaNode = boolean | { readonly [keyword: string]: unknown };

const ANNOTATIONS = new Set(['$schema', 'title', 'description', 'default', 'format', 'examples', 'definitions']);
const SUPPORTED = new Set([
  '$ref',
  'type',
  'enum',
  'const',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
  'oneOf',
  'allOf',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string[] {
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array'];
  if (typeof value === 'number') return Number.isInteger(value) ? ['integer', 'number'] : ['number'];
  if (typeof value === 'object') return ['object'];
  return [typeof value];
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Resolve a local `#/a/b` pointer inside `root`. */
export function resolvePointer(root: unknown, ref: string): JsonSchemaNode {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref (not local): ${ref}`);
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isRecord(node) || !Object.hasOwn(node, key)) throw new Error(`unresolvable $ref: ${ref}`);
    node = node[key];
  }
  if (typeof node !== 'boolean' && !isRecord(node)) throw new Error(`$ref target is not a schema: ${ref}`);
  return node as JsonSchemaNode;
}

/** Validation errors of `value` against `schema` (resolved within `root`); empty means valid. */
export function validateAgainstSchema(root: unknown, schema: JsonSchemaNode, value: unknown, path = '$'): string[] {
  if (schema === true) return [];
  if (schema === false) return [`${path}: schema is false`];
  const errors: string[] = [];
  for (const keyword of Object.keys(schema)) {
    if (!ANNOTATIONS.has(keyword) && !SUPPORTED.has(keyword)) errors.push(`${path}: unsupported keyword ${keyword}`);
  }
  if (errors.length > 0) return errors;

  if (typeof schema['$ref'] === 'string') {
    errors.push(...validateAgainstSchema(root, resolvePointer(root, schema['$ref']), value, path));
  }
  if (schema['type'] !== undefined) {
    const allowed = Array.isArray(schema['type']) ? (schema['type'] as string[]) : [schema['type'] as string];
    if (!typeOf(value).some((t) => allowed.includes(t))) errors.push(`${path}: type ${typeOf(value)[0]} not in ${allowed.join('|')}`);
  }
  if (Array.isArray(schema['enum']) && !schema['enum'].some((v) => deepEqual(v, value))) {
    errors.push(`${path}: not in enum`);
  }
  if (Object.hasOwn(schema, 'const') && !deepEqual(schema['const'], value)) errors.push(`${path}: const mismatch`);
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) errors.push(`${path}: below minimum`);
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) errors.push(`${path}: above maximum`);
  }
  if (typeof value === 'string') {
    const length = [...value].length;
    if (typeof schema['minLength'] === 'number' && length < schema['minLength']) errors.push(`${path}: shorter than minLength`);
    if (typeof schema['maxLength'] === 'number' && length > schema['maxLength']) errors.push(`${path}: longer than maxLength`);
  }
  if (isRecord(value)) {
    const properties = isRecord(schema['properties']) ? schema['properties'] : {};
    if (Array.isArray(schema['required'])) {
      for (const key of schema['required'] as string[]) {
        if (!Object.hasOwn(value, key)) errors.push(`${path}: missing required ${key}`);
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(properties, key)) {
        errors.push(...validateAgainstSchema(root, properties[key] as JsonSchemaNode, child, `${path}.${key}`));
      } else if (schema['additionalProperties'] === false) {
        errors.push(`${path}: additional property ${key}`);
      } else if (isRecord(schema['additionalProperties']) || typeof schema['additionalProperties'] === 'boolean') {
        errors.push(
          ...validateAgainstSchema(root, schema['additionalProperties'] as JsonSchemaNode, child, `${path}.${key}`),
        );
      }
    }
  }
  if (Array.isArray(value) && schema['items'] !== undefined) {
    value.forEach((item, i) => errors.push(...validateAgainstSchema(root, schema['items'] as JsonSchemaNode, item, `${path}[${i}]`)));
  }
  if (Array.isArray(schema['allOf'])) {
    for (const sub of schema['allOf'] as JsonSchemaNode[]) errors.push(...validateAgainstSchema(root, sub, value, path));
  }
  if (Array.isArray(schema['anyOf'])) {
    const ok = (schema['anyOf'] as JsonSchemaNode[]).some((sub) => validateAgainstSchema(root, sub, value, path).length === 0);
    if (!ok) errors.push(`${path}: no anyOf branch matched`);
  }
  if (Array.isArray(schema['oneOf'])) {
    const matches = (schema['oneOf'] as JsonSchemaNode[]).filter(
      (sub) => validateAgainstSchema(root, sub, value, path).length === 0,
    ).length;
    if (matches !== 1) errors.push(`${path}: ${matches} oneOf branches matched (exactly 1 required)`);
  }
  return errors;
}
