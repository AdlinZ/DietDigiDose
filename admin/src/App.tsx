import { Routes, Route, Navigate } from 'react-router';
import React, { lazy, Suspense } from 'react';

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
const ChangePassword = lazy(() => import('./pages/ChangePassword'));
const SecurityAudit = lazy(() => import('./pages/SecurityAudit'));
const Kitchenware = lazy(() => import('./pages/Kitchenware'));
const Notifications = lazy(() => import('./pages/Notifications'));

// Auth Guard
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem('adminToken');
  if (!token) {
    return <Navigate to="/login" replace />;
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
        <Route path="ingredients" element={<Ingredients />} />
        <Route path="kitchenware" element={<Kitchenware />} />
        <Route path="recipes" element={<Recipes />} />
        <Route path="community" element={<Community />} />
        <Route path="ai-config" element={<AIConfig />} />
        <Route path="ai-usage" element={<AIUsage />} />
        <Route path="ai-conversations" element={<AIConversations />} />
        <Route path="security" element={<SecurityAudit />} />
        <Route path="notifications" element={<Notifications />} />
      </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
