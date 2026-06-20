import 'fake-indexeddb/auto';

if (typeof globalThis.localStorage === 'undefined') {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
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
