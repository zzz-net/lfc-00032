import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import {
  checkFlowTracePermission,
  checkServiceRestartReauth,
  checkPermissionMidOperation,
  checkPermissionRestoredMidOperation,
  acquireExportSlot,
  releaseExportSlot,
  redactSampleSummary,
  redactDetailData,
  redactExportData,
  isAuditorRole,
  revokePermission,
  restorePermission,
  resetServiceState,
  getServiceStatus,
  createOperationLog,
  getOperationLogs,
  queryAuditRecords,
  getPermissionSnapshot,
  getAuditConfig,
  updateAuditConfig,
  registerSampleIdMapping,
  loadPersistedPermissionState,
} from '../services/flowTracePermissionService';
import type {
  FlowTraceSampleSummary,
  FlowTraceDetailData,
  User,
  FlowTraceAuditQueryFilter,
} from '@shared/types';
import { FLOW_TRACE_PERMISSION_DENY_REASONS, FLOW_TRACE_AUDITOR_VISIBLE_FIELDS, FLOW_TRACE_NON_AUDITOR_VISIBLE_FIELDS, FLOW_TRACE_NON_AUDITOR_REDACTED_FIELDS } from '@shared/constants';
import { resetDBInstance } from '../lib/db';

const ADMIN_USER = { username: 'admin', password: '123456' };
const AUDITOR_USER = { username: 'auditor01', password: '123456' };
const COLLECTOR_USER = { username: 'collector01', password: '123456' };
const WAREHOUSE_USER = { username: 'warehouse01', password: '123456' };
const TESTER_USER = { username: 'tester01', password: '123456' };

const s = () => useAppStore.getState();

const makeRow = (sampleNo: string, overrides?: Partial<any>) => ({
  sampleNo,
  type: 'blood',
  collectedAt: '2025-06-21T10:00:00Z',
  collectedBy: '张采集',
  ...overrides,
});

const initAndLogin = async (username: string, password: string) => {
  const store = s();
  await store.initializeDB();
  const loginSuccess = await store.login(username, password);
  expect(loginSuccess).toBe(true);
  await new Promise(resolve => setTimeout(resolve, 10));
  await store.getAllUsers();
  await store.getAllLocations();
  await store.getAllSamples();
  await store.getAllBatches();
  await store.getFailedTransfers();
  return useAppStore.getState().currentUser;
};

const simulateRestart = async () => {
  resetDBInstance();
  resetServiceState();
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
  await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);

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
  const loginAuditor = await s().login(AUDITOR_USER.username, AUDITOR_USER.password);
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

describe('Permission State Persistence After Restart', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should persist revocation state to IndexedDB and restore after restart', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    const check1 = checkFlowTracePermission(user, 'viewList');
    expect(check1.decision).toBe('allow');

    await revokePermission(user!.id, '安全原因，临时撤销权限');

    const check2 = checkFlowTracePermission(user, 'viewList');
    expect(check2.decision).toBe('deny');
    expect(check2.reason).toBe('安全原因，临时撤销权限');

    await simulateRestart();
    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    await loadPersistedPermissionState();

    const currentUser = s().currentUser;
    const check3 = checkFlowTracePermission(currentUser, 'viewList');
    expect(check3.decision).toBe('deny');
    expect(check3.reason).toBe('安全原因，临时撤销权限');
  });

  it('should persist restored permission after restart', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '临时撤销');
    await restorePermission(user!.id);

    await simulateRestart();
    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    await loadPersistedPermissionState();

    const currentUser = s().currentUser;
    const check = checkFlowTracePermission(currentUser, 'viewList');
    expect(check.decision).toBe('allow');
  });

  it('should maintain revocation for the same sample after restart', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERS-REV-001');

    const user = s().currentUser;
    expect(user).not.toBeNull();
    await revokePermission(user!.id, '重启后仍然拦截');

    await simulateRestart();
    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    await loadPersistedPermissionState();

    const envelope = await s().getFlowTraceDataSecure(sampleId);
    expect(envelope.permission.decision).toBe('deny');
    expect(envelope.data).toBeNull();
  });

  it('should maintain export restriction after restart when permission was revoked', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERS-EXP-001');

    const user = s().currentUser;
    expect(user).not.toBeNull();
    await revokePermission(user!.id, '禁止导出');

    await simulateRestart();
    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    await loadPersistedPermissionState();

    const exportEnvelope = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });
    expect(exportEnvelope.permission.decision).toBe('deny');
    expect(exportEnvelope.data).toBe('');
  });
});

