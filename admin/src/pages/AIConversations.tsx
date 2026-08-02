import { useCallback, useEffect, useState } from 'react';
import { Eye, MessageCircle, RefreshCw, Search, X } from 'lucide-react';
import api from '../services/api';

interface Conversation {
  userId: number;
  sessionId: string;
  username: string;
  nickname: string | null;
  turnCount: number;
  messageCount: number;
  updatedAt: string;
  lastUserMessage: string | null;
}

interface ConversationDetail {
  user: { id: number; username: string; nickname: string | null };
  sessionId: string;
  messages: Array<{ id: number; role: 'user' | 'assistant'; content: string; createdAt: string }>;
}

interface ScanJob {
  id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  errorMessage: string | null;
  updatedAt: string;
  userId: number;
  username: string;
  nickname: string | null;
  itemCount: number;
}

interface ScanJobDetail extends ScanJob {
  items: Array<{ foodName: string; quantity: string; suggestedStorageLocation: string; estimatedExpireDays: number }>;
}

function formatDateTime(value: string) {
  return new Date(`${value.replace(' ', 'T')}Z`).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function AIConversations() {
  const [query, setQuery] = useState('');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scanJobs, setScanJobs] = useState<ScanJob[]>([]);
  const [scanJobsLoading, setScanJobsLoading] = useState(true);
  const [selectedScanJob, setSelectedScanJob] = useState<ScanJobDetail | null>(null);
  const [scanDetailLoading, setScanDetailLoading] = useState(false);
  const totalTurns = conversations.reduce((sum, item) => sum + Number(item.turnCount || 0), 0);
  const activeUsers = new Set(conversations.map((item) => item.userId)).size;

  const loadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get<{ items: Conversation[] }>('/admin/chat-conversations', { params: { query: query || undefined } });
      setConversations(response.data.items);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const loadScanJobs = useCallback(async () => {
    setScanJobsLoading(true);
    try {
      const response = await api.get<{ items: ScanJob[] }>('/admin/inventory-scan-jobs');
      setScanJobs(response.data.items);
    } finally {
      setScanJobsLoading(false);
    }
  }, []);

  useEffect(() => { loadScanJobs(); }, [loadScanJobs]);

  const openDetail = async (conversation: Conversation) => {
    setDetailLoading(true);
    try {
      const response = await api.get<ConversationDetail>(`/admin/chat-conversations/${conversation.userId}/${encodeURIComponent(conversation.sessionId)}`);
      setSelected(response.data);
    } finally {
      setDetailLoading(false);
    }
  };

  const openScanDetail = async (jobId: string) => {
    setScanDetailLoading(true);
    try {
      const response = await api.get<ScanJobDetail>(`/admin/inventory-scan-jobs/${jobId}`);
      setSelectedScanJob(response.data);
    } finally {
      setScanDetailLoading(false);
    }
  };

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-primary/10 p-2.5 text-primary"><MessageCircle className="h-6 w-6" /></div>
          <div>
            <h1 className="text-2xl font-bold text-text-main">AI 对话记录</h1>
            <p className="mt-1 text-sm text-text-muted">查看用户与 AI 的完整会话，用于客服跟进与模型质量排查。</p>
          </div>
        </div>
        <div className="flex gap-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索用户、昵称或 ID" className="w-64 rounded-xl bg-white py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none focus:ring-2 focus:ring-primary/20" />
          </div>
          <button type="button" onClick={() => { loadConversations(); loadScanJobs(); }} className="inline-flex items-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white"><RefreshCw className={`mr-2 h-4 w-4 ${loading || scanJobsLoading ? 'animate-spin' : ''}`} />刷新</button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-text-muted">会话数</p><p className="mt-2 text-2xl font-bold text-text-main">{conversations.length}</p></div>
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-text-muted">对话轮次</p><p className="mt-2 text-2xl font-bold text-text-main">{totalTurns}</p></div>
        <div className="rounded-2xl bg-white p-5 shadow-sm"><p className="text-xs text-text-muted">参与用户</p><p className="mt-2 text-2xl font-bold text-text-main">{activeUsers}</p></div>
      </div>

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold text-text-main">会话列表</h2><p className="mt-1 text-xs text-text-muted">最近 100 段会话，每段会话可展开查看逐轮消息。</p></div><span className="rounded-full bg-background-alt px-3 py-1 text-xs text-text-muted">{conversations.length} 段</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left"><thead><tr className="border-b border-background-alt text-xs text-text-muted"><th className="w-[22%] pb-3 font-medium">用户</th><th className="w-[14%] pb-3 font-medium">对话轮次</th><th className="w-[34%] pb-3 font-medium">最后提问</th><th className="w-[16%] pb-3 text-right font-medium">最后更新</th><th className="w-[14%] pb-3 text-right font-medium">操作</th></tr></thead>
          <tbody>{conversations.map((item) => <tr key={`${item.userId}-${item.sessionId}`} className="border-b border-background-alt/60 text-sm last:border-0"><td className="py-4"><p className="font-medium text-text-main">{item.nickname || item.username}</p><p className="mt-0.5 text-xs text-text-muted">@{item.username} · ID {item.userId}</p></td><td className="py-4 text-text-main">{item.turnCount} 轮 <span className="text-xs text-text-muted">/ {item.messageCount} 条</span></td><td className="max-w-96 truncate py-4 text-text-muted" title={item.lastUserMessage || ''}>{item.lastUserMessage || '—'}</td><td className="py-4 text-right text-xs text-text-muted">{formatDateTime(item.updatedAt)}</td><td className="py-4 text-right"><button type="button" onClick={() => openDetail(item)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"><Eye className="h-3.5 w-3.5" />查看对话</button></td></tr>)}</tbody></table>
          {!loading && conversations.length === 0 ? <div className="py-14 text-center text-sm text-text-muted">暂未记录 AI 对话；新产生的对话会出现在这里。</div> : null}
          {loading ? <div className="py-14 text-center text-sm text-text-muted">正在加载会话记录...</div> : null}
        </div>
      </section>

      <section className="rounded-[24px] bg-white p-6 shadow-sm">
        <div className="mb-5 flex items-center justify-between"><div><h2 className="font-bold text-text-main">图片识别记录</h2><p className="mt-1 text-xs text-text-muted">食材、小票和订单图片识别任务，与聊天记录统一归档在此。</p></div><span className="rounded-full bg-background-alt px-3 py-1 text-xs text-text-muted">{scanJobs.length} 条</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[880px] text-left"><thead><tr className="border-b border-background-alt text-xs text-text-muted"><th className="w-[25%] pb-3 font-medium">用户</th><th className="w-[14%] pb-3 font-medium">状态</th><th className="w-[16%] pb-3 font-medium">结果</th><th className="w-[22%] pb-3 font-medium">异常摘要</th><th className="w-[14%] pb-3 text-right font-medium">最后更新</th><th className="w-[14%] pb-3 text-right font-medium">操作</th></tr></thead><tbody>{scanJobs.map((job) => <tr key={job.id} className="border-b border-background-alt/60 text-sm last:border-0"><td className="py-4"><p className="font-medium text-text-main">{job.nickname || job.username}</p><p className="mt-0.5 text-xs text-text-muted">@{job.username} · ID {job.userId}</p></td><td className="py-4"><ScanStatus status={job.status} /></td><td className="py-4 text-text-main">{job.status === 'completed' ? `${job.itemCount} 项食材` : '—'}</td><td className="max-w-52 truncate py-4 text-xs text-red-600" title={job.errorMessage || ''}>{job.errorMessage || '—'}</td><td className="py-4 text-right text-xs text-text-muted">{formatDateTime(job.updatedAt)}</td><td className="py-4 text-right"><button type="button" onClick={() => openScanDetail(job.id)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"><Eye className="h-3.5 w-3.5" />查看详情</button></td></tr>)}</tbody></table>{scanJobsLoading ? <div className="py-10 text-center text-sm text-text-muted">正在加载识别记录...</div> : null}{!scanJobsLoading && scanJobs.length === 0 ? <div className="py-10 text-center text-sm text-text-muted">暂无图片识别记录</div> : null}</div>
      </section>

      {selected || detailLoading ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-5" onClick={() => !detailLoading && setSelected(null)}><section className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between border-b border-background-alt px-6 py-5"><div><p className="text-xs text-text-muted">AI 对话详情</p><h2 className="mt-1 text-lg font-bold text-text-main">{selected ? `${selected.user.nickname || selected.user.username} 的会话` : '正在加载...'}</h2></div><button type="button" onClick={() => setSelected(null)} disabled={detailLoading} className="rounded-xl p-2 text-text-muted hover:bg-background-alt"><X className="h-5 w-5" /></button></div>{detailLoading || !selected ? <div className="flex h-52 items-center justify-center text-sm text-text-muted">正在加载对话...</div> : <div className="space-y-4 overflow-y-auto bg-background-alt p-6">{selected.messages.map((message) => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'bg-primary text-white' : 'bg-white text-text-main shadow-sm'}`}><p className="mb-1 text-[10px] opacity-65">{message.role === 'user' ? '用户' : 'AI'} · {formatDateTime(message.createdAt)}</p><p className="whitespace-pre-wrap">{message.content}</p></div></div>)}</div>}</section></div> : null}

      {selectedScanJob || scanDetailLoading ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 p-5" onClick={() => !scanDetailLoading && setSelectedScanJob(null)}><section className="max-h-[85vh] w-full max-w-2xl overflow-hidden rounded-[28px] bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-start justify-between border-b border-background-alt px-6 py-5"><div><p className="text-xs text-text-muted">图片识别详情</p><h2 className="mt-1 text-lg font-bold text-text-main">{selectedScanJob ? `${selectedScanJob.nickname || selectedScanJob.username} 的识别结果` : '正在加载...'}</h2></div><button type="button" onClick={() => setSelectedScanJob(null)} disabled={scanDetailLoading} className="rounded-xl p-2 text-text-muted hover:bg-background-alt"><X className="h-5 w-5" /></button></div>{scanDetailLoading || !selectedScanJob ? <div className="flex h-52 items-center justify-center text-sm text-text-muted">正在加载识别详情...</div> : <div className="max-h-[65vh] overflow-y-auto p-6"><div className="grid grid-cols-3 gap-3 rounded-2xl bg-background-alt p-4 text-sm"><div><p className="text-xs text-text-muted">状态</p><div className="mt-1"><ScanStatus status={selectedScanJob.status} /></div></div><div><p className="text-xs text-text-muted">识别条目</p><p className="mt-1 font-semibold text-text-main">{selectedScanJob.items.length} 项</p></div><div><p className="text-xs text-text-muted">最后更新</p><p className="mt-1 text-xs text-text-main">{formatDateTime(selectedScanJob.updatedAt)}</p></div></div>{selectedScanJob.errorMessage ? <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-700">{selectedScanJob.errorMessage}</div> : null}{selectedScanJob.items.length > 0 ? <div className="mt-5 overflow-hidden rounded-2xl border border-background-alt">{selectedScanJob.items.map((item, index) => <div key={`${item.foodName}-${index}`} className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-background-alt px-4 py-3 text-sm last:border-0"><span className="font-medium text-text-main">{item.foodName}</span><span className="text-text-muted">{item.quantity}</span><span className="text-text-muted">{item.suggestedStorageLocation} · {item.estimatedExpireDays} 天</span></div>)}</div> : !selectedScanJob.errorMessage ? <div className="py-10 text-center text-sm text-text-muted">未识别到可入库食材。</div> : null}</div>}</section></div> : null}
    </div>
  );
}

function ScanStatus({ status }: { status: ScanJob['status'] }) {
  const styles: Record<ScanJob['status'], string> = { queued: 'bg-amber-50 text-amber-700', processing: 'bg-blue-50 text-blue-700', completed: 'bg-emerald-50 text-emerald-700', failed: 'bg-red-50 text-red-700' };
  const labels: Record<ScanJob['status'], string> = { queued: '排队中', processing: '识别中', completed: '已完成', failed: '失败' };
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}>{labels[status]}</span>;
}
