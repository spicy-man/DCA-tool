import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSentiment } from '../public/js/charts/sentiment.mjs';
import { setSignalSentiment, updateSignals, drawSignalMarkers, initStrategyOverlay, signalSettings } from '../public/js/features/strategy/overlay.mjs';
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
  const scroll = element();
  $('strategy-dialog').querySelector = () => scroll;
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
  assert.equal($('backtest-plot').children.filter(c => c.tag === 'path').length, 4);

  $('backtest-tab-profit').listeners.click();
  assert.equal($('backtest-tab-equity').getAttribute('aria-selected'), 'false');
  assert.equal($('backtest-tab-profit').getAttribute('aria-selected'), 'true');
  assert.equal(saved.get('seeker.backtestSeries.v1'), 'profit');
  assert.equal($('backtest-principal-legend').hidden, true);
  assert.equal($('backtest-plot').children.filter(c => c.tag === 'path').length, 3);

  $('backtest-tab-equity').listeners.click();
  $('backtest-mode').value = 'actual';
  $('backtest-mode').listeners.change();
  assert.equal($('backtest-principal-legend').hidden, true);
  assert.equal($('backtest-plot').children.filter(c => c.tag === 'path').length, 3);
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
  assert.equal($('strategy-asof').textContent, '行情截至 2025-01-03');
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
