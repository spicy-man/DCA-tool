import { KD_DEFAULTS, normalizeKDOptions, calculateKDSeries, kdMultiple, kdTierLevel } from '../../domain/kd-strategy.mjs';
import { chartInsets, createTradingScale, periodKey } from '../../charts/geometry.mjs';
import { appEvents, events } from '../../services/events.mjs';
import { downloadCSV } from '../../ui/download.mjs';
import { tooltipContent, positionTooltip } from '../../ui/tooltip.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'seeker.kd.v1';
const storageVersion = 2;
const factorControls = [
  ['main-kd-tier-factor', 'main-kd-factor-error']
];
const number = value => value == null ? '—' : value.toFixed(2);
const money = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const multiple = value => value.toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'N';

let options = { ...KD_DEFAULTS };
let review = null;
let latestChart = null;
let activeRange = null;
let plotFrame = null;
let cachedLayout = null;
let staticLayer = null;
let hoverDate = null;
let hoverPointer = null;
let boundPlot = null;
let observedWrap = null;
let replayBound = false;

export const getKDOptions = () => ({ ...options });

export function readKDTierFactor(value) {
  return normalizeKDOptions({ tierFactor: Number(value) }).tierFactor;
}

function renderTiers() {
  const header = document.createElement('th');
  header.textContent = '投入金额';
  const tiers = Array.from({ length: 10 }, (_, level) => {
    const cell = document.createElement('td');
    cell.textContent = multiple(kdMultiple(90 - level * 10, options.tierFactor));
    return cell;
  });
  $('kd-tier-row').replaceChildren(header, ...tiers);
  const highest = kdMultiple(0, options.tierFactor);
  const base = review?.baseAmount;
  const cash = base == null ? '' : '；按当前N计算为 $' + money(base * highest);
  $('kd-risk').textContent = '当前系数 ' + options.tierFactor + '，单笔最高 ' + multiple(highest) + cash +
    '。若多个计划顺延至同月，单月需求可能更高。';
}

function syncFactorControls(source) {
  for (const [id, errorId] of factorControls) {
    const input = $(id);
    if (!input) continue;
    if (id !== source) input.value = String(options.tierFactor);
    input.setAttribute('aria-invalid', 'false');
    if ($(errorId)) $(errorId).textContent = '';
  }
}

function saveOptions() {
  renderTiers();
  try { localStorage.setItem(storageKey, JSON.stringify({ ...options, version: storageVersion })); } catch {}
  appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
}

export function setKDTierFactor(value, source) {
  options = { ...options, tierFactor: readKDTierFactor(value) };
  syncFactorControls(source);
  saveOptions();
}

function chartContext(canvas) {
  const dpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
  const w = canvas?.clientWidth || 0;
  const h = canvas?.clientHeight || 0;
  if (!(w > 0 && h > 0)) return null;
  const pw = Math.round(w * dpr);
  const ph = Math.round(h * dpr);
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const c = canvas.getContext?.('2d');
  if (!c) return null;
  if (typeof c.setTransform === 'function') c.setTransform(dpr, 0, 0, dpr, 0, 0);
  else c.scale(dpr, dpr);
  return { c, w, h, dpr, pixelWidth: pw, pixelHeight: ph };
}

function sampleKDPoints(states, { start, end, frequency = 'daily' }) {
  if (frequency === 'daily') {
    const points = [];
    let previousWeek = null;
    let lastDate = null;
    let lastState = null;
    for (const [date, state] of states) {
      if (date < start) continue;
      if (date > end) break;
      if (!state) continue;
      lastDate = date;
      lastState = state;
      if (state.signalDate !== previousWeek) {
        points.push({ date, ...state });
        previousWeek = state.signalDate;
      }
    }
    if (lastDate && points.at(-1)?.date !== lastDate) {
      points.push({ date: lastDate, ...lastState });
    }
    return points;
  }
  const buckets = new Map();
  for (const [date, state] of states) {
    if (date < start) continue;
    if (date > end) break;
    if (state) buckets.set(periodKey(date, frequency), { date, ...state });
  }
  return [...buckets.values()];
}

function countKDObservations(states, { start, end, frequency = 'daily' }) {
  if (frequency === 'daily') {
    let count = 0;
    for (const [date, state] of states) {
      if (date < start) continue;
      if (date > end) break;
      if (state) count++;
    }
    return count;
  }
  const buckets = new Set();
  for (const [date, state] of states) {
    if (date < start) continue;
    if (date > end) break;
    if (state) buckets.add(periodKey(date, frequency));
  }
  return buckets.size;
}

