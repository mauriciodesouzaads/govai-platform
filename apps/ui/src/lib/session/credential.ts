// The GovAI API key holder.
//
// The key lives in ONE module-scoped variable and nowhere else. It is deliberately NOT React
// state and NOT a context value: React state is copied into props, into devtools, into error
// boundaries and into serialized error reports. Components observe `hasCredential`, never the
// credential itself, and the only consumer of `get()` is the API client's header builder.
//
// Where the key must never appear (mission §11), and how that is prevented here:
//   localStorage / sessionStorage / IndexedDB / cookie  — this module performs no I/O at all
//   URL / query parameter / router state                — never passed to the router
//   React Query key                                     — query keys are built in api/keys.ts
//                                                         from window/filter values only
//   console / analytics / error telemetry               — nothing here logs, and there is no
//                                                         analytics or telemetry in this app
//   the DOM after a successful submit                   — the /enter form clears its input
//
// A tab reload loses the key, by design. The UI says so.

export type CredentialStore = {
  /** Read the credential. The only legitimate caller is the API client's header builder. */
  get(): string | null;
  set(value: string): void;
  clear(): void;
  hasCredential(): boolean;
  /** Notified on every set/clear so React can re-render authentication state. */
  subscribe(listener: () => void): () => void;
};

export function createCredentialStore(): CredentialStore {
  let credential: string | null = null;
  const listeners = new Set<() => void>();

  const emit = (): void => {
    for (const listener of listeners) listener();
  };

  return {
    get: () => credential,
    set: (value: string) => {
      credential = value;
      emit();
    },
    clear: () => {
      credential = null;
      emit();
    },
    hasCredential: () => credential !== null,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
