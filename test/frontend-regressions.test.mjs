import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSentiment } from '../public/js/charts/sentiment.mjs';
import { setSignalSentiment, updateSignals, drawSignalMarkers, initStrategyOverlay, signalSettings } from '../public/js/features/strategy/overlay.mjs';
import { appEvents, events } from '../public/js/services/events.mjs';
import { loadMarket, invalidateMarket, initMarketChart } from '../public/js/features/market/chart.mjs';
import { initStrategyDialog } from '../public/js/ui/strategy-dialog.mjs';

function element() {
  return {
    textContent: '', dataset: {}, style: {}, children: [], value: '', checked: true,
    listeners: {}, open: true,
    replaceChildren(...children) { this.children = children; },
    append(child) { this.children.push(child); },
    setAttribute() {}, closest() { return this; },
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
    createElement: element
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
