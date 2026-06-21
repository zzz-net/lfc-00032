import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAppStore } from '../store/useAppStore';
import {
  checkFlowTracePermission,
  checkServiceRestartReauth,
  checkPermissionMidOperation,
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
} from '../services/flowTracePermissionService';
import type {
  FlowTraceSampleSummary,
  FlowTraceDetailData,
  User,
} from '@shared/types';
import { FLOW_TRACE_PERMISSION_DENY_REASONS } from '@shared/constants';
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

describe('Flow Trace Permission Module - Core Permission Check', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should correctly identify auditor roles', () => {
    expect(isAuditorRole('auditor')).toBe(true);
    expect(isAuditorRole('admin')).toBe(true);
    expect(isAuditorRole('collector')).toBe(false);
    expect(isAuditorRole('warehouse')).toBe(false);
    expect(isAuditorRole('tester')).toBe(false);
  });

  it('should grant allow decision to auditor for all actions', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);

    const viewListCheck = checkFlowTracePermission(user, 'viewList');
    expect(viewListCheck.decision).toBe('allow');
    expect(viewListCheck.userId).toBe(user!.id);
    expect(viewListCheck.userRole).toBe('auditor');

    const viewDetailCheck = checkFlowTracePermission(user, 'viewDetail', 'sample123');
    expect(viewDetailCheck.decision).toBe('allow');
    expect(viewDetailCheck.sampleId).toBe('sample123');

    const exportCheck = checkFlowTracePermission(user, 'export', 'sample123');
    expect(exportCheck.decision).toBe('allow');
  });

  it('should grant redact decision to non-auditor roles for view actions', async () => {
    const nonAuditorAccounts = [COLLECTOR_USER, WAREHOUSE_USER, TESTER_USER];

    for (const account of nonAuditorAccounts) {
      const user = await initAndLogin(account.username, account.password);

      const viewListCheck = checkFlowTracePermission(user, 'viewList');
      expect(viewListCheck.decision).toBe('redact');
      expect(viewListCheck.reason).toBe('非审核员角色，数据将被脱敏');

      const viewDetailCheck = checkFlowTracePermission(user, 'viewDetail', 'sample123');
      expect(viewDetailCheck.decision).toBe('redact');

      s().logout();
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  });

  it('should deny all actions for unauthenticated user', () => {
    const viewListCheck = checkFlowTracePermission(null, 'viewList');
    expect(viewListCheck.decision).toBe('deny');
    expect(viewListCheck.reason).toBe(FLOW_TRACE_PERMISSION_DENY_REASONS.ROLE_NOT_AUTHORIZED);

    const viewDetailCheck = checkFlowTracePermission(null, 'viewDetail', 'sample123');
    expect(viewDetailCheck.decision).toBe('deny');

    const exportCheck = checkFlowTracePermission(null, 'export', 'sample123');
    expect(exportCheck.decision).toBe('deny');
  });

  it('should deny action after permission revocation', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    const check1 = checkFlowTracePermission(user, 'viewList');
    expect(check1.decision).toBe('allow');

    await revokePermission(user!.id, '安全原因，临时撤销权限');

    const check2 = checkFlowTracePermission(user, 'viewList');
    expect(check2.decision).toBe('deny');
    expect(check2.reason).toBe('安全原因，临时撤销权限');
  });

  it('should restore permission after revocation is lifted', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '临时撤销');
    const check1 = checkFlowTracePermission(user, 'viewList');
    expect(check1.decision).toBe('deny');

    await restorePermission(user!.id);
    const check2 = checkFlowTracePermission(user, 'viewList');
    expect(check2.decision).toBe('allow');
  });
});

