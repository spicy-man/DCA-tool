import { periodKey } from '../domain/trading-calendar.mjs';

export { periodKey };

// Both panels use the same plot edges and a right-hand value axis.
export function chartInsets(width) {
  return { left: 0, right: width < 500 ? 54 : 64 };
}

// Trading sessions occupy equal horizontal slots; non-trading days occupy no space.
export function createTradingScale(calendar, frequency, left, width, rightOffset = 3) {
  const periods = new Map();
  for (const date of calendar) {
    periods.set(periodKey(date, frequency), date);
  }
  const keys = [...periods.keys()].sort();
  const dates = keys.map(key => periods.get(key));
  const positions = new Map(keys.map((key, i) => [key, i]));
  const spacing = width / Math.max(1, keys.length + rightOffset);
  const spanDays = (Date.parse(dates.at(-1)) - Date.parse(dates[0])) / 86400000;
  const shortTicks = frequency !== 'monthly' && spanDays < 180;

  function index(date) {
    const key = periodKey(date, frequency);
    if (positions.has(key)) return positions.get(key);
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo - 0.5;
  }

  return {
    spacing,
    dates,
    shortTicks,
    x: date => left + (index(date) + 0.5) * spacing,
    dateAt: px => dates[Math.max(0, Math.min(dates.length - 1, Math.round((px - left) / spacing - 0.5)))],
    ticks(count) {
      const indexes = new Set();
      for (let i = 0; i < count; i++) {
        indexes.add(Math.round(((dates.length - 1) * i) / Math.max(1, count - 1)));
      }
      const dateFormat = shortTicks
        ? { month: 'short', day: 'numeric', timeZone: 'UTC' }
        : { month: 'short', year: '2-digit', timeZone: 'UTC' };
      return [...indexes]
        .filter(i => dates[i])
        .map(i => {
          const date = dates[i];
          const label = new Date(date + 'T00:00:00Z').toLocaleDateString('zh-CN', dateFormat);
          return { date, x: left + (i + 0.5) * spacing, label };
        });
    }
  };
}

// Device-pixel geometry prevents antialiased outlines and keeps the wick centered.
export function candleMetrics(spacing, dpr) {
  const wick = Math.max(1, Math.floor(dpr));
  const ratio = spacing <= 4 ? 1 : 0.8 + 0.2 / (1 + 0.7 * (spacing - 4));
  let body = Math.max(wick, Math.floor(spacing * dpr * ratio));
  if (body >= 2 && body % 2 !== wick % 2) body--;
  return { body: Math.max(wick, body), wick, border: wick };
}

function linearNiceStep(span, count) {
  const target = Math.max(span, 1e-6) / Math.max(1, count);
  const unit = 10 ** Math.floor(Math.log10(target));
  return [1, 2, 2.5, 5, 10]
    .map(n => n * unit)
    .reduce((best, n) => (Math.abs(n - target) < Math.abs(best - target) ? n : best));
}

function linearTicks(low, high, count) {
  const step = linearNiceStep(high - low, count);
  const ticks = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) {
    ticks.push(Math.abs(value) < step * 1e-9 ? 0 : Number(value.toPrecision(12)));
  }
  return ticks;
}

// Positive price axis with optional logarithmic mapping and clean visual ticks.
export function createPriceAxis(lowPrice, highPrice, top, height, logScale = false) {
  const minPrice = Math.max(1e-6, lowPrice);
  const maxPrice = Math.max(minPrice * 1.0001, highPrice);
  const maxTickCount = Math.max(3, Math.floor(height / 85));

  if (!logScale) {
    const pad = Math.max((maxPrice - minPrice) * 0.1, maxPrice * 0.002);
    const low = minPrice - pad;
    const high = maxPrice + pad;
    return {
      low,
      high,
      logScale: false,
      y: value => top + ((high - value) / (high - low)) * height,
      ticks: () => linearTicks(low, high, maxTickCount)
    };
  }

  const logMin = Math.log10(minPrice);
  const logMax = Math.log10(maxPrice);
  const logSpan = Math.max(logMax - logMin, 0.002);
  const logPad = Math.max(logSpan * 0.1, 0.001);
  const lowLog = logMin - logPad;
  const highLog = logMax + logPad;
  const low = 10 ** lowLog;
  const high = 10 ** highLog;
  const y = value => top + ((highLog - Math.log10(Math.max(1e-9, value))) / (highLog - lowLog)) * height;

  return {
    low,
    high,
    logScale: true,
    y,
    ticks() {
      const startExp = Math.floor(lowLog);
      const endExp = Math.ceil(highLog);
      for (const mults of [
        [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8],
        [1, 1.5, 2, 3, 5, 7],
        [1, 2, 5],
        [1, 3],
        [1]
      ]) {
        const candidates = [];
        for (let exp = startExp; exp <= endExp; exp++) {
          const base = 10 ** exp;
          for (const m of mults) {
            const v = Number((m * base).toPrecision(12));
            if (v >= low && v <= high) candidates.push(v);
          }
        }
        if (candidates.length >= 2 && candidates.length <= maxTickCount + 2) {
          return candidates;
        }
      }
      if (high / low < 2.2) {
        return linearTicks(low, high, maxTickCount).filter(v => v > 0);
      }
      const stepExp = Math.max(1, Math.ceil((endExp - startExp) / maxTickCount));
      const fallback = [];
      for (let exp = startExp; exp <= endExp; exp += stepExp) {
        const v = 10 ** exp;
        if (v >= low && v <= high) fallback.push(v);
      }
      return fallback.length >= 2 ? fallback : [minPrice, maxPrice];
    }
  };
}

