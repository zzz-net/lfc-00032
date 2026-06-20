import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FlaskConical, Lock, User as UserIcon, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { DEFAULT_PASSWORD } from '@shared/constants';

export const Login = () => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState(DEFAULT_PASSWORD);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const login = useAppStore((s) => s.login);
  const currentUser = useAppStore((s) => s.currentUser);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (currentUser) {
      const from = (location.state as { from?: string } | null)?.from || '/dashboard';
      navigate(from, { replace: true });
    }
  }, [currentUser, navigate, location.state]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const success = await login(username, password);
    setLoading(false);

    if (!success) {
      setError('用户名或密码错误');
    }
  };

  const demoAccounts = [
    { username: 'admin', role: '管理员' },
    { username: 'collector01', role: '采集员' },
    { username: 'warehouse01', role: '库管员' },
    { username: 'tester01', role: '检测员' },
    { username: 'auditor01', role: '审核员' },
  ];

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 via-slate-50 to-teal-50 p-4 relative overflow-hidden">
      <div className="absolute inset-0 opacity-30">
        <div className="absolute top-10 left-10 w-72 h-72 bg-brand-200 rounded-full filter blur-3xl" />
        <div className="absolute bottom-10 right-10 w-96 h-96 bg-teal-200 rounded-full filter blur-3xl" />
        <div className="absolute top-1/2 left-1/3 w-64 h-64 bg-amber-100 rounded-full filter blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="glass-card p-8 backdrop-blur-lg">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-600 text-white shadow-lg shadow-brand-200 mb-4">
              <FlaskConical className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 font-serif">样本流转链路登记</h1>
            <p className="text-sm text-slate-500 mt-2">实验样本全生命周期追踪系统</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="px-4 py-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700 animate-fade-in">
                {error}
              </div>
            )}

            <div>
              <label className="label-text">用户名</label>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input-field pl-10"
                  placeholder="请输入用户名"
                  required
                />
              </div>
            </div>

            <div>
              <label className="label-text">密码</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pl-10 pr-10"
                  placeholder="请输入密码"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full h-11"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  登录中...
                </>
              ) : (
                '登 录'
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-slate-200">
            <p className="text-xs text-slate-500 mb-3 text-center">演示账号（密码均为 123456）：</p>
            <div className="flex flex-wrap justify-center gap-2">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.username}
                  type="button"
                  onClick={() => {
                    setUsername(acc.username);
                    setPassword(DEFAULT_PASSWORD);
                  }}
                  className="px-3 py-1.5 text-xs bg-slate-100 hover:bg-brand-50 text-slate-700 hover:text-brand-700 rounded-md transition-colors"
                >
                  {acc.role}
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">
          © 2025 样本流转链路登记系统 · 本地数据安全存储
        </p>
      </div>
    </div>
  );
};
