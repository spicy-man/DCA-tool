import { SYMBOLS } from './market.mjs';
import {
  KD_DEFAULTS,
  calculateKDSeries,
  kdMultiple,
  kdTierLevel,
  normalizeKDOptions
} from './kd-strategy.mjs';

export const MS_PER_DAY = 86400000;
export const MS_PER_YEAR = MS_PER_DAY * 365.25;
export const MIN_CHANNEL_VIEW_SPAN = 30 / 365.25;

export const CHANNEL_SYMBOLS = [...SYMBOLS];
export const CUSTOM_SYMBOL_RE = /^[A-Z0-9][A-Z0-9.-]{0,14}$/;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isValidChannelSymbol(symbol) {
  return typeof symbol === 'string' && !UNSAFE_KEYS.has(symbol) && CUSTOM_SYMBOL_RE.test(symbol);
}

export function getChannelAssetMeta(symbol) {
  if (Object.hasOwn(CHANNEL_ASSETS, symbol)) {
    return CHANNEL_ASSETS[symbol];
  }
  return {
    symbol,
    shortName: symbol,
    descTag: '自定义标的',
    defaultSlope: 10.0,
    minSlope: 0,
    maxSlope: 25,
    presets: [
      { label: '保守 8%', value: 8.0 },
      { label: '中性 10%', value: 10.0 },
      { label: '乐观 12%', value: 12.0 }
    ]
  };
}

export const CHANNEL_ASSETS = {
  SPY: {
    symbol: 'SPY',
    shortName: '标普 500',
    descTag: '美股大盘基准',
    defaultSlope: 10.0,
    minSlope: 5,
    maxSlope: 18,
    presets: [
      { label: '保守 9%', value: 9.0 },
      { label: '中性 10%', value: 10.0 },
      { label: '乐观 11%', value: 11.0 }
    ]
  },
  QQQ: {
    symbol: 'QQQ',
    shortName: '纳斯达克 100',
    descTag: '科技成长核心',
    defaultSlope: 15.0,
    minSlope: 8,
    maxSlope: 24,
    presets: [
      { label: '保守 13.5%', value: 13.5 },
      { label: '中性 15%', value: 15.0 },
      { label: '乐观 16.5%', value: 16.5 }
    ]
  },
  VGT: {
    symbol: 'VGT',
    shortName: '信息技术',
    descTag: '信息技术板块',
    defaultSlope: 16.5,
    minSlope: 8,
    maxSlope: 26,
    presets: [
      { label: '保守 15%', value: 15.0 },
      { label: '中性 16.5%', value: 16.5 },
      { label: '乐观 18%', value: 18.0 }
    ]
  },
  SMH: {
    symbol: 'SMH',
    shortName: '半导体',
    descTag: '高周期高波动',
    defaultSlope: 18.0,
    minSlope: 10,
    maxSlope: 32,
    presets: [
      { label: '保守 16%', value: 16.0 },
      { label: '中性 18%', value: 18.0 },
      { label: '乐观 20%', value: 20.0 }
    ]
  },
  'BRK-B': {
    symbol: 'BRK-B',
    shortName: '伯克希尔 B',
    descTag: '无分红全留存复利',
    defaultSlope: 10.0,
    minSlope: 5,
    maxSlope: 18,
    presets: [
      { label: '保守 9%', value: 9.0 },
      { label: '中性 10%', value: 10.0 },
      { label: '乐观 11.5%', value: 11.5 }
    ]
  }
};

export const SAMPLE_WINDOWS = {
  '15y': { id: '15y', label: '近 15 年', years: 15 },
  '10y': { id: '10y', label: '近 10 年', years: 10 },
  all: { id: 'all', label: '各自全历史', years: null }
};

export const PRICE_BASES = {
  price: { id: 'price', label: '拆股复权（不含息）', field: 'sourceClose' },
  totalReturn: { id: 'totalReturn', label: '前复权（含股息）', field: 'close' }
};

export const ANCHOR_MODES = {
  recent7y: 'recent7y',
  fullPivot: 'fullPivot'
};

