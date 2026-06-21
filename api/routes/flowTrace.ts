import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  flowTracePermissionMiddleware,
  type FlowTraceSecureRequest,
} from '../middleware/flowTracePermission.js';
import {
  successResponse,
  notFoundResponse,
  badRequestResponse,
  errorResponse,
  serverErrorResponse,
} from '../lib/response.js';
import {
  getFlowTraceList,
  getFlowTraceData,
  exportFlowTraceData,
} from '../services/flowTraceQueryService.js';
import {
  redactSampleSummary,
  redactDetailData,
  redactExportData,
  createOperationLog,
  wrapWithPermissionEnvelope,
  acquireExportSlot,
  releaseExportSlot,
  queryAuditRecords,
  revokePermission,
  restorePermission,
  flushOperationLogs,
} from '../services/flowTracePermissionService.js';
import type {
  FlowTraceFilter,
  FlowTraceExportOptions,
  FlowTraceAuditQueryFilter,
  User,
} from '../../shared/types.js';
import { findSampleById, findSampleBySampleNo } from '../lib/db.js';

const router = Router();

router.use(requireAuth);

router.get(
  '/list',
  flowTracePermissionMiddleware('viewList'),
  async (req: Request, res: Response): Promise<void> => {
    const secureReq = req as FlowTraceSecureRequest;
    const user = (req.currentUser || null) as User | null;
    const ft = secureReq.flowTrace!;

    try {
      const filter: FlowTraceFilter = {
        keyword: req.query.keyword as string | undefined,
        status: req.query.status as FlowTraceFilter['status'],
        hasFailed: req.query.hasFailed === 'true',
        hasRollback: req.query.hasRollback === 'true',
        isLocked: req.query.isLocked === 'true',
        isArchived: req.query.isArchived !== undefined ? req.query.isArchived === 'true' : undefined,
      };

      const rawData = getFlowTraceList(filter);
      const { data, redaction } = redactSampleSummary(rawData, ft.isAuditor);

      const status = redaction ? 'redacted' : 'success';
      const sampleNoMap: Record<string, string> = {};
      for (const s of rawData) {
        sampleNoMap[s.id] = s.sampleNo;
      }

      createOperationLog({
        user,
        action: 'viewList',
        status,
        permissionDecision: ft.permCheck.decision,
        dataSize: data.length,
      });

      const envelope = wrapWithPermissionEnvelope(data, ft.permCheck, redaction);
      successResponse(res, envelope);
    } catch (e) {
      createOperationLog({
        user,
        action: 'viewList',
        status: 'error',
        permissionDecision: ft.permCheck.decision,
        errorCode: 'UNKNOWN_ERROR',
        denyReason: e instanceof Error ? e.message : '未知错误',
      });
      serverErrorResponse(res, e instanceof Error ? e.message : '查询失败');
    }
  }
);

router.get(
  '/detail/:sampleId',
  flowTracePermissionMiddleware('viewDetail'),
  async (req: Request, res: Response): Promise<void> => {
    const secureReq = req as FlowTraceSecureRequest;
    const user = (req.currentUser || null) as User | null;
    const ft = secureReq.flowTrace!;
    const sampleId = req.params.sampleId;

    try {
      const actualSampleId = resolveRealSampleId(sampleId);

      const rawData = getFlowTraceData(actualSampleId);

      if (!rawData) {
        notFoundResponse(res, '样本不存在');
        return;
      }

      const { data, redaction } = redactDetailData(rawData, ft.isAuditor);

      const status = redaction ? 'redacted' : 'success';

      createOperationLog({
        user,
        action: 'viewDetail',
        status,
        permissionDecision: ft.permCheck.decision,
        sampleId: actualSampleId,
        sampleNo: rawData.sample.sampleNo,
      });

      const envelope = wrapWithPermissionEnvelope(data, ft.permCheck, redaction);
      successResponse(res, envelope);
    } catch (e) {
      createOperationLog({
        user,
        action: 'viewDetail',
        status: 'error',
        permissionDecision: ft.permCheck.decision,
        sampleId,
        errorCode: 'UNKNOWN_ERROR',
        denyReason: e instanceof Error ? e.message : '未知错误',
      });
      serverErrorResponse(res, e instanceof Error ? e.message : '查询失败');
    }
  }
);

