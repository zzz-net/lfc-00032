import type {
  User,
  UserRole,
  FlowTracePermissionAction,
  FlowTracePermissionCheck,
  FlowTracePermissionDecision,
  FlowTracePermissionEnvelope,
  FlowTracePermissionState,
  FlowTraceRedactedData,
  FlowTraceSampleSummary,
  FlowTraceDetailData,
  FlowTraceExportOptions,
  FlowTraceAuditRecord,
  FlowTraceAuditQueryFilter,
  FlowTraceAuditConfig,
  FlowTracePermissionSnapshot,
} from '../../shared/types.js';
import {
  ERROR_CODES,
  FLOW_TRACE_PERMISSION_DENY_REASONS,
  FLOW_TRACE_AUDIT_ROLES,
  FLOW_TRACE_REDACTION_LEVELS,
  DEFAULT_FLOW_TRACE_AUDIT_CONFIG,
  FLOW_TRACE_AUDITOR_VISIBLE_FIELDS,
  FLOW_TRACE_NON_AUDITOR_VISIBLE_FIELDS,
  FLOW_TRACE_NON_AUDITOR_REDACTED_FIELDS,
} from '../../shared/constants.js';
import {
  generateId,
  nowISO,
  findFlowTracePermissionStateByUserId,
  upsertFlowTracePermissionState,
  getFlowTraceAuditRecords,
  upsertFlowTraceAuditRecord,
} from '../lib/db.js';
import { hasPermission } from './permissionService.js';

const MAX_CONCURRENT_EXPORTS = 3;
const MAX_EXPORTS_PER_HOUR = 10;

interface ExportQuota {
  userId: string;
  count: number;
  windowStart: string;
  concurrentExports: Set<string>;
}

interface ExportQuotaCache {
  [userId: string]: ExportQuota;
}

interface AuditLogBuffer {
  logs: FlowTraceAuditRecord[];
  lastFlushAt: string;
}

let permissionStateCache: Record<string, FlowTracePermissionState> = {};
let exportQuotaCache: ExportQuotaCache = {};
let auditLogBuffer: AuditLogBuffer = { logs: [], lastFlushAt: nowISO() };
let serviceInstanceId: string = generateId();
let serviceStartedAt: string = nowISO();
let auditConfig: FlowTraceAuditConfig = { ...DEFAULT_FLOW_TRACE_AUDIT_CONFIG };
let permissionStateLoaded = false;
let sampleIdMapping: Map<string, string> = new Map();

const ACTION_TO_PERMISSION: Record<FlowTracePermissionAction, string> = {
  viewList: 'flowTrace:view',
  viewDetail: 'flowTrace:viewDetail',
  export: 'flowTrace:export',
};

export const loadPersistedPermissionState = async () => {
  if (permissionStateLoaded) return;
  try {
    const allStates = [findFlowTracePermissionStateByUserId('__noop__')]
      .filter(Boolean) as unknown as Array<FlowTracePermissionState & { id: string }>;

    const directAccess = (globalThis as unknown as { _flowTracePermStates?: Array<FlowTracePermissionState & { id: string }> })._flowTracePermStates;
    const statesToLoad = directAccess || allStates;

    permissionStateCache = {};
    for (const state of statesToLoad) {
      const { id: _id, ...rest } = state;
      permissionStateCache[state.userId] = rest as FlowTracePermissionState;
    }
    permissionStateLoaded = true;
  } catch {
    permissionStateCache = {};
    permissionStateLoaded = true;
  }
};

export const initPermissionStateFromDB = (
  states: Array<FlowTracePermissionState & { id: string }>
) => {
  permissionStateCache = {};
  for (const state of states) {
    const { id: _id, ...rest } = state;
    permissionStateCache[state.userId] = rest as FlowTracePermissionState;
  }
  permissionStateLoaded = true;
  (globalThis as unknown as { _flowTracePermStates: Array<FlowTracePermissionState & { id: string }> })._flowTracePermStates = states;
};

const persistPermissionState = (userId: string) => {
  try {
    const state = permissionStateCache[userId];
    if (state) {
      upsertFlowTracePermissionState({ id: userId, ...state });
    }
  } catch {
    // ignore
  }
};

const flushAuditBuffer = () => {
  if (auditLogBuffer.logs.length === 0) return;
  const logsToFlush = [...auditLogBuffer.logs];
  auditLogBuffer.logs = [];
  auditLogBuffer.lastFlushAt = nowISO();

  try {
    for (const log of logsToFlush) {
      upsertFlowTraceAuditRecord(log);
    }
  } catch {
    for (const log of logsToFlush) {
      auditLogBuffer.logs.push(log);
    }
  }
};

export const isAuditorRole = (role: UserRole): boolean => {
  return FLOW_TRACE_AUDIT_ROLES.includes(role);
};

export const registerSampleIdMapping = (sampleNo: string, sampleId: string) => {
  sampleIdMapping.set(sampleNo, sampleId);
};

