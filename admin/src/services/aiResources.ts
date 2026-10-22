import api from './api';
export const capabilities = ['chat', 'vision', 'asr'] as const;
export type Capability = typeof capabilities[number];
export const serviceIds = ['chat', 'vision', 'asr', 'supervisor', 'nutrition', 'recipe', 'operations'] as const;
export type ServiceId = typeof serviceIds[number];
export type Target = { resourceId: string; model?: string };
export type Binding = Target | { inherit: true };
export type Credential = { action: 'keep' | 'clear' } | { action: 'replace'; value: string };
export type Resource = { id: string; name: string } & ({ kind: 'legacy'; scope: Capability } | {
  kind: 'connection'; protocol: 'openai-compatible'; baseUrl: string;
  models: { id: string; capabilities: Capability[] }[]; credential?: Credential;
  hasApiKey?: boolean; verification?: string;
});
export interface ResourceUpdate {
  schemaVersion: 1; revision: number; resources: Resource[];
  defaults: Record<Capability, Target>; services: Record<ServiceId, Binding>;
}
export interface ResourceConfiguration extends ResourceUpdate {
  migrated: boolean;
  catalog: { id: ServiceId; capability: Capability; input: string; output: string }[];
  effective: Record<ServiceId, { resourceId: string; model: string; baseUrl: string; source: string; hasApiKey: boolean }>;
}
export class UnsupportedResourceConfiguration extends Error {
  constructor() { super('检测到搜索/工具或新版配置字段。当前页面仅支持 v1 模型配置，已停止编辑以免丢失字段；请先整合对应管理界面。'); }
}
// The search branch keeps schemaVersion=1 but adds tool fields. Fail closed before
// projecting a whole document, even when those services are currently disabled.
export function assertSupportedConfiguration(data: ResourceUpdate) {
  const known = (object: object, keys: readonly string[]) => Object.keys(object).every(key => keys.includes(key));
  const extra = data as ResourceConfiguration;
  if (data.schemaVersion !== 1
    || !known(data, ['schemaVersion', 'revision', 'resources', 'defaults', 'services', 'migrated', 'catalog', 'effective'])
    || !known(data.defaults, capabilities) || !known(data.services, serviceIds)
    || extra.catalog?.some(service => !serviceIds.includes(service.id) || !capabilities.includes(service.capability))
    || (extra.effective && !known(extra.effective, serviceIds))
    || data.resources.some(r => r.kind === 'legacy'
      ? !capabilities.includes(r.scope) || !known(r, ['id', 'name', 'kind', 'scope'])
      : r.kind !== 'connection' || r.protocol !== 'openai-compatible'
        || !known(r, ['id', 'name', 'kind', 'protocol', 'baseUrl', 'models', 'credential', 'hasApiKey', 'maskedKey', 'verification', 'apiKey'])
        || r.models.some(m => !known(m, ['id', 'capabilities']) || m.capabilities.some(c => !capabilities.includes(c))))
    || Object.values(data.defaults).some(t => !known(t, ['resourceId', 'model']))
    || Object.values(data.services).some(t => !known(t, ['resourceId', 'model', 'inherit']))) throw new UnsupportedResourceConfiguration();
}
// Explicit allowlist: GET metadata, masks and effective values must never become PUT fields.
export function writableConfiguration(data: ResourceUpdate): ResourceUpdate {
  assertSupportedConfiguration(data);
  const target = (value: Target): Target => ({ resourceId: value.resourceId, ...(value.model?.trim() ? { model: value.model.trim() } : {}) });
  return { schemaVersion: 1, revision: data.revision,
    resources: data.resources.map(r => r.kind === 'legacy'
      ? { id: r.id, name: r.name, kind: r.kind, scope: r.scope }
      : { id: r.id, name: r.name.trim(), kind: r.kind, protocol: r.protocol, baseUrl: r.baseUrl.trim(),
        models: r.models.map(m => ({ id: m.id.trim(), capabilities: [...m.capabilities] })),
        credential: r.credential?.action === 'replace'
          ? { action: 'replace', value: r.credential.value.trim() } : { action: r.credential?.action || 'keep' } }),
    defaults: Object.fromEntries(capabilities.map(c => [c, target(data.defaults[c])])) as ResourceUpdate['defaults'],
    services: Object.fromEntries(serviceIds.map(s => [s, 'inherit' in data.services[s] ? { inherit: true } : target(data.services[s] as Target)])) as ResourceUpdate['services'],
  };
}
export function validateConfiguration(data: ResourceUpdate): string | null {
  if (data.resources.length > 100) return '最多支持 100 个资源。';
  if (new Set(data.resources.map(r => r.id)).size !== data.resources.length) return '资源标识不可重复。';
  for (const r of data.resources) {
    if (!/^[a-z][a-z0-9_-]{0,63}$/.test(r.id) || !r.name.trim() || r.name.trim().length > 100) return '请填写有效标识和名称（名称最多 100 字）。';
    if (r.kind === 'legacy') continue;
    try { const u = new URL(r.baseUrl); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error(); }
    catch { return '端点必须是无凭据、查询参数或片段的 HTTP(S) 地址。'; }
    if (!r.models.length || r.models.length > 100 || r.models.some(m => !m.id.trim() || m.id.trim().length > 200 || !m.capabilities.length)) return '请填写模型标识并选择至少一种能力（最多 100 个模型）。';
    if (new Set(r.models.map(m => m.id.trim())).size !== r.models.length) return '模型标识不可重复。';
    if (r.credential?.action === 'replace' && (!r.credential.value.trim() || r.credential.value.trim().length > 4096)) return '替换密钥必须非空且不超过 4096 字符。';
  }
  function compatible(t: Target, c: Capability) {
    const r = data.resources.find(r => r.id === t.resourceId);
    return r?.kind === 'legacy' ? r.scope === c && (!t.model || t.model.trim().length <= 200)
      : r?.models.some(m => m.id.trim() === t.model && m.capabilities.includes(c));
  }
  for (const c of capabilities) if (!compatible(data.defaults[c], c)) return '默认配置的资源或模型能力不兼容。';
  for (const s of serviceIds) {
    const b = data.services[s];
    if (!('inherit' in b) && !compatible(b, capabilities.includes(s as Capability) ? s as Capability : 'chat')) return '业务服务的资源或模型能力不兼容。';
  }
  return null;
}
export const resourceEndpoint = '/admin/ai-config/resources';
export async function readResources(signal?: AbortSignal) {
  const data = (await api.get<ResourceConfiguration>(resourceEndpoint, { signal })).data;
  assertSupportedConfiguration(data);
  return data;
}
export async function saveResources(data: ResourceUpdate) {
  const result = (await api.put<ResourceConfiguration>(resourceEndpoint, writableConfiguration(data))).data;
  assertSupportedConfiguration(result);
  return result;
}
