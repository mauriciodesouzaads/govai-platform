// The React Query configuration.
//
// Retry policy is deliberately narrow and BOUNDED. The transport already retries 429 (bounded,
// Retry-After aware); this layer retries only genuinely transient faults — a 5xx or a request
// that never reached the API — at most twice. Everything else (401, 400, 404, 409, a contract
// mismatch) is a permanent answer: retrying it would burn the shared 100/min budget and hide
// the real cause behind a spinner.
//
// staleTime is generous because the API enforces a per-process 100 req/min limit
// (apps/api/src/server.ts:109-112) and an evidence cockpit is several panels wide. Per-key
// rate limiting is a named backend follow-up (EP-B1), not something the UI can fix.

import { QueryClient } from '@tanstack/react-query';
import { isApiError, isRetryableKind } from '../contract/errors.js';

export const MAX_TRANSIENT_RETRIES = 2;

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_TRANSIENT_RETRIES) return false;
  if (!isApiError(error)) return false;
  return isRetryableKind(error.kind);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}
