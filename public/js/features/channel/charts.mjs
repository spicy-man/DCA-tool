import {
  MS_PER_YEAR,
  classifyChannelZ,
  createShiftedCustomAnchor,
  formatIsoDateUtc,
  interpolateLnPrice,
  parseIsoDateUtc,
  solveEndpointChannel
} from '../../domain/log-channel.mjs';

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

function computeYearTicks(startDate, endDate, showProjection, proj12mDate) {
  const startYear = Number(startDate.slice(0, 4));
  const lastYear = Number((showProjection ? proj12mDate : endDate).slice(0, 4));
  const span = Math.max(1, lastYear - startYear);
  const step = span > 24 ? 4 : (span > 14 ? 2 : 1);
  const years = [];
  for (let y = startYear; y <= lastYear; y++) {
    if (y === startYear || (y - startYear) % step === 0) {
      years.push(y);
    }
  }
  return years;
}

function formatAxisPrice(val) {
  if (val >= 1000) return String(Math.round(val));
  if (val >= 10) return Number.isInteger(val) ? String(val) : val.toFixed(1);
  return val.toFixed(2).replace(/\.?0+$/, '');
}

export function createChannelGeom(model, { width, isMobile, showProjection }) {
  const padLeft = isMobile ? 40 : 46;
  const padRight = isMobile ? 52 : 70;
  const plotW = Math.max(140, width - padLeft - padRight);
  const tSpan = Math.max(1, model.dataset.tEnd);
  const tMin = -tSpan * 0.015;
  const tMax = showProjection ? model.dataset.tProj + tSpan * 0.015 : model.dataset.tEnd + tSpan * 0.02;
  return { padLeft, padRight, plotW, tMin, tMax };
}

