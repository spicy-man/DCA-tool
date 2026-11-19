import { appEvents, events } from '../../services/events.mjs';
import { normalizeStatusStrategy } from '../../domain/signal-view.mjs';
import { validTotalAmount, validWeight } from '../../domain/strategy-summary.mjs';

const $ = id => document.getElementById(id);

// Historical localStorage key kept stable for backward compatibility; stores all strategy & allocation preferences.
const storageKey = 'seeker.pyramid.v1';
const symbolStorageKey = 'seeker.symbol.v1';
const strategyViewKey = 'seeker.strategyView.v1';

// fearEnabled controls whether fear buys run; when disabled (UI shows 0), fearBuyCount keeps the last positive value for legacy compatibility.
export const STRATEGY_DEFAULTS = Object.freeze({
  buyDay: 1,
  baseAmount: 2000,
  enabled: true,
  fearThreshold: 10,
  fearBuyCount: 0,
  fearEnabled: false
});

let strategyParams = { ...STRATEGY_DEFAULTS };
let fallback = {
  baseAmount: STRATEGY_DEFAULTS.baseAmount,
  fearBuyCount: STRATEGY_DEFAULTS.fearBuyCount,
  fearEnabled: STRATEGY_DEFAULTS.fearEnabled
};
let bySymbol = {};
let allocation = { totalAmount: STRATEGY_DEFAULTS.baseAmount, weights: {}, fearEnabled: {}, plan: 'kdFear' };
let viewStrategy = 'kdFear';
let sentimentRows = [];
let sentimentListeners = new Set();

export function onSentimentChange(listener) {
  sentimentListeners.add(listener);
  return () => sentimentListeners.delete(listener);
}

export function validBaseAmount(value) {
  return Number.isFinite(value) && (value === 0 || (value >= 0.01 && Number.isFinite(value * 3 ** 9)));
}

export function validFearBuyCount(count, baseAmount) {
  return Number.isSafeInteger(count) && count >= 1 && Number.isFinite(baseAmount * count);
}

export function validAllocationFearCount(raw, baseAmount) {
  return raw.trim() !== '' && (Number(raw) === 0 || validFearBuyCount(Number(raw), baseAmount));
}

export function normalizeAllocationPlan(plan) {
  return plan === 'pyramidFear' || plan === 'combined' ? 'combined' : 'kdFear';
}

export function activeSymbol(fallbackSymbol = 'SPY') {
  return $('symbol')?.value || fallbackSymbol;
}

export function symbolParams(symbol) {
  const entry = symbol && bySymbol[symbol];
  const baseAmount = entry && validBaseAmount(entry.baseAmount) ? entry.baseAmount : fallback.baseAmount;
  const fearBuyCount = entry && validFearBuyCount(entry.fearBuyCount, baseAmount)
    ? entry.fearBuyCount
    : validFearBuyCount(fallback.fearBuyCount, baseAmount) ? fallback.fearBuyCount : STRATEGY_DEFAULTS.fearBuyCount;
  const fearEnabled = entry && typeof entry.fearEnabled === 'boolean' ? entry.fearEnabled : fallback.fearEnabled;
  return { baseAmount, fearBuyCount, fearEnabled };
}

export function saveStrategySettings() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      ...strategyParams,
      baseAmount: fallback.baseAmount,
      fearBuyCount: fallback.fearBuyCount,
      fearEnabled: fallback.fearEnabled,
      bySymbol,
      allocation
    }));
  } catch {}
}

export function syncControlsForSymbol(symbol, { notify = true } = {}) {
  const params = symbolParams(symbol);
  strategyParams = { ...strategyParams, ...params };
  if ($('buy-day')) $('buy-day').value = strategyParams.buyDay;
  if ($('base-amount')) $('base-amount').value = strategyParams.baseAmount;
  if ($('fear-threshold')) $('fear-threshold').value = strategyParams.fearThreshold;
  if ($('fear-buy-count')) $('fear-buy-count').value = strategyParams.fearEnabled ? strategyParams.fearBuyCount : 0;
  if ($('signals-enabled')) $('signals-enabled').checked = strategyParams.enabled;
  if ($('signal-error')) $('signal-error').textContent = '';
  if (notify) appEvents.dispatchEvent(new CustomEvent(events.symbolSettings));
}

export function signalSettings() {
  return { ...strategyParams };
}

export function getSignalStrategy() {
  return viewStrategy;
}

export function setSignalStrategy(next) {
  viewStrategy = normalizeStatusStrategy(next);
  try {
    localStorage.setItem(strategyViewKey, viewStrategy);
  } catch {}
}

export function getAllocationState() {
  return allocation;
}

export function setAllocationState(next) {
  allocation = next;
}

export function setSymbolParams(symbol, entry) {
  bySymbol[symbol] = entry;
}

