export function escapeCSVCell(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return '"' + String(value) + '"';
  }
  const text = String(value ?? '');
  const safe = /^(?:[\t\r\n]|[\s\u00A0]*[=+\-@])/.test(text) ? "'" + text : text;
  return '"' + safe.replace(/"/g, '""') + '"';
}

export function formatCSV(rows) {
  return '\uFEFF' + rows.map(row => row.map(escapeCSVCell).join(',')).join('\r\n');
}

export function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
