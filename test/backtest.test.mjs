import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compareStrategies, moneyWeightedReturn, findLatestPeakRecovery } from '../public/js/domain/backtest.mjs';
import { calculatePyramidSignals } from '../public/js/domain/pyramid-strategy.mjs';
import { calculateFearSignals } from '../public/js/domain/fear-strategy.mjs';
import { parseCSV } from '../public/js/domain/sentiment.mjs';

const near = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) < tolerance, actual + ' != ' + expected);
const rows = [
  { date: '2025-01-02', open: 100, close: 80, high: 100 },
  { date: '2025-01-03', open: 50, close: 100, high: 100 },
  { date: '2025-01-06', open: 100, close: 80, high: 100 }
];
const monthlySignals = [{ date: '2025-01-02', amount: 200 }];
const fearSignals = [{ date: '2025-01-06', amount: 100 }];
const input = { rows, monthlySignals, fearSignals, range: { start: '2025-01-01', end: '2025-01-31' }, baseAmount: 100 };

test('前高修复取最近一轮，按自然日计时，平台从最后触及高点起算', () => {
  const curve = [100, 100, 80, 100, 120, 110, 120, 130].map((equity, i) => ({
    date: ['2024-02-27', '2024-02-28', '2024-02-29', '2024-03-04', '2024-03-05', '2024-03-06', '2024-03-08', '2024-03-11'][i],
    equity, invested: 100
  }));
  assert.deepEqual(findLatestPeakRecovery(curve.slice(0, 4)), {
    start: '2024-02-28', end: '2024-03-04', value: 100, recovered: true, days: 5
  });
  assert.deepEqual(findLatestPeakRecovery(curve.slice(0, 6)), {
    start: '2024-03-05', end: '2024-03-06', value: 120, recovered: false, days: 1
  });
  assert.deepEqual(findLatestPeakRecovery(curve), {
    start: '2024-03-05', end: '2024-03-08', value: 120, recovered: true, days: 3
  });
});

test('资产与盈亏独立判断修复，兼容负盈亏、无投入和无回落', () => {
  const curve = [
    { date: '2025-01-02', equity: 0, profit: 0, invested: 0 },
    { date: '2025-01-03', equity: 90, profit: -10, invested: 100 },
    { date: '2025-01-06', equity: 80, profit: -20, invested: 100 },
    { date: '2025-01-07', equity: 180, profit: -20, invested: 200 }
  ];
  assert.deepEqual(findLatestPeakRecovery(curve), {
    start: '2025-01-03', end: '2025-01-07', value: 90, recovered: true, days: 4
  });
  assert.deepEqual(findLatestPeakRecovery(curve, 'profit'), {
    start: '2025-01-03', end: '2025-01-07', value: -10, recovered: false, days: 4
  });
  assert.equal(findLatestPeakRecovery([]), null);
  assert.equal(findLatestPeakRecovery(curve.slice(0, 1)), null);
  assert.equal(findLatestPeakRecovery(curve.slice(0, 2)), null);
  assert.equal(findLatestPeakRecovery([curve[1], { ...curve[3], equity: 90 }]), null);
  assert.equal(findLatestPeakRecovery([curve[1], curve[3]]), null);
});

test('月度收盘信号在后续开盘成交，恐慌信号不再多延迟一天', () => {
  const result = compareStrategies(input);
  const [regular, pyramid, combined] = result.results;
  assert.deepEqual(result.results.map(s => s.invested), [100, 200, 300]);
  assert.deepEqual(result.results.map(s => s.equity), [160, 320, 400]);
  assert.deepEqual(result.results.map(s => s.profit), [60, 120, 100]);
  assert.deepEqual(result.results.map(s => s.trades), [1, 2, 3]);
  assert.equal(regular.curve[0].invested, 0);
  assert.equal(pyramid.curve[1].invested, 200);
  near(combined.maxDrawdown, 0.2);
  assert.ok(result.results.every(s => s.cash === 0));
});

