import path from 'node:path';
import { readOptional, readJsonOptional } from './storage.mjs';
import { SYMBOLS } from '../public/js/domain/market.mjs';
import { FUND_GROUPS } from '../public/js/domain/funds.mjs';
import { parseCSV } from '../public/js/domain/sentiment.mjs';
import { isStatusComplete, isSourceHealthy } from '../public/js/domain/data-health.mjs';

const BUILTIN_SYMBOL_FILES = new Set(SYMBOLS.map(s => s.toLowerCase() + '.json'));
const BUILTIN_FUND_FILES = new Set(Object.values(FUND_GROUPS).map(g => g.snapshotFile));
const BUILTIN_STATUS_SYMBOLS = new Set(['Fear & Greed', ...SYMBOLS]);

export function isBuiltinDataFile(fileName) {
  return fileName === 'fear-greed.csv' ||
    BUILTIN_SYMBOL_FILES.has(fileName) ||
    BUILTIN_FUND_FILES.has(fileName);
}

function sameDir(dataDir, baseDataDir) {
  return !baseDataDir || path.resolve(baseDataDir) === path.resolve(dataDir);
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function parseCsvSafe(text) {
  if (!text) return null;
  try {
    const rows = parseCSV(text);
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}

function shouldPreferBaseSentiment(localText, baseText) {
  const localRows = parseCsvSafe(localText);
  const baseRows = parseCsvSafe(baseText);
  if (!baseRows) return false;
  if (!localRows) return true;
  const localDate = localRows.at(-1).date;
  const baseDate = baseRows.at(-1).date;
  return baseDate > localDate || (baseDate === localDate && baseRows.length > localRows.length);
}

function shouldPreferBaseMarket(localText, baseText) {
  const local = parseJsonSafe(localText);
  const base = parseJsonSafe(baseText);
  if (!base?.rows?.length) return false;
  if (!local?.rows?.length) return true;
  const localDate = local.anchorDate || '';
  const baseDate = base.anchorDate || '';
  return baseDate > localDate || (baseDate === localDate && base.rows.length > local.rows.length);
}

function latestTimestamp(obj) {
  return Math.max(
    Date.parse(obj?.checkedAt || '') || 0,
    Date.parse(obj?.lastAttemptAt || '') || 0
  );
}

function preferBaseByCheckState(local, base) {
  const localChecked = Date.parse(local?.checkedAt || '') || 0;
  const baseChecked = Date.parse(base?.checkedAt || '') || 0;
  if (baseChecked !== localChecked) return baseChecked > localChecked;
  if (base?.ok === false && local?.ok !== false) return false;
  const localTime = latestTimestamp(local);
  const baseTime = latestTimestamp(base);
  if (baseTime !== localTime) return baseTime > localTime;
  return base?.ok !== false && local?.ok === false;
}

function shouldPreferBaseFunds(localText, baseText) {
  const local = parseJsonSafe(localText);
  const base = parseJsonSafe(baseText);
  if (!base || !Array.isArray(base.rows)) return false;
  if (!local || !Array.isArray(local.rows)) return true;
  if (base.rows.length && !local.rows.length) return true;
  if (local.rows.length && !base.rows.length) return false;
  return preferBaseByCheckState(local, base);
}

export async function readBuiltinDataText(dataDir, baseDataDir, fileName) {
  const localText = await readOptional(path.join(dataDir, fileName));
  if (sameDir(dataDir, baseDataDir) || !isBuiltinDataFile(fileName)) return localText;
  const baseText = await readOptional(path.join(baseDataDir, fileName));
  if (baseText == null) return localText;
  if (localText == null) return baseText;
  if (fileName === 'fear-greed.csv') return shouldPreferBaseSentiment(localText, baseText) ? baseText : localText;
  if (BUILTIN_FUND_FILES.has(fileName)) return shouldPreferBaseFunds(localText, baseText) ? baseText : localText;
  return shouldPreferBaseMarket(localText, baseText) ? baseText : localText;
}

export async function readBuiltinDataJson(dataDir, baseDataDir, fileName) {
  return parseJsonSafe(await readBuiltinDataText(dataDir, baseDataDir, fileName));
}

function pickStatusResult(localResult, baseResult) {
  if (!localResult) return baseResult;
  if (!baseResult) return localResult;
  const localDate = localResult.date || '';
  const baseDate = baseResult.date || '';
  if (baseDate !== localDate) return baseDate > localDate ? baseResult : localResult;
  const localTime = Date.parse(localResult.checkedAt || '') || 0;
  const baseTime = Date.parse(baseResult.checkedAt || '') || 0;
  if (baseTime !== localTime) return baseTime > localTime ? baseResult : localResult;
  return baseResult.ok !== false && localResult.ok === false ? baseResult : localResult;
}

function maxTimestamp(a, b) {
  const timeA = Date.parse(a || '') || 0;
  const timeB = Date.parse(b || '') || 0;
  if (!timeA && !timeB) return a || b || null;
  return timeB > timeA ? b : a;
}

function pickFundsStatus(localFunds, baseFunds) {
  if (!localFunds) return baseFunds;
  if (!baseFunds) return localFunds;
  return preferBaseByCheckState(localFunds, baseFunds) ? baseFunds : localFunds;
}

export function syncRequestedComplete(status) {
  if (!Array.isArray(status.requestedSources)) return;
  status.requestedComplete = status.requestedSources.length > 0
    ? status.requestedSources.every(symbol => (status.results || []).some(r => r?.symbol === symbol && isSourceHealthy(r, status.expectedDate)))
    : Boolean(status.complete);
}

export async function readMergedStatus(dataDir, baseDataDir, customSymbols) {
  const localStatus = await readJsonOptional(path.join(dataDir, 'status.json'));
  if (sameDir(dataDir, baseDataDir)) return localStatus;
  const baseStatus = await readJsonOptional(path.join(baseDataDir, 'status.json'));
  if (!localStatus && !baseStatus) return null;

  const localBySymbol = new Map((localStatus?.results || []).map(r => [r?.symbol, r]));
  const baseBySymbol = new Map((baseStatus?.results || []).map(r => [r?.symbol, r]));
  const expectedDate = [localStatus?.expectedDate, baseStatus?.expectedDate].filter(Boolean).sort().at(-1) || null;

  const results = [];
  for (const symbol of ['Fear & Greed', ...SYMBOLS]) {
    const chosen = pickStatusResult(localBySymbol.get(symbol), baseBySymbol.get(symbol));
    if (chosen) results.push({ ...chosen });
  }
  const allowedCustom = Array.isArray(customSymbols) ? new Set(customSymbols) : null;
  for (const result of localStatus?.results || []) {
    if (!result?.symbol || BUILTIN_STATUS_SYMBOLS.has(result.symbol)) continue;
    if (allowedCustom && !allowedCustom.has(result.symbol)) continue;
    results.push({ ...result });
  }
  if (expectedDate) {
    for (const result of results) {
      if (result.date != null) {
        result.fresh = result.date >= expectedDate && !result.missingDates?.length;
      }
    }
  }

  const effectiveCustom = Array.isArray(customSymbols)
    ? customSymbols
    : results.filter(r => !BUILTIN_STATUS_SYMBOLS.has(r.symbol)).map(r => r.symbol);
  const funds = pickFundsStatus(localStatus?.funds, baseStatus?.funds);
  const hasRequested = Array.isArray(localStatus?.requestedSources) || Array.isArray(baseStatus?.requestedSources);
  const requestedSources = hasRequested
    ? [...new Set([
        ...(baseStatus?.requestedSources || []).filter(s => BUILTIN_STATUS_SYMBOLS.has(s)),
        ...(localStatus?.requestedSources || []).filter(s => BUILTIN_STATUS_SYMBOLS.has(s) || !allowedCustom || allowedCustom.has(s))
      ])]
    : undefined;

  const merged = {
    version: localStatus?.version || baseStatus?.version || 1,
    checkedAt: maxTimestamp(localStatus?.checkedAt, baseStatus?.checkedAt),
    expectedDate,
    ...(requestedSources ? { requestedSources } : {}),
    complete: isStatusComplete(results, expectedDate, effectiveCustom),
    results,
    ...(funds ? { funds } : {})
  };
  syncRequestedComplete(merged);
  return merged;
}
