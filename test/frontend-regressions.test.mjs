import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSentiment } from '../public/js/charts/sentiment.mjs';
import { setSignalSentiment, updateSignals, drawSignalMarkers, initStrategyOverlay, signalSettings, getVisibleSignals, getSignalStrategy, allocateWeightedAmounts } from '../public/js/features/strategy/overlay.mjs';
import { appEvents, events } from '../public/js/services/events.mjs';
import { loadMarket, invalidateMarket, initMarketChart, renderMarket } from '../public/js/features/market/chart.mjs';
import { initStrategyDialog } from '../public/js/ui/strategy-dialog.mjs';

function element() {
  const attrs = {};
  return {
    textContent: '', dataset: {}, style: { setProperty() {} }, children: [], value: '', checked: true,
    listeners: {}, open: true, clientWidth: 600, clientHeight: 300,
    replaceChildren(...children) { this.children = children; },
    append(...children) { for (const child of children) { this.children = this.children.filter(existing => existing !== child); this.children.push(child); } },
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
  plot.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 280 });
  const key = value => plot.listeners.keydown({ key: value, preventDefault() {} });
  const daily = ['2025-01-02', '2025-01-03', '2025-01-06', '2025-01-07'].map((date, i) => ({ date, open: 100, close: [100, 100, 80, 90][i] }));
  const context = {
    symbol: 'QQQ', rows: daily, monthlySignals: [{ date: daily[0].date, amount: 100 }],
    fearSignals: [{ date: daily[3].date, amount: 100 }], baseAmount: 100, sentiment: [],
    range: { start: daily[0].date, end: daily.at(-1).date, calendar: daily.map(r => r.date) }
  };
  const line = () => $('backtest-plot').children.find(c => c.getAttribute('data-recovery-line') === '');
  const label = () => $('backtest-plot').children.find(c => c.getAttribute('data-recovery-label') === '')?.textContent;
  updateBacktest(context);
  assert.equal(line(), undefined);
  assert.equal($('backtest-replay-play').disabled, true);
  $('backtest-replay-random').listeners.click();
  assert.equal($('backtest-replay-start').value, '2025-01-06');
  $('backtest-replay-start').value = '2025-01-02';
  $('backtest-replay-start').listeners.change();
  assert.equal(line(), undefined);
  $('backtest-replay-play').listeners.click();
  assert.equal(interval, 250);
  $('backtest-replay-speed').value = '16';
  $('backtest-replay-speed').listeners.change();
  assert.equal(interval, 62.5);
  assert.equal(line(), undefined);
  const firstDayX = Number(plot.children.find(c => c.getAttribute('data-replay-cursor') === '').getAttribute('x1'));
  tick();
  assert.equal(line(), undefined);
  tick();
  assert.match(label(), /未修复.*3 天/);
  $('backtest-replay-play').listeners.click(); // pause keeps current progress
  assert.match(label(), /未修复.*3 天/);
  $('backtest-replay-play').listeners.click();
  tick();
  assert.match(label(), /前高修复.*4 天/);
  plot.listeners.pointermove({ clientX: firstDayX, clientY: 140 });
  assert.equal(plot.children.find(c => c.getAttribute('data-recovery-label') === '').getAttribute('visibility'), 'hidden');
  plot.listeners.pointerleave();
  assert.equal(plot.children.find(c => c.getAttribute('data-recovery-label') === '').getAttribute('visibility'), 'visible');
  plot.listeners.click({ clientX: firstDayX, clientY: 140 });
  assert.equal(line(), undefined);
  assert.equal($('backtest-replay-play').textContent, '播放');
  key('Home');
  assert.equal(line(), undefined);
  key('ArrowRight');
  assert.match($('backtest-period').textContent, /2025-01-03/);
  key('End');
  assert.match(label(), /前高修复.*4 天/);
  $('backtest-tab-profit').listeners.click();
  assert.match(label(), /未修复.*4 天/);
  $('backtest-scale-toggle').listeners.click();
  $('backtest-mode').value = 'actual';
  $('backtest-mode').listeners.change();
  assert.match(label(), /未修复.*4 天/);
  $('backtest-replay-reset').listeners.click();
  assert.equal(line(), undefined);
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
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { globalThis.localStorage = oldStorage; globalThis.ResizeObserver = oldResize; });
  $('symbol').value = 'QQQ';
  $('price-chart').getContext = () => new Proxy({}, { get: (_, name) => name === 'measureText' ? () => ({ width: 20 }) : () => {}, set: () => true });
  initStrategyOverlay();
  $('fear-buy-count').value = '3';
  $('fear-buy-count').listeners.input();
  setSignalSentiment([{ date: '2025-01-02', score: 20 }, { date: '2025-01-03', score: 9 }]);
  updateSignals(data, settings);
  drawSignalMarkers(frame);
  const oldMarker = $('signal-layer').children.at(-1);
  setSignalSentiment([{ date: '2025-01-02', score: 20 }, { date: '2025-01-03', score: 8 }]);
  updateSignals(data, settings);
  drawSignalMarkers(frame);
  assert.notEqual($('signal-layer').children.at(-1), oldMarker);
  const marker = $('signal-layer').children.at(-1);
  drawSignalMarkers({ ...frame, x: date => frame.x(date) + 10 });
  assert.notEqual($('signal-layer').children.at(-1), marker);
  assert.ok($('signal-table').children.length > 0);
  updateSignals(null, null);
  for (const id of ['signal-layer', 'signal-table']) assert.equal($(id).children.length, 0);
  for (const id of ['signal-note', 'signal-total']) assert.equal($(id).textContent, '');
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
  globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
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
  assert.equal($('backtest-principal-legend').hidden, false);

  $('backtest-tab-profit').listeners.click();
  assert.equal($('backtest-tab-profit').getAttribute('aria-selected'), 'true');
  assert.equal(saved.get('seeker.backtestSeries.v1'), 'profit');
  assert.equal($('backtest-principal-legend').hidden, true);

  $('backtest-tab-equity').listeners.click();
  $('backtest-mode').value = 'actual';
  $('backtest-mode').listeners.change();
  assert.equal($('backtest-principal-legend').hidden, true);
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
  $('backtest-replay-start').value = '2025-01-03';
  $('backtest-replay-start').listeners.change();
  $('backtest-replay-play').listeners.click();
  assert.equal($('price-observations').textContent, '1 根 K 线');
  assert.equal($('price-change').textContent, '2025-01-03');
  tick();
  assert.equal($('price-observations').textContent, '2 根 K 线');
  assert.match($('price-change').textContent, /2025-01-06/);
  $('backtest-plot').listeners.keydown({ key: 'ArrowLeft', preventDefault() {} });
  assert.equal($('price-observations').textContent, '1 根 K 线');
  $('backtest-replay-reset').listeners.click();
  assert.equal($('date-range').textContent, '2025-01-03 – 2025-01-03');

  $('backtest-replay-play').listeners.click();
  appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
  assert.equal($('backtest-replay-start').value, '');
  assert.equal($('date-range').textContent, '2025-01-03 – 2025-01-03');

  $('backtest-replay-start').value = '2025-01-03';
  $('backtest-replay-start').listeners.change();
  $('backtest-replay-play').listeners.click();
  await loadMarket(true);
  assert.equal($('backtest-replay-start').value, '');

  $('backtest-replay-start').value = '2025-01-03';
  $('backtest-replay-start').listeners.change();
  $('backtest-replay-play').listeners.click();
  t.mock.method(globalThis, 'fetch', async () => { throw Error('refresh failed'); });
  await loadMarket(true);
  assert.equal($('price-asof').textContent, 'refresh failed');
  assert.equal($('price-observations').textContent, '0 根 K 线');
  assert.equal($('price-close').textContent, '—');
});

