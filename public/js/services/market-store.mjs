import { loadMarketSnapshot } from './data-client.mjs';

// Single frontend cache for market snapshots shared by the main K-line chart and portfolio allocation dialog.
const snapshots = new Map();
const seededRows = new Map();
const loadingSymbols = new Set();
const failedSymbols = new Set();
const symbolEpochs = new Map();
const listeners = new Set();
let globalEpoch = 0;

function notifyChange() {
  for (const listener of listeners) listener();
}

export function onMarketStoreChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyMarketStoreChange() {
  notifyChange();
}

export function getMarketSnapshot(symbol) {
  return snapshots.get(symbol) ?? null;
}

export function getMarketRows(symbol) {
  return snapshots.get(symbol)?.rows ?? seededRows.get(symbol) ?? null;
}

export function hasMarketSnapshot(symbol) {
  return snapshots.has(symbol);
}

export function setMarketSnapshot(symbol, data, { notify = true } = {}) {
  const prevRows = getMarketRows(symbol);
  symbolEpochs.set(symbol, (symbolEpochs.get(symbol) || 0) + 1);
  loadingSymbols.delete(symbol);
  snapshots.set(symbol, data);
  seededRows.delete(symbol);
  failedSymbols.delete(symbol);
  if (notify && prevRows !== data?.rows) notifyChange();
}

export function seedMarketRows(symbol, rows, { notify = true } = {}) {
  if (!rows?.length || snapshots.has(symbol)) return;
  const prevRows = getMarketRows(symbol);
  symbolEpochs.set(symbol, (symbolEpochs.get(symbol) || 0) + 1);
  loadingSymbols.delete(symbol);
  seededRows.set(symbol, rows);
  failedSymbols.delete(symbol);
  if (notify && prevRows !== rows) notifyChange();
}

export function isMarketLoading(symbol) {
  return loadingSymbols.has(symbol);
}

export function clearFailedMarketSymbols() {
  failedSymbols.clear();
}

export function invalidateMarketSymbol(symbol) {
  symbolEpochs.set(symbol, (symbolEpochs.get(symbol) || 0) + 1);
  snapshots.delete(symbol);
  seededRows.delete(symbol);
  loadingSymbols.delete(symbol);
  failedSymbols.delete(symbol);
  notifyChange();
}

export function invalidateAllMarketSnapshots({ notify = true } = {}) {
  globalEpoch++;
  snapshots.clear();
  seededRows.clear();
  loadingSymbols.clear();
  failedSymbols.clear();
  if (notify) notifyChange();
}

export function ensureMarketSnapshots(symbols) {
  if (typeof fetch !== 'function') return;
  for (const symbol of symbols) {
    if (getMarketRows(symbol)?.length || loadingSymbols.has(symbol) || failedSymbols.has(symbol)) continue;
    loadingSymbols.add(symbol);
    const epoch = globalEpoch;
    const symbolEpoch = symbolEpochs.get(symbol) || 0;
    loadMarketSnapshot(symbol)
      .then(snapshot => {
        if (epoch !== globalEpoch || symbolEpoch !== (symbolEpochs.get(symbol) || 0) || getMarketRows(symbol)?.length) return;
        if (snapshot?.rows?.length) {
          snapshots.set(symbol, snapshot);
        } else {
          failedSymbols.add(symbol);
        }
      })
      .catch(() => {
        if (epoch === globalEpoch && symbolEpoch === (symbolEpochs.get(symbol) || 0) && !getMarketRows(symbol)?.length) {
          failedSymbols.add(symbol);
        }
      })
      .finally(() => {
        if (epoch !== globalEpoch || symbolEpoch !== (symbolEpochs.get(symbol) || 0)) return;
        loadingSymbols.delete(symbol);
        notifyChange();
      });
  }
}
