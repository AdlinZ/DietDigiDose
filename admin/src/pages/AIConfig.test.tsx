// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import AIConfig from './AIConfig';
import api from '../services/api';
import { legacyTextFields, legacyConfigPatch } from '../services/legacyAIConfig';
vi.mock('../services/api', () => ({ default: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
let host: HTMLDivElement, root: Root;
const get = vi.mocked(api.get), put = vi.mocked(api.put);
const policy = { main: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, planner: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, vision: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, asr: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, deadlineMs: 180000, maxModelCalls: 12, maxToolCalls: 6 };
const data = { draftRevision: 3, editable: { ...Object.fromEntries(legacyTextFields.map(k => [k, ''])), model: 'global-raw', chatModel: 'chat-raw' }, credentialState: { global: true, chat: true, vision: true, asr: true }, runtimePolicy: policy, model: 'effective-model-must-not-copy', effectiveModels: [] };
async function mount() { await act(async () => root.render(<AIConfig />)); }
async function changeBudget() { const input = [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith('工具调用上限'))!.querySelector('input')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '7'); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
function saveButton() { return [...host.querySelectorAll('button')].find(b => b.textContent?.includes('保存 AI 配置草稿'))!; }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.resetAllMocks(); vi.useFakeTimers(); get.mockResolvedValue({ data }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); });
it('uses raw fields, retains empty inheritance and sends only changed budget without clearing any key', async () => {
  put.mockResolvedValue({ data: {} }); await mount();
  expect([...host.querySelectorAll('input')].some(i => i.value === 'effective-model-must-not-copy')).toBe(false);
  expect([...host.querySelectorAll('input[type=password]')].every(i => (i as HTMLInputElement).value === '')).toBe(true);
  await changeBudget(); await act(async () => saveButton().click());
  expect(put.mock.calls[0][1]).toEqual({ draftRevision: 3, runtimePolicy: { ...policy, maxToolCalls: 7 } });
});
it('does not replay an uncertain legacy write, locks fields, and allows reread', async () => {
  put.mockRejectedValue({ response: { data: { error: 'SECRET-MUST-NOT-SHOW' } } }); await mount(); await changeBudget(); await act(async () => { saveButton().click(); saveButton().click(); });
  expect(put).toHaveBeenCalledTimes(1); expect(host.textContent).toContain('保存未确认'); expect(host.textContent).not.toContain('SECRET-MUST-NOT-SHOW'); expect(host.querySelector('fieldset')!.disabled).toBe(true);
  await act(async () => saveButton().click()); expect(put).toHaveBeenCalledTimes(1);
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '重新读取')!.click()); expect(host.querySelector('fieldset')!.disabled).toBe(false);
});
it('fails closed if the raw editable interface is absent', async () => {
  get.mockResolvedValue({ data: { model: 'effective-only' } }); await mount(); expect(host.textContent).toContain('已停止编辑'); expect(host.querySelector('input')).toBeNull();
});
it('allowlists patches and keeps blank credentials omitted', () => {
  expect(legacyConfigPatch({ model: '', badField: 'secret' }, { model: 'old' }, { apiKey: ' ', chatApiKey: 'demo-replacement', unrelated: 'secret' })).toEqual({ model: '', chatApiKey: 'demo-replacement' });
});

it('offers explicit confirmed key clearing without displaying environment secrets', async () => {
  get.mockResolvedValue({ data: { ...data, hasApiKey: true, credentialState: { ...data.credentialState, global: false } } });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  put.mockResolvedValue({ data: {} }); await mount();
  expect(host.querySelector<HTMLInputElement>('input[type=password]')!.placeholder).toContain('保持不变');
  const checkbox = [...host.querySelectorAll('label')].find(l => l.textContent === '清除对话密钥覆盖')!.querySelector('input')!;
  await act(async () => checkbox.click()); await act(async () => saveButton().click()); expect(put).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); await act(async () => saveButton().click());
  expect(put.mock.calls[0][1]).toEqual({ draftRevision: 3, chatApiKey: '' }); confirm.mockRestore();
});

it('uses effective bindings for thinking options without copying them into editable fields', async () => {
  const effectiveModels = ['对话', '主助手', '菜谱', '运营', '规划', '图片'].map(role => ({ role, baseUrl: 'https://api.siliconflow.cn/v1', model: 'Pro/deepseek-ai/DeepSeek-V4', source: '有效业务服务配置' }));
  get.mockResolvedValue({ data: { ...data, editable: Object.fromEntries(legacyTextFields.map(k => [k, ''])), effectiveModels } });
  put.mockResolvedValue({ data: {} }); await mount();
  for (const role of ['main', 'planner', 'vision']) expect([...host.querySelector<HTMLSelectElement>(`select[aria-label="${role} 思考模式"]`)!.options].map(o => o.value)).toEqual(['default', 'off', 'high', 'max']);
  expect([...host.querySelectorAll('input')].some(i => i.value === effectiveModels[0].model)).toBe(false);
  await changeBudget(); await act(async () => saveButton().click());
  expect(put.mock.calls[0][1]).toEqual({ draftRevision: 3, runtimePolicy: { ...policy, maxToolCalls: 7 } });
});
it('requires every effective main binding to support thinking options', async () => {
  get.mockResolvedValue({ data: { ...data, effectiveModels: ['对话', '主助手', '菜谱', '运营'].map(role => ({ role, baseUrl: role === '运营' ? 'https://example.test/v1' : 'https://api.siliconflow.cn/v1', model: 'Pro/deepseek-ai/DeepSeek-V4', source: '有效业务服务配置' })) } });
  await mount(); expect(host.querySelector<HTMLSelectElement>('select[aria-label="main 思考模式"]')!.options).toHaveLength(1);
});
it('replacement cancels clearing and cannot be silently discarded', async () => {
  put.mockResolvedValue({ data: {} }); await mount();
  const checkbox = [...host.querySelectorAll('label')].find(l => l.textContent === '清除全局密钥覆盖')!.querySelector('input')!;
  await act(async () => checkbox.click()); expect(checkbox.checked).toBe(true);
  const input = host.querySelector<HTMLInputElement>('input[type=password]')!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'demo-rotation'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  expect(checkbox.checked).toBe(false); expect(checkbox.disabled).toBe(true);
  await act(async () => saveButton().click()); expect(put.mock.calls[0][1]).toEqual({ draftRevision: 3, apiKey: 'demo-rotation' });
  expect(legacyConfigPatch({}, {}, { apiKey: 'demo-rotation' }, ['apiKey'])).toEqual({ apiKey: 'demo-rotation' });
});

it('labels saved draft validation without claiming a provider connection', async () => {
  vi.mocked(api.post).mockResolvedValue({ data: { lifecycle: { test: { revision: 3 } } } });
  await mount();
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent?.includes('校验已保存草稿'))!.click());
  expect(api.post).toHaveBeenCalledWith('/admin/ai-config/resources/test', { revision: 3 });
  expect(host.textContent).toContain('未调用供应商');
  expect(host.textContent).not.toContain('延迟 undefined');
});
