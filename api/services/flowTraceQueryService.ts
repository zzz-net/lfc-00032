import type {
  Sample,
  Batch,
  TransferRecord,
  Location,
  User,
  FailedTransfer,
  SampleStatus,
  TransferType,
  FlowTraceSampleSummary,
  FlowTraceDetailData,
  FlowTraceFilter,
  FlowTraceStageKey,
  FlowTraceExportOptions,
} from '../../shared/types.js';
import {
  TRANSFER_TYPE_LABELS,
  ERROR_CATEGORIES,
  FLOW_TRACE_STAGE_LABELS,
  FLOW_TRACE_STAGE_ORDER,
  STATUS_TO_STAGE,
  STATUS_LABELS,
} from '../../shared/constants.js';
import {
  getSamples,
  getBatches,
  getTransferRecords,
  getFailedTransfers,
  getLocations,
  getUsers,
  findSampleById,
  findTransfersBySampleId,
  nowISO,
} from '../lib/db.js';
import Papa from 'papaparse';

const typePriority: Record<TransferType, number> = {
  import: 0,
  inbound: 1,
  outbound: 2,
  test_receive: 3,
  test_complete: 4,
  archive: 5,
  rollback: 6,
};

const sortTransfers = (transfers: TransferRecord[]): TransferRecord[] => {
  return [...transfers].sort((a, b) => {
    const timeCompare = a.operatedAt.localeCompare(b.operatedAt);
    if (timeCompare !== 0) return timeCompare;
    const priorityA = typePriority[a.type] ?? 100;
    const priorityB = typePriority[b.type] ?? 100;
    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.id.localeCompare(b.id);
  });
};

const buildUserMap = (users: User[]) => new Map(users.map((u) => [u.id, u]));
const buildLocationMap = (locations: Location[]) => new Map(locations.map((l) => [l.id, l]));

const getUserInfo = (userMap: Map<string, User>, userId?: string) => {
  if (!userId) return { name: '-', role: '-' };
  const user = userMap.get(userId);
  return {
    name: user?.displayName || userId,
    role: user?.role || '-',
  };
};

const getLocationCode = (locationMap: Map<string, Location>, locationId?: string) => {
  if (!locationId) return '-';
  return locationMap.get(locationId)?.code || locationId;
};

const getErrorCategory = (errorCode: string): 'permission' | 'status' | 'location' | 'duplicate' | 'other' => {
  return ERROR_CATEGORIES[errorCode] || 'other';
};

export const getFlowTraceList = (filter?: FlowTraceFilter): FlowTraceSampleSummary[] => {
  const allSamples = getSamples();
  const allBatches = getBatches();
  const allTransfers = getTransferRecords();
  const allFailed = getFailedTransfers();

  const batchMap = new Map(allBatches.map((b) => [b.id, b]));

  const transferMap = new Map<string, TransferRecord[]>();
  const failedMap = new Map<string, FailedTransfer[]>();

  for (const t of allTransfers) {
    if (!transferMap.has(t.sampleId)) transferMap.set(t.sampleId, []);
    transferMap.get(t.sampleId)!.push(t);
  }

  for (const f of allFailed) {
    const key = f.sampleId || (f.payload?.sampleNo as string) || '';
    if (!failedMap.has(key)) failedMap.set(key, []);
    failedMap.get(key)!.push(f);
  }

  const summaries: FlowTraceSampleSummary[] = [];

  for (const sample of allSamples) {
    const batch = batchMap.get(sample.batchId);
    const sampleTransfers = transferMap.get(sample.id) || [];
    const sampleFailed = failedMap.get(sample.id) || failedMap.get(sample.sampleNo) || [];

    const sortedTransfers = sortTransfers(sampleTransfers);
    const rollbackCount = sortedTransfers.filter((t) => t.type === 'rollback').length;
    const lastTransfer = sortedTransfers.length > 0 ? sortedTransfers[sortedTransfers.length - 1] : null;

    const currentStage = (STATUS_TO_STAGE[sample.currentStatus] || 'import') as FlowTraceStageKey;

    let isLocked = false;
    let lockReason: string | undefined;

    if (sample.isArchived) {
      isLocked = true;
      lockReason = '样本已归档，所有操作被锁定';
    }

    const hasBlockedOps = sampleFailed.some((f) => !f.resolved);

    summaries.push({
      id: sample.id,
      sampleNo: sample.sampleNo,
      type: sample.type,
      batchNo: batch?.batchNo || '-',
      currentStatus: sample.currentStatus,
      currentStage,
      isArchived: sample.isArchived,
      isLocked,
      lockReason,
      lastTransferAt: lastTransfer?.operatedAt,
      failedAttempts: sampleFailed.length,
      rollbackCount,
      hasBlockedOps,
    });
  }

  summaries.sort((a, b) => {
    const aTime = a.lastTransferAt || '';
    const bTime = b.lastTransferAt || '';
    return bTime.localeCompare(aTime);
  });

  if (filter) {
    let filtered = summaries;

    if (filter.keyword) {
      const kw = filter.keyword.toLowerCase();
      filtered = filtered.filter(
        (s) =>
          s.sampleNo.toLowerCase().includes(kw) ||
          s.batchNo.toLowerCase().includes(kw) ||
          s.type.toLowerCase().includes(kw)
      );
    }

    if (filter.status) {
      filtered = filtered.filter((s) => s.currentStatus === filter.status);
    }

    if (filter.hasFailed) {
      filtered = filtered.filter((s) => s.failedAttempts > 0);
    }

    if (filter.hasRollback) {
      filtered = filtered.filter((s) => s.rollbackCount > 0);
    }

    if (filter.isLocked) {
      filtered = filtered.filter((s) => s.isLocked);
    }

    if (filter.isArchived !== undefined) {
      filtered = filtered.filter((s) => s.isArchived === filter.isArchived);
    }

    return filtered;
  }

  return summaries;
};

