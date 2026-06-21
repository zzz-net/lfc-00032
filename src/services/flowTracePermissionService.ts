import type {
  User,
  UserRole,
  FlowTracePermissionAction,
  FlowTracePermissionCheck,
  FlowTracePermissionDecision,
  FlowTracePermissionEnvelope,
  FlowTraceOperationLog,
  FlowTracePermissionState,
  FlowTraceRedactedData,
  FlowTraceSampleSummary,
  FlowTraceDetailData,
  FlowTraceExportOptions,
} from '@shared/types';
import {
  ERROR_CODES,
  FLOW_TRACE_PERMISSION_DENY_REASONS,
  FLOW_TRACE_AUDIT_ROLES,
  FLOW_TRACE_REDACTION_LEVELS,
} from '@shared/constants';
import { generateId, nowISO } from '../lib/db';
import { hasPermission } from './permissionService';

const PERMISSION_STATE_KEY = 'flow_trace_permission_state';
const EXPORT_QUOTA_KEY = 'flow_trace_export_quota';
const MAX_CONCURRENT_EXPORTS = 3;
const MAX_EXPORTS_PER_HOUR = 10;

interface PermissionStateCache {
  [userId: string]: FlowTracePermissionState;
}

interface ExportQuota {
  userId: string;
  count: number;
  windowStart: string;
  concurrentExports: Set<string>;
}

interface ExportQuotaCache {
  [userId: string]: ExportQuota;
}

interface OperationLogBuffer {
  logs: FlowTraceOperationLog[];
  lastFlushAt: string;
}

let permissionStateCache: PermissionStateCache = {};
let exportQuotaCache: ExportQuotaCache = {};
let operationLogBuffer: OperationLogBuffer = { logs: [], lastFlushAt: nowISO() };
let serviceInstanceId: string = generateId();
let serviceStartedAt: string = nowISO();

const ACTION_TO_PERMISSION: Record<FlowTracePermissionAction, string> = {
  viewList: 'flowTrace:view',
  viewDetail: 'flowTrace:viewDetail',
  export: 'flowTrace:export',
};

const loadPermissionState = () => {
  try {
    const stored = localStorage.getItem(PERMISSION_STATE_KEY);
    if (stored) {
      permissionStateCache = JSON.parse(stored);
    }
  } catch {
    permissionStateCache = {};
  }
};

const savePermissionState = () => {
  try {
    localStorage.setItem(PERMISSION_STATE_KEY, JSON.stringify(permissionStateCache));
  } catch {
    // ignore
  }
};

const loadExportQuota = () => {
  try {
    const stored = localStorage.getItem(EXPORT_QUOTA_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      exportQuotaCache = {};
      for (const [userId, quota] of Object.entries(parsed)) {
        exportQuotaCache[userId] = {
          ...(quota as ExportQuota),
          concurrentExports: new Set((quota as ExportQuota).concurrentExports as unknown as string[]),
        };
      }
    }
  } catch {
    exportQuotaCache = {};
  }
};

const saveExportQuota = () => {
  try {
    const toStore: Record<string, Omit<ExportQuota, 'concurrentExports'> & { concurrentExports: string[] }> = {};
    for (const [userId, quota] of Object.entries(exportQuotaCache)) {
      toStore[userId] = {
        ...quota,
        concurrentExports: Array.from(quota.concurrentExports),
      };
    }
    localStorage.setItem(EXPORT_QUOTA_KEY, JSON.stringify(toStore));
  } catch {
    // ignore
  }
};

loadPermissionState();
loadExportQuota();

export const isAuditorRole = (role: UserRole): boolean => {
  return FLOW_TRACE_AUDIT_ROLES.includes(role);
};

