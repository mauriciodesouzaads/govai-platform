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
import { MeResponse } from '../contract/me.js';
import { ApiError, isApiError } from '../contract/errors.js';

// The session.
//
// ★ EP-B2 changed what "signing in" MEANS here. The probe used to be an evidence read
// (`GET /v1/evidence/summary`), which validated the key but told the interface nothing about
// who the key belongs to beyond an `org_id` that happened to ride along in the body. The probe
// is now `GET /v1/me`: the credential is still validated by a real authenticated read that
// writes nothing, but what comes back is the SERVER-RESOLVED PRINCIPAL — org, user, roles,
// commercial tier and operational mode.
//
// Three properties this file must keep true:
//
//   1. THE IDENTITY IS NEVER INFERRED, AND NEVER AUTHORITATIVE HERE. Everything in
//      `principal` arrived in one response and is re-fetched on every authentication. It is
//      React state for rendering, not a capability: the server re-derives identity on every
//      single request (each route calls `authenticateApiKey` itself), so nothing the browser
//      holds can grant anything. A tampered `principal` changes what this tab DISPLAYS and
//      nothing else.
//   2. THE CREDENTIAL STAYS WHERE IT WAS. It is still held in the one module-scoped variable
//      in credential.ts; the principal does NOT travel with it into storage, and a tab reload
//      still ends the session and re-authenticates from scratch.
//   3. NO DUPLICATE PROBE. `signIn` sets the principal directly from its own probe. The
//      adoption effect below only fires for a credential this provider did not itself
//      validate — which in the application is never, and in a test is a pre-seeded store.
//      A session that holds a credential but no principal is INCOMPLETE, and completing it is
//      what that effect is for.

export type Principal = MeResponse;

export type SessionValue = {
  /** True once a credential has been accepted by a real authenticated read. */
  isAuthenticated: boolean;
  /** The authenticated principal as the SERVER resolved it (GET /v1/me), or null while the
   *  session has not yet obtained one. Never edited, never inferred, never persisted. */
  principal: Principal | null;
  /** The organization id LEARNED from the authenticated response — never chosen by the user
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
  const [principal, setPrincipal] = useState<Principal | null>(null);

  useEffect(() => {
    const credentialStore = storeRef.current;
    return credentialStore.subscribe(() => {
      setIsAuthenticated(credentialStore.hasCredential());
    });
  }, []);

  // Dropping the credential must also drop everything fetched with it. Query keys carry no
  // identity (api/keys.ts), so leaving the cache populated would let the next credential read
  // the previous organization's rows out of cache. The principal goes with it: it describes
  // the credential that is being discarded.
  const dropSession = useCallback(() => {
    storeRef.current.clear();
    setPrincipal(null);
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
      let me: Principal;
      try {
        me = await client.get('/v1/me', { schema: MeResponse, credential: trimmed });
      } catch (err) {
        if (isApiError(err)) throw err;
        throw new ApiError({ kind: 'unknown', message: 'probe failed' });
      }
      storeRef.current.set(trimmed);
      setPrincipal(me);
      setIsAuthenticated(true);
    },
    [client],
  );

  // Adoption: a credential this provider did not validate itself still owes the reader a
  // principal, and the shell must not render a session whose identity it never learned.
  //
  // ★ The in-flight guard is a REF and there is deliberately NO cancel-on-unmount flag. Under
  // <StrictMode> React mounts, unmounts and remounts every effect: a `cancelled` closure flag
  // would be flipped by the first cleanup, the second run would bail on the still-true ref,
  // and the resolved response would then be discarded by the very flag that was meant to
  // protect it — leaving the session permanently without a principal, in development only. A
  // late `setPrincipal` on an unmounted tree is a no-op in React 18+, so there is nothing for
  // a cancel flag to prevent here. A remount creates a fresh ref and re-adopts, which is
  // correct: a new provider instance has learned nothing yet.
  const adopting = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || principal !== null || adopting.current) return;
    adopting.current = true;
    void client
      .get('/v1/me', { schema: MeResponse })
      .then(setPrincipal)
      .catch(() => {
        // Deliberately silent: a 401 has already dropped the session via onUnauthorized, and
        // any other failure leaves the shell showing the facts it does have rather than an
        // invented identity. Not retried in a loop — the deps do not change on failure, so the
        // reader ends the session and signs in again.
      })
      .finally(() => {
        adopting.current = false;
      });
  }, [client, isAuthenticated, principal]);

  const value = useMemo<SessionValue>(
    () => ({
      isAuthenticated,
      principal,
      orgId: principal?.org_id ?? null,
      signIn,
      signOut: dropSession,
      client,
    }),
    [isAuthenticated, principal, signIn, dropSession, client],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}
