import { useEffect, useState } from 'react';
import {
  Warehouse,
  Plus,
  Edit2,
  MapPin,
  Archive,
  FlaskConical,
  Package,
  ToggleLeft,
  ToggleRight,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Modal } from '@/components/common/Modal';
import { LOCATION_TYPE_LABELS } from '@shared/constants';
import type { Location, LocationType } from '@shared/types';

export const LocationList = () => {
  const locations = useAppStore((s) => s.locations);
  const samples = useAppStore((s) => s.samples);
  const getAllLocations = useAppStore((s) => s.getAllLocations);
  const createLocation = useAppStore((s) => s.createLocation);
  const updateLocation = useAppStore((s) => s.updateLocation);
  const currentUser = useAppStore((s) => s.currentUser);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    code: '',
    name: '',
    type: 'storage' as LocationType,
    capacity: 50,
    description: '',
  });

  useEffect(() => {
    getAllLocations();
  }, [getAllLocations]);

  const canManage = currentUser?.role === 'warehouse' || currentUser?.role === 'admin';

  const openCreate = () => {
    setEditing(null);
    setForm({ code: '', name: '', type: 'storage', capacity: 50, description: '' });
    setShowModal(true);
  };

  const openEdit = (loc: Location) => {
    setEditing(loc);
    setForm({
      code: loc.code,
      name: loc.name,
      type: loc.type,
      capacity: loc.capacity,
      description: loc.description || '',
    });
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    setLoading(true);
    try {
      if (editing) {
        await updateLocation(editing.id, {
          ...form,
          updatedAt: new Date().toISOString(),
        });
      } else {
        await createLocation({
          ...form,
          status: 'active',
        });
      }
      setShowModal(false);
    } finally {
      setLoading(false);
    }
  };

  const toggleStatus = async (loc: Location) => {
    await updateLocation(loc.id, { status: loc.status === 'active' ? 'inactive' : 'active' });
  };

  const getTypeIcon = (type: LocationType) => {
    switch (type) {
      case 'storage':
        return <Package className="w-5 h-5 text-teal-600" />;
      case 'testing':
        return <FlaskConical className="w-5 h-5 text-blue-600" />;
      case 'archive':
        return <Archive className="w-5 h-5 text-emerald-600" />;
    }
  };

  const getOccupancy = (loc: Location) => {
    return samples.filter((s) => s.currentLocationId === loc.id).length;
  };

  const groupedByType: Record<LocationType, Location[]> = {
    storage: [],
    testing: [],
    archive: [],
  };
  locations.forEach((l) => groupedByType[l.type].push(l));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 font-serif">库位管理</h1>
          <p className="text-slate-500 mt-1">配置和管理样本存储库位</p>
        </div>
        {canManage && (
          <button onClick={openCreate} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            新增库位
          </button>
        )}
      </div>

      {(Object.keys(groupedByType) as LocationType[]).map((type) => (
        <div key={type} className="space-y-3">
          <div className="flex items-center gap-2">
            {getTypeIcon(type)}
            <h2 className="text-lg font-semibold text-slate-900 font-serif">
              {LOCATION_TYPE_LABELS[type]}
            </h2>
            <span className="text-sm text-slate-500">({groupedByType[type].length})</span>
          </div>

          {groupedByType[type].length === 0 ? (
            <div className="glass-card p-8 text-center">
              <Warehouse className="w-10 h-10 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500 text-sm">暂无{LOCATION_TYPE_LABELS[type]}</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {groupedByType[type].map((loc) => {
                const occupancy = getOccupancy(loc);
                const pct = Math.min(100, (occupancy / loc.capacity) * 100);
                return (
                  <div
                    key={loc.id}
                    className={`glass-card p-5 ${loc.status === 'inactive' ? 'opacity-60' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                            loc.status === 'active' ? 'bg-slate-100' : 'bg-slate-200'
                          }`}
                        >
                          {getTypeIcon(loc.type)}
                        </div>
                        <div>
                          <p className="font-mono text-sm font-semibold text-slate-900">
                            {loc.code}
                          </p>
                          <p className="text-sm text-slate-600">{loc.name}</p>
                        </div>
                      </div>
                      {canManage && (
                        <button
                          onClick={() => toggleStatus(loc)}
                          className="text-slate-400 hover:text-slate-600 transition-colors"
                          title={loc.status === 'active' ? '点击停用' : '点击启用'}
                        >
                          {loc.status === 'active' ? (
                            <ToggleRight className="w-6 h-6 text-brand-600" />
                          ) : (
                            <ToggleLeft className="w-6 h-6 text-slate-400" />
                          )}
                        </button>
                      )}
                    </div>

                    {loc.description && (
                      <p className="text-xs text-slate-500 mb-3 line-clamp-2">
                        {loc.description}
                      </p>
                    )}

                    <div className="mb-2">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-slate-500">容量占用</span>
                        <span className="font-medium text-slate-700">
                          {occupancy} / {loc.capacity}
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            pct >= 90
                              ? 'bg-rose-500'
                              : pct >= 70
                              ? 'bg-amber-500'
                              : 'bg-teal-500'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          loc.status === 'active'
                            ? 'bg-teal-50 text-teal-700'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {loc.status === 'active' ? '启用中' : '已停用'}
                      </span>
                      {canManage && (
                        <button
                          onClick={() => openEdit(loc)}
                          className="text-slate-400 hover:text-brand-600 transition-colors"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? '编辑库位' : '新增库位'}
        footer={
          <>
            <button onClick={() => setShowModal(false)} className="btn-secondary">
              取消
            </button>
            <button onClick={handleSubmit} disabled={loading} className="btn-primary">
              {loading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {editing ? '保存' : '创建'}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label-text">库位编码 *</label>
            <input
              type="text"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
              className="input-field font-mono"
              placeholder="例如：WH-A-01"
            />
          </div>
          <div>
            <label className="label-text">库位名称 *</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="input-field"
              placeholder="例如：A区存储库位01"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label-text">库位类型</label>
              <select
                value={form.type}
                onChange={(e) => setForm({ ...form, type: e.target.value as LocationType })}
                className="input-field"
              >
                <option value="storage">存储库位</option>
                <option value="testing">检测区域</option>
                <option value="archive">归档区域</option>
              </select>
            </div>
            <div>
              <label className="label-text">容量</label>
              <input
                type="number"
                min={1}
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: parseInt(e.target.value) || 0 })}
                className="input-field"
              />
            </div>
          </div>
          <div>
            <label className="label-text">描述说明</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="input-field min-h-[80px] resize-none"
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
