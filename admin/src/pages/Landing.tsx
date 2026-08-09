import { useState } from 'react';
import { Link } from 'react-router';
import logoUrl from '../../../client/assets/logo.png';
import {
  ArrowRight,
  Bot,
  Boxes,
  Camera,
  Check,
  ChevronRight,
  CirclePlay,
  CookingPot,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Utensils,
} from 'lucide-react';

const Github = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

const features = [
  { icon: ScanLine, title: '看见一餐的营养', description: '拍下餐盘，识别食物并整理热量与三大营养素。' },
  { icon: Bot, title: '让 AI 知道你的厨房', description: '结合库存、目标与可用厨具，给出真正做得出来的建议。' },
  { icon: Boxes, title: '让食材不再被遗忘', description: '把食材、保质期与日常饮食放进一个清晰的工作流。' },
];

const steps = [
  ['01', '记录你的食材与习惯', '快速录入库存、健康目标与常用厨具。'],
  ['02', '获取可执行的建议', 'AI 优先匹配现有食材和设备，不止给一张漂亮食谱。'],
  ['03', '把每一天变成反馈', '从一餐到一周，看见自己的营养节奏与变化。'],
];

const appEntryUrl = import.meta.env.VITE_APP_ENTRY_URL ?? 'http://localhost:8080';

const moments = [
  {
    label: '晚餐没想法',
    title: '把现有食材，变成今晚能做的一餐。',
    description: '告诉食光你有什么、想吃得怎样，它会先考虑库存和可用厨具，再给出可执行的建议。',
    icon: Bot,
    detail: ['基于库存优先匹配', '结合饮食目标调整', '标注所需时间与营养'],
    accent: 'bg-[#E8F4EA] text-[#2B7A58]',
  },
  {
    label: '记录太麻烦',
    title: '一顿饭，留下真正有用的记录。',
    description: '拍照、手动添加或从食材库选择。记录被整理成能回看的营养节奏，而不是待填的表格。',
    icon: Camera,
    detail: ['拍照辅助识别食物', '同步热量与营养信息', '保留每天真实饮食轨迹'],
    accent: 'bg-[#FFF2DE] text-[#B98031]',
  },
  {
    label: '食材总被忘记',
    title: '让冰箱里的每一样东西被看见。',
    description: '把库存、保质期和常用厨具放在一起。下一次打开 App，不必从“今天吃什么”重新开始。',
    icon: Boxes,
    detail: ['清晰管理现有食材', '减少重复购买与浪费', '建议优先消耗的组合'],
    accent: 'bg-[#E9F0FB] text-[#5277B8]',
  },
];

