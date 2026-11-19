import { updateBacktest, initBacktest } from './backtest.mjs';
import { calculateKDSignals } from '../../domain/kd-strategy.mjs';
import { getKDOptions } from './kd.mjs';
import { SIGNAL_STRATEGIES, selectSignalHistory, signalName, formatMultiple } from '../../domain/signal-view.mjs';
import { appEvents, events } from '../../services/events.mjs';
import {
  invalidateAllMarketSnapshots,
  seedMarketRows
} from '../../services/market-store.mjs';
import { evaluateFearStrategy } from '../../domain/fear-strategy.mjs';
import { renderStrategySummary } from './summary.mjs';
import { allocateWeightedAmounts } from '../../domain/strategy-summary.mjs';
import { calculatePyramidSignals } from '../../domain/pyramid-strategy.mjs';
import { downloadCSV, formatCSV } from '../../ui/download.mjs';
import { formatMoney } from '../../ui/format.mjs';
import { tooltipContent, positionTooltip } from '../../ui/tooltip.mjs';
import { initAllocationDialog } from './allocation-dialog.mjs';
import {
  activeSymbol,
  getAllocationState,
  getSentimentRows,
  getSignalStrategy,
  loadStrategySettings,
  saveStrategySettings,
  setAllocationState,
  setSignalSentiment,
  setSignalStrategy,
  setStrategyParams,
  setSymbolParams,
  signalSettings,
  symbolParams,
  syncControlsForSymbol,
  validBaseAmount,
  validFearBuyCount
} from './settings.mjs';

export { allocateWeightedAmounts, signalSettings, getSignalStrategy, setSignalSentiment };

const $ = id => document.getElementById(id);
const cache = new WeakMap();

let current = [];
let allCurrent = [];
let market = null;
let viewRange = null;
let candleMap = new Map();

export function getVisibleSignals() {
  return current;
}

export function signalForDate(date) {
  return current.filter(signal => signal.date === date);
}

