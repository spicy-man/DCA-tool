import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FUND_GROUPS, getFundGroup } from '../public/js/domain/fund-groups.mjs';
import { refreshFunds } from '../server/updater.mjs';

const now = Date.parse('2026-10-26T08:00Z');
const dates = ['2021-10-22', '2023-10-23', '2025-10-23', '2026-10-23'];
function history(symbol) {
  return { chart: { error: null, result: [{ meta: { symbol,
    currency: ['QQQ', 'VOO'].includes(symbol) ? 'USD' : 'CNY', firstTradeDate: Date.parse('2010-01-01') / 1000 },
    timestamp: dates.map(date => Date.parse(date + 'T12:00Z') / 1000),
    indicators: { quote: [{ close: [1, 1.2, 1.5, 2] }], adjclose: [{ adjclose: [1, 1.2, 1.5, 2] }] } }] } };
}
function source(url) {
  const u = new URL(url);
  if (u.hostname === 'fundf10.eastmoney.com') return '<th>净资产规模</th><td>10.25亿元（截止至：2026年06月30日）<th>管理费率</th><td>0.50%</td><th>托管费率</th><td>0.10%</td>';
  if (u.pathname.includes('/finance/chart/')) return JSON.stringify(history(decodeURIComponent(u.pathname.split('/').at(-1))));
  const codes = u.searchParams.get('secids').split(',').map(code => code.slice(2));
  return JSON.stringify({ rc: 0, data: { diff: codes.map(code => ({ f12: code, f2: 2, f441: 1.8,
    f6: 10000000, f3: 1, f38: 1000000, f124: Date.parse('2026-10-26T07:30Z') / 1000 })) } });
}

test('每日更新覆盖两个独立分组，VOO与QQQ历史不会混用；单组失败保留对应快照', async t => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dca-fund-groups-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const result = await refreshFunds({ dataDir, now, fetchText: async url => source(url) });
  assert.equal(result.complete, true);
  assert.deepEqual(result.groups.map(group => group.groupId), ['nasdaq100', 'sp500']);
  const read = group => readFile(path.join(dataDir, group.snapshotFile), 'utf8');
  const nasdaq = await read(FUND_GROUPS.nasdaq100);
  const sp = JSON.parse(await read(FUND_GROUPS.sp500));
  assert.equal(JSON.parse(nasdaq).performance.benchmark.code, 'QQQ');
  assert.equal(sp.performance.benchmark.code, 'VOO');
  assert.deepEqual(sp.rows.map(row => row.code), FUND_GROUPS.sp500.funds.map(row => row.code));
  assert.equal(sp.rows.length, 4);
  assert.equal(sp.performance.complete, true);
  const failed = await refreshFunds({ dataDir, now: now + 1000, group: 'sp500', fetchText: async () => { throw Error('offline'); } });
  assert.equal(failed.complete, false);
  const saved = JSON.parse(await read(FUND_GROUPS.sp500));
  assert.equal(saved.ok, false);
  assert.deepEqual(saved.rows, sp.rows);
  assert.equal(await read(FUND_GROUPS.nasdaq100), nasdaq);
  await assert.rejects(refreshFunds({ dataDir, group: '../private', fetchText: async () => { throw Error('unexpected fetch'); } }), /未知基金分组/);
});

test('两种入口、快照路径与基准明确分离，未知配置拒绝使用', () => {
  assert.equal(getFundGroup('sp500').homeSymbol, 'SPY');
  assert.equal(getFundGroup('sp500').benchmark.symbol, 'VOO');
  assert.equal(getFundGroup('nasdaq100').benchmark.symbol, 'QQQ');
  assert.notEqual(getFundGroup('sp500').snapshotFile, getFundGroup('nasdaq100').snapshotFile);
  assert.throws(() => getFundGroup('__proto__'));
});
