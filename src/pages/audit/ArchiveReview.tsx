import { useEffect, useState } from 'react';
import {
  Search,
  Clock,
  Lock,
  Unlock,
  FileText,
  Download,
  FileJson,
  FileSpreadsheet,
  RotateCcw,
  XCircle,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  ArrowRight,
  User,
  MapPin,
  FlaskConical,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Modal } from '@/components/common/Modal';
import { hasPermission } from '@/services/permissionService';
import {
  TRANSFER_TYPE_LABELS,
  TRANSFER_TYPE_COLORS,
  STATUS_LABELS,
  ROLE_LABELS,
  ERROR_CODES,
} from '@shared/constants';
import type {
  ArchiveReviewData,
  ArchiveReviewTimelineItem,
  ArchiveReviewExportOptions,
} from '@shared/types';

const formatDate = (iso: string) => new Date(iso).toLocaleString('zh-CN');

const ERROR_CODE_LABELS: Record<string, string> = {
  [ERROR_CODES.DUPLICATE_SAMPLE_NO]: '样本编号重复',
  [ERROR_CODES.INVALID_STATUS_TRANSITION]: '状态流转无效',
  [ERROR_CODES.WRONG_SOURCE_LOCATION]: '源库位错误',
  [ERROR_CODES.INSUFFICIENT_PERMISSION]: '权限不足',
  [ERROR_CODES.SAMPLE_ALREADY_ARCHIVED]: '样本已归档',
  [ERROR_CODES.SAMPLE_NOT_REVIEWED]: '样本未复核',
  [ERROR_CODES.TRANSFER_NOT_FOUND]: '交接记录不存在',
  [ERROR_CODES.TRANSFER_ALREADY_ROLLED_BACK]: '已被回退',
  [ERROR_CODES.INVALID_TARGET_LOCATION]: '目标库位无效',
  [ERROR_CODES.LOCATION_FULL]: '库位已满',
  [ERROR_CODES.INVALID_HOLDER]: '持有人无效',
  [ERROR_CODES.MISSING_REQUIRED_FIELD]: '缺少必填字段',
  [ERROR_CODES.INVALID_DATE_FORMAT]: '日期格式无效',
};

