import test from 'node:test';
import assert from 'node:assert/strict';
import { initApplication } from '../public/js/application.mjs';
import { initStrategyOverlay } from '../public/js/features/strategy/overlay.mjs';
import { loadMarket } from '../public/js/features/market/chart.mjs';
import { drawOverview } from '../public/js/charts/sentiment.mjs';

function canvasContext(calls = []) {
  return new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 20 })
      : (...args) => calls.push([key, ...args]),
    set: () => true
  });
}

for (const mode of ['static', 'local']) test(`联合时间范围与刷新入口：${mode}`, async t => {
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