export function updateSignals(data, nextRange, { syncBacktest = true, seedStore = true } = {}) {
  const previousSymbol = market?.symbol;
  market = data;
  viewRange = nextRange;
  const strategyParams = signalSettings();
  const viewStrategy = getSignalStrategy();
  if (!data || !nextRange) {
    renderStrategySummary(null, null, strategyParams, [], null, { strategy: viewStrategy, kdOptions: getKDOptions() });
    updateBacktest(null);
    current = [];
    allCurrent = [];
    candleMap = new Map();
    const layer = $('signal-layer');
    layer.replaceChildren();
    layer.dataset.layout = '';
    $('signal-note').textContent = '';
    $('signal-total').textContent = '';
    $('signal-table').replaceChildren();
    return;
  }
  if (seedStore && !nextRange.replay && data.symbol && data.rows?.length) {
    seedMarketRows(data.symbol, data.rows);
  }
  if (data.symbol && data.symbol !== previousSymbol) {
    syncControlsForSymbol(data.symbol);
  }

  const activeParams = signalSettings();
  const sentimentRows = getSentimentRows();
  let computed = cache.get(data.rows);
  if (!computed) {
    computed = new Map();
    cache.set(data.rows, computed);
  }
  const key = activeParams.buyDay + ':' + activeParams.baseAmount;
  if (!computed.has(key)) {
    computed.set(key, activeParams.baseAmount === 0 ? [] : calculatePyramidSignals(data.rows, activeParams));
  }

  const replayRows = nextRange.replay ? data.rows.filter(row => row.date <= nextRange.end) : data.rows;
  const rawFear = evaluateFearStrategy(
    replayRows,
    nextRange.replay ? sentimentRows.filter(row => row.date <= nextRange.end) : sentimentRows,
    { ...activeParams, baseAmount: activeParams.baseAmount || 1, fearBuyCount: Math.max(1, activeParams.fearBuyCount) }
  );
  const fear = activeParams.baseAmount === 0 || !activeParams.fearEnabled
    ? { ...rawFear, signals: [], pending: [], disabled: !activeParams.fearEnabled }
    : rawFear;
  const kdOptions = getKDOptions();
  const fullMonthlySignals = computed.get(key);
  const fullKdSignals = syncBacktest || viewStrategy === 'kdFear'
    ? calculateKDSignals(data.rows, fullMonthlySignals, { ...kdOptions, baseAmount: activeParams.baseAmount })
    : [];
  const monthlySignals = nextRange.replay ? fullMonthlySignals.filter(s => s.date <= nextRange.end) : fullMonthlySignals;
  const kdSignals = nextRange.replay ? fullKdSignals.filter(s => s.date <= nextRange.end) : fullKdSignals;
  const history = selectSignalHistory(viewStrategy, {
    monthlySignals, fearSignals: fear.signals, kdSignals, baseAmount: activeParams.baseAmount
  });
  renderStrategySummary(data, nextRange, activeParams, history, fear, { strategy: viewStrategy, kdOptions });
  if (syncBacktest) {
    updateBacktest({
      rows: data.rows,
      monthlySignals,
      kdSignals,
      fearSignals: fear.signals,
      range: nextRange,
      baseAmount: activeParams.baseAmount,
      symbol: data.symbol,
      sentiment: sentimentRows,
      strategy: viewStrategy
    });
  }
  allCurrent = history.filter(r => r.date >= nextRange.start && r.date <= nextRange.end);

  current = activeParams.enabled && nextRange.frequency === 'daily' ? allCurrent : [];
  candleMap = new Map(data.rows.map(r => [r.date, r]));
  $('signal-note').textContent =
    nextRange.frequency !== 'daily'
      ? '买入信号仅在 1 日 K 线显示'
      : !activeParams.enabled
        ? '买入信号已隐藏'
        : activeParams.baseAmount === 0
          ? '当前标的 1N = 0.00，不生成买入信号'
          : `当前区间 ${allCurrent.length} 笔 · ${SIGNAL_STRATEGIES[viewStrategy]} · 每月 ${activeParams.buyDay} 日` +
            (['combined', 'kdFear'].includes(viewStrategy)
              ? (activeParams.fearEnabled ? ` + F&G 跌破 ${activeParams.fearThreshold}` : '（未启用恐慌加投）')
              : '');
  const usesKD = viewStrategy === 'kdFear';
  $('strategy-heading').textContent = SIGNAL_STRATEGIES[viewStrategy] + '买入信号';
  $('signal-pyramid-explanation').hidden = usesKD;
  $('signal-strategy-rule').textContent = usesKD
    ? '按已收盘周线加权K分档，恐慌信号独立加投。月度信号收盘确认后，在下一可用交易日开盘成交。'
    : '月跌幅金字塔与恐慌加投独立累加。月度按信号日展示，在下一可用交易日开盘成交。';
  renderSignalTable();
}

export function signalTooltipRows(signal) {
  if (Array.isArray(signal)) return signal.flatMap(signalTooltipRows);
  const amountFormatted = formatMoney(signal.amount);
  if (signal.type === 'fear') {
    return [
      ['信号类型', '恐慌加投'],
      ['指数信号日', signal.signalDate],
      ['F&G 下穿', signal.previousScore.toFixed(2) + ' → ' + signal.score.toFixed(2)],
      ['触发 / 重置', signal.fearThreshold + ' / ' + signal.rearmThreshold],
      ['买入（N）', signal.multiple + 'N'],
      ['投入金额', amountFormatted]
    ];
  }
  if (signal.strategy === 'regular') {
    return [
      ['信号类型', '普通定投'],
      ['定投所属月份', signal.scheduledMonth],
      ['计划定投日', signal.scheduledDate],
      ['买入（N）', '1N'],
      ['投入金额', amountFormatted],
      ['成交口径', '信号收盘后，下一交易日开盘']
    ];
  }
  if (signal.strategy === 'kd') {
    return [
      ['信号类型', '加权K定投'],
      ['定投所属月份', signal.scheduledMonth],
      ['计划定投日', signal.scheduledDate],
      ['使用的周收盘', signal.signalWeek ?? '无已完成周线'],
      ['月K', signal.monthK?.toFixed(2) ?? '—'],
      ['季度K', signal.quarterK?.toFixed(2) ?? '—'],
      ['加权K', signal.weightedK?.toFixed(2) ?? '—'],
      ['买入（N）', formatMultiple(signal.multiple) + 'N'],
      ['投入金额', amountFormatted],
      ['成交口径', '信号收盘后，下一交易日开盘']
    ];
  }
  return [
    ['信号类型', '月度定投'],
    ['定投所属月份', signal.scheduledMonth],
    ['计划定投日', signal.scheduledDate],
    ['近月高点', signal.monthHigh.toFixed(2)],
    ['距高点回撤', (signal.drawdown * 100).toFixed(2) + '%'],
    ['买入（N）', signal.multiple + 'N'],
    ['投入金额', amountFormatted]
  ];
}

