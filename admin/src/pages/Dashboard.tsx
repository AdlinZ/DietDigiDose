import { useEffect, useState, useMemo } from 'react';
import { Users, FileText, Image, Box, AlertCircle, RefreshCw, Activity, UserPlus, Clock, ArrowRight, CookingPot } from 'lucide-react';
import api from '../services/api';
import { getAvatarUrl } from '../utils/avatar';

interface Stats {
  users: number;
  posts: number;
  recipes: number;
  inventory: number;
  kitchenware: number;
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

export default function Dashboard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [trends, setTrends] = useState<Trend[]>([]);
  const [recent, setRecent] = useState<{
    recentUsers: RecentUser[];
    recentPosts: RecentPost[];
    pendingFoods: PendingFood[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statsRes, trendsRes, recentRes] = await Promise.all([
        api.get('/admin/stats'),
        api.get('/admin/stats/trends'),
        api.get('/admin/stats/recent')
      ]);
      setStats(statsRes.data);
      setTrends(trendsRes.data);
      setRecent(recentRes.data);
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
    weekday: 'long'
  });

  const maxValue = useMemo(() => {
    if (!trends.length) return 100;
    let max = 0;
    trends.forEach(t => {
      if (t.users > max) max = t.users;
      if (t.records > max) max = t.records;
      if (t.posts > max) max = t.posts;
    });
    return max > 0 ? max * 1.2 : 100;
  }, [trends]);

  const svgWidth = 800;
  const svgHeight = 250;
  const paddingX = 40;
  const paddingY = 20;
  
  const getCoordinates = (data: Trend[], key: keyof Trend) => {
    if (data.length === 0) return '';
    const stepX = (svgWidth - paddingX * 2) / (data.length - 1 || 1);
    const rangeY = svgHeight - paddingY * 2;
    
    return data.map((point, index) => {
      const x = paddingX + index * stepX;
      const val = point[key] as number;
      const y = svgHeight - paddingY - (val / maxValue) * rangeY;
      return `${x},${y}`;
    }).join(' ');
  };
  
  const formatTrendDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const renderChart = () => {
    if (trends.length === 0) return <div className="h-[250px] flex items-center justify-center text-text-muted">暂无趋势数据</div>;
    
    const usersPoints = getCoordinates(trends, 'users');
    const recordsPoints = getCoordinates(trends, 'records');
    const postsPoints = getCoordinates(trends, 'posts');
    const stepX = (svgWidth - paddingX * 2) / (trends.length - 1 || 1);

    return (
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="w-full h-auto min-w-[600px]">
          {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
            const y = paddingY + ratio * (svgHeight - paddingY * 2);
            const val = Math.round(maxValue * (1 - ratio));
            return (
              <g key={ratio}>
                <line x1={paddingX} y1={y} x2={svgWidth - paddingX} y2={y} stroke="#E5E7EB" strokeDasharray="4 4" />
                <text x={paddingX - 10} y={y + 4} fontSize="12" fill="#8B7D6B" textAnchor="end">{val}</text>
              </g>
            );
          })}
          
          {trends.map((t, i) => (
            <text key={i} x={paddingX + i * stepX} y={svgHeight - 2} fontSize="12" fill="#8B7D6B" textAnchor="middle">
              {formatTrendDate(t.date)}
            </text>
          ))}

          <polyline points={usersPoints} fill="none" stroke="#2D6A4F" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={recordsPoints} fill="none" stroke="#3B82F6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points={postsPoints} fill="none" stroke="#D4A276" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          
          {trends.map((t, i) => {
            const cx = paddingX + i * stepX;
            const rangeY = svgHeight - paddingY * 2;
            const yUsers = svgHeight - paddingY - (t.users / maxValue) * rangeY;
            const yRecords = svgHeight - paddingY - (t.records / maxValue) * rangeY;
            const yPosts = svgHeight - paddingY - (t.posts / maxValue) * rangeY;
            return (
              <g key={`points-${i}`}>
                <circle cx={cx} cy={yUsers} r="4" fill="#fff" stroke="#2D6A4F" strokeWidth="2" />
                <circle cx={cx} cy={yRecords} r="4" fill="#fff" stroke="#3B82F6" strokeWidth="2" />
                <circle cx={cx} cy={yPosts} r="4" fill="#fff" stroke="#D4A276" strokeWidth="2" />
              </g>
            );
          })}
        </svg>
      </div>
    );
  };

  const statCards = [
    { title: '总用户数', value: stats?.users || 0, icon: Users, color: 'text-primary', bg: 'bg-[#2D6A4F]/10' },
    { title: '总食谱数', value: stats?.recipes || 0, icon: FileText, color: 'text-secondary', bg: 'bg-[#D4A276]/10' },
    { title: '社区帖子', value: stats?.posts || 0, icon: Image, color: 'text-blue-500', bg: 'bg-blue-50' },
    { title: '食材记录', value: stats?.inventory || 0, icon: Box, color: 'text-orange-500', bg: 'bg-orange-50' },
    { title: '厨具资产', value: stats?.kitchenware || 0, icon: CookingPot, color: 'text-emerald-600', bg: 'bg-emerald-50' },
  ];

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-white rounded-[24px] shadow-sm">
        <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
        <p className="text-lg text-text-main mb-6">{error}</p>
        <button 
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
      {/* Welcome Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-text-main">欢迎回来，管理员</h2>
          <p className="text-text-muted mt-1">{todayStr}</p>
        </div>
        <button 
          onClick={fetchData} 
          disabled={loading}
          className="flex items-center px-4 py-2 bg-white border border-gray-100 text-text-main rounded-xl hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          刷新数据
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6">
        {statCards.map((card, idx) => (
          <div key={idx} className="bg-white p-6 rounded-[24px] shadow-sm flex items-center space-x-4">
            <div className={`p-4 rounded-2xl ${card.bg} ${card.color}`}>
              <card.icon size={28} />
            </div>
            <div>
              <p className="text-text-muted text-sm font-medium">{card.title}</p>
              <h3 className="text-3xl font-bold text-text-main mt-1">
                {loading ? '-' : card.value}
              </h3>
            </div>
          </div>
        ))}
      </div>

      {/* Trends Chart */}
      <div className="bg-white rounded-[24px] p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
          <h3 className="text-lg font-bold text-text-main flex items-center">
            <Activity className="mr-2 w-5 h-5 text-primary" /> 近7日数据趋势
          </h3>
          <div className="flex items-center space-x-4 mt-4 sm:mt-0 text-sm">
            <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-primary mr-2"></span>新用户</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-blue-500 mr-2"></span>饮食记录</div>
            <div className="flex items-center"><span className="w-3 h-3 rounded-full bg-secondary mr-2"></span>社区帖子</div>
          </div>
        </div>
        {loading && !trends.length ? (
          <div className="h-[250px] flex items-center justify-center text-text-muted">加载中...</div>
        ) : (
          renderChart()
        )}
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Users */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-text-main flex items-center">
              <UserPlus className="mr-2 w-5 h-5 text-primary" /> 最新用户
            </h3>
          </div>
          <div className="space-y-4">
            {loading && !recent ? (
              <div className="text-center text-text-muted py-4">加载中...</div>
            ) : recent?.recentUsers.map(u => (
              <div key={u.id} className="flex items-center space-x-3">
                <img
                  src={getAvatarUrl(u.avatar_url, u.id)}
                  alt={u.nickname || u.username}
                  className="w-10 h-10 rounded-full object-cover bg-background-alt"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-main truncate">{u.nickname || u.username}</p>
                  <p className="text-xs text-text-muted truncate">@{u.username}</p>
                </div>
                <div className="text-xs text-text-muted">
                  {new Date(u.created_at).toLocaleDateString()}
                </div>
              </div>
            ))}
            {!loading && recent?.recentUsers.length === 0 && (
              <div className="text-center text-text-muted py-4">暂无新用户</div>
            )}
          </div>
        </div>

        {/* Posts */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-text-main flex items-center">
              <Image className="mr-2 w-5 h-5 text-secondary" /> 最新帖子
            </h3>
          </div>
          <div className="space-y-4">
            {loading && !recent ? (
              <div className="text-center text-text-muted py-4">加载中...</div>
            ) : recent?.recentPosts.map(p => (
              <div key={p.id} className="flex items-start space-x-3">
                {p.image_url ? (
                  <img src={p.image_url} alt="post" className="w-12 h-12 rounded-lg object-cover bg-background-alt" />
                ) : (
                  <div className="w-12 h-12 rounded-lg bg-background-alt flex items-center justify-center text-text-muted">
                    <Image size={20} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-text-main line-clamp-2">{p.content || '无内容'}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {p.category && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-background-alt text-text-muted">
                        {p.category}
                      </span>
                    )}
                    <span className="text-xs text-text-muted truncate">{p.nickname}</span>
                  </div>
                </div>
              </div>
            ))}
            {!loading && recent?.recentPosts.length === 0 && (
              <div className="text-center text-text-muted py-4">暂无新帖子</div>
            )}
          </div>
        </div>

        {/* Pending Foods */}
        <div className="bg-white rounded-[24px] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-text-main flex items-center">
              <Clock className="mr-2 w-5 h-5 text-orange-500" /> 待审核食材
            </h3>
          </div>
          <div className="space-y-4">
            {loading && !recent ? (
              <div className="text-center text-text-muted py-4">加载中...</div>
            ) : recent?.pendingFoods.map(f => (
              <div key={f.id} className="group flex items-center justify-between p-3 bg-background rounded-xl hover:bg-background-alt transition-colors cursor-pointer" title="前往食材管理">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-main truncate">{f.name}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {f.calories_100g} kcal/100g • {f.author_name}提交
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity ml-2 flex-shrink-0" />
              </div>
            ))}
            {!loading && recent?.pendingFoods.length === 0 && (
              <div className="text-center text-text-muted py-4">暂无待审核食材</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
