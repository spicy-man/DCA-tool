import { daysInMonth } from './pyramid-strategy.mjs';

// The next unrepresented monthly plan, not a forecast execution date.
export function nextMonthlyPlan(rows, monthlySignals, buyDay) {
  if (!rows.length) return null;
  const last = monthlySignals.at(-1);
  let [year, month] = (last?.scheduledMonth || rows[0].date.slice(0, 7)).split('-').map(Number);
  if (last) {
    month++;
    if (month === 13) { year++; month = 1; }
  }
  const scheduledMonth = year + '-' + String(month).padStart(2, '0');
  return {
    scheduledMonth,
    scheduledDate: scheduledMonth + '-' + String(Math.min(buyDay, daysInMonth(year, month))).padStart(2, '0')
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
