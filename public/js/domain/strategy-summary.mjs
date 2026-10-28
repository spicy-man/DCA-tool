import { daysInMonth, previousMonthCutoff, pyramidMultiple } from './pyramid-strategy.mjs';
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

// Group by execution month, including zero-signal months in the covered range.
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
  return { start, end, months, count, total, monthlyAmount, regularAmount, pyramidExtraAmount, monthlyCount, pyramidCount, fearAmount, fearCount, average: total / months, peak, peakMonths };
}
