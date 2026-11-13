// Run with: node --test redesign/interactions.test.cjs
// Dependency-free state-machine regressions; not a visual/browser test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = name => fs.readFileSync(path.join(__dirname, name), 'utf8');
const script = name => source(name).match(/<script>([\s\S]*?)<\/script>/)[1];
function harness(reduced = true) {
  const handlers = {}, timeouts = new Map(), intervals = new Map(), elements = new Map();
  let nextId = 0;
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', style: {}, innerHTML: '',
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {}, focus() {}, scrollHeight: 0 });
    return elements.get(selector);
  };
  const ctx = vm.createContext({ console, Math, Date, matchMedia: () => ({ matches: reduced }),
    window: { addEventListener() {} },
    document: { querySelector: element, querySelectorAll: () => [], addEventListener: (key, fn) => handlers[key] = fn },
    localStorage: { getItem: () => 'accepted' },
    setTimeout: fn => { const id = ++nextId; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id),
    setInterval: fn => { const id = ++nextId; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
  });
  const run = code => vm.runInContext(code, ctx);
  run(script('shiguang-ai-redesign.html'));
  const click = dataset => handlers.click({ target: { closest: () => ({ dataset }) } });
  const flush = () => { for (const [id, fn] of [...timeouts]) { timeouts.delete(id); fn(); } };
  const tick = () => { for (const fn of [...intervals.values()]) fn(); };
  run("S.sessions=[{id:'a',title:'新对话',msgs:[]},{id:'b',title:'新对话',msgs:[]}];S.activeId='a';renderAll();");
  return { run, click, flush, tick, intervals, timeouts, element };
}
for (const reduced of [true, false]) {
  test(`reply stays with original session after switching (reduced=${reduced})`, () => {
    const h = harness(reduced);
    h.run("send('分析今日饮食')");
    h.click({ a: 'load-session', id: 'b' });
    h.flush();
    for (let i = 0; i < 200; i++) h.tick();
    assert.equal(h.run('S.sessions[0].msgs.length'), 2);
    assert.equal(h.run('S.sessions[1].msgs.length'), 0);
    assert.equal(h.run('S.busy'), false);
    h.click({ a: 'load-session', id: 'a' });
    assert.match(h.element('#convIn').innerHTML, /今天已记录/);
  });
  test(`new chat and clear do not cancel a different session (reduced=${reduced})`, () => {
    const h = harness(reduced);
    h.run("send('分析今日饮食')");
    h.click({ a: 'new-chat' });
    h.click({ a: 'menu-clear' });
    h.flush();
    for (let i = 0; i < 200; i++) h.tick();
    assert.equal(h.run("S.sessions.find(s=>s.id==='a').msgs.length"), 2);
    assert.equal(h.run('msgs().length'), 0);
    assert.equal(h.run('S.busy'), false);
  });
  test(`clear cancels pending reply and permits another send (reduced=${reduced})`, () => {
    const h = harness(reduced);
    h.run("send('分析今日饮食')");
    const stale = [...h.timeouts.values()][0];
    h.click({ a: 'menu-clear' });
    assert.equal(h.run('S.busy'), false);
    h.run("send('喝水')");
    stale(); // Even an already-queued callback must not modify the new request.
    h.flush();
    for (let i = 0; i < 200; i++) h.tick();
    assert.equal(h.run('msgs().length'), 2);
    assert.match(h.run('msgs()[1].text'), /今日饮水/);
  });
}
test('stream survives switching away and back; clear during stream stays empty', () => {
  const h = harness(false);
  h.run("send('分析今日饮食')"); h.flush(); h.tick();
  h.click({ a: 'load-session', id: 'b' }); h.tick();
  h.click({ a: 'load-session', id: 'a' });
  assert.match(h.element('#convIn').innerHTML, /今天已记/);
  h.click({ a: 'menu-clear' }); h.tick(); h.flush();
  assert.equal(h.run('msgs().length'), 0);
  assert.equal(h.run('S.busy'), false);
  assert.equal(h.intervals.size, 0);
});
test('scan undo removes only its own IDs and confirm/undo are idempotent', () => {
  const h = harness();
  h.run("S.pantry=[{id:'existing',name:'原有'}];sess().msgs=[{id:'one',role:'ai',text:'',cards:[{type:'scan',items:SCAN}]},{id:'two',role:'ai',text:'',cards:[{type:'scan',items:SCAN}]}]");
  const click = (a, mid) => h.click({ a, mid, ci: '0' });
  click('scan-confirm', 'one'); click('scan-confirm', 'one');
  assert.equal(h.run('S.pantry.length'), h.run('SCAN.length+1'));
  click('scan-confirm', 'two');
  h.run("S.pantry.unshift({id:'later',name:'后来添加'})");
  click('scan-undo', 'one'); click('scan-undo', 'one');
  assert.equal(h.run('S.pantry.length'), h.run('SCAN.length+2'));
  assert.equal(h.run("msgs()[1].cards[0].added.every(id=>S.pantry.some(p=>p.id===id))"), true);
  assert.equal(h.run("S.pantry.some(p=>p.id==='existing')&&S.pantry.some(p=>p.id==='later')"), true);
});
// Exercise the shipped add-food transition handlers with controlled completion order.
function scanHarness() {
  const src = script('shiguang-app-redesign.html');
  const lines = src.split('\n');
  const callbacks = [];
  const ctx = vm.createContext({ W: null, winScanToken: 0, reduced: false,
    renderWin() {}, SCAN_SAMPLE: [{ name: '识别食材' }], setTimeout: fn => callbacks.push(fn),
    document: { body: { classList: { add() {}, remove() {} } } },
    $: () => ({ classList: { remove() {} } }) });
  const run = s => vm.runInContext(s, ctx);
  run(lines.filter(l => l.startsWith('function openWin(') || l.startsWith('function closeWin(')).join('\n'));
  const action = (a, v) => {
    ctx.a = a; ctx.v = v;
    run('(function(){' + lines.find(l => l.includes(`if(a==='${a}')`)) + '})()');
  };
  return { run, action, callbacks };
}
for (const interruption of ['close', 'back', 'manual', 'replace']) {
  test(`old scan cannot overwrite ${interruption} transition`, () => {
    const h = scanHarness();
    h.run("openWin({type:'addfood',mode:'choose'})");
    h.action('af-mode', 'photo');
    if (interruption === 'close') h.run("closeWin();openWin({type:'addfood',mode:'manual',name:'正在输入'})");
    if (interruption === 'back') h.action('af-back');
    if (interruption === 'manual') h.action('af-mode', 'manual');
    if (interruption === 'replace') h.run("openWin({type:'addfood',mode:'manual'})");
    const before = h.run('JSON.stringify(W)');
    h.callbacks[0]();
    assert.equal(h.run('JSON.stringify(W)'), before);
  });
}
test('only latest scan completes; uninterrupted scan succeeds', () => {
  const h = scanHarness(); h.run("openWin({type:'addfood'})");
  h.action('af-mode', 'photo'); h.action('af-mode', 'photo');
  h.callbacks[0](); assert.equal(h.run('W.mode'), 'scanning');
  h.callbacks[1](); assert.equal(h.run('W.mode'), 'scan');
  assert.equal(h.run('W.rows.length'), 1);
});
test('all standalone HTML inline scripts parse', () => {
  for (const file of ['index.html', 'shiguang-app-redesign.html', 'shiguang-ai-redesign.html']) {
    for (const match of source(file).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
  }
});