export default function Landing() {
  const [activeMoment, setActiveMoment] = useState(0);
  const selectedMoment = moments[activeMoment];
  const SelectedMomentIcon = selectedMoment.icon;

  return (
    <main className="min-h-screen overflow-hidden bg-[#FCFBF7] text-[#21332A] selection:bg-[#2D6A4F] selection:text-white">
      <header className="sticky top-0 z-40 border-b border-[#DDE8DF]/80 bg-[#FCFBF7]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-5 lg:px-8">
          <Link to="/" className="flex items-center gap-3">
            <img src={logoUrl} alt="食光烙记" className="h-10 w-10 object-contain" />
            <div>
              <p className="text-base font-extrabold tracking-tight text-[#215E43]">食光烙记</p>
              <p className="text-[10px] font-semibold tracking-[0.12em] text-[#7D8D82]">DIETDIGIDOSE</p>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm font-medium text-[#617267] md:flex">
            <a href="#product" className="transition-colors hover:text-[#215E43]">产品能力</a>
            <a href="#moments" className="transition-colors hover:text-[#215E43]">使用场景</a>
            <a href="#how-it-works" className="transition-colors hover:text-[#215E43]">使用方式</a>
            <a href="#beta" className="transition-colors hover:text-[#215E43]">内测计划</a>
            <a href="https://github.com/AdlinZ/DietDigiDose" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 transition-colors hover:text-[#215E43]"><Github size={15} /> GitHub</a>
          </nav>

          <div className="flex items-center gap-2">
            <a href={appEntryUrl} className="hidden rounded-xl px-4 py-2 text-sm font-semibold text-[#446154] transition-colors hover:bg-[#EEF4EE] sm:block">打开 App</a>
            <a href={appEntryUrl} className="inline-flex items-center gap-2 rounded-xl bg-[#215E43] px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_20px_rgba(33,94,67,0.18)] transition hover:-translate-y-0.5 hover:bg-[#184D36]">开始使用 <ArrowRight size={15} /></a>
          </div>
        </div>
      </header>

      <section className="relative">
        <div className="pointer-events-none absolute left-1/2 top-0 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(190,220,196,0.54),rgba(252,251,247,0)_68%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-20 lg:grid-cols-[1.02fr_.98fr] lg:px-8 lg:pb-28 lg:pt-28">
          <div className="max-w-2xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#BED8C4] bg-[#F1F8F1] px-3 py-1.5 text-xs font-bold text-[#215E43]">
              <Sparkles size={13} /> 现已开放小范围内测
            </div>
            <h1 className="mt-7 text-[42px] font-extrabold leading-[1.11] tracking-[-0.055em] text-[#1F3127] sm:text-6xl lg:text-[66px]">
              好好吃饭，<br />
              <span className="text-[#2B7A58]">不必靠意志力。</span>
            </h1>
            <p className="mt-7 max-w-xl text-base leading-8 text-[#65766A] sm:text-lg">
              食光烙记将食材库存、厨具、饮食记录和 AI 建议连接成一个轻量的日常系统，帮你在每一餐做出更适合自己的选择。
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <a href={appEntryUrl} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-[#215E43] px-6 py-3.5 text-sm font-bold text-white shadow-[0_12px_28px_rgba(33,94,67,0.22)] transition hover:-translate-y-0.5 hover:bg-[#184D36]">打开食光 App <ArrowRight size={17} /></a>
              <a href="#product" className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#D7E4D9] bg-white px-6 py-3.5 text-sm font-bold text-[#365344] transition hover:border-[#97BCA1] hover:bg-[#F8FBF8]"><CirclePlay size={17} className="text-[#2B7A58]" /> 先看看如何工作</a>
            </div>
            <p className="mt-4 text-xs font-medium text-[#7A897E]">还没有内测资格？<a href="#beta" className="ml-1 text-[#215E43] underline decoration-[#9FC5A7] underline-offset-4 transition-colors hover:text-[#184D36]">申请加入内测</a></p>
            <div className="mt-9 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#738177]">
              {['饮食记录', '食材管理', 'AI 烹饪助手'].map((item) => <span key={item} className="flex items-center gap-1.5"><Check size={14} className="text-[#2B7A58]" />{item}</span>)}
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[590px]">
            <div className="absolute -inset-6 rounded-[42px] bg-[#D8EBDD]/55 blur-2xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-[#D6E4D8] bg-[#FEFEFC] p-3 shadow-[0_30px_80px_rgba(43,79,57,0.16)] sm:p-4">
              <div className="flex items-center gap-1.5 border-b border-[#E7EEE8] px-2 pb-3">
                <span className="h-2 w-2 rounded-full bg-[#ED9E90]" /><span className="h-2 w-2 rounded-full bg-[#EBCB83]" /><span className="h-2 w-2 rounded-full bg-[#8CC6A0]" />
                <div className="ml-3 rounded-md bg-[#F1F5F1] px-2.5 py-1 text-[9px] font-semibold text-[#809086]">今天的食光</div>
              </div>
              <div className="grid gap-3 p-2 pt-4 sm:grid-cols-[.82fr_1.18fr]">
                <div className="rounded-2xl bg-[#F0F7F1] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6B9177]">今日目标</p>
                  <p className="mt-3 text-2xl font-extrabold tracking-tight text-[#214635]">1,280 <span className="text-xs font-semibold text-[#688174]">/ 1,800 kcal</span></p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[#D9E9DB]"><div className="h-full w-[71%] rounded-full bg-[#2B7A58]" /></div>
                  <div className="mt-5 space-y-2.5">
                    {[['蛋白质', '68g', 'bg-[#6CA6DC]'], ['碳水', '134g', 'bg-[#E6B76A]'], ['脂肪', '42g', 'bg-[#D98978]']].map(([label, value, color]) => <div className="flex items-center justify-between text-[10px]" key={label}><span className="flex items-center gap-1.5 text-[#6E7E73]"><i className={`h-1.5 w-1.5 rounded-full ${color}`} />{label}</span><b className="text-[#395342]">{value}</b></div>)}
                  </div>
                </div>
                <div className="rounded-2xl border border-[#E6EDE7] bg-white p-4">
                  <div className="flex items-center justify-between"><div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#E9F4EC]"><Bot size={14} className="text-[#2B7A58]" /></div><div><p className="text-[11px] font-extrabold text-[#294535]">今日晚餐建议</p><p className="text-[9px] text-[#809086]">基于你的库存与装备</p></div></div><span className="rounded-full bg-[#FFF3D9] px-2 py-1 text-[9px] font-bold text-[#B68230]">18 min</span></div>
                  <div className="mt-4 rounded-xl bg-[#FAF7EF] p-3"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#DFEFE3]"><Utensils size={17} className="text-[#2B7A58]" /></div><div><p className="text-xs font-extrabold text-[#334C3B]">菌菇鸡胸暖沙拉</p><p className="mt-1 text-[9px] text-[#77877C]">462 kcal · 蛋白质 38g</p></div></div></div>
                  <div className="mt-3 flex flex-wrap gap-1.5">{['鸡胸肉', '口蘑', '平底锅'].map((item) => <span key={item} className="flex items-center gap-1 rounded-md bg-[#F2F7F3] px-2 py-1 text-[9px] font-semibold text-[#4B7657]"><Check size={11} aria-hidden="true" />{item}</span>)}</div>
                  <button className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#215E43] py-2.5 text-[10px] font-bold text-white">查看做法 <ChevronRight size={13} /></button>
                </div>
              </div>
              <div className="mx-2 mt-1 flex items-center justify-between rounded-xl border border-[#E8EFE9] px-3 py-2.5 text-[10px] text-[#67786C]"><span className="flex items-center gap-1.5"><Camera size={12} className="text-[#2B7A58]" />拍照记录这顿饭</span><span className="font-bold text-[#2B7A58]">开始识别</span></div>
            </div>
            <div className="absolute -bottom-5 -left-5 hidden rounded-2xl border border-[#E1ECE3] bg-white p-3.5 shadow-lg sm:block"><div className="flex items-center gap-2.5"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#FFF3DD]"><CookingPot size={16} className="text-[#B98031]" /></div><div><p className="text-[10px] font-bold text-[#334C3B]">装备匹配完成</p><p className="mt-0.5 text-[9px] text-[#7D8C82]">已有 3 件可用厨具</p></div></div></div>
          </div>
        </div>
      </section>

      <section id="product" className="border-y border-[#E5ECE5] bg-white py-20 sm:py-28">
        <div className="mx-auto max-w-7xl px-5 lg:px-8">
          <div className="max-w-2xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#2B7A58]">A calmer health workflow</p><h2 className="mt-4 text-3xl font-extrabold tracking-[-0.035em] text-[#21332A] sm:text-4xl">不是另一个打卡工具，<br />而是你的饮食操作系统。</h2></div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, title, description }, index) => <article key={title} className={`group rounded-[24px] border p-6 transition duration-300 hover:-translate-y-1 hover:shadow-xl ${index === 1 ? 'border-[#2B7A58] bg-[#215E43] text-white shadow-[0_16px_35px_rgba(33,94,67,0.18)]' : 'border-[#E2EBE3] bg-[#FCFDFB] text-[#21332A]'}`}><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${index === 1 ? 'bg-white/15 text-white' : 'bg-[#EAF4EC] text-[#2B7A58]'}`}><Icon size={20} /></div><h3 className="mt-8 text-lg font-extrabold">{title}</h3><p className={`mt-3 text-sm leading-6 ${index === 1 ? 'text-[#D3E6D7]' : 'text-[#6E7E73]'}`}>{description}</p><div className={`mt-8 flex items-center gap-1 text-xs font-bold ${index === 1 ? 'text-white' : 'text-[#2B7A58]'}`}>了解更多 <ArrowRight size={14} className="transition-transform group-hover:translate-x-1" /></div></article>)}
          </div>
        </div>
      </section>

      <section id="moments" className="bg-[#183F2D] px-5 py-20 text-white sm:py-28">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#A8D4B0]">Built for real days</p>
            <h2 className="mt-4 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">不是要求你更自律，<br />而是让选择更轻松。</h2>
            <p className="mt-5 max-w-xl text-sm leading-7 text-[#BFD3C4]">从冰箱里剩下什么，到今天到底吃了什么，食光把琐碎信息放回它该在的位置。</p>
          </div>

          <div className="mt-12 grid gap-7 lg:grid-cols-[.85fr_1.15fr] lg:items-stretch">
            <div className="space-y-2">
              {moments.map((moment, index) => {
                const MomentIcon = moment.icon;
                const isActive = index === activeMoment;
                return (
                  <button
                    key={moment.label}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => setActiveMoment(index)}
                    className={`group flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all ${isActive ? 'border-white/20 bg-white text-[#21332A] shadow-[0_16px_32px_rgba(0,0,0,0.16)]' : 'border-transparent text-[#C3D5C7] hover:border-white/10 hover:bg-white/5'}`}
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isActive ? moment.accent : 'bg-white/10 text-white'}`}><MomentIcon size={18} aria-hidden="true" /></span>
                    <span className="flex-1"><span className="block text-sm font-bold">{moment.label}</span><span className={`mt-1 block text-xs ${isActive ? 'text-[#728277]' : 'text-[#9EB5A4]'}`}>{moment.title}</span></span>
                    <ChevronRight size={17} className={`transition-transform ${isActive ? 'text-[#2B7A58] translate-x-0.5' : 'text-[#8AA891]'}`} aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <article className="relative overflow-hidden rounded-[28px] border border-white/10 bg-[#24573F] p-6 sm:p-8">
              <div className="absolute -right-10 -top-12 h-44 w-44 rounded-full border border-[#8CC6A0]/20" />
              <div className="absolute right-12 top-14 h-24 w-24 rounded-full bg-[#8CC6A0]/10 blur-2xl" />
              <div className="relative flex h-full flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-[#B7D4BE]"><span>食光 App / 场景 {String(activeMoment + 1).padStart(2, '0')}</span><span className="h-px w-12 bg-white/20" /></div>
                  <span className={`mt-10 flex h-12 w-12 items-center justify-center rounded-2xl bg-white ${selectedMoment.accent}`}><SelectedMomentIcon size={22} aria-hidden="true" /></span>
                  <h3 className="mt-6 max-w-lg text-2xl font-extrabold leading-tight tracking-[-0.03em] sm:text-3xl">{selectedMoment.title}</h3>
                  <p className="mt-4 max-w-lg text-sm leading-7 text-[#D0E0D3]">{selectedMoment.description}</p>
                </div>
                <div className="mt-9 grid gap-2 sm:grid-cols-3">
                  {selectedMoment.detail.map((detail, index) => <div key={detail} className="rounded-xl border border-white/10 bg-black/10 p-3"><span className="text-[10px] font-bold tracking-[0.14em] text-[#A7C8AE]">0{index + 1}</span><p className="mt-2 text-xs font-semibold leading-5 text-white">{detail}</p></div>)}
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="bg-[#F4F8F3] py-20 sm:py-28">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 lg:grid-cols-[.82fr_1.18fr] lg:px-8"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-[#2B7A58]">How it works</p><h2 className="mt-4 text-3xl font-extrabold tracking-[-0.035em] text-[#21332A] sm:text-4xl">从“今天吃什么”，到可持续的日常。</h2><p className="mt-5 max-w-md text-sm leading-7 text-[#68796D]">少一些记录压力，多一点可用的反馈。每个模块都服务于下一顿更轻松的选择。</p></div><div className="divide-y divide-[#DCE7DE] border-y border-[#DCE7DE]">{steps.map(([number, title, description]) => <div key={number} className="grid grid-cols-[56px_1fr_auto] gap-3 py-6 sm:grid-cols-[72px_1fr_auto] sm:py-7"><span className="text-sm font-extrabold text-[#78A587]">{number}</span><div><h3 className="font-extrabold text-[#294535]">{title}</h3><p className="mt-2 text-sm leading-6 text-[#718175]">{description}</p></div><ChevronRight className="mt-1 h-5 w-5 text-[#97AA9B]" /></div>)}</div></div>
      </section>

      <section id="beta" className="px-5 py-20 sm:py-28">
        <div className="mx-auto max-w-7xl overflow-hidden rounded-[32px] bg-[#215E43] px-6 py-12 text-center text-white shadow-[0_25px_60px_rgba(33,94,67,0.2)] sm:px-12 sm:py-16"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-white/12"><Sparkles size={21} /></div><h2 className="mt-6 text-3xl font-extrabold tracking-[-0.04em] sm:text-4xl">从今天这一餐开始</h2><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-[#D5E7D8]">已有账号，直接打开食光 App 继续记录；还在观望，欢迎加入内测，和我们一起把它打磨得更贴近日常。</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><a href={appEntryUrl} className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-[#215E43] transition hover:bg-[#EFF7F0]">打开食光 App <ArrowRight size={16} /></a><a href="mailto:adlinzhang@gmail.com?subject=%E9%A3%9F%E5%85%89%E7%83%99%E8%AE%B0%E5%86%85%E6%B5%8B%E7%94%B3%E8%AF%B7" className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 px-5 py-3 text-sm font-bold text-white transition hover:bg-white/10"><Sparkles size={15} /> 申请内测名额</a></div></div>
      </section>

      <footer className="border-t border-[#E2EAE3] px-5 py-7"><div className="mx-auto flex max-w-7xl flex-col gap-3 text-xs text-[#7A897E] sm:flex-row sm:items-center sm:justify-between"><span>© 2026 食光烙记 · Dietdigidose</span><div className="flex items-center gap-5"><a href="https://github.com/AdlinZ/DietDigiDose" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-[#4F6D59] transition hover:text-[#215E43]"><Github size={13} /> GitHub 开源仓库</a><span className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-[#2B7A58]" /> 内测环境 · 数据安全优先</span></div></div></footer>
    </main>
  );
}
