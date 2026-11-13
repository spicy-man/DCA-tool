import test from 'node:test';
import assert from 'node:assert/strict';
import { initApplication } from '../public/js/application.mjs';
import { initStrategyOverlay } from '../public/js/features/strategy/overlay.mjs';
import { initMarketChart, loadMarket } from '../public/js/features/market/chart.mjs';
import { appEvents } from '../public/js/services/events.mjs';
import { drawOverview } from '../public/js/charts/sentiment.mjs';

function trackAppEvents(t) {
  const added = [];
  const original = appEvents.addEventListener.bind(appEvents);
  t.mock.method(appEvents, 'addEventListener', (type, fn, options) => {
    added.push([type, fn, options]);
    return original(type, fn, options);
  });
  t.after(() => {
    for (const [type, fn, options] of added) appEvents.removeEventListener(type, fn, options);
  });
}

function canvasContext(calls = []) {
  return new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 20 })
      : (...args) => calls.push([key, ...args]),
    set: () => true
  });
}

for (const mode of ['static', 'local']) test(`联合时间范围与刷新入口：${mode}`, async t => {
  trackAppEvents(t);
  const nodes = new Map();
  const ctx = canvasContext();
  const element = () => ({
    textContent: '', value: '', dataset: {}, hidden: false, open: false,
    clientWidth: 600, clientHeight: 300, offsetHeight: 0, children: [], listeners: {},
    style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
    setAttribute() {}, replaceChildren(...values) { this.children = values; },
    append(value) { this.children.push(value); },
    addEventListener(key, fn) { this.listeners[key] = fn; },
    closest(selector) { return selector === 'details' ? this : null; },
    querySelector() { return element(); }, getContext() { return ctx; },
    getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 300 }; }
  });
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  for (const [key, value] of Object.entries({
    document: { getElementById: $, createElement: element, createElementNS: element, querySelector() { return null; } },
    window: { devicePixelRatio: 1 }, devicePixelRatio: 1,
    ResizeObserver: class { observe() {} },
    localStorage: { getItem: () => null, setItem() {} }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  $('symbol').value = 'SPY';
  $('symbol').options = [{ value: 'SPY', textContent: 'SPY' }, { value: 'QQQ', textContent: 'QQQ' }];
  $('range').value = 'all';
  $('frequency').value = 'daily';
  $('layout').value = 'expanded';
  const rows = ['1999-03-10', '2026-09-01', '2026-10-15', '2026-10-16', '2026-10-19'].map((date, i) => ({
    date, open: 100 + i, high: 110 + i, low: 90 + i, close: 100 + i, volume: 10
  }));
  let sentimentStart = '1980-01-02';
  let market = { symbol: 'SPY', anchorDate: rows.at(-1).date, fetchedAt: '2026-10-20T00:00:00Z', rows };
  let failSentiment = false;
  let failRefresh = false;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    if (failSentiment && url.includes('fear-greed.csv')) throw Error('情绪数据读取失败');
    if (failRefresh && url.includes('/api/refresh')) throw Error('刷新部分失败');
    return {
      ok: true,
      json: async () => url.includes('qqq.json') ? { ...market, symbol: 'QQQ', rows: [{ ...rows[0], date: '1990-01-02' }, ...market.rows] } : url.includes('spy.json') ? market : url.includes('deployment') ? { mode } : null,
      text: async () => `Date,Fear Greed,Rating\n${sentimentStart},50,Neutral\n2026-10-15,40,Fear\n2026-10-16,30,Fear\n`
    };
  });
  initStrategyOverlay();
  initApplication();
  await new Promise(resolve => setImmediate(resolve));
  for (let i = 0; i < 20 && !$('price-asof').textContent.includes('Yahoo'); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal($('date-range').textContent, '1999-03-10 – 2026-10-19');
  assert.equal($('price-close').textContent, '104.00');
  assert.equal($('price-observations').textContent, '5 根 K 线');
  assert.match($('backtest-period').textContent, /2026-10-19/);
  assert.equal(Number($('timeline').max), Date.parse('2026-10-19'));
  assert.equal($('observations').textContent, '2 条记录');

  assert.equal($('refresh').disabled, mode === 'static');
  assert.equal($('refresh-hint').title, $('refresh').title);
  assert.equal($('refresh-hint').tabIndex, mode === 'static' ? 0 : -1);
  if (mode === 'static') {
    assert.equal($('refresh').title, '仅本地部署可更新数据');
    const requestCount = requests.length;
    await $('refresh').listeners.click();
    assert.equal(requests.length, requestCount, '线上版不抓取来源，也不重新读取快照');
    assert.equal($('refresh').disabled, true);
    return;
  }
  assert.equal($('refresh').title, '更新数据');

  $('range').value = 'sentiment';
  $('range').listeners.change();
  assert.equal($('date-range').textContent, '1999-03-10 – 2026-10-19');

  $('range').value = '12';
  $('range').listeners.change();
  assert.match($('date-range').textContent, /2026-10-19$/);
  $('timeline').value = Date.parse('2026-10-16');
  $('timeline').listeners.input({ currentTarget: $('timeline') });
  assert.match($('date-range').textContent, /2026-10-16$/);
  market = { ...market, anchorDate: '2026-10-20', rows: [...rows, { ...rows.at(-1), date: '2026-10-20', close: 105 }] };
  await $('refresh').listeners.click();
  assert.ok(requests.includes('./api/refresh'));
  assert.equal($('refresh').disabled, false);
  assert.equal(Number($('timeline').max), Date.parse('2026-10-20'));
  assert.match($('date-range').textContent, /2026-10-16$/);
  $('latest').listeners.click();
  assert.match($('date-range').textContent, /2026-10-20$/);
  assert.equal($('price-close').textContent, '105.00');
  assert.equal(Number($('backtest-timeline').max), Date.parse('2026-10-20'));

  market = { ...market, anchorDate: '2026-10-21', rows: [...market.rows, { ...rows.at(-1), date: '2026-10-21', close: 106 }] };
  await $('refresh').listeners.click();
  assert.match($('date-range').textContent, /2026-10-21$/);
  assert.equal($('price-close').textContent, '106.00');
  $('range').value = 'all';
  $('range').listeners.change();
  assert.match($('date-range').textContent, /^1999-03-10/);
  $('symbol').value = 'QQQ';
  await loadMarket();
  assert.match($('date-range').textContent, /^1990-01-02/);
  $('symbol').value = 'SPY';
  await loadMarket();
  assert.match($('date-range').textContent, /^1999-03-10/);
  assert.equal(Number($('timeline').max), Date.parse('2026-10-21'));
  assert.match($('backtest-period').textContent, /1999-03-10/);
  sentimentStart = '2011-01-03';
  await $('refresh').listeners.click();
  $('timeline').value = Date.parse('2026-10-16');
  $('range').value = 'sentiment';
  $('range').listeners.change();
  assert.equal($('date-range').textContent, '2011-01-03 – 2026-10-21');
  assert.match($('backtest-period').textContent, /2026-09-01/);
  $('symbol').value = 'QQQ';
  await loadMarket();
  assert.equal($('date-range').textContent, '2011-01-03 – 2026-10-21');

  assert.equal($('fear-state').textContent, '未启用恐慌加投');

  // 行情已更新时，后续情绪数据读取失败仍必须丢弃旧行情缓存。
  $('symbol').value = 'SPY';
  $('fear-buy-count').value = '3';
  $('fear-buy-count').listeners.input();
  market = { ...market, anchorDate: '2026-10-22', rows: [...market.rows, { ...rows.at(-1), date: '2026-10-22', close: 107 }] };
  failSentiment = true;
  await $('refresh').listeners.click();
  assert.match($('price-anchor').textContent, /2026-10-22/);
  assert.equal($('status').textContent, '情绪数据读取失败');
  assert.equal($('fear-state').textContent, '暂无指数记录');
  assert.match($('funding-range').textContent, /暂无指数，未含恐慌加投/);
  assert.match($('funding-split').textContent, /恐慌加投 暂无指数数据，无法统计/);

  // 刷新请求报错也可能已部分写入行情。
  failSentiment = false;
  failRefresh = true;
  sentimentStart = '2015-01-02';
  market = { ...market, anchorDate: '2026-10-23', rows: [...market.rows, { ...rows.at(-1), date: '2026-10-23', close: 108 }] };
  await $('refresh').listeners.click();
  assert.match($('price-anchor').textContent, /2026-10-23/);
  assert.equal($('status').textContent, '刷新部分失败');
  assert.match($('date-range').textContent, /^2015-01-02/);
  assert.notEqual($('fear-state').textContent, '暂无指数记录');
  assert.doesNotMatch($('funding-range').textContent, /暂无指数/);
});

