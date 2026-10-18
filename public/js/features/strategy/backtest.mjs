import { compareStrategies } from '../../domain/backtest.mjs';

let context = null;
let shownResult = null;
const colors = ['#607487', '#0d9488', '#2563eb'];
const amount = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const percent = value => value === null ? '—' : (Math.abs(value) < 0.00005 ? 0 : value * 100).toFixed(2) + '%';
const $ = id => document.getElementById(id);

function drawProfitChart(result) {
  const svg = $('backtest-plot');
  svg.replaceChildren();
  const add = (tag, attributes, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
  };
  const all = result.results.flatMap(strategy => strategy.curve.map(point => point.profit));
  const min = Math.min(0, ...all);
  const max = Math.max(0, ...all);
  const span = max - min || 1;
  const width = Math.max(320, svg.clientWidth || 980);
  svg.setAttribute('viewBox', '0 0 ' + width + ' 280');
  const left = 70, right = width - 20, top = 18, bottom = 230;
  const start = Date.parse(result.start), end = Date.parse(result.end);
  const x = date => left + (Date.parse(date) - start) / (end - start || 1) * (right - left);
  const y = value => bottom - (value - min) / span * (bottom - top);
  add('title', {}, '三种策略的累计盈亏，已扣除累计投入本金');
  for (let i = 0; i <= 4; i++) {
    const value = min + span * i / 4;
    add('line', { x1: left, x2: right, y1: y(value), y2: y(value), stroke: '#e5eaf0', 'stroke-dasharray': '3 4' });
    add('text', { x: left - 10, y: y(value) + 4, 'text-anchor': 'end', fill: '#607487', 'font-size': 12 }, value.toLocaleString('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }));
  }
  for (const [i, strategy] of result.results.entries()) {
    const path = strategy.curve.map((point, index) => (index ? 'L' : 'M') + x(point.date).toFixed(2) + ',' + y(point.profit).toFixed(2)).join(' ');
    add('path', { d: path, fill: 'none', stroke: colors[i], 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
    const last = strategy.curve.at(-1);
    add('circle', { cx: x(last.date), cy: y(last.profit), r: 3, fill: colors[i] });
  }
  add('text', { x: left, y: 258, fill: '#607487', 'font-size': 12 }, result.start);
  add('text', { x: right, y: 258, fill: '#607487', 'font-size': 12, 'text-anchor': 'end' }, result.end);
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
    const coverage = sentiment.length ? '指数记录覆盖 ' + sentiment[0].date + ' — ' + sentiment.at(-1).date + '，缺失日期不补造。' : '暂无指数数据，恐慌加投未参与。';
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
  $('backtest-mode').addEventListener('change', render);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (shownResult) drawProfitChart(shownResult);
    }).observe($('backtest-plot'));
  }
}
