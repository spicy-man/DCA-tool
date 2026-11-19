import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchPublicText, yahooURL } from './network.mjs';
import { normalizeYahoo, SYMBOLS, validSymbol, filterMarketHistory, HISTORY_STARTS, findMissingTradingDays } from '../public/js/domain/market.mjs';
import { readCustomSymbols, writeCustomSymbolsWithStatus, syncRequestedComplete, isReservedSymbolFile } from './symbols.mjs';
import { parseCSV, rating, OFFICIAL_START } from '../public/js/domain/sentiment.mjs';
import { isStatusComplete, isSourceHealthy } from '../public/js/domain/data-health.mjs';
import { latestClosedSession } from '../public/js/domain/trading-calendar.mjs';
import { readOptional, readJsonOptional, atomicWrite, preserveHistory, withDataLock } from './storage.mjs';
import { loadHistoricalSupplement, mergeHistoricalSupplement } from './sentiment-history.mjs';
import { fetchFundSnapshot } from './fund-quotes.mjs';
import { fetchFundPerformance } from './fund-performance.mjs';
import { FUND_GROUPS, getFundGroup } from '../public/js/domain/funds.mjs';
import { readBuiltinDataText, readBuiltinDataJson, readMergedStatus } from './data-layer.mjs';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url));
export const LOCAL_DATA_DIR = fileURLToPath(new URL('../.local-data/', import.meta.url));
export const ARCHIVE_URL =
  'https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv';
export const CNN_URL =
  'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2021-02-01';

const pending = new Map();

async function updateFundGroup({ dataDir, baseDataDir = null, fetchText = fetchPublicText, now = Date.now() }, group) {
  const file = path.join(dataDir, group.snapshotFile);
  const previous = await readBuiltinDataJson(dataDir, baseDataDir, group.snapshotFile);
  let next;
  try {
    next = await fetchFundSnapshot({ fetchText, now, previous, funds: group.funds });
    next.performance = await fetchFundPerformance({ fetchText, now, previous: previous?.performance,
      quoteDate: next.rows.map(row => row.quoteDate).sort()[0], funds: group.funds,
      benchmarkSymbol: group.benchmark.symbol, loadBenchmarkSnapshot: async () => {
        const text = await readBuiltinDataText(dataDir, baseDataDir, (group.homeSymbol || group.benchmark.symbol).toLowerCase() + '.json');
        return text ? JSON.parse(text) : null;
      } });
  } catch {
    next = { ...(previous || { version: 1, source: '东方财富 / 天天基金', rows: [], checkedAt: null }),
      ok: false, lastAttemptAt: new Date(now).toISOString(),
      error: '本次基金更新失败，已保留上次有效快照' };
  }
  next.groupId = group.id;
  await atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
  return next;
}

async function updateFunds(options) {
  const groups = options.group ? [getFundGroup(options.group)] : Object.values(FUND_GROUPS);
  const snapshots = [];
  for (const group of groups) snapshots.push(await updateFundGroup(options, group));
  return { ...snapshots[0], complete: snapshots.every(s => s.ok && s.performance?.ok && s.performance?.complete),
    groups: snapshots.map(s => ({ groupId: s.groupId, ok: s.ok, count: s.rows.length,
      performanceDate: s.performance?.endDate, performanceOk: s.performance?.ok ?? null,
      performanceComplete: s.performance?.complete,
      error: s.error || s.performance?.error })) };
}

export function refreshFunds(options = {}) {
  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  const baseDataDir = options.baseDataDir ? path.resolve(options.baseDataDir) : null;
  return withDataLock(dataDir, () => updateFunds({ ...options, dataDir, baseDataDir }));
}
const csv = rows =>
  'Date,Fear Greed,Rating\n' +
  rows.map(r => [r.date, r.score, r.label || rating(r.score)].join(',')).join('\n') +
  '\n';

