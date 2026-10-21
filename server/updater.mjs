import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { fetchPublicText, yahooURL } from './network.mjs';
import { normalizeYahoo, SYMBOLS, validSymbol, filterMarketHistory, HISTORY_STARTS } from '../public/js/domain/market.mjs';
import { readCustomSymbols } from './symbols.mjs';
import { parseCSV, rating, OFFICIAL_START } from '../public/js/domain/sentiment.mjs';
import { latestClosedSession } from '../public/js/domain/trading-calendar.mjs';
import { readOptional, atomicWrite, preserveHistory, withDataLock } from './storage.mjs';
import { loadHistoricalSupplement, mergeHistoricalSupplement } from './sentiment-history.mjs';

export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../public/data/', import.meta.url));
export const ARCHIVE_URL =
  'https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv';
export const CNN_URL =
  'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2021-02-01';

const pending = new Map();
const csv = rows =>
  'Date,Fear Greed,Rating\n' +
  rows.map(r => [r.date, r.score, r.label || rating(r.score)].join(',')).join('\n') +
  '\n';

export function parseCNN(payload) {
  const entries = payload?.fear_and_greed_historical?.data;
  if (!Array.isArray(entries) || !entries.length) throw Error('CNN 缺少历史数据');
  // Match fetch_cnn.py (UTC dates, including intraday points) followed by
  // build_combined.py (stable date sort, keep the last entry for each date).
  // Validate every entry before deduplication so a bad point cannot be hidden.
  const byDate = new Map();
  for (const entry of entries) {
    if (!Number.isFinite(entry?.x) || !Number.isFinite(entry?.y) ||
        !Number.isFinite(new Date(entry.x).getTime())) throw Error('CNN 日期或分数无效');
    const date = new Date(entry.x).toISOString().slice(0, 10);
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

async function snapshot(dataDir, symbol) {
  const fileName = symbol === 'Fear & Greed' ? 'fear-greed.csv' : symbol.toLowerCase() + '.json';
  const text = await readOptional(path.join(dataDir, fileName));
  if (!text) return null;
  if (symbol === 'Fear & Greed') {
    const rows = parseCSV(text);
    return { date: rows.at(-1).date, count: rows.length };
  }
  const data = JSON.parse(text);
  if (data.symbol !== symbol || !data.rows?.length) throw Error('本地行情格式无效');
  return { date: data.anchorDate, count: filterMarketHistory(symbol, data.rows).length };
}

async function updateETF(symbol, { dataDir, fetchText, now }) {
  const file = path.join(dataDir, symbol.toLowerCase() + '.json');
  const saved = await readOptional(file);
  const previous = saved ? JSON.parse(saved) : null;
  const payload = JSON.parse(await fetchText(yahooURL(symbol)));
  const next = normalizeYahoo(payload, symbol, now);
  const result = payload.chart.result[0];
  const latest = latestClosedSession(now, 0);
  const incompleteDates = (result.timestamp || []).flatMap((timestamp, i) => {
    const date = new Date(timestamp * 1000).toLocaleDateString('en-CA', {
      timeZone: 'America/New_York'
    });
    const quote = result.indicators.quote[0];
    const values = [quote.open?.[i], quote.high?.[i], quote.low?.[i], quote.close?.[i],
      result.indicators.adjclose[0].adjclose?.[i]];
    return date <= latest && (!HISTORY_STARTS[symbol] || date >= HISTORY_STARTS[symbol]) && values.some(v => v == null) ? [date] : [];
  });
  if (previous) preserveHistory(filterMarketHistory(symbol, previous.rows), next.rows);
  await atomicWrite(file, JSON.stringify(next));
  return { date: next.anchorDate, count: next.rows.length, source: 'Yahoo Finance',
    ...(incompleteDates.length ? {
      warning: 'Yahoo 日线价格或复权价格缺失：' + incompleteDates.slice(-5).join('、')
    } : {}) };
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
    '上游缺失已有历史日期，已保留原数据', '指数数据已超过 7 天未更新',
    '缺少 2021 年以前历史存档，请先使用 archive 初始化'
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

async function updateSentiment({ dataDir, fetchText, now, sentimentSource, wait }) {
  const file = path.join(dataDir, 'fear-greed.csv');
  const saved = await readOptional(file);
  const previous = saved ? parseCSV(saved) : [];
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
  if (pending.has(dataDir)) return pending.get(dataDir);
  const promise = withDataLock(dataDir, () => run({ ...options, dataDir })).finally(() =>
    pending.delete(dataDir)
  );
  pending.set(dataDir, promise);
  return promise;
}

export async function addCustomSymbol(symbol, options = {}) {
  if (!validSymbol(symbol)) throw Error('请输入有效的美股代码，例如 VOO、AAPL 或 BRK-B');
  const dataDir = path.resolve(options.dataDir || DEFAULT_DATA_DIR);
  return withDataLock(dataDir, async () => {
    const symbols = await readCustomSymbols(dataDir);
    if (SYMBOLS.includes(symbol) || symbols.includes(symbol)) return { symbol, symbols };
    if (symbols.length >= 30) throw Error('自定义标的最多支持 30 个');
    try {
      await updateETF(symbol, { dataDir, fetchText: options.fetchText || fetchPublicText,
        now: options.now ?? Date.now() });
    } catch {
      throw Error('无法添加：请确认代码有效、属于美元美股股票或 ETF，并检查行情数据源连接');
    }
    symbols.push(symbol);
    await atomicWrite(path.join(dataDir, 'custom-symbols.json'), JSON.stringify(symbols) + '\n');
    return { symbol, symbols };
  });
}

async function run({
  dataDir,
  fetchText = fetchPublicText,
  now = Date.now(),
  wait = sleep,
  skipFresh = false,
  sources,
  sentimentSource = process.env.FEAR_GREED_SOURCE || 'auto'
}) {
  const symbols = [...SYMBOLS, ...await readCustomSymbols(dataDir)];
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
  const oldText = await readOptional(path.join(dataDir, 'status.json'));
  const old = oldText ? JSON.parse(oldText) : null;
  const context = { dataDir, fetchText, now, expectedDate, sentimentSource, wait };

  const results = await Promise.all(
    ['Fear & Greed', ...symbols].map(async symbol => {
      const last = old?.results?.find(r => r.symbol === symbol);
      if (!sources.includes(symbol)) {
        return last || { symbol, ok: false, fresh: false, date: null, checkedAt: null };
      }
      try {
        const current = await snapshot(dataDir, symbol);
        if (
          skipFresh &&
          symbol !== 'Fear & Greed' &&
          current?.date >= expectedDate &&
          last?.ok &&
          last.date === current.date &&
          last.expectedDate === expectedDate
        ) {
          return { ...last, ...current, skipped: true };
        }
        const value =
          symbol === 'Fear & Greed'
            ? await updateSentiment(context)
            : await retry(() => updateETF(symbol, context), wait);
        return {
          symbol,
          ...value,
          ok: true,
          fresh: value.date >= expectedDate,
          ...(value.date < expectedDate ? {
            message: (value.warning ? value.warning + '；' : '') +
              '来源有效数据截至 ' + value.date + '，尚缺 ' + expectedDate + ' 的完整数据'
          } : {}),
          expectedDate,
          checkedAt,
          lastSuccessAt: checkedAt
        };
      } catch (error) {
        let cached;
        try {
          cached = await snapshot(dataDir, symbol);
        } catch {}
        return {
          symbol,
          ok: false,
          fresh: !!cached && cached.date >= expectedDate,
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
      .every(r => r.ok && r.date >= expectedDate),
    complete: results.every(r => r.ok && r.date >= expectedDate),
    results
  };
  await atomicWrite(path.join(dataDir, 'status.json'), JSON.stringify(status, null, 2) + '\n');
  return status;
}
