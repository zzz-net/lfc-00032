import { useEffect } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type ToastType = 'success' | 'error' | 'warning';

export interface ToastData {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastProps {
  toast: ToastData;
  onClose: (id: string) => void;
}

export const Toast = ({ toast, onClose }: ToastProps) => {
  useEffect(() => {
    const timer = setTimeout(() => onClose(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onClose]);

  const iconClass = cn('w-5 h-5 shrink-0', {
    'text-emerald-500': toast.type === 'success',
    'text-rose-500': toast.type === 'error',
    'text-amber-500': toast.type === 'warning',
  });

  return (
    <div className="flex items-center gap-3 bg-white rounded-lg shadow-lg border border-slate-200 px-4 py-3 animate-slide-up min-w-[280px] max-w-md">
      {toast.type === 'success' && <CheckCircle2 className={iconClass} />}
      {toast.type === 'error' && <XCircle className={iconClass} />}
      {toast.type === 'warning' && <AlertTriangle className={iconClass} />}
      <span className="text-sm text-slate-700 flex-1">{toast.message}</span>
      <button
        onClick={() => onClose(toast.id)}
        className="text-slate-400 hover:text-slate-600 transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastData[];
  onClose: (id: string) => void;
}

export const ToastContainer = ({ toasts, onClose }: ToastContainerProps) => {
  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={onClose} />
      ))}
    </div>
  );
};

export const createToast = (type: ToastType, message: string): ToastData => ({
  id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  type,
  message,
});
