import { isTradingDay, periodKey } from './trading-calendar.mjs';

export const KD_DEFAULTS = Object.freeze({
  monthWeight: 80,
  quarterWeight: 20,
  period: 9,
  signal: 3,
  tierFactor: 1.5
});

const DAY_MS = 86400000;
// Absorb subtraction and smoothing noise only at a 10-point tier boundary.
const TIER_BOUNDARY_TOLERANCE = 1e-10;
const cache = new WeakMap();

export function normalizeKDOptions(input = {}) {
  const options = { ...KD_DEFAULTS, ...input };
  for (const weight of [options.monthWeight, options.quarterWeight]) {
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) throw Error('加权K权重须为0%至100%');
  }
  if (Math.abs(options.monthWeight + options.quarterWeight - 100) > 1e-8) {
    throw Error('月K与季度K权重合计须为100%');
  }
  for (const count of [options.period, options.signal]) {
    if (!Number.isInteger(count) || count < 1 || count > 200) throw Error('加权K周期参数须为1至200的整数');
  }
  if (!Number.isFinite(options.tierFactor) || options.tierFactor < 1 || options.tierFactor > 3) {
    throw Error('加权K分档系数须为1至3，可填小数');
  }
  return options;
}

function prepareWeeks(rows) {
  const weeks = [];
  const sessions = [];
  let previous = '';
  for (const row of rows) {
    const { date } = row;
    const time = Date.parse(date);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date || date <= previous) {
      throw Error('加权K日线须按有效日期递增且不重复');
    }
    previous = date;
    const high = row.sourceHigh ?? row.high;
    const low = row.sourceLow ?? row.low;
    const close = row.sourceClose ?? row.close;
    if (![high, low, close].every(value => Number.isFinite(value) && value > 0) ||
        low > high || low > close + 1e-5 || high < close - 1e-5) {
      throw Error('加权K源High/Low/Close无效：' + date);
    }

    const key = periodKey(date, 'weekly');
    const week = weeks.at(-1);
    if (week?.key === key) {
      week.end = date;
      week.high = Math.max(week.high, high, close);
      week.low = Math.min(week.low, low, close);
      week.close = close;
    } else {
      weeks.push({ key, start: date, end: date, high: Math.max(high, close), low: Math.min(low, close), close });
    }

    // A holiday-shortened week may end before Friday. Check the exchange
    // calendar so a snapshot ending midweek cannot confirm a partial candle.
    let next = time + DAY_MS;
    while (!isTradingDay(new Date(next).toISOString().slice(0, 10))) next += DAY_MS;
    sessions.push({ date, key, closesWeek: periodKey(new Date(next).toISOString().slice(0, 10), 'weekly') !== key });
  }
  return { weeks, sessions };
}

function decimalPrice(price) {
  const [decimal, exponent = '0'] = String(price).split('e');
  const fractionDigits = decimal.split('.')[1]?.length ?? 0;
  return { digits: BigInt(decimal.replace('.', '')), exponent: Number(exponent) - fractionDigits };
}

function weeklyRSV(close, low, high) {
  let range = high - low;
  let offset = close - low;
  if (range > 0 && range <= high / 100) {
    // Narrow ranges amplify the rounding of the input prices. Subtract their
    // decimal representations before converting the differences back to Number.
    const prices = [low, close, high].map(decimalPrice);
    const exponent = Math.min(...prices.map(price => price.exponent));
    const [bottom, last, top] = prices.map(price => price.digits * 10n ** BigInt(price.exponent - exponent));
    range = Number(`${top - bottom}e${exponent}`);
    offset = Number(`${last - bottom}e${exponent}`);
  }
  return 100 * (offset / Math.max(range, 1e-10));
}

function calendarK(weeks, periodKeyForWeek, fallbackWeeks, { period, signal }) {
  const starts = [];
  let previousPeriod;
  let k = null;
  return weeks.map((week, index) => {
    const key = periodKeyForWeek(week.start);
    if (key !== previousPeriod) {
      starts.push(index);
      previousPeriod = key;
    }
    const bars = count => starts.length >= count ? index - starts.at(-count) + 1 : count * fallbackWeeks;
    const lookback = bars(period);
    const smoothing = bars(signal);
    let high = week.high;
    let low = week.low;
    for (let i = Math.max(0, index - lookback + 1); i < index; i++) {
      high = Math.max(high, weeks[i].high);
      low = Math.min(low, weeks[i].low);
    }
    const rsv = weeklyRSV(week.close, low, high);
    k = k === null ? rsv : (rsv + (smoothing - 1) * k) / smoothing;
    return { k, full: starts.length >= Math.max(period, signal) };
  });
}

