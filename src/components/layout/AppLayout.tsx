import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FlaskConical,
  Warehouse,
  ArrowDownToLine,
  ArrowRightLeft,
  FlaskRound,
  FileCheck2,
  RotateCcw,
  FileX2,
  Clock,
  Download,
  LogOut,
  User,
  FileText,
  GitBranch,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { ROLE_LABELS } from '@shared/constants';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  roles?: string[];
}

const navItems: NavItem[] = [
  { to: '/dashboard', label: '仪表盘', icon: <LayoutDashboard className="w-5 h-5" /> },
  { to: '/samples', label: '样本管理', icon: <FlaskConical className="w-5 h-5" /> },
  { to: '/samples/import', label: '批次导入', icon: <ArrowDownToLine className="w-5 h-5" />, roles: ['collector', 'admin'] },
  { to: '/locations', label: '库位管理', icon: <Warehouse className="w-5 h-5" />, roles: ['warehouse', 'admin'] },
  { to: '/flow/inbound', label: '入库登记', icon: <ArrowDownToLine className="w-5 h-5" />, roles: ['warehouse', 'admin'] },
  { to: '/flow/outbound', label: '出库交接', icon: <ArrowRightLeft className="w-5 h-5" />, roles: ['warehouse', 'tester', 'admin'] },
  { to: '/flow/testing/receive', label: '检测接收', icon: <FlaskRound className="w-5 h-5" />, roles: ['tester', 'admin'] },
  { to: '/flow/testing/complete', label: '检测完成', icon: <FileCheck2 className="w-5 h-5" />, roles: ['tester', 'admin'] },
  { to: '/flow/archive', label: '归档复核', icon: <FileCheck2 className="w-5 h-5" />, roles: ['auditor', 'admin'] },
  { to: '/exception/rollback', label: '异常回退', icon: <RotateCcw className="w-5 h-5" />, roles: ['auditor', 'admin'] },
  { to: '/exception/failures', label: '失败记录', icon: <FileX2 className="w-5 h-5" />, roles: ['auditor', 'admin'] },
  { to: '/audit/timeline', label: '审计时间线', icon: <Clock className="w-5 h-5" />, roles: ['auditor', 'admin'] },
  { to: '/audit/export', label: '审计导出', icon: <Download className="w-5 h-5" />, roles: ['auditor', 'admin'] },
  { to: '/audit/archive-review', label: '归档后复盘', icon: <FileText className="w-5 h-5" />, roles: ['auditor', 'admin'] },
  { to: '/audit/flow-trace', label: '流转追溯台', icon: <GitBranch className="w-5 h-5" />, roles: ['auditor', 'admin'] },
];

interface AppLayoutProps {
  children: ReactNode;
}

export const AppLayout = ({ children }: AppLayoutProps) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const logout = useAppStore((s) => s.logout);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const visibleNavItems = navItems.filter(
    (item) => !item.roles || (currentUser && item.roles.includes(currentUser.role))
  );

  return (
    <div className="min-h-screen flex bg-slate-50">
      <aside className="w-60 bg-white border-r border-slate-200 flex flex-col shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-slate-200">
          <FlaskConical className="w-7 h-7 text-brand-600" />
          <span className="ml-3 text-lg font-bold text-slate-900 font-serif">样本流转系统</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {visibleNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'sidebar-item-active' : 'sidebar-item')}
            >
              {item.icon}
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-slate-200">
          <div className="flex items-center gap-3 px-3 py-2 mb-2">
            <div className="w-9 h-9 rounded-full bg-brand-100 flex items-center justify-center text-brand-700">
              <User className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-900 truncate">
                {currentUser?.displayName}
              </p>
              <p className="text-xs text-slate-500">
                {currentUser ? ROLE_LABELS[currentUser.role] : ''}
              </p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="sidebar-item w-full text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          >
            <LogOut className="w-5 h-5" />
            退出登录
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="p-6 lg:p-8 max-w-[1400px] mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
};
