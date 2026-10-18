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
