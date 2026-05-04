/**
 * Canonical JSON serialization — determinístico.
 *
 * Regras:
 *  - chaves de objeto ordenadas lexicograficamente (UTF-16 code units, default JS).
 *  - sem espaços extras.
 *  - números finitos JSON-conformes; NaN/Infinity rejeitados.
 *  - strings escapadas via JSON.stringify (Unicode literal preservado, sem normalização).
 *  - arrays preservam ordem.
 *  - undefined no root ou em array → erro (não serializável).
 *  - undefined em propriedade de objeto → propriedade omitida (paridade com JSON.stringify).
 *  - null permitido em qualquer posição.
 *  - bytes/Date NÃO suportados diretamente — caller deve passar string ISO ou hex.
 */
export function canonicalize(input: unknown): string {
  return stringify(input);
}

function stringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`canonicalize: non-finite number ${value}`);
    }
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    throw new Error('canonicalize: bigint not supported (convert to string explicitly)');
  }
  if (value === undefined) {
    throw new Error('canonicalize: undefined not serializable');
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      parts.push(stringify(item));
    }
    return `[${parts.join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v === undefined) continue;
      parts.push(`${JSON.stringify(k)}:${stringify(v)}`);
    }
    return `{${parts.join(',')}}`;
  }
  throw new Error(`canonicalize: unsupported type ${typeof value}`);
}
