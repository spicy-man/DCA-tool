import { appEvents, events } from '../../services/events.mjs';
import { loadMarketSnapshot } from '../../services/data-client.mjs';
import {
  updateSignals,
  drawSignalMarkers,
  showMarketTooltip
} from '../strategy/overlay.mjs';
import {
  createTradingScale,
  createPriceAxis,
  candleMetrics,
  paintCandle,
  chartInsets,
  periodKey
} from '../../charts/geometry.mjs';
import { aggregateOHLC } from '../../domain/market.mjs';
import { downloadCSV } from '../../ui/download.mjs';
import { tooltipContent, positionTooltip } from '../../ui/tooltip.mjs';

const $ = id => document.getElementById(id);
const symbolStorageKey = 'seeker.symbol.v1';
const priceScaleStorageKey = 'seeker.priceScale.v1';
const store = new Map();
let settings;
let shown = [];
let frame;
let active = -1;
let hoverDate = null;
let hoverY = null;
let loading = false;
let requestID = 0;
let logScale = false;

export async function loadMarket(force = false) {
  const id = ++requestID;
  const symbol = $('symbol').value;
  loading = true;
  $('price-title').textContent = symbol + ' · 前复权 K 线';
  $('price-close').textContent = '—';
  $('price-asof').textContent = '正在读取 ' + symbol + ' 行情…';

  try {
    if (force || !store.has(symbol)) {
      const data = await loadMarketSnapshot(symbol);
      store.set(symbol, data);
    }
    if (id !== requestID) return;
    loading = false;
    appEvents.dispatchEvent(
      new CustomEvent(events.marketCalendar, { detail: store.get(symbol).rows.map(r => r.date) })
    );
    renderMarket(settings);
  } catch (error) {
    if (id !== requestID) return;
    loading = false;
    $('price-asof').textContent = error.message;
    shown = [];
    $('price-close').textContent = '—';
    $('price-change').textContent = '—';
    $('price-observations').textContent = '0 根 K 线';
    $('price-table').replaceChildren();
    updateSignals(null, null);
    drawPrice();
  }
}

export function invalidateMarket() {
  store.clear();
  return loadMarket(true);
}

export function renderMarket(next) {
  settings = next;
  if (!next || loading) return;
  const symbol = $('symbol').value;
  const data = store.get(symbol);
  if (!data) return;

  updateSignals(data, next);
  const daily = data.rows.filter(r => r.date >= next.start && r.date <= next.end);
  shown = aggregateOHLC(daily, next.frequency);
  active = -1;
  hoverDate = null;
  hoverY = null;
  $('price-tooltip').hidden = true;
  $('price-title').textContent = symbol + ' · 前复权 K 线';
  $('price-asof').textContent = 'Yahoo Finance · 数据截至 ' + data.anchorDate;

  const last = shown.at(-1);
  const previous = shown.at(-2);
  $('price-close').textContent = last ? last.close.toFixed(2) : '—';
  $('price-change').textContent = last
    ? previous
      ? `${last.date} · ${((last.close / previous.close - 1) * 100).toFixed(2)}%`
      : `${last.date}`
    : '当前区间无行情';
  $('price-observations').textContent = shown.length.toLocaleString() + ' 根 K 线';
  $('price-anchor').textContent = `${symbol} 可用历史：${data.rows[0].date} — ${data.anchorDate} · 复权基准：${data.anchorDate} · 更新：${data.fetchedAt.slice(0, 10)}`;
  $('price-source').href = 'https://finance.yahoo.com/quote/' + symbol + '/history/';

  if ($('price-table').closest('details').open) renderPriceTable();

  const stale = (Date.now() - Date.parse(data.anchorDate)) / 864e5 > 7;
  if (stale) $('price-asof').textContent += ' · 行情超过 7 天未更新';
  if (!shown.length) {
    $('price-empty').textContent = `当前区间无 ${symbol} 行情；可用历史始于 ${data.rows[0].date}。`;
  }
  drawPrice();
}

function renderPriceTable() {
  $('price-table').replaceChildren(
    ...shown
      .slice()
      .reverse()
      .map(r => {
        const tr = document.createElement('tr');
        const cells = [
          r.date,
          ...[r.open, r.high, r.low, r.close].map(n => n.toFixed(2)),
          r.volume === null ? '—' : r.volume.toLocaleString()
        ];
        for (const v of cells) {
          const td = document.createElement('td');
          td.textContent = v;
          tr.append(td);
        }
        return tr;
      })
  );
}

