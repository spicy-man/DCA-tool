import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePortfolioStrategies, compareStrategies, riskAdjustedMetrics } from '../public/js/domain/backtest.mjs';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('恒价下多次入金在单标的和组合回测中不产生回撤或风险比率', () => {
  const rows = ['01-02', '01-03', '02-01', '02-02', '02-05']
    .map(date => ({ date: '2024-' + date, open: 19, close: 19 }));
  const start = rows[0].date;
  const end = rows.at(-1).date;
  const monthlySignals = [rows[0], rows[2]].map(({ date }) => ({ date, amount: 1000 }));
  const item = { symbol: 'A', rows, monthlySignals, fearSignals: [], baseAmount: 1000 };
  const single = compareStrategies({ ...item, range: { start, end }, mode: 'actual' });
  const portfolio = comparePortfolioStrategies({ items: [item], startDate: start, mode: 'actual' });
  for (const { results } of [single, portfolio]) {
    const { invested, maxDrawdown, sharpe, sortino, mar } = results[0];
    assert.equal(invested, 2000);
    assert.deepEqual({ maxDrawdown, sharpe, sortino, mar }, { maxDrawdown: 0, sharpe: null, sortino: null, mar: null });
  }
});

test('恒定非零日收益不产生夏普值，真实小波动仍参与计算', () => {
  const curve = [1.1, 1.21, 1.331].map((nav, i) => ({
    date: '2024-01-0' + (i + 2), invested: 1000, nav
  }));
  assert.equal(riskAdjustedMetrics(curve, 0).sharpe, null);
  const variable = curve.map((point, i) => i === 1 ? { ...point, nav: point.nav + 1e-10 } : point);
  assert.ok(Number.isFinite(riskAdjustedMetrics(variable, 0).sharpe));
});

test('夏普和索提诺按单位净值日收益计算，外部入金不改变结果', () => {
  const curve = [
    { date: '2024-01-02', invested: 1000, nav: 1.2 },
    { date: '2024-01-03', invested: 1000, nav: 1.08 },
    { date: '2024-01-04', invested: 3000, nav: 1.08 }
  ];
  const { sharpe, sortino } = riskAdjustedMetrics(curve, 0.1);
  const returns = [0.2, -0.1, 0];
  const mean = returns.reduce((sum, value) => sum + value, 0) / 3;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / 3;
  const downside = 0.01 / 3;
  near(sharpe, mean / Math.sqrt(variance) * Math.sqrt(252));
  near(sortino, mean / Math.sqrt(downside) * Math.sqrt(252));
  assert.deepEqual(riskAdjustedMetrics(curve.map(point => ({ ...point, invested: 1000 })), 0.1), riskAdjustedMetrics(curve, 0.1));
});

test('MAR使用单位净值年化收益除以最大回撤；无有效分母显示空值', () => {
  const curve = [
    { date: '2023-01-02', invested: 1000, nav: 1.2 },
    { date: '2024-01-02', invested: 1000, nav: 1.08 }
  ];
  const years = 365 / 365;
  near(riskAdjustedMetrics(curve, 0.1).mar, Math.expm1(Math.log(1.08) / years) / 0.1);
  assert.equal(riskAdjustedMetrics(curve, 0).mar, null);
  assert.equal(riskAdjustedMetrics([{ date: '2024-01-02', invested: 0, nav: 1 }], 0).sharpe, null);
  assert.equal(riskAdjustedMetrics([{ date: '2024-01-02', invested: 1000, nav: 1 }], 0).sortino, null);
});
