import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router';
import {
  Users,
  FileText,
  Image,
  Box,
  AlertCircle,
  RefreshCw,
  Activity,
  UserPlus,
  Clock,
  CookingPot,
  ChevronRight,
  TrendingUp,
  Zap,
  ShieldCheck,
  Bot,
  Sliders,
  Sparkles,
  Clock3,
  CheckCircle2,
} from 'lucide-react';
import api from '../services/api';
import { getAvatarUrl } from '../utils/avatar';

interface Stats {
  users: number;
  posts: number;
  recipes: number;
  inventory: number;
  kitchenware: number;
  ingredients?: number;
  kitchenwareCatalog?: number;
}

interface Trend {
  date: string;
  users: number;
  records: number;
  posts: number;
}

interface RecentUser {
  id: string;
  username: string;
  nickname: string;
  avatar_url: string;
  created_at: string;
}

interface RecentPost {
  id: string;
  username: string;
  nickname: string;
  content: string;
  image_url: string;
  category: string;
  created_at: string;
}

interface PendingFood {
  id: string;
  name: string;
  calories_100g: number;
  created_at: string;
  author_name: string;
}

interface AuditLogItem {
  id: number;
  adminUserId: number;
  adminName: string;
  action: string;
  resourceType: string;
  summary: string;
  createdAt: string;
}

interface AISummary {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  activeUsers: number;
}

const numberFormatter = new Intl.NumberFormat('zh-CN');
function formatNumber(val: number) {
  return numberFormatter.format(Number(val) || 0);
}

