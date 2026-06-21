import { describe, it, expect } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import { hasPermission } from '../services/permissionService';
import { checkFlowTracePermission } from '../services/flowTracePermissionService';
import type { SampleImportRow, FlowTraceDetailData, FlowTraceSampleSummary } from '@shared/types';
import { resetDBInstance } from '../lib/db';
import { FLOW_TRACE_STAGE_LABELS, ERROR_CATEGORY_LABELS, STATUS_LABELS } from '@shared/constants';

const ADMIN_USER = { username: 'admin', password: '123456' };

const makeRow = (sampleNo: string, overrides?: Partial<SampleImportRow>): SampleImportRow => ({
  sampleNo,
  type: 'blood',
  collectedAt: '2025-06-21T10:00:00Z',
  collectedBy: '张采集',
  ...overrides,
});

const s = () => useAppStore.getState();

const initAndLogin = async () => {
  const store = s();
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

const simulateRestart = async () => {
  resetDBInstance();
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
  await s().initializeDB();
};

const fullFlowToArchive = async (sampleNo: string, testResult = '合格') => {
  await initAndLogin();

  const rows = [makeRow(sampleNo)];
  await s().importBatch(rows, `BATCH-FT-${sampleNo}`);

  const sample = s().samples.find((samp) => samp.sampleNo === sampleNo);
  expect(sample).toBeDefined();

  const locations = s().locations;
  expect(locations.length).toBeGreaterThan(0);
  const storageLoc = locations.find((l) => l.type === 'storage' && l.status === 'active');
  expect(storageLoc).toBeDefined();

  await s().performInbound(sample!.id, storageLoc!.id);

  const testers = s().users.filter((u) => u.role === 'tester');
  const tester = testers[0];
  expect(tester).toBeDefined();
  await s().performOutbound(sample!.id, storageLoc!.id, tester.id);

  const testingLoc = locations.find((l) => l.type === 'testing' && l.status === 'active');
  expect(testingLoc).toBeDefined();
  await s().performTestReceive(sample!.id, testingLoc!.id);

  const testCompleteResult = await s().performTestComplete(sample!.id, testResult);
  expect(testCompleteResult).not.toBeNull();

  s().logout();
  await new Promise(resolve => setTimeout(resolve, 10));
  const loginAuditor = await s().login('auditor01', '123456');
  expect(loginAuditor).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 10));
  await s().getAllLocations();

  const reviewResult = await s().performReview(sample!.id, '复核通过');
  expect(reviewResult).toBe(true);

  const archiveLoc = s().locations.find((l) => l.type === 'archive' && l.status === 'active');
  expect(archiveLoc).toBeDefined();
  const archiveResult = await s().performArchive(sample!.id, archiveLoc!.id);
  expect(archiveResult).not.toBeNull();

  return { sampleId: sample!.id, archiveTransferId: archiveResult!.id };
};