test('定投金额与恐慌倍数按标的独立缓存，定投日与恐慌阈值全局共用并兼容旧缓存', t => {
  const $ = dom(t);
  const saved = new Map();
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { globalThis.localStorage = oldStorage; globalThis.ResizeObserver = oldResize; });

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

  saved.set('seeker.pyramid.v1', JSON.stringify({ buyDay: 15, baseAmount: 1500, fearThreshold: 12, fearBuyCount: 2, enabled: true }));
  initStrategyOverlay();
  assert.equal(signalSettings().buyDay, 15);
  assert.equal(signalSettings().baseAmount, 1500);
  assert.equal(signalSettings().fearThreshold, 12);
  assert.equal(signalSettings().fearBuyCount, 2);

  $('buy-day').value = '5'; $('buy-day').listeners.change();
  $('fear-threshold').value = '18'; $('fear-threshold').listeners.input();
  $('base-amount').value = '3000'; $('base-amount').listeners.input();
  $('fear-buy-count').value = '4'; $('fear-buy-count').listeners.input();

  $('symbol').value = 'QQQ'; $('symbol').listeners.change();
  $('base-amount').value = '1200'; $('base-amount').listeners.input();
  $('fear-buy-count').value = '2'; $('fear-buy-count').listeners.input();
  assert.equal(signalSettings().baseAmount, 1200);
  assert.equal(signalSettings().fearBuyCount, 2);
  assert.equal(signalSettings().buyDay, 5);
  assert.equal(signalSettings().fearThreshold, 18);

  // 非法阈值报错后切换标的，应恢复上次合法全局值
  $('fear-threshold').value = '99'; $('fear-threshold').listeners.input();
  assert.ok($('signal-error').textContent.length > 0);
  $('symbol').value = 'SPY'; $('symbol').listeners.change();
  assert.equal($('signal-error').textContent, '');
  assert.equal(Number($('fear-threshold').value), 18);
  assert.equal(signalSettings().baseAmount, 3000);
  assert.equal(signalSettings().fearBuyCount, 4);

  // 重载页面从缓存恢复最后选择的标的与独立参数
  saved.set('seeker.symbol.v1', 'QQQ');
  $('symbol').value = 'SPY';
  initStrategyOverlay();
  assert.equal(Number($('base-amount').value), 1200);
  assert.equal(Number($('fear-buy-count').value), 2);
  assert.equal(Number($('buy-day').value), 5);
  assert.equal(Number($('fear-threshold').value), 18);
});