export function parseCNN(payload, now = Date.now()) {
  const entries = payload?.fear_and_greed_historical?.data;
  if (!Array.isArray(entries) || !entries.length) throw Error('CNN 缺少历史数据');
  const today = new Date(now).toISOString().slice(0, 10);
  // Match fetch_cnn.py (UTC dates, including intraday points) followed by
  // build_combined.py (stable date sort, keep the last entry for each date).
  // Validate every entry before deduplication so a bad point cannot be hidden.
  const byDate = new Map();
  for (const entry of entries) {
    if (!Number.isFinite(entry?.x) || !Number.isFinite(entry?.y) ||
        !Number.isFinite(new Date(entry.x).getTime())) throw Error('CNN 日期或分数无效');
    const date = new Date(entry.x).toISOString().slice(0, 10);
    if (date > today) throw Error('指数数据包含未来日期');
    const [row] = parseCSV('Date,Fear Greed,Rating\n' +
      [date, entry.y, entry.rating || rating(entry.y)].join(','));
    if (date >= OFFICIAL_START) byDate.set(date, row);
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!rows.length) throw Error('CNN 没有可用历史数据');
  return rows;
}

function validateSentimentAge(rows, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (rows.at(-1).date > today) {
    throw Error('指数数据包含未来日期');
  }
  if ((Date.parse(today) - Date.parse(rows.at(-1).date)) / 86400000 > 7) {
    throw Error('指数数据已超过 7 天未更新');
  }
}

async function retry(task, wait) {
  try {
    return await task();
  } catch (error) {
    // Never attempt to work around an explicit access denial or rate limit.
    if (/\b(401|403|418|429)\b/.test(error.message)) throw error;
    await wait(1500);
    return task();
  }
}

async function snapshot(dataDir, symbol, now = Date.now(), baseDataDir = null) {
  const fileName = symbol === 'Fear & Greed' ? 'fear-greed.csv' : symbol.toLowerCase() + '.json';
  const file = path.join(dataDir, fileName);
  if (symbol === 'Fear & Greed') {
    const text = await readBuiltinDataText(dataDir, baseDataDir, fileName);
    if (!text) return null;
    const today = new Date(now).toISOString().slice(0, 10);
    const rows = parseCSV(text).filter(row => row.date <= today);
    if (!rows.length) return null;
    return { date: rows.at(-1).date, count: rows.length };
  }
  const data = SYMBOLS.includes(symbol)
    ? await readBuiltinDataJson(dataDir, baseDataDir, fileName)
    : await readJsonOptional(file);
  if (!data) return null;
  if (data.symbol !== symbol || !data.rows?.length) throw Error('本地行情格式无效');
  const rows = filterMarketHistory(symbol, data.rows);
  const missingDates = SYMBOLS.includes(symbol) ? findMissingTradingDays(rows) : [];
  return {
    date: data.anchorDate,
    count: rows.length,
    ...(missingDates.length ? { missingDates } : {})
  };
}

async function updateETF(symbol, { dataDir, baseDataDir = null, fetchText, now }) {
  const fileName = symbol.toLowerCase() + '.json';
  const file = path.join(dataDir, fileName);
  const previous = SYMBOLS.includes(symbol)
    ? await readBuiltinDataJson(dataDir, baseDataDir, fileName)
    : await readJsonOptional(file);
  let text;
  try {
    text = await fetchText(yahooURL(symbol));
  } catch (error) {
    error.publicMessage = sourceFailure('Yahoo Finance', error) + '；已保留上次有效数据';
    throw error;
  }
  let payload, next, incompleteDates, missingDates;
  const latest = latestClosedSession(now, 0);
  try {
    payload = JSON.parse(text);
    next = normalizeYahoo(payload, symbol, now);
    const result = payload.chart.result[0];
    const completeDates = new Set(next.rows.map(r => r.date));
    incompleteDates = (result.timestamp || []).flatMap((timestamp, i) => {
      const date = new Date(timestamp * 1000).toLocaleDateString('en-CA', {
        timeZone: 'America/New_York'
      });
      if (completeDates.has(date)) return [];
      const quote = result.indicators.quote[0];
      const values = [quote.open?.[i], quote.high?.[i], quote.low?.[i], quote.close?.[i],
        result.indicators.adjclose[0].adjclose?.[i]];
      return date <= latest && (!HISTORY_STARTS[symbol] || date >= HISTORY_STARTS[symbol]) && values.some(v => v == null) ? [date] : [];
    });
    if (previous?.rows) {
      const previousRows = filterMarketHistory(symbol, previous.rows);
      const tailIncomplete = new Set(incompleteDates.filter(date => date > next.anchorDate));
      if (tailIncomplete.size && previousRows.some(r => tailIncomplete.has(r.date))) {
        preserveHistory(previousRows.filter(r => !tailIncomplete.has(r.date)), next.rows);
        const retainedMissing = SYMBOLS.includes(symbol) ? findMissingTradingDays(previousRows) : [];
        return {
          date: previous.anchorDate,
          count: previousRows.length,
          source: 'Yahoo Finance',
          retained: true,
          ...(retainedMissing.length ? {
            missingDates: retainedMissing,
            warning: 'Yahoo 日线缺失交易日：' + retainedMissing.slice(-5).join('、')
          } : {})
        };
      }
      preserveHistory(previousRows, next.rows);
    }
    missingDates = SYMBOLS.includes(symbol) ? findMissingTradingDays(next.rows) : [];
  } catch (error) {
    const message = validationFailure('Yahoo Finance', error);
    error.publicMessage = message.includes('已保留') ? message : message + '；已保留上次有效数据';
    throw error;
  }
  await atomicWrite(file, JSON.stringify(next));
  const missingSet = new Set(missingDates);
  const extraIncomplete = incompleteDates.filter(date => !missingSet.has(date));
  const warnings = [];
  if (missingDates.length) warnings.push('Yahoo 日线缺失交易日：' + missingDates.slice(-5).join('、'));
  if (extraIncomplete.length) warnings.push('Yahoo 日线价格或复权价格缺失：' + extraIncomplete.slice(-5).join('、'));
  return {
    date: next.anchorDate,
    count: next.rows.length,
    source: 'Yahoo Finance',
    ...(missingDates.length ? { missingDates } : {}),
    ...(warnings.length ? { warning: warnings.join('；') } : {})
  };
}

