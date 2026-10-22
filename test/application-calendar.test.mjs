import test from 'node:test';
import assert from 'node:assert/strict';
import { initApplication } from '../public/js/application.mjs';
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
    ResizeObserver: class { observe() {} }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  $('symbol').value = 'SPY';
  $('range').value = 'all';
  $('frequency').value = 'daily';
  $('layout').value = 'expanded';
  const rows = ['1999-03-10', '2026-09-01', '2026-10-15', '2026-10-16', '2026-10-19'].map((date, i) => ({
    date, open: 100 + i, high: 110 + i, low: 90 + i, close: 100 + i, volume: 10
  }));
  let sentimentStart = '1980-01-02';
  let market = { symbol: 'SPY', anchorDate: rows.at(-1).date, fetchedAt: '2026-10-20T00:00:00Z', rows };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url);
    return {
      ok: true,
      json: async () => url.includes('qqq.json') ? { ...market, symbol: 'QQQ', rows: [{ ...rows[0], date: '1990-01-02' }, ...market.rows] } : url.includes('spy.json') ? market : url.includes('deployment') ? { mode } : null,
      text: async () => `Date,Fear Greed,Rating\n${sentimentStart},50,Neutral\n2026-10-15,40,Fear\n2026-10-16,30,Fear\n`
    };
  });
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
