import { useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Loader2, User, MapPin } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';

export const OutboundFlow = () => {
  const samples = useAppStore((s) => s.samples);
  const locations = useAppStore((s) => s.locations);
  const users = useAppStore((s) => s.users);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getLocationById = useAppStore((s) => s.getLocationById);
  const performOutbound = useAppStore((s) => s.performOutbound);
  const error = useAppStore((s) => s.error);

  const [selectedSample, setSelectedSample] = useState('');
  const [sourceLocation, setSourceLocation] = useState('');
  const [receiver, setReceiver] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const availableSamples = samples.filter((s) => s.currentStatus === 'in_stock');
  const testers = users.filter((u) => u.role === 'tester' || u.role === 'admin');

  const sample = selectedSample ? getSampleById(selectedSample) : undefined;
  const sampleLocation = sample?.currentLocationId ? getLocationById(sample.currentLocationId) : undefined;

  const handleSubmit = async () => {
    if (!selectedSample || !sourceLocation || !receiver) return;
    setLoading(true);
    setSuccess(false);
    const result = await performOutbound(selectedSample, sourceLocation, receiver, remark || undefined);
    setLoading(false);
    if (result) {
      setSuccess(true);
      setSelectedSample('');
      setSourceLocation('');
      setReceiver('');
      setRemark('');
      setTimeout(() => setSuccess(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">出库交接</h1>
        <p className="text-slate-500 mt-1">将在库样本出库交接给检测人员</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 space-y-5">
          <div>
            <label className="label-text">在库样本 <span className="text-rose-500">*</span></label>
            <select
              value={selectedSample}
              onChange={(e) => setSelectedSample(e.target.value)}
              className="input-field"
            >
              <option value="">请选择样本...</option>
              {availableSamples.map((s) => {
                const loc = s.currentLocationId ? getLocationById(s.currentLocationId) : null;
                return (
                  <option key={s.id} value={s.id}>
                    {s.sampleNo} - {s.type} [{loc?.code || '-'}]
                  </option>
                );
              })}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              共 {availableSamples.length} 个样本在库
            </p>
          </div>

          {sample && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{sample.sampleNo}</span>
                <StatusBadge status={sample.currentStatus} />
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <MapPin className="w-4 h-4" />
                {sampleLocation ? `${sampleLocation.code} - ${sampleLocation.name}` : '未知库位'}
              </div>
            </div>
          )}

          <div>
            <label className="label-text">转出确认库位 <span className="text-rose-500">*</span></label>
            <select
              value={sourceLocation}
              onChange={(e) => setSourceLocation(e.target.value)}
              className="input-field"
            >
              <option value="">请确认样本所在库位...</option>
              {locations
                .filter((l) => l.type === 'storage' && l.status === 'active')
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} - {l.name}
                  </option>
                ))}
            </select>
            <p className="text-xs text-amber-600 mt-1">
              必须与样本当前实际库位一致
            </p>
          </div>

          <div>
            <label className="label-text">检测接收人 <span className="text-rose-500">*</span></label>
            <select
              value={receiver}
              onChange={(e) => setReceiver(e.target.value)}
              className="input-field"
            >
              <option value="">请选择接收人...</option>
              {testers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} ({u.username})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text">备注说明</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="input-field min-h-[80px] resize-none"
              placeholder="交接相关备注..."
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
              出库交接成功！
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !selectedSample || !sourceLocation || !receiver}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <ArrowRightLeft className="w-4 h-4 mr-2" />
                确认出库交接
              </>
            )}
          </button>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4">校验规则</h2>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">样本状态</p>
              <p className="text-xs text-slate-600 mt-1">样本必须处于"在库"状态</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-sm font-medium text-amber-800">库位一致性</p>
              <p className="text-xs text-amber-700 mt-1">
                选择的转出库位必须与样本实际库位一致，从错误库位转出将被拒绝
              </p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">持有人校验</p>
              <p className="text-xs text-slate-600 mt-1">操作人必须是样本当前持有人</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">接收人角色</p>
              <p className="text-xs text-slate-600 mt-1">接收人必须是检测员角色</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
