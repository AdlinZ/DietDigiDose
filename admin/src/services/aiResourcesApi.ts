import api from './api';
import { assertSupportedConfiguration, writableConfiguration, type ResourceConfiguration, type ResourceUpdate } from './aiResources';
export const resourceEndpoint = '/admin/ai-config/resources';
export async function readResources(signal?: AbortSignal) {
  const data = (await api.get<ResourceConfiguration>(resourceEndpoint, { signal })).data;
  assertSupportedConfiguration(data); return data;
}
export async function saveResources(data: ResourceUpdate) {
  const result = (await api.put<ResourceConfiguration>(resourceEndpoint, writableConfiguration(data))).data;
  assertSupportedConfiguration(result); return result;
}
