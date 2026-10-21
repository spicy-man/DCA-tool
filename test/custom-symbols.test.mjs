import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { addCustomSymbol, refreshAll } from '../server/updater.mjs';
import { readCustomSymbols, removeCustomSymbol } from '../server/symbols.mjs';
import { createServer } from '../server/http-server.mjs';
import { normalizeYahoo, validSymbol, SYMBOLS } from '../public/js/domain/market.mjs';
import { yahooURL } from '../server/network.mjs';

const now = Date.parse('2025-01-07T23:00Z');
function yahoo(symbol) {
  return { chart: { result: [{ meta: { symbol, currency: 'USD', instrumentType: 'ETF',
    exchangeTimezoneName: 'America/New_York' }, timestamp: [Date.parse('2025-01-06T15:00Z') / 1000],
  indicators: { quote: [{ open: [100], high: [110], low: [90], close: [100], volume: [10] }],
    adjclose: [{ adjclose: [95] }] } }], error: null } };
}
async function directory(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dca-symbols-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('仅允许安全代码，拒绝路径、查询和保留文件名；自定义行情仍验证市场及币种', () => {
  for (const symbol of ['VOO', 'AAPL', 'BRK-B', 'BRK.B']) {
    assert.ok(validSymbol(symbol));
    assert.match(yahooURL(symbol), /query1.finance.yahoo.com/);
    assert.equal(normalizeYahoo(yahoo(symbol), symbol, now).symbol, symbol);
  }
  for (const symbol of ['../SPY', 'SPY?x=1', 'spy', '', 'STATUS', 'STATUS.JSON', 'CON', 'NUL', '^GSPC']) {
    assert.equal(validSymbol(symbol), false);
    assert.throws(() => yahooURL(symbol));
  }
  for (const changes of [{ currency: 'HKD' }, { exchangeTimezoneName: 'Asia/Hong_Kong' },
    { instrumentType: 'CRYPTOCURRENCY' }, { symbol: 'OTHER' }]) {
    const payload = yahoo('VOO');
    Object.assign(payload.chart.result[0].meta, changes);
    assert.throws(() => normalizeYahoo(payload, 'VOO', now));
  }
});

test('添加验证成功后持久化，重复添加不下载；后续全量及计划行情刷新包含自定义标的', async t => {
  const dataDir = await directory(t);
  let calls = 0;
  const options = { dataDir, now, fetchText: async () => { calls++; return JSON.stringify(yahoo('VOO')); } };
  assert.deepEqual(await addCustomSymbol('VOO', options), { symbol: 'VOO', symbols: ['VOO'] });
  await addCustomSymbol('VOO', options);
  await addCustomSymbol('SPY', options);
  assert.equal(calls, 1);
  assert.deepEqual(await readCustomSymbols(dataDir), ['VOO']);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'voo.json'), 'utf8')).symbol, 'VOO');
  for (const sources of [undefined, SYMBOLS]) {
    const requested = [];
    const status = await refreshAll({ dataDir, now, sources, wait: async () => {},
      fetchText: async url => {
        if (!url.includes('finance.yahoo.com')) throw Error('HTTP 403');
        const symbol = new URL(url).pathname.split('/').at(-1);
        requested.push(symbol);
        return JSON.stringify(yahoo(symbol));
      } });
    assert.ok(requested.includes('VOO'));
    assert.ok(status.results.find(r => r.symbol === 'VOO').ok);
  }
});

test('添加失败不注册标的、不覆盖原列表和行情；锁阻止与刷新同时写入', async t => {
  const dataDir = await directory(t);
  await assert.rejects(addCustomSymbol('../spy', { dataDir }), /有效/);
  const options = { dataDir, now, fetchText: async () => JSON.stringify(yahoo('VOO')) };
  await addCustomSymbol('VOO', options);
  const previous = await readFile(path.join(dataDir, 'voo.json'), 'utf8');
  await assert.rejects(addCustomSymbol('AAPL', options), /无法添加/);
  assert.deepEqual(await readCustomSymbols(dataDir), ['VOO']);
  assert.equal(await readFile(path.join(dataDir, 'voo.json'), 'utf8'), previous);
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const ready = new Promise(resolve => { entered = resolve; });
  const adding = addCustomSymbol('AAPL', { dataDir, now, fetchText: async () => {
    entered(); await gate; return JSON.stringify(yahoo('AAPL'));
  } });
  await ready;
  await assert.rejects(refreshAll({ dataDir }), /已有数据更新任务/);
  release();
  await adding;
});

