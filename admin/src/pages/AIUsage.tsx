import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  Search,
  Users,
  Zap,
} from 'lucide-react';
import api from '../services/api';
import { getAvatarUrl } from '../utils/avatar';

type RangeKey = '7d' | '30d' | '90d' | 'all';

interface UsageSummary {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  activeUsers: number;
}

interface UsageTrend {
  date: string;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface UsageBreakdown {
  model?: string;
  endpoint?: string;
  requests: number;
  totalTokens: number;
}

interface UserUsage {
  id: number;
  username: string;
  nickname: string | null;
  avatarUrl: string | null;
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  successRate: number;
  lastUsedAt: string | null;
}

interface UsageResponse {
  range: RangeKey;
  selectedUserId: number | null;
  summary: UsageSummary;
  trend: UsageTrend[];
  models: UsageBreakdown[];
  endpoints: UsageBreakdown[];
  users: UserUsage[];
}

const rangeOptions: Array<{ value: RangeKey; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
  { value: 'all', label: '全部时间' },
];

const endpointNames: Record<string, string> = {
  chat: 'AI 营养对话',
  'vision-food': '餐食图片识别',
  'scan-receipt': '小票 / 食材扫描',
  'voice-command': '烹饪语音问答',
};

const numberFormatter = new Intl.NumberFormat('zh-CN');

function formatNumber(value: number) {
  return numberFormatter.format(Number(value) || 0);
}

function formatDateTime(value: string | null) {
  if (!value) return '暂无调用';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AIUsage() {
  const [range, setRange] = useState<RangeKey>('30d');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get<UsageResponse>('/admin/ai-usage', {
        params: {
          range,
          userId: selectedUserId || undefined,
        },
      });
      setData(response.data);
    } catch (requestError) {
      console.error('Error fetching AI usage:', requestError);
      setError('模型用量加载失败，请检查服务器连接后重试');
    } finally {
      setLoading(false);
    }
  }, [range, selectedUserId]);

  useEffect(() => {
    fetchUsage();
  }, [fetchUsage]);

  const filteredUsers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return data?.users ?? [];
    return (data?.users ?? []).filter((user) =>
      user.username.toLowerCase().includes(query)
      || user.nickname?.toLowerCase().includes(query)
      || String(user.id).includes(query)
    );
  }, [data?.users, searchQuery]);

  const displayedTrend = useMemo(() => (data?.trend ?? []).slice(-30), [data?.trend]);
  const maxTrendTokens = Math.max(...displayedTrend.map((item) => item.totalTokens), 1);
  const maxModelTokens = Math.max(...(data?.models ?? []).map((item) => item.totalTokens), 1);
  const maxEndpointTokens = Math.max(...(data?.endpoints ?? []).map((item) => item.totalTokens), 1);

  const selectedUser = data?.users.find((user) => String(user.id) === selectedUserId);
  const scopeLabel = selectedUser
    ? `${selectedUser.nickname || selectedUser.username} 的用量`
    : '全部用户用量';

  const summaryCards = [
    {
      title: '调用总量',
      value: formatNumber(data?.summary.requests ?? 0),
      note: `${formatNumber(data?.summary.activeUsers ?? 0)} 位活跃用户`,
      icon: Activity,
      color: 'text-primary',
      background: 'bg-primary/10',
    },
    {
      title: 'Token 总量',
      value: formatNumber(data?.summary.totalTokens ?? 0),
      note: `输入 ${formatNumber(data?.summary.promptTokens ?? 0)} · 输出 ${formatNumber(data?.summary.completionTokens ?? 0)}`,
      icon: Zap,
      color: 'text-amber-600',
      background: 'bg-amber-50',
    },
    {
      title: '平均响应',
      value: `${formatNumber(data?.summary.avgLatencyMs ?? 0)} ms`,
      note: '从请求发出到模型返回',
      icon: Clock3,
      color: 'text-blue-600',
      background: 'bg-blue-50',
    },
    {
      title: '成功率',
      value: `${Number(data?.summary.successRate ?? 0).toFixed(1)}%`,
      note: `${formatNumber(data?.summary.requests ?? 0)} 次请求`,
      icon: CheckCircle2,
      color: 'text-emerald-600',
      background: 'bg-emerald-50',
    },
  ];

  return (
    <div className="space-y-8">
      {error ? (
        <div className="flex items-center justify-between rounded-2xl border border-red-100 bg-red-50 p-4 text-red-700">
          <div className="flex items-center gap-3">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">{error}</span>
          </div>
          <button type="button" onClick={fetchUsage} className="text-sm font-medium">重试</button>
        </div>
      ) : null}

      <div>
        <p className="mb-3 text-sm font-medium text-text-muted">{scopeLabel}</p>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => (
            <div key={card.title} className="rounded-[24px] bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-text-muted">{card.title}</p>
                  <p className="mt-2 text-3xl font-bold text-text-main">{loading ? '—' : card.value}</p>
                </div>
                <div className={`rounded-2xl p-3 ${card.background} ${card.color}`}>
                  <card.icon className="h-6 w-6" />
                </div>
              </div>
              <p className="mt-4 truncate text-xs text-text-muted">{card.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <section className="rounded-[24px] bg-white p-6 shadow-sm xl:col-span-2">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h2 className="font-bold text-text-main">每日 Token 趋势</h2>
              <p className="mt-1 text-xs text-text-muted">
                输入与输出 Token 合计
                {(data?.trend.length ?? 0) > 30 ? ' · 展示最近 30 个有调用的日期' : ''}
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-text-muted">
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-primary" />输入</span>
              <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-secondary" />输出</span>
            </div>
          </div>

          {loading ? (
            <div className="flex h-64 items-center justify-center text-sm text-text-muted">正在加载趋势...</div>
          ) : displayedTrend.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <Activity className="mb-3 h-9 w-9 text-text-muted/40" />
              <p className="text-sm font-medium text-text-main">当前范围内暂无模型调用</p>
              <p className="mt-1 text-xs text-text-muted">产生真实模型请求后，用量会自动记录在这里</p>
            </div>
          ) : (
            <div className="flex h-64 items-end gap-2 overflow-x-auto border-b border-gray-100 px-1 pt-4">
              {displayedTrend.map((item) => {
                const inputHeight = Math.max((item.promptTokens / maxTrendTokens) * 190, item.promptTokens ? 3 : 0);
                const outputHeight = Math.max((item.completionTokens / maxTrendTokens) * 190, item.completionTokens ? 3 : 0);
                return (
                  <div
                    key={item.date}
                    className="group flex min-w-7 flex-1 flex-col items-center justify-end self-stretch"
                    title={`${item.date} · ${formatNumber(item.totalTokens)} Token · ${formatNumber(item.requests)} 次`}
                  >
                    <div className="flex flex-1 items-end gap-0.5">
                      <div className="w-2.5 rounded-t bg-primary" style={{ height: `${inputHeight}px` }} />
                      <div className="w-2.5 rounded-t bg-secondary" style={{ height: `${outputHeight}px` }} />
                    </div>
                    <span className="mt-2 h-7 whitespace-nowrap text-[10px] text-text-muted">
                      {new Date(`${item.date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <div className="space-y-6">
          <BreakdownCard
            title="模型分布"
            items={data?.models ?? []}
            labelKey="model"
            maxTokens={maxModelTokens}
            emptyText="暂无模型调用"
          />
          <BreakdownCard
            title="功能分布"
            items={data?.endpoints ?? []}
            labelKey="endpoint"
            maxTokens={maxEndpointTokens}
            emptyText="暂无功能调用"
          />
        </div>
      </div>

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-text-main">
              <Users className="h-5 w-5 text-primary" />
              单用户使用量
            </h2>
            <p className="mt-1 text-xs text-text-muted">按用户及时间筛选统计模型调用与 Token 消耗</p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索用户、昵称或 ID"
                className="w-full rounded-xl bg-background-alt py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>

            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-text-main shadow-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">全部用户</option>
              {(data?.users ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.nickname || user.username} (@{user.username})
                </option>
              ))}
            </select>

            <select
              value={range}
              onChange={(event) => setRange(event.target.value as RangeKey)}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-text-main shadow-sm outline-none focus:ring-2 focus:ring-primary/20"
            >
              {rangeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>

            <button
              type="button"
              onClick={fetchUsage}
              disabled={loading}
              className="flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-text-main shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-background-alt text-xs text-text-muted">
                <th className="pb-3 font-medium">用户</th>
                <th className="pb-3 text-right font-medium">调用次数</th>
                <th className="pb-3 text-right font-medium">输入 Token</th>
                <th className="pb-3 text-right font-medium">输出 Token</th>
                <th className="pb-3 text-right font-medium">Token 总量</th>
                <th className="pb-3 text-right font-medium">平均响应</th>
                <th className="pb-3 text-right font-medium">成功率</th>
                <th className="pb-3 text-right font-medium">最后调用</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user) => (
                <tr
                  key={user.id}
                  className={`border-b border-background-alt/60 text-sm last:border-0 ${
                    String(user.id) === selectedUserId ? 'bg-primary/5' : ''
                  }`}
                >
                  <td className="py-4">
                    <button
                      type="button"
                      onClick={() => setSelectedUserId(String(user.id) === selectedUserId ? '' : String(user.id))}
                      className="flex items-center gap-3 text-left"
                    >
                      <img
                        src={getAvatarUrl(user.avatarUrl, user.id)}
                        alt={user.nickname || user.username}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                      <span>
                        <span className="block font-medium text-text-main">{user.nickname || user.username}</span>
                        <span className="block text-xs text-text-muted">@{user.username} · ID {user.id}</span>
                      </span>
                    </button>
                  </td>
                  <td className="py-4 text-right text-text-main">{formatNumber(user.requests)}</td>
                  <td className="py-4 text-right text-text-muted">{formatNumber(user.promptTokens)}</td>
                  <td className="py-4 text-right text-text-muted">{formatNumber(user.completionTokens)}</td>
                  <td className="py-4 text-right font-semibold text-text-main">{formatNumber(user.totalTokens)}</td>
                  <td className="py-4 text-right text-text-muted">{formatNumber(user.avgLatencyMs)} ms</td>
                  <td className="py-4 text-right">
                    <span className={user.successRate >= 95 ? 'text-emerald-600' : user.requests ? 'text-amber-600' : 'text-text-muted'}>
                      {user.requests ? `${Number(user.successRate).toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="py-4 text-right text-xs text-text-muted">{formatDateTime(user.lastUsedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && filteredUsers.length === 0 ? (
            <div className="py-12 text-center text-sm text-text-muted">没有匹配的用户</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function BreakdownCard({
  title,
  items,
  labelKey,
  maxTokens,
  emptyText,
}: {
  title: string;
  items: UsageBreakdown[];
  labelKey: 'model' | 'endpoint';
  maxTokens: number;
  emptyText: string;
}) {
  return (
    <section className="rounded-[24px] bg-white p-5 shadow-sm">
      <h2 className="mb-4 font-bold text-text-main">{title}</h2>
      {items.length === 0 ? (
        <div className="py-5 text-center text-xs text-text-muted">{emptyText}</div>
      ) : (
        <div className="space-y-4">
          {items.slice(0, 5).map((item) => {
            const rawLabel = item[labelKey] || '未知';
            const label = labelKey === 'endpoint' ? endpointNames[rawLabel] || rawLabel : rawLabel;
            return (
              <div key={rawLabel}>
                <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                  <span className="truncate font-medium text-text-main" title={label}>{label}</span>
                  <span className="shrink-0 text-text-muted">{formatNumber(item.totalTokens)} Token</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-background-alt">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.max((item.totalTokens / maxTokens) * 100, 2)}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] text-text-muted">{formatNumber(item.requests)} 次调用</p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