function sourceFailure(name, error) {
  const code = error.message.match(/\b([45]\d{2})\b/)?.[1];
  if (code) return name + ' 接口返回 ' + code;
  return name + (/timeout|timed out|超时/i.test(error.message) ? ' 请求超时' : ' 网络连接失败');
}

function validationFailure(name, error) {
  // These diagnostics come from our parsers, never from an upstream response.
  const reasons = new Set([
    'CNN 缺少历史数据', 'CNN 日期或分数无效', 'CNN 没有可用历史数据',
    'CSV 列名不匹配', 'CSV 数据无效或日期重复', '没有可用数据',
    '上游缺失已有历史日期，已保留原数据', '指数数据包含未来日期', '指数数据已超过 7 天未更新',
    '缺少 2021 年以前历史存档，请先使用 archive 初始化',
    'Yahoo 行情标识或币种不匹配', '行情缺少 OHLC 或复权因子',
    '行情价格无效或日期重复', 'OHLC 范围异常', '成交量异常', '无完整交易日数据'
  ]);
  const reason = error instanceof SyntaxError ? '响应不是有效 JSON' :
    reasons.has(error.message) ? error.message : '数据格式无效';
  return name + ' 数据校验失败：' + reason;
}

function sentimentFailure(warnings) {
  const error = Error('指数更新失败');
  // Only fixed diagnostics reach the public status; never expose raw network errors.
  error.publicMessage = warnings.join('；') + '；已保留本地数据';
  return error;
}

