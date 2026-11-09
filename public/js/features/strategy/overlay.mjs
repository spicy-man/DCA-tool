import { updateBacktest, initBacktest } from './backtest.mjs';
import { appEvents, events } from '../../services/events.mjs';
import { chartInsets, createTradingScale, createProfitAxis } from '../../charts/geometry.mjs';
import { loadMarketSnapshot } from '../../services/data-client.mjs';
import { evaluateFearStrategy } from '../../domain/fear-strategy.mjs';
import { renderStrategySummary } from './summary.mjs';
import { summarizePortfolioFunding } from '../../domain/strategy-summary.mjs';
import { calculatePyramidSignals } from '../../domain/pyramid-strategy.mjs';
import { downloadCSV } from '../../ui/download.mjs';
import { tooltipContent, positionTooltip } from '../../ui/tooltip.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'seeker.pyramid.v1';
const symbolStorageKey = 'seeker.symbol.v1';
const cache = new WeakMap();
const defaults = { buyDay: 1, baseAmount: 2000, enabled: true, fearThreshold: 10, fearBuyCount: 3, fearEnabled: true };

let state = { ...defaults };
let fallback = { baseAmount: defaults.baseAmount, fearBuyCount: defaults.fearBuyCount, fearEnabled: defaults.fearEnabled };
let bySymbol = {};
let allocation = { totalAmount: defaults.baseAmount, weights: {}, fearEnabled: {} };
let current = [];
let allCurrent = [];
let market = null;
let settings = null;
let candleMap = new Map();
let sentimentRows = [];
const marketRowsBySymbol = new Map();
const loadingSymbols = new Set();
const failedSymbols = new Set();

function validBaseAmount(value) {
  return Number.isFinite(value) && (value === 0 || (value >= 0.01 && Number.isFinite(value * 38)));
}

function validTotalAmount(value) {
  return Number.isFinite(value) && value >= 0.01 && Number.isFinite(value * 38);
}

function validFearBuyCount(count, baseAmount) {
  return Number.isSafeInteger(count) && count >= 1 && Number.isFinite(baseAmount * count);
}

function validWeight(value) {
  return Number.isFinite(value) && value >= 0 && value <= 10000;
}

function activeSymbol() {
  return $('symbol')?.value || market?.symbol || 'SPY';
}

function symbolParams(symbol) {
  const entry = symbol && bySymbol[symbol];
  const baseAmount = entry && validBaseAmount(entry.baseAmount) ? entry.baseAmount : fallback.baseAmount;
  const fearBuyCount = entry && validFearBuyCount(entry.fearBuyCount, baseAmount)
    ? entry.fearBuyCount
    : validFearBuyCount(fallback.fearBuyCount, baseAmount) ? fallback.fearBuyCount : defaults.fearBuyCount;
  const fearEnabled = entry && typeof entry.fearEnabled === 'boolean' ? entry.fearEnabled : fallback.fearEnabled;
  return { baseAmount, fearBuyCount, fearEnabled };
}

function saveStorage() {
  try {
    localStorage.setItem(storageKey, JSON.stringify({
      ...state,
      baseAmount: fallback.baseAmount,
      fearBuyCount: fallback.fearBuyCount,
      fearEnabled: fallback.fearEnabled,
      bySymbol,
      allocation
    }));
  } catch {}
}

function syncControlsForSymbol(symbol) {
  const params = symbolParams(symbol);
  state = { ...state, ...params };
  if ($('buy-day')) $('buy-day').value = state.buyDay;
  if ($('base-amount')) $('base-amount').value = state.baseAmount;
  if ($('fear-threshold')) $('fear-threshold').value = state.fearThreshold;
  if ($('fear-buy-count')) $('fear-buy-count').value = state.fearEnabled ? state.fearBuyCount : 0;
  if ($('signals-enabled')) $('signals-enabled').checked = state.enabled;
  if ($('signal-error')) $('signal-error').textContent = '';
}

export function setSignalSentiment(rows) {
  sentimentRows = rows;
  appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
}