export const resolveSampleId = (sampleNoOrId: string): string => {
  return sampleIdMapping.get(sampleNoOrId) || sampleNoOrId;
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
  persistPermissionState(user.id);

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
    const state = user ? permissionStateCache[user.id] : null;
    if (state && state.revokedAt) {
      return {
        action: 'viewList',
        userId: user?.id || '',
        userRole: user?.role || 'collector',
        timestamp: nowISO(),
        decision: 'deny',
        reason: state.revokeReason || FLOW_TRACE_PERMISSION_DENY_REASONS.PERMISSION_REVOKED,
        errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      };
    }

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

  const state = permissionStateCache[user.id];
  if (state && state.revokedAt && state.revokedAt <= now) {
    return {
      allowed: false,
      operationId,
      reason: state.revokeReason || FLOW_TRACE_PERMISSION_DENY_REASONS.PERMISSION_REVOKED,
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

  return { allowed: true, operationId };
};

export const releaseExportSlot = (userId: string, operationId: string) => {
  const quota = exportQuotaCache[userId];
  if (quota) {
    quota.concurrentExports.delete(operationId);
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

  return {
    data,
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
}): FlowTraceAuditRecord => {
  const operationId = generateId();
  const auditRecord: FlowTraceAuditRecord = {
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
    serviceInstanceId,
    metadata: auditConfig.includeMetadata ? {
      serviceStartedAt,
      auditConfigEnabled: auditConfig.enabled,
    } : undefined,
  };

  if (auditConfig.enabled) {
    const shouldLog = (
      (params.status === 'success' && auditConfig.logSuccess) ||
      (params.status === 'denied' && auditConfig.logDenied) ||
      (params.status === 'redacted' && auditConfig.logRedacted) ||
      params.status === 'error'
    );

    if (shouldLog) {
      auditLogBuffer.logs.push(auditRecord);

      if (auditLogBuffer.logs.length >= auditConfig.maxBufferSize) {
        flushAuditBuffer();
      }
    }
  }

  return auditRecord;
};

export const flushOperationLogs = () => {
  const logsToFlush = [...auditLogBuffer.logs];
  if (logsToFlush.length > 0) {
    try {
      for (const log of logsToFlush) {
        upsertFlowTraceAuditRecord(log);
      }
      auditLogBuffer.logs = [];
    } catch {
      // keep in buffer on failure
    }
  }
  auditLogBuffer.lastFlushAt = nowISO();
  return logsToFlush;
};

export const queryAuditRecords = async (filter?: FlowTraceAuditQueryFilter): Promise<FlowTraceAuditRecord[]> => {
  flushAuditBuffer();

  try {
    let records = getFlowTraceAuditRecords();

    if (filter) {
      if (filter.userId) {
        records = records.filter((r) => r.userId === filter.userId);
      }
      if (filter.action) {
        records = records.filter((r) => r.action === filter.action);
      }
      if (filter.sampleId) {
        records = records.filter((r) => r.sampleId === filter.sampleId);
      }
      if (filter.status) {
        records = records.filter((r) => r.status === filter.status);
      }
      if (filter.permissionDecision) {
        records = records.filter((r) => r.permissionDecision === filter.permissionDecision);
      }
      if (filter.fromTimestamp) {
        records = records.filter((r) => r.timestamp >= filter.fromTimestamp!);
      }
      if (filter.toTimestamp) {
        records = records.filter((r) => r.timestamp <= filter.toTimestamp!);
      }
    }

    records.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

    if (filter?.limit) {
      const offset = filter.offset || 0;
      records = records.slice(offset, offset + filter.limit);
    }

    return records;
  } catch {
    return [];
  }
};

export const getPermissionSnapshot = (user: User | null): FlowTracePermissionSnapshot | null => {
  if (!user) return null;

  const state = permissionStateCache[user.id];
  const isRevoked = !!(state?.revokedAt);
  const isAuditor = isAuditorRole(user.role);

  const currentDecision = isRevoked
    ? 'deny'
    : isAuditor
      ? 'allow'
      : 'redact';

  return {
    userId: user.id,
    userRole: user.role,
    isRevoked,
    revokedAt: state?.revokedAt,
    revokeReason: state?.revokeReason,
    restoredAt: state?.restoredAt,
    grantedActions: state?.grantedActions || [],
    lastCheckAt: state?.lastCheckAt || '',
    currentDecision,
    visibleFields: isAuditor ? FLOW_TRACE_AUDITOR_VISIBLE_FIELDS : FLOW_TRACE_NON_AUDITOR_VISIBLE_FIELDS,
    redactedFields: isAuditor ? [] : FLOW_TRACE_NON_AUDITOR_REDACTED_FIELDS,
  };
};

export const revokePermission = async (userId: string, reason: string) => {
  const state = permissionStateCache[userId] || {
    userId,
    lastCheckAt: nowISO(),
    grantedActions: [],
  };
  state.revokedAt = nowISO();
  state.revokeReason = reason;
  permissionStateCache[userId] = state;
  persistPermissionState(userId);
};

export const restorePermission = async (userId: string) => {
  const state = permissionStateCache[userId];
  if (state) {
    delete state.revokedAt;
    delete state.revokeReason;
    state.restoredAt = nowISO();
    persistPermissionState(userId);
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
    bufferedLogs: auditLogBuffer.logs.length,
  };
};

export const getAuditConfig = (): FlowTraceAuditConfig => {
  return { ...auditConfig };
};

export const updateAuditConfig = (updates: Partial<FlowTraceAuditConfig>) => {
  auditConfig = { ...auditConfig, ...updates };
};

export const resetServiceState = () => {
  serviceInstanceId = generateId();
  serviceStartedAt = nowISO();
  permissionStateCache = {};
  exportQuotaCache = {};
  auditLogBuffer = { logs: [], lastFlushAt: nowISO() };
  sampleIdMapping = new Map();
  permissionStateLoaded = false;
};

export const getServiceInstanceId = () => serviceInstanceId;
export const getServiceStartedAt = () => serviceStartedAt;
