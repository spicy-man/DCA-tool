export const SIGNAL_STRATEGIES = Object.freeze({
  regular: '普通定投（每月1N）',
  pyramid: '回撤金字塔',
  combined: '金字塔＋恐慌加投',
  kd: 'KD 定投',
  kdFear: 'KD 定投＋恐慌加投'
});

export const normalizeSignalStrategy = value => Object.hasOwn(SIGNAL_STRATEGIES, value) ? value : 'combined';
export const normalizeStatusStrategy = value => value === 'kd' || value === 'kdFear' ? 'kdFear' : 'combined';
export const formatMultiple = value => value.toLocaleString('en-US', { maximumFractionDigits: 10 });

export function signalName(signal) {
  if (signal.type === 'fear') return '恐慌加投';
  if (signal.strategy === 'kd') return 'KD定投';
  if (signal.strategy === 'regular') return '普通定投';
  return '月度定投';
}

// Display signals share the backtest inputs without mutating them.
export function selectSignalHistory(strategy, { monthlySignals = [], fearSignals = [], kdSignals = [], baseAmount = 1000 }) {
  strategy = normalizeSignalStrategy(strategy);
  const usesKD = strategy === 'kd' || strategy === 'kdFear';
  const monthly = usesKD ? kdSignals : monthlySignals;
  const kind = usesKD ? 'kd' : strategy === 'regular' ? 'regular' : 'pyramid';
  const signals = monthly.map(signal => ({
    ...signal,
    type: 'monthly',
    strategy: kind,
    ...(kind === 'regular' ? { multiple: 1, amount: baseAmount } : {})
  }));
  if (strategy === 'combined' || strategy === 'kdFear') signals.push(...fearSignals);
  return signals.sort((a, b) => a.date.localeCompare(b.date));
}
