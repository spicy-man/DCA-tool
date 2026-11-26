import {
  MS_PER_YEAR,
  classifyChannelZ,
  createShiftedCustomAnchor,
  formatIsoDateUtc,
  getFullChannelViewBounds,
  interpolateLnPrice,
  parseIsoDateUtc,
  solveEndpointChannel
} from '../../domain/log-channel.mjs';
import { kdMultiple } from '../../domain/kd-strategy.mjs';

const FONT_STACK = '"Inter Variable", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

function setupHiDPI(canvas, cssHeight) {
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2.5);
  const parentWidth = canvas.parentElement?.clientWidth || 720;
  const cssWidth = Math.max(280, parentWidth);
  canvas.style.width = cssWidth + 'px';
  canvas.style.height = cssHeight + 'px';
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: cssWidth, height: cssHeight };
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function computeLogTicks(yMin, yMax) {
  const minVal = Math.max(0.01, yMin);
  const maxVal = Math.max(minVal * 1.1, yMax);
  const startPow = Math.floor(Math.log10(minVal)) - 1;
  const endPow = Math.ceil(Math.log10(maxVal)) + 1;
  const multipliers = [1, 1.5, 2, 3, 4, 5, 6, 8];
  const candidates = [];
  for (let p = startPow; p <= endPow; p++) {
    const scale = Math.pow(10, p);
    for (const m of multipliers) {
      const val = Number((m * scale).toPrecision(4));
      if (val >= minVal * 0.98 && val <= maxVal * 1.02) {
        candidates.push(val);
      }
    }
  }
  const minGap = (Math.log(maxVal) - Math.log(minVal)) / 7.8;
  const out = [];
  let last = -Infinity;
  for (const val of candidates) {
    const lv = Math.log(val);
    if (lv - last >= minGap) {
      out.push(val);
      last = lv;
    }
  }
  return out;
}

function computeTimeTicks(baseMs, tMin, tMax, plotW, isMobile = false) {
  const spanYears = Math.max(0.01, tMax - tMin);
  const startDate = formatIsoDateUtc(baseMs + tMin * MS_PER_YEAR);
  const endDate = formatIsoDateUtc(baseMs + tMax * MS_PER_YEAR);
  const minGapPx = isMobile ? 48 : 58;
  const raw = [];

  if (spanYears > 4) {
    const startYear = Number(startDate.slice(0, 4));
    const lastYear = Number(endDate.slice(0, 4));
    const step = spanYears > 24 ? 4 : (spanYears > 14 ? 2 : 1);
    for (let y = startYear; y <= lastYear; y++) {
      if (y === startYear || (y - startYear) % step === 0) {
        const t = (parseIsoDateUtc(`${y}-01-01`) - baseMs) / MS_PER_YEAR;
        if (t >= tMin && t <= tMax) raw.push({ t, label: String(y) });
      }
    }
  } else if (spanYears > 0.35) {
    const monthStep = spanYears > 1.8 ? 6 : (spanYears > 0.9 ? 3 : (spanYears > 0.5 ? 2 : 1));
    let y = Number(startDate.slice(0, 4));
    let m = Number(startDate.slice(5, 7));
    const endY = Number(endDate.slice(0, 4));
    const endM = Number(endDate.slice(5, 7));
    while (y < endY || (y === endY && m <= endM)) {
      if ((m - 1) % monthStep === 0) {
        const iso = `${y}-${String(m).padStart(2, '0')}-01`;
        const t = (parseIsoDateUtc(iso) - baseMs) / MS_PER_YEAR;
        if (t >= tMin && t <= tMax) {
          raw.push({ t, label: m === 1 ? String(y) : `${y}-${String(m).padStart(2, '0')}` });
        }
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  } else {
    const stepDays = spanYears > 0.18 ? 14 : 7;
    const stepYears = stepDays / 365.25;
    const firstDay = Math.ceil(tMin / stepYears) * stepYears;
    let prevYear = '';
    for (let t = firstDay; t <= tMax + 1e-6; t += stepYears) {
      if (t < tMin) continue;
      const iso = formatIsoDateUtc(baseMs + t * MS_PER_YEAR);
      const yr = iso.slice(0, 4);
      const label = !prevYear || yr !== prevYear ? iso : iso.slice(5);
      prevYear = yr;
      raw.push({ t, label });
    }
  }

  const ticks = [];
  let lastX = -Infinity;
  for (const tick of raw) {
    const px = ((tick.t - tMin) / spanYears) * plotW;
    if (px - lastX >= minGapPx) {
      ticks.push(tick);
      lastX = px;
    }
  }
  return ticks;
}

function findVisiblePointSlice(points, tMin, tMax) {
  if (!points?.length) return { startIdx: 0, endIdx: -1 };
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t < tMin) lo = mid + 1;
    else hi = mid;
  }
  const startIdx = Math.max(0, lo - 1);

  lo = startIdx;
  hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (points[mid].t > tMax) hi = mid - 1;
    else lo = mid;
  }
  const endIdx = Math.min(points.length - 1, lo + 1);
  return { startIdx, endIdx };
}

function formatAxisPrice(val) {
  if (val >= 1000) return String(Math.round(val));
  if (val >= 10) return Number.isInteger(val) ? String(val) : val.toFixed(1);
  return val.toFixed(2).replace(/\.?0+$/, '');
}

export function createChannelGeom(model, { width, isMobile, showProjection, viewRange = null }) {
  const padLeft = isMobile ? 40 : 46;
  const padRight = isMobile ? 52 : 70;
  const plotW = Math.max(140, width - padLeft - padRight);
  const fullBounds = getFullChannelViewBounds(model.dataset, showProjection);
  const isZoomed = Boolean(viewRange && Number.isFinite(viewRange.tMin) && Number.isFinite(viewRange.tMax));
  const tMin = isZoomed ? viewRange.tMin : fullBounds.tMin;
  const tMax = isZoomed ? viewRange.tMax : fullBounds.tMax;
  return { padLeft, padRight, plotW, tMin, tMax, fullBounds, isZoomed };
}

