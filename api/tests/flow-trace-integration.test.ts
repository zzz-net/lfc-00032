import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import {
  getDB,
  resetDB,
  upsertUser,
  upsertLocation,
  upsertSample,
  upsertBatch,
  upsertTransferRecord,
  generateId,
  nowISO,
} from '../lib/db.js';
import { createInitialUsers, createInitialLocations } from '../lib/seed.js';
import {
  revokePermission,
  restorePermission,
  resetServiceState,
  flushOperationLogs,
  isAuditorRole,
  getPermissionSnapshot,
  checkFlowTracePermission,
  checkServiceRestartReauth,
  getServiceStartedAt,
  initPermissionStateFromDB,
} from '../services/flowTracePermissionService.js';
import type { Sample, Batch, TransferRecord } from '../../shared/types.js';

const setupSeedData = () => {
  resetDB();
  for (const u of createInitialUsers()) upsertUser(u);
  for (const loc of createInitialLocations()) upsertLocation(loc);
};

const createDemoSample = (suffix = '001') => {
  const db = getDB();
  const collector = db.users.find(u => u.role === 'collector')!;
  const warehouse = db.users.find(u => u.role === 'warehouse')!;
  const tester = db.users.find(u => u.role === 'tester')!;
  const auditor = db.users.find(u => u.role === 'auditor')!;
  const storageLoc = db.locations.find(l => l.type === 'storage' && l.status === 'active')!;
  const testingLoc = db.locations.find(l => l.type === 'testing' && l.status === 'active')!;
  const archiveLoc = db.locations.find(l => l.type === 'archive' && l.status === 'active')!;

  const now = nowISO();
  const batchId = generateId();
  const batch: Batch = {
    id: batchId,
    batchNo: `BATCH-TEST-${suffix}`,
    importedAt: now,
    importedBy: collector.id,
    sampleCount: 1,
    remark: 'Test batch',
  };
  upsertBatch(batch);

  const sampleId = generateId();
  const sample: Sample = {
    id: sampleId,
    sampleNo: `TEST-S-${suffix}`,
    batchId,
    type: '血液',
    collectedAt: new Date(Date.now() - 86400000).toISOString(),
    collectedBy: collector.displayName,
    description: `Test sample ${suffix}`,
    currentStatus: 'archived',
    currentLocationId: archiveLoc.id,
    currentHolderId: auditor.id,
    isArchived: true,
    archivedAt: now,
    reviewedBy: auditor.id,
    reviewedAt: now,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: now,
  };
  upsertSample(sample);

  upsertTransferRecord({
    id: generateId(),
    sampleId,
    type: 'import',
    toStatus: 'imported',
    operatorId: collector.id,
    operatedAt: sample.collectedAt,
    remark: 'import',
    isRolledBack: false,
  } as TransferRecord);

  upsertTransferRecord({
    id: generateId(),
    sampleId,
    type: 'inbound',
    fromStatus: 'imported',
    toStatus: 'in_stock',
    toLocationId: storageLoc.id,
    toHolderId: warehouse.id,
    operatorId: warehouse.id,
    operatedAt: new Date(Date.now() - 82800000).toISOString(),
    remark: '入库',
    isRolledBack: false,
  } as TransferRecord);

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
    operatedAt: new Date(Date.now() - 79200000).toISOString(),
    remark: '出库',
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
    operatedAt: new Date(Date.now() - 75600000).toISOString(),
    remark: '接收',
    isRolledBack: false,
  } as TransferRecord);

  upsertTransferRecord({
    id: generateId(),
    sampleId,
    type: 'test_complete',
    fromStatus: 'testing',
    toStatus: 'tested',
    operatorId: tester.id,
    operatedAt: new Date(Date.now() - 72000000).toISOString(),
    remark: '完成',
    testResult: '合格',
    isRolledBack: false,
  } as TransferRecord);

  upsertTransferRecord({
    id: generateId(),
    sampleId,
    type: 'archive',
    fromStatus: 'tested',
    toStatus: 'archived',
    fromLocationId: testingLoc.id,
    toLocationId: archiveLoc.id,
    operatorId: auditor.id,
    operatedAt: new Date(Date.now() - 68400000).toISOString(),
    remark: '归档',
    isRolledBack: false,
  } as TransferRecord);

  return sample;
};

const loginAs = async (username: string, password: string = '123456') => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ username, password });
  return {
    res,
    body: res.body as any,
    sessionId: res.body?.data?.sessionId as string | undefined,
    user: res.body?.data?.user,
  };
};

