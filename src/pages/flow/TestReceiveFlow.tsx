import { useState } from 'react';
import { FlaskRound, CheckCircle2, Loader2, MapPin, User } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';

export const TestReceiveFlow = () => {
  const samples = useAppStore((s) => s.samples);
  const locations = useAppStore((s) => s.locations);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getUserById = useAppStore((s) => s.getUserById);
  const performTestReceive = useAppStore((s) => s.performTestReceive);
  const error = useAppStore((s) => s.error);

  const [selectedSample, setSelectedSample] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const availableSamples = samples.filter((s) => s.currentStatus === 'in_transit');
  const testingLocations = locations.filter(
    (l) => l.type === 'testing' && l.status === 'active'
  );

  const sample = selectedSample ? getSampleById(selectedSample) : undefined;
  const sender = sample?.currentHolderId ? getUserById(sample.currentHolderId) : undefined;

  const handleSubmit = async () => {
    if (!selectedSample || !selectedLocation) return;
    setLoading(true);
    setSuccess(false);
    const result = await performTestReceive(selectedSample, selectedLocation, remark || undefined);
    setLoading(false);
    if (result) {
      setSuccess(true);
      setSelectedSample('');
      setSelectedLocation('');
      setRemark('');
      setTimeout(() => setSuccess(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">检测接收</h1>
        <p className="text-slate-500 mt-1">接收送检中的样本并分配到检测区域</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 space-y-5">
          <div>
            <label className="label-text">送检中样本 <span className="text-rose-500">*</span></label>
            <select
              value={selectedSample}
              onChange={(e) => setSelectedSample(e.target.value)}
              className="input-field"
            >
              <option value="">请选择样本...</option>
              {availableSamples.map((s) => {
                const holder = s.currentHolderId ? getUserById(s.currentHolderId) : null;
                return (
                  <option key={s.id} value={s.id}>
                    {s.sampleNo} - {s.type} [{holder?.displayName || '未指定'}]
                  </option>
                );
              })}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              共 {availableSamples.length} 个样本待接收
            </p>
          </div>

          {sample && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-900">{sample.sampleNo}</span>
                <StatusBadge status={sample.currentStatus} />
              </div>
              {sender && (
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <User className="w-4 h-4" />
                  送件人：{sender.displayName}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="label-text">检测区域 <span className="text-rose-500">*</span></label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="input-field"
            >
              <option value="">请选择检测区域...</option>
              {testingLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} - {l.name}
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
              placeholder="接收相关备注..."
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
              检测接收成功！
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading || !selectedSample || !selectedLocation}
            className="btn-primary w-full"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                处理中...
              </>
            ) : (
              <>
                <FlaskRound className="w-4 h-4 mr-2" />
                确认接收
              </>
            )}
          </button>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4">校验规则</h2>
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">样本状态</p>
              <p className="text-xs text-slate-600 mt-1">样本必须处于"送检中"状态</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">角色权限</p>
              <p className="text-xs text-slate-600 mt-1">只有检测员可以执行接收操作</p>
            </div>
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <p className="text-sm font-medium text-slate-800">目标区域</p>
              <p className="text-xs text-slate-600 mt-1">目标库位必须是检测区域类型</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