export function setStrategyParams(next) {
  strategyParams = next;
}

export function getSentimentRows() {
  return sentimentRows;
}

export function setSignalSentiment(rows, { notify = true } = {}) {
  sentimentRows = rows;
  for (const listener of sentimentListeners) listener();
  if (notify) appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
}

export function loadStrategySettings() {
  strategyParams = { ...STRATEGY_DEFAULTS };
  fallback = {
    baseAmount: STRATEGY_DEFAULTS.baseAmount,
    fearBuyCount: STRATEGY_DEFAULTS.fearBuyCount,
    fearEnabled: STRATEGY_DEFAULTS.fearEnabled
  };
  bySymbol = {};
  allocation = { totalAmount: STRATEGY_DEFAULTS.baseAmount, weights: {}, fearEnabled: {}, plan: 'kdFear' };
  viewStrategy = 'kdFear';
  try {
    viewStrategy = normalizeStatusStrategy(localStorage.getItem(strategyViewKey));
  } catch {}

  let initialSymbol = $('symbol')?.value || 'SPY';
  try {
    const savedSymbol = localStorage.getItem(symbolStorageKey);
    if (savedSymbol && Array.from($('symbol')?.options || []).some(option => option.value === savedSymbol)) {
      initialSymbol = savedSymbol;
    }
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (
      saved &&
      Number.isInteger(saved.buyDay) &&
      saved.buyDay >= 1 &&
      saved.buyDay <= 31 &&
      validBaseAmount(saved.baseAmount)
    ) {
      const hasSavedFearCount = validFearBuyCount(saved.fearBuyCount, saved.baseAmount);
      fallback = {
        baseAmount: saved.baseAmount,
        fearBuyCount: hasSavedFearCount ? saved.fearBuyCount : STRATEGY_DEFAULTS.fearBuyCount,
        fearEnabled: typeof saved.fearEnabled === 'boolean'
          ? saved.fearEnabled
          : (hasSavedFearCount ? true : STRATEGY_DEFAULTS.fearEnabled)
      };
      strategyParams = {
        ...STRATEGY_DEFAULTS,
        buyDay: saved.buyDay,
        baseAmount: fallback.baseAmount,
        enabled: saved.enabled !== false,
        fearBuyCount: fallback.fearBuyCount,
        fearEnabled: fallback.fearEnabled,
        fearThreshold:
          Number.isFinite(saved.fearThreshold) && saved.fearThreshold > 0 && saved.fearThreshold <= 95
            ? saved.fearThreshold
            : 10
      };
      if (saved.bySymbol && typeof saved.bySymbol === 'object') {
        for (const [symbol, entry] of Object.entries(saved.bySymbol)) {
          if (!entry || !validBaseAmount(entry.baseAmount)) continue;
          const hasEntryFearCount = validFearBuyCount(entry.fearBuyCount, entry.baseAmount);
          bySymbol[symbol] = {
            baseAmount: entry.baseAmount,
            fearBuyCount: hasEntryFearCount ? entry.fearBuyCount : fallback.fearBuyCount,
            fearEnabled: typeof entry.fearEnabled === 'boolean'
              ? entry.fearEnabled
              : (hasEntryFearCount ? true : fallback.fearEnabled)
          };
        }
      }
      if (saved.allocation && typeof saved.allocation === 'object') {
        const totalAmount = validTotalAmount(saved.allocation.totalAmount)
          ? saved.allocation.totalAmount
          : validTotalAmount(fallback.baseAmount)
            ? fallback.baseAmount
            : STRATEGY_DEFAULTS.baseAmount;
        const weights = {};
        if (saved.allocation.weights && typeof saved.allocation.weights === 'object') {
          for (const [symbol, weight] of Object.entries(saved.allocation.weights)) {
            if (validWeight(weight)) weights[symbol] = weight;
          }
        }
        const fearEnabled = {};
        if (saved.allocation.fearEnabled && typeof saved.allocation.fearEnabled === 'object') {
          for (const [symbol, enabled] of Object.entries(saved.allocation.fearEnabled)) {
            if (typeof enabled === 'boolean') fearEnabled[symbol] = enabled;
          }
        }
        allocation = {
          totalAmount,
          weights,
          fearEnabled,
          plan: normalizeAllocationPlan(saved.allocation.plan)
        };
      } else {
        allocation = {
          totalAmount: validTotalAmount(fallback.baseAmount) ? fallback.baseAmount : STRATEGY_DEFAULTS.baseAmount,
          weights: {},
          fearEnabled: {},
          plan: 'kdFear'
        };
      }
    }
  } catch {}

  const initialParams = symbolParams(initialSymbol);
  strategyParams = { ...strategyParams, ...initialParams };
  return strategyParams;
}