const authHeader = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('后端集成测试', () => {
  beforeAll(() => {
    setupSeedData();
  });

  beforeEach(() => {
    resetServiceState();
  });

  describe('登录与会话', () => {
    it('登录成功返回稳定可调试结果', async () => {
      const { body, sessionId, user } = await loginAs('auditor01');
      expect(body.success).toBe(true);
      expect(sessionId).toBeTruthy();
      expect(user?.username).toBe('auditor01');
      expect(user?.role).toBe('auditor');
      expect(body.data.debug).toBeTruthy();
      expect(body.data.debug.hasFlowTraceAccess).toBe(true);
      expect(body.data.debug.visibleFieldsCount).toBeGreaterThan(0);
      expect(body.data.permissionSnapshot).toBeTruthy();
      expect(body.data.permissionSnapshot.isRevoked).toBe(false);
    });

    it('未登录访问 flow-trace 接口返回 401', async () => {
      const res = await request(app).get('/api/flow-trace/list');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('登出后 session 失效', async () => {
      const { sessionId } = await loginAs('warehouse01');
      const res1 = await request(app)
        .get('/api/auth/me')
        .set(authHeader(sessionId!));
      expect(res1.status).toBe(200);

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set(authHeader(sessionId!));
      expect(logoutRes.status).toBe(200);

      const res2 = await request(app)
        .get('/api/auth/me')
        .set(authHeader(sessionId!));
      expect(res2.status).toBe(401);
    });
  });

  describe('普通用户 vs 审核员字段差异', () => {
    let sampleId: string;

    beforeAll(() => {
      sampleId = createDemoSample('FLD01').id;
    });

    it('审核员详情包含敏感字段', async () => {
      const { sessionId } = await loginAs('auditor01');
      const res = await request(app)
        .get(`/api/flow-trace/detail/${sampleId}`)
        .set(authHeader(sessionId!));
      expect(res.status).toBe(200);
      const envelope = res.body.data;
      expect(envelope.permission.decision).toBe('allow');
      const data = envelope.data;
      expect(data.sample.reviewedBy).toBeTruthy();
      expect(data.sample.reviewedAt).toBeTruthy();
      expect(data.sample.lockReason).toBeTruthy();
      expect(data.sample.archivedAt).toBeTruthy();
      expect(data.businessChain[0].operatorName).toBeTruthy();
      expect(data.latestValidTransfer).toBeTruthy();
      expect(data.blockedOperations).toBeDefined();
      expect(data.rollbackHistory).toBeDefined();
      expect(data.fullTimeline).toBeTruthy();
      expect(data.summary.failedAttempts).toBeDefined();
      expect(data.summary.rollbackCount).toBeDefined();
    });

    it('普通用户详情敏感字段被脱敏', async () => {
      const { sessionId } = await loginAs('warehouse01');
      const res = await request(app)
        .get(`/api/flow-trace/detail/${sampleId}`)
        .set(authHeader(sessionId!));
      expect(res.status).toBe(200);
      const envelope = res.body.data;
      expect(envelope.permission.decision).toBe('redact');
      const data = envelope.data;
      expect(data.sample.reviewedBy).toBeUndefined();
      expect(data.sample.reviewedAt).toBeUndefined();
      expect(data.sample.archivedAt).toBeUndefined();
      expect(data.sample.lockReason).toBeUndefined();
      expect(data.businessChain[0].operatorName).toBeUndefined();
      expect(data.latestValidTransfer).toBeNull();
      expect(data.blockedOperations).toEqual([]);
      expect(data.rollbackHistory).toEqual([]);
      expect(Array.isArray(data.fullTimeline)).toBe(true);
      expect(data.fullTimeline.length).toBeGreaterThan(0);
      for (const item of data.fullTimeline) {
        expect(item.remark).toBeUndefined();
        expect(item.operatorRole).toBe('-');
      }
      expect(data.summary.failedAttempts).toBe(0);
      expect(data.summary.rollbackCount).toBe(0);
    });

    it('列表页审核员和普通用户字段差异正确', async () => {
      const { sessionId: auditorSession } = await loginAs('auditor01');
      const auditorList = await request(app)
        .get('/api/flow-trace/list')
        .set(authHeader(auditorSession!));
      expect(auditorList.status).toBe(200);
      const auditorEnvelope = auditorList.body.data;
      expect(auditorEnvelope.permission.decision).toBe('allow');
      const audSample = auditorEnvelope.data.find(
        (s: any) => s.id === sampleId,
      );
      expect(audSample).toBeTruthy();
      expect(audSample.lockReason).toBeTruthy();
      expect(audSample.failedAttempts).toBeDefined();
      expect(audSample.rollbackCount).toBeDefined();

      const { sessionId: whSession } = await loginAs('warehouse01');
      const whList = await request(app)
        .get('/api/flow-trace/list')
        .set(authHeader(whSession!));
      expect(whList.status).toBe(200);
      const whEnvelope = whList.body.data;
      expect(whEnvelope.permission.decision).toBe('redact');
      const whSample = whEnvelope.data.find(
        (s: any) => s.id === sampleId,
      );
      expect(whSample).toBeTruthy();
      expect(whSample.lockReason).toBeUndefined();
      expect(whSample.failedAttempts).toBe(0);
      expect(whSample.rollbackCount).toBe(0);
    });

    it('isAuditorRole 判定正确', () => {
      expect(isAuditorRole('auditor')).toBe(true);
      expect(isAuditorRole('admin')).toBe(true);
      expect(isAuditorRole('warehouse')).toBe(false);
      expect(isAuditorRole('collector')).toBe(false);
      expect(isAuditorRole('tester')).toBe(false);
    });
  });

  describe('权限撤销/恢复和重启一致性', () => {
    let sampleId: string;

    beforeAll(() => {
      sampleId = createDemoSample('REV01').id;
    });

    it('撤销权限后列表、详情、导出均返回 deny', async () => {
      const { user, sessionId } = await loginAs('warehouse01');
      expect(sessionId).toBeTruthy();

      const listBefore = await request(app)
        .get('/api/flow-trace/list')
        .set(authHeader(sessionId!));
      expect(listBefore.status).toBe(200);
      expect(listBefore.body.data.permission.decision).not.toBe('deny');

      const { sessionId: adminSession } = await loginAs('admin');
      const revokeRes = await request(app)
        .post(`/api/flow-trace/permission/revoke/${user.id}`)
        .send({ reason: 'test revoke' })
        .set(authHeader(adminSession!));
      expect(revokeRes.status).toBe(200);
      expect(revokeRes.body.success).toBe(true);

      const snap = getPermissionSnapshot(user);
      expect(snap?.isRevoked).toBe(true);
      expect(snap?.currentDecision).toBe('deny');

      const listAfter = await request(app)
        .get('/api/flow-trace/list')
        .set(authHeader(sessionId!));
      expect(listAfter.status).toBe(403);

      const detailAfter = await request(app)
        .get(`/api/flow-trace/detail/${sampleId}`)
        .set(authHeader(sessionId!));
      expect(detailAfter.status).toBe(403);

      const exportAfter = await request(app)
        .post(`/api/flow-trace/export/${sampleId}`)
        .send({ format: 'json' })
        .set(authHeader(sessionId!));
      expect(exportAfter.status).toBe(403);
    });

    it('权限撤销持久化，重启状态保持（模拟服务重启）', async () => {
      const db = getDB();
      const warehouseUser = db.users.find(u => u.username === 'warehouse01')!;
      const { sessionId: adminSession } = await loginAs('admin');

      const revokeRes = await request(app)
        .post(`/api/flow-trace/permission/revoke/${warehouseUser.id}`)
        .send({ reason: 'persistence test' })
        .set(authHeader(adminSession!));
      expect(revokeRes.status).toBe(200);

      flushOperationLogs();

      const permStates = db.flowTracePermissionState;
      const revokedState = permStates.find(s => s.userId === warehouseUser.id);
      expect(revokedState).toBeTruthy();
      expect(revokedState?.revokedAt).toBeTruthy();
      expect(typeof revokedState?.revokedAt).toBe('string');

      resetServiceState();

      const permSnapshotBeforeInit = getPermissionSnapshot(warehouseUser);
      expect(permSnapshotBeforeInit?.isRevoked).toBeFalsy();

      initPermissionStateFromDB(permStates as any[]);

      const snapAfter = getPermissionSnapshot(warehouseUser);
      expect(snapAfter?.isRevoked).toBe(true);
      expect(snapAfter?.currentDecision).toBe('deny');

      const permCheck = checkFlowTracePermission(warehouseUser, 'viewList');
      expect(permCheck.decision).toBe('deny');
    });

    it('恢复权限后接口恢复访问', async () => {
      const { user } = await loginAs('warehouse01');
      const { sessionId: adminSession } = await loginAs('admin');

      await request(app)
        .post(`/api/flow-trace/permission/revoke/${user.id}`)
        .send({ reason: 'temp' })
        .set(authHeader(adminSession!));

      const restoreRes = await request(app)
        .post(`/api/flow-trace/permission/restore/${user.id}`)
        .set(authHeader(adminSession!));
      expect(restoreRes.status).toBe(200);

      const snap = getPermissionSnapshot(user);
      expect(snap?.isRevoked).toBe(false);
      expect(snap?.currentDecision).toBe('redact');
    });
  });

  describe('重复查询后再导出一致性', () => {
    let sampleId: string;

    beforeAll(() => {
      sampleId = createDemoSample('CONS01').id;
    });

    it('多次查询后导出数据一致', async () => {
      const { sessionId } = await loginAs('auditor01');

      const detail1 = await request(app)
        .get(`/api/flow-trace/detail/${sampleId}`)
        .set(authHeader(sessionId!));
      expect(detail1.status).toBe(200);

      const detail2 = await request(app)
        .get(`/api/flow-trace/detail/${sampleId}`)
        .set(authHeader(sessionId!));
      expect(detail2.status).toBe(200);

      const d1 = detail1.body.data.data;
      const d2 = detail2.body.data.data;
      expect(d1.sample.sampleNo).toEqual(d2.sample.sampleNo);
      expect(d1.businessChain.length).toEqual(d2.businessChain.length);
      expect(d1.summary.totalTransfers).toEqual(d2.summary.totalTransfers);

      const list1 = await request(app)
        .get('/api/flow-trace/list')
        .set(authHeader(sessionId!));
      const list2 = await request(app)
        .get('/api/flow-trace/list')
        .set(authHeader(sessionId!));
      expect(list1.body.data.data.length).toEqual(
        list2.body.data.data.length,
      );

      const exportRes = await request(app)
        .post(`/api/flow-trace/export/${sampleId}`)
        .send({ format: 'json' })
        .set(authHeader(sessionId!));
      expect(exportRes.status).toBe(200);
      const exportJsonStr = exportRes.body.data.data;
      expect(typeof exportJsonStr).toBe('string');
      const exportObj = JSON.parse(exportJsonStr);
      expect(exportObj.sample.sampleNo).toEqual(d1.sample.sampleNo);
      expect(exportObj.businessChain.length).toEqual(d1.businessChain.length);
      expect(exportObj.summary.totalTransfers).toEqual(d1.summary.totalTransfers);
    });

    it('普通用户重复查询和导出字段一致脱敏', async () => {
      const { sessionId } = await loginAs('warehouse01');

      const detail = await request(app)
        .get(`/api/flow-trace/detail/${sampleId}`)
        .set(authHeader(sessionId!));
      expect(detail.status).toBe(200);
      expect(detail.body.data.data.sample.reviewedBy).toBeUndefined();

      const exportRes = await request(app)
        .post(`/api/flow-trace/export/${sampleId}`)
        .send({ format: 'json' })
        .set(authHeader(sessionId!));
      expect(exportRes.status).toBe(200);

      const exportJsonStr = exportRes.body.data.data;
      expect(typeof exportJsonStr).toBe('string');
      const exportObj = JSON.parse(exportJsonStr);
      expect(exportObj.sample.reviewedBy).toBeUndefined();
      expect(exportObj.redactedFields.length).toBeGreaterThan(0);
      expect(exportObj.redactionNotice).toBeTruthy();
    });

    it('CSV 导出成功生成带分隔符的文本', async () => {
      const { sessionId } = await loginAs('auditor01');
      const exportRes = await request(app)
        .post(`/api/flow-trace/export/${sampleId}`)
        .send({ format: 'csv' })
        .set(authHeader(sessionId!));
      expect(exportRes.status).toBe(200);
      const envelope = exportRes.body.data;
      expect(envelope.filename).toBeTruthy();
      const csvContent = envelope.data;
      expect(typeof csvContent).toBe('string');
      expect(csvContent).toContain(',');
    });
  });

  describe('重新导入同一样本状态一致性', () => {
    it('重新导入同一样本号，详情展示为当前最新状态', async () => {
      const db = getDB();
      const collector = db.users.find(u => u.role === 'collector')!;
      const auditor = db.users.find(u => u.role === 'auditor')!;
      const archiveLoc = db.locations.find(l => l.type === 'archive')!;

      const firstId = generateId();
      const sampleNo = 'DUP-TEST-001';
      upsertSample({
        id: firstId,
        sampleNo,
        batchId: generateId(),
        type: '血液',
        collectedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        collectedBy: collector.displayName,
        description: 'first version',
        currentStatus: 'imported',
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
        updatedAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      } as Sample);

      const { sessionId } = await loginAs('auditor01');
      const firstDetail = await request(app)
        .get(`/api/flow-trace/detail/${firstId}`)
        .set(authHeader(sessionId!));
      expect(firstDetail.status).toBe(200);
      expect(firstDetail.body.data.data.sample.currentStatus).toBe(
        'imported',
      );

      const secondId = generateId();
      const now = nowISO();
      upsertSample({
        id: secondId,
        sampleNo,
        batchId: generateId(),
        type: '血液',
        collectedAt: new Date(Date.now() - 86400000).toISOString(),
        collectedBy: collector.displayName,
        description: 'reimported version',
        currentStatus: 'archived',
        currentLocationId: archiveLoc.id,
        currentHolderId: auditor.id,
        isArchived: true,
        archivedAt: now,
        reviewedBy: auditor.id,
        reviewedAt: now,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: now,
      } as Sample);

      const secondDetail = await request(app)
        .get(`/api/flow-trace/detail/${secondId}`)
        .set(authHeader(sessionId!));
      expect(secondDetail.status).toBe(200);
      expect(secondDetail.body.data.data.sample.sampleNo).toBe(sampleNo);
      expect(secondDetail.body.data.data.sample.currentStatus).toBe(
        'archived',
      );
      expect(secondDetail.body.data.data.sample.description).toBe(
        'reimported version',
      );

      const firstAgain = await request(app)
        .get(`/api/flow-trace/detail/${firstId}`)
        .set(authHeader(sessionId!));
      expect(firstAgain.status).toBe(200);
      expect(firstAgain.body.data.data.sample.currentStatus).toBe(
        'imported',
      );
    });
  });

  describe('审计记录落盘', () => {
    it('成功操作产生审计记录，flush 后可查询', async () => {
      const { sessionId } = await loginAs('auditor01');
      flushOperationLogs();

      const listBefore = await request(app)
        .get('/api/flow-trace/audit-records')
        .set(authHeader(sessionId!));
      expect(listBefore.status).toBe(200);
      const beforeCount = listBefore.body.data.records.length;

      const sampleId = createDemoSample('AUD01').id;
      await request(app)
        .get(`/api/flow-trace/detail/${sampleId}`)
        .set(authHeader(sessionId!));
      await request(app)
        .post(`/api/flow-trace/export/${sampleId}`)
        .send({ format: 'json' })
        .set(authHeader(sessionId!));

      await request(app)
        .post('/api/auth/debug/flush-logs')
        .set(authHeader(sessionId!));

      const listAfter = await request(app)
        .get('/api/flow-trace/audit-records')
        .set(authHeader(sessionId!));
      expect(listAfter.status).toBe(200);
      const afterCount = listAfter.body.data.records.length;
      expect(afterCount).toBeGreaterThan(beforeCount);

      const records = listAfter.body.data.records as any[];
      const actions = records.map(r => r.action);
      expect(actions).toContain('viewDetail');
      expect(actions).toContain('export');
    });
  });

  describe('服务重启重新认证', () => {
    it('checkServiceRestartReauth 对重启后创建的 session 返回 null，重启前的返回 deny', () => {
      const db = getDB();
      const user = db.users.find(u => u.role === 'warehouse')!;

      const afterStartSessionTime = new Date(
        new Date(getServiceStartedAt()).getTime() + 5000,
      ).toISOString();
      const checkAfter = checkServiceRestartReauth(user, afterStartSessionTime);
      expect(checkAfter).toBeNull();

      const beforeStartSessionTime = new Date(
        new Date(getServiceStartedAt()).getTime() - 5000,
      ).toISOString();
      const checkBefore = checkServiceRestartReauth(user, beforeStartSessionTime);
      expect(checkBefore).toBeTruthy();
      expect(checkBefore?.decision).toBe('deny');

      resetServiceState();
      const newServiceStartedAt = getServiceStartedAt();

      const checkAfterReset = checkServiceRestartReauth(user, afterStartSessionTime);
      const origStart = new Date(afterStartSessionTime).getTime();
      const newStart = new Date(newServiceStartedAt).getTime();
      if (origStart < newStart) {
        expect(checkAfterReset).toBeTruthy();
        expect(checkAfterReset?.decision).toBe('deny');
      } else {
        expect(checkAfterReset).toBeNull();
      }
    });
  });

  describe('统一错误响应格式', () => {
    it('未认证返回统一错误格式', async () => {
      const res = await request(app).get('/api/flow-trace/list');
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeTruthy();
      expect(res.body.error.code).toBeTruthy();
      expect(res.body.error.message).toBeTruthy();
      expect(res.body.timestamp).toBeTruthy();
      expect(res.body.requestId).toBeTruthy();
    });

    it('未找到返回统一格式', async () => {
      const { sessionId } = await loginAs('admin');
      const res = await request(app)
        .get('/api/flow-trace/detail/non-existent-id')
        .set(authHeader(sessionId!));
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeTruthy();
    });
  });
});