function updateChartMeta(states, range) {
  const frequency = range?.frequency || 'daily';
  const freqLabel = frequency === 'daily' ? '日线视图' : frequency === 'weekly' ? '周线视图' : '月线视图';
  const observationCount = countKDObservations(states, { start: range.start, end: range.end, frequency });
  if ($('kd-sample-note')) {
    $('kd-sample-note').textContent = '按已收盘周线更新 · ' + freqLabel + ' · 月K ' + options.monthWeight + '% / 季度K ' + options.quarterWeight + '%';
  }
  if ($('kd-observations')) {
    $('kd-observations').textContent = observationCount.toLocaleString() + ' 条记录';
  }
}

function matchedPoint(frame, date) {
  if (!date || !frame) return null;
  if (frame.frequency === 'daily') {
    if (date < frame.start || date > frame.end) return null;
    const state = frame.states?.get(date) ?? latestChart?.states?.get(date);
    return state ? { date, ...state } : null;
  }
  return frame.pointMap?.get(periodKey(date, frame.frequency)) ?? null;
}

// Fritsch-Carlson monotone cubic Hermite tangents prevent curve overshoot across [0, 100].
function monotoneTangents(xs, ys) {
  const n = xs.length;
  const tangents = new Float64Array(n);
  if (n < 2) return tangents;
  const dx = new Float64Array(n - 1);
  const slopes = new Float64Array(n - 1);
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    slopes[i] = dx[i] > 0 ? (ys[i + 1] - ys[i]) / dx[i] : 0;
  }
  tangents[0] = slopes[0];
  tangents[n - 1] = slopes[n - 2];
  for (let i = 1; i < n - 1; i++) {
    const d0 = slopes[i - 1];
    const d1 = slopes[i];
    if (d0 * d1 <= 0 || dx[i - 1] <= 0 || dx[i] <= 0) {
      tangents[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      tangents[i] = (w1 + w2) / (w1 / d0 + w2 / d1);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const d = slopes[i];
    if (d === 0 || dx[i] <= 0) {
      tangents[i] = 0;
      tangents[i + 1] = 0;
      continue;
    }
    const a = tangents[i] / d;
    const b = tangents[i + 1] / d;
    const sum = a * a + b * b;
    if (sum > 9) {
      const scale = 3 / Math.sqrt(sum);
      tangents[i] = scale * a * d;
      tangents[i + 1] = scale * b * d;
    }
  }
  return tangents;
}

function drawStaticKDLayer(c, layout) {
  const { left, right, top, pw, ph, w, h, y, xs, curves, xTicks } = layout;

  c.save();
  c.strokeStyle = '#e5eaf0';
  c.lineWidth = 1;
  c.setLineDash([3, 4]);
  c.font = '11px Segoe UI, sans-serif';
  c.fillStyle = '#607487';
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  for (const tick of [0, 20, 40, 60, 80, 100]) {
    const py = y(tick);
    c.beginPath();
    c.moveTo(left, py);
    c.lineTo(w - right, py);
    c.stroke();
    c.fillText(String(tick), w - right + 10, py);
  }
  c.restore();

  c.save();
  c.beginPath();
  c.rect(left, top, pw, ph);
  c.clip();
  c.lineJoin = 'round';
  c.setLineDash([]);
  for (const { color, lineWidth, ys, tangents } of curves) {
    if (xs.length === 1) {
      c.fillStyle = color;
      c.beginPath();
      c.arc(xs[0], ys[0], Math.max(2, lineWidth + 0.5), 0, Math.PI * 2);
      c.fill();
      continue;
    }
    c.strokeStyle = color;
    c.lineWidth = lineWidth;
    c.beginPath();
    c.moveTo(xs[0], ys[0]);
    for (let i = 0; i < xs.length - 1; i++) {
      const step = xs[i + 1] - xs[i];
      if (step <= 0) {
        c.lineTo(xs[i + 1], ys[i + 1]);
        continue;
      }
      const third = step / 3;
      c.bezierCurveTo(
        xs[i] + third,
        ys[i] + tangents[i] * third,
        xs[i + 1] - third,
        ys[i + 1] - tangents[i + 1] * third,
        xs[i + 1],
        ys[i + 1]
      );
    }
    c.stroke();
  }
  c.restore();

  c.fillStyle = '#8b959c';
  c.font = '10px Segoe UI, sans-serif';
  c.textBaseline = 'alphabetic';
  for (const tick of xTicks) {
    c.textAlign = 'center';
    c.fillText(tick.label, Math.max(c.measureText(tick.label).width / 2 + 2, tick.x), h - 9);
  }
}

export function drawKDChart() {
  const canvas = $('kd-plot');
  if (!canvas || $('kd-wrap')?.hidden) {
    plotFrame = null;
    return null;
  }
  const ctx = chartContext(canvas);
  if (!ctx) {
    plotFrame = null;
    return null;
  }
  const { c, w, h, dpr, pixelWidth, pixelHeight } = ctx;
  c.clearRect(0, 0, w, h);

  if (!latestChart || !activeRange) {
    cachedLayout = null;
    plotFrame = null;
    return null;
  }

  const { states, rows } = latestChart;
  const { start, end, frequency = 'daily' } = activeRange;
  const { left, right } = chartInsets(w);
  const top = 10;
  const bottom = 32;
  const pw = w - left - right;
  const ph = h - top - bottom;
  if (!(pw > 0 && ph > 0)) {
    plotFrame = null;
    return null;
  }

  let layout = cachedLayout;
  if (!layout || layout.states !== states || layout.start !== start || layout.end !== end ||
      layout.frequency !== frequency || layout.calendarRef !== activeRange.calendar ||
      layout.w !== w || layout.h !== h || layout.dpr !== dpr) {
    const calendar = activeRange.calendar?.length
      ? activeRange.calendar
      : rows.filter(row => row.date >= start && row.date <= end).map(row => row.date);
    const points = sampleKDPoints(states, { start, end, frequency });
    if (!calendar.length || !points.length) {
      cachedLayout = null;
      plotFrame = null;
      return null;
    }
    const scale = createTradingScale(calendar, frequency, left, pw);
    const x = scale.x;
    const y = v => top + ((100 - v) / 100) * ph;
    const pointMap = frequency === 'daily' ? null : new Map();
    const xs = new Float64Array(points.length);
    for (let i = 0; i < points.length; i++) {
      if (pointMap) pointMap.set(periodKey(points[i].date, frequency), points[i]);
      xs[i] = x(points[i].date);
    }
    const curveSpecs = [
      ['monthK', '#0d9488', 1],
      ['quarterK', '#2563eb', 1],
      ['weightedK', '#c26e2b', 2.2]
    ];
    const curves = curveSpecs.map(([key, color, lineWidth]) => {
      const ys = new Float64Array(points.length);
      for (let i = 0; i < points.length; i++) ys[i] = y(points[i][key]);
      return { key, color, lineWidth, ys, tangents: monotoneTangents(xs, ys) };
    });
    layout = {
      states,
      start,
      end,
      frequency,
      calendarRef: activeRange.calendar,
      dpr,
      left,
      right,
      top,
      bottom,
      pw,
      ph,
      w,
      h,
      x,
      y,
      scale,
      points,
      pointMap,
      xs,
      curves,
      xTicks: scale.ticks(w < 500 ? 3 : 6),
      staticCanvas: null
    };
    if (typeof document !== 'undefined' && typeof c.drawImage === 'function') {
      if (!staticLayer || staticLayer.ownerDocument !== document || typeof staticLayer.getContext !== 'function') {
        staticLayer = document.createElement('canvas');
      }
      if (typeof staticLayer?.getContext === 'function') {
        if (staticLayer.width !== pixelWidth) staticLayer.width = pixelWidth;
        if (staticLayer.height !== pixelHeight) staticLayer.height = pixelHeight;
        const sc = staticLayer.getContext('2d');
        if (sc) {
          if (typeof sc.setTransform === 'function') sc.setTransform(dpr, 0, 0, dpr, 0, 0);
          else sc.scale(dpr, dpr);
          sc.clearRect(0, 0, w, h);
          drawStaticKDLayer(sc, layout);
          layout.staticCanvas = staticLayer;
        }
      }
    }
    cachedLayout = layout;
  }

  const { x, y } = layout;
  plotFrame = layout;

  if (layout.staticCanvas) c.drawImage(layout.staticCanvas, 0, 0, w, h);
  else drawStaticKDLayer(c, layout);

  if (hoverDate) {
    const point = matchedPoint(layout, hoverDate);
    const crossX = x(point ? point.date : hoverDate);
    const crossY = point ? y(point.weightedK) : hoverPointer?.y ?? null;
    c.save();
    c.setLineDash([3, 4]);
    c.strokeStyle = '#7f949d';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(crossX, top);
    c.lineTo(crossX, h - bottom);
    if (Number.isFinite(crossY)) {
      c.moveTo(left, crossY);
      c.lineTo(w - right, crossY);
    }
    c.stroke();
    c.restore();

    if (point) {
      for (const [key, color, radius, bordered] of [
        ['monthK', '#0d9488', 2.5, false],
        ['quarterK', '#2563eb', 2.5, false],
        ['weightedK', '#c26e2b', 4, true]
      ]) {
        c.beginPath();
        c.arc(crossX, y(point[key]), radius, 0, Math.PI * 2);
        c.fillStyle = color;
        c.fill();
        if (bordered) {
          c.strokeStyle = '#ffffff';
          c.lineWidth = 1.5;
          c.stroke();
        }
      }
    }
  }

  return plotFrame;
}

export function setKDHover(date, pointer = null) {
  hoverDate = date;
  hoverPointer = pointer;
  const tip = $('kd-tooltip');
  if (!date || !plotFrame || !latestChart || $('kd-wrap')?.hidden || $('kd-chart-collapse')?.inert) {
    if (tip) tip.hidden = true;
    drawKDChart();
    return;
  }
  const point = matchedPoint(plotFrame, date);
  if (tip) {
    if (point) {
      const level = kdTierLevel(point.weightedK);
      const bandLow = (9 - level) * 10;
      const mult = kdMultiple(point.weightedK, options.tierFactor);
      tooltipContent(tip, {
        title: point.date,
        rows: [
          ['加权K', number(point.weightedK)],
          ['月K', number(point.monthK)],
          ['季度K', number(point.quarterK)],
          ['分档倍率', multiple(mult) + `（${bandLow}–${bandLow + 10}）`],
          ['周收盘', point.signalDate]
        ],
        footer: point.full ? undefined : '处于指标预热期'
      });
    } else {
      tooltipContent(tip, {
        title: date,
        rows: [['加权K', '该日期无可用周线指标']]
      });
    }
    const tipX = pointer?.x ?? plotFrame.x(point ? point.date : date);
    const tipY = point ? plotFrame.y(point.weightedK) : pointer?.y ?? 60;
    positionTooltip(tip, tipX, tipY, plotFrame.w);
  }
  drawKDChart();
}

function hideKDHover() {
  setKDHover(null);
  appEvents.dispatchEvent(new CustomEvent(events.kdHover, { detail: null }));
}

export function initKDControls() {
  if (!$('kd-panel')) return;
  options = { ...KD_DEFAULTS };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved) {
      const { version, ...storedOptions } = saved;
      const previous = normalizeKDOptions({ tierFactor: 2, ...storedOptions });
      const formerDefaults = version === undefined && previous.monthWeight === 40 && previous.quarterWeight === 60 &&
        previous.period === 9 && previous.signal === 3 && previous.tierFactor === 2;
      if (!formerDefaults) options = { ...KD_DEFAULTS, tierFactor: previous.tierFactor };
    }
  } catch {}
  syncFactorControls();
  renderTiers();

  for (const [id, errorId] of factorControls) {
    const input = $(id);
    if (!input) continue;
    input.addEventListener('input', () => {
      try {
        setKDTierFactor(input.value, id);
      } catch (error) {
        input.setAttribute('aria-invalid', 'true');
        $(errorId).textContent = error.message + '。仍显示上一次有效参数的结果。';
      }
    });
  }

  const plot = $('kd-plot');
  if (plot && boundPlot !== plot) {
    boundPlot = plot;
    plot.addEventListener('pointermove', event => {
      if (!plotFrame || !plotFrame.points.length) return;
      const rect = plot.getBoundingClientRect();
      const mx = event.clientX - rect.left;
      const my = event.clientY - rect.top;
      if (mx < plotFrame.left || mx > plotFrame.w - plotFrame.right ||
          my < plotFrame.top || my > plotFrame.h - plotFrame.bottom) {
        hideKDHover();
        return;
      }
      const date = plotFrame.scale.dateAt(mx);
      setKDHover(date, { x: mx, y: my });
      appEvents.dispatchEvent(new CustomEvent(events.kdHover, { detail: date }));
    });
    plot.addEventListener('pointerleave', hideKDHover);
  }

  const wrap = $('kd-wrap');
  if (wrap && observedWrap !== wrap && typeof ResizeObserver !== 'undefined') {
    observedWrap = wrap;
    new ResizeObserver(() => {
      if (latestChart) drawKDChart();
    }).observe(wrap);
  }

  if (!replayBound) {
    replayBound = true;
    appEvents.addEventListener(events.replayRange, event => {
      if (!latestChart) return;
      if (event.detail && event.detail !== activeRange) {
        activeRange = event.detail;
        hoverDate = null;
        hoverPointer = null;
        if ($('kd-tooltip')) $('kd-tooltip').hidden = true;
        updateChartMeta(latestChart.states, activeRange);
        drawKDChart();
      }
    });
  }

  $('kd-download').addEventListener('click', exportOrders);
}

