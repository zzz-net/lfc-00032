import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAppStore } from './store/useAppStore';
import { AppLayout } from './components/layout/AppLayout';
import { Toast, ToastContainer, createToast, type ToastData } from './components/common/Toast';

import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { SampleList } from './pages/SampleList';
import { SampleDetail } from './pages/SampleDetail';
import { SampleImport } from './pages/SampleImport';
import { LocationList } from './pages/LocationList';
import { InboundFlow } from './pages/flow/InboundFlow';
import { OutboundFlow } from './pages/flow/OutboundFlow';
import { TestReceiveFlow } from './pages/flow/TestReceiveFlow';
import { TestCompleteFlow } from './pages/flow/TestCompleteFlow';
import { ArchiveFlow } from './pages/flow/ArchiveFlow';
import { RollbackPage } from './pages/exception/RollbackPage';
import { FailureList } from './pages/exception/FailureList';
import { AuditTimeline } from './pages/audit/AuditTimeline';
import { AuditExport } from './pages/audit/AuditExport';
import { ArchiveReview } from './pages/audit/ArchiveReview';
import type { UserRole } from '@shared/types';
import { ROLE_LABELS } from '@shared/constants';
import { Loader2 } from 'lucide-react';

const ROUTE_ROLES: Record<string, UserRole[]> = {
  '/samples/import': ['collector', 'admin'],
  '/locations': ['warehouse', 'admin'],
  '/flow/inbound': ['warehouse', 'admin'],
  '/flow/outbound': ['warehouse', 'tester', 'admin'],
  '/flow/testing/receive': ['tester', 'admin'],
  '/flow/testing/complete': ['tester', 'admin'],
  '/flow/archive': ['auditor', 'admin'],
  '/exception/rollback': ['auditor', 'admin'],
  '/exception/failures': ['auditor', 'admin'],
  '/audit/timeline': ['auditor', 'admin'],
  '/audit/export': ['auditor', 'admin'],
  '/audit/archive-review': ['auditor', 'admin'],
};

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: UserRole[];
}

const ProtectedRoute = ({ children, allowedRoles }: ProtectedRouteProps) => {
  const currentUser = useAppStore((s) => s.currentUser);
  const isInitialized = useAppStore((s) => s.isInitialized);
  const location = useLocation();

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-500">
          <Loader2 className="w-6 h-6 animate-spin" />
          <span>系统初始化中...</span>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }

  if (allowedRoles && !allowedRoles.includes(currentUser.role) && currentUser.role !== 'admin') {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center min-h-[60vh]">
          <div className="text-center">
            <h2 className="text-xl font-semibold text-slate-900 mb-2">权限不足</h2>
            <p className="text-slate-500">
              当前角色「{ROLE_LABELS[currentUser.role]}」无权访问此页面
            </p>
            <p className="text-sm text-slate-400 mt-2">
              需要角色: {allowedRoles.map((r) => ROLE_LABELS[r]).join(' / ')}
            </p>
          </div>
        </div>
      </AppLayout>
    );
  }

  return <AppLayout>{children}</AppLayout>;
};

function AppContent() {
  const currentUser = useAppStore((s) => s.currentUser);
  const storeError = useAppStore((s) => s.error);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (currentUser && location.pathname === '/login') {
      navigate('/dashboard', { replace: true });
    }
  }, [currentUser, location.pathname, navigate]);

  useEffect(() => {
    if (storeError && storeError !== lastError) {
      setLastError(storeError);
      setToasts((prev) => [...prev, createToast('error', storeError)]);
    }
  }, [storeError, lastError]);

  const closeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/samples"
          element={
            <ProtectedRoute>
              <SampleList />
            </ProtectedRoute>
          }
        />
        <Route
          path="/samples/:id"
          element={
            <ProtectedRoute>
              <SampleDetail />
            </ProtectedRoute>
          }
        />
        <Route
          path="/samples/import"
          element={
            <ProtectedRoute allowedRoles={['collector', 'admin']}>
              <SampleImport />
            </ProtectedRoute>
          }
        />

        <Route
          path="/locations"
          element={
            <ProtectedRoute allowedRoles={['warehouse', 'admin']}>
              <LocationList />
            </ProtectedRoute>
          }
        />

        <Route
          path="/flow/inbound"
          element={
            <ProtectedRoute allowedRoles={['warehouse', 'admin']}>
              <InboundFlow />
            </ProtectedRoute>
          }
        />
        <Route
          path="/flow/outbound"
          element={
            <ProtectedRoute allowedRoles={['warehouse', 'tester', 'admin']}>
              <OutboundFlow />
            </ProtectedRoute>
          }
        />
        <Route
          path="/flow/testing/receive"
          element={
            <ProtectedRoute allowedRoles={['tester', 'admin']}>
              <TestReceiveFlow />
            </ProtectedRoute>
          }
        />
        <Route
          path="/flow/testing/complete"
          element={
            <ProtectedRoute allowedRoles={['tester', 'admin']}>
              <TestCompleteFlow />
            </ProtectedRoute>
          }
        />
        <Route
          path="/flow/archive"
          element={
            <ProtectedRoute allowedRoles={['auditor', 'admin']}>
              <ArchiveFlow />
            </ProtectedRoute>
          }
        />

        <Route
          path="/exception/rollback"
          element={
            <ProtectedRoute allowedRoles={['auditor', 'admin']}>
              <RollbackPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/exception/failures"
          element={
            <ProtectedRoute allowedRoles={['auditor', 'admin']}>
              <FailureList />
            </ProtectedRoute>
          }
        />

        <Route
          path="/audit/timeline"
          element={
            <ProtectedRoute allowedRoles={['auditor', 'admin']}>
              <AuditTimeline />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit/export"
          element={
            <ProtectedRoute allowedRoles={['auditor', 'admin']}>
              <AuditExport />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit/archive-review"
          element={
            <ProtectedRoute allowedRoles={['auditor', 'admin']}>
              <ArchiveReview />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>

      <ToastContainer toasts={toasts} onClose={closeToast} />
    </>
  );
}

export default function App() {
  const initializeDB = useAppStore((s) => s.initializeDB);

  useEffect(() => {
    initializeDB();
  }, [initializeDB]);

  return (
    <Router>
      <AppContent />
    </Router>
  );
}