// Signed profit axis supporting zero and negative values via symmetric logarithm.
export function createProfitAxis(values, top, bottom, logScale = false, baseAmount = 100) {
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const height = bottom - top;

  if (!logScale || (rawMax === 0 && rawMin === 0)) {
    const span = rawMax - rawMin || 1;
    const ticks = Array.from({ length: 5 }, (_, i) => rawMin + (span * i) / 4);
    return {
      min: rawMin,
      max: rawMax,
      logScale: false,
      y: value => bottom - ((value - rawMin) / span) * height,
      ticks
    };
  }

  const maxAbs = Math.max(Math.abs(rawMax), Math.abs(rawMin), 1);
  const unit = Math.max(1, Number.isFinite(baseAmount) && baseAmount > 0 ? baseAmount : 100, maxAbs / 1000);
  const symlog = v => Math.sign(v) * Math.log1p(Math.abs(v) / unit);
  const invSymlog = t => Math.sign(t) * unit * Math.expm1(Math.abs(t));
  const rawTMin = symlog(rawMin);
  const rawTMax = symlog(rawMax);
  const rawTSpan = rawTMax - rawTMin || 1;
  const ticks = Array.from({ length: 5 }, (_, i) => {
    const raw = invSymlog(rawTMin + (rawTSpan * i) / 4);
    if (Math.abs(raw) < unit * 1e-6) return 0;
    const mag = 10 ** Math.floor(Math.log10(Math.abs(raw)));
    return Math.round(raw / (mag / 2)) * (mag / 2);
  });
  if (rawMin <= 0 && rawMax >= 0 && !ticks.includes(0)) {
    let closest = 0;
    for (let i = 1; i < ticks.length; i++) {
      if (Math.abs(ticks[i]) < Math.abs(ticks[closest])) closest = i;
    }
    ticks[closest] = 0;
  }
  const min = Math.min(rawMin, ...ticks);
  const max = Math.max(rawMax, ...ticks);
  const tMin = symlog(min);
  const tMax = symlog(max);
  const tSpan = tMax - tMin || 1;

  return {
    min,
    max,
    logScale: true,
    y: value => bottom - ((symlog(value) - tMin) / tSpan) * height,
    ticks: [...new Set(ticks)].sort((a, b) => a - b)
  };
}

export function paintCandle(c, bar, metrics, dpr) {
  const center = Math.round(bar.x * dpr);
  const left = center - Math.floor(metrics.body / 2);
  const wickLeft = center - Math.floor(metrics.wick / 2);
  const top = Math.round(Math.min(bar.openY, bar.closeY) * dpr);
  const bottom = Math.round(Math.max(bar.openY, bar.closeY) * dpr);
  const high = Math.round(bar.highY * dpr);
  const low = Math.round(bar.lowY * dpr);

  c.fillStyle = '#000000';
  if (top > high) c.fillRect(wickLeft, high, metrics.wick, top - high);
  if (low > bottom) c.fillRect(wickLeft, bottom + 1, metrics.wick, low - bottom);

  const height = Math.max(metrics.wick, bottom - top + 1);
  c.fillRect(left, top, metrics.body, height);

  if (bar.up && metrics.body > metrics.border * 2 && height > metrics.border * 2) {
    c.fillStyle = '#ffffff';
    c.fillRect(
      left + metrics.border,
      top + metrics.border,
      metrics.body - 2 * metrics.border,
      height - 2 * metrics.border
    );
  }
}
