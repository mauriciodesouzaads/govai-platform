import { describe, expect, it, vi } from 'vitest';
import { createCredentialStore } from './credential.js';
import { queryKeys } from '../api/keys.js';

const KEY = 'govai_sk_AAAtest-key-value-0123456789';

describe('the credential store', () => {
  it('holds, reports and clears the credential', () => {
    const store = createCredentialStore();
    expect(store.get()).toBeNull();
    expect(store.hasCredential()).toBe(false);

    store.set(KEY);
    expect(store.get()).toBe(KEY);
    expect(store.hasCredential()).toBe(true);

    store.clear();
    expect(store.get()).toBeNull();
    expect(store.hasCredential()).toBe(false);
  });

  it('notifies subscribers on set and clear, and unsubscribes cleanly', () => {
    const store = createCredentialStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.set(KEY);
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.set(KEY);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('performs NO browser storage I/O of any kind', () => {
    // The guarantee is structural — the module imports nothing and touches no global — so the
    // test pins it by spying on every storage entry point a future edit might reach for.
    const localSet = vi.spyOn(Storage.prototype, 'setItem');
    const localGet = vi.spyOn(Storage.prototype, 'getItem');

    const store = createCredentialStore();
    store.set(KEY);
    store.get();
    store.hasCredential();
    store.clear();

    expect(localSet).not.toHaveBeenCalled();
    expect(localGet).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    expect(document.cookie).toBe('');
  });
});

describe('query keys carry no identity', () => {
  // Query keys are the one place a credential could quietly become a cache index. They are
  // built only from what the reader chose, which is also why a session change must clear the
  // whole cache (SessionProvider.dropSession) — a test in session-lifecycle covers that half.
  const allKeys = [
    queryKeys.evidenceSummary(86_400),
    queryKeys.evidenceGaps('ec1', 86_400, 100),
    queryKeys.auditEvents('run', 50),
    queryKeys.capabilities(),
  ];

  it.each(allKeys.map((k) => [JSON.stringify(k), k] as const))(
    '%s contains no credential material',
    (_label, key) => {
      const serialized = JSON.stringify(key);
      expect(serialized).not.toContain(KEY);
      expect(serialized).not.toMatch(/govai_sk_/);
      expect(serialized).not.toMatch(/api[-_]?key/i);
      expect(serialized).not.toMatch(/authorization/i);
      expect(serialized).not.toMatch(/bearer/i);
    },
  );

  it('scopes the cache by what the reader is looking at', () => {
    expect(queryKeys.evidenceSummary(3_600)).not.toEqual(queryKeys.evidenceSummary(86_400));
    expect(queryKeys.evidenceGaps('ec1', 86_400, 100)).not.toEqual(
      queryKeys.evidenceGaps('ec2', 86_400, 100),
    );
    expect(queryKeys.auditEvents('run', 50)).not.toEqual(queryKeys.auditEvents('policy', 50));
  });
});
