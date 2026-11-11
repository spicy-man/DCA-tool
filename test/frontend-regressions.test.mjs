import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSentiment } from '../public/js/charts/sentiment.mjs';
import { setSignalSentiment, updateSignals, drawSignalMarkers, initStrategyOverlay, signalSettings, getVisibleSignals, getSignalStrategy, signalTooltipRows } from '../public/js/features/strategy/overlay.mjs';
import { appEvents, events } from '../public/js/services/events.mjs';
import { loadMarket, invalidateMarket, initMarketChart, renderMarket } from '../public/js/features/market/chart.mjs';
import { initStrategyDialog } from '../public/js/ui/strategy-dialog.mjs';

function element() {
  const attrs = {};
  return {
    textContent: '', dataset: {}, style: { setProperty() {} }, children: [], value: '', checked: true,
    listeners: {}, open: true, clientWidth: 600, clientHeight: 300,
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children = this.children.filter(existing => existing !== child); this.children.push(child); },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name]; },
    closest() { return this; },
    addEventListener(name, fn) { this.listeners[name] = fn; }
  };
}

function dom(t) {
  const nodes = new Map();
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected fetch'); });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  globalThis.document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement: element,
    createElementNS: (_, tag) => Object.assign(element(), { tag }),
    querySelector: () => null
  };
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  return id => document.getElementById(id);
}

const rows = ['2025-01-02', '2025-01-03', '2025-01-06'].map(date => ({ date, open: 100, high: 110, low: 90, close: 100 }));
const data = { symbol: 'QQQ', rows, fetchedAt: '2025-01-07T00:00:00Z' };
const settings = { start: rows[0].date, end: rows.at(-1).date, calendar: rows.map(r => r.date), frequency: 'daily' };
const frame = { w: 600, h: 300, bottom: 32, x: date => rows.findIndex(r => r.date === date) * 50, y: () => 100 };

test('前高修复仅在选定起始日并播放后展示，暂停保留且不提前暴露修复结果', async t => {
  const $ = dom(t);
  const { initBacktest, updateBacktest } = await import('../public/js/features/strategy/backtest.mjs');
  const previousStorage = globalThis.localStorage;
  const previousResize = globalThis.ResizeObserver;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { globalThis.localStorage = previousStorage; globalThis.ResizeObserver = previousResize; });
  let tick;
  let interval;
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { tick = callback; interval = delay; return 1; });
  t.mock.method(Math, 'random', () => 0.99);
  t.mock.method(globalThis, 'clearInterval', () => {});
  initBacktest();
  const plot = $('backtest-plot');
  plot.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 140 });
  const at = index => ({ clientX: 10 + (index + 0.5) * (536 / 7) / 2, clientY: 70 });
  const marked = attr => plot.children.find(c => c.getAttribute(attr) === '');
  const key = value => plot.listeners.keydown({ key: value, preventDefault() {} });
  const daily = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'].map((date, i) => ({ date, open: 100, close: [100, 100, 80, 90][i] }));
  const context = {
    symbol: 'QQQ', rows: daily, monthlySignals: [{ date: daily[0].date, amount: 100 }],
    fearSignals: [{ date: daily[3].date, amount: 100 }], baseAmount: 100, sentiment: [],
    range: { start: daily[0].date, end: daily.at(-1).date, calendar: daily.map(r => r.date) }
  };
  const line = () => $('backtest-plot').children.find(c => c.getAttribute('data-recovery-line') === '');
  const label = () => $('backtest-plot').children.find(c => c.getAttribute('data-recovery-label') === '').textContent;
  updateBacktest(context);
  const strategyPaths = plot.children.filter(node => node.getAttribute('data-strategy'));
  assert.deepEqual(strategyPaths.map(node => node.getAttribute('data-strategy')), ['regular', 'pyramid', 'combined']);
  assert.ok(strategyPaths.every(node => node.getAttribute('stroke-width') === '2'));
  assert.ok(strategyPaths.every(node => node.getAttribute('stroke-dasharray') === undefined));
  assert.equal(line(), undefined);
  assert.equal($('backtest-replay-play').disabled, true);
  $('backtest-replay-random').listeners.click();
  assert.equal($('backtest-replay-start').value, '2025-01-06');
  assert.equal(line(), undefined);
  $('backtest-replay-start').value = '2025-01-02';
  $('backtest-replay-start').listeners.change();
  assert.equal(line(), undefined);
  $('backtest-replay-play').listeners.click();
  assert.equal(interval, 250);
  $('backtest-replay-speed').value = '16';
  $('backtest-replay-speed').listeners.change();
  assert.equal(interval, 62.5);
  assert.match($('backtest-period').textContent, /2025-01-02 — 2025-01-02/);
  assert.equal(line(), undefined);
  tick();
  assert.equal(line(), undefined);
  tick();
  assert.equal(label(), '未修复 · 已 3 天');
  assert.ok(plot.children.indexOf(marked('data-recovery-label')) > plot.children.indexOf(marked('data-replay-mask')));
  assert.match($('backtest-period').textContent, /2025-01-06/);
  plot.listeners.click(at(3));
  assert.equal($('backtest-replay-play').textContent, '暂停');
  assert.match($('backtest-period').textContent, /2025-01-06/);
  $('backtest-replay-play').listeners.click();
  assert.equal($('backtest-replay-play').textContent, '播放');
  assert.equal(label(), '未修复 · 已 3 天');
  $('backtest-replay-speed').value = '1';
  $('backtest-replay-speed').listeners.change();
  assert.equal($('backtest-replay-play').textContent, '播放');
  $('backtest-replay-play').listeners.click();
  assert.equal(interval, 1000);
  tick();
  assert.equal(label(), '前高修复 · 4 天');
  assert.equal(line().getAttribute('y1'), line().getAttribute('y2'));
  assert.ok(Number(line().getAttribute('x2')) > Number(line().getAttribute('x1')));
  plot.listeners.pointermove(at(2));
  assert.equal(marked('data-replay-date').textContent, '2025-01-06');
  assert.equal(marked('data-recovery-label').getAttribute('visibility'), 'hidden');
  assert.equal(marked('data-replay-mask').getAttribute('x'), marked('data-replay-cursor').getAttribute('x1'));
  assert.equal(label(), '前高修复 · 4 天');
  plot.listeners.pointerleave();
  assert.equal(marked('data-replay-date').textContent, '2025-01-07');
  assert.equal(marked('data-recovery-label').getAttribute('visibility'), 'visible');
  plot.listeners.click(at(2));
  assert.equal(label(), '未修复 · 已 3 天');
  assert.equal($('backtest-replay-play').textContent, '播放');
  assert.equal($('backtest-replay-start').value, '2025-01-02');
  plot.listeners.click(at(3));
  assert.equal(label(), '前高修复 · 4 天');
  key('Home');
  assert.equal(line(), undefined);
  key('ArrowRight');
  assert.match($('backtest-period').textContent, /2025-01-03/);
  key('End');
  assert.equal(label(), '前高修复 · 4 天');
  plot.listeners.click(at(2));
  $('backtest-replay-play').listeners.click();
  assert.equal(interval, 1000);
  plot.listeners.click(at(1));
  assert.equal($('backtest-replay-play').textContent, '播放');
  key('End');
  $('backtest-tab-profit').listeners.click();
  assert.equal(label(), '未修复 · 已 4 天');
  assert.match(line().getAttribute('aria-label'), /累计盈亏前高 0.00/);
  $('backtest-scale-toggle').listeners.click();
  assert.equal(label(), '未修复 · 已 4 天');
  assert.ok(Number.isFinite(Number(line().getAttribute('y1'))));
  $('backtest-mode').value = 'actual';
  $('backtest-mode').listeners.change();
  assert.equal(label(), '未修复 · 已 4 天');
  $('backtest-replay-random').listeners.click();
  assert.equal($('backtest-replay-start').value, '2025-01-06');
  assert.equal(line(), undefined);
  $('backtest-replay-play').listeners.click();
  assert.match($('backtest-period').textContent, /2025-01-06 — 2025-01-06/);
  $('backtest-replay-reset').listeners.click();
  assert.equal(line(), undefined);
  assert.match($('backtest-period').textContent, /2025-01-02 — 2025-01-07/);
  $('backtest-replay-play').listeners.click();
  updateBacktest({ ...context, symbol: 'SPY' });
  assert.equal(line(), undefined);
  assert.equal($('backtest-replay-start').value, '');
  assert.equal($('backtest-replay-play').disabled, true);
});