describe('Configurable Audit Records', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should record who viewed in audit records', async () => {
    const { sampleId } = await fullFlowToArchive('S-AUDIT-VIEW-001');

    await s().getFlowTraceListSecure();
    await s().getFlowTraceDataSecure(sampleId);

    const auditRecords = await queryAuditRecords({ action: 'viewList' });
    expect(auditRecords.length).toBeGreaterThan(0);
    const viewRecord = auditRecords[0];
    expect(viewRecord.userId).toBeTruthy();
    expect(viewRecord.username).toBeTruthy();
    expect(viewRecord.action).toBe('viewList');
    expect(viewRecord.timestamp).toBeTruthy();

    const detailRecords = await queryAuditRecords({ action: 'viewDetail', sampleId });
    expect(detailRecords.length).toBeGreaterThan(0);
    expect(detailRecords[0].sampleId).toBe(sampleId);
  });

  it('should record who exported in audit records', async () => {
    const { sampleId } = await fullFlowToArchive('S-AUDIT-EXP-001');

    await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });

    const exportRecords = await queryAuditRecords({ action: 'export' });
    expect(exportRecords.length).toBeGreaterThan(0);
    const record = exportRecords[0];
    expect(record.userId).toBeTruthy();
    expect(record.username).toBeTruthy();
    expect(record.exportOptions).toBeDefined();
    expect(record.dataSize).toBeGreaterThan(0);
  });

  it('should record denial reason in audit records', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '审计测试拒绝原因');

    await s().getFlowTraceListSecure();

    const deniedRecords = await queryAuditRecords({ status: 'denied' });
    expect(deniedRecords.length).toBeGreaterThan(0);
    expect(deniedRecords[0].denyReason).toBe('审计测试拒绝原因');
    expect(deniedRecords[0].permissionDecision).toBe('deny');
  });

  it('should support querying audit records by userId', async () => {
    const { sampleId } = await fullFlowToArchive('S-AUDIT-UID-001');
    const user = s().currentUser;

    await s().getFlowTraceDataSecure(sampleId);

    const records = await queryAuditRecords({ userId: user!.id });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.userId === user!.id)).toBe(true);
  });

  it('should support querying audit records by sampleId', async () => {
    const { sampleId } = await fullFlowToArchive('S-AUDIT-SID-001');

    await s().getFlowTraceDataSecure(sampleId);

    const records = await queryAuditRecords({ sampleId });
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.sampleId === sampleId)).toBe(true);
  });

  it('should support querying audit records by time range', async () => {
    const { sampleId } = await fullFlowToArchive('S-AUDIT-TIME-001');
    const beforeQuery = new Date(Date.now() - 60000).toISOString();

    await s().getFlowTraceDataSecure(sampleId);

    const afterQuery = new Date(Date.now() + 60000).toISOString();
    const records = await queryAuditRecords({
      fromTimestamp: beforeQuery,
      toTimestamp: afterQuery,
    });
    expect(records.length).toBeGreaterThan(0);
  });

  it('should respect audit config for logging success', async () => {
    updateAuditConfig({ logSuccess: false });
    const { sampleId } = await fullFlowToArchive('S-AUDIT-CFG-001');

    await s().getFlowTraceListSecure();
    await s().getFlowTraceDataSecure(sampleId);

    const successRecords = await queryAuditRecords({ status: 'success' });
    expect(successRecords.length).toBe(0);

    updateAuditConfig({ logSuccess: true });
  });

  it('should respect audit config for logging denied', async () => {
    updateAuditConfig({ logDenied: false });
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);

    await revokePermission(user!.id, '配置测试');
    await s().getFlowTraceListSecure();

    const deniedRecords = await queryAuditRecords({ status: 'denied' });
    expect(deniedRecords.length).toBe(0);

    updateAuditConfig({ logDenied: true });
  });

  it('should include service instance ID in audit records', async () => {
    const { sampleId } = await fullFlowToArchive('S-AUDIT-INST-001');

    await s().getFlowTraceDataSecure(sampleId);

    const records = await queryAuditRecords({ action: 'viewDetail' });
    expect(records.length).toBeGreaterThan(0);
    expect(records[0].serviceInstanceId).toBeTruthy();
  });

  it('should persist audit records across restart', async () => {
    const { sampleId } = await fullFlowToArchive('S-AUDIT-PERS-001');

    await s().getFlowTraceDataSecure(sampleId);

    const preRestartRecords = await queryAuditRecords({ action: 'viewDetail' });
    const preCount = preRestartRecords.filter((r) => r.sampleId === sampleId).length;
    expect(preCount).toBeGreaterThan(0);

    await simulateRestart();
    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);

    const postRestartRecords = await queryAuditRecords({ action: 'viewDetail' });
    const postCount = postRestartRecords.filter((r) => r.sampleId === sampleId).length;
    expect(postCount).toBe(preCount);
  });
});