export function drawLogChannelUpper(
  canvas,
  model,
  {
    showOrigLine = false,
    showPivot = false,
    showProjection = true,
    viewRange = null,
    hoverT = null,
    lockedYBounds = null,
    activeHandle = null,
    pinnedHandle = null
  } = {}
) {
  const isMobile = (globalThis.innerWidth || 1024) < 640;
  const cssH = isMobile ? 310 : 440;
  const { ctx, width, height } = setupHiDPI(canvas, cssH);
  const geom = createChannelGeom(model, { width, isMobile, showProjection, viewRange });
  const { padLeft, plotW, tMin, tMax } = geom;

  const padTop = 20;
  const padBottom = 30;
  const plotH = height - padTop - padBottom;

  const ds = model.dataset;
  const pts = ds.points;
  const tEnd = ds.tEnd;
  const tLineEnd = showProjection ? ds.tProj : tEnd;
  const sigma = model.sigmaUsed;
  const { startIdx, endIdx } = findVisiblePointSlice(pts, tMin, tMax);

  let lnYMin;
  let lnYMax;
  if (lockedYBounds && Number.isFinite(lockedYBounds.lnYMin) && Number.isFinite(lockedYBounds.lnYMax)) {
    lnYMin = lockedYBounds.lnYMin;
    lnYMax = lockedYBounds.lnYMax;
  } else {
    lnYMin = Infinity;
    lnYMax = -Infinity;
    for (let i = startIdx; i <= endIdx; i++) {
      const v = pts[i].lnP;
      if (v < lnYMin) lnYMin = v;
      if (v > lnYMax) lnYMax = v;
    }

    const tProbeL = Math.max(0, Math.min(tLineEnd, tMin));
    const tProbeR = Math.max(tProbeL, Math.min(tLineEnd, tMax));
    const probes = [
      model.lnFit(tProbeL) - 2 * sigma,
      model.lnFit(tProbeL) + 2 * sigma,
      model.lnFit(tProbeR) - 2 * sigma,
      model.lnFit(tProbeR) + 2 * sigma
    ];
    if (showOrigLine) {
      probes.push(model.origLnFit(tProbeL), model.origLnFit(tProbeR));
    }
    for (const v of probes) {
      if (v < lnYMin) lnYMin = v;
      if (v > lnYMax) lnYMax = v;
    }
    const span = Math.max(0.1, lnYMax - lnYMin);
    lnYMin -= span * 0.06;
    lnYMax += span * 0.07;
  }

  const xOf = t => padLeft + ((t - tMin) / (tMax - tMin)) * plotW;
  const yOfLn = lnV => padTop + ((lnYMax - lnV) / (lnYMax - lnYMin)) * plotH;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotW, plotH);
  ctx.clip();

  if (showProjection) {
    const xTodayBg = xOf(tEnd);
    const bgLeft = Math.max(padLeft, xTodayBg);
    const bgRight = padLeft + plotW;
    if (bgRight > bgLeft) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(bgLeft, padTop, bgRight - bgLeft, plotH);
    }
  }

  const yTicks = computeLogTicks(Math.exp(lnYMin), Math.exp(lnYMax));
  ctx.strokeStyle = '#eef2f6';
  ctx.lineWidth = 1;
  for (const val of yTicks) {
    const y = Math.round(yOfLn(Math.log(val))) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
  }

  const timeTicks = computeTimeTicks(ds.baseMs, tMin, tMax, plotW, isMobile);
  for (const tick of timeTicks) {
    const x = Math.round(xOf(tick.t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(104, 127, 142, 0.04)';
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOfLn(model.lnFit(0) + 2 * sigma));
  ctx.lineTo(xOf(tLineEnd), yOfLn(model.lnFit(tLineEnd) + 2 * sigma));
  ctx.lineTo(xOf(tLineEnd), yOfLn(model.lnFit(tLineEnd) - 2 * sigma));
  ctx.lineTo(xOf(0), yOfLn(model.lnFit(0) - 2 * sigma));
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(104, 127, 142, 0.055)';
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOfLn(model.lnFit(0) + sigma));
  ctx.lineTo(xOf(tLineEnd), yOfLn(model.lnFit(tLineEnd) + sigma));
  ctx.lineTo(xOf(tLineEnd), yOfLn(model.lnFit(tLineEnd) - sigma));
  ctx.lineTo(xOf(0), yOfLn(model.lnFit(0) - sigma));
  ctx.closePath();
  ctx.fill();

  const tZoneStart = Math.max(0, tEnd - 2.0);
  ctx.fillStyle = 'rgba(77, 139, 120, 0.10)';
  ctx.beginPath();
  ctx.moveTo(xOf(tZoneStart), yOfLn(model.lnFit(tZoneStart) - sigma));
  ctx.lineTo(xOf(tLineEnd), yOfLn(model.lnFit(tLineEnd) - sigma));
  ctx.lineTo(xOf(tLineEnd), yOfLn(model.lnFit(tLineEnd) - 2 * sigma));
  ctx.lineTo(xOf(tZoneStart), yOfLn(model.lnFit(tZoneStart) - 2 * sigma));
  ctx.closePath();
  ctx.fill();

  if (showOrigLine) {
    ctx.save();
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOfLn(model.origLnFit(0)));
    ctx.lineTo(xOf(tLineEnd), yOfLn(model.origLnFit(tLineEnd)));
    ctx.stroke();
    ctx.restore();
  }

  function drawBand(kSigma, color, lw, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOfLn(model.lnFit(0) + kSigma * sigma));
    ctx.lineTo(xOf(tLineEnd), yOfLn(model.lnFit(tLineEnd) + kSigma * sigma));
    ctx.stroke();
    ctx.restore();
  }

  drawBand(2, '#c47a6d', 1.25, [5, 4]);
  drawBand(-2, '#4d8b78', 1.25, [5, 4]);
  drawBand(1, '#a0b2be', 1.15, [4, 4]);
  drawBand(-1, '#a0b2be', 1.15, [4, 4]);
  if (activeHandle === 'centerline') {
    drawBand(0, '#19374a', 2.8, null);
  } else {
    drawBand(0, '#334e5e', 2.2, null);
  }

  const xToday = xOf(tEnd);
  ctx.save();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xToday, padTop);
  ctx.lineTo(xToday, padTop + plotH);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.font = `600 10px ${FONT_STACK}`;
  const tw = ctx.measureText(ds.endDate).width;
  const bx = Math.max(padLeft + 4, Math.min(padLeft + plotW - tw - 12, xToday - tw / 2 - 4));
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fillRect(bx, padTop + 4, tw + 8, 16);
  ctx.fillStyle = '#475569';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(ds.endDate, bx + 4, padTop + 12);
  ctx.restore();

  // Sample daily series efficiently over the visible slice
  const visibleCount = Math.max(0, endIdx - startIdx + 1);
  if (visibleCount > 0) {
    ctx.save();
    ctx.strokeStyle = '#19374a';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const stride = visibleCount > plotW * 2 ? Math.floor(visibleCount / (plotW * 1.8)) : 1;
    for (let i = startIdx; i <= endIdx; i += stride) {
      const x = xOf(pts[i].t);
      const y = yOfLn(pts[i].lnP);
      if (i === startIdx) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if ((endIdx - startIdx) % stride !== 0) {
      const lastPt = pts[endIdx];
      ctx.lineTo(xOf(lastPt.t), yOfLn(lastPt.lnP));
    }
    ctx.stroke();
    ctx.restore();
  }

  if (showPivot) {
    const px = xOf(model.pivot.t);
    const py = yOfLn(model.pivot.lnP);
    ctx.save();
    ctx.fillStyle = 'rgba(234, 88, 12, 0.2)';
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#fff7ed';
    ctx.beginPath();
    ctx.arc(px, py, 5.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ea580c';
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.fillStyle = '#ea580c';
    ctx.beginPath();
    ctx.arc(px, py, 2.1, 0, Math.PI * 2);
    ctx.fill();

    const lbl = `基准点 (${model.pivot.date.slice(0, 7)}, $${model.pivot.price.toFixed(2)})`;
    ctx.font = `600 10.5px ${FONT_STACK}`;
    const pw = ctx.measureText(lbl).width + 12;
    const ph = 20;
    const lx = Math.max(padLeft + 6, Math.min(padLeft + plotW - pw - 6, px - pw / 2));
    let ly = py + 15;
    if (ly + ph > padTop + plotH - 6) ly = py - ph - 15;

    ctx.strokeStyle = 'rgba(234, 88, 12, 0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py + (ly > py ? 6 : -6));
    ctx.lineTo(px, ly > py ? ly : ly + ph);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 247, 237, 0.96)';
    ctx.strokeStyle = '#fb923c';
    ctx.lineWidth = 1;
    drawRoundRect(ctx, lx, ly, pw, ph, 5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#9a3412';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(lbl, lx + 6, ly + ph / 2);
    ctx.restore();
  }

  const lastX = xOf(tEnd);
  const lastY = yOfLn(Math.log(model.latestPrice));
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(lastX, lastY, 4.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#19374a';
  ctx.lineWidth = 2.1;
  ctx.stroke();

  ctx.save();
  const curTxt = '$' + model.latestPrice.toFixed(2);
  ctx.font = `700 10.5px ${FONT_STACK}`;
  const cw = ctx.measureText(curTxt).width + 10;
  const ch = 18;
  let cx = showProjection ? lastX + 7 : lastX - cw - 7;
  if (cx + cw > padLeft + plotW - 3) cx = lastX - cw - 7;
  const cy = Math.max(padTop + 4, Math.min(padTop + plotH - ch - 4, lastY - ch / 2));
  ctx.fillStyle = 'rgba(25, 55, 74, 0.92)';
  drawRoundRect(ctx, cx, cy, cw, ch, 4);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(curTxt, cx + 5, cy + ch / 2);
  ctx.restore();

  if (hoverT !== null && hoverT >= tMin && hoverT <= tMax) {
    const hx = xOf(hoverT);
    ctx.save();
    ctx.strokeStyle = 'rgba(25, 55, 74, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();

    ctx.fillStyle = '#334e5e';
    ctx.beginPath();
    ctx.arc(hx, yOfLn(model.lnFit(hoverT)), 3.2, 0, Math.PI * 2);
    ctx.fill();

    if (hoverT >= 0 && hoverT <= tEnd) {
      const hy = yOfLn(interpolateLnPrice(pts, hoverT));
      ctx.fillStyle = '#19374a';
      ctx.beginPath();
      ctx.arc(hx, hy, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(padLeft + 0.5, padTop + 0.5, plotW, plotH);

  ctx.fillStyle = '#475569';
  ctx.font = `11px ${FONT_STACK}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const val of yTicks) {
    const y = yOfLn(Math.log(val));
    if (y >= padTop + 4 && y <= padTop + plotH - 4) {
      ctx.fillText(formatAxisPrice(val), padLeft - 7, y);
      ctx.strokeStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(padLeft - 3, y);
      ctx.lineTo(padLeft, y);
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#475569';
  ctx.font = `11px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of timeTicks) {
    const x = xOf(tick.t);
    ctx.fillText(tick.label, x, padTop + plotH + 7);
    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(x, padTop + plotH);
    ctx.lineTo(x, padTop + plotH + 4);
    ctx.stroke();
  }

  const tLabelRight = Math.max(0, Math.min(tLineEnd, tMax));
  const rightLabels = [
    { off: 2, text: '+2σ', color: '#b3675a' },
    { off: 1, text: '+1σ', color: '#7e93a2' },
    { off: 0, text: '中枢', color: '#334e5e' },
    { off: -1, text: '−1σ', color: '#7e93a2' },
    { off: -2, text: '−2σ', color: '#3f7a68' }
  ];
  ctx.font = `600 10.5px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let prevY = -Infinity;
  for (const item of rightLabels) {
    let y = yOfLn(model.lnFit(tLabelRight) + item.off * sigma);
    if (y < prevY + 13) y = prevY + 13;
    if (y >= padTop + 4 && y <= padTop + plotH - 4) {
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, padLeft + plotW + 6, y);
      prevY = y;
    }
  }

  const tHandleLeft = Math.max(0, tMin);
  const tHandleRight = Math.min(tLineEnd, tMax);
  const makeHandle = t => {
    const lnP = model.lnFit(t);
    const y = yOfLn(lnP);
    return {
      x: xOf(t),
      y,
      t,
      lnP,
      visible: y >= padTop - 10 && y <= padTop + plotH + 10
    };
  };
  const handles = tHandleRight > tHandleLeft + 0.02
    ? { left: makeHandle(tHandleLeft), right: makeHandle(tHandleRight) }
    : { left: null, right: null };

  for (const side of ['left', 'right']) {
    const h = handles[side];
    if (!h || !h.visible) continue;
    const isActive = activeHandle === side;
    const isPinned = pinnedHandle === side;
    ctx.save();
    if (isActive) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(25, 55, 74, 0.16)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(h.x, h.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#19374a';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (isPinned) {
      ctx.beginPath();
      ctx.arc(h.x, h.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff7ed';
      ctx.fill();
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      ctx.globalAlpha = 0.78;
      ctx.beginPath();
      ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.restore();
  }

  return { ...geom, padTop, plotH, lnYMin, lnYMax, tLineEnd, handles };
}

export function hitTestChannelHandle(canvas, geom, clientX, clientY, model = null) {
  if (!canvas || !geom || !geom.handles) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const hitRadius = 16;
  for (const side of ['left', 'right']) {
    const h = geom.handles[side];
    if (!h || h.visible === false) continue;
    if (Math.hypot(x - h.x, y - h.y) <= hitRadius) return side;
  }
  if (
    x >= geom.padLeft &&
    x <= geom.padLeft + geom.plotW &&
    y >= geom.padTop &&
    y <= geom.padTop + geom.plotH
  ) {
    if (model && Number.isFinite(geom.lnYMin) && Number.isFinite(geom.lnYMax) && geom.lnYMax > geom.lnYMin) {
      const tAtX = geom.tMin + ((x - geom.padLeft) / geom.plotW) * (geom.tMax - geom.tMin);
      const maxChannelT = Number.isFinite(geom.tLineEnd) ? geom.tLineEnd : (geom.handles?.right?.t ?? Infinity);
      if (tAtX >= 0 && tAtX <= maxChannelT) {
        const centerY = geom.padTop + ((geom.lnYMax - model.lnFit(tAtX)) / (geom.lnYMax - geom.lnYMin)) * geom.plotH;
        if (Math.abs(y - centerY) <= 12) return 'centerline';
      }
    }
    return 'body';
  }
  return null;
}

export function computeEndpointRotate(
  canvas,
  geom,
  model,
  { fixedT, fixedLnP, dragT },
  clientY,
  anchorMode
) {
  if (!canvas || !geom || !geom.plotH || !model?.dataset) {
    return {
      slopePct: model?.slopePct ?? 10,
      offsetPct: model?.offsetPct ?? 0,
      customAnchor: model?.customAnchor ?? null
    };
  }
  const rect = canvas.getBoundingClientRect();
  const y = clientY - rect.top;
  const targetLnP = geom.lnYMax - ((y - geom.padTop) / geom.plotH) * (geom.lnYMax - geom.lnYMin);
  return solveEndpointChannel(model.dataset, {
    fixedT,
    fixedLnP,
    dragT,
    targetLnP,
    anchorMode
  });
}

export function computeBodyDragAnchor(
  geom,
  startClientY,
  currentClientY,
  model,
  { startAnchorDate, startAnchorPrice, anchorMode } = {}
) {
  if (!geom || !geom.plotH || !Number.isFinite(geom.lnYMax) || !Number.isFinite(geom.lnYMin) || !model?.dataset) {
    return {
      customAnchor: model?.customAnchor || null,
      offsetPct: model?.offsetPct ?? 0
    };
  }
  const deltaLn = -((currentClientY - startClientY) / geom.plotH) * (geom.lnYMax - geom.lnYMin);
  return createShiftedCustomAnchor(model.dataset, {
    baseAnchorDate: startAnchorDate,
    baseAnchorPrice: startAnchorPrice,
    deltaLn,
    slopePct: model.slopePct,
    anchorMode
  });
}

export function computeDragOffsetPct(geom, startClientY, currentClientY, startOffsetPct) {
  if (!geom || !geom.plotH || !Number.isFinite(geom.lnYMax) || !Number.isFinite(geom.lnYMin)) {
    return startOffsetPct;
  }
  const deltaLn = -((currentClientY - startClientY) / geom.plotH) * (geom.lnYMax - geom.lnYMin);
  const baseLn = Math.log(1 + (Number.isFinite(startOffsetPct) ? startOffsetPct : 0) / 100);
  const rawPct = (Math.exp(baseLn + deltaLn) - 1) * 100;
  return Math.max(-40, Math.min(60, Math.round(rawPct * 2) / 2));
}

export function drawLogChannelLower(
  canvas,
  model,
  { showProjection = true, viewRange = null, hoverT = null, geom = null } = {}
) {
  const isMobile = (globalThis.innerWidth || 1024) < 640;
  const cssH = isMobile ? 160 : 185;
  const { ctx, width, height } = setupHiDPI(canvas, cssH);
  const effectiveGeom = geom || createChannelGeom(model, { width, isMobile, showProjection, viewRange });
  const { padLeft, plotW, tMin, tMax } = effectiveGeom;

  const padTop = 12;
  const padBottom = 28;
  const plotH = height - padTop - padBottom;

  const ds = model.dataset;
  const pts = ds.points;
  const res = model.residuals;
  const sigma = model.sigmaUsed;
  const hasSigma = Number.isFinite(sigma) && sigma > 0;
  const toZ = r => (hasSigma ? r / sigma : 0);
  const zSeries = res.map(toZ);
  const tEnd = ds.tEnd;
  const { startIdx, endIdx } = findVisiblePointSlice(pts, tMin, tMax);

  let minZ = -2.35;
  let maxZ = 2.35;
  for (let i = startIdx; i <= endIdx; i++) {
    if (zSeries[i] < minZ) minZ = zSeries[i];
    if (zSeries[i] > maxZ) maxZ = zSeries[i];
  }
  const padZ = (maxZ - minZ) * 0.12;
  minZ -= padZ;
  maxZ += padZ;

  const xOf = t => padLeft + ((t - tMin) / (tMax - tMin)) * plotW;
  const yOf = z => padTop + ((maxZ - z) / (maxZ - minZ)) * plotH;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotW, plotH);
  ctx.clip();

  if (showProjection) {
    const xTodayBg = xOf(tEnd);
    const bgLeft = Math.max(padLeft, xTodayBg);
    const bgRight = padLeft + plotW;
    if (bgRight > bgLeft) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(bgLeft, padTop, bgRight - bgLeft, plotH);
    }
  }

  const spanZ = maxZ - minZ;
  const step = spanZ > 8 ? 2 : (spanZ > 4.5 ? 1 : 0.5);
  const zTicks = [];
  ctx.strokeStyle = '#eef2f6';
  ctx.lineWidth = 1;
  for (let v = Math.ceil(minZ / step) * step; v <= maxZ + 1e-6; v += step) {
    const rounded = Math.round(v * 10) / 10;
    const val = Math.abs(rounded) < 1e-9 ? 0 : rounded;
    zTicks.push(val);
    const y = Math.round(yOf(val)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
  }

  const timeTicks = computeTimeTicks(ds.baseMs, tMin, tMax, plotW, isMobile);
  for (const tick of timeTicks) {
    const x = Math.round(xOf(tick.t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }

  const visibleCount = Math.max(0, endIdx - startIdx + 1);
  const stride = visibleCount > plotW * 2 ? Math.floor(visibleCount / (plotW * 1.8)) : 1;

  function fillResidualSide(thresholdZ, isAbove, color) {
    if (visibleCount <= 0) return;
    ctx.save();
    ctx.beginPath();
    if (isAbove) {
      ctx.rect(padLeft, padTop, plotW, Math.max(0, yOf(thresholdZ) - padTop));
    } else {
      ctx.rect(padLeft, yOf(thresholdZ), plotW, Math.max(0, padTop + plotH - yOf(thresholdZ)));
    }
    ctx.clip();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(xOf(pts[startIdx].t), yOf(thresholdZ));
    for (let i = startIdx; i <= endIdx; i += stride) {
      ctx.lineTo(xOf(pts[i].t), yOf(zSeries[i]));
    }
    if ((endIdx - startIdx) % stride !== 0) {
      ctx.lineTo(xOf(pts[endIdx].t), yOf(zSeries[endIdx]));
    }
    ctx.lineTo(xOf(pts[endIdx].t), yOf(thresholdZ));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  fillResidualSide(0, true, 'rgba(196, 122, 109, 0.10)');
  fillResidualSide(0, false, 'rgba(77, 139, 120, 0.10)');
  fillResidualSide(1, true, 'rgba(196, 122, 109, 0.14)');
  fillResidualSide(-1, false, 'rgba(77, 139, 120, 0.15)');

  function drawHLine(zVal, color, lw, dash) {
    const y = yOf(zVal);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.restore();
  }

  drawHLine(2, '#c47a6d', 1.15, [5, 4]);
  drawHLine(-2, '#4d8b78', 1.15, [5, 4]);
  drawHLine(1, '#a0b2be', 1.0, [4, 4]);
  drawHLine(-1, '#a0b2be', 1.0, [4, 4]);
  drawHLine(0, '#334e5e', 1.2, null);

  const xToday = xOf(tEnd);
  ctx.save();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xToday, padTop);
  ctx.lineTo(xToday, padTop + plotH);
  ctx.stroke();
  ctx.restore();

  if (visibleCount > 0) {
    ctx.save();
    ctx.strokeStyle = '#19374a';
    ctx.lineWidth = 1.45;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = startIdx; i <= endIdx; i += stride) {
      const x = xOf(pts[i].t);
      const y = yOf(zSeries[i]);
      if (i === startIdx) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    if ((endIdx - startIdx) % stride !== 0) {
      ctx.lineTo(xOf(pts[endIdx].t), yOf(zSeries[endIdx]));
    }
    ctx.stroke();
    ctx.restore();
  }

  const lx = xOf(tEnd);
  const ly = yOf(hasSigma ? model.zEnd : 0);
  ctx.fillStyle = '#19374a';
  ctx.beginPath();
  ctx.arc(lx, ly, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (hoverT !== null && hoverT >= tMin && hoverT <= tMax) {
    const hx = xOf(hoverT);
    ctx.save();
    ctx.strokeStyle = 'rgba(25, 55, 74, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();

    if (hoverT >= 0 && hoverT <= tEnd) {
      const hr = interpolateLnPrice(pts, hoverT) - model.lnFit(hoverT);
      ctx.fillStyle = '#19374a';
      ctx.beginPath();
      ctx.arc(hx, yOf(toZ(hr)), 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.restore();
  }

  ctx.restore();

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(padLeft + 0.5, padTop + 0.5, plotW, plotH);

  ctx.fillStyle = '#475569';
  ctx.font = `11px ${FONT_STACK}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const val of zTicks) {
    const y = yOf(val);
    if (y >= padTop + 4 && y <= padTop + plotH - 4) {
      let lbl = '0';
      if (val !== 0) {
        const sign = val > 0 ? '+' : '−';
        const mag = Math.abs(val);
        lbl = `${sign}${Number.isInteger(mag) ? String(mag) : mag.toFixed(1)}σ`;
      }
      ctx.fillText(lbl, padLeft - 7, y);
    }
  }

  function formatBandPct(k) {
    if (!hasSigma || k === 0) return '0%';
    const pct = (Math.exp(k * sigma) - 1) * 100;
    const rounded = Math.round(pct);
    if (rounded === 0) {
      return `${pct >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%`;
    }
    return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`;
  }

  ctx.font = `600 10px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let prevY = -Infinity;
  for (const lbl of [
    { k: 2, text: formatBandPct(2), color: '#b3675a' },
    { k: 1, text: formatBandPct(1), color: '#7e93a2' },
    { k: 0, text: '0%', color: '#334e5e' },
    { k: -1, text: formatBandPct(-1), color: '#7e93a2' },
    { k: -2, text: formatBandPct(-2), color: '#3f7a68' }
  ]) {
    let y = yOf(lbl.k);
    if (y < prevY + 11) y = prevY + 11;
    if (y >= padTop + 4 && y <= padTop + plotH - 4) {
      ctx.fillStyle = lbl.color;
      ctx.fillText(lbl.text, padLeft + plotW + 6, y);
      prevY = y;
    }
  }

  ctx.fillStyle = '#475569';
  ctx.font = `11px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of timeTicks) {
    ctx.fillText(tick.label, xOf(tick.t), padTop + plotH + 7);
  }
}

export function drawValuationThermometer(canvas, models) {
  const isMobile = (globalThis.innerWidth || 1024) < 640;
  const rowH = isMobile ? 54 : 52;
  const padTop = 36;
  const padBottom = 26;
  const cssH = padTop + models.length * rowH + padBottom;
  const { ctx, width, height } = setupHiDPI(canvas, cssH);

  const padLeft = isMobile ? 86 : 124;
  const padRight = isMobile ? 14 : 24;
  const plotW = Math.max(140, width - padLeft - padRight);
  const zMin = -2.5;
  const zMax = 2.5;
  const xOfZ = z => {
    const clamped = Math.max(zMin, Math.min(zMax, z));
    return padLeft + ((clamped - zMin) / (zMax - zMin)) * plotW;
  };

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  const zones = [
    { from: -2.5, to: -1.5, fill: 'rgba(5, 150, 105, 0.16)', label: '黄金坑' },
    { from: -1.5, to: -0.75, fill: 'rgba(16, 185, 129, 0.09)', label: '击球区' },
    { from: -0.75, to: 0.5, fill: 'rgba(241, 245, 249, 0.65)', label: '合理中枢' },
    { from: 0.5, to: 1.25, fill: 'rgba(245, 158, 11, 0.11)', label: '偏贵区' },
    { from: 1.25, to: 2.5, fill: 'rgba(220, 38, 38, 0.13)', label: '过热区' }
  ];

  const plotTop = padTop;
  const plotH = models.length * rowH;

  for (const zone of zones) {
    const x0 = xOfZ(zone.from);
    const x1 = xOfZ(zone.to);
    ctx.fillStyle = zone.fill;
    ctx.fillRect(x0, plotTop, x1 - x0, plotH);

    if (!isMobile || x1 - x0 > 40) {
      ctx.fillStyle = '#607487';
      ctx.font = `600 10.5px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(zone.label, (x0 + x1) / 2, plotTop - 16);
    }
  }

  const ticks = [-2.5, -2.0, -1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5, 2.0, 2.5];
  for (const tv of ticks) {
    const x = Math.round(xOfZ(tv)) + 0.5;
    const isZero = tv === 0;
    const isMajor = Number.isInteger(tv);
    ctx.save();
    ctx.strokeStyle = isZero ? '#334155' : (isMajor ? 'rgba(100,116,139,0.35)' : 'rgba(148,163,184,0.22)');
    ctx.lineWidth = isZero ? 1.5 : 1;
    if (!isZero) ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + plotH);
    ctx.stroke();
    ctx.restore();

    if (!isMobile || isMajor || Math.abs(tv) === 2.5) {
      ctx.fillStyle = isZero ? '#19374a' : '#607487';
      ctx.font = `${isZero ? '700' : '600'} 10.5px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(tv === 0 ? '0σ' : `${tv > 0 ? '+' : ''}${tv.toFixed(1)}σ`, x, plotTop - 3);
    }
  }

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(padLeft + 0.5, plotTop + 0.5, plotW, plotH);

  models.forEach((m, idx) => {
    const cy = plotTop + idx * rowH + rowH / 2;
    const st = classifyChannelZ(m.zEnd);

    if (idx > 0) {
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padLeft, plotTop + idx * rowH + 0.5);
      ctx.lineTo(padLeft + plotW, plotTop + idx * rowH + 0.5);
      ctx.stroke();
    }

    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#19374a';
    ctx.font = `700 13px ${FONT_STACK}`;
    ctx.fillText(m.symbol, padLeft - 12, cy - 8);

    ctx.fillStyle = '#607487';
    ctx.font = `500 10.5px ${FONT_STACK}`;
    ctx.fillText(`$${m.latestPrice.toFixed(2)} · ${m.slopePct.toFixed(1)}%`, padLeft - 12, cy + 9);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padLeft + 6, cy);
    ctx.lineTo(padLeft + plotW - 6, cy);
    ctx.stroke();

    const xNew = xOfZ(m.zEnd);

    ctx.save();
    ctx.fillStyle = st.dotColor;
    ctx.beginPath();
    ctx.arc(xNew, cy, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    const zSign = m.zEnd >= 0 ? '+' : '';
    const pillTxt = `${zSign}${m.zEnd.toFixed(2)}σ`;
    ctx.font = `700 10.5px ${FONT_STACK}`;
    const pw = ctx.measureText(pillTxt).width + 10;
    const ph = 18;
    let lx = xNew + 11;
    if (lx + pw > padLeft + plotW - 4) lx = xNew - pw - 11;
    if (lx < padLeft + 4) lx = xNew + 11;
    const ly = cy - ph / 2;

    ctx.fillStyle = st.dotColor;
    drawRoundRect(ctx, lx, ly, pw, ph, 9);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pillTxt, lx + pw / 2, cy);
    ctx.restore();
  });

  const outOfRange = models.filter(m => Math.abs(m.zEnd) > 2.5);
  ctx.fillStyle = '#607487';
  ctx.font = `500 10.5px ${FONT_STACK}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  const footTxt = outOfRange.length > 0
    ? '注：超出 ±2.5σ 范围的点位在边界处显示并标注实际数值'
    : '横轴范围：−2.5σ（极端黄金坑）← 0σ 合理中枢 → +2.5σ（极端过热）';
  ctx.fillText(footTxt, padLeft + plotW, plotTop + plotH + 7);
}

export function resolveChannelHover(canvas, geom, model, clientX, showProjection) {
  if (!canvas || !geom || !model) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const { padLeft, plotW, tMin, tMax } = geom;
  if (x < padLeft || x > padLeft + plotW) return null;

  const rawT = tMin + ((x - padLeft) / plotW) * (tMax - tMin);
  const ds = model.dataset;
  const maxT = showProjection ? ds.tProj : ds.tEnd;
  const clampedT = Math.max(0, Math.min(maxT, rawT));

  let targetT = clampedT;
  let snappedPoint = null;
  if (clampedT <= ds.tEnd + 0.015) {
    const pts = ds.points;
    let lo = 0;
    let hi = pts.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= clampedT) lo = mid;
      else hi = mid;
    }
    snappedPoint = Math.abs(pts[lo].t - clampedT) <= Math.abs(pts[hi].t - clampedT) ? pts[lo] : pts[hi];
    targetT = snappedPoint.t;
  }

  const isProjection = targetT > ds.tEnd + 1e-4;
  const dateStr = snappedPoint ? snappedPoint.date : formatIsoDateUtc(ds.baseMs + targetT * MS_PER_YEAR);
  return { targetT, snappedPoint, isProjection, dateStr };
}

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

function findNearestKDPoint(points, targetT) {
  if (!points?.length) return null;
  if (targetT <= points[0].t) return points[0];
  if (targetT >= points[points.length - 1].t) return points[points.length - 1];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].t <= targetT) lo = mid;
    else hi = mid;
  }
  return Math.abs(points[lo].t - targetT) <= Math.abs(points[hi].t - targetT) ? points[lo] : points[hi];
}

