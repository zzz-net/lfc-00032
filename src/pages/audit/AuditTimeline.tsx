import { useEffect, useState } from 'react';
import { Clock, Filter, Search, User, ArrowRight, XCircle, RotateCcw } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import {
  TRANSFER_TYPE_LABELS,
  TRANSFER_TYPE_COLORS,
  ROLE_LABELS,
  STATUS_LABELS,
} from '@shared/constants';
import type { AuditLog, AuditTimelineFilter, TransferType, FailedTransfer } from '@shared/types';

const formatDate = (iso: string) => new Date(iso).toLocaleString('zh-CN');

export const AuditTimeline = () => {
  const users = useAppStore((s) => s.users);
  const samples = useAppStore((s) => s.samples);
  const getAuditLogs = useAppStore((s) => s.getAuditLogs);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getUserById = useAppStore((s) => s.getUserById);
  const getLocationById = useAppStore((s) => s.getLocationById);
  const getTransferRecordsBySample = useAppStore((s) => s.getTransferRecordsBySample);
  const getFailedTransfers = useAppStore((s) => s.getFailedTransfers);
  const failedTransfers = useAppStore((s) => s.failedTransfers);

  const [sampleFilter, setSampleFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [showFailed, setShowFailed] = useState(false);

  const transferTypes: TransferType[] = [
    'import', 'inbound', 'outbound', 'test_receive', 'test_complete', 'archive', 'rollback'
  ];

  const fetchLogs = async () => {
    setLoading(true);
    const filter: AuditTimelineFilter = {};
    if (userFilter) filter.userId = userFilter;
    if (fromDate) filter.fromDate = fromDate;
    if (toDate) filter.toDate = toDate;
    if (typeFilter) filter.transferType = typeFilter as TransferType;
    const result = await getAuditLogs(filter);
    const filtered = sampleFilter
      ? result.filter((l) => {
          const sampleNo = (l.details?.sampleNo as string) || '';
          const sid = l.targetId || '';
          return sampleNo.includes(sampleFilter) || sid.includes(sampleFilter);
        })
      : result;
    setLogs(filtered);
    setLoading(false);
  };

  useEffect(() => {
    fetchLogs();
    getFailedTransfers();
  }, []);

  const filteredFailed = failedTransfers.filter((f) => {
    if (sampleFilter) {
      const s = getSampleById(f.sampleId);
      const no = s?.sampleNo || (f.payload?.sampleNo as string) || '';
      if (!no.includes(sampleFilter)) return false;
    }
    if (userFilter && f.attemptedBy !== userFilter) return false;
    return true;
  });

  const actionLabels: Record<string, string> = {
    login: '用户登录',
    logout: '用户登出',
    'batch:import': '批次导入',
    'location:create': '创建库位',
    'location:update': '更新库位',
    'sample:review': '样本复核',
    'transfer:inbound': '入库操作',
    'transfer:outbound': '出库操作',
    'transfer:test_receive': '检测接收',
    'transfer:test_complete': '检测完成',
    'transfer:archive': '归档操作',
    'transfer:rollback': '回退操作',
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">审计时间线</h1>
        <p className="text-slate-500 mt-1">查看完整的系统操作审计日志和流转链路</p>
      </div>

      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">筛选条件</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          <div>
            <label className="label-text text-xs">样本编号</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={sampleFilter}
                onChange={(e) => setSampleFilter(e.target.value)}
                className="input-field pl-8 text-sm"
                placeholder="搜索样本..."
              />
            </div>
          </div>
          <div>
            <label className="label-text text-xs">操作者</label>
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">全部</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.displayName}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-text text-xs">操作类型</label>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="input-field text-sm"
            >
              <option value="">全部</option>
              {transferTypes.map((t) => (
                <option key={t} value={t}>{TRANSFER_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label-text text-xs">开始日期</label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="input-field text-sm"
            />
          </div>
          <div>
            <label className="label-text text-xs">结束日期</label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="input-field text-sm"
            />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={showFailed}
              onChange={(e) => setShowFailed(e.target.checked)}
              className="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <XCircle className="w-4 h-4 text-rose-500" />
            显示失败记录
          </label>
          <button onClick={fetchLogs} disabled={loading} className="btn-primary text-sm">
            {loading ? '加载中...' : '查询'}
          </button>
        </div>
      </div>

      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900 font-serif flex items-center gap-2">
            <Clock className="w-5 h-5 text-slate-500" />
            操作记录
          </h2>
          <span className="text-sm text-slate-500">共 {logs.length + (showFailed ? filteredFailed.length : 0)} 条</span>
        </div>

        {logs.length === 0 && (!showFailed || filteredFailed.length === 0) ? (
          <div className="text-center py-12">
            <Clock className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">暂无符合条件的审计记录</p>
          </div>
        ) : (
          <div className="relative pl-6">
            <div className="absolute left-[7px] top-2 bottom-2 w-0.5 bg-slate-200" />
            <div className="space-y-5">
              {showFailed && filteredFailed.map((f) => {
                const user = getUserById(f.attemptedBy);
                const s = getSampleById(f.sampleId);
                const sampleNo = s?.sampleNo || (f.payload?.sampleNo as string) || '-';
                return (
                  <div key={f.id} className="relative">
                    <div className="absolute -left-[22px] top-1.5 w-4 h-4 rounded-full bg-rose-100 border-2 border-rose-400" />
                    <div className="p-4 rounded-lg bg-rose-50 border border-rose-200">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <XCircle className="w-4 h-4 text-rose-500" />
                        <span className="text-sm font-medium text-rose-800">失败操作</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-mono">
                          {sampleNo}
                        </span>
                        <span className="text-xs text-rose-600">
                          {TRANSFER_TYPE_LABELS[f.attemptedType]}
                        </span>
                        <span className="text-xs text-slate-400 ml-auto">
                          {formatDate(f.attemptedAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-rose-700">
                        <User className="w-3.5 h-3.5 text-rose-400" />
                        <span>{user?.displayName || '-'}</span>
                        <span className="text-xs">· {f.errorCode}: {f.errorMessage}</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {logs.slice(0, 100).map((log) => {
                const user = getUserById(log.userId);
                const sampleNo = log.details?.sampleNo as string | undefined;
                const isRollback = log.action === 'transfer:rollback';
                const rollbackToRecordId = log.details?.rollbackToRecordId as string | undefined;
                return (
                  <div key={log.id} className="relative">
                    <div className={`absolute -left-[22px] top-1.5 w-4 h-4 rounded-full border-2 ${
                      isRollback ? 'bg-rose-100 border-rose-500' : 'bg-white border-brand-500'
                    }`} />
                    <div className={`p-4 rounded-lg border transition-colors ${
                      isRollback
                        ? 'bg-rose-50/50 border-rose-200 hover:border-rose-300'
                        : 'bg-white border-slate-200 hover:border-brand-200'
                    }`}>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {isRollback && <RotateCcw className="w-4 h-4 text-rose-500" />}
                        <span className="text-sm font-medium text-slate-900">
                          {actionLabels[log.action] || log.action}
                        </span>
                        {sampleNo && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-brand-50 text-brand-700 font-mono">
                            {sampleNo}
                          </span>
                        )}
                        <span className="text-xs text-slate-400 ml-auto">
                          {formatDate(log.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600">
                        <User className="w-3.5 h-3.5 text-slate-400" />
                        <span>{user?.displayName || '-'}</span>
                        {user && (
                          <span className="text-xs text-slate-400">({ROLE_LABELS[user.role]})</span>
                        )}
                      </div>
                      {Object.keys(log.details || {}).length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                          <p className="text-xs text-slate-500 mb-1">操作详情：</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(log.details || {}).map(([k, v]) => {
                              if (k === 'sampleNo') return null;
                              let display = String(v);
                              if (k === 'toStatus' || k === 'fromStatus' || k === 'rollbackToStatus') {
                                display = STATUS_LABELS[v as keyof typeof STATUS_LABELS] || String(v);
                              }
                              if (k.endsWith('Id') && String(v).length > 10) {
                                const loc = getLocationById(String(v));
                                if (loc) display = loc.code;
                                const u = getUserById(String(v));
                                if (u) display = u.displayName;
                              }
                              if (k === 'rolledBackTransferType') {
                                display = TRANSFER_TYPE_LABELS[v as TransferType] || String(v);
                              }
                              return (
                                <span
                                  key={k}
                                  className={`text-xs px-2 py-0.5 rounded border ${
                                    k === 'reason'
                                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                                      : 'bg-slate-50 border-slate-200'
                                  }`}
                                >
                                  {k}: {display}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {logs.length > 100 && (
              <div className="mt-4 text-center text-sm text-slate-500">
                仅展示前 100 条记录，请使用筛选缩小范围
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
