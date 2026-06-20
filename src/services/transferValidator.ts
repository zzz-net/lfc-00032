import type {
  Sample,
  SampleStatus,
  Location,
  User,
  TransferRecord,
  TransferType,
  TransferValidationResult,
} from '@shared/types';
import { ERROR_CODES } from '@shared/constants';

interface InboundValidationParams {
  sample: Sample;
  targetLocation: Location;
  operator: User;
}

interface OutboundValidationParams {
  sample: Sample;
  sourceLocationId: string;
  operator: User;
  receiver: User;
}

interface TestReceiveValidationParams {
  sample: Sample;
  operator: User;
  targetLocation: Location;
}

interface TestCompleteValidationParams {
  sample: Sample;
  operator: User;
}

interface ArchiveValidationParams {
  sample: Sample;
  operator: User;
  reviewer: User;
}

interface RollbackValidationParams {
  sample: Sample;
  targetTransfer: TransferRecord | undefined;
  operator: User;
}

const isArchivedProtected = (sample: Sample): TransferValidationResult => {
  if (sample.isArchived) {
    return {
      valid: false,
      errorCode: ERROR_CODES.SAMPLE_ALREADY_ARCHIVED,
      errorMessage: '样本已归档，禁止执行任何编辑或流转操作',
    };
  }
  return { valid: true };
};

const checkStatus = (sample: Sample, expectedStatus: SampleStatus): TransferValidationResult => {
  if (sample.currentStatus !== expectedStatus) {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_STATUS_TRANSITION,
      errorMessage: `样本当前状态不符合要求，期望状态: ${expectedStatus}`,
    };
  }
  return { valid: true };
};

export const validateInbound = (params: InboundValidationParams): TransferValidationResult => {
  const { sample, targetLocation, operator } = params;

  const archivedCheck = isArchivedProtected(sample);
  if (!archivedCheck.valid) return archivedCheck;

  const statusCheck = checkStatus(sample, 'imported');
  if (!statusCheck.valid) return statusCheck;

  if (targetLocation.status !== 'active') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_TARGET_LOCATION,
      errorMessage: '目标库位未启用',
    };
  }

  if (targetLocation.type !== 'storage') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_TARGET_LOCATION,
      errorMessage: '入库目标必须是存储类型库位',
    };
  }

  if (operator.role !== 'warehouse' && operator.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '只有库管员可以执行入库操作',
    };
  }

  return { valid: true };
};

export const validateOutbound = (params: OutboundValidationParams): TransferValidationResult => {
  const { sample, sourceLocationId, operator, receiver } = params;

  const archivedCheck = isArchivedProtected(sample);
  if (!archivedCheck.valid) return archivedCheck;

  const statusCheck = checkStatus(sample, 'in_stock');
  if (!statusCheck.valid) return statusCheck;

  if (sample.currentLocationId !== sourceLocationId) {
    return {
      valid: false,
      errorCode: ERROR_CODES.WRONG_SOURCE_LOCATION,
      errorMessage: '样本当前所在库位与选择的转出库位不一致',
    };
  }

  if (sample.currentHolderId && sample.currentHolderId !== operator.id) {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_HOLDER,
      errorMessage: '当前操作人不是样本持有人',
    };
  }

  if (operator.role !== 'warehouse' && operator.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '只有库管员可以执行出库操作',
    };
  }

  if (receiver.role !== 'tester' && receiver.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '出库接收人必须是检测员',
    };
  }

  return { valid: true };
};

export const validateTestReceive = (
  params: TestReceiveValidationParams
): TransferValidationResult => {
  const { sample, operator, targetLocation } = params;

  const archivedCheck = isArchivedProtected(sample);
  if (!archivedCheck.valid) return archivedCheck;

  const statusCheck = checkStatus(sample, 'in_transit');
  if (!statusCheck.valid) return statusCheck;

  if (operator.role !== 'tester' && operator.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '只有检测员可以接收检测样本',
    };
  }

  if (targetLocation.type !== 'testing') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_TARGET_LOCATION,
      errorMessage: '检测接收目标必须是检测区域',
    };
  }

  return { valid: true };
};

export const validateTestComplete = (
  params: TestCompleteValidationParams
): TransferValidationResult => {
  const { sample, operator } = params;

  const archivedCheck = isArchivedProtected(sample);
  if (!archivedCheck.valid) return archivedCheck;

  const statusCheck = checkStatus(sample, 'testing');
  if (!statusCheck.valid) return statusCheck;

  if (sample.currentHolderId !== operator.id && operator.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_HOLDER,
      errorMessage: '只有当前样本持有人可以提交检测完成',
    };
  }

  if (operator.role !== 'tester' && operator.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '只有检测员可以提交检测完成',
    };
  }

  return { valid: true };
};

export const validateArchive = (params: ArchiveValidationParams): TransferValidationResult => {
  const { sample, operator, reviewer } = params;

  const archivedCheck = isArchivedProtected(sample);
  if (!archivedCheck.valid) return archivedCheck;

  const statusCheck = checkStatus(sample, 'tested');
  if (!statusCheck.valid) return statusCheck;

  if (!sample.reviewedBy || !sample.reviewedAt) {
    return {
      valid: false,
      errorCode: ERROR_CODES.SAMPLE_NOT_REVIEWED,
      errorMessage: '样本未经过审核员复核，无法归档',
    };
  }

  if (reviewer.role !== 'auditor' && reviewer.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '复核人必须是审核员角色',
    };
  }

  if (operator.role !== 'auditor' && operator.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '只有审核员可以执行归档操作',
    };
  }

  return { valid: true };
};

export const validateRollback = (params: RollbackValidationParams): TransferValidationResult => {
  const { sample, targetTransfer, operator } = params;

  if (!targetTransfer) {
    return {
      valid: false,
      errorCode: ERROR_CODES.TRANSFER_NOT_FOUND,
      errorMessage: '目标交接记录不存在，无法回退',
    };
  }

  if (targetTransfer.isRolledBack) {
    return {
      valid: false,
      errorCode: ERROR_CODES.TRANSFER_ALREADY_ROLLED_BACK,
      errorMessage: '该交接记录已经被回退过',
    };
  }

  if (sample.currentStatus !== targetTransfer.toStatus) {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_STATUS_TRANSITION,
      errorMessage: '样本当前状态与交接记录目标状态不匹配，无法回退',
    };
  }

  if (targetTransfer.type === 'import') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INVALID_STATUS_TRANSITION,
      errorMessage: '批次导入记录不允许回退',
    };
  }

  if (operator.role !== 'auditor' && operator.role !== 'admin') {
    return {
      valid: false,
      errorCode: ERROR_CODES.INSUFFICIENT_PERMISSION,
      errorMessage: '只有审核员或管理员可以执行回退操作',
    };
  }

  return { valid: true };
};

export const VALID_TRANSITIONS: Record<TransferType, { from: SampleStatus; to: SampleStatus }> = {
  import: { from: 'imported', to: 'imported' },
  inbound: { from: 'imported', to: 'in_stock' },
  outbound: { from: 'in_stock', to: 'in_transit' },
  test_receive: { from: 'in_transit', to: 'testing' },
  test_complete: { from: 'testing', to: 'tested' },
  archive: { from: 'tested', to: 'archived' },
  rollback: { from: 'archived', to: 'rolled_back' },
};
