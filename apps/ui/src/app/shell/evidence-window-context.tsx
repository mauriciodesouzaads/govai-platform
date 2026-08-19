import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { DEFAULT_WINDOW, windowById, type WindowOption } from '../../lib/window.js';

// The selected evidence window, shared by the shell selector and the evidence screens.
//
// It is UI state, not persisted state: it is not written to storage (only the locale is), and
// it is not put in the URL in U1 — the screens that consume it always print the window they
// used, and every export records it, so a shared screenshot is never ambiguous about which
// window produced the numbers.

type EvidenceWindowValue = {
  window: WindowOption;
  setWindow: (id: string) => void;
};

const EvidenceWindowContext = createContext<EvidenceWindowValue | null>(null);

export function EvidenceWindowProvider({
  children,
  initial = DEFAULT_WINDOW,
}: {
  children: ReactNode;
  initial?: WindowOption;
}) {
  const [current, setCurrent] = useState<WindowOption>(initial);
  const value = useMemo<EvidenceWindowValue>(
    () => ({ window: current, setWindow: (id: string) => setCurrent(windowById(id)) }),
    [current],
  );
  return (
    <EvidenceWindowContext.Provider value={value}>{children}</EvidenceWindowContext.Provider>
  );
}

export function useEvidenceWindow(): EvidenceWindowValue {
  const ctx = useContext(EvidenceWindowContext);
  if (!ctx) throw new Error('useEvidenceWindow must be used inside <EvidenceWindowProvider>');
  return ctx;
}