export function signalSettings() {
  return { ...state };
}

export function getVisibleSignals() {
  return current;
}

export function signalForDate(date) {
  return current.filter(signal => signal.date === date);
}

export function updateSignals(data, next, { syncBacktest = true } = {}) {
  const previousSymbol = market?.symbol;
  market = data;
  settings = next;
  if (!data || !next) {
    renderStrategySummary(null, null, state);
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
  if (data.symbol && data.rows?.length) {
    marketRowsBySymbol.set(data.symbol, data.rows);
    failedSymbols.delete(data.symbol);
  }
  if (data.symbol && data.symbol !== previousSymbol) {
    syncControlsForSymbol(data.symbol);
  }

  let computed = cache.get(data.rows);
  if (!computed) {
    computed = new Map();
    cache.set(data.rows, computed);
  }
  const key = state.buyDay + ':' + state.baseAmount;
  if (!computed.has(key)) {
    computed.set(key, state.baseAmount === 0 ? [] : calculatePyramidSignals(data.rows, state));
  }

  const rawFear = evaluateFearStrategy(
    data.rows,
    next.replay ? sentimentRows.filter(row => row.date <= next.end) : sentimentRows,
    { ...state, baseAmount: state.baseAmount || 1, fearBuyCount: Math.max(1, state.fearBuyCount) }
  );
  const fear = state.baseAmount === 0 || !state.fearEnabled
    ? { ...rawFear, signals: [], pending: [], disabled: !state.fearEnabled }
    : rawFear;
  const history = [
    ...computed.get(key).map(s => ({ ...s, type: 'monthly' })),
    ...fear.signals
  ]
    .sort((a, b) => a.date.localeCompare(b.date));
  renderStrategySummary(data, next, state, history, fear);
  if (syncBacktest) updateBacktest({ rows: data.rows, monthlySignals: computed.get(key), fearSignals: fear.signals, range: next, baseAmount: state.baseAmount, symbol: data.symbol, sentiment: sentimentRows });
  allCurrent = history.filter(r => r.date >= next.start && r.date <= next.end);

  current = state.enabled && next.frequency === 'daily' ? allCurrent : [];
  candleMap = new Map(data.rows.map(r => [r.date, r]));
  $('signal-note').textContent =
    next.frequency !== 'daily'
      ? '买入信号仅在 1 日 K 线显示'
      : !state.enabled
        ? '买入信号已隐藏'
        : state.baseAmount === 0
          ? '当前标的 1N = 0.00，不生成买入信号'
          : !state.fearEnabled
            ? `当前区间 ${allCurrent.length} 笔 · 每月 ${state.buyDay} 日（未启用恐慌加投）`
            : `当前区间 ${allCurrent.length} 笔 · 每月 ${state.buyDay} 日 + F&G 跌破 ${state.fearThreshold}`;
  renderSignalTable();
}

export function signalTooltipRows(signal) {
  if (Array.isArray(signal)) return signal.flatMap(signalTooltipRows);
  const amountFormatted =
    signal.amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
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
    marker.textContent = 'buy ' + p.signal.multiple + 'N';
    marker.dataset.date = p.signal.date;
    marker.dataset.type = p.signal.type;
    marker.dataset.multiple = p.signal.multiple;
    marker.setAttribute(
      'aria-label',
      `${p.signal.date} ${p.signal.type === 'fear' ? '恐慌加投' : '月度定投'} 买入 ${p.signal.multiple}N，${p.signal.amount.toFixed(2)}`
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
        const cells = [
          signal.date,
          signal.type === 'fear'
            ? '恐慌加投 · F&G ' + signal.score.toFixed(2)
            : '月度定投 · ' + signal.scheduledMonth,
          signal.type === 'fear' ? '—' : (signal.drawdown * 100).toFixed(2) + '%',
          signal.multiple + 'N',
          signal.amount.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })
        ];
        for (const v of cells) {
          const td = document.createElement('td');
          td.textContent = v;
          tr.append(td);
        }
        return tr;
      })
  );
  const totalAmount = allCurrent
    .reduce((sum, s) => sum + s.amount, 0)
    .toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  $('signal-total').textContent = `当前区间 ${allCurrent.length} 笔 · 合计 ${totalAmount}`;
}