test('相同供资逐日同时注入，余额留现金，资金流不虚增回报或缩小实际投入', () => {
  const result = compareStrategies({ ...input, mode: 'equal' });
  assert.deepEqual(result.results.map(s => s.invested), [300, 300, 300]);
  const interest = 100 * (1.03 ** (3 / 365) - 1);
  near(result.results[0].equity, 360 + interest);
  near(result.results[0].cash, 200 + interest);
  near(result.results[0].profit, 60 + interest);
  near(result.results[0].cashInterest, interest);
  assert.deepEqual(result.results.slice(1).map(s => s.equity), [420, 400]);
  assert.deepEqual(result.results.slice(1).map(s => s.cash), [100, 0]);
  assert.deepEqual(result.results.slice(1).map(s => s.cashInterest), [0, 0]);
  const [regular, pyramid, combined] = result.results;
  near(regular.maxDrawdown, 1 - ((360 + interest) / (200 + 100 / ((300 + interest) / 200))) / 1.5);
  near(pyramid.maxDrawdown, 0.16);
  near(combined.maxDrawdown, 0.2);
  for (let i = 0; i < rows.length; i++) {
    assert.equal(regular.curve[i].invested, combined.curve[i].invested);
    assert.equal(pyramid.curve[i].invested, combined.curve[i].invested);
  }
});

test('年化现金流按实际天数计算，包含负收益、闰日、同日及无解边界', () => {
  near(moneyWeightedReturn([{ date: '2025-01-01', amount: 100 }], '2026-01-01', 110), 0.1);
  near(moneyWeightedReturn([{ date: '2025-01-01', amount: 100 }], '2026-01-01', 50), -0.5);
  const deposits = [{ date: '2024-01-01', amount: 100 }, { date: '2025-01-01', amount: 100 }];
  near(moneyWeightedReturn(deposits, '2026-01-01', 100 * 1.1 ** (731 / 365) + 110), 0.1);
  near(moneyWeightedReturn(deposits, '2026-01-01', 200), 0);
  assert.equal(moneyWeightedReturn([], '2026-01-01', 100), null);
  assert.equal(moneyWeightedReturn([{ date: '2026-01-01', amount: 100 }], '2026-01-01', 100), null);
  assert.equal(moneyWeightedReturn([{ date: '2027-01-01', amount: 100 }], '2026-01-01', 100), null);
  assert.equal(moneyWeightedReturn([{ date: '2025-01-01', amount: 100 }], '2026-01-01', 0), null);
  assert.equal(moneyWeightedReturn([...deposits, { date: '2026-01-01', amount: 100 }], '2026-01-01', 50), null);
});

test('按选区重新建仓，不继承旧持仓；区间末信号不提前成交', () => {
  const result = compareStrategies({ ...input, range: { start: '2025-01-03', end: '2025-01-03' } });
  assert.equal(result.start, '2025-01-03');
  assert.equal(result.results[0].equity, 200);
  assert.equal(result.results[0].xirr, null);
  const pending = compareStrategies({ ...input, monthlySignals: [{ date: '2025-01-06', amount: 200 }], fearSignals: [] });
  assert.equal(pending.deferredMonthly, 1);
  assert.ok(pending.results.every(s => s.invested === 0 && s.xirr === null && s.maxDrawdown === null));
  const outside = compareStrategies({ ...input, range: { start: '2026-01-01', end: '2026-12-31' } });
  assert.equal(outside, null);
  assert.equal(compareStrategies({ ...input, rows: [], monthlySignals: [], fearSignals: [] }), null);
});

test('月末休市跨月信号先确认再成交，两月计划独立保留', () => {
  const calendar = ['2026-01-30', '2026-02-02', '2026-02-03', '2026-02-27', '2026-03-02', '2026-03-03'];
  const daily = calendar.map(date => ({ date, open: 100, close: 100, high: 100 }));
  const result = compareStrategies({ rows: daily, monthlySignals: calculatePyramidSignals(daily, { buyDay: 31, baseAmount: 100 }), fearSignals: [], range: { start: calendar[0], end: calendar.at(-1) }, baseAmount: 100 });
  assert.equal(result.results[0].trades, 2);
  assert.deepEqual(result.results[0].curve.map(p => p.invested), [0, 0, 100, 100, 100, 200]);
  near(result.results[0].xirr, 0);
});

