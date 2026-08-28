import { Outlet, NavLink, useLocation, useNavigate, Link } from 'react-router';
import {
  LayoutDashboard,
  Users,
  BookOpen,
  MessageSquare,
  LogOut,
  Apple,
  Bot,
  ChartNoAxesCombined,
  ShieldCheck,
  Globe,
  User,
  CookingPot,
  ChevronDown,
  Layers3,
  SlidersHorizontal,
  Bell,
  Workflow,
  DatabaseZap,
} from 'lucide-react';
import { cn } from '../utils/cn';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../services/api';
import logoUrl from '../../../client/assets/logo.png';

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const mainScrollRef = useRef<HTMLElement>(null);
  const [adminName, setAdminName] = useState('');
  const assetRoutes = ['/admin/ingredients', '/admin/recipes', '/admin/kitchenware'];
  const assetSectionActive = assetRoutes.some((route) => location.pathname.startsWith(route));
  const [assetSectionOpen, setAssetSectionOpen] = useState(assetSectionActive);
  const aiRoutes = ['/admin/ai-config', '/admin/ai-usage', '/admin/ai-conversations', '/admin/agent-runs'];
  const aiSectionActive = aiRoutes.some((route) => location.pathname.startsWith(route));
  const [aiSectionOpen, setAiSectionOpen] = useState(aiSectionActive);

  useEffect(() => {
    api.get('/auth/me').then(({ data }) => {
      if (data.role !== 'admin') {
        localStorage.removeItem('adminToken');
        navigate('/login?reason=insufficient-role', { replace: true });
        return;
      }
      setAdminName(data.username || '管理员');
    }).catch(() => undefined);
  }, [navigate]);

  useEffect(() => {
    if (assetSectionActive) setAssetSectionOpen(true);
  }, [assetSectionActive]);

  useEffect(() => {
    if (aiSectionActive) setAiSectionOpen(true);
  }, [aiSectionActive]);

  // The main panel owns the scroll instead of the document. Reset it when the
  // route changes so a newly opened page never inherits the previous page's
  // scroll position and appears clipped from the top.
  useLayoutEffect(() => {
    if (!mainScrollRef.current) return;
    mainScrollRef.current.scrollTop = 0;
    mainScrollRef.current.scrollLeft = 0;
  }, [location.pathname]);

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    navigate('/login');
  };

  const primaryNavItems = [
    { to: '/admin', icon: LayoutDashboard, label: '数据看板', end: true },
    { to: '/admin/users', icon: Users, label: '用户管理' },
  ];
  const assetNavItems = [
    { to: '/admin/ingredients', icon: Apple, label: '食材库' },
    { to: '/admin/recipes', icon: BookOpen, label: '食谱库' },
    { to: '/admin/kitchenware', icon: CookingPot, label: '厨具资产' },
  ];
  const aiNavItems = [
    { to: '/admin/ai-config', icon: SlidersHorizontal, label: '模型配置' },
    { to: '/admin/ai-usage', icon: ChartNoAxesCombined, label: '模型用量' },
    { to: '/admin/ai-conversations', icon: MessageSquare, label: '对话记录' },
    { to: '/admin/agent-runs', icon: Workflow, label: 'Agent 运行' },
  ];
  const secondaryNavItems = [
    { to: '/admin/community', icon: MessageSquare, label: '社区审核' },
  ];
  const finalNavItems = [
    { to: '/admin/notifications', icon: Bell, label: '通知中心' },
    { to: '/admin/media-cleanup', icon: DatabaseZap, label: '媒体清理' },
    { to: '/admin/security', icon: ShieldCheck, label: '安全审计' },
  ];

  return (
    <div className="flex h-screen h-dvh min-h-0 overflow-hidden bg-background-alt font-sans">
      {/* Sidebar */}
      <aside className="flex min-h-0 w-64 shrink-0 flex-col bg-background shadow-md">
        <div className="flex items-center gap-3 border-b border-gray-100 p-5">
          <img
            src={logoUrl}
            alt="食光烙记"
            className="h-12 w-12 shrink-0 object-contain"
          />
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold text-primary">食光烙记</h1>
            <p className="mt-0.5 text-xs text-text-muted">管理控制台</p>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {primaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center space-x-3 px-4 py-3 rounded-2xl transition-colors',
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-main hover:bg-gray-100 hover:text-primary'
                )
              }
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}

          <div
            className={cn(
              'rounded-2xl transition-colors',
              assetSectionActive ? 'bg-primary/8' : '',
            )}
          >
            <button
              type="button"
              onClick={() => setAssetSectionOpen((open) => !open)}
              aria-expanded={assetSectionOpen}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors',
                assetSectionActive
                  ? 'font-medium text-primary'
                  : 'text-text-main hover:bg-gray-100 hover:text-primary',
              )}
            >
              <Layers3 size={20} />
              <span className="flex-1 font-medium">膳食资产</span>
              <ChevronDown
                size={16}
                className={cn('transition-transform', assetSectionOpen ? 'rotate-180' : '')}
              />
            </button>

            {assetSectionOpen ? (
              <div className="space-y-1 px-2 pb-2">
                {assetNavItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-xl px-4 py-2.5 pl-8 text-sm transition-colors',
                        isActive
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-text-muted hover:bg-white hover:text-primary',
                      )
                    }
                  >
                    <item.icon size={17} />
                    <span className="font-medium">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>

          {secondaryNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center space-x-3 px-4 py-3 rounded-2xl transition-colors',
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-main hover:bg-gray-100 hover:text-primary'
                )
              }
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}

          <div
            className={cn(
              'rounded-2xl transition-colors',
              aiSectionActive ? 'bg-primary/8' : '',
            )}
          >
            <button
              type="button"
              onClick={() => setAiSectionOpen((open) => !open)}
              aria-expanded={aiSectionOpen}
              className={cn(
                'flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors',
                aiSectionActive
                  ? 'font-medium text-primary'
                  : 'text-text-main hover:bg-gray-100 hover:text-primary',
              )}
            >
              <Bot size={20} />
              <span className="flex-1 font-medium">AI 服务</span>
              <ChevronDown
                size={16}
                className={cn('transition-transform', aiSectionOpen ? 'rotate-180' : '')}
              />
            </button>

            {aiSectionOpen ? (
              <div className="space-y-1 px-2 pb-2">
                {aiNavItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-xl px-4 py-2.5 pl-8 text-sm transition-colors',
                        isActive
                          ? 'bg-primary text-white shadow-sm'
                          : 'text-text-muted hover:bg-white hover:text-primary',
                      )
                    }
                  >
                    <item.icon size={17} />
                    <span className="font-medium">{item.label}</span>
                  </NavLink>
                ))}
              </div>
            ) : null}
          </div>

          {finalNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center space-x-3 px-4 py-3 rounded-2xl transition-colors',
                  isActive
                    ? 'bg-primary text-white shadow-sm'
                    : 'text-text-main hover:bg-gray-100 hover:text-primary'
                )
              }
            >
              <item.icon size={20} />
              <span className="font-medium">{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-gray-100 space-y-2 shrink-0">
          {/* 管理员信息 */}
          {adminName && (
            <div className="flex items-center space-x-3 px-4 py-3">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <User size={16} className="text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-main truncate">{adminName}</p>
                <p className="text-[11px] text-text-muted">管理员</p>
              </div>
            </div>
          )}
          <Link
            to="/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center space-x-3 px-4 py-3 w-full text-left text-primary hover:bg-[#2D6A4F]/10 rounded-2xl transition-colors font-medium text-sm"
          >
            <Globe size={18} />
            <span>查看宣传官网 ↗</span>
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center space-x-3 px-4 py-3 w-full text-left text-red-500 hover:bg-red-50 rounded-2xl transition-colors text-sm font-medium"
          >
            <LogOut size={18} />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main ref={mainScrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="p-4 sm:p-6 lg:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