export const ArchiveReview = () => {
  const samples = useAppStore((s) => s.samples);
  const currentUser = useAppStore((s) => s.currentUser);
  const getAllSamples = useAppStore((s) => s.getAllSamples);
  const getArchiveReviewData = useAppStore((s) => s.getArchiveReviewData);
  const exportArchiveReviewData = useAppStore((s) => s.exportArchiveReviewData);

  const [sampleFilter, setSampleFilter] = useState('');
  const [selectedSampleId, setSelectedSampleId] = useState('');
  const [reviewData, setReviewData] = useState<ArchiveReviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('csv');
  const [exportSuccess, setExportSuccess] = useState(false);

  const canView = hasPermission(currentUser, 'archive:review').allowed;
  const canExport = hasPermission(currentUser, 'archive:reviewExport').allowed;

  useEffect(() => {
    getAllSamples();
  }, [getAllSamples]);

  const archivedSamples = samples.filter((s) => s.isArchived);

  const filteredSamples = archivedSamples.filter((s) =>
    s.sampleNo.toLowerCase().includes(sampleFilter.toLowerCase())
  );

  const loadReviewData = async (sampleId: string) => {
    if (!sampleId) {
      setReviewData(null);
      return;
    }
    setLoading(true);
    try {
      const data = await getArchiveReviewData(sampleId);
      setReviewData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedSampleId) {
      loadReviewData(selectedSampleId);
    }
  }, [selectedSampleId]);

  const handleExport = async () => {
    if (!reviewData || !canExport) return;

    setExportLoading(true);
    setExportSuccess(false);

    try {
      const options: ArchiveReviewExportOptions = {
        format: exportFormat,
        includeFullTimeline: true,
        includeFailedRecords: true,
        includeRollbackRecords: true,
      };

      const data = await exportArchiveReviewData(reviewData.sample.id, options);
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `archive_review_${reviewData.sample.sampleNo}_${timestamp}.${exportFormat}`;

      let blob: Blob;
      let mimeType: string;

      if (exportFormat === 'json') {
        blob = new Blob([data as string], { type: 'application/json' });
        mimeType = 'application/json';
      } else {
        const bom = '\uFEFF';
        blob = new Blob([bom + (data as string)], { type: 'text/csv;charset=utf-8' });
        mimeType = 'text/csv;charset=utf-8';
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setExportLoading(false);
    }
  };

  const getTimelineItemIcon = (item: ArchiveReviewTimelineItem) => {
    switch (item.type) {
      case 'transfer':
        return <ArrowRight className="w-4 h-4" />;
      case 'rollback':
        return <RotateCcw className="w-4 h-4" />;
      case 'failed':
        return <XCircle className="w-4 h-4" />;
      case 'review':
        return <ShieldCheck className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getTimelineItemColor = (item: ArchiveReviewTimelineItem) => {
    if (item.type === 'failed') return 'bg-rose-100 border-rose-300 text-rose-700';
    if (item.type === 'rollback') return 'bg-amber-100 border-amber-300 text-amber-700';
    if (item.type === 'review') return 'bg-blue-100 border-blue-300 text-blue-700';
    if (item.isRolledBack) return 'bg-slate-100 border-slate-300 text-slate-500 opacity-60';
    return 'bg-emerald-100 border-emerald-300 text-emerald-700';
  };

  if (!canView) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 font-serif">归档后复盘</h1>
          <p className="text-slate-500 mt-1">查看归档样本的完整流转链路和审计记录</p>
        </div>
        <div className="glass-card p-12 text-center">
          <Lock className="w-16 h-16 text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500">您没有权限访问此页面</p>
          <p className="text-sm text-slate-400 mt-2">此功能仅限审核员和管理员使用</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">归档后复盘</h1>
        <p className="text-slate-500 mt-1">按样本查看归档前后的完整流转链路、失败交接、回退原因和锁定状态</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <FlaskConical className="w-5 h-5 text-slate-500" />
              <span className="font-medium text-slate-900">选择归档样本</span>
              <span className="ml-auto text-xs text-slate-500">共 {archivedSamples.length} 个</span>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={sampleFilter}
                onChange={(e) => setSampleFilter(e.target.value)}
                className="input-field pl-8 text-sm"
                placeholder="搜索样本编号..."
              />
            </div>

            <div className="max-h-[500px] overflow-y-auto space-y-2">
              {filteredSamples.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  {sampleFilter ? '未找到匹配的样本' : '暂无归档样本'}
                </div>
              ) : (
                filteredSamples.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedSampleId(s.id)}
                    className={`w-full text-left p-3 rounded-lg border transition-all ${
                      selectedSampleId === s.id
                        ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-100'
                        : 'border-slate-200 hover:border-brand-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-sm font-medium text-slate-900">{s.sampleNo}</span>
                      <StatusBadge status={s.currentStatus} />
                    </div>
                    <div className="text-xs text-slate-500">{s.type}</div>
                    {s.archivedAt && (
                      <div className="text-xs text-slate-400 mt-1">
                        归档于 {formatDate(s.archivedAt)}
                      </div>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {!selectedSampleId ? (
            <div className="glass-card p-12 text-center">
              <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <p className="text-slate-500">请从左侧选择一个归档样本查看复盘详情</p>
            </div>
          ) : loading ? (
            <div className="glass-card p-12 text-center">
              <Loader2 className="w-8 h-8 text-brand-500 mx-auto mb-4 animate-spin" />
              <p className="text-slate-500">加载复盘数据中...</p>
            </div>
          ) : !reviewData ? (
            <div className="glass-card p-12 text-center">
              <AlertTriangle className="w-16 h-16 text-amber-400 mx-auto mb-4" />
              <p className="text-slate-500">未能加载复盘数据</p>
            </div>
          ) : (
            <>
              <div className="glass-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-bold text-slate-900 font-serif">
                        {reviewData.sample.sampleNo}
                      </h2>
                      <StatusBadge status={reviewData.sample.currentStatus} />
                      {reviewData.sample.isLocked ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 border border-rose-200">
                          <Lock className="w-3 h-3" />
                          已锁定
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 border border-emerald-200">
                          <Unlock className="w-3 h-3" />
                          未锁定
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 text-sm">{reviewData.sample.type}</p>
                    {reviewData.sample.lockReason && (
                      <p className="text-xs text-rose-600 mt-2 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {reviewData.sample.lockReason}
                      </p>
                    )}
                  </div>

                  {canExport && (
                    <button
                      onClick={() => setShowExportModal(true)}
                      className="btn-primary text-sm flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      导出审计结果
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="p-3 rounded-lg bg-slate-50">
                    <div className="text-xs text-slate-500 mb-1">总流转次数</div>
                    <div className="text-xl font-bold text-slate-900">{reviewData.summary.totalTransfers}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-50">
                    <div className="text-xs text-emerald-600 mb-1">成功流转</div>
                    <div className="text-xl font-bold text-emerald-700">{reviewData.summary.successfulTransfers}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-rose-50">
                    <div className="text-xs text-rose-600 mb-1">失败尝试</div>
                    <div className="text-xl font-bold text-rose-700">{reviewData.summary.failedAttempts}</div>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50">
                    <div className="text-xs text-amber-600 mb-1">回退次数</div>
                    <div className="text-xl font-bold text-amber-700">{reviewData.summary.rollbackCount}</div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  {reviewData.sample.archivedAt && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-slate-500">归档时间：</span>
                      <span className="font-medium">{formatDate(reviewData.sample.archivedAt)}</span>
                      <span className="text-slate-400">({reviewData.sample.archivedBy})</span>
                    </div>
                  )}
                  {reviewData.sample.reviewedAt && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      <span className="text-slate-500">复核时间：</span>
                      <span className="font-medium">{formatDate(reviewData.sample.reviewedAt)}</span>
                      <span className="text-slate-400">({reviewData.sample.reviewedBy})</span>
                    </div>
                  )}
                  {reviewData.summary.lastArchiveAt && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span className="text-slate-500">最后归档：</span>
                      <span>{formatDate(reviewData.summary.lastArchiveAt)}</span>
                    </div>
                  )}
                  {reviewData.summary.lastRollbackAt && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <RotateCcw className="w-4 h-4 text-amber-400" />
                      <span className="text-slate-500">最后回退：</span>
                      <span>{formatDate(reviewData.summary.lastRollbackAt)}</span>
                    </div>
                  )}
                </div>
              </div>

              {reviewData.rollbackRecords.length > 0 && (
                <div className="glass-card p-6 border-amber-200 bg-amber-50/30">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-amber-500" />
                    回退记录
                  </h3>
                  <div className="space-y-3">
                    {reviewData.rollbackRecords.map((r) => (
                      <div key={r.id} className="p-4 rounded-lg bg-white border border-amber-200">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${TRANSFER_TYPE_COLORS[r.rolledBackTransferType]}`}>
                            {TRANSFER_TYPE_LABELS[r.rolledBackTransferType]}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDate(r.rollbackAt)}
                          </span>
                          <span className="text-xs text-slate-600 ml-auto">
                            操作人：{r.rollbackByName}
                          </span>
                        </div>
                        <div className="text-sm text-slate-700 mb-2">
                          <span className="text-slate-500">状态变更：</span>
                          <span className="font-medium">
                            {STATUS_LABELS[r.fromStatus]} → {STATUS_LABELS[r.toStatus]}
                          </span>
                        </div>
                        <div className="text-sm text-amber-700 bg-amber-50 p-2 rounded">
                          <span className="font-medium">回退原因：</span>{r.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {reviewData.failedTransfers.length > 0 && (
                <div className="glass-card p-6 border-rose-200 bg-rose-50/30">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <XCircle className="w-5 h-5 text-rose-500" />
                    失败交接记录
                  </h3>
                  <div className="space-y-3">
                    {reviewData.failedTransfers.map((f) => (
                      <div key={f.id} className="p-4 rounded-lg bg-white border border-rose-200">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${TRANSFER_TYPE_COLORS[f.attemptedType]}`}>
                            尝试: {TRANSFER_TYPE_LABELS[f.attemptedType]}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDate(f.attemptedAt)}
                          </span>
                          <span className="text-xs text-slate-600 ml-auto">
                            尝试人：{f.attemptedByName}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2">
                          <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-100 text-rose-700 border border-rose-200">
                            {f.errorCode}
                          </span>
                          <span className="text-xs text-slate-600">
                            {ERROR_CODE_LABELS[f.errorCode] || f.errorCode}
                          </span>
                        </div>
                        <div className="text-sm text-rose-700">{f.errorMessage}</div>
                        {f.resolved && (
                          <div className="mt-2 text-xs text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            已解决
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass-card p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-slate-500" />
                  完整时间线（归档前后）
                </h3>

                <div className="relative pl-6">
                  <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-slate-200" />
                  <div className="space-y-5">
                    {reviewData.timeline.map((item, idx) => {
                      const isLast = idx === reviewData.timeline.length - 1;
                      return (
                        <div key={item.id} className="relative">
                          <div
                            className={`absolute -left-[22px] top-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                              item.type === 'failed'
                                ? 'bg-rose-100 border-rose-400'
                                : item.type === 'rollback'
                                ? 'bg-amber-100 border-amber-400'
                                : item.type === 'review'
                                ? 'bg-blue-100 border-blue-400'
                                : item.isRolledBack
                                ? 'bg-slate-200 border-slate-400'
                                : 'bg-emerald-100 border-emerald-400'
                            }`}
                          >
                            {getTimelineItemIcon(item)}
                          </div>
                          <div
                            className={`p-4 rounded-lg border ${
                              isLast ? 'ring-2 ring-brand-100 border-brand-200' : ''
                            } ${
                              item.type === 'failed'
                                ? 'bg-rose-50 border-rose-200'
                                : item.type === 'rollback'
                                ? 'bg-amber-50 border-amber-200'
                                : item.type === 'review'
                                ? 'bg-blue-50 border-blue-200'
                                : item.isRolledBack
                                ? 'bg-slate-50 border-slate-200 opacity-60'
                                : 'bg-white border-slate-200'
                            }`}
                          >
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getTimelineItemColor(item)}`}
                              >
                                {item.action}
                              </span>
                              {item.isRolledBack && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">
                                  <RotateCcw className="w-3 h-3" />
                                  已回退
                                </span>
                              )}
                              <span className="text-xs text-slate-400 ml-auto">
                                {formatDate(item.timestamp)}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-3 text-sm mb-2">
                              <div className="flex items-center gap-1 text-slate-600">
                                <User className="w-3.5 h-3.5 text-slate-400" />
                                <span>{item.operatorName}</span>
                                <span className="text-xs text-slate-400">
                                  ({ROLE_LABELS[item.operatorRole as keyof typeof ROLE_LABELS] || item.operatorRole})
                                </span>
                              </div>
                              {item.status && (
                                <div className="flex items-center gap-1 text-slate-600">
                                  <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                                  <span>{item.status}</span>
                                </div>
                              )}
                            </div>

                            {item.location && item.location !== '- → -' && (
                              <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                                <MapPin className="w-3 h-3" />
                                库位：{item.location}
                              </div>
                            )}

                            {item.holder && item.holder !== '- → -' && (
                              <div className="flex items-center gap-1 text-xs text-slate-500 mb-1">
                                <User className="w-3 h-3" />
                                持有人：{item.holder}
                              </div>
                            )}

                            {item.testResult && (
                              <div className="text-xs text-violet-600 bg-violet-50 px-2 py-1 rounded inline-block mt-1">
                                检测结果：{item.testResult}
                              </div>
                            )}

                            {item.remark && (
                              <div className="text-xs text-slate-600 bg-slate-50 px-2 py-1 rounded mt-2">
                                备注：{item.remark}
                              </div>
                            )}

                            {item.rollbackReason && (
                              <div className="text-xs text-rose-600 bg-rose-50 px-2 py-1 rounded mt-2">
                                回退原因：{item.rollbackReason}
                                {item.rollbackBy && ` (${item.rollbackBy}·${item.rollbackAt ? formatDate(item.rollbackAt) : ''})`}
                              </div>
                            )}

                            {item.errorCode && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-100 text-rose-700 border border-rose-200">
                                  {item.errorCode}
                                </span>
                                <span className="text-xs text-rose-600">{item.errorMessage}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal
        open={showExportModal}
        onClose={() => setShowExportModal(false)}
        title="导出审计结果"
        size="md"
        footer={
          <>
            <button onClick={() => setShowExportModal(false)} className="btn-secondary" disabled={exportLoading}>
              取消
            </button>
            <button onClick={handleExport} className="btn-primary" disabled={exportLoading}>
              {exportLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  导出中...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 mr-2" />
                  确认导出
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          {exportSuccess && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              导出成功！
            </div>
          )}

          <div>
            <label className="label-text">导出格式</label>
            <div className="grid grid-cols-2 gap-3 mt-2">
              <button
                onClick={() => setExportFormat('csv')}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                  exportFormat === 'csv'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <FileSpreadsheet className={`w-6 h-6 ${exportFormat === 'csv' ? 'text-brand-600' : 'text-slate-400'}`} />
                <div className="text-left">
                  <p className={`font-medium ${exportFormat === 'csv' ? 'text-brand-700' : 'text-slate-700'}`}>CSV 格式</p>
                  <p className="text-xs text-slate-500">适合 Excel 打开</p>
                </div>
              </button>
              <button
                onClick={() => setExportFormat('json')}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                  exportFormat === 'json'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <FileJson className={`w-6 h-6 ${exportFormat === 'json' ? 'text-brand-600' : 'text-slate-400'}`} />
                <div className="text-left">
                  <p className={`font-medium ${exportFormat === 'json' ? 'text-brand-700' : 'text-slate-700'}`}>JSON 格式</p>
                  <p className="text-xs text-slate-500">适合程序处理</p>
                </div>
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-sm font-medium text-slate-700 mb-2">导出内容包括：</p>
            <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
              <li>样本基本信息和锁定状态</li>
              <li>完整的流转时间线（包含归档前后）</li>
              <li>所有失败交接记录及错误详情</li>
              <li>所有回退记录及原因</li>
              <li>统计摘要数据</li>
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
};
