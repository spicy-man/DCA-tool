import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createServer } from '../server/http-server.mjs';
import { addCustomSymbol, refreshAll } from '../server/updater.mjs';
import { SYMBOLS } from '../public/js/domain/market.mjs';
import { FUND_GROUPS } from '../public/js/domain/funds.mjs';

const now = Date.parse('2025-01-08T23:00Z');

async function makeTempDir(t, prefix) {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function marketSnapshot(symbol, dates) {
  return {
    symbol,
    anchorDate: dates.at(-1),
    rows: dates.map(date => ({ date, open: 100, high: 110, low: 90, close: 100, adjClose: 100, volume: 100 }))
  };
}

function yahooPayload(symbol, isoTimes) {
  const times = Array.isArray(isoTimes) ? isoTimes : [isoTimes];
  return {
    chart: {
      result: [{
        meta: {
          symbol,
          currency: 'USD',
          instrumentType: 'ETF',
          exchangeTimezoneName: 'America/New_York'
        },
        timestamp: times.map(t => Date.parse(t) / 1000),
        indicators: {
          quote: [{
            open: times.map(() => 102),
            high: times.map(() => 112),
            low: times.map(() => 98),
            close: times.map(() => 105),
            volume: times.map(() => 200)
          }],
          adjclose: [{ adjclose: times.map(() => 105) }]
        }
      }],
      error: null
    }
  };
}

function baseStatus({ date = '2025-01-06', checkedAt = '2025-01-07T01:00:00.000Z', fundsCheckedAt = checkedAt } = {}) {
  return {
    version: 1,
    checkedAt,
    expectedDate: date,
    requestedSources: ['Fear & Greed', ...SYMBOLS],
    requestedComplete: true,
    complete: true,
    results: [
      { symbol: 'Fear & Greed', date, count: 2, source: 'CNN', ok: true, fresh: true, expectedDate: date, checkedAt, lastSuccessAt: checkedAt },
      ...SYMBOLS.map(symbol => ({
        symbol, date, count: 1, source: 'Yahoo Finance', ok: true, fresh: true, expectedDate: date, checkedAt, lastSuccessAt: checkedAt
      }))
    ],
    funds: {
      ok: true,
      complete: true,
      checkedAt: fundsCheckedAt,
      performance: { ok: true, complete: true, endDate: date },
      groups: Object.keys(FUND_GROUPS).map(groupId => ({ groupId, ok: true, count: 1, performanceOk: true, performanceComplete: true }))
    }
  };
}

async function seedBaseDir(baseDataDir) {
  await writeFile(path.join(baseDataDir, 'fear-greed.csv'),
    'Date,Fear Greed,Rating\n2020-01-02,50,Neutral\n2025-01-06,55,Greed\n');
  for (const symbol of SYMBOLS) {
    await writeFile(path.join(baseDataDir, symbol.toLowerCase() + '.json'),
      JSON.stringify(marketSnapshot(symbol, ['2025-01-06'])));
  }
  for (const group of Object.values(FUND_GROUPS)) {
    await writeFile(path.join(baseDataDir, group.snapshotFile),
      JSON.stringify({ version: 1, groupId: group.id, checkedAt: '2025-01-07T01:00:00.000Z', ok: true, rows: [{ code: group.funds[0].code, quoteDate: '2025-01-06' }] }));
  }
  const stray = {
    symbol: 'LEAK',
    date: '2025-01-06',
    count: 1,
    source: 'Yahoo Finance',
    ok: true,
    fresh: true,
    expectedDate: '2025-01-06',
    checkedAt: '2025-01-07T01:00:00.000Z',
    lastSuccessAt: '2025-01-07T01:00:00.000Z'
  };
  const statusWithStray = baseStatus();
  statusWithStray.results.push(stray);
  statusWithStray.requestedSources.push('LEAK');
  await writeFile(path.join(baseDataDir, 'status.json'), JSON.stringify(statusWithStray, null, 2) + '\n');
  // Even if stray custom files exist in baseDataDir, layered reads must ignore them.
  await writeFile(path.join(baseDataDir, 'custom-symbols.json'), '["LEAK"]\n');
  await writeFile(path.join(baseDataDir, 'leak.json'), JSON.stringify(marketSnapshot('LEAK', ['2025-01-06'])));
}

test('分层存储：读取回退到基线目录，过滤基线残留个人标的并严格隔离本地自选股', async t => {
  const dataDir = await makeTempDir(t, 'dca-local-');
  const baseDataDir = await makeTempDir(t, 'dca-base-');
  await seedBaseDir(baseDataDir);

  const server = createServer({
    dataDir,
    baseDataDir,
    addSymbol: (symbol, options) => addCustomSymbol(symbol, {
      ...options,
      now,
      fetchText: async () => JSON.stringify(yahooPayload(symbol, '2025-01-07T15:00:00Z'))
    })
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  // Empty local dir falls back to baseDataDir for built-ins, stripping stray non-built-in status entries.
  assert.equal((await fetch(base + '/data/spy.json')).status, 200);
  assert.equal((await fetch(base + '/data/fear-greed.csv')).status, 200);
  assert.equal((await fetch(base + '/data/nasdaq100-etfs.json')).status, 200);
  const initialStatus = await (await fetch(base + '/data/status.json')).json();
  assert.equal(initialStatus.results.some(r => r.symbol === 'LEAK'), false);
  assert.equal(initialStatus.requestedSources.includes('LEAK'), false);
  assert.equal((await fetch(base + '/data/status.json', { method: 'HEAD' })).status, 200);
  assert.deepEqual(await (await fetch(base + '/data/custom-symbols.json')).json(), []);
  assert.equal((await fetch(base + '/data/leak.json')).status, 404);

  // If custom-symbols.json exists locally while local status.json is missing, complete must be false.
  await writeFile(path.join(dataDir, 'custom-symbols.json'), '["GOOGL"]\n');
  const missingCustomStatus = await (await fetch(base + '/data/status.json')).json();
  assert.equal(missingCustomStatus.complete, false);
  await rm(path.join(dataDir, 'custom-symbols.json'));

  const baseStatusBefore = await readFile(path.join(baseDataDir, 'status.json'), 'utf8');
  const baseFilesBefore = (await readdir(baseDataDir)).sort();

  // Adding and deleting personal symbol only modifies dataDir, never baseDataDir.
  const addRes = await fetch(base + '/api/symbols', {
    method: 'POST',
    body: JSON.stringify({ symbol: 'GOOGL' })
  });
  assert.equal(addRes.status, 200);
  assert.deepEqual(await addRes.json(), { symbol: 'GOOGL', symbols: ['GOOGL'] });
  assert.deepEqual(await (await fetch(base + '/data/custom-symbols.json')).json(), ['GOOGL']);
  assert.equal(JSON.parse(await readFile(path.join(dataDir, 'googl.json'), 'utf8')).symbol, 'GOOGL');

  const mergedAfterAdd = await (await fetch(base + '/data/status.json')).json();
  assert.ok(mergedAfterAdd.results.some(r => r.symbol === 'GOOGL'));
  assert.ok(mergedAfterAdd.results.some(r => r.symbol === 'SPY'));

  assert.equal(await readFile(path.join(baseDataDir, 'status.json'), 'utf8'), baseStatusBefore);
  assert.deepEqual((await readdir(baseDataDir)).sort(), baseFilesBefore);

  const delRes = await fetch(base + '/api/symbols', {
    method: 'DELETE',
    body: JSON.stringify({ symbol: 'GOOGL' })
  });
  assert.equal(delRes.status, 200);
  assert.deepEqual(await (await fetch(base + '/data/custom-symbols.json')).json(), []);
  assert.equal(await readFile(path.join(baseDataDir, 'status.json'), 'utf8'), baseStatusBefore);
});

test('分层存储：pull 更新基线目录后自动取更新鲜内置数据并保留本地自选股，本地刷新不污染基线', async t => {
  const dataDir = await makeTempDir(t, 'dca-local-refresh-');
  const baseDataDir = await makeTempDir(t, 'dca-base-refresh-');
  await seedBaseDir(baseDataDir);

  await addCustomSymbol('GOOGL', {
    dataDir,
    baseDataDir,
    now: Date.parse('2025-01-07T23:00Z'),
    fetchText: async () => JSON.stringify(yahooPayload('GOOGL', '2025-01-06T15:00:00Z'))
  });

  // Simulate git pull updating baseDataDir to 2025-01-07 while local status.json is still on 2025-01-06.
  await writeFile(path.join(baseDataDir, 'spy.json'),
    JSON.stringify(marketSnapshot('SPY', ['2025-01-06', '2025-01-07'])));
  await writeFile(path.join(baseDataDir, 'fear-greed.csv'),
    'Date,Fear Greed,Rating\n2020-01-02,50,Neutral\n2025-01-06,55,Greed\n2025-01-07,60,Greed\n');
  await writeFile(path.join(baseDataDir, 'nasdaq100-etfs.json'),
    JSON.stringify({ version: 1, groupId: 'nasdaq100', checkedAt: '2025-01-08T02:00:00.000Z', ok: true, rows: [{ code: '159941', quoteDate: '2025-01-07' }] }));
  await writeFile(path.join(baseDataDir, 'status.json'),
    JSON.stringify(baseStatus({ date: '2025-01-07', checkedAt: '2025-01-08T02:00:00.000Z' }), null, 2) + '\n');

  const server = createServer({ dataDir, baseDataDir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  const spy = await (await fetch(base + '/data/spy.json')).json();
  assert.equal(spy.anchorDate, '2025-01-07');
  assert.match(await (await fetch(base + '/data/fear-greed.csv')).text(), /2025-01-07/);
  assert.equal((await (await fetch(base + '/data/nasdaq100-etfs.json')).json()).rows[0].quoteDate, '2025-01-07');

  const status = await (await fetch(base + '/data/status.json')).json();
  assert.equal(status.expectedDate, '2025-01-07');
  assert.equal(status.results.find(r => r.symbol === 'SPY').date, '2025-01-07');
  assert.equal(status.results.find(r => r.symbol === 'GOOGL').date, '2025-01-06');
  assert.equal(status.complete, false);

  // Local refresh updates dataDir (preserving baseDataDir history) without touching baseDataDir.
  const baseSpyBefore = await readFile(path.join(baseDataDir, 'spy.json'), 'utf8');
  const baseStatusBefore = await readFile(path.join(baseDataDir, 'status.json'), 'utf8');

  const refreshed = await refreshAll({
    dataDir,
    baseDataDir,
    now,
    wait: async () => {},
    sources: ['SPY', 'GOOGL'],
    fetchText: async url => {
      const symbol = new URL(url).pathname.split('/').at(-1);
      return JSON.stringify(yahooPayload(symbol, ['2025-01-06T15:00:00Z', '2025-01-07T15:00:00Z']));
    }
  });
  assert.equal(refreshed.results.find(r => r.symbol === 'SPY').date, '2025-01-07');
  assert.equal(refreshed.results.find(r => r.symbol === 'GOOGL').date, '2025-01-07');
  assert.equal(await readFile(path.join(baseDataDir, 'spy.json'), 'utf8'), baseSpyBefore);
  assert.equal(await readFile(path.join(baseDataDir, 'status.json'), 'utf8'), baseStatusBefore);

  // Local refresh newer than baseDataDir wins over older baseDataDir data.
  await refreshAll({
    dataDir,
    baseDataDir,
    now: Date.parse('2025-01-09T23:00Z'),
    wait: async () => {},
    sources: ['SPY'],
    fetchText: async () => JSON.stringify(yahooPayload('SPY', [
      '2025-01-06T15:00:00Z', '2025-01-07T15:00:00Z', '2025-01-08T15:00:00Z'
    ]))
  });
  assert.equal((await (await fetch(base + '/data/spy.json')).json()).anchorDate, '2025-01-08');
  const newerLocalStatus = await (await fetch(base + '/data/status.json')).json();
  assert.equal(newerLocalStatus.results.find(r => r.symbol === 'SPY').date, '2025-01-08');
});

test('分层存储：本地基金更新失败保留错误诊断不被基线掩盖，基线更新后可恢复', async t => {
  const dataDir = await makeTempDir(t, 'dca-local-funds-');
  const baseDataDir = await makeTempDir(t, 'dca-base-funds-');
  await seedBaseDir(baseDataDir);

  const server = createServer({ dataDir, baseDataDir });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;

  // Refresh with includeFunds: true when fund endpoints fail -> must expose failure, not mask with base ok=true.
  const failedAt = Date.parse('2025-01-07T10:00:00Z');
  const result = await refreshAll({
    dataDir,
    baseDataDir,
    now: failedAt,
    wait: async () => {},
    includeFunds: true,
    sources: ['SPY'],
    fetchText: async url => {
      if (url.includes('finance.yahoo.com')) {
        return JSON.stringify(yahooPayload('SPY', ['2025-01-06T15:00:00Z', '2025-01-07T15:00:00Z']));
      }
      throw Error('HTTP 503');
    }
  });
  assert.equal(result.funds.ok, false);

  const fundSnapshot = await (await fetch(base + '/data/nasdaq100-etfs.json')).json();
  assert.equal(fundSnapshot.ok, false);
  assert.match(fundSnapshot.error, /更新失败/);

  const statusAfterFail = await (await fetch(base + '/data/status.json')).json();
  assert.equal(statusAfterFail.funds.ok, false);
  assert.match(statusAfterFail.funds.error, /更新失败/);

  // Newer baseDataDir pull (T3 > failedAt) supersedes the older local failure.
  const newerCheckedAt = '2025-01-08T02:00:00.000Z';
  await writeFile(path.join(baseDataDir, 'nasdaq100-etfs.json'),
    JSON.stringify({ version: 1, groupId: 'nasdaq100', checkedAt: newerCheckedAt, ok: true, rows: [{ code: '159941', quoteDate: '2025-01-07' }] }));
  await writeFile(path.join(baseDataDir, 'status.json'),
    JSON.stringify(baseStatus({ date: '2025-01-07', checkedAt: newerCheckedAt, fundsCheckedAt: newerCheckedAt }), null, 2) + '\n');

  const recoveredFund = await (await fetch(base + '/data/nasdaq100-etfs.json')).json();
  assert.equal(recoveredFund.ok, true);
  assert.equal(recoveredFund.checkedAt, newerCheckedAt);
  const recoveredStatus = await (await fetch(base + '/data/status.json')).json();
  assert.equal(recoveredStatus.funds.ok, true);
  assert.equal(recoveredStatus.funds.checkedAt, newerCheckedAt);

  // Even if base later failed a subsequent check (ok: false, lastAttemptAt: T4) while holding newer quotes (checkedAt: T3 > local T1),
  // stale local (T1) must still accept the newer base data (T3) rather than staying stuck on T1.
  await writeFile(path.join(dataDir, 'nasdaq100-etfs.json'),
    JSON.stringify({ version: 1, groupId: 'nasdaq100', checkedAt: '2025-01-07T01:00:00.000Z', ok: true, rows: [{ code: '159941', quoteDate: '2025-01-06' }] }));
  await writeFile(path.join(dataDir, 'status.json'),
    JSON.stringify(baseStatus({ date: '2025-01-06', checkedAt: '2025-01-07T01:00:00.000Z', fundsCheckedAt: '2025-01-07T01:00:00.000Z' }), null, 2) + '\n');

  const baseFailAttemptAt = '2025-01-08T09:00:00.000Z';
  await writeFile(path.join(baseDataDir, 'nasdaq100-etfs.json'),
    JSON.stringify({ version: 1, groupId: 'nasdaq100', checkedAt: newerCheckedAt, lastAttemptAt: baseFailAttemptAt, ok: false, error: '上游失败', rows: [{ code: '159941', quoteDate: '2025-01-07' }] }));
  const failedNewerBaseStatus = baseStatus({ date: '2025-01-07', checkedAt: baseFailAttemptAt, fundsCheckedAt: newerCheckedAt });
  failedNewerBaseStatus.funds.ok = false;
  failedNewerBaseStatus.funds.lastAttemptAt = baseFailAttemptAt;
  failedNewerBaseStatus.funds.error = '上游失败';
  await writeFile(path.join(baseDataDir, 'status.json'), JSON.stringify(failedNewerBaseStatus, null, 2) + '\n');

  const newerBaseFund = await (await fetch(base + '/data/nasdaq100-etfs.json')).json();
  assert.equal(newerBaseFund.checkedAt, newerCheckedAt);
  assert.equal(newerBaseFund.rows[0].quoteDate, '2025-01-07');
  const newerBaseStatus = await (await fetch(base + '/data/status.json')).json();
  assert.equal(newerBaseStatus.funds.checkedAt, newerCheckedAt);
  assert.equal(newerBaseStatus.funds.ok, false);
});
