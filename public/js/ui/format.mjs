export const formatMoney = value =>
  value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatPercent = value =>
  value === null ? '—' : (Math.abs(value) < 0.00005 ? 0 : value * 100).toFixed(2) + '%';

export const formatRatio = value =>
  value === null || !Number.isFinite(value) ? '—' : value.toFixed(2);
