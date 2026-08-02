import { useState, useEffect } from 'react';
import { Search, User, ShieldAlert, X, AlertCircle, BadgeCheck } from 'lucide-react';
import api from '../services/api';
import { cn } from '../utils/cn';
import { getAvatarUrl } from '../utils/avatar';

interface UserData {
  id: number;
  username: string;
  nickname: string;
  avatar_url: string;
  role: string;
  is_verified_expert: number | boolean;
  created_at: string;
}

export default function Users() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user' | 'expert'>('all');
  
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    userId: number;
    currentRole: string;
  } | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoading(true);
      const res = await api.get('/admin/users');
      setUsers(res.data);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleRole = async (id: number, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    try {
      await api.put(`/admin/users/${id}/role`, { role: newRole });
      setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
      if (selectedUser && selectedUser.id === id) {
        setSelectedUser({ ...selectedUser, role: newRole });
      }
      setConfirmModal(null);
    } catch (err) {
      console.error('Error toggling role:', err);
    }
  };

  const handleToggleExpert = async (id: number, currentValue: boolean) => {
    try {
      const nextValue = !currentValue;
      await api.put(`/admin/users/${id}/expert`, { is_verified_expert: nextValue });
      setUsers(current => current.map(user => user.id === id ? { ...user, is_verified_expert: nextValue } : user));
      setSelectedUser(current => current?.id === id ? { ...current, is_verified_expert: nextValue } : current);
    } catch (err) {
      console.error('Error toggling expert verification:', err);
    }
  };

  const filteredUsers = users.filter(user => {
    const matchesSearch = 
      user.username.toLowerCase().includes(searchQuery.toLowerCase()) || 
      user.nickname?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesRole = roleFilter === 'all'
      ? true
      : roleFilter === 'expert'
        ? Boolean(user.is_verified_expert)
        : user.role === roleFilter;
    return matchesSearch && matchesRole;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-text-main">用户管理</h1>
          <span className="bg-primary/10 text-primary px-3 py-1 rounded-full text-sm font-medium">
            共 {filteredUsers.length} 人
          </span>
        </div>
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
            <input 
              type="text" 
              placeholder="搜索用户名或昵称..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-background-alt border-none rounded-xl text-sm focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        {[{ id: 'all', label: '全部' }, { id: 'admin', label: '管理员' }, { id: 'user', label: '普通用户' }, { id: 'expert', label: '专业用户' }].map(tab => (
          <button
            key={tab.id}
            onClick={() => setRoleFilter(tab.id as any)}
            className={cn(
              "px-4 py-2 rounded-xl text-sm font-medium transition-colors",
              roleFilter === tab.id 
                ? "bg-primary text-white" 
                : "bg-background-alt text-text-muted hover:text-text-main"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-[24px] p-6 shadow-sm">
        {loading ? (
          <div className="py-12 text-center text-text-muted">加载中...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-12 text-center text-text-muted">未找到用户</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-text-muted text-sm border-b border-background-alt">
                  <th className="pb-4 font-medium w-12 text-center">ID</th>
                  <th className="pb-4 font-medium px-4">用户信息</th>
                  <th className="pb-4 font-medium px-4">角色</th>
                  <th className="pb-4 font-medium px-4">专业认证</th>
                  <th className="pb-4 font-medium px-4">加入时间</th>
                  <th className="pb-4 font-medium text-right pl-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => (
                  <tr 
                    key={user.id} 
                    className="border-b border-background-alt/50 last:border-0 hover:bg-background-alt/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedUser(user)}
                  >
                    <td className="py-4 text-text-muted text-center text-sm">{user.id}</td>
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-3">
                        <img
                          src={getAvatarUrl(user.avatar_url, user.id)}
                          alt={user.nickname || user.username}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                        <div>
                          <div className="font-medium text-text-main">{user.nickname || user.username}</div>
                          <div className="text-xs text-text-muted">@{user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <span className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium",
                        user.role === 'admin' 
                          ? "bg-secondary/10 text-secondary" 
                          : "bg-background-alt text-text-muted"
                      )}>
                        {user.role === 'admin' ? <ShieldAlert className="w-3 h-3" /> : <User className="w-3 h-3" />}
                        {user.role === 'admin' ? '管理员' : '普通用户'}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleToggleExpert(user.id, Boolean(user.is_verified_expert));
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors",
                          user.is_verified_expert
                            ? "bg-green-50 text-green-700 hover:bg-green-100"
                            : "bg-background-alt text-text-muted hover:text-primary"
                        )}
                      >
                        <BadgeCheck className="h-3.5 w-3.5" />
                        {user.is_verified_expert ? '已认证' : '未认证'}
                      </button>
                    </td>
                    <td className="py-4 px-4 text-sm text-text-muted">
                      {new Date(user.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-4 pl-4 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmModal({ isOpen: true, userId: user.id, currentRole: user.role });
                        }}
                        className="text-sm text-primary hover:text-primary/80 font-medium px-3 py-1.5 rounded-lg hover:bg-primary/5 transition-colors"
                      >
                        {user.role === 'admin' ? '降级' : '设为管理'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User Detail Side Panel / Modal */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center sm:justify-end bg-black/40 backdrop-blur-sm p-4 sm:p-0">
          <div 
            className="bg-white w-full sm:w-[400px] sm:h-screen sm:rounded-none rounded-3xl p-6 sm:p-8 shadow-xl flex flex-col relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              onClick={() => setSelectedUser(null)}
              className="absolute right-6 top-6 p-2 rounded-full hover:bg-background-alt text-text-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="mt-8 flex flex-col items-center text-center">
              <img
                src={getAvatarUrl(selectedUser.avatar_url, selectedUser.id)}
                alt={selectedUser.nickname || selectedUser.username}
                className="w-24 h-24 rounded-full object-cover shadow-sm mb-4"
              />
              <h2 className="text-xl font-bold text-text-main">{selectedUser.nickname || selectedUser.username}</h2>
              <p className="text-text-muted">@{selectedUser.username}</p>
              
              <div className="mt-4 flex gap-2">
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium",
                  selectedUser.role === 'admin' 
                    ? "bg-secondary/10 text-secondary" 
                    : "bg-background-alt text-text-main"
                )}>
                  {selectedUser.role === 'admin' ? <ShieldAlert className="w-4 h-4" /> : <User className="w-4 h-4" />}
                  {selectedUser.role === 'admin' ? '管理员' : '普通用户'}
                </span>
                <span className="inline-flex items-center px-3 py-1.5 rounded-xl bg-background-alt text-text-muted text-sm">
                  ID: {selectedUser.id}
                </span>
                {selectedUser.is_verified_expert ? (
                  <span className="inline-flex items-center gap-1.5 rounded-xl bg-green-50 px-3 py-1.5 text-sm font-medium text-green-700">
                    <BadgeCheck className="h-4 w-4" />专业用户
                  </span>
                ) : null}
              </div>
            </div>

            <div className="mt-8 space-y-6 flex-1">
              <div>
                <h3 className="text-sm font-medium text-text-muted mb-2">个人简介</h3>
                <p className="text-text-main bg-background p-4 rounded-2xl text-sm leading-relaxed">
                  这个人很懒，什么都没写。
                </p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-muted mb-2">注册时间</h3>
                <p className="text-text-main text-sm font-medium">
                  {new Date(selectedUser.created_at).toLocaleString()}
                </p>
              </div>
            </div>
            
            <div className="mt-auto pt-6 border-t border-background-alt">
              <button
                onClick={() => void handleToggleExpert(selectedUser.id, Boolean(selectedUser.is_verified_expert))}
                className={cn(
                  "mb-3 w-full rounded-2xl py-3 text-sm font-medium transition-colors",
                  selectedUser.is_verified_expert
                    ? "bg-green-50 text-green-700 hover:bg-green-100"
                    : "bg-background-alt text-primary hover:bg-primary/10"
                )}
              >
                {selectedUser.is_verified_expert ? '取消专业用户认证' : '认证为专业用户'}
              </button>
              <button
                onClick={() => {
                  setConfirmModal({ isOpen: true, userId: selectedUser.id, currentRole: selectedUser.role });
                }}
                className={cn(
                  "w-full py-3 rounded-2xl font-medium text-sm transition-colors",
                  selectedUser.role === 'admin'
                    ? "bg-background-alt text-text-main hover:bg-background-alt/80"
                    : "bg-primary text-white hover:bg-primary/90"
                )}
              >
                {selectedUser.role === 'admin' ? '取消管理员权限' : '设为管理员'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 text-secondary mb-4">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-text-main">确认修改角色</h3>
            </div>
            <p className="text-text-muted text-sm mb-6">
              确定要将该用户的角色修改为 
              <span className="font-bold text-text-main mx-1">
                {confirmModal.currentRole === 'admin' ? '普通用户' : '管理员'}
              </span>
              吗？
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-background-alt text-text-main font-medium text-sm hover:bg-background-alt/80 transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => handleToggleRole(confirmModal.userId, confirmModal.currentRole)}
                className="flex-1 py-2.5 rounded-xl bg-primary text-white font-medium text-sm hover:bg-primary/90 transition-colors"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
