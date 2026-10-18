import test from 'node:test';
import assert from 'node:assert/strict';
import { drawSentiment } from '../public/js/charts/sentiment.mjs';
import { setSignalSentiment, updateSignals, drawSignalMarkers, initStrategyOverlay, signalSettings } from '../public/js/features/strategy/overlay.mjs';
import { appEvents, events } from '../public/js/services/events.mjs';
import { loadMarket, invalidateMarket } from '../public/js/features/market/chart.mjs';

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
  $('fear-threshold').value = '12';
  $('fear-threshold').listeners.input();
  assert.equal(signalSettings().fearThreshold, 12);
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