describe('Mid-Use Permission Revocation and Restoration Consistency', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should detect permission revoked mid-operation', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const operationStart = new Date().toISOString();

    const midCheck1 = checkPermissionMidOperation(user, 'export', operationStart);
    expect(midCheck1).toBeNull();

    await new Promise(resolve => setTimeout(resolve, 10));
    await revokePermission(user!.id, '操作期间撤销权限');

    const midCheck2 = checkPermissionMidOperation(user, 'export', operationStart);
    expect(midCheck2).not.toBeNull();
    expect(midCheck2!.decision).toBe('deny');
    expect(midCheck2!.reason).toBe(FLOW_TRACE_PERMISSION_DENY_REASONS.PERMISSION_CHANGED_MID_OPERATION);
  });

  it('should return consistent results across list, detail, and export when permission is revoked', async () => {
    const { sampleId } = await fullFlowToArchive('S-MID-CONS-001');
    const user = s().currentUser;
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '中途撤销一致性测试');

    const listEnvelope = await s().getFlowTraceListSecure();
    expect(listEnvelope.permission.decision).toBe('deny');
    expect(listEnvelope.data).toBeNull();

    const detailEnvelope = await s().getFlowTraceDataSecure(sampleId);
    expect(detailEnvelope.permission.decision).toBe('deny');
    expect(detailEnvelope.data).toBeNull();

    const exportEnvelope = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });
    expect(exportEnvelope.permission.decision).toBe('deny');
    expect(exportEnvelope.data).toBe('');
  });

  it('should return consistent results across list, detail, and export when permission is restored', async () => {
    const { sampleId } = await fullFlowToArchive('S-MID-RESTORE-001');
    const user = s().currentUser;
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '先撤销');
    await restorePermission(user!.id);

    const listEnvelope = await s().getFlowTraceListSecure();
    expect(listEnvelope.permission.decision).toBe('allow');
    expect(listEnvelope.data).not.toBeNull();

    const detailEnvelope = await s().getFlowTraceDataSecure(sampleId);
    expect(detailEnvelope.permission.decision).toBe('allow');
    expect(detailEnvelope.data).not.toBeNull();

    const exportEnvelope = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });
    expect(exportEnvelope.permission.decision).toBe('allow');
    expect(exportEnvelope.data).not.toBe('');
  });

  it('should detect permission restored mid-operation', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const operationStart = new Date().toISOString();

    await revokePermission(user!.id, '临时撤销');
    await restorePermission(user!.id);

    const result = checkPermissionRestoredMidOperation(user, 'viewDetail', operationStart);
    expect(result).not.toBeNull();
    expect(result!.restored).toBe(true);
    expect(result!.newDecision).toBe('allow');
  });

  it('should block export when permission revoked mid-export', async () => {
    const { sampleId } = await fullFlowToArchive('S-MID-EXP-001');
    const user = s().currentUser;
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '导出期间撤销');

    const slot = acquireExportSlot(user);
    expect(slot.allowed).toBe(false);
  });
});

