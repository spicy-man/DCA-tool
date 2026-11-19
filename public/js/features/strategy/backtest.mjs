import { renderKDReview } from './kd.mjs';
import { compareStrategies, findLatestPeakRecovery } from '../../domain/backtest.mjs';
import { appEvents, events } from '../../services/events.mjs';
import { formatMoney } from '../../ui/format.mjs';
import { STRATEGY_COLORS, drawBacktestChart, renderBacktestTable } from './backtest-view.mjs';

const backtestScaleStorageKey = 'seeker.backtestScale.v1';
const backtestSeriesStorageKey = 'seeker.backtestSeries.v1';
let context = null;
let shownResult = null;
let activeStrategy = 'kdFear';
let strategyViewListener = null;
let logScale = false;
let seriesMode = 'equity';
let replay = null;
let replayTimer = null;
let replayFrame = null;
let previewIndex = null;
const $ = id => document.getElementById(id);

function drawProfitChart(result) {
  replayFrame = null;
  const svg = $('backtest-plot');
  const calendar = replay
    ? replay.dates.slice(0, Math.max(80, replay.maxIndex + 1))
    : context?.range?.calendar?.length
      ? context.range.calendar
      : null;

  drawBacktestChart(svg, result, {
    seriesMode,
    logScale,
    baseAmount: context?.baseAmount,
    principalLegend: $('backtest-principal-legend'),
    widthFallback: 980,
    height: 280,
    top: 18,
    bottomPadding: 42,
    tickLabelOffset: 10,
    calendar,
    onAfterSeries({ add, x, y, width, height, left, right, top, bottom, scale, principalCurve, showEquity }) {
      let recoveryLabel = null;
      const preferredId = (context?.strategy || activeStrategy) === 'combined' ? 'combined' : 'kdFear';
      let focusIndex = result.results.findIndex(strategy => strategy.id === preferredId);
      if (focusIndex < 0) focusIndex = result.results.findIndex(strategy => strategy.id === 'combined');
      if (focusIndex < 0) focusIndex = result.results.findIndex(strategy => strategy.id === 'kdFear');
      const focus = focusIndex >= 0 ? result.results[focusIndex] : null;
      const recovery = replay && focus && findLatestPeakRecovery(focus.curve, seriesMode);
      if (recovery) {
        const x1 = x(recovery.start);
        const x2 = x(recovery.end);
        const py = y(recovery.value);
        const label = recovery.recovered ? '前高修复 · ' + recovery.days + ' 天' : '未修复 · 已 ' + recovery.days + ' 天';
        add('line', {
          x1, x2, y1: py, y2: py, stroke: STRATEGY_COLORS[focusIndex], 'stroke-width': 1.5,
          'stroke-dasharray': '6 4', 'data-recovery-line': '',
          'aria-label': focus.name + (showEquity ? '累计资产' : '累计盈亏') + '前高 ' + formatMoney(recovery.value) + '，' + recovery.start + ' 至 ' + recovery.end + '，' + label
        });
        for (const px of [x1, x2]) add('circle', { cx: px, cy: py, r: 3, fill: '#fff', stroke: STRATEGY_COLORS[focusIndex], 'stroke-width': 1.5 });
        const halfLabel = label.length * 5.5 + 4;
        const labelRight = replay ? Math.min(width - right, x(principalCurve.at(-1).date) - 4) : width - right;
        recoveryLabel = add('text', {
          x: Math.max(left + halfLabel, Math.min(labelRight - halfLabel, (x1 + x2) / 2)),
          y: Math.max(top + 12, py - 9), 'text-anchor': 'middle', fill: STRATEGY_COLORS[focusIndex],
          'font-size': 11, stroke: '#fff', 'stroke-width': 4, 'paint-order': 'stroke',
          'stroke-linejoin': 'round', 'data-recovery-label': ''
        }, label);
      }
      if (replay) {
        const mask = add('rect', { y: top, height: bottom - top, fill: '#fff', 'pointer-events': 'none', 'data-replay-mask': '' });
        const cursor = add('line', { y1: top, y2: bottom, stroke: '#607487', 'stroke-dasharray': '4 4', 'pointer-events': 'none', 'data-replay-cursor': '' });
        const dateLabel = add('text', { y: top - 5, fill: '#607487', 'font-size': 11, 'text-anchor': 'middle', 'pointer-events': 'none', 'data-replay-date': '' });
        // Keep text readable even when only a few days fit left of the cursor.
        if (recoveryLabel) svg.append(recoveryLabel);
        replayFrame = { width, height, left, right: width - right, top, bottom, scale, mask, cursor, dateLabel, recoveryLabel };
        paintReplayCursor();
      }
    }
  });
}

