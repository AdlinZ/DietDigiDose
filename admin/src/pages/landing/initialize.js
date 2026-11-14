// Homepage-only interactive examples. All data is static and local to this mount.
// No account mutations, generated code, or remote HTML is executed here.
export function initializeLanding(root) {
const previousOverflow = document.body.style.overflow;
let disposed = false;
const cleanups = [];
function on(target, type, handler, options) {
  target.addEventListener(type, handler, options);
  cleanups.push(() => target.removeEventListener(type, handler, options));
}

/* ================= 图标 ================= */
const P = {
  external:'<path d="M7 17L17 7M9.5 7H17v7.5"/>',
  arrow:'<path d="M4 12h15M13 6l6 6-6 6"/>',
  up:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  down:'<path d="M12 5v14M6 13l6 6 6-6"/>',
  close:'<path d="M6 6l12 12M18 6L6 18"/>',
  check:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  flame:'<path d="M12 3.5c.8 3-4.2 5-4.2 9a4.2 4.2 0 0 0 8.4 0c0-1.9-.9-3.2-1.9-4.3.4 1.9-.9 2.4-.9 2.4.6-2-.4-5.1-1.4-7.1z"/>',
  layers:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 7.8v.2"/>',
  spark:'<path d="M12 4l1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z"/>',
  reset:'<path d="M4 10a8 8 0 1 1 1.5 6M4 10V4m0 6h6"/>',
  mail:'<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M4 7.5l8 5.5 8-5.5"/>',
  basket:'<path d="M4.5 10h15l-1.8 9.5H6.3z"/><path d="M8.5 10l3.5-6 3.5 6M9.5 13.5v3M14.5 13.5v3"/>',
  pot:'<path d="M4 11h16v5a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M8 11a4 4 0 0 1 8 0M2 13h2M20 13h2M10 4.5c0-1.2 1-1.3 1-2.5M14 4.5c0-1.2 1-1.3 1-2.5"/>',
  notebook:'<rect x="6" y="4" width="13" height="17" rx="2"/><path d="M9.5 9h6M9.5 13h6M6 8H4M6 12H4M6 16H4"/>',
  tomato:'<circle cx="12" cy="13.5" r="6.5"/><path d="M12 7c-.2-2 .9-3.2 2.7-3.7M12 7c-1.7-.6-3.5-.3-4.7.8M12 7V5.5"/>',
  egg:'<path d="M12 3.5c3 0 5.8 4.4 5.8 8.7a5.8 5.8 0 1 1-11.6 0C6.2 7.9 9 3.5 12 3.5z"/>',
  scallion:'<path d="M8 21V9M12 21V5M16 21V10M8 9L6.5 6.5M12 5l1-2.5M16 10l1.8-2.3"/>',
  onion:'<circle cx="12" cy="13.5" r="6.5"/><path d="M12 7c-.8-1.8-.2-3 .2-4M9 13.5a3 3 0 0 1 6 0"/>',
  beef:'<rect x="4" y="7.5" width="16" height="9.5" rx="3"/><path d="M7.5 10.5c1.5 1 3 1 4.5 0s3-1 4.5 0M7.5 14c1.5 1 3 1 4.5 0s3-1 4.5 0"/>',
  rice:'<path d="M4 12.5h16a8 8 0 0 1-16 0z"/><path d="M8 9h.01M12 7.5h.01M16 9h.01M9.5 20.5h5"/>',
  tofu:'<rect x="5" y="8.5" width="14" height="10.5" rx="2"/><path d="M5 12h14M9 8.5v10.5"/>',
  leaf:'<path d="M5 19C5 9.5 11 4.5 20 4.5c0 9-5 14.5-15 14.5z"/><path d="M5 19C9 13.5 13 9.5 17 7"/>',
  potato:'<path d="M7 9c2-3.5 8-4 10.5-1s1.5 8-1.5 10-8 1.5-10-1.5S5 12.5 7 9z"/><path d="M10 11h.01M14 13h.01M11 15.5h.01"/>',
  mushroom:'<path d="M4 12a8 8 0 0 1 16 0z"/><path d="M10 12.5h4l-.6 6a1.5 1.5 0 0 1-2.8 0z"/>',
  garlic:'<path d="M12 4.5c1 2 5 3.6 5 8a5 5 0 0 1-10 0c0-4.4 4-6 5-8z"/><path d="M12 9v7"/>',
  ginger:'<path d="M6 12c0-3 3-5 5.5-4S16 8 17 10s2 2.5 1 4.5-4 2.5-6 2-6 1-6-4.5z"/><path d="M14 8.5l2-2"/>',
  bowl:'<path d="M4 12.5h16a8 8 0 0 1-16 0z"/><path d="M9 9c0-1.8 1.6-1.9 1.6-3.7M13.5 9c0-1.8 1.6-1.9 1.6-3.7M9.5 20.5h5"/>'
};
const icon = (n, cls='') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]||''}</svg>`;
root.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

/* ================= 数据 ================= */
const ING = [
  {k:'tomato', n:'番茄', q:'2 个', i:'tomato'},
  {k:'egg', n:'鸡蛋', q:'3 枚', i:'egg'},
  {k:'scallion', n:'小葱', q:'1 把', i:'scallion'},
  {k:'onion', n:'洋葱', q:'1 颗', i:'onion'},
  {k:'beef', n:'肥牛卷', q:'200 g', i:'beef'},
  {k:'rice', n:'剩米饭', q:'1 碗', i:'rice'},
  {k:'tofu', n:'嫩豆腐', q:'1 盒', i:'tofu'},
  {k:'greens', n:'青菜', q:'2 棵', i:'leaf'},
  {k:'potato', n:'土豆', q:'2 个', i:'potato'},
  {k:'mushroom', n:'蘑菇', q:'150 g', i:'mushroom'},
  {k:'garlic', n:'大蒜', q:'1 头', i:'garlic'},
  {k:'ginger', n:'生姜', q:'1 块', i:'ginger'}
];
const ING_NAME = Object.fromEntries(ING.map(x => [x.k, x.n]));
const RECIPES = [
  {id:'fqcd', name:'番茄炒蛋', tag:'家常快手', time:15, serves:2, desc:'国民下饭菜，酸甜汤汁拌饭一绝。',
   needs:[{k:'tomato',a:'2 个（约 300 g）'},{k:'egg',a:'3 枚'},{k:'scallion',a:'1 根'}],
   pantry:'盐 2 g · 糖 3 g · 食用油 15 ml',
   steps:['番茄切块，鸡蛋加少许盐打散，小葱切花。','热锅倒油，倒入蛋液，边缘凝固后划散，盛出备用。','锅里留底油，下番茄中火炒到出沙，加糖和盐调味。','倒回鸡蛋翻匀，撒葱花，出锅。'],
   nutri:{kcal:210, protein:12, fat:14, carb:9}},
  {id:'ycnrf', name:'洋葱肥牛饭', tag:'一碗端', time:20, serves:1, desc:'一锅出汁，盖在热饭上就是满足的一餐。',
   needs:[{k:'onion',a:'半个'},{k:'beef',a:'200 g'},{k:'rice',a:'一碗'}],
   pantry:'生抽 15 ml · 糖 5 g · 食用油 10 ml',
   steps:['洋葱切丝；肥牛卷室温回软。','生抽、糖加两勺清水，搅匀成料汁。','热锅少油，下洋葱丝炒到透明微焦。','下肥牛大火快炒至变色，淋入料汁收浓。','盖在热米饭上，把汤汁浇上去。'],
   nutri:{kcal:560, protein:28, fat:24, carb:58}},
  {id:'mpdf', name:'麻婆豆腐', tag:'下饭', time:18, serves:2, desc:'家常少肉版，麻辣鲜香靠豆瓣和花椒。',
   needs:[{k:'tofu',a:'1 盒（400 g）'},{k:'garlic',a:'2 瓣'},{k:'scallion',a:'1 根'}],
   pantry:'豆瓣酱 15 g · 花椒 1 g · 淀粉 5 g · 食用油 15 ml',
   steps:['豆腐切小块，淡盐水里泡 5 分钟去腥。','蒜切末，豆瓣酱剁细；花椒焙香碾碎。','少油炒香蒜末与豆瓣酱，加半碗水煮开。','下豆腐小火煨 3 分钟，水淀粉勾薄芡。','撒花椒碎和葱花，趁热盖在饭上。'],
   nutri:{kcal:240, protein:14, fat:null, carb:12}},
  {id:'hjdcf', name:'黄金蛋炒饭', tag:'快手', time:10, serves:1, desc:'隔夜饭的归宿，粒粒分明、金黄干香。',
   needs:[{k:'rice',a:'一碗（隔夜）'},{k:'egg',a:'2 枚'},{k:'scallion',a:'1 根'}],
   pantry:'盐 2 g · 食用油 15 ml',
   steps:['蛋黄拌进米饭抓散，让每粒米裹上蛋液。','蛋白单独炒熟盛出。','热锅热油下米饭，中火炒到粒粒分明。','倒回蛋白，加盐调味，撒葱花翻匀。'],
   nutri:{kcal:420, protein:14, fat:16, carb:52}},
  {id:'qcdft', name:'青菜豆腐汤', tag:'汤羹', time:12, serves:2, desc:'清清爽爽，给一餐画个温柔的句号。',
   needs:[{k:'greens',a:'2 棵'},{k:'tofu',a:'半盒'},{k:'ginger',a:'2 片'}],
   pantry:'盐 2 g · 香油 3 ml',
   steps:['青菜洗净切段，豆腐切小块。','锅里烧水，下姜片煮 2 分钟。','下豆腐煮 3 分钟，再下青菜烫软。','盐调味，滴几滴香油出锅。'],
   nutri:{kcal:90, protein:7, fat:4, carb:6}},
  {id:'sltds', name:'酸辣土豆丝', tag:'家常', time:15, serves:2, desc:'脆爽酸辣，考验刀工也考验火候。',
   needs:[{k:'potato',a:'2 个'},{k:'garlic',a:'2 瓣'}],
   pantry:'干辣椒 2 个 · 醋 15 ml · 盐 2 g · 食用油 15 ml',
   steps:['土豆切细丝，清水淘掉表面淀粉，沥干。','蒜切片，干辣椒剪段。','热油爆香蒜片和辣椒，下土豆丝大火快炒。','沿锅边淋醋，加盐炒到断生仍脆。'],
   nutri:{kcal:180, protein:4, fat:8, carb:24}},
  {id:'mgcqc', name:'蘑菇炒青菜', tag:'时蔬', time:10, serves:2, desc:'菌菇的鲜配青菜的甜，简单就很好。',
   needs:[{k:'mushroom',a:'150 g'},{k:'greens',a:'2 棵'},{k:'garlic',a:'2 瓣'}],
   pantry:'盐 2 g · 食用油 12 ml',
   steps:['蘑菇切片，青菜切段，蒜切末。','热锅少油，先下蘑菇炒到出水再收干。','下蒜末和青菜梗炒香，再下菜叶。','盐调味，全程大火不超过 3 分钟。'],
   nutri:{kcal:120, protein:5, fat:7, carb:10}},
  {id:'fqdfg', name:'番茄豆腐羹', tag:'汤羹', time:15, serves:2, desc:'酸香开胃，蛋花要薄如蝉翼。',
   needs:[{k:'tomato',a:'1 个'},{k:'tofu',a:'半盒'},{k:'egg',a:'1 枚'},{k:'scallion',a:'1 根'}],
   pantry:'盐 2 g · 淀粉 8 g · 香油 3 ml',
   steps:['番茄去皮切小丁，豆腐切小块。','少油把番茄炒出沙，加两碗水煮开。','下豆腐煮 3 分钟，水淀粉勾薄芡。','淋入蛋液搅出蛋花，盐调味，撒葱花点香油。'],
   nutri:{kcal:160, protein:10, fat:8, carb:12}}
];

/* ================= 状态 ================= */
const selected = new Set(['tomato','egg','scallion','rice']);
const queue = new Set();
const prep = {};           // recipeId -> Set(checked need idx)
let activeId = null;
let activeTab = 'prep';

const $ = s => root.querySelector(s);
const fridgeGrid = $('#fridgeGrid'), demoRight = $('#demoRight'),
      fridgeCount = $('#fridgeCount'), rightTitle = $('#rightTitle'), rightSub = $('#rightSub'),
      queueCount = $('#queueCount'), queuePanel = $('#queuePanel'), queueList = $('#queueList'),
      toastEl = $('#toast'), toastMsg = $('#toastMsg');
let toastTimer = null;
function toast(msg){
  toastMsg.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
}

/* ================= 冰箱 ================= */
function renderFridge(){
  fridgeGrid.innerHTML = ING.map(g => `
    <button class="ing" data-ing="${g.k}" aria-pressed="${selected.has(g.k)}">
      ${icon(g.i)}<b>${g.n}</b><small>${g.q}</small>
    </button>`).join('');
  fridgeCount.textContent = `已选 ${selected.size} 样`;
}
on(fridgeGrid, 'click', e => {
  const btn = e.target.closest('[data-ing]');
  if(!btn) return;
  const k = btn.dataset.ing;
  if(selected.has(k)) selected.delete(k); else selected.add(k);
  btn.setAttribute('aria-pressed', selected.has(k));
  fridgeCount.textContent = `已选 ${selected.size} 样`;
  renderRight();
});
on($('#randomBtn'), 'click', () => {
  const keys = ING.map(g => g.k).sort(() => Math.random() - .5);
  selected.clear();
  keys.slice(0, 4 + Math.floor(Math.random() * 3)).forEach(k => selected.add(k));
  renderFridge(); renderRight();
  toast('随手抓了一把食材，看看能做什么');
});
on($('#resetBtn'), 'click', () => {
  selected.clear();
  renderFridge(); renderRight();
  toast('冰箱清空了，重新勾选几样吧');
});

/* ================= 匹配与列表 ================= */
function scored(){
  return RECIPES.map(r => {
    const have = r.needs.filter(n => selected.has(n.k));
    const missing = r.needs.filter(n => !selected.has(n.k));
    return { r, pct: have.length / r.needs.length, missing };
  }).sort((a, b) => b.pct - a.pct || a.missing.length - b.missing.length || a.r.time - b.r.time);
}
function queueBtnHTML(id){
  const added = queue.has(id);
  return `<button class="queue-btn ${added?'added':''}" data-queue="${id}">${icon(added?'check':'plus')}${added?'已在队列':'加入队列'}</button>`;
}
function renderList(){
  const prevScroll = demoRight.querySelector('.result-list')?.scrollTop || 0;
  const rows = scored();
  const okCount = rows.filter(x => x.pct === 1).length;
  rightTitle.textContent = '今晚可以做';
  rightSub.textContent = `${RECIPES.length} 道菜 · ${okCount} 道食材齐了`;
  const hint = selected.size === 0 ? `<div class="empty-hint">冰箱空空如也 —— 先勾选几样食材，或点上方「随机一把」。</div>` : '';
  demoRight.innerHTML = hint + `<div class="result-list dark-scroll">` + rows.map(({r, pct, missing}) => `
    <article class="recipe">
      <div class="recipe-top">
        <button class="recipe-main" data-open="${r.id}" aria-label="查看${r.name}的做法">
          <span class="recipe-name"><b>${r.name}</b><span class="rtag">${r.tag}</span></span>
          <span class="recipe-meta">${icon('clock')}${r.time} 分钟 · ${r.serves} 人份</span>
          <span class="match ${pct===1?'ok':''}"><span class="match-bar"><i style="width:${Math.round(pct*100)}%"></i></span><em>${pct===1?'齐了':Math.round(pct*100)+'%'}</em></span>
          ${pct===1
            ? `<span class="miss ok">食材齐了，可以开火。</span>`
            : `<span class="miss">还缺：<b>${missing.map(m => ING_NAME[m.k]).join('、')}</b></span>`}
        </button>
        ${queueBtnHTML(r.id)}
      </div>
    </article>`).join('') + `</div>`;
  const list = demoRight.querySelector('.result-list');
  if(list) list.scrollTop = prevScroll;
}

/* ================= 详情 ================= */
function renderDetail(){
  const r = RECIPES.find(x => x.id === activeId);
  if(!r){ activeId = null; renderList(); return; }
  rightTitle.textContent = '食谱详情';
  rightSub.textContent = '演示数据为示例';
  const checked = prep[r.id] || new Set();
  const pct = Math.round(checked.size / r.needs.length * 100);
  const tabs = [['prep','备料清单'],['steps','做法步骤'],['nutri','营养参考']];
  let body = '';
  if(activeTab === 'prep'){
    body = `<ul class="prep-list">${r.needs.map((n, i) => `
      <li><label class="prep-row">
        <input type="checkbox" data-prep="${i}" ${checked.has(i)?'checked':''}>
        <span class="box">${icon('check')}</span>
        <span class="pname">${ING_NAME[n.k]}</span><span class="pamt">${n.a}</span>
      </label></li>`).join('')}</ul>
      <div class="prep-progress"><span class="match-bar"><i id="prepBar" style="width:${pct}%"></i></span><small id="prepText">已备好 ${checked.size}/${r.needs.length}</small></div>
      <p class="pantry-note"><b>常备调料：</b>${r.pantry}</p>`;
  } else if(activeTab === 'steps'){
    body = `<ol class="steps-ol">${r.steps.map(s => `<li>${s}</li>`).join('')}</ol>`;
  } else {
    const n = r.nutri;
    const cell = (v, u, label) => v == null
      ? `<div class="nutri pending"><b>待补全</b><span>${label}</span></div>`
      : `<div class="nutri"><b>${v}<small>${u}</small></b><span>${label}</span></div>`;
    body = `<div class="nutri-grid">${cell(n.kcal,'kcal','热量')}${cell(n.protein,'g','蛋白质')}${cell(n.fat,'g','脂肪')}${cell(n.carb,'g','碳水')}</div>
      <p class="nutri-note">${icon('info')}<span><span class="estimate-tag">估算</span> 基于原料与用量的估算值（每份），不是精确测量；资料不全的项目会标明待补全，也不应当作医疗建议。</span></p>`;
  }
  demoRight.innerHTML = `
    <button class="back-link" data-back>${icon('down')} 返回菜谱列表</button>
    <h3 class="detail-title">${r.name}</h3>
    <p class="detail-desc">${r.desc}</p>
    <div class="detail-meta"><span>${icon('clock')}${r.time} 分钟</span><span>${icon('bowl')}${r.serves} 人份</span><span>${r.tag}</span></div>
    <div class="tabs" role="tablist">${tabs.map(([k, label]) => `<button role="tab" data-tab="${k}" aria-selected="${activeTab===k}">${label}</button>`).join('')}</div>
    <div role="tabpanel">${body}</div>
    <div class="detail-foot">${queueBtnHTML(r.id, true)}<a class="detail-link" href="#start" >申请手机端内测 ${icon('external')}</a></div>`;
  demoRight.querySelector('.back-link .ic').style.transform = 'rotate(90deg)';
}
function renderRight(){ if(activeId) renderDetail(); else renderList(); }

on(demoRight, 'click', e => {
  const open = e.target.closest('[data-open]');
  if(open){ activeId = open.dataset.open; activeTab = 'prep'; renderRight();
    if(window.innerWidth < 1080) demoRight.scrollIntoView({behavior:'smooth', block:'start'});
    return; }
  if(e.target.closest('[data-back]')){ activeId = null; renderRight(); return; }
  const tab = e.target.closest('[data-tab]');
  if(tab){ activeTab = tab.dataset.tab; renderRight(); return; }
  const q = e.target.closest('[data-queue]');
  if(q){ toggleQueue(q.dataset.queue); }
});
on(demoRight, 'change', e => {
  const cb = e.target.closest('[data-prep]');
  if(!cb || !activeId) return;
  const set = prep[activeId] || (prep[activeId] = new Set());
  const i = +cb.dataset.prep;
  if(cb.checked) set.add(i); else set.delete(i);
  const r = RECIPES.find(x => x.id === activeId);
  $('#prepBar').style.width = Math.round(set.size / r.needs.length * 100) + '%';
  $('#prepText').textContent = `已备好 ${set.size}/${r.needs.length}`;
  if(set.size === r.needs.length) toast('备料齐了，可以开火');
});

/* ================= 烹饪队列 ================= */
function toggleQueue(id){
  const r = RECIPES.find(x => x.id === id);
  if(queue.has(id)){ queue.delete(id); toast(`已移出烹饪队列 · ${r.name}`); }
  else { queue.add(id); toast(`已加入烹饪队列 · ${r.name}`); }
  queueCount.textContent = queue.size;
  renderRight(); renderQueuePanel();
}
function renderQueuePanel(){
  queueList.innerHTML = queue.size === 0
    ? `<p class="queue-empty">队列还空着，看到想做的就加进来。</p>`
    : [...queue].map(id => {
        const r = RECIPES.find(x => x.id === id);
        return `<div class="queue-row"><span>${r.name}</span><button data-unqueue="${id}" aria-label="把${r.name}移出队列">${icon('close')}</button></div>`;
      }).join('');
}
on($('#queueChip'), 'click', e => {
  e.stopPropagation();
  const open = queuePanel.classList.toggle('open');
  $('#queueChip').setAttribute('aria-expanded', open);
  renderQueuePanel();
});
on(queuePanel, 'click', e => {
  e.stopPropagation();
  const un = e.target.closest('[data-unqueue]');
  if(un){ toggleQueue(un.dataset.unqueue); return; }
  if(e.target.closest('#queueClear')){
    if(queue.size === 0) return;
    queue.clear(); queueCount.textContent = 0;
    renderRight(); renderQueuePanel();
    toast('烹饪队列已清空');
  }
});
on(document, 'click', e => {
  if(!e.target.closest('.demo-controls')){
    queuePanel.classList.remove('open');
    $('#queueChip').setAttribute('aria-expanded', 'false');
  }
});

/* ================= 灯箱 ================= */
const lightbox = $('#lightbox');
function openLightbox(){ closeMenu(false); lightbox.inert = false; lightbox.setAttribute('aria-hidden', 'false'); lightbox.classList.add('open'); document.body.style.overflow = 'hidden'; $('#lightboxClose').focus(); }
function closeLightbox(){ const wasOpen = lightbox.classList.contains('open'); lightbox.classList.remove('open'); lightbox.inert = true; lightbox.setAttribute('aria-hidden', 'true'); document.body.style.overflow = previousOverflow; if(wasOpen) $('#shotBtn').focus(); }
on($('#shotBtn'), 'click', openLightbox);
on($('#lightboxClose'), 'click', closeLightbox);
on(lightbox, 'click', e => { if(e.target === lightbox) closeLightbox(); });
on(document, 'keydown', e => { if(e.key === 'Escape'){ closeLightbox(); closeMenu(); }
  if(e.key === 'Tab'){
    const dialog = lightbox.classList.contains('open') ? lightbox : (overlay.classList.contains('open') ? overlay : null);
    if(!dialog) return;
    const items = [...dialog.querySelectorAll('a[href], button:not([disabled])')];
    const first = items[0], last = items[items.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  } });

/* ================= FAQ ================= */
root.querySelectorAll('.faq-item').forEach(item => {
  on(item.querySelector('.faq-q'), 'click', () => {
    const open = item.classList.toggle('open');
    item.querySelector('.faq-q').setAttribute('aria-expanded', open);
  });
});

/* ================= 移动菜单 ================= */
const overlay = $('#menuOverlay'), burger = $('#burger');
function closeMenu(restoreFocus = true){
  const wasOpen = overlay.classList.contains('open');
  overlay.inert = true;
  overlay.classList.remove('open');
  overlay.setAttribute('aria-hidden', 'true');
  burger.setAttribute('aria-expanded', 'false');
  document.body.style.overflow = previousOverflow;
  if(wasOpen && restoreFocus) burger.focus();
}
on(burger, 'click', () => {
  const open = overlay.classList.toggle('open');
  overlay.inert = !open;
  overlay.setAttribute('aria-hidden', String(!open));
  burger.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : previousOverflow;
  if(open) $('#menuClose').focus();
});
on($('#menuClose'), 'click', closeMenu);
overlay.querySelectorAll('a').forEach(a => on(a, 'click', closeMenu));

/* ================= 导航状态 / 滚动 ================= */
const nav = $('#nav'), progress = $('#progress'), toTop = $('#toTop');
let ticking = false; let scrollFrame = 0;
function onScroll(){
  if(disposed) return;
  const y = window.scrollY;
  nav.classList.toggle('scrolled', y > 10);
  const h = document.documentElement.scrollHeight - window.innerHeight;
  progress.style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
  toTop.classList.toggle('show', y > 600);
  ticking = false;
}
on(window, 'scroll', () => { if(!ticking){ ticking = true; scrollFrame = requestAnimationFrame(() => { if(!disposed) onScroll(); }); } }, {passive:true});
onScroll();
on(toTop, 'click', () => window.scrollTo({top:0, behavior:'smooth'}));


// Reveal without hiding content when observers are unavailable or motion is reduced.
root.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('in'));
root.classList.add('ready');
const mq = $('#mqTrack');
mq.innerHTML += mq.innerHTML;
renderFridge(); renderRight(); renderQueuePanel();
return () => {
  disposed = true;
  cleanups.forEach(cleanup => cleanup());
  clearTimeout(toastTimer);
  cancelAnimationFrame(scrollFrame);
  document.body.style.overflow = previousOverflow;
};

}
