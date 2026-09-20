import { LayoutDashboard, BookOpen, Users, BarChart3, Bot, Settings } from 'lucide-react';
export interface AdminPage { path: string; label: string }
export interface AdminGroup { id: string; label: string; icon: typeof Settings; pages: AdminPage[] }
export const workbench: AdminPage = { path: '/admin', label: '工作台' };
export const workbenchIcon = LayoutDashboard;
export const adminGroups: AdminGroup[] = [
  { id: 'content', label: '内容管理', icon: BookOpen, pages: [
    { path: '/admin/ingredients', label: '食材库' }, { path: '/admin/recipes', label: '食谱库' },
    { path: '/admin/kitchenware', label: '厨具库' }, { path: '/admin/kitchenware-mapping-reviews', label: '厨具映射审核' },
  ] },
  { id: 'operations', label: '用户与运营', icon: Users, pages: [
    { path: '/admin/users', label: '用户管理' }, { path: '/admin/feedback', label: '用户反馈' },
    { path: '/admin/community', label: '社区管理' }, { path: '/admin/notifications', label: '通知中心' },
    { path: '/admin/user-level-rule', label: '等级规则' },
  ] },
  { id: 'analytics', label: '数据分析', icon: BarChart3, pages: [
    { path: '/admin/analytics', label: '数据概览' }, { path: '/admin/core-loops', label: '每周核心闭环' },
  ] },
  { id: 'ai', label: 'AI 服务', icon: Bot, pages: [
    { path: '/admin/ai-config', label: '模型配置' }, { path: '/admin/ai-usage', label: '模型用量' },
    { path: '/admin/ai-conversations', label: '对话记录' }, { path: '/admin/agent-runs', label: '任务运行' },
    { path: '/admin/voice-packs', label: '音色目录' },
  ] },
  { id: 'system', label: '系统设置', icon: Settings, pages: [
    { path: '/admin/site-settings', label: '网站设置' }, { path: '/admin/auth-services/sms', label: '短信认证' },
    { path: '/admin/security', label: '安全审计' }, { path: '/admin/media-cleanup', label: '媒体清理' },
  ] },
];
export const adminPages = [workbench, ...adminGroups.flatMap(group => group.pages)];
export function adminLocation(path: string) {
  const normalized = path.replace(/\/$/, '') || '/';
  const group = adminGroups.find(item => item.pages.some(page => page.path === normalized));
  const page = adminPages.find(item => item.path === normalized);
  return { group, page };
}
export function adminLink(path: string, query?: Record<string, string>) {
  const page = adminPages.find(item => item.path === path);
  if (!page) throw new Error(`Unknown admin page: ${path}`);
  return { label: page.label, to: query ? `${path}?${new URLSearchParams(query)}` : path };
}
