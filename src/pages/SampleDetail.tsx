import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  FlaskConical,
  MapPin,
  User,
  Calendar,
  FileText,
  CheckCircle2,
  RotateCcw,
  Clock,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';
import { TRANSFER_TYPE_LABELS, TRANSFER_TYPE_COLORS, ROLE_LABELS } from '@shared/constants';
import type { TransferRecord } from '@shared/types';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN');
};

export const SampleDetail = () => {
  const { id } = useParams<{ id: string }>();
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getLocationById = useAppStore((s) => s.getLocationById);
  const getUserById = useAppStore((s) => s.getUserById);
  const getBatchById = (batchId: string) =>
    useAppStore.getState().batches.find((b) => b.id === batchId);
  const getTransferRecordsBySample = useAppStore((s) => s.getTransferRecordsBySample);
  const batches = useAppStore((s) => s.batches);
  const getAllBatches = useAppStore((s) => s.getAllBatches);

  const [transfers, setTransfers] = useState<TransferRecord[]>([]);

  const sample = id ? getSampleById(id) : undefined;
  const batch = sample ? getBatchById(sample.batchId) : undefined;
  const location = sample?.currentLocationId ? getLocationById(sample.currentLocationId) : null;
  const holder = sample?.currentHolderId ? getUserById(sample.currentHolderId) : null;
  const reviewer = sample?.reviewedBy ? getUserById(sample.reviewedBy) : null;
  const importedBy = batch?.importedBy ? getUserById(batch.importedBy) : null;

  useEffect(() => {
    getAllBatches();
    if (id) {
      getTransferRecordsBySample(id).then(setTransfers);
    }
  }, [id, getTransferRecordsBySample, getAllBatches]);

  if (!sample) {
    return (
      <div className="space-y-4">
        <Link to="/samples" className="text-slate-500 hover:text-slate-700 flex items-center text-sm">
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回列表
        </Link>
        <div className="glass-card p-12 text-center">
          <FlaskConical className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500">样本不存在</p>
        </div>
      </div>
    );
  }

  const infoItems = [
    { icon: <MapPin className="w-4 h-4" />, label: '当前库位', value: location ? `${location.code} - ${location.name}` : '未在库' },
    { icon: <User className="w-4 h-4" />, label: '当前持有人', value: holder?.displayName || '-' },
    { icon: <Calendar className="w-4 h-4" />, label: '采集时间', value: formatDate(sample.collectedAt) },
    { icon: <User className="w-4 h-4" />, label: '采集人员', value: sample.collectedBy },
    { icon: <FileText className="w-4 h-4" />, label: '所属批次', value: batch?.batchNo || '-' },
    { icon: <User className="w-4 h-4" />, label: '导入人', value: importedBy?.displayName || '-' },
    { icon: <CheckCircle2 className="w-4 h-4" />, label: '复核状态', value: sample.reviewedBy ? `已复核（${reviewer?.displayName || ''}·${formatDate(sample.reviewedAt!)}）` : '未复核' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/samples" className="text-slate-500 hover:text-slate-700 flex items-center text-sm">
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回列表
        </Link>
      </div>

      <div className="glass-card p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-slate-900 font-serif">{sample.sampleNo}</h1>
              <StatusBadge status={sample.currentStatus} />
              {sample.isArchived && (
                <span className="badge bg-emerald-100 text-emerald-700 border-emerald-200">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  已归档
                </span>
              )}
            </div>
            <p className="text-slate-500">{sample.type}{sample.description && ` · ${sample.description}`}</p>
          </div>
          <div className="text-sm text-slate-500">
            <div>创建时间：{formatDate(sample.createdAt)}</div>
            <div>更新时间：{formatDate(sample.updatedAt)}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {infoItems.map((item) => (
            <div key={item.label} className="p-4 rounded-lg bg-slate-50">
              <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
                {item.icon}
                {item.label}
              </div>
              <p className="text-sm font-medium text-slate-900">{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="glass-card p-6">
        <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-slate-500" />
          流转时间线
        </h2>

        <div className="relative pl-6">
          <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-slate-200" />
          {transfers.length === 0 ? (
            <p className="text-slate-500 text-sm py-4">暂无流转记录</p>
          ) : (
            <div className="space-y-6">
              {transfers.map((transfer, idx) => {
                const operator = getUserById(transfer.operatorId);
                const rolledBy = transfer.rolledBackBy ? getUserById(transfer.rolledBackBy) : null;
                const isLast = idx === transfers.length - 1;
                return (
                  <div key={transfer.id} className="relative">
                    <div
                      className={`absolute -left-[22px] top-1 w-4 h-4 rounded-full border-2 ${
                        transfer.type === 'rollback'
                          ? 'bg-rose-100 border-rose-500'
                          : transfer.isRolledBack
                          ? 'bg-slate-200 border-slate-400'
                          : 'bg-white border-brand-500'
                      }`}
                    />
                    <div
                      className={`p-4 rounded-lg border ${
                        transfer.type === 'rollback'
                          ? 'bg-rose-50 border-rose-200'
                          : transfer.isRolledBack
                          ? 'bg-slate-50 border-slate-200 opacity-60'
                          : 'bg-white border-slate-200'
                      } ${isLast ? 'ring-2 ring-brand-100 border-brand-200' : ''}`}
                    >
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${TRANSFER_TYPE_COLORS[transfer.type]}`}
                        >
                          {TRANSFER_TYPE_LABELS[transfer.type]}
                        </span>
                        {transfer.isRolledBack && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">
                            <RotateCcw className="w-3 h-3 mr-1" />
                            已回退
                          </span>
                        )}
                        <span className="text-xs text-slate-500">
                          {formatDate(transfer.operatedAt)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-slate-500">操作人</p>
                          <p className="text-slate-900">{operator?.displayName || '-'}</p>
                        </div>
                        <div>
                          <p className="text-xs text-slate-500">状态变更</p>
                          <p className="text-slate-900">
                            {transfer.fromStatus ? `${transfer.fromStatus} → ` : ''}
                            {transfer.toStatus}
                          </p>
                        </div>
                        {transfer.fromLocationId || transfer.toLocationId ? (
                          <div>
                            <p className="text-xs text-slate-500">库位变更</p>
                            <p className="text-slate-900">
                              {transfer.fromLocationId
                                ? `${getLocationById(transfer.fromLocationId)?.code || '-'} → `
                                : ''}
                              {transfer.toLocationId ? getLocationById(transfer.toLocationId)?.code : '-'}
                            </p>
                          </div>
                        ) : null}
                        {transfer.fromHolderId || transfer.toHolderId ? (
                          <div>
                            <p className="text-xs text-slate-500">持有人变更</p>
                            <p className="text-slate-900">
                              {transfer.fromHolderId
                                ? `${getUserById(transfer.fromHolderId)?.displayName || '-'} → `
                                : ''}
                              {transfer.toHolderId ? getUserById(transfer.toHolderId)?.displayName : '-'}
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {transfer.testResult && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-xs text-slate-500">检测结果</p>
                          <p className="text-sm text-slate-900">{transfer.testResult}</p>
                        </div>
                      )}

                      {transfer.remark && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-xs text-slate-500">备注</p>
                          <p className="text-sm text-slate-900">{transfer.remark}</p>
                        </div>
                      )}

                      {transfer.isRolledBack && transfer.rollbackReason && (
                        <div className="mt-2 pt-2 border-t border-rose-100">
                          <p className="text-xs text-rose-500">回退原因（{rolledBy?.displayName || ''}·{transfer.rolledBackAt ? formatDate(transfer.rolledBackAt) : ''}）</p>
                          <p className="text-sm text-rose-700">{transfer.rollbackReason}</p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
