import test from 'node:test';
import assert from 'node:assert/strict';
import { initSymbolDialog } from '../public/js/ui/symbol-dialog.mjs';
import { appEvents, events } from '../public/js/services/events.mjs';

function element() {
  return {
    disabled: true, options: [], listeners: {}, children: [], value: '',
    attributes: { title: '本地部署可添加个人标的', tabindex: '0' },
    removeAttribute(name) { delete this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; },
    querySelectorAll() { return this.children.flatMap(child => child.children.filter(node => node.type === 'button')); },
    dispatchEvent(event) { this.lastEvent = event.type; this.lastEventDetail = event.detail; },
    add(option) { this.options.push(option); option.remove = () => { this.options = this.options.filter(value => value !== option); }; }
  };
}

test('在线版禁用添加入口且不加载个人标的；本地版启用入口并读取列表', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  for (const mode of ['static', 'local']) {
    const nodes = new Map();
    globalThis.document = { createElement: element, getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    } };
    const calls = [];
    const fetchMock = t.mock.method(globalThis, 'fetch', async url => {
      calls.push(url);
      return { ok: true, json: async () => url === './deployment.json' ? { mode } : [] };
    });
    await initSymbolDialog();
    const button = document.getElementById('add-symbol');
    const hint = document.getElementById('add-symbol-hint');
    assert.equal(button.disabled, mode === 'static');
    assert.equal(typeof button.listeners.click, mode === 'static' ? 'undefined' : 'function');
    assert.equal(hint.attributes.title, mode === 'static' ? '本地部署可添加个人标的' : undefined);
    assert.deepEqual(calls, mode === 'static'
      ? ['./deployment.json'] : ['./deployment.json', './data/custom-symbols.json']);
    fetchMock.mock.restore();
  }
});

test('管理列表仅显示个人标的；删除当前标的切回 SPY 并同步选择框，删除失败保留列表', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const nodes = new Map();
  globalThis.document = { createElement: element, getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, element());
    return nodes.get(id);
  } };
  const $ = id => document.getElementById(id);
  for (const id of ['symbol', 'floating-charts-symbol']) {
    for (const value of ['SPY', 'QQQ', 'VGT', 'SMH', 'AAPL']) $(id).add({ value });
    $(id).value = 'AAPL';
  }
  let fail = true;
  let outdated = false;
  let adding = false;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url === './deployment.json') return { ok: true, json: async () => ({ mode: 'local' }) };
    if (url === './data/custom-symbols.json') return { ok: true, json: async () => ['AAPL'] };
    if (adding) {
      assert.equal(options.method, 'POST');
      return { ok: true, json: async () => ({ symbol: 'AAPL', symbols: ['AAPL'] }) };
    }
    assert.equal(options.method, 'DELETE');
    assert.deepEqual(JSON.parse(options.body), { symbol: 'AAPL' });
    return { ok: !fail && !outdated, status: outdated ? 405 : 200,
      json: async () => outdated ? { error: '仅支持 POST' } : fail ? { error: '已有数据更新任务运行' } : { symbol: 'AAPL', symbols: [] } };
  });
  await initSymbolDialog();
  const buttons = () => $('custom-symbol-list').querySelectorAll('button');
  assert.deepEqual($('custom-symbol-list').children.map(row => row.children[0].textContent), ['AAPL']);
  assert.equal(buttons().length, 1);
  assert.equal(buttons()[0].attributes['aria-label'], '删除 AAPL');
  await buttons()[0].listeners.click();
  assert.equal($('symbol').value, 'AAPL');
  assert.match($('symbol-message').textContent, /已有数据更新任务/);
  outdated = true;
  await buttons()[0].listeners.click();
  assert.match($('symbol-message').textContent, /重新运行 start.cmd/);
  assert.equal($('symbol').value, 'AAPL');
  outdated = false;
  let healthNotified = 0;
  const onHealth = () => { healthNotified++; };
  appEvents.addEventListener(events.sourceHealth, onHealth);
  t.after(() => appEvents.removeEventListener(events.sourceHealth, onHealth));
  fail = false;
  await buttons()[0].listeners.click();
  assert.equal(healthNotified, 1);
  assert.equal($('symbol').value, 'SPY');
  assert.equal($('floating-charts-symbol').value, 'SPY');
  assert.equal($('symbol').lastEvent, 'change');
  for (const id of ['symbol', 'floating-charts-symbol']) {
    assert.deepEqual($(id).options.map(option => option.value), ['SPY', 'QQQ', 'VGT', 'SMH']);
  }
  assert.equal(buttons().length, 0);
  assert.equal($('custom-symbol-list').children.length, 0);
  const previousOption = Object.getOwnPropertyDescriptor(globalThis, 'Option');
  globalThis.Option = function(text, value) { this.text = text; this.value = value; };
  t.after(() => previousOption ? Object.defineProperty(globalThis, 'Option', previousOption) : delete globalThis.Option);
  adding = true;
  $('custom-symbol').value = 'AAPL';
  await $('symbol-form').listeners.submit({ preventDefault() {} });
  assert.equal(healthNotified, 2);
  assert.equal($('symbol').value, 'AAPL');
  assert.equal($('floating-charts-symbol').value, 'AAPL');
  assert.deepEqual($('symbol').lastEventDetail, { forceRefresh: true });
});