describe('Flow Trace Permission Module - Service Layer Integration', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('getFlowTraceListSecure should return full data for auditor', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-LIST-001');

    const envelope = await s().getFlowTraceListSecure();
    expect(envelope.permission.decision).toBe('allow');
    expect(envelope.data).not.toBeNull();
    expect(envelope.redaction).toBeUndefined();

    const sample = envelope.data!.find((s) => s.id === sampleId);
    expect(sample).toBeDefined();
    expect(sample!.hasBlockedOps).toBeDefined();
    expect(sample!.failedAttempts).toBeDefined();
    expect(sample!.rollbackCount).toBe(0);
  });

  it('getFlowTraceListSecure should return redacted data for non-auditor', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-LIST-002');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);

    const envelope = await s().getFlowTraceListSecure();
    expect(envelope.permission.decision).toBe('redact');
    expect(envelope.data).not.toBeNull();
    expect(envelope.redaction).toBeDefined();
    expect(envelope.redaction!.level).toBe('partial');

    const sample = envelope.data!.find((s) => s.id === sampleId);
    expect(sample).toBeDefined();
    expect(sample!.hasBlockedOps).toBe(false);
    expect(sample!.failedAttempts).toBe(0);
    expect(sample!.rollbackCount).toBe(0);
    expect(sample!.lockReason).toBeUndefined();
  });

  it('getFlowTraceDataSecure should return full data for auditor', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-DET-001');

    const envelope = await s().getFlowTraceDataSecure(sampleId);
    expect(envelope.permission.decision).toBe('allow');
    expect(envelope.data).not.toBeNull();
    expect(envelope.redaction).toBeUndefined();

    expect(envelope.data!.blockedOperations).toBeDefined();
    expect(envelope.data!.rollbackHistory).toBeDefined();
    expect(envelope.data!.latestValidTransfer).not.toBeNull();
    expect(envelope.data!.fullTimeline.length).toBeGreaterThan(0);
    expect(envelope.data!.sample.lockReason).toBeDefined();
    expect(envelope.data!.sample.archivedBy).toBeDefined();
  });

  it('getFlowTraceDataSecure should return redacted data for non-auditor', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-DET-002');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);

    const envelope = await s().getFlowTraceDataSecure(sampleId);
    expect(envelope.permission.decision).toBe('redact');
    expect(envelope.data).not.toBeNull();
    expect(envelope.redaction).toBeDefined();
    expect(envelope.redaction!.level).toBe('minimal');

    expect(envelope.data!.blockedOperations).toEqual([]);
    expect(envelope.data!.rollbackHistory).toEqual([]);
    expect(envelope.data!.latestValidTransfer).toBeNull();
    expect(envelope.data!.sample.lockReason).toBeUndefined();
    expect(envelope.data!.sample.archivedBy).toBeUndefined();
    expect(envelope.data!.sample.reviewedBy).toBeUndefined();
    expect(envelope.data!.summary.failedAttempts).toBe(0);
    expect(envelope.data!.summary.rollbackCount).toBe(0);
  });

  it('exportFlowTraceDataSecure should return full export for auditor', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-EXP-001');

    const currentUser = s().currentUser;
    expect(currentUser).not.toBeNull();
    expect(currentUser?.role).toBe('auditor');

    const rawData = await s().exportFlowTraceData(sampleId, { format: 'json' });
    expect(rawData).not.toBe('');
    expect(typeof rawData).toBe('string');

    const permCheck = checkFlowTracePermission(currentUser, 'export', sampleId);
    expect(permCheck.decision).toBe('allow');

    const envelope = await s().exportFlowTraceDataSecure(sampleId, {
      format: 'json',
      includeBusinessChain: true,
      includeFullTimeline: true,
    });

    if (envelope.permission.decision !== 'allow') {
      console.log('Export failed:', envelope.permission.reason, envelope.permission.errorCode);
    }

    expect(envelope.permission.decision).toBe('allow');
    expect(envelope.permission.reason).toBe('审核员权限，允许完整访问');
    expect(envelope.data).not.toBe('');
    expect(envelope.redaction).toBeUndefined();

    const parsed = JSON.parse(envelope.data as string);
    expect(parsed.blockedOperations).toBeDefined();
    expect(parsed.rollbackHistory).toBeDefined();
    expect(parsed.fullTimeline).toBeDefined();
    expect(parsed.latestValidTransfer).toBeDefined();
    expect(parsed.redactionNotice).toBeUndefined();
  });

  it('exportFlowTraceDataSecure should return redacted export for non-auditor', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-EXP-002');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));
    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);

    const envelope = await s().exportFlowTraceDataSecure(sampleId, {
      format: 'json',
      includeBusinessChain: true,
      includeFullTimeline: true,
    });

    expect(envelope.permission.decision).toBe('redact');
    expect(envelope.data).not.toBe('');
    expect(envelope.redaction).toBeDefined();

    const parsed = JSON.parse(envelope.data as string);
    expect(parsed.redactionNotice).toBeDefined();
    expect(parsed.redactedFields).toBeDefined();
    expect(parsed.blockedOperations).toBeUndefined();
    expect(parsed.rollbackHistory).toBeUndefined();
    expect(parsed.fullTimeline).toBeUndefined();
    expect(parsed.latestValidTransfer).toBeUndefined();
    expect(parsed.sample.lockReason).toBeUndefined();
    expect(parsed.sample.archivedBy).toBeUndefined();
  });

  it('should deny all secure actions after permission revocation', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '权限已被撤销');

    const listEnvelope = await s().getFlowTraceListSecure();
    expect(listEnvelope.permission.decision).toBe('deny');
    expect(listEnvelope.data).toBeNull();
    expect(listEnvelope.permission.reason).toBe('权限已被撤销');

    const detailEnvelope = await s().getFlowTraceDataSecure('test-sample-id');
    expect(detailEnvelope.permission.decision).toBe('deny');
    expect(detailEnvelope.data).toBeNull();

    const exportEnvelope = await s().exportFlowTraceDataSecure('test-sample-id', { format: 'json' });
    expect(exportEnvelope.permission.decision).toBe('deny');
    expect(exportEnvelope.data).toBe('');
  });
});