function render() {
  replayFrame = null;
  shownResult = null;
  $('backtest-results').replaceChildren();
  $('backtest-plot').replaceChildren();
  if (!context) {
    renderKDReview(null,null);
    $('backtest-period').textContent = '暂无可用行情，请先读取数据';
    $('backtest-note').textContent = '';
    return;
  }
  try {
    const mode = $('backtest-mode').value || 'equal';
    const range = replay ? { ...context.range, start: replay.start, end: replay.dates[replay.index] } : context.range;
    const replayWindow = replay
      ? (() => {
          // Keep individual candles legible even when entry is decades in the past.
          const first = Math.max(0, replay.index - 79);
          const calendar = replay.dates.slice(first, Math.max(80, replay.index + 1));
          return { start: replay.dates[first], end: replay.dates[replay.index], calendar, frequency: 'daily', replay: true };
        })()
      : null;
    const result = compareStrategies({ ...context, range, mode });
    if (!result) {
      renderKDReview(null,null);
      $('backtest-period').textContent = '当前区间无行情，无法回测';
      $('backtest-note').textContent = '';
      return;
    }
    renderKDReview({ ...context, range: replayWindow || range }, result);
    $('backtest-period').textContent = context.symbol + ' · ' + result.start + ' — ' + result.end + ' · ' + ((Date.parse(result.end) - Date.parse(result.start)) / (365.25 * 86400000)).toFixed(1) + '年 · 区间开始时持仓为零';
    renderBacktestTable($('backtest-results'), result.results);
    const sentiment = context.sentiment;
    const coverage = sentiment.length ? '指数记录覆盖 ' + sentiment[0].date + ' — ' + sentiment.at(-1).date + '，缺失日期不补造；指数覆盖前的区间不触发恐慌加投。' : '暂无指数数据，恐慌加投未参与。';
    const funding = mode === 'equal'
      ? '五组按每日各策略所需金额的最大值获得相同资金；未使用资金按 3% 年化、实际天数／365 复利计息（含周末休市），利息计入资产与收益。'
      : '各策略投入金额不同，期末资产更高不代表收益率更高。';
    $('backtest-note').textContent = funding + ' 买入 N 数＝累计买入金额 ÷ 定投金额 N，包含该策略实际买入；加权K定投不叠加恐慌，加权K定投＋恐慌加投则在加权K月度买入之外独立叠加恐慌买入。' + ' ' + (result.deferredMonthly ? result.deferredMonthly + ' 笔区间内月度信号尚未在本区间成交。' : '') + ' ' + coverage;
    shownResult = result;
    drawProfitChart(result);
    if (replayWindow) {
      appEvents.dispatchEvent(new CustomEvent(events.replayRange, { detail: replayWindow }));
    }
  } catch (error) {
    renderKDReview(null,null);
    $('backtest-results').replaceChildren();
    $('backtest-plot').replaceChildren();
    $('backtest-period').textContent = '无法计算回测';
    $('backtest-note').textContent = error.message;
  }
}

function paintReplayCursor() {
  if (!replay || !replayFrame) return;
  const { scale, left, right, mask, cursor, dateLabel } = replayFrame;
  const date = replay.dates[previewIndex ?? replay.index];
  if (replayFrame.recoveryLabel) replayFrame.recoveryLabel.setAttribute('visibility', previewIndex !== null && previewIndex < replay.index ? 'hidden' : 'visible');
  const px = scale.x(date);
  mask.setAttribute('x', px);
  mask.setAttribute('width', Math.max(0, right - px));
  cursor.setAttribute('x1', px);
  cursor.setAttribute('x2', px);
  dateLabel.setAttribute('x', Math.max(left + 38, Math.min(right - 38, px)));
  dateLabel.textContent = date;
}

