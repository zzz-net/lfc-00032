import { useState } from 'react';
import { FileCheck2, CheckCircle2, Loader2, User, MapPin } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';

export const TestCompleteFlow = () => {
  const samples = useAppStore((s) => s.samples);
  const currentUser = useAppStore((s) => s.currentUser);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getUserById = useAppStore((s) => s.getUserById);
  const getLocationById = useAppStore((s) => s.getLocationById);
  const performTestComplete = useAppStore((s) => s.performTestComplete);
  const error = useAppStore((s) => s.error);

  const [selectedSample, setSelectedSample] = useState('');
  const [testResult, setTestResult] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const availableSamples = samples.filter(
    (s) => s.currentStatus === 'testing' && (!s.currentHolderId || s.currentHolderId === currentUser?.id || currentUser?.role === 'admin')
  );

  const sample = selectedSample ? getSampleById(selectedSample) : undefined;
  const holder = sample?.currentHolderId ? getUserById(sample.currentHolderId) : undefined;
  const location = sample?.currentLocationId ? getLocationById(sample.currentLocationId) : undefined;

  const handleSubmit = async () => {
    if (!selectedSample || !testResult.trim()) return;
    setLoading(true);
    setSuccess(false);
    const result = await performTestComplete(selectedSample, testResult.trim(), remark || undefined);
    setLoading(false);
    if (result) {
      setSuccess(true);
      setSelectedSample('');
      setTestResult('');
      setRemark('');
      setTimeout(() => setSuccess(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">检测完成</h1>
        <p className="text-slate-500 mt-1">录入检测结果并完成检测交接</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 space-y-5">
          <div>
            <label className="label-text">检测中样本 <span className="text-rose-500">*</span></label>
            <select
              value={selectedSample}
              onChange={(e) => setSelectedSample(e.target.value)}
              className="input-field"
            >
              <option value="">请选择样本...</option>
              {availableSamples.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sampleNo} - {s.type}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              您当前持有 {availableSamples.length} 个检测中样本
            </p>
          </div>

          {sample && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{sample.sampleNo}</span>
                <StatusBadge status={sample.currentStatus} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-1.5 text-slate-600">
                  <User className="w-4 h-4 text-slate-400" />
                  {holder?.displayName || '-'}
                </div>
                <div className="flex items-center gap-1.5 text-slate-600">
                  <MapPin className="w-4 h-4 text-slate-400" />
                  {location?.code || '-'}
                </div>
              </div>
            </div>
          )}

          <div>
            <label className="label-text">检测结果 <span className="text-rose-500">*</span></label>
            <textarea
              value={testResult}
              onChange={(e) => setTestResult(e.target.value)}
              className="input-field min-h-[120px] resize-none"
              placeholder="请录入详细的检测结果..."
            />
          </div>

          <div>
            <label className="label-text">备注说明</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="input-field min-h-[60px] resize-none"
              placeholder="其他备注信息..."
            />
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
              {error}
            </div>
          )}

          {success && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" />
              检测完成提交成功！
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !selectedSample || !testResult.trim()}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <FileCheck2 className="w-4 h-4 mr-2" />
                提交检测完成
              </>
            )}
          </button>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4">校验规则</h2>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">样本状态</p>
              <p className="text-xs text-slate-600 mt-1">样本必须处于"检测中"状态</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">持有人校验</p>
              <p className="text-xs text-amber-700 mt-1">
                只有当前样本持有人才可以提交检测完成
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">检测结果</p>
              <p className="text-xs text-slate-600 mt-1">必须填写检测结果内容</p>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-lg bg-blue-50 border border-blue-200">
            <p className="text-sm text-blue-800 font-medium mb-1">后续流程</p>
            <p className="text-xs text-blue-700">
              检测完成后，样本需经过审核员复核才能进行最终归档。
              未复核的样本无法执行归档操作。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
