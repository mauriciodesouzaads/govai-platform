import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createCredentialStore, type CredentialStore } from './credential.js';
import { createApiClient, type ApiClient } from '../api/client.js';
import { EvidenceSummaryResponse } from '../contract/evidence.js';
import { ApiError, isApiError } from '../contract/errors.js';
import { DEFAULT_WINDOW } from '../window.js';

export type SessionValue = {
  /** True once a credential has been accepted by a real authenticated read. */
  isAuthenticated: boolean;
  /** The organization id LEARNED from an authenticated response — never chosen by the user
   *  and never sent as a parameter. Null before the first successful probe. */
  orgId: string | null;
  /** Validate a candidate key against the API and, only on success, keep it in memory. */
  signIn: (candidate: string) => Promise<void>;
  signOut: () => void;
  client: ApiClient;
};

const SessionContext = createContext<SessionValue | null>(null);

export type SessionProviderProps = {
  children: ReactNode;
  baseUrl?: string;
  /** Injected by tests. */
  fetchImpl?: typeof fetch;
  store?: CredentialStore;
};

export function SessionProvider({ children, baseUrl, fetchImpl, store }: SessionProviderProps) {
  const queryClient = useQueryClient();
  const storeRef = useRef<CredentialStore>(store ?? createCredentialStore());
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    storeRef.current.hasCredential(),
  );
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    const credentialStore = storeRef.current;
    return credentialStore.subscribe(() => {
      setIsAuthenticated(credentialStore.hasCredential());
    });
  }, []);

  // Dropping the credential must also drop everything fetched with it. Query keys carry no
  // identity (api/keys.ts), so leaving the cache populated would let the next credential read
  // the previous organization's rows out of cache.
  const dropSession = useCallback(() => {
    storeRef.current.clear();
    setOrgId(null);
    queryClient.clear();
  }, [queryClient]);

  const client = useMemo(
    () =>
      createApiClient({
        baseUrl,
        getCredential: () => storeRef.current.get(),
        onUnauthorized: dropSession,
        ...(fetchImpl ? { fetchImpl } : {}),
      }),
    [baseUrl, fetchImpl, dropSession],
  );

  const signIn = useCallback(
    async (candidate: string) => {
      const trimmed = candidate.trim();
      if (trimmed.length === 0) {
        throw new ApiError({ kind: 'auth', message: 'empty credential' });
      }
      // Probe with the candidate passed explicitly — it is not stored until the API accepts
      // it, so a rejected key never becomes the session credential even transiently.
      let summary;
      try {
        summary = await client.get('/v1/evidence/summary', {
          query: { window: DEFAULT_WINDOW.seconds },
          schema: EvidenceSummaryResponse,
          credential: trimmed,
        });
      } catch (err) {
        if (isApiError(err)) throw err;
        throw new ApiError({ kind: 'unknown', message: 'probe failed' });
      }
      storeRef.current.set(trimmed);
      setOrgId(summary.org_id);
      setIsAuthenticated(true);
    },
    [client],
  );

  const value = useMemo<SessionValue>(
    () => ({ isAuthenticated, orgId, signIn, signOut: dropSession, client }),
    [isAuthenticated, orgId, signIn, dropSession, client],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
