import { openDB, type IDBPDatabase } from 'idb';
import type {
  User,
  Batch,
  Sample,
  Location,
  TransferRecord,
  FailedTransfer,
  AuditLog,
} from '@shared/types';
import { DB_NAME, DB_VERSION, STORES } from '@shared/constants';

export interface SampleTrackingDBSchema {
  users: {
    key: string;
    value: User;
    indexes: { 'by-username': string };
  };
  batches: {
    key: string;
    value: Batch;
    indexes: { 'by-batchNo': string; 'by-importedAt': string };
  };
  samples: {
    key: string;
    value: Sample;
    indexes: {
      'by-sampleNo': string;
      'by-batchId': string;
      'by-status': string;
      'by-location': string;
    };
  };
  locations: {
    key: string;
    value: Location;
    indexes: { 'by-code': string; 'by-type': string; 'by-status': string };
  };
  transferRecords: {
    key: string;
    value: TransferRecord;
    indexes: {
      'by-sampleId': string;
      'by-operatedAt': string;
      'by-operatorId': string;
      'by-type': string;
    };
  };
  failedTransfers: {
    key: string;
    value: FailedTransfer;
    indexes: { 'by-sampleId': string; 'by-attemptedAt': string; 'by-resolved': string };
  };
  auditLogs: {
    key: string;
    value: AuditLog;
    indexes: { 'by-timestamp': string; 'by-userId': string; 'by-action': string };
  };
}

let dbInstance: IDBPDatabase<SampleTrackingDBSchema> | null = null;

export const getDB = async (): Promise<IDBPDatabase<SampleTrackingDBSchema>> => {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<SampleTrackingDBSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORES.users)) {
        const usersStore = db.createObjectStore(STORES.users, { keyPath: 'id' });
        usersStore.createIndex('by-username', 'username', { unique: true });
      }

      if (!db.objectStoreNames.contains(STORES.batches)) {
        const batchesStore = db.createObjectStore(STORES.batches, { keyPath: 'id' });
        batchesStore.createIndex('by-batchNo', 'batchNo', { unique: true });
        batchesStore.createIndex('by-importedAt', 'importedAt');
      }

      if (!db.objectStoreNames.contains(STORES.samples)) {
        const samplesStore = db.createObjectStore(STORES.samples, { keyPath: 'id' });
        samplesStore.createIndex('by-sampleNo', 'sampleNo', { unique: true });
        samplesStore.createIndex('by-batchId', 'batchId');
        samplesStore.createIndex('by-status', 'currentStatus');
        samplesStore.createIndex('by-location', 'currentLocationId');
      }

      if (!db.objectStoreNames.contains(STORES.locations)) {
        const locationsStore = db.createObjectStore(STORES.locations, { keyPath: 'id' });
        locationsStore.createIndex('by-code', 'code', { unique: true });
        locationsStore.createIndex('by-type', 'type');
        locationsStore.createIndex('by-status', 'status');
      }

      if (!db.objectStoreNames.contains(STORES.transferRecords)) {
        const transferStore = db.createObjectStore(STORES.transferRecords, { keyPath: 'id' });
        transferStore.createIndex('by-sampleId', 'sampleId');
        transferStore.createIndex('by-operatedAt', 'operatedAt');
        transferStore.createIndex('by-operatorId', 'operatorId');
        transferStore.createIndex('by-type', 'type');
      }

      if (!db.objectStoreNames.contains(STORES.failedTransfers)) {
        const failedStore = db.createObjectStore(STORES.failedTransfers, { keyPath: 'id' });
        failedStore.createIndex('by-sampleId', 'sampleId');
        failedStore.createIndex('by-attemptedAt', 'attemptedAt');
        failedStore.createIndex('by-resolved', 'resolved');
      }

      if (!db.objectStoreNames.contains(STORES.auditLogs)) {
        const auditStore = db.createObjectStore(STORES.auditLogs, { keyPath: 'id' });
        auditStore.createIndex('by-timestamp', 'timestamp');
        auditStore.createIndex('by-userId', 'userId');
        auditStore.createIndex('by-action', 'action');
      }
    },
  });

  return dbInstance;
};

export const generateId = (): string => {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const nowISO = (): string => new Date().toISOString();
