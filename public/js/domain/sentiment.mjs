import { daysInMonth } from './pyramid-strategy.mjs';
import { periodKey } from './trading-calendar.mjs';

export const OFFICIAL_START = '2021-02-01';

export function rating(score) {
  return score < 25
    ? 'Extreme Fear'
    : score < 45
      ? 'Fear'
      : score < 55
        ? 'Neutral'
        : score < 75
          ? 'Greed'
          : 'Extreme Greed';
}

export function parseCSV(text) {
  const lines = text.trim().replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.shift() !== 'Date,Fear Greed,Rating') throw Error('CSV 列名不匹配');
  const seen = new Set();
  const rows = lines.map(line => {
    const [date, value, label] = line.split(',');
    const score = Number(value);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date ||
      !value?.trim() ||
      !Number.isFinite(score) ||
      score < 0 ||
      score > 100 ||
      seen.has(date)
    ) {
      throw Error('CSV 数据无效或日期重复');
    }
    seen.add(date);
    return {
      date,
      score,
      label: label || rating(score),
      source: date >= OFFICIAL_START ? 'CNN official' : 'Historical archive'
    };
  });
  if (!rows.length) throw Error('没有可用数据');
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export function aggregate(rows, frequency) {
  if (frequency === 'daily') return rows;
  const groups = new Map();
  for (const row of rows) {
    groups.set(periodKey(row.date, frequency), row);
  }
  return [...groups.values()];
}

export function selectRange(rows, range, end = rows.at(-1).date) {
  if (range === 'all') return rows.filter(r => r.date <= end);
  const [year, month, day] = end.split('-').map(Number);
  const totalMonths = year * 12 + (month - 1) - Number(range);
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12 + 1;
  const targetDay = Math.min(day, daysInMonth(targetYear, targetMonth));
  const start = `${String(targetYear).padStart(4, '0')}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
  return rows.filter(r => r.date >= start && r.date <= end);
}