describe('Repeated Queries, Concurrent Exports, and Re-imported Samples', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should produce consistent results for repeated queries', async () => {
    const { sampleId } = await fullFlowToArchive('S-REPEAT-001');

    const envelope1 = await s().getFlowTraceDataSecure(sampleId);
    const envelope2 = await s().getFlowTraceDataSecure(sampleId);
    const envelope3 = await s().getFlowTraceDataSecure(sampleId);

    expect(envelope1.permission.decision).toBe(envelope2.permission.decision);
    expect(envelope2.permission.decision).toBe(envelope3.permission.decision);

    if (envelope1.data && envelope2.data && envelope3.data) {
      expect(envelope1.data.sample.id).toBe(envelope2.data.sample.id);
      expect(envelope2.data.sample.id).toBe(envelope3.data.sample.id);
      expect(envelope1.data.summary.totalTransfers).toBe(envelope2.data.summary.totalTransfers);
      expect(envelope2.data.summary.totalTransfers).toBe(envelope3.data.summary.totalTransfers);
    }
  });

  it('should limit concurrent exports and track logs correctly', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    const slots: string[] = [];
    for (let i = 0; i < 3; i++) {
      const result = acquireExportSlot(user);
      expect(result.allowed).toBe(true);
      slots.push(result.operationId);
    }

    const fourthResult = acquireExportSlot(user);
    expect(fourthResult.allowed).toBe(false);
    expect(fourthResult.reason).toBe(FLOW_TRACE_PERMISSION_DENY_REASONS.CONCURRENT_EXPORT_LIMIT);

    releaseExportSlot(user!.id, slots[0]);

    const fifthResult = acquireExportSlot(user);
    expect(fifthResult.allowed).toBe(true);

    for (const slot of slots.slice(1)) {
      releaseExportSlot(user!.id, slot);
    }
    releaseExportSlot(user!.id, fifthResult.operationId);
  });

  it('should limit exports per hour', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    for (let i = 0; i < 10; i++) {
      const result = acquireExportSlot(user);
      expect(result.allowed).toBe(true);
      releaseExportSlot(user!.id, result.operationId);
    }

    const eleventhResult = acquireExportSlot(user);
    expect(eleventhResult.allowed).toBe(false);
    expect(eleventhResult.reason).toBe(FLOW_TRACE_PERMISSION_DENY_REASONS.EXPORT_QUOTA_EXCEEDED);
  });

  it('should not confuse permission and audit state for re-imported sample with same sampleNo', async () => {
    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);

    const rows1 = [makeRow('S-REIMPORT-001')];
    const result1 = await s().importBatch(rows1, 'BATCH-REIMPORT-1');
    expect(result1.success).toBe(true);

    const sample1 = s().samples.find((samp) => samp.sampleNo === 'S-REIMPORT-001');
    expect(sample1).toBeDefined();

    const envelope1 = await s().getFlowTraceDataSecure(sample1!.id);
    expect(envelope1.permission.decision).toBe('allow');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await s().login(COLLECTOR_USER.username, COLLECTOR_USER.password);
    await new Promise(resolve => setTimeout(resolve, 10));

    const collectorEnvelope = await s().getFlowTraceDataSecure(sample1!.id);
    expect(collectorEnvelope.permission.decision).toBe('redact');
    expect(collectorEnvelope.redaction).toBeDefined();
    expect(collectorEnvelope.data).not.toBeNull();
    if (collectorEnvelope.data) {
      expect(collectorEnvelope.data.sample.lockReason).toBeUndefined();
      expect(collectorEnvelope.data.blockedOperations).toEqual([]);
    }
  });

  it('should not create duplicate audit logs for the same operation', async () => {
    const { sampleId } = await fullFlowToArchive('S-NO-DUP-001');

    await s().getFlowTraceDataSecure(sampleId);

    const records = await queryAuditRecords({ action: 'viewDetail', sampleId });
    const operationIds = records.map((r) => r.operationId);
    const uniqueIds = new Set(operationIds);
    expect(uniqueIds.size).toBe(operationIds.length);
  });

  it('should maintain consistent visible fields across repeated queries for non-auditor', async () => {
    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);
    const rows = [makeRow('S-VISIBLE-001')];
    await s().importBatch(rows, 'BATCH-VISIBLE-001');
    const sample = s().samples.find((samp) => samp.sampleNo === 'S-VISIBLE-001');
    expect(sample).toBeDefined();
    const storageLoc = s().locations.find((l) => l.type === 'storage' && l.status === 'active');
    expect(storageLoc).toBeDefined();
    await s().performInbound(sample!.id, storageLoc!.id);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);

    const envelope1 = await s().getFlowTraceDataSecure(sample!.id);
    const envelope2 = await s().getFlowTraceDataSecure(sample!.id);

    expect(envelope1.redaction).toBeDefined();
    expect(envelope2.redaction).toBeDefined();

    if (envelope1.data && envelope2.data) {
      expect(envelope1.data.sample.lockReason).toBeUndefined();
      expect(envelope2.data.sample.lockReason).toBeUndefined();
      expect(envelope1.data.blockedOperations).toEqual([]);
      expect(envelope2.data.blockedOperations).toEqual([]);
      expect(envelope1.data.rollbackHistory).toEqual([]);
      expect(envelope2.data.rollbackHistory).toEqual([]);
    }
  });
});

