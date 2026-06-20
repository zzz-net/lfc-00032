import { create } from 'zustand';
import type {
  User,
  PublicUser,
  Sample,
  Location,
  Batch,
  TransferRecord,
  FailedTransfer,
  AuditLog,
  SampleImportRow,
  ImportResult,
  AuditTimelineFilter,
  AuditExportFormat,
  TransferType,
  SampleStatus,
} from '@shared/types';
import { getDB, generateId, nowISO } from '../lib/db';
import { createInitialUsers, createInitialLocations } from '../lib/seed';
import {
  SESSION_KEY,
  hashPassword,
  ERROR_CODES,
  STORES,
} from '@shared/constants';
import {
  validateInbound,
  validateOutbound,
  validateTestReceive,
  validateTestComplete,
  validateArchive,
  validateRollback,
} from '../services/transferValidator';
import Papa from 'papaparse';

interface AppState {
  currentUser: User | null;
  users: PublicUser[];
  samples: Sample[];
  locations: Location[];
  batches: Batch[];
  transferRecords: TransferRecord[];
  failedTransfers: FailedTransfer[];
  auditLogs: AuditLog[];
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;

  initializeDB: () => Promise<void>;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  restoreSession: () => Promise<void>;

  getAllUsers: () => Promise<void>;
  getAllLocations: () => Promise<void>;
  getAllSamples: () => Promise<void>;
  getAllBatches: () => Promise<void>;
  getTransferRecordsBySample: (sampleId: string) => Promise<TransferRecord[]>;
  getFailedTransfers: () => Promise<void>;
  getAuditLogs: (filter?: AuditTimelineFilter) => Promise<AuditLog[]>;

  createLocation: (data: Omit<Location, 'id' | 'createdAt' | 'updatedAt'>) => Promise<Location>;
  updateLocation: (id: string, data: Partial<Location>) => Promise<void>;

  importBatch: (
    rows: SampleImportRow[],
    batchNo: string,
    remark?: string
  ) => Promise<ImportResult>;
  importCSVFile: (file: File, batchNo: string, remark?: string) => Promise<ImportResult>;

  performInbound: (
    sampleId: string,
    locationId: string,
    remark?: string
  ) => Promise<TransferRecord | null>;
  performOutbound: (
    sampleId: string,
    sourceLocationId: string,
    receiverId: string,
    remark?: string
  ) => Promise<TransferRecord | null>;
  performTestReceive: (
    sampleId: string,
    locationId: string,
    remark?: string
  ) => Promise<TransferRecord | null>;
  performTestComplete: (
    sampleId: string,
    testResult: string,
    remark?: string
  ) => Promise<TransferRecord | null>;
  performReview: (sampleId: string, remark?: string) => Promise<boolean>;
  performArchive: (
    sampleId: string,
    locationId: string,
    remark?: string
  ) => Promise<TransferRecord | null>;

  performRollback: (
    transferRecordId: string,
    reason: string
  ) => Promise<TransferRecord | null>;

  exportAuditData: (
    format: AuditExportFormat,
    filter?: AuditTimelineFilter
  ) => Promise<string | Blob>;

  getSampleById: (id: string) => Sample | undefined;
  getLocationById: (id: string) => Location | undefined;
  getUserById: (id: string) => PublicUser | undefined;

  addAuditLog: (
    action: string,
    targetType: string,
    details: Record<string, unknown>,
    targetId?: string
  ) => Promise<void>;
  recordFailedTransfer: (
    sampleId: string,
    attemptedType: TransferType,
    errorCode: string,
    errorMessage: string,
    payload: Record<string, unknown>
  ) => Promise<void>;
}

const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  username: user.username,
  role: user.role,
  displayName: user.displayName,
});

