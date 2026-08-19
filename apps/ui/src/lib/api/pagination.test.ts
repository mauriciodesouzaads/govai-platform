import { describe, expect, it } from 'vitest';
import { keysetAdapter, offsetAdapter } from './pagination.js';

describe('offset adapter (GET /v1/evidence/gaps)', () => {
  it('starts at cursor 0, the API default', () => {
    expect(offsetAdapter.initialParam).toBe(0);
  });

  it('follows the server’s own next_cursor rather than recomputing it', () => {
    expect(offsetAdapter.getNextParam({ next_cursor: 100 }, 0)).toBe(100);
    expect(offsetAdapter.getNextParam({ next_cursor: 200 }, 100)).toBe(200);
  });

  it('stops when the server says there is no next page', () => {
    expect(offsetAdapter.getNextParam({ next_cursor: null }, 100)).toBeNull();
  });

  it('never paginates the ec3drop singleton, whose next_cursor is always null', () => {
    // A client-side "was the page full?" rule would loop here forever: the singleton returns
    // one item, which is not a full page, but the API still refuses to advance the cursor.
    expect(offsetAdapter.getNextParam({ next_cursor: null }, 0)).toBeNull();
  });
});

describe('keyset adapter (GET /v1/audit-events)', () => {
  const limit = 3;
  const adapter = keysetAdapter(limit);
  const page = (seqs: number[]) => ({ events: seqs.map((s) => ({ sequence_number: s })) });

  it('starts with no before_seq so the API returns the newest events', () => {
    expect(adapter.initialParam).toBeUndefined();
  });

  it('takes the next before_seq from the LAST row, because the page is descending', () => {
    // before_seq is a strict `<`, so passing the smallest loaded sequence advances correctly
    // and cannot repeat a row.
    expect(adapter.getNextParam(page([10, 9, 8]), undefined)).toBe(8);
    expect(adapter.getNextParam(page([7, 6, 5]), 8)).toBe(5);
  });

  it('ends the list when a page comes back shorter than the limit', () => {
    expect(adapter.getNextParam(page([4, 3]), 5)).toBeNull();
    expect(adapter.getNextParam(page([]), 3)).toBeNull();
  });

  it('offers one more page when the page is exactly full', () => {
    // Deliberate: stopping early would silently hide events, which is worse than one extra
    // request that comes back empty.
    expect(adapter.getNextParam(page([3, 2, 1]), 5)).toBe(1);
  });
});