export function showMarketTooltip(tip, row, { x, y, width, symbol, frequency, signal = signalForDate(row.date) }) {
  tooltipContent(tip, {
    title: symbol + ' · ' + row.date,
    rows: [
      ['开盘价', row.open.toFixed(2)],
      ['最高价', row.high.toFixed(2)],
      ['最低价', row.low.toFixed(2)],
      ['收盘价', row.close.toFixed(2)],
      ...(signal ? signalTooltipRows(signal) : [])
    ],
    footer: '前复权 · ' + (frequency === 'daily' ? '日线' : frequency === 'weekly' ? '周线' : '月线')
  });
  positionTooltip(tip, x, y, width);
}

export function drawSignalMarkers(frame) {
  const layer = $('signal-layer');
  if (!frame || !current.length) {
    layer.replaceChildren();
    layer.dataset.layout = '';
    return;
  }

  const points = current
    .map(signal => ({ signal, x: frame.x(signal.date), row: candleMap.get(signal.date) }))
    .filter(p => p.row);
  const floating = !!layer.closest('.floating-charts');
  // Cache rendered values and coordinates, including corrections to historical data.
  // Equal row counts and last dates do not identify the same snapshot or calendar.
  const layout = JSON.stringify([
    market.symbol,
    frame.w,
    frame.h,
    frame.bottom,
    floating,
    points.map(({ signal, x, row }) => [signal, row, x, frame.y(row.low)])
  ]);

  if (layer.dataset.layout === layout) return;
  layer.dataset.layout = layout;
  layer.replaceChildren();

  const dense = points.some((p, i) => i && p.x > points[i - 1].x && p.x - points[i - 1].x < 54);
  const sameDateCounts = new Map();
  const totalsByDate = new Map();
  for (const { signal } of points) {
    totalsByDate.set(signal.date, (totalsByDate.get(signal.date) || 0) + 1);
  }

  for (const p of points) {
    const slot = sameDateCounts.get(p.signal.date) || 0;
    sameDateCounts.set(p.signal.date, slot + 1);

    const marker = document.createElement('button');
    marker.type = 'button';
    marker.className =
      'buy-marker' + (p.signal.type === 'fear' ? ' is-fear' : '') + (dense ? ' is-compact' : '');
    marker.textContent = 'buy ' + p.signal.multiple.toLocaleString('en-US', { maximumFractionDigits: 4 }) + 'N';
    marker.dataset.date = p.signal.date;
    marker.dataset.type = p.signal.type;
    marker.dataset.multiple = p.signal.multiple;
    marker.setAttribute(
      'aria-label',
      `${p.signal.date} ${signalName(p.signal)} 买入 ${formatMultiple(p.signal.multiple)}N，${p.signal.amount.toFixed(2)}`
    );
    marker.style.left = p.x + 'px';
    marker.style.top = (floating
      ? Math.min(frame.h - frame.bottom - 12 - (totalsByDate.get(p.signal.date) - 1) * 12, frame.y(p.row.low) + 3) + slot * 12
      : Math.min(frame.h - frame.bottom - 47, frame.y(p.row.low) + 8) + slot * 24) + 'px';

    const show = () =>
      showMarketTooltip($('price-tooltip'), p.row, {
        x: p.x,
        y: Math.min(frame.h - 32, frame.y(p.row.low)),
        width: frame.w,
        symbol: market.symbol,
        frequency: 'daily',
        signal: p.signal
      });
    marker.addEventListener('pointerenter', show);
    marker.addEventListener('focus', show);
    marker.addEventListener('click', show);
    marker.addEventListener('pointerleave', event => {
      if (event.relatedTarget?.closest?.('#price-tooltip')) return;
      $('price-tooltip').hidden = true;
    });
    marker.addEventListener('blur', () => {
      $('price-tooltip').hidden = true;
    });
    layer.append(marker);
  }
}

