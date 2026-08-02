import { useCallback, useEffect, useMemo, useState } from 'react';
import { CookingPot, RefreshCw, Search, Trash2, UserRound, Wrench } from 'lucide-react';
import api from '../services/api';

interface KitchenwareItem {
  id: number;
  user_id: number;
  name: string;
  category: string;
  status: string;
  note: string | null;
  image_url: string | null;
  purchase_date: string | null;
  last_maintained_at: string | null;
  created_at: string;
  owner_username: string;
  owner_nickname: string | null;
}

const categories = ['全部', '小家电', '烹饪锅具', '刀具餐具', '烘焙工具', '其他'];
const statuses = ['全部', '常用', '良好', '需保养', '维修中', '闲置'];

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleDateString('zh-CN');
}

export default function Kitchenware() {
  const [items, setItems] = useState<KitchenwareItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const [status, setStatus] = useState('全部');
  const [message, setMessage] = useState('');

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<KitchenwareItem[]>('/admin/kitchenware', {
        params: { search: search.trim() || undefined, category, status },
      });
      setItems(response.data);
      setMessage('');
    } catch (error) {
      console.error('Kitchenware loading failed:', error);
      setMessage('厨具数据加载失败');
    } finally {
      setLoading(false);
    }
  }, [category, search, status]);

  useEffect(() => {
    const timer = window.setTimeout(fetchItems, 250);
    return () => window.clearTimeout(timer);
  }, [fetchItems]);

  const stats = useMemo(() => ({
    total: items.length,
    attention: items.filter((item) => item.status === '需保养' || item.status === '维修中').length,
    owners: new Set(items.map((item) => item.user_id)).size,
  }), [items]);

  const updateStatus = async (item: KitchenwareItem, nextStatus: string) => {
    try {
      await api.put(`/admin/kitchenware/${item.id}/status`, { status: nextStatus });
      setItems((current) => current.map((entry) => (
        entry.id === item.id ? { ...entry, status: nextStatus } : entry
      )));
    } catch (error: any) {
      setMessage(error.response?.data?.error || '状态更新失败');
    }
  };

  const removeItem = async (item: KitchenwareItem) => {
    if (!window.confirm(`确定要将厨具【${item.name}】移入回收站吗？`)) return;
    try {
      await api.delete(`/admin/kitchenware/${item.id}`);
      setItems((current) => current.filter((entry) => entry.id !== item.id));
    } catch (error: any) {
      setMessage(error.response?.data?.error || '删除失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-text-main">
            <CookingPot className="h-7 w-7 text-primary" />
            厨具资产管理
          </h1>
          <p className="mt-1 text-sm text-text-muted">查看用户录入的锅具、刀具和厨房家电，维护设备状态</p>
        </div>
        <button
          type="button"
          onClick={fetchItems}
          disabled={loading}
          className="flex items-center justify-center rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm font-medium shadow-sm disabled:opacity-50"
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-text-muted">当前厨具</p>
          <p className="mt-2 text-2xl font-bold text-text-main">{stats.total}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-text-muted">需要关注</p>
          <p className="mt-2 text-2xl font-bold text-amber-600">{stats.attention}</p>
        </div>
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <p className="text-xs text-text-muted">关联用户</p>
          <p className="mt-2 text-2xl font-bold text-primary">{stats.owners}</p>
        </div>
      </div>

      <section className="rounded-[24px] bg-white p-5 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row">
          <label className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索厨具、备注或用户名"
              className="w-full rounded-xl border border-gray-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-primary"
            />
          </label>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-primary"
          >
            {categories.map((item) => <option key={item}>{item}</option>)}
          </select>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-primary"
          >
            {statuses.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>

        {message ? (
          <div className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">{message}</div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left">
            <thead>
              <tr className="border-b border-background-alt text-xs text-text-muted">
                <th className="pb-3 font-medium">厨具</th>
                <th className="pb-3 font-medium">所属用户</th>
                <th className="pb-3 font-medium">分类</th>
                <th className="pb-3 font-medium">状态</th>
                <th className="pb-3 font-medium">购买日期</th>
                <th className="pb-3 font-medium">最近保养</th>
                <th className="pb-3 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-background-alt/70 text-sm last:border-0">
                  <td className="py-4">
                    <div className="flex items-center gap-3">
                      {item.image_url ? (
                        <img src={item.image_url} alt="" className="h-11 w-11 rounded-xl object-cover" />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
                          <CookingPot className="h-5 w-5 text-primary" />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-text-main">{item.name}</p>
                        <p className="mt-0.5 max-w-[250px] truncate text-xs text-text-muted">{item.note || '无备注'}</p>
                      </div>
                    </div>
                  </td>
                  <td className="py-4">
                    <div className="flex items-center gap-2 text-text-main">
                      <UserRound className="h-4 w-4 text-text-muted" />
                      {item.owner_nickname || item.owner_username}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">@{item.owner_username}</p>
                  </td>
                  <td className="py-4 text-text-muted">{item.category}</td>
                  <td className="py-4">
                    <select
                      value={item.status}
                      onChange={(event) => updateStatus(item, event.target.value)}
                      className="rounded-lg border border-gray-200 bg-background-alt px-2.5 py-1.5 text-xs outline-none"
                    >
                      {statuses.slice(1).map((entry) => <option key={entry}>{entry}</option>)}
                    </select>
                  </td>
                  <td className="py-4 text-text-muted">{item.purchase_date || '—'}</td>
                  <td className="py-4">
                    <span className="inline-flex items-center gap-1.5 text-text-muted">
                      <Wrench className="h-3.5 w-3.5" />
                      {formatDate(item.last_maintained_at)}
                    </span>
                  </td>
                  <td className="py-4 text-right">
                    <button
                      type="button"
                      onClick={() => removeItem(item)}
                      className="rounded-lg p-2 text-red-500 transition-colors hover:bg-red-50"
                      title="移入回收站"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && !items.length ? (
            <div className="py-14 text-center text-sm text-text-muted">没有匹配的厨具记录</div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