test('ticker 切换后刷新恢复，失效偏好及存储异常不阻断初始化和切换', async t => {
  const $ = dom(t);
  const saved = new Map();
  let blocked = false;
  for (const [key, value] of Object.entries({
    localStorage: {
      getItem(key) { if (blocked) throw Error('Storage blocked'); return saved.get(key) ?? null; },
      setItem(key, value) { if (blocked) throw Error('Storage blocked'); saved.set(key, value); }
    },
    ResizeObserver: class { observe() {} },
    devicePixelRatio: 1
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  $('symbol').options = ['SPY', 'QQQ', 'VGT'].map(value => ({ value }));
  $('symbol').value = 'SPY';
  $('price-chart').getContext = () => ({ scale() {}, fillRect() {} });
  initMarketChart();
  assert.equal($('symbol').value, 'SPY');
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ ...data, symbol: 'VGT' }) };
  });
  $('symbol').value = 'VGT';
  $('symbol').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.get('seeker.symbol.v1'), 'VGT');
  assert.ok(requests.some(url => url.includes('vgt.json')));
  // An ordinary switch reuses the cache; re-adding must use the new snapshot.
  let dates;
  const calendarListener = event => { dates = event.detail; };
  appEvents.addEventListener(events.marketCalendar, calendarListener);
  t.after(() => appEvents.removeEventListener(events.marketCalendar, calendarListener));
  const count = requests.length;
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return { ok: true, json: async () => ({ ...data, symbol: 'VGT',
      rows: [...rows, { ...rows[0], date: '2025-01-07' }] }) };
  });
  $('symbol').listeners.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, count);
  assert.equal(dates.at(-1), '2025-01-06');
  $('symbol').listeners.change({ detail: { forceRefresh: true } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(requests.length, count + 1);
  assert.equal(dates.at(-1), '2025-01-07');
  $('symbol').value = 'SPY';
  initMarketChart();
  assert.equal($('symbol').value, 'VGT');
  saved.set('seeker.symbol.v1', 'INVALID');
  $('symbol').value = 'SPY';
  initMarketChart();
  assert.equal($('symbol').value, 'SPY');
  blocked = true;
  assert.doesNotThrow(() => initMarketChart());
  $('symbol').value = 'QQQ';
  assert.doesNotThrow(() => $('symbol').listeners.change());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal($('symbol').value, 'QQQ');
});

test('空指数窗口清除旧画布，保留背景和坐标绘制且不崩溃', t => {
  const oldWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { globalThis.window = oldWindow; });
  let resets = 0;
  const calls = [];
  const ctx = new Proxy({}, { get: (_, name) => name === 'measureText' ? () => ({ width: 20 }) : (...args) => calls.push([name, ...args]), set: () => true });
  const canvas = { clientWidth: 600, clientHeight: 200, set width(v) { resets++; }, getContext: () => ctx };
  drawSentiment(canvas, { visible: [{ date: '2020-06-05', score: 30 }], windowRange: { start: '2020-06-05', end: '2020-06-05', calendar: ['2020-06-05'], frequency: 'daily' } });
  calls.length = 0;
  const result = drawSentiment(canvas, { visible: [], windowRange: { start: '2020-06-06', end: '2020-07-08', calendar: ['2020-06-08', '2020-07-08'], frequency: 'daily' } });
  assert.equal(result, null);
  assert.equal(resets, 2);
  assert.ok(calls.some(([name]) => name === 'fillRect'));
});

test('历史指数修正和等长日历坐标变更重绘信号，行情失败清除明细', t => {
  const $ = dom(t);
  setSignalSentiment([{ date: '2025-01-02', score: 20 }, { date: '2025-01-03', score: 9 }]);
  updateSignals(data, settings);
  drawSignalMarkers(frame);
  const oldLayout = $('signal-layer').dataset.layout;
  const oldMarker = $('signal-layer').children.at(-1);
  setSignalSentiment([{ date: '2025-01-02', score: 20 }, { date: '2025-01-03', score: 8 }]);
  updateSignals(data, settings);
  drawSignalMarkers(frame);
  assert.notEqual($('signal-layer').dataset.layout, oldLayout);
  assert.notEqual($('signal-layer').children.at(-1), oldMarker);
  const marker = $('signal-layer').children.at(-1);
  drawSignalMarkers({ ...frame, x: date => frame.x(date) + 10 });
  assert.notEqual($('signal-layer').children.at(-1), marker);
  assert.ok($('signal-table').children.length > 0);
  updateSignals(null, null);
  for (const id of ['signal-layer', 'signal-table']) assert.equal($(id).children.length, 0);
  for (const id of ['signal-note', 'signal-total']) assert.equal($(id).textContent, '');
  assert.equal($('signal-layer').dataset.layout, '');
});

test('恐慌阈值 input 即时生效，无需失焦', t => {
  const $ = dom(t);
  const oldStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  t.after(() => { globalThis.localStorage = oldStorage; });
  initStrategyOverlay();
  assert.equal(Number($('base-amount').value), 2000);
  assert.equal(Number($('fear-buy-count').value), 3);
  assert.equal(signalSettings().baseAmount, 2000);
  assert.equal(signalSettings().fearBuyCount, 3);
  $('fear-threshold').value = '12';
  $('fear-threshold').listeners.input();
  assert.equal(signalSettings().fearThreshold, 12);
});

