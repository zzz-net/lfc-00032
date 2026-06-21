export type UserRole = 'collector' | 'warehouse' | 'tester' | 'auditor' | 'admin';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
  passwordHash: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  username: string;
  role: UserRole;
  displayName: string;
}

export type LocationType = 'storage' | 'testing' | 'archive';

export interface Location {
  id: string;
  code: string;
  name: string;
  type: LocationType;
  parentId?: string;
  capacity: number;
  status: 'active' | 'inactive';
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export type SampleStatus =
  | 'imported'
  | 'in_stock'
  | 'in_transit'
  | 'testing'
  | 'tested'
  | 'archived'
  | 'rolled_back';

export interface Sample {
  id: string;
  sampleNo: string;
  batchId: string;
  type: string;
  collectedAt: string;
  collectedBy: string;
  description?: string;
  currentStatus: SampleStatus;
  currentLocationId?: string;
  currentHolderId?: string;
  isArchived: boolean;
  archivedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Batch {
  id: string;
  batchNo: string;
  importedAt: string;
  importedBy: string;
  sampleCount: number;
  remark?: string;
}

export type TransferType =
  | 'import'
  | 'inbound'
  | 'outbound'
  | 'test_receive'
  | 'test_complete'
  | 'archive'
  | 'rollback';

export interface TransferRecord {
  id: string;
  sampleId: string;
  type: TransferType;
  fromStatus?: SampleStatus;
  toStatus: SampleStatus;
  fromLocationId?: string;
  toLocationId?: string;
  fromHolderId?: string;
  toHolderId?: string;
  operatorId: string;
  operatedAt: string;
  remark?: string;
  testResult?: string;
  isRolledBack: boolean;
  rolledBackBy?: string;
  rolledBackAt?: string;
  rollbackReason?: string;
  rollbackToRecordId?: string;
}

export interface FailedTransfer {
  id: string;
  sampleId: string;
  attemptedType: TransferType;
  attemptedAt: string;
  attemptedBy: string;
  errorCode: string;
  errorMessage: string;
  payload: Record<string, unknown>;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  userId: string;
  action: string;
  targetType: string;
  targetId?: string;
  details: Record<string, unknown>;
}

export interface TransferValidationResult {
  valid: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export type AuditExportFormat = 'json' | 'csv';

export interface AuditTimelineFilter {
  sampleId?: string;
  userId?: string;
  fromDate?: string;
  toDate?: string;
  transferType?: TransferType;
}

export interface SampleImportRow {
  sampleNo: string;
  type: string;
  collectedAt: string;
  collectedBy: string;
  description?: string;
}

export interface ImportResult {
  success: boolean;
  batchId?: string;
  batchNo?: string;
  importedCount: number;
  failedRows: Array<{
    rowIndex: number;
    data: SampleImportRow;
    errorCode: string;
    errorMessage: string;
  }>;
}

export type ArchiveReviewRecordType = 'transfer' | 'failed' | 'rollback' | 'review';

export interface ArchiveReviewTimelineItem {
  id: string;
  type: ArchiveReviewRecordType;
  timestamp: string;
  operatorName: string;
  operatorRole: string;
  action: string;
  status?: string;
  location?: string;
  holder?: string;
  testResult?: string;
  remark?: string;
  isRolledBack?: boolean;
  rollbackReason?: string;
  rollbackBy?: string;
  rollbackAt?: string;
  errorCode?: string;
  errorMessage?: string;
  payload?: Record<string, unknown>;
}

export interface ArchiveReviewData {
  sample: {
    id: string;
    sampleNo: string;
    type: string;
    currentStatus: SampleStatus;
    isArchived: boolean;
    archivedAt?: string;
    archivedBy?: string;
    reviewedBy?: string;
    reviewedAt?: string;
    isLocked: boolean;
    lockReason?: string;
  };
  archiveTransfer: TransferRecord | null;
  timeline: ArchiveReviewTimelineItem[];
  failedTransfers: Array<{
    id: string;
    attemptedType: TransferType;
    attemptedAt: string;
    attemptedByName: string;
    errorCode: string;
    errorMessage: string;
    resolved: boolean;
  }>;
  rollbackRecords: Array<{
    id: string;
    rollbackAt: string;
    rollbackByName: string;
    reason: string;
    rolledBackTransferType: TransferType;
    fromStatus: SampleStatus;
    toStatus: SampleStatus;
  }>;
  summary: {
    totalTransfers: number;
    successfulTransfers: number;
    failedAttempts: number;
    rollbackCount: number;
    archiveAttempts: number;
    lastArchiveAt?: string;
    lastRollbackAt?: string;
  };
}

export interface ArchiveReviewExportOptions {
  format: 'json' | 'csv';
  includeFullTimeline?: boolean;
  includeFailedRecords?: boolean;
  includeRollbackRecords?: boolean;
}