export const CHANNEL_TIERS = [
  { k: -2.0, code: '−2.0σ', desc: '极端黄金坑', color: '#065f46' },
  { k: -1.5, code: '−1.5σ', desc: '优质击球区', color: '#047857' },
  { k: -1.0, code: '−1.0σ', desc: '常规回调买点', color: '#059669' },
  { k: -0.5, code: '−0.5σ', desc: '温和左侧', color: '#0284c7' },
  { k: 0.0, code: '0.0σ', desc: '合理中枢', color: '#19374a' },
  { k: 1.0, code: '+1.0σ', desc: '偏贵警戒', color: '#d97706' },
  { k: 2.0, code: '+2.0σ', desc: '过热减仓', color: '#b91c1c' }
];

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const Z_CRITICAL_95 = 1.959963984540054;
const T_CRITICAL_95_TABLE = [
  12.7062047, 4.3026527, 3.1824463, 2.7764451, 2.5705818,
  2.4469119, 2.3646243, 2.3060041, 2.2621572, 2.2281389
];

/**
 * Compute two-sided 95% Student-t critical value t_{0.975, df}.
 */
export function tCritical95(df) {
  if (!Number.isFinite(df) || df < 1) return Z_CRITICAL_95;
  if (df <= 10) {
    return T_CRITICAL_95_TABLE[Math.round(df) - 1];
  }
  const z = Z_CRITICAL_95;
  const z2 = z * z;
  const z3 = z2 * z;
  const z5 = z3 * z2;
  const z7 = z5 * z2;
  return (
    z +
    (z3 + z) / (4 * df) +
    (5 * z5 + 16 * z3 + 3 * z) / (96 * df * df) +
    (3 * z7 + 19 * z5 + 17 * z3 - 15 * z) / (384 * df * df * df)
  );
}

/**
 * Compute empirical band coverage (±1σ / ±2σ) and tie-safe mid-rank percentile.
 */
export function computeEmpiricalStats(residuals, sigma, targetRes) {
  if (!Array.isArray(residuals) || !residuals.length) {
    return { in1sPct: 0, in2sPct: 0, percentilePct: 50 };
  }
  const n = residuals.length;
  const tol = 1e-12;
  const hasSigma = Number.isFinite(sigma) && sigma > 0;
  const lim1 = hasSigma ? sigma : tol;
  const lim2 = hasSigma ? 2 * sigma : tol;

  let in1 = 0;
  let in2 = 0;
  let less = 0;
  let equal = 0;
  for (let i = 0; i < n; i++) {
    const r = residuals[i];
    const absR = Math.abs(r);
    if (absR <= lim1) in1++;
    if (absR <= lim2) in2++;
    if (r < targetRes - tol) less++;
    else if (Math.abs(r - targetRes) <= tol) equal++;
  }

  return {
    in1sPct: (in1 / n) * 100,
    in2sPct: (in2 / n) * 100,
    percentilePct: ((less + 0.5 * equal) / n) * 100
  };
}