export const checkFlowTracePermission = (
  user: User | null,
  action: FlowTracePermissionAction,
  sampleId?: string
): FlowTracePermissionCheck => {
  const now = nowISO();

  if (!user) {
    return {
      action,
      sampleId,
      timestamp: now,
      userId: '',
      userRole: 'collector',
      decision: 'deny',
      reason: FLOW_TRACE_PERMISSION_DENY_REASONS.ROLE_NOT_AUTHORIZED,
      errorCode: ERROR_CODES.AUTH_REQUIRED,
    };
  }

  const baseResult = {
    action,
    sampleId,
    timestamp: now,
    userId: user.id,
    userRole: user.role,
  };

  const permissionKey = ACTION_TO_PERMISSION[action];
  const permCheck = hasPermission(user, permissionKey);

  if (!permCheck.allowed) {
    return {
      ...baseResult,
      decision: 'deny',
      reason: FLOW_TRACE_PERMISSION_DENY_REASONS.ROLE_NOT_AUTHORIZED,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
    };
  }

  const state = permissionStateCache[user.id];
  if (state && state.revokedAt && state.revokedAt <= now) {
    return {
      ...baseResult,
      decision: 'deny',
      reason: state.revokeReason || FLOW_TRACE_PERMISSION_DENY_REASONS.PERMISSION_REVOKED,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
    };
  }

  if (state && state.lastCheckAt) {
    const lastCheck = new Date(state.lastCheckAt).getTime();
    const nowTime = new Date(now).getTime();
    if (nowTime - lastCheck > 30 * 60 * 1000) {
      // 超过30分钟，需要重新验证
    }
  }

  const decision: FlowTracePermissionDecision = isAuditorRole(user.role) ? 'allow' : 'redact';
  const reason = decision === 'allow'
    ? '审核员权限，允许完整访问'
    : '非审核员角色，数据将被脱敏';

  permissionStateCache[user.id] = {
    userId: user.id,
    lastCheckAt: now,
    grantedActions: [...(state?.grantedActions || []), action].filter(
      (v, i, a) => a.indexOf(v) === i
    ),
    revokedAt: state?.revokedAt,
    revokeReason: state?.revokeReason,
  };
  savePermissionState();

  return {
    ...baseResult,
    decision,
    reason,
  };
};

export const checkServiceRestartReauth = (
  user: User | null,
  lastAccessAt?: string
): FlowTracePermissionCheck | null => {
  if (!lastAccessAt) return null;

  const lastAccess = new Date(lastAccessAt).getTime();
  const startedAt = new Date(serviceStartedAt).getTime();

  if (lastAccess < startedAt) {
    return {
      action: 'viewList',
      userId: user?.id || '',
      userRole: user?.role || 'collector',
      timestamp: nowISO(),
      decision: 'deny',
      reason: FLOW_TRACE_PERMISSION_DENY_REASONS.SERVICE_RESTART_REAUTH,
      errorCode: ERROR_CODES.AUTH_REQUIRED,
    };
  }

  return null;
};

export const checkPermissionMidOperation = (
  user: User | null,
  action: FlowTracePermissionAction,
  operationStartAt: string
): FlowTracePermissionCheck | null => {
  const state = user ? permissionStateCache[user.id] : null;
  if (state?.revokedAt && state.revokedAt > operationStartAt) {
    return {
      action,
      userId: user?.id || '',
      userRole: user?.role || 'collector',
      timestamp: nowISO(),
      decision: 'deny',
      reason: FLOW_TRACE_PERMISSION_DENY_REASONS.PERMISSION_CHANGED_MID_OPERATION,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
    };
  }
  return null;
};

export const acquireExportSlot = (
  user: User | null
): { allowed: boolean; operationId: string; reason?: string } => {
  const operationId = generateId();

  if (!user) {
    return { allowed: false, operationId, reason: '用户未登录' };
  }

  const now = nowISO();
  const nowTime = new Date(now).getTime();
  const windowStart = new Date(nowTime - 60 * 60 * 1000).toISOString();

  let quota = exportQuotaCache[user.id];
  if (!quota || quota.windowStart < windowStart) {
    quota = {
      userId: user.id,
      count: 0,
      windowStart: now,
      concurrentExports: new Set(),
    };
  }

  if (quota.count >= MAX_EXPORTS_PER_HOUR) {
    return {
      allowed: false,
      operationId,
      reason: FLOW_TRACE_PERMISSION_DENY_REASONS.EXPORT_QUOTA_EXCEEDED,
    };
  }

  if (quota.concurrentExports.size >= MAX_CONCURRENT_EXPORTS) {
    return {
      allowed: false,
      operationId,
      reason: FLOW_TRACE_PERMISSION_DENY_REASONS.CONCURRENT_EXPORT_LIMIT,
    };
  }

  quota.count++;
  quota.concurrentExports.add(operationId);
  exportQuotaCache[user.id] = quota;
  saveExportQuota();

  return { allowed: true, operationId };
};