export function drawLogChannelUpper(
  canvas,
  model,
  {
    showOrigLine = false,
    showPivot = false,
    showProjection = true,
    hoverT = null,
    lockedYBounds = null,
    activeHandle = null,
    pinnedHandle = null
  } = {}
) {
  const isMobile = (globalThis.innerWidth || 1024) < 640;
  const cssH = isMobile ? 275 : 335;
  const { ctx, width, height } = setupHiDPI(canvas, cssH);
  const geom = createChannelGeom(model, { width, isMobile, showProjection });
  const { padLeft, plotW, tMin, tMax } = geom;

  const padTop = 20;
  const padBottom = 30;
  const plotH = height - padTop - padBottom;

  const ds = model.dataset;
  const pts = ds.points;
  const tEnd = ds.tEnd;
  const tLineEnd = showProjection ? ds.tProj : tEnd;
  const sigma = model.sigmaUsed;

  let lnYMin;
  let lnYMax;
  if (lockedYBounds && Number.isFinite(lockedYBounds.lnYMin) && Number.isFinite(lockedYBounds.lnYMax)) {
    lnYMin = lockedYBounds.lnYMin;
    lnYMax = lockedYBounds.lnYMax;
  } else {
    lnYMin = Infinity;
    lnYMax = -Infinity;
    for (let i = 0; i < pts.length; i++) {
      const v = pts[i].lnP;
      if (v < lnYMin) lnYMin = v;
      if (v > lnYMax) lnYMax = v;
    }

    const probes = [
      model.lnFit(0) - 2 * sigma,
      model.lnFit(0) + 2 * sigma,
      model.lnFit(tLineEnd) - 2 * sigma,
      model.lnFit(tLineEnd) + 2 * sigma
    ];
    if (showOrigLine) {
      probes.push(model.origLnFit(0), model.origLnFit(tLineEnd));
    }
    for (const v of probes) {
      if (v < lnYMin) lnYMin = v;
      if (v > lnYMax) lnYMax = v;
    }
    const span = Math.max(0.2, lnYMax - lnYMin);
    lnYMin -= span * 0.06;
    lnYMax += span * 0.07;
  }

  const xOf = t => padLeft + ((t - tMin) / (tMax - tMin)) * plotW;
  const yOfLn = lnV => padTop + ((lnYMax - lnV) / (lnYMax - lnYMin)) * plotH;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  if (showProjection) {
    const xToday = xOf(tEnd);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(xToday, padTop, padLeft + plotW - xToday, plotH);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotW, plotH);
  ctx.clip();

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

  const years = computeYearTicks(ds.startDate, ds.endDate, showProjection, ds.proj12mDate);
  for (const yr of years) {
    const tYr = (parseIsoDateUtc(`${yr}-01-01`) - ds.baseMs) / MS_PER_YEAR;
    if (tYr >= tMin && tYr <= tMax) {
      const x = Math.round(xOf(tYr)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
    }
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
  drawBand(0, '#334e5e', 2.2, null);

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

  // Sample daily series efficiently by pixel column when dense
  ctx.save();
  ctx.strokeStyle = '#19374a';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  const stride = pts.length > plotW * 2 ? Math.floor(pts.length / (plotW * 1.8)) : 1;
  for (let i = 0; i < pts.length; i += stride) {
    const x = xOf(pts[i].t);
    const y = yOfLn(pts[i].lnP);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if ((pts.length - 1) % stride !== 0) {
    const lastPt = pts[pts.length - 1];
    ctx.lineTo(xOf(lastPt.t), yOfLn(lastPt.lnP));
  }
  ctx.stroke();
  ctx.restore();

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
  for (const yr of years) {
    const tYr = (parseIsoDateUtc(`${yr}-01-01`) - ds.baseMs) / MS_PER_YEAR;
    if (tYr >= tMin && tYr <= tMax) {
      const x = xOf(tYr);
      ctx.fillText(String(yr), x, padTop + plotH + 7);
      ctx.strokeStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.moveTo(x, padTop + plotH);
      ctx.lineTo(x, padTop + plotH + 4);
      ctx.stroke();
    }
  }

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
    let y = yOfLn(model.lnFit(tLineEnd) + item.off * sigma);
    if (y < prevY + 13) y = prevY + 13;
    if (y >= padTop + 4 && y <= padTop + plotH - 4) {
      ctx.fillStyle = item.color;
      ctx.fillText(item.text, padLeft + plotW + 6, y);
      prevY = y;
    }
  }

  const handles = {
    left: { x: xOf(0), y: yOfLn(model.lnFit(0)), t: 0, lnP: model.lnFit(0) },
    right: { x: xOf(tLineEnd), y: yOfLn(model.lnFit(tLineEnd)), t: tLineEnd, lnP: model.lnFit(tLineEnd) }
  };

  for (const side of ['left', 'right']) {
    const h = handles[side];
    if (h.y < padTop - 10 || h.y > padTop + plotH + 10) continue;
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

  return { ...geom, padTop, plotH, lnYMin, lnYMax, handles };
}

export function hitTestChannelHandle(canvas, geom, clientX, clientY) {
  if (!canvas || !geom || !geom.handles) return null;
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  const hitRadius = 16;
  for (const side of ['left', 'right']) {
    const h = geom.handles[side];
    if (!h) continue;
    if (Math.hypot(x - h.x, y - h.y) <= hitRadius) return side;
  }
  if (
    x >= geom.padLeft &&
    x <= geom.padLeft + geom.plotW &&
    y >= geom.padTop &&
    y <= geom.padTop + geom.plotH
  ) {
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
  { showProjection = true, hoverT = null, geom = null } = {}
) {
  const isMobile = (globalThis.innerWidth || 1024) < 640;
  const cssH = isMobile ? 160 : 185;
  const { ctx, width, height } = setupHiDPI(canvas, cssH);
  const effectiveGeom = geom || createChannelGeom(model, { width, isMobile, showProjection });
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

  let minZ = -2.35;
  let maxZ = 2.35;
  for (let i = 0; i < zSeries.length; i++) {
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

  if (showProjection) {
    const xToday = xOf(tEnd);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(xToday, padTop, padLeft + plotW - xToday, plotH);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(padLeft, padTop, plotW, plotH);
  ctx.clip();

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

  const years = computeYearTicks(ds.startDate, ds.endDate, showProjection, ds.proj12mDate);
  for (const yr of years) {
    const tYr = (parseIsoDateUtc(`${yr}-01-01`) - ds.baseMs) / MS_PER_YEAR;
    if (tYr >= tMin && tYr <= tMax) {
      const x = Math.round(xOf(tYr)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, padTop);
      ctx.lineTo(x, padTop + plotH);
      ctx.stroke();
    }
  }

  const stride = pts.length > plotW * 2 ? Math.floor(pts.length / (plotW * 1.8)) : 1;

  function fillResidualSide(thresholdZ, isAbove, color) {
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
    ctx.moveTo(xOf(pts[0].t), yOf(thresholdZ));
    for (let i = 0; i < pts.length; i += stride) {
      ctx.lineTo(xOf(pts[i].t), yOf(zSeries[i]));
    }
    if ((pts.length - 1) % stride !== 0) {
      ctx.lineTo(xOf(pts[pts.length - 1].t), yOf(zSeries[pts.length - 1]));
    }
    ctx.lineTo(xOf(pts[pts.length - 1].t), yOf(thresholdZ));
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

  ctx.save();
  ctx.strokeStyle = '#19374a';
  ctx.lineWidth = 1.45;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += stride) {
    const x = xOf(pts[i].t);
    const y = yOf(zSeries[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if ((pts.length - 1) % stride !== 0) {
    ctx.lineTo(xOf(pts[pts.length - 1].t), yOf(zSeries[pts.length - 1]));
  }
  ctx.stroke();
  ctx.restore();

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
  for (const yr of years) {
    const tYr = (parseIsoDateUtc(`${yr}-01-01`) - ds.baseMs) / MS_PER_YEAR;
    if (tYr >= tMin && tYr <= tMax) {
      ctx.fillText(String(yr), xOf(tYr), padTop + plotH + 7);
    }
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
