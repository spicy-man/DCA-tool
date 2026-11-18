import { isTradingDay, latestClosedSession, nyDate, sessionClose } from '../public/js/domain/trading-calendar.mjs';
import { SYMBOLS } from '../public/js/domain/market.mjs';

function appendStaleSources(sources, now, { status, customSymbols = [] }) {
  const expectedDate = latestClosedSession(now);
  const bySymbol = new Map((status?.results || []).map(r => [r.symbol, r]));
  const merged = [...sources];
  for (const symbol of ['Fear & Greed', ...SYMBOLS, ...customSymbols]) {
    if (merged.includes(symbol)) continue;
    const record = bySymbol.get(symbol);
    if (!record || !record.ok || record.fresh === false || record.missingDates?.length || !record.date || record.date < expectedDate) {
      merged.push(symbol);
    }
  }
  return merged;
}

function parseWeekdays(spec) {
  if (spec === '*') return null;
  const days = new Set();
  for (const part of spec.split(',')) {
    const range = /^([0-7])(?:-([0-7]))?$/.exec(part);
    if (!range) return undefined;
    const start = Number(range[1]);
    const end = range[2] === undefined ? start : Number(range[2]);
    if (start > end) return undefined;
    for (let day = start; day <= end; day++) days.add(day === 7 ? 0 : day);
  }
  return days;
}

// Each workflow entry has one New York hour. Resolve the planned slot rather
// than the runner's hour so a delayed job still refreshes the intended sources.
export function scheduledSources(cron, now = Date.now(), options = {}) {
  const match = /^1 (4|10|13|14|16|17|22) \* \* (\S+)$/.exec(cron);
  const weekdays = match ? parseWeekdays(match[2]) : undefined;
  if (!match || weekdays === undefined) throw Error('未知数据更新时间');
  const hour = Number(match[1]);
  let date = nyDate(now);
  for (let i = 0; i < 8; i++) {
    const noon = Date.parse(date + 'T17:00:00Z');
    const nyHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23'
    }).format(noon));
    const planned = noon + (hour - nyHour) * 3600000 + 60000;
    const weekday = new Date(noon).getUTCDay();
    if (planned <= now && (weekdays === null || weekdays.has(weekday))) {
      const sources = [4, 10, 16, 22].includes(hour) ? ['Fear & Greed'] : [];
      const minutesAfterClose = (planned - sessionClose(date)) / 60000;
      if (isTradingDay(date) && [1, 61].includes(minutesAfterClose)) {
        if (!sources.includes('Fear & Greed')) sources.push('Fear & Greed');
        sources.push(...SYMBOLS);
      }
      return options?.catchUp ? appendStaleSources(sources, now, options) : sources;
    }
    date = new Date(noon - 86400000).toISOString().slice(0, 10);
  }
  throw Error('无法确定计划更新时间');
}
