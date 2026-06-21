import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { validateRollback } from '../services/transferValidator';
import { hasPermission } from '../services/permissionService';
import type { SampleImportRow, TransferRecord, User, ArchiveReviewData } from '@shared/types';
import { resetDBInstance } from '../lib/db';

const ADMIN_USER = { username: 'admin', password: '123456' };

const makeRow = (sampleNo: string, overrides?: Partial<SampleImportRow>): SampleImportRow => ({
  sampleNo,
  type: 'blood',
  collectedAt: '2025-06-21T10:00:00Z',
  collectedBy: '张采集',
  ...overrides,
});

const initAndLogin = async () => {
  const store = useAppStore.getState();
  await store.initializeDB();
  const loginSuccess = await store.login(ADMIN_USER.username, ADMIN_USER.password);
  expect(loginSuccess).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 10));
  await store.getAllUsers();
  await store.getAllLocations();
  await store.getAllSamples();
  await store.getAllBatches();
  await store.getFailedTransfers();
};

describe('Batch import with mixed duplicate and new samples', () => {
  it('should import valid rows and only record failures for duplicates in the same batch', async () => {
    await initAndLogin();

    const rows: SampleImportRow[] = [
      makeRow('S-MIX-001'),
      makeRow('S-MIX-002'),
      makeRow('S-MIX-001'),
      makeRow('S-MIX-003'),
      makeRow('S-MIX-002'),
      makeRow('S-MIX-004'),
    ];

    const result = await useAppStore.getState().importBatch(rows, 'BATCH-MIX-001');

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(4);
    expect(result.failedRows).toHaveLength(2);

    const failedNos = result.failedRows.map((f) => f.data.sampleNo);
    expect(failedNos).toEqual(['S-MIX-001', 'S-MIX-002']);

    const importedNos = useAppStore.getState().samples
      .filter((s) => s.sampleNo.startsWith('S-MIX-'))
      .map((s) => s.sampleNo)
      .sort();
    expect(importedNos).toEqual(['S-MIX-001', 'S-MIX-002', 'S-MIX-003', 'S-MIX-004']);

    const failedTransfers = useAppStore.getState().failedTransfers.filter(
      (f) => (f.payload?.batchNo as string) === 'BATCH-MIX-001'
    );
    expect(failedTransfers.length).toBe(2);
    expect(failedTransfers.every((f) => f.errorCode === 'DUPLICATE_SAMPLE_NO')).toBe(true);
  });

  it('should import new samples even when some rows have missing required fields', async () => {
    await initAndLogin();

    const rows: SampleImportRow[] = [
      makeRow('S-FIELD-001'),
      { sampleNo: '', type: 'blood', collectedAt: '2025-01-01', collectedBy: 'X' },
      makeRow('S-FIELD-002'),
      { sampleNo: 'S-FIELD-NODATE', type: 'blood', collectedAt: '', collectedBy: 'X' },
    ];

    const result = await useAppStore.getState().importBatch(rows, 'BATCH-FIELD-001');

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(2);
    expect(result.failedRows).toHaveLength(2);

    const importedNos = useAppStore.getState().samples
      .filter((s) => s.sampleNo.startsWith('S-FIELD-'))
      .map((s) => s.sampleNo)
      .sort();
    expect(importedNos).toEqual(['S-FIELD-001', 'S-FIELD-002']);
  });

  it('should reject re-importing a sampleNo that already exists in DB from a previous batch', async () => {
    await initAndLogin();

    const batch1 = [makeRow('S-EXIST-001'), makeRow('S-EXIST-002')];
    const r1 = await useAppStore.getState().importBatch(batch1, 'BATCH-EXIST-1');
    expect(r1.importedCount).toBe(2);

    const batch2 = [makeRow('S-EXIST-001'), makeRow('S-EXIST-003')];
    const r2 = await useAppStore.getState().importBatch(batch2, 'BATCH-EXIST-2');

    expect(r2.success).toBe(true);
    expect(r2.importedCount).toBe(1);
    expect(r2.failedRows).toHaveLength(1);
    expect(r2.failedRows[0].errorCode).toBe('DUPLICATE_SAMPLE_NO');

    const allNos = useAppStore.getState().samples
      .filter((s) => s.sampleNo.startsWith('S-EXIST-'))
      .map((s) => s.sampleNo)
      .sort();
    expect(allNos).toEqual(['S-EXIST-001', 'S-EXIST-002', 'S-EXIST-003']);
  });
});

