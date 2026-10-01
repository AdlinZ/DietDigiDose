import { useEffect, useState } from 'react';
import { recipeExecutionProfileSchema, type RecipeExecutionProfile } from '@dietdigidose/contracts';
import api from '../services/api';

type Task = Omit<RecipeExecutionProfile['tasks'][number], 'minutes'> & { minutes: string };
type Tool = { key: string; catalogId: string; capacityKind: 'not_applicable' | 'volume'; mlPerServing: string };
type Catalog = { id: number; name: string; quality_status?: string };
const phases = { preparation: '准备', cooking: '烹饪', cleanup: '收尾' };
const field = 'border rounded-lg px-2 py-1 w-full';

export function RecipeExecutionEditor({ recipeId }: { recipeId: number }) {
  const [recipeKey, setRecipeKey] = useState('');
  const [reviewKey, setReviewKey] = useState('');
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [reference, setReference] = useState('');
  const [servings, setServings] = useState('');
  const [tools, setTools] = useState<Tool[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true); setMessage('');
    void Promise.all([api.get(`/admin/recipes/${recipeId}/execution`), api.get('/admin/kitchenware/catalog')]).then(([record, devices]) => {
      if (!active) return;
      setRecipeKey(record.data.recipeKey);
      setReviewKey(record.data.reviewKey);
      setCatalog(devices.data.filter((item: Catalog) => item.quality_status == null || item.quality_status === 'trusted'));
      const profile = record.data.execution?.profile as RecipeExecutionProfile | undefined;
      setReference(profile?.reference ?? ''); setServings(profile ? String(profile.maxBatchServings) : '');
      setTools(profile?.tools.map(tool => ({ key: tool.key, catalogId: String(tool.catalogId), capacityKind: tool.capacity.kind,
        mlPerServing: tool.capacity.kind === 'volume' ? String(tool.capacity.mlPerServing) : '' })) ?? []);
      setTasks(profile?.tasks.map(task => ({ ...task, minutes: String(task.minutes) })) ?? [
        { id: 'prepare', title: '准备食材', phase: 'preparation', minutes: '', active: true, dependsOn: [], tools: [] },
        { id: 'cook', title: '烹饪', phase: 'cooking', minutes: '', active: true, dependsOn: ['prepare'], tools: [] },
        { id: 'clean', title: '收尾', phase: 'cleanup', minutes: '', active: true, dependsOn: ['cook'], tools: [] },
      ]);
      setMessage(profile ? '已加载当前食谱的审核流程。修改后需重新审核保存。' : '当前没有有效的制作流程审核，不能据此保证完整用时。');
    }).catch(() => { if (active) setMessage('读取制作流程失败，请关闭详情后重试。'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [recipeId]);
  const update = (id: string, patch: Partial<Task>) => setTasks(current => current.map(task => task.id === id ? { ...task, ...patch } : task));
  const toggle = (values: string[], value: string) => values.includes(value) ? values.filter(item => item !== value) : [...values, value];
  const save = async (remove = false) => {
    let profile: RecipeExecutionProfile | null = null;
    if (!remove) {
      if (!servings.trim() || tasks.some(task => !task.minutes.trim()) || tools.some(tool => !tool.catalogId || (tool.capacityKind === 'volume' && !tool.mlPerServing.trim()))) {
        setMessage('请填写批次份量、每项时间上限与设备容量依据；没有依据时请保留未审核状态。'); return;
      }
      const parsed = recipeExecutionProfileSchema.safeParse({ version: 1, reference, maxBatchServings: Number(servings),
        tools: tools.map(tool => ({ key: tool.key, name: catalog.find(item => String(item.id) === tool.catalogId)?.name ?? '', catalogId: Number(tool.catalogId),
          capacity: tool.capacityKind === 'volume' ? { kind: 'volume', mlPerServing: Number(tool.mlPerServing) } : { kind: 'not_applicable' } })),
        tasks: tasks.map(task => ({ ...task, minutes: Number(task.minutes) })),
      });
      if (!parsed.success) { setMessage(parsed.error.issues.map(issue => issue.message).join('；')); return; }
      profile = parsed.data;
    }
    setBusy(true);
    try {
      const response = await api.put(`/admin/recipes/${recipeId}/execution`, { recipeKey, reviewKey, profile });
      setReviewKey(response.data.reviewKey);
      setMessage(remove ? '制作流程审核已撤销，后续推荐将重新标为待核对。' : '制作流程审核已保存。食材、份数、步骤或厨具改变后会失效。');
    } catch (error: any) { setMessage(error.response?.data?.error || '审核保存失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <section className="space-y-3 border-t pt-4">
    <h3 className="font-semibold">制作流程审核</h3>
    <p className="text-sm text-text-muted">按可核对的来源或实测记录填写每批用时上限，包含准备、烹饪和收尾。小批次沿用此上限；专用设备保留到该批收尾完成。</p>
    <p role="status" className="text-sm">{loading ? '正在读取…' : message}</p>
    <fieldset disabled={busy || loading || !recipeKey} className="space-y-3">
      <label className="block">审核依据<textarea aria-label="制作流程审核依据" value={reference} onChange={event => setReference(event.target.value)} placeholder="来源、实测记录及核对条件" className={field} /></label>
      <label className="block">单批最多制作份量<input aria-label="单批最多制作份量" type="number" min="0.001" max="30" step="any" value={servings} onChange={event => setServings(event.target.value)} className={field} /></label>
      <h4 className="font-medium">设备与容量依据</h4>
      {tools.map(tool => <div key={tool.key} className="border rounded-xl p-3 space-y-2">
        <label>设备<select aria-label="制作设备" value={tool.catalogId} onChange={event => setTools(current => current.map(item => item.key === tool.key ? { ...item, catalogId: event.target.value } : item))} className={field}><option value="">选择已审核目录</option>{catalog.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label>容量要求<select aria-label="容量要求" value={tool.capacityKind} onChange={event => setTools(current => current.map(item => item.key === tool.key ? { ...item, capacityKind: event.target.value as Tool['capacityKind'] } : item))} className={field}><option value="volume">按每份容积核对</option><option value="not_applicable">该设备无需容积校验</option></select></label>
        {tool.capacityKind === 'volume' ? <label>每份需要的可用容积（毫升）<input aria-label="每份需要容积" type="number" min="0" step="any" value={tool.mlPerServing} onChange={event => setTools(current => current.map(item => item.key === tool.key ? { ...item, mlPerServing: event.target.value } : item))} className={field} /></label> : null}
        <button type="button" className="admin-button" onClick={() => { setTools(current => current.filter(item => item.key !== tool.key)); setTasks(current => current.map(task => ({ ...task, tools: task.tools.filter(key => key !== tool.key) }))); }}>移除此设备</button>
      </div>)}
      <button type="button" className="admin-button" onClick={() => setTools(current => [...current, { key: crypto.randomUUID(), catalogId: '', capacityKind: 'volume', mlPerServing: '' }])}>添加设备</button>
      <h4 className="font-medium">任务顺序与占用</h4>
      {tasks.map((task, index) => <div key={task.id} className="border rounded-xl p-3 space-y-2">
        <label>任务 {index + 1}<input aria-label={`任务 ${index + 1} 名称`} value={task.title} onChange={event => update(task.id, { title: event.target.value })} className={field} /></label>
        <label>阶段<select aria-label={`任务 ${index + 1} 阶段`} value={task.phase} onChange={event => update(task.id, { phase: event.target.value as Task['phase'], active: event.target.value !== 'cooking' || task.active })} className={field}>{Object.entries(phases).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
        <label>用时上限（整分钟）<input aria-label={`任务 ${index + 1} 用时上限`} type="number" min="0" max="1440" step="1" value={task.minutes} onChange={event => update(task.id, { minutes: event.target.value })} className={field} /></label>
        <label className="block"><input type="checkbox" checked={task.active} disabled={task.phase !== 'cooking'} onChange={event => update(task.id, { active: event.target.checked })} /> 持续需要人工操作（取消仅用于已核实可等待的烹饪任务）</label>
        <p>开始前必须完成：</p>{tasks.filter(other => other.id !== task.id).map(other => <label key={other.id} className="block text-sm"><input type="checkbox" checked={task.dependsOn.includes(other.id)} onChange={() => update(task.id, { dependsOn: toggle(task.dependsOn, other.id) })} /> {other.title}</label>)}
        <p>使用设备：</p>{tools.map(tool => <label key={tool.key} className="block text-sm"><input type="checkbox" checked={task.tools.includes(tool.key)} onChange={() => update(task.id, { tools: toggle(task.tools, tool.key) })} /> {catalog.find(item => String(item.id) === tool.catalogId)?.name ?? '尚未选择的设备'}</label>)}
        <button type="button" className="admin-button" onClick={() => setTasks(current => current.filter(item => item.id !== task.id).map(item => ({ ...item, dependsOn: item.dependsOn.filter(id => id !== task.id) })))}>移除此任务</button>
      </div>)}
      <button type="button" className="admin-button" onClick={() => setTasks(current => [...current, { id: crypto.randomUUID(), title: '', phase: 'preparation', minutes: '', active: true, dependsOn: [], tools: [] }])}>添加任务</button>
      <div className="flex gap-2"><button type="button" className="admin-button" onClick={() => void save()}>审核保存制作流程</button><button type="button" className="admin-button" onClick={() => void save(true)}>撤销制作流程审核</button></div>
    </fieldset>
  </section>;
}