test('配比弹窗支持按权重填入、草稿校验与取消隔离、0倍数停用及稀疏月顺延', t => {
  const $ = dom(t);
  const saved = new Map();
  const oldStorage = globalThis.localStorage;
  const oldResize = globalThis.ResizeObserver;
  globalThis.localStorage = { getItem: k => saved.get(k) ?? null, setItem: (k, v) => saved.set(k, v) };
  globalThis.ResizeObserver = class { observe() {} };
  t.after(() => { globalThis.localStorage = oldStorage; globalThis.ResizeObserver = oldResize; });

  $('symbol').options = [
    { value: 'SPY', textContent: 'SPY' },
    { value: 'QQQ', textContent: 'QQQ' },
    { value: 'SMH', textContent: 'SMH' }
  ];
  $('symbol').value = 'SPY';
  $('price-chart').getContext = () => new Proxy({}, {
    get: (_, name) => name === 'measureText' ? () => ({ width: 20 }) : () => {},
    set: () => true
  });
  $('allocation-dialog').showModal = () => { $('allocation-dialog').open = true; };
  $('allocation-dialog').close = () => { $('allocation-dialog').open = false; };

  initStrategyOverlay();
  $('buy-day').value = '5'; $('buy-day').listeners.change();
  $('fear-buy-count').value = '4'; $('fear-buy-count').listeners.input();
  $('symbol').value = 'QQQ'; $('symbol').listeners.change();
  $('fear-buy-count').value = '2'; $('fear-buy-count').listeners.input();
  $('symbol').value = 'SPY'; $('symbol').listeners.change();
  setSignalSentiment([{ date: '2025-01-02', score: 20 }, { date: '2025-01-03', score: 8 }]);
  updateSignals({ ...data, symbol: 'QQQ' }, settings);
  updateSignals({ ...data, symbol: 'SPY' }, settings);
  $('allocation-open').listeners.click();
  assert.equal($('allocation-list').children.length, 3);
  $('allocation-total').value = '5000';
  $('allocation-total').listeners.input();
  const weightInput = i => $('allocation-list').children[i].children[1].children[0];
  const fearInput = i => $('allocation-list').children[i].children.find(child => child.className === 'allocation-fear-count').children[0];
  weightInput(0).value = '50'; weightInput(0).listeners.input();
  weightInput(1).value = '30'; weightInput(1).listeners.input();
  assert.match($('allocation-summary').textContent, /80%.*20%/);
  assert.match($('allocation-estimate-peak').textContent, /13,000\.00/);

  // 弹窗内草稿阈值与回测控件切换不污染全局配置；空倍数阻断提交且不把空值当成 0；关闭 QQQ 恐慌加投（填 0）及 0% 配比 SMH
  $('allocation-fear-threshold').value = '8'; $('allocation-fear-threshold').listeners.input();
  assert.match($('allocation-estimate-peak').textContent, /0\.00/);
  assert.equal(signalSettings().fearThreshold, 10);
  $('allocation-fear-threshold').value = '10'; $('allocation-fear-threshold').listeners.input();
  $('allocation-backtest-mode').value = 'actual'; $('allocation-backtest-mode').listeners.change();
  assert.equal($('allocation-principal-legend').hidden, true);
  $('allocation-tab-equity').listeners.click();
  assert.equal($('allocation-backtest-plot').dataset.series, 'equity');
  $('allocation-scale-toggle').listeners.click();
  assert.equal($('allocation-backtest-plot').dataset.scale, 'linear');
  fearInput(1).value = ''; fearInput(1).listeners.input();
  assert.equal($('allocation-estimate-peak').textContent, '—');
  $('allocation-form').listeners.submit({ preventDefault() {} });
  assert.match($('allocation-message').textContent, /恐慌加投倍数/);
  fearInput(1).value = '0'; fearInput(1).listeners.input();
  assert.match($('allocation-estimate-peak').textContent, /10,000\.00/);
  $('allocation-form').listeners.submit({ preventDefault() {} });
  assert.equal(signalSettings().baseAmount, 2500);
  $('symbol').value = 'QQQ'; $('symbol').listeners.change();
  assert.equal(signalSettings().baseAmount, 1500);
  assert.equal(signalSettings().fearEnabled, false);
  assert.equal(Number($('fear-buy-count').value), 0);
  $('symbol').value = 'SMH'; $('symbol').listeners.change();
  assert.equal(signalSettings().baseAmount, 0);
  updateSignals({ ...data, symbol: 'SMH' }, settings);
  assert.match($('signal-note').textContent, /不生成买入信号/);
  assert.equal($('backtest-results').children.length, 5);

  // 取消草稿不落盘，非法定投日阻断提交；批量应用正数重新启用并支持稀疏月顺延及方案切换持久化
  $('allocation-open').listeners.click();
  const beforeDraft = saved.get('seeker.pyramid.v1');
  $('allocation-buy-day').value = '32';
  $('allocation-form').listeners.submit({ preventDefault() {} });
  assert.match($('allocation-message').textContent, /定投日/);
  assert.equal(saved.get('seeker.pyramid.v1'), beforeDraft);
  $('allocation-buy-day').value = '25'; $('allocation-buy-day').listeners.input();
  $('allocation-cancel').listeners.click();
  assert.equal(saved.get('seeker.pyramid.v1'), beforeDraft);
  $('allocation-open').listeners.click();
  assert.equal($('allocation-buy-day').value, '5');
  $('allocation-bulk-fear-count').value = '5';
  $('allocation-apply-fear-count').listeners.click();
  $('allocation-form').listeners.submit({ preventDefault() {} });
  assert.equal(signalSettings().fearBuyCount, 5);
  assert.equal(signalSettings().fearEnabled, true);

  // 1 月计划顺延，与 2 月计划落在同一天，按标的汇总两笔
  const sparseRows = ['2025-01-30', '2025-02-28'].map(date => ({ date, open: 100, high: 100, low: 100, close: 100 }));
  updateSignals({ ...data, symbol: 'SPY', rows: sparseRows }, settings);
  $('allocation-open').listeners.click();
  assert.equal($('allocation-plan-kdFear').getAttribute('aria-pressed'), 'true');
  $('allocation-plan-pyramidFear').listeners.click();
  $('allocation-buy-day').value = '31';
  $('allocation-buy-day').listeners.input();
  assert.match($('allocation-recent-signal').textContent, /2025-02-28.*5,000\.00/);
  assert.equal($('allocation-recent-detail').textContent, 'SPY 5,000.00');

  $('allocation-form').listeners.submit({ preventDefault() {} });
  $('allocation-open').listeners.click();
  assert.equal($('allocation-plan-pyramidFear').getAttribute('aria-pressed'), 'true');
  $('allocation-plan-kdFear').listeners.click();
  $('allocation-cancel').listeners.click();
  $('allocation-open').listeners.click();
  assert.equal($('allocation-plan-pyramidFear').getAttribute('aria-pressed'), 'true');
});