function splitIsoDate(dateStr) {
  if (typeof dateStr !== 'string') throw Error('无效日期格式');
  const match = dateStr.match(ISO_DATE_RE);
  if (!match) throw Error(`无效日期格式: ${dateStr}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw Error(`非法日历日期: ${dateStr}`);
  }
  return { year, month, day };
}

function daysInUtcMonth(year, month1To12) {
  return new Date(Date.UTC(year, month1To12, 0)).getUTCDate();
}

export function parseIsoDateUtc(dateStr) {
  const { year, month, day } = splitIsoDate(dateStr);
  return Date.UTC(year, month - 1, day);
}

export function formatIsoDateUtc(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function subtractCalendarYears(dateStr, years) {
  const { year, month, day } = splitIsoDate(dateStr);
  const targetYear = year - years;
  const clampedDay = Math.min(day, daysInUtcMonth(targetYear, month));
  return formatIsoDateUtc(Date.UTC(targetYear, month - 1, clampedDay));
}

export function addCalendarMonths(dateStr, months) {
  const { year, month, day } = splitIsoDate(dateStr);
  const totalMonths = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12 + 12) % 12 + 1;
  const clampedDay = Math.min(day, daysInUtcMonth(targetYear, targetMonth));
  return formatIsoDateUtc(Date.UTC(targetYear, targetMonth - 1, clampedDay));
}

export function buildChannelDataset(
  symbol,
  rows,
  { windowId = '15y', priceBasis = 'totalReturn', rollingAnchorYears = 7 } = {}
) {
  if (!isValidChannelSymbol(symbol)) throw Error(`不支持的通道标的: ${symbol}`);
  const meta = getChannelAssetMeta(symbol);
  const winCfg = SAMPLE_WINDOWS[windowId] ?? SAMPLE_WINDOWS['15y'];
  const basisCfg = PRICE_BASES[priceBasis] ?? PRICE_BASES.totalReturn;
  const field = basisCfg.field;

  if (!Array.isArray(rows) || !rows.length) {
    throw Error(`${symbol} 缺少历史行情数据`);
  }

  const validRows = [];
  for (const row of rows) {
    if (!row || typeof row.date !== 'string' || !ISO_DATE_RE.test(row.date)) continue;
    const price = Number(row[field]);
    if (!Number.isFinite(price) || price <= 0) continue;
    validRows.push({ date: row.date, price });
  }

  validRows.sort((a, b) => a.date.localeCompare(b.date));
  if (validRows.length < 3) {
    throw Error(`${symbol} 有效行情点数不足`);
  }

  const latestDate = validRows.at(-1).date;
  const sliced = winCfg.years
    ? validRows.filter(row => row.date >= subtractCalendarYears(latestDate, winCfg.years))
    : validRows;

  if (sliced.length < 3) {
    throw Error(`${symbol} 在所选样本窗口内数据不足`);
  }

  const startDate = sliced[0].date;
  const endDate = sliced.at(-1).date;
  const baseMs = parseIsoDateUtc(startDate);
  const endMs = parseIsoDateUtc(endDate);
  const proj6mDate = addCalendarMonths(endDate, 6);
  const proj12mDate = addCalendarMonths(endDate, 12);
  const proj12Ms = parseIsoDateUtc(proj12mDate);

  const points = sliced.map(row => {
    const ms = parseIsoDateUtc(row.date);
    return {
      date: row.date,
      ms,
      t: (ms - baseMs) / MS_PER_YEAR,
      price: row.price,
      lnP: Math.log(row.price)
    };
  });

  const n = points.length;
  let sumT = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumT += points[i].t;
    sumY += points[i].lnP;
  }
  const meanTAll = sumT / n;
  const meanYAll = sumY / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dt = points[i].t - meanTAll;
    const dy = points[i].lnP - meanYAll;
    sxx += dt * dt;
    sxy += dt * dy;
    syy += dy * dy;
  }
  if (sxx <= 0) throw Error(`${symbol} 时间跨度为零，无法拟合回归`);

  const bOrig = sxy / sxx;
  const aOrig = meanYAll - bOrig * meanTAll;
  const gOrig = Math.exp(bOrig) - 1;
  const slopePct = gOrig * 100;

  const origResiduals = new Array(n);
  let sse = 0;
  for (let i = 0; i < n; i++) {
    const res = points[i].lnP - (aOrig + bOrig * points[i].t);
    origResiduals[i] = res;
    sse += res * res;
  }
  const r2 = syy > 0 ? 1 - sse / syy : 1;
  const sigma = Math.sqrt(sse / (n - 2));

  const tEnd = points[n - 1].t;
  const tProj = (proj12Ms - baseMs) / MS_PER_YEAR;
  const latestPrice = points[n - 1].price;
  const fitEnd = Math.exp(aOrig + bOrig * tEnd);
  const resEnd = origResiduals[n - 1];
  const zEnd = sigma > 0 ? resEnd / sigma : 0;
  const origEmpirical = computeEmpiricalStats(origResiduals, sigma, resEnd);

  const mDiffs = n - 1;
  const spanYears = tEnd > 0 ? tEnd : 1e-6;
  const totalLnReturn = points[n - 1].lnP - points[0].lnP;
  const muAnn = totalLnReturn / spanYears;
  const cagr = Math.exp(muAnn) - 1;
  const cagrPct = cagr * 100;
  const meanDailyRet = totalLnReturn / mDiffs;
  let retSse = 0;
  for (let i = 1; i < n; i++) {
    const dr = (points[i].lnP - points[i - 1].lnP) - meanDailyRet;
    retSse += dr * dr;
  }
  const dailyVar = retSse / Math.max(1, mDiffs - 1);
  const annVol = Math.sqrt(dailyVar * (mDiffs / spanYears));
  const driftSe = annVol / Math.sqrt(spanYears);
  const tCrit95 = tCritical95(mDiffs - 1);
  const cagrCiLowPct = (Math.exp(muAnn - tCrit95 * driftSe) - 1) * 100;
  const cagrCiHighPct = (Math.exp(muAnn + tCrit95 * driftSe) - 1) * 100;
  const returnStats = {
    spanYears,
    cagr,
    cagrPct,
    annVol,
    annVolPct: annVol * 100,
    driftSe,
    tCrit95,
    cagrCiLowPct,
    cagrCiHighPct
  };

  const recentCutoff = subtractCalendarYears(endDate, rollingAnchorYears);
  const recentPts = points.filter(pt => pt.date >= recentCutoff);
  const anchorFallback = recentPts.length < 2;
  const anchorSource = anchorFallback ? points : recentPts;

  let rSumT = 0;
  let rSumY = 0;
  for (let i = 0; i < anchorSource.length; i++) {
    rSumT += anchorSource[i].t;
    rSumY += anchorSource[i].lnP;
  }
  const meanTRecent = rSumT / anchorSource.length;
  const meanYRecent = rSumY / anchorSource.length;

  let peakPrice = 0;
  let peakDate = startDate;
  for (let i = 0; i < n; i++) {
    if (points[i].price >= peakPrice) {
      peakPrice = points[i].price;
      peakDate = points[i].date;
    }
  }

  const origSlopeRounded = Number(slopePct.toFixed(1));
  const minSlopeFloor = slopePct < 0 ? -50 : 0;
  const effectiveMinSlope = Math.max(minSlopeFloor, Math.min(meta.minSlope, Math.floor(slopePct) - 2));
  const effectiveMaxSlope = Math.max(meta.maxSlope, Math.ceil(slopePct) + 2);

  return {
    ...meta,
    windowId: winCfg.id,
    windowLabel: winCfg.label,
    priceBasis: basisCfg.id,
    priceBasisLabel: basisCfg.label,
    startDate,
    endDate,
    proj6mDate,
    proj12mDate,
    baseMs,
    endMs,
    tEnd,
    tProj,
    pointCount: n,
    points,
    peakPrice,
    peakDate,
    minSlope: effectiveMinSlope,
    maxSlope: effectiveMaxSlope,
    presets: [
      ...meta.presets.map(preset => ({ ...preset, isOrig: false })),
      {
        label: `按历史 (${origSlopeRounded.toFixed(1)}%)`,
        value: origSlopeRounded,
        isOrig: true
      }
    ],
    orig: {
      a: aOrig,
      b: bOrig,
      slope: gOrig,
      slopePct,
      r2,
      sigma,
      fitEnd,
      resEnd,
      zEnd,
      latestPrice,
      empirical: origEmpirical
    },
    returnStats,
    recentWindow: {
      startDate: anchorSource[0].date,
      endDate: anchorSource.at(-1).date,
      count: anchorSource.length,
      anchorFallback
    },
    pivots: {
      full: {
        t: meanTAll,
        lnP: meanYAll,
        price: Math.exp(meanYAll),
        date: formatIsoDateUtc(baseMs + meanTAll * MS_PER_YEAR)
      },
      recent7y: {
        t: meanTRecent,
        lnP: meanYRecent,
        price: Math.exp(meanYRecent),
        date: formatIsoDateUtc(baseMs + meanTRecent * MS_PER_YEAR)
      }
    }
  };
}

export function normalizeCustomAnchor(customAnchor) {
  if (!customAnchor || typeof customAnchor !== 'object') return null;
  const anchorDate = typeof customAnchor.anchorDate === 'string' ? customAnchor.anchorDate.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return null;
  let anchorMs;
  try {
    anchorMs = parseIsoDateUtc(anchorDate);
  } catch {
    return null;
  }
  if (!Number.isFinite(anchorMs)) return null;
  const anchorPrice = customAnchor.anchorPrice;
  if (typeof anchorPrice !== 'number' || !Number.isFinite(anchorPrice) || anchorPrice <= 0) return null;
  return { anchorDate, anchorPrice };
}

export function evaluateChannelModel(
  dataset,
  { slopePct, anchorMode = ANCHOR_MODES.recent7y, keepOrigSigma = true, offsetPct = 0, customAnchor = null } = {}
) {
  const effectiveSlope = Number.isFinite(slopePct) ? slopePct : dataset.defaultSlope;
  const g = Math.max(-0.99, effectiveSlope / 100);
  const bStar = Math.log(1 + g);

  const normalizedAnchor = anchorMode === ANCHOR_MODES.fullPivot
    ? ANCHOR_MODES.fullPivot
    : ANCHOR_MODES.recent7y;
  const basePivot = normalizedAnchor === ANCHOR_MODES.recent7y
    ? dataset.pivots.recent7y
    : dataset.pivots.full;

  const validAnchor = normalizeCustomAnchor(customAnchor);
  let aStar;
  let lnOffset;
  let effectiveOffsetPct;
  let pivotOut;

  if (validAnchor) {
    const anchorMs = parseIsoDateUtc(validAnchor.anchorDate);
    const anchorT = (anchorMs - dataset.baseMs) / MS_PER_YEAR;
    const anchorLnP = Math.log(validAnchor.anchorPrice);
    aStar = anchorLnP - bStar * anchorT;
    const lnAtBasePivot = aStar + bStar * basePivot.t;
    lnOffset = lnAtBasePivot - basePivot.lnP;
    effectiveOffsetPct = Math.round(((Math.exp(lnOffset) - 1) * 100) * 10) / 10;
    pivotOut = {
      t: anchorT,
      date: validAnchor.anchorDate,
      lnP: anchorLnP,
      price: validAnchor.anchorPrice
    };
  } else {
    const clampedOffsetPct = Number.isFinite(offsetPct)
      ? Math.max(-40, Math.min(60, offsetPct))
      : 0;
    lnOffset = Math.log(1 + clampedOffsetPct / 100);
    const pivotLnP = basePivot.lnP + lnOffset;
    const pivotPrice = basePivot.price * (1 + clampedOffsetPct / 100);
    aStar = pivotLnP - bStar * basePivot.t;
    effectiveOffsetPct = clampedOffsetPct;
    pivotOut = {
      t: basePivot.t,
      date: basePivot.date,
      lnP: pivotLnP,
      price: pivotPrice
    };
  }

  const lnFit = t => aStar + bStar * t;
  const priceFit = t => Math.exp(aStar + bStar * t);
  const origLnFit = t => dataset.orig.a + dataset.orig.b * t;

  const pts = dataset.points;
  const n = pts.length;
  const residuals = new Array(n);
  let sseMod = 0;
  for (let i = 0; i < n; i++) {
    const r = pts[i].lnP - lnFit(pts[i].t);
    residuals[i] = r;
    sseMod += r * r;
  }

  const sigmaRecalc = Math.sqrt(sseMod / Math.max(1, n - 1));
  const sigmaOrig = dataset.orig.sigma;
  const sigmaUsed = keepOrigSigma ? sigmaOrig : sigmaRecalc;

  const latestPrice = dataset.orig.latestPrice;
  const fitEnd = priceFit(dataset.tEnd);
  const origFitEnd = dataset.orig.fitEnd;
  const resEnd = residuals[n - 1];
  const zEnd = sigmaUsed > 0 ? resEnd / sigmaUsed : 0;
  const devPct = latestPrice / fitEnd - 1;
  const bandUp1sPct = (Math.exp(sigmaUsed) - 1) * 100;
  const bandDown1sPct = (Math.exp(-sigmaUsed) - 1) * 100;
  const empirical = computeEmpiricalStats(residuals, sigmaUsed, resEnd);

  const priceM10 = fitEnd * Math.exp(-1.0 * sigmaUsed);
  const priceM15 = fitEnd * Math.exp(-1.5 * sigmaUsed);
  const priceM20 = fitEnd * Math.exp(-2.0 * sigmaUsed);

  let closestIdx = 0;
  let minDist = Infinity;
  CHANNEL_TIERS.forEach((tier, idx) => {
    const dist = Math.abs(zEnd - tier.k);
    if (dist < minDist) {
      minDist = dist;
      closestIdx = idx;
    }
  });

  const g6 = Math.pow(1 + g, 0.5);
  const g12 = 1 + g;
  const tiers = CHANNEL_TIERS.map((tier, idx) => {
    const mult = Math.exp(tier.k * sigmaUsed);
    const pNow = fitEnd * mult;
    const p6m = pNow * g6;
    const p12m = pNow * g12;
    const devCenter = mult - 1;
    const diffPct = pNow / latestPrice - 1;
    const diffUsd = pNow - latestPrice;
    return {
      ...tier,
      mult,
      devCenter,
      pNow,
      p6m,
      p12m,
      diffPct,
      diffUsd,
      isCurrent: idx === closestIdx,
      isHit: tier.k <= -0.5 && latestPrice <= pNow
    };
  });

  return {
    dataset,
    symbol: dataset.symbol,
    anchorMode: normalizedAnchor,
    keepOrigSigma: Boolean(keepOrigSigma),
    slopePct: effectiveSlope,
    g,
    bStar,
    aStar,
    offsetPct: effectiveOffsetPct,
    lnOffset,
    customAnchor: validAnchor,
    isCustomAnchored: Boolean(validAnchor),
    basePivot,
    pivot: pivotOut,
    lnFit,
    priceFit,
    origLnFit,
    residuals,
    sigmaOrig,
    sigmaRecalc,
    sigmaUsed,
    bandUp1sPct,
    bandDown1sPct,
    empirical,
    latestPrice,
    fitEnd,
    origFitEnd,
    resEnd,
    zEnd,
    origZEnd: dataset.orig.zEnd,
    devPct,
    priceM10,
    priceM15,
    priceM20,
    tiers
  };
}

export function classifyChannelZ(z) {
  if (z <= -1.5) {
    return {
      label: '深度低估',
      badgeClass: 'badge-deep-under',
      valueClass: 'is-good',
      pillClass: 'z-good',
      dotColor: '#065f46'
    };
  }
  if (z <= -0.75) {
    return {
      label: '击球区',
      badgeClass: 'badge-buy-zone',
      valueClass: 'is-good',
      pillClass: 'z-good',
      dotColor: '#059669'
    };
  }
  if (z < 0.5) {
    return {
      label: '合理中枢',
      badgeClass: 'badge-fair',
      valueClass: '',
      pillClass: '',
      dotColor: '#19374a'
    };
  }
  if (z < 1.25) {
    return {
      label: '略偏贵',
      badgeClass: 'badge-expensive',
      valueClass: 'is-warn',
      pillClass: 'z-warn',
      dotColor: '#d97706'
    };
  }
  return {
    label: '过热',
    badgeClass: 'badge-overheat',
    valueClass: 'is-hot',
    pillClass: 'z-hot',
    dotColor: '#b91c1c'
  };
}

export function interpolateLnPrice(points, tQuery) {
  if (!points?.length) return 0;
  if (tQuery <= points[0].t) return points[0].lnP;
  if (tQuery >= points[points.length - 1].t) return points[points.length - 1].lnP;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= tQuery) lo = mid;
    else hi = mid;
  }
  const p0 = points[lo];
  const p1 = points[hi];
  const span = p1.t - p0.t;
  const frac = span > 0 ? (tQuery - p0.t) / span : 0;
  return p0.lnP + frac * (p1.lnP - p0.lnP);
}

/**
 * Given a fixed anchor endpoint (fixedT, fixedLnP) and a dragged endpoint
 * (dragT, targetLnP) along the center regression line, solve the clamped
 * annual slope (slopePct), equivalent vertical shift (offsetPct), and an
 * immutable calendar-date anchor (customAnchor).
 */
export function solveEndpointChannel(
  dataset,
  { fixedT, fixedLnP, dragT, targetLnP, anchorMode = ANCHOR_MODES.recent7y } = {}
) {
  if (!dataset || !Number.isFinite(fixedT) || !Number.isFinite(fixedLnP) || !Number.isFinite(dragT) || !Number.isFinite(targetLnP)) {
    return { slopePct: dataset?.defaultSlope ?? 10, offsetPct: 0, customAnchor: null };
  }
  if (Math.abs(dragT - fixedT) < 1e-6) {
    return { slopePct: dataset.defaultSlope, offsetPct: 0, customAnchor: null };
  }
  const bRaw = (targetLnP - fixedLnP) / (dragT - fixedT);
  const rawSlopePct = (Math.exp(bRaw) - 1) * 100;
  const slopePct = Math.max(
    dataset.minSlope,
    Math.min(dataset.maxSlope, Math.round(rawSlopePct * 10) / 10)
  );
  const bClamped = Math.log(1 + Math.max(-0.99, slopePct / 100));
  const basePivot = anchorMode === ANCHOR_MODES.fullPivot ? dataset.pivots.full : dataset.pivots.recent7y;
  const anchorMs = parseIsoDateUtc(basePivot.date);
  const anchorT = Number.isFinite(anchorMs) ? (anchorMs - dataset.baseMs) / MS_PER_YEAR : basePivot.t;
  const lnAtAnchor = fixedLnP + bClamped * (anchorT - fixedT);
  const rawPrice = Math.exp(lnAtAnchor);
  const clampedPrice = Math.max(basePivot.price * 0.2, Math.min(basePivot.price * 5.0, rawPrice));
  const anchorPrice = Number(clampedPrice.toFixed(4));
  const customAnchor = { anchorDate: basePivot.date, anchorPrice };
  const offsetPct = Math.max(-40, Math.min(60, Math.round(((anchorPrice / basePivot.price) - 1) * 1000) / 10));
  return { slopePct, offsetPct, customAnchor };
}

/**
 * Shift an absolute date-price anchor vertically by deltaLn (in log price units),
 * clamping within [0.2x, 5.0x] of the date-aligned reference price on anchorDate.
 */
export function createShiftedCustomAnchor(
  dataset,
  { baseAnchorDate, baseAnchorPrice, deltaLn, slopePct, anchorMode = ANCHOR_MODES.recent7y } = {}
) {
  if (!dataset) return { customAnchor: null, offsetPct: 0 };
  const basePivot = anchorMode === ANCHOR_MODES.fullPivot ? dataset.pivots.full : dataset.pivots.recent7y;
  const validBase = normalizeCustomAnchor({ anchorDate: baseAnchorDate, anchorPrice: baseAnchorPrice });
  const anchorDate = validBase ? validBase.anchorDate : basePivot.date;
  const startPrice = validBase ? validBase.anchorPrice : basePivot.price;
  const bSlope = Math.log(1 + Math.max(-0.99, (Number.isFinite(slopePct) ? slopePct : dataset.defaultSlope) / 100));
  const anchorMs = parseIsoDateUtc(anchorDate);
  const anchorT = Number.isFinite(anchorMs) ? (anchorMs - dataset.baseMs) / MS_PER_YEAR : basePivot.t;
  const refPriceOnAnchorDate = basePivot.price * Math.exp(bSlope * (anchorT - basePivot.t));
  const shiftedPrice = startPrice * Math.exp(Number.isFinite(deltaLn) ? deltaLn : 0);
  const clampedPrice = Math.max(refPriceOnAnchorDate * 0.2, Math.min(refPriceOnAnchorDate * 5.0, shiftedPrice));
  const anchorPrice = Number(clampedPrice.toFixed(4));
  const lnAtBase = Math.log(anchorPrice) + bSlope * (basePivot.t - anchorT);
  const equivAtBase = Math.exp(lnAtBase);
  const offsetPct = Math.max(-40, Math.min(60, Math.round(((equivAtBase / basePivot.price) - 1) * 1000) / 10));
  return {
    customAnchor: { anchorDate, anchorPrice },
    offsetPct
  };
}

export function classifyChannelKD(value) {
  if (!Number.isFinite(value)) {
    return { label: '—', valueClass: '', dotColor: '#607487' };
  }
  if (value < 20) {
    return { label: '极低 · 重仓区', valueClass: 'is-good', dotColor: '#065f46' };
  }
  if (value < 40) {
    return { label: '低位 · 加码区', valueClass: 'is-good', dotColor: '#047857' };
  }
  if (value < 80) {
    return { label: '常规区间', valueClass: '', dotColor: '#c26e2b' };
  }
  if (value < 90) {
    return { label: '偏高区间', valueClass: 'is-warn', dotColor: '#b45309' };
  }
  return { label: '高位区间', valueClass: 'is-hot', dotColor: '#b91c1c' };
}

export function buildChannelKDTiers(tierFactor = KD_DEFAULTS.tierFactor, latestWeightedK = null) {
  const { tierFactor: factor } = normalizeKDOptions({ tierFactor });
  const currentLevel = Number.isFinite(latestWeightedK) ? kdTierLevel(latestWeightedK) : -1;
  return Array.from({ length: 10 }, (_, level) => {
    const bandLow = (9 - level) * 10;
    const bandHigh = (10 - level) * 10;
    return {
      level,
      bandLow,
      bandHigh,
      rangeLabel: `${bandLow}–${bandHigh}`,
      multiple: kdMultiple(bandLow, factor),
      isCurrent: level === currentLevel,
      isBuyZone: level >= 6
    };
  });
}

export function buildChannelKDSeries(fullRows, dataset, kdOptions = KD_DEFAULTS) {
  const options = normalizeKDOptions(kdOptions);
  if (!Array.isArray(fullRows) || !fullRows.length || !dataset?.points?.length) {
    return { options, byDate: new Map(), points: [], latest: null };
  }

  const states = calculateKDSeries(fullRows, options);
  const byDate = new Map();
  const points = [];
  let prevWeek = null;
  let lastPt = null;
  let lastState = null;

  for (const pt of dataset.points) {
    const state = states.get(pt.date);
    if (!state) continue;
    byDate.set(pt.date, state);
    lastPt = pt;
    lastState = state;
    if (state.signalDate !== prevWeek) {
      points.push({ date: pt.date, t: pt.t, ...state });
      prevWeek = state.signalDate;
    }
  }
  if (lastPt && points.at(-1)?.date !== lastPt.date) {
    points.push({ date: lastPt.date, t: lastPt.t, ...lastState });
  }

  const latestState = states.get(dataset.endDate) ?? null;
  const latest = latestState
    ? {
      ...latestState,
      date: dataset.endDate,
      tierLevel: kdTierLevel(latestState.weightedK),
      multiple: kdMultiple(latestState.weightedK, options.tierFactor)
    }
    : null;

  return { options, byDate, points, latest };
}

export function getFullChannelViewBounds(dataset, showProjection = true) {
  if (!dataset) return { tMin: 0, tMax: 1 };
  const tSpan = Math.max(1, dataset.tEnd);
  const tMin = -tSpan * 0.015;
  const tMax = showProjection ? dataset.tProj + tSpan * 0.015 : dataset.tEnd + tSpan * 0.02;
  return { tMin, tMax };
}

export function constrainChannelView(view, bounds, minSpan = MIN_CHANNEL_VIEW_SPAN) {
  if (!view || !bounds) return null;
  if (!Number.isFinite(view.tMin) || !Number.isFinite(view.tMax)) return null;
  if (!Number.isFinite(bounds.tMin) || !Number.isFinite(bounds.tMax)) return null;
  const fullSpan = bounds.tMax - bounds.tMin;
  if (fullSpan <= 0) return null;
  const effMin = Math.min(minSpan, fullSpan);
  const span = Math.min(fullSpan, Math.max(effMin, view.tMax - view.tMin));
  if (span >= fullSpan * 0.998) return null;
  const tMin = Math.max(bounds.tMin, Math.min(bounds.tMax - span, view.tMin));
  return { tMin, tMax: tMin + span };
}

export function zoomChannelView(currentView, ratio, factor, bounds) {
  if (!bounds || !Number.isFinite(bounds.tMin) || !Number.isFinite(bounds.tMax)) return null;
  const fullSpan = bounds.tMax - bounds.tMin;
  if (fullSpan <= 0 || !Number.isFinite(factor) || factor <= 0) return null;
  const clampedRatio = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0.5));
  const base = currentView || bounds;
  const baseSpan = base.tMax - base.tMin;
  const anchorT = base.tMin + baseSpan * clampedRatio;
  const effMin = Math.min(MIN_CHANNEL_VIEW_SPAN, fullSpan);
  const nextSpan = Math.min(fullSpan, Math.max(effMin, baseSpan * factor));
  return constrainChannelView(
    { tMin: anchorT - nextSpan * clampedRatio, tMax: anchorT + nextSpan * (1 - clampedRatio) },
    bounds
  );
}

export function panChannelView(currentView, fraction, bounds) {
  if (!currentView || !bounds || !Number.isFinite(fraction)) return null;
  const delta = (currentView.tMax - currentView.tMin) * fraction;
  return constrainChannelView(
    { tMin: currentView.tMin + delta, tMax: currentView.tMax + delta },
    bounds
  );
}

