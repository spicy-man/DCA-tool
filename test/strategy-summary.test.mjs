import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFunding, nextMonthlyPlan } from '../public/js/domain/strategy-summary.mjs';
import { evaluateFearStrategy, calculateFearSignals } from '../public/js/domain/fear-strategy.mjs';
import { calculatePyramidSignals } from '../public/js/domain/pyramid-strategy.mjs';

const market = dates => dates.map(date => ({ date, high: 100, close: 100 }));

test('执行月合计顺延月度及同日恐慌信号，月均包含零投入月份', () => {
  const rows = market(['2026-01-30', '2026-02-02', '2026-02-27', '2026-03-02', '2026-03-31']);
  const monthly = calculatePyramidSignals(rows, { buyDay: 31, baseAmount: 123.45 }).map(s => ({ ...s, type: 'monthly' }));
  const signals = [...monthly, { date: '2026-03-02', type: 'fear', amount: 123.45 }];
  const result = summarizeFunding(signals, rows, { start: '2026-01-01', end: '2026-03-31' });
  assert.equal(result.start, '2026-01-30');
  assert.equal(result.months, 3);
  assert.equal(result.count, 4);
  assert.ok(Math.abs(result.monthlyAmount - 370.35) < 1e-9);
  assert.equal(result.fearAmount, 123.45);
  assert.ok(Math.abs(result.total - 493.8) < 1e-9);
  assert.ok(Math.abs(result.average - 164.6) < 1e-9);
  assert.ok(Math.abs(result.peak - 370.35) < 1e-9);
  assert.deepEqual(result.peakMonths, ['2026-03']);
  const feb = summarizeFunding(signals, rows, { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(feb.total, 123.45);
  assert.equal(feb.months, 1);
});

test('覆盖范围裁剪、空行情、零信号和并列最高月份', () => {
  const rows = market(['2025-12-31', '2026-03-31']);
  assert.equal(summarizeFunding([], [], { start: '2026-01-01', end: '2026-03-31' }), null);
  assert.equal(summarizeFunding([], rows, { start: '2024-01-01', end: '2024-12-31' }), null);
  const zero = summarizeFunding([], rows, { start: '2025-12-01', end: '2026-04-30' });
  assert.equal(zero.months, 4);
  assert.equal(zero.total, 0);
  assert.equal(zero.average, 0);
  assert.deepEqual(zero.peakMonths, []);
  const result = summarizeFunding([
    { date: '2026-01-05', type: 'monthly', amount: 100 },
    { date: '2026-02-05', type: 'fear', amount: 100 }
  ], rows, { start: '2026-01-01', end: '2026-02-28' });
  assert.deepEqual(result.peakMonths, ['2026-01', '2026-02']);
});

test('下一月度计划覆盖28至31日、平闰年二月和跨年', () => {
  for (const year of [2024, 2025]) {
    for (const buyDay of [28, 29, 30, 31]) {
      const rows = market([year + '-01-31']);
      const signals = calculatePyramidSignals(rows, { buyDay });
      const plan = nextMonthlyPlan(rows, signals, buyDay);
      assert.equal(plan.scheduledDate, year + '-02-' + Math.min(buyDay, year === 2024 ? 29 : 28));
    }
  }
  const rows = market(['2025-12-31']);
  assert.equal(nextMonthlyPlan(rows, calculatePyramidSignals(rows), 1).scheduledDate, '2026-01-01');
  assert.equal(nextMonthlyPlan([], [], 31), null);
});

test('休市待执行计划保留所属月份，顺延执行后才推进', () => {
  const rows = market(['2026-01-30']);
  assert.equal(nextMonthlyPlan(rows, calculatePyramidSignals(rows, { buyDay: 31 }), 31).scheduledDate, '2026-01-31');
  rows.push(...market(['2026-02-02']));
  assert.equal(nextMonthlyPlan(rows, calculatePyramidSignals(rows, { buyDay: 31 }), 31).scheduledDate, '2026-02-28');
  rows.push(...market(['2026-03-02']));
  assert.equal(nextMonthlyPlan(rows, calculatePyramidSignals(rows, { buyDay: 31 }), 31).scheduledDate, '2026-03-31');
});

test('恐慌状态与原信号共用下穿和重置规则，未确认执行不计入投入', () => {
  const rows = market(['2026-01-02', '2026-01-05']);
  const sentiment = [
    { date: '2026-01-02', score: 16 },
    { date: '2026-01-05', score: 9 }
  ];
  let result = evaluateFearStrategy(rows, sentiment);
  assert.equal(result.armed, false);
  assert.equal(result.signals.length, 0);
  assert.equal(result.pending[0].signalDate, '2026-01-05');
  rows.push(...market(['2026-01-06']));
  result = evaluateFearStrategy(rows, sentiment);
  assert.equal(result.pending.length, 0);
  assert.deepEqual(result.signals, calculateFearSignals(rows, sentiment));
  assert.equal(result.signals[0].date, '2026-01-06');
  sentiment.push({ date: '2026-01-06', score: 14.99 });
  assert.equal(evaluateFearStrategy(rows, sentiment).armed, false);
  sentiment.push({ date: '2026-01-07', score: 15 });
  assert.equal(evaluateFearStrategy(rows, sentiment).armed, true);
  assert.equal(evaluateFearStrategy(rows, []).latest, null);
  const preInception = evaluateFearStrategy(market(['2026-01-06']), sentiment.slice(0, 2));
  assert.equal(preInception.pending.length, 0);
  assert.equal(preInception.signals.length, 0);
});

test('摘要使用完整历史状态和选区统计，数据失效时清除旧金额', async t => {
  const { renderStrategySummary } = await import('../public/js/features/strategy/summary.mjs');
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const nodes = new Map();
  globalThis.document = { getElementById(id) {
    if (!nodes.has(id)) nodes.set(id, { textContent: '' });
    return nodes.get(id);
  } };
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else delete globalThis.document;
  });
  const text = id => nodes.get(id).textContent;
  const rows = market(['2026-01-02', '2026-02-02']);
  const signals = calculatePyramidSignals(rows).map(signal => ({ ...signal, type: 'monthly' }));
  const settings = { buyDay: 1, baseAmount: 1000, fearThreshold: 10 };
  const fear = evaluateFearStrategy(rows, [{ date: '2026-02-02', score: 9 }]);
  const data = { symbol: 'VOO', rows };
  renderStrategySummary(data, { start: '2026-01-01', end: '2026-02-28' }, settings, signals, fear);
  assert.equal(text('funding-total'), '2,000.00（2N）');
  assert.equal(text('recent-signal'), '2026-02-02');
  renderStrategySummary(data, { start: '2026-01-01', end: '2026-01-31' }, settings, signals, fear);
  assert.equal(text('funding-total'), '1,000.00（1N）');
  assert.equal(text('recent-signal'), '2026-02-02');
  renderStrategySummary(data, { start: '2025-01-01', end: '2025-12-31' }, settings, signals, fear);
  assert.equal(text('funding-total'), '—');
  assert.equal(text('funding-split'), '');
  renderStrategySummary(null, null, settings);
  assert.equal(text('funding-total'), '—');
  assert.equal(text('next-plan'), '等待行情数据');
  assert.equal(text('fear-state-note'), '');
});