export const useAppStore = create<AppState>((set, get) => ({
  currentUser: null,
  users: [],
  samples: [],
  locations: [],
  batches: [],
  transferRecords: [],
  failedTransfers: [],
  auditLogs: [],
  isInitialized: false,
  isLoading: false,
  error: null,

  initializeDB: async () => {
    if (get().isInitialized) return;
    const db = await getDB();

    try {
      const userCount = await db.count(STORES.users);
      if (userCount === 0) {
        const initialUsers = createInitialUsers();
        const tx = db.transaction(STORES.users, 'readwrite');
        for (const user of initialUsers) {
          const existing = await tx.store.index('by-username').get(user.username);
          if (!existing) {
            await tx.store.put(user);
          }
        }
        await tx.done;
      }

      const locationCount = await db.count(STORES.locations);
      if (locationCount === 0) {
        const initialLocations = createInitialLocations();
        const tx = db.transaction(STORES.locations, 'readwrite');
        for (const loc of initialLocations) {
          const existing = await tx.store.index('by-code').get(loc.code);
          if (!existing) {
            await tx.store.put(loc);
          }
        }
        await tx.done;
      }
    } catch (err) {
      console.warn('Seed data warning:', err);
    }

    set({ isInitialized: true });
    await get().restoreSession();
  },

  login: async (username: string, password: string) => {
    const db = await getDB();
    const index = db.transaction(STORES.users).store.index('by-username');
    const user = await index.get(username);

    if (!user || user.passwordHash !== hashPassword(password)) {
      set({ error: '用户名或密码错误' });
      return false;
    }

    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ userId: user.id, loginAt: nowISO() })
    );

    await get().addAuditLog('login', 'user', { username }, user.id);
    set({ currentUser: user, error: null });
    await get().getAllUsers();
    await get().getAllLocations();
    await get().getAllSamples();
    await get().getAllBatches();
    return true;
  },

  logout: () => {
    const user = get().currentUser;
    if (user) {
      get().addAuditLog('logout', 'user', { username: user.username }, user.id);
    }
    localStorage.removeItem(SESSION_KEY);
    set({ currentUser: null });
  },

  restoreSession: async () => {
    const sessionStr = localStorage.getItem(SESSION_KEY);
    if (!sessionStr) return;

    try {
      const session = JSON.parse(sessionStr);
      const db = await getDB();
      const user = await db.get(STORES.users, session.userId);
      if (user) {
        set({ currentUser: user });
        await get().getAllUsers();
        await get().getAllLocations();
        await get().getAllSamples();
        await get().getAllBatches();
      } else {
        localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      localStorage.removeItem(SESSION_KEY);
    }
  },

  getAllUsers: async () => {
    const db = await getDB();
    const allUsers = await db.getAll(STORES.users);
    set({ users: allUsers.map(toPublicUser) });
  },

  getAllLocations: async () => {
    const db = await getDB();
    const locations = await db.getAll(STORES.locations);
    set({ locations: locations.sort((a, b) => a.code.localeCompare(b.code)) });
  },

  getAllSamples: async () => {
    const db = await getDB();
    const samples = await db.getAll(STORES.samples);
    set({ samples: samples.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  },

  getAllBatches: async () => {
    const db = await getDB();
    const batches = await db.getAll(STORES.batches);
    set({ batches: batches.sort((a, b) => b.importedAt.localeCompare(a.importedAt)) });
  },

  getTransferRecordsBySample: async (sampleId: string) => {
    const db = await getDB();
    const index = db.transaction(STORES.transferRecords).store.index('by-sampleId');
    const records = await index.getAll(sampleId);
    return records.sort((a, b) => a.operatedAt.localeCompare(b.operatedAt));
  },

  getFailedTransfers: async () => {
    const db = await getDB();
    const failed = await db.getAll(STORES.failedTransfers);
    set({
      failedTransfers: failed.sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt)),
    });
  },

  getAuditLogs: async (filter?: AuditTimelineFilter) => {
    const db = await getDB();
    let logs = await db.getAll(STORES.auditLogs);

    if (filter) {
      if (filter.userId) {
        logs = logs.filter((l) => l.userId === filter.userId);
      }
      if (filter.fromDate) {
        logs = logs.filter((l) => l.timestamp >= filter.fromDate!);
      }
      if (filter.toDate) {
        logs = logs.filter((l) => l.timestamp <= filter.toDate!);
      }
      if (filter.transferType) {
        logs = logs.filter(
          (l) => (l.details.transferType as TransferType) === filter.transferType
        );
      }
    }

    return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },

  createLocation: async (data) => {
    const db = await getDB();
    const now = nowISO();
    const location: Location = {
      ...data,
      id: generateId(),
      createdAt: now,
      updatedAt: now,
    };
    await db.add(STORES.locations, location);
    await get().addAuditLog(
      'location:create',
      'location',
      { code: location.code, name: location.name },
      location.id
    );
    await get().getAllLocations();
    return location;
  },

  updateLocation: async (id, data) => {
    const db = await getDB();
    const existing = await db.get(STORES.locations, id);
    if (!existing) return;

    const updated: Location = {
      ...existing,
      ...data,
      updatedAt: nowISO(),
    };
    await db.put(STORES.locations, updated);
    await get().addAuditLog(
      'location:update',
      'location',
      { changes: data },
      id
    );
    await get().getAllLocations();
  },

  importBatch: async (rows, batchNo, remark) => {
    const db = await getDB();
    const currentUser = get().currentUser;
    if (!currentUser) {
      return { success: false, importedCount: 0, failedRows: [] };
    }

    const batchId = generateId();
    const now = nowISO();
    const failedRows: ImportResult['failedRows'] = [];
    let importedCount = 0;

    const existingSamples = await db.getAllFromIndex(STORES.samples, 'by-sampleNo');
    const existingSampleNos = new Set(existingSamples.map((s) => s.sampleNo));
    const batchSeenNos = new Set<string>();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      if (!row.sampleNo || !row.type || !row.collectedAt || !row.collectedBy) {
        failedRows.push({
          rowIndex: i,
          data: row,
          errorCode: ERROR_CODES.MISSING_REQUIRED_FIELD,
          errorMessage: '缺少必填字段',
        });
        continue;
      }

      if (existingSampleNos.has(row.sampleNo) || batchSeenNos.has(row.sampleNo)) {
        failedRows.push({
          rowIndex: i,
          data: row,
          errorCode: ERROR_CODES.DUPLICATE_SAMPLE_NO,
          errorMessage: `样本号 ${row.sampleNo} 已存在`,
        });
        continue;
      }

      const collectedDate = new Date(row.collectedAt);
      if (isNaN(collectedDate.getTime())) {
        failedRows.push({
          rowIndex: i,
          data: row,
          errorCode: ERROR_CODES.INVALID_DATE_FORMAT,
          errorMessage: '采集日期格式无效',
        });
        continue;
      }

      batchSeenNos.add(row.sampleNo);
      existingSampleNos.add(row.sampleNo);
      importedCount++;
    }

    const validRows = rows.filter(
      (_, i) => !failedRows.some((f) => f.rowIndex === i)
    );

    if (importedCount > 0) {
      const sampleIds: string[] = [];
      const tx = db.transaction(
        [STORES.batches, STORES.samples, STORES.transferRecords, STORES.auditLogs, STORES.failedTransfers],
        'readwrite'
      );

      try {
        for (const row of validRows) {
          const sampleId = generateId();
          sampleIds.push(sampleId);
          const sample: Sample = {
            id: sampleId,
            sampleNo: row.sampleNo,
            batchId,
            type: row.type,
            collectedAt: row.collectedAt,
            collectedBy: row.collectedBy,
            description: row.description,
            currentStatus: 'imported',
            isArchived: false,
            createdAt: now,
            updatedAt: now,
          };
          tx.objectStore(STORES.samples).put(sample);

          const transfer: TransferRecord = {
            id: generateId(),
            sampleId,
            type: 'import',
            toStatus: 'imported',
            operatorId: currentUser.id,
            operatedAt: now,
            remark: `批次导入: ${batchNo}`,
            isRolledBack: false,
          };
          tx.objectStore(STORES.transferRecords).put(transfer);
        }

        const batch: Batch = {
          id: batchId,
          batchNo,
          importedAt: now,
          importedBy: currentUser.id,
          sampleCount: importedCount,
          remark,
        };
        tx.objectStore(STORES.batches).put(batch);

        const auditLog: AuditLog = {
          id: generateId(),
          timestamp: now,
          userId: currentUser.id,
          action: 'batch:import',
          targetType: 'batch',
          targetId: batchId,
          details: { batchNo, importedCount, failedCount: failedRows.length, remark },
        };
        tx.objectStore(STORES.auditLogs).put(auditLog);

        for (const f of failedRows) {
          const failed: FailedTransfer = {
            id: generateId(),
            sampleId: '',
            attemptedType: 'import',
            attemptedAt: now,
            attemptedBy: currentUser.id,
            errorCode: f.errorCode,
            errorMessage: f.errorMessage,
            payload: { rowIndex: f.rowIndex, sampleNo: f.data.sampleNo, batchNo },
            resolved: false,
          };
          tx.objectStore(STORES.failedTransfers).put(failed);
        }

        await tx.done;
      } catch (err) {
        console.warn('Batch import partial error:', err);
        try { await tx.done; } catch { /* tx may already be aborted */ }
      }
    }

    await get().getAllSamples();
    await get().getAllBatches();
    await get().getFailedTransfers();

    return {
      success: importedCount > 0,
      batchId: importedCount > 0 ? batchId : undefined,
      batchNo: importedCount > 0 ? batchNo : undefined,
      importedCount,
      failedRows,
    };
  },

  importCSVFile: async (file, batchNo, remark) => {
    return new Promise<ImportResult>((resolve) => {
      Papa.parse<SampleImportRow>(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          const rows = results.data.filter(
            (r) => r && typeof r === 'object' && Object.keys(r).length > 0
          );
          const result = await get().importBatch(rows, batchNo, remark);
          resolve(result);
        },
        error: () => {
          resolve({ success: false, importedCount: 0, failedRows: [] });
        },
      });
    });
  },

  performInbound: async (sampleId, locationId, remark) => {
    const currentUser = get().currentUser;
    if (!currentUser) return null;

    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);
    const location = await db.get(STORES.locations, locationId);

    if (!sample || !location) return null;

    const validation = validateInbound({ sample, targetLocation: location, operator: currentUser });

    if (!validation.valid) {
      await get().recordFailedTransfer(
        sampleId,
        'inbound',
        validation.errorCode!,
        validation.errorMessage!,
        { sampleId, locationId, remark }
      );
      set({ error: validation.errorMessage! });
      return null;
    }

    const locationSamples = await db.getAllFromIndex(STORES.samples, 'by-location', locationId);
    if (locationSamples.length >= location.capacity) {
      await get().recordFailedTransfer(
        sampleId,
        'inbound',
        ERROR_CODES.LOCATION_FULL,
        '目标库位已满',
        { sampleId, locationId, capacity: location.capacity, current: locationSamples.length }
      );
      set({ error: '目标库位已满' });
      return null;
    }

    const now = nowISO();
    const tx = db.transaction(
      [STORES.samples, STORES.transferRecords, STORES.auditLogs],
      'readwrite'
    );

    const updatedSample: Sample = {
      ...sample,
      currentStatus: 'in_stock',
      currentLocationId: locationId,
      currentHolderId: currentUser.id,
      updatedAt: now,
    };
    await tx.objectStore(STORES.samples).put(updatedSample);

    const transfer: TransferRecord = {
      id: generateId(),
      sampleId,
      type: 'inbound',
      fromStatus: 'imported',
      toStatus: 'in_stock',
      toLocationId: locationId,
      toHolderId: currentUser.id,
      operatorId: currentUser.id,
      operatedAt: now,
      remark,
      isRolledBack: false,
    };
    await tx.objectStore(STORES.transferRecords).add(transfer);

    const auditLog: AuditLog = {
      id: generateId(),
      timestamp: now,
      userId: currentUser.id,
      action: 'transfer:inbound',
      targetType: 'sample',
      targetId: sampleId,
      details: { sampleNo: sample.sampleNo, locationId, locationCode: location.code },
    };
    await tx.objectStore(STORES.auditLogs).add(auditLog);

    await tx.done;
    await get().getAllSamples();
    set({ error: null });
    return transfer;
  },

  performOutbound: async (sampleId, sourceLocationId, receiverId, remark) => {
    const currentUser = get().currentUser;
    if (!currentUser) return null;

    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);
    const receiver = await db.get(STORES.users, receiverId);

    if (!sample || !receiver) return null;

    const validation = validateOutbound({
      sample,
      sourceLocationId,
      operator: currentUser,
      receiver,
    });

    if (!validation.valid) {
      await get().recordFailedTransfer(
        sampleId,
        'outbound',
        validation.errorCode!,
        validation.errorMessage!,
        { sampleId, sourceLocationId, receiverId, remark }
      );
      set({ error: validation.errorMessage! });
      return null;
    }

    const now = nowISO();
    const tx = db.transaction(
      [STORES.samples, STORES.transferRecords, STORES.auditLogs],
      'readwrite'
    );

    const updatedSample: Sample = {
      ...sample,
      currentStatus: 'in_transit',
      currentLocationId: undefined,
      currentHolderId: receiverId,
      updatedAt: now,
    };
    await tx.objectStore(STORES.samples).put(updatedSample);

    const transfer: TransferRecord = {
      id: generateId(),
      sampleId,
      type: 'outbound',
      fromStatus: 'in_stock',
      toStatus: 'in_transit',
      fromLocationId: sourceLocationId,
      fromHolderId: sample.currentHolderId,
      toHolderId: receiverId,
      operatorId: currentUser.id,
      operatedAt: now,
      remark,
      isRolledBack: false,
    };
    await tx.objectStore(STORES.transferRecords).add(transfer);

    const auditLog: AuditLog = {
      id: generateId(),
      timestamp: now,
      userId: currentUser.id,
      action: 'transfer:outbound',
      targetType: 'sample',
      targetId: sampleId,
      details: { sampleNo: sample.sampleNo, sourceLocationId, receiverId, receiverName: receiver.displayName },
    };
    await tx.objectStore(STORES.auditLogs).add(auditLog);

    await tx.done;
    await get().getAllSamples();
    set({ error: null });
    return transfer;
  },

  performTestReceive: async (sampleId, locationId, remark) => {
    const currentUser = get().currentUser;
    if (!currentUser) return null;

    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);
    const location = await db.get(STORES.locations, locationId);

    if (!sample || !location) return null;

    const validation = validateTestReceive({ sample, operator: currentUser, targetLocation: location });

    if (!validation.valid) {
      await get().recordFailedTransfer(
        sampleId,
        'test_receive',
        validation.errorCode!,
        validation.errorMessage!,
        { sampleId, locationId, remark }
      );
      set({ error: validation.errorMessage! });
      return null;
    }

    const now = nowISO();
    const tx = db.transaction(
      [STORES.samples, STORES.transferRecords, STORES.auditLogs],
      'readwrite'
    );

    const updatedSample: Sample = {
      ...sample,
      currentStatus: 'testing',
      currentLocationId: locationId,
      currentHolderId: currentUser.id,
      updatedAt: now,
    };
    await tx.objectStore(STORES.samples).put(updatedSample);

    const transfer: TransferRecord = {
      id: generateId(),
      sampleId,
      type: 'test_receive',
      fromStatus: 'in_transit',
      toStatus: 'testing',
      fromHolderId: sample.currentHolderId,
      toLocationId: locationId,
      toHolderId: currentUser.id,
      operatorId: currentUser.id,
      operatedAt: now,
      remark,
      isRolledBack: false,
    };
    await tx.objectStore(STORES.transferRecords).add(transfer);

    const auditLog: AuditLog = {
      id: generateId(),
      timestamp: now,
      userId: currentUser.id,
      action: 'transfer:test_receive',
      targetType: 'sample',
      targetId: sampleId,
      details: { sampleNo: sample.sampleNo, locationId, locationCode: location.code },
    };
    await tx.objectStore(STORES.auditLogs).add(auditLog);

    await tx.done;
    await get().getAllSamples();
    set({ error: null });
    return transfer;
  },

  performTestComplete: async (sampleId, testResult, remark) => {
    const currentUser = get().currentUser;
    if (!currentUser) return null;

    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);

    if (!sample) return null;

    const validation = validateTestComplete({ sample, operator: currentUser });

    if (!validation.valid) {
      await get().recordFailedTransfer(
        sampleId,
        'test_complete',
        validation.errorCode!,
        validation.errorMessage!,
        { sampleId, testResult, remark }
      );
      set({ error: validation.errorMessage! });
      return null;
    }

    const now = nowISO();
    const tx = db.transaction(
      [STORES.samples, STORES.transferRecords, STORES.auditLogs],
      'readwrite'
    );

    const updatedSample: Sample = {
      ...sample,
      currentStatus: 'tested',
      updatedAt: now,
    };
    await tx.objectStore(STORES.samples).put(updatedSample);

    const transfer: TransferRecord = {
      id: generateId(),
      sampleId,
      type: 'test_complete',
      fromStatus: 'testing',
      toStatus: 'tested',
      fromHolderId: sample.currentHolderId,
      toHolderId: currentUser.id,
      operatorId: currentUser.id,
      operatedAt: now,
      remark,
      testResult,
      isRolledBack: false,
    };
    await tx.objectStore(STORES.transferRecords).add(transfer);

    const auditLog: AuditLog = {
      id: generateId(),
      timestamp: now,
      userId: currentUser.id,
      action: 'transfer:test_complete',
      targetType: 'sample',
      targetId: sampleId,
      details: { sampleNo: sample.sampleNo, testResult },
    };
    await tx.objectStore(STORES.auditLogs).add(auditLog);

    await tx.done;
    await get().getAllSamples();
    set({ error: null });
    return transfer;
  },

  performReview: async (sampleId, remark) => {
    const currentUser = get().currentUser;
    if (!currentUser) return false;
    if (currentUser.role !== 'auditor' && currentUser.role !== 'admin') {
      set({ error: '只有审核员可以执行复核操作' });
      return false;
    }

    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);
    if (!sample) return false;

    if (sample.currentStatus !== 'tested') {
      set({ error: '只有检测完成的样本可以复核' });
      return false;
    }

    const now = nowISO();
    const updatedSample: Sample = {
      ...sample,
      reviewedBy: currentUser.id,
      reviewedAt: now,
      updatedAt: now,
    };
    await db.put(STORES.samples, updatedSample);

    await get().addAuditLog(
      'sample:review',
      'sample',
      { sampleNo: sample.sampleNo, remark },
      sampleId
    );
    await get().getAllSamples();
    set({ error: null });
    return true;
  },

  performArchive: async (sampleId, locationId, remark) => {
    const currentUser = get().currentUser;
    if (!currentUser) return null;

    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);
    const location = await db.get(STORES.locations, locationId);

    if (!sample || !location) return null;

    const validation = validateArchive({
      sample,
      operator: currentUser,
      reviewer: currentUser,
    });

    if (!validation.valid) {
      await get().recordFailedTransfer(
        sampleId,
        'archive',
        validation.errorCode!,
        validation.errorMessage!,
        { sampleId, locationId, remark }
      );
      set({ error: validation.errorMessage! });
      return null;
    }

    const now = nowISO();
    const tx = db.transaction(
      [STORES.samples, STORES.transferRecords, STORES.auditLogs],
      'readwrite'
    );

    const updatedSample: Sample = {
      ...sample,
      currentStatus: 'archived',
      currentLocationId: locationId,
      currentHolderId: currentUser.id,
      isArchived: true,
      archivedAt: now,
      updatedAt: now,
    };
    await tx.objectStore(STORES.samples).put(updatedSample);

    const transfer: TransferRecord = {
      id: generateId(),
      sampleId,
      type: 'archive',
      fromStatus: 'tested',
      toStatus: 'archived',
      fromLocationId: sample.currentLocationId,
      toLocationId: locationId,
      operatorId: currentUser.id,
      operatedAt: now,
      remark,
      isRolledBack: false,
    };
    await tx.objectStore(STORES.transferRecords).add(transfer);

    const auditLog: AuditLog = {
      id: generateId(),
      timestamp: now,
      userId: currentUser.id,
      action: 'transfer:archive',
      targetType: 'sample',
      targetId: sampleId,
      details: { sampleNo: sample.sampleNo, locationId, locationCode: location.code },
    };
    await tx.objectStore(STORES.auditLogs).add(auditLog);

    await tx.done;
    await get().getAllSamples();
    set({ error: null });
    return transfer;
  },

  performRollback: async (transferRecordId, reason) => {
    const currentUser = get().currentUser;
    if (!currentUser) return null;

    const db = await getDB();
    const targetTransfer = await db.get(STORES.transferRecords, transferRecordId);

    if (!targetTransfer) {
      set({ error: '目标交接记录不存在' });
      return null;
    }

    const sample = await db.get(STORES.samples, targetTransfer.sampleId);
    if (!sample) return null;

    const validation = validateRollback({ sample, targetTransfer, operator: currentUser });

    if (!validation.valid) {
      await get().recordFailedTransfer(
        targetTransfer.sampleId,
        'rollback',
        validation.errorCode!,
        validation.errorMessage!,
        { transferRecordId, reason }
      );
      set({ error: validation.errorMessage! });
      return null;
    }

    const sampleTransfers = await (
      await db.transaction(STORES.transferRecords).store.index('by-sampleId')
    ).getAll(targetTransfer.sampleId);
    const sortedTransfers = sampleTransfers.sort((a, b) =>
      a.operatedAt.localeCompare(b.operatedAt)
    );
    const targetIndex = sortedTransfers.findIndex((t) => t.id === transferRecordId);

    if (targetIndex < 0) {
      set({ error: '目标交接记录未找到' });
      return null;
    }

    const prevTransfer = targetIndex > 0 ? sortedTransfers[targetIndex - 1] : null;
    const rollbackToStatus: SampleStatus = prevTransfer ? prevTransfer.toStatus : 'imported';
    const now = nowISO();

    const tx = db.transaction(
      [STORES.samples, STORES.transferRecords, STORES.auditLogs],
      'readwrite'
    );

    const updatedTargetTransfer: TransferRecord = {
      ...targetTransfer,
      isRolledBack: true,
      rolledBackBy: currentUser.id,
      rolledBackAt: now,
      rollbackReason: reason,
    };
    await tx.objectStore(STORES.transferRecords).put(updatedTargetTransfer);

    const updatedSample: Sample = {
      ...sample,
      currentStatus: rollbackToStatus,
      currentLocationId: prevTransfer?.toLocationId ?? undefined,
      currentHolderId: prevTransfer?.toHolderId ?? undefined,
      isArchived: false,
      archivedAt: undefined,
      reviewedBy: undefined,
      reviewedAt: undefined,
      updatedAt: now,
    };
    await tx.objectStore(STORES.samples).put(updatedSample);

    const rollbackRecord: TransferRecord = {
      id: generateId(),
      sampleId: sample.id,
      type: 'rollback',
      fromStatus: targetTransfer.toStatus,
      toStatus: rollbackToStatus,
      fromLocationId: targetTransfer.toLocationId,
      toLocationId: prevTransfer?.toLocationId,
      fromHolderId: targetTransfer.toHolderId,
      toHolderId: prevTransfer?.toHolderId,
      operatorId: currentUser.id,
      operatedAt: now,
      remark: `回退交接记录: ${transferRecordId}，原因: ${reason}`,
      isRolledBack: false,
      rollbackToRecordId: prevTransfer?.id,
    };
    await tx.objectStore(STORES.transferRecords).add(rollbackRecord);

    const auditLog: AuditLog = {
      id: generateId(),
      timestamp: now,
      userId: currentUser.id,
      action: 'transfer:rollback',
      targetType: 'transfer',
      targetId: transferRecordId,
      details: {
        sampleId: sample.id,
        sampleNo: sample.sampleNo,
        rolledBackTransferType: targetTransfer.type,
        rollbackToStatus,
        reason,
      },
    };
    await tx.objectStore(STORES.auditLogs).add(auditLog);

    await tx.done;
    await get().getAllSamples();
    set({ error: null });
    return rollbackRecord;
  },

  exportAuditData: async (format, filter) => {
    const db = await getDB();
    const allTransfers = await db.getAll(STORES.transferRecords);
    const allSamples = await db.getAll(STORES.samples);
    const allUsers = await db.getAll(STORES.users);
    const allLocations = await db.getAll(STORES.locations);
    const allFailedTransfers = await db.getAll(STORES.failedTransfers);
    const allAuditLogs = await get().getAuditLogs(filter);

    const sampleMap = new Map(allSamples.map((s) => [s.id, s]));
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const locationMap = new Map(allLocations.map((l) => [l.id, l]));

    const timeline = allTransfers
      .map((t) => ({
        id: t.id,
        sampleNo: sampleMap.get(t.sampleId)?.sampleNo ?? t.sampleId,
        sampleId: t.sampleId,
        transferType: t.type,
        fromStatus: t.fromStatus,
        toStatus: t.toStatus,
        fromLocation: t.fromLocationId ? locationMap.get(t.fromLocationId)?.code : '-',
        toLocation: t.toLocationId ? locationMap.get(t.toLocationId)?.code : '-',
        fromHolder: t.fromHolderId ? userMap.get(t.fromHolderId)?.displayName : '-',
        toHolder: t.toHolderId ? userMap.get(t.toHolderId)?.displayName : '-',
        operator: userMap.get(t.operatorId)?.displayName ?? t.operatorId,
        operatedAt: t.operatedAt,
        testResult: t.testResult ?? '',
        remark: t.remark ?? '',
        isRolledBack: t.isRolledBack,
        rolledBackBy: t.rolledBackBy ? userMap.get(t.rolledBackBy)?.displayName : '',
        rolledBackAt: t.rolledBackAt ?? '',
        rollbackReason: t.rollbackReason ?? '',
        rollbackToRecordId: t.rollbackToRecordId ?? '',
      }))
      .sort((a, b) => a.operatedAt.localeCompare(b.operatedAt));

    const failedTimeline = allFailedTransfers.map((f) => ({
      id: f.id,
      sampleNo: sampleMap.get(f.sampleId)?.sampleNo ?? (f.payload.sampleNo as string) ?? f.sampleId,
      attemptedType: f.attemptedType,
      attemptedAt: f.attemptedAt,
      attemptedBy: userMap.get(f.attemptedBy)?.displayName ?? f.attemptedBy,
      errorCode: f.errorCode,
      errorMessage: f.errorMessage,
      resolved: f.resolved,
      resolvedBy: f.resolvedBy ? userMap.get(f.resolvedBy)?.displayName : '',
      resolvedAt: f.resolvedAt ?? '',
    }));

    if (format === 'json') {
      return JSON.stringify(
        {
          exportedAt: nowISO(),
          filter: filter ?? {},
          transfers: timeline,
          failedTransfers: failedTimeline,
          auditLogs: allAuditLogs,
        },
        null,
        2
      );
    }

    const headers = [
      '操作时间',
      '样本编号',
      '操作类型',
      '原状态',
      '新状态',
      '原库位',
      '新库位',
      '原持有人',
      '新持有人',
      '操作人',
      '检测结果',
      '备注',
      '是否已回退',
      '回退人',
      '回退时间',
      '回退原因',
      '回退至记录ID',
    ];
    const csvRows = [headers];
    for (const t of timeline) {
      csvRows.push([
        t.operatedAt,
        t.sampleNo,
        t.transferType,
        t.fromStatus ?? '',
        t.toStatus,
        t.fromLocation,
        t.toLocation,
        t.fromHolder,
        t.toHolder,
        t.operator,
        t.testResult,
        t.remark,
        t.isRolledBack ? '是' : '否',
        t.rolledBackBy,
        t.rolledBackAt,
        t.rollbackReason,
        t.rollbackToRecordId,
      ]);
    }

    csvRows.push([]);
    csvRows.push(['=== 失败记录 ===']);
    const failedHeaders = [
      '尝试时间',
      '样本编号',
      '尝试操作',
      '尝试人',
      '错误码',
      '错误信息',
      '是否已解决',
      '解决人',
      '解决时间',
    ];
    csvRows.push(failedHeaders);
    for (const f of failedTimeline) {
      csvRows.push([
        f.attemptedAt,
        f.sampleNo,
        f.attemptedType,
        f.attemptedBy,
        f.errorCode,
        f.errorMessage,
        f.resolved ? '是' : '否',
        f.resolvedBy,
        f.resolvedAt,
      ]);
    }

    return Papa.unparse(csvRows);
  },

  getSampleById: (id) => get().samples.find((s) => s.id === id),
  getLocationById: (id) => get().locations.find((l) => l.id === id),
  getUserById: (id) => get().users.find((u) => u.id === id),

  addAuditLog: async (action, targetType, details, targetId) => {
    const currentUser = get().currentUser;
    if (!currentUser) return;

    const db = await getDB();
    const log: AuditLog = {
      id: generateId(),
      timestamp: nowISO(),
      userId: currentUser.id,
      action,
      targetType,
      targetId,
      details,
    };
    await db.add(STORES.auditLogs, log);
  },

  recordFailedTransfer: async (sampleId, attemptedType, errorCode, errorMessage, payload) => {
    const currentUser = get().currentUser;
    if (!currentUser) return;

    const db = await getDB();
    const failed: FailedTransfer = {
      id: generateId(),
      sampleId,
      attemptedType,
      attemptedAt: nowISO(),
      attemptedBy: currentUser.id,
      errorCode,
      errorMessage,
      payload,
      resolved: false,
    };
    await db.add(STORES.failedTransfers, failed);
    await get().getFailedTransfers();
  },
}));