describe('Flow Trace Desk - Core Functionality', () => {
  describe('List and Filtering', () => {
    it('should return flow trace list with sample summaries', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-LIST-001'), makeRow('S-FT-LIST-002')];
      await s().importBatch(rows, 'BATCH-FT-LIST-001');

      const list = await s().getFlowTraceList();
      expect(list.length).toBeGreaterThanOrEqual(2);

      const sample1 = list.find((samp) => samp.sampleNo === 'S-FT-LIST-001');
      expect(sample1).toBeDefined();
      expect(sample1!.batchNo).toBe('BATCH-FT-LIST-001');
      expect(sample1!.currentStatus).toBe('imported');
      expect(sample1!.currentStage).toBe('import');
      expect(sample1!.isArchived).toBe(false);
      expect(sample1!.isLocked).toBe(false);
    });

    it('should filter by keyword correctly', async () => {
      await initAndLogin();

      await s().importBatch([makeRow('S-FT-FILT-001')], 'BATCH-FT-FILT-A');
      await s().importBatch([makeRow('S-FT-FILT-002')], 'BATCH-FT-FILT-B');

      const filteredByNo = await s().getFlowTraceList({ keyword: 'S-FT-FILT-001' });
      expect(filteredByNo.length).toBe(1);
      expect(filteredByNo[0].sampleNo).toBe('S-FT-FILT-001');

      const filteredByBatch = await s().getFlowTraceList({ keyword: 'BATCH-FT-FILT-A' });
      expect(filteredByBatch.length).toBe(1);
    });

    it('should filter by status correctly', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-STAT-001'), makeRow('S-FT-STAT-002')];
      await s().importBatch(rows, 'BATCH-FT-STAT-001');

      const sample1 = s().samples.find((samp) => samp.sampleNo === 'S-FT-STAT-001');
      expect(sample1).toBeDefined();
      const storageLoc = s().locations.find((l) => l.type === 'storage' && l.status === 'active');
      expect(storageLoc).toBeDefined();
      await s().performInbound(sample1!.id, storageLoc!.id);

      const importedList = await s().getFlowTraceList({ status: 'imported' });
      expect(importedList.some((samp) => samp.sampleNo === 'S-FT-STAT-002')).toBe(true);
      expect(importedList.some((samp) => samp.sampleNo === 'S-FT-STAT-001')).toBe(false);

      const inStockList = await s().getFlowTraceList({ status: 'in_stock' });
      expect(inStockList.some((samp) => samp.sampleNo === 'S-FT-STAT-001')).toBe(true);
    });

    it('should filter by hasFailed flag correctly', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-FAIL-001')];
      await s().importBatch(rows, 'BATCH-FT-FAIL-001');

      const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-FAIL-001');
      expect(sample).toBeDefined();
      const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
      expect(testingLoc).toBeDefined();
      await s().performTestReceive(sample!.id, testingLoc!.id);

      await s().getFailedTransfers();

      const failedList = await s().getFlowTraceList({ hasFailed: true });
      expect(failedList.some((samp) => samp.sampleNo === 'S-FT-FAIL-001')).toBe(true);
      expect(failedList[0].failedAttempts).toBeGreaterThan(0);
      expect(failedList[0].hasBlockedOps).toBe(true);
    });

    it('should filter by hasRollback flag correctly', async () => {
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-RB-001');

      await s().performRollback(archiveTransferId, '测试回退');

      const rollbackList = await s().getFlowTraceList({ hasRollback: true });
      const targetSample = rollbackList.find((samp) => samp.id === sampleId);
      expect(targetSample).toBeDefined();
      expect(targetSample!.rollbackCount).toBe(1);
    });

    it('should filter by isLocked flag correctly', async () => {
      const { sampleId } = await fullFlowToArchive('S-FT-LOCK-001');

      const lockedList = await s().getFlowTraceList({ isLocked: true });
      const targetSample = lockedList.find((samp) => samp.id === sampleId);
      expect(targetSample).toBeDefined();
      expect(targetSample!.isLocked).toBe(true);
      expect(targetSample!.lockReason).toBe('样本已归档，所有操作被锁定');
    });

    it('should filter by isArchived flag correctly', async () => {
      const { sampleId } = await fullFlowToArchive('S-FT-ARCH-001');

      const archivedList = await s().getFlowTraceList({ isArchived: true });
      expect(archivedList.some((samp) => samp.id === sampleId)).toBe(true);

      const unarchivedList = await s().getFlowTraceList({ isArchived: false });
      expect(unarchivedList.some((samp) => samp.id === sampleId)).toBe(false);
    });
  });

  describe('Detail Data - Business Chain', () => {
    it('should build correct business chain for full flow sample', async () => {
      const { sampleId } = await fullFlowToArchive('S-FT-CHAIN-001');

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData).not.toBeNull();
      expect(traceData!.businessChain.length).toBeGreaterThan(0);

      const stageKeys = traceData!.businessChain.map((st) => st.key);
      expect(stageKeys).toContain('import');
      expect(stageKeys).toContain('inbound');
      expect(stageKeys).toContain('outbound');
      expect(stageKeys).toContain('test_receive');
      expect(stageKeys).toContain('test_complete');
      expect(stageKeys).toContain('review');
      expect(stageKeys).toContain('archive');
    });

    it('should correctly mark completed and current stages', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-STAGE-001')];
      await s().importBatch(rows, 'BATCH-FT-STAGE-001');

      const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-STAGE-001');
      expect(sample).toBeDefined();
      const storageLoc = s().locations.find((l) => l.type === 'storage' && l.status === 'active');
      expect(storageLoc).toBeDefined();
      await s().performInbound(sample!.id, storageLoc!.id);

      const traceData = await s().getFlowTraceData(sample!.id);
      expect(traceData).not.toBeNull();

      const importStage = traceData!.businessChain.find((st) => st.key === 'import');
      expect(importStage).toBeDefined();
      expect(importStage!.status).toBe('completed');

      const inboundStage = traceData!.businessChain.find((st) => st.key === 'inbound');
      expect(inboundStage).toBeDefined();
      expect(inboundStage!.status).toBe('current');

      const outboundStage = traceData!.businessChain.find((st) => st.key === 'outbound');
      expect(outboundStage).toBeDefined();
      expect(outboundStage!.status).toBe('pending');
    });

    it('should include stage timestamps and operator info', async () => {
      const { sampleId } = await fullFlowToArchive('S-FT-INFO-001');

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData).not.toBeNull();

      const archiveStage = traceData!.businessChain.find((st) => st.key === 'archive');
      expect(archiveStage).toBeDefined();
      expect(archiveStage!.timestamp).toBeTruthy();
      expect(archiveStage!.operatorName).toBeTruthy();
      expect(archiveStage!.status).toBe('current');
    });
  });

  describe('Detail Data - Latest Valid Transfer', () => {
    it('should return the latest valid transfer', async () => {
      const { sampleId } = await fullFlowToArchive('S-FT-LATEST-001');

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData).not.toBeNull();
      expect(traceData!.latestValidTransfer).not.toBeNull();
      expect(traceData!.latestValidTransfer!.type).toBe('archive');
      expect(traceData!.latestValidTransfer!.operatorName).toBeTruthy();
    });

    it('should return import transfer for newly imported sample', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-NOLATEST-001')];
      await s().importBatch(rows, 'BATCH-FT-NOLATEST-001');

      const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-NOLATEST-001');
      expect(sample).toBeDefined();
      const traceData = await s().getFlowTraceData(sample!.id);

      expect(traceData!.latestValidTransfer).not.toBeNull();
      expect(traceData!.latestValidTransfer!.type).toBe('import');
    });
  });

  describe('Detail Data - Blocked Operations', () => {
    it('should categorize permission errors correctly', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-PERM-001')];
      await s().importBatch(rows, 'BATCH-FT-PERM-001');

      const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-PERM-001');
      expect(sample).toBeDefined();

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      const loginResult = await s().login('collector01', '123456');
      expect(loginResult).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getAllLocations();

      const currentUser = s().currentUser;
      expect(currentUser).not.toBeNull();
      expect(currentUser!.role).toBe('collector');

      const storageLoc = s().locations.find((l) => l.type === 'storage' && l.status === 'active');
      expect(storageLoc).toBeDefined();
      await s().performInbound(sample!.id, storageLoc!.id);

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().login('auditor01', '123456');
      await new Promise(resolve => setTimeout(resolve, 10));
      await s().getFailedTransfers();

      const traceData = await s().getFlowTraceData(sample!.id);
      expect(traceData).not.toBeNull();
      expect(traceData!.blockedOperations.length).toBeGreaterThan(0);

      const permErrors = traceData!.blockedOperations.filter(
        (op) => op.errorCategory === 'permission'
      );
      expect(permErrors.length).toBeGreaterThan(0);
    });

    it('should categorize status conflict errors correctly', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-STATERR-001')];
      await s().importBatch(rows, 'BATCH-FT-STATERR-001');

      const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-STATERR-001');
      expect(sample).toBeDefined();
      const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
      expect(testingLoc).toBeDefined();
      await s().performTestReceive(sample!.id, testingLoc!.id);

      await s().getFailedTransfers();

      const traceData = await s().getFlowTraceData(sample!.id);
      expect(traceData).not.toBeNull();

      const statusErrors = traceData!.blockedOperations.filter(
        (op) => op.errorCategory === 'status'
      );
      expect(statusErrors.length).toBeGreaterThan(0);
    });

    it('should categorize duplicate errors correctly', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-DUP-001'), makeRow('S-FT-DUP-001')];
      await s().importBatch(rows, 'BATCH-FT-DUP-001');

      const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-DUP-001');
      expect(sample).toBeDefined();
      const traceData = await s().getFlowTraceData(sample!.id);
      expect(traceData).not.toBeNull();

      const dupErrors = traceData!.blockedOperations.filter(
        (op) => op.errorCategory === 'duplicate'
      );
      expect(dupErrors.length).toBeGreaterThanOrEqual(1);
    });

    it('should include error code and message for each blocked operation', async () => {
      await initAndLogin();

      const rows = [makeRow('S-FT-ERRINFO-001')];
      await s().importBatch(rows, 'BATCH-FT-ERRINFO-001');

      const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-ERRINFO-001');
      expect(sample).toBeDefined();
      const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
      expect(testingLoc).toBeDefined();
      await s().performTestReceive(sample!.id, testingLoc!.id);

      await s().getFailedTransfers();

      const traceData = await s().getFlowTraceData(sample!.id);
      expect(traceData!.blockedOperations.length).toBeGreaterThan(0);

      const firstBlocked = traceData!.blockedOperations[0];
      expect(firstBlocked.errorCode).toBeTruthy();
      expect(firstBlocked.errorMessage).toBeTruthy();
      expect(firstBlocked.attemptedAt).toBeTruthy();
      expect(firstBlocked.attemptedByName).toBeTruthy();
    });
  });

  describe('Detail Data - Rollback History', () => {
    it('should record rollback history with landing stage', async () => {
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-RBHIST-001');

      await s().performRollback(archiveTransferId, '测试回退历史');

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData).not.toBeNull();
      expect(traceData!.rollbackHistory.length).toBe(1);

      const rollback = traceData!.rollbackHistory[0];
      expect(rollback.reason).toBe('测试回退历史');
      expect(rollback.rolledBackStage).toBe('archive');
      expect(rollback.landingStage).toBe('test_complete');
      expect(rollback.fromStatus).toBe('archived');
      expect(rollback.toStatus).toBe('tested');
      expect(rollback.rollbackByName).toBeTruthy();
    });

    it('should handle multiple rollbacks', async () => {
      const { sampleId, archiveTransferId: archiveId1 } = await fullFlowToArchive('S-FT-MULTIRB-001', '第一次检测');

      await s().performRollback(archiveId1, '第一次回退');

      const archiveLoc = s().locations.find((l) => l.type === 'archive' && l.status === 'active');
      expect(archiveLoc).toBeDefined();
      await s().performReview(sampleId, '重新复核');
      const archive2 = await s().performArchive(sampleId, archiveLoc!.id);
      expect(archive2).not.toBeNull();

      await s().performRollback(archive2!.id, '第二次回退');

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData!.rollbackHistory.length).toBe(2);
      expect(traceData!.summary.rollbackCount).toBe(2);
    });
  });

  describe('Detail Data - Full Timeline', () => {
    it('should include all events in chronological order', async () => {
      const { sampleId } = await fullFlowToArchive('S-FT-TL-001');

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData).not.toBeNull();
      expect(traceData!.fullTimeline.length).toBeGreaterThan(0);

      const timestamps = traceData!.fullTimeline.map((t) => t.timestamp);
      const sortedTimestamps = [...timestamps].sort();
      expect(timestamps).toEqual(sortedTimestamps);
    });

    it('should include transfer, rollback, and failed events', async () => {
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-TLTYPE-001');

      const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
      expect(testingLoc).toBeDefined();
      await s().performTestReceive(sampleId, testingLoc!.id);

      await s().performRollback(archiveTransferId, '测试时间线类型');

      await s().getFailedTransfers();

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData).not.toBeNull();

      const types = new Set(traceData!.fullTimeline.map((t) => t.type));
      expect(types.has('transfer')).toBe(true);
      expect(types.has('rollback')).toBe(true);
      expect(types.has('failed')).toBe(true);
    });

    it('should mark rolled back transfers correctly', async () => {
      const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-TLRB-001');

      await s().performRollback(archiveTransferId, '测试已回退标记');

      const traceData = await s().getFlowTraceData(sampleId);
      const archiveTransfer = traceData!.fullTimeline.find(
        (t) => t.type === 'transfer' && t.stageKey === 'archive'
      );
      expect(archiveTransfer).toBeDefined();
      expect(archiveTransfer!.isRolledBack).toBe(true);
    });
  });

  describe('Detail Data - Summary', () => {
    it('should calculate summary statistics correctly', async () => {
      const { sampleId } = await fullFlowToArchive('S-FT-SUM-001');

      const traceData = await s().getFlowTraceData(sampleId);
      expect(traceData).not.toBeNull();
      expect(traceData!.summary.totalTransfers).toBeGreaterThan(0);
      expect(traceData!.summary.validTransfers).toBeGreaterThan(0);
      expect(traceData!.summary.archiveAttempts).toBe(1);
      expect(traceData!.summary.currentStageLabel).toBeTruthy();
      expect(traceData!.summary.daysInCurrentStage).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('Flow Trace Desk - Data Persistence After Restart', () => {
  it('should show consistent flow trace list after restart', async () => {
    await initAndLogin();

    const rows = [makeRow('S-FT-PERS-001'), makeRow('S-FT-PERS-002')];
    await s().importBatch(rows, 'BATCH-FT-PERS-001');

    const list1 = await s().getFlowTraceList();
    const sampleCount1 = list1.filter((samp) => samp.sampleNo.startsWith('S-FT-PERS-')).length;

    await simulateRestart();
    await s().login('admin', '123456');
    await new Promise(resolve => setTimeout(resolve, 10));

    const list2 = await s().getFlowTraceList();
    const sampleCount2 = list2.filter((samp) => samp.sampleNo.startsWith('S-FT-PERS-')).length;

    expect(sampleCount2).toBe(sampleCount1);
  });

  it('should show consistent detail data after restart', async () => {
    const { sampleId } = await fullFlowToArchive('S-FT-PERSDET-001');

    const traceData1 = await s().getFlowTraceData(sampleId);
    expect(traceData1).not.toBeNull();

    await simulateRestart();
    await s().login('auditor01', '123456');
    await new Promise(resolve => setTimeout(resolve, 10));

    const traceData2 = await s().getFlowTraceData(sampleId);
    expect(traceData2).not.toBeNull();

    expect(traceData2!.sample.id).toBe(traceData1!.sample.id);
    expect(traceData2!.sample.sampleNo).toBe(traceData1!.sample.sampleNo);
    expect(traceData2!.sample.isArchived).toBe(true);
    expect(traceData2!.sample.isLocked).toBe(true);
    expect(traceData2!.businessChain.length).toBe(traceData1!.businessChain.length);
    expect(traceData2!.summary.totalTransfers).toBe(traceData1!.summary.totalTransfers);
  });

  it('should maintain rollback state after restart', async () => {
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-PERSRB-001');

    await s().performRollback(archiveTransferId, '重启前回退');

    const traceData1 = await s().getFlowTraceData(sampleId);
    expect(traceData1!.rollbackHistory.length).toBe(1);

    await simulateRestart();
    await s().login('auditor01', '123456');
    await new Promise(resolve => setTimeout(resolve, 10));

    const traceData2 = await s().getFlowTraceData(sampleId);
    expect(traceData2!.sample.isArchived).toBe(false);
    expect(traceData2!.rollbackHistory.length).toBe(1);
    expect(traceData2!.rollbackHistory[0].reason).toBe('重启前回退');
  });

  it('should maintain failed operations after restart', async () => {
    await initAndLogin();

    const rows = [makeRow('S-FT-PERSFAIL-001')];
    await s().importBatch(rows, 'BATCH-FT-PERSFAIL-001');

    const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-PERSFAIL-001');
    expect(sample).toBeDefined();
    const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
    expect(testingLoc).toBeDefined();
    await s().performTestReceive(sample!.id, testingLoc!.id);

    await s().getFailedTransfers();
    const traceData1 = await s().getFlowTraceData(sample!.id);
    const failCount1 = traceData1!.blockedOperations.length;

    await simulateRestart();
    await s().login('admin', '123456');
    await new Promise(resolve => setTimeout(resolve, 10));
    await s().getFailedTransfers();

    const traceData2 = await s().getFlowTraceData(sample!.id);
    expect(traceData2!.blockedOperations.length).toBe(failCount1);
  });
});

describe('Flow Trace Desk - Export Functionality', () => {
  it('should export JSON format with all required sections', async () => {
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-EXP-001');

    await s().performRollback(archiveTransferId, '测试导出');

    const jsonExport = await s().exportFlowTraceData(sampleId, {
      format: 'json',
      includeBusinessChain: true,
      includeFullTimeline: true,
      includeBlockedOps: true,
      includeRollbackHistory: true,
      includeSummary: true,
    });

    const parsed = JSON.parse(jsonExport as string);

    expect(parsed.exportedAt).toBeTruthy();
    expect(parsed.sample).toBeTruthy();
    expect(parsed.sample.sampleNo).toBe('S-FT-EXP-001');
    expect(parsed.summary).toBeTruthy();
    expect(parsed.businessChain).toBeTruthy();
    expect(parsed.latestValidTransfer).toBeTruthy();
    expect(parsed.blockedOperations).toBeTruthy();
    expect(parsed.rollbackHistory).toBeTruthy();
    expect(parsed.fullTimeline).toBeTruthy();
  });

  it('should export CSV format with clear sections for sample with failures and rollbacks', async () => {
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-EXP-002');

    const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
    expect(testingLoc).toBeDefined();
    await s().performTestReceive(sampleId, testingLoc!.id);

    await s().performRollback(archiveTransferId, '测试导出');

    await s().getFailedTransfers();

    const csvExport = await s().exportFlowTraceData(sampleId, {
      format: 'csv',
      includeBusinessChain: true,
      includeFullTimeline: true,
      includeBlockedOps: true,
      includeRollbackHistory: true,
      includeSummary: true,
    });

    const csvStr = csvExport as string;

    expect(csvStr).toContain('=== 样本流转追溯记录 ===');
    expect(csvStr).toContain('=== 样本基本信息 ===');
    expect(csvStr).toContain('=== 统计摘要 ===');
    expect(csvStr).toContain('=== 最近一次有效流转 ===');
    expect(csvStr).toContain('=== 业务环节链 ===');
    expect(csvStr).toContain('=== 被拦截/失败操作记录 ===');
    expect(csvStr).toContain('=== 回退历史记录 ===');
    expect(csvStr).toContain('=== 完整时间线 ===');
    expect(csvStr).toContain('S-FT-EXP-002');
  });

  it('should include Chinese stage names in export', async () => {
    const { sampleId } = await fullFlowToArchive('S-FT-EXPZH-001');

    const csvExport = await s().exportFlowTraceData(sampleId, {
      format: 'csv',
      includeBusinessChain: true,
    });

    const csvStr = csvExport as string;
    expect(csvStr).toContain(FLOW_TRACE_STAGE_LABELS.import);
    expect(csvStr).toContain(FLOW_TRACE_STAGE_LABELS.inbound);
    expect(csvStr).toContain(FLOW_TRACE_STAGE_LABELS.outbound);
    expect(csvStr).toContain(FLOW_TRACE_STAGE_LABELS.archive);
  });

  it('should include error categories in export', async () => {
    await initAndLogin();

    const rows = [makeRow('S-FT-EXPERR-001'), makeRow('S-FT-EXPERR-001')];
    await s().importBatch(rows, 'BATCH-FT-EXPERR-001');

    const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-EXPERR-001');
    expect(sample).toBeDefined();
    const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
    expect(testingLoc).toBeDefined();
    await s().performTestReceive(sample!.id, testingLoc!.id);

    await s().getFailedTransfers();

    const csvExport = await s().exportFlowTraceData(sample!.id, {
      format: 'csv',
      includeBlockedOps: true,
    });

    const csvStr = csvExport as string;
    expect(csvStr).toContain(ERROR_CATEGORY_LABELS.duplicate);
    expect(csvStr).toContain(ERROR_CATEGORY_LABELS.status);
  });

  it('should include rollback landing stage in export', async () => {
    const { sampleId, archiveTransferId } = await fullFlowToArchive('S-FT-EXPRB-001');

    await s().performRollback(archiveTransferId, '导出回退测试');

    const csvExport = await s().exportFlowTraceData(sampleId, {
      format: 'csv',
      includeRollbackHistory: true,
    });

    const csvStr = csvExport as string;
    expect(csvStr).toContain('撤回落点环节');
    expect(csvStr).toContain(FLOW_TRACE_STAGE_LABELS.archive);
    expect(csvStr).toContain(FLOW_TRACE_STAGE_LABELS.test_complete);
  });

  it('should respect export options for selective export', async () => {
    const { sampleId } = await fullFlowToArchive('S-FT-EXPOPT-001');

    const jsonFull = await s().exportFlowTraceData(sampleId, {
      format: 'json',
      includeBusinessChain: true,
      includeFullTimeline: true,
      includeBlockedOps: true,
      includeRollbackHistory: true,
      includeSummary: true,
    });
    const parsedFull = JSON.parse(jsonFull as string);
    expect(parsedFull.businessChain).toBeDefined();
    expect(parsedFull.fullTimeline).toBeDefined();

    const jsonMinimal = await s().exportFlowTraceData(sampleId, {
      format: 'json',
      includeBusinessChain: false,
      includeFullTimeline: false,
      includeBlockedOps: false,
      includeRollbackHistory: false,
      includeSummary: false,
    });
    const parsedMinimal = JSON.parse(jsonMinimal as string);
    expect(parsedMinimal.businessChain).toBeUndefined();
    expect(parsedMinimal.fullTimeline).toBeUndefined();
    expect(parsedMinimal.sample).toBeDefined();
  });

  it('exported data should match current interface state', async () => {
    const { sampleId } = await fullFlowToArchive('S-FT-EXPMATCH-001');

    const traceData = await s().getFlowTraceData(sampleId);

    const jsonExport = await s().exportFlowTraceData(sampleId, { format: 'json' });
    const parsed = JSON.parse(jsonExport as string);

    expect(parsed.sample.sampleNo).toBe(traceData!.sample.sampleNo);
    expect(parsed.summary.totalTransfers).toBe(traceData!.summary.totalTransfers);
    expect(parsed.businessChain.length).toBe(traceData!.businessChain.length);
    expect(parsed.fullTimeline.length).toBe(traceData!.fullTimeline.length);
  });
});

describe('Flow Trace Desk - Permission Control', () => {
  it('should grant flowTrace permissions to auditor', async () => {
    await initAndLogin();

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    const loginResult = await s().login('auditor01', '123456');
    expect(loginResult).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));

    const currentUser = s().currentUser;
    expect(currentUser).not.toBeNull();
    expect(currentUser!.role).toBe('auditor');

    const viewResult = hasPermission(currentUser, 'flowTrace:view');
    expect(viewResult.allowed).toBe(true);

    const detailResult = hasPermission(currentUser, 'flowTrace:viewDetail');
    expect(detailResult.allowed).toBe(true);

    const exportResult = hasPermission(currentUser, 'flowTrace:export');
    expect(exportResult.allowed).toBe(true);
  });

  it('should grant all flowTrace permissions to admin', async () => {
    await initAndLogin();

    const currentUser = s().currentUser;
    expect(currentUser).not.toBeNull();
    expect(currentUser!.role).toBe('admin');

    expect(hasPermission(currentUser, 'flowTrace:view').allowed).toBe(true);
    expect(hasPermission(currentUser, 'flowTrace:viewDetail').allowed).toBe(true);
    expect(hasPermission(currentUser, 'flowTrace:export').allowed).toBe(true);
  });

  it('should grant basic flowTrace permissions to non-auditor roles with data redaction', async () => {
    await initAndLogin();

    const nonAuditorAccounts = [
      { username: 'collector01', role: 'collector' },
      { username: 'warehouse01', role: 'warehouse' },
      { username: 'tester01', role: 'tester' },
    ];

    for (const account of nonAuditorAccounts) {
      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
      const loginResult = await s().login(account.username, '123456');
      expect(loginResult).toBe(true);
      await new Promise(resolve => setTimeout(resolve, 10));

      const currentUser = s().currentUser;
      expect(currentUser).not.toBeNull();
      expect(currentUser!.role).toBe(account.role);

      expect(hasPermission(currentUser, 'flowTrace:view').allowed).toBe(true);
      expect(hasPermission(currentUser, 'flowTrace:viewDetail').allowed).toBe(true);
      expect(hasPermission(currentUser, 'flowTrace:export').allowed).toBe(true);

      const permCheck = checkFlowTracePermission(currentUser, 'viewList');
      expect(permCheck.decision).toBe('redact');
      expect(permCheck.reason).toBe('非审核员角色，数据将被脱敏');
    }
  });

  it('auditor should be able to export flow trace data', async () => {
    const { sampleId } = await fullFlowToArchive('S-FT-PERMEXP-001');

    const currentUser = s().currentUser;
    expect(currentUser).not.toBeNull();
    expect(currentUser!.role).toBe('auditor');

    const canExport = hasPermission(currentUser, 'flowTrace:export');
    expect(canExport.allowed).toBe(true);

    const jsonExport = await s().exportFlowTraceData(sampleId, { format: 'json' });
    expect(jsonExport).toBeDefined();
    const parsed = JSON.parse(jsonExport as string);
    expect(parsed.sample.sampleNo).toBe('S-FT-PERMEXP-001');
  });

  it('collector should have basic flowTrace permissions but with data redaction', async () => {
    await initAndLogin();

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    const loginResult = await s().login('collector01', '123456');
    expect(loginResult).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));

    const currentUser = s().currentUser;
    expect(currentUser).not.toBeNull();
    expect(currentUser!.role).toBe('collector');

    const canView = hasPermission(currentUser, 'flowTrace:view');
    expect(canView.allowed).toBe(true);

    const permCheck = checkFlowTracePermission(currentUser, 'viewList');
    expect(permCheck.decision).toBe('redact');
    expect(permCheck.reason).toBe('非审核员角色，数据将被脱敏');
  });
});

