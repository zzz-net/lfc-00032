import { useEffect, useState } from 'react';
import { RotateCcw, AlertTriangle, CheckCircle2, Loader2, Clock, User } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Modal } from '@/components/common/Modal';
import { TRANSFER_TYPE_LABELS, TRANSFER_TYPE_COLORS } from '@shared/constants';
import type { TransferRecord } from '@shared/types';

const formatDate = (iso: string) => new Date(iso).toLocaleString('zh-CN');

export const RollbackPage = () => {
  const samples = useAppStore((s) => s.samples);
  const currentUser = useAppStore((s) => s.currentUser);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getUserById = useAppStore((s) => s.getUserById);
  const getTransferRecordsBySample = useAppStore((s) => s.getTransferRecordsBySample);
  const performRollback = useAppStore((s) => s.performRollback);
  const storeError = useAppStore((s) => s.error);

  const [selectedSample, setSelectedSample] = useState('');
  const [transfers, setTransfers] = useState<TransferRecord[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [targetTransfer, setTargetTransfer] = useState<TransferRecord | null>(null);
  const [rollbackReason, setRollbackReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  const nonArchivedSamples = samples.filter((s) => !s.isArchived);

  useEffect(() => {
    if (selectedSample) {
      getTransferRecordsBySample(selectedSample).then((list) =>
        setTransfers(list.filter((t) => t.type !== 'import').reverse())
      );
    } else {
      setTransfers([]);
    }
  }, [selectedSample, getTransferRecordsBySample, success]);

  const sample = selectedSample ? getSampleById(selectedSample) : undefined;

  const openRollback = (t: TransferRecord) => {
    setTargetTransfer(t);
    setRollbackReason('');
    setError('');
    setShowModal(true);
  };

  const handleRollback = async () => {
    if (!targetTransfer || !rollbackReason.trim()) return;
    setLoading(true);
    setError('');
    const result = await performRollback(targetTransfer.id, rollbackReason.trim());
    setLoading(false);
    if (result) {
      setSuccess(true);
      setShowModal(false);
      setTargetTransfer(null);
      setTimeout(() => setSuccess(false), 3000);
    } else {
      setError(storeError || '回退失败');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">异常回退</h1>
        <p className="text-slate-500 mt-1">回退错误的流转操作，恢复到上一状态</p>
      </div>

      <div className="glass-card p-5 border-amber-200 bg-amber-50/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium mb-1">重要提示</p>
            <ul className="list-disc list-inside space-y-0.5 text-xs">
              <li>回退操作仅限审核员和管理员执行</li>
              <li>只能回退未被回退过的交接记录</li>
              <li>批次导入记录不可回退</li>
              <li>回退会被完整记录在审计链路中</li>
              <li>回退不存在的交接记录将被拒绝</li>
            </ul>
          </div>
        </div>
      </div>

      {success && (
        <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5" />
          回退成功！样本状态已恢复，审计链路已记录。
        </div>
      )}

      <div className="glass-card p-6 space-y-5">
        <div>
          <label className="label-text">选择样本</label>
          <select
            value={selectedSample}
            onChange={(e) => setSelectedSample(e.target.value)}
            className="input-field"
          >
            <option value="">请选择需要回退操作的样本...</option>
            {nonArchivedSamples.map((s) => (
              <option key={s.id} value={s.id}>
                {s.sampleNo} - {s.type}
              </option>
            ))}
          </select>
        </div>

        {sample && (
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-slate-900">{sample.sampleNo}</span>
                <StatusBadge status={sample.currentStatus} />
              </div>
              <p className="text-xs text-slate-500 mt-1">{sample.type}</p>
            </div>
            <div className="text-xs text-slate-500 text-right">
              <div>创建: {formatDate(sample.createdAt)}</div>
              <div>更新: {formatDate(sample.updatedAt)}</div>
            </div>
          </div>
        )}

        {selectedSample && (
          <div>
            <p className="label-text mb-3">流转记录（最新在前）</p>
            {transfers.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-sm">
                暂无可回退的流转记录
              </div>
            ) : (
              <div className="space-y-3">
                {transfers.map((t) => {
                  const operator = getUserById(t.operatorId);
                  const canRollback =
                    !t.isRolledBack &&
                    t.type !== 'import' &&
                    t.toStatus === sample?.currentStatus &&
                    (currentUser?.role === 'auditor' || currentUser?.role === 'admin');
                  return (
                    <div
                      key={t.id}
                      className={`p-4 rounded-lg border ${
                        t.isRolledBack
                          ? 'bg-slate-50 border-slate-200 opacity-60'
                          : canRollback
                          ? 'bg-white border-slate-200 hover:border-rose-200 hover:bg-rose-50/30'
                          : 'bg-white border-slate-200'
                      } transition-all`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white ${TRANSFER_TYPE_COLORS[t.type]}`}
                            >
                              {TRANSFER_TYPE_LABELS[t.type]}
                            </span>
                            <span className="text-xs text-slate-500">
                              <Clock className="w-3 h-3 inline mr-1" />
                              {formatDate(t.operatedAt)}
                            </span>
                            {t.isRolledBack && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-600">
                                <RotateCcw className="w-3 h-3 mr-1" />
                                已回退
                              </span>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-slate-500">操作人：</span>
                              {operator?.displayName || '-'}
                            </div>
                            <div>
                              <span className="text-slate-500">状态：</span>
                              {t.fromStatus || '-'} → {t.toStatus}
                            </div>
                          </div>
                          {t.testResult && (
                            <p className="text-xs text-slate-600 mt-2">
                              检测结果：{t.testResult}
                            </p>
                          )}
                          {t.remark && (
                            <p className="text-xs text-slate-600 mt-1">备注：{t.remark}</p>
                          )}
                          {t.isRolledBack && t.rollbackReason && (
                            <p className="text-xs text-rose-600 mt-2 p-2 bg-rose-50 rounded">
                              回退原因：{t.rollbackReason}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => openRollback(t)}
                          disabled={!canRollback}
                          className="btn-danger text-xs shrink-0 disabled:opacity-50"
                        >
                          <RotateCcw className="w-3 h-3 mr-1" />
                          回退
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title="确认回退操作"
        size="md"
        footer={
          <>
            <button onClick={() => setShowModal(false)} className="btn-secondary" disabled={loading}>
              取消
            </button>
            <button onClick={handleRollback} className="btn-danger" disabled={loading || !rollbackReason.trim()}>
              {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              确认回退
            </button>
          </>
        }
      >
        {targetTransfer && (
          <div className="space-y-4">
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200">
              <p className="text-sm text-rose-800 font-medium mb-1">⚠️ 警告</p>
              <p className="text-xs text-rose-700">
                即将回退「{TRANSFER_TYPE_LABELS[targetTransfer.type]}」操作，
                样本状态将从「{targetTransfer.toStatus}」恢复到上一状态。
                此操作不可撤销，请谨慎操作。
              </p>
            </div>
            <div>
              <label className="label-text">回退原因 <span className="text-rose-500">*</span></label>
              <textarea
                value={rollbackReason}
                onChange={(e) => setRollbackReason(e.target.value)}
                className="input-field min-h-[100px] resize-none"
                placeholder="请填写回退原因（将记录到审计链路中）..."
              />
            </div>
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
                {error}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