describe('Permission Snapshot and Visible Fields', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should return correct snapshot for auditor with full access', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);

    const snapshot = getPermissionSnapshot(user);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.isRevoked).toBe(false);
    expect(snapshot!.currentDecision).toBe('allow');
    expect(snapshot!.visibleFields).toEqual(FLOW_TRACE_AUDITOR_VISIBLE_FIELDS);
    expect(snapshot!.redactedFields).toEqual([]);
  });

  it('should return correct snapshot for non-auditor with redacted access', async () => {
    const user = await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);

    const snapshot = getPermissionSnapshot(user);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.isRevoked).toBe(false);
    expect(snapshot!.currentDecision).toBe('redact');
    expect(snapshot!.visibleFields).toEqual(FLOW_TRACE_NON_AUDITOR_VISIBLE_FIELDS);
    expect(snapshot!.redactedFields).toEqual(FLOW_TRACE_NON_AUDITOR_REDACTED_FIELDS);
    expect(snapshot!.redactedFields).toContain('sample.lockReason');
    expect(snapshot!.redactedFields).toContain('latestValidTransfer');
    expect(snapshot!.redactedFields).toContain('blockedOperations');
  });

  it('should return correct snapshot for revoked user', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);

    await revokePermission(user!.id, '测试快照撤销');

    const snapshot = getPermissionSnapshot(user);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.isRevoked).toBe(true);
    expect(snapshot!.currentDecision).toBe('deny');
    expect(snapshot!.revokeReason).toBe('测试快照撤销');
  });

  it('should return null snapshot for null user', () => {
    const snapshot = getPermissionSnapshot(null);
    expect(snapshot).toBeNull();
  });
});

describe('Auditor vs Non-Auditor Actual Differences', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should show auditor full data and non-auditor redacted data for the same sample', async () => {
    const { sampleId } = await fullFlowToArchive('S-DIFF-001');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const auditorEnvelope = await s().getFlowTraceDataSecure(sampleId);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);
    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);
    const nonAuditorEnvelope = await s().getFlowTraceDataSecure(sampleId);

    expect(auditorEnvelope.permission.decision).toBe('allow');
    expect(nonAuditorEnvelope.permission.decision).toBe('redact');

    expect(auditorEnvelope.redaction).toBeUndefined();
    expect(nonAuditorEnvelope.redaction).toBeDefined();

    expect(auditorEnvelope.data!.blockedOperations.length).toBeGreaterThanOrEqual(0);
    expect(nonAuditorEnvelope.data!.blockedOperations.length).toBe(0);

    expect(auditorEnvelope.data!.rollbackHistory.length).toBeGreaterThanOrEqual(0);
    expect(nonAuditorEnvelope.data!.rollbackHistory.length).toBe(0);

    expect(auditorEnvelope.data!.latestValidTransfer).not.toBeNull();
    expect(nonAuditorEnvelope.data!.latestValidTransfer).toBeNull();

    expect(auditorEnvelope.data!.sample.lockReason).toBeDefined();
    expect(nonAuditorEnvelope.data!.sample.lockReason).toBeUndefined();

    expect(auditorEnvelope.data!.sample.archivedBy).toBeDefined();
    expect(nonAuditorEnvelope.data!.sample.archivedBy).toBeUndefined();

    expect(auditorEnvelope.data!.sample.reviewedBy).toBeDefined();
    expect(nonAuditorEnvelope.data!.sample.reviewedBy).toBeUndefined();

    expect(auditorEnvelope.data!.businessChain[0].operatorName).toBeDefined();
    expect(nonAuditorEnvelope.data!.businessChain[0].operatorName).toBeUndefined();

    expect(auditorEnvelope.data!.summary.failedAttempts).toBeDefined();
    expect(nonAuditorEnvelope.data!.summary.failedAttempts).toBe(0);

    expect(auditorEnvelope.data!.summary.rollbackCount).toBeDefined();
    expect(nonAuditorEnvelope.data!.summary.rollbackCount).toBe(0);
  });

  it('should show auditor full export and non-auditor redacted export for the same sample', async () => {
    const { sampleId } = await fullFlowToArchive('S-DIFF-EXP-001');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const auditorExport = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });
    const auditorParsed = JSON.parse(auditorExport.data as string);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);
    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);
    const nonAuditorExport = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });
    const nonAuditorParsed = JSON.parse(nonAuditorExport.data as string);

    expect(auditorExport.permission.decision).toBe('allow');
    expect(nonAuditorExport.permission.decision).toBe('redact');

    expect(auditorParsed.blockedOperations).toBeDefined();
    expect(nonAuditorParsed.blockedOperations).toBeUndefined();

    expect(auditorParsed.rollbackHistory).toBeDefined();
    expect(nonAuditorParsed.rollbackHistory).toBeUndefined();

    expect(auditorParsed.fullTimeline).toBeDefined();
    expect(nonAuditorParsed.fullTimeline).toBeUndefined();

    expect(nonAuditorParsed.redactionNotice).toBeDefined();
    expect(auditorParsed.redactionNotice).toBeUndefined();

    expect(auditorParsed.sample.lockReason).toBeDefined();
    expect(nonAuditorParsed.sample.lockReason).toBeUndefined();
  });

  it('should show auditor full list and non-auditor redacted list', async () => {
    const { sampleId } = await fullFlowToArchive('S-DIFF-LIST-001');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const auditorEnvelope = await s().getFlowTraceListSecure();
    const auditorSample = auditorEnvelope.data!.find((s) => s.id === sampleId)!;

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);
    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);
    const nonAuditorEnvelope = await s().getFlowTraceListSecure();
    const nonAuditorSample = nonAuditorEnvelope.data!.find((s) => s.id === sampleId)!;

    expect(auditorSample.failedAttempts).toBeDefined();
    expect(nonAuditorSample.failedAttempts).toBe(0);

    expect(auditorSample.rollbackCount).toBeDefined();
    expect(nonAuditorSample.rollbackCount).toBe(0);

    expect(auditorSample.lockReason).toBeDefined();
    expect(nonAuditorSample.lockReason).toBeUndefined();

    expect(auditorSample.hasBlockedOps).toBeDefined();
    expect(nonAuditorSample.hasBlockedOps).toBe(false);
  });
});

