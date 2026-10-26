import test from 'node:test';
import assert from 'node:assert/strict';
import { yearsBefore, parsePerformanceHistory, calculateFundPerformance, performanceRows } from '../public/js/domain/fund-performance.mjs';
import { fetchFundPerformance } from '../server/fund-performance.mjs';
import { sortFunds } from '../public/js/domain/nasdaq-funds.mjs';

const dates = ['2021-10-22', '2023-10-23', '2025-10-23', '2026-10-23'];
const history = (values, firstDate = '2015-01-01') => ({ firstDate, rows: dates.map((date, i) => ({ date, close: values[i] })) });
function yahoo(symbol, currency, values = [1, 1.2, 1.5, 2]) {
  return { chart: { error: null, result: [{ meta: { symbol, currency, firstTradeDate: Date.parse('2015-01-01') / 1000 },
    timestamp: dates.map(d => Date.parse(d + 'T12:00Z') / 1000),
    indicators: { quote: [{ close: values }], adjclose: [{ adjclose: values }] } }] } };
}
const options = { symbols: ['159941.SZ'], currency: 'CNY', timezone: 'Asia/Shanghai', cutoff: '2026-10-23' };
const now = Date.parse('2026-10-26T08:00Z');

test('前复权使用AdjClose；缺少复权因子不回退原价；校验标的币种与日期', () => {
  const p = yahoo('159941.SZ', 'CNY');
  p.chart.result[0].indicators.quote[0].close = [4, 3, 2, 2];
  const r = parsePerformanceHistory(p, options);
  assert.equal(r.rows[0].close, 1);
  assert.equal(r.rows.at(-1).close, 2);
  const missing = structuredClone(p); delete missing.chart.result[0].indicators.adjclose;
  assert.throws(() => parsePerformanceHistory(missing, options));
  assert.throws(() => parsePerformanceHistory(p, { ...options, currency: 'USD' }));
  assert.throws(() => parsePerformanceHistory(p, { ...options, symbols: ['QQQ'] }));
  assert.equal(parsePerformanceHistory(p, { ...options, cutoff: '2025-10-23' }).rows.length, 3);
  const broken = structuredClone(p); broken.chart.result[0].indicators.adjclose[0].adjclose[0] = null;
  assert.throws(() => parsePerformanceHistory(broken, options));
});

test('空报价排除该日，不填值或混用不复权价格', () => {
  const p = yahoo('159941.SZ', 'CNY', [1, null, 1.5, 2]);
  const r = parsePerformanceHistory(p, options);
  assert.equal(r.rows.length, 3);
  assert.ok(!r.rows.some(row => row.date === '2023-10-23'));
});

test('1/3/5年累计涨幅使用各自复权价格，无汇率换算；闰年与非交易日回退', () => {
  const result = calculateFundPerformance(history([1, 1.2, 1.5, 2]), '2026-10-23');
  assert.equal(result[5].startDate, '2021-10-22');
  assert.equal(result[5].return, 100);
  assert.equal(result[1].startDate, '2025-10-23');
  assert.ok(Math.abs(result[1].return - 100 / 3) < 1e-9);
  assert.equal(result[3].startDate, '2023-10-23');
  assert.ok(Math.abs(result[3].return - (2 / 1.2 - 1) * 100) < 1e-9);
  assert.equal(yearsBefore('2024-02-29', 1), '2023-02-28');
  assert.equal(yearsBefore('2024-02-29', 3), '2021-02-28');
});

test('不足年限和缺失同期数据区分；不得拿成立以来或过远交易日替代', () => {
  const fund = history([1, 1.2, 1.5, 2], '2023-06-01');
  assert.equal(calculateFundPerformance(fund, '2026-10-23')[5].status, 'short-history');
  fund.firstDate = '2015-01-01'; fund.rows.shift();
  assert.equal(calculateFundPerformance(fund, '2026-10-23')[5].status, 'missing');
  fund.rows.pop();
  assert.equal(calculateFundPerformance(fund, '2026-10-23')[1].status, 'missing');
  const noRecent = history([1, 1.2, 1.5, 2]); noRecent.rows.splice(2, 1);
  assert.equal(calculateFundPerformance(noRecent, '2026-10-23')[1].status, 'missing');
});