async function updateSentiment({ dataDir, baseDataDir = null, fetchText, now, sentimentSource, wait }) {
  const file = path.join(dataDir, 'fear-greed.csv');
  const saved = await readBuiltinDataText(dataDir, baseDataDir, 'fear-greed.csv');
  const today = new Date(now).toISOString().slice(0, 10);
  const previous = saved ? parseCSV(saved).filter(row => row.date <= today) : [];
  const supplement = await loadHistoricalSupplement();
  let selected;
  let cnnNetworkFailed = false;
  const warnings = [];

  if (sentimentSource !== 'archive') {
    let text;
    try {
      text = await retry(() => fetchText(CNN_URL), wait);
    } catch (error) {
      cnnNetworkFailed = true;
      warnings.push(sourceFailure('CNN', error));
      if (sentimentSource === 'cnn') throw sentimentFailure(warnings);
    }
    if (!cnnNetworkFailed) {
      try {
        const tail = parseCNN(JSON.parse(text), now);
        // Keep earlier local history if CNN returns a shorter window, and
        // reject missing dates inside the returned window.
        preserveHistory(previous.filter(r => r.date >= tail[0].date), tail);
        if (!previous.some(r => r.date < OFFICIAL_START)) {
          throw Error('缺少 2021 年以前历史存档，请先使用 archive 初始化');
        }
        const rows = mergeHistoricalSupplement(
          [...previous.filter(r => r.date < tail[0].date), ...tail], supplement
        );
        validateSentimentAge(rows, now);
        selected = { rows, source: 'CNN' };
      } catch (error) {
        throw sentimentFailure([validationFailure('CNN', error)]);
      }
    }
  }

  if (
    sentimentSource === 'archive' ||
    (sentimentSource === 'auto' && cnnNetworkFailed)
  ) {
    let text;
    try {
      text = await retry(() => fetchText(ARCHIVE_URL), wait);
    } catch (error) {
      throw sentimentFailure([...warnings, sourceFailure('备用存档', error)]);
    }
    try {
      const rows = mergeHistoricalSupplement(
        parseCSV(text), supplement
      );
      validateSentimentAge(rows, now);
      preserveHistory(previous, rows);
      selected = { rows, source: 'whit3rabbit/fear-greed-data' };
    } catch (error) {
      throw sentimentFailure([...warnings, validationFailure('备用存档', error)]);
    }
  }

  const { rows, source } = selected;
  await atomicWrite(file, csv(rows));
  return { date: rows.at(-1).date, count: rows.length, source,
    ...(warnings.length ? { warning: warnings.join('；') + '；已使用 GitHub 存档' } : {}) };
}

export function refreshAll(options = {}) {
  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  const baseDataDir = options.baseDataDir ? path.resolve(options.baseDataDir) : null;
  if (pending.has(dataDir)) return pending.get(dataDir);
  const promise = withDataLock(dataDir, () => run({ ...options, dataDir, baseDataDir })).finally(() =>
    pending.delete(dataDir)
  );
  pending.set(dataDir, promise);
  return promise;
}

export async function addCustomSymbol(symbol, options = {}) {
  if (!validSymbol(symbol) || isReservedSymbolFile(symbol)) throw Error('请输入有效的美股代码，例如 VOO、AAPL 或 BRK-B');
  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  const baseDataDir = options.baseDataDir ? path.resolve(options.baseDataDir) : null;
  const now = options.now ?? Date.now();
  return withDataLock(dataDir, async () => {
    const symbols = await readCustomSymbols(dataDir);
    if (SYMBOLS.includes(symbol) || symbols.includes(symbol)) return { symbol, symbols };
    if (symbols.length >= 30) throw Error('自定义标的最多支持 30 个');
    const cacheFile = path.join(dataDir, symbol.toLowerCase() + '.json');
    const prevCacheText = await readOptional(cacheFile);
    let value;
    try {
      value = await updateETF(symbol, { dataDir, fetchText: options.fetchText || fetchPublicText, now });
    } catch {
      throw Error('无法添加：请确认代码有效、属于美元美股股票或 ETF，并检查行情数据源连接');
    }
    const nextSymbols = [...symbols, symbol];
    try {
      await writeCustomSymbolsWithStatus(dataDir, nextSymbols, status => {
        const expectedDate = status.expectedDate || latestClosedSession(now);
        const checkedAt = new Date(now).toISOString();
        const entry = {
          symbol, ...value, ok: true, fresh: value.date >= expectedDate,
          ...(value.date < expectedDate ? {
            message: (value.warning ? value.warning + '；' : '') +
              '来源有效数据截至 ' + value.date + '，尚缺 ' + expectedDate + ' 的完整数据'
          } : {}),
          expectedDate, checkedAt, lastSuccessAt: checkedAt
        };
        status.results = [...(status.results || []).filter(r => r.symbol !== symbol), entry];
        status.complete = isStatusComplete(status.results, expectedDate, nextSymbols);
        syncRequestedComplete(status);
      }, { baseDataDir });
    } catch (error) {
      if (prevCacheText !== null) await atomicWrite(cacheFile, prevCacheText).catch(() => {});
      else await unlink(cacheFile).catch(() => {});
      throw error;
    }
    return { symbol, symbols: nextSymbols };
  });
}

