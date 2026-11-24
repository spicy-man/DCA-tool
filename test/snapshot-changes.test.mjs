import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import {
  hasSubstantiveFundChange,
  hasSubstantiveMarketChange,
  hasSubstantiveStatusChange,
  pruneRedundantSnapshotWrites
} from '../server/snapshot-changes.mjs';

function makeStatus(overrides = {}) {
  return JSON.stringify({
    version: 1,
    checkedAt: '2026-11-14T13:59:42.563Z',
    expectedDate: '2026-11-13',
    requestedSources: ['Fear & Greed', 'SPY'],
    requestedComplete: true,
    complete: true,
    results: [
      {
        symbol: 'Fear & Greed',
        date: '2026-11-13',
        count: 3990,
        source: 'CNN',
        ok: true,
        fresh: true,
        expectedDate: '2026-11-13',
        checkedAt: '2026-11-14T13:59:42.563Z',
        lastSuccessAt: '2026-11-14T13:59:42.563Z'
      },
      {
        symbol: 'SPY',
        date: '2026-11-13',
        count: 1000,
        source: 'Yahoo Finance',
        ok: true,
        fresh: true,
        expectedDate: '2026-11-13',
        checkedAt: '2026-11-14T13:59:42.563Z',
        lastSuccessAt: '2026-11-14T13:59:42.563Z'
      }
    ],
    ...overrides
  }, null, 2) + '\n';
}

function makeFund(overrides = {}) {
  const checkedAt = overrides.checkedAt || '2026-11-14T10:51:34.852Z';
  const rowOverrides = overrides.row || {};
  const perfOverrides = overrides.performance || {};
  return JSON.stringify({
    version: 1,
    source: '东方财富 / 天天基金',
    quoteSource: '东方财富',
    checkedAt,
    lastAttemptAt: checkedAt,
    ok: overrides.ok ?? true,
    rows: [
      {
        code: '513650',
        price: 1.995,
        iopv: 1.8373,
        premium: 8.583,
        amount: 501778085,
        shares: 5241733888,
        quoteDate: '2026-11-13',
        quoteTime: '2026-11-13T08:11:40.000Z',
        netAssets: 8711000000,
        scaleDate: '2026-09-30',
        annualFee: 0.75,
        profileCheckedAt: checkedAt,
        ...rowOverrides
      }
    ],
    performance: {
      version: 2,
      ok: true,
      complete: true,
      endDate: '2026-11-12',
      checkedAt,
      lastAttemptAt: checkedAt,
      source: 'Yahoo Finance',
      currency: 'native',
      benchmark: { code: 'QQQ', quoteDate: '2026-11-13', periods: { 1: { status: 'ok', return: 20 } } },
      rows: [{ code: '513650', ok: true, periods: { 1: { status: 'ok', return: 10 } } }],
      ...perfOverrides
    }
  }, null, 2) + '\n';
}

test('hasSubstantiveStatusChange 忽略纯时间戳与调度子集变化，保留真实状态或行变化', () => {
  const base = makeStatus();
  const timestampOnly = makeStatus({
    checkedAt: '2026-11-14T15:25:57.849Z',
    requestedSources: ['Fear & Greed'],
    results: JSON.parse(base).results.map((r, i) =>
      i === 0 ? { ...r, checkedAt: '2026-11-14T15:25:57.849Z', lastSuccessAt: '2026-11-14T15:25:57.849Z' } : r
    )
  });
  assert.equal(hasSubstantiveStatusChange(base, timestampOnly, false), false);
  assert.equal(hasSubstantiveStatusChange(base, timestampOnly, true), true);

  const incomplete = makeStatus({ complete: false, checkedAt: '2026-11-14T15:25:57.849Z' });
  assert.equal(hasSubstantiveStatusChange(base, incomplete, false), true);
  assert.equal(hasSubstantiveStatusChange(incomplete, timestampOnly, false), true);

  const sourceSwitched = makeStatus({
    results: JSON.parse(base).results.map((r, i) =>
      i === 0 ? { ...r, source: 'whit3rabbit/fear-greed-data', warning: '已使用 GitHub 存档' } : r
    )
  });
  assert.equal(hasSubstantiveStatusChange(base, sourceSwitched, false), true);
});

test('hasSubstantiveFundChange 忽略时间戳与同日停盘份额抖动，保留收益推进及行情更新', () => {
  const base = makeFund();
  const jitterOnly = makeFund({
    checkedAt: '2026-11-14T13:59:43.954Z',
    row: { shares: 5271734016 }
  });
  assert.equal(hasSubstantiveFundChange(base, jitterOnly), false);

  const perfAdvanced = makeFund({
    checkedAt: '2026-11-14T18:05:34.112Z',
    performance: { endDate: '2026-11-13' }
  });
  assert.equal(hasSubstantiveFundChange(base, perfAdvanced), true);

  const priceUpdated = makeFund({
    checkedAt: '2026-11-16T07:05:00.000Z',
    row: { quoteDate: '2026-11-16', quoteTime: '2026-11-16T07:00:00.000Z', price: 2.01 }
  });
  assert.equal(hasSubstantiveFundChange(base, priceUpdated), true);

  const failed = makeFund({ ok: false, checkedAt: '2026-11-14T13:59:43.954Z' });
  assert.equal(hasSubstantiveFundChange(base, failed), true);
});

