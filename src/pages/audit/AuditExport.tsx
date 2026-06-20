import { useState } from 'react';
import { Download, FileJson, FileSpreadsheet, Loader2, CheckCircle2, Calendar, User, ArrowRightLeft } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { AuditExportFormat, AuditTimelineFilter, TransferType } from '@shared/types';
import { TRANSFER_TYPE_LABELS } from '@shared/constants';

export const AuditExport = () => {
  const users = useAppStore((s) => s.users);
  const exportAuditData = useAppStore((s) => s.exportAuditData);

  const [format, setFormat] = useState<AuditExportFormat>('csv');
  const [userFilter, setUserFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const transferTypes: TransferType[] = [
    'import', 'inbound', 'outbound', 'test_receive', 'test_complete', 'archive', 'rollback'
  ];

  const handleExport = async () => {
    setLoading(true);
    setSuccess(false);

    try {
      const filter: AuditTimelineFilter = {};
      if (userFilter) filter.userId = userFilter;
      if (fromDate) filter.fromDate = fromDate;
      if (toDate) filter.toDate = toDate;
      if (typeFilter) filter.transferType = typeFilter as TransferType;

      const data = await exportAuditData(format, filter);
      const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const filename = `sample_tracking_audit_${timestamp}.${format}`;

      let blob: Blob;
      let mimeType: string;

      if (format === 'json') {
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

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">审计导出</h1>
        <p className="text-slate-500 mt-1">导出完整的样本流转审计链路，包含所有交接记录和操作者信息</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 space-y-5">
          <div>
            <label className="label-text">导出格式</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setFormat('csv')}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                  format === 'csv'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <FileSpreadsheet className={`w-8 h-8 ${format === 'csv' ? 'text-brand-600' : 'text-slate-400'}`} />
                <div className="text-left">
                  <p className={`font-medium ${format === 'csv' ? 'text-brand-700' : 'text-slate-700'}`}>CSV 格式</p>
                  <p className="text-xs text-slate-500">适合 Excel 打开</p>
                </div>
              </button>
              <button
                onClick={() => setFormat('json')}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 transition-all ${
                  format === 'json'
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <FileJson className={`w-8 h-8 ${format === 'json' ? 'text-brand-600' : 'text-slate-400'}`} />
                <div className="text-left">
                  <p className={`font-medium ${format === 'json' ? 'text-brand-700' : 'text-slate-700'}`}>JSON 格式</p>
                  <p className="text-xs text-slate-500">适合程序处理</p>
                </div>
              </button>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-5">
            <p className="text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-slate-500" />
              筛选条件（可选）
            </p>
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="label-text text-xs">操作者</label>
                <select
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="input-field text-sm"
                >
                  <option value="">全部操作者</option>
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
                  <option value="">全部类型</option>
                  {transferTypes.map((t) => (
                    <option key={t} value={t}>{TRANSFER_TYPE_LABELS[t]}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {success && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              导出成功！
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={loading}
            className="btn-primary w-full h-11 text-base"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download className="w-5 h-5 mr-2" />
                导出审计数据
              </>
            )}
          </button>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4">导出内容说明</h2>
          <div className="space-y-3 text-sm text-slate-600">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="font-medium text-slate-800 flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-brand-600" />
                完整流转记录
              </p>
              <ul className="text-xs text-slate-600 mt-2 space-y-1 list-disc list-inside">
                <li>样本编号、操作类型、状态变更</li>
                <li>库位变更（来源库位、目标库位）</li>
                <li>持有人变更（原持有人、新持有人）</li>
                <li>操作人、操作时间</li>
                <li>检测结果、备注</li>
              </ul>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="font-medium text-slate-800 flex items-center gap-2">
                <User className="w-4 h-4 text-brand-600" />
                回退与异常记录
              </p>
              <ul className="text-xs text-slate-600 mt-2 space-y-1 list-disc list-inside">
                <li>是否已回退标记</li>
                <li>回退操作人、回退时间</li>
                <li>回退原因记录</li>
                <li>失败交接记录（错误码、错误信息）</li>
              </ul>
            </div>
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200">
              <p className="font-medium text-emerald-800">数据完整性</p>
              <p className="text-xs text-emerald-700 mt-1">
                导出文件包含完整的审计链路，回退操作、失败记录、恢复记录均会完整保留，
                即使回退并重启后数据依然完整。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
