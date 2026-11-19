import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { readOptional, readJsonOptional, atomicWrite, withDataLock } from './storage.mjs';
import { SYMBOLS, validSymbol } from '../public/js/domain/market.mjs';
import { FUND_GROUPS } from '../public/js/domain/funds.mjs';
import { isStatusComplete } from '../public/js/domain/data-health.mjs';
import { readMergedStatus, syncRequestedComplete } from './data-layer.mjs';

export { syncRequestedComplete };

const RESERVED_FILES = new Set([
  'custom-symbols.json',
  'status.json',
  ...Object.values(FUND_GROUPS).map(group => group.snapshotFile.toLowerCase())
]);

export function isReservedSymbolFile(symbol) {
  return typeof symbol === 'string' && RESERVED_FILES.has(symbol.toLowerCase() + '.json');
}

export async function readCustomSymbols(dataDir) {
  const saved = await readOptional(path.join(dataDir, 'custom-symbols.json'));
  const symbols = saved ? JSON.parse(saved) : [];
  if (!Array.isArray(symbols) || symbols.some(s => !validSymbol(s)) ||
      new Set(symbols).size !== symbols.length) throw Error('自定义标的配置无效');
  // A formerly personal ticker may become built in after an upgrade.
  return symbols.filter(symbol => !SYMBOLS.includes(symbol));
}

export async function writeCustomSymbolsWithStatus(dataDir, nextSymbols, updateStatus, { baseDataDir = null } = {}) {
  const customFile = path.join(dataDir, 'custom-symbols.json');
  const statusFile = path.join(dataDir, 'status.json');
  const prevCustomText = await readOptional(customFile);
  await atomicWrite(customFile, JSON.stringify(nextSymbols) + '\n');
  try {
    const status = await readMergedStatus(dataDir, baseDataDir);
    if (status) {
      updateStatus(status, nextSymbols);
      await atomicWrite(statusFile, JSON.stringify(status, null, 2) + '\n');
    }
  } catch (error) {
    if (prevCustomText !== null) {
      await atomicWrite(customFile, prevCustomText).catch(() => {});
    } else {
      await unlink(customFile).catch(() => {});
    }
    throw error;
  }
}

export async function removeCustomSymbol(symbol, { dataDir, baseDataDir = null }) {
  if (!validSymbol(symbol)) throw Error('标的代码无效');
  if (SYMBOLS.includes(symbol)) throw Error('默认标的不可删除');
  if (isReservedSymbolFile(symbol)) throw Error('保留数据文件不可作为标的删除');
  return withDataLock(dataDir, async () => {
    const currentSymbols = await readCustomSymbols(dataDir);
    if (!currentSymbols.includes(symbol)) return { symbol, symbols: currentSymbols };
    const symbols = currentSymbols.filter(value => value !== symbol);
    const cacheFile = path.join(dataDir, symbol.toLowerCase() + '.json');
    const prevCacheText = await readOptional(cacheFile);
    await unlink(cacheFile).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    try {
      await writeCustomSymbolsWithStatus(dataDir, symbols, status => {
        status.results = (status.results || []).filter(result => result.symbol !== symbol);
        if (Array.isArray(status.requestedSources)) {
          status.requestedSources = status.requestedSources.filter(value => value !== symbol);
        }
        status.complete = isStatusComplete(status.results, status.expectedDate, symbols);
        syncRequestedComplete(status);
      }, { baseDataDir });
    } catch (error) {
      if (prevCacheText !== null) await atomicWrite(cacheFile, prevCacheText).catch(() => {});
      throw error;
    }
    return { symbol, symbols };
  });
}