export function calculateKDSeries(rows, input = {}) {
  const options = normalizeKDOptions(input);
  let entry = cache.get(rows);
  if (!entry) {
    entry = prepareWeeks(rows);
    cache.set(rows, entry);
  }

  const periodKey = [options.period, options.signal].join(':');
  if (entry.periodKey !== periodKey) {
    entry.monthly = calendarK(entry.weeks, date => date.slice(0, 7), 4, options);
    entry.quarterly = calendarK(entry.weeks, date => date.slice(0, 4) + '-Q' + Math.ceil(Number(date.slice(5, 7)) / 3), 13, options);
    entry.periodKey = periodKey;
    entry.states = null;
  }

  const weightKey = [options.monthWeight, options.quarterWeight].join(':');
  if (entry.states && entry.weightKey === weightKey) return entry.states;

  const states = new Map();
  let index = -1;
  for (const { date, key, closesWeek } of entry.sessions) {
    let nextWeek = entry.weeks[index + 1];
    while (nextWeek && nextWeek.end <= date && (nextWeek.key < key || closesWeek)) {
      index++;
      nextWeek = entry.weeks[index + 1];
    }
    if (index < 0) {
      states.set(date, null);
      continue;
    }
    const month = entry.monthly[index];
    const quarter = entry.quarterly[index];
    const weighted = (month.k * options.monthWeight + quarter.k * options.quarterWeight) / 100;
    states.set(date, {
      signalDate: entry.weeks[index].end,
      monthK: month.k,
      quarterK: quarter.k,
      weightedK: Math.min(100, Math.max(0, weighted)),
      full: month.full && quarter.full
    });
  }
  entry.weightKey = weightKey;
  entry.states = states;
  return states;
}

/** Map weighted K (0–100) to tier level 0 (90–100) through 9 (0–10). */
export function kdTierLevel(value) {
  if (!Number.isFinite(value)) throw Error('加权K无效');
  const nearestTier = Math.round(value / 10);
  const tier = Math.abs(value - nearestTier * 10) <= TIER_BOUNDARY_TOLERANCE
    ? nearestTier
    : Math.floor(value / 10);
  return Math.min(9, Math.max(0, 9 - tier));
}

export function kdMultiple(value, factor = KD_DEFAULTS.tierFactor) {
  if (!Number.isFinite(factor) || factor < 1 || factor > 3) throw Error('加权K分档系数须为1至3');
  return Math.round(factor ** kdTierLevel(value) * 10) / 10;
}

// Reuse the monthly plan dates, including distinct plans rolled into one month.
export function calculateKDSignals(rows, monthlySignals, { baseAmount = 1000, ...input } = {}) {
  const options = normalizeKDOptions(input);
  if (!Number.isFinite(baseAmount) || (baseAmount !== 0 && baseAmount < 0.01) ||
      !Number.isFinite(baseAmount * kdMultiple(0, options.tierFactor))) {
    throw Error('加权K定投的N须为0或不低于$0.01的有效金额');
  }
  if (baseAmount === 0) return [];

  const states = calculateKDSeries(rows, options);
  return monthlySignals.map(({ date, scheduledMonth, scheduledDate, buyDay }) => {
    if (!states.has(date)) throw Error('加权K月度信号缺少对应行情');
    const state = states.get(date);
    const multiple = state ? kdMultiple(state.weightedK, options.tierFactor) : 1;
    return {
      date, scheduledMonth, scheduledDate, buyDay,
      signalWeek: state?.signalDate ?? null,
      monthK: state?.monthK ?? null,
      quarterK: state?.quarterK ?? null,
      weightedK: state?.weightedK ?? null,
      multiple,
      amount: baseAmount * multiple,
      baseAmount,
      warmup: !state?.full,
      fallback: !state
    };
  });
}