test('KD行情失效时清空旧指标、明细及画布，隐藏tooltip并禁止导出旧结果',async t=>{
  const $=dom(t),{renderKDReview}=await import('../public/js/features/strategy/kd.mjs');
  const calls=[];
  $('kd-plot').clientWidth=960;$('kd-plot').clientHeight=224;
  $('kd-plot').getContext=()=>new Proxy({},{get:(_,k)=>k==='measureText'?()=>({width:20}):(...a)=>calls.push([k,...a]),set:()=>true});
  $('kd-orders').append(element());$('kd-download').disabled=false;$('kd-tooltip').hidden=false;
  $('kd-latest').textContent='80.00';$('kd-rating').textContent='第 1 档';$('kd-observations').textContent='10 条记录';
  renderKDReview(null,null);
  assert.equal($('kd-orders').children.length,0);assert.equal($('kd-download').disabled,true);assert.equal($('kd-status').textContent,'等待行情');
  assert.equal($('kd-latest').textContent,'—');assert.equal($('kd-rating').textContent,'—');assert.equal($('kd-observations').textContent,'—');
  assert.equal($('kd-tooltip').hidden,true);assert.ok(calls.some(c=>c[0]==='clearRect'));
});

test('KD独立Canvas曲线与主图对齐，月K/季K细实线、加权K粗实线及悬浮tooltip与联动准线',async t=>{
 const $=dom(t),{initKDControls,getKDOptions,renderKDReview,setKDHover}=await import('../public/js/features/strategy/kd.mjs');
 const previous=globalThis.localStorage;let saved=JSON.stringify({monthWeight:40,quarterWeight:60,period:9,signal:3});
 globalThis.localStorage={getItem:()=>saved,setItem:(_key,value)=>{saved=value;}};
 t.after(()=>{globalThis.localStorage=previous;});
 initKDControls();assert.deepEqual(getKDOptions(),{monthWeight:80,quarterWeight:20,period:9,signal:3,tierFactor:1.5});assert.equal($('main-kd-tier-factor').value,'1.5');
 saved=JSON.stringify({monthWeight:70,quarterWeight:30,period:9,signal:3,tierFactor:2});initKDControls();assert.deepEqual(getKDOptions(),{monthWeight:80,quarterWeight:20,period:9,signal:3,tierFactor:2});
 assert.equal($('main-kd-tier-factor').value,'2');
 $('main-kd-tier-factor').value='1.5';$('main-kd-tier-factor').listeners.input();
 assert.equal(getKDOptions().tierFactor,1.5);assert.equal(JSON.parse(saved).tierFactor,1.5);
 assert.equal($('kd-tier-row').children[3].textContent,'2.3N');assert.match($('kd-risk').textContent,/38.4N/);
 for(const value of ['','0.9','3.1','NaN']){$('main-kd-tier-factor').value=value;$('main-kd-tier-factor').listeners.input();assert.equal(getKDOptions().tierFactor,1.5);assert.equal($('main-kd-tier-factor').getAttribute('aria-invalid'),'true');assert.match($('main-kd-factor-error').textContent,/上一次有效参数/);}
 $('main-kd-tier-factor').value='1.3';$('main-kd-tier-factor').listeners.input();
 assert.equal($('main-kd-tier-factor').getAttribute('aria-invalid'),'false');
 initKDControls();assert.equal(getKDOptions().tierFactor,1.3);assert.equal($('main-kd-tier-factor').value,'1.3');
 $('main-kd-tier-factor').value='1.5';$('main-kd-tier-factor').listeners.input();

 const plot=$('kd-plot'),tip=$('kd-tooltip'),calls=[];
 plot.clientWidth=960;plot.clientHeight=224;
 plot.getBoundingClientRect=()=>({left:0,top:0,width:960,height:224});
 plot.getContext=()=>new Proxy({},{
   get:(_,k)=>k==='measureText'?()=>({width:20}):(...a)=>calls.push([k,...a]),
   set:(target,k,v)=>{calls.push(['set',k,v]);target[k]=v;return true;}
 });
 tip.closest=()=>null;tip.offsetWidth=160;tip.offsetHeight=120;
 const kdRows=[
   ['2025-01-02',100,104,98,101],['2025-01-03',101,106,100,105],
   ['2025-01-06',105,107,101,102],['2025-01-10',102,108,99,107],
   ['2025-01-13',107,112,104,110],['2025-01-17',110,115,106,113]
 ].map(([date,open,high,low,close])=>({date,open,high,low,close}));
 const kdRange={start:'2025-01-02',end:'2025-01-17',frequency:'daily',calendar:kdRows.map(r=>r.date)};
 renderKDReview({symbol:'QQQ',baseAmount:1000,rows:kdRows,kdSignals:[],range:kdRange},{start:'2025-01-02',end:'2025-01-17',kdOrders:[],deferredKD:0});
 assert.notEqual($('kd-latest').textContent,'—');
 assert.match($('kd-rating').textContent,/第 \d 档 · /);
 assert.equal($('kd-observations').textContent,'5 条记录');
 const dashes=calls.filter(c=>c[0]==='setLineDash').map(c=>JSON.stringify(c[1]));
 const widths=calls.filter(c=>c[0]==='set'&&c[1]==='lineWidth').map(c=>c[2]);
 const curves=calls.filter(c=>c[0]==='bezierCurveTo');
 assert.ok(!dashes.includes('[5,4]'));assert.ok(dashes.includes('[]'));
 assert.equal(widths.filter(w=>w===1).length,3);assert.ok(widths.includes(2.2));
 assert.equal(curves.length,6);
 assert.ok(curves.every(([, , y1, , y2, , y3]) => [y1, y2, y3].every(v => v >= 10 - 1e-6 && v <= 192 + 1e-6)));
 assert.equal(tip.hidden,true);

 const hovered=[];
 const onKdHover=e=>hovered.push(e.detail);
 appEvents.addEventListener(events.kdHover,onKdHover);
 t.after(()=>appEvents.removeEventListener(events.kdHover,onKdHover));

 calls.length=0;
 plot.listeners.pointermove({clientX:500,clientY:100});
 assert.equal(tip.hidden,false);
 assert.match(tip.children[1].children.map(c=>c.textContent).join(' '),/加权K .*月K .*季度K .*分档倍率 .*周收盘 /);
 assert.equal(hovered.at(-1),tip.children[0].textContent);
 assert.equal(calls.filter(c=>c[0]==='arc').length,3);

 // 右侧Y轴区域外应隐藏tooltip并通知取消联动
 plot.listeners.pointermove({clientX:920,clientY:100});
 assert.equal(tip.hidden,true);
 assert.equal(hovered.at(-1),null);

 // 外部图表联动触发setKDHover（含周中沿用上周指标日）
 calls.length=0;
 setKDHover('2025-01-13');
 assert.equal(tip.hidden,false);
 assert.equal(tip.children[0].textContent,'2025-01-13');
 assert.match(tip.children[1].children.map(c=>c.textContent).join(' '),/周收盘 2025-01-10/);
 assert.equal(calls.filter(c=>c[0]==='arc').length,3);
 setKDHover('2025-01-17');
 assert.equal(tip.hidden,false);
 assert.equal(tip.children[0].textContent,'2025-01-17');
 plot.listeners.pointerleave();
 assert.equal(tip.hidden,true);
 assert.equal(hovered.at(-1),null);

 // 窗口右端落在周中非交易日（如休市日）时，曲线仍补齐至最后可用交易日并同步口径与条数
 calls.length=0;
 appEvents.dispatchEvent(new CustomEvent(events.replayRange,{
   detail:{start:'2025-01-02',end:'2025-01-09',frequency:'daily',calendar:['2025-01-02','2025-01-03','2025-01-06']}
 }));
 assert.equal(calls.filter(c=>c[0]==='bezierCurveTo').length,3);
 assert.match($('kd-sample-note').textContent,/日线视图/);
 assert.equal($('kd-observations').textContent,'2 条记录');

 // 仅1个有效采样点时也应绘制3条曲线圆点，不出现空白画布
 calls.length=0;
 appEvents.dispatchEvent(new CustomEvent(events.replayRange,{
   detail:{start:'2025-01-03',end:'2025-01-03',frequency:'daily',calendar:['2025-01-03']}
 }));
 assert.equal(calls.filter(c=>c[0]==='bezierCurveTo').length,0);
 assert.equal(calls.filter(c=>c[0]==='arc').length,3);
 assert.equal($('kd-observations').textContent,'1 条记录');

 // 周线视图下按周聚合统计并刷新示例文案，复盘事件再切回日线视角
 renderKDReview(
   {symbol:'QQQ',baseAmount:1000,rows:kdRows,kdSignals:[],range:{start:'2025-01-02',end:'2025-01-17',frequency:'weekly',calendar:kdRows.map(r=>r.date)}},
   {start:'2025-01-02',end:'2025-01-17',kdOrders:[],deferredKD:0}
 );
 assert.match($('kd-sample-note').textContent,/周线视图/);
 assert.equal($('kd-observations').textContent,'3 条记录');
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
  assert.equal(JSON.parse(saved.get('seeker.kd.v1')).tierFactor, 1.3);
});