describe('Rollback audit chain completeness', () => {
  it('should produce complete rollback chain in exported audit data', async () => {
    await initAndLogin();
    const store = useAppStore.getState();

    const rows = [makeRow('S-RLB-001')];
    await store.importBatch(rows, 'BATCH-RLB-001');

    const sample = useAppStore.getState().samples.find((s) => s.sampleNo === 'S-RLB-001')!;
    expect(sample).toBeDefined();

    const locations = useAppStore.getState().locations;
    const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;

    const inboundResult = await store.performInbound(sample.id, storageLoc.id);
    expect(inboundResult).not.toBeNull();

    const testers = useAppStore.getState().users.filter((u) => u.role === 'tester');
    const tester = testers[0];
    expect(tester).toBeDefined();

    const outboundResult = await store.performOutbound(sample.id, storageLoc.id, tester.id);
    expect(outboundResult).not.toBeNull();

    await store.logout();
    await store.login('auditor01', '123456');

    const rollbackResult = await useAppStore.getState().performRollback(outboundResult!.id, '出库操作有误，需要回退');
    expect(rollbackResult).not.toBeNull();

    const jsonExport = await useAppStore.getState().exportAuditData('json');
    const parsed = JSON.parse(jsonExport as string);

    expect(parsed.transfers).toBeDefined();
    expect(parsed.failedTransfers).toBeDefined();

    const sampleTransfers = parsed.transfers.filter(
      (t: any) => t.sampleNo === 'S-RLB-001'
    );

    const outboundRecord = sampleTransfers.find((t: any) => t.transferType === 'outbound');
    expect(outboundRecord).toBeDefined();
    expect(outboundRecord.isRolledBack).toBe(true);
    expect(outboundRecord.rolledBackBy).toBeTruthy();
    expect(outboundRecord.rolledBackAt).toBeTruthy();
    expect(outboundRecord.rollbackReason).toBe('出库操作有误，需要回退');

    const rollbackRecord = sampleTransfers.find((t: any) => t.transferType === 'rollback');
    expect(rollbackRecord).toBeDefined();
    expect(rollbackRecord.rollbackToRecordId).toBeTruthy();
    expect(rollbackRecord.remark).toContain('回退交接记录');

    const rollbackAuditLog = parsed.auditLogs.find(
      (l: any) => l.action === 'transfer:rollback'
    );
    expect(rollbackAuditLog).toBeDefined();
    expect(rollbackAuditLog.details.sampleNo).toBe('S-RLB-001');
    expect(rollbackAuditLog.details.reason).toBe('出库操作有误，需要回退');

    const csvExport = await useAppStore.getState().exportAuditData('csv');
    const csvStr = csvExport as string;
    expect(csvStr).toContain('回退至记录ID');
    expect(csvStr).toContain('失败记录');
  });

  it('should record failed transfer attempts in the audit chain', async () => {
    await initAndLogin();

    const rows = [makeRow('S-FAIL-001')];
    await useAppStore.getState().importBatch(rows, 'BATCH-FAIL-001');

    const sample = useAppStore.getState().samples.find((s) => s.sampleNo === 'S-FAIL-001')!;

    const testingLoc = useAppStore.getState().locations.find(
      (l) => l.type === 'testing' && l.status === 'active'
    )!;

    const result = await useAppStore.getState().performTestReceive(sample.id, testingLoc.id);
    expect(result).toBeNull();

    await useAppStore.getState().getFailedTransfers();
    const fails = useAppStore.getState().failedTransfers.filter(
      (f) => f.sampleId === sample.id
    );
    expect(fails.length).toBeGreaterThanOrEqual(1);
    expect(fails[0].errorCode).toBe('INVALID_STATUS_TRANSITION');

    const jsonExport = await useAppStore.getState().exportAuditData('json');
    const parsed = JSON.parse(jsonExport as string);
    expect(parsed.failedTransfers.length).toBeGreaterThanOrEqual(1);

    const sampleFail = parsed.failedTransfers.find(
      (f: any) => f.sampleNo === 'S-FAIL-001'
    );
    expect(sampleFail).toBeDefined();
    expect(sampleFail.errorCode).toBe('INVALID_STATUS_TRANSITION');
  });
});

describe('Data persistence after reinitialize', () => {
  it('should retain all data after re-initializing the store from IndexedDB', async () => {
    await initAndLogin();

    const rows = [makeRow('S-PERS-001'), makeRow('S-PERS-002')];
    await useAppStore.getState().importBatch(rows, 'BATCH-PERS-001');

    const locations = useAppStore.getState().locations;
    const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;

    const sample1 = useAppStore.getState().samples.find((s) => s.sampleNo === 'S-PERS-001')!;
    await useAppStore.getState().performInbound(sample1.id, storageLoc.id);

    const testers = useAppStore.getState().users.filter((u) => u.role === 'tester');
    const tester = testers[0];

    const outboundResult = await useAppStore.getState().performOutbound(sample1.id, storageLoc.id, tester.id);
    expect(outboundResult).not.toBeNull();

    useAppStore.setState({
      currentUser: null,
      samples: [],
      batches: [],
      transferRecords: [],
      failedTransfers: [],
      auditLogs: [],
      isInitialized: false,
    });

    await useAppStore.getState().initializeDB();
    await useAppStore.getState().login('admin', '123456');

    const restoredSamples = useAppStore.getState().samples.filter(
      (s) => s.sampleNo.startsWith('S-PERS-')
    );
    expect(restoredSamples.length).toBe(2);

    const restoredSample1 = useAppStore.getState().samples.find(
      (s) => s.sampleNo === 'S-PERS-001'
    )!;
    expect(restoredSample1.currentStatus).toBe('in_transit');
    expect(restoredSample1.currentHolderId).toBe(tester.id);

    const restoredSample2 = useAppStore.getState().samples.find(
      (s) => s.sampleNo === 'S-PERS-002'
    )!;
    expect(restoredSample2.currentStatus).toBe('imported');

    const restoredBatches = useAppStore.getState().batches;
    expect(restoredBatches.some((b) => b.batchNo === 'BATCH-PERS-001')).toBe(true);

    const transfers = await useAppStore.getState().getTransferRecordsBySample(restoredSample1.id);
    expect(transfers.length).toBe(3);
    expect(transfers.map((t) => t.type).sort()).toEqual(['import', 'inbound', 'outbound']);
  });
});

