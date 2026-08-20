import { describe, expect, it } from 'vitest';
import { CATALOGS, type MessageKey } from '../../lib/i18n/catalogs/index.js';
import { LOCALES } from '../../lib/i18n/locales.js';

// ★★ A TRANSLATION MAY WEAKEN A CLAIM AND MAY NEVER STRENGTHEN ONE.
//
// The existing i18n suite enforces that rule for the enforcement vocabulary and the identity
// copy. This file extends it to the AI Console's own strings, concept by concept, because the
// console is where a reader forms their belief about what GovAI actually did to a request —
// and a Spanish reader must not come away believing something a Portuguese reader would not.
//
// Every group below is a CONCEPT, checked in all three languages: what must be said, and what
// must never be said.

type Locale = (typeof LOCALES)[number];

function text(locale: Locale, key: MessageKey): string {
  return CATALOGS[locale][key];
}

/** Every AI Console key. */
function aiKeys(): MessageKey[] {
  return (Object.keys(CATALOGS['pt-BR']) as MessageKey[]).filter((k) => k.startsWith('ai.'));
}

describe('the console copy exists in all three languages', () => {
  it.each(LOCALES)('%s defines every ai.* key, non-empty', (locale) => {
    const missing = aiKeys().filter((k) => text(locale, k).trim().length === 0);
    expect(missing).toEqual([]);
  });

  it('adds a meaningful number of keys — the console is not half-translated', () => {
    expect(aiKeys().length).toBeGreaterThan(60);
  });

  it.each(LOCALES)('%s keeps the product name untranslated', (locale) => {
    expect(text(locale, 'ai.title')).toBe('AI Console');
    expect(text(locale, 'app.nav.ai')).toBe('AI Console');
  });
});

// ── Concept: an unconfirmed outcome is neither a failure nor a success ─────────────────────

describe('★ "outcome not confirmed" stays unconfirmed', () => {
  const REQUIRED: Record<Locale, RegExp> = {
    'pt-BR': /não confirmad/i,
    'en-US': /not confirmed/i,
    es: /no confirmad/i,
  };
  /** Words that would turn an unknown outcome into a known one, either way. */
  const FORBIDDEN: Record<Locale, RegExp[]> = {
    'pt-BR': [/\bfalhou\b/i, /\bconcluíd/i, /\bcompletad/i, /não executad/i, /não foi executad/i],
    'en-US': [/\bfailed\b/i, /\bcompleted\b/i, /\bdid not run\b/i, /was not executed/i],
    es: [/\bfalló\b/i, /\bcompletad/i, /no se ejecutó/i, /no fue ejecutad/i],
  };

  it.each(LOCALES)('%s: both unconfirmed states say so', (locale) => {
    for (const key of ['ai.state.networkError', 'ai.state.unknownOutcome'] as MessageKey[]) {
      expect(text(locale, key), `${locale} ${key}`).toMatch(REQUIRED[locale]);
    }
  });

  it.each(LOCALES)('%s: their notes never resolve the ambiguity in either direction', (locale) => {
    for (const key of [
      'ai.state.networkError.note',
      'ai.state.unknownOutcome.note',
    ] as MessageKey[]) {
      const value = text(locale, key);
      for (const forbidden of FORBIDDEN[locale]) {
        expect(forbidden.test(value), `${locale} ${key} must not match ${forbidden}: "${value}"`).toBe(
          false,
        );
      }
    }
  });
});

// ── Concept: forwarded vs applied ──────────────────────────────────────────────────────────

describe('★ "forwarded" never becomes "blocked" or "applied"', () => {
  const FORWARDED: Record<Locale, RegExp> = {
    'pt-BR': /encaminhad/i,
    'en-US': /forward/i,
    es: /reenviad/i,
  };
  const BLOCK_WORDS: Record<Locale, RegExp[]> = {
    'pt-BR': [/bloquead/i, /impedid/i, /retid/i, /protegid/i],
    'en-US': [/blocked/i, /prevented/i, /withheld/i, /protected/i],
    es: [/bloquead/i, /impedid/i, /retenid/i, /protegid/i],
  };

  it.each(LOCALES)('%s: the applied-forwarded label says forwarded and nothing stronger', (locale) => {
    const value = text(locale, 'ai.receipt.applied.forwarded');
    expect(value).toMatch(FORWARDED[locale]);
    for (const forbidden of BLOCK_WORDS[locale]) {
      expect(forbidden.test(value), `${locale}: "${value}"`).toBe(false);
    }
  });

  it.each(LOCALES)('%s: only the applied-blocked label mentions a block, with its 403', (locale) => {
    const blocked = text(locale, 'ai.receipt.applied.blocked');
    expect(blocked).toMatch(BLOCK_WORDS[locale][0] as RegExp);
    expect(blocked).toContain('403');
  });

  it.each(LOCALES)('%s: the explainer separates the recommendation from the effect', (locale) => {
    const value = text(locale, 'ai.receipt.recommendationVsApplied');
    // It must state BOTH that the request reached the provider AND that nobody was asked and
    // no sandbox was created — the two readings the vocabulary most invites.
    expect(value).toMatch(FORWARDED[locale]);
    const negations: Record<Locale, RegExp[]> = {
      'pt-BR': [/ninguém foi consultado/i, /nenhum sandbox foi criado/i],
      'en-US': [/nobody was asked/i, /no sandbox was created/i],
      es: [/no se consultó a nadie/i, /no se creó ningún sandbox/i],
    };
    for (const required of negations[locale]) {
      expect(required.test(value), `${locale} must state: ${required}`).toBe(true);
    }
  });
});