test('pruneRedundantSnapshotWrites 还原无实质变更的文件，并在真实数据更新时连带保留 status.json', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dca-prune-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const baseline = {
    'fear-greed.csv': 'Date,Fear Greed,Rating\n2026-11-13,38.6,fear\n',
    'spy.json': '{"symbol":"SPY"}\n',
    'qqq.json': '{"symbol":"QQQ"}\n',
    'vgt.json': '{"symbol":"VGT"}\n',
    'smh.json': '{"symbol":"SMH"}\n',
    'brk-b.json': '{"symbol":"BRK-B"}\n',
    'status.json': makeStatus(),
    'nasdaq100-etfs.json': makeFund(),
    'sp500-etfs.json': makeFund()
  };

  for (const [name, content] of Object.entries(baseline)) {
    await writeFile(path.join(dir, name), content);
  }

  // Case 1: Only timestamps and off-hours shares jitter changed -> both fund and status revert.
  await writeFile(path.join(dir, 'status.json'), makeStatus({ checkedAt: '2026-11-15T00:00:00.000Z', requestedSources: ['Fear & Greed'] }));
  await writeFile(path.join(dir, 'nasdaq100-etfs.json'), makeFund({ checkedAt: '2026-11-15T00:00:00.000Z', row: { shares: 999 } }));
  const pruned = await pruneRedundantSnapshotWrites({ dataDir: dir, readBaseline: name => baseline[name] ?? null });
  assert.equal(pruned.marketChanged, false);
  assert.deepEqual(pruned.reverted.sort(), ['nasdaq100-etfs.json', 'status.json']);
  assert.equal(await readFile(path.join(dir, 'status.json'), 'utf8'), baseline['status.json']);
  assert.equal(await readFile(path.join(dir, 'nasdaq100-etfs.json'), 'utf8'), baseline['nasdaq100-etfs.json']);

  // Case 2: Market data CSV updated -> keeps fresh status.json too.
  const nextCsv = 'Date,Fear Greed,Rating\n2026-11-13,39.1,fear\n';
  const nextStatus = makeStatus({ checkedAt: '2026-11-15T01:00:00.000Z' });
  await writeFile(path.join(dir, 'fear-greed.csv'), nextCsv);
  await writeFile(path.join(dir, 'status.json'), nextStatus);
  const kept = await pruneRedundantSnapshotWrites({ dataDir: dir, readBaseline: name => baseline[name] ?? null });
  assert.equal(kept.marketChanged, true);
  assert.deepEqual(kept.reverted, []);
  assert.deepEqual(kept.kept, ['status.json']);
  // Case 3: CRLF working tree vs LF git blob does not count as modified.
  await writeFile(path.join(dir, 'fear-greed.csv'), baseline['fear-greed.csv'].replaceAll('\n', '\r\n'));
  await writeFile(path.join(dir, 'status.json'), baseline['status.json'].replaceAll('\n', '\r\n'));
  await writeFile(path.join(dir, 'nasdaq100-etfs.json'), baseline['nasdaq100-etfs.json'].replaceAll('\n', '\r\n'));
  const unchangedEol = await pruneRedundantSnapshotWrites({ dataDir: dir, readBaseline: name => baseline[name] ?? null });
  assert.deepEqual(unchangedEol, { marketChanged: false, reverted: [], kept: [] });
});

function makeMarketSnapshot(overrides = {}) {
  return JSON.stringify({
    symbol: 'SPY',
    currency: 'USD',
    timezone: 'America/New_York',
    source: 'Yahoo Finance',
    fetchedAt: overrides.fetchedAt || '2026-11-24T02:04:18.384Z',
    anchorDate: overrides.anchorDate || '2026-11-23',
    anchorFactor: overrides.anchorFactor ?? 1,
    adjustment: '前复权',
    rows: overrides.rows || [
      {
        date: '1993-01-29',
        sourceOpen: 43.96875,
        sourceHigh: 43.96875,
        sourceLow: 43.75,
        sourceClose: 43.9375,
        adjClose: 24.053529739379883,
        volume: 1003200,
        factor: 0.5474487565150471,
        open: 24.070637513020976,
        high: 24.070637513020976,
        low: 23.95088309753331,
        close: 24.053529739379883
      },
      {
        date: '2026-11-23',
        sourceOpen: 724.33,
        sourceHigh: 727.98,
        sourceLow: 713.54,
        sourceClose: 722.29,
        adjClose: 722.29,
        volume: 88150300,
        factor: 1,
        open: 724.33,
        high: 727.98,
        low: 713.54,
        close: 722.29
      }
    ]
  });
}

