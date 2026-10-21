import path from 'node:path';
import { readOptional, atomicWrite, withDataLock } from './storage.mjs';
import { SYMBOLS, validSymbol } from '../public/js/domain/market.mjs';

export async function readCustomSymbols(dataDir) {
  const saved = await readOptional(path.join(dataDir, 'custom-symbols.json'));
  const symbols = saved ? JSON.parse(saved) : [];
  if (!Array.isArray(symbols) || symbols.some(s => !validSymbol(s)) ||
      new Set(symbols).size !== symbols.length) throw Error('自定义标的配置无效');
  // A formerly personal ticker may become built in after an upgrade.
  return symbols.filter(symbol => !SYMBOLS.includes(symbol));
}

export async function removeCustomSymbol(symbol, { dataDir }) {
  if (!validSymbol(symbol)) throw Error('标的代码无效');
  if (SYMBOLS.includes(symbol)) throw Error('默认标的不可删除');
  return withDataLock(dataDir, async () => {
    const symbols = (await readCustomSymbols(dataDir)).filter(value => value !== symbol);
    const file = path.join(dataDir, 'status.json');
    const saved = await readOptional(file);
    if (saved) {
      const status = JSON.parse(saved);
      status.results = status.results.filter(result => result.symbol !== symbol);
      if (status.requestedSources) status.requestedSources = status.requestedSources.filter(value => value !== symbol);
      const complete = result => result.ok && result.date >= status.expectedDate;
      status.complete = status.results.every(complete);
      status.requestedComplete = status.results.filter(result => status.requestedSources?.includes(result.symbol)).every(complete);
      await atomicWrite(file, JSON.stringify(status, null, 2) + '\n');
    }
    await atomicWrite(path.join(dataDir, 'custom-symbols.json'), JSON.stringify(symbols) + '\n');
    return { symbol, symbols };
  });
}
