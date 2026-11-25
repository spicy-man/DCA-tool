import { isTradingDay, latestClosedSession, nyDate, sessionClose } from '../public/js/domain/trading-calendar.mjs';
import { SYMBOLS } from '../public/js/domain/market.mjs';
import { isSourceHealthy } from '../public/js/domain/data-health.mjs';

export const FUND_SCHEDULES = Object.freeze([
  '11 9 * * 2-6',
  '17 15 * * 1-6',
  '23 21 * * 1-6'
]);

const FUND_SCHEDULE_SET = new Set(FUND_SCHEDULES);
const ALLOWED_NY_HOURS = new Set([4, 10, 13, 14, 16, 17, 18, 22]);
const FNG_HOURS = new Set([4, 10, 16, 22]);

function appendStaleSources(sources, now, { status, customSymbols = [] }) {
  const expectedDate = latestClosedSession(now);
  const bySymbol = new Map((status?.results || []).map(r => [r.symbol, r]));
  const merged = [...sources];
  for (const symbol of ['Fear & Greed', ...SYMBOLS, ...customSymbols]) {
    if (merged.includes(symbol)) continue;
    const record = bySymbol.get(symbol);
    if (!isSourceHealthy(record, expectedDate)) {
      merged.push(symbol);
    }
  }
  return merged;
}

function parseRangeSpec(spec, min, max, mapValue = v => v) {
  if (spec === '*') return null;
  const values = new Set();
  for (const part of spec.split(',')) {
    const range = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(part);
    if (!range) return undefined;
    const start = Number(range[1]);
    const end = range[2] === undefined ? start : Number(range[2]);
    if (start < min || end > max || start > end) return undefined;
    for (let value = start; value <= end; value++) values.add(mapValue(value));
  }
  return values;
}

/**
 * Resolve scheduled US sources and domestic ETF flag for a workflow cron entry.
 * Keep FUND_SCHEDULES and ALLOWED_NY_HOURS in sync with .github/workflows/pages.yml.
 */
export function scheduledPlan(cron, now = Date.now(), options = {}) {
  if (typeof cron !== 'string') throw Error('未知数据更新时间');
  if (FUND_SCHEDULE_SET.has(cron)) {
    const sources = options?.catchUp ? appendStaleSources([], now, options) : [];
    return { sources, funds: true };
  }
  const match = /^(\d{1,2}) (\d{1,2}) \* (\S+) (\S+)$/.exec(cron);
  const minute = match ? Number(match[1]) : NaN;
  const hour = match ? Number(match[2]) : NaN;
  const months = match ? parseRangeSpec(match[3], 1, 12) : undefined;
  const weekdays = match ? parseRangeSpec(match[4], 0, 7, day => (day === 7 ? 0 : day)) : undefined;
  if (
    !match ||
    minute < 0 || minute > 59 ||
    !ALLOWED_NY_HOURS.has(hour) ||
    months === undefined ||
    weekdays === undefined
  ) {
    throw Error('未知数据更新时间');
  }

  let date = nyDate(now);
  for (let i = 0; i < 8; i++) {
    const noon = Date.parse(date + 'T17:00:00Z');
    const nyHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23'
    }).format(noon));
    const planned = noon + (hour - nyHour) * 3600000 + minute * 60000;
    const weekday = new Date(noon).getUTCDay();
    const month = Number(date.slice(5, 7));
    if (
      planned <= now &&
      (months === null || months.has(month)) &&
      (weekdays === null || weekdays.has(weekday))
    ) {
      const sources = FNG_HOURS.has(hour) ? ['Fear & Greed'] : [];
      const minutesAfterClose = (planned - sessionClose(date)) / 60000;
      if (isTradingDay(date) && minutesAfterClose >= 1 && minutesAfterClose <= 120) {
        if (!sources.includes('Fear & Greed')) sources.push('Fear & Greed');
        sources.push(...SYMBOLS);
      }
      return {
        sources: options?.catchUp ? appendStaleSources(sources, now, options) : sources,
        funds: false
      };
    }
    date = new Date(noon - 86400000).toISOString().slice(0, 10);
  }
  throw Error('无法确定计划更新时间');
}

export function scheduledSources(cron, now = Date.now(), options = {}) {
  return scheduledPlan(cron, now, options).sources;
}