export function drawPrice(crossDate) {
  const canvas = $('price-chart');
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const dpr = devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  c.fillStyle = '#dbdbdb';
  c.fillRect(0, 0, w, h);
  frame = null;

  $('price-empty').hidden = shown.length > 0 || loading;
  if (!settings || !shown.length) {
    $('signal-layer').replaceChildren();
    $('signal-layer').dataset.layout = '';
    return;
  }

  const { left, right } = chartInsets(w);
  const top = 24 + (document.querySelector('#price-wrap .chart-toolbar')?.offsetHeight || 0);
  const bottom = 32;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const start = Date.parse(settings.start);
  const end = Date.parse(settings.end);

  const lowest = shown.reduce((best, row) => row.low < best.low ? row : best);
  const highest = shown.reduce((best, row) => row.high > best.high ? row : best);
  const priceAxis = createPriceAxis(lowest.low, highest.high, top, ph, logScale);

  const scale = createTradingScale(settings.calendar, settings.frequency, left, pw);
  const x = scale.x;
  const y = priceAxis.y;
  frame = { left, right, top, bottom, pw, ph, start, end, w, h, x, y, scale, logScale };
  canvas.dataset.priceScale = logScale ? 'log' : 'linear';

  c.font = '11px Segoe UI, sans-serif';
  c.textAlign = 'left';
  for (const price of priceAxis.ticks()) {
    const py = y(price);
    if (py > h - bottom - 4) continue;
    c.fillStyle = '#555555';
    c.fillText(price.toFixed(2), w - right + 10, py + 4);
  }

  c.save();
  c.beginPath();
  c.rect(left, top, pw, ph);
  c.clip();

  // Use whole device pixels for every edge, with the same parity for body and wick.
  const metrics = candleMetrics(scale.spacing, dpr);
  canvas.dataset.barSpacing = scale.spacing.toFixed(3);
  canvas.dataset.bodyPixels = metrics.body;
  canvas.dataset.wickPixels = metrics.wick;

  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  for (const r of shown) {
    paintCandle(
      c,
      {
        x: x(r.date),
        openY: y(r.open),
        closeY: y(r.close),
        highY: y(r.high),
        lowY: y(r.low),
        up: r.close >= r.open
      },
      metrics,
      dpr
    );
  }
  c.restore();

  c.save();
  c.setLineDash([1, 3]);
  c.strokeStyle = '#444444';
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(left, y(shown.at(-1).close));
  c.lineTo(w - right, y(shown.at(-1).close));
  c.stroke();
  c.restore();

  const cross = crossDate || hoverDate || (active >= 0 ? shown[active]?.date : null);
  if (cross) {
    c.setLineDash([3, 4]);
    c.strokeStyle = '#859aa5';
    c.beginPath();
    c.moveTo(x(cross), top);
    c.lineTo(x(cross), h - bottom);
    if (Number.isFinite(hoverY)) {
      c.moveTo(left, hoverY);
      c.lineTo(w - right, hoverY);
    }
    c.stroke();
  }
  c.restore();

  // Keep extrema labels near their candles and inside the plot.
  c.save();
  c.font = '11px Segoe UI, Microsoft YaHei, sans-serif';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.setLineDash([]);
  for (const [row, value, title, labelY] of [
    [highest, highest.high, '最高', Math.max(12, y(highest.high) - 12)],
    [lowest, lowest.low, '最低', Math.min(h - bottom - 12, y(lowest.low) - 2)]
  ]) {
    const text = value.toFixed(2);
    const width = c.measureText(text).width + 12;
    const pointX = x(row.date);
    const offset = 8;
    const preferredX = pointX + offset + width < w - right
      ? pointX + offset
      : pointX - offset - width;
    const labelX = Math.max(left + 2, Math.min(preferredX, w - right - width - 2));
    const anchorX = Math.max(labelX + 4, Math.min(pointX, labelX + width - 4));
    c.strokeStyle = '#607487';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(pointX, y(value));
    c.lineTo(anchorX, labelY);
    c.stroke();
    c.fillStyle = '#f3f6f8';
    c.fillRect(labelX, labelY - 9, width, 18);
    c.fillStyle = '#19374a';
    c.fillText(text, labelX + 6, labelY);
  }
  c.restore();
  drawSignalMarkers(frame);
  c.fillStyle = '#666666';
  for (const tick of scale.ticks(w < 500 ? 3 : 6)) {
    c.textAlign = 'center';
    c.fillText(tick.label, Math.max(c.measureText(tick.label).width / 2 + 2, tick.x), h - 10);
  }
}