function renderSignalTable() {
  if (!$('signal-table').closest('details').open) return;
  $('signal-table').replaceChildren(
    ...allCurrent
      .slice()
      .reverse()
      .map(signal => {
        const tr = document.createElement('tr');
        const metricLabel = signal.type === 'fear'
          ? '—'
          : signal.strategy === 'kd'
            ? '加权K ' + (signal.weightedK?.toFixed(2) ?? '无周线，按1N')
            : signal.strategy === 'regular'
              ? '固定1N'
              : (signal.drawdown * 100).toFixed(2) + '%';
        const cells = [
          signal.date,
          signal.type === 'fear'
            ? '恐慌加投 · F&G ' + signal.score.toFixed(2)
            : signalName(signal) + ' · ' + signal.scheduledMonth,
          metricLabel,
          formatMultiple(signal.multiple) + 'N',
          formatMoney(signal.amount)
        ];
        for (const v of cells) {
          const td = document.createElement('td');
          td.textContent = v;
          tr.append(td);
        }
        return tr;
      })
  );
  const totalAmount = formatMoney(allCurrent.reduce((sum, s) => sum + s.amount, 0));
  $('signal-total').textContent = `当前区间 ${allCurrent.length} 笔 · 合计 ${totalAmount}`;
}

function apply() {
  const rawBaseAmount = String($('base-amount').value ?? '').trim();
  const rawFearInput = String($('fear-buy-count').value ?? '').trim();
  const buyDay = Number($('buy-day').value);
  const baseAmount = Number(rawBaseAmount);
  const fearThreshold = Number($('fear-threshold').value);
  const rawFearCount = Number(rawFearInput);
  if (!Number.isInteger(buyDay) || buyDay < 1 || buyDay > 31) {
    $('signal-error').textContent = '定投日须为 1–31 的整数';
    return;
  }
  if (!rawBaseAmount || !validBaseAmount(baseAmount)) {
    $('signal-error').textContent = 'N 请输入 0 或不小于 0.01 的有效金额';
    return;
  }
  if (!Number.isFinite(fearThreshold) || fearThreshold <= 0 || fearThreshold > 95) {
    $('signal-error').textContent = 'F&G 阈值请输入大于 0 且不超过 95 的数值';
    return;
  }
  if (!rawFearInput || (rawFearCount !== 0 && !validFearBuyCount(rawFearCount, baseAmount))) {
    $('signal-error').textContent = '恐慌加投倍数须为 0（不启用）或不小于 1 的整数，且加投金额须在可计算范围内';
    return;
  }
  $('signal-error').textContent = '';
  const symbol = activeSymbol(market?.symbol || 'SPY');
  const prevCount = symbolParams(symbol).fearBuyCount;
  const fearEnabled = rawFearCount !== 0;
  const fearBuyCount = fearEnabled ? rawFearCount : prevCount;
  setSymbolParams(symbol, { baseAmount, fearBuyCount, fearEnabled });
  const allocation = getAllocationState();
  setAllocationState({ ...allocation, fearEnabled: { ...allocation.fearEnabled, [symbol]: fearEnabled } });
  setStrategyParams({
    buyDay,
    baseAmount,
    fearThreshold,
    fearBuyCount,
    fearEnabled,
    enabled: $('signals-enabled').checked
  });
  saveStrategySettings();
  appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
}