test('每日历史更新保留同一共同截止日；单只失败保留数据但不混入当期排序', async () => {
  const fetchText = async url => {
    const symbol = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    assert.ok(!symbol.includes('=X'), '不应请求汇率数据');
    return JSON.stringify(yahoo(symbol, symbol === 'QQQ' ? 'USD' : 'CNY'));
  };
  const first = await fetchFundPerformance({ now, quoteDate: '2026-10-26', fetchText });
  assert.equal(first.version, 2);
  assert.equal(first.endDate, '2026-10-23');
  assert.equal(first.benchmark.currency, 'USD');
  assert.equal(first.benchmark.price, 2);
  assert.equal(first.benchmark.periods[5].return, 100);
  assert.equal(first.complete, true);
  assert.equal(first.rows.length, 12);
  const partial = await fetchFundPerformance({ now, quoteDate: '2026-10-26', previous: first, fetchText: async url => {
    if (url.includes('159941')) throw Error('unavailable');
    return fetchText(url);
  } });
  assert.equal(partial.complete, false);
  const old = partial.rows.find(row => row.code === '159941');
  assert.equal(old.ok, false);
  assert.deepEqual(old.periods, first.rows[0].periods);
  const rows = performanceRows([{ code: '159941' }, { code: '159501' }], partial);
  assert.equal(rows[0].return1, null);
  assert.equal(sortFunds(rows, 'return1', 'desc')[0].code, '159501');
  const failed = await fetchFundPerformance({ now, quoteDate: '2026-10-26', previous: first,
    fetchText: async () => { throw Error('private URL'); } });
  assert.equal(failed.ok, false);
  assert.equal(failed.checkedAt, first.checkedAt);
  assert.deepEqual(failed.rows, first.rows);
  assert.doesNotMatch(JSON.stringify(failed), /private URL/);
});

test('收益三列可独立排序，旧人民币比较格式不作为新原币种收益展示', () => {
  const rows = [{ code: 'a' }, { code: 'b' }];
  const old = performanceRows(rows, { version: 1, rows: [{ code: 'a', ok: true, periods: { 1: { status: 'ok', fundReturn: 12 } } }] });
  assert.equal(old[0].return1, null);
  const data = { version: 2, rows: [
    { code: 'a', ok: true, periods: { 1: { status: 'ok', return: 10 }, 3: { status: 'ok', return: 50 }, 5: { status: 'short-history' } } },
    { code: 'b', ok: true, periods: { 1: { status: 'ok', return: 20 }, 3: { status: 'ok', return: 40 }, 5: { status: 'ok', return: 60 } } }
  ] };
  const next = performanceRows(rows, data);
  assert.equal(sortFunds(next, 'return1', 'desc')[0].code, 'b');
  assert.equal(sortFunds(next, 'return3', 'desc')[0].code, 'a');
  assert.equal(sortFunds(next, 'return5', 'asc')[0].code, 'b');
});

test('中美假期不同时选可用共同收盘日，不以中国休市日覆盖有效收益', async () => {
  const now = Date.parse('2026-10-08T08:00Z');
  const commonDates = ['2021-09-30', '2023-09-28', '2025-09-30', '2026-09-30'];
  const fetchText = async url => {
    const symbol = decodeURIComponent(new URL(url).pathname.split('/').at(-1));
    const payload = yahoo(symbol, symbol === 'QQQ' ? 'USD' : 'CNY');
    const chart = payload.chart.result[0];
    chart.timestamp = commonDates.map(date => Date.parse(date + 'T12:00Z') / 1000);
    if (symbol === 'QQQ') {
      chart.timestamp.push(Date.parse('2026-10-07T12:00Z') / 1000);
      chart.indicators.quote[0].close.push(2.1);
    }
    return JSON.stringify(payload);
  };
  const result = await fetchFundPerformance({ now, quoteDate: '2026-10-08', fetchText });
  assert.equal(result.endDate, '2026-09-30');
  assert.equal(result.complete, true);
  assert.equal(result.benchmark.periods[1].endDate, result.endDate);
  assert.ok(result.rows.every(row => row.periods[1].status === 'ok' && row.periods[1].endDate === result.endDate));
  const partial = await fetchFundPerformance({ now, quoteDate: '2026-10-08', previous: result,
    fetchText: url => url.includes('159941') ? Promise.reject(Error('offline')) : fetchText(url) });
  assert.equal(partial.endDate, result.endDate);
  assert.equal(partial.complete, false);
  assert.equal(partial.rows[0].ok, false);
  assert.equal(performanceRows([{ code: '159941' }], partial)[0].return1, null);
  const newer = { ...result, endDate: '2026-10-01' };
  const regressed = await fetchFundPerformance({ now, quoteDate: '2026-10-08', previous: newer, fetchText });
  assert.equal(regressed.ok, false);
  assert.equal(regressed.endDate, newer.endDate);
  assert.deepEqual(regressed.rows, newer.rows);
});
