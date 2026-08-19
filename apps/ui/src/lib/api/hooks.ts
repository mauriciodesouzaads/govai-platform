// Resource hooks — the only place the U1 screens touch the network.
//
// Each hook binds one endpoint to its mirrored contract schema, its query key and its
// pagination adapter, so a screen cannot accidentally request an unvalidated shape or invent
// a cursor rule of its own.

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { UseInfiniteQueryResult, UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';
import { useSession } from '../session/SessionProvider.js';
import { queryKeys } from './keys.js';
import { keysetAdapter, offsetAdapter } from './pagination.js';
import {
  Ec1GapsResponse,
  Ec2GapsResponse,
  Ec3DropGapsResponse,
  Ec3SealGapsResponse,
  Ec4GapsResponse,
  EvidenceSummaryResponse,
  GAPS_DEFAULT_LIMIT,
  type DropEstimate,
  type Ec1GapRow,
  type Ec2GapRow,
  type Ec3SealRow,
  type Ec4Row,
  type EvidenceInvariant,
  type GapsResponse,
} from '../contract/evidence.js';
import {
  AuditEventsResponse,
  AUDIT_EVENTS_DEFAULT_LIMIT,
  type ChainCategory,
} from '../contract/audit-events.js';
import { CapabilitiesResponse } from '../contract/capabilities.js';

/**
 * The /gaps `items[]` shape is discriminated by the REQUEST's `invariant`, not by anything
 * inside the response body. This map pairs each enum member with its row schema, and the
 * mapped type is what lets `useEvidenceGaps('ec2', …)` return `Ec2GapRow[]` at the call site
 * with no cast anywhere.
 */
export type GapRowFor = {
  ec1: Ec1GapRow;
  ec2: Ec2GapRow;
  ec3seal: Ec3SealRow;
  ec3drop: DropEstimate;
  ec4: Ec4Row;
};

const GAP_SCHEMAS: {
  [K in EvidenceInvariant]: z.ZodType<GapsResponse<GapRowFor[K]>>;
} = {
  ec1: Ec1GapsResponse,
  ec2: Ec2GapsResponse,
  ec3seal: Ec3SealGapsResponse,
  ec3drop: Ec3DropGapsResponse,
  ec4: Ec4GapsResponse,
};

export function useEvidenceSummary(
  windowSeconds: number,
): UseQueryResult<z.infer<typeof EvidenceSummaryResponse>> {
  const { client } = useSession();
  return useQuery({
    queryKey: queryKeys.evidenceSummary(windowSeconds),
    queryFn: ({ signal }) =>
      client.get('/v1/evidence/summary', {
        query: { window: windowSeconds },
        schema: EvidenceSummaryResponse,
        signal,
      }),
  });
}

export function useEvidenceGaps<I extends EvidenceInvariant>(
  invariant: I,
  windowSeconds: number,
  limit: number = GAPS_DEFAULT_LIMIT,
): UseInfiniteQueryResult<{ pages: GapsResponse<GapRowFor[I]>[] }> {
  const { client } = useSession();
  const schema = GAP_SCHEMAS[invariant];
  return useInfiniteQuery({
    queryKey: queryKeys.evidenceGaps(invariant, windowSeconds, limit),
    initialPageParam: offsetAdapter.initialParam,
    queryFn: ({ pageParam, signal }) =>
      client.get('/v1/evidence/gaps', {
        query: { invariant, window: windowSeconds, limit, cursor: pageParam },
        schema,
        signal,
      }),
    getNextPageParam: (lastPage, _all, lastParam) =>
      offsetAdapter.getNextParam(lastPage, lastParam),
  });
}

export function useAuditEvents(
  chainCategory: ChainCategory,
  limit: number = AUDIT_EVENTS_DEFAULT_LIMIT,
): UseInfiniteQueryResult<{ pages: z.infer<typeof AuditEventsResponse>[] }> {
  const { client } = useSession();
  const adapter = keysetAdapter(limit);
  return useInfiniteQuery({
    queryKey: queryKeys.auditEvents(chainCategory, limit),
    initialPageParam: adapter.initialParam,
    queryFn: ({ pageParam, signal }) =>
      client.get('/v1/audit-events', {
        query: {
          chain_category: chainCategory,
          limit,
          ...(pageParam === undefined ? {} : { before_seq: pageParam }),
        },
        schema: AuditEventsResponse,
        signal,
      }),
    getNextPageParam: (lastPage, _all, lastParam) => adapter.getNextParam(lastPage, lastParam),
  });
}

export function useCapabilities(): UseQueryResult<z.infer<typeof CapabilitiesResponse>> {
  const { client } = useSession();
  return useQuery({
    queryKey: queryKeys.capabilities(),
    queryFn: ({ signal }) =>
      client.get('/v1/capabilities', { schema: CapabilitiesResponse, signal }),
  });
}