export function drawLogChannelKD(
  canvas,
  model,
  kdData,
  { showProjection = true, viewRange = null, hoverT = null, hoverDate = null, geom = null, tierFactor = 1.5 } = {}
) {
  const isMobile = (globalThis.innerWidth || 1024) < 640;
  const cssH = isMobile ? 160 : 185;
  const { ctx, width, height } = setupHiDPI(canvas, cssH);
  const effectiveGeom = geom || createChannelGeom(model, { width, isMobile, showProjection, viewRange });
  const { padLeft, plotW, tMin, tMax } = effectiveGeom;

  const padTop = 12;
  const padBottom = 28;
  const plotH = height - padTop - padBottom;

  const ds = model.dataset;
  const tEnd = ds.tEnd;
  const xOf = t => padLeft + ((t - tMin) / (tMax - tMin)) * plotW;
  const yOf = k => padTop + ((100 - k) / 100) * plotH;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotW, plotH);
  ctx.clip();

  if (showProjection) {
    const xTodayBg = xOf(tEnd);
    const bgLeft = Math.max(padLeft, xTodayBg);
    const bgRight = padLeft + plotW;
    if (bgRight > bgLeft) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(bgLeft, padTop, bgRight - bgLeft, plotH);
    }
  }

  // Low-K buy zones
  ctx.fillStyle = 'rgba(77, 139, 120, 0.08)';
  ctx.fillRect(padLeft, yOf(30), plotW, yOf(0) - yOf(30));
  ctx.fillStyle = 'rgba(77, 139, 120, 0.09)';
  ctx.fillRect(padLeft, yOf(20), plotW, yOf(0) - yOf(20));

  ctx.strokeStyle = '#eef2f6';
  ctx.lineWidth = 1;
  for (const tick of [0, 20, 40, 60, 80, 100]) {
    const y = Math.round(yOf(tick)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
  }

  const timeTicks = computeTimeTicks(ds.baseMs, tMin, tMax, plotW, isMobile);
  for (const tick of timeTicks) {
    const x = Math.round(xOf(tick.t)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, padTop);
    ctx.lineTo(x, padTop + plotH);
    ctx.stroke();
  }

  function drawRefLine(val, color, lw, dash) {
    const y = yOf(val);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(padLeft, y);
    ctx.lineTo(padLeft + plotW, y);
    ctx.stroke();
    ctx.restore();
  }

  drawRefLine(80, '#c47a6d', 1.1, [4, 4]);
  drawRefLine(50, '#cbd5e1', 1.0, [3, 3]);
  drawRefLine(20, '#4d8b78', 1.15, [4, 4]);

  const xToday = xOf(tEnd);
  ctx.save();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xToday, padTop);
  ctx.lineTo(xToday, padTop + plotH);
  ctx.stroke();
  ctx.restore();

  const kdPts = kdData?.points || [];
  const { startIdx: kdStartIdx, endIdx: kdEndIdx } = findVisiblePointSlice(kdPts, tMin, tMax);
  const visibleKdPts = kdEndIdx >= kdStartIdx ? kdPts.slice(kdStartIdx, kdEndIdx + 1) : [];
  if (visibleKdPts.length) {
    const xs = new Float64Array(visibleKdPts.length);
    for (let i = 0; i < visibleKdPts.length; i++) {
      xs[i] = xOf(visibleKdPts[i].t);
    }

    const curveSpecs = [
      ['monthK', '#0d9488', 1.1],
      ['quarterK', '#2563eb', 1.1],
      ['weightedK', '#c26e2b', 2.0]
    ];

    for (const [key, color, lineWidth] of curveSpecs) {
      const ys = new Float64Array(visibleKdPts.length);
      for (let i = 0; i < visibleKdPts.length; i++) ys[i] = yOf(visibleKdPts[i][key]);
      const tangents = monotoneTangents(xs, ys);
      ctx.save();
      if (xs.length === 1) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(xs[0], ys[0], Math.max(2, lineWidth + 0.5), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = lineWidth;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(xs[0], ys[0]);
        for (let i = 0; i < xs.length - 1; i++) {
          const step = xs[i + 1] - xs[i];
          if (step <= 0) {
            ctx.lineTo(xs[i + 1], ys[i + 1]);
            continue;
          }
          const third = step / 3;
          ctx.bezierCurveTo(
            xs[i] + third,
            ys[i] + tangents[i] * third,
            xs[i + 1] - third,
            ys[i + 1] - tangents[i + 1] * third,
            xs[i + 1],
            ys[i + 1]
          );
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    const latestState = kdData?.latest || kdPts.at(-1);
    if (latestState && Number.isFinite(latestState.weightedK) && tEnd >= tMin && tEnd <= tMax) {
      const lx = xOf(tEnd);
      const ly = yOf(latestState.weightedK);
      ctx.fillStyle = '#c26e2b';
      ctx.beginPath();
      ctx.arc(lx, ly, 4.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.save();
      const valTxt = latestState.weightedK.toFixed(1);
      ctx.font = `700 10.5px ${FONT_STACK}`;
      const bw = ctx.measureText(valTxt).width + 10;
      const bh = 18;
      let bx = showProjection ? lx + 7 : lx - bw - 7;
      if (bx + bw > padLeft + plotW - 3) bx = lx - bw - 7;
      const by = Math.max(padTop + 4, Math.min(padTop + plotH - bh - 4, ly - bh / 2));
      ctx.fillStyle = '#c26e2b';
      drawRoundRect(ctx, bx, by, bw, bh, 4);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(valTxt, bx + 5, by + bh / 2);
      ctx.restore();
    }
  }

  if (hoverT !== null && hoverT >= tMin && hoverT <= tMax) {
    const hx = xOf(hoverT);
    ctx.save();
    ctx.strokeStyle = 'rgba(25, 55, 74, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(hx, padTop);
    ctx.lineTo(hx, padTop + plotH);
    ctx.stroke();

    if (hoverT >= 0 && hoverT <= tEnd && kdPts.length) {
      const hState = (hoverDate && kdData?.byDate?.get(hoverDate)) || findNearestKDPoint(kdPts, hoverT);
      if (hState) {
        for (const [key, color, radius, bordered] of [
          ['monthK', '#0d9488', 2.5, false],
          ['quarterK', '#2563eb', 2.5, false],
          ['weightedK', '#c26e2b', 4, true]
        ]) {
          ctx.beginPath();
          ctx.arc(hx, yOf(hState[key]), radius, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          if (bordered) {
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }
      }
    }
    ctx.restore();
  }

  ctx.restore();

  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1;
  ctx.strokeRect(padLeft + 0.5, padTop + 0.5, plotW, plotH);

  ctx.fillStyle = '#475569';
  ctx.font = `11px ${FONT_STACK}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const tick of [0, 20, 40, 60, 80, 100]) {
    const y = yOf(tick);
    if (y >= padTop + 4 && y <= padTop + plotH - 4) {
      ctx.fillText(String(tick), padLeft - 7, y);
    }
  }

  const fmtMult = v => kdMultiple(v, tierFactor).toLocaleString('en-US', { maximumFractionDigits: 1 }) + 'N';
  ctx.font = `600 10px ${FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let prevY = -Infinity;
  for (const ref of [
    { val: 95, color: '#94a3b8' },
    { val: 65, color: '#64748b' },
    { val: 35, color: '#c26e2b' },
    { val: 15, color: '#3f7a68' },
    { val: 5, color: '#065f46' }
  ]) {
    let y = yOf(ref.val);
    if (y < prevY + 12) y = prevY + 12;
    if (y >= padTop + 4 && y <= padTop + plotH - 4) {
      ctx.fillStyle = ref.color;
      ctx.fillText(fmtMult(ref.val), padLeft + plotW + 6, y);
      prevY = y;
    }
  }

  ctx.fillStyle = '#475569';
  ctx.font = `11px ${FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const tick of timeTicks) {
    ctx.fillText(tick.label, xOf(tick.t), padTop + plotH + 7);
  }
}