router.post(
  '/export/:sampleId',
  flowTracePermissionMiddleware('export'),
  async (req: Request, res: Response): Promise<void> => {
    const secureReq = req as FlowTraceSecureRequest;
    const user = (req.currentUser || null) as User | null;
    const ft = secureReq.flowTrace!;
    const sampleId = req.params.sampleId;
    const options = (req.body || {}) as FlowTraceExportOptions;

    const slot = acquireExportSlot(user);

    if (!slot.allowed) {
      createOperationLog({
        user,
        action: 'export',
        status: 'denied',
        permissionDecision: 'deny',
        sampleId,
        exportOptions: options,
        denyReason: slot.reason,
        errorCode: 'EXPORT_SLOT_DENIED',
      });
      errorResponse(res, 'EXPORT_LIMIT_EXCEEDED', slot.reason || '导出超限', 429);
      return;
    }

    try {
      const actualSampleId = resolveRealSampleId(sampleId);
      const sample = findSampleById(actualSampleId);

      if (!sample) {
        releaseExportSlot(user?.id || '', slot.operationId);
        notFoundResponse(res, '样本不存在');
        return;
      }

      const format = options.format || 'json';
      const rawData = exportFlowTraceData(actualSampleId, options);

      if (!rawData) {
        releaseExportSlot(user?.id || '', slot.operationId);
        notFoundResponse(res, '样本追溯数据不存在');
        return;
      }

      const { data: redactedData, redaction } = redactExportData(rawData, format, ft.isAuditor);

      const status = redaction ? 'redacted' : 'success';

      createOperationLog({
        user,
        action: 'export',
        status,
        permissionDecision: ft.permCheck.decision,
        sampleId: actualSampleId,
        sampleNo: sample.sampleNo,
        exportOptions: options,
        dataSize: Buffer.byteLength(redactedData, 'utf-8'),
      });

      releaseExportSlot(user?.id || '', slot.operationId);

      const envelope = wrapWithPermissionEnvelope(redactedData, ft.permCheck, redaction);

      if (format === 'csv') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        successResponse(res, {
          ...envelope,
          filename: `flow-trace-${sample.sampleNo}.csv`,
        });
      } else {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        successResponse(res, envelope);
      }
    } catch (e) {
      releaseExportSlot(user?.id || '', slot.operationId);
      createOperationLog({
        user,
        action: 'export',
        status: 'error',
        permissionDecision: ft.permCheck.decision,
        sampleId,
        exportOptions: options,
        errorCode: 'UNKNOWN_ERROR',
        denyReason: e instanceof Error ? e.message : '未知错误',
      });
      serverErrorResponse(res, e instanceof Error ? e.message : '导出失败');
    }
  }
);

router.get(
  '/audit-records',
  flowTracePermissionMiddleware('viewList'),
  async (req: Request, res: Response): Promise<void> => {
    const user = (req.currentUser || null) as User | null;

    try {
      const filter: FlowTraceAuditQueryFilter = {
        userId: req.query.userId as string | undefined,
        action: req.query.action as FlowTraceAuditQueryFilter['action'],
        sampleId: req.query.sampleId as string | undefined,
        status: req.query.status as FlowTraceAuditQueryFilter['status'],
        permissionDecision: req.query.permissionDecision as FlowTraceAuditQueryFilter['permissionDecision'],
        fromTimestamp: req.query.fromTimestamp as string | undefined,
        toTimestamp: req.query.toTimestamp as string | undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        offset: req.query.offset ? parseInt(req.query.offset as string, 10) : undefined,
      };

      flushOperationLogs();
      const records = await queryAuditRecords(filter);
      successResponse(res, { records, total: records.length, filter });
    } catch (e) {
      serverErrorResponse(res, e instanceof Error ? e.message : '查询审计记录失败');
    }
  }
);

router.post(
  '/permission/revoke/:userId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const currentUser = req.currentUser;
    const { userId } = req.params;
    const { reason } = req.body || {};

    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'auditor')) {
      errorResponse(res, 'INSUFFICIENT_PERMISSION', '仅管理员或审核员可撤销权限', 403);
      return;
    }

    if (!reason) {
      badRequestResponse(res, '必须提供撤销原因', 'MISSING_REASON');
      return;
    }

    await revokePermission(userId, reason);
    flushOperationLogs();
    successResponse(res, { message: '权限已撤销', userId, reason });
  }
);

router.post(
  '/permission/restore/:userId',
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const currentUser = req.currentUser;
    const { userId } = req.params;

    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'auditor')) {
      errorResponse(res, 'INSUFFICIENT_PERMISSION', '仅管理员或审核员可恢复权限', 403);
      return;
    }

    await restorePermission(userId);
    flushOperationLogs();
    successResponse(res, { message: '权限已恢复', userId });
  }
);

const resolveRealSampleId = (sampleIdOrNo: string): string => {
  const byId = findSampleById(sampleIdOrNo);
  if (byId) return byId.id;
  const byNo = findSampleBySampleNo(sampleIdOrNo);
  if (byNo) return byNo.id;
  return sampleIdOrNo;
};

export default router;
