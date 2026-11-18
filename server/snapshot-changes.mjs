import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { SYMBOLS } from '../public/js/domain/market.mjs';
import { FUND_GROUPS } from '../public/js/domain/fund-groups.mjs';
import { atomicWrite, readOptional } from './storage.mjs';

export const MARKET_SNAPSHOT_FILES = Object.freeze([
  'fear-greed.csv',
  ...SYMBOLS.map(symbol => symbol.toLowerCase() + '.json')
]);

export const FUND_SNAPSHOT_FILES = Object.freeze(
  Object.values(FUND_GROUPS).map(group => group.snapshotFile)
);

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
  const { checkedAt, ...rest } = funds;
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

  let marketChanged = false;
  for (const name of MARKET_SNAPSHOT_FILES) {
    const currentText = await readOptional(path.join(dataDir, name));
    const baselineText = await readBaseline(name);
    if (currentText !== null && normalizeEol(currentText) !== normalizeEol(baselineText)) {
      marketChanged = true;
    }
  }

  const reverted = [];
  const kept = [];

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
