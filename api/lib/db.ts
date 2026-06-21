import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type {
  User,
  Batch,
  Sample,
  Location,
  TransferRecord,
  FailedTransfer,
  AuditLog,
  FlowTraceAuditRecord,
  FlowTracePermissionState,
} from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../../.data');
const DB_FILE = path.join(DATA_DIR, 'server-db.json');

export interface ServerDB {
  users: User[];
  batches: Batch[];
  samples: Sample[];
  locations: Location[];
  transferRecords: TransferRecord[];
  failedTransfers: FailedTransfer[];
  auditLogs: AuditLog[];
  flowTraceAuditRecords: FlowTraceAuditRecord[];
  flowTracePermissionState: Array<FlowTracePermissionState & { id: string }>;
  sessions: Array<{ id: string; userId: string; createdAt: string; lastAccessAt: string }>;
  _meta: { version: number; updatedAt: string };
}

const EMPTY_DB: ServerDB = {
  users: [],
  batches: [],
  samples: [],
  locations: [],
  transferRecords: [],
  failedTransfers: [],
  auditLogs: [],
  flowTraceAuditRecords: [],
  flowTracePermissionState: [],
  sessions: [],
  _meta: { version: 1, updatedAt: new Date().toISOString() },
};

let inMemoryDB: ServerDB = JSON.parse(JSON.stringify(EMPTY_DB));
let persistenceEnabled = true;

export const generateId = (): string => {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const nowISO = (): string => new Date().toISOString();

const ensureDataDir = () => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
};

export const loadDB = (): ServerDB => {
  if (!persistenceEnabled) return inMemoryDB;

  try {
    ensureDataDir();
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      inMemoryDB = JSON.parse(raw);
    } else {
      inMemoryDB = JSON.parse(JSON.stringify(EMPTY_DB));
      saveDB();
    }
  } catch {
    inMemoryDB = JSON.parse(JSON.stringify(EMPTY_DB));
  }
  return inMemoryDB;
};

export const saveDB = (): void => {
  if (!persistenceEnabled) return;

  try {
    ensureDataDir();
    inMemoryDB._meta.updatedAt = nowISO();
    fs.writeFileSync(DB_FILE, JSON.stringify(inMemoryDB, null, 2), 'utf-8');
  } catch (e) {
    console.warn('[DB] Failed to persist:', e instanceof Error ? e.message : e);
  }
};

export const resetDB = (): void => {
  inMemoryDB = JSON.parse(JSON.stringify(EMPTY_DB));
  saveDB();
};

export const getDB = (): ServerDB => {
  return inMemoryDB;
};

export const setPersistenceEnabled = (enabled: boolean): void => {
  persistenceEnabled = enabled;
};

export const runTransaction = <T>(fn: (db: ServerDB) => T): T => {
  const result = fn(inMemoryDB);
  saveDB();
  return result;
};

export const getUsers = (): User[] => [...inMemoryDB.users];
export const getBatches = (): Batch[] => [...inMemoryDB.batches];
export const getSamples = (): Sample[] => [...inMemoryDB.samples];
export const getLocations = (): Location[] => [...inMemoryDB.locations];
export const getTransferRecords = (): TransferRecord[] => [...inMemoryDB.transferRecords];
export const getFailedTransfers = (): FailedTransfer[] => [...inMemoryDB.failedTransfers];
export const getAuditLogs = (): AuditLog[] => [...inMemoryDB.auditLogs];
export const getFlowTraceAuditRecords = (): FlowTraceAuditRecord[] => [...inMemoryDB.flowTraceAuditRecords];
export const getFlowTracePermissionStates = (): Array<FlowTracePermissionState & { id: string }> => [...inMemoryDB.flowTracePermissionState];
export const getSessions = (): Array<{ id: string; userId: string; createdAt: string; lastAccessAt: string }> => [...inMemoryDB.sessions];

