// Pagination adapters — one per pagination style the GovAI API actually uses.
//
// The two styles U1 consumes are genuinely different contracts, and the difference is not
// cosmetic: getting either wrong silently truncates evidence.
//
//   OFFSET  (GET /v1/evidence/gaps)  the SERVER returns `next_cursor`: `cursor + limit` while
//                                    a page came back full, null otherwise. The ec3drop
//                                    singleton always returns null, so it can never loop.
//   KEYSET  (GET /v1/audit-events)   the server returns NO cursor. Rows are ordered by
//                                    sequence_number DESC and `before_seq` is a strict `<`,
//                                    so the next page starts from the LAST row of this page.
//                                    The list ends when a page is shorter than `limit`.
//
// The composite-cursor style ({before_created_at, before_id}) used by the workroom and
// regulatory surfaces is NOT implemented — those screens are out of U1 scope. The adapter
// interface is shaped to accept it later without touching any consumer.

/**
 * @typeParam TParam - the type of the page parameter (an offset, a sequence bound, …)
 * @typeParam TPage  - the shape the endpoint returns for one page
 */
export type PaginationAdapter<TParam, TPage> = {
  /** The parameter for the first page. */
  readonly initialParam: TParam;
  /** The parameter for the next page, or null when the list is exhausted. */
  getNextParam(page: TPage, currentParam: TParam): TParam | null;
};

// --- offset (evidence gaps) --------------------------------------------------------------

export type OffsetPage = { next_cursor: number | null };

/**
 * Trusts the server's own `next_cursor` rather than recomputing it. Recomputing would
 * reproduce the server's rule in a second place and silently diverge if it ever changed — and
 * it would break the ec3drop singleton, whose next_cursor is null even though its single item
 * is not a "full page" by any client-side rule.
 */
export const offsetAdapter: PaginationAdapter<number, OffsetPage> = {
  initialParam: 0,
  getNextParam: (page) => page.next_cursor,
};

// --- keyset (audit events) ---------------------------------------------------------------

export type KeysetPage = { events: ReadonlyArray<{ sequence_number: number }> };

/**
 * Derives `before_seq` from the last row of the page, because the API returns no cursor.
 * The page is ordered DESC, so the last row carries the smallest sequence_number loaded so
 * far and `before_seq` is exclusive.
 *
 * End of list = a page shorter than `limit`. A page that is exactly `limit` long and happens
 * to be the last one costs one extra empty request; the alternative — stopping early — would
 * silently hide events, which is the failure mode that matters here.
 */
export function keysetAdapter(limit: number): PaginationAdapter<number | undefined, KeysetPage> {
  return {
    initialParam: undefined,
    getNextParam: (page) => {
      if (page.events.length < limit) return null;
      const last = page.events[page.events.length - 1];
      if (!last) return null;
      return last.sequence_number;
    },
  };
}
