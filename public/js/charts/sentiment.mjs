import { createTradingScale, chartInsets } from './geometry.mjs';
import { OFFICIAL_START } from '../domain/sentiment.mjs';

export function chartContext(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const c = canvas.getContext('2d');
  c.scale(dpr, dpr);
  return { c, w, h };
}

export function drawSentiment(canvas, { visible, windowRange, hover = -1, crossDate = null, crossY = null, threshold = 10 }) {
  const { c, w, h } = chartContext(canvas);
  if (!windowRange) return null;

  const { left, right } = chartInsets(w);
  const top = 10;
  const bottom = 32;
  const pw = w - left - right;
  const ph = h - top - bottom;
  const start = Date.parse(windowRange.start);
  const end = Date.parse(windowRange.end);
  const scale = createTradingScale(windowRange.calendar, windowRange.frequency, left, pw);
  const x = scale.x;
  const y = v => top + ((100 - v) / 100) * ph;
  const plot = { left, right, top, bottom, pw, ph, x, y, w, h, start, end, scale };

  const bands = [
    [75, 100, '#eaf5f1', 'Extreme greed'],
    [55, 75, '#f2f8f5', 'Greed'],
    [45, 55, '#f7f8f8', 'Neutral'],
    [25, 45, '#fcf8ef', 'Fear'],
    [0, 25, '#fcf1eb', 'Extreme fear']
  ];

  c.save();
  c.font = '8px Segoe UI, sans-serif';
  c.textAlign = 'right';
  c.textBaseline = 'middle';
  for (const [lo, hi, color, label] of bands) {
    c.fillStyle = color;
    c.fillRect(left, y(hi), w - left, y(lo) - y(hi));
    c.fillStyle = '#87948f';
    c.fillText(label, w - 5, y((lo + hi) / 2));
  }

  c.font = '10px Segoe UI, sans-serif';
  c.textAlign = 'left';
  for (const tick of [0, 25, 50, 75, 100]) {
    c.strokeStyle = '#ffffff99';
    c.lineWidth = 0.6;
    c.beginPath();
    c.moveTo(left, y(tick));
    c.lineTo(w, y(tick));
    c.stroke();
  }
  c.restore();

  c.font = '10px Segoe UI, sans-serif';
  c.save();
  c.strokeStyle = '#d05b4b';
  c.lineWidth = 1.2;
  c.setLineDash([]);
  c.beginPath();
  c.moveTo(left, y(threshold));
  c.lineTo(w - right, y(threshold));
  c.stroke();
  c.restore();

  const cutoff = Date.parse(OFFICIAL_START);
  if (cutoff > start && cutoff < end) {
    c.save();
    c.setLineDash([4, 4]);
    c.strokeStyle = '#819da8';
    c.beginPath();
    c.moveTo(x(OFFICIAL_START), top);
    c.lineTo(x(OFFICIAL_START), h - bottom);
    c.stroke();
    c.restore();
    c.fillStyle = '#5d7b88';
    c.textAlign = 'left';
    c.fillText('CNN 官方数据 →', x(OFFICIAL_START) + 6, top + 12);
  }

  if (visible.length) {
    c.strokeStyle = '#273e46';
    c.lineWidth = 1.25;
    c.lineJoin = 'round';
    c.beginPath();
    visible.forEach((r, i) => (i ? c.lineTo(x(r.date), y(r.score)) : c.moveTo(x(r.date), y(r.score))));
    c.stroke();
  }

  c.fillStyle = '#8b959c';
  for (const tick of scale.ticks(w < 500 ? 3 : 6)) {
    c.textAlign = 'center';
    c.fillText(tick.label, Math.max(c.measureText(tick.label).width / 2 + 2, tick.x), h - 9);
  }

  if (crossDate) {
    c.save();
    c.setLineDash([3, 4]);
    c.strokeStyle = '#7f949d';
    c.beginPath();
    c.moveTo(x(crossDate), top);
    c.lineTo(x(crossDate), h - bottom);
    if (Number.isFinite(crossY)) {
      c.moveTo(left, crossY);
      c.lineTo(w - right, crossY);
    }
    c.stroke();
    c.restore();
  }

  if (hover >= 0 && visible[hover]) {
    const r = visible[hover];
    const px = x(r.date);
    const py = y(r.score);
    c.save();
    c.setLineDash([3, 4]);
    c.strokeStyle = '#7f949d';
    c.beginPath();
    if (!crossDate) {
      c.moveTo(px, top);
      c.lineTo(px, h - bottom);
      c.moveTo(left, Number.isFinite(crossY) ? crossY : py);
      c.lineTo(w - right, Number.isFinite(crossY) ? crossY : py);
    }
    c.stroke();
    c.restore();
    c.fillStyle = '#19374a';
    c.beginPath();
    c.arc(px, py, 3, 0, Math.PI * 2);
    c.fill();
  }

  return visible.length ? plot : null;
}

export function drawOverview(canvas, rows) {
  const { c, w, h } = chartContext(canvas);
  if (!rows.length) return;
  c.strokeStyle = '#91a8b5';
  c.lineWidth = 0.8;
  c.beginPath();
  const start = Date.parse(rows[0].date);
  const span = Date.parse(rows.at(-1).date) - start;
  rows.forEach((r, i) => {
    const x = span > 0 ? ((Date.parse(r.date) - start) / span) * w : w / 2;
    const y = 3 + ((100 - r.score) / 100) * (h - 6);
    i ? c.lineTo(x, y) : c.moveTo(x, y);
  });
  c.stroke();
}
