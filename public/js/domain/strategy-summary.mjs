import { calculatePyramidSignals, daysInMonth, previousMonthCutoff, pyramidMultiple } from './pyramid-strategy.mjs';
import { buildPortfolioOrders, comparePortfolioStrategies } from './backtest.mjs';
import { evaluateFearStrategy } from './fear-strategy.mjs';
import { calculateKDSignals } from './kd-strategy.mjs';
import { isTradingDay } from './trading-calendar.mjs';

// Use the next execution's window and only its known daily bars; future prices can change the estimate.
export function estimateMonthlyBuy(rows, baseAmount, expectedDate, lastExecutionDate) {
  if (!rows.length) return null;
  const latest = rows.at(-1);
  if (lastExecutionDate && latest.date <= lastExecutionDate) return null;
  const cutoff = previousMonthCutoff(expectedDate);
  const knownRows = rows.filter(row => row.date >= cutoff && row.date <= expectedDate);
  if (!knownRows.length) return null;
  const monthHigh = Math.max(...knownRows.map(row => row.high));
  const drawdown = Math.max(0, 1 - latest.close / monthHigh);
  const { multiple } = pyramidMultiple(drawdown);
  return { date: latest.date, cutoff, drawdown, multiple, amount: baseAmount * multiple };
}

// Next unrepresented monthly plan and its calendar estimate, subject to available data.
export function nextMonthlyPlan(rows, monthlySignals, buyDay) {
  if (!rows.length) return null;
  const last = monthlySignals.at(-1);
  let [year, month] = (last?.scheduledMonth || rows[0].date.slice(0, 7)).split('-').map(Number);
  if (last) {
    month++;
    if (month === 13) { year++; month = 1; }
  }
  const scheduledMonth = year + '-' + String(month).padStart(2, '0');
  const scheduledDate = scheduledMonth + '-' + String(Math.min(buyDay, daysInMonth(year, month))).padStart(2, '0');
  let expectedDate = scheduledDate;
  while (!isTradingDay(expectedDate)) {
    expectedDate = new Date(Date.parse(expectedDate + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  }
  return {
    scheduledMonth,
    scheduledDate,
    expectedDate
  };
}

function summarizeAnnualPeak(monthly) {
  const annual = new Map();
  for (const [month, amount] of monthly) {
    const year = month.slice(0, 4);
    annual.set(year, (annual.get(year) || 0) + amount);
  }
  const annualPeak = Math.max(0, ...annual.values());
  const peakYears = annualPeak > 0
    ? [...annual].filter(([, amount]) => Math.abs(amount - annualPeak) < 1e-9).map(([year]) => year).sort()
    : [];
  return { annualPeak, peakYears };
}

// Group by signal date, including zero-signal months in the covered range.
export function summarizeFunding(signals, rows, { start, end }) {
  if (!rows.length) return null;
  start = start > rows[0].date ? start : rows[0].date;
  end = end < rows.at(-1).date ? end : rows.at(-1).date;
  if (start > end) return null;
  const monthIndex = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const months = monthIndex(end) - monthIndex(start) + 1;
  const monthly = new Map();
  let monthlyAmount = 0;
  let fearAmount = 0;
  let regularAmount = 0;
  let monthlyCount = 0;
  let pyramidCount = 0;
  let fearCount = 0;
  let count = 0;
  for (const signal of signals) {
    if (signal.date < start || signal.date > end) continue;
    if (signal.type === 'fear') {
      fearAmount += signal.amount;
      fearCount++;
    } else {
      monthlyAmount += signal.amount;
      const base = signal.baseAmount ?? signal.amount / (signal.multiple || 1);
      regularAmount += base;
      monthlyCount++;
      if (signal.amount > base) pyramidCount++;
    }
    const month = signal.date.slice(0, 7);
    monthly.set(month, (monthly.get(month) || 0) + signal.amount);
    count++;
  }
  const pyramidExtraAmount = monthlyAmount - regularAmount;
  const total = monthlyAmount + fearAmount;
  const peak = Math.max(0, ...monthly.values());
  const peakMonths = [...monthly].filter(([, amount]) => amount === peak).map(([month]) => month).sort();
  return { start, end, months, count, total, monthlyAmount, regularAmount, pyramidExtraAmount, monthlyCount, pyramidCount, fearAmount, fearCount, average: total / months, peak, peakMonths, ...summarizeAnnualPeak(monthly) };
}

export function summarizePortfolioFunding({ items, sentiment, buyDay = 1, fearThreshold = 10, mode = 'equal', totalBaseAmount = 0, kdOptions = null, plan = 'pyramidFear' }) {
  if (!sentiment?.length || !items?.length) return null;
  if (!['pyramidFear', 'kdFear'].includes(plan)) throw Error('组合定投方案无效');
  if (plan === 'kdFear' && kdOptions === null) throw Error('加权K组合缺少有效参数');
  const fngStart = sentiment[0].date;
  let start = null;
  let end = null;
  const monthly = new Map();
  const byMonthSymbol = new Map();
  const backtestItems = [];
  let total = 0;
  let count = 0;
  for (const { symbol, rows, baseAmount, fearBuyCount = 1 } of items) {
    if (!rows?.length || !Number.isFinite(baseAmount) || baseAmount < 0.01) continue;
    const itemStart = rows[0].date > fngStart ? rows[0].date : fngStart;
    const itemEnd = rows.at(-1).date;
    if (itemStart > itemEnd) continue;
    if (!start || itemStart < start) start = itemStart;
    if (!end || itemEnd > end) end = itemEnd;
    const monthlySignals = calculatePyramidSignals(rows, { buyDay, baseAmount });
    const fearSignals = fearBuyCount > 0
      ? evaluateFearStrategy(rows, sentiment, { baseAmount, fearThreshold, fearBuyCount }).signals
      : [];
    const kdSignals = kdOptions === null
      ? null
      : calculateKDSignals(rows, monthlySignals, { ...kdOptions, baseAmount });
    backtestItems.push({ symbol, rows, monthlySignals, fearSignals, baseAmount, kdSignals });
    const selectedSignals = plan === 'kdFear' ? kdSignals : monthlySignals;
    const orders = buildPortfolioOrders({ rows, monthlySignals: selectedSignals, fearSignals, start: itemStart, end: itemEnd });
    for (const order of [...orders.monthly, ...orders.fear]) {
      const month = order.date.slice(0, 7);
      monthly.set(month, (monthly.get(month) || 0) + order.amount);
      if (!byMonthSymbol.has(month)) byMonthSymbol.set(month, new Map());
      const symbolMap = byMonthSymbol.get(month);
      symbolMap.set(symbol, (symbolMap.get(symbol) || 0) + order.amount);
      total += order.amount;
      count++;
    }
  }
  if (!start || !end || start > end) return null;
  const monthIndex = date => Number(date.slice(0, 4)) * 12 + Number(date.slice(5, 7)) - 1;
  const months = monthIndex(end) - monthIndex(start) + 1;
  const peak = Math.max(0, ...monthly.values());
  const peakMonths = peak > 0
    ? [...monthly].filter(([, amount]) => Math.abs(amount - peak) < 1e-9).map(([month]) => month).sort()
    : [];
  const peakMonth = peakMonths[0] || null;
  const peakBreakdown = peakMonth
    ? items
        .map(({ symbol }) => ({ symbol, amount: byMonthSymbol.get(peakMonth)?.get(symbol) || 0 }))
        .filter(entry => entry.amount > 0)
    : [];
  const backtest = comparePortfolioStrategies({ items: backtestItems, startDate: fngStart, mode, totalBaseAmount });
  return { plan, start, end, months, count, total, average: total / months, peak, peakMonths, peakBreakdown, ...summarizeAnnualPeak(monthly), backtest };
}
