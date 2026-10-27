import { fundNumber } from './nasdaq-funds.mjs';

export const PERFORMANCE_YEARS = Object.freeze([1, 3, 5]);

export function yearsBefore(date, years) {
  const [year, month, day] = date.split('-').map(Number);
  const target = year - years;
  const lastDay = new Date(Date.UTC(target, month, 0)).getUTCDate();
  return `${target}-${String(month).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

export function parsePerformanceHistory(payload, { symbols, currency, timezone, cutoff }) {
  const result = payload?.chart?.result?.[0];
  if (payload?.chart?.error || !result || !symbols.includes(result.meta?.symbol) || result.meta.currency !== currency) {
    throw Error('历史行情标的或币种不匹配');
  }
  const times = result.timestamp;
  const raw = result.indicators?.quote?.[0]?.close;
  const values = result.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(times) || !Array.isArray(values) || !Array.isArray(raw) || values.length !== times.length || raw.length !== times.length) throw Error('缺少复权历史');
  const format = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const rows = [];
  for (let i = 0; i < times.length; i++) {
    if (!Number.isFinite(times[i])) throw Error('历史日期无效');
    const date = format.format(new Date(times[i] * 1000));
    if (date > cutoff) continue;
    // Exclude empty bars; never substitute unadjusted prices.
    if (raw[i] == null && values[i] == null) continue;
    const close = fundNumber(values[i]);
    if (!(close > 0) || !(fundNumber(raw[i]) > 0) || (rows.length && date <= rows.at(-1).date)) {
      throw Error('历史价格缺失或日期无序');
    }
    rows.push({ date, close, rawClose: fundNumber(raw[i]) });
  }
  if (!rows.length) throw Error('历史行情为空');
  const firstTradeDate = result.meta.firstTradeDate;
  return { rows, firstDate: Number.isFinite(firstTradeDate) ? format.format(new Date(firstTradeDate * 1000)) : rows[0].date };
}

export function parseBenchmarkHistory(snapshot, { symbol = 'QQQ', cutoff } = {}) {
  if (snapshot?.symbol !== symbol || snapshot?.currency !== 'USD' || !Array.isArray(snapshot.rows)) {
    throw Error('本地基准行情无效');
  }
  const rows = [];
  for (const row of snapshot.rows) {
    if (!row?.date || row.date > cutoff) continue;
    const close = fundNumber(row.adjClose ?? row.close);
    const rawClose = fundNumber(row.sourceClose ?? row.close);
    if (!(close > 0) || !(rawClose > 0) || (rows.length && row.date <= rows.at(-1).date)) {
      throw Error('历史价格缺失或日期无序');
    }
    rows.push({ date: row.date, close, rawClose });
  }
  if (!rows.length) throw Error('历史行情为空');
  return { rows, firstDate: snapshot.rows[0]?.date || rows[0].date };
}

export function calculateFundPerformance(history, endDate) {
  const prices = new Map(history.rows.map(r => [r.date, r.close]));
  const dates = history.rows.map(r => r.date).filter(date => date <= endDate);
  const periods = {};
  for (const years of PERFORMANCE_YEARS) {
    const target = yearsBefore(endDate, years);
    if (history.firstDate > target) {
      periods[years] = { status: 'short-history', years, endDate };
      continue;
    }
    const startDate = dates.filter(date => date <= target).at(-1);
    if (!prices.has(endDate) || !startDate || Date.parse(target) - Date.parse(startDate) > 14 * 86400000) {
      periods[years] = { status: 'missing', years, endDate };
      continue;
    }
    periods[years] = { status: 'ok', years, startDate, endDate,
      return: (prices.get(endDate) / prices.get(startDate) - 1) * 100 };
  }
  return periods;
}

export function performanceRows(rows, performance) {
  return rows.map(row => {
    const entry = performance?.version === 2 ? performance.rows?.find(item => item.code === row.code) : null;
    const next = { ...row, periods: entry?.ok ? entry.periods : null, performanceError: entry?.ok === false };
    for (const years of PERFORMANCE_YEARS) {
      const period = next.periods?.[years];
      next['return' + years] = period?.status === 'ok' ? period.return : null;
    }
    return next;
  });
}