describe('Flow Trace Permission Module - Complex Scenarios', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should require re-authentication after service restart for pre-restart access', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-RESTART-001');
    const preRestartTime = new Date().toISOString();

    await new Promise(resolve => setTimeout(resolve, 100));
    await simulateRestart();

    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);

    const restartCheck = checkServiceRestartReauth(user, preRestartTime);
    expect(restartCheck).not.toBeNull();
    expect(restartCheck!.decision).toBe('deny');
    expect(restartCheck!.reason).toBe(FLOW_TRACE_PERMISSION_DENY_REASONS.SERVICE_RESTART_REAUTH);
  });

  it('should maintain consistent permissions after service restart', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-RESTART-002');

    const envelope1 = await s().getFlowTraceDataSecure(sampleId);
    expect(envelope1.permission.decision).toBe('allow');
    const data1 = envelope1.data;

    await simulateRestart();
    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);

    const envelope2 = await s().getFlowTraceDataSecure(sampleId);
    expect(envelope2.permission.decision).toBe('allow');
    const data2 = envelope2.data;

    expect(data2!.sample.id).toBe(data1!.sample.id);
    expect(data2!.sample.sampleNo).toBe(data1!.sample.sampleNo);
    expect(data2!.summary.totalTransfers).toBe(data1!.summary.totalTransfers);
    expect(data2!.businessChain.length).toBe(data1!.businessChain.length);
  });

  it('should detect permission change mid-operation', async () => {
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

  it('should limit concurrent exports per user', async () => {
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

  it('should record operation logs for all actions', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-LOG-001');
    const initialLogs = getOperationLogs().length;

    await s().getFlowTraceListSecure();
    await s().getFlowTraceDataSecure(sampleId);
    const exportResult = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });

    const logs = getOperationLogs();
    expect(logs.length).toBeGreaterThan(initialLogs);

    const viewListLog = logs.find((l) => l.action === 'viewList');
    expect(viewListLog).toBeDefined();
    expect(viewListLog!.permissionDecision).toBe('allow');
    expect(viewListLog!.status).toBe('success');

    const viewDetailLog = logs.find((l) => l.action === 'viewDetail');
    expect(viewDetailLog).toBeDefined();
    expect(viewDetailLog!.sampleId).toBe(sampleId);

    const exportLog = logs.find((l) => l.action === 'export');
    expect(exportLog).toBeDefined();
    expect(exportLog!.exportOptions).toBeDefined();

    if (exportResult.permission.decision === 'allow') {
      expect(exportLog!.dataSize).toBeGreaterThan(0);
      expect(exportLog!.status).toBe('success');
    } else {
      expect(exportLog!.status).toBe('denied');
    }
  });

  it('should record denied operations in logs', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    await revokePermission(user!.id, '测试拒绝日志');

    const beforeLogs = getOperationLogs().length;
    await s().getFlowTraceListSecure();
    const logs = getOperationLogs();

    expect(logs.length).toBeGreaterThan(beforeLogs);
    const deniedLog = logs[logs.length - 1];
    expect(deniedLog.status).toBe('denied');
    expect(deniedLog.permissionDecision).toBe('deny');
    expect(deniedLog.denyReason).toBe('测试拒绝日志');
  });
});

