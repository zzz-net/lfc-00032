import { useEffect, useState } from 'react';
import { ArrowDownToLine, CheckCircle2, Loader2, FlaskConical } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { Sample, Location } from '@shared/types';

interface Props {
  onSuccess?: () => void;
}

export const InboundFlow = ({ onSuccess }: Props) => {
  const samples = useAppStore((s) => s.samples);
  const locations = useAppStore((s) => s.locations);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const performInbound = useAppStore((s) => s.performInbound);
  const error = useAppStore((s) => s.error);

  const [selectedSample, setSelectedSample] = useState<string>('');
  const [selectedLocation, setSelectedLocation] = useState<string>('');
  const [remark, setRemark] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const availableSamples = samples.filter((s) => s.currentStatus === 'imported');
  const storageLocations = locations.filter(
    (l) => l.type === 'storage' && l.status === 'active'
  );

  const sample = selectedSample ? getSampleById(selectedSample) : undefined;

  const handleSubmit = async () => {
    if (!selectedSample || !selectedLocation) return;
    setLoading(true);
    setSuccess(false);
    const result = await performInbound(selectedSample, selectedLocation, remark || undefined);
    setLoading(false);
    if (result) {
      setSuccess(true);
      setSelectedSample('');
      setSelectedLocation('');
      setRemark('');
      setTimeout(() => setSuccess(false), 2000);
      onSuccess?.();
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">入库登记</h1>
        <p className="text-slate-500 mt-1">将待入库样本登记到指定存储库位</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6 space-y-5">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
            <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">1</div>
            选择入库样本
          </div>
          <div>
            <label className="label-text">待入库样本 <span className="text-rose-500">*</span></label>
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
              共 {availableSamples.length} 个样本待入库
            </p>
          </div>

          {sample && (
            <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-slate-900">{sample.sampleNo}</span>
                <StatusBadge status={sample.currentStatus} />
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-slate-500">类型：</span>
                  {sample.type}
                </div>
                <div>
                  <span className="text-slate-500">采集人：</span>
                  {sample.collectedBy}
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-slate-500 mb-2 pt-2">
            <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">2</div>
            选择目标库位
          </div>
          <div>
            <label className="label-text">存储库位 <span className="text-rose-500">*</span></label>
            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="input-field"
            >
              <option value="">请选择库位...</option>
              {storageLocations.map((l) => {
                const occupancy = samples.filter((s) => s.currentLocationId === l.id).length;
                const available = l.capacity - occupancy;
                return (
                  <option key={l.id} value={l.id} disabled={available <= 0}>
                    {l.code} - {l.name} (剩余 {available}/{l.capacity})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex items-center gap-2 text-sm text-slate-500 mb-2 pt-2">
            <div className="w-6 h-6 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-semibold">3</div>
            提交入库
          </div>
          <div>
            <label className="label-text">备注说明</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              className="input-field min-h-[80px] resize-none"
              placeholder="入库相关备注信息..."
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
              入库成功！
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
                <ArrowDownToLine className="w-4 h-4 mr-2" />
                确认入库
              </>
            )}
          </button>
        </div>

        <div className="glass-card p-6">
          <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4">操作说明</h2>
          <div className="space-y-4 text-sm text-slate-600">
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 font-semibold text-sm">
                1
              </div>
              <p>从列表中选择一个"待入库"状态的样本</p>
            </div>
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 font-semibold text-sm">
                2
              </div>
              <p>选择一个启用状态的存储类型库位，需确保库位未满</p>
            </div>
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 font-semibold text-sm">
                3
              </div>
              <p>系统会自动校验样本状态、库位状态和容量</p>
            </div>
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center shrink-0 font-semibold text-sm">
                4
              </div>
              <p>确认后样本状态变为"在库"，当前持有人为操作人</p>
            </div>
          </div>

          <div className="mt-6 p-4 rounded-lg bg-amber-50 border border-amber-200">
            <p className="text-sm text-amber-800 font-medium mb-2">校验规则</p>
            <ul className="text-xs text-amber-700 space-y-1 list-disc list-inside">
              <li>样本必须处于"待入库"状态</li>
              <li>目标库位必须是存储类型且已启用</li>
              <li>目标库位剩余容量必须大于0</li>
              <li>只有库管员可以执行入库操作</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
