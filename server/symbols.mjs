import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { readOptional, readJsonOptional, atomicWrite, withDataLock } from './storage.mjs';
import { SYMBOLS, validSymbol } from '../public/js/domain/market.mjs';
import { isStatusComplete } from '../public/js/domain/data-health.mjs';

export async function readCustomSymbols(dataDir) {
  const saved = await readOptional(path.join(dataDir, 'custom-symbols.json'));
  const symbols = saved ? JSON.parse(saved) : [];
  if (!Array.isArray(symbols) || symbols.some(s => !validSymbol(s)) ||
      new Set(symbols).size !== symbols.length) throw Error('自定义标的配置无效');
  // A formerly personal ticker may become built in after an upgrade.
  return symbols.filter(symbol => !SYMBOLS.includes(symbol));
}

export async function writeCustomSymbolsWithStatus(dataDir, nextSymbols, updateStatus) {
  const customFile = path.join(dataDir, 'custom-symbols.json');
  const statusFile = path.join(dataDir, 'status.json');
  const prevCustomText = await readOptional(customFile);
  await atomicWrite(customFile, JSON.stringify(nextSymbols) + '\n');
  try {
    const status = await readJsonOptional(statusFile);
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

export async function removeCustomSymbol(symbol, { dataDir }) {
  if (!validSymbol(symbol)) throw Error('标的代码无效');
  if (SYMBOLS.includes(symbol)) throw Error('默认标的不可删除');
  return withDataLock(dataDir, async () => {
    const symbols = (await readCustomSymbols(dataDir)).filter(value => value !== symbol);
    await writeCustomSymbolsWithStatus(dataDir, symbols, status => {
      status.results = (status.results || []).filter(result => result.symbol !== symbol);
      if (status.requestedSources) status.requestedSources = status.requestedSources.filter(value => value !== symbol);
      const complete = result => result.ok && result.date >= status.expectedDate;
      status.complete = isStatusComplete(status.results, status.expectedDate, symbols);
      status.requestedComplete = status.results.filter(result => status.requestedSources?.includes(result.symbol)).every(complete);
    });
    await unlink(path.join(dataDir, symbol.toLowerCase() + '.json')).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    return { symbol, symbols };
  });
}