describe('Rollback after archive', () => {
  const fullFlow = async (sampleNo: string) => {
    const store = useAppStore.getState();
    const rows = [makeRow(sampleNo)];
    await store.importBatch(rows, `BATCH-ARCH-${sampleNo}`);

    const sample = useAppStore.getState().samples.find((s) => s.sampleNo === sampleNo)!;
    let locations = useAppStore.getState().locations;
    expect(locations.length).toBeGreaterThan(0);
    const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active');
    expect(storageLoc).toBeDefined();

    await useAppStore.getState().performInbound(sample.id, storageLoc!.id);

    const testers = useAppStore.getState().users.filter((u) => u.role === 'tester');
    const tester = testers[0];
    expect(tester).toBeDefined();
    await useAppStore.getState().performOutbound(sample.id, storageLoc!.id, tester.id);

    const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active');
    expect(testingLoc).toBeDefined();
    await useAppStore.getState().performTestReceive(sample.id, testingLoc!.id);

    const testCompleteResult = await useAppStore.getState().performTestComplete(sample.id, '合格');
    expect(testCompleteResult).not.toBeNull();

    await useAppStore.getState().logout();
    const loginAuditor = await useAppStore.getState().login('auditor01', '123456');
    expect(loginAuditor).toBe(true);
    expect(useAppStore.getState().currentUser?.role).toBe('auditor');
    await useAppStore.getState().getAllLocations();
    locations = useAppStore.getState().locations;

    const reviewResult = await useAppStore.getState().performReview(sample.id, '复核通过');
    expect(reviewResult).toBe(true);

    const archiveLoc = locations.find((l) => l.type === 'archive' && l.status === 'active');
    expect(archiveLoc).toBeDefined();
    const archiveResult = await useAppStore.getState().performArchive(sample.id, archiveLoc!.id);
    expect(archiveResult).not.toBeNull();

    const archivedSample = useAppStore.getState().samples.find((s) => s.id === sample.id)!;
    expect(archivedSample.currentStatus).toBe('archived');
    expect(archivedSample.isArchived).toBe(true);

    return { sampleId: sample.id, archiveTransferId: archiveResult!.id };
  };

  it('should allow rolling back an archived sample and restore its state', async () => {
    await initAndLogin();
    const { sampleId, archiveTransferId } = await fullFlow('S-ARCH-001');

    const rollbackResult = await useAppStore.getState().performRollback(
      archiveTransferId,
      '归档操作有误，需要回退'
    );
    expect(rollbackResult).not.toBeNull();

    const restoredSample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(restoredSample.currentStatus).toBe('tested');
    expect(restoredSample.isArchived).toBe(false);
    expect(restoredSample.archivedAt).toBeUndefined();
  });

  it('should produce complete audit chain after rolling back an archive', async () => {
    await initAndLogin();
    const { sampleId, archiveTransferId } = await fullFlow('S-ARCH-002');

    const rollbackResult = await useAppStore.getState().performRollback(
      archiveTransferId,
      '归档回退测试审计链路'
    );
    expect(rollbackResult).not.toBeNull();

    const jsonExport = await useAppStore.getState().exportAuditData('json');
    const parsed = JSON.parse(jsonExport as string);

    const sampleTransfers = parsed.transfers.filter(
      (t: any) => t.sampleNo === 'S-ARCH-002'
    );

    const archiveRecord = sampleTransfers.find((t: any) => t.transferType === 'archive');
    expect(archiveRecord).toBeDefined();
    expect(archiveRecord.isRolledBack).toBe(true);
    expect(archiveRecord.rollbackReason).toBe('归档回退测试审计链路');

    const rollbackRecord = sampleTransfers.find((t: any) => t.transferType === 'rollback');
    expect(rollbackRecord).toBeDefined();
    expect(rollbackRecord.rollbackToRecordId).toBeTruthy();
    expect(rollbackRecord.fromStatus).toBe('archived');
    expect(rollbackRecord.toStatus).toBe('tested');

    const rollbackAuditLog = parsed.auditLogs.find(
      (l: any) => l.action === 'transfer:rollback' && l.details.sampleNo === 'S-ARCH-002'
    );
    expect(rollbackAuditLog).toBeDefined();
    expect(rollbackAuditLog.details.rolledBackTransferType).toBe('archive');
    expect(rollbackAuditLog.details.rollbackToStatus).toBe('tested');
    expect(rollbackAuditLog.details.reason).toBe('归档回退测试审计链路');

    const csvExport = await useAppStore.getState().exportAuditData('csv');
    expect(csvExport as string).toContain('回退至记录ID');
  });

  it('should retain rollback state after reinitialize', async () => {
    await initAndLogin();
    const { sampleId, archiveTransferId } = await fullFlow('S-ARCH-003');

    const rollbackResult = await useAppStore.getState().performRollback(
      archiveTransferId,
      '归档回退后重启验证'
    );
    expect(rollbackResult).not.toBeNull();

    useAppStore.setState({
      currentUser: null,
      samples: [],
      batches: [],
      transferRecords: [],
      failedTransfers: [],
      auditLogs: [],
      isInitialized: false,
    });

    await useAppStore.getState().initializeDB();
    await useAppStore.getState().login('admin', '123456');

    const restoredSample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(restoredSample.currentStatus).toBe('tested');
    expect(restoredSample.isArchived).toBe(false);

    const transfers = await useAppStore.getState().getTransferRecordsBySample(sampleId);
    const archiveTransfer = transfers.find((t) => t.type === 'archive');
    expect(archiveTransfer?.isRolledBack).toBe(true);

    const rollbackTransfer = transfers.find((t) => t.type === 'rollback');
    expect(rollbackTransfer).toBeDefined();
    expect(rollbackTransfer?.toStatus).toBe('tested');
  });
});

