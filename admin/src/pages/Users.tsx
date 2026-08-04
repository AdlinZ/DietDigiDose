import { useState, useEffect, useMemo } from 'react';
import { Search, User, ShieldAlert, X, AlertCircle, BadgeCheck, Users as UsersIcon, Mail, Phone, Lock, Sparkles, UserX, UserCheck } from 'lucide-react';
import api from '../services/api';
import { cn } from '../utils/cn';
import { getAvatarUrl } from '../utils/avatar';

interface UserData {
  id: number;
  username: string;
  email?: string | null;
  phone?: string | null;
  nickname: string;
  avatar_url: string;
  role: string;
  is_verified_expert: number | boolean;
  is_disabled?: number | boolean;
  created_at: string;
}

export default function Users() {
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user' | 'expert' | 'disabled'>('all');
  
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [credentialIdentifier, setCredentialIdentifier] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsMessage, setCredentialsMessage] = useState('');
  
  const [confirmRoleModal, setConfirmRoleModal] = useState<{
    isOpen: boolean;
    userId: number;
    currentRole: string;
  } | null>(null);

  const [confirmStatusModal, setConfirmStatusModal] = useState<{
    isOpen: boolean;
    userId: number;
    username: string;
    currentDisabled: boolean;
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
      setConfirmRoleModal(null);
    } catch (err: any) {
      const msg = err.response?.data?.error || '操作失败';
      alert(msg);
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

  const handleToggleDisabled = async (id: number, currentDisabled: boolean) => {
    try {
      const nextDisabled = !currentDisabled;
      await api.put(`/admin/users/${id}/status`, { is_disabled: nextDisabled });
      setUsers(current => current.map(u => u.id === id ? { ...u, is_disabled: nextDisabled } : u));
      if (selectedUser && selectedUser.id === id) {
        setSelectedUser({ ...selectedUser, is_disabled: nextDisabled });
      }
      setConfirmStatusModal(null);
    } catch (err: any) {
      const msg = err.response?.data?.error || '更新账号状态失败';
      alert(msg);
    }
  };

  const openUserDetail = (user: UserData) => {
    setSelectedUser(user);
    setCredentialIdentifier(user.email || user.phone || user.username);
    setResetPassword('');
    setCredentialsMessage('');
  };

  const handleSaveCredentials = async () => {
    if (!selectedUser || selectedUser.role === 'admin') return;
    const identifier = credentialIdentifier.trim().toLowerCase();
    const currentIdentifier = (selectedUser.email || selectedUser.phone || selectedUser.username).toLowerCase();
    if (!identifier) {
      setCredentialsMessage('请输入邮箱或手机号');
      return;
    }
    if (!resetPassword && identifier === currentIdentifier) {
      setCredentialsMessage('未检测到需要保存的改动');
      return;
    }
    try {
      setCredentialsSaving(true);
      setCredentialsMessage('');
      const res = await api.put(`/admin/users/${selectedUser.id}/credentials`, {
        ...(identifier === currentIdentifier ? {} : { identifier }),
        ...(resetPassword ? { newPassword: resetPassword } : {}),
      });
      const updated = res.data.user as Pick<UserData, 'username' | 'email' | 'phone'>;
      setUsers(current => current.map(user => user.id === selectedUser.id ? { ...user, ...updated } : user));
      setSelectedUser(current => current?.id === selectedUser.id ? { ...current, ...updated } : current);
      setCredentialIdentifier(updated.email || updated.phone || updated.username);
      setResetPassword('');
      setCredentialsMessage('登录信息已保存');
    } catch (error) {
      const message = (error as { response?: { data?: { error?: string } } }).response?.data?.error;
      setCredentialsMessage(message || '保存失败，请稍后重试');
    } finally {
      setCredentialsSaving(false);
    }
  };

  const userStats = useMemo(() => {
    const total = users.length;
    const admins = users.filter((u) => u.role === 'admin').length;
    const experts = users.filter((u) => Boolean(u.is_verified_expert)).length;
    const disabled = users.filter((u) => Boolean(u.is_disabled)).length;
    const regulars = users.filter((u) => u.role !== 'admin' && !u.is_verified_expert && !u.is_disabled).length;
    return { total, admins, experts, disabled, regulars };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      const matchesSearch =
        !query ||
        user.username.toLowerCase().includes(query) ||
        user.nickname?.toLowerCase().includes(query) ||
        (user.email && user.email.toLowerCase().includes(query)) ||
        (user.phone && user.phone.includes(query)) ||
        String(user.id).includes(query);

      const matchesRole =
        roleFilter === 'all'
          ? true
          : roleFilter === 'expert'
          ? Boolean(user.is_verified_expert)
          : roleFilter === 'disabled'
          ? Boolean(user.is_disabled)
          : user.role === roleFilter;

      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, roleFilter]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">用户管理</h1>
          <p className="text-xs text-text-muted mt-1">管理系统注册用户、停用/启用账号、专业认证及登录凭证</p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted w-4 h-4" />
            <input 
              type="text" 
              placeholder="搜索用户名、昵称、邮箱或手机号..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-100 shadow-sm rounded-xl text-sm focus:ring-2 focus:ring-primary/20 outline-none"
            />
          </div>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">总注册用户</p>
            <p className="mt-1.5 text-2xl font-bold text-text-main">{loading ? '—' : userStats.total}</p>
          </div>
          <div className="rounded-2xl bg-primary/10 p-3 text-primary">
            <UsersIcon className="h-6 w-6" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">专业认证用户</p>
            <p className="mt-1.5 text-2xl font-bold text-green-700">{loading ? '—' : userStats.experts}</p>
          </div>
          <div className="rounded-2xl bg-green-50 p-3 text-green-700">
            <BadgeCheck className="h-6 w-6" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">系统管理员</p>
            <p className="mt-1.5 text-2xl font-bold text-secondary">{loading ? '—' : userStats.admins}</p>
          </div>
          <div className="rounded-2xl bg-secondary/10 p-3 text-secondary">
            <ShieldAlert className="h-6 w-6" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-[24px] bg-white p-5 shadow-sm">
          <div>
            <p className="text-xs font-medium text-text-muted">已停用账号</p>
            <p className="mt-1.5 text-2xl font-bold text-red-600">{loading ? '—' : userStats.disabled}</p>
          </div>
          <div className="rounded-2xl bg-red-50 p-3 text-red-600">
            <UserX className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { id: 'all', label: '全部', count: userStats.total },
            { id: 'admin', label: '管理员', count: userStats.admins },
            { id: 'user', label: '普通用户', count: userStats.regulars },
            { id: 'expert', label: '专业用户', count: userStats.experts },
            { id: 'disabled', label: '已停用', count: userStats.disabled },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setRoleFilter(tab.id as any)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 whitespace-nowrap",
                roleFilter === tab.id 
                  ? "bg-primary text-white shadow-sm" 
                  : "bg-white text-text-muted hover:text-text-main hover:bg-gray-50 border border-gray-100"
              )}
            >
              <span>{tab.label}</span>
              <span className={cn(
                "rounded-full px-1.5 py-0.2 text-[10px]",
                roleFilter === tab.id ? "bg-white/20 text-white" : "bg-background-alt text-text-muted"
              )}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <span className="text-xs text-text-muted font-medium shrink-0">
          已显示 {filteredUsers.length} 项
        </span>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-[24px] p-6 shadow-sm">
        {loading ? (
          <div className="py-16 text-center text-text-muted text-sm">正在加载用户列表...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="py-16 text-center">
            <User className="h-10 w-10 text-text-muted/40 mx-auto mb-3" />
            <p className="text-sm font-medium text-text-main">未找到符合条件的用户</p>
            <p className="text-xs text-text-muted mt-1">请重新输入搜索关键字或切换筛选条件</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="text-text-muted text-xs border-b border-background-alt">
                  <th className="pb-4 font-medium w-16 text-center">ID</th>
                  <th className="pb-4 font-medium px-4">用户信息</th>
                  <th className="pb-4 font-medium px-4">联系方式</th>
                  <th className="pb-4 font-medium px-4">角色</th>
                  <th className="pb-4 font-medium px-4">状态</th>
                  <th className="pb-4 font-medium px-4">专业认证</th>
                  <th className="pb-4 font-medium px-4">注册时间</th>
                  <th className="pb-4 font-medium text-right pl-4">操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map(user => {
                  const isDisabled = Boolean(user.is_disabled);
                  return (
                    <tr 
                      key={user.id} 
                      className={`border-b border-background-alt/50 last:border-0 hover:bg-background-alt/30 transition-colors cursor-pointer text-sm ${
                        isDisabled ? 'opacity-70 bg-red-50/20' : ''
                      }`}
                      onClick={() => openUserDetail(user)}
                    >
                      <td className="py-4 text-text-muted text-center text-xs font-mono">{user.id}</td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={getAvatarUrl(user.avatar_url, user.id)}
                            alt={user.nickname || user.username}
                            className="w-10 h-10 rounded-full object-cover shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="font-semibold text-text-main truncate">{user.nickname || user.username}</div>
                            <div className="text-xs text-text-muted truncate">@{user.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-xs text-text-muted">
                        {user.email ? (
                          <span className="flex items-center gap-1.5 text-text-main">
                            <Mail className="w-3.5 h-3.5 text-text-muted" />
                            {user.email}
                          </span>
                        ) : user.phone ? (
                          <span className="flex items-center gap-1.5 text-text-main">
                            <Phone className="w-3.5 h-3.5 text-text-muted" />
                            {user.phone}
                          </span>
                        ) : (
                          <span className="text-text-muted/60">—</span>
                        )}
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
                        {isDisabled ? (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 border border-red-100">
                            <UserX className="w-3 h-3" /> 已停用
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600">
                            <UserCheck className="w-3 h-3" /> 正常
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4">
                        <button
                          type="button"
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
                      <td className="py-4 px-4 text-xs text-text-muted">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="py-4 pl-4 text-right">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmStatusModal({
                              isOpen: true,
                              userId: user.id,
                              username: user.nickname || user.username,
                              currentDisabled: isDisabled,
                            });
                          }}
                          className={cn(
                            "text-xs font-medium px-3 py-1.5 rounded-lg transition-colors",
                            isDisabled
                              ? "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                              : "text-red-600 hover:text-red-700 hover:bg-red-50"
                          )}
                        >
                          {isDisabled ? '恢复启用' : '停用账号'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* User Detail Side Panel */}
      {selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center sm:justify-end bg-black/40 backdrop-blur-sm p-4 sm:p-0">
          <div 
            className="bg-white w-full sm:w-[480px] sm:h-screen sm:rounded-none rounded-3xl p-5 sm:p-6 shadow-xl overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <button 
              type="button"
              onClick={() => setSelectedUser(null)}
              className="absolute right-5 top-5 p-2 rounded-full hover:bg-background-alt text-text-muted transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="mt-2 flex items-center gap-4 pr-10 text-left">
              <img
                src={getAvatarUrl(selectedUser.avatar_url, selectedUser.id)}
                alt={selectedUser.nickname || selectedUser.username}
                className="h-16 w-16 shrink-0 rounded-2xl object-cover shadow-sm"
              />
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-bold text-text-main">{selectedUser.nickname || selectedUser.username}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium",
                    selectedUser.role === 'admin' ? "bg-secondary/10 text-secondary" : "bg-background-alt text-text-main"
                  )}>
                    {selectedUser.role === 'admin' ? <ShieldAlert className="w-4 h-4" /> : <User className="w-4 h-4" />}
                    {selectedUser.role === 'admin' ? '管理员' : '普通用户'}
                  </span>
                  <span className="inline-flex items-center rounded-lg bg-background-alt px-2.5 py-1 text-xs text-text-muted font-mono">ID {selectedUser.id}</span>
                  {selectedUser.is_disabled ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600">
                      <UserX className="h-4 w-4" />已停用
                    </span>
                  ) : selectedUser.is_verified_expert ? (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                      <BadgeCheck className="h-4 w-4" />专业用户
                    </span>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl border border-background-alt bg-background/60 p-3.5 flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-medium text-text-muted">注册时间</h3>
                  <p className="mt-0.5 text-sm font-medium text-text-main">
                    {new Date(selectedUser.created_at).toLocaleString()}
                  </p>
                </div>
                <Sparkles className="w-5 h-5 text-primary/40" />
              </div>

              {selectedUser.role !== 'admin' ? (
                <div className="rounded-2xl border border-background-alt p-4">
                  <h3 className="text-sm font-semibold text-text-main flex items-center gap-2">
                    <Lock className="w-4 h-4 text-primary" /> 登录凭证管理
                  </h3>
                  <p className="mt-1 text-xs text-text-muted">修改用户登录绑定的手机号/邮箱，或强制设置新密码。</p>
                  <div className="mt-4 space-y-3">
                    <label className="block text-xs font-medium text-text-muted">
                      登录邮箱或手机号
                      <input
                        type="text"
                        value={credentialIdentifier}
                        onChange={(event) => setCredentialIdentifier(event.target.value)}
                        className="mt-1.5 w-full rounded-xl border border-background-alt bg-background px-3 py-2.5 text-sm text-text-main outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </label>
                    <label className="block text-xs font-medium text-text-muted">
                      重置密码（留空则不修改）
                      <input
                        type="password"
                        value={resetPassword}
                        onChange={(event) => setResetPassword(event.target.value)}
                        placeholder="至少 6 位，包含字母和数字"
                        className="mt-1.5 w-full rounded-xl border border-background-alt bg-background px-3 py-2.5 text-sm text-text-main outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </label>
                    {credentialsMessage ? <p className="text-xs text-text-muted">{credentialsMessage}</p> : null}
                    <button
                      type="button"
                      onClick={() => void handleSaveCredentials()}
                      disabled={credentialsSaving}
                      className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60 shadow-sm"
                    >
                      {credentialsSaving ? '保存中…' : '保存登录信息'}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            
            <div className="mt-6 pt-4 border-t border-background-alt space-y-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmStatusModal({
                    isOpen: true,
                    userId: selectedUser.id,
                    username: selectedUser.nickname || selectedUser.username,
                    currentDisabled: Boolean(selectedUser.is_disabled),
                  });
                }}
                className={cn(
                  "w-full rounded-2xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2",
                  selectedUser.is_disabled
                    ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                    : "bg-red-50 text-red-600 hover:bg-red-100"
                )}
              >
                {selectedUser.is_disabled ? <UserCheck className="w-4 h-4" /> : <UserX className="w-4 h-4" />}
                {selectedUser.is_disabled ? '恢复账号使用' : '停用该账号'}
              </button>

              <button
                type="button"
                onClick={() => void handleToggleExpert(selectedUser.id, Boolean(selectedUser.is_verified_expert))}
                className={cn(
                  "w-full rounded-2xl py-3 text-sm font-medium transition-colors flex items-center justify-center gap-2",
                  selectedUser.is_verified_expert
                    ? "bg-green-50 text-green-700 hover:bg-green-100"
                    : "bg-background-alt text-primary hover:bg-primary/10"
                )}
              >
                <BadgeCheck className="w-4 h-4" />
                {selectedUser.is_verified_expert ? '取消专业用户认证' : '认证为专业用户'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setConfirmRoleModal({ isOpen: true, userId: selectedUser.id, currentRole: selectedUser.role });
                }}
                className={cn(
                  "w-full py-3 rounded-2xl font-medium text-sm transition-colors flex items-center justify-center gap-2",
                  selectedUser.role === 'admin'
                    ? "bg-background-alt text-text-main hover:bg-background-alt/80"
                    : "bg-primary text-white hover:bg-primary/90"
                )}
              >
                <ShieldAlert className="w-4 h-4" />
                {selectedUser.role === 'admin' ? '取消管理员权限' : '设为管理员'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Disable/Enable Modal */}
      {confirmStatusModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 text-red-600 mb-4">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-text-main">
                {confirmStatusModal.currentDisabled ? '确认恢复账号' : '确认停用账号'}
              </h3>
            </div>
            <p className="text-text-muted text-sm mb-6">
              确定要{confirmStatusModal.currentDisabled ? '恢复账号' : '停用账号'} 
              <span className="font-bold text-text-main mx-1">
                {confirmStatusModal.username}
              </span>
              吗？{confirmStatusModal.currentDisabled ? '启用后该用户可正常登录使用。' : '停用后该用户将无法登录。'}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmStatusModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-background-alt text-text-main font-medium text-sm hover:bg-background-alt/80 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleToggleDisabled(confirmStatusModal.userId, confirmStatusModal.currentDisabled)}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-white font-medium text-sm transition-colors",
                  confirmStatusModal.currentDisabled ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
                )}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Role Modal */}
      {confirmRoleModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-3xl p-6 w-full max-w-sm shadow-xl">
            <div className="flex items-center gap-3 text-secondary mb-4">
              <AlertCircle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-text-main">确认修改角色</h3>
            </div>
            <p className="text-text-muted text-sm mb-6">
              确定要将该用户的角色修改为 
              <span className="font-bold text-text-main mx-1">
                {confirmRoleModal.currentRole === 'admin' ? '普通用户' : '管理员'}
              </span>
              吗？
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setConfirmRoleModal(null)}
                className="flex-1 py-2.5 rounded-xl bg-background-alt text-text-main font-medium text-sm hover:bg-background-alt/80 transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => handleToggleRole(confirmRoleModal.userId, confirmRoleModal.currentRole)}
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