test('策略说明在三个页签间切换，KD 十档金额和示例同步当前参数',async t=>{
 const $=dom(t),{initKDControls}=await import('../public/js/features/strategy/kd.mjs');
 const previous=globalThis.localStorage,oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),opened=[];
 globalThis.localStorage={getItem:()=>null,setItem(){}};globalThis.window={open:(...args)=>opened.push(args)};
 t.after(()=>{globalThis.localStorage=previous;if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;});
 initKDControls();
 initStrategyOverlay();
 $('base-amount').value='1000';
 $('base-amount').listeners.input();
 const diagrams=['monthly_dca_logic.svg','fear_dca_logic.svg'].map(image=>Object.assign(element(),{dataset:{image}}));
 $('strategy-dialog').querySelectorAll=()=>diagrams;
 const names = ['kd', 'pyramid', 'fear'];
 const tabs = names.map(name => $('strategy-tab-' + name));
 const panels = names.map(name => $('strategy-' + name + '-panel'));
 let focused;
 tabs.forEach((tab, index) => { tab.focus = () => { focused = index; }; });
 const assertSelected = selected => {
   assert.deepEqual(panels.map(panel => panel.hidden), names.map((_, i) => i !== selected));
   assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-selected')), names.map((_, i) => String(i === selected)));
 };
 initStrategyDialog();
 assertSelected(0);
 assert.equal($('strategy-kd-tiers').children.length,10);
 $('main-kd-tier-factor').value='3';$('main-kd-tier-factor').listeners.input();
 assert.match($('strategy-kd-tiers').children[9].children.map(c=>c.textContent).join(' '), /19,683N/);
 tabs[1].listeners.click();
 assertSelected(1);
 tabs[1].listeners.keydown({key:'Home',preventDefault(){}});assert.equal(focused,0);assertSelected(0);
 tabs[0].listeners.keydown({key:'End',preventDefault(){}});assert.equal(focused,2);assertSelected(2);
 $('base-amount').value='50';$('fear-buy-count').value='0';$('fear-buy-count').listeners.input();
 assert.match($('strategy-fear-parameters').textContent,/\$50\.00/);
 tabs[2].listeners.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(focused,0);assertSelected(0);
 $('main-kd-tier-factor').value='1.5';$('main-kd-tier-factor').listeners.input();
 diagrams.forEach(button=>button.listeners.click());
 assert.deepEqual(opened,diagrams.map(b=>[new URL('../public/diagram.html?image='+b.dataset.image,import.meta.url).href,'_blank','noopener,noreferrer']));
 assert.equal($('strategy-dialog').open,true);
});