// Match the selected period exactly; missing sessions must not borrow another day's price.
export function setMarketHover(date, pointer = null) {
  hoverDate = date;
  active = date && settings
    ? shown.findIndex(row => periodKey(row.date, settings.frequency) === periodKey(date, settings.frequency))
    : -1;
  const row = shown[active];
  hoverY = pointer?.y ?? (row && frame ? frame.y(row.close) : null);
  const tip = $('price-tooltip');
  if (!date || !frame || !settings) {
    tip.hidden = true;
    drawPrice();
    return;
  }
  const position = {
    x: pointer?.x ?? frame.x(date),
    y: hoverY ?? frame.top + 50,
    width: frame.w,
    symbol: $('symbol').value,
    frequency: settings.frequency
  };
  if (row) {
    showMarketTooltip(tip, row, position);
  } else {
    tooltipContent(tip, { title: position.symbol + ' · ' + date, rows: [['行情', '该日期无行情记录']] });
    positionTooltip(tip, position.x, position.y, position.width);
  }
  drawPrice();
}

function hide() {
  setMarketHover(null);
  appEvents.dispatchEvent(new CustomEvent(events.marketHover, { detail: null }));
}

export function initMarketChart() {
  const symbolSelect = $('symbol');
  const scaleToggle = $('price-scale-toggle');
  logScale = false;
  try {
    const saved = localStorage.getItem(symbolStorageKey);
    if (Array.from(symbolSelect.options).some(option => option.value === saved)) {
      symbolSelect.value = saved;
    }
    logScale = localStorage.getItem(priceScaleStorageKey) === 'log';
  } catch {}
  scaleToggle.setAttribute('aria-pressed', String(logScale));

  scaleToggle.addEventListener('click', () => {
    logScale = !logScale;
    scaleToggle.setAttribute('aria-pressed', String(logScale));
    try {
      localStorage.setItem(priceScaleStorageKey, logScale ? 'log' : 'linear');
    } catch {}
    $('price-tooltip').hidden = true;
    drawPrice();
  });

  $('price-table').closest('details').addEventListener('toggle', () => {
    if ($('price-table').closest('details').open) renderPriceTable();
  });

  $('price-chart').addEventListener('pointermove', event => {
    if (!frame || !shown.length) return;
    const rect = $('price-chart').getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    if (mx < frame.left || mx > frame.w - frame.right || my < frame.top || my > frame.h - frame.bottom) {
      hide();
      return;
    }
    const date = frame.scale.dateAt(mx);
    setMarketHover(date, { x: mx, y: my });
    appEvents.dispatchEvent(new CustomEvent(events.marketHover, { detail: date }));
  });

  $('price-chart').addEventListener('pointerleave', event => {
    if (event.relatedTarget?.closest?.('#price-tooltip')) return;
    hide();
  });

  $('symbol').addEventListener('change', event => {
    try {
      localStorage.setItem(symbolStorageKey, symbolSelect.value);
    } catch {}
    shown = [];
    updateSignals(null, null);
    $('price-tooltip').hidden = true;
    drawPrice();
    // Re-adding a removed ticker downloads a new snapshot on the server.
    loadMarket(event?.detail?.forceRefresh === true);
  });

  $('price-download').addEventListener('click', () => {
    if (!shown.length) return;
    const data = store.get($('symbol').value);
    const csv =
      'Date,Open,High,Low,Close,Volume,Adjustment,AnchorDate\n' +
      shown
        .map(r => [r.date, r.open, r.high, r.low, r.close, r.volume ?? '', 'QFQ', data.anchorDate].join(','))
        .join('\n');
    downloadCSV(data.symbol + '-qfq-' + settings.frequency + '.csv', csv);
  });

  appEvents.addEventListener(events.strategySettings, () => {
    if (settings) renderMarket(settings);
  });

  new ResizeObserver(() => {
    document.getElementById('price-tooltip').hidden = true;
    drawPrice();
  }).observe($('price-wrap'));
}