test('概览曲线按联合日期范围定位，指数缺失区间保持留白', t => {
  const previous = globalThis.window;
  globalThis.window = { devicePixelRatio: 1 };
  t.after(() => { globalThis.window = previous; });
  const calls = [];
  const ctx = canvasContext(calls);
  const canvas = { clientWidth: 100, clientHeight: 30, getContext: () => ctx };
  drawOverview(canvas, [{ date: '2026-10-15', score: 40 }, { date: '2026-10-16', score: 30 }], {
    start: Date.parse('2026-10-14'), end: Date.parse('2026-10-19')
  });
  assert.equal(calls.find(([name]) => name === 'moveTo')[1], 20);
  assert.equal(calls.find(([name]) => name === 'lineTo')[1], 40);
});

test('PWA 切回前台仅在 status.json 更新后刷新行情与情绪，离线失败保留当前画面', async t => {
  trackAppEvents(t);
  const nodes = new Map();
  const ctx = canvasContext();
  const element = () => {
    const handlers = {};
    return {
      textContent: '', value: '', dataset: {}, hidden: false, open: false,
      clientWidth: 600, clientHeight: 300, offsetHeight: 0, children: [], listeners: {},
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {}, replaceChildren(...values) { this.children = values; },
      append(value) { this.children.push(value); },
      addEventListener(key, fn) {
        (handlers[key] ||= []).push(fn);
        this.listeners[key] = (...args) => {
          let result;
          for (const handler of handlers[key]) result = handler(...args);
          return result;
        };
      },
      closest(selector) { return selector === 'details' ? this : null; },
      querySelector() { return element(); }, getContext() { return ctx; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 300 }; }
    };
  };
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const docListeners = {};
  const doc = {
    visibilityState: 'visible',
    getElementById: $,
    createElement: element,
    createElementNS: element,
    querySelector: () => null,
    addEventListener(key, fn) { docListeners[key] = fn; }
  };
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const nav = { onLine: true };
  for (const [key, value] of Object.entries({
    document: doc,
    navigator: nav,
    window: { devicePixelRatio: 1 }, devicePixelRatio: 1,
    ResizeObserver: class { observe() {} },
    localStorage: { getItem: () => null, setItem() {} }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  $('symbol').value = 'VGT';
  $('symbol').options = [{ value: 'VGT', textContent: 'VGT' }];
  $('range').value = 'all';
  $('frequency').value = 'daily';
  $('layout').value = 'expanded';

  const baseRows = ['2026-10-15', '2026-10-16'].map((date, i) => ({
    date, open: 100 + i, high: 110 + i, low: 90 + i, close: 100 + i, volume: 10
  }));
  let market = { symbol: 'VGT', anchorDate: '2026-10-16', fetchedAt: '2026-10-16T21:00:00Z', rows: [...baseRows] };
  let health = { version: 1, expectedDate: '2026-10-16', checkedAt: '2026-10-16T21:01:00Z', complete: true, results: [] };
  let sentimentScore = 30;
  let failStatus = false;
  let failSentiment = false;
  let failMarket = false;
  let statusFetches = 0;
  let sentimentFetches = 0;
  let marketFetches = 0;

  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('status.json')) {
      statusFetches++;
      if (failStatus) throw Error('offline');
      return { ok: true, json: async () => health };
    }
    if (url.includes('fear-greed.csv')) {
      sentimentFetches++;
      if (failSentiment) throw Error('sentiment offline');
      return { ok: true, text: async () => `Date,Fear Greed,Rating\n2026-10-15,40,Fear\n2026-10-16,${sentimentScore},Fear\n` };
    }
    if (url.includes('vgt.json')) {
      marketFetches++;
      if (failMarket) throw Error('market offline');
      return { ok: true, json: async () => market };
    }
    return { ok: true, json: async () => url.includes('deployment') ? { mode: 'local' } : null };
  });

  initStrategyOverlay();
  initMarketChart();
  initApplication();
  for (let i = 0; i < 20 && (!$('price-asof').textContent.includes('2026-10-16') || !$('status').textContent); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(statusFetches, 1);
  assert.equal(marketFetches, 1);
  assert.equal($('price-close').textContent, '101.00');

  // Within 60s cooldown, hidden tab, or offline must not fetch status.json.
  now += 30_000;
  await docListeners.visibilitychange();
  now += 40_000;
  doc.visibilityState = 'hidden';
  await docListeners.visibilitychange();
  doc.visibilityState = 'visible';
  nav.onLine = false;
  await docListeners.visibilitychange();
  nav.onLine = true;
  assert.equal(statusFetches, 1);

  // Unchanged status.json after cooldown must not re-fetch market snapshot.
  now += 70_000;
  await docListeners.visibilitychange();
  assert.equal(statusFetches, 2);
  assert.equal(marketFetches, 1);

  // Offline status failure keeps existing close price intact.
  now += 70_000;
  failStatus = true;
  await docListeners.visibilitychange();
  assert.equal(statusFetches, 3);
  assert.equal($('price-close').textContent, '101.00');
  assert.equal(marketFetches, 1);

  // Newer status.json + sentiment failure keeps current view and retries next resume.
  failStatus = false;
  failSentiment = true;
  market = {
    symbol: 'VGT',
    anchorDate: '2026-10-19',
    fetchedAt: '2026-10-19T21:00:00Z',
    rows: [...baseRows, { date: '2026-10-19', open: 102, high: 112, low: 92, close: 109, volume: 10 }]
  };
  health = { version: 1, expectedDate: '2026-10-19', checkedAt: '2026-10-19T21:01:00Z', complete: true, results: [] };
  now += 70_000;
  await docListeners.visibilitychange();
  assert.equal($('price-close').textContent, '101.00');
  assert.equal(marketFetches, 1);

  // Newer status.json + market failure preserves close price and retries next resume.
  failSentiment = false;
  failMarket = true;
  now += 70_000;
  await docListeners.visibilitychange();
  assert.equal(marketFetches, 2);
  assert.equal($('price-close').textContent, '101.00');

  // Next resume when network recovers completes the refresh and updates close price in a single render pass.
  failMarket = false;
  let strategySettingsEvents = 0;
  const countSettings = () => { strategySettingsEvents++; };
  appEvents.addEventListener('strategy-settings', countSettings);
  now += 70_000;
  await docListeners.visibilitychange();
  appEvents.removeEventListener('strategy-settings', countSettings);
  assert.equal(strategySettingsEvents, 0);
  assert.equal(marketFetches, 3);
  assert.equal($('price-close').textContent, '109.00');
  assert.match($('price-asof').textContent, /2026-10-19/);

  // Unchanged visibilitychange while #refresh load() is in flight must not cancel load().
  let resolveRefreshSentiment;
  const refreshSentimentWait = new Promise(resolve => { resolveRefreshSentiment = resolve; });
  const baseFetch = globalThis.fetch;
  sentimentScore = 25;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('fear-greed.csv')) {
      await refreshSentimentWait;
    }
    return baseFetch(url);
  });
  const refreshPromise = $('refresh').listeners.click();
  await new Promise(resolve => setImmediate(resolve));
  now += 70_000;
  await docListeners.visibilitychange();
  resolveRefreshSentiment();
  await refreshPromise;
  assert.equal($('score').textContent, 25);
  t.mock.method(globalThis, 'fetch', baseFetch);

  // Resume during an active symbol switch must not cancel loadMarket() or stall loading=true.
  let resolveSwitch;
  const switchWait = new Promise(resolve => { resolveSwitch = resolve; });
  let failSmh = false;
  $('symbol').options.push({ value: 'SMH', textContent: 'SMH' });
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('smh.json')) {
      await switchWait;
      if (failSmh) throw Error('smh offline');
      return { ok: true, json: async () => ({ ...market, symbol: 'SMH' }) };
    }
    if (url.includes('status.json')) {
      return { ok: true, json: async () => ({ ...health, checkedAt: '2026-10-20T21:01:00Z' }) };
    }
    return baseFetch(url);
  });
  $('symbol').value = 'SMH';
  $('symbol').listeners.change();
  now += 70_000;
  const resumeDuringSwitch = docListeners.visibilitychange();
  await resumeDuringSwitch;
  resolveSwitch();
  for (let i = 0; i < 20 && (!$('price-title').textContent.includes('SMH') || $('price-close').textContent === '—'); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.match($('price-title').textContent, /^SMH/);
  assert.equal($('price-close').textContent, '109.00');
  assert.match($('price-asof').textContent, /2026-10-19/);

  // Failed symbol load recovers on next resume even when status.json is unchanged (without re-fetching sentiment).
  $('symbol').options.push({ value: 'QQQ', textContent: 'QQQ' });
  failSmh = true;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('qqq.json')) {
      if (failSmh) throw Error('qqq offline');
      return { ok: true, json: async () => ({ ...market, symbol: 'QQQ' }) };
    }
    return baseFetch(url);
  });
  $('symbol').value = 'QQQ';
  $('symbol').listeners.change();
  for (let i = 0; i < 20 && !$('price-asof').textContent.includes('qqq offline'); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal($('price-close').textContent, '—');
  failSmh = false;
  const sentimentBeforeRetry = sentimentFetches;
  now += 70_000;
  await docListeners.visibilitychange();
  assert.equal(sentimentFetches, sentimentBeforeRetry);
  assert.match($('price-title').textContent, /^QQQ/);
  assert.equal($('price-close').textContent, '109.00');
});