function apply() {
  const buyDay = Number($('buy-day').value);
  const baseAmount = Number($('base-amount').value);
  const fearThreshold = Number($('fear-threshold').value);
  const rawFearCount = Number($('fear-buy-count').value);
  if (!Number.isInteger(buyDay) || buyDay < 1 || buyDay > 31) {
    $('signal-error').textContent = '定投日须为 1–31 的整数';
    return;
  }
  if (!validBaseAmount(baseAmount)) {
    $('signal-error').textContent = 'N 请输入 0 或不小于 0.01 的有效金额';
    return;
  }
  if (!Number.isFinite(fearThreshold) || fearThreshold <= 0 || fearThreshold > 95) {
    $('signal-error').textContent = 'F&G 阈值请输入大于 0 且不超过 95 的数值';
    return;
  }
  if (rawFearCount !== 0 && !validFearBuyCount(rawFearCount, baseAmount)) {
    $('signal-error').textContent = '恐慌加投倍数须为 0（不启用）或不小于 1 的整数，且加投金额须在可计算范围内';
    return;
  }
  $('signal-error').textContent = '';
  const symbol = activeSymbol();
  const prevCount = symbolParams(symbol).fearBuyCount;
  const fearEnabled = rawFearCount !== 0;
  const fearBuyCount = fearEnabled ? rawFearCount : prevCount;
  bySymbol[symbol] = { baseAmount, fearBuyCount, fearEnabled };
  allocation.fearEnabled = { ...allocation.fearEnabled, [symbol]: fearEnabled };
  state = { buyDay, baseAmount, fearThreshold, fearBuyCount, fearEnabled, enabled: $('signals-enabled').checked };
  saveStorage();
  appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
}

function availableSymbolOptions() {
  const select = $('symbol');
  if (select?.options?.length) {
    return Array.from(select.options).map(option => ({
      symbol: option.value,
      label: option.textContent || option.text || option.value
    }));
  }
  return [
    { symbol: 'SPY', label: 'SPY · 标普 500' },
    { symbol: 'QQQ', label: 'QQQ · 纳斯达克 100' },
    { symbol: 'VGT', label: 'VGT · 信息技术 ETF' },
    { symbol: 'SMH', label: 'SMH · 半导体 ETF' },
    { symbol: 'BRK-B', label: 'BRK-B · 伯克希尔 B' }
  ];
}

function formatMoney(value) {
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  return value === null ? '—' : (Math.abs(value) < 0.00005 ? 0 : value * 100).toFixed(2) + '%';
}

const strategyColors = ['#607487', '#0d9488', '#2563eb'];

