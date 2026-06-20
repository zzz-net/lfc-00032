import { useState } from 'react';
import { FileCheck2, CheckCircle2, Loader2, ShieldCheck, User, Archive } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';

export const ArchiveFlow = () => {
  const samples = useAppStore((s) => s.samples);
  const locations = useAppStore((s) => s.locations);
  const currentUser = useAppStore((s) => s.currentUser);
  const getSampleById = useAppStore((s) => s.getSampleById);
  const getUserById = useAppStore((s) => s.getUserById);
  const performReview = useAppStore((s) => s.performReview);
  const performArchive = useAppStore((s) => s.performArchive);
  const storeError = useAppStore((s) => s.error);

  const [tab, setTab] = useState('review');
  const [reviewSample, setReviewSample] = useState('');
  const [reviewRemark, setReviewRemark] = useState('');
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewSuccess, setReviewSuccess] = useState(false);

  const [archiveSample, setArchiveSample] = useState('');
  const [archiveLocation, setArchiveLocation] = useState('');
  const [archiveRemark, setArchiveRemark] = useState('');
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveSuccess, setArchiveSuccess] = useState(false);
  const [error, setError] = useState('');

  const reviewable = samples.filter((s) => s.currentStatus === 'tested' && !s.reviewedBy);
  const archivable = samples.filter(
    (s) => s.currentStatus === 'tested' && s.reviewedBy && !s.isArchived
  );

  const archiveLocations = locations.filter(
    (l) => l.type === 'archive' && l.status === 'active'
  );

  const rSample = reviewSample ? getSampleById(reviewSample) : undefined;
  const aSample = archiveSample ? getSampleById(archiveSample) : undefined;
  const reviewer = aSample?.reviewedBy ? getUserById(aSample.reviewedBy) : undefined;

  const handleReview = async () => {
    if (!reviewSample) return;
    setReviewLoading(true);
    setError('');
    const result = await performReview(reviewSample, reviewRemark || undefined);
    setReviewLoading(false);
    if (result) {
      setReviewSuccess(true);
      setReviewSample('');
      setReviewRemark('');
      setTimeout(() => setReviewSuccess(false), 2000);
    } else {
      setError(storeError || '');
    }
  };

  const handleArchive = async () => {
    if (!archiveSample || !archiveLocation) return;
    setArchiveLoading(true);
    setError('');
    const result = await performArchive(archiveSample, archiveLocation, archiveRemark || undefined);
    setArchiveLoading(false);
    if (result) {
      setArchiveSuccess(true);
      setArchiveSample('');
      setArchiveLocation('');
      setArchiveRemark('');
      setTimeout(() => setArchiveSuccess(false), 2000);
    } else {
      setError(storeError || '');
    }
  };

  interface TabBtnProps {
    active: boolean;
    label: string;
  }

  const TabButton = ({ active, label }: TabBtnProps) => {
    const displayLabel = label === 'review' ? '样本复核' : '最终归档';
    return (
      <button
        onClick={() => setTab(label)}
        className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
          tab === label
            ? 'bg-brand-600 text-white shadow-sm'
            : 'text-slate-600 hover:bg-slate-100'
        }`}
      >
        {displayLabel}
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">归档复核</h1>
        <p className="text-slate-500 mt-1">对检测完成样本进行复核和最终归档</p>
      </div>

      <div className="flex gap-2">
        <TabButton active={tab === 'review'} label="review" />
        <TabButton active={tab === 'archive'} label="archive" />
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700">
          {error}
        </div>
      )}

      {tab === 'review' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 space-y-5">
            <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
              <ShieldCheck className="w-5 h-5 text-brand-600" />
              <span className="font-medium text-slate-900">样本复核</span>
            </div>
            <p className="text-xs text-slate-500">
              审核员对检测完成的样本进行复核，确认检测结果无误
            </p>

            <div>
              <label className="label-text">
                待复核样本 <span className="text-rose-500">*</span>
              </label>
              <select
                value={reviewSample}
                onChange={(e) => setReviewSample(e.target.value)}
                className="input-field"
              >
                <option value="">请选择样本...</option>
                {reviewable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sampleNo} - {s.type}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                共 {reviewable.length} 个样本待复核
              </p>
            </div>

            {rSample && (
              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{rSample.sampleNo}</span>
                  <StatusBadge status={rSample.currentStatus} />
                </div>
                <p className="text-sm text-slate-600">类型：{rSample.type}</p>
                <p className="text-sm text-slate-600">采集人：{rSample.collectedBy}</p>
              </div>
            )}

            <div>
              <label className="label-text">复核意见</label>
              <textarea
                value={reviewRemark}
                onChange={(e) => setReviewRemark(e.target.value)}
                className="input-field min-h-[80px] resize-none"
                placeholder="复核意见..."
              />
            </div>

            {reviewSuccess && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                复核成功！
              </div>
            )}

            <button
              onClick={handleReview}
              disabled={
                reviewLoading ||
                !reviewSample ||
                (currentUser?.role !== 'auditor' && currentUser?.role !== 'admin')
              }
              className="btn-primary w-full"
            >
              {reviewLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4 mr-2" />
                  确认复核
                </>
              )}
            </button>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4">校验规则</h2>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-sm font-medium text-slate-800">样本状态</p>
                <p className="text-xs text-slate-600 mt-1">样本必须处于"检测完成"状态</p>
              </div>
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-sm font-medium text-slate-800">角色权限</p>
                <p className="text-xs text-slate-600 mt-1">只有审核员可以执行复核操作</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm font-medium text-amber-800">归档前置条件</p>
                <p className="text-xs text-amber-700 mt-1">
                  未复核的样本无法归档，复核是归档的必要前置步骤
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 space-y-5">
            <div className="flex items-center gap-2 text-sm text-slate-600 mb-1">
              <Archive className="w-5 h-5 text-emerald-600" />
              <span className="font-medium text-slate-900">最终归档</span>
            </div>
            <p className="text-xs text-slate-500">
              对已复核样本执行最终归档，归档后样本将被锁定，禁止任何编辑
            </p>

            <div>
              <label className="label-text">
                已复核待归档样本 <span className="text-rose-500">*</span>
              </label>
              <select
                value={archiveSample}
                onChange={(e) => setArchiveSample(e.target.value)}
                className="input-field"
              >
                <option value="">请选择样本...</option>
                {archivable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.sampleNo} - {s.type}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1">
                共 {archivable.length} 个样本待归档
              </p>
            </div>

            {aSample && (
              <div className="p-4 rounded-lg bg-violet-50 border border-violet-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{aSample.sampleNo}</span>
                  <StatusBadge status={aSample.currentStatus} />
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <ShieldCheck className="w-4 h-4" />
                  复核人：{reviewer?.displayName || '-'}
                </div>
                {aSample.reviewedAt && (
                  <p className="text-xs text-slate-500">
                    复核时间：{new Date(aSample.reviewedAt).toLocaleString('zh-CN')}
                  </p>
                )}
              </div>
            )}

            <div>
              <label className="label-text">
                归档库位 <span className="text-rose-500">*</span>
              </label>
              <select
                value={archiveLocation}
                onChange={(e) => setArchiveLocation(e.target.value)}
                className="input-field"
              >
                <option value="">请选择归档区域...</option>
                {archiveLocations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.code} - {l.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label-text">归档备注</label>
              <textarea
                value={archiveRemark}
                onChange={(e) => setArchiveRemark(e.target.value)}
                className="input-field min-h-[60px] resize-none"
                placeholder="归档相关备注..."
              />
            </div>

            {archiveSuccess && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-700 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                归档成功！样本已锁定。
              </div>
            )}

            <button
              onClick={handleArchive}
              disabled={
                archiveLoading ||
                !archiveSample ||
                !archiveLocation ||
                (currentUser?.role !== 'auditor' && currentUser?.role !== 'admin')
              }
              className="btn-primary w-full"
            >
              {archiveLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  处理中...
                </>
              ) : (
                <>
                  <Archive className="w-4 h-4 mr-2" />
                  确认归档（锁定）
                </>
              )}
            </button>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4">校验规则</h2>
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-sm font-medium text-slate-800">复核校验</p>
                <p className="text-xs text-slate-600 mt-1">样本必须经过审核员复核</p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-sm font-medium text-amber-800">未复核拒绝归档</p>
                <p className="text-xs text-amber-700 mt-1">未复核的样本会被拒绝归档</p>
              </div>
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200">
                <p className="text-sm font-medium text-rose-800">归档后锁定</p>
                <p className="text-xs text-rose-700 mt-1">归档后样本被锁定，普通编辑将被拒绝</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
