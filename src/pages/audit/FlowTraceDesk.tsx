import { useEffect, useState, useMemo } from 'react';
import {
  Search,
  Filter,
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
  Clock,
  ChevronRight,
  Ban,
  AlertOctagon,
  CheckCircle,
  Circle,
  GitBranch,
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
  FLOW_TRACE_STAGE_LABELS,
  ERROR_CATEGORY_LABELS,
} from '@shared/constants';
import type {
  FlowTraceSampleSummary,
  FlowTraceDetailData,
  FlowTraceExportOptions,
  FlowTraceFilter,
  FlowTraceStage,
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

const getStageStatusStyle = (status: FlowTraceStage['status']) => {
  switch (status) {
    case 'completed':
      return {
        bg: 'bg-emerald-100',
        border: 'border-emerald-400',
        text: 'text-emerald-700',
        icon: <CheckCircle className="w-4 h-4" />,
        label: '已完成',
      };
    case 'current':
      return {
        bg: 'bg-blue-100',
        border: 'border-blue-500',
        text: 'text-blue-700',
        icon: <Circle className="w-4 h-4 fill-blue-500" />,
        label: '进行中',
      };
    case 'pending':
      return {
        bg: 'bg-slate-100',
        border: 'border-slate-300',
        text: 'text-slate-500',
        icon: <Circle className="w-4 h-4" />,
        label: '待进行',
      };
    case 'failed':
      return {
        bg: 'bg-rose-100',
        border: 'border-rose-400',
        text: 'text-rose-700',
        icon: <XCircle className="w-4 h-4" />,
        label: '有失败',
      };
    case 'rolled_back':
      return {
        bg: 'bg-amber-100',
        border: 'border-amber-400',
        text: 'text-amber-700',
        icon: <RotateCcw className="w-4 h-4" />,
        label: '已回退',
      };
    default:
      return {
        bg: 'bg-slate-100',
        border: 'border-slate-300',
        text: 'text-slate-500',
        icon: <Circle className="w-4 h-4" />,
        label: status,
      };
  }
};

export const FlowTraceDesk = () => {
  const samples = useAppStore((s) => s.samples);
  const currentUser = useAppStore((s) => s.currentUser);
  const getFlowTraceList = useAppStore((s) => s.getFlowTraceList);
  const getFlowTraceData = useAppStore((s) => s.getFlowTraceData);
  const exportFlowTraceData = useAppStore((s) => s.exportFlowTraceData);

  const [sampleList, setSampleList] = useState<FlowTraceSampleSummary[]>([]);
  const [selectedSampleId, setSelectedSampleId] = useState('');
  const [traceData, setTraceData] = useState<FlowTraceDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<'json' | 'csv'>('csv');
  const [exportSuccess, setExportSuccess] = useState(false);

  const [filterKeyword, setFilterKeyword] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterHasFailed, setFilterHasFailed] = useState(false);
  const [filterHasRollback, setFilterHasRollback] = useState(false);
  const [filterIsLocked, setFilterIsLocked] = useState(false);
  const [filterIsArchived, setFilterIsArchived] = useState<boolean | undefined>(undefined);

  const canView = hasPermission(currentUser, 'flowTrace:view').allowed;
  const canViewDetail = hasPermission(currentUser, 'flowTrace:viewDetail').allowed;
  const canExport = hasPermission(currentUser, 'flowTrace:export').allowed;

  const loadSampleList = async () => {
    setListLoading(true);
    try {
      const filter: FlowTraceFilter = {};
      if (filterKeyword) filter.keyword = filterKeyword;
      if (filterStatus) filter.status = filterStatus as any;
      if (filterHasFailed) filter.hasFailed = true;
      if (filterHasRollback) filter.hasRollback = true;
      if (filterIsLocked) filter.isLocked = true;
      if (filterIsArchived !== undefined) filter.isArchived = filterIsArchived;

      const list = await getFlowTraceList(filter);
      setSampleList(list);
    } catch (e) {
      console.error(e);
    } finally {
      setListLoading(false);
    }
  };

  const loadTraceData = async (sampleId: string) => {
    if (!sampleId) {
      setTraceData(null);
      return;
    }
    setLoading(true);
    try {
      const data = await getFlowTraceData(sampleId);
      setTraceData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) {
      loadSampleList();
    }
  }, [canView]);

  useEffect(() => {
    if (selectedSampleId && canViewDetail) {
      loadTraceData(selectedSampleId);
    }
  }, [selectedSampleId, canViewDetail]);

  const handleExport = async () => {
    if (!traceData || !canExport) return;

    setExportLoading(true);
    setExportSuccess(false);

    try {
      const options: FlowTraceExportOptions = {
        format: exportFormat,
        includeBusinessChain: true,
        includeFullTimeline: true,
        includeBlockedOps: true,
        includeRollbackHistory: true,
        includeSummary: true,
      };

      const data = await exportFlowTraceData(traceData.sample.id, options);
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `flow_trace_${traceData.sample.sampleNo}_${timestamp}.${exportFormat}`;

      let blob: Blob;
      if (exportFormat === 'json') {
        blob = new Blob([data as string], { type: 'application/json' });
      } else {
        const bom = '\uFEFF';
        blob = new Blob([bom + (data as string)], { type: 'text/csv;charset=utf-8' });
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

  const getTimelineItemIcon = (type: string) => {
    switch (type) {
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

  const getTimelineItemColor = (item: FlowTraceDetailData['fullTimeline'][0]) => {
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
          <h1 className="text-2xl font-bold text-slate-900 font-serif">流转追溯台</h1>
          <p className="text-slate-500 mt-1">按样本追溯完整业务链，查看流转、拦截、回退与锁定状态</p>
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
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 font-serif">流转追溯台</h1>
          <p className="text-slate-500 mt-1">
            按样本追溯完整业务链，查看最近一次有效流转、被拦截操作、撤回落点与锁定状态
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-100">
            共 {sampleList.length} 个样本
          </span>
        </div>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">筛选条件</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="label-text text-xs">关键词搜索</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={filterKeyword}
                onChange={(e) => setFilterKeyword(e.target.value)}
                className="input-field pl-8 text-sm"
                placeholder="样本号/批次号/类型..."
              />
            </div>
          </div>
          <div>
            <label className="label-text text-xs">当前状态</label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-text text-xs">特殊标记</label>
            <div className="flex flex-wrap gap-2 pt-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterHasFailed}
                  onChange={(e) => setFilterHasFailed(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                有失败记录
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterHasRollback}
                  onChange={(e) => setFilterHasRollback(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                有回退记录
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filterIsLocked}
                  onChange={(e) => setFilterIsLocked(e.target.checked)}
                  className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                />
                已锁定
              </label>
            </div>
          </div>
          <div>
            <label className="label-text text-xs">归档状态</label>
            <div className="flex flex-wrap gap-2 pt-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="radio"
                  name="archived"
                  checked={filterIsArchived === undefined}
                  onChange={() => setFilterIsArchived(undefined)}
                  className="text-brand-600 focus:ring-brand-500"
                />
                全部
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="radio"
                  name="archived"
                  checked={filterIsArchived === true}
                  onChange={() => setFilterIsArchived(true)}
                  className="text-brand-600 focus:ring-brand-500"
                />
                已归档
              </label>
              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input
                  type="radio"
                  name="archived"
                  checked={filterIsArchived === false}
                  onChange={() => setFilterIsArchived(false)}
                  className="text-brand-600 focus:ring-brand-500"
                />
                未归档
              </label>
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={loadSampleList} className="btn-primary text-sm">
            {listLoading ? '加载中...' : '查询'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <div className="glass-card p-5">
            <div className="flex items-center gap-2 mb-4">
              <FlaskConical className="w-5 h-5 text-slate-500" />
              <span className="font-medium text-slate-900">选择样本</span>
            </div>

            <div className="max-h-[600px] overflow-y-auto space-y-2">
              {listLoading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-6 h-6 text-brand-500 mx-auto animate-spin" />
                  <p className="text-sm text-slate-500 mt-2">加载中...</p>
                </div>
              ) : sampleList.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  暂无符合条件的样本
                </div>
              ) : (
                sampleList.map((s) => (
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
                      <span className="font-mono text-sm font-medium text-slate-900">
                        {s.sampleNo}
                      </span>
                      <div className="flex items-center gap-1">
                        {s.isLocked && <Lock className="w-3 h-3 text-rose-500" />}
                        {s.hasBlockedOps && <AlertTriangle className="w-3 h-3 text-amber-500" />}
                        {s.rollbackCount > 0 && <RotateCcw className="w-3 h-3 text-orange-500" />}
                        <StatusBadge status={s.currentStatus} />
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mb-1">
                      批次：{s.batchNo} · {s.type}
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">
                        环节：{FLOW_TRACE_STAGE_LABELS[s.currentStage] || s.currentStage}
                      </span>
                      {s.lastTransferAt && (
                        <span className="text-slate-400">
                          {formatDate(s.lastTransferAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5">
                      {s.failedAttempts > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-rose-50 text-rose-600">
                          <XCircle className="w-3 h-3" />
                          {s.failedAttempts} 次失败
                        </span>
                      )}
                      {s.rollbackCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600">
                          <RotateCcw className="w-3 h-3" />
                          {s.rollbackCount} 次回退
                        </span>
                      )}
                    </div>
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
              <p className="text-slate-500">请从左侧选择一个样本查看流转追溯详情</p>
            </div>
          ) : loading ? (
            <div className="glass-card p-12 text-center">
              <Loader2 className="w-8 h-8 text-brand-500 mx-auto mb-4 animate-spin" />
              <p className="text-slate-500">加载追溯数据中...</p>
            </div>
          ) : !traceData ? (
            <div className="glass-card p-12 text-center">
              <AlertTriangle className="w-16 h-16 text-amber-400 mx-auto mb-4" />
              <p className="text-slate-500">未能加载追溯数据</p>
            </div>
          ) : (
            <>
              <div className="glass-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <h2 className="text-xl font-bold text-slate-900 font-serif">
                        {traceData.sample.sampleNo}
                      </h2>
                      <StatusBadge status={traceData.sample.currentStatus} />
                      {traceData.sample.isLocked ? (
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
                    <p className="text-slate-500 text-sm">
                      {traceData.sample.type} · 批次 {traceData.sample.batchNo}
                    </p>
                    {traceData.sample.lockReason && (
                      <p className="text-xs text-rose-600 mt-2 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />
                        {traceData.sample.lockReason}
                      </p>
                    )}
                  </div>

                  {canExport && (
                    <button
                      onClick={() => setShowExportModal(true)}
                      className="btn-primary text-sm flex items-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      导出追溯记录
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
                  <div className="p-3 rounded-lg bg-slate-50">
                    <div className="text-xs text-slate-500 mb-1">总流转</div>
                    <div className="text-xl font-bold text-slate-900">
                      {traceData.summary.totalTransfers}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-50">
                    <div className="text-xs text-emerald-600 mb-1">有效流转</div>
                    <div className="text-xl font-bold text-emerald-700">
                      {traceData.summary.validTransfers}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-rose-50">
                    <div className="text-xs text-rose-600 mb-1">失败尝试</div>
                    <div className="text-xl font-bold text-rose-700">
                      {traceData.summary.failedAttempts}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50">
                    <div className="text-xs text-amber-600 mb-1">回退次数</div>
                    <div className="text-xl font-bold text-amber-700">
                      {traceData.summary.rollbackCount}
                    </div>
                  </div>
                  <div className="p-3 rounded-lg bg-blue-50">
                    <div className="text-xs text-blue-600 mb-1">当前环节</div>
                    <div className="text-sm font-bold text-blue-700 mt-1">
                      {traceData.summary.currentStageLabel}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                  <div className="flex items-center gap-2 text-slate-600">
                    <MapPin className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-500">当前库位：</span>
                    <span className="font-medium">{traceData.sample.currentLocation || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <User className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-500">当前持有人：</span>
                    <span className="font-medium">{traceData.sample.currentHolder || '-'}</span>
                  </div>
                  <div className="flex items-center gap-2 text-slate-600">
                    <Clock className="w-4 h-4 text-slate-400" />
                    <span className="text-slate-500">当前环节停留：</span>
                    <span className="font-medium">{traceData.summary.daysInCurrentStage} 天</span>
                  </div>
                  {traceData.sample.archivedAt && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      <span className="text-slate-500">归档时间：</span>
                      <span className="font-medium">
                        {formatDate(traceData.sample.archivedAt)}
                      </span>
                      <span className="text-slate-400">
                        ({traceData.sample.archivedBy})
                      </span>
                    </div>
                  )}
                  {traceData.sample.reviewedAt && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      <span className="text-slate-500">复核时间：</span>
                      <span className="font-medium">
                        {formatDate(traceData.sample.reviewedAt)}
                      </span>
                      <span className="text-slate-400">
                        ({traceData.sample.reviewedBy})
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="glass-card p-6 border-brand-200 bg-brand-50/30">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <GitBranch className="w-5 h-5 text-brand-600" />
                  业务环节链
                </h3>
                <div className="flex items-start justify-between gap-2 overflow-x-auto pb-2">
                  {traceData.businessChain.map((stage, index) => {
                    const style = getStageStatusStyle(stage.status);
                    const isLast = index === traceData.businessChain.length - 1;
                    return (
                      <div key={stage.key} className="flex items-start flex-shrink-0">
                        <div className="flex flex-col items-center min-w-[100px]">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center border-2 ${style.bg} ${style.border} ${style.text}`}
                          >
                            {style.icon}
                          </div>
                          <div className="mt-2 text-center">
                            <p className={`text-xs font-medium ${style.text}`}>{stage.label}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{style.label}</p>
                            {stage.timestamp && (
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                {new Date(stage.timestamp).toLocaleDateString('zh-CN')}
                              </p>
                            )}
                            {stage.operatorName && (
                              <p className="text-[10px] text-slate-500 mt-0.5">
                                {stage.operatorName}
                              </p>
                            )}
                          </div>
                        </div>
                        {!isLast && (
                          <div className="flex items-center pt-5 px-1">
                            <ChevronRight className="w-4 h-4 text-slate-300" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {traceData.latestValidTransfer && (
                <div className="glass-card p-6 border-emerald-200 bg-emerald-50/30">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    最近一次有效流转
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white ${TRANSFER_TYPE_COLORS[traceData.latestValidTransfer.type]}`}>
                        {TRANSFER_TYPE_LABELS[traceData.latestValidTransfer.type]}
                      </span>
                    </div>
                    <div className="text-right text-sm text-slate-500">
                      {formatDate(traceData.latestValidTransfer.timestamp)}
                    </div>
                    <div className="text-sm text-slate-600">
                      <span className="text-slate-500">操作人：</span>
                      <span className="font-medium">
                        {traceData.latestValidTransfer.operatorName}
                      </span>
                    </div>
                    {traceData.latestValidTransfer.fromStatus && (
                      <div className="text-sm text-slate-600">
                        <span className="text-slate-500">状态：</span>
                        <span className="font-medium">
                          {STATUS_LABELS[traceData.latestValidTransfer.fromStatus]} →{' '}
                          {STATUS_LABELS[traceData.latestValidTransfer.toStatus]}
                        </span>
                      </div>
                    )}
                    {(traceData.latestValidTransfer.fromLocation ||
                      traceData.latestValidTransfer.toLocation) && (
                      <div className="text-sm text-slate-600 md:col-span-2">
                        <span className="text-slate-500">库位：</span>
                        <span className="font-medium">
                          {traceData.latestValidTransfer.fromLocation || '-'} →{' '}
                          {traceData.latestValidTransfer.toLocation || '-'}
                        </span>
                      </div>
                    )}
                    {traceData.latestValidTransfer.remark && (
                      <div className="text-sm text-slate-600 md:col-span-2 bg-white p-2 rounded border border-emerald-200">
                        <span className="text-slate-500">备注：</span>
                        {traceData.latestValidTransfer.remark}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {traceData.blockedOperations.length > 0 && (
                <div className="glass-card p-6 border-rose-200 bg-rose-50/30">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <Ban className="w-5 h-5 text-rose-500" />
                    被拦截/失败操作
                    <span className="ml-2 text-sm font-normal text-rose-600">
                      共 {traceData.blockedOperations.length} 次
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {traceData.blockedOperations.map((op) => (
                      <div
                        key={op.id}
                        className="p-4 rounded-lg bg-white border border-rose-200"
                      >
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${TRANSFER_TYPE_COLORS[op.attemptedType]}`}
                          >
                            尝试: {TRANSFER_TYPE_LABELS[op.attemptedType]}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              op.errorCategory === 'permission'
                                ? 'bg-orange-100 text-orange-700'
                                : op.errorCategory === 'status'
                                  ? 'bg-blue-100 text-blue-700'
                                  : op.errorCategory === 'location'
                                    ? 'bg-purple-100 text-purple-700'
                                    : op.errorCategory === 'duplicate'
                                      ? 'bg-teal-100 text-teal-700'
                                      : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {ERROR_CATEGORY_LABELS[op.errorCategory] || op.errorCategory}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDate(op.attemptedAt)}
                          </span>
                          <span className="text-xs text-slate-600 ml-auto">
                            尝试人：{op.attemptedByName}
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2">
                          <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-100 text-rose-700 border border-rose-200">
                            {op.errorCode}
                          </span>
                          <span className="text-xs text-slate-600">
                            {ERROR_CODE_LABELS[op.errorCode] || op.errorCode}
                          </span>
                        </div>
                        <div className="text-sm text-rose-700">{op.errorMessage}</div>
                        {op.resolved && (
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

              {traceData.rollbackHistory.length > 0 && (
                <div className="glass-card p-6 border-amber-200 bg-amber-50/30">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                    <RotateCcw className="w-5 h-5 text-amber-500" />
                    回退历史
                    <span className="ml-2 text-sm font-normal text-amber-600">
                      共 {traceData.rollbackHistory.length} 次
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {traceData.rollbackHistory.map((rb) => (
                      <div
                        key={rb.id}
                        className="p-4 rounded-lg bg-white border border-amber-200"
                      >
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium text-white ${TRANSFER_TYPE_COLORS[rb.rolledBackTransferType]}`}
                          >
                            回退: {TRANSFER_TYPE_LABELS[rb.rolledBackTransferType]}
                          </span>
                          <span className="text-xs text-slate-500">
                            {formatDate(rb.rollbackAt)}
                          </span>
                          <span className="text-xs text-slate-600 ml-auto">
                            回退人：{rb.rollbackByName}
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2 text-sm">
                          <div className="text-slate-600">
                            <span className="text-slate-500">被回退环节：</span>
                            <span className="font-medium">
                              {FLOW_TRACE_STAGE_LABELS[rb.rolledBackStage] ||
                                rb.rolledBackStage}
                            </span>
                          </div>
                          <div className="text-slate-600">
                            <span className="text-slate-500">撤回落点：</span>
                            <span className="font-medium text-emerald-600">
                              {FLOW_TRACE_STAGE_LABELS[rb.landingStage] || rb.landingStage}
                            </span>
                          </div>
                          <div className="text-slate-600">
                            <span className="text-slate-500">状态变更：</span>
                            <span className="font-medium">
                              {STATUS_LABELS[rb.fromStatus]} → {STATUS_LABELS[rb.toStatus]}
                            </span>
                          </div>
                        </div>
                        <div className="text-sm text-amber-700 bg-amber-50 p-2 rounded">
                          <span className="font-medium">回退原因：</span>
                          {rb.reason}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="glass-card p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Clock className="w-5 h-5 text-slate-500" />
                  完整时间线
                </h3>

                <div className="relative pl-6">
                  <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-slate-200" />
                  <div className="space-y-5">
                    {traceData.fullTimeline.map((item, idx) => {
                      const isLast = idx === traceData.fullTimeline.length - 1;
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
                            {getTimelineItemIcon(item.type)}
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
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${getTimelineItemColor(
                                  item
                                )}`}
                              >
                                {item.actionLabel}
                              </span>
                              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                                {FLOW_TRACE_STAGE_LABELS[item.stageKey] || item.stageKey}
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
                                  (
                                  {ROLE_LABELS[
                                    item.operatorRole as keyof typeof ROLE_LABELS
                                  ] || item.operatorRole}
                                  )
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
                                {item.rollbackBy && ` (${item.rollbackBy})`}
                              </div>
                            )}

                            {item.errorCode && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-xs font-mono bg-rose-100 text-rose-700 border border-rose-200">
                                  {item.errorCode}
                                </span>
                                {item.errorCategory && (
                                  <span className="text-xs text-slate-500">
                                    [{ERROR_CATEGORY_LABELS[item.errorCategory] ||
                                      item.errorCategory}
                                    ]
                                  </span>
                                )}
                                <span className="text-xs text-rose-600">
                                  {item.errorMessage}
                                </span>
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
        title="导出流转追溯记录"
        size="md"
        footer={
          <>
            <button
              onClick={() => setShowExportModal(false)}
              className="btn-secondary"
              disabled={exportLoading}
            >
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
                <FileSpreadsheet
                  className={`w-6 h-6 ${
                    exportFormat === 'csv' ? 'text-brand-600' : 'text-slate-400'
                  }`}
                />
                <div className="text-left">
                  <p
                    className={`font-medium ${
                      exportFormat === 'csv' ? 'text-brand-700' : 'text-slate-700'
                    }`}
                  >
                    CSV 格式
                  </p>
                  <p className="text-xs text-slate-500">适合 Excel 打开，易读性强</p>
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
                <FileJson
                  className={`w-6 h-6 ${
                    exportFormat === 'json' ? 'text-brand-600' : 'text-slate-400'
                  }`}
                />
                <div className="text-left">
                  <p
                    className={`font-medium ${
                      exportFormat === 'json' ? 'text-brand-700' : 'text-slate-700'
                    }`}
                  >
                    JSON 格式
                  </p>
                  <p className="text-xs text-slate-500">适合程序处理，结构完整</p>
                </div>
              </button>
            </div>
          </div>

          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <p className="text-sm font-medium text-slate-700 mb-2">导出内容包括：</p>
            <ul className="text-xs text-slate-600 space-y-1 list-disc list-inside">
              <li>样本基本信息和锁定状态</li>
              <li>业务环节链（各环节状态与完成情况）</li>
              <li>最近一次有效流转详情</li>
              <li>所有被拦截/失败操作（含错误类别与原因）</li>
              <li>所有回退历史（含撤回落点与原因）</li>
              <li>完整时间线</li>
              <li>统计摘要数据</li>
            </ul>
          </div>
        </div>
      </Modal>
    </div>
  );
};