export const upsertUser = (user: User): void => {
  const idx = inMemoryDB.users.findIndex(u => u.id === user.id);
  if (idx >= 0) inMemoryDB.users[idx] = user;
  else inMemoryDB.users.push(user);
  saveDB();
};

export const upsertBatch = (batch: Batch): void => {
  const idx = inMemoryDB.batches.findIndex(b => b.id === batch.id);
  if (idx >= 0) inMemoryDB.batches[idx] = batch;
  else inMemoryDB.batches.push(batch);
  saveDB();
};

export const upsertSample = (sample: Sample): void => {
  const idx = inMemoryDB.samples.findIndex(s => s.id === sample.id);
  if (idx >= 0) inMemoryDB.samples[idx] = sample;
  else inMemoryDB.samples.push(sample);
  saveDB();
};

export const upsertLocation = (location: Location): void => {
  const idx = inMemoryDB.locations.findIndex(l => l.id === location.id);
  if (idx >= 0) inMemoryDB.locations[idx] = location;
  else inMemoryDB.locations.push(location);
  saveDB();
};

export const upsertTransferRecord = (record: TransferRecord): void => {
  const idx = inMemoryDB.transferRecords.findIndex(t => t.id === record.id);
  if (idx >= 0) inMemoryDB.transferRecords[idx] = record;
  else inMemoryDB.transferRecords.push(record);
  saveDB();
};

export const upsertFailedTransfer = (failed: FailedTransfer): void => {
  const idx = inMemoryDB.failedTransfers.findIndex(f => f.id === failed.id);
  if (idx >= 0) inMemoryDB.failedTransfers[idx] = failed;
  else inMemoryDB.failedTransfers.push(failed);
  saveDB();
};

export const upsertAuditLog = (log: AuditLog): void => {
  inMemoryDB.auditLogs.push(log);
  saveDB();
};

export const upsertFlowTraceAuditRecord = (record: FlowTraceAuditRecord): void => {
  inMemoryDB.flowTraceAuditRecords.push(record);
  saveDB();
};

export const upsertFlowTracePermissionState = (state: FlowTracePermissionState & { id: string }): void => {
  const idx = inMemoryDB.flowTracePermissionState.findIndex(s => s.id === state.id);
  if (idx >= 0) inMemoryDB.flowTracePermissionState[idx] = state;
  else inMemoryDB.flowTracePermissionState.push(state);
  saveDB();
};

export const upsertSession = (session: { id: string; userId: string; createdAt: string; lastAccessAt: string }): void => {
  const idx = inMemoryDB.sessions.findIndex(s => s.id === session.id);
  if (idx >= 0) inMemoryDB.sessions[idx] = session;
  else inMemoryDB.sessions.push(session);
  saveDB();
};

export const removeSession = (sessionId: string): void => {
  inMemoryDB.sessions = inMemoryDB.sessions.filter(s => s.id !== sessionId);
  saveDB();
};

export const findUserByUsername = (username: string): User | undefined => {
  return inMemoryDB.users.find(u => u.username === username);
};

export const findUserById = (id: string): User | undefined => {
  return inMemoryDB.users.find(u => u.id === id);
};

export const findSampleBySampleNo = (sampleNo: string): Sample | undefined => {
  return inMemoryDB.samples.find(s => s.sampleNo === sampleNo);
};

export const findSampleById = (id: string): Sample | undefined => {
  return inMemoryDB.samples.find(s => s.id === id);
};

export const findTransfersBySampleId = (sampleId: string): TransferRecord[] => {
  return inMemoryDB.transferRecords.filter(t => t.sampleId === sampleId);
};

export const findFlowTracePermissionStateByUserId = (userId: string): (FlowTracePermissionState & { id: string }) | undefined => {
  return inMemoryDB.flowTracePermissionState.find(s => s.userId === userId);
};

export const findSessionById = (id: string): { id: string; userId: string; createdAt: string; lastAccessAt: string } | undefined => {
  return inMemoryDB.sessions.find(s => s.id === id);
};

loadDB();