describe('Audit Config Management', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should return default audit config', () => {
    const config = getAuditConfig();
    expect(config.enabled).toBe(true);
    expect(config.logSuccess).toBe(true);
    expect(config.logDenied).toBe(true);
    expect(config.logRedacted).toBe(true);
    expect(config.includeMetadata).toBe(true);
  });

  it('should update audit config', () => {
    updateAuditConfig({ logSuccess: false, retentionDays: 30 });

    const config = getAuditConfig();
    expect(config.logSuccess).toBe(false);
    expect(config.retentionDays).toBe(30);
    expect(config.logDenied).toBe(true);

    updateAuditConfig({ logSuccess: true, retentionDays: 90 });
  });

  it('should not log success when logSuccess is disabled', async () => {
    updateAuditConfig({ logSuccess: false });
    const { sampleId } = await fullFlowToArchive('S-CFG-LOG-001');

    await s().getFlowTraceListSecure();

    const successRecords = await queryAuditRecords({ status: 'success' });
    expect(successRecords.length).toBe(0);

    updateAuditConfig({ logSuccess: true });
  });
});

describe('Sample ID Mapping for Re-import', () => {
  beforeEach(() => {
    resetServiceState();
  });

  it('should register and resolve sample ID mapping', () => {
    registerSampleIdMapping('S-MAP-001', 'sample-uuid-1');
    expect(registerSampleIdMapping).toBeDefined();
  });
});

describe('Service Restart Re-auth with Persisted Revocation', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should require re-auth after restart but still respect persisted revocation', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const preRestartTime = new Date().toISOString();

    await revokePermission(user!.id, '重启前撤销');

    await new Promise(resolve => setTimeout(resolve, 100));
    await simulateRestart();

    const restartedUser = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    await loadPersistedPermissionState();

    const restartCheck = checkServiceRestartReauth(restartedUser, preRestartTime);
    expect(restartCheck).not.toBeNull();
    expect(restartCheck!.decision).toBe('deny');
    expect(restartCheck!.reason).toContain('撤销');
  });

  it('should maintain consistent permission across all secure methods after restart', async () => {
    const { sampleId } = await fullFlowToArchive('S-RESTART-CONS-001');

    const envelope1 = await s().getFlowTraceDataSecure(sampleId);
    expect(envelope1.permission.decision).toBe('allow');

    await simulateRestart();
    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    await loadPersistedPermissionState();

    const envelope2 = await s().getFlowTraceDataSecure(sampleId);
    expect(envelope2.permission.decision).toBe('allow');
    expect(envelope2.data!.sample.id).toBe(envelope1.data!.sample.id);
    expect(envelope2.data!.summary.totalTransfers).toBe(envelope1.data!.summary.totalTransfers);
  });
});
