import { chartInsets, createTradingScale, createProfitAxis } from '../../charts/geometry.mjs';
import { formatMoney, formatPercent, formatRatio } from '../../ui/format.mjs';

export const STRATEGY_COLORS = Object.freeze(['#607487', '#0d9488', '#2563eb', '#c26e2b', '#a64b77']);

export function renderBacktestTable(tbody, results) {
  if (!tbody) return;
  tbody.replaceChildren(
    ...results.map((strategy, i) => {
      const tr = document.createElement('tr');
      const values = [
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
        formatRatio(strategy.sharpe),
        formatRatio(strategy.sortino),
        formatRatio(strategy.mar),
        strategy.trades
      ];
      for (const [index, value] of values.entries()) {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) {
          cell.scope = 'row';
          cell.style.setProperty('--strategy-color', STRATEGY_COLORS[i]);
        }
        cell.textContent = value;
        tr.append(cell);
      }
      return tr;
    })
  );
}

export function drawBacktestChart(svg, result, {
  seriesMode,
  logScale,
  baseAmount,
  principalLegend,
  widthFallback = 820,
  height = 220,
  top = 16,
  bottomPadding = 34,
  tickLabelOffset = 8,
  calendar = null,
  titlePrefix = '',
  onAfterSeries = null
}) {
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
  const width = Math.max(320, svg.clientWidth || widthFallback);
  svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
  const { left, right } = chartInsets(width);
  const bottom = height - bottomPadding;
  const pw = width - left - right;
  const resolvedCalendar = calendar?.length ? calendar : principalCurve.map(point => point.date);
  const scale = createTradingScale(resolvedCalendar, 'daily', left, pw);
  const x = scale.x;
  const axis = createProfitAxis(all, top, bottom, logScale, baseAmount);
  const y = axis.y;

  add('title', {}, showEquity
    ? (showPrincipal ? `${titlePrefix}五种策略的累计资产与投入本金` : `${titlePrefix}五种策略的累计资产`)
    : `${titlePrefix}五种策略的累计盈亏，已扣除累计投入本金`);

  for (const value of axis.ticks) {
    const py = y(value);
    add('line', { x1: left, x2: width - right, y1: py, y2: py, stroke: '#e5eaf0', 'stroke-dasharray': '3 4' });
    add('text', { x: width - right + 10, y: py + 4, 'text-anchor': 'start', fill: '#607487', 'font-size': 11 },
      value.toLocaleString('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }));
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
    const path = strategy.curve
      .map((point, index) => (index ? 'L' : 'M') + x(point.date).toFixed(2) + ',' + y(metric(point)).toFixed(2))
      .join(' ');
    add('path', {
      d: path,
      fill: 'none',
      stroke: STRATEGY_COLORS[i],
      'stroke-width': 2,
      'data-strategy': strategy.id,
      'aria-label': strategy.name,
      'vector-effect': 'non-scaling-stroke'
    });
    const last = strategy.curve.at(-1);
    add('circle', { cx: x(last.date), cy: y(metric(last)), r: 3, fill: STRATEGY_COLORS[i] });
  }

  onAfterSeries?.({ add, x, y, width, height, left, right, top, bottom, scale, principalCurve, showEquity });

  for (const tick of scale.ticks(width < 500 ? 3 : 6)) {
    const labelX = Math.max(tick.label.length * 4 + 2, tick.x);
    add('text', { x: labelX.toFixed(2), y: height - tickLabelOffset, 'text-anchor': 'middle', fill: '#607487', 'font-size': 11 }, tick.label);
  }
}
