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
  ArchiveReviewData,
  ArchiveReviewTimelineItem,
  ArchiveReviewExportOptions,
} from '@shared/types';
import { getDB, generateId, nowISO } from '../lib/db';
import { createInitialUsers, createInitialLocations } from '../lib/seed';
import {
  SESSION_KEY,
  hashPassword,
  ERROR_CODES,
  STORES,
  TRANSFER_TYPE_LABELS,
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

  getArchiveReviewData: (sampleId: string) => Promise<ArchiveReviewData | null>;
  exportArchiveReviewData: (
    sampleId: string,
    options: ArchiveReviewExportOptions
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

    set({ currentUser: user, error: null });
    await get().addAuditLog('login', 'user', { username }, user.id);
    await get().getAllUsers();
    await get().getAllLocations();
    await get().getAllSamples();
    await get().getAllBatches();
    await get().getFailedTransfers();
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
    
    const typePriority: Record<TransferType, number> = {
      import: 0,
      inbound: 1,
      outbound: 2,
      test_receive: 3,
      test_complete: 4,
      archive: 5,
      rollback: 6,
    };
    
    const sortedTransfers = sampleTransfers.sort((a, b) => {
      const timeCompare = a.operatedAt.localeCompare(b.operatedAt);
      if (timeCompare !== 0) return timeCompare;
      const priorityA = typePriority[a.type] ?? 100;
      const priorityB = typePriority[b.type] ?? 100;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.id.localeCompare(b.id);
    });
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

  getArchiveReviewData: async (sampleId) => {
    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);
    if (!sample) return null;

    const allTransfers = await (
      await db.transaction(STORES.transferRecords).store.index('by-sampleId')
    ).getAll(sampleId);
    
    const typePriority: Record<TransferType, number> = {
      import: 0,
      inbound: 1,
      outbound: 2,
      test_receive: 3,
      test_complete: 4,
      archive: 5,
      rollback: 6,
    };
    
    const sortedTransfers = allTransfers.sort((a, b) => {
      const timeCompare = a.operatedAt.localeCompare(b.operatedAt);
      if (timeCompare !== 0) return timeCompare;
      const priorityA = typePriority[a.type] ?? 100;
      const priorityB = typePriority[b.type] ?? 100;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.id.localeCompare(b.id);
    });

    const allFailedRaw = await db.getAll(STORES.failedTransfers);
    const sortedFailed = allFailedRaw
      .filter((f) => {
        if (f.sampleId === sampleId) return true;
        if (f.sampleId === '' && f.payload?.sampleNo === sample.sampleNo) return true;
        return false;
      })
      .sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));

    const allUsers = await db.getAll(STORES.users);
    const allLocations = await db.getAll(STORES.locations);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const locationMap = new Map(allLocations.map((l) => [l.id, l]));

    const getUserInfo = (userId?: string) => {
      if (!userId) return { name: '-', role: '-' };
      const user = userMap.get(userId);
      return {
        name: user?.displayName || userId,
        role: user?.role || '-',
      };
    };

    const getLocationCode = (locationId?: string) => {
      if (!locationId) return '-';
      return locationMap.get(locationId)?.code || locationId;
    };

    const archiveTransfer = sortedTransfers.find((t) => t.type === 'archive') || null;
    const reviewAuditLog = (await db.getAll(STORES.auditLogs)).find(
      (l) => l.action === 'sample:review' && l.targetId === sampleId
    );

    const timeline: ArchiveReviewTimelineItem[] = [];

    for (const transfer of sortedTransfers) {
      const operator = getUserInfo(transfer.operatorId);
      const rolledBy = transfer.rolledBackBy ? getUserInfo(transfer.rolledBackBy) : null;

      timeline.push({
        id: transfer.id,
        type: transfer.type === 'rollback' ? 'rollback' : 'transfer',
        timestamp: transfer.operatedAt,
        operatorName: operator.name,
        operatorRole: operator.role,
        action: TRANSFER_TYPE_LABELS[transfer.type],
        status: transfer.fromStatus
          ? `${transfer.fromStatus} → ${transfer.toStatus}`
          : transfer.toStatus,
        location:
          transfer.fromLocationId || transfer.toLocationId
            ? `${getLocationCode(transfer.fromLocationId)} → ${getLocationCode(transfer.toLocationId)}`
            : undefined,
        holder:
          transfer.fromHolderId || transfer.toHolderId
            ? `${getUserInfo(transfer.fromHolderId).name} → ${getUserInfo(transfer.toHolderId).name}`
            : undefined,
        testResult: transfer.testResult,
        remark: transfer.remark,
        isRolledBack: transfer.isRolledBack,
        rollbackReason: transfer.rollbackReason,
        rollbackBy: rolledBy?.name,
        rollbackAt: transfer.rolledBackAt,
      });
    }

    if (sample.reviewedBy && sample.reviewedAt) {
      const reviewer = getUserInfo(sample.reviewedBy);
      timeline.push({
        id: `review-${sample.id}`,
        type: 'review',
        timestamp: sample.reviewedAt,
        operatorName: reviewer.name,
        operatorRole: reviewer.role,
        action: '样本复核',
        status: 'tested → reviewed',
        remark: reviewAuditLog?.details?.remark as string | undefined,
      });
    }

    for (const failed of sortedFailed) {
      const attemptor = getUserInfo(failed.attemptedBy);
      timeline.push({
        id: `failed-${failed.id}`,
        type: 'failed',
        timestamp: failed.attemptedAt,
        operatorName: attemptor.name,
        operatorRole: attemptor.role,
        action: `失败: ${TRANSFER_TYPE_LABELS[failed.attemptedType]}`,
        errorCode: failed.errorCode,
        errorMessage: failed.errorMessage,
        payload: failed.payload,
      });
    }

    timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const failedTransfersList = sortedFailed.map((f) => ({
      id: f.id,
      attemptedType: f.attemptedType,
      attemptedAt: f.attemptedAt,
      attemptedByName: getUserInfo(f.attemptedBy).name,
      errorCode: f.errorCode,
      errorMessage: f.errorMessage,
      resolved: f.resolved,
    }));

    const rollbackRecordsList = sortedTransfers
      .filter((t) => t.type === 'rollback')
      .map((t) => {
        const rollbackInfo = getUserInfo(t.operatorId);
        const rolledBackType = t.remark?.includes('回退交接记录')
          ? (t.remark.match(/回退交接记录: (\w+)/)?.[1] as TransferType) || 'import'
          : 'import';
        const rolledBackRecordId = t.remark?.match(/回退交接记录: (\w+)/)?.[1];
        const rolledBackRecord = rolledBackRecordId
          ? sortedTransfers.find((st) => st.id === rolledBackRecordId)
          : null;
        const reason = rolledBackRecord?.rollbackReason
          || t.remark?.match(/原因: (.+)$/)?.[1]
          || '';
        return {
          id: t.id,
          rollbackAt: t.operatedAt,
          rollbackByName: rollbackInfo.name,
          reason,
          rolledBackTransferType: rolledBackType,
          fromStatus: t.fromStatus || 'imported',
          toStatus: t.toStatus,
        };
      });

    const archivedByUser = archiveTransfer ? getUserInfo(archiveTransfer.operatorId) : null;
    const reviewedByUser = sample.reviewedBy ? getUserInfo(sample.reviewedBy) : null;

    const summary = {
      totalTransfers: sortedTransfers.length,
      successfulTransfers: sortedTransfers.filter((t) => !t.isRolledBack).length,
      failedAttempts: sortedFailed.length,
      rollbackCount: rollbackRecordsList.length,
      archiveAttempts: sortedTransfers.filter((t) => t.type === 'archive').length,
      lastArchiveAt: sortedTransfers
        .filter((t) => t.type === 'archive')
        .sort((a, b) => b.operatedAt.localeCompare(a.operatedAt))[0]?.operatedAt,
      lastRollbackAt: sortedTransfers
        .filter((t) => t.type === 'rollback')
        .sort((a, b) => b.operatedAt.localeCompare(a.operatedAt))[0]?.operatedAt,
    };

    let isLocked = false;
    let lockReason: string | undefined;

    if (sample.isArchived) {
      isLocked = true;
      lockReason = '样本已归档，所有操作被锁定';
    }

    return {
      sample: {
        id: sample.id,
        sampleNo: sample.sampleNo,
        type: sample.type,
        currentStatus: sample.currentStatus,
        isArchived: sample.isArchived,
        archivedAt: sample.archivedAt,
        archivedBy: archivedByUser?.name,
        reviewedBy: reviewedByUser?.name,
        reviewedAt: sample.reviewedAt,
        isLocked,
        lockReason,
      },
      archiveTransfer,
      timeline,
      failedTransfers: failedTransfersList,
      rollbackRecords: rollbackRecordsList,
      summary,
    };
  },

  exportArchiveReviewData: async (sampleId, options) => {
    const reviewData = await get().getArchiveReviewData(sampleId);
    if (!reviewData) throw new Error('样本不存在或无复盘数据');

    const { format, includeFullTimeline = true, includeFailedRecords = true, includeRollbackRecords = true } = options;

    const exportData = {
      exportedAt: nowISO(),
      sample: reviewData.sample,
      summary: reviewData.summary,
      timeline: includeFullTimeline ? reviewData.timeline : undefined,
      failedTransfers: includeFailedRecords ? reviewData.failedTransfers : undefined,
      rollbackRecords: includeRollbackRecords ? reviewData.rollbackRecords : undefined,
    };

    if (format === 'json') {
      return JSON.stringify(exportData, null, 2);
    }

    const csvRows: string[][] = [];

    csvRows.push(['=== 样本归档复盘报告 ===']);
    csvRows.push(['导出时间', exportData.exportedAt]);
    csvRows.push([]);

    csvRows.push(['=== 样本基本信息 ===']);
    csvRows.push(['样本编号', reviewData.sample.sampleNo]);
    csvRows.push(['样本类型', reviewData.sample.type]);
    csvRows.push(['当前状态', reviewData.sample.currentStatus]);
    csvRows.push(['是否归档', reviewData.sample.isArchived ? '是' : '否']);
    if (reviewData.sample.archivedAt) {
      csvRows.push(['归档时间', reviewData.sample.archivedAt]);
      csvRows.push(['归档人', reviewData.sample.archivedBy || '-']);
    }
    if (reviewData.sample.reviewedAt) {
      csvRows.push(['复核时间', reviewData.sample.reviewedAt]);
      csvRows.push(['复核人', reviewData.sample.reviewedBy || '-']);
    }
    csvRows.push(['是否锁定', reviewData.sample.isLocked ? '是' : '否']);
    if (reviewData.sample.lockReason) {
      csvRows.push(['锁定原因', reviewData.sample.lockReason]);
    }
    csvRows.push([]);

    csvRows.push(['=== 统计摘要 ===']);
    csvRows.push(['总流转次数', String(reviewData.summary.totalTransfers)]);
    csvRows.push(['成功流转次数', String(reviewData.summary.successfulTransfers)]);
    csvRows.push(['失败尝试次数', String(reviewData.summary.failedAttempts)]);
    csvRows.push(['回退次数', String(reviewData.summary.rollbackCount)]);
    csvRows.push(['归档尝试次数', String(reviewData.summary.archiveAttempts)]);
    if (reviewData.summary.lastArchiveAt) {
      csvRows.push(['最后归档时间', reviewData.summary.lastArchiveAt]);
    }
    if (reviewData.summary.lastRollbackAt) {
      csvRows.push(['最后回退时间', reviewData.summary.lastRollbackAt]);
    }
    csvRows.push([]);

    if (includeFullTimeline && reviewData.timeline.length > 0) {
      csvRows.push(['=== 完整时间线 ===']);
      csvRows.push([
        '时间',
        '类型',
        '操作',
        '操作人',
        '角色',
        '状态变更',
        '库位变更',
        '持有人变更',
        '检测结果',
        '备注',
        '是否回退',
        '回退原因',
        '错误码',
        '错误信息',
      ]);
      for (const item of reviewData.timeline) {
        csvRows.push([
          item.timestamp,
          item.type,
          item.action,
          item.operatorName,
          item.operatorRole,
          item.status || '',
          item.location || '',
          item.holder || '',
          item.testResult || '',
          item.remark || '',
          item.isRolledBack ? '是' : '否',
          item.rollbackReason || '',
          item.errorCode || '',
          item.errorMessage || '',
        ]);
      }
      csvRows.push([]);
    }

    if (includeFailedRecords) {
      csvRows.push(['=== 失败记录 ===']);
      if (reviewData.failedTransfers.length > 0) {
        csvRows.push([
          '尝试时间',
          '尝试操作',
          '尝试人',
          '错误码',
          '错误信息',
          '是否已解决',
        ]);
        for (const f of reviewData.failedTransfers) {
          csvRows.push([
            f.attemptedAt,
            TRANSFER_TYPE_LABELS[f.attemptedType],
            f.attemptedByName,
            f.errorCode,
            f.errorMessage,
            f.resolved ? '是' : '否',
          ]);
        }
      } else {
        csvRows.push(['无失败记录']);
      }
      csvRows.push([]);
    }

    if (includeRollbackRecords) {
      csvRows.push(['=== 回退记录 ===']);
      if (reviewData.rollbackRecords.length > 0) {
        csvRows.push([
          '回退时间',
          '回退人',
          '回退原因',
          '被回退操作',
          '从状态',
          '到状态',
        ]);
        for (const r of reviewData.rollbackRecords) {
          csvRows.push([
            r.rollbackAt,
            r.rollbackByName,
            r.reason,
            TRANSFER_TYPE_LABELS[r.rolledBackTransferType],
            r.fromStatus,
            r.toStatus,
          ]);
        }
      } else {
        csvRows.push(['无回退记录']);
      }
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
