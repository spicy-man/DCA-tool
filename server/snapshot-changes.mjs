import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { SYMBOLS } from '../public/js/domain/market.mjs';
import { FUND_GROUPS } from '../public/js/domain/funds.mjs';
import { atomicWrite, readOptional } from './storage.mjs';

export const MARKET_SNAPSHOT_FILES = Object.freeze([
  'fear-greed.csv',
  ...SYMBOLS.map(symbol => symbol.toLowerCase() + '.json')
]);

export const FUND_SNAPSHOT_FILES = Object.freeze(
  Object.values(FUND_GROUPS).map(group => group.snapshotFile)
);

export const MARKET_FLOAT_ABS_TOL = 1e-6;
export const MARKET_FLOAT_REL_TOL = 5e-6;
const MARKET_FLOAT_FIELDS = new Set([
  'sourceOpen', 'sourceHigh', 'sourceLow', 'sourceClose',
  'adjClose', 'factor', 'open', 'high', 'low', 'close'
]);

function normalizeEol(text) {
  return text === null || text === undefined ? text : text.replaceAll('\r\n', '\n');
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function approxEqualNumber(a, b) {
  if (a === b) return true;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
    return false;
  }
  const diff = Math.abs(a - b);
  if (diff <= MARKET_FLOAT_ABS_TOL) return true;
  return diff / Math.max(Math.abs(a), Math.abs(b)) <= MARKET_FLOAT_REL_TOL;
}

