import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker } from 'react-router';
import { PageHeader } from '../components/admin/PageHeader';
import { Section } from '../components/admin/Section';
import { createLatestRequest } from '../utils/latestRequest';
import { capabilities, readResources, saveResources, UnsupportedResourceConfiguration, validateConfiguration, writableConfiguration,
  type Capability, type Resource, type ResourceConfiguration, type ResourceUpdate, type Target } from '../services/aiResources';
import './AIResources.css';

const labels: Record<string, string> = { chat: '对话', vision: '图像分析', asr: '语音转写', supervisor: '主助手', nutrition: '营养规划', recipe: '食谱', operations: '操作执行' };
function TargetFields({ value, capability, resources, onChange }: { value: Target; capability: Capability; resources: Resource[]; onChange: (t: Target) => void }) {
  const available = resources.filter(r => r.kind === 'legacy' ? r.scope === capability : r.models.some(m => m.capabilities.includes(capability)));
  const selected = resources.find(r => r.id === value.resourceId);
  return <div className="ai-target"><label>提供商资源<select value={value.resourceId} onChange={e => {
    const r = resources.find(r => r.id === e.target.value);
    onChange({ resourceId: e.target.value, ...(r?.kind === 'connection' ? { model: r.models.find(m => m.capabilities.includes(capability))?.id } : {}) });
  }}><option value="">请选择资源</option>{available.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
    <label>模型{selected?.kind === 'connection' ? <select value={value.model || ''} onChange={e => onChange({ ...value, model: e.target.value })}><option value="">请选择模型</option>{selected.models.filter(m => m.capabilities.includes(capability)).map(m => <option key={m.id}>{m.id}</option>)}</select>
      : <input value={value.model || ''} maxLength={200} placeholder="留空沿用旧配置" onChange={e => onChange({ resourceId: value.resourceId, ...(e.target.value ? { model: e.target.value } : {}) })} />}</label></div>;
}
export default function AIResources({ page }: { page: 'providers' | 'services' }) {
  const [saved, setSaved] = useState<ResourceConfiguration | null>(null);
  const [draft, setDraft] = useState<ResourceUpdate | null>(null);
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [needsReload, setNeedsReload] = useState(false);
  const reads = useRef(createLatestRequest()), busy = useRef(false), lifecycle = useRef({ generation: 0 });
  const dirty = !!draft && !!saved && JSON.stringify(draft) !== JSON.stringify(writableConfiguration(saved));
  const blocker = useBlocker(dirty || saving);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (!busy.current && window.confirm('有未保存修改，确定放弃并离开？')) blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => { if (dirty || busy.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const fetchConfiguration = useCallback(async () => {
    if (busy.current) return;
    const request = reads.current.begin(); setLoading(true); setError(''); setNotice('');
    try {
      const data = await readResources(request.signal);
      if (request.isLatest()) { setSaved(data); setDraft(writableConfiguration(data)); setNeedsReload(false); }
    } catch (failure) {
      if (request.isLatest()) {
        setError(failure instanceof UnsupportedResourceConfiguration ? failure.message : '读取配置失败，请重试。');
        if (failure instanceof UnsupportedResourceConfiguration) { setSaved(null); setDraft(null); setNeedsReload(true); }
      }
    }
    finally { if (request.isLatest()) setLoading(false); }
  }, []);
  async function load() {
    if (dirty && !window.confirm('重新读取将放弃未保存修改，继续？')) return;
    await fetchConfiguration();
  }
  useEffect(() => {
    const requests = reads.current, owner = lifecycle.current;
    void fetchConfiguration();
    return () => { requests.cancel(); owner.generation++; };
  }, [fetchConfiguration]);
  async function save() {
    if (!draft || busy.current || needsReload) return;
    const validation = validateConfiguration(draft); if (validation) { setError(validation); return; }
    if (draft.resources.some(r => r.kind === 'connection' && r.credential?.action === 'clear') && !window.confirm('确定清空所选资源的密钥？保存后立即生效。')) return;
    busy.current = true; setSaving(true); setError(''); setNotice(''); reads.current.cancel();
    const owner = lifecycle.current.generation;
    try {
      const current = await readResources();
      if (owner !== lifecycle.current.generation) return;
      if (current.revision !== draft.revision) { setNeedsReload(true); setError('配置版本已变更。未覆盖他人修改；请重新读取后核对再编辑。'); return; }
      const result = await saveResources(draft);
      if (owner !== lifecycle.current.generation) return;
      setSaved(result); setDraft(writableConfiguration(result)); setNotice('已保存，后续配置读取立即生效。');
    } catch (failure) {
      if (owner === lifecycle.current.generation) { setNeedsReload(true); setError(failure instanceof UnsupportedResourceConfiguration ? failure.message : '保存未确认：可能存在版本冲突、能力/旧角色模型或策略不兼容，也可能已保存但响应丢失。请重新读取核对；不会自动重试。'); }
    } finally { if (owner === lifecycle.current.generation) { busy.current = false; setSaving(false); } }
  }
  function updateResource(index: number, resource: Resource) { if (draft) setDraft({ ...draft, resources: draft.resources.map((r, i) => i === index ? resource : r) }); }
  return <div className="ai-resources">
    <PageHeader title={page === 'providers' ? '服务提供商' : '业务服务'} description="统一资源与业务绑定 · v1 配置" actions={<button className="admin-button" disabled={saving || loading} onClick={() => void load()}>重新读取</button>} />
    <div className="ai-note">保存立即生效，当前没有草稿发布流程。模型能力为人工声明；连接成功也不代表视觉 / ASR 已验证。此页不发起供应商调用。</div>
    {loading && <p role="status">正在读取配置…</p>}{error && <p role="alert" className="admin-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {saved && draft && <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <p className="admin-muted">版本 {saved.revision} · {saved.migrated ? '资源配置已保存' : '沿用旧配置（首次保存创建资源文档）'} · {dirty ? '有未保存修改' : '与读取结果一致'}</p>
      <fieldset disabled={saving || loading || needsReload}>
        {page === 'providers' ? <>
          <Section title="连接与模型目录" action={<button type="button" className="admin-button" onClick={() => {
            let i = 1; while (draft.resources.some(r => r.id === `provider-${i}`)) i++;
            setDraft({ ...draft, resources: [...draft.resources, { id: `provider-${i}`, name: '', kind: 'connection', protocol: 'openai-compatible', baseUrl: '', models: [{ id: '', capabilities: ['chat'] }], credential: { action: 'keep' } }] });
          }}>新增连接</button>}>
            {draft.resources.map((r, index) => <article className="ai-resource-card" key={r.id}>
              <div className="ai-card-heading"><h3>{r.name || '新连接'} <small>{r.id}</small></h3><span className="ai-status">{r.kind === 'legacy' ? '旧配置引用' : '未验证'}</span></div>
              {r.kind === 'legacy' ? <p>保留 {labels[r.scope]} 的原地址、密钥及环境变量优先级。可在「旧配置与策略」维护。</p> : <>
                <div className="ai-target"><label>连接名称<input required maxLength={100} value={r.name} onChange={e => updateResource(index, { ...r, name: e.target.value })} /></label><label>连接协议<select value={r.protocol} onChange={() => {}}><option value="openai-compatible">OpenAI compatible</option></select></label></div>
                <label>API 地址<input required type="url" placeholder="https://provider.example/v1" value={r.baseUrl} onChange={e => updateResource(index, { ...r, baseUrl: e.target.value })} /></label>
                <div className="ai-target"><label>密钥操作<select value={r.credential?.action || 'keep'} onChange={e => updateResource(index, { ...r, credential: e.target.value === 'replace' ? { action: 'replace', value: '' } : { action: e.target.value as 'keep' | 'clear' } })}><option value="keep">保留已有密钥（新连接为空）</option><option value="replace">替换密钥</option><option value="clear">明确清空密钥</option></select></label>
                  <p className="admin-muted">{saved.resources.some(item => item.id === r.id && item.kind === 'connection' && item.hasApiKey) ? '服务端已配置密钥，不回显。' : '未配置密钥。'} 清空后不回退到全局密钥。</p></div>
                {r.credential?.action === 'replace' && <label>新密钥<input type="password" autoComplete="new-password" required maxLength={4096} value={r.credential.value} onChange={e => updateResource(index, { ...r, credential: { action: 'replace', value: e.target.value } })} /></label>}
                <h4>模型 / 声明能力</h4>{r.models.map((m, mi) => <div className="ai-model" key={mi}><label>模型标识<input required maxLength={200} value={m.id} onChange={e => updateResource(index, { ...r, models: r.models.map((old, j) => j === mi ? { ...m, id: e.target.value } : old) })} /></label>
                  <div className="ai-capabilities">{capabilities.map(c => <label key={c}><input type="checkbox" checked={m.capabilities.includes(c)} onChange={e => updateResource(index, { ...r, models: r.models.map((old, j) => j === mi ? { ...m, capabilities: e.target.checked ? [...m.capabilities, c] : m.capabilities.filter(v => v !== c) } : old) })} />{labels[c]}</label>)}</div>
                  <button type="button" className="admin-button" onClick={() => updateResource(index, { ...r, models: r.models.filter((_, j) => j !== mi) })}>移除模型</button></div>)}
                <div className="admin-actions"><button type="button" className="admin-button" onClick={() => updateResource(index, { ...r, models: [...r.models, { id: '', capabilities: ['chat'] }] })}>添加模型</button>
                <button type="button" className="admin-button" onClick={() => { if (window.confirm('移除连接？仍被引用的连接将无法保存。')) setDraft({ ...draft, resources: draft.resources.filter((_, i) => i !== index) }); }}>移除连接</button></div>
              </>}
            </article>)}
          </Section>
        </> : <>
          <Section title="按能力默认配置">{capabilities.map(c => <article className="ai-resource-card" key={c}><h3>{labels[c]}默认</h3><TargetFields value={draft.defaults[c]} capability={c} resources={draft.resources} onChange={target => setDraft({ ...draft, defaults: { ...draft.defaults, [c]: target } })} /></article>)}</Section>
          <Section title="已实现的业务服务">{saved.catalog.map(service => {
            const binding = draft.services[service.id], effective = saved.effective[service.id];
            return <article className="ai-resource-card" key={service.id}><div className="ai-card-heading"><h3>{labels[service.id]} <small>{service.id}</small></h3><span>{labels[service.capability]}</span></div>
              <p className="admin-muted">输入：{service.input} → 输出：{service.output}</p>
              <label>绑定方式<select value={'inherit' in binding ? 'inherit' : 'override'} onChange={e => setDraft({ ...draft, services: { ...draft.services, [service.id]: e.target.value === 'inherit' ? { inherit: true } : { resourceId: effective.resourceId, model: effective.model } } })}><option value="inherit">继承{service.capability === 'chat' && service.id !== 'chat' ? '对话服务（保留旧角色模型覆盖）' : '能力默认配置'}</option><option value="override">独立覆盖</option></select></label>
              {!('inherit' in binding) && <TargetFields value={binding} capability={service.capability} resources={draft.resources} onChange={target => setDraft({ ...draft, services: { ...draft.services, [service.id]: target } })} />}
              <div className="ai-effective"><strong>已读取的有效配置{dirty ? '（不含未保存修改）' : ''}</strong><p>{saved.resources.find(r => r.id === effective.resourceId)?.name || effective.resourceId} / {effective.model}</p><p>{effective.baseUrl}</p><p>来源：{effective.source} · 密钥{effective.hasApiKey ? '已配置' : '未配置'}</p></div>
            </article>;
          })}</Section>
          <p className="admin-muted">继承角色可能保留旧模型覆盖；新连接目录需包含该模型，否则请独立绑定。调用预算、提示词、工具权限、TTS 回退与本地语音优先策略沿用现有设置。搜索服务待独立后端适配。</p>
        </>}
      </fieldset>
      <div className="ai-savebar"><span>{saving ? '正在保存，请勿离开…' : '保存整份配置，后续读取立即生效'}</span><button type="button" className="admin-button" disabled={saving || loading || !dirty} onClick={() => { if (window.confirm('放弃未保存修改？')) { setDraft(writableConfiguration(saved)); setError(''); setNotice(''); } }}>取消修改</button><button className="admin-button" type="submit" disabled={saving || loading || needsReload || !dirty}>保存并立即生效</button></div>
    </form>}
  </div>;
}