// ── Concept: a block claim requires a 403 ──────────────────────────────────────────────────

describe('★ "blocked" appears only where a 403 actually happened', () => {
  it.each(LOCALES)('%s: the blocked state names the 403 and the pre-provider fact', (locale) => {
    expect(text(locale, 'ai.state.blocked')).toContain('403');
    const note = text(locale, 'ai.state.blocked.note');
    expect(note).toContain('403');
    // It says GovAI did not call the provider — the one claim the source proves.
    const required: Record<Locale, RegExp> = {
      'pt-BR': /não chamou o provedor/i,
      'en-US': /did not call the provider/i,
      es: /no llamó al proveedor/i,
    };
    expect(note).toMatch(required[locale]);
  });
});

// ── Concept: stopped by the reader, not by the provider ────────────────────────────────────

describe('★ "stopped" is attributed to this browser, not to the provider', () => {
  it.each(LOCALES)('%s: the note says the browser cancelled, and claims nothing further', (locale) => {
    const note = text(locale, 'ai.state.stopped.note');
    const required: Record<Locale, RegExp> = {
      'pt-BR': /navegador cancelou/i,
      'en-US': /browser cancelled|browser canceled/i,
      es: /navegador canceló/i,
    };
    expect(note).toMatch(required[locale]);
    const forbidden: Record<Locale, RegExp[]> = {
      'pt-BR': [/provedor cancelou/i, /geração interrompida com sucesso/i],
      'en-US': [/provider cancelled|provider canceled/i, /successfully cancelled/i],
      es: [/proveedor canceló/i, /cancelado con éxito/i],
    };
    for (const pattern of forbidden[locale]) {
      expect(pattern.test(note), `${locale}: "${note}"`).toBe(false);
    }
  });
});

// ── Concept: not persisted, without overclaiming about the provider ────────────────────────

describe('★ "not persisted" is scoped to the GovAI UI', () => {
  it.each(LOCALES)('%s: names the provider/account configuration as still governing', (locale) => {
    const value = text(locale, 'ai.memoryOnly');
    const required: Record<Locale, RegExp> = {
      'pt-BR': /configuração do provedor e da conta/i,
      'en-US': /provider and account configuration/i,
      es: /configuración del proveedor y de la cuenta/i,
    };
    expect(value).toMatch(required[locale]);
  });

  it.each(LOCALES)('%s: never claims nothing is retained anywhere', (locale) => {
    const forbidden: Record<Locale, RegExp[]> = {
      'pt-BR': [/nada é retido/i, /nada fica guardado/i, /nada é armazenado em lugar nenhum/i],
      'en-US': [/nothing is retained anywhere/i, /nothing is stored anywhere/i],
      es: [/nada se retiene en ningún/i, /nada se almacena en ningún/i],
    };
    for (const pattern of forbidden[locale]) {
      expect(pattern.test(text(locale, 'ai.memoryOnly')), String(pattern)).toBe(false);
    }
  });
});

// ── Concept: retry is a NEW provider call ──────────────────────────────────────────────────

describe('★ retry is labelled as a new provider call, in every language', () => {
  it.each(LOCALES)('%s: the label names the provider call', (locale) => {
    const required: Record<Locale, RegExp> = {
      'pt-BR': /chamada ao provedor/i,
      'en-US': /provider call/i,
      es: /llamada al proveedor/i,
    };
    expect(text(locale, 'ai.retry')).toMatch(required[locale]);
  });

  it.each(LOCALES)('%s: the note warns it may be billed again and denies auto-retry', (locale) => {
    const note = text(locale, 'ai.retry.note');
    const billing: Record<Locale, RegExp> = {
      'pt-BR': /cobrad/i,
      'en-US': /billed/i,
      es: /facturars/i,
    };
    const never: Record<Locale, RegExp> = {
      'pt-BR': /nunca repete/i,
      'en-US': /never repeats/i,
      es: /nunca repite/i,
    };
    expect(note).toMatch(billing[locale]);
    expect(note).toMatch(never[locale]);
  });
});