describe('Flow Trace Permission Module - Data Redaction', () => {
  beforeEach(() => {
    resetServiceState();
  });

  const mockSampleSummary: FlowTraceSampleSummary = {
    id: 'test-sample-1',
    sampleNo: 'TEST-001',
    type: 'blood',
    batchNo: 'BATCH-001',
    currentStatus: 'archived',
    currentStage: 'archive',
    isArchived: true,
    isLocked: true,
    lockReason: '样本已归档，所有操作被锁定',
    lastTransferAt: '2025-06-20T10:00:00Z',
    failedAttempts: 3,
    rollbackCount: 1,
    hasBlockedOps: true,
  };

  it('redactSampleSummary should redact sensitive fields for non-auditor', () => {
    const { data, redaction } = redactSampleSummary([mockSampleSummary], false);

    expect(redaction).toBeDefined();
    expect(data[0].hasBlockedOps).toBe(false);
    expect(data[0].failedAttempts).toBe(0);
    expect(data[0].rollbackCount).toBe(0);
    expect(data[0].lockReason).toBeUndefined();
  });

  it('redactSampleSummary should not redact for auditor', () => {
    const { data, redaction } = redactSampleSummary([mockSampleSummary], true);

    expect(redaction).toBeUndefined();
    expect(data[0].hasBlockedOps).toBe(true);
    expect(data[0].failedAttempts).toBe(3);
    expect(data[0].rollbackCount).toBe(1);
    expect(data[0].lockReason).toBeDefined();
  });

  it('redactExportData should redact JSON export for non-auditor', () => {
    const fullData = JSON.stringify({
      exportedAt: '2025-06-20T10:00:00Z',
      exportType: '流转追溯记录',
      sample: {
        id: 'test-1',
        sampleNo: 'TEST-001',
        lockReason: '敏感原因',
        archivedBy: '张三',
      },
      summary: {
        totalTransfers: 5,
        failedAttempts: 3,
      },
      blockedOperations: [{ errorMessage: '敏感错误' }],
      rollbackHistory: [{ reason: '敏感原因' }],
      fullTimeline: [{ remark: '敏感备注' }],
    });

    const { data, redaction } = redactExportData(fullData, 'json', false);
    const parsed = JSON.parse(data);

    expect(redaction).toBeDefined();
    expect(parsed.redactionNotice).toBeDefined();
    expect(parsed.redactedFields).toBeDefined();
    expect(parsed.blockedOperations).toBeUndefined();
    expect(parsed.rollbackHistory).toBeUndefined();
    expect(parsed.fullTimeline).toBeUndefined();
    expect(parsed.sample.lockReason).toBeUndefined();
    expect(parsed.sample.archivedBy).toBeUndefined();
    expect(parsed.summary.failedAttempts).toBeUndefined();
  });

  it('redactExportData should not redact for auditor', () => {
    const fullData = JSON.stringify({
      exportedAt: '2025-06-20T10:00:00Z',
      sample: { sampleNo: 'TEST-001' },
      blockedOperations: [],
    });

    const { data, redaction } = redactExportData(fullData, 'json', true);
    const parsed = JSON.parse(data);

    expect(redaction).toBeUndefined();
    expect(parsed.blockedOperations).toBeDefined();
    expect(parsed.redactionNotice).toBeUndefined();
  });
});

