import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCircle2, Loader2, RefreshCw, Send, Smartphone, Users } from 'lucide-react';
import api from '../services/api';

type Campaign = { id: number; title: string; body: string; status: string; recipientCount: number; successCount: number; failureCount: number; createdAt: string; sentAt: string | null; adminName: string };
type Automatic = { deliveryDate: string; status: string; count: number };
type Overview = { activeDevices: number; enabledUsers: number; campaigns: Campaign[]; automatic: Automatic[] };

export default function Notifications() {
  const [data, setData] = useState<Overview | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try { setError(''); setData((await api.get<Overview>('/admin/notifications')).data); }
    catch (e) { setError(e instanceof Error ? e.message : '加载通知数据失败'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const send = async () => {
    if (!title.trim() || !body.trim() || sending) return;
    if (!window.confirm('将向所有已启用推送的设备发送此通知，确认继续？')) return;
    setSending(true);
    try {
      await api.post('/admin/notifications/campaigns', { title: title.trim(), body: body.trim() });
      setTitle(''); setBody(''); await load();
    } catch (e) { setError(e instanceof Error ? e.message : '发送失败'); }
    finally { setSending(false); }
  };

  return <div className="space-y-6 p-7">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-text-main">通知中心</h1><p className="mt-1 text-sm text-text-muted">发送运营通知，并追踪自动临期提醒的投递情况。</p></div><button onClick={() => void load()} className="rounded-xl border border-gray-200 p-2 text-text-muted hover:bg-gray-50"><RefreshCw size={18}/></button></div>
    {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid gap-4 md:grid-cols-2"><Stat icon={Smartphone} label="活跃推送设备" value={data?.activeDevices ?? '—'} /><Stat icon={Users} label="已开启提醒用户" value={data?.enabledUsers ?? '—'} /></div>
    <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2"><Send size={18} className="text-primary"/><h2 className="font-bold text-text-main">发送通知</h2></div><div className="space-y-3"><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder="通知标题" className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-primary"/><textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={500} rows={3} placeholder="通知内容" className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-primary"/><div className="flex items-center justify-between"><span className="text-xs text-text-muted">仅发送给已授权且启用推送的设备</span><button disabled={!title.trim() || !body.trim() || sending} onClick={() => void send()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{sending ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}发送</button></div></div></section>
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-100 p-5"><h2 className="font-bold text-text-main">手动通知记录</h2></div><div className="divide-y divide-gray-100">{data?.campaigns.length ? data.campaigns.map((item) => <div key={item.id} className="p-5"><div className="flex items-start justify-between gap-4"><div><div className="font-semibold text-text-main">{item.title}</div><p className="mt-1 text-sm text-text-muted">{item.body}</p><p className="mt-2 text-xs text-text-muted">{item.adminName} · {new Date(item.createdAt).toLocaleString('zh-CN')}</p></div><div className="shrink-0 text-right text-xs text-text-muted"><div className="font-semibold text-primary">{item.status}</div><div className="mt-1">{item.successCount}/{item.recipientCount} 已接受</div>{item.failureCount > 0 && <div className="mt-1 text-red-600">{item.failureCount} 失败</div>}</div></div></div>) : <Empty label="还没有手动发送记录"/>}</div></section>
    <section className="rounded-2xl border border-gray-200 bg-white shadow-sm"><div className="border-b border-gray-100 p-5"><h2 className="font-bold text-text-main">自动临期提醒</h2></div><div className="divide-y divide-gray-100">{data?.automatic.length ? data.automatic.map((item, index) => <div key={`${item.deliveryDate}-${item.status}-${index}`} className="flex items-center justify-between p-4 text-sm"><span>{item.deliveryDate}</span><span className="text-text-muted">{item.status} · {item.count} 条</span></div>) : <Empty label="暂无自动提醒投递记录"/>}</div></section>
  </div>;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Bell; label: string; value: number | string }) { return <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon size={20}/></div><div><div className="text-sm text-text-muted">{label}</div><div className="mt-1 text-2xl font-bold text-text-main">{value}</div></div></div></div>; }
function Empty({ label }: { label: string }) { return <div className="p-8 text-center text-sm text-text-muted"><CheckCircle2 className="mx-auto mb-2 text-gray-300" size={22}/>{label}</div>; }
