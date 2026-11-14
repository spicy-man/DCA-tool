import test from 'node:test';
import assert from 'node:assert/strict';
import { isNewerVersion, createAppUpdateWatcher } from '../public/js/ui/app-update.mjs';
import { initApplication } from '../public/js/application.mjs';
import { initFundComparison } from '../public/js/features/funds/comparison.mjs';
import { appEvents } from '../public/js/services/events.mjs';

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

function canvasContext() {
  return new Proxy({}, {
    get: (_, key) => key === 'measureText' ? () => ({ width: 20 }) : () => {},
    set: () => true
  });
}

function createDom(version = '2.2.0') {
  const ctx = canvasContext();
  const createNode = () => {
    const node = {
      id: '',
      className: '',
      type: '',
      textContent: '',
      value: '',
      href: '',
      hidden: false,
      open: false,
      clientWidth: 600,
      clientHeight: 220,
      offsetHeight: 0,
      dataset: {},
      options: [],
      children: [],
      listeners: {},
      style: { setProperty() {} },
      classList: { toggle() {}, add() {}, remove() {} },
      setAttribute() {},
      removeAttribute() {},
      closest() { return node; },
      querySelector() { return createNode(); },
      getContext() { return ctx; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 600, height: 220 }; },
      append(...items) { node.children.push(...items); },
      prepend(...items) { node.children.unshift(...items); },
      insertBefore(item, ref) {
        const index = node.children.indexOf(ref);
        if (index >= 0) node.children.splice(index, 0, item);
        else node.children.unshift(item);
      },
      replaceChildren(...items) { node.children = items; },
      addEventListener(key, fn) { node.listeners[key] = fn; }
    };
    return node;
  };
  const nodes = new Map();
  const main = createNode();
  const shell = createNode();
  shell.children = [main];
  shell.querySelector = selector => (selector === 'main' ? main : null);
  const body = createNode();
  body.dataset = { fundGroup: 'nasdaq100' };
  const meta = { content: version };
  const docListeners = {};
  const doc = {
    visibilityState: 'visible',
    body,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, createNode());
      return nodes.get(id);
    },
    createElement: createNode,
    querySelectorAll: () => [],
    querySelector(selector) {
      if (selector === 'meta[name="app-version"]') return meta;
      if (selector === '.shell') return shell;
      return null;
    },
    addEventListener(key, fn) { docListeners[key] = fn; }
  };
  return { doc, shell, main, meta, docListeners, $: id => doc.getElementById(id) };
}

test('isNewerVersion 严格比较语义化版本号并忽略无效输入', () => {
  assert.equal(isNewerVersion('2.2.1', '2.2.0'), true);
  assert.equal(isNewerVersion('2.3.0', '2.2.9'), true);
  assert.equal(isNewerVersion('3.0.0', '2.9.9'), true);
  assert.equal(isNewerVersion('2.2.0', '2.2.0'), false);
  assert.equal(isNewerVersion('2.1.9', '2.2.0'), false);
  assert.equal(isNewerVersion(null, '2.2.0'), false);
  assert.equal(isNewerVersion('v2.2.1', '2.2.0'), false);
});

test('createAppUpdateWatcher 探测新版本后挂载提示条，支持点击刷新与同版本稍后忽略', async () => {
  const { doc, shell, main } = createDom('2.2.0');
  let remoteVersion = '2.2.0';
  let reloads = 0;
  let fetches = 0;
  const nav = { onLine: true };
  const watcher = createAppUpdateWatcher({
    doc,
    win: { navigator: nav },
    getDeployment: async () => {
      fetches++;
      return { mode: 'static', version: remoteVersion };
    },
    reload: () => { reloads++; }
  });

  assert.equal(await watcher.checkForUpdate(), false);
  assert.equal(fetches, 1);
  assert.equal(shell.children.length, 1);

  nav.onLine = false;
  assert.equal(await watcher.checkForUpdate(), false);
  assert.equal(fetches, 1);
  nav.onLine = true;

  remoteVersion = '2.2.1';
  assert.equal(await watcher.checkForUpdate(), true);
  assert.equal(shell.children.length, 2);
  assert.equal(shell.children[1], main);
  const banner = shell.children[0];
  assert.equal(banner.id, 'app-update-banner');
  assert.equal(banner.hidden, false);
  assert.match(banner.children[0].textContent, /v2\.2\.1/);

  const [reloadBtn, dismissBtn] = banner.children[1].children;
  dismissBtn.listeners.click();
  assert.equal(banner.hidden, true);
  assert.equal(await watcher.checkForUpdate(), false);
  assert.equal(banner.hidden, true);

  remoteVersion = '2.2.2';
  assert.equal(await watcher.checkForUpdate(), true);
  assert.equal(banner.hidden, false);
  assert.match(banner.children[0].textContent, /v2\.2\.2/);

  reloadBtn.listeners.click();
  assert.equal(reloads, 1);
});

