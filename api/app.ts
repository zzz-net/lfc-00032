import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import flowTraceRoutes from './routes/flowTrace.js';
import { authMiddleware } from './middleware/auth.js';
import { errorResponse, notFoundResponse } from './lib/response.js';
import {
  getDB,
  upsertUser,
  upsertLocation,
  upsertSample,
  upsertBatch,
  upsertTransferRecord,
  nowISO,
  generateId,
  saveDB,
} from './lib/db.js';
import { createInitialUsers, createInitialLocations } from './lib/seed.js';
import type { Sample, Batch, TransferRecord } from '../shared/types.js';
import {
  initPermissionStateFromDB,
} from './services/flowTracePermissionService.js';
import { getFlowTracePermissionStates } from './lib/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app: express.Application = express();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req: Request, res: Response, next: NextFunction) => {
  res.locals.requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  next();
});

app.use(authMiddleware);

const ensureSeedData = () => {
  const db = getDB();

  if (db.users.length === 0) {
    const users = createInitialUsers();
    for (const u of users) {
      upsertUser(u);
    }
    console.log('[Seed] Created initial users');
  }

  if (db.locations.length === 0) {
    const locations = createInitialLocations();
    for (const loc of locations) {
      upsertLocation(loc);
    }
    console.log('[Seed] Created initial locations');
  }

  try {
    const states = getFlowTracePermissionStates();
    initPermissionStateFromDB(states);
  } catch (e) {
    console.warn('[Seed] Permission state init failed:', e instanceof Error ? e.message : e);
  }
};

