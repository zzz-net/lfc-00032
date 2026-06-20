import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FlaskConical,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import type { SampleImportRow, ImportResult } from '@shared/types';
import { STATUS_LABELS } from '@shared/constants';
import Papa from 'papaparse';

export const SampleImport = () => {
  const importCSVFile = useAppStore((s) => s.importCSVFile);
  const importBatch = useAppStore((s) => s.importBatch);
  const currentUser = useAppStore((s) => s.currentUser);

  const [batchNo, setBatchNo] = useState(`BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-001`);
  const [remark, setRemark] = useState('');
  const [previewRows, setPreviewRows] = useState<SampleImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setResult(null);
    setError('');

    Papa.parse<SampleImportRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rows = results.data.filter(
          (r) => r && typeof r === 'object' && (r.sampleNo || r.type)
        );
        setPreviewRows(rows);
      },
      error: (err) => {
        setError(`解析CSV失败: ${err.message}`);
      },
    });
  };

  const handleJSONPreview = (text: string) => {
    try {
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        setPreviewRows(data);
        setResult(null);
        setError('');
      } else {
        setError('JSON数据必须是数组格式');
      }
    } catch (e) {
      setError('JSON格式无效');
    }
  };

  const handleImport = async (usePreview: boolean) => {
    if (!batchNo.trim()) {
      setError('请输入批次号');
      return;
    }
    if (previewRows.length === 0) {
      setError('没有可导入的样本数据');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const importResult = await importBatch(previewRows, batchNo.trim(), remark || undefined);
      setResult(importResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : '导入失败');
    } finally {
      setLoading(false);
    }
  };

  const sampleFields = [
    { key: 'sampleNo', label: '样本编号', required: true },
    { key: 'type', label: '样本类型', required: true },
    { key: 'collectedAt', label: '采集时间(ISO格式)', required: true },
    { key: 'collectedBy', label: '采集人员', required: true },
    { key: 'description', label: '备注说明', required: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/samples" className="text-slate-500 hover:text-slate-700 flex items-center text-sm">
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回样本列表
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-slate-900 font-serif">批次导入</h1>
        <p className="text-slate-500 mt-1">导入CSV或JSON格式的样本批次数据</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4 flex items-center gap-2">
              <FileText className="w-5 h-5 text-slate-500" />
              批次信息
            </h2>
            <div className="space-y-4">
              <div>
                <label className="label-text">批次号 <span className="text-rose-500">*</span></label>
                <input
                  type="text"
                  value={batchNo}
                  onChange={(e) => setBatchNo(e.target.value)}
                  className="input-field"
                  placeholder="例如：BATCH-20250621-001"
                />
              </div>
              <div>
                <label className="label-text">备注说明</label>
                <textarea
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  className="input-field min-h-[80px] resize-none"
                  placeholder="批次描述、来源等信息..."
                />
              </div>
            </div>
          </div>

          <div className="glass-card p-6">
            <h2 className="text-lg font-semibold text-slate-900 font-serif mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-slate-500" />
              数据文件
            </h2>

            <div className="space-y-4">
              <div>
                <label className="label-text">上传CSV文件</label>
                <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:border-brand-300 hover:bg-brand-50/30 transition-all cursor-pointer">
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="hidden"
                    id="csv-upload"
                  />
                  <label htmlFor="csv-upload" className="cursor-pointer block">
                    <Upload className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                    <p className="text-sm text-slate-600">点击或拖拽CSV文件到此处</p>
                    <p className="text-xs text-slate-400 mt-1">
                      {fileName ? `已选择: ${fileName}` : '支持 .csv 格式'}
                    </p>
                  </label>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                <p className="text-sm font-medium text-slate-700 mb-2">CSV字段格式说明：</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left">
                        <th className="px-2 py-1 text-slate-600 font-medium">字段名</th>
                        <th className="px-2 py-1 text-slate-600 font-medium">说明</th>
                        <th className="px-2 py-1 text-slate-600 font-medium">必填</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleFields.map((f) => (
                        <tr key={f.key} className="border-t border-slate-200">
                          <td className="px-2 py-1 font-mono text-slate-800">{f.key}</td>
                          <td className="px-2 py-1 text-slate-600">{f.label}</td>
                          <td className="px-2 py-1">
                            {f.required ? (
                              <span className="text-rose-500">是</span>
                            ) : (
                              <span className="text-slate-400">否</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  示例：<code className="bg-white px-1.5 py-0.5 rounded border border-slate-200 text-[10px]">
                    sampleNo,type,collectedAt,collectedBy,description
                  </code>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900 font-serif flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-slate-500" />
                数据预览
              </h2>
              <span className="text-sm text-slate-500">共 {previewRows.length} 条</span>
            </div>

            {previewRows.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 text-sm">请先上传CSV文件以预览数据</p>
              </div>
            ) : (
              <div className="max-h-[400px] overflow-auto border border-slate-200 rounded-lg">
                <table className="table-container text-xs">
                  <thead className="table-header sticky top-0">
                    <tr>
                      <th className="table-header-cell text-xs">#</th>
                      {sampleFields.map((f) => (
                        <th key={f.key} className="table-header-cell text-xs">
                          {f.label}
                          {f.required && <span className="text-rose-500 ml-1">*</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {previewRows.slice(0, 50).map((row, idx) => (
                      <tr key={idx} className="table-row">
                        <td className="table-cell text-xs text-slate-500">{idx + 1}</td>
                        {sampleFields.map((f) => (
                          <td key={f.key} className="table-cell text-xs">
                            <span className={f.required && !row[f.key as keyof SampleImportRow] ? 'text-rose-600' : ''}>
                              {String(row[f.key as keyof SampleImportRow] || '-')}
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {previewRows.length > 50 && (
                  <div className="p-2 text-center text-xs text-slate-500 bg-slate-50 border-t border-slate-200">
                    仅显示前50条，共 {previewRows.length} 条
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 rounded-lg bg-rose-50 border border-rose-200 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700">{error}</p>
            </div>
          )}

          {result && (
            <div className={`p-5 rounded-lg border ${result.success ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center gap-2 mb-3">
                {result.success ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                )}
                <span className="font-medium text-slate-900">
                  {result.success ? '导入成功' : '部分导入失败'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-white/60 p-3 rounded">
                  <p className="text-slate-500 text-xs">批次号</p>
                  <p className="font-medium text-slate-900">{result.batchNo || '-'}</p>
                </div>
                <div className="bg-white/60 p-3 rounded">
                  <p className="text-slate-500 text-xs">成功导入</p>
                  <p className="font-medium text-emerald-700">{result.importedCount} 条</p>
                </div>
                <div className="bg-white/60 p-3 rounded col-span-2">
                  <p className="text-slate-500 text-xs mb-1">
                    失败记录 ({result.failedRows.length} 条)
                  </p>
                  {result.failedRows.length === 0 ? (
                    <p className="text-sm text-slate-400">无</p>
                  ) : (
                    <div className="max-h-32 overflow-auto space-y-1">
                      {result.failedRows.map((f, idx) => (
                        <div key={idx} className="text-xs text-rose-700 bg-rose-50/50 p-2 rounded">
                          第{f.rowIndex + 1}行 ({f.data.sampleNo || '?'}): {f.errorMessage}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              {result.success && (
                <Link to="/samples" className="btn-primary w-full mt-4">
                  查看样本列表
                </Link>
              )}
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => handleImport(true)}
              disabled={loading || previewRows.length === 0}
              className="btn-primary flex-1"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  导入中...
                </>
              ) : (
                '确认导入批次'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
