import { NASDAQ_FUNDS } from '../public/js/domain/nasdaq-funds.mjs';
import { yearsBefore, parsePerformanceHistory, parseBenchmarkHistory, calculateFundPerformance } from '../public/js/domain/fund-performance.mjs';
import { latestClosedSession } from '../public/js/domain/trading-calendar.mjs';

export function performanceHistoryURL(symbol, now) {
  const start = yearsBefore(new Date(now).toISOString().slice(0, 10), 6);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?` +
    `period1=${Date.parse(start) / 1000}&period2=${Math.floor(now / 1000)}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
}

export async function fetchFundPerformance({ fetchText, now, previous, quoteDate, funds = NASDAQ_FUNDS, benchmarkSymbol = 'QQQ', benchmarkSnapshot, loadBenchmarkSnapshot }) {
  const checkedAt = new Date(now).toISOString();
  previous = previous?.version === 2 && previous.benchmark?.code === benchmarkSymbol ? previous : null;
  try {
    if (loadBenchmarkSnapshot) benchmarkSnapshot = await loadBenchmarkSnapshot();
    const load = async (symbol, options) => parsePerformanceHistory(
      JSON.parse(await fetchText(performanceHistoryURL(symbol, now))), options);
    const latest = latestClosedSession(now, 0);
    const qqq = benchmarkSnapshot
      ? parseBenchmarkHistory(benchmarkSnapshot, { symbol: benchmarkSymbol, cutoff: latest })
      : await load(benchmarkSymbol, { symbols: [benchmarkSymbol], currency: 'USD', timezone: 'America/New_York', cutoff: latest });
    const cutoff = qqq.rows.map(r => r.date).filter(date => date <= quoteDate).at(-1);
    const histories = [];
    // Bound concurrent requests to this public history service.
    for (let i = 0; i < funds.length; i += 3) {
      histories.push(...await Promise.all(funds.slice(i, i + 3).map(async ({ code }) => {
        try {
          const symbol = code + (code.startsWith('5') ? '.SS' : '.SZ');
          const history = await load(symbol, { symbols: [symbol], currency: 'CNY', timezone: 'Asia/Shanghai', cutoff });
          return { code, ok: true, history };
        } catch {
          const old = previous?.rows?.find(row => row.code === code);
          return { ...old, code, ok: false, error: '历史行情更新失败' };
        }
      })));
    }
    // China and US holidays differ. Compare on the latest date actually present
    // in every available history; failed downloads remain excluded per fund.
    const availableDates = histories.filter(row => row.ok)
      .map(row => new Set(row.history.rows.map(price => price.date)));
    const endDate = qqq.rows.map(row => row.date).filter(date => date <= cutoff &&
      availableDates.every(dates => dates.has(date))).at(-1);
    if (!endDate || now - Date.parse(endDate) > 15 * 86400000 || (previous?.endDate && endDate < previous.endDate)) {
      throw Error('同期基准日期无效');
    }
    const rows = histories.map(({ history, ...row }) => history
      ? { ...row, periods: calculateFundPerformance(history, endDate) } : row);
    const benchmarkPeriods = calculateFundPerformance(qqq, endDate);
    return { version: 2, ok: true, complete: Object.values(benchmarkPeriods).every(p => p.status === 'ok') &&
      rows.every(r => r.ok && Object.values(r.periods).every(p => p.status !== 'missing')), endDate, checkedAt, lastAttemptAt: checkedAt,
      source: 'Yahoo Finance', currency: 'native',
      benchmark: { code: benchmarkSymbol, currency: 'USD', price: qqq.rows.find(row => row.date === endDate).rawClose,
        quoteDate: endDate, periods: benchmarkPeriods }, adjustment: 'AdjClose 比值（分红、拆分调整后的前复权收益）', rows };
  } catch {
    return { ...(previous || { version: 2, rows: [], checkedAt: null }), ok: false, lastAttemptAt: checkedAt,
      error: '历史收益更新失败，保留上次有效区间' };
  }
}