test('状态只保留两种组合策略，切换和刷新恢复选择',async t=>{
 const $=dom(t),oldStorage=globalThis.localStorage,oldResize=globalThis.ResizeObserver,saved=new Map();
 globalThis.localStorage={getItem:key=>saved.get(key)??null,setItem:(key,value)=>saved.set(key,String(value))};globalThis.ResizeObserver=class{observe(){}};
 t.after(()=>{globalThis.localStorage=oldStorage;globalThis.ResizeObserver=oldResize;});
 $('symbol').value='QQQ';$('symbol').options=[{value:'QQQ',textContent:'QQQ'}];
 $('price-chart').getContext=()=>new Proxy({},{get:(_,name)=>name==='measureText'?()=>({width:20}):()=>{},set:()=>true});
 initStrategyOverlay();
 assert.equal(getSignalStrategy(),'kdFear');
 assert.equal($('status-strategy-kdFear').getAttribute('aria-pressed'),'true');
 assert.equal(signalSettings().fearBuyCount,0);
 assert.equal(signalSettings().fearEnabled,false);
 assert.equal(Number($('fear-buy-count').value),0);
 const daily=['2024-01-02','2024-01-05','2024-02-01','2024-02-02','2024-03-01','2024-03-04'].map((date,i)=>({date,open:100-i*5,high:105-i*5,low:90-i*5,close:100-i*5}));
 const range={start:daily[0].date,end:daily.at(-1).date,calendar:daily.map(r=>r.date),frequency:'daily',replay:true};updateSignals({symbol:'QQQ',rows:daily},range);
 const backtest=$('backtest-results').children,period=$('backtest-period').textContent;
 for(const strategy of ['combined','kdFear']){
   $('status-strategy-'+strategy).listeners.click();assert.equal(getSignalStrategy(),strategy);
   assert.equal($('status-strategy-'+strategy).getAttribute('aria-pressed'),'true');
   assert.equal($('backtest-results').children,backtest);assert.equal($('backtest-period').textContent,period);
   const visible=getVisibleSignals();assert.ok(visible.every(s=>s.date<=range.end));
   if(strategy==='kdFear')assert.match($('funding-split').textContent,/加权K额外投入/);
   drawSignalMarkers({...frame,x:date=>daily.findIndex(r=>r.date===date)*70,y:()=>90});assert.equal($('signal-layer').children.length,visible.length);
 }
 initStrategyOverlay();assert.equal(getSignalStrategy(),'kdFear');
 saved.set('seeker.strategyView.v1','kd');initStrategyOverlay();assert.equal(getSignalStrategy(),'kdFear');
});

