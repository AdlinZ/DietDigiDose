import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
type Status = "received" | "processing" | "waiting_user" | "resolved" | "closed";
const labels: Record<Status, string> = { received: "已收到", processing: "处理中", waiting_user: "待用户补充", resolved: "已解决", closed: "已关闭" };
type Item = { id: number; userId: number; category: string; content: string; status: Status; version: number; createdAt: string; context: { page?: string; appVersion?: string; platform?: string } | null };
type Detail = Item & { messages: Array<{ id: number; authorRole: string; visibility: string; content: string; status: Status; createdAt: string }> };
export default function Feedback() {
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [filter, setFilter] = useState("");
  const [category, setCategory] = useState("");
  const [next, setNext] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("processing");
  const [internal, setInternal] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const selection = useRef(0);
  const busy = useRef(false);
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const load = useCallback(async (cursor?: number) => {
    const sequence = ++generation.current;
    setLoading(true); setError("");
    try {
      const { data } = await api.get("/feedback/admin", { params: { status: filter || undefined, category: category || undefined, before: cursor } });
      if (sequence !== generation.current) return;
      setItems(current => cursor ? [...current, ...data.items] : data.items); setNext(data.nextCursor);
    } catch (err: any) { if (sequence === generation.current) setError(err.response?.data?.error || "读取反馈失败"); }
    finally { if (sequence === generation.current) setLoading(false); }
  }, [filter, category]);
  useEffect(() => { void load(); const cancel = () => { generation.current++; }; return cancel; }, [load]);
  useEffect(() => { const cancel = () => { selection.current++; }; return cancel; }, []);
  const open = async (id: number) => {
    const sequence = ++selection.current;
    setDetail(null); setText(""); setInternal(false); setError("");
    try {
      const { data } = await api.get(`/feedback/admin/${id}`);
      if (sequence !== selection.current) return;
      setDetail(data); setStatus(data.status);
    } catch (err: any) { if (sequence === selection.current) setError(err.response?.data?.error || "读取详情失败"); }
  };
  const submit = async () => {
    if (!detail || !text.trim() || busy.current) return;
    const sequence = selection.current;
    busy.current = true; setSaving(true); setError("");
    const payload = { content: text.trim(), version: detail.version, visibility: internal ? "internal" : "public", status: internal ? detail.status : status };
    const fingerprint = JSON.stringify([detail.id, payload]);
    if (pending.current?.fingerprint !== fingerprint) pending.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const { data } = await api.post(`/feedback/admin/${detail.id}/replies`, { ...payload, requestKey: pending.current.key });
      if (sequence !== selection.current) return;
      setDetail(data); setText(""); setStatus(data.status); pending.current = null;
      await load();
    } catch (err: any) { if (sequence === selection.current) setError(err.response?.data?.error || "提交失败，请重试；如提示版本冲突，请刷新详情"); }
    finally { busy.current = false; setSaving(false); }
  };
  return <div className="space-y-5">
    <div><h1 className="text-2xl font-bold text-slate-900">用户反馈</h1><p className="mt-1 text-sm text-slate-500">公开回复会通知用户；内部备注仅管理员可见，不能单独改变公开状态。</p></div>
    {error && <div role="alert" className="rounded-xl bg-red-50 text-red-700 p-3">{error}</div>}
    <div className="flex gap-3 flex-wrap">
      <select aria-label="反馈状态筛选" value={filter} onChange={e => setFilter(e.target.value)} className="rounded-lg border p-2"><option value="">全部状态</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      <select aria-label="反馈类型筛选" value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border p-2"><option value="">全部类型</option><option value="issue">问题</option><option value="suggestion">建议</option><option value="support">客服</option></select>
      <button disabled={loading} onClick={() => void load()} className="rounded-lg border px-4">刷新列表</button>
    </div>
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="space-y-3" aria-label="反馈列表">
        {loading && <p>正在加载…</p>}{!loading && !items.length && <p className="text-slate-500">没有符合条件的反馈。</p>}
        {items.map(item => <button key={item.id} onClick={() => void open(item.id)} className={`w-full text-left rounded-xl border bg-white p-4 ${detail?.id === item.id ? "border-indigo-500" : "border-slate-200"}`}><p className="font-semibold">#{item.id} · {labels[item.status]} · 用户 {item.userId}</p><p className="mt-2 line-clamp-3 text-sm text-slate-600">{item.content}</p><time className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</time></button>)}
        {next && <button disabled={loading} onClick={() => void load(next)} className="rounded-lg border p-2">加载更多</button>}
      </section>
      {detail ? <section aria-label="反馈详情" className="rounded-xl border bg-white p-5 space-y-4">
        <div className="flex justify-between"><h2 className="font-bold">反馈 #{detail.id} · {labels[detail.status]}</h2><button disabled={saving} onClick={() => void open(detail.id)} className="text-indigo-600">刷新详情</button></div>
        <p className="whitespace-pre-wrap break-words">{detail.content}</p>
        <p className="text-xs text-slate-500">页面：{detail.context?.page || "未附带"} · 版本：{detail.context?.appVersion || "未知"} · 平台：{detail.context?.platform || "未知"}</p>
        {detail.messages.map(message => <div key={message.id} className={`rounded-lg p-3 ${message.visibility === "internal" ? "bg-amber-50" : "bg-slate-50"}`}><p className="text-xs font-semibold">{message.authorRole === "admin" ? "管理员" : "用户补充"} · {message.visibility === "internal" ? "内部备注" : "公开"} · {labels[message.status]}</p><p className="mt-1 whitespace-pre-wrap break-words">{message.content}</p><time className="text-xs text-slate-500">{new Date(message.createdAt).toLocaleString()}</time></div>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />仅内部备注（不通知用户）</label>
        {!internal && <label className="block text-sm">处理状态<select aria-label="处理状态" className="ml-3 border rounded p-2" value={status} onChange={e => setStatus(e.target.value as Status)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
        <textarea aria-label={internal ? "内部备注" : "公开回复"} className="w-full min-h-32 border rounded-xl p-3" maxLength={2000} value={text} onChange={e => setText(e.target.value)} placeholder={internal ? "仅管理员可见，勿记录密码或凭据" : "向用户说明处理结果或需要补充的信息"} />
        <button disabled={saving || !text.trim()} onClick={() => void submit()} className="rounded-lg bg-indigo-600 text-white px-4 py-2 disabled:opacity-50">{saving ? "提交中…" : internal ? "保存内部备注" : "发送回复并更新状态"}</button>
      </section> : <p className="text-slate-500">选择一条反馈查看详情。</p>}
    </div>
  </div>;
}