function exportOrders() {
  if (!review) return;
  const { symbol, start, end, baseAmount, orders } = review;
  const rows = [
    ['加权K定投', symbol], ['回测起始', start], ['回测结束', end],
    ['月K权重', options.monthWeight], ['季度K权重', options.quarterWeight],
    ['Period', options.period], ['Signal', options.signal], ['分档系数', options.tierFactor],
    ['口径', '周线K使用Yahoo源High/Low/Close；账户使用前复权价格；月度信号收盘确认，下一交易日开盘成交'],
    ['投入公式', 'N × round(系数^档位, 1位小数)，档位0至9'],
    [],
    ['信号日', '计划所属月', '使用的周收盘', '月K', '季度K', '加权K', '倍率', '加权K金额', '普通1N', '成交日', '状态'],
    ...orders.map(order => [
      order.date, order.scheduledMonth, order.signalWeek, order.monthK, order.quarterK,
      order.weightedK, order.multiple, order.amount, baseAmount, order.fillDate,
      order.fillDate ? '已成交' : '待成交（区间外不执行）'
    ])
  ];
  const escape = value => '"' + String(value ?? '').replace(/"/g, '""') + '"';
  const csv = '\uFEFF' + rows.map(row => row.map(escape).join(',')).join('\r\n');
  downloadCSV('KD_' + symbol + '_' + start + '_' + end + '.csv', csv);
}

export function renderKDReview(context, result) {
  if (!$('kd-panel')) return;
  if (!result || !Array.isArray(context?.kdSignals)) {
    review = null;
    latestChart = null;
    activeRange = null;
    cachedLayout = null;
    hoverDate = null;
    hoverPointer = null;
    if ($('kd-tooltip')) $('kd-tooltip').hidden = true;
    $('kd-status').textContent = '等待行情';
    $('kd-latest').textContent = '—';
    if ($('kd-rating')) $('kd-rating').textContent = '—';
    if ($('kd-observations')) $('kd-observations').textContent = '—';
    $('kd-orders').replaceChildren();
    $('kd-download').disabled = true;
    renderTiers();
    drawKDChart();
    return;
  }

  const { start, end, kdOrders } = result;
  const { symbol, baseAmount, rows, kdSignals } = context;
  const orderKey = (date, month) => date + ':' + month;
  const fills = new Map(kdOrders.map(order => [orderKey(order.signalDate, order.scheduledMonth), order.date]));
  const orders = [];
  for (const signal of kdSignals) {
    const fillDate = fills.get(orderKey(signal.date, signal.scheduledMonth));
    if (fillDate || (signal.date >= start && signal.date <= end)) orders.push({ ...signal, fillDate });
  }

  review = { symbol, start, end, baseAmount, orders };
  $('kd-download').disabled = false;
  renderTiers();
  const states = calculateKDSeries(rows, options);
  const state = states.get(end);

  $('kd-latest').textContent = number(state?.weightedK);
  if ($('kd-rating')) {
    $('kd-rating').textContent = state
      ? '第 ' + kdTierLevel(state.weightedK) + ' 档 · ' + multiple(kdMultiple(state.weightedK, options.tierFactor))
      : '尚无已完成周线 · 1N';
  }
  $('kd-status').textContent = '指标范围 0–100，数值越低对应买入档位越高';

  $('kd-orders').replaceChildren(...orders.map(order => {
    const row = document.createElement('tr');
    const values = [
      order.date, order.scheduledMonth, order.signalWeek ?? '暂无', number(order.monthK), number(order.quarterK),
      number(order.weightedK), multiple(order.multiple), money(order.amount), money(baseAmount), order.fillDate ?? '待成交'
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    }
    return row;
  }));

  latestChart = { states, rows };
  activeRange = context.range?.start && context.range?.end
    ? context.range
    : { start, end, frequency: context.range?.frequency || 'daily', calendar: rows.filter(row => row.date >= start && row.date <= end).map(row => row.date) };
  updateChartMeta(states, activeRange);
  hoverDate = null;
  hoverPointer = null;
  if ($('kd-tooltip')) $('kd-tooltip').hidden = true;
  drawKDChart();
}