test('每张图的查看原图只打开对应标签页，保留策略弹窗', t => {
  const $ = dom(t);
  const oldWindow = globalThis.window;
  const opened = [];
  globalThis.window = { open: (...args) => opened.push(args) };
  t.after(() => { globalThis.window = oldWindow; });
  const buttons = ['monthly_dca_logic.svg', 'fear_dca_logic.svg'].map(name => Object.assign(element(), { dataset: { image: name } }));
  $('strategy-dialog').querySelectorAll = selector => {
    assert.equal(selector, '.strategy-diagram-original');
    return buttons;
  };
  initStrategyDialog();
  buttons[0].listeners.click();
  assert.equal(opened.length, 1);
  buttons[1].listeners.click();
  assert.equal(opened.length, 2);
  assert.deepEqual(opened, buttons.map(button => {
    const viewer = new URL('../public/diagram.html', import.meta.url);
    viewer.searchParams.set('image', button.dataset.image);
    return [viewer.href, '_blank', 'noopener,noreferrer'];
  }));
  assert.equal($('strategy-dialog').open, true);
});

test('QQQ 首次加载及强制刷新均派发最新交易日历', async t => {
  const $ = dom(t);
  $('symbol').value = 'QQQ';
  let dates;
  const listener = e => { dates = e.detail; };
  appEvents.addEventListener(events.marketCalendar, listener);
  t.after(() => appEvents.removeEventListener(events.marketCalendar, listener));
  let snapshot = data;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => snapshot }));
  await loadMarket();
  assert.deepEqual(dates, rows.map(r => r.date));
  snapshot = { ...data, rows: [...rows, { ...rows[0], date: '2025-01-07' }] };
  await invalidateMarket();
  assert.equal(dates.at(-1), '2025-01-07');
});

test('行情刷新后旧的主图请求不能回写缓存', async t => {
  const $ = dom(t);
  $('symbol').value = 'QQQ';
  renderMarket(null);
  let resolveOld;
  let calls = 0;
  const fresh = { ...data, rows: [...rows, { ...rows[0], date: '2025-02-03' }] };
  t.mock.method(globalThis, 'fetch', () => {
    if (++calls === 1) return new Promise(resolve => { resolveOld = resolve; });
    return Promise.resolve({ ok: true, json: async () => fresh });
  });
  let dates;
  const listener = event => { dates = event.detail; };
  appEvents.addEventListener(events.marketCalendar, listener);
  t.after(() => appEvents.removeEventListener(events.marketCalendar, listener));
  const oldRequest = loadMarket(true);
  await invalidateMarket();
  resolveOld({ ok: true, json: async () => ({ ...data, rows: [...rows] }) });
  await oldRequest;
  await loadMarket();
  assert.equal(calls, 2);
  assert.equal(dates.at(-1), '2025-02-03');
});