test('恐慌加投倍数为 0 时自动折叠恐慌图表并保留拖动条，开启或手动切换可展开', async t => {
  trackAppEvents(t);
  const nodes = new Map();
  const ctx = canvasContext();
  const element = () => {
    const attrs = {};
    const handlers = {};
    return {
      textContent: '', value: '', dataset: {}, hidden: false, open: false,
      clientWidth: 600, clientHeight: 300, offsetHeight: 0, children: [], listeners: {},
      style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
      setAttribute(name, value) { attrs[name] = String(value); },
      getAttribute(name) { return attrs[name]; },
      replaceChildren(...values) { this.children = values; },
      append(value) { this.children.push(value); },
      before() {},
      after() {},
      addEventListener(key, fn) {
        (handlers[key] ||= []).push(fn);
        this.listeners[key] = (...args) => {
          let result;
          for (const handler of handlers[key]) result = handler(...args);
          return result;
        };
      },
      closest(selector) { return selector === 'details' ? this : null; },
      querySelector() { return element(); }, getContext() { return ctx; },
      getBoundingClientRect() { return { left: 0, top: 0, bottom: -10, width: 600, height: this.hidden ? 0 : 224 }; }
    };
  };
  const $ = id => {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  };
  const createdAnchors = [];
  const doc = {
    getElementById: $,
    createElement: tag => {
      const el = element();
      el.tagName = tag;
      createdAnchors.push(el);
      return el;
    },
    createElementNS: element,
    querySelector: () => null
  };
  for (const [key, value] of Object.entries({
    document: doc,
    window: { devicePixelRatio: 1 }, devicePixelRatio: 1,
    ResizeObserver: class { observe() {} },
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    getComputedStyle: () => ({ marginTop: '8px', marginBottom: '0px' }),
    requestAnimationFrame: fn => { fn(); return 1; },
    addEventListener() {},
    removeEventListener() {},
    innerWidth: 1280,
    innerHeight: 800
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  $('symbol').value = 'SPY';
  $('symbol').options = [{ value: 'SPY', textContent: 'SPY' }, { value: 'QQQ', textContent: 'QQQ' }];
  $('range').value = '12';
  $('frequency').value = 'daily';
  $('frequency').selectedOptions = [{ textContent: '日线' }];
  $('layout').value = 'expanded';

  const rows = ['2025-01-02', '2026-09-01', '2026-10-15', '2026-10-16', '2026-10-19'].map((date, i) => ({
    date, open: 100 + i, high: 110 + i, low: 90 + i, close: 100 + i, volume: 10
  }));
  t.mock.method(globalThis, 'fetch', async url => ({
    ok: true,
    json: async () => url.includes('qqq.json')
      ? { symbol: 'QQQ', anchorDate: '2026-10-19', fetchedAt: '2026-10-20T00:00:00Z', rows }
      : url.includes('spy.json')
        ? { symbol: 'SPY', anchorDate: '2026-10-19', fetchedAt: '2026-10-20T00:00:00Z', rows }
        : url.includes('deployment') ? { mode: 'static' } : null,
    text: async () => 'Date,Fear Greed,Rating\n2025-01-02,50,Neutral\n2026-10-15,40,Fear\n2026-10-16,30,Fear\n'
  }));

  const { initFloatingCharts } = await import('../public/js/ui/floating-charts.mjs');
  initStrategyOverlay();
  initMarketChart();
  initApplication();
  initFloatingCharts();
  for (let i = 0; i < 20 && !$('price-asof').textContent.includes('Yahoo'); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }

  // 默认恐慌加投倍数为 0：折叠恐慌图表，但保留拖动条且可拖动更新区间。
  assert.equal($('sentiment-chart-collapse').hidden, true);
  assert.equal($('chart-wrap').hidden, true);
  assert.equal($('sentiment-chart-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal($('sentiment-chart-toggle-label').textContent, '展开图表');
  assert.equal($('timeline').hidden, false);
  assert.equal($('mini').hidden, false);
  assert.equal(createdAnchors[1].hidden, true);

  $('timeline').value = Date.parse('2026-10-16');
  $('timeline').listeners.input({ currentTarget: $('timeline') });
  assert.match($('date-range').textContent, /2026-10-16$/);

  // 手动点击展开按钮后可查看图表，调整阈值不会意外收起。
  $('sentiment-chart-toggle').listeners.click();
  assert.equal($('sentiment-chart-collapse').hidden, false);
  assert.equal($('chart-wrap').hidden, false);
  assert.equal($('sentiment-chart-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal($('sentiment-chart-toggle-label').textContent, '折叠图表');
  $('fear-threshold').value = '15';
  $('fear-threshold').listeners.input();
  assert.equal($('chart-wrap').hidden, false);

  // 再次点击收起，然后启用恐慌加投倍数 -> 自动展开。
  $('sentiment-chart-toggle').listeners.click();
  assert.equal($('chart-wrap').hidden, true);
  $('fear-buy-count').value = '3';
  $('fear-buy-count').listeners.input();
  assert.equal($('chart-wrap').hidden, false);
  assert.equal($('sentiment-chart-toggle').getAttribute('aria-expanded'), 'true');

  // 切换到未启用恐慌加投的 QQQ -> 自动折叠；切回 SPY（3N）-> 自动展开。
  $('symbol').value = 'QQQ';
  $('symbol').listeners.change();
  assert.equal($('chart-wrap').hidden, true);
  $('symbol').value = 'SPY';
  $('symbol').listeners.change();
  assert.equal($('chart-wrap').hidden, false);

  // 将 SPY 改回 0 -> 自动折叠并隐藏 tooltip。
  $('tooltip').hidden = false;
  $('fear-buy-count').value = '0';
  $('fear-buy-count').listeners.input();
  assert.equal($('sentiment-chart-collapse').hidden, true);
  assert.equal($('chart-wrap').hidden, true);
  assert.equal($('tooltip').hidden, true);

  // 带过渡动画的折叠：等待动画结束后再彻底隐藏；动画中途再次展开会取消收起。
  let resolveTransition;
  const collapse = $('sentiment-chart-collapse');
  const attrs = {};
  collapse.setAttribute = (k, v) => { attrs[k] = String(v); };
  collapse.getAttribute = k => attrs[k];
  collapse.hasAttribute = k => Object.hasOwn(attrs, k);
  collapse.removeAttribute = k => { delete attrs[k]; };
  collapse.getAnimations = () => [{ finished: new Promise(resolve => { resolveTransition = resolve; }) }];
  $('sentiment-chart-toggle').listeners.click();
  assert.equal(collapse.hidden, false);
  $('sentiment-chart-toggle').listeners.click();
  assert.equal(collapse.inert, true);
  assert.equal(collapse.hasAttribute('data-closing'), true);
  assert.equal($('chart-wrap').hidden, false);
  $('sentiment-chart-toggle').listeners.click();
  resolveTransition();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(collapse.hidden, false);
  assert.equal($('chart-wrap').hidden, false);
  assert.equal(collapse.hasAttribute('data-closing'), false);

  $('sentiment-chart-toggle').listeners.click();
  assert.equal(collapse.hasAttribute('data-closing'), true);
  resolveTransition();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(collapse.hidden, true);
  assert.equal($('chart-wrap').hidden, true);
});