function rowsSubstantivelyEqual(prevRows, nextRows) {
  if (!Array.isArray(prevRows) || !Array.isArray(nextRows) || prevRows.length !== nextRows.length) {
    return false;
  }
  for (let i = 0; i < prevRows.length; i++) {
    const prevRow = prevRows[i];
    const nextRow = nextRows[i];
    if (!prevRow || !nextRow || typeof prevRow !== 'object' || typeof nextRow !== 'object') {
      return false;
    }
    const prevKeys = Object.keys(prevRow);
    const nextKeys = Object.keys(nextRow);
    if (prevKeys.length !== nextKeys.length) return false;
    for (const key of prevKeys) {
      if (!Object.prototype.hasOwnProperty.call(nextRow, key)) return false;
      if (MARKET_FLOAT_FIELDS.has(key)) {
        if (!approxEqualNumber(prevRow[key], nextRow[key])) return false;
      } else if (!isDeepStrictEqual(prevRow[key], nextRow[key])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * 判断美股行情 JSON 快照相对基准是否存在除 fetchedAt 与 Yahoo float32 级微抖动外的实质变化。
 */
export function hasSubstantiveMarketChange(previousText, nextText) {
  if (nextText === null || nextText === undefined) return false;
  if (previousText === null || previousText === undefined) return true;
  if (normalizeEol(previousText) === normalizeEol(nextText)) return false;
  const previous = parseJson(previousText);
  const next = parseJson(nextText);
  if (!previous || !next || typeof previous !== 'object' || typeof next !== 'object') return true;
  if (!Array.isArray(previous.rows) || !Array.isArray(next.rows)) return true;

  const { fetchedAt: _pf, anchorFactor: prevAnchorFactor, rows: prevRows, ...prevMeta } = previous;
  const { fetchedAt: _nf, anchorFactor: nextAnchorFactor, rows: nextRows, ...nextMeta } = next;
  if (!isDeepStrictEqual(prevMeta, nextMeta)) return true;
  if (prevAnchorFactor !== nextAnchorFactor && !approxEqualNumber(prevAnchorFactor, nextAnchorFactor)) {
    return true;
  }
  return !rowsSubstantivelyEqual(prevRows, nextRows);
}

function normalizeFundPerformance(performance) {
  if (!performance) return null;
  const { checkedAt, lastAttemptAt, ...rest } = performance;
  return rest;
}

function normalizeFundSnapshot(snapshot, previous) {
  const prevRowsByCode = new Map((previous?.rows || []).map(row => [row.code, row]));
  const rows = (snapshot.rows || []).map(row => {
    const { profileCheckedAt, ...rest } = row;
    const prevRow = prevRowsByCode.get(row.code);
    // Eastmoney post-close CDN nodes can jitter `shares` even when quoteDate/quoteTime have not changed.
    if (prevRow && prevRow.quoteDate === row.quoteDate && prevRow.quoteTime === row.quoteTime) {
      delete rest.shares;
    }
    return rest;
  });
  const { checkedAt, lastAttemptAt, performance, ...rest } = snapshot;
  return {
    ...rest,
    rows,
    performance: normalizeFundPerformance(performance)
  };
}

/**
 * 判断国内场内 ETF 快照相对基准是否存在除时间戳及停盘后份额节点抖动外的实质变化。
 */
export function hasSubstantiveFundChange(previousText, nextText) {
  if (nextText === null || nextText === undefined) return false;
  if (previousText === null || previousText === undefined) return true;
  if (normalizeEol(previousText) === normalizeEol(nextText)) return false;
  const previous = parseJson(previousText);
  const next = parseJson(nextText);
  if (!previous || !next) return true;
  if (previous.ok !== true || next.ok !== true) return true;
  if (previous.performance?.ok !== true || next.performance?.ok !== true) return true;
  return !isDeepStrictEqual(
    normalizeFundSnapshot(previous, previous),
    normalizeFundSnapshot(next, previous)
  );
}

function normalizeStatusFunds(funds) {
  if (!funds) return undefined;
  const { checkedAt, lastAttemptAt, ...rest } = funds;
  return rest;
}

function normalizeStatusSnapshot(status) {
  const { checkedAt, requestedSources, requestedComplete, funds, results, ...rest } = status;
  return {
    ...rest,
    ...(funds ? { funds: normalizeStatusFunds(funds) } : {}),
    results: (results || []).map(({ checkedAt: _c, lastSuccessAt: _s, ...entry }) => entry)
  };
}

/**
 * 判断 status.json 相对基准是否存在除轮询时间戳和调度子集字段外的实质状态变化。
 */
export function hasSubstantiveStatusChange(previousText, nextText, hasMarketDataChanges = false) {
  if (nextText === null || nextText === undefined) return false;
  if (hasMarketDataChanges) return true;
  if (previousText === null || previousText === undefined) return true;
  if (normalizeEol(previousText) === normalizeEol(nextText)) return false;
  const previous = parseJson(previousText);
  const next = parseJson(nextText);
  if (!previous || !next) return true;
  if (previous.complete !== true || next.complete !== true) return true;
  return !isDeepStrictEqual(normalizeStatusSnapshot(previous), normalizeStatusSnapshot(next));
}

/**
 * 在提交前还原仅包含轮询时间戳或非实质抖动的快照文件，减少无意义提交与部署。
 */
export async function pruneRedundantSnapshotWrites({ dataDir, readBaseline, restoreBaseline }) {
  const restore = async (file, name, baselineText) => {
    if (restoreBaseline) await restoreBaseline(name, baselineText);
    else await atomicWrite(file, baselineText);
  };

  const reverted = [];
  const kept = [];
  let marketChanged = false;
  for (const name of MARKET_SNAPSHOT_FILES) {
    const file = path.join(dataDir, name);
    const currentText = await readOptional(file);
    if (currentText === null) continue;
    const baselineText = await readBaseline(name);
    if (baselineText === null) {
      marketChanged = true;
      if (name.endsWith('.json')) kept.push(name);
      continue;
    }
    if (normalizeEol(currentText) === normalizeEol(baselineText)) continue;
    if (name.endsWith('.json') && !hasSubstantiveMarketChange(baselineText, currentText)) {
      await restore(file, name, baselineText);
      reverted.push(name);
    } else {
      marketChanged = true;
      if (name.endsWith('.json')) kept.push(name);
    }
  }

  for (const name of FUND_SNAPSHOT_FILES) {
    const file = path.join(dataDir, name);
    const currentText = await readOptional(file);
    if (currentText === null) continue;
    const baselineText = await readBaseline(name);
    if (baselineText === null) {
      kept.push(name);
      continue;
    }
    if (normalizeEol(currentText) === normalizeEol(baselineText)) continue;
    if (!hasSubstantiveFundChange(baselineText, currentText)) {
      await restore(file, name, baselineText);
      reverted.push(name);
    } else {
      kept.push(name);
    }
  }

  const statusFile = path.join(dataDir, 'status.json');
  const currentStatus = await readOptional(statusFile);
  if (currentStatus !== null) {
    const baselineStatus = await readBaseline('status.json');
    if (baselineStatus === null) {
      kept.push('status.json');
    } else if (normalizeEol(currentStatus) !== normalizeEol(baselineStatus)) {
      if (!hasSubstantiveStatusChange(baselineStatus, currentStatus, marketChanged)) {
        await restore(statusFile, 'status.json', baselineStatus);
        reverted.push('status.json');
      } else {
        kept.push('status.json');
      }
    }
  }

  return { marketChanged, reverted, kept };
}

export function readGitHeadSnapshot(name, cwd = process.cwd()) {
  try {
    return execFileSync('git', ['show', `HEAD:public/data/${name}`], {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      timeout: 30000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
  } catch {
    return null;
  }
}