test('组合使用完整复盘前行情，刷新时丢弃旧请求并等待新快照', async t => {
  const $ = dom(t);
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { globalThis.localStorage = oldStorage; globalThis.ResizeObserver = oldResize; });
  $('symbol').options = [{ value: 'QQQ', textContent: 'QQQ' }, { value: 'SPY', textContent: 'SPY' }];
  $('symbol').value = 'QQQ';
  const freshRows = [...rows, { ...rows[0], date: '2025-02-03' }];
  let spyRequests = [];
  t.mock.method(globalThis, 'fetch', url => {
    if (url.includes('spy.json')) return new Promise((resolve, reject) => spyRequests.push({ resolve, reject }));
    return Promise.resolve({ ok: true, json: async () => ({ ...data, rows: [...freshRows] }) });
  });
  initStrategyOverlay();
  setSignalSentiment([{ date: '2025-01-02', score: 20 }]);
  updateSignals(data, settings);
  updateSignals({ ...data, rows: rows.slice(0, 1) }, { ...settings, end: rows[0].date, replay: true });
  $('allocation-open').listeners.click();
  const qqqWeight = $('allocation-list').children[0].children[1].children[0];
  const spyWeight = $('allocation-list').children[1].children[1].children[0];
  qqqWeight.value = '50';
  qqqWeight.listeners.input();
  assert.match($('allocation-backtest-period').textContent, /2025-01-06/);
  spyWeight.value = '50';
  spyWeight.listeners.input();
  assert.equal(spyRequests.length, 1);
  assert.equal($('allocation-estimate-average').textContent, '正在测算…');

  renderMarket(null);
  await invalidateMarket();
  updateSignals({ ...data, rows: freshRows }, settings);
  spyWeight.listeners.input();
  assert.equal(spyRequests.length, 2);
  spyRequests[0].resolve({ ok: true, json: async () => ({ ...data, symbol: 'SPY', rows: [...rows] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal($('allocation-estimate-average').textContent, '正在测算…');
  spyRequests[1].resolve({ ok: true, json: async () => ({ ...data, symbol: 'SPY', rows: [...freshRows] }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match($('allocation-backtest-period').textContent, /2025-02-03/);
  assert.match($('allocation-estimate-note').textContent, /2025-01 — 2025-02/);

  // 已缓存的非当前标的也要重新读取；旧失败不能覆盖再次刷新后的在途状态。
  await invalidateMarket();
  assert.equal(spyRequests.length, 3);
  assert.equal($('allocation-estimate-average').textContent, '正在测算…');
  await invalidateMarket();
  assert.equal(spyRequests.length, 4);
  spyRequests[2].reject(Error('old request failed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal($('allocation-estimate-average').textContent, '正在测算…');
  const newerRows = [...freshRows, { ...rows[0], date: '2025-04-03' }];
  spyRequests[3].resolve({ ok: true, json: async () => ({ ...data, symbol: 'SPY', rows: newerRows }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.match($('allocation-backtest-period').textContent, /2025-04-03/);
});

test('K 线图与回测曲线图右下角对数切换按钮各自生效并记住偏好', t => {
  const $ = dom(t);
  const saved = new Map();
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  const oldDPR = globalThis.devicePixelRatio;
  globalThis.localStorage = {
    getItem: k => saved.get(k) ?? null,
    setItem: (k, v) => saved.set(k, v)
  };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.devicePixelRatio = 1;
  t.after(() => {
    globalThis.localStorage = oldStorage;
    globalThis.ResizeObserver = oldResize;
    globalThis.devicePixelRatio = oldDPR;
  });

  $('symbol').options = [{ value: 'QQQ' }];
  $('symbol').value = 'QQQ';
  $('price-chart').getContext = () => new Proxy({}, {
    get: (_, name) => name === 'measureText' ? () => ({ width: 20 }) : () => {},
    set: () => true
  });

  initStrategyOverlay();
  initMarketChart();
  updateSignals(data, settings);

  assert.equal($('price-scale-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal($('backtest-scale-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal($('backtest-plot').dataset.scale, 'linear');

  $('price-scale-toggle').listeners.click();
  assert.equal($('price-scale-toggle').getAttribute('aria-pressed'), 'false');
  assert.equal(saved.get('seeker.priceScale.v1'), 'linear');

  $('backtest-scale-toggle').listeners.click();
  assert.equal($('backtest-scale-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(saved.get('seeker.backtestScale.v1'), 'log');
  assert.equal($('backtest-plot').dataset.scale, 'log');
  assert.equal($('backtest-tab-equity').getAttribute('aria-selected'), 'true');
  assert.equal($('backtest-tab-profit').getAttribute('aria-selected'), 'false');
  assert.equal($('backtest-principal-legend').hidden, false);
  assert.equal($('backtest-plot').children.filter(c => c.tag === 'path').length, 6);

  $('backtest-tab-profit').listeners.click();
  assert.equal($('backtest-tab-equity').getAttribute('aria-selected'), 'false');
  assert.equal($('backtest-tab-profit').getAttribute('aria-selected'), 'true');
  assert.equal(saved.get('seeker.backtestSeries.v1'), 'profit');
  assert.equal($('backtest-principal-legend').hidden, true);
  assert.equal($('backtest-plot').children.filter(c => c.tag === 'path').length, 5);

  $('backtest-tab-equity').listeners.click();
  $('backtest-mode').value = 'actual';
  $('backtest-mode').listeners.change();
  assert.equal($('backtest-principal-legend').hidden, true);
  assert.equal($('backtest-plot').children.filter(c => c.tag === 'path').length, 5);
  assert.ok($('backtest-plot').children.some(c => c.tag === 'text' && c.textContent === '0'));

  updateSignals(data, { ...settings, frequency: 'monthly' });
  const firstPath = $('backtest-plot').children.find(c => c.tag === 'path').getAttribute('d');
  const xs = firstPath.split(' ').map(part => Number(part.slice(1).split(',')[0]));
  assert.ok(xs.every((x, i) => !i || x > xs[i - 1]));
});


test('复盘从起始日左端逐日展开主图 K 线，回看同步且重置恢复原区间', async t => {
  const $ = dom(t);
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  const oldDPR = globalThis.devicePixelRatio;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.ResizeObserver = class { observe() {} };
  globalThis.devicePixelRatio = 1;
  t.after(() => {
    globalThis.localStorage = oldStorage;
    globalThis.ResizeObserver = oldResize;
    globalThis.devicePixelRatio = oldDPR;
  });
  let tick;
  t.mock.method(globalThis, 'setInterval', callback => { tick = callback; return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  $('symbol').options = [{ value: 'QQQ' }];
  $('symbol').value = 'QQQ';
  $('price-chart').getContext = () => new Proxy({}, {
    get: (_, name) => name === 'measureText' ? () => ({ width: 20 }) : () => {},
    set: () => true
  });
  const snapshot = { ...data, anchorDate: rows.at(-1).date, rows: rows.map(row => ({ ...row, volume: null })) };
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => snapshot }));
  initStrategyOverlay();
  initMarketChart();
  renderMarket(null);
  await loadMarket(true);
  renderMarket({ ...settings, start: '2025-01-03', end: '2025-01-03', calendar: ['2025-01-03'], frequency: 'monthly' });
  assert.equal($('price-observations').textContent, '1 根 K 线');
  t.mock.method(Math, 'random', () => 0);
  $('backtest-replay-random').listeners.click();
  assert.equal($('backtest-replay-start').value, '2025-01-02');
  assert.equal($('backtest-replay-start').min, '2025-01-02');
  assert.equal($('backtest-replay-start').max, '2025-01-06');
  $('backtest-replay-play').listeners.click();
  assert.equal($('price-change').textContent, '2025-01-02');
  assert.equal($('price-observations').textContent, '1 根 K 线');
  tick();
  assert.equal($('price-observations').textContent, '2 根 K 线');
  tick();
  assert.equal($('price-observations').textContent, '3 根 K 线');
  assert.match($('price-change').textContent, /2025-01-06/);
  $('backtest-replay-reset').listeners.click();
  assert.equal($('date-range').textContent, '2025-01-03 – 2025-01-03');
  renderMarket({ ...settings, frequency: 'monthly' });
  $('backtest-replay-start').value = '2025-01-03';
  $('backtest-replay-start').listeners.change();
  $('backtest-replay-play').listeners.click();
  assert.equal($('price-observations').textContent, '1 根 K 线');
  assert.equal($('price-change').textContent, '2025-01-03');
  assert.equal($('price-title').textContent, 'QQQ · 日线复盘');
  assert.match($('price-asof').textContent, /^复盘至 2025-01-03(?: · |$)/);
  assert.equal($('backtest-replay-start').value, '2025-01-03');
  const firstX = Number($('backtest-plot').children.find(node => node.tag === 'path').getAttribute('d').slice(1).split(',')[0]);
  assert.ok(firstX < 60);
  tick();
  assert.equal($('price-observations').textContent, '2 根 K 线');
  assert.match($('price-change').textContent, /2025-01-06/);
  $('backtest-plot').listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal($('price-observations').textContent, '1 根 K 线');
  assert.match($('backtest-period').textContent, /2025-01-03 — 2025-01-03/);
  $('backtest-replay-reset').listeners.click();
  assert.equal($('price-title').textContent, 'QQQ · 前复权 K 线');
  assert.equal($('price-observations').textContent, '1 根 K 线');
  assert.equal($('date-range').textContent, '2025-01-02 – 2025-01-06');
  $('backtest-replay-play').listeners.click();
  appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
  assert.equal($('price-title').textContent, 'QQQ · 前复权 K 线');
  assert.match($('backtest-period').textContent, /2025-01-02 — 2025-01-06/);
  assert.equal($('backtest-replay-start').value, '');
  $('backtest-replay-start').value = '2025-01-03';
  $('backtest-replay-start').listeners.change();
  $('backtest-replay-play').listeners.click();
  await loadMarket(true);
  assert.equal($('price-title').textContent, 'QQQ · 前复权 K 线');
  assert.match($('backtest-period').textContent, /2025-01-02 — 2025-01-06/);
  $('backtest-replay-start').value = '2025-01-03';
  $('backtest-replay-start').listeners.change();
  $('backtest-replay-play').listeners.click();
  t.mock.method(globalThis, 'fetch', async () => { throw Error('refresh failed'); });
  await loadMarket(true);
  assert.equal($('price-asof').textContent, 'refresh failed');
  assert.equal($('price-observations').textContent, '0 根 K 线');
  assert.equal($('price-close').textContent, '—');
  assert.equal($('backtest-period').textContent, '暂无可用行情，请先读取数据');
});

test('定投金额与恐慌倍数按标的独立保存在浏览器缓存，定投日与恐慌阈值全局共用，支持总金额按配比填入', t => {
  const $ = dom(t);
  const saved = new Map();
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  globalThis.localStorage = {
    getItem: k => saved.get(k) ?? null,
    setItem: (k, v) => saved.set(k, v)
  };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => {
    globalThis.localStorage = oldStorage;
    globalThis.ResizeObserver = oldResize;
  });

  $('symbol').options = [
    { value: 'SPY', textContent: 'SPY · 标普 500' },
    { value: 'QQQ', textContent: 'QQQ · 纳斯达克 100' },
    { value: 'SMH', textContent: 'SMH · 半导体 ETF' }
  ];
  $('symbol').value = 'SPY';
  $('price-chart').getContext = () => new Proxy({}, {
    get: (_, name) => name === 'measureText' ? () => ({ width: 20 }) : () => {},
    set: () => true
  });

  // 1. 兼容旧版扁平缓存
  saved.set('seeker.pyramid.v1', JSON.stringify({ buyDay: 15, baseAmount: 1500, fearThreshold: 12, fearBuyCount: 2, enabled: true }));
  initStrategyOverlay();
  assert.equal(signalSettings().buyDay, 15);
  assert.equal(signalSettings().baseAmount, 1500);
  assert.equal(signalSettings().fearThreshold, 12);
  assert.equal(signalSettings().fearBuyCount, 2);

  // 2. 在 SPY 下修改金额 N=3000、倍数=4、定投日=5、恐慌阈值=18
  $('buy-day').value = '5';
  $('buy-day').listeners.change();
  $('fear-threshold').value = '18';
  $('fear-threshold').listeners.input();
  $('base-amount').value = '3000';
  $('base-amount').listeners.input();
  $('fear-buy-count').value = '4';
  $('fear-buy-count').listeners.input();

  // 切换到未单独设置过的 QQQ：定投日(5)和阈值(18)共用，金额和倍数在 QQQ 单独设置后与 SPY 独立
  $('symbol').value = 'QQQ';
  $('symbol').listeners.change();
  $('base-amount').value = '1200';
  $('base-amount').listeners.input();
  $('fear-buy-count').value = '2';
  $('fear-buy-count').listeners.input();
  assert.equal(signalSettings().baseAmount, 1200);
  assert.equal(signalSettings().fearBuyCount, 2);
  assert.equal(signalSettings().buyDay, 5);
  assert.equal(signalSettings().fearThreshold, 18);

  // 切回 SPY：自动恢复 SPY 的 N=3000 和倍数=4
  $('symbol').value = 'SPY';
  $('symbol').listeners.change();
  assert.equal(Number($('base-amount').value), 3000);
  assert.equal(Number($('fear-buy-count').value), 4);
  assert.equal(signalSettings().baseAmount, 3000);
  assert.equal(signalSettings().fearBuyCount, 4);

  // 3. 配比自动填入：打开配比弹窗，总金额 5000，SPY 60%（3000 -> 3000）、QQQ 30%（1500），SMH 留空保持不变
  setSignalSentiment([]);
  $('allocation-dialog').showModal = () => { $('allocation-dialog').open = true; };
  $('allocation-dialog').close = () => { $('allocation-dialog').open = false; };
  updateSignals({ ...data, symbol: 'QQQ' }, settings);
  updateSignals({ ...data, symbol: 'SPY' }, settings);
  $('allocation-open').listeners.click();
  assert.equal($('allocation-list').children.length, 3);
  $('allocation-total').value = '5000';
  $('allocation-total').listeners.input();
  const spyWeightInput = $('allocation-list').children[0].children[1].children[0];
  const qqqWeightInput = $('allocation-list').children[1].children[1].children[0];
  const smhPreview = $('allocation-list').children[2].children[2];
  spyWeightInput.value = '50';
  spyWeightInput.listeners.input();
  qqqWeightInput.value = '30';
  qqqWeightInput.listeners.input();
  assert.equal($('allocation-fear-state').textContent, '等待指数数据');
  setSignalSentiment([{ date: '2025-01-02', score: 20 }, { date: '2025-01-03', score: 8 }]);
  assert.match($('allocation-fear-state').textContent, /当前 8\.00/);
  assert.match($('allocation-summary').textContent, /80%.*剩余 20% 未分配/);
  assert.equal(smhPreview.textContent, '1N = 0.00');
  // 1 月 6 日月度信号缺少下一根日线，仅恐慌买入已成交。
  assert.match($('allocation-estimate-average').textContent, /13,000\.00（2\.6N）/);
  assert.match($('allocation-estimate-peak').textContent, /13,000\.00（2\.6N）/);
  assert.equal($('allocation-estimate-annual-peak').textContent, '13,000.00（2.6N）');
  assert.match($('allocation-next-detail').textContent, /^SPY .+\nQQQ .+$/);
  assert.doesNotMatch($('allocation-next-detail').textContent, /2025-|行情截至/);
  assert.match($('allocation-fear-state').textContent, /等待回升至 23/);
  assert.equal($('allocation-recent-signal').textContent, '2025-01-06 · 合计 8,000.00');
  assert.match($('allocation-recent-detail').textContent, /^SPY 5,000\.00\nQQQ 3,000\.00$/);
  assert.match($('allocation-estimate-note').textContent, /峰值月份 2025-01（SPY 10,000\.00 ＋ QQQ 3,000\.00）/);
  const pyramidPeak=$('allocation-estimate-peak').textContent;
  $('allocation-plan-kdFear').listeners.click();
  assert.match($('allocation-status-heading').textContent,/KD＋恐慌/);
  assert.equal($('allocation-estimate-peak').textContent,pyramidPeak);
  assert.match($('allocation-estimate-note').textContent,/测算方案 KD＋恐慌/);
  assert.match($('allocation-kd-funding').textContent,/另一方案（跌幅＋恐慌）/);
  assert.equal($('allocation-backtest-results').children.length,5);
  $('allocation-plan-pyramidFear').listeners.click();
  assert.equal($('allocation-estimate-peak').textContent,pyramidPeak);
  const allocationFearCount = index => $('allocation-list').children[index].children.find(child => child.className === 'allocation-fear-count').children[0];
  const spyFearCount = allocationFearCount(0);
  assert.equal(spyFearCount.value, '4');
  spyFearCount.value = '5';
  spyFearCount.listeners.input();
  assert.match($('allocation-estimate-peak').textContent, /15,500\.00（3\.1N）/);
  $('allocation-fear-threshold').value = '8';
  $('allocation-fear-threshold').listeners.input();
  assert.match($('allocation-estimate-peak').textContent, /0\.00（0N）/);
  assert.equal($('allocation-estimate-annual-peak').textContent, '0.00（0N）');
  assert.equal(signalSettings().fearThreshold, 18);
  spyFearCount.value = '4';
  $('allocation-fear-threshold').value = '18';
  $('allocation-fear-threshold').listeners.input();
  assert.equal($('allocation-backtest-wrap').hidden, false);
  assert.equal($('allocation-backtest-results').children.length, 5);
  assert.equal($('allocation-backtest-results').children[0].children.length, 14);
  assert.equal(
    $('allocation-backtest-plot').children.filter(node => node.getAttribute?.('data-strategy')).length,
    5
  );

  // QQQ 的恐慌倍数填 0，峰值由 13,000.00 降为 10,000.00；空值不能当作 0。
  const qqqFearCount = allocationFearCount(1);
  qqqFearCount.value = '';
  qqqFearCount.listeners.input();
  assert.equal($('allocation-estimate-peak').textContent, '—');
  assert.equal($('allocation-estimate-annual-peak').textContent, '—');
  assert.equal($('allocation-next-plan').textContent, '请检查组合参数');
  assert.equal($('allocation-next-detail').textContent, '');
  assert.equal($('allocation-recent-detail').textContent, '');
  $('allocation-form').listeners.submit({ preventDefault() {} });
  assert.match($('allocation-message').textContent, /恐慌加投倍数/);
  qqqFearCount.value = '0';
  qqqFearCount.listeners.input();
  assert.match($('allocation-estimate-peak').textContent, /10,000\.00（2N）/);
  assert.match($('allocation-estimate-note').textContent, /峰值月份 2025-01（SPY 10,000\.00）/);

  assert.equal($('allocation-backtest-plot').dataset.series, 'profit');
  assert.equal($('allocation-backtest-plot').dataset.scale, 'log');

  // 切换为累计资产、线性坐标及各自按规则投入
  $('allocation-backtest-mode').value = 'actual';
  $('allocation-backtest-mode').listeners.change();
  assert.equal($('allocation-principal-legend').hidden, true);
  $('allocation-tab-equity').listeners.click();
  assert.equal($('allocation-backtest-plot').dataset.series, 'equity');
  $('allocation-scale-toggle').listeners.click();
  assert.equal($('allocation-backtest-plot').dataset.scale, 'linear');

  // 输入正倍数重新启用
  qqqFearCount.value = '2';
  qqqFearCount.listeners.input();
  assert.match($('allocation-estimate-peak').textContent, /13,000\.00（2\.6N）/);
  assert.match($('allocation-next-detail').textContent, /^SPY .+\nQQQ .+$/);
  assert.doesNotMatch($('allocation-next-detail').textContent, /2025-|行情截至/);
  assert.match($('allocation-fear-state').textContent, /等待回升至 23/);
  assert.equal($('allocation-recent-signal').textContent, '2025-01-06 · 合计 8,000.00');
  assert.match($('allocation-recent-detail').textContent, /^SPY 5,000\.00\nQQQ 3,000\.00$/);

  $('allocation-form').listeners.submit({ preventDefault() {} });
  // SPY 当前激活，立即更新为 5000 * 50% = 2500，且 SPY 原有的恐慌倍数 4 保留
  assert.equal(Number($('base-amount').value), 2500);
  assert.equal(signalSettings().baseAmount, 2500);
  assert.equal(signalSettings().fearBuyCount, 4);

  // 切换到 QQQ：金额已按 5000 * 30% = 1500 填入，QQQ 原有的恐慌倍数 2 保留
  $('symbol').value = 'QQQ';
  $('symbol').listeners.change();
  assert.equal(Number($('base-amount').value), 1500);
  assert.equal(signalSettings().baseAmount, 1500);
  assert.equal(signalSettings().fearBuyCount, 2);

  // 切换到配比为 0% 的 SMH：金额按 1N = 0 填入，恐慌倍数保持初始默认值 2
  // 若在 QQQ 输入非法阈值未通过校验后切换到 SMH，全局输入框自动恢复合法值 18
  $('fear-threshold').value = '99';
  $('fear-threshold').listeners.input();
  assert.match($('signal-error').textContent, /阈值/);
  $('symbol').value = 'SMH';
  $('symbol').listeners.change();
  assert.equal($('signal-error').textContent, '');
  assert.equal(Number($('fear-threshold').value), 18);
  assert.equal(Number($('base-amount').value), 0);
  assert.equal(signalSettings().baseAmount, 0);
  updateSignals({ ...data, symbol: 'SMH' }, settings);
  assert.equal($('signal-note').textContent, '当前标的 1N = 0.00，不生成买入信号');
  assert.equal($('funding-total').textContent, '0.00（0N）');
  assert.equal($('backtest-results').children.length, 5);
  assert.equal(signalSettings().fearBuyCount, 2);

  // 4. 刷新页面后从 localStorage 恢复最后选中的 QQQ 及各标的独立配置
  saved.set('seeker.symbol.v1', 'QQQ');
  $('symbol').value = 'SPY';
  initStrategyOverlay();
  assert.equal(Number($('base-amount').value), 1500);
  assert.equal(Number($('fear-buy-count').value), 2);
  assert.equal(Number($('buy-day').value), 5);
  assert.equal(Number($('fear-threshold').value), 18);

  // 5. 在配比界面关闭 QQQ 的恐慌加投并提交，主界面 QQQ 的恐慌加投显示为未启用（0），但原倍数 2 仍保留可恢复
  $('allocation-open').listeners.click();
  const qqqCountAfterReload = allocationFearCount(1);
  qqqCountAfterReload.value = '0';
  qqqCountAfterReload.listeners.input();
  $('allocation-form').listeners.submit({ preventDefault() {} });
  $('symbol').value = 'QQQ';
  $('symbol').listeners.change();
  assert.equal(signalSettings().fearEnabled, false);
  assert.equal(signalSettings().fearBuyCount, 2);
  assert.equal(Number($('fear-buy-count').value), 0);
  updateSignals({ ...data, symbol: 'QQQ' }, settings);
  assert.equal($('fear-state').textContent, '未启用恐慌加投');
  assert.match($('signal-note').textContent, /未启用恐慌加投/);

  // 已停用的旧设置显示为 0；批量应用支持 0 和正数，取消草稿不写入。
  $('allocation-open').listeners.click();
  assert.equal(allocationFearCount(1).value, '0');
  const savedBeforeDraft = saved.get('seeker.pyramid.v1');
  $('allocation-buy-day').value = '25';
  $('allocation-buy-day').listeners.input();
  $('allocation-fear-threshold').value = '10';
  $('allocation-fear-threshold').listeners.input();
  $('allocation-bulk-fear-count').value = '';
  $('allocation-apply-fear-count').listeners.click();
  assert.match($('allocation-message').textContent, /不小于 0/);
  $('allocation-bulk-fear-count').value = '0';
  $('allocation-apply-fear-count').listeners.click();
  assert.equal(allocationFearCount(0).value, '0');
  assert.equal(allocationFearCount(1).value, '0');
  $('allocation-bulk-fear-count').value = '5';
  $('allocation-apply-fear-count').listeners.click();
  assert.equal(allocationFearCount(0).value, '5');
  assert.equal(allocationFearCount(1).value, '5');
  assert.equal(saved.get('seeker.pyramid.v1'), savedBeforeDraft);
  $('allocation-cancel').listeners.click();
  $('allocation-open').listeners.click();
  assert.equal($('allocation-buy-day').value, '5');
  assert.equal($('allocation-fear-threshold').value, '18');
  assert.equal(allocationFearCount(0).value, '4');
  assert.equal(allocationFearCount(1).value, '0');
  $('allocation-buy-day').value = '32';
  $('allocation-form').listeners.submit({ preventDefault() {} });
  assert.match($('allocation-message').textContent, /定投日/);
  assert.equal(saved.get('seeker.pyramid.v1'), savedBeforeDraft);
  $('allocation-buy-day').value = '25';
  $('allocation-fear-threshold').value = '10';
  $('allocation-bulk-fear-count').value = '5';
  $('allocation-apply-fear-count').listeners.click();
  $('allocation-form').listeners.submit({ preventDefault() {} });
  assert.equal(Number($('buy-day').value), 25);
  assert.equal(Number($('fear-threshold').value), 10);
  assert.equal(signalSettings().fearBuyCount, 5);
  $('symbol').value = 'SPY';
  $('symbol').listeners.change();
  assert.equal(signalSettings().fearBuyCount, 5);
  const stored = JSON.parse(saved.get('seeker.pyramid.v1'));
  assert.equal(stored.bySymbol.QQQ.fearBuyCount, 5);
  assert.equal(stored.bySymbol.QQQ.fearEnabled, true);

  // 1 月计划顺延，与 2 月计划落在同一天，按标的汇总两笔。
  const sparseRows = ['2025-01-30', '2025-02-28'].map(date => ({
    date, open: 100, high: 100, low: 100, close: 100
  }));
  updateSignals({ ...data, symbol: 'SPY', rows: sparseRows }, settings);
  $('allocation-open').listeners.click();
  $('allocation-buy-day').value = '31';
  $('allocation-buy-day').listeners.input();
  assert.equal($('allocation-recent-signal').textContent, '2025-02-28 · 合计 5,000.00');
  assert.equal($('allocation-recent-detail').textContent, 'SPY 5,000.00');
  $('allocation-plan-kdFear').listeners.click();
  $('allocation-form').listeners.submit({preventDefault(){}});
  assert.equal(JSON.parse(saved.get('seeker.pyramid.v1')).allocation.plan,'kdFear');
  $('allocation-open').listeners.click();
  assert.equal($('allocation-plan-kdFear').getAttribute('aria-pressed'), 'true');
  assert.equal($('allocation-plan-pyramidFear').getAttribute('aria-pressed'), 'false');
  $('allocation-plan-pyramidFear').listeners.click();
  $('allocation-cancel').listeners.click();
  $('allocation-open').listeners.click();
  assert.equal($('allocation-plan-kdFear').getAttribute('aria-pressed'), 'true');
});

test('KD行情失效时清空旧指标、明细及曲线，并禁止导出旧结果',async t=>{
  const $=dom(t),{renderKDReview}=await import('../public/js/features/strategy/kd.mjs');
  for(const id of ['kd-latest','kd-largest','kd-spent','kd-ratio','kd-components','kd-note'])$(id).textContent='旧结果';
  $('kd-orders').append(element());$('kd-plot').append(element());$('kd-download').disabled=false;
  renderKDReview(null,null);
  for(const id of ['kd-latest','kd-largest','kd-spent','kd-ratio'])assert.equal($(id).textContent,'—');
  assert.equal($('kd-orders').children.length,0);assert.equal($('kd-plot').children.length,0);assert.equal($('kd-download').disabled,true);assert.equal($('kd-status').textContent,'等待行情');
});

test('KD旧默认值迁移80/20及1.5，保留自定义，输入校验及重置恢复新默认',async t=>{
 const $=dom(t),{initKDControls,getKDOptions}=await import('../public/js/features/strategy/kd.mjs');
 const previous=globalThis.localStorage;let saved=JSON.stringify({monthWeight:40,quarterWeight:60,period:9,signal:3});
 globalThis.localStorage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
 t.after(()=>{globalThis.localStorage=previous;});
 initKDControls();assert.equal(getKDOptions().tierFactor,1.5);assert.equal(Number($('kd-month-weight').value),80);assert.equal(Number($('kd-quarter-weight').value),20);
 saved=JSON.stringify({monthWeight:70,quarterWeight:30,period:9,signal:3,tierFactor:2});initKDControls();assert.equal(getKDOptions().monthWeight,70);assert.equal(getKDOptions().tierFactor,2);
 for(const id of ['kd-month-weight','kd-period','kd-signal'])$(id).value=String($(id).value);
 $('kd-tier-factor').value='1.5';$('kd-tier-factor').listeners.input();
 assert.equal(getKDOptions().tierFactor,1.5);assert.equal(JSON.parse(saved).tierFactor,1.5);
 assert.equal($('main-kd-tier-factor').value,'1.5');
 assert.equal($('kd-tier-row').children[3].textContent,'2.3N');assert.match($('kd-risk').textContent,/38.4N/);
 for(const value of ['','0.9','3.1','NaN']){$('kd-tier-factor').value=value;$('kd-tier-factor').listeners.input();assert.equal(getKDOptions().tierFactor,1.5);assert.match($('kd-error').textContent,/上一次有效参数/);}
 $('kd-period').value='';$('kd-period').listeners.input();
 $('main-kd-tier-factor').value='1.3';$('main-kd-tier-factor').listeners.input();
 assert.equal($('kd-tier-factor').value,'1.3');assert.equal(JSON.parse(saved).tierFactor,1.3);
 assert.equal($('kd-period').value,'');assert.equal(getKDOptions().period,9);
 assert.equal($('kd-error').textContent,'');assert.match($('kd-parameter-error').textContent,/上一次有效参数/);
 $('main-kd-tier-factor').value='3.1';$('main-kd-tier-factor').listeners.input();
 assert.equal($('kd-tier-factor').value,'1.3');assert.match($('main-kd-factor-error').textContent,/上一次有效参数/);
 initKDControls();assert.equal($('main-kd-tier-factor').value,'1.3');assert.equal($('kd-tier-factor').value,'1.3');
 $('kd-month-weight').value='40';$('kd-month-weight').listeners.input();
 $('main-kd-tier-factor').value='2';$('main-kd-tier-factor').listeners.input();
 initKDControls();
 assert.deepEqual(getKDOptions(),{monthWeight:40,quarterWeight:60,period:9,signal:3,tierFactor:2});
 assert.equal($('main-kd-tier-factor').value,'2');assert.equal($('kd-tier-factor').value,'2');
 $('kd-reset').listeners.click();assert.deepEqual(getKDOptions(),{monthWeight:80,quarterWeight:20,period:9,signal:3,tierFactor:1.5});assert.equal($('kd-tier-row').children[10].textContent,'38.4N');assert.equal($('kd-error').textContent,'');assert.equal(JSON.parse(saved).tierFactor,1.5);
 assert.equal($('main-kd-tier-factor').value,'1.5');assert.equal($('kd-tier-factor').value,'1.5');
});

test('组合 KD 系数草稿同时用于计划和回测，关闭后放弃、确认后同步保存', async t => {
  const $ = dom(t);
  const { initKDControls } = await import('../public/js/features/strategy/kd.mjs');
  const saved = new Map();
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  globalThis.localStorage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value) };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { globalThis.localStorage = oldStorage; globalThis.ResizeObserver = oldResize; });
  $('symbol').options = [{ value: 'QQQ', textContent: 'QQQ' }];
  $('symbol').value = 'QQQ';
  $('price-chart').getContext = () => new Proxy({}, {
    get: (_, name) => name === 'measureText' ? () => ({ width: 20 }) : () => {},
    set: () => true
  });
  $('allocation-dialog').showModal = () => { $('allocation-dialog').open = true; };
  $('allocation-dialog').close = () => { $('allocation-dialog').open = false; };
  initKDControls();
  initStrategyOverlay();

  const history = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07', '2025-01-10']
    .map(date => ({ date, open: 100, high: 110, low: 90, close: 100 }));
  const range = { ...settings, end: history.at(-1).date, calendar: history.map(row => row.date) };
  setSignalSentiment([{ date: history[0].date, score: 50 }]);
  updateSignals({ ...data, rows: history }, range);
  $('allocation-open').listeners.click();
  const weight = $('allocation-list').children[0].children[1].children[0];
  weight.value = '100';
  weight.listeners.input();
  $('allocation-plan-kdFear').listeners.click();
  $('allocation-buy-day').value = '6';
  $('allocation-buy-day').listeners.input();
  const factor = $('allocation-kd-tier-factor');
  const editFactor = value => { factor.value = value; factor.listeners.input(); };
  const submit = () => $('allocation-form').listeners.submit({ preventDefault() {} });
  editFactor('1');
  assert.match($('allocation-next-plan').textContent, /2,000\.00/);
  assert.match($('allocation-estimate-peak').textContent, /2,000\.00/);
  editFactor('2');
  assert.match($('allocation-next-plan').textContent, /32,000\.00/);
  assert.match($('allocation-estimate-peak').textContent, /32,000\.00/);
  assert.equal($('main-kd-tier-factor').value, '1.5');
  editFactor('');
  assert.match($('allocation-estimate-peak').textContent, /32,000\.00/);
  submit();
  assert.equal($('allocation-dialog').open, true);
  assert.match($('allocation-kd-factor-error').textContent, /上一次有效系数/);
  editFactor('3');
  $('allocation-cancel').listeners.click();
  assert.equal(saved.has('seeker.kd.v1'), false);
  $('allocation-open').listeners.click();
  assert.equal(factor.value, '1.5');
  editFactor('1.3');
  submit();
  assert.equal($('allocation-dialog').open, false);
  assert.equal($('main-kd-tier-factor').value, '1.3');
  assert.equal($('kd-tier-factor').value, '1.3');
  assert.equal(JSON.parse(saved.get('seeker.kd.v1')).tierFactor, 1.3);
});

test('策略说明在三个页签间切换，KD 十档金额和示例同步当前参数',async t=>{
 const $=dom(t),{initKDControls}=await import('../public/js/features/strategy/kd.mjs');
 const previous=globalThis.localStorage;globalThis.localStorage={getItem:()=>null,setItem(){}};t.after(()=>{globalThis.localStorage=previous;});
 initKDControls();
 initStrategyOverlay();
 $('base-amount').value='1000';
 $('base-amount').listeners.input();
 $('strategy-dialog').querySelectorAll=()=>[];
 const names = ['pyramid', 'kd', 'fear'];
 const tabs = names.map(name => $('strategy-tab-' + name));
 const panels = names.map(name => $('strategy-' + name + '-panel'));
 let focused;
 tabs.forEach((tab, index) => { tab.focus = () => { focused = index; }; });
 const assertSelected = selected => {
   assert.deepEqual(panels.map(panel => panel.hidden), names.map((_, i) => i !== selected));
   assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-selected')), names.map((_, i) => String(i === selected)));
   assert.deepEqual(tabs.map(tab => tab.getAttribute('tabindex')), names.map((_, i) => i === selected ? '0' : '-1'));
 };
 const press = (from, key, to) => {
   tabs[from].listeners.keydown({key, preventDefault() {}});
   assert.equal(focused, to);
   assertSelected(to);
 };
 initStrategyDialog();
 assertSelected(0);
 assert.match($('strategy-pyramid-parameters').textContent, /每月 \d+ 日 · N = \$1,000\.00/);
 $('base-amount').value='0.001';
 $('base-amount').listeners.input();
 tabs[1].listeners.click();
 assertSelected(1);
 assert.match($('strategy-kd-parameters').textContent,/月K 80% · 季度K 20%.*N = \$1,000\.00/);
 assert.equal($('strategy-kd-tiers').children.length,10);
 assert.equal($('strategy-kd-tiers').children[1].children[2].textContent,'1.5N');
 assert.equal($('strategy-kd-tiers').children[9].children[3].textContent,'$38,400.00');
 assert.match($('strategy-kd-example').textContent,/加权K=44.*7.6N.*7,600.00/);
 $('kd-tier-factor').value='3';$('kd-tier-factor').listeners.input();
 assert.equal($('strategy-kd-tiers').children[9].children[2].textContent,'19,683N');
 press(1, 'Home', 0);
 press(0, 'End', 2);
 assert.match($('strategy-fear-parameters').textContent, /阈值 \d+.*加投.*N = \$1,000\.00/);
 $('base-amount').value='50';
 $('fear-buy-count').value='0';
 $('fear-buy-count').listeners.input();
 assert.match($('strategy-fear-parameters').textContent, /加投 0 倍（已停用） · N = \$50\.00/);
 press(2, 'ArrowRight', 0);
 press(0, 'ArrowLeft', 2);
 press(2, 'ArrowLeft', 1);
 $('kd-reset').listeners.click();
});

test('状态只保留两种组合策略，切换和刷新恢复选择',async t=>{
 const $=dom(t),oldStorage=globalThis.localStorage,oldResize=globalThis.ResizeObserver,saved=new Map();
 globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value))};globalThis.ResizeObserver=class{observe(){}};
 t.after(()=>{globalThis.localStorage=oldStorage;globalThis.ResizeObserver=oldResize;});
 $('symbol').value='QQQ';$('symbol').options=[{value:'QQQ',textContent:'QQQ'}];
 $('price-chart').getContext=()=>new Proxy({},{get:(_,name)=>name==='measureText'?()=>({width:20}):()=>{},set:()=>true});
 initStrategyOverlay();const daily=['2024-01-02','2024-01-05','2024-02-01','2024-02-02','2024-03-01','2024-03-04'].map((date,i)=>({date,open:100-i*5,high:105-i*5,low:90-i*5,close:100-i*5}));
 const range={start:daily[0].date,end:daily.at(-1).date,calendar:daily.map(r=>r.date),frequency:'daily',replay:true};updateSignals({symbol:'QQQ',rows:daily},range);
 const backtest=$('backtest-results').children,period=$('backtest-period').textContent;
 for(const strategy of ['combined','kdFear']){
   $('status-strategy-'+strategy).listeners.click();assert.equal(getSignalStrategy(),strategy);
   assert.equal($('status-strategy-'+strategy).getAttribute('aria-pressed'),'true');
   assert.equal($('backtest-results').children,backtest);assert.equal($('backtest-period').textContent,period);
   const visible=getVisibleSignals();assert.ok(visible.every(s=>s.date<=range.end));
   if(strategy==='kdFear'){assert.match($('funding-split').textContent,/KD额外投入/);assert.match($('signal-strategy-rule').textContent,/KD按已收盘周线.*恐慌信号独立加投/);}
   drawSignalMarkers({...frame,x:date=>daily.findIndex(r=>r.date===date)*70,y:()=>90});assert.equal($('signal-layer').children.length,visible.length);
 }
 initStrategyOverlay();assert.equal(getSignalStrategy(),'kdFear');
 saved.set('seeker.strategyView.v1','kd');initStrategyOverlay();assert.equal(getSignalStrategy(),'kdFear');
 saved.set('seeker.strategyView.v1','regular');initStrategyOverlay();assert.equal(getSignalStrategy(),'combined');
 saved.set('seeker.strategyView.v1','invalid');initStrategyOverlay();assert.equal(getSignalStrategy(),'combined');
});