describe('Flow Trace Permission Module - Auditor vs Non-Auditor Comparison', () => {
  beforeEach(() => {
    resetServiceState();
  });

  afterEach(() => {
    resetServiceState();
  });

  it('should show clear difference between auditor and non-auditor list view', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-CMP-001');

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

    expect(auditorEnvelope.permission.decision).toBe('allow');
    expect(nonAuditorEnvelope.permission.decision).toBe('redact');

    expect(auditorEnvelope.redaction).toBeUndefined();
    expect(nonAuditorEnvelope.redaction).toBeDefined();

    expect(auditorSample.failedAttempts).toBeDefined();
    expect(nonAuditorSample.failedAttempts).toBe(0);

    expect(auditorSample.rollbackCount).toBeDefined();
    expect(nonAuditorSample.rollbackCount).toBe(0);

    expect(auditorSample.lockReason).toBeDefined();
    expect(nonAuditorSample.lockReason).toBeUndefined();
  });

  it('should show clear difference between auditor and non-auditor detail view', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-CMP-002');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const auditorEnvelope = await s().getFlowTraceDataSecure(sampleId);
    const auditorData = auditorEnvelope.data!;

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);
    const nonAuditorEnvelope = await s().getFlowTraceDataSecure(sampleId);
    const nonAuditorData = nonAuditorEnvelope.data!;

    expect(auditorEnvelope.permission.decision).toBe('allow');
    expect(nonAuditorEnvelope.permission.decision).toBe('redact');

    expect(auditorData.latestValidTransfer).not.toBeNull();
    expect(nonAuditorData.latestValidTransfer).toBeNull();

    expect(auditorData.blockedOperations.length).toBeGreaterThanOrEqual(0);
    expect(nonAuditorData.blockedOperations.length).toBe(0);

    expect(auditorData.rollbackHistory.length).toBeGreaterThanOrEqual(0);
    expect(nonAuditorData.rollbackHistory.length).toBe(0);

    expect(auditorData.sample.lockReason).toBeDefined();
    expect(nonAuditorData.sample.lockReason).toBeUndefined();

    expect(auditorData.sample.archivedBy).toBeDefined();
    expect(nonAuditorData.sample.archivedBy).toBeUndefined();

    expect(auditorData.businessChain[0].operatorName).toBeDefined();
    expect(nonAuditorData.businessChain[0].operatorName).toBeUndefined();
  });

  it('should show clear difference between auditor and non-auditor export', async () => {
    const { sampleId } = await fullFlowToArchive('S-PERM-CMP-003');

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    const auditorEnvelope = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });
    const auditorParsed = JSON.parse(auditorEnvelope.data as string);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(ADMIN_USER.username, ADMIN_USER.password);

    s().logout();
    await new Promise(resolve => setTimeout(resolve, 10));

    await initAndLogin(COLLECTOR_USER.username, COLLECTOR_USER.password);
    const nonAuditorEnvelope = await s().exportFlowTraceDataSecure(sampleId, { format: 'json' });
    const nonAuditorParsed = JSON.parse(nonAuditorEnvelope.data as string);

    expect(auditorEnvelope.permission.decision).toBe('allow');
    expect(nonAuditorEnvelope.permission.decision).toBe('redact');

    expect(auditorParsed.blockedOperations).toBeDefined();
    expect(nonAuditorParsed.blockedOperations).toBeUndefined();

    expect(auditorParsed.rollbackHistory).toBeDefined();
    expect(nonAuditorParsed.rollbackHistory).toBeUndefined();

    expect(auditorParsed.fullTimeline).toBeDefined();
    expect(nonAuditorParsed.fullTimeline).toBeUndefined();

    expect(nonAuditorParsed.redactionNotice).toBeDefined();
    expect(auditorParsed.redactionNotice).toBeUndefined();
  });
});

describe('Flow Trace Permission Module - Service Status', () => {
  beforeEach(() => {
    resetServiceState();
  });

  it('should track service instance and status', async () => {
    const status1 = getServiceStatus();
    expect(status1.instanceId).toBeDefined();
    expect(status1.startedAt).toBeDefined();

    await new Promise(resolve => setTimeout(resolve, 10));
    resetServiceState();

    const status2 = getServiceStatus();
    expect(status2.instanceId).not.toBe(status1.instanceId);
    expect(status2.startedAt).not.toBe(status1.startedAt);
  });

  it('should track active exports and buffered logs', async () => {
    const user = await initAndLogin(AUDITOR_USER.username, AUDITOR_USER.password);
    expect(user).not.toBeNull();

    const initialStatus = getServiceStatus();

    const slot = acquireExportSlot(user);
    expect(slot.allowed).toBe(true);

    createOperationLog({
      user,
      action: 'viewList',
      status: 'success',
      permissionDecision: 'allow',
    });

    const statusAfter = getServiceStatus();
    expect(statusAfter.activeExports).toBe(initialStatus.activeExports + 1);
    expect(statusAfter.bufferedLogs).toBeGreaterThan(initialStatus.bufferedLogs);

    releaseExportSlot(user!.id, slot.operationId);

    const statusFinal = getServiceStatus();
    expect(statusFinal.activeExports).toBe(initialStatus.activeExports);
  });
});