test('基础、金字塔超额和恐慌投入独立拆分，避免加投倍数重复计算基础金额', () => {
  const rows = market(['2026-02-02', '2026-03-02']);
  const signals = [
    { type: 'monthly', date: '2026-02-02', amount: 100.25, baseAmount: 100.25, multiple: 1 },
    { type: 'monthly', date: '2026-03-02', amount: 401, baseAmount: 100.25, multiple: 4 },
    { type: 'monthly', date: '2026-03-02', amount: 200.5, baseAmount: 100.25, multiple: 2 },
    { type: 'fear', date: '2026-03-02', amount: 100.25 }
  ];
  const result = summarizeFunding(signals, rows, { start: '2026-02-01', end: '2026-03-31' });
  assert.equal(result.regularAmount, 300.75);
  assert.equal(result.pyramidExtraAmount, 401);
  assert.equal(result.fearAmount, 100.25);
  assert.equal(result.monthlyCount, 3);
  assert.equal(result.pyramidCount, 2);
  assert.equal(result.fearCount, 1);
  assert.equal(result.total, result.regularAmount + result.pyramidExtraAmount + result.fearAmount);
  const zero = summarizeFunding([], rows, { start: '2026-02-01', end: '2026-03-31' });
  for (const key of ['regularAmount', 'pyramidExtraAmount', 'monthlyCount', 'pyramidCount', 'fearAmount', 'fearCount']) assert.equal(zero[key], 0);
  const march = summarizeFunding(signals, rows, { start: '2026-03-01', end: '2026-03-31' });
  assert.equal(march.regularAmount, 200.5);
  assert.equal(march.pyramidExtraAmount, 401);
});
