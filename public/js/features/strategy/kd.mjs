import { KD_DEFAULTS, normalizeKDOptions, calculateKDSeries, kdMultiple } from '../../domain/kd-strategy.mjs';
import { appEvents, events } from '../../services/events.mjs';
import { downloadCSV } from '../../ui/download.mjs';

const $ = id => document.getElementById(id);
const storageKey = 'seeker.kd.v1';
const storageVersion = 2;
const controls = {
  monthWeight: 'kd-month-weight',
  period: 'kd-period',
  signal: 'kd-signal'
};
const factorControls = [
  ['main-kd-tier-factor', 'main-kd-factor-error'],
  ['kd-tier-factor', 'kd-error']
];
const number = value => value == null ? '—' : value.toFixed(2);
const money = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const multiple = value => value.toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'N';

let options = { ...KD_DEFAULTS };
let review = null;

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
    if (id !== source) input.value = String(options.tierFactor);
    input.setAttribute('aria-invalid', 'false');
    $(errorId).textContent = '';
  }
}

function setParameterError(message) {
  $('kd-parameter-error').textContent = message;
  for (const id of Object.values(controls)) $(id).setAttribute('aria-invalid', String(Boolean(message)));
}

function syncControls() {
  for (const [name, id] of Object.entries(controls)) $(id).value = String(options[name]);
  $('kd-quarter-weight').value = String(options.quarterWeight);
  syncFactorControls();
  setParameterError('');
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
      if (!formerDefaults) options = previous;
    }
  } catch {}
  syncControls();
  renderTiers();

  function readOptions() {
    const next = {};
    for (const [name, id] of Object.entries(controls)) {
      const input = $(id);
      if (!input.value.trim()) throw Error('请填写有效KD参数');
      next[name] = Number(input.value);
    }
    return normalizeKDOptions({ ...options, ...next, quarterWeight: 100 - next.monthWeight });
  }

  function applyOptions() {
    try {
      options = readOptions();
    } catch (error) {
      setParameterError(error.message + '。仍显示上一次有效参数的结果。');
      return;
    }
    $('kd-quarter-weight').value = String(options.quarterWeight);
    setParameterError('');
    saveOptions();
  }

  for (const id of Object.values(controls)) $(id).addEventListener('input', applyOptions);
  for (const [id, errorId] of factorControls) {
    const input = $(id);
    input.addEventListener('input', () => {
      try {
        setKDTierFactor(input.value, id);
      } catch (error) {
        input.setAttribute('aria-invalid', 'true');
        $(errorId).textContent = error.message + '。仍显示上一次有效参数的结果。';
      }
    });
  }
  $('kd-reset').addEventListener('click', () => {
    options = { ...KD_DEFAULTS };
    syncControls();
    saveOptions();
  });
  $('kd-download').addEventListener('click', exportOrders);
}

function exportOrders() {
  if (!review) return;
  const { symbol, start, end, baseAmount, orders } = review;
  const rows = [
    ['KD定投', symbol], ['回测起始', start], ['回测结束', end],
    ['月K权重', options.monthWeight], ['季度K权重', options.quarterWeight],
    ['Period', options.period], ['Signal', options.signal], ['分档系数', options.tierFactor],
    ['口径', '周线K使用Yahoo源High/Low/Close；账户使用前复权价格；月度信号收盘确认，下一交易日开盘成交'],
    ['投入公式', 'N × round(系数^档位, 1位小数)，档位0至9'],
    [],
    ['信号日', '计划所属月', '使用的周收盘', '月K', '季度K', '加权K', '倍数', 'KD金额', '普通1N', '成交日', '状态'],
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

function drawKDChart(states, { start, end }) {
  const svg = $('kd-plot');
  svg.replaceChildren();
  const points = [];
  let previousWeek = null;
  for (const [date, state] of states) {
    if (date < start) continue;
    if (date > end) break;
    if (state && (state.signalDate !== previousWeek || date === end)) {
      points.push({ date, ...state });
      previousWeek = state.signalDate;
    }
  }
  function add(tag, attributes, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    svg.append(node);
  }
  const first = Date.parse(start);
  const span = Math.max(86400000, Date.parse(end) - first);
  const x = date => 52 + (Date.parse(date) - first) / span * 870;
  const y = k => 220 - k * 2;
  for (let k = 0; k <= 100; k += 10) {
    add('line', { x1: 52, x2: 922, y1: y(k), y2: y(k), stroke: '#e5eaf0', 'stroke-dasharray': '3 4' });
    add('text', { x: 41, y: y(k) + 4, 'text-anchor': 'end', fill: '#607487', 'font-size': 10 }, k);
  }
  const lines = [['monthK', '#0d9488', 1.5], ['quarterK', '#2563eb', 1.5], ['weightedK', '#c26e2b', 2.5]];
  for (const [key, color, width] of lines) {
    const d = points.map((point, i) => (i ? 'L' : 'M') + x(point.date) + ',' + y(point[key])).join(' ');
    add('path', { d, fill: 'none', stroke: color, 'stroke-width': width, 'data-kd-line': key });
  }
  add('text', { x: 52, y: 245, fill: '#607487', 'font-size': 10 }, start);
  add('text', { x: 922, y: 245, fill: '#607487', 'font-size': 10, 'text-anchor': 'end' }, end);
}

export function renderKDReview(context, result) {
  if (!$('kd-panel')) return;
  if (!result || !Array.isArray(context?.kdSignals)) {
    review = null;
    $('kd-status').textContent = '等待行情';
    for (const id of ['kd-latest', 'kd-largest', 'kd-spent', 'kd-ratio']) $(id).textContent = '—';
    $('kd-components').textContent = '';
    $('kd-note').textContent = '';
    $('kd-orders').replaceChildren();
    $('kd-plot').replaceChildren();
    $('kd-download').disabled = true;
    renderTiers();
    return;
  }

  const { start, end, kdOrders, deferredKD } = result;
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
  const kd = result.results.find(strategy => strategy.id === 'kd');
  const regular = result.results.find(strategy => strategy.id === 'regular');
  $('kd-status').textContent = symbol + ' · ' + start + ' — ' + end + ' · N = ' + money(baseAmount) + ' USD';
  $('kd-latest').textContent = number(state?.weightedK);
  $('kd-components').textContent = state
    ? '月K ' + number(state.monthK) + ' / 季度K ' + number(state.quarterK) + ' · 周收盘 ' + state.signalDate
    : '尚无已完成周线，按1N执行';
  $('kd-largest').textContent = money(kd.maxMonthly);
  $('kd-spent').textContent = money(kd.monthlyBought);
  $('kd-ratio').textContent = regular.monthlyBought > 0 ? (kd.monthlyBought / regular.monthlyBought).toFixed(2) + '×' : '—';
  const warm = orders.filter(order => order.warmup).length;
  const funding = result.mode === 'equal'
    ? '五策略共同供资的最大单月入金 ' + money(result.fundingPeak) + ' USD。'
    : '各自投入模式。';
  $('kd-note').textContent = 'KD有 ' + kdOrders.length + ' 笔成交，' + deferredKD + ' 笔待成交。' +
    (warm ? '其中 ' + warm + ' 笔信号处于预热期。' : '') + funding;

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
  drawKDChart(states, result);
}
