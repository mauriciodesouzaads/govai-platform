// The "export this query" payload builder — pure, so what leaves the browser is testable.
//
// The export is an EVIDENCE SNAPSHOT, not a dossier: it carries exactly the parsed response
// the browser received, plus the context needed to reproduce the same query, and nothing else.
//
// It must NEVER carry:
//   • the API key or any authorization header,
//   • a dump of browser storage,
//   • anything the UI derived, inferred or judged (labels, tones, verdicts).
// The builder has no access to the credential store by construction — it takes only the data
// and the context object below — and a test asserts the serialized output against the whole
// forbidden set.

import type { Locale } from './i18n/locales.js';

export type QueryExportContext = {
  /** The API path this data came from, e.g. `/v1/evidence/summary`. */
  endpoint: string;
  /** The query parameters actually sent. Never a header, never a credential. */
  params: Record<string, string | number | undefined>;
  /** The organization id LEARNED from the authenticated response. */
  orgId: string | null;
  locale: Locale;
  exportedAt: string;
};

export type QueryExport = {
  govai_export: {
    kind: 'query_export';
    /** Says out loud what this is not, inside the artifact itself. */
    disclaimer: string;
    exported_at: string;
    org_id: string | null;
    locale: Locale;
    ui_build_sha: string | null;
    endpoint: string;
    params: Record<string, string | number | undefined>;
  };
  data: unknown;
};

const DISCLAIMER =
  'Query export: the response this browser received for the stated endpoint and parameters, ' +
  'serialized without post-processing. It is not a compliance report, not a certification ' +
  'artifact and not a legal dossier.';

/** The build SHA is a public, non-secret build-time value (see .env.example); null when the
 *  build did not provide one — an explicit absence, never a fabricated value. */
export function uiBuildSha(): string | null {
  const raw = import.meta.env.VITE_GOVAI_BUILD_SHA;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

export function buildQueryExport(context: QueryExportContext, data: unknown): QueryExport {
  return {
    govai_export: {
      kind: 'query_export',
      disclaimer: DISCLAIMER,
      exported_at: context.exportedAt,
      org_id: context.orgId,
      locale: context.locale,
      ui_build_sha: uiBuildSha(),
      endpoint: context.endpoint,
      params: context.params,
    },
    data,
  };
}