describe('Flow Trace Desk - Complex Scenarios', () => {
  it('should correctly separate valid transfers, failed attempts, and rollbacks', async () => {
    await initAndLogin();

    const rows = [makeRow('S-FT-COMPLEX-001')];
    await s().importBatch(rows, 'BATCH-FT-COMPLEX-001');
    const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-COMPLEX-001');
    expect(sample).toBeDefined();
    const sampleId = sample!.id;

    const storageLoc = s().locations.find((l) => l.type === 'storage' && l.status === 'active');
    expect(storageLoc).toBeDefined();
    const testingLoc = s().locations.find((l) => l.type === 'testing' && l.status === 'active');
    expect(testingLoc).toBeDefined();
    const archiveLoc = s().locations.find((l) => l.type === 'archive' && l.status === 'active');
    expect(archiveLoc).toBeDefined();

    await s().performInbound(sampleId, storageLoc!.id);

    await s().performTestReceive(sampleId, testingLoc!.id);

    const testers = s().users.filter((u) => u.role === 'tester');
    const tester = testers[0];
    expect(tester).toBeDefined();
    await s().performOutbound(sampleId, storageLoc!.id, tester.id);

    await s().performTestReceive(sampleId, testingLoc!.id);
    await s().performTestComplete(sampleId, '合格');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await s().login('auditor01', '123456');
    await new Promise(resolve => setTimeout(resolve, 10));
    await s().getAllLocations();

    await s().performReview(sampleId, '复核通过');
    await s().performArchive(sampleId, archiveLoc!.id);

    await s().getFailedTransfers();

    const traceData = await s().getFlowTraceData(sampleId);
    expect(traceData).not.toBeNull();

    const validCount = traceData!.summary.validTransfers;
    const failedCount = traceData!.summary.failedAttempts;
    const rollbackCount = traceData!.summary.rollbackCount;

    expect(validCount).toBeGreaterThan(0);
    expect(failedCount).toBeGreaterThan(0);
    expect(rollbackCount).toBe(0);

    const blockedOps = traceData!.blockedOperations;
    expect(blockedOps.length).toBeGreaterThan(0);
    expect(blockedOps.some((op) => op.errorCategory === 'status')).toBe(true);

    const categories = new Set(blockedOps.map((op) => op.errorCategory));
    expect(categories.size).toBeGreaterThanOrEqual(1);
  });

  it('should handle multiple duplicate import attempts', async () => {
    await initAndLogin();

    await s().importBatch([makeRow('S-FT-DUPMULTI-001')], 'BATCH-FT-DUPMULTI-1');
    await s().importBatch([makeRow('S-FT-DUPMULTI-001')], 'BATCH-FT-DUPMULTI-2');
    await s().importBatch([makeRow('S-FT-DUPMULTI-001'), makeRow('S-FT-DUPMULTI-002')], 'BATCH-FT-DUPMULTI-3');

    const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-DUPMULTI-001');
    expect(sample).toBeDefined();

    await s().getFailedTransfers();

    const traceData = await s().getFlowTraceData(sample!.id);
    expect(traceData).not.toBeNull();

    const dupErrors = traceData!.blockedOperations.filter(
      (op) => op.errorCategory === 'duplicate'
    );
    expect(dupErrors.length).toBeGreaterThanOrEqual(2);
  });

  it('should show correct stage status after rollback and re-archive', async () => {
    const { sampleId, archiveTransferId: archiveId1 } = await fullFlowToArchive('S-FT-REARCH-001', '第一次检测');

    await s().performRollback(archiveId1, '第一次回退');

    const traceData1 = await s().getFlowTraceData(sampleId);
    const archiveStage1 = traceData1!.businessChain.find((st) => st.key === 'archive');
    expect(archiveStage1).toBeDefined();
    expect(archiveStage1!.status).toBe('rolled_back');

    const archiveLoc = s().locations.find((l) => l.type === 'archive' && l.status === 'active');
    expect(archiveLoc).toBeDefined();
    await s().performReview(sampleId, '重新复核');
    const archive2 = await s().performArchive(sampleId, archiveLoc!.id);
    expect(archive2).not.toBeNull();

    const traceData2 = await s().getFlowTraceData(sampleId);
    const archiveStage2 = traceData2!.businessChain.find((st) => st.key === 'archive');
    expect(archiveStage2).toBeDefined();
    expect(archiveStage2!.status).toBe('current');
    expect(traceData2!.summary.archiveAttempts).toBe(2);
  });

  it('should handle permission and status errors together', async () => {
    await initAndLogin();

    const rows = [makeRow('S-FT-MIXERR-001')];
    await s().importBatch(rows, 'BATCH-FT-MIXERR-001');
    const sample = s().samples.find((samp) => samp.sampleNo === 'S-FT-MIXERR-001');
    expect(sample).toBeDefined();
    const sampleId = sample!.id;

    const storageLoc = s().locations.find((l) => l.type === 'storage' && l.status === 'active');
    expect(storageLoc).toBeDefined();

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    const loginCollector = await s().login('collector01', '123456');
    expect(loginCollector).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    await s().getAllLocations();
    await s().performInbound(sampleId, storageLoc!.id);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    const loginAdmin = await s().login('admin', '123456');
    expect(loginAdmin).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 10));
    await s().getAllLocations();

    await s().performInbound(sampleId, storageLoc!.id);

    await s().performInbound(sampleId, storageLoc!.id);

    await s().getFailedTransfers();

    const traceData = await s().getFlowTraceData(sampleId);
    expect(traceData).not.toBeNull();

    const hasPermissionError = traceData!.blockedOperations.some(
      (op) => op.errorCategory === 'permission'
    );
    const hasStatusError = traceData!.blockedOperations.some(
      (op) => op.errorCategory === 'status'
    );

    expect(hasPermissionError).toBe(true);
    expect(hasStatusError).toBe(true);
  });
});
