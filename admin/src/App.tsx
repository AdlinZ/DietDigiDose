import { Routes, Route, Navigate } from 'react-router';
import React, { lazy, Suspense, useEffect, useState } from 'react';
import api from './services/api';
import { adminLoginPath, classifyAdminSession } from './services/adminSession';

const AdminLayout = lazy(() => import('./layout/AdminLayout'));
const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Users = lazy(() => import('./pages/Users'));
const Recipes = lazy(() => import('./pages/Recipes'));
const Community = lazy(() => import('./pages/Community'));
const Ingredients = lazy(() => import('./pages/Ingredients'));
const AIConfig = lazy(() => import('./pages/AIConfig'));
const AIUsage = lazy(() => import('./pages/AIUsage'));
const AIConversations = lazy(() => import('./pages/AIConversations'));
const AgentRuns = lazy(() => import('./pages/AgentRuns'));
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const SecurityAudit = lazy(() => import('./pages/SecurityAudit'));
const Kitchenware = lazy(() => import('./pages/Kitchenware'));
const Notifications = lazy(() => import('./pages/Notifications'));
const AuthServiceSms = lazy(() => import('./pages/AuthServiceSms'));
const AuthServicePlaceholder = lazy(() => import('./pages/AuthServicePlaceholder'));
const UserLevelRule = lazy(() => import('./pages/UserLevelRule'));
const MediaCleanup = lazy(() => import('./pages/MediaCleanup'));
const VoicePacks = lazy(() => import('./pages/VoicePacks'));

// Auth Guard
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('adminToken');
  const [status, setStatus] = useState<'checking' | 'authorized' | 'unauthenticated' | 'insufficient-role'>(
    token ? 'checking' : 'unauthenticated',
  );

  useEffect(() => {
    let active = true;
    if (!token) {
      setStatus('unauthenticated');
      return () => { active = false; };
    }
    void api.get('/auth/me').then(({ data }) => {
      if (!active) return;
      const failure = classifyAdminSession({ role: data.role });
      if (failure) {
        localStorage.removeItem('adminToken');
        setStatus(failure);
      } else {
        setStatus('authorized');
      }
    }).catch((error) => {
      if (!active) return;
      const failure = classifyAdminSession({ status: error.response?.status, code: error.response?.data?.code });
      localStorage.removeItem('adminToken');
      setStatus(failure || 'unauthenticated');
    });
    return () => { active = false; };
  }, [token]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }
  if (status === 'checking') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">正在验证管理权限…</div>;
  }
  if (status === 'unauthenticated' || status === 'insufficient-role') {
    return <Navigate to={adminLoginPath(status)} replace />;
  }
  return children;
};

function App() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">页面加载中…</div>}>
      <Routes>
      {/* 面向公众的产品宣传官网主页 */}
      <Route path="/" element={<Landing />} />

      {/* 管理员登录 */}
      <Route path="/login" element={<Login />} />
      <Route
        path="/change-password"
        element={
          <ProtectedRoute>
            <ChangePassword />
          </ProtectedRoute>
        }
      />

      {/* 管理控制台路由 */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="users" element={<Users />} />
        <Route path="user-level-rule" element={<UserLevelRule />} />
        <Route path="ingredients" element={<Ingredients />} />
        <Route path="kitchenware" element={<Kitchenware />} />
        <Route path="recipes" element={<Recipes />} />
        <Route path="community" element={<Community />} />
        <Route path="ai-config" element={<AIConfig />} />
        <Route path="ai-usage" element={<AIUsage />} />
        <Route path="ai-conversations" element={<AIConversations />} />
        <Route path="agent-runs" element={<AgentRuns />} />
        <Route path="security" element={<SecurityAudit />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="media-cleanup" element={<MediaCleanup />} />
        <Route path="voice-packs" element={<VoicePacks />} />
        <Route path="auth-services/sms" element={<AuthServiceSms />} />
        <Route path="auth-services/captcha" element={<AuthServicePlaceholder />} />
        <Route path="auth-services/phone" element={<AuthServicePlaceholder />} />
      </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