const ensureDemoFlowData = () => {
  const db = getDB();
  if (db.samples.length > 0) return;

  const users = db.users;
  const locations = db.locations;

  const collector = users.find(u => u.role === 'collector') || users[0];
  const warehouse = users.find(u => u.role === 'warehouse') || users[0];
  const tester = users.find(u => u.role === 'tester') || users[0];
  const auditor = users.find(u => u.role === 'auditor') || users[0];

  const storageLoc = locations.find(l => l.type === 'storage' && l.status === 'active');
  const testingLoc = locations.find(l => l.type === 'testing' && l.status === 'active');
  const archiveLoc = locations.find(l => l.type === 'archive' && l.status === 'active');

  if (!storageLoc || !testingLoc || !archiveLoc) return;

  const now = nowISO();
  const demoSamples: Array<{ sampleNo: string; type: string }> = [
    { sampleNo: 'DEMO-S-001', type: '血液' },
    { sampleNo: 'DEMO-S-002', type: '唾液' },
    { sampleNo: 'DEMO-S-003', type: '尿液' },
  ];

  const batchId = generateId();
  const batch: Batch = {
    id: batchId,
    batchNo: 'BATCH-DEMO-001',
    importedAt: now,
    importedBy: collector.id,
    sampleCount: demoSamples.length,
    remark: '演示数据批次',
  };
  upsertBatch(batch);

  for (let i = 0; i < demoSamples.length; i++) {
    const ds = demoSamples[i];
    const sampleId = generateId();
    const collectedAt = new Date(Date.now() - (i + 1) * 86400000).toISOString();

    const sample: Sample = {
      id: sampleId,
      sampleNo: ds.sampleNo,
      batchId,
      type: ds.type,
      collectedAt,
      collectedBy: collector.displayName,
      description: `演示样本 #${i + 1}`,
      currentStatus: i === 0 ? 'archived' : i === 1 ? 'tested' : 'in_stock',
      currentLocationId: i === 0 ? archiveLoc.id : i === 1 ? testingLoc.id : storageLoc.id,
      currentHolderId: i === 0 ? auditor.id : i === 1 ? tester.id : warehouse.id,
      isArchived: i === 0,
      archivedAt: i === 0 ? now : undefined,
      reviewedBy: i <= 1 ? auditor.id : undefined,
      reviewedAt: i <= 1 ? now : undefined,
      createdAt: collectedAt,
      updatedAt: now,
    };
    upsertSample(sample);

    const transferBase = {
      sampleId,
      operatorId: collector.id,
      operatedAt: collectedAt,
      isRolledBack: false,
    } as const;

    upsertTransferRecord({
      id: generateId(),
      ...transferBase,
      type: 'import',
      toStatus: 'imported',
      remark: `批次导入: ${batch.batchNo}`,
    } as TransferRecord);

    if (i >= 1) {
      upsertTransferRecord({
        id: generateId(),
        sampleId,
        type: 'inbound',
        fromStatus: 'imported',
        toStatus: 'in_stock',
        toLocationId: storageLoc.id,
        toHolderId: warehouse.id,
        operatorId: warehouse.id,
        operatedAt: new Date(Date.now() - (i + 1) * 86400000 + 3600000).toISOString(),
        remark: '入库登记',
        isRolledBack: false,
      } as TransferRecord);
    }

    if (i >= 2) {
      // no further steps for sample 3
    }

    if (i <= 1) {
      upsertTransferRecord({
        id: generateId(),
        sampleId,
        type: 'outbound',
        fromStatus: 'in_stock',
        toStatus: 'in_transit',
        fromLocationId: storageLoc.id,
        fromHolderId: warehouse.id,
        toHolderId: tester.id,
        operatorId: warehouse.id,
        operatedAt: new Date(Date.now() - (i + 1) * 86400000 + 7200000).toISOString(),
        remark: '出库交接',
        isRolledBack: false,
      } as TransferRecord);

      upsertTransferRecord({
        id: generateId(),
        sampleId,
        type: 'test_receive',
        fromStatus: 'in_transit',
        toStatus: 'testing',
        toLocationId: testingLoc.id,
        toHolderId: tester.id,
        operatorId: tester.id,
        operatedAt: new Date(Date.now() - (i + 1) * 86400000 + 10800000).toISOString(),
        remark: '检测接收',
        isRolledBack: false,
      } as TransferRecord);

      upsertTransferRecord({
        id: generateId(),
        sampleId,
        type: 'test_complete',
        fromStatus: 'testing',
        toStatus: 'tested',
        fromHolderId: tester.id,
        toHolderId: tester.id,
        operatorId: tester.id,
        operatedAt: new Date(Date.now() - (i + 1) * 86400000 + 14400000).toISOString(),
        remark: '检测完成',
        testResult: i === 0 ? '合格' : '待复核',
        isRolledBack: false,
      } as TransferRecord);
    }

    if (i === 0) {
      upsertTransferRecord({
        id: generateId(),
        sampleId,
        type: 'archive',
        fromStatus: 'tested',
        toStatus: 'archived',
        fromLocationId: testingLoc.id,
        toLocationId: archiveLoc.id,
        operatorId: auditor.id,
        operatedAt: new Date(Date.now() - (i + 1) * 86400000 + 18000000).toISOString(),
        remark: '归档复核通过',
        isRolledBack: false,
      } as TransferRecord);
    }
  }

  saveDB();
  console.log('[Seed] Created demo flow trace data');
};

ensureSeedData();
ensureDemoFlowData();

app.use('/api/auth', authRoutes);
app.use('/api/flow-trace', flowTraceRoutes);

app.get(
  '/api/health',
  (_req: Request, res: Response): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
      timestamp: nowISO(),
      service: {
        instanceId: 'server',
        uptime: process.uptime(),
      },
    });
  },
);

app.get(
  '/api/health/full',
  (_req: Request, res: Response): void => {
    const db = getDB();
    res.status(200).json({
      success: true,
      timestamp: nowISO(),
      data: {
        users: db.users.length,
        samples: db.samples.length,
        batches: db.batches.length,
        locations: db.locations.length,
        transferRecords: db.transferRecords.length,
        failedTransfers: db.failedTransfers.length,
        auditLogs: db.auditLogs.length,
        flowTraceAuditRecords: db.flowTraceAuditRecords.length,
        sessions: db.sessions.length,
      },
    });
  },
);

app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Unhandled Error]', error);
  errorResponse(res, 'INTERNAL_ERROR', error.message || '服务器内部错误', 500, {
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
  });
});

app.use((req: Request, res: Response) => {
  notFoundResponse(res, `API not found: ${req.method} ${req.path}`);
});

export default app;