test('hasSubstantiveMarketChange 忽略 fetchedAt 与 float32 级历史抖动，保留真实价格/成交量/新增日/除权修正', async t => {
  const base = makeMarketSnapshot();
  const parsedBase = JSON.parse(base);

  // 1. 仅 fetchedAt 变化 + float32 级微抖动 (rel ~1.36e-6 <= 5e-6)
  const jitterRows = parsedBase.rows.map((r, i) => i === 0
    ? {
        ...r,
        adjClose: 24.05353355407715,
        factor: 0.5474488433360375,
        open: 24.0706413304314,
        high: 24.0706413304314,
        low: 23.95088689595164,
        close: 24.05353355407715
      }
    : r);
  const jitterOnly = makeMarketSnapshot({
    fetchedAt: '2026-11-24T05:47:04.776Z',
    rows: jitterRows
  });
  assert.equal(hasSubstantiveMarketChange(base, jitterOnly), false);

  // 2. 真实 $0.01 收盘低价修正 (rel ~1.4e-5 > 5e-6)
  const priceFixed = makeMarketSnapshot({
    fetchedAt: '2026-11-24T05:03:45.253Z',
    rows: parsedBase.rows.map((r, i) => i === 1 ? { ...r, sourceLow: 713.53, low: 713.53 } : r)
  });
  assert.equal(hasSubstantiveMarketChange(base, priceFixed), true);

  // 3. 真实成交量修正
  const volumeFixed = makeMarketSnapshot({
    fetchedAt: '2026-11-24T05:03:45.253Z',
    rows: parsedBase.rows.map((r, i) => i === 1 ? { ...r, volume: 88150400 } : r)
  });
  assert.equal(hasSubstantiveMarketChange(base, volumeFixed), true);

  // 4. 新增交易日
  const appendedDay = makeMarketSnapshot({
    anchorDate: '2026-11-24',
    rows: [...parsedBase.rows, { ...parsedBase.rows[1], date: '2026-11-24' }]
  });
  assert.equal(hasSubstantiveMarketChange(base, appendedDay), true);

  // 5. 真实除权除息 factor 变化 (> 5e-6)
  const dividendAdjusted = makeMarketSnapshot({
    rows: parsedBase.rows.map((r, i) => i === 0 ? { ...r, factor: r.factor * 0.995 } : r)
  });
  assert.equal(hasSubstantiveMarketChange(base, dividendAdjusted), true);

  // 6. 未知结构或非法 JSON 保守判定为有变更
  assert.equal(hasSubstantiveMarketChange(base, '{"symbol":"SPY"}\n'), true);
  assert.equal(hasSubstantiveMarketChange(base, '{invalid-json'), true);

  // 7. 集成验证：pruneRedundantSnapshotWrites 还原无实质变更的 ETF JSON 与 status.json，真实修订时保留
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dca-market-prune-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const baseline = {
    'fear-greed.csv': 'Date,Fear Greed,Rating\n2026-11-23,16.9,extreme fear\n',
    'spy.json': base,
    'qqq.json': '{"symbol":"QQQ","rows":[]}\n',
    'vgt.json': '{"symbol":"VGT","rows":[]}\n',
    'smh.json': '{"symbol":"SMH","rows":[]}\n',
    'brk-b.json': '{"symbol":"BRK-B","rows":[]}\n',
    'status.json': makeStatus(),
    'nasdaq100-etfs.json': makeFund(),
    'sp500-etfs.json': makeFund()
  };
  for (const [name, content] of Object.entries(baseline)) {
    await writeFile(path.join(dir, name), content);
  }
  await writeFile(path.join(dir, 'spy.json'), jitterOnly);
  await writeFile(path.join(dir, 'status.json'), makeStatus({ checkedAt: '2026-11-24T05:47:04.776Z' }));
  const revertedRun = await pruneRedundantSnapshotWrites({ dataDir: dir, readBaseline: name => baseline[name] ?? null });
  assert.equal(revertedRun.marketChanged, false);
  assert.deepEqual(revertedRun.reverted.sort(), ['spy.json', 'status.json']);
  assert.equal(await readFile(path.join(dir, 'spy.json'), 'utf8'), base);

  await writeFile(path.join(dir, 'spy.json'), priceFixed);
  await writeFile(path.join(dir, 'status.json'), makeStatus({ checkedAt: '2026-11-24T05:03:45.253Z' }));
  const keptRun = await pruneRedundantSnapshotWrites({ dataDir: dir, readBaseline: name => baseline[name] ?? null });
  assert.equal(keptRun.marketChanged, true);
  assert.deepEqual(keptRun.reverted, []);
  assert.deepEqual(keptRun.kept.sort(), ['spy.json', 'status.json']);
});
