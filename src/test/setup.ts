import 'fake-indexeddb/auto';

if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  const mockStorage: Storage = {
    getItem: (key: string): string | null => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key: string, value: string): void => { store[key] = String(value); },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { Object.keys(store).forEach((k) => delete store[k]); },
    get length(): number { return Object.keys(store).length; },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: mockStorage,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

import { useAppStore } from '../store/useAppStore';

beforeEach(async () => {
  const { resetDBInstance } = await import('../lib/db');
  resetDBInstance();

  const dbs = await indexedDB.databases();
  for (const db of dbs) {
    if (db.name) {
      indexedDB.deleteDatabase(db.name);
    }
  }
  globalThis.localStorage.clear();
  useAppStore.setState({
    currentUser: null,
    samples: [],
    batches: [],
    transferRecords: [],
    failedTransfers: [],
    auditLogs: [],
    locations: [],
    users: [],
    isInitialized: false,
    isLoading: false,
    error: null,
  });
});