function replayIndexAt(event) {
  if (!replay || !replayFrame) return null;
  const bounds = $('backtest-plot').getBoundingClientRect();
  const frame = replayFrame;
  // Match the SVG's default xMidYMid meet transform, including letterboxing.
  const ratio = Math.min(bounds.width / frame.width, bounds.height / frame.height);
  if (!(ratio > 0)) return null;
  const px = (event.clientX - bounds.left - (bounds.width - frame.width * ratio) / 2) / ratio;
  const py = (event.clientY - bounds.top - (bounds.height - frame.height * ratio) / 2) / ratio;
  const halfSlot = frame.scale.spacing / 2;
  if (py < frame.top || py > frame.bottom || px < frame.left || px > frame.right ||
      px < frame.scale.x(replay.dates[0]) - halfSlot ||
      px > frame.scale.x(replay.dates[replay.maxIndex]) + halfSlot) return null;
  let nearest = 0;
  for (let i = 1; i <= replay.maxIndex; i++) {
    if (Math.abs(frame.scale.x(replay.dates[i]) - px) < Math.abs(frame.scale.x(replay.dates[nearest]) - px)) nearest = i;
  }
  return nearest;
}

function seekReplay(index) {
  if (!replay || index === null || index < 0 || index > replay.maxIndex) return;
  pauseReplay();
  replay.index = index;
  previewIndex = null;
  render();
  syncReplayControls();
}

function pauseReplay() {
  clearInterval(replayTimer);
  replayTimer = null;
}

function startReplayTimer() {
  pauseReplay();
  const speed = Number($('backtest-replay-speed').value);
  const daysPerSecond = [1, 2, 4, 8, 16].includes(speed) ? speed : 4;
  replayTimer = setInterval(() => {
    replay.index++;
    replay.maxIndex = Math.max(replay.maxIndex, replay.index);
    if (replay.index === replay.dates.length - 1) pauseReplay();
    render();
    syncReplayControls();
  }, 1000 / daysPerSecond);
}

function syncReplayControls() {
  const input = $('backtest-replay-start');
  const dates = context?.rows.map(row => row.date) || [];
  input.min = dates[0] || '';
  input.max = dates.at(-1) || '';
  input.disabled = !dates.length;
  $('backtest-replay-random').disabled = !dates.length;
  const selected = dates.some(date => date >= input.value) && input.value >= input.min && input.value <= input.max;
  $('backtest-replay-play').disabled = !selected;
  $('backtest-replay-play').textContent = replayTimer !== null ? '暂停' : replay && replay.index === replay.dates.length - 1 ? '重新播放' : '播放';
  $('backtest-replay-reset').disabled = !replay;
  $('backtest-replay-status').textContent = replay
    ? '复盘至 ' + replay.dates[replay.index] + (replayTimer !== null ? ' · 播放中' : replay.index === replay.dates.length - 1 ? ' · 已结束' : ' · 已暂停')
    : '选择起始日并播放后展示前高修复';
}

function resetReplay() {
  const wasReplaying = replay !== null;
  pauseReplay();
  replay = null;
  previewIndex = null;
  syncReplayControls();
  render();
  if (wasReplaying) appEvents.dispatchEvent(new CustomEvent(events.replayRange, { detail: null }));
}

export function updateBacktest(next) {
  if (next?.strategy === 'combined' || next?.strategy === 'kdFear') activeStrategy = next.strategy;
  context = next;
  if ($('backtest-replay-start')) $('backtest-replay-start').value = '';
  resetReplay();
}