describe('Archive-rollback chain integrity', () => {
  const fullFlowToArchive = async (sampleNo: string) => {
    const store = useAppStore.getState();
    const rows = [makeRow(sampleNo)];
    await store.importBatch(rows, `BATCH-ARCH2-${sampleNo}`);

    const sample = useAppStore.getState().samples.find((s) => s.sampleNo === sampleNo)!;
    let locations = useAppStore.getState().locations;
    expect(locations.length).toBeGreaterThan(0);
    const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active');
    expect(storageLoc).toBeDefined();

    await useAppStore.getState().performInbound(sample.id, storageLoc!.id);

    const testers = useAppStore.getState().users.filter((u) => u.role === 'tester');
    const tester = testers[0];
    expect(tester).toBeDefined();
    await useAppStore.getState().performOutbound(sample.id, storageLoc!.id, tester.id);

    const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active');
    expect(testingLoc).toBeDefined();
    await useAppStore.getState().performTestReceive(sample.id, testingLoc!.id);

    const testCompleteResult = await useAppStore.getState().performTestComplete(sample.id, '合格');
    expect(testCompleteResult).not.toBeNull();

    await useAppStore.getState().logout();
    const loginAuditor = await useAppStore.getState().login('auditor01', '123456');
    expect(loginAuditor).toBe(true);
    expect(useAppStore.getState().currentUser?.role).toBe('auditor');
    await useAppStore.getState().getAllLocations();
    locations = useAppStore.getState().locations;

    const reviewResult = await useAppStore.getState().performReview(sample.id, '复核通过');
    expect(reviewResult).toBe(true);

    const archiveLoc = locations.find((l) => l.type === 'archive' && l.status === 'active');
    expect(archiveLoc).toBeDefined();
    const archiveResult = await useAppStore.getState().performArchive(sample.id, archiveLoc!.id);
    expect(archiveResult).not.toBeNull();

    return { sampleId: sample.id, archiveTransferId: archiveResult!.id };
  };

  it('archived sample must be visible in store after archive so rollback page can list it', async () => {
    await initAndLogin();
    const { sampleId } = await fullFlowToArchive('S-ARCH2-VIS');

    const allSamples = useAppStore.getState().samples;
    const archivedSample = allSamples.find((s) => s.id === sampleId);
    expect(archivedSample).toBeDefined();
    expect(archivedSample!.currentStatus).toBe('archived');
    expect(archivedSample!.isArchived).toBe(true);
  });

  it('should successfully roll back the most recent archive transfer', async () => {
    await initAndLogin();
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-ARCH2-RLB');

    const rollbackResult = await useAppStore.getState().performRollback(
      archiveTransferId,
      '撤回最近一次归档交接'
    );
    expect(rollbackResult).not.toBeNull();
    expect(rollbackResult!.type).toBe('rollback');
    expect(rollbackResult!.fromStatus).toBe('archived');
    expect(rollbackResult!.toStatus).toBe('tested');

    const restoredSample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(restoredSample.currentStatus).toBe('tested');
    expect(restoredSample.isArchived).toBe(false);
    expect(restoredSample.archivedAt).toBeUndefined();
    expect(restoredSample.reviewedBy).toBeUndefined();
    expect(restoredSample.reviewedAt).toBeUndefined();
  });

  it('sample status and audit records must be consistent after rollback', async () => {
    await initAndLogin();
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-ARCH2-AUD');

    await useAppStore.getState().performRollback(archiveTransferId, '审计一致性验证');

    const sample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(sample.currentStatus).toBe('tested');
    expect(sample.isArchived).toBe(false);

    const transfers = await useAppStore.getState().getTransferRecordsBySample(sampleId);

    const archiveTransfer = transfers.find((t) => t.type === 'archive');
    expect(archiveTransfer).toBeDefined();
    expect(archiveTransfer!.isRolledBack).toBe(true);
    expect(archiveTransfer!.rollbackReason).toBe('审计一致性验证');

    const rollbackTransfer = transfers.find((t) => t.type === 'rollback');
    expect(rollbackTransfer).toBeDefined();
    expect(rollbackTransfer!.fromStatus).toBe('archived');
    expect(rollbackTransfer!.toStatus).toBe('tested');

    const lastNonRollbackTransfer = [...transfers]
      .filter((t) => t.type !== 'rollback' && t.type !== 'import')
      .sort((a, b) => b.operatedAt.localeCompare(a.operatedAt))[0];
    expect(lastNonRollbackTransfer.type).toBe('archive');
    expect(lastNonRollbackTransfer.isRolledBack).toBe(true);

    const currentUser = useAppStore.getState().currentUser!;
    const validation = validateRollback({
      sample,
      targetTransfer: rollbackTransfer!,
      operator: currentUser,
    });
    expect(validation.valid).toBe(false);
  });

  it('rollback-type transfer record must not be roll-backable', async () => {
    await initAndLogin();
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-ARCH2-NO');

    const rollbackResult = await useAppStore.getState().performRollback(
      archiveTransferId,
      '第一次回退'
    );
    expect(rollbackResult).not.toBeNull();

    const secondRollback = await useAppStore.getState().performRollback(
      rollbackResult!.id,
      '尝试回退回退记录'
    );
    expect(secondRollback).toBeNull();
    expect(useAppStore.getState().error).toContain('回退记录本身不允许再次回退');

    const sample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(sample.currentStatus).toBe('tested');
    expect(sample.isArchived).toBe(false);
  });

  it('after rollback, sample can be re-reviewed and re-archived', async () => {
    await initAndLogin();
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-ARCH2-RER');

    await useAppStore.getState().performRollback(archiveTransferId, '准备重新归档');

    let sample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(sample.currentStatus).toBe('tested');
    expect(sample.reviewedBy).toBeUndefined();

    const reviewResult = await useAppStore.getState().performReview(sampleId, '重新复核');
    expect(reviewResult).toBe(true);

    sample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(sample.reviewedBy).toBeDefined();

    const archiveLoc = useAppStore.getState().locations.find(
      (l) => l.type === 'archive' && l.status === 'active'
    )!;
    const reArchiveResult = await useAppStore.getState().performArchive(sampleId, archiveLoc.id);
    expect(reArchiveResult).not.toBeNull();

    sample = useAppStore.getState().samples.find((s) => s.id === sampleId)!;
    expect(sample.currentStatus).toBe('archived');
    expect(sample.isArchived).toBe(true);
  });
});