function formatRelativeTime(val: string) {
  if (!val) return '';
  const date = new Date(val.endsWith('Z') ? val : `${val.replace(' ', 'T')}Z`);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  return `${Math.floor(diffSec / 86400)} 天前`;
}

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);
  const [recent, setRecent] = useState<{
    recentUsers: RecentUser[];
    recentPosts: RecentPost[];
    pendingFoods: PendingFood[];
  } | null>(null);
  const [aiSummary, setAiSummary] = useState<AISummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, trendsRes, recentRes, aiUsageRes, auditLogsRes] = await Promise.allSettled([
        api.get('/admin/stats'),
        api.get('/admin/stats/trends'),
        api.get('/admin/stats/recent'),
        api.get('/admin/ai-usage?range=7d'),
        api.get('/admin/audit-logs?pageSize=5'),
      ]);

      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (trendsRes.status === 'fulfilled') setTrends(trendsRes.value.data);
      if (recentRes.status === 'fulfilled') setRecent(recentRes.value.data);
      if (aiUsageRes.status === 'fulfilled') setAiSummary(aiUsageRes.value.data.summary);
      if (auditLogsRes.status === 'fulfilled') setAuditLogs(auditLogsRes.value.data.items || []);
    } catch (err: any) {
      console.error('Error fetching dashboard data:', err);
      setError('获取数据失败，请检查网络或服务器状态');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const todayStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });

  const maxValue = useMemo(() => {
    if (!trends.length) return 100;
    let max = 0;
    trends.forEach((t) => {
      if (t.users > max) max = t.users;
      if (t.records > max) max = t.records;
      if (t.posts > max) max = t.posts;
    });
    return max > 0 ? max * 1.2 : 100;
  }, [trends]);

  const trendTotals = useMemo(() => {
    if (!trends.length) return null;
    const users = trends.reduce((acc, t) => acc + t.users, 0);
    const records = trends.reduce((acc, t) => acc + t.records, 0);
    const posts = trends.reduce((acc, t) => acc + t.posts, 0);
    return { users, records, posts };
  }, [trends]);

  const svgWidth = 800;
  const svgHeight = 250;
  const paddingX = 40;
  const paddingY = 20;

  const getCoordinates = (data: Trend[], key: keyof Trend) => {
    if (data.length === 0) return '';
    const stepX = (svgWidth - paddingX * 2) / (data.length - 1 || 1);
    const rangeY = svgHeight - paddingY * 2;

    return data
      .map((point, index) => {
        const x = paddingX + index * stepX;
        const val = point[key] as number;
        const y = svgHeight - paddingY - (val / maxValue) * rangeY;
        return `${x},${y}`;
      })
      .join(' ');
  };

  const formatTrendDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const renderChart = () => {
    if (trends.length === 0) {
      return (
        <div className="h-[250px] flex items-center justify-center text-text-muted">
          暂无趋势数据
        </div>
      );
    }

    const usersPoints = getCoordinates(trends, 'users');
    const recordsPoints = getCoordinates(trends, 'records');
    const postsPoints = getCoordinates(trends, 'posts');
    const stepX = (svgWidth - paddingX * 2) / (trends.length - 1 || 1);

    return (
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="w-full h-auto min-w-[600px] select-none"
          onMouseLeave={() => setHoveredTrendIndex(null)}
        >
          {/* Grid lines & Y-axis labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = paddingY + ratio * (svgHeight - paddingY * 2);
            const val = Math.round(maxValue * (1 - ratio));
            return (
              <g key={ratio}>
                <line
                  x1={paddingX}
                  y1={y}
                  x2={svgWidth - paddingX}
                  y2={y}
                  stroke="#F3F4F6"
                  strokeDasharray="4 4"
                />
                <text
                  x={paddingX - 10}
                  y={y + 4}
                  fontSize="11"
                  fill="#9CA3AF"
                  textAnchor="end"
                >
                  {val}
                </text>
              </g>
            );
          })}

          {/* X-axis date labels */}
          {trends.map((t, i) => {
            const isHovered = hoveredTrendIndex === i;
            return (
              <text
                key={i}
                x={paddingX + i * stepX}
                y={svgHeight - 2}
                fontSize="11"
                fontWeight={isHovered ? '700' : '500'}
                fill={isHovered ? '#2D6A4F' : '#6B7280'}
                textAnchor="middle"
              >
                {formatTrendDate(t.date)}
              </text>
            );
          })}

          {/* Lines */}
          <polyline
            points={usersPoints}
            fill="none"
            stroke="#2D6A4F"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={recordsPoints}
            fill="none"
            stroke="#3B82F6"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points={postsPoints}
            fill="none"
            stroke="#D4A276"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Hover line */}
          {hoveredTrendIndex !== null && (
            <line
              x1={paddingX + hoveredTrendIndex * stepX}
              y1={paddingY}
              x2={paddingX + hoveredTrendIndex * stepX}
              y2={svgHeight - paddingY}
              stroke="#9CA3AF"
              strokeDasharray="3 3"
              strokeWidth="1.5"
            />
          )}

          {/* Circles */}
          {trends.map((t, i) => {
            const cx = paddingX + i * stepX;
            const rangeY = svgHeight - paddingY * 2;
            const yUsers = svgHeight - paddingY - (t.users / maxValue) * rangeY;
            const yRecords = svgHeight - paddingY - (t.records / maxValue) * rangeY;
            const yPosts = svgHeight - paddingY - (t.posts / maxValue) * rangeY;
            const isHovered = hoveredTrendIndex === i;

            return (
              <g key={`points-${i}`}>
                <circle
                  cx={cx}
                  cy={yUsers}
                  r={isHovered ? '6' : '4'}
                  fill="#fff"
                  stroke="#2D6A4F"
                  strokeWidth={isHovered ? '3' : '2'}
                />
                <circle
                  cx={cx}
                  cy={yRecords}
                  r={isHovered ? '6' : '4'}
                  fill="#fff"
                  stroke="#3B82F6"
                  strokeWidth={isHovered ? '3' : '2'}
                />
                <circle
                  cx={cx}
                  cy={yPosts}
                  r={isHovered ? '6' : '4'}
                  fill="#fff"
                  stroke="#D4A276"
                  strokeWidth={isHovered ? '3' : '2'}
                />
              </g>
            );
          })}

          {/* Hitboxes */}
          {trends.map((_, i) => {
            const stepHalf = stepX / 2;
            const cx = paddingX + i * stepX;
            return (
              <rect
                key={`hitbox-${i}`}
                x={cx - stepHalf}
                y={0}
                width={stepX}
                height={svgHeight}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoveredTrendIndex(i)}
              />
            );
          })}
        </svg>
      </div>
    );
  };

  const statCards = [
    {
      title: '注册用户',
      value: stats?.users || 0,
      note: `近7天新增 +${trendTotals?.users || 0}`,
      icon: Users,
      color: 'text-primary',
      bg: 'bg-primary/10',
      link: '/admin/users',
    },
    {
      title: '食谱灵感',
      value: stats?.recipes || 0,
      note: '官方及共享食谱库',
      icon: FileText,
      color: 'text-secondary',
      bg: 'bg-secondary/10',
      link: '/admin/recipes',
    },
    {
      title: '社区动态',
      value: stats?.posts || 0,
      note: `近7天新增 +${trendTotals?.posts || 0}`,
      icon: Image,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      link: '/admin/community',
    },
    {
      title: '食材资产',
      value: stats?.ingredients ?? stats?.inventory ?? 0,
      note: `包含用户库存 ${stats?.inventory || 0} 件`,
      icon: Box,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      link: '/admin/ingredients',
    },
    {
      title: '厨具档案',
      value: (stats?.kitchenwareCatalog ?? 0) + (stats?.kitchenware ?? 0),
      note: `官方 ${stats?.kitchenwareCatalog || 0} 种 | 自定义 ${stats?.kitchenware || 0} 件`,
      icon: CookingPot,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
      link: '/admin/kitchenware',
    },
  ];

  const quickActions = [
    { label: 'AI 模型配置', icon: Sliders, link: '/admin/ai-config', color: 'text-primary bg-primary/10' },
    { label: 'Token 用量监控', icon: Zap, link: '/admin/ai-usage', color: 'text-amber-600 bg-amber-50' },
    { label: '待审核食材', icon: Clock, link: '/admin/ingredients', color: 'text-orange-600 bg-orange-50' },
    { label: '安全审计日志', icon: ShieldCheck, link: '/admin/security-audit', color: 'text-blue-600 bg-blue-50' },
  ];

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[24px] shadow-sm">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-lg text-text-main mb-6">{error}</p>
        <button
          type="button"
          onClick={fetchData}
          className="flex items-center px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="w-5 h-5 mr-2" />
          重新加载
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Top Banner & Quick Shortcuts */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-5 bg-white p-6 rounded-[24px] shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-bold text-text-main">欢迎回来，管理员 👋</h2>
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-600 border border-emerald-100">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              系统服务运行正常
            </span>
          </div>
          <p className="text-xs text-text-muted mt-1.5 flex items-center gap-2">
            <span>📅 {todayStr}</span>
            <span>·</span>
            <span>全站数据自动实时同步中</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.label}
              to={action.link}
              className="flex items-center gap-2 rounded-xl border border-gray-100 bg-background/50 px-3.5 py-2 text-xs font-medium text-text-main transition-all hover:bg-white hover:shadow-sm hover:border-gray-200"
            >
              <span className={`rounded-lg p-1.5 ${action.color}`}>
                <action.icon size={14} />
              </span>
              <span>{action.label}</span>
            </Link>
          ))}

          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="flex items-center px-3.5 py-2 bg-primary text-white text-xs font-medium rounded-xl hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50 ml-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>
      </div>

      {/* Stats Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5">
        {statCards.map((card, idx) => (
          <Link
            key={idx}
            to={card.link}
            className="group bg-white p-5 rounded-[24px] shadow-sm hover:shadow-md hover:-translate-y-1 transition-all flex flex-col justify-between"
          >
            <div className="flex items-start justify-between">
              <div className={`p-3.5 rounded-2xl ${card.bg} ${card.color} transition-transform group-hover:scale-105`}>
                <card.icon size={24} />
              </div>
              <ChevronRight className="w-4 h-4 text-text-muted/40 group-hover:text-text-muted group-hover:translate-x-0.5 transition-all" />
            </div>
            <div className="mt-4">
              <p className="text-text-muted text-xs font-medium">{card.title}</p>
              <h3 className="text-2xl font-bold text-text-main mt-0.5">
                {loading ? '-' : formatNumber(card.value)}
              </h3>
              <p className="text-[11px] text-text-muted/80 mt-1 truncate">{card.note}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Trends & AI Health Section (2 Cols + 1 Col) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Trends Chart (2 Cols) */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm xl:col-span-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
            <div>
              <h3 className="text-lg font-bold text-text-main flex items-center">
                <Activity className="mr-2 w-5 h-5 text-primary" /> 近 7 日平台运营趋势
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                跟踪每日新注册用户、饮食打卡记录与社区互动趋势
              </p>
            </div>
            <div className="flex items-center space-x-4 text-xs text-text-muted">
              <div className="flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-primary mr-1.5" />
                新用户
              </div>
              <div className="flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 mr-1.5" />
                饮食记录
              </div>
              <div className="flex items-center">
                <span className="w-2.5 h-2.5 rounded-full bg-secondary mr-1.5" />
                社区帖子
              </div>
            </div>
          </div>

          {/* Interactive Trend Detail Banner */}
          {hoveredTrendIndex !== null && trends[hoveredTrendIndex] ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-3.5 transition-all">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                <span className="font-bold text-text-main text-sm">
                  {trends[hoveredTrendIndex].date} 数据明细
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-xs">
                <div>
                  <span className="text-text-muted">新用户：</span>
                  <span className="font-bold text-primary ml-1">
                    {formatNumber(trends[hoveredTrendIndex].users)} 人
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">饮食记录：</span>
                  <span className="font-bold text-blue-600 ml-1">
                    {formatNumber(trends[hoveredTrendIndex].records)} 条
                  </span>
                </div>
                <div>
                  <span className="text-text-muted">社区帖子：</span>
                  <span className="font-bold text-secondary ml-1">
                    {formatNumber(trends[hoveredTrendIndex].posts)} 篇
                  </span>
                </div>
              </div>
            </div>
          ) : trendTotals ? (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-background-alt/50 p-3.5 transition-all">
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <span>近 7 天累计运营：</span>
              </div>
              <div className="flex flex-wrap items-center gap-6 text-xs">
                <div>
                  <span className="text-text-muted">新增用户：</span>
                  <span className="font-bold text-primary ml-1">{formatNumber(trendTotals.users)} 人</span>
                </div>
                <div>
                  <span className="text-text-muted">饮食记录：</span>
                  <span className="font-bold text-blue-600 ml-1">{formatNumber(trendTotals.records)} 条</span>
                </div>
                <div>
                  <span className="text-text-muted">社区发布：</span>
                  <span className="font-bold text-secondary ml-1">{formatNumber(trendTotals.posts)} 篇</span>
                </div>
              </div>
            </div>
          ) : null}

          {loading && !trends.length ? (
            <div className="h-[250px] flex items-center justify-center text-text-muted">
              加载中...
            </div>
          ) : (
            renderChart()
          )}
        </div>

        {/* AI Service Monitor Card (1 Col) */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-text-main flex items-center">
                <Zap className="mr-2 w-5 h-5 text-amber-500" /> AI 服务运行监控
              </h3>
              <Link
                to="/admin/ai-usage"
                className="text-xs text-amber-600 font-medium hover:underline flex items-center gap-0.5"
              >
                用量详情 <ChevronRight size={14} />
              </Link>
            </div>
            <p className="text-xs text-text-muted mb-4">近 7 天模型调用、Token 消耗与响应健康度</p>

            <div className="space-y-3.5">
              <div className="flex items-center justify-between p-3 rounded-2xl bg-amber-50/50 border border-amber-100/60">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <span className="text-xs text-text-muted block">Token 消耗总计</span>
                    <span className="font-bold text-text-main text-base">
                      {formatNumber(aiSummary?.totalTokens || 0)} Token
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-full font-medium">
                  近 7 天
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-2xl bg-background-alt/60">
                  <span className="text-text-muted block text-[11px]">调用请求</span>
                  <span className="font-bold text-text-main text-sm mt-0.5 block">
                    {formatNumber(aiSummary?.requests || 0)} 次
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {formatNumber(aiSummary?.activeUsers || 0)} 位活跃用户
                  </span>
                </div>
                <div className="p-3 rounded-2xl bg-background-alt/60">
                  <span className="text-text-muted block text-[11px]">请求成功率</span>
                  <span className="font-bold text-emerald-600 text-sm mt-0.5 block">
                    {aiSummary?.successRate !== undefined ? `${Number(aiSummary.successRate).toFixed(1)}%` : '—'}
                  </span>
                  <span className="text-[10px] text-text-muted">响应正常</span>
                </div>
              </div>

              <div className="p-3 rounded-2xl bg-background-alt/60 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Clock3 className="w-4 h-4 text-blue-500" />
                  <span className="text-text-muted">平均响应延迟</span>
                </div>
                <span className="font-semibold text-text-main">
                  {formatNumber(aiSummary?.avgLatencyMs || 0)} ms
                </span>
              </div>
            </div>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between">
            <span className="text-xs text-text-muted flex items-center gap-1">
              <Bot className="w-3.5 h-3.5 text-primary" /> Qwen 3.5 / SiliconFlow
            </span>
            <Link
              to="/admin/ai-config"
              className="text-xs text-primary font-medium hover:underline flex items-center gap-0.5"
            >
              配置 Key <ChevronRight size={12} />
            </Link>
          </div>
        </div>
      </div>

      {/* 2x2 Balanced Grid: Community Posts, Pending Assets, Recent Users, Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Card 1: Recent Posts */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                <Image className="w-5 h-5 text-secondary" /> 最新社区动态
              </h3>
              <Link
                to="/admin/community"
                className="text-xs text-secondary font-medium hover:underline flex items-center gap-0.5"
              >
                进入社区 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="space-y-4">
              {loading && !recent ? (
                <div className="text-center text-text-muted py-6 text-xs">加载中...</div>
              ) : (
                recent?.recentPosts.slice(0, 4).map((p) => (
                  <div key={p.id} className="flex items-start justify-between gap-3 p-2.5 rounded-2xl hover:bg-background-alt/50 transition-colors">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <img
                        src={getAvatarUrl(undefined, p.id)}
                        alt={p.nickname || p.username}
                        className="w-9 h-9 rounded-full object-cover shrink-0 bg-background-alt"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-text-main truncate">
                            {p.nickname || p.username}
                          </span>
                          {p.category && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-primary/10 text-primary font-medium shrink-0">
                              {p.category}
                            </span>
                          )}
                          <span className="text-[10px] text-text-muted shrink-0 ml-auto">
                            {formatRelativeTime(p.created_at)}
                          </span>
                        </div>
                        <p className="text-xs text-text-muted mt-1 line-clamp-1 leading-relaxed">
                          {p.content || '发布了新图片动态'}
                        </p>
                      </div>
                    </div>
                    {p.image_url ? (
                      <img
                        src={p.image_url}
                        alt="post thumbnail"
                        className="w-11 h-11 rounded-xl object-cover bg-background-alt shrink-0"
                      />
                    ) : null}
                  </div>
                ))
              )}
              {!loading && recent?.recentPosts.length === 0 && (
                <div className="text-center text-text-muted py-8 text-xs">暂无社区动态</div>
              )}
            </div>
          </div>
        </div>

        {/* Card 2: Pending Foods & Assets */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" /> 待审核膳食资产
              </h3>
              <Link
                to="/admin/ingredients"
                className="text-xs text-orange-500 font-medium hover:underline flex items-center gap-0.5"
              >
                前往审核 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="space-y-3">
              {loading && !recent ? (
                <div className="text-center text-text-muted py-6 text-xs">加载中...</div>
              ) : recent?.pendingFoods && recent.pendingFoods.length > 0 ? (
                recent.pendingFoods.slice(0, 4).map((f) => (
                  <Link
                    key={f.id}
                    to="/admin/ingredients"
                    className="group flex items-center justify-between p-3 bg-orange-50/40 rounded-2xl border border-orange-100/60 hover:bg-orange-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-sm shrink-0">
                        🍎
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-main truncate">{f.name}</p>
                        <p className="text-[11px] text-text-muted mt-0.5">
                          {f.calories_100g} kcal/100g • 由 {f.author_name || '用户'} 提交
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-orange-600 font-medium px-2.5 py-1 bg-white rounded-lg shadow-sm shrink-0 group-hover:bg-orange-600 group-hover:text-white transition-colors">
                      审核
                    </span>
                  </Link>
                ))
              ) : (
                <div className="py-8 px-4 text-center rounded-2xl bg-emerald-50/50 border border-emerald-100 flex flex-col items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                  <p className="text-xs font-bold text-text-main">当前暂无待审核食材</p>
                  <p className="text-[11px] text-text-muted mt-1 mb-3">所有用户自定义食物与食谱库均已审核完毕</p>
                  <Link
                    to="/admin/ingredients"
                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-white px-3 py-1.5 rounded-xl border border-emerald-200 shadow-sm hover:bg-emerald-50 transition-colors"
                  >
                    查看官方标准食材库 <ChevronRight size={12} />
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Card 3: Recent Users */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-primary" /> 最新注册用户
              </h3>
              <Link
                to="/admin/users"
                className="text-xs text-primary font-medium hover:underline flex items-center gap-0.5"
              >
                用户管理 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="space-y-3">
              {loading && !recent ? (
                <div className="text-center text-text-muted py-6 text-xs">加载中...</div>
              ) : (
                recent?.recentUsers.slice(0, 4).map((u) => (
                  <div key={u.id} className="flex items-center justify-between p-2.5 rounded-2xl hover:bg-background-alt/50 transition-colors">
                    <div className="flex items-center space-x-3 min-w-0">
                      <img
                        src={getAvatarUrl(u.avatar_url, u.id)}
                        alt={u.nickname || u.username}
                        className="w-10 h-10 rounded-full object-cover bg-background-alt shrink-0"
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-text-main truncate">
                          {u.nickname || u.username}
                        </p>
                        <p className="text-[11px] text-text-muted truncate">@{u.username}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="text-[10px] text-text-muted block">
                        {formatRelativeTime(u.created_at)}
                      </span>
                      <span className="text-[10px] font-mono text-text-muted/60 bg-background-alt px-1.5 py-0.5 rounded mt-0.5 inline-block">
                        ID {u.id}
                      </span>
                    </div>
                  </div>
                ))
              )}
              {!loading && recent?.recentUsers.length === 0 && (
                <div className="text-center text-text-muted py-8 text-xs">暂无新注册用户</div>
              )}
            </div>
          </div>
        </div>

        {/* Card 4: Audit Logs */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
              <h3 className="text-base font-bold text-text-main flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-blue-600" /> 管理员审计日志
              </h3>
              <Link
                to="/admin/security-audit"
                className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-0.5"
              >
                安全审计 <ChevronRight size={14} />
              </Link>
            </div>
            <div className="space-y-3">
              {loading && !auditLogs.length ? (
                <div className="text-center text-text-muted py-6 text-xs">加载中...</div>
              ) : (
                auditLogs.slice(0, 4).map((log) => (
                  <div key={log.id} className="flex items-start gap-3 p-2.5 rounded-2xl hover:bg-background-alt/50 transition-colors">
                    <div className="p-2 rounded-xl bg-blue-50 text-blue-600 shrink-0 mt-0.5">
                      <ShieldCheck size={16} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text-main">{log.adminName}</span>
                        <span className="text-[10px] text-text-muted">{formatRelativeTime(log.createdAt)}</span>
                      </div>
                      <p className="text-[11px] text-text-muted mt-0.5 line-clamp-1">{log.summary}</p>
                    </div>
                  </div>
                ))
              )}
              {!loading && auditLogs.length === 0 && (
                <div className="text-center text-text-muted py-8 text-xs">暂无审计日志</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
