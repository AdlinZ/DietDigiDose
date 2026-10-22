// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import AIConfig from './AIConfig';
import api from '../services/api';
import { legacyTextFields, legacyConfigPatch } from '../services/legacyAIConfig';
vi.mock('../services/api', () => ({ default: { get: vi.fn(), put: vi.fn() } }));
let host: HTMLDivElement, root: Root;
const get = vi.mocked(api.get), put = vi.mocked(api.put);
const policy = { main: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, planner: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, vision: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, asr: { thinking: 'default', maxTokens: 3000, timeoutMs: 60000, retries: 0 }, deadlineMs: 180000, maxModelCalls: 12, maxToolCalls: 6 };
const data = { editable: { ...Object.fromEntries(legacyTextFields.map(k => [k, ''])), model: 'global-raw', chatModel: 'chat-raw' }, credentialState: { global: true, chat: true, vision: true, asr: true }, runtimePolicy: policy, model: 'effective-model-must-not-copy', effectiveModels: [] };
async function mount() { await act(async () => root.render(<AIConfig />)); }
async function changeBudget() { const input = [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith('工具调用上限'))!.querySelector('input')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '7'); input.dispatchEvent(new Event('input', { bubbles: true })); }); }
function saveButton() { return [...host.querySelectorAll('button')].find(b => b.textContent?.includes('保存全站'))!; }
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; vi.resetAllMocks(); vi.useFakeTimers(); get.mockResolvedValue({ data }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); });
it('uses raw fields, retains empty inheritance and sends only changed budget without clearing any key', async () => {
  put.mockResolvedValue({ data: {} }); await mount();
  expect([...host.querySelectorAll('input')].some(i => i.value === 'effective-model-must-not-copy')).toBe(false);
  expect([...host.querySelectorAll('input[type=password]')].every(i => (i as HTMLInputElement).value === '')).toBe(true);
  await changeBudget(); await act(async () => saveButton().click());
  expect(put.mock.calls[0][1]).toEqual({ runtimePolicy: { ...policy, maxToolCalls: 7 } });
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