async function run({
  dataDir,
  baseDataDir = null,
  fetchText = fetchPublicText,
  now = Date.now(),
  wait = sleep,
  skipFresh = false,
  catchUp = false,
  includeFunds = false,
  sources,
  sentimentSource = process.env.FEAR_GREED_SOURCE || 'auto'
}) {
  const customSymbols = await readCustomSymbols(dataDir);
  const symbols = [...SYMBOLS, ...customSymbols];
  sources = sources ? [...new Set([...sources,
    ...(SYMBOLS.every(s => sources.includes(s)) ? symbols : [])])] : ['Fear & Greed', ...symbols];
  if (!['auto', 'cnn', 'archive'].includes(sentimentSource)) {
    throw Error('FEAR_GREED_SOURCE 必须为 auto、cnn 或 archive');
  }
  if (!sources.length || sources.some(symbol => !['Fear & Greed', ...symbols].includes(symbol))) {
    throw Error('更新来源无效');
  }
  const expectedDate = latestClosedSession(now);
  const checkedAt = new Date(now).toISOString();
  const old = await readMergedStatus(dataDir, baseDataDir, customSymbols);
  if (catchUp) {
    for (const symbol of ['Fear & Greed', ...symbols]) {
      if (sources.includes(symbol)) continue;
      const last = old?.results?.find(r => r.symbol === symbol);
      if (!isSourceHealthy(last, expectedDate)) {
        sources.push(symbol);
      }
    }
  }
  const context = { dataDir, baseDataDir, fetchText, now, expectedDate, sentimentSource, wait };

  const results = await Promise.all(
    ['Fear & Greed', ...symbols].map(async symbol => {
      const last = old?.results?.find(r => r.symbol === symbol);
      if (!sources.includes(symbol)) {
        return last || { symbol, ok: false, fresh: false, date: null, checkedAt: null };
      }
      try {
        const current = await snapshot(dataDir, symbol, now, baseDataDir);
        if (
          skipFresh &&
          symbol !== 'Fear & Greed' &&
          current?.date >= expectedDate &&
          !current?.missingDates?.length &&
          last?.ok &&
          last.fresh !== false &&
          !last.missingDates?.length &&
          last.date === current.date &&
          last.expectedDate === expectedDate
        ) {
          return { ...last, ...current, skipped: true };
        }
        const value =
          symbol === 'Fear & Greed'
            ? await updateSentiment(context)
            : await retry(() => updateETF(symbol, context), wait);
        const { retained, ...rest } = value;
        const fresh = value.date >= expectedDate && !value.missingDates?.length;
        return {
          symbol,
          ...rest,
          ok: true,
          fresh,
          ...(value.date < expectedDate ? {
            message: (value.warning ? value.warning + '；' : '') +
              '来源有效数据截至 ' + value.date + '，尚缺 ' + expectedDate + ' 的完整数据'
          } : {}),
          expectedDate,
          checkedAt,
          lastSuccessAt: retained && last?.lastSuccessAt ? last.lastSuccessAt : checkedAt
        };
      } catch (error) {
        let cached;
        try {
          cached = await snapshot(dataDir, symbol, now, baseDataDir);
        } catch {}
        return {
          symbol,
          ok: false,
          fresh: !!cached && cached.date >= expectedDate && !cached.missingDates?.length,
          ...cached,
          expectedDate,
          checkedAt,
          lastSuccessAt: last?.lastSuccessAt || null,
          source: last?.source || null,
          error: error.publicMessage || '更新失败，保留上次有效数据'
        };
      }
    })
  );

  const status = {
    version: 1,
    checkedAt,
    expectedDate,
    requestedSources: sources,
    requestedComplete: results.filter(r => sources.includes(r.symbol))
      .every(r => isSourceHealthy(r, expectedDate)),
    complete: isStatusComplete(results, expectedDate, customSymbols),
    results
  };
  await atomicWrite(path.join(dataDir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  if (includeFunds) {
    const funds = await updateFunds({ dataDir, baseDataDir, fetchText, now });
    const fundErrors = funds.groups.map(g => g.error).filter(Boolean);
    status.funds = {
      ok: funds.groups.every(g => g.ok !== false),
      complete: funds.complete !== false,
      checkedAt: funds.checkedAt || checkedAt,
      lastAttemptAt: checkedAt,
      performance: {
        ok: funds.groups.every(g => g.performanceOk !== false),
        complete: funds.groups.every(g => g.performanceComplete !== false),
        endDate: funds.performance?.endDate ?? null
      },
      ...(fundErrors.length ? { error: fundErrors.join('；') } : {}),
      groups: funds.groups
    };
    await atomicWrite(path.join(dataDir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  }
  return status;
}
