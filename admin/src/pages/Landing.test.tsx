// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Landing from './Landing';
import api from '../services/api';
import markup from './landing/markup.html?raw';
import css from './Landing.css?raw';
vi.mock('../services/api', () => ({ default: { get: vi.fn() } }));
let host: HTMLDivElement, root: Root;
const get = vi.mocked(api.get);
const find = (selector: string) => host.querySelector<HTMLElement>(selector)!;
async function click(selector: string) { await act(async () => find(selector).click()); }
async function mount() { await act(async () => root.render(<StrictMode><Landing /></StrictMode>)); }
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks(); vi.useFakeTimers();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  get.mockResolvedValue({ data: { filing: { enabled: false } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  document.body.style.overflow = '';
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.clearAllTimers(); vi.useRealTimers(); });
it('integrates only the homepage and directs mobile onboarding to existing email', async () => {
  await mount();
  expect(host.querySelectorAll('#mqTrack .mq-set')).toHaveLength(2);
  expect(host.querySelector('a[href^="mailto:adlinzhang@gmail.com"]')).not.toBeNull();
  expect(host.querySelector('a[href*="/app/"]')).toBeNull();
  expect(host.textContent).not.toContain('打开网页版');
  expect(host.textContent).not.toContain('手机或电脑浏览器');
  expect(host.textContent).not.toContain('26w41a');
  for (const href of ['/journal', '/changelog', '/privacy', '/terms', '/login']) expect(host.querySelector(`a[href="${href}"]`)).not.toBeNull();
  expect(host.textContent).toContain('互动演示使用示例数据，不会保存到个人账户');
});
it('keeps internal anchors resolvable and all CSS scoped to the homepage', async () => {
  await mount();
  host.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach(a => expect(host.querySelector(a.getAttribute('href')!)).not.toBeNull());
  expect(markup).not.toContain('<script');
  expect(css).not.toMatch(/(^|\})\s*(?:html|body|:root)\s*\{/);
});
it('selects ingredients and resets without changing account data', async () => {
  await mount(); expect(find('#fridgeCount').textContent).toBe('已选 4 样');
  await click('[data-ing="egg"]'); expect(find('#fridgeCount').textContent).toBe('已选 3 样');
  await click('#resetBtn'); expect(find('#fridgeCount').textContent).toBe('已选 0 样');
  expect(find('#demoRight').textContent).toContain('冰箱空空');
  await click('#randomBtn'); expect(host.querySelectorAll('[data-ing][aria-pressed="true"]').length).toBeGreaterThanOrEqual(4);
});
it('supports detail tabs, preparation and repeated queue add/remove', async () => {
  await mount(); await click('[data-open="fqcd"]');
  await click('[data-prep="0"]'); expect(find('#prepText').textContent).toBe('已备好 1/3');
  await click('[data-tab="steps"]'); expect(find('#demoRight').textContent).toContain('做法步骤');
  await click('[data-tab="nutri"]'); expect(find('#demoRight').textContent).toContain('不是精确测量');
  await click('[data-queue="fqcd"]'); expect(find('#queueCount').textContent).toBe('1');
  await click('#queueChip'); await click('[data-unqueue="fqcd"]'); expect(find('#queueCount').textContent).toBe('0');
  await click('[data-back]'); expect(find('#rightTitle').textContent).toBe('今晚可以做');
});
it('clears a queue and dismisses the queue panel when clicking outside', async () => {
  await mount(); await click('[data-queue="fqcd"]'); await click('#queueChip'); await click('#queueClear');
  expect(find('#queueCount').textContent).toBe('0');
  await click('.hero'); expect(find('#queueChip').getAttribute('aria-expanded')).toBe('false');
});
it('opens and dismisses mobile menu by Escape and navigation, restoring scroll', async () => {
  await mount(); await click('#burger'); expect(document.body.style.overflow).toBe('hidden');
  expect(find('#menuOverlay').getAttribute('aria-hidden')).toBe('false');
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(find('#burger').getAttribute('aria-expanded')).toBe('false'); expect(document.activeElement).toBe(find('#burger'));
  await click('#burger'); await click('#menuOverlay a[href="#daily"]');
  expect(find('#menuOverlay').getAttribute('aria-hidden')).toBe('true'); expect(document.body.style.overflow).toBe('');
});
it('closes screenshot lightbox, traps focus and restores the trigger', async () => {
  await mount(); await click('#shotBtn'); expect(document.activeElement).toBe(find('#lightboxClose'));
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(find('#lightboxClose'));
  await click('#lightbox'); expect(find('#lightbox').getAttribute('aria-hidden')).toBe('true');
  expect(document.activeElement).toBe(find('#shotBtn')); expect(document.body.style.overflow).toBe('');
});
it('renders dynamic filing safely without hardcoded registration details', async () => {
  get.mockResolvedValue({ data: { filing: { enabled: true, text: '<b>备案</b>', url: 'javascript:alert(1)' } } });
  await mount(); expect(find('#siteFiling').textContent).toBe('<b>备案</b>'); expect(find('#siteFiling').children).toHaveLength(0);
  expect(markup).not.toContain('蜀ICP备');
});
it('cleans up menu scroll lock and resets demo state on remount', async () => {
  await mount(); await click('[data-queue="fqcd"]'); await click('#burger');
  await act(async () => root.render(null)); expect(document.body.style.overflow).toBe('');
  await mount(); expect(find('#queueCount').textContent).toBe('0'); expect(find('#burger').getAttribute('aria-expanded')).toBe('false');
  expect(host.querySelectorAll('#mqTrack .mq-set')).toHaveLength(2);
});
it('ignores filing response from an unmounted page', async () => {
  let resolve: (value: any) => void;
  get.mockImplementation(() => new Promise(r => { resolve = r; })); await mount();
  const old = find('#siteFiling'); await act(async () => root.render(null));
  await act(async () => resolve!({ data: { filing: { enabled: true, text: 'late', url: 'https://example.com' } } }));
  expect(old.textContent).toBe('');
});
it('keeps focus through recipe navigation, detail tabs and repeated queue actions', async () => {
  await mount();
  find('[data-open="fqcd"]').focus(); await click('[data-open="fqcd"]');
  expect(document.activeElement).toBe(find('[data-back]'));
  find('[data-tab="steps"]').focus(); await click('[data-tab="steps"]');
  expect(document.activeElement).toBe(find('[data-tab="steps"]'));
  for (let i = 0; i < 2; i++) {
    find('[data-queue="fqcd"]').focus(); await click('[data-queue="fqcd"]');
    expect(document.activeElement).toBe(find('[data-queue="fqcd"]'));
  }
  find('[data-back]').focus(); await click('[data-back]');
  expect(document.activeElement).toBe(find('[data-open="fqcd"]'));
  find('[data-queue="fqcd"]').focus(); await click('[data-queue="fqcd"]');
  expect(document.activeElement).toBe(find('[data-queue="fqcd"]'));
});
it('moves focus to the next queue removal control or the queue trigger', async () => {
  await mount(); await click('[data-queue="fqcd"]'); await click('[data-queue="hjdcf"]');
  await click('#queueChip');
  find('[data-unqueue="fqcd"]').focus(); await click('[data-unqueue="fqcd"]');
  expect(document.activeElement).toBe(find('[data-unqueue="hjdcf"]'));
  await click('[data-unqueue="hjdcf"]'); expect(document.activeElement).toBe(find('#queueChip'));
});
it('does not steal focus from ingredient or queue-clear controls when refreshing results', async () => {
  await mount(); find('[data-ing="egg"]').focus(); await click('[data-ing="egg"]');
  expect(document.activeElement).toBe(find('[data-ing="egg"]'));
  await click('[data-queue="fqcd"]'); await click('#queueChip');
  find('#queueClear').focus(); await click('#queueClear'); expect(document.activeElement).toBe(find('#queueClear'));
});