// ── Concept: the correlation limit ─────────────────────────────────────────────────────────

describe('★ the audit-correlation limit is stated, not softened', () => {
  it.each(LOCALES)('%s: says the API does not expose it and that nothing is estimated', (locale) => {
    const value = text(locale, 'ai.receipt.correlationCaveat');
    const required: Record<Locale, RegExp[]> = {
      'pt-BR': [/não é exposta pela API atual/i, /não a estima/i],
      'en-US': [/not exposed by the current API/i, /does not estimate it/i],
      es: [/no la expone la API actual/i, /no la estima/i],
    };
    for (const pattern of required[locale]) {
      expect(pattern.test(value), `${locale} must state ${pattern}: "${value}"`).toBe(true);
    }
  });
});

// ── Concept: the native surface exposes no governance ──────────────────────────────────────

describe('★ the native-surface note denies a per-request decision rather than implying one', () => {
  it.each(LOCALES)('%s: says the surface resolves and returns none, and infers nothing', (locale) => {
    const value = text(locale, 'ai.receipt.governance.nativeSurface');
    const required: Record<Locale, RegExp[]> = {
      'pt-BR': [/não resolve decisão de governança/i, /Nada é deduzido/i],
      'en-US': [/resolves no per-request governance decision/i, /Nothing is inferred/i],
      es: [/no resuelve ninguna decisión de gobernanza/i, /no se deduce nada/i],
    };
    for (const pattern of required[locale]) {
      expect(pattern.test(value), `${locale} must state ${pattern}: "${value}"`).toBe(true);
    }
  });
});

// ── Concept: the model listing is not a compatibility guarantee ────────────────────────────

describe('★ the model hint denies that listing implies endpoint support', () => {
  it.each(LOCALES)('%s: says membership does not guarantee support', (locale) => {
    const required: Record<Locale, RegExp> = {
      'pt-BR': /não garante suporte/i,
      'en-US': /does not guarantee support/i,
      es: /no garantiza soporte/i,
    };
    expect(text(locale, 'ai.model.hint')).toMatch(required[locale]);
  });
});

// ── Concept: no evidence claim anywhere in the console ─────────────────────────────────────

describe('★ NO console string claims evidence was captured, sealed or certified', () => {
  const FORBIDDEN: Record<Locale, RegExp[]> = {
    'pt-BR': [/evidência capturad/i, /selad/i, /certificad/i, /comprovad/i],
    'en-US': [/evidence captured/i, /\bsealed\b/i, /\bcertified\b/i, /\bproven\b/i],
    es: [/evidencia capturad/i, /sellad/i, /certificad/i, /comprobad/i],
  };

  it.each(LOCALES)('%s: no ai.* string makes an evidence claim', (locale) => {
    for (const key of aiKeys()) {
      const value = text(locale, key);
      for (const pattern of FORBIDDEN[locale]) {
        expect(pattern.test(value), `${locale} ${key} must not match ${pattern}: "${value}"`).toBe(
          false,
        );
      }
    }
  });

  it.each(LOCALES)('%s: the receipt is called a receipt, never a proof or a certificate', (locale) => {
    const title = text(locale, 'ai.receipt.title');
    const forbidden: Record<Locale, RegExp[]> = {
      'pt-BR': [/prova/i, /certificad/i, /forense/i, /conformidade/i],
      'en-US': [/proof/i, /certificate/i, /forensic/i, /compliance/i],
      es: [/prueba/i, /certificad/i, /forense/i, /cumplimiento/i],
    };
    for (const pattern of forbidden[locale]) {
      expect(pattern.test(title), `${locale}: "${title}"`).toBe(false);
    }
  });
});

// ── Concept: the duration is client-observed ───────────────────────────────────────────────

describe('★ the duration label names the observer', () => {
  it.each(LOCALES)('%s: says the browser observed it, not the provider or the backend', (locale) => {
    const value = text(locale, 'ai.receipt.duration');
    const required: Record<Locale, RegExp> = {
      'pt-BR': /navegador/i,
      'en-US': /client-observed/i,
      es: /navegador/i,
    };
    expect(value).toMatch(required[locale]);
    for (const forbidden of [/provedor|provider|proveedor/i, /backend/i, /GovAI/]) {
      expect(forbidden.test(value), `${locale} duration must not name ${forbidden}`).toBe(false);
    }
  });
});

// ── Concept: the non-goals are stated, not implied ─────────────────────────────────────────

describe('the scope note names what the console does not do', () => {
  it.each(LOCALES)('%s: names tools, files and agents as out of scope', (locale) => {
    const value = text(locale, 'ai.scopeNote').toLowerCase();
    for (const term of ['agent', 'arquiv|file|archiv', 'ferramenta|tool|herramienta']) {
      expect(new RegExp(term).test(value), `${locale} scope note must mention ${term}`).toBe(true);
    }
  });
});
