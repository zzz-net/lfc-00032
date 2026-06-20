import type { UserRole, SampleStatus, TransferType } from './types';

export const DB_NAME = 'SampleTrackingDB';
export const DB_VERSION = 1;

export const STORES = {
  users: 'users',
  batches: 'batches',
  samples: 'samples',
  locations: 'locations',
  transferRecords: 'transferRecords',
  failedTransfers: 'failedTransfers',
  auditLogs: 'auditLogs',
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
} as const;

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
