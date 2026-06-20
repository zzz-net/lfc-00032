import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Search, Filter, ArrowUpDown, Eye } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { SampleStatus } from '@shared/types';
import { STATUS_LABELS, LOCATION_TYPE_LABELS } from '@shared/constants';

const formatDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString('zh-CN');
};

export const SampleList = () => {
  const samples = useAppStore((s) => s.samples);
  const locations = useAppStore((s) => s.locations);
  const users = useAppStore((s) => s.users);
  const getAllSamples = useAppStore((s) => s.getAllSamples);
  const getAllLocations = useAppStore((s) => s.getAllLocations);
  const getAllUsers = useAppStore((s) => s.getAllUsers);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<SampleStatus | 'all'>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'createdAt' | 'sampleNo'>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    getAllSamples();
    getAllLocations();
    getAllUsers();
  }, [getAllSamples, getAllLocations, getAllUsers]);

  const filteredSamples = useMemo(() => {
    let result = [...samples];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) => s.sampleNo.toLowerCase().includes(q) || s.type.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter((s) => s.currentStatus === statusFilter);
    }

    if (locationFilter !== 'all') {
      result = result.filter((s) => s.currentLocationId === locationFilter);
    }

    result.sort((a, b) => {
      if (sortBy === 'sampleNo') {
        return sortAsc ? a.sampleNo.localeCompare(b.sampleNo) : b.sampleNo.localeCompare(a.sampleNo);
      }
      return sortAsc ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt);
    });

    return result;
  }, [samples, search, statusFilter, locationFilter, sortBy, sortAsc]);

  const getLocationName = (id?: string) => {
    if (!id) return '-';
    return locations.find((l) => l.id === id)?.code || '-';
  };

  const getUserName = (id?: string) => {
    if (!id) return '-';
    return users.find((u) => u.id === id)?.displayName || '-';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 font-serif">样本管理</h1>
          <p className="text-slate-500 mt-1">查看和管理所有实验样本</p>
        </div>
        <div className="flex gap-2">
          <Link to="/samples/import" className="btn-primary">
            <FlaskConical className="w-4 h-4 mr-2" />
            批次导入
          </Link>
        </div>
      </div>

      <div className="glass-card p-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="搜索样本编号或类型..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-field pl-9"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as SampleStatus | 'all')}
              className="input-field pl-9 appearance-none"
            >
              <option value="all">全部状态</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            <select
              value={locationFilter}
              onChange={(e) => setLocationFilter(e.target.value)}
              className="input-field pl-9 appearance-none"
            >
              <option value="all">全部库位</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.code} - {l.name}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={() => {
              if (sortBy === 'createdAt') {
                setSortAsc(!sortAsc);
              } else {
                setSortBy('createdAt');
                setSortAsc(false);
              }
            }}
            className="btn-outline justify-between"
          >
            <ArrowUpDown className="w-4 h-4 mr-2" />
            按{sortBy === 'createdAt' ? '创建时间' : '样本编号'}
            {sortAsc ? '升序' : '降序'}
          </button>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="table-container">
            <thead className="table-header">
              <tr>
                <th className="table-header-cell">样本编号</th>
                <th className="table-header-cell">样本类型</th>
                <th className="table-header-cell">当前状态</th>
                <th className="table-header-cell">当前库位</th>
                <th className="table-header-cell">当前持有人</th>
                <th className="table-header-cell">采集时间</th>
                <th className="table-header-cell">创建时间</th>
                <th className="table-header-cell text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredSamples.length === 0 ? (
                <tr>
                  <td colSpan={8} className="table-cell text-center py-12 text-slate-500">
                    <FlaskConical className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                    暂无符合条件的样本
                  </td>
                </tr>
              ) : (
                filteredSamples.map((sample) => (
                  <tr key={sample.id} className="table-row">
                    <td className="table-cell font-medium text-slate-900">{sample.sampleNo}</td>
                    <td className="table-cell">{sample.type}</td>
                    <td className="table-cell">
                      <StatusBadge status={sample.currentStatus} />
                      {sample.isArchived && (
                        <span className="ml-1 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                          已归档
                        </span>
                      )}
                    </td>
                    <td className="table-cell">{getLocationName(sample.currentLocationId)}</td>
                    <td className="table-cell">{getUserName(sample.currentHolderId)}</td>
                    <td className="table-cell text-slate-500">{formatDate(sample.collectedAt)}</td>
                    <td className="table-cell text-slate-500">{formatDate(sample.createdAt)}</td>
                    <td className="table-cell text-right">
                      <Link
                        to={`/samples/${sample.id}`}
                        className="inline-flex items-center text-brand-600 hover:text-brand-700"
                      >
                        <Eye className="w-4 h-4 mr-1" />
                        详情
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-sm text-slate-500">
          共 {filteredSamples.length} 条记录
        </div>
      </div>
    </div>
  );
};