export const releaseExportSlot = (userId: string, operationId: string) => {
  const quota = exportQuotaCache[userId];
  if (quota) {
    quota.concurrentExports.delete(operationId);
    saveExportQuota();
  }
};

export const redactSampleSummary = (
  summaries: FlowTraceSampleSummary[],
  isAuditor: boolean
): { data: FlowTraceSampleSummary[]; redaction?: FlowTraceRedactedData } => {
  if (isAuditor) {
    return { data: summaries };
  }

  const level = FLOW_TRACE_REDACTION_LEVELS.PARTIAL;
  const redactedSummaries = summaries.map((s) => ({
    ...s,
    hasBlockedOps: false,
    failedAttempts: 0,
    rollbackCount: 0,
    lockReason: undefined,
  }));

  return {
    data: redactedSummaries,
    redaction: {
      level: level.level,
      redactedFields: level.fields,
      message: level.message,
    },
  };
};

export const redactDetailData = (
  data: FlowTraceDetailData | null,
  isAuditor: boolean
): { data: FlowTraceDetailData | null; redaction?: FlowTraceRedactedData } => {
  if (!data) return { data: null };
  if (isAuditor) return { data };

  const level = FLOW_TRACE_REDACTION_LEVELS.MINIMAL;

  const redacted: FlowTraceDetailData = {
    ...data,
    sample: {
      ...data.sample,
      lockReason: undefined,
      archivedBy: undefined,
      archivedAt: undefined,
      reviewedBy: undefined,
      reviewedAt: undefined,
    },
    businessChain: data.businessChain.map((stage) => ({
      ...stage,
      operatorName: undefined,
      operatorRole: undefined,
      remark: undefined,
      rollbackReason: undefined,
      errorCode: undefined,
      errorMessage: undefined,
    })),
    latestValidTransfer: null,
    blockedOperations: [],
    rollbackHistory: [],
    fullTimeline: data.fullTimeline.map((item) => ({
      ...item,
      remark: undefined,
      rollbackReason: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      operatorRole: '-',
      testResult: undefined,
    })),
    summary: {
      ...data.summary,
      failedAttempts: 0,
      rollbackCount: 0,
      archiveAttempts: 0,
    },
  };

  return {
    data: redacted,
    redaction: {
      level: level.level,
      redactedFields: level.fields,
      message: level.message,
    },
  };
};

