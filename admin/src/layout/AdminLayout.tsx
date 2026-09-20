import { Outlet, NavLink, useLocation, useNavigate, Link } from 'react-router';
import {
  ChevronDown, Globe, Menu, X, User, LayoutDashboard, LogOut, KeyRound,
  Apple, BookOpen, CookingPot, Users, MessageSquare, Bell, Award,
  BarChart3, Activity, SlidersHorizontal, Workflow, AudioLines,
  Settings, ShieldCheck, DatabaseZap, Smartphone,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import api from '../services/api';
import { logoUrl } from '../assets';
import { adminGroups, adminLocation, workbench } from '../navigation/adminNavigation';
import { DialogFrame } from '../components/admin/DialogFrame';
import './admin.css';

const pageIcons: Record<string, typeof Settings> = {
  '/admin/ingredients': Apple,
  '/admin/recipes': BookOpen,
  '/admin/kitchenware': CookingPot,
  '/admin/kitchenware-mapping-reviews': CookingPot,
  '/admin/users': Users,
  '/admin/feedback': MessageSquare,
  '/admin/community': MessageSquare,
  '/admin/notifications': Bell,
  '/admin/user-level-rule': Award,
  '/admin/analytics': BarChart3,
  '/admin/core-loops': Activity,
  '/admin/ai-config': SlidersHorizontal,
  '/admin/ai-usage': BarChart3,
  '/admin/ai-conversations': MessageSquare,
  '/admin/agent-runs': Workflow,
  '/admin/voice-packs': AudioLines,
  '/admin/site-settings': Settings,
  '/admin/auth-services/sms': Smartphone,
  '/admin/security': ShieldCheck,
  '/admin/media-cleanup': DatabaseZap,
};

function savedGroups(): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem('admin.nav.groups') || '{}');
    return typeof value === 'object' && value !== null ? value : {};
  } catch {
    return {};
  }
}

export default function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const mainScrollRef = useRef<HTMLElement>(null);
  const [adminName, setAdminName] = useState('管理员');
  const [openGroups, setOpenGroups] = useState(savedGroups);
  const [mobileOpen, setMobileOpen] = useState(false);
  const current = adminLocation(location.pathname);

  useEffect(() => {
    document.title = (current.page?.label || '管理控制台') + '｜食光烙记';
  }, [current.page]);

  useEffect(() => {
    let active = true;
    api.get('/auth/me').then(({ data }) => {
      if (!active) return;
      if (data.role !== 'admin') {
        localStorage.removeItem('adminToken');
        navigate('/login?reason=insufficient-role', { replace: true });
      } else {
        setAdminName(data.username || '管理员');
      }
    }).catch(() => undefined);
    return () => { active = false; };
  }, [navigate]);

  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    if (current.group) setOpenGroups(old => ({ ...old, [current.group!.id]: true }));
  }, [current.group, location.pathname]);
  useLayoutEffect(() => { mainScrollRef.current?.scrollTo(0, 0); }, [location.pathname]);

  const toggleGroup = (id: string) => setOpenGroups(old => {
    const next = { ...old, [id]: !old[id] };
    try { localStorage.setItem('admin.nav.groups', JSON.stringify(next)); }
    catch { /* Navigation remains usable without storage. */ }
    return next;
  });
  const logout = () => {
    localStorage.removeItem('adminToken');
    navigate('/login');
  };

  const sidebar = <>
    <Link to="/admin" className="admin-brand">
      <img src={logoUrl} alt="" />
      <span>食光烙记<small>管理控制台</small></span>
    </Link>
    <nav aria-label="管理导航" className="admin-navigation">
      <NavLink to={workbench.path} end className={({ isActive }) => 'admin-nav-link' + (isActive ? ' is-active' : '')}>
        <LayoutDashboard aria-hidden="true" />{workbench.label}
      </NavLink>
      {adminGroups.map(group => (
        <div key={group.id} className={'admin-nav-group' + (current.group?.id === group.id ? ' is-current' : '')}>
          <button type="button" aria-expanded={!!openGroups[group.id]} onClick={() => toggleGroup(group.id)}>
            <group.icon aria-hidden="true" />
            <span>{group.label}</span>
            <ChevronDown size={16} aria-hidden="true" className={openGroups[group.id] ? 'rotate-180' : ''} />
          </button>
          {openGroups[group.id] && (
            <div className="admin-nav-children">
              {group.pages.map(page => {
                const Icon = pageIcons[page.path] || group.icon;
                return <NavLink key={page.path} to={page.path} end className={({ isActive }) => 'admin-nav-link' + (isActive ? ' is-active' : '')}>
                  <Icon aria-hidden="true" /><span>{page.label}</span>
                </NavLink>;
              })}
            </div>
          )}
        </div>
      ))}
    </nav>
    <footer className="admin-sidebar-footer">
      <div className="admin-profile">
        <span className="admin-profile-icon"><User size={18} aria-hidden="true" /></span>
        <div><strong>{adminName}</strong><small>管理员</small></div>
      </div>
      <Link to="/" target="_blank" rel="noopener noreferrer" className="admin-footer-link">
        <Globe size={18} aria-hidden="true" />查看宣传官网 ↗
      </Link>
      <Link to="/change-password" className="admin-footer-link">
        <KeyRound size={18} aria-hidden="true" />修改密码
      </Link>
      <button type="button" className="admin-footer-link is-logout" onClick={logout}>
        <LogOut size={18} aria-hidden="true" />退出登录
      </button>
    </footer>
  </>;

  return <div className="admin-shell">
    <a href="#admin-main" className="admin-skip">跳到正文</a>
    <aside className="admin-sidebar">{sidebar}</aside>
    {mobileOpen && (
      <DialogFrame className="admin-mobile-backdrop" aria-label="管理导航菜单" onClose={() => setMobileOpen(false)}>
        <aside className="admin-mobile-sidebar">
          <button type="button" className="admin-mobile-close admin-button" aria-label="关闭菜单" onClick={() => setMobileOpen(false)}>
            <X size={18} />
          </button>
          {sidebar}
        </aside>
      </DialogFrame>
    )}
    <div className="admin-workspace">
      <header className="admin-topbar">
        <button type="button" className="admin-menu-button admin-button" aria-label="打开菜单" onClick={() => setMobileOpen(true)}>
          <Menu size={18} />
        </button>
        <nav aria-label="面包屑">
          <Link to="/admin">工作台</Link>
          {current.group && <><span>/</span><span>{current.group.label}</span></>}
          {location.pathname !== '/admin' && <><span>/</span><span aria-current="page">{current.page?.label || '页面'}</span></>}
        </nav>
      </header>
      <main id="admin-main" ref={mainScrollRef} tabIndex={-1} className="admin-main">
        <div className="admin-page"><Outlet /></div>
      </main>
    </div>
  </div>;
}
