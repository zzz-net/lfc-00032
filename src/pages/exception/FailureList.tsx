import { useEffect } from 'react';
import { FileX2, User, Clock, AlertCircle } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { TRANSFER_TYPE_LABELS, ROLE_LABELS } from '@shared/constants';

const formatDate = (iso: string) => new Date(iso).toLocaleString('zh-CN');

export const FailureList = () => {
  const failedTransfers = useAppStore((s) => s.failedTransfers);
  const getUserById = useAppStore((s) => s.getUserById);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getFailedTransfers = useAppStore((s) => s.getFailedTransfers);

  useEffect(() => {
    getFailedTransfers();
  }, [getFailedTransfers]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">失败记录</h1>
        <p className="text-slate-500 mt-1">所有失败的交接尝试记录，包含错误原因和操作详情</p>
      </div>

      <div className="glass-card overflow-hidden">
        {failedTransfers.length === 0 ? (
          <div className="p-12 text-center">
            <FileX2 className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500">暂无失败记录</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-container">
              <thead className="table-header">
                <tr>
                  <th className="table-header-cell">时间</th>
                  <th className="table-header-cell">样本</th>
                  <th className="table-header-cell">操作类型</th>
                  <th className="table-header-cell">操作人</th>
                  <th className="table-header-cell">错误码</th>
                  <th className="table-header-cell">错误信息</th>
                  <th className="table-header-cell">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {failedTransfers.map((f) => {
                  const sample = getSampleById(f.sampleId);
                  const user = getUserById(f.attemptedBy);
                  return (
                    <tr key={f.id} className="table-row bg-rose-50/30">
                      <td className="table-cell text-slate-500 text-xs whitespace-nowrap">
                        {formatDate(f.attemptedAt)}
                      </td>
                      <td className="table-cell font-medium">
                        {sample?.sampleNo || f.sampleId}
                      </td>
                      <td className="table-cell">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                          {TRANSFER_TYPE_LABELS[f.attemptedType]}
                        </span>
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>{user?.displayName || '-'}</span>
                          {user && (
                            <span className="text-xs text-slate-400">({ROLE_LABELS[user.role]})</span>
                          )}
                        </div>
                      </td>
                      <td className="table-cell">
                        <code className="text-xs bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded">
                          {f.errorCode}
                        </code>
                      </td>
                      <td className="table-cell text-slate-700 max-w-xs">
                        <div className="flex items-start gap-1.5">
                          <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                          <span className="text-sm">{f.errorMessage}</span>
                        </div>
                      </td>
                      <td className="table-cell">
                        {f.resolved ? (
                          <span className="badge bg-emerald-50 text-emerald-700 border-emerald-200">
                            已处理
                          </span>
                        ) : (
                          <span className="badge bg-amber-50 text-amber-700 border-amber-200">
                            待处理
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-sm text-slate-500">
          共 {failedTransfers.length} 条记录
        </div>
      </div>
    </div>
  );
};