function drawAllocationBacktestChart(svg, result, { seriesMode, logScale, baseAmount, principalLegend }) {
  if (!svg) return;
  svg.replaceChildren();
  if (!result?.results?.length) return;
  svg.dataset.scale = logScale ? 'log' : 'linear';
  svg.dataset.series = seriesMode;
  const showEquity = seriesMode === 'equity';
  const showPrincipal = showEquity && result.mode === 'equal';
  if (principalLegend) principalLegend.hidden = !showPrincipal;
  const add = (tag, attributes, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
    return node;
  };
  const metric = point => showEquity ? point.equity : point.profit;
  const principalCurve = result.results[0].curve;
  if (!principalCurve?.length) return;
  const all = [
    ...result.results.flatMap(strategy => strategy.curve.map(metric)),
    ...(showPrincipal ? principalCurve.map(point => point.invested) : [])
  ];
  const width = Math.max(320, svg.clientWidth || 820);
  const height = 220;
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const { left, right } = chartInsets(width);
  const top = 16;
  const bottom = height - 34;
  const pw = width - left - right;
  const calendar = principalCurve.map(point => point.date);
  const scale = createTradingScale(calendar, 'daily', left, pw);
  const x = scale.x;
  const axis = createProfitAxis(all, top, bottom, logScale, baseAmount);
  const y = axis.y;
  add('title', {}, showEquity
    ? (showPrincipal ? '配比组合三种策略的累计资产与投入本金' : '配比组合三种策略的累计资产')
    : '配比组合三种策略的累计盈亏，已扣除累计投入本金');
  for (const value of axis.ticks) {
    const py = y(value);
    add('line', { x1: left, x2: width - right, y1: py, y2: py, stroke: '#e5eaf0', 'stroke-dasharray': '3 4' });
    add('text', { x: width - right + 10, y: py + 4, 'text-anchor': 'start', fill: '#607487', 'font-size': 11 }, value.toLocaleString('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }));
  }
  if (showPrincipal) {
    const principalPath = principalCurve
      .map((point, index) => (index ? 'L' : 'M') + x(point.date).toFixed(2) + ',' + y(point.invested).toFixed(2))
      .join(' ');
    add('path', {
      d: principalPath,
      fill: 'none',
      stroke: '#94a3b8',
      'stroke-width': 1.6,
      'stroke-dasharray': '5 4',
      'vector-effect': 'non-scaling-stroke'
    });
  }
  for (const [i, strategy] of result.results.entries()) {
    const path = strategy.curve.map((point, index) => (index ? 'L' : 'M') + x(point.date).toFixed(2) + ',' + y(metric(point)).toFixed(2)).join(' ');
    add('path', { d: path, fill: 'none', stroke: strategyColors[i], 'stroke-width': 2, 'data-strategy': strategy.id, 'aria-label': strategy.name, 'vector-effect': 'non-scaling-stroke' });
    const last = strategy.curve.at(-1);
    add('circle', { cx: x(last.date), cy: y(metric(last)), r: 3, fill: strategyColors[i] });
  }
  for (const tick of scale.ticks(width < 500 ? 3 : 6)) {
    const labelX = Math.max(tick.label.length * 4 + 2, tick.x);
    add('text', { x: labelX.toFixed(2), y: height - 8, 'text-anchor': 'middle', fill: '#607487', 'font-size': 11 }, tick.label);
  }
}

function initAllocationDialog() {
  const dialog = $('allocation-dialog');
  const openBtn = $('allocation-open');
  const cancelBtn = $('allocation-cancel');
  const form = $('allocation-form');
  const totalInput = $('allocation-total');
  const list = $('allocation-list');
  const summary = $('allocation-summary');
  const estimateAverage = $('allocation-estimate-average');
  const estimatePeak = $('allocation-estimate-peak');
  const estimateNote = $('allocation-estimate-note');
  const backtestWrap = $('allocation-backtest-wrap');
  const backtestPeriod = $('allocation-backtest-period');
  const backtestMode = $('allocation-backtest-mode');
  const backtestResults = $('allocation-backtest-results');
  const backtestPlot = $('allocation-backtest-plot');
  const tabEquity = $('allocation-tab-equity');
  const tabProfit = $('allocation-tab-profit');
  const principalLegend = $('allocation-principal-legend');
  const scaleToggle = $('allocation-scale-toggle');
  const message = $('allocation-message');
  let inputs = new Map();
  let allocSeriesMode = 'equity';
  let allocLogScale = false;
  let lastBacktest = null;
  let lastTotal = defaults.baseAmount;

  function ensureMarketRows(symbols) {
    if (typeof fetch !== 'function') return;
    for (const symbol of symbols) {
      if (marketRowsBySymbol.has(symbol) || loadingSymbols.has(symbol) || failedSymbols.has(symbol)) continue;
      loadingSymbols.add(symbol);
      loadMarketSnapshot(symbol)
        .then(snapshot => {
          if (snapshot?.rows?.length) {
            marketRowsBySymbol.set(symbol, snapshot.rows);
          } else {
            failedSymbols.add(symbol);
          }
        })
        .catch(() => {
          failedSymbols.add(symbol);
        })
        .finally(() => {
          loadingSymbols.delete(symbol);
          if (inputs.size) updatePreview();
        });
    }
  }

  function updatePreview() {
    const total = Number(totalInput.value);
    const totalValid = validTotalAmount(total);
    let sumWeight = 0;
    let hasInvalid = false;
    const activeItems = [];
    for (const [symbol, info] of inputs) {
      const raw = info.input.value.trim();
      const weight = raw === '' ? 0 : Number(raw);
      if (raw === '' || weight === 0) {
        info.preview.textContent = totalValid ? '1N = 0.00' : '等待总金额';
      } else if (!validWeight(weight)) {
        info.preview.textContent = '配比无效';
        hasInvalid = true;
      } else {
        sumWeight += weight;
        if (totalValid) {
          const computed = Math.round(total * weight) / 100;
          const fearCount = symbolParams(symbol).fearBuyCount;
          const fearEnabled = info.fearInput ? info.fearInput.checked : true;
          if (validBaseAmount(computed) && validFearBuyCount(fearCount, computed)) {
            info.preview.textContent = '1N = ' + formatMoney(computed);
            if (computed >= 0.01) {
              activeItems.push({ symbol, baseAmount: computed, fearBuyCount: fearEnabled ? fearCount : 0 });
            }
          } else {
            info.preview.textContent = '金额无效';
            hasInvalid = true;
          }
        } else {
          info.preview.textContent = '等待总金额';
        }
      }
    }
    const roundedSum = Math.round(sumWeight * 100) / 100;
    if (roundedSum === 0) {
      summary.textContent = '配比合计：0%（剩余 100% 未分配）';
    } else if (Math.abs(roundedSum - 100) < 1e-6) {
      summary.textContent = '配比合计：100%';
    } else if (roundedSum < 100) {
      summary.textContent = `配比合计：${roundedSum}%（剩余 ${Math.round((100 - roundedSum) * 100) / 100}% 未分配）`;
    } else {
      summary.textContent = `配比合计：${roundedSum}%（已超出 100%）`;
    }

    if (!estimatePeak || !estimateNote) return;
    const setEstimate = (avgText, peakText, noteText, backtest = null) => {
      if (estimateAverage) estimateAverage.textContent = avgText;
      estimatePeak.textContent = peakText;
      estimateNote.textContent = noteText;
      if (!backtestWrap || !backtestResults) return;
      lastBacktest = backtest;
      lastTotal = totalValid ? total : defaults.baseAmount;
      if (!backtest?.results?.length) {
        backtestWrap.hidden = true;
        backtestResults.replaceChildren();
        if (backtestPlot) backtestPlot.replaceChildren();
        return;
      }
      backtestWrap.hidden = false;
      if (backtestPeriod) {
        const years = ((Date.parse(backtest.end) - Date.parse(backtest.start)) / (365.25 * 86400000)).toFixed(1);
        backtestPeriod.textContent = `组合回测 · ${backtest.start} — ${backtest.end} · ${years}年`;
      }
      backtestResults.replaceChildren(
        ...backtest.results.map((strategy, i) => {
          const tr = document.createElement('tr');
          const cells = [
            strategy.name,
            formatMoney(strategy.invested),
            formatMoney(strategy.cash - strategy.cashInterest),
            formatMoney(strategy.equity),
            formatMoney(strategy.profit - strategy.cashInterest),
            formatMoney(strategy.cashInterest),
            formatMoney(strategy.profit),
            formatPercent(strategy.capitalReturn),
            formatPercent(strategy.xirr),
            formatPercent(strategy.maxDrawdown),
            strategy.trades
          ];
          for (const [index, value] of cells.entries()) {
            const cell = document.createElement(index === 0 ? 'th' : 'td');
            if (index === 0) {
              cell.scope = 'row';
              cell.style.setProperty('--strategy-color', strategyColors[i]);
            }
            cell.textContent = value;
            tr.append(cell);
          }
          return tr;
        })
      );
      drawAllocationBacktestChart(backtestPlot, backtest, {
        seriesMode: allocSeriesMode,
        logScale: allocLogScale,
        baseAmount: lastTotal,
        principalLegend
      });
    };
    if (!totalValid || hasInvalid) {
      setEstimate('—', '—', '请输入有效的总定投金额与配比后自动测算');
      return;
    }
    if (!activeItems.length) {
      setEstimate('0.00（0N）', '0.00（0N）', '当前配比下各标的均为 0.00，无买入资金需求');
      return;
    }
    ensureMarketRows(activeItems.map(item => item.symbol));
    if (activeItems.some(item => !marketRowsBySymbol.has(item.symbol) && loadingSymbols.has(item.symbol))) {
      setEstimate('正在测算…', '正在测算…', '正在读取各标的历史行情数据…');
      return;
    }
    if (!sentimentRows.length || activeItems.some(item => !marketRowsBySymbol.has(item.symbol))) {
      setEstimate('暂无数据', '暂无数据', '等待恐慌指数与各标的历史行情就绪后自动测算');
      return;
    }
    const mode = backtestMode?.value === 'actual' ? 'actual' : 'equal';
    const funding = summarizePortfolioFunding({
      items: activeItems.map(item => ({ ...item, rows: marketRowsBySymbol.get(item.symbol) })),
      sentiment: sentimentRows,
      buyDay: state.buyDay,
      fearThreshold: state.fearThreshold,
      mode,
      totalBaseAmount: total
    });
    if (!funding) {
      setEstimate('暂无数据', '暂无数据', '当前行情区间无法测算');
      return;
    }
    const avgN = (funding.average / total).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const peakN = (funding.peak / total).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const avgText = formatMoney(funding.average) + '（' + avgN + 'N）';
    const peakText = formatMoney(funding.peak) + '（' + peakN + 'N）';
    if (funding.peak > 0) {
      const monthLabel = funding.peakMonths[0] + (funding.peakMonths.length > 1 ? ' 等 ' + funding.peakMonths.length + ' 个月' : '');
      const breakdown = funding.peakBreakdown.map(entry => entry.symbol + ' ' + formatMoney(entry.amount)).join(' ＋ ');
      setEstimate(
        avgText,
        peakText,
        '峰值月份 ' + monthLabel + '（' + breakdown + '）\n' +
        '测算区间 ' + funding.start.slice(0, 7) + ' — ' + funding.end.slice(0, 7) + '（' + funding.months + ' 个月）· 累计买入 ' + formatMoney(funding.total),
        funding.backtest
      );
    } else {
      setEstimate(avgText, peakText, funding.start.slice(0, 7) + ' — ' + funding.end.slice(0, 7) + ' 区间内无触发买入信号', funding.backtest);
    }
  }

  function renderList() {
    inputs = new Map();
    const rows = availableSymbolOptions().map(({ symbol, label }) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'allocation-symbol-label';
      name.textContent = label;
      li.append(name);

      const wrap = document.createElement('label');
      wrap.className = 'allocation-weight-wrap';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '10000';
      input.step = 'any';
      input.inputMode = 'decimal';
      input.placeholder = '0';
      input.className = 'allocation-weight-input';
      input.setAttribute('aria-label', symbol + ' 配比百分比');
      const savedWeight = allocation.weights[symbol];
      input.value = validWeight(savedWeight) ? String(savedWeight) : '0';
      input.addEventListener('input', () => {
        message.textContent = '';
        updatePreview();
      });
      const unit = document.createElement('span');
      unit.textContent = '%';
      wrap.append(input, unit);
      li.append(wrap);

      const preview = document.createElement('span');
      preview.className = 'allocation-preview';
      li.append(preview);

      const fearLabel = document.createElement('label');
      fearLabel.className = 'allocation-fear-toggle';
      const fearInput = document.createElement('input');
      fearInput.type = 'checkbox';
      fearInput.className = 'allocation-fear-checkbox';
      fearInput.setAttribute('aria-label', symbol + ' 启用恐慌加投');
      const savedFearEnabled = allocation.fearEnabled?.[symbol];
      fearInput.checked = typeof savedFearEnabled === 'boolean' ? savedFearEnabled : symbolParams(symbol).fearEnabled;
      fearInput.addEventListener('change', () => {
        message.textContent = '';
        updatePreview();
      });
      fearLabel.append(fearInput, '恐慌加投');
      li.append(fearLabel);

      inputs.set(symbol, { input, preview, fearInput });
      return li;
    });
    list.replaceChildren(...rows);
    updatePreview();
  }

  openBtn.addEventListener('click', () => {
    failedSymbols.clear();
    totalInput.value = String(
      validTotalAmount(allocation.totalAmount)
        ? allocation.totalAmount
        : validTotalAmount(state.baseAmount)
          ? state.baseAmount
          : defaults.baseAmount
    );
    message.textContent = '';
    renderList();
    dialog.showModal?.();
  });

  cancelBtn.addEventListener('click', () => dialog.close?.());

  dialog.addEventListener('click', event => {
    if (event.target !== dialog || !dialog.getBoundingClientRect) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) {
      dialog.close?.();
    }
  });

  totalInput.addEventListener('input', () => {
    message.textContent = '';
    updatePreview();
  });

  backtestMode?.addEventListener('change', () => {
    updatePreview();
  });

  for (const [button, mode] of [[tabEquity, 'equity'], [tabProfit, 'profit']]) {
    button?.addEventListener('click', () => {
      if (allocSeriesMode === mode) return;
      allocSeriesMode = mode;
      tabEquity?.setAttribute('aria-selected', String(allocSeriesMode === 'equity'));
      tabProfit?.setAttribute('aria-selected', String(allocSeriesMode === 'profit'));
      if (lastBacktest) {
        drawAllocationBacktestChart(backtestPlot, lastBacktest, {
          seriesMode: allocSeriesMode,
          logScale: allocLogScale,
          baseAmount: lastTotal,
          principalLegend
        });
      }
    });
  }

  scaleToggle?.addEventListener('click', () => {
    allocLogScale = !allocLogScale;
    scaleToggle.setAttribute('aria-pressed', String(allocLogScale));
    if (lastBacktest) {
      drawAllocationBacktestChart(backtestPlot, lastBacktest, {
        seriesMode: allocSeriesMode,
        logScale: allocLogScale,
        baseAmount: lastTotal,
        principalLegend
      });
    }
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const total = Number(totalInput.value);
    if (!validTotalAmount(total)) {
      message.textContent = '总定投金额请输入不小于 0.01 的有效数值';
      return;
    }
    const nextWeights = { ...allocation.weights };
    const nextFearEnabled = { ...allocation.fearEnabled };
    const updates = [];
    for (const [symbol, { input, fearInput }] of inputs) {
      const raw = input.value.trim();
      const weight = raw === '' ? 0 : Number(raw);
      if (!validWeight(weight)) {
        message.textContent = symbol + ' 配比请输入 0 至 10000 之间的有效百分比';
        return;
      }
      const computed = weight === 0 ? 0 : Math.round(total * weight) / 100;
      const fearCount = symbolParams(symbol).fearBuyCount;
      const fearEnabled = fearInput ? fearInput.checked : true;
      if (!validBaseAmount(computed) || !validFearBuyCount(fearCount, computed)) {
        message.textContent = symbol + ' 折算后的定投金额（' + computed.toFixed(2) + '）超出有效计算范围';
        return;
      }
      nextWeights[symbol] = weight;
      nextFearEnabled[symbol] = fearEnabled;
      updates.push([symbol, computed, fearCount, fearEnabled]);
    }
    allocation = { totalAmount: total, weights: nextWeights, fearEnabled: nextFearEnabled };
    for (const [symbol, baseAmount, fearBuyCount, fearEnabled] of updates) {
      bySymbol[symbol] = { baseAmount, fearBuyCount, fearEnabled };
    }
    syncControlsForSymbol(activeSymbol());
    saveStorage();
    appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
    dialog.close?.();
  });
}