test('恒价入金不产生盈利或回撤；拒绝无序行情及无效金额', () => {
  const daily = rows.map(row => ({ ...row, open: 100, close: 100 }));
  for (const mode of ['actual', 'equal']) {
    const result = compareStrategies({ ...input, rows: daily, mode });
    assert.ok(result.results.every(s => s.maxDrawdown === 0));
    for (const strategy of result.results) near(strategy.profit, strategy.cashInterest);
  }
  assert.throws(() => compareStrategies({ ...input, rows: rows.toReversed() }));
  assert.throws(() => compareStrategies({ ...input, rows: [{ ...rows[0], open: 0 }] }));
  assert.throws(() => compareStrategies({ ...input, baseAmount: NaN }));
  assert.throws(() => compareStrategies({ ...input, mode: 'invalid' }));
  assert.throws(() => compareStrategies({ ...input, monthlySignals: [{ date: rows[0].date, amount: NaN }] }));
});

test('真实SPY/QQQ/VGT资产与独立买入求和一致，截断未来不改历史账户轨迹', async () => {
  const sentiment = parseCSV(await readFile(new URL('../public/data/fear-greed.csv', import.meta.url), 'utf8'));
  for (const symbol of ['spy', 'qqq', 'vgt']) {
    const { rows: daily } = JSON.parse(await readFile(new URL('../public/data/' + symbol + '.json', import.meta.url), 'utf8'));
    const monthly = calculatePyramidSignals(daily, { buyDay: 31, baseAmount: 100 });
    const fear = calculateFearSignals(daily, sentiment, { baseAmount: 100 });
    const range = { start: '2020-01-01', end: '2021-12-31' };
    const referenceMonthly = monthly.map(s => ({ date: daily.find(r => r.date > s.date)?.date, amount: s.amount })).filter(s => s.date >= range.start && s.date <= range.end);
    const referenceFear = fear.filter(s => s.date >= range.start && s.date <= range.end);
    const orders = [referenceMonthly.map(s => ({ ...s, amount: 100 })), referenceMonthly, [...referenceMonthly, ...referenceFear]];
    for (const mode of ['actual', 'equal']) {
      const result = compareStrategies({ rows: daily, monthlySignals: monthly, fearSignals: fear, range, baseAmount: 100, mode });
      const close = daily.find(r => r.date === result.end).close;
      const common = orders[2].reduce((sum, s) => sum + s.amount, 0);
      for (const [i, strategy] of result.results.entries()) {
        const spent = orders[i].reduce((sum, s) => sum + s.amount, 0);
        const asset = orders[i].reduce((sum, s) => sum + s.amount / daily.find(r => r.date === s.date).open * close, 0);
        const futureCash = list => list.reduce((sum, s) => sum + s.amount * 1.03 ** ((Date.parse(result.end) - Date.parse(s.date)) / 86400000 / 365), 0);
        const expectedCash = mode === 'equal' ? futureCash(orders[2]) - futureCash(orders[i]) : 0;
        near(strategy.equity, asset + expectedCash, 1e-6);
        near(strategy.cash, expectedCash, 1e-6);
        near(strategy.cashInterest, expectedCash - (mode === 'equal' ? common - spent : 0), 1e-6);
        near(strategy.invested, mode === 'equal' ? common : spent, 1e-6);
        assert.ok(strategy.maxDrawdown >= 0 && strategy.maxDrawdown < 1);
      }
      const prefix = daily.filter(r => r.date <= '2020-12-31');
      const shorter = compareStrategies({ rows: prefix, monthlySignals: calculatePyramidSignals(prefix, { buyDay: 31, baseAmount: 100 }), fearSignals: calculateFearSignals(prefix, sentiment.filter(s => s.date <= prefix.at(-1).date), { baseAmount: 100 }), range: { ...range, end: '2020-12-31' }, baseAmount: 100, mode });
      for (let i = 0; i < 3; i++) assert.deepEqual(shorter.results[i].curve, result.results[i].curve.filter(p => p.date <= '2020-12-31'));
    }
  }
});

