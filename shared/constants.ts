import type { UserRole, SampleStatus, TransferType } from './types';

export const DB_NAME = 'SampleTrackingDB';
export const DB_VERSION = 2;

export const STORES = {
  users: 'users',
  batches: 'batches',
  samples: 'samples',
  locations: 'locations',
  transferRecords: 'transferRecords',
  failedTransfers: 'failedTransfers',
  auditLogs: 'auditLogs',
  flowTraceAuditRecords: 'flowTraceAuditRecords',
  flowTracePermissionState: 'flowTracePermissionState',
} as const;

export const SESSION_KEY = 'sample_tracking_session';

export const ROLE_LABELS: Record<UserRole, string> = {
  collector: '采集员',
  warehouse: '库管员',
  tester: '检测员',
  auditor: '审核员',
  admin: '管理员',
};

export const STATUS_LABELS: Record<SampleStatus, string> = {
  imported: '待入库',
  in_stock: '在库',
  in_transit: '送检中',
  testing: '检测中',
  tested: '检测完成',
  archived: '已归档',
  rolled_back: '已回退',
};

export const STATUS_COLORS: Record<SampleStatus, string> = {
  imported: 'bg-slate-100 text-slate-700 border-slate-200',
  in_stock: 'bg-teal-50 text-teal-700 border-teal-200',
  in_transit: 'bg-amber-50 text-amber-700 border-amber-200',
  testing: 'bg-blue-50 text-blue-700 border-blue-200',
  tested: 'bg-violet-50 text-violet-700 border-violet-200',
  archived: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rolled_back: 'bg-rose-50 text-rose-700 border-rose-200',
};

export const TRANSFER_TYPE_LABELS: Record<TransferType, string> = {
  import: '批次导入',
  inbound: '入库登记',
  outbound: '出库交接',
  test_receive: '检测接收',
  test_complete: '检测完成',
  archive: '归档复核',
  rollback: '异常回退',
};

export const TRANSFER_TYPE_COLORS: Record<TransferType, string> = {
  import: 'bg-slate-500',
  inbound: 'bg-teal-600',
  outbound: 'bg-amber-600',
  test_receive: 'bg-blue-600',
  test_complete: 'bg-violet-600',
  archive: 'bg-emerald-600',
  rollback: 'bg-rose-600',
};

export const LOCATION_TYPE_LABELS: Record<string, string> = {
  storage: '存储库位',
  testing: '检测区域',
  archive: '归档区域',
};

export const ERROR_CODES = {
  DUPLICATE_SAMPLE_NO: 'DUPLICATE_SAMPLE_NO',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  WRONG_SOURCE_LOCATION: 'WRONG_SOURCE_LOCATION',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
  SAMPLE_ALREADY_ARCHIVED: 'SAMPLE_ALREADY_ARCHIVED',
  SAMPLE_NOT_REVIEWED: 'SAMPLE_NOT_REVIEWED',
  TRANSFER_NOT_FOUND: 'TRANSFER_NOT_FOUND',
  TRANSFER_ALREADY_ROLLED_BACK: 'TRANSFER_ALREADY_ROLLED_BACK',
  INVALID_TARGET_LOCATION: 'INVALID_TARGET_LOCATION',
  LOCATION_FULL: 'LOCATION_FULL',
  INVALID_HOLDER: 'INVALID_HOLDER',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_DATE_FORMAT: 'INVALID_DATE_FORMAT',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  PERMISSION_STATE_CORRUPTED: 'PERMISSION_STATE_CORRUPTED',
  AUDIT_RECORD_PERSIST_FAILED: 'AUDIT_RECORD_PERSIST_FAILED',
  SAMPLE_REIMPORTED: 'SAMPLE_REIMPORTED',
} as const;

export const ERROR_CATEGORIES: Record<string, 'permission' | 'status' | 'location' | 'duplicate' | 'other'> = {
  DUPLICATE_SAMPLE_NO: 'duplicate',
  INVALID_STATUS_TRANSITION: 'status',
  WRONG_SOURCE_LOCATION: 'location',
  INSUFFICIENT_PERMISSION: 'permission',
  SAMPLE_ALREADY_ARCHIVED: 'status',
  SAMPLE_NOT_REVIEWED: 'status',
  TRANSFER_NOT_FOUND: 'other',
  TRANSFER_ALREADY_ROLLED_BACK: 'status',
  INVALID_TARGET_LOCATION: 'location',
  LOCATION_FULL: 'location',
  INVALID_HOLDER: 'status',
  MISSING_REQUIRED_FIELD: 'other',
  INVALID_DATE_FORMAT: 'other',
  INVALID_CREDENTIALS: 'permission',
  AUTH_REQUIRED: 'permission',
};

export const ERROR_CATEGORY_LABELS: Record<string, string> = {
  permission: '权限不足',
  status: '状态冲突',
  location: '库位问题',
  duplicate: '编号重复',
  other: '其他原因',
};