export const getFlowTraceData = (sampleId: string): FlowTraceDetailData | null => {
  const sample = findSampleById(sampleId);
  if (!sample) return null;

  const allBatches = getBatches();
  const allTransfers = findTransfersBySampleId(sampleId);
  const allUsers = getUsers();
  const allLocations = getLocations();
  const allFailedRaw = getFailedTransfers();

  const batch = allBatches.find((b) => b.id === sample.batchId);
  const userMap = buildUserMap(allUsers);
  const locationMap = buildLocationMap(allLocations);

  const sortedTransfers = sortTransfers(allTransfers);
  const sortedFailed = allFailedRaw
    .filter((f) => {
      if (f.sampleId === sampleId) return true;
      if (f.sampleId === '' && f.payload?.sampleNo === sample.sampleNo) return true;
      return false;
    })
    .sort((a, b) => a.attemptedAt.localeCompare(b.attemptedAt));

  const stageToTransferType: Record<string, TransferType> = {
    import: 'import',
    inbound: 'inbound',
    outbound: 'outbound',
    test_receive: 'test_receive',
    test_complete: 'test_complete',
    archive: 'archive',
    rollback: 'rollback',
  };

  const buildBusinessChain = (): FlowTraceDetailData['businessChain'] => {
    const stages: FlowTraceDetailData['businessChain'] = [];

    const validTransfers = sortedTransfers.filter(
      (t) => t.type !== 'rollback' && !t.isRolledBack
    );

    const latestTransferByType = new Map<TransferType, TransferRecord>();
    for (const t of validTransfers) {
      latestTransferByType.set(t.type, t);
    }

    const currentStageKey = STATUS_TO_STAGE[sample.currentStatus] || 'import';

    for (const stageKey of FLOW_TRACE_STAGE_ORDER) {
      const transferType = stageToTransferType[stageKey] as TransferType;
      const transfer = latestTransferByType.get(transferType);
      const stageLabel = FLOW_TRACE_STAGE_LABELS[stageKey] || stageKey;

      let stageStatus: FlowTraceDetailData['businessChain'][0]['status'] = 'pending';
      let timestamp: string | undefined;
      let operatorName: string | undefined;
      let operatorRole: string | undefined;
      let location: string | undefined;
      let remark: string | undefined;
      let testResult: string | undefined;

      if (stageKey === 'review') {
        if (sample.reviewedBy && sample.reviewedAt) {
          stageStatus = currentStageKey === 'review' ? 'current' : 'completed';
          timestamp = sample.reviewedAt;
          const reviewer = getUserInfo(userMap, sample.reviewedBy);
          operatorName = reviewer.name;
          operatorRole = reviewer.role;
        } else if (sample.currentStatus === 'tested') {
          stageStatus = 'current';
        }
      } else if (transfer) {
        stageStatus = stageKey === currentStageKey ? 'current' : 'completed';
        timestamp = transfer.operatedAt;
        const operator = getUserInfo(userMap, transfer.operatorId);
        operatorName = operator.name;
        operatorRole = operator.role;
        location = transfer.toLocationId ? getLocationCode(locationMap, transfer.toLocationId) : undefined;
        remark = transfer.remark;
        testResult = transfer.testResult;
      }

      const failedAttempts = sortedFailed.filter(
        (f) => f.attemptedType === transferType
      );
      if (failedAttempts.length > 0 && stageStatus === 'pending') {
        stageStatus = 'failed';
      }

      const rolledBackTransfers = sortedTransfers.filter(
        (t) => t.type === transferType && t.isRolledBack
      );
      const hasValidTransfer = sortedTransfers.some(
        (t) => t.type === transferType && !t.isRolledBack
      );
      const latestRolledBack = rolledBackTransfers[rolledBackTransfers.length - 1];

      if (stageStatus === 'pending' && latestRolledBack && !hasValidTransfer) {
        stageStatus = 'rolled_back';
      }

      stages.push({
        key: stageKey as FlowTraceStageKey,
        label: stageLabel,
        status: stageStatus,
        timestamp,
        operatorName,
        operatorRole,
        location,
        remark,
        testResult,
        isRolledBack: !hasValidTransfer && !!latestRolledBack,
        rollbackReason: latestRolledBack?.rollbackReason,
      });
    }

    return stages;
  };

  const buildLatestValidTransfer = (): FlowTraceDetailData['latestValidTransfer'] => {
    const validTransfers = sortedTransfers.filter(
      (t) => t.type !== 'rollback' && !t.isRolledBack
    );
    if (validTransfers.length === 0) return null;

    const latest = validTransfers[validTransfers.length - 1];
    const operator = getUserInfo(userMap, latest.operatorId);

    return {
      type: latest.type,
      timestamp: latest.operatedAt,
      operatorName: operator.name,
      fromStatus: latest.fromStatus,
      toStatus: latest.toStatus,
      fromLocation: latest.fromLocationId ? getLocationCode(locationMap, latest.fromLocationId) : undefined,
      toLocation: latest.toLocationId ? getLocationCode(locationMap, latest.toLocationId) : undefined,
      remark: latest.remark,
    };
  };

  const buildBlockedOperations = (): FlowTraceDetailData['blockedOperations'] => {
    return sortedFailed.map((f) => {
      const attemptor = getUserInfo(userMap, f.attemptedBy);
      return {
        id: f.id,
        attemptedType: f.attemptedType,
        attemptedAt: f.attemptedAt,
        attemptedByName: attemptor.name,
        errorCode: f.errorCode,
        errorMessage: f.errorMessage,
        errorCategory: getErrorCategory(f.errorCode),
        resolved: f.resolved,
      };
    });
  };

  const buildRollbackHistory = (): FlowTraceDetailData['rollbackHistory'] => {
    const rollbackTransfers = sortedTransfers.filter((t) => t.type === 'rollback');

    return rollbackTransfers.map((t) => {
      const rollbackInfo = getUserInfo(userMap, t.operatorId);
      const rolledBackRecordId = t.remark?.match(/回退交接记录: (\w+)/)?.[1];
      const rolledBackRecord = rolledBackRecordId
        ? sortedTransfers.find((st) => st.id === rolledBackRecordId)
        : null;
      const reason = rolledBackRecord?.rollbackReason
        || t.remark?.match(/原因: (.+)$/)?.[1]
        || '';

      const rolledBackStage = rolledBackRecord
        ? (STATUS_TO_STAGE[rolledBackRecord.toStatus] || 'import')
        : 'import';
      const landingStage = STATUS_TO_STAGE[t.toStatus] || 'import';

      return {
        id: t.id,
        rollbackAt: t.operatedAt,
        rollbackByName: rollbackInfo.name,
        reason,
        rolledBackStage: rolledBackStage as FlowTraceStageKey,
        rolledBackTransferType: rolledBackRecord?.type || 'import',
        fromStatus: t.fromStatus || 'imported',
        toStatus: t.toStatus,
        landingStage: landingStage as FlowTraceStageKey,
      };
    });
  };

  const buildFullTimeline = (): FlowTraceDetailData['fullTimeline'] => {
    const timeline: FlowTraceDetailData['fullTimeline'] = [];

    for (const transfer of sortedTransfers) {
      const operator = getUserInfo(userMap, transfer.operatorId);
      const stageKey = transfer.type === 'rollback'
        ? 'rollback'
        : (STATUS_TO_STAGE[transfer.toStatus] || 'import');

      timeline.push({
        id: transfer.id,
        type: transfer.type === 'rollback' ? 'rollback' : 'transfer',
        timestamp: transfer.operatedAt,
        stageKey: stageKey as FlowTraceStageKey,
        actionLabel: TRANSFER_TYPE_LABELS[transfer.type],
        operatorName: operator.name,
        operatorRole: operator.role,
        status: transfer.fromStatus
          ? `${STATUS_LABELS[transfer.fromStatus]} → ${STATUS_LABELS[transfer.toStatus]}`
          : STATUS_LABELS[transfer.toStatus],
        location:
          transfer.fromLocationId || transfer.toLocationId
            ? `${getLocationCode(locationMap, transfer.fromLocationId)} → ${getLocationCode(locationMap, transfer.toLocationId)}`
            : undefined,
        holder:
          transfer.fromHolderId || transfer.toHolderId
            ? `${getUserInfo(userMap, transfer.fromHolderId).name} → ${getUserInfo(userMap, transfer.toHolderId).name}`
            : undefined,
        testResult: transfer.testResult,
        remark: transfer.remark,
        isRolledBack: transfer.isRolledBack,
        rollbackReason: transfer.rollbackReason,
        rollbackBy: transfer.rolledBackBy ? getUserInfo(userMap, transfer.rolledBackBy).name : undefined,
      });
    }

    if (sample.reviewedBy && sample.reviewedAt) {
      const reviewer = getUserInfo(userMap, sample.reviewedBy);
      timeline.push({
        id: `review-${sample.id}`,
        type: 'review',
        timestamp: sample.reviewedAt,
        stageKey: 'review',
        actionLabel: '样本复核',
        operatorName: reviewer.name,
        operatorRole: reviewer.role,
        status: `${STATUS_LABELS.tested} → 已复核`,
      });
    }

    for (const failed of sortedFailed) {
      const attemptor = getUserInfo(userMap, failed.attemptedBy);
      const stageKey = STATUS_TO_STAGE[failed.attemptedType === 'import' ? 'imported' : failed.attemptedType] || 'import';

      timeline.push({
        id: `failed-${failed.id}`,
        type: 'failed',
        timestamp: failed.attemptedAt,
        stageKey: stageKey as FlowTraceStageKey,
        actionLabel: `失败: ${TRANSFER_TYPE_LABELS[failed.attemptedType]}`,
        operatorName: attemptor.name,
        operatorRole: attemptor.role,
        errorCode: failed.errorCode,
        errorMessage: failed.errorMessage,
        errorCategory: getErrorCategory(failed.errorCode),
      });
    }

    timeline.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return timeline;
  };

  const buildSummary = (): FlowTraceDetailData['summary'] => {
    const validTransfers = sortedTransfers.filter(
      (t) => !t.isRolledBack && t.type !== 'rollback'
    );
    const rollbackTransfers = sortedTransfers.filter((t) => t.type === 'rollback');
    const archiveTransfers = sortedTransfers.filter((t) => t.type === 'archive');

    const lastValid = validTransfers.length > 0
      ? validTransfers[validTransfers.length - 1]
      : null;
    const lastRollback = rollbackTransfers.length > 0
      ? rollbackTransfers[rollbackTransfers.length - 1]
      : null;
    const lastFailed = sortedFailed.length > 0 ? sortedFailed[sortedFailed.length - 1] : null;

    const currentStageLabel = FLOW_TRACE_STAGE_LABELS[sample.currentStatus === 'tested' && sample.reviewedBy
      ? 'review'
      : STATUS_TO_STAGE[sample.currentStatus] || 'import'] || STATUS_LABELS[sample.currentStatus];

    const lastEventTime = lastValid?.operatedAt || sample.createdAt;
    const daysInCurrentStage = Math.floor(
      (Date.now() - new Date(lastEventTime).getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      totalTransfers: sortedTransfers.length,
      validTransfers: validTransfers.length,
      failedAttempts: sortedFailed.length,
      rollbackCount: rollbackTransfers.length,
      archiveAttempts: archiveTransfers.length,
      lastValidTransferAt: lastValid?.operatedAt,
      lastRollbackAt: lastRollback?.operatedAt,
      lastFailedAt: lastFailed?.attemptedAt,
      currentStageLabel,
      daysInCurrentStage,
    };
  };

  let isLocked = false;
  let lockReason: string | undefined;

  if (sample.isArchived) {
    isLocked = true;
    lockReason = '样本已归档，所有操作被锁定';
  }

  const allUsersForInfo = getUsers();
  const allLocationsForInfo = getLocations();
  const userMapFinal = buildUserMap(allUsersForInfo);
  const locationMapFinal = buildLocationMap(allLocationsForInfo);
  const archiveTransfer = sortedTransfers.find((t) => t.type === 'archive') || null;
  const archivedByUser = archiveTransfer ? getUserInfo(userMapFinal, archiveTransfer.operatorId) : null;
  const reviewedByUser = sample.reviewedBy ? getUserInfo(userMapFinal, sample.reviewedBy) : null;

  return {
    sample: {
      id: sample.id,
      sampleNo: sample.sampleNo,
      type: sample.type,
      batchId: sample.batchId,
      batchNo: batch?.batchNo || '-',
      currentStatus: sample.currentStatus,
      currentLocation: sample.currentLocationId ? getLocationCode(locationMapFinal, sample.currentLocationId) : undefined,
      currentHolder: sample.currentHolderId ? getUserInfo(userMapFinal, sample.currentHolderId).name : undefined,
      isArchived: sample.isArchived,
      archivedAt: sample.archivedAt,
      archivedBy: archivedByUser?.name,
      reviewedBy: reviewedByUser?.name,
      reviewedAt: sample.reviewedAt,
      isLocked,
      lockReason,
      collectedAt: sample.collectedAt,
      collectedBy: sample.collectedBy,
      description: sample.description,
    },
    businessChain: buildBusinessChain(),
    latestValidTransfer: buildLatestValidTransfer(),
    blockedOperations: buildBlockedOperations(),
    rollbackHistory: buildRollbackHistory(),
    fullTimeline: buildFullTimeline(),
    summary: buildSummary(),
  };
};

export const exportFlowTraceData = (
  sampleId: string,
  options: FlowTraceExportOptions
): string => {
  const detail = getFlowTraceData(sampleId);
  if (!detail) return '';

  const { format, includeBusinessChain = true, includeFullTimeline = true, includeBlockedOps = true, includeRollbackHistory = true, includeSummary = true } = options;

  if (format === 'json') {
    const exportObj: Record<string, unknown> = {
      exportedAt: nowISO(),
      exportType: '流转追溯记录',
      sample: detail.sample,
    };

    if (includeSummary) exportObj.summary = detail.summary;
    if (includeBusinessChain) exportObj.businessChain = detail.businessChain;
    if (detail.latestValidTransfer) exportObj.latestValidTransfer = detail.latestValidTransfer;
    if (includeBlockedOps) exportObj.blockedOperations = detail.blockedOperations;
    if (includeRollbackHistory) exportObj.rollbackHistory = detail.rollbackHistory;
    if (includeFullTimeline) exportObj.fullTimeline = detail.fullTimeline;

    return JSON.stringify(exportObj, null, 2);
  }

  const csvRows: string[][] = [];

  csvRows.push(['=== 样本流转追溯记录 ===']);
  csvRows.push(['导出时间', new Date().toLocaleString('zh-CN')]);
  csvRows.push([]);

  csvRows.push(['=== 样本基本信息 ===']);
  csvRows.push(['样本编号', detail.sample.sampleNo]);
  csvRows.push(['样本类型', detail.sample.type]);
  csvRows.push(['批次号', detail.sample.batchNo]);
  csvRows.push(['当前状态', detail.sample.currentStatus]);
  csvRows.push(['当前库位', detail.sample.currentLocation || '-']);
  csvRows.push(['当前持有人', detail.sample.currentHolder || '-']);
  csvRows.push(['是否归档', detail.sample.isArchived ? '是' : '否']);
  if (detail.sample.archivedAt) csvRows.push(['归档时间', detail.sample.archivedAt]);
  if (detail.sample.archivedBy) csvRows.push(['归档人', detail.sample.archivedBy]);
  if (detail.sample.reviewedAt) csvRows.push(['复核时间', detail.sample.reviewedAt]);
  if (detail.sample.reviewedBy) csvRows.push(['复核人', detail.sample.reviewedBy]);
  csvRows.push(['是否锁定', detail.sample.isLocked ? '是' : '否']);
  if (detail.sample.lockReason) csvRows.push(['锁定原因', detail.sample.lockReason]);
  csvRows.push(['采集时间', detail.sample.collectedAt]);
  csvRows.push(['采集人', detail.sample.collectedBy]);
  if (detail.sample.description) csvRows.push(['描述', detail.sample.description]);
  csvRows.push([]);

  if (includeSummary) {
    csvRows.push(['=== 统计摘要 ===']);
    csvRows.push(['总流转次数', String(detail.summary.totalTransfers)]);
    csvRows.push(['有效流转次数', String(detail.summary.validTransfers)]);
    csvRows.push(['失败尝试次数', String(detail.summary.failedAttempts)]);
    csvRows.push(['回退次数', String(detail.summary.rollbackCount)]);
    csvRows.push(['归档尝试次数', String(detail.summary.archiveAttempts)]);
    if (detail.summary.lastValidTransferAt) csvRows.push(['最后有效流转时间', detail.summary.lastValidTransferAt]);
    if (detail.summary.lastRollbackAt) csvRows.push(['最后回退时间', detail.summary.lastRollbackAt]);
    csvRows.push(['当前阶段', detail.summary.currentStageLabel]);
    csvRows.push(['当前阶段天数', String(detail.summary.daysInCurrentStage)]);
    csvRows.push([]);
  }

  if (includeBusinessChain && detail.businessChain.length > 0) {
    csvRows.push(['=== 业务流转链 ===']);
    csvRows.push(['阶段', '标签', '状态', '时间', '操作人', '角色', '库位', '检测结果', '备注']);
    for (const stage of detail.businessChain) {
      csvRows.push([
        stage.key,
        stage.label,
        stage.status,
        stage.timestamp || '',
        stage.operatorName || '',
        stage.operatorRole || '',
        stage.location || '',
        stage.testResult || '',
        stage.remark || '',
      ]);
    }
    csvRows.push([]);
  }

  if (includeFullTimeline && detail.fullTimeline.length > 0) {
    csvRows.push(['=== 完整时间线 ===']);
    csvRows.push(['时间', '类型', '操作', '操作人', '角色', '状态变更', '库位变更', '持有人变更', '检测结果', '备注', '是否回退', '回退原因', '错误码', '错误信息']);
    for (const item of detail.fullTimeline) {
      csvRows.push([
        item.timestamp,
        item.type,
        item.actionLabel,
        item.operatorName,
        item.operatorRole,
        item.status || '',
        item.location || '',
        item.holder || '',
        item.testResult || '',
        item.remark || '',
        item.isRolledBack ? '是' : '否',
        item.rollbackReason || '',
        item.errorCode || '',
        item.errorMessage || '',
      ]);
    }
    csvRows.push([]);
  }

  if (includeBlockedOps && detail.blockedOperations.length > 0) {
    csvRows.push(['=== 受阻操作记录 ===']);
    csvRows.push(['时间', '操作类型', '尝试人', '错误码', '错误信息', '错误分类', '是否解决']);
    for (const op of detail.blockedOperations) {
      csvRows.push([
        op.attemptedAt,
        op.attemptedType,
        op.attemptedByName,
        op.errorCode,
        op.errorMessage,
        op.errorCategory,
        op.resolved ? '是' : '否',
      ]);
    }
    csvRows.push([]);
  }

  if (includeRollbackHistory && detail.rollbackHistory.length > 0) {
    csvRows.push(['=== 回退历史 ===']);
    csvRows.push(['回退时间', '回退人', '回退原因', '被回退操作', '从状态', '到状态', '落地阶段']);
    for (const r of detail.rollbackHistory) {
      csvRows.push([
        r.rollbackAt,
        r.rollbackByName,
        r.reason,
        r.rolledBackTransferType,
        r.fromStatus,
        r.toStatus,
        r.landingStage,
      ]);
    }
  }

  return Papa.unparse(csvRows);
};
