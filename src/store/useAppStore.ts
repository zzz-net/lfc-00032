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
  FlowTraceSampleSummary,
  FlowTraceDetailData,
  FlowTraceExportOptions,
  FlowTraceFilter,
  FlowTraceStageKey,
  FlowTracePermissionAction,
  FlowTracePermissionEnvelope,
  FlowTraceOperationLog,
  FlowTracePermissionCheck,
} from '@shared/types';
import { getDB, generateId, nowISO } from '../lib/db';
import { createInitialUsers, createInitialLocations } from '../lib/seed';
import {
  SESSION_KEY,
  hashPassword,
  ERROR_CODES,
  STORES,
  TRANSFER_TYPE_LABELS,
  ERROR_CATEGORIES,
  FLOW_TRACE_STAGE_LABELS,
  FLOW_TRACE_STAGE_ORDER,
  STATUS_TO_STAGE,
  STATUS_LABELS,
  ROLE_LABELS,
} from '@shared/constants';
import {
  validateInbound,
  validateOutbound,
  validateTestReceive,
  validateTestComplete,
  validateArchive,
  validateRollback,
} from '../services/transferValidator';
import {
  checkFlowTracePermission,
  checkServiceRestartReauth,
  checkPermissionMidOperation,
  acquireExportSlot,
  releaseExportSlot,
  redactSampleSummary,
  redactDetailData,
  redactExportData,
  createOperationLog,
  isAuditorRole,
  wrapWithPermissionEnvelope,
  revokePermission,
  restorePermission,
  getOperationLogs,
  getServiceStatus,
} from '../services/flowTracePermissionService';
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

  getFlowTraceList: (filter?: FlowTraceFilter) => Promise<FlowTraceSampleSummary[]>;
  getFlowTraceListSecure: (filter?: FlowTraceFilter) => Promise<FlowTracePermissionEnvelope<FlowTraceSampleSummary[]>>;
  getFlowTraceData: (sampleId: string) => Promise<FlowTraceDetailData | null>;
  getFlowTraceDataSecure: (sampleId: string) => Promise<FlowTracePermissionEnvelope<FlowTraceDetailData>>;
  exportFlowTraceData: (
    sampleId: string,
    options: FlowTraceExportOptions
  ) => Promise<string | Blob>;
  exportFlowTraceDataSecure: (
    sampleId: string,
    options: FlowTraceExportOptions
  ) => Promise<FlowTracePermissionEnvelope<string>>;
  getFlowTraceOperationLogs: () => FlowTraceOperationLog[];
  getFlowTraceServiceStatus: () => ReturnType<typeof getServiceStatus>;
  revokeFlowTracePermission: (userId: string, reason: string) => void;
  restoreFlowTracePermission: (userId: string) => void;

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

    if (importedCount > 0 || failedRows.length > 0) {
      const sampleIds: string[] = [];
      const tx = db.transaction(
        [STORES.batches, STORES.samples, STORES.transferRecords, STORES.auditLogs, STORES.failedTransfers],
        'readwrite'
      );

      try {
        if (importedCount > 0) {
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
        }

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

  getFlowTraceList: async (filter) => {
    const db = await getDB();
    const allSamples = await db.getAll(STORES.samples);
    const allBatches = await db.getAll(STORES.batches);
    const allTransfers = await db.getAll(STORES.transferRecords);
    const allFailed = await db.getAll(STORES.failedTransfers);
    const allLocations = await db.getAll(STORES.locations);

    const batchMap = new Map(allBatches.map((b) => [b.id, b]));
    const locationMap = new Map(allLocations.map((l) => [l.id, l]));

    const transferMap = new Map<string, TransferRecord[]>();
    const failedMap = new Map<string, FailedTransfer[]>();

    for (const t of allTransfers) {
      if (!transferMap.has(t.sampleId)) transferMap.set(t.sampleId, []);
      transferMap.get(t.sampleId)!.push(t);
    }

    for (const f of allFailed) {
      const key = f.sampleId || (f.payload?.sampleNo as string) || '';
      if (!failedMap.has(key)) failedMap.set(key, []);
      failedMap.get(key)!.push(f);
    }

    const typePriority: Record<TransferType, number> = {
      import: 0,
      inbound: 1,
      outbound: 2,
      test_receive: 3,
      test_complete: 4,
      archive: 5,
      rollback: 6,
    };

    const summaries: FlowTraceSampleSummary[] = [];

    for (const sample of allSamples) {
      const batch = batchMap.get(sample.batchId);
      const sampleTransfers = transferMap.get(sample.id) || [];
      const sampleFailed = failedMap.get(sample.id) || failedMap.get(sample.sampleNo) || [];

      const sortedTransfers = [...sampleTransfers].sort((a, b) => {
        const timeCompare = a.operatedAt.localeCompare(b.operatedAt);
        if (timeCompare !== 0) return timeCompare;
        const priorityA = typePriority[a.type] ?? 100;
        const priorityB = typePriority[b.type] ?? 100;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.id.localeCompare(b.id);
      });

      const validTransfers = sortedTransfers.filter((t) => !t.isRolledBack && t.type !== 'rollback');
      const rollbackCount = sortedTransfers.filter((t) => t.type === 'rollback').length;
      const lastTransfer = sortedTransfers.length > 0 ? sortedTransfers[sortedTransfers.length - 1] : null;

      const currentStage = (STATUS_TO_STAGE[sample.currentStatus] || 'import') as FlowTraceStageKey;

      let isLocked = false;
      let lockReason: string | undefined;

      if (sample.isArchived) {
        isLocked = true;
        lockReason = '样本已归档，所有操作被锁定';
      }

      const hasBlockedOps = sampleFailed.some((f) => !f.resolved);

      summaries.push({
        id: sample.id,
        sampleNo: sample.sampleNo,
        type: sample.type,
        batchNo: batch?.batchNo || '-',
        currentStatus: sample.currentStatus,
        currentStage,
        isArchived: sample.isArchived,
        isLocked,
        lockReason,
        lastTransferAt: lastTransfer?.operatedAt,
        failedAttempts: sampleFailed.length,
        rollbackCount,
        hasBlockedOps,
      });
    }

    summaries.sort((a, b) => {
      const aTime = a.lastTransferAt || '';
      const bTime = b.lastTransferAt || '';
      return bTime.localeCompare(aTime);
    });

    if (filter) {
      let filtered = summaries;

      if (filter.keyword) {
        const kw = filter.keyword.toLowerCase();
        filtered = filtered.filter(
          (s) =>
            s.sampleNo.toLowerCase().includes(kw) ||
            s.batchNo.toLowerCase().includes(kw) ||
            s.type.toLowerCase().includes(kw)
        );
      }

      if (filter.status) {
        filtered = filtered.filter((s) => s.currentStatus === filter.status);
      }

      if (filter.hasFailed) {
        filtered = filtered.filter((s) => s.failedAttempts > 0);
      }

      if (filter.hasRollback) {
        filtered = filtered.filter((s) => s.rollbackCount > 0);
      }

      if (filter.isLocked) {
        filtered = filtered.filter((s) => s.isLocked);
      }

      if (filter.isArchived !== undefined) {
        filtered = filtered.filter((s) => s.isArchived === filter.isArchived);
      }

      return filtered;
    }

    return summaries;
  },

  getFlowTraceListSecure: async (filter) => {
    const currentUser = get().currentUser;
    const operationStartAt = nowISO();

    const restartCheck = checkServiceRestartReauth(currentUser);
    if (restartCheck) {
      createOperationLog({
        user: currentUser,
        action: 'viewList',
        status: 'denied',
        permissionDecision: 'deny',
        denyReason: restartCheck.reason,
        errorCode: restartCheck.errorCode,
      });
      return wrapWithPermissionEnvelope<FlowTraceSampleSummary[]>(null, restartCheck);
    }

    const permCheck = checkFlowTracePermission(currentUser, 'viewList');

    if (permCheck.decision === 'deny') {
      createOperationLog({
        user: currentUser,
        action: 'viewList',
        status: 'denied',
        permissionDecision: 'deny',
        denyReason: permCheck.reason,
        errorCode: permCheck.errorCode,
      });
      return wrapWithPermissionEnvelope<FlowTraceSampleSummary[]>(null, permCheck);
    }

    const midCheck = checkPermissionMidOperation(currentUser, 'viewList', operationStartAt);
    if (midCheck) {
      createOperationLog({
        user: currentUser,
        action: 'viewList',
        status: 'denied',
        permissionDecision: 'deny',
        denyReason: midCheck.reason,
        errorCode: midCheck.errorCode,
      });
      return wrapWithPermissionEnvelope<FlowTraceSampleSummary[]>(null, midCheck);
    }

    try {
      const rawData = await get().getFlowTraceList(filter);
      const isAuditor = currentUser ? isAuditorRole(currentUser.role) : false;
      const { data, redaction } = redactSampleSummary(rawData, isAuditor);

      const status = redaction ? 'redacted' : 'success';
      createOperationLog({
        user: currentUser,
        action: 'viewList',
        status,
        permissionDecision: permCheck.decision,
        dataSize: data.length,
      });

      return wrapWithPermissionEnvelope<FlowTraceSampleSummary[]>(data, permCheck, redaction);
    } catch (e) {
      createOperationLog({
        user: currentUser,
        action: 'viewList',
        status: 'error',
        permissionDecision: permCheck.decision,
        errorCode: 'UNKNOWN_ERROR',
        denyReason: e instanceof Error ? e.message : '未知错误',
      });
      return wrapWithPermissionEnvelope<FlowTraceSampleSummary[]>(null, {
        ...permCheck,
        decision: 'deny',
        reason: e instanceof Error ? e.message : '未知错误',
        errorCode: 'UNKNOWN_ERROR',
      });
    }
  },

  getFlowTraceData: async (sampleId) => {
    const db = await getDB();
    const sample = await db.get(STORES.samples, sampleId);
    if (!sample) return null;

    const allBatches = await db.getAll(STORES.batches);
    const allTransfers = await (
      await db.transaction(STORES.transferRecords).store.index('by-sampleId')
    ).getAll(sampleId);
    const allUsers = await db.getAll(STORES.users);
    const allLocations = await db.getAll(STORES.locations);
    const allFailedRaw = await db.getAll(STORES.failedTransfers);

    const batch = allBatches.find((b) => b.id === sample.batchId);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));
    const locationMap = new Map(allLocations.map((l) => [l.id, l]));

    const typePriority: Record<TransferType, number> = {
      import: 0,
      inbound: 1,
      outbound: 2,
      test_receive: 3,
      test_complete: 4,
      archive: 5,
      rollback: 6,
    };

    const sortedTransfers = [...allTransfers].sort((a, b) => {
      const timeCompare = a.operatedAt.localeCompare(b.operatedAt);
      if (timeCompare !== 0) return timeCompare;
      const priorityA = typePriority[a.type] ?? 100;
      const priorityB = typePriority[b.type] ?? 100;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return a.id.localeCompare(b.id);
    });

    const sortedFailed = allFailedRaw
      .filter((f) => {
        if (f.sampleId === sampleId) return true;
        if (f.sampleId === '' && f.payload?.sampleNo === sample.sampleNo) return true;
        return false;
      })
      .sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));

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

    const getErrorCategory = (errorCode: string): 'permission' | 'status' | 'location' | 'duplicate' | 'other' => {
      return ERROR_CATEGORIES[errorCode] || 'other';
    };

    const stageToTransferType: Record<string, TransferType> = {
      import: 'import',
      inbound: 'inbound',
      outbound: 'outbound',
      test_receive: 'test_receive',
      test_complete: 'test_complete',
      archive: 'archive',
      rollback: 'rollback',
    };

    const buildBusinessChain = () => {
      const stages: FlowTraceDetailData['businessChain'] = [];

      const validTransfers = sortedTransfers.filter(
        (t) => t.type !== 'rollback' && !t.isRolledBack
      );

      const latestTransferByType = new Map<TransferType, TransferRecord>();
      for (const t of validTransfers) {
        latestTransferByType.set(t.type, t);
      }

      const currentStageKey = STATUS_TO_STAGE[sample.currentStatus] || 'import';

      for (const stageKey of FLOW_TRACE_STAGE_ORDER) {
        const transferType = stageToTransferType[stageKey] as TransferType;
        const transfer = latestTransferByType.get(transferType);
        const stageLabel = FLOW_TRACE_STAGE_LABELS[stageKey] || stageKey;

        let stageStatus: FlowTraceDetailData['businessChain'][0]['status'] = 'pending';
        let timestamp: string | undefined;
        let operatorName: string | undefined;
        let operatorRole: string | undefined;
        let location: string | undefined;
        let remark: string | undefined;
        let testResult: string | undefined;

        if (stageKey === 'review') {
          if (sample.reviewedBy && sample.reviewedAt) {
            stageStatus = currentStageKey === 'review' ? 'current' : 'completed';
            timestamp = sample.reviewedAt;
            const reviewer = getUserInfo(sample.reviewedBy);
            operatorName = reviewer.name;
            operatorRole = reviewer.role;
          } else if (sample.currentStatus === 'tested') {
            stageStatus = 'current';
          }
        } else if (transfer) {
          stageStatus = stageKey === currentStageKey ? 'current' : 'completed';
          timestamp = transfer.operatedAt;
          const operator = getUserInfo(transfer.operatorId);
          operatorName = operator.name;
          operatorRole = operator.role;
          location = transfer.toLocationId ? getLocationCode(transfer.toLocationId) : undefined;
          remark = transfer.remark;
          testResult = transfer.testResult;
        }

        const failedAttempts = sortedFailed.filter(
          (f) => f.attemptedType === transferType
        );
        if (failedAttempts.length > 0 && stageStatus === 'pending') {
          stageStatus = 'failed';
        }

        const rolledBackTransfers = sortedTransfers.filter(
          (t) => t.type === transferType && t.isRolledBack
        );
        const hasValidTransfer = sortedTransfers.some(
          (t) => t.type === transferType && !t.isRolledBack
        );
        const latestRolledBack = rolledBackTransfers[rolledBackTransfers.length - 1];

        if (stageStatus === 'pending' && latestRolledBack && !hasValidTransfer) {
          stageStatus = 'rolled_back';
        }

        stages.push({
          key: stageKey as FlowTraceStageKey,
          label: stageLabel,
          status: stageStatus,
          timestamp,
          operatorName,
          operatorRole,
          location,
          remark,
          testResult,
          isRolledBack: !hasValidTransfer && !!latestRolledBack,
          rollbackReason: latestRolledBack?.rollbackReason,
        });
      }

      return stages;
    };

    const buildLatestValidTransfer = (): FlowTraceDetailData['latestValidTransfer'] => {
      const validTransfers = sortedTransfers.filter(
        (t) => t.type !== 'rollback' && !t.isRolledBack
      );
      if (validTransfers.length === 0) return null;

      const latest = validTransfers[validTransfers.length - 1];
      const operator = getUserInfo(latest.operatorId);

      return {
        type: latest.type,
        timestamp: latest.operatedAt,
        operatorName: operator.name,
        fromStatus: latest.fromStatus,
        toStatus: latest.toStatus,
        fromLocation: latest.fromLocationId ? getLocationCode(latest.fromLocationId) : undefined,
        toLocation: latest.toLocationId ? getLocationCode(latest.toLocationId) : undefined,
        remark: latest.remark,
      };
    };

    const buildBlockedOperations = (): FlowTraceDetailData['blockedOperations'] => {
      return sortedFailed.map((f) => {
        const attemptor = getUserInfo(f.attemptedBy);
        return {
          id: f.id,
          attemptedType: f.attemptedType,
          attemptedAt: f.attemptedAt,
          attemptedByName: attemptor.name,
          errorCode: f.errorCode,
          errorMessage: f.errorMessage,
          errorCategory: getErrorCategory(f.errorCode),
          resolved: f.resolved,
        };
      });
    };

    const buildRollbackHistory = (): FlowTraceDetailData['rollbackHistory'] => {
      const rollbackTransfers = sortedTransfers.filter((t) => t.type === 'rollback');

      return rollbackTransfers.map((t) => {
        const rollbackInfo = getUserInfo(t.operatorId);
        const rolledBackRecordId = t.remark?.match(/回退交接记录: (\w+)/)?.[1];
        const rolledBackRecord = rolledBackRecordId
          ? sortedTransfers.find((st) => st.id === rolledBackRecordId)
          : null;
        const reason = rolledBackRecord?.rollbackReason
          || t.remark?.match(/原因: (.+)$/)?.[1]
          || '';

        const rolledBackStage = rolledBackRecord
          ? (STATUS_TO_STAGE[rolledBackRecord.toStatus] || 'import')
          : 'import';
        const landingStage = STATUS_TO_STAGE[t.toStatus] || 'import';

        return {
          id: t.id,
          rollbackAt: t.operatedAt,
          rollbackByName: rollbackInfo.name,
          reason,
          rolledBackStage: rolledBackStage as FlowTraceStageKey,
          rolledBackTransferType: rolledBackRecord?.type || 'import',
          fromStatus: t.fromStatus || 'imported',
          toStatus: t.toStatus,
          landingStage: landingStage as FlowTraceStageKey,
        };
      });
    };

    const buildFullTimeline = (): FlowTraceDetailData['fullTimeline'] => {
      const timeline: FlowTraceDetailData['fullTimeline'] = [];

      for (const transfer of sortedTransfers) {
        const operator = getUserInfo(transfer.operatorId);
        const stageKey = transfer.type === 'rollback'
          ? 'rollback'
          : (STATUS_TO_STAGE[transfer.toStatus] || 'import');

        timeline.push({
          id: transfer.id,
          type: transfer.type === 'rollback' ? 'rollback' : 'transfer',
          timestamp: transfer.operatedAt,
          stageKey: stageKey as FlowTraceStageKey,
          actionLabel: TRANSFER_TYPE_LABELS[transfer.type],
          operatorName: operator.name,
          operatorRole: operator.role,
          status: transfer.fromStatus
            ? `${STATUS_LABELS[transfer.fromStatus]} → ${STATUS_LABELS[transfer.toStatus]}`
            : STATUS_LABELS[transfer.toStatus],
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
          rollbackBy: transfer.rolledBackBy ? getUserInfo(transfer.rolledBackBy).name : undefined,
        });
      }

      if (sample.reviewedBy && sample.reviewedAt) {
        const reviewer = getUserInfo(sample.reviewedBy);
        timeline.push({
          id: `review-${sample.id}`,
          type: 'review',
          timestamp: sample.reviewedAt,
          stageKey: 'review',
          actionLabel: '样本复核',
          operatorName: reviewer.name,
          operatorRole: reviewer.role,
          status: `${STATUS_LABELS.tested} → 已复核`,
        });
      }

      for (const failed of sortedFailed) {
        const attemptor = getUserInfo(failed.attemptedBy);
        const stageKey = STATUS_TO_STAGE[failed.attemptedType === 'import' ? 'imported' : failed.attemptedType] || 'import';

        timeline.push({
          id: `failed-${failed.id}`,
          type: 'failed',
          timestamp: failed.attemptedAt,
          stageKey: stageKey as FlowTraceStageKey,
          actionLabel: `失败: ${TRANSFER_TYPE_LABELS[failed.attemptedType]}`,
          operatorName: attemptor.name,
          operatorRole: attemptor.role,
          errorCode: failed.errorCode,
          errorMessage: failed.errorMessage,
          errorCategory: getErrorCategory(failed.errorCode),
        });
      }

      timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return timeline;
    };

    const buildSummary = (): FlowTraceDetailData['summary'] => {
      const validTransfers = sortedTransfers.filter(
        (t) => !t.isRolledBack && t.type !== 'rollback'
      );
      const rollbackTransfers = sortedTransfers.filter((t) => t.type === 'rollback');
      const archiveTransfers = sortedTransfers.filter((t) => t.type === 'archive');

      const lastValid = validTransfers.length > 0
        ? validTransfers[validTransfers.length - 1]
        : null;
      const lastRollback = rollbackTransfers.length > 0
        ? rollbackTransfers[rollbackTransfers.length - 1]
        : null;
      const lastFailed = sortedFailed.length > 0 ? sortedFailed[sortedFailed.length - 1] : null;

      const currentStageLabel = FLOW_TRACE_STAGE_LABELS[sample.currentStatus === 'tested' && sample.reviewedBy
        ? 'review'
        : STATUS_TO_STAGE[sample.currentStatus] || 'import'] || STATUS_LABELS[sample.currentStatus];

      const lastEventTime = lastValid?.operatedAt || sample.createdAt;
      const daysInCurrentStage = Math.floor(
        (Date.now() - new Date(lastEventTime).getTime()) / (1000 * 60 * 60 * 24)
      );

      return {
        totalTransfers: sortedTransfers.length,
        validTransfers: validTransfers.length,
        failedAttempts: sortedFailed.length,
        rollbackCount: rollbackTransfers.length,
        archiveAttempts: archiveTransfers.length,
        lastValidTransferAt: lastValid?.operatedAt,
        lastRollbackAt: lastRollback?.operatedAt,
        lastFailedAt: lastFailed?.attemptedAt,
        currentStageLabel,
        daysInCurrentStage,
      };
    };

    const currentLocation = sample.currentLocationId
      ? getLocationCode(sample.currentLocationId)
      : undefined;
    const currentHolder = sample.currentHolderId
      ? getUserInfo(sample.currentHolderId).name
      : undefined;

    const archivedBy = sortedTransfers.find((t) => t.type === 'archive' && !t.isRolledBack)
      ? getUserInfo(
          sortedTransfers.find((t) => t.type === 'archive' && !t.isRolledBack)!.operatorId
        ).name
      : undefined;

    const isLocked = sample.isArchived;
    const lockReason = isLocked ? '样本已归档，所有操作被锁定' : undefined;

    return {
      sample: {
        id: sample.id,
        sampleNo: sample.sampleNo,
        type: sample.type,
        batchId: sample.batchId,
        batchNo: batch?.batchNo || '-',
        currentStatus: sample.currentStatus,
        currentLocation,
        currentHolder,
        isArchived: sample.isArchived,
        archivedAt: sample.archivedAt,
        archivedBy,
        reviewedBy: sample.reviewedBy ? getUserInfo(sample.reviewedBy).name : undefined,
        reviewedAt: sample.reviewedAt,
        isLocked,
        lockReason,
        collectedAt: sample.collectedAt,
        collectedBy: sample.collectedBy,
        description: sample.description,
      },
      businessChain: buildBusinessChain(),
      latestValidTransfer: buildLatestValidTransfer(),
      blockedOperations: buildBlockedOperations(),
      rollbackHistory: buildRollbackHistory(),
      fullTimeline: buildFullTimeline(),
      summary: buildSummary(),
    };
  },

  getFlowTraceDataSecure: async (sampleId) => {
    const currentUser = get().currentUser;
    const operationStartAt = nowISO();

    const restartCheck = checkServiceRestartReauth(currentUser);
    if (restartCheck) {
      createOperationLog({
        user: currentUser,
        action: 'viewDetail',
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        denyReason: restartCheck.reason,
        errorCode: restartCheck.errorCode,
      });
      return wrapWithPermissionEnvelope<FlowTraceDetailData>(null, restartCheck);
    }

    const permCheck = checkFlowTracePermission(currentUser, 'viewDetail', sampleId);

    if (permCheck.decision === 'deny') {
      createOperationLog({
        user: currentUser,
        action: 'viewDetail',
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        denyReason: permCheck.reason,
        errorCode: permCheck.errorCode,
      });
      return wrapWithPermissionEnvelope<FlowTraceDetailData>(null, permCheck);
    }

    const midCheck = checkPermissionMidOperation(currentUser, 'viewDetail', operationStartAt);
    if (midCheck) {
      createOperationLog({
        user: currentUser,
        action: 'viewDetail',
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        denyReason: midCheck.reason,
        errorCode: midCheck.errorCode,
      });
      return wrapWithPermissionEnvelope<FlowTraceDetailData>(null, midCheck);
    }

    try {
      const rawData = await get().getFlowTraceData(sampleId);
      const isAuditor = currentUser ? isAuditorRole(currentUser.role) : false;
      const { data, redaction } = redactDetailData(rawData, isAuditor);

      const status = redaction ? 'redacted' : 'success';
      createOperationLog({
        user: currentUser,
        action: 'viewDetail',
        status,
        permissionDecision: permCheck.decision,
        sampleId,
        sampleNo: data?.sample.sampleNo,
      });

      return wrapWithPermissionEnvelope<FlowTraceDetailData>(data, permCheck, redaction);
    } catch (e) {
      createOperationLog({
        user: currentUser,
        action: 'viewDetail',
        status: 'error',
        permissionDecision: permCheck.decision,
        sampleId,
        errorCode: 'UNKNOWN_ERROR',
        denyReason: e instanceof Error ? e.message : '未知错误',
      });
      return wrapWithPermissionEnvelope<FlowTraceDetailData>(null, {
        ...permCheck,
        decision: 'deny',
        reason: e instanceof Error ? e.message : '未知错误',
        errorCode: 'UNKNOWN_ERROR',
      });
    }
  },

  exportFlowTraceData: async (sampleId, options) => {
    const traceData = await get().getFlowTraceData(sampleId);
    if (!traceData) throw new Error('样本不存在或无流转追溯数据');

    const {
      format,
      includeBusinessChain = true,
      includeFullTimeline = true,
      includeBlockedOps = true,
      includeRollbackHistory = true,
      includeSummary = true,
    } = options;

    if (format === 'json') {
      const exportData = {
        exportedAt: nowISO(),
        exportType: '流转追溯记录',
        sample: traceData.sample,
        summary: includeSummary ? traceData.summary : undefined,
        businessChain: includeBusinessChain ? traceData.businessChain : undefined,
        latestValidTransfer: traceData.latestValidTransfer,
        blockedOperations: includeBlockedOps ? traceData.blockedOperations : undefined,
        rollbackHistory: includeRollbackHistory ? traceData.rollbackHistory : undefined,
        fullTimeline: includeFullTimeline ? traceData.fullTimeline : undefined,
      };
      return JSON.stringify(exportData, null, 2);
    }

    const csvRows: string[][] = [];

    csvRows.push(['=== 样本流转追溯记录 ===']);
    csvRows.push(['导出时间', new Date().toLocaleString('zh-CN')]);
    csvRows.push(['记录类型', '流转追溯台 - 单样本完整业务链追溯']);
    csvRows.push([]);

    csvRows.push(['=== 样本基本信息 ===']);
    csvRows.push(['样本编号', traceData.sample.sampleNo]);
    csvRows.push(['样本类型', traceData.sample.type]);
    csvRows.push(['所属批次', traceData.sample.batchNo]);
    csvRows.push(['当前状态', STATUS_LABELS[traceData.sample.currentStatus]]);
    csvRows.push(['当前环节', traceData.summary.currentStageLabel]);
    csvRows.push(['当前库位', traceData.sample.currentLocation || '-']);
    csvRows.push(['当前持有人', traceData.sample.currentHolder || '-']);
    csvRows.push(['采集时间', traceData.sample.collectedAt]);
    csvRows.push(['采集人', traceData.sample.collectedBy]);
    csvRows.push(['是否归档', traceData.sample.isArchived ? '是' : '否']);
    if (traceData.sample.archivedAt) {
      csvRows.push(['归档时间', traceData.sample.archivedAt]);
      csvRows.push(['归档人', traceData.sample.archivedBy || '-']);
    }
    if (traceData.sample.reviewedAt) {
      csvRows.push(['复核时间', traceData.sample.reviewedAt]);
      csvRows.push(['复核人', traceData.sample.reviewedBy || '-']);
    }
    csvRows.push(['是否锁定', traceData.sample.isLocked ? '是' : '否']);
    if (traceData.sample.lockReason) {
      csvRows.push(['锁定原因', traceData.sample.lockReason]);
    }
    csvRows.push(['当前环节停留天数', String(traceData.summary.daysInCurrentStage)]);
    if (traceData.sample.description) {
      csvRows.push(['备注说明', traceData.sample.description]);
    }
    csvRows.push([]);

    if (includeSummary && traceData.summary) {
      csvRows.push(['=== 统计摘要 ===']);
      csvRows.push(['总流转次数', String(traceData.summary.totalTransfers)]);
      csvRows.push(['有效流转次数', String(traceData.summary.validTransfers)]);
      csvRows.push(['失败尝试次数', String(traceData.summary.failedAttempts)]);
      csvRows.push(['回退次数', String(traceData.summary.rollbackCount)]);
      csvRows.push(['归档尝试次数', String(traceData.summary.archiveAttempts)]);
      if (traceData.summary.lastValidTransferAt) {
        csvRows.push(['最后有效流转时间', traceData.summary.lastValidTransferAt]);
      }
      if (traceData.summary.lastRollbackAt) {
        csvRows.push(['最后回退时间', traceData.summary.lastRollbackAt]);
      }
      if (traceData.summary.lastFailedAt) {
        csvRows.push(['最后失败尝试时间', traceData.summary.lastFailedAt]);
      }
      csvRows.push(['当前所处环节', traceData.summary.currentStageLabel]);
      csvRows.push(['当前环节停留天数', String(traceData.summary.daysInCurrentStage)]);
      csvRows.push([]);
    }

    if (traceData.latestValidTransfer) {
      csvRows.push(['=== 最近一次有效流转 ===']);
      csvRows.push(['操作类型', TRANSFER_TYPE_LABELS[traceData.latestValidTransfer.type]]);
      csvRows.push(['操作时间', traceData.latestValidTransfer.timestamp]);
      csvRows.push(['操作人', traceData.latestValidTransfer.operatorName]);
      if (traceData.latestValidTransfer.fromStatus) {
        csvRows.push([
          '状态变更',
          `${STATUS_LABELS[traceData.latestValidTransfer.fromStatus]} → ${STATUS_LABELS[traceData.latestValidTransfer.toStatus]}`,
        ]);
      }
      if (traceData.latestValidTransfer.fromLocation || traceData.latestValidTransfer.toLocation) {
        csvRows.push([
          '库位变更',
          `${traceData.latestValidTransfer.fromLocation || '-'} → ${traceData.latestValidTransfer.toLocation || '-'}`,
        ]);
      }
      if (traceData.latestValidTransfer.remark) {
        csvRows.push(['备注说明', traceData.latestValidTransfer.remark]);
      }
      csvRows.push([]);
    }

    if (includeBusinessChain && traceData.businessChain.length > 0) {
      csvRows.push(['=== 业务环节链 ===']);
      csvRows.push([
        '环节序号',
        '环节名称',
        '环节状态',
        '完成时间',
        '操作人',
        '操作角色',
        '库位',
        '检测结果',
        '是否已回退',
        '回退原因',
        '备注',
      ]);

      const statusLabels: Record<string, string> = {
        completed: '已完成',
        current: '进行中',
        pending: '待进行',
        failed: '有失败',
        rolled_back: '已回退',
      };

      for (let i = 0; i < traceData.businessChain.length; i++) {
        const stage = traceData.businessChain[i];
        csvRows.push([
          String(i + 1),
          stage.label,
          statusLabels[stage.status] || stage.status,
          stage.timestamp || '-',
          stage.operatorName || '-',
          stage.operatorRole ? ROLE_LABELS[stage.operatorRole as keyof typeof ROLE_LABELS] || stage.operatorRole : '-',
          stage.location || '-',
          stage.testResult || '-',
          stage.isRolledBack ? '是' : '否',
          stage.rollbackReason || '-',
          stage.remark || '-',
        ]);
      }
      csvRows.push([]);
    }

    if (includeBlockedOps && traceData.blockedOperations.length > 0) {
      csvRows.push(['=== 被拦截/失败操作记录 ===']);
      csvRows.push([
        '序号',
        '尝试操作',
        '尝试时间',
        '尝试人',
        '错误类别',
        '错误码',
        '错误原因说明',
        '是否已解决',
      ]);

      const errorCategoryLabels: Record<string, string> = {
        permission: '权限不足',
        status: '状态冲突',
        location: '库位问题',
        duplicate: '编号重复',
        other: '其他原因',
      };

      for (let i = 0; i < traceData.blockedOperations.length; i++) {
        const op = traceData.blockedOperations[i];
        csvRows.push([
          String(i + 1),
          TRANSFER_TYPE_LABELS[op.attemptedType],
          op.attemptedAt,
          op.attemptedByName,
          errorCategoryLabels[op.errorCategory] || op.errorCategory,
          op.errorCode,
          op.errorMessage,
          op.resolved ? '是' : '否',
        ]);
      }
      csvRows.push([]);
    }

    if (includeRollbackHistory && traceData.rollbackHistory.length > 0) {
      csvRows.push(['=== 回退历史记录 ===']);
      csvRows.push([
        '序号',
        '回退时间',
        '回退人',
        '回退原因',
        '被回退环节',
        '被回退操作',
        '从状态',
        '到状态',
        '撤回落点环节',
      ]);

      for (let i = 0; i < traceData.rollbackHistory.length; i++) {
        const rb = traceData.rollbackHistory[i];
        csvRows.push([
          String(i + 1),
          rb.rollbackAt,
          rb.rollbackByName,
          rb.reason,
          FLOW_TRACE_STAGE_LABELS[rb.rolledBackStage] || rb.rolledBackStage,
          TRANSFER_TYPE_LABELS[rb.rolledBackTransferType],
          STATUS_LABELS[rb.fromStatus],
          STATUS_LABELS[rb.toStatus],
          FLOW_TRACE_STAGE_LABELS[rb.landingStage] || rb.landingStage,
        ]);
      }
      csvRows.push([]);
    }

    if (includeFullTimeline && traceData.fullTimeline.length > 0) {
      csvRows.push(['=== 完整时间线 ===']);
      csvRows.push([
        '序号',
        '时间',
        '类型',
        '所属环节',
        '操作说明',
        '操作人',
        '角色',
        '状态变更',
        '库位变更',
        '持有人变更',
        '检测结果',
        '是否已回退',
        '回退原因',
        '错误类别',
        '错误码',
        '错误说明',
        '备注',
      ]);

      const typeLabels: Record<string, string> = {
        transfer: '有效流转',
        rollback: '异常回退',
        failed: '失败尝试',
        review: '样本复核',
      };

      for (let i = 0; i < traceData.fullTimeline.length; i++) {
        const item = traceData.fullTimeline[i];
        csvRows.push([
          String(i + 1),
          item.timestamp,
          typeLabels[item.type] || item.type,
          FLOW_TRACE_STAGE_LABELS[item.stageKey] || item.stageKey,
          item.actionLabel,
          item.operatorName,
          ROLE_LABELS[item.operatorRole as keyof typeof ROLE_LABELS] || item.operatorRole,
          item.status || '-',
          item.location || '-',
          item.holder || '-',
          item.testResult || '-',
          item.isRolledBack ? '是' : '否',
          item.rollbackReason || '-',
          item.errorCategory || '-',
          item.errorCode || '-',
          item.errorMessage || '-',
          item.remark || '-',
        ]);
      }
      csvRows.push([]);
    }

    return Papa.unparse(csvRows);
  },

  exportFlowTraceDataSecure: async (sampleId, options) => {
    const currentUser = get().currentUser;
    const operationStartAt = nowISO();
    let exportOperationId = '';

    const slotResult = acquireExportSlot(currentUser);
    exportOperationId = slotResult.operationId;

    if (!slotResult.allowed) {
      const restartCheck = checkServiceRestartReauth(currentUser);
      const baseCheck = restartCheck || {
        action: 'export' as const,
        userId: currentUser?.id || '',
        userRole: currentUser?.role || 'collector',
        timestamp: nowISO(),
        decision: 'deny' as const,
        reason: slotResult.reason || '导出请求被拒绝',
        errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      };

      createOperationLog({
        user: currentUser,
        action: 'export',
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        exportOptions: options,
        denyReason: slotResult.reason,
        errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      });

      return wrapWithPermissionEnvelope<string>('', baseCheck);
    }

    try {
      const restartCheck = checkServiceRestartReauth(currentUser);
      if (restartCheck) {
        createOperationLog({
          user: currentUser,
          action: 'export',
          status: 'denied',
          permissionDecision: 'deny',
          sampleId,
          exportOptions: options,
          denyReason: restartCheck.reason,
          errorCode: restartCheck.errorCode,
        });
        return wrapWithPermissionEnvelope<string>('', restartCheck);
      }

      const permCheck = checkFlowTracePermission(currentUser, 'export', sampleId);

      if (permCheck.decision === 'deny') {
        createOperationLog({
          user: currentUser,
          action: 'export',
          status: 'denied',
          permissionDecision: 'deny',
          sampleId,
          exportOptions: options,
          denyReason: permCheck.reason,
          errorCode: permCheck.errorCode,
        });
        return wrapWithPermissionEnvelope<string>('', permCheck);
      }

      const midCheck = checkPermissionMidOperation(currentUser, 'export', operationStartAt);
      if (midCheck) {
        createOperationLog({
          user: currentUser,
          action: 'export',
          status: 'denied',
          permissionDecision: 'deny',
          sampleId,
          exportOptions: options,
          denyReason: midCheck.reason,
          errorCode: midCheck.errorCode,
        });
        return wrapWithPermissionEnvelope<string>('', midCheck);
      }

      const rawData = await get().exportFlowTraceData(sampleId, options);
      const dataStr = typeof rawData === 'string' ? rawData : '';
      const isAuditor = currentUser ? isAuditorRole(currentUser.role) : false;
      const { data, redaction } = redactExportData(dataStr, options.format, isAuditor);

      let sampleNo: string | undefined;
      try {
        if (dataStr && options.format === 'json') {
          const parsed = JSON.parse(dataStr);
          sampleNo = parsed.sample?.sampleNo;
        } else {
          const sample = get().getSampleById(sampleId);
          sampleNo = sample?.sampleNo;
        }
      } catch {
        const sample = get().getSampleById(sampleId);
        sampleNo = sample?.sampleNo;
      }

      const status = redaction ? 'redacted' : 'success';
      createOperationLog({
        user: currentUser,
        action: 'export',
        status,
        permissionDecision: permCheck.decision,
        sampleId,
        sampleNo,
        exportOptions: options,
        dataSize: data.length,
      });

      releaseExportSlot(currentUser?.id || '', exportOperationId);

      return wrapWithPermissionEnvelope<string>(data, permCheck, redaction);
    } catch (e) {
      releaseExportSlot(currentUser?.id || '', exportOperationId);

      createOperationLog({
        user: currentUser,
        action: 'export',
        status: 'error',
        permissionDecision: 'deny',
        sampleId,
        exportOptions: options,
        errorCode: 'UNKNOWN_ERROR',
        denyReason: e instanceof Error ? e.message : '未知错误',
      });

      return wrapWithPermissionEnvelope<string>('', {
        action: 'export',
        userId: currentUser?.id || '',
        userRole: currentUser?.role || 'collector',
        sampleId,
        timestamp: nowISO(),
        decision: 'deny',
        reason: e instanceof Error ? e.message : '未知错误',
        errorCode: 'UNKNOWN_ERROR',
      });
    }
  },

  getFlowTraceOperationLogs: () => {
    return getOperationLogs();
  },

  getFlowTraceServiceStatus: () => {
    return getServiceStatus();
  },

  revokeFlowTracePermission: (userId, reason) => {
    revokePermission(userId, reason);
    get().addAuditLog(
      'flowTrace:revokePermission',
      'user',
      { userId, reason },
      userId
    );
  },

  restoreFlowTracePermission: (userId) => {
    restorePermission(userId);
    get().addAuditLog(
      'flowTrace:restorePermission',
      'user',
      { userId },
      userId
    );
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