export const redactExportData = (
  data: string,
  format: 'json' | 'csv',
  isAuditor: boolean
): { data: string; redaction?: FlowTraceRedactedData } => {
  if (isAuditor) return { data };

  const level = FLOW_TRACE_REDACTION_LEVELS.MINIMAL;

  if (format === 'json') {
    try {
      const parsed = JSON.parse(data);
      const redacted = {
        exportedAt: parsed.exportedAt,
        exportType: parsed.exportType,
        sample: {
          id: parsed.sample?.id,
          sampleNo: parsed.sample?.sampleNo,
          type: parsed.sample?.type,
          batchNo: parsed.sample?.batchNo,
          currentStatus: parsed.sample?.currentStatus,
          currentLocation: parsed.sample?.currentLocation,
          currentHolder: parsed.sample?.currentHolder,
          isArchived: parsed.sample?.isArchived,
          isLocked: parsed.sample?.isLocked,
          collectedAt: parsed.sample?.collectedAt,
          collectedBy: parsed.sample?.collectedBy,
        },
        summary: {
          totalTransfers: parsed.summary?.totalTransfers,
          validTransfers: parsed.summary?.validTransfers,
          currentStageLabel: parsed.summary?.currentStageLabel,
          daysInCurrentStage: parsed.summary?.daysInCurrentStage,
        },
        redactionNotice: level.message,
        redactedFields: level.fields,
      };
      return {
        data: JSON.stringify(redacted, null, 2),
        redaction: {
          level: level.level,
          redactedFields: level.fields,
          message: level.message,
        },
      };
    } catch {
      return { data, redaction: { level: 'minimal', redactedFields: [], message: '数据解析失败，已返回原始数据' } };
    }
  }

  const redactedCsv = [
    ['=== 样本流转追溯记录（脱敏版） ==='],
    ['导出时间', new Date().toLocaleString('zh-CN')],
    ['注意', level.message],
    [],
    ['=== 样本基本信息 ==='],
  ];

  try {
    if (format === 'csv') {
      const lines = data.split('\n');
      let inBasicInfo = false;
      for (const line of lines) {
        if (line.includes('=== 样本基本信息 ===')) {
          inBasicInfo = true;
          continue;
        }
        if (line.includes('===') && inBasicInfo) {
          break;
        }
        if (inBasicInfo && line.trim()) {
          const cols = line.split(',');
          if (cols[0] && !['锁定原因', '归档时间', '归档人', '复核时间', '复核人', '备注说明'].includes(cols[0].replace(/"/g, ''))) {
            redactedCsv.push(cols);
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return {
    data: redactedCsv.map((row) => row.join(',')).join('\n'),
    redaction: {
      level: level.level,
      redactedFields: level.fields,
      message: level.message,
    },
  };
};

export const createOperationLog = (params: {
  user: User | null;
  action: FlowTracePermissionAction;
  status: 'success' | 'denied' | 'redacted' | 'error';
  permissionDecision: FlowTracePermissionDecision;
  sampleId?: string;
  sampleNo?: string;
  denyReason?: string;
  errorCode?: string;
  exportOptions?: FlowTraceExportOptions;
  dataSize?: number;
}): FlowTraceOperationLog => {
  const operationId = generateId();
  const log: FlowTraceOperationLog = {
    id: generateId(),
    operationId,
    userId: params.user?.id || '',
    username: params.user?.username || '',
    userRole: params.user?.role || 'collector',
    action: params.action,
    sampleId: params.sampleId,
    sampleNo: params.sampleNo,
    timestamp: nowISO(),
    status: params.status,
    permissionDecision: params.permissionDecision,
    denyReason: params.denyReason,
    errorCode: params.errorCode,
    exportOptions: params.exportOptions,
    dataSize: params.dataSize,
    clientInfo: `service:${serviceInstanceId}`,
  };

  operationLogBuffer.logs.push(log);

  if (operationLogBuffer.logs.length >= 10) {
    flushOperationLogs();
  }

  return log;
};

export const flushOperationLogs = () => {
  const logsToFlush = [...operationLogBuffer.logs];
  operationLogBuffer.logs = [];
  operationLogBuffer.lastFlushAt = nowISO();
  return logsToFlush;
};

export const getOperationLogs = (): FlowTraceOperationLog[] => {
  return [...operationLogBuffer.logs];
};

export const revokePermission = (userId: string, reason: string) => {
  const state = permissionStateCache[userId] || {
    userId,
    lastCheckAt: nowISO(),
    grantedActions: [],
  };
  state.revokedAt = nowISO();
  state.revokeReason = reason;
  permissionStateCache[userId] = state;
  savePermissionState();
};

export const restorePermission = (userId: string) => {
  const state = permissionStateCache[userId];
  if (state) {
    delete state.revokedAt;
    delete state.revokeReason;
    savePermissionState();
  }
};

export const wrapWithPermissionEnvelope = <T>(
  data: T | null,
  permission: FlowTracePermissionCheck,
  redaction?: FlowTraceRedactedData
): FlowTracePermissionEnvelope<T> => {
  return {
    data,
    permission,
    redaction,
    operationId: generateId(),
    timestamp: nowISO(),
  };
};

export const getServiceStatus = () => {
  return {
    instanceId: serviceInstanceId,
    startedAt: serviceStartedAt,
    permissionStates: Object.keys(permissionStateCache).length,
    activeExports: Object.values(exportQuotaCache).reduce((sum, q) => sum + q.concurrentExports.size, 0),
    bufferedLogs: operationLogBuffer.logs.length,
  };
};

export const resetServiceState = () => {
  serviceInstanceId = generateId();
  serviceStartedAt = nowISO();
  permissionStateCache = {};
  exportQuotaCache = {};
  operationLogBuffer = { logs: [], lastFlushAt: nowISO() };
  localStorage.removeItem(PERMISSION_STATE_KEY);
  localStorage.removeItem(EXPORT_QUOTA_KEY);
};