export function initStrategyOverlay() {
  initBacktest();
  market = null;
  state = { ...defaults };
  fallback = { baseAmount: defaults.baseAmount, fearBuyCount: defaults.fearBuyCount, fearEnabled: defaults.fearEnabled };
  bySymbol = {};
  allocation = { totalAmount: defaults.baseAmount, weights: {}, fearEnabled: {} };
  marketRowsBySymbol.clear();
  loadingSymbols.clear();
  failedSymbols.clear();
  $('price-tooltip').addEventListener('pointerleave', () => { $('price-tooltip').hidden = true; });
  $('signal-table').closest('details').addEventListener('toggle', renderSignalTable);

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
      fallback = {
        baseAmount: saved.baseAmount,
        fearBuyCount: validFearBuyCount(saved.fearBuyCount, saved.baseAmount)
          ? saved.fearBuyCount : defaults.fearBuyCount,
        fearEnabled: typeof saved.fearEnabled === 'boolean' ? saved.fearEnabled : defaults.fearEnabled
      };
      state = {
        ...defaults,
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
          bySymbol[symbol] = {
            baseAmount: entry.baseAmount,
            fearBuyCount: validFearBuyCount(entry.fearBuyCount, entry.baseAmount)
              ? entry.fearBuyCount
              : fallback.fearBuyCount,
            fearEnabled: typeof entry.fearEnabled === 'boolean' ? entry.fearEnabled : fallback.fearEnabled
          };
        }
      }
      if (saved.allocation && typeof saved.allocation === 'object') {
        const totalAmount = validTotalAmount(saved.allocation.totalAmount)
          ? saved.allocation.totalAmount
          : validTotalAmount(fallback.baseAmount)
            ? fallback.baseAmount
            : defaults.baseAmount;
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
        allocation = { totalAmount, weights, fearEnabled };
      } else {
        allocation = {
          totalAmount: validTotalAmount(fallback.baseAmount) ? fallback.baseAmount : defaults.baseAmount,
          weights: {},
          fearEnabled: {}
        };
      }
    }
  } catch {}

  const initialParams = symbolParams(initialSymbol);
  state = { ...state, ...initialParams };

  $('fear-threshold').value = state.fearThreshold;
  $('fear-buy-count').value = state.fearEnabled ? state.fearBuyCount : 0;
  $('buy-day').value = state.buyDay;
  $('base-amount').value = state.baseAmount;
  $('signals-enabled').checked = state.enabled;

  $('symbol').addEventListener('change', () => {
    syncControlsForSymbol(activeSymbol());
  });

  for (const id of ['buy-day', 'base-amount', 'fear-threshold', 'fear-buy-count', 'signals-enabled']) {
    const eventType = id === 'base-amount' || id === 'fear-threshold' || id === 'fear-buy-count' ? 'input' : 'change';
    $(id).addEventListener(eventType, apply);
  }

  initAllocationDialog();

  $('signal-download').addEventListener('click', () => {
    if (!market || !allCurrent.length) return;
    const header =
      'Symbol,Date,BuyDay,BaseAmountUSD,MonthCutoff,MonthHigh,Drawdown,Multiple,AmountUSD,SignalType,SignalDate,FearScore,FearThreshold,RearmThreshold,ScheduledMonth,ScheduledDate\n';
    const body = allCurrent
      .map(s =>
        [
          market.symbol,
          s.date,
          s.buyDay,
          s.baseAmount,
          s.cutoff,
          s.monthHigh,
          s.drawdown,
          s.multiple,
          s.amount,
          s.type,
          s.signalDate ?? '',
          s.score ?? '',
          s.fearThreshold ?? '',
          s.rearmThreshold ?? '',
          s.scheduledMonth ?? '',
          s.scheduledDate ?? ''
        ].join(',')
      )
      .join('\n');
    downloadCSV(market.symbol + '-dca-signals.csv', header + body);
  });
}
