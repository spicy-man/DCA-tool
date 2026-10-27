import { compareStrategies } from '../../domain/backtest.mjs';
import { chartInsets, createTradingScale, createProfitAxis } from '../../charts/geometry.mjs';

const backtestScaleStorageKey = 'seeker.backtestScale.v1';
const backtestSeriesStorageKey = 'seeker.backtestSeries.v1';
let context = null;
let shownResult = null;
let logScale = false;
let seriesMode = 'equity';
const colors = ['#607487', '#0d9488', '#2563eb'];
const amount = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = value => value === null ? '—' : (Math.abs(value) < 0.00005 ? 0 : value * 100).toFixed(2) + '%';
const $ = id => document.getElementById(id);

function drawProfitChart(result) {
  const svg = $('backtest-plot');
  svg.replaceChildren();
  svg.dataset.scale = logScale ? 'log' : 'linear';
  svg.dataset.series = seriesMode;
  const showEquity = seriesMode === 'equity';
  const showPrincipal = showEquity && result.mode === 'equal';
  $('backtest-principal-legend').hidden = !showPrincipal;
  const add = (tag, attributes, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
  };
  const metric = point => showEquity ? point.equity : point.profit;
  const principalCurve = result.results[0].curve;
  const all = [
    ...result.results.flatMap(strategy => strategy.curve.map(metric)),
    ...(showPrincipal ? principalCurve.map(point => point.invested) : [])
  ];
  const width = Math.max(320, svg.clientWidth || 980);
  const height = 280;
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const { left, right } = chartInsets(width);
  const top = 18;
  const bottom = height - 42;
  const pw = width - left - right;
  const calendar = context?.range?.calendar?.length
    ? context.range.calendar
    : principalCurve.map(point => point.date);
  const scale = createTradingScale(calendar, 'daily', left, pw);
  const x = scale.x;
  const axis = createProfitAxis(all, top, bottom, logScale, context?.baseAmount);
  const y = axis.y;
  add('title', {}, showEquity
    ? (showPrincipal ? '三种策略的累计资产与投入本金' : '三种策略的累计资产')
    : '三种策略的累计盈亏，已扣除累计投入本金');
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
    add('path', { d: path, fill: 'none', stroke: colors[i], 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
    const last = strategy.curve.at(-1);
    add('circle', { cx: x(last.date), cy: y(metric(last)), r: 3, fill: colors[i] });
  }
  for (const tick of scale.ticks(width < 500 ? 3 : 6)) {
    const labelX = Math.max(tick.label.length * 4 + 2, tick.x);
    add('text', { x: labelX.toFixed(2), y: height - 10, 'text-anchor': 'middle', fill: '#607487', 'font-size': 11 }, tick.label);
  }
}

function render() {
  shownResult = null;
  $('backtest-results').replaceChildren();
  $('backtest-plot').replaceChildren();
  if (!context) {
    $('backtest-period').textContent = '暂无可用行情，请先读取数据';
    $('backtest-note').textContent = '';
    return;
  }
  try {
    const mode = $('backtest-mode').value || 'equal';
    const result = compareStrategies({ ...context, mode });
    if (!result) {
      $('backtest-period').textContent = '当前区间无行情，无法回测';
      $('backtest-note').textContent = '';
      return;
    }
    $('backtest-period').textContent = context.symbol + ' · ' + result.start + ' — ' + result.end + ' · ' + ((Date.parse(result.end) - Date.parse(result.start)) / (365.25 * 86400000)).toFixed(1) + '年 · 区间开始时持仓为零';
    for (const [i, strategy] of result.results.entries()) {
      const tr = document.createElement('tr');
      const values = [strategy.name, amount(strategy.invested), amount(strategy.cash - strategy.cashInterest), amount(strategy.equity), amount(strategy.profit - strategy.cashInterest), amount(strategy.cashInterest), amount(strategy.profit), percent(strategy.capitalReturn), percent(strategy.xirr), percent(strategy.maxDrawdown), strategy.trades];
      for (const [j, value] of values.entries()) {
        const cell = document.createElement(j === 0 ? 'th' : 'td');
        if (j === 0) { cell.scope = 'row'; cell.style.setProperty('--strategy-color', colors[i]); }
        cell.textContent = value;
        tr.append(cell);
      }
      $('backtest-results').append(tr);
    }
    const sentiment = context.sentiment;
    const coverage = sentiment.length ? '指数记录覆盖 ' + sentiment[0].date + ' — ' + sentiment.at(-1).date + '，缺失日期不补造；指数覆盖前的区间不触发恐慌加投。' : '暂无指数数据，恐慌加投未参与。';
    const funding = mode === 'equal'
      ? '三组在组合策略每次买入时获得相同资金；未使用资金按 3% 年化、实际天数／365 复利计息（含周末休市），利息计入资产与收益。'
      : '各策略投入金额不同，期末资产更高不代表收益率更高。';
    $('backtest-note').textContent = funding + ' 买入 N 数＝累计买入金额 ÷ 定投金额 N，包含月度金字塔和恐慌加投。' + ' ' + (result.deferredMonthly ? result.deferredMonthly + ' 笔区间内月度信号尚未在本区间成交。' : '') + ' ' + coverage;
    shownResult = result;
    drawProfitChart(result);
  } catch (error) {
    $('backtest-results').replaceChildren();
    $('backtest-plot').replaceChildren();
    $('backtest-period').textContent = '无法计算回测';
    $('backtest-note').textContent = error.message;
  }
}

export function updateBacktest(next) {
  context = next;
  render();
}

export function initBacktest() {
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