test('添加 API：方法、同源、格式、大小限制及列表恢复', async t => {
  const dataDir = await directory(t);
  const server = createServer({ dataDir, addSymbol: (symbol, options) =>
    addCustomSymbol(symbol, { ...options, now, fetchText: async () => JSON.stringify(yahoo(symbol)) }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (body, headers = {}) => fetch(base + '/api/symbols', { method: 'POST', body, headers });
  assert.equal((await fetch(base + '/api/symbols')).status, 405);
  assert.equal((await post('{}', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await post('{}', { Origin: 'null' })).status, 403);
  assert.equal((await post('{')).status, 400);
  assert.equal((await post('null')).status, 400);
  assert.equal((await post('x'.repeat(1025))).status, 413);
  assert.deepEqual(await (await fetch(base + '/data/custom-symbols.json')).json(), []);
  const result = await post(JSON.stringify({ symbol: ' voo ' }));
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { symbol: 'VOO', symbols: ['VOO'] });
  assert.deepEqual(await (await fetch(base + '/data/custom-symbols.json')).json(), ['VOO']);
  assert.equal((await fetch(base + '/data/voo.json')).status, 200);
  const remove = (symbol, headers = {}) => fetch(base + '/api/symbols', {
    method: 'DELETE', body: JSON.stringify({ symbol }), headers
  });
  assert.equal((await remove('VOO', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await remove('VOO', { Origin: 'null' })).status, 403);
  for (const symbol of [...SYMBOLS, '../spy']) assert.equal((await remove(symbol)).status, 400);
  assert.deepEqual(await (await remove('VOO')).json(), { symbol: 'VOO', symbols: [] });
  assert.deepEqual(await (await fetch(base + '/data/custom-symbols.json')).json(), []);
  assert.equal((await fetch(base + '/data/voo.json')).status, 200);
});

test('删除移除持久化列表和健康状态，保留行情；后续刷新不再请求已删除标的', async t => {
  const dataDir = await directory(t);
  await addCustomSymbol('VOO', { dataDir, now, fetchText: async () => JSON.stringify(yahoo('VOO')) });
  await refreshAll({ dataDir, now, sources: SYMBOLS, wait: async () => {},
    fetchText: async url => JSON.stringify(yahoo(new URL(url).pathname.split('/').at(-1))) });
  const cached = await readFile(path.join(dataDir, 'voo.json'), 'utf8');
  await addCustomSymbol('AAPL', { dataDir, now, fetchText: async () => JSON.stringify(yahoo('AAPL')) });
  assert.ok(JSON.parse(await readFile(path.join(dataDir, 'status.json'), 'utf8')).results.some(r => r.symbol === 'AAPL' && r.ok));
  await removeCustomSymbol('AAPL', { dataDir });
  for (const symbol of SYMBOLS) await assert.rejects(removeCustomSymbol(symbol, { dataDir }), /默认标的不可删除/);
  await removeCustomSymbol('VOO', { dataDir });
  await removeCustomSymbol('VOO', { dataDir });
  assert.deepEqual(await readCustomSymbols(dataDir), []);
  const status = JSON.parse(await readFile(path.join(dataDir, 'status.json'), 'utf8'));
  assert.ok(!status.results.some(result => result.symbol === 'VOO'));
  assert.ok(!status.requestedSources.includes('VOO'));
  assert.equal(await readFile(path.join(dataDir, 'voo.json'), 'utf8'), cached);
  await refreshAll({ dataDir, now, sources: SYMBOLS, wait: async () => {},
    fetchText: async url => {
      assert.ok(!url.includes('/VOO?'));
      return JSON.stringify(yahoo(new URL(url).pathname.split('/').at(-1)));
    } });
});

test('已有个人 SMH 升级成内置标的，不重复注册；旧缓存仅移除改制前数据且仍保护有效历史', async t => {
  const dataDir = await directory(t);
  await writeFile(path.join(dataDir, 'custom-symbols.json'), JSON.stringify(['SMH', 'AAPL']));
  assert.deepEqual(await readCustomSymbols(dataDir), ['AAPL']);
  const cached = normalizeYahoo(yahoo('SMH'), 'SMH', now);
  cached.rows.unshift({ ...cached.rows[0], date: '2011-12-19' });
  await writeFile(path.join(dataDir, 'smh.json'), JSON.stringify(cached));
  const status = await refreshAll({ dataDir, now, sources: ['SMH'], wait: async () => {},
    fetchText: async () => JSON.stringify(yahoo('SMH')) });
  assert.ok(status.results.find(result => result.symbol === 'SMH').ok);
  const saved = JSON.parse(await readFile(path.join(dataDir, 'smh.json'), 'utf8'));
  assert.deepEqual(saved.rows.map(row => row.date), ['2025-01-06']);
  const missing = yahoo('SMH');missing.chart.result[0].timestamp = [Date.parse('2025-01-07T15:00Z') / 1000];
  const failed = await refreshAll({ dataDir, now, sources: ['SMH'], wait: async () => {},
    fetchText: async () => JSON.stringify(missing) });
  assert.equal(failed.results.find(result => result.symbol === 'SMH').ok, false);
  assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, 'smh.json'), 'utf8')), saved);
});
