import { useEffect } from 'react';
import { FlaskConical, Package, AlertTriangle, CheckCircle2, Activity, ArrowRight, Clock } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Link } from 'react-router-dom';
import { StatusBadge } from '@/components/common/StatusBadge';
import { TRANSFER_TYPE_LABELS, STATUS_LABELS } from '@shared/constants';
import type { TransferRecord } from '@shared/types';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const Dashboard = () => {
  const samples = useAppStore((s) => s.samples);
  const users = useAppStore((s) => s.users);
  const failedTransfers = useAppStore((s) => s.failedTransfers);
  const getUserById = useAppStore((s) => s.getUserById);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getLocationById = useAppStore((s) => s.getLocationById);
  const getAllSamples = useAppStore((s) => s.getAllSamples);
  const getFailedTransfers = useAppStore((s) => s.getFailedTransfers);
  const getTransferRecordsBySample = useAppStore((s) => s.getTransferRecordsBySample);

  useEffect(() => {
    getAllSamples();
    getFailedTransfers();
  }, [getAllSamples, getFailedTransfers]);

  const totalCount = samples.length;
  const inStockCount = samples.filter((s) => s.currentStatus === 'in_stock').length;
  const testingCount = samples.filter((s) => ['in_transit', 'testing'].includes(s.currentStatus)).length;
  const archivedCount = samples.filter((s) => s.isArchived).length;
  const pendingCount = samples.filter((s) => s.currentStatus === 'tested' && !s.reviewedBy).length;

  const stats = [
    {
      label: '样本总数',
      value: totalCount,
      icon: <FlaskConical className="w-6 h-6" />,
      bg: 'bg-brand-50',
      text: 'text-brand-700',
      border: 'border-brand-100',
    },
    {
      label: '在库样本',
      value: inStockCount,
      icon: <Package className="w-6 h-6" />,
      bg: 'bg-teal-50',
      text: 'text-teal-700',
      border: 'border-teal-100',
    },
    {
      label: '检测中',
      value: testingCount,
      icon: <Activity className="w-6 h-6" />,
      bg: 'bg-blue-50',
      text: 'text-blue-700',
      border: 'border-blue-100',
    },
    {
      label: '已归档',
      value: archivedCount,
      icon: <CheckCircle2 className="w-6 h-6" />,
      bg: 'bg-emerald-50',
      text: 'text-emerald-700',
      border: 'border-emerald-100',
    },
  ];

  const recentSamples = samples.slice(0, 5);
  const unresolvedFailures = failedTransfers.filter((f) => !f.resolved).slice(0, 5);

  const TodoItem = ({
    count,
    title,
    desc,
    to,
  }: {
    count: number;
    title: string;
    desc: string;
    to: string;
  }) => (
    <Link
      to={to}
      className="flex items-start gap-4 p-4 rounded-xl bg-white border border-slate-200 hover:border-brand-200 hover:shadow-sm transition-all group"
    >
      <div className="w-10 h-10 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
        <Clock className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-slate-900">{title}</span>
          {count > 0 && (
            <span className="px-2 py-0.5 text-xs font-semibold bg-amber-100 text-amber-700 rounded-full">
              {count} 待处理
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 mt-0.5">{desc}</p>
      </div>
      <ArrowRight className="w-5 h-5 text-slate-300 group-hover:text-brand-500 transition-colors shrink-0" />
    </Link>
  );

  const TransferCard = async ({ sampleId }: { sampleId: string }) => {
    const records: TransferRecord[] = await getTransferRecordsBySample(sampleId);
    const latest = records[records.length - 1];
    const sample = getSampleById(sampleId);
    if (!latest || !sample) return null;
    const operator = getUserById(latest.operatorId);

    return (
      <div className="flex items-center gap-4 py-3 border-b border-slate-100 last:border-0">
        <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-medium text-slate-600">
          {sample.sampleNo.slice(-2)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-900">{sample.sampleNo}</span>
            <StatusBadge status={sample.currentStatus} />
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {operator?.displayName} · {TRANSFER_TYPE_LABELS[latest.type]}
          </p>
        </div>
        <span className="text-xs text-slate-400">{formatDate(latest.operatedAt)}</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">仪表盘</h1>
        <p className="text-slate-500 mt-1">样本流转状态概览</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className={`rounded-xl p-5 ${stat.bg} border ${stat.border}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-slate-600">{stat.label}</p>
                <p className={`text-3xl font-bold mt-2 ${stat.text}`}>{stat.value}</p>
              </div>
              <div className={`p-2.5 rounded-lg bg-white/70 ${stat.text}`}>{stat.icon}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900 font-serif">待办事项</h2>
          <TodoItem
            count={samples.filter((s) => s.currentStatus === 'imported').length}
            title="待入库样本"
            desc="需要库管员确认入库登记"
            to="/flow/inbound"
          />
          <TodoItem
            count={samples.filter((s) => s.currentStatus === 'in_stock').length}
            title="待出库送检"
            desc="需要出库交接给检测人员"
            to="/flow/outbound"
          />
          <TodoItem
            count={samples.filter((s) => s.currentStatus === 'in_transit').length}
            title="待检测接收"
            desc="送检中样本等待检测员接收"
            to="/flow/testing/receive"
          />
          <TodoItem
            count={pendingCount}
            title="待复核归档"
            desc="检测完成样本等待审核员复核"
            to="/flow/archive"
          />
          {unresolvedFailures.length > 0 && (
            <TodoItem
              count={unresolvedFailures.length}
              title="异常处理"
              desc="存在失败的交接记录需要处理"
              to="/exception/failures"
            />
          )}
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-slate-900 font-serif">最近样本</h2>
            <Link
              to="/samples"
              className="text-sm text-brand-600 hover:text-brand-700 font-medium"
            >
              查看全部 →
            </Link>
          </div>

          {recentSamples.length === 0 ? (
            <div className="text-center py-12">
              <FlaskConical className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500">暂无样本数据</p>
              <Link
                to="/samples/import"
                className="inline-block mt-4 btn-primary text-sm"
              >
                导入样本批次
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              {recentSamples.map((sample) => {
                const location = sample.currentLocationId ? getLocationById(sample.currentLocationId) : null;
                const holder = sample.currentHolderId ? getUserById(sample.currentHolderId) : null;
                return (
                  <Link
                    key={sample.id}
                    to={`/samples/${sample.id}`}
                    className="block p-3 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{sample.sampleNo}</span>
                          <StatusBadge status={sample.currentStatus} />
                        </div>
                        <p className="text-xs text-slate-500 mt-1">
                          {sample.type} · {STATUS_LABELS[sample.currentStatus]}
                          {location && ` · ${location.name}`}
                          {holder && ` · ${holder.displayName}`}
                        </p>
                      </div>
                      <span className="text-xs text-slate-400">
                        {formatDate(sample.createdAt)}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {unresolvedFailures.length > 0 && (
        <div className="glass-card p-5 border-rose-100">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-rose-500" />
            <h2 className="text-lg font-semibold text-slate-900 font-serif">异常告警</h2>
          </div>
          <div className="space-y-2">
            {unresolvedFailures.map((f) => {
              const sample = getSampleById(f.sampleId);
              const user = getUserById(f.attemptedBy);
              return (
                <div
                  key={f.id}
                  className="flex items-start gap-3 p-3 rounded-lg bg-rose-50 border border-rose-100"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-slate-900">
                        {sample?.sampleNo || f.sampleId}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
                        {TRANSFER_TYPE_LABELS[f.attemptedType]} 失败
                      </span>
                      <span className="text-xs text-slate-500">
                        {user?.displayName} · {formatDate(f.attemptedAt)}
                      </span>
                    </div>
                    <p className="text-sm text-rose-700 mt-1">{f.errorMessage}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