test('现金年化3%覆盖整年、闰日、复利与末日新注资不追溯计息', () => {
  for (const [start, end, days] of [['2023-01-03', '2024-01-03', 365], ['2024-01-03', '2025-01-03', 366]]) {
    const daily = [start, end].map(date => ({ date, open: 100, close: 100 }));
    const result = compareStrategies({ rows: daily, monthlySignals: [], fearSignals: [{ date: start, amount: 100 }, { date: end, amount: 100 }], range: { start, end }, baseAmount: 100, mode: 'equal' });
    const idle = result.results[0];
    const expectedInterest = 100 * (1.03 ** (days / 365) - 1);
    near(idle.cashInterest, expectedInterest);
    near(idle.cash, 200 + expectedInterest);
    near(idle.profit, expectedInterest);
    assert.equal(idle.invested, 200);
    near(idle.xirr, 0.03);
    assert.equal(result.results[2].cashInterest, 0);
  }
  const dates = ['2023-01-03', '2024-01-03', '2025-01-03'];
  const result = compareStrategies({ rows: dates.map(date => ({ date, open: 100, close: 100 })), monthlySignals: [], fearSignals: [{ date: dates[0], amount: 100 }], range: { start: dates[0], end: dates[2] }, baseAmount: 100, mode: 'equal' });
  near(result.results[0].cashInterest, 100 * (1.03 ** (731 / 365) - 1));
});


test('可调恐慌笔数同步改变回测买入与供资，不改变月度策略',()=>{
 const sentiment=[{date:'2025-01-02',score:16},{date:'2025-01-03',score:9}];
 const fear=calculateFearSignals(rows,sentiment,{baseAmount:100,fearBuyCount:3});
 assert.equal(fear[0].amount,300);
 const actual=compareStrategies({...input,fearSignals:fear});
 assert.deepEqual(actual.results.map(s=>s.invested),[100,200,500]);
 assert.deepEqual(actual.results.map(s=>s.equity),[160,320,560]);
 assert.deepEqual(actual.results.map(s=>s.trades),[1,2,5]);
 const equal=compareStrategies({...input,fearSignals:fear,mode:'equal'});
 assert.deepEqual(equal.results.map(s=>s.invested),[500,500,500]);
 assert.equal(equal.results[2].equity,560);
});

test('买入N数包含月度金字塔与三次恐慌加投，资金和资产计算不变', () => {
  const daily = Array.from({ length: 8 }, (_, i) => ({ date: `2025-01-${String(i + 2).padStart(2, '0')}`, open: 100, close: 100, high: 100 }));
  const sentiment = daily.slice(0, 6).map((row, i) => ({ date: row.date, score: i % 2 ? 9 : 16 }));
  const fear = calculateFearSignals(daily, sentiment, { baseAmount: 100, fearBuyCount: 2 });
  assert.equal(fear.length, 3);
  const config = { rows: daily, monthlySignals: [{ date: daily[0].date, amount: 200 }], fearSignals: fear, baseAmount: 100, range: { start: daily[0].date, end: daily.at(-1).date } };
  for (const mode of ['actual', 'equal']) {
    const result = compareStrategies({ ...config, mode });
    assert.deepEqual(result.results.map(s => s.trades), [1, 2, 8]);
    const legacy = compareStrategies({ ...config, mode, fearSignals: fear.map(({ multiple, ...signal }) => signal) });
    for (let i = 0; i < 3; i++) {
      const { trades: actualTrades, ...actual } = result.results[i];
      const { trades: legacyTrades, ...expected } = legacy.results[i];
      assert.deepEqual(actual, expected);
    }
    const narrowed = compareStrategies({ ...config, mode, range: { start: fear[1].date, end: daily.at(-1).date } });
    assert.deepEqual(narrowed.results.map(s => s.trades), [0, 0, 4]);
  }

});