test('清空定投金额或恐慌倍数输入框不覆盖已保存配置；组合配比最大余数法精确分摊', t => {
 const $ = dom(t), oldStorage = globalThis.localStorage, oldResize = globalThis.ResizeObserver, saved = new Map();
 globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)) };
 globalThis.ResizeObserver = class { observe() {} };
 t.after(() => { globalThis.localStorage = oldStorage; globalThis.ResizeObserver = oldResize; });
 $('symbol').value = 'SPY';
 $('symbol').options = [{ value: 'SPY', textContent: 'SPY' }];
 initStrategyOverlay();
 $('base-amount').value = '1500';
 $('base-amount').listeners.input();
 $('fear-buy-count').value = '2';
 $('fear-buy-count').listeners.input();
 const before = signalSettings();
 const beforeRaw = saved.get('seeker.pyramid.v1');
 $('base-amount').value = '';
 $('base-amount').listeners.input();
 assert.notEqual($('signal-error').textContent, '');
 assert.equal(signalSettings().baseAmount, before.baseAmount);
 assert.equal(saved.get('seeker.pyramid.v1'), beforeRaw);
 $('base-amount').value = String(before.baseAmount);
 $('fear-buy-count').value = '   ';
 $('fear-buy-count').listeners.input();
 assert.notEqual($('signal-error').textContent, '');
 assert.equal(signalSettings().fearEnabled, true);
 assert.equal(signalSettings().fearBuyCount, 2);
 assert.equal(saved.get('seeker.pyramid.v1'), beforeRaw);

 const even = allocateWeightedAmounts(100.01, [{ symbol: 'SPY', weight: 50 }, { symbol: 'QQQ', weight: 50 }]);
 assert.equal(even.get('SPY'), 50.01);
 assert.equal(even.get('QQQ'), 50);
 const thirds = allocateWeightedAmounts(10, [{ symbol: 'SPY', weight: 33.33 }, { symbol: 'QQQ', weight: 33.33 }, { symbol: 'VGT', weight: 33.34 }]);
 assert.equal(thirds.get('SPY'), 3.33);
 assert.equal(thirds.get('QQQ'), 3.33);
 assert.equal(thirds.get('VGT'), 3.34);

 // Replay mode accepts full data.rows and filters signals & summary by range.end without mutating or slicing data.rows.
 const fullDaily = ['2024-01-02', '2024-01-05', '2024-02-01', '2024-02-02', '2024-03-01', '2024-03-04'].map((date, i) => ({
   date, open: 100 - i * 5, high: 105 - i * 5, low: 90 - i * 5, close: 100 - i * 5
 }));
 const fullData = { symbol: 'QQQ', rows: fullDaily };
 updateSignals(fullData, { start: '2024-01-02', end: '2024-02-02', calendar: fullDaily.slice(0, 4).map(r => r.date), frequency: 'daily', replay: true }, { syncBacktest: false });
 assert.equal(fullData.rows.length, 6);
 assert.ok(getVisibleSignals().every(s => s.date <= '2024-02-02'));
 assert.equal($('recent-signal').textContent, '2024-02-01');
});