export function initBacktest() {
  pauseReplay();
  replay = null;
  previewIndex = null;
  if (strategyViewListener) appEvents.removeEventListener(events.strategyView, strategyViewListener);
  strategyViewListener = event => {
    const next = event?.detail;
    if (next !== 'combined' && next !== 'kdFear') return;
    activeStrategy = next;
    if (context) context.strategy = next;
    if (shownResult) drawProfitChart(shownResult);
  };
  appEvents.addEventListener(events.strategyView, strategyViewListener);
  const plot = $('backtest-plot');
  plot.addEventListener('pointermove', event => {
    previewIndex = replayIndexAt(event);
    plot.style.cursor = previewIndex === null ? '' : 'crosshair';
    paintReplayCursor();
  });
  plot.addEventListener('pointerleave', () => {
    previewIndex = null;
    plot.style.cursor = '';
    paintReplayCursor();
  });
  plot.addEventListener('click', event => seekReplay(replayIndexAt(event)));
  plot.addEventListener('keydown', event => {
    if (!replay || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const target = event.key === 'Home' ? 0 : event.key === 'End' ? replay.maxIndex : replay.index + (event.key === 'ArrowLeft' ? -1 : 1);
    seekReplay(Math.max(0, Math.min(replay.maxIndex, target)));
  });
  $('backtest-replay-start').addEventListener('change', resetReplay);
  $('backtest-replay-reset').addEventListener('click', resetReplay);
  $('backtest-replay-random').addEventListener('click', () => {
    const dates = context?.rows.map(row => row.date) || [];
    if (!dates.length) return;
    // Leave at least one following session to play when the interval permits it.
    const count = Math.max(1, dates.length - 1);
    $('backtest-replay-start').value = dates[Math.floor(Math.random() * count)];
    resetReplay();
  });
  $('backtest-replay-speed').addEventListener('change', () => {
    if (replayTimer !== null) startReplayTimer();
    syncReplayControls();
  });
  $('backtest-replay-play').addEventListener('click', () => {
    if (replayTimer !== null) {
      pauseReplay();
      syncReplayControls();
      return;
    }
    const start = $('backtest-replay-start').value;
    const dates = context?.rows.filter(row => row.date >= start).map(row => row.date) || [];
    if (!start || start < $('backtest-replay-start').min || start > $('backtest-replay-start').max || !dates.length) return;
    if (!replay || replay.index === replay.dates.length - 1) replay = { start: dates[0], dates, index: 0, maxIndex: 0 };
    previewIndex = null;
    if (replay.index < replay.dates.length - 1) {
      startReplayTimer();
    }
    render();
    syncReplayControls();
  });
  syncReplayControls();
  const scaleToggle = $('backtest-scale-toggle');
  const tabProfit = $('backtest-tab-profit');
  const tabEquity = $('backtest-tab-equity');
  logScale = false;
  seriesMode = 'equity';
  try {
    logScale = localStorage.getItem(backtestScaleStorageKey) === 'log';
    if (localStorage.getItem(backtestSeriesStorageKey) === 'profit') seriesMode = 'profit';
  } catch {}
  scaleToggle.setAttribute('aria-pressed', String(logScale));

  const syncTabs = () => {
    tabProfit.setAttribute('aria-selected', String(seriesMode === 'profit'));
    tabEquity.setAttribute('aria-selected', String(seriesMode === 'equity'));
  };
  syncTabs();

  for (const [button, mode] of [[tabProfit, 'profit'], [tabEquity, 'equity']]) {
    button.addEventListener('click', () => {
      if (seriesMode === mode) return;
      seriesMode = mode;
      syncTabs();
      try {
        localStorage.setItem(backtestSeriesStorageKey, seriesMode);
      } catch {}
      if (shownResult) drawProfitChart(shownResult);
    });
  }

  scaleToggle.addEventListener('click', () => {
    logScale = !logScale;
    scaleToggle.setAttribute('aria-pressed', String(logScale));
    try {
      localStorage.setItem(backtestScaleStorageKey, logScale ? 'log' : 'linear');
    } catch {}
    if (shownResult) drawProfitChart(shownResult);
  });

  $('backtest-mode').addEventListener('change', render);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (shownResult) drawProfitChart(shownResult);
    }).observe($('backtest-plot'));
  }
}