export const FLOW_TRACE_STAGE_LABELS: Record<string, string> = {
  import: '批次导入',
  inbound: '入库登记',
  outbound: '出库交接',
  test_receive: '检测接收',
  test_complete: '检测完成',
  review: '复核通过',
  archive: '归档完成',
  rollback: '异常回退',
};

export const FLOW_TRACE_STAGE_ORDER: string[] = [
  'import',
  'inbound',
  'outbound',
  'test_receive',
  'test_complete',
  'review',
  'archive',
];

export const STATUS_TO_STAGE: Record<string, string> = {
  imported: 'import',
  in_stock: 'inbound',
  in_transit: 'outbound',
  testing: 'test_receive',
  tested: 'test_complete',
  archived: 'archive',
  rolled_back: 'rollback',
};

export const DEFAULT_PASSWORD = '123456';

export const hashPassword = (password: string): string => {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `hash_${Math.abs(hash).toString(16)}_${password.length}`;
};

export const FLOW_TRACE_PERMISSION_DENY_REASONS = {
  ROLE_NOT_AUTHORIZED: '当前角色无权访问追溯功能',
  PERMISSION_REVOKED: '追溯权限已被撤销',
  SAMPLE_LOCKED: '该样本已锁定，需审核员权限',
  EXPORT_QUOTA_EXCEEDED: '导出次数超出限制',
  CONCURRENT_EXPORT_LIMIT: '并发导出数量超出限制',
  SERVICE_RESTART_REAUTH: '服务重启后需重新验证权限',
  PERMISSION_CHANGED_MID_OPERATION: '操作期间权限发生变更',
  INSUFFICIENT_CLEARANCE: '安全等级不足，无法查看完整数据',
} as const;

export const FLOW_TRACE_AUDIT_ROLES: UserRole[] = ['auditor', 'admin'];

export const FLOW_TRACE_REDACTION_LEVELS = {
  MINIMAL: {
    level: 'minimal' as const,
    fields: ['blockedOperations', 'rollbackHistory', 'fullTimeline', 'latestValidTransfer'],
    message: '您的权限仅允许查看样本基本信息',
  },
  PARTIAL: {
    level: 'partial' as const,
    fields: ['blockedOperations.errorMessage', 'rollbackHistory.reason', 'fullTimeline.remark', 'fullTimeline.errorMessage'],
    message: '敏感字段已脱敏，如需完整信息请联系审核员',
  },
};

export const DEFAULT_FLOW_TRACE_AUDIT_CONFIG: import('./types').FlowTraceAuditConfig = {
  enabled: true,
  logSuccess: true,
  logDenied: true,
  logRedacted: true,
  retentionDays: 90,
  includeMetadata: true,
  flushIntervalMs: 5000,
  maxBufferSize: 20,
};

export const FLOW_TRACE_AUDITOR_VISIBLE_FIELDS = [
  'sample.id', 'sample.sampleNo', 'sample.type', 'sample.batchId', 'sample.batchNo',
  'sample.currentStatus', 'sample.currentLocation', 'sample.currentHolder',
  'sample.isArchived', 'sample.archivedAt', 'sample.archivedBy',
  'sample.reviewedBy', 'sample.reviewedAt', 'sample.isLocked', 'sample.lockReason',
  'sample.collectedAt', 'sample.collectedBy', 'sample.description',
  'businessChain', 'latestValidTransfer', 'blockedOperations',
  'rollbackHistory', 'fullTimeline', 'summary',
];

export const FLOW_TRACE_NON_AUDITOR_VISIBLE_FIELDS = [
  'sample.id', 'sample.sampleNo', 'sample.type', 'sample.batchNo',
  'sample.currentStatus', 'sample.currentLocation', 'sample.currentHolder',
  'sample.isArchived', 'sample.isLocked',
  'sample.collectedAt', 'sample.collectedBy',
  'businessChain.key', 'businessChain.label', 'businessChain.status',
  'businessChain.timestamp', 'businessChain.location',
  'summary.totalTransfers', 'summary.validTransfers',
  'summary.currentStageLabel', 'summary.daysInCurrentStage',
];

export const FLOW_TRACE_NON_AUDITOR_REDACTED_FIELDS = [
  'sample.lockReason', 'sample.archivedBy', 'sample.archivedAt',
  'sample.reviewedBy', 'sample.reviewedAt',
  'businessChain.operatorName', 'businessChain.operatorRole', 'businessChain.remark',
  'businessChain.rollbackReason', 'businessChain.errorCode', 'businessChain.errorMessage',
  'latestValidTransfer', 'blockedOperations', 'rollbackHistory', 'fullTimeline',
  'summary.failedAttempts', 'summary.rollbackCount', 'summary.archiveAttempts',
];