export function initStrategyOverlay({ includeSubmodules = true } = {}) {
  if (includeSubmodules) initBacktest();
  market = null;
  viewRange = null;
  current = [];
  allCurrent = [];
  candleMap = new Map();

  const initialParams = loadStrategySettings();

  const syncStatusSwitch = () => {
    const kd = getSignalStrategy() === 'kdFear';
    $('status-strategy-combined').setAttribute('aria-pressed', String(!kd));
    $('status-strategy-kdFear').setAttribute('aria-pressed', String(kd));
  };
  syncStatusSwitch();
  for (const [id, strategy] of [['status-strategy-combined', 'combined'], ['status-strategy-kdFear', 'kdFear']]) {
    $(id).addEventListener('click', () => {
      if (getSignalStrategy() === strategy) return;
      setSignalStrategy(strategy);
      syncStatusSwitch();
      updateSignals(market, viewRange, { syncBacktest: false, seedStore: false });
      appEvents.dispatchEvent(new CustomEvent(events.strategyView, { detail: getSignalStrategy() }));
    });
  }

  invalidateAllMarketSnapshots({ notify: false });
  $('price-tooltip').addEventListener('pointerleave', () => { $('price-tooltip').hidden = true; });
  $('signal-table').closest('details').addEventListener('toggle', renderSignalTable);

  $('fear-threshold').value = initialParams.fearThreshold;
  $('fear-buy-count').value = initialParams.fearEnabled ? initialParams.fearBuyCount : 0;
  $('buy-day').value = initialParams.buyDay;
  $('base-amount').value = initialParams.baseAmount;
  $('signals-enabled').checked = initialParams.enabled;
  appEvents.dispatchEvent(new CustomEvent(events.symbolSettings));

  $('symbol').addEventListener('change', () => {
    syncControlsForSymbol(activeSymbol(market?.symbol || 'SPY'));
  });

  for (const id of ['buy-day', 'base-amount', 'fear-threshold', 'fear-buy-count', 'signals-enabled']) {
    const eventType = id === 'base-amount' || id === 'fear-threshold' || id === 'fear-buy-count' ? 'input' : 'change';
    $(id).addEventListener(eventType, apply);
  }

  if (includeSubmodules) initAllocationDialog();

  $('signal-download').addEventListener('click', () => {
    if (!market || !allCurrent.length) return;
    const viewStrategy = getSignalStrategy();
    const csv = formatCSV([
      [
        'Symbol', 'Date', 'BuyDay', 'BaseAmountUSD', 'MonthCutoff', 'MonthHigh', 'Drawdown',
        'Multiple', 'AmountUSD', 'SignalType', 'SignalDate', 'FearScore', 'FearThreshold',
        'RearmThreshold', 'ScheduledMonth', 'ScheduledDate', 'Strategy',
        'MonthK', 'QuarterK', 'WeightedK', 'SignalWeek'
      ],
      ...allCurrent.map(s => [
        market.symbol,
        s.date,
        s.buyDay,
        s.baseAmount,
        s.strategy === 'regular' ? '' : s.cutoff,
        s.strategy === 'regular' ? '' : s.monthHigh,
        s.strategy === 'regular' ? '' : s.drawdown,
        s.multiple,
        s.amount,
        s.type,
        s.signalDate ?? '',
        s.score ?? '',
        s.fearThreshold ?? '',
        s.rearmThreshold ?? '',
        s.scheduledMonth ?? '',
        s.scheduledDate ?? '',
        viewStrategy,
        s.monthK ?? '',
        s.quarterK ?? '',
        s.weightedK ?? '',
        s.signalWeek ?? ''
      ])
    ]);
    downloadCSV(market.symbol + '-' + viewStrategy + '-dca-signals.csv', csv);
  });
}