describe('Archive Review - Post-archiving Analysis Capability', () => {
  beforeEach(async () => {
    resetDBInstance();
    useAppStore.setState({
      currentUser: null,
      users: [],
      samples: [],
      locations: [],
      batches: [],
      transferRecords: [],
      failedTransfers: [],
      auditLogs: [],
      isInitialized: false,
    });
  });

  const fullFlowToArchive = async (sampleNo: string, testResult = '合格') => {
    const store = useAppStore.getState();
    const rows = [makeRow(sampleNo)];
    await store.importBatch(rows, `BATCH-REV-${sampleNo}`);

    const sample = useAppStore.getState().samples.find((s) => s.sampleNo === sampleNo)!;
    await store.getAllLocations();
    let locations = useAppStore.getState().locations;
    expect(locations.length).toBeGreaterThan(0);
    const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active');
    expect(storageLoc).toBeDefined();

    await store.performInbound(sample.id, storageLoc!.id);

    await store.getAllUsers();
    const testers = useAppStore.getState().users.filter((u) => u.role === 'tester');
    const tester = testers[0];
    expect(tester).toBeDefined();
    await store.performOutbound(sample.id, storageLoc!.id, tester.id);

    const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active');
    expect(testingLoc).toBeDefined();
    await store.performTestReceive(sample.id, testingLoc!.id);

    const testCompleteResult = await store.performTestComplete(sample.id, testResult);
    expect(testCompleteResult).not.toBeNull();

    store.logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    const loginAuditor = await store.login('auditor01', '123456');
    expect(loginAuditor).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    await store.getAllLocations();
    locations = store.locations;

    const reviewResult = await store.performReview(sample.id, '复核通过');
    expect(reviewResult).toBe(true);

    const archiveLoc = locations.find((l) => l.type === 'archive' && l.status === 'active');
    expect(archiveLoc).toBeDefined();
    const archiveResult = await store.performArchive(sample.id, archiveLoc!.id);
    expect(archiveResult).not.toBeNull();

    return { sampleId: sample.id, archiveTransferId: archiveResult!.id };
  };

  const simulateRestart = async () => {
    resetDBInstance();
    useAppStore.setState({
      currentUser: null,
      samples: [],
      batches: [],
      transferRecords: [],
      failedTransfers: [],
      auditLogs: [],
      isInitialized: false,
    });
    await useAppStore.getState().initializeDB();
  };

  describe('Data Consistency After Restart', () => {
    it('should show consistent review data after archive and restart', async () => {
      await initAndLogin();
      const { sampleId } = await fullFlowToArchive('S-REV-001');

      const reviewData1 = await useAppStore.getState().getArchiveReviewData(sampleId);
      expect(reviewData1).not.toBeNull();
      expect(reviewData1!.sample.isArchived).toBe(true);
      expect(reviewData1!.sample.isLocked).toBe(true);
      expect(reviewData1!.summary.totalTransfers).toBeGreaterThan(0);

      await simulateRestart();
      await useAppStore.getState().login('auditor01', '123456');

      const reviewData2 = await useAppStore.getState().getArchiveReviewData(sampleId);
      expect(reviewData2).not.toBeNull();
      expect(reviewData2!.sample.id).toBe(reviewData1!.sample.id);
      expect(reviewData2!.sample.sampleNo).toBe(reviewData1!.sample.sampleNo);
      expect(reviewData2!.sample.isArchived).toBe(true);
      expect(reviewData2!.sample.isLocked).toBe(true);
      expect(reviewData2!.summary.totalTransfers).toBe(reviewData1!.summary.totalTransfers);
      expect(reviewData2!.summary.successfulTransfers).toBe(reviewData1!.summary.successfulTransfers);
      expect(reviewData2!.timeline.length).toBe(reviewData1!.timeline.length);
    });

    it('should show consistent rollback data after rollback and restart', async () => {
      await initAndLogin();
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-REV-002');

      const rollbackResult = await useAppStore.getState().performRollback(
        archiveTransferId,
        '归档回退测试重启一致性'
      );
      expect(rollbackResult).not.toBeNull();

      const reviewData1 = await useAppStore.getState().getArchiveReviewData(sampleId);
      expect(reviewData1).not.toBeNull();
      expect(reviewData1!.sample.isArchived).toBe(false);
      expect(reviewData1!.summary.rollbackCount).toBe(1);
      expect(reviewData1!.rollbackRecords.length).toBe(1);

      await simulateRestart();
      await useAppStore.getState().login('auditor01', '123456');

      const reviewData2 = await useAppStore.getState().getArchiveReviewData(sampleId);
      expect(reviewData2).not.toBeNull();
      expect(reviewData2!.sample.isArchived).toBe(false);
      expect(reviewData2!.summary.rollbackCount).toBe(1);
      expect(reviewData2!.rollbackRecords.length).toBe(1);
      expect(reviewData2!.rollbackRecords[0].reason).toBe('归档回退测试重启一致性');
    });

    it('should maintain export consistency after restart', async () => {
      await initAndLogin();
      const { sampleId } = await fullFlowToArchive('S-REV-003');

      const jsonExport1 = await useAppStore.getState().exportArchiveReviewData(sampleId, { format: 'json' });
      const parsed1 = JSON.parse(jsonExport1 as string);

      await simulateRestart();
      await useAppStore.getState().login('auditor01', '123456');

      const jsonExport2 = await useAppStore.getState().exportArchiveReviewData(sampleId, { format: 'json' });
      const parsed2 = JSON.parse(jsonExport2 as string);

      expect(parsed2.sample.id).toBe(parsed1.sample.id);
      expect(parsed2.sample.sampleNo).toBe(parsed1.sample.sampleNo);
      expect(parsed2.summary.totalTransfers).toBe(parsed1.summary.totalTransfers);
      expect(parsed2.timeline.length).toBe(parsed1.timeline.length);
    });
  });

  describe('Complex Scenario Handling', () => {
    it('should distinguish between valid transfers, failed attempts, and permission errors', async () => {
      await initAndLogin();
      const s = () => useAppStore.getState();

      const rows = [makeRow('S-REV-004')];
      await s().importBatch(rows, 'BATCH-REV-004');
      const sampleId = s().samples.find((samp) => samp.sampleNo === 'S-REV-004')!.id;

      await s().getAllLocations();
      const locations = s().locations;
      expect(locations.length).toBeGreaterThan(0);
      const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;
      const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active')!;
      const archiveLoc = locations.find((l) => l.type === 'archive' && l.status === 'active')!;

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('collector01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();
      await s().performInbound(sampleId, storageLoc.id);

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('admin', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();
      await s().getAllUsers();

      await s().performInbound(sampleId, storageLoc.id);

      await s().performTestReceive(sampleId, testingLoc.id);

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('collector01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();
      await s().performInbound(sampleId, storageLoc.id);

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('admin', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();
      await s().getAllUsers();
      const testers = s().users.filter((u) => u.role === 'tester');
      const tester = testers[0];
      expect(tester).toBeDefined();
      await s().performOutbound(sampleId, storageLoc.id, tester.id);

      await s().performTestReceive(sampleId, testingLoc.id);

      const testResult = await s().performTestComplete(sampleId, '合格');
      expect(testResult).not.toBeNull();

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();

      await s().performReview(sampleId, '复核通过');
      await s().performArchive(sampleId, archiveLoc.id);

      const reviewData = await s().getArchiveReviewData(sampleId);
      expect(reviewData).not.toBeNull();

      const failedRecords = reviewData!.timeline.filter((t) => t.type === 'failed');
      expect(failedRecords.length).toBeGreaterThanOrEqual(2);

      const permissionErrors = failedRecords.filter(
        (f) => f.errorCode === 'INSUFFICIENT_PERMISSION'
      );
      expect(permissionErrors.length).toBeGreaterThanOrEqual(1);

      const statusErrors = failedRecords.filter(
        (f) => f.errorCode === 'INVALID_STATUS_TRANSITION'
      );
      expect(statusErrors.length).toBeGreaterThanOrEqual(1);

      const validTransfers = reviewData!.timeline.filter(
        (t) => t.type === 'transfer' && !t.isRolledBack
      );
      expect(validTransfers.length).toBeGreaterThan(0);

      const failedList = reviewData!.failedTransfers;
      expect(failedList.length).toBeGreaterThanOrEqual(2);
      expect(failedList.some((f) => f.errorCode === 'INSUFFICIENT_PERMISSION')).toBe(true);
      expect(failedList.some((f) => f.errorCode === 'INVALID_STATUS_TRANSITION')).toBe(true);
    });

    it('should handle duplicate import attempts correctly', async () => {
      await initAndLogin();
      const s = () => useAppStore.getState();

      const rows1 = [makeRow('S-REV-005'), makeRow('S-REV-005')];
      const result1 = await s().importBatch(rows1, 'BATCH-REV-005');
      expect(result1.importedCount).toBe(1);
      expect(result1.failedRows.length).toBe(1);

      const rows2 = [makeRow('S-REV-005'), makeRow('S-REV-006')];
      const result2 = await s().importBatch(rows2, 'BATCH-REV-005B');
      expect(result2.importedCount).toBe(1);
      expect(result2.failedRows.length).toBe(1);
      expect(result2.failedRows[0].errorCode).toBe('DUPLICATE_SAMPLE_NO');

      const sampleId = s().samples.find((samp) => samp.sampleNo === 'S-REV-005')!.id;

      await s().getAllLocations();
      const locations = s().locations;
      expect(locations.length).toBeGreaterThan(0);
      const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;
      const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active')!;
      const archiveLoc = locations.find((l) => l.type === 'archive' && l.status === 'active')!;

      await s().performInbound(sampleId, storageLoc.id);

      await s().getAllUsers();
      const testers = s().users.filter((u) => u.role === 'tester');
      const tester = testers[0];
      expect(tester).toBeDefined();
      await s().performOutbound(sampleId, storageLoc.id, tester.id);

      await s().performTestReceive(sampleId, testingLoc.id);
      await s().performTestComplete(sampleId, '合格');

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();

      await s().performReview(sampleId, '复核通过');
      await s().performArchive(sampleId, archiveLoc.id);

      const reviewData = await s().getArchiveReviewData(sampleId);
      expect(reviewData).not.toBeNull();

      const duplicateFails = reviewData!.failedTransfers.filter(
        (f) => f.errorCode === 'DUPLICATE_SAMPLE_NO'
      );
      expect(duplicateFails.length).toBeGreaterThanOrEqual(1);

      const failedTimeline = reviewData!.timeline.filter((t) => t.type === 'failed');
      expect(failedTimeline.some((t) => t.errorCode === 'DUPLICATE_SAMPLE_NO')).toBe(true);
    });

    it('should show multiple rollbacks and re-archives correctly', async () => {
      await initAndLogin();
      const { sampleId, archiveTransferId: archiveId1 } = await fullFlowToArchive('S-REV-007', '第一次检测');

      const store = useAppStore.getState();

      const rollback1 = await store.performRollback(archiveId1, '第一次回退：需要重新检测');
      expect(rollback1).not.toBeNull();

      const locations = store.locations;
      const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active')!;
      const testers = store.users.filter((u) => u.role === 'tester');
      const tester = testers[0];

      store.logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.login('tester01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));

      const sample = store.samples.find((s) => s.id === sampleId)!;
      const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;

      await store.performOutbound(sampleId, storageLoc.id, tester.id);
      await store.performTestReceive(sampleId, testingLoc.id);
      await store.performTestComplete(sampleId, '第二次检测合格');

      store.logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.getAllLocations();
      await store.performReview(sampleId, '复核通过');
      const archiveLoc = locations.find((l) => l.type === 'archive' && l.status === 'active')!;
      const archive2 = await store.performArchive(sampleId, archiveLoc.id);
      expect(archive2).not.toBeNull();

      const rollback2 = await store.performRollback(archive2!.id, '第二次回退：发现问题');
      expect(rollback2).not.toBeNull();

      await store.performReview(sampleId, '重新复核');
      const archive3 = await store.performArchive(sampleId, archiveLoc.id);
      expect(archive3).not.toBeNull();

      const reviewData = await store.getArchiveReviewData(sampleId);
      expect(reviewData).not.toBeNull();

      expect(reviewData!.summary.rollbackCount).toBe(2);
      expect(reviewData!.summary.archiveAttempts).toBe(3);
      expect(reviewData!.rollbackRecords.length).toBe(2);
      expect(reviewData!.sample.isArchived).toBe(true);

      const archiveTransfers = reviewData!.timeline.filter(
        (t) => t.action === '归档复核'
      );
      expect(archiveTransfers.length).toBe(3);

      const rolledBackArchives = archiveTransfers.filter((t) => t.isRolledBack);
      expect(rolledBackArchives.length).toBe(2);
    });
  });

  describe('Data Consistency with Existing Modules', () => {
    it('should match data with existing audit timeline', async () => {
      await initAndLogin();
      const { sampleId } = await fullFlowToArchive('S-REV-008');

      const reviewData = await useAppStore.getState().getArchiveReviewData(sampleId);
      expect(reviewData).not.toBeNull();

      const auditLogs = await useAppStore.getState().getAuditLogs();
      const sampleAuditLogs = auditLogs.filter(
        (l) => l.targetId === sampleId || (l.details?.sampleNo as string) === 'S-REV-008'
      );

      expect(sampleAuditLogs.length).toBeGreaterThan(0);

      const reviewTimelineActions = reviewData!.timeline
        .filter((t) => t.type === 'transfer' || t.type === 'review')
        .map((t) => t.action);

      const auditActions = sampleAuditLogs.map((l) => {
        if (l.action === 'sample:review') return '样本复核';
        if (l.action.startsWith('transfer:')) {
          const type = l.action.replace('transfer:', '');
          const labels: Record<string, string> = {
            inbound: '入库登记',
            outbound: '出库交接',
            test_receive: '检测接收',
            test_complete: '检测完成',
            archive: '归档复核',
            rollback: '异常回退',
          };
          return labels[type] || type;
        }
        return null;
      }).filter(Boolean);

      for (const action of auditActions) {
        expect(reviewTimelineActions).toContain(action);
      }
    });

    it('should match failed transfer data with existing failure list', async () => {
      await initAndLogin();
      const s = () => useAppStore.getState();

      const rows = [makeRow('S-REV-009')];
      await s().importBatch(rows, 'BATCH-REV-009');
      const sampleId = s().samples.find((samp) => samp.sampleNo === 'S-REV-009')!.id;

      await s().getAllLocations();
      const locations = s().locations;
      expect(locations.length).toBeGreaterThan(0);
      const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active')!;
      const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active')!;
      const archiveLoc = locations.find((l) => l.type === 'archive' && l.status === 'active')!;

      await s().performTestReceive(sampleId, testingLoc.id);

      await s().getFailedTransfers();
      const allFailures = s().failedTransfers.filter((f) => f.sampleId === sampleId);
      expect(allFailures.length).toBeGreaterThan(0);

      await s().performInbound(sampleId, storageLoc.id);

      await s().getAllUsers();
      const testers = s().users.filter((u) => u.role === 'tester');
      const tester = testers[0];
      expect(tester).toBeDefined();
      await s().performOutbound(sampleId, storageLoc.id, tester.id);
      await s().performTestReceive(sampleId, testingLoc.id);
      await s().performTestComplete(sampleId, '合格');

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();

      await s().performReview(sampleId, '复核通过');
      await s().performArchive(sampleId, archiveLoc.id);

      const reviewData = await s().getArchiveReviewData(sampleId);
      expect(reviewData).not.toBeNull();

      expect(reviewData!.failedTransfers.length).toBe(allFailures.length);
      expect(reviewData!.failedTransfers[0].errorCode).toBe(allFailures[0].errorCode);
      expect(reviewData!.failedTransfers[0].errorMessage).toBe(allFailures[0].errorMessage);
    });

    it('should match rollback data with existing rollback records', async () => {
      await initAndLogin();
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-REV-010');

      const rollbackResult = await useAppStore.getState().performRollback(
        archiveTransferId,
        '一致性测试回退'
      );
      expect(rollbackResult).not.toBeNull();

      const transfers = await useAppStore.getState().getTransferRecordsBySample(sampleId);
      const rollbackTransfers = transfers.filter((t) => t.type === 'rollback');
      expect(rollbackTransfers.length).toBe(1);

      const reviewData = await useAppStore.getState().getArchiveReviewData(sampleId);
      expect(reviewData).not.toBeNull();
      expect(reviewData!.rollbackRecords.length).toBe(1);
      expect(reviewData!.rollbackRecords[0].reason).toBe('一致性测试回退');
      expect(reviewData!.rollbackRecords[0].fromStatus).toBe('archived');
      expect(reviewData!.rollbackRecords[0].toStatus).toBe('tested');
    });
  });

  describe('Permission Control', () => {
    it('should grant archive:review permission to auditor', async () => {
      await initAndLogin();
      const store = useAppStore.getState();
      store.logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));

      const currentUser = store.currentUser;
      expect(currentUser).not.toBeNull();

      const result = hasPermission(currentUser, 'archive:review');
      expect(result.allowed).toBe(true);

      const exportResult = hasPermission(currentUser, 'archive:reviewExport');
      expect(exportResult.allowed).toBe(true);
    });

    it('should grant all permissions to admin', async () => {
      await initAndLogin();

      const currentUser = useAppStore.getState().currentUser;
      expect(currentUser).not.toBeNull();
      expect(currentUser!.role).toBe('admin');

      const result = hasPermission(currentUser, 'archive:review');
      expect(result.allowed).toBe(true);

      const exportResult = hasPermission(currentUser, 'archive:reviewExport');
      expect(exportResult.allowed).toBe(true);
    });

    it('should deny archive:review permission to non-auditor roles', async () => {
      await initAndLogin();
      const store = useAppStore.getState();

      const nonAuditorAccounts = [
        { username: 'collector01', role: 'collector' },
        { username: 'warehouse01', role: 'warehouse' },
        { username: 'tester01', role: 'tester' },
      ];

      for (const account of nonAuditorAccounts) {
        store.logout();
        await new Promise(resolve => setTimeout(resolve, 10));
        const loginResult = await store.login(account.username, '123456');
        expect(loginResult).toBe(true);
        await new Promise(resolve => setTimeout(resolve, 10));
        await store.getAllUsers();
        const freshStore = useAppStore.getState();
        const currentUser = freshStore.currentUser;
        expect(currentUser).not.toBeNull();

        const result = hasPermission(currentUser, 'archive:review');
        expect(result.allowed).toBe(false);
        expect(result.errorCode).toBe('INSUFFICIENT_PERMISSION');

        const exportResult = hasPermission(currentUser, 'archive:reviewExport');
        expect(exportResult.allowed).toBe(false);
      }
    });

    it('should allow auditor to export review data', async () => {
      await initAndLogin();
      const { sampleId } = await fullFlowToArchive('S-REV-011');

      const store = useAppStore.getState();
      store.logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));

      const currentUser = store.currentUser;
      const canExport = hasPermission(currentUser, 'archive:reviewExport');
      expect(canExport.allowed).toBe(true);

      const jsonExport = await useAppStore.getState().exportArchiveReviewData(sampleId, { format: 'json' });
      expect(jsonExport).toBeDefined();
      const parsed = JSON.parse(jsonExport as string);
      expect(parsed.sample.sampleNo).toBe('S-REV-011');

      const csvExport = await useAppStore.getState().exportArchiveReviewData(sampleId, { format: 'csv' });
      expect(csvExport).toBeDefined();
      expect((csvExport as string)).toContain('S-REV-011');
    });

    it('should include lock status correctly for archived samples', async () => {
      await initAndLogin();
      const { sampleId } = await fullFlowToArchive('S-REV-012');

      const reviewData = await useAppStore.getState().getArchiveReviewData(sampleId);
      expect(reviewData).not.toBeNull();
      expect(reviewData!.sample.isLocked).toBe(true);
      expect(reviewData!.sample.lockReason).toBe('样本已归档，所有操作被锁定');

      const jsonExport = await useAppStore.getState().exportArchiveReviewData(sampleId, { format: 'json' });
      const parsed = JSON.parse(jsonExport as string);
      expect(parsed.sample.isLocked).toBe(true);
      expect(parsed.sample.lockReason).toBe('样本已归档，所有操作被锁定');
    });
  });

  describe('Export Content Validation', () => {
    it('should include all required sections in JSON export', async () => {
      await initAndLogin();
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-REV-013');

      await useAppStore.getState().performRollback(archiveTransferId, '测试导出内容');

      const store = useAppStore.getState();
      const sample = store.samples.find((s) => s.id === sampleId)!;
      const locations = store.locations;
      const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active')!;
      await store.performTestReceive(sampleId, testingLoc.id);

      store.logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await store.login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));

      const jsonExport = await store.exportArchiveReviewData(sampleId, { format: 'json' });
      const parsed = JSON.parse(jsonExport as string);

      expect(parsed.exportedAt).toBeDefined();
      expect(parsed.sample).toBeDefined();
      expect(parsed.summary).toBeDefined();
      expect(parsed.timeline).toBeDefined();
      expect(parsed.failedTransfers).toBeDefined();
      expect(parsed.rollbackRecords).toBeDefined();

      expect(parsed.sample.sampleNo).toBe('S-REV-013');
      expect(parsed.summary.failedAttempts).toBeGreaterThan(0);
      expect(parsed.summary.rollbackCount).toBe(1);
      expect(parsed.timeline.length).toBeGreaterThan(0);
      expect(parsed.failedTransfers.length).toBeGreaterThan(0);
      expect(parsed.rollbackRecords.length).toBe(1);
    });

    it('should include all required sections in CSV export', async () => {
      await initAndLogin();
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-REV-014');

      await useAppStore.getState().performRollback(archiveTransferId, '测试CSV导出');

      const csvExport = await useAppStore.getState().exportArchiveReviewData(sampleId, { format: 'csv' });
      const csvStr = csvExport as string;

      expect(csvStr).toContain('=== 样本归档复盘报告 ===');
      expect(csvStr).toContain('=== 样本基本信息 ===');
      expect(csvStr).toContain('=== 统计摘要 ===');
      expect(csvStr).toContain('=== 完整时间线 ===');
      expect(csvStr).toContain('=== 失败记录 ===');
      expect(csvStr).toContain('=== 回退记录 ===');
      expect(csvStr).toContain('S-REV-014');
      expect(csvStr).toContain('测试CSV导出');
    });

    it('should respect export options for selective export', async () => {
      await initAndLogin();
      const { sampleId } = await fullFlowToArchive('S-REV-015');

      const jsonFull = await useAppStore.getState().exportArchiveReviewData(sampleId, {
        format: 'json',
        includeFullTimeline: true,
        includeFailedRecords: true,
        includeRollbackRecords: true,
      });
      const parsedFull = JSON.parse(jsonFull as string);
      expect(parsedFull.timeline).toBeDefined();
      expect(parsedFull.failedTransfers).toBeDefined();
      expect(parsedFull.rollbackRecords).toBeDefined();

      const jsonMinimal = await useAppStore.getState().exportArchiveReviewData(sampleId, {
        format: 'json',
        includeFullTimeline: false,
        includeFailedRecords: false,
        includeRollbackRecords: false,
      });
      const parsedMinimal = JSON.parse(jsonMinimal as string);
      expect(parsedMinimal.timeline).toBeUndefined();
      expect(parsedMinimal.failedTransfers).toBeUndefined();
      expect(parsedMinimal.rollbackRecords).toBeUndefined();
      expect(parsedMinimal.sample).toBeDefined();
      expect(parsedMinimal.summary).toBeDefined();
    });
  });
});