test('首页与基金对比页在数据未变时切回前台也能探测到新版并弹出更新提示', async t => {
  for (const mode of ['home', 'funds']) {
    trackAppEvents(t);
    const { doc, shell, docListeners, $ } = createDom('2.2.0');
    let now = 3_000_000;
    t.mock.method(Date, 'now', () => now);
    const nav = { onLine: true };
    const win = { devicePixelRatio: 1, navigator: nav, location: { reload() {} } };
    for (const [key, value] of Object.entries({
      document: doc,
      window: win,
      devicePixelRatio: 1,
      navigator: nav,
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      ResizeObserver: class { observe() {} }
    })) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
    }

    let remoteVersion = '2.2.0';
    const health = { version: 1, expectedDate: '2026-10-16', checkedAt: '2026-10-16T21:00:00Z', complete: true, results: [] };
    const market = {
      symbol: 'VGT',
      anchorDate: '2026-10-16',
      fetchedAt: '2026-10-16T21:00:00Z',
      rows: [
        { date: '2026-10-15', open: 100, high: 105, low: 95, close: 100, volume: 10 },
        { date: '2026-10-16', open: 100, high: 106, low: 98, close: 101, volume: 10 }
      ]
    };
    const snapshot = {
      version: 1,
      groupId: 'nasdaq100',
      ok: true,
      checkedAt: '2026-10-26T07:05:00Z',
      rows: [{ code: '513100', manager: '国泰', price: 1.5, iopv: 1.4, premium: 7.14, amount: 5e8, netAssets: 1e10, annualFee: 0.6, quoteDate: '2026-10-26' }],
      performance: { version: 2, ok: true, complete: true, endDate: '2026-10-26', benchmark: { code: 'QQQ', price: 500, quoteDate: '2026-10-26' }, funds: {} }
    };

    t.mock.method(globalThis, 'fetch', async url => {
      if (url.includes('deployment.json')) return { ok: true, json: async () => ({ mode: 'static', version: remoteVersion }) };
      if (url.includes('status.json')) return { ok: true, json: async () => health };
      if (url.includes('fear-greed.csv')) return { ok: true, text: async () => 'date,score,rating,source\n2026-10-15,35,Fear,cnn\n2026-10-16,32,Fear,cnn\n' };
      if (url.includes('nasdaq100-etfs.json')) return { ok: true, json: async () => snapshot };
      return { ok: true, json: async () => market };
    });

    if (mode === 'home') {
      $('symbol').value = 'VGT';
      $('range').value = '12';
      initApplication();
      for (let i = 0; i < 20 && !$('status').textContent; i++) await new Promise(resolve => setImmediate(resolve));
    } else {
      initFundComparison();
      for (let i = 0; i < 20 && $('fund-table').children.length === 0; i++) await new Promise(resolve => setImmediate(resolve));
    }

    assert.equal(shell.children.length, 1);
    remoteVersion = '2.2.1';
    now += 70_000;
    await docListeners.visibilitychange();
    assert.equal(shell.children.length, 2);
    assert.equal(shell.children[0].id, 'app-update-banner');
    assert.match(shell.children[0].children[0].textContent, /v2\.2\.1/);
  }
});
