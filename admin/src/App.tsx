import { Routes, Route, Navigate } from 'react-router-dom';
import AdminLayout from './layout/AdminLayout';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import Recipes from './pages/Recipes';
import Community from './pages/Community';
import Ingredients from './pages/Ingredients';
import AIConfig from './pages/AIConfig';
import AIUsage from './pages/AIUsage';
import AIConversations from './pages/AIConversations';
import ChangePassword from './pages/ChangePassword';
import SecurityAudit from './pages/SecurityAudit';
import Kitchenware from './pages/Kitchenware';

import React from 'react';

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
      </Route>
    </Routes>
  );
}

export default App;
