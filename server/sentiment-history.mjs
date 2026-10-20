import { readFile } from 'node:fs/promises';
import { parseCSV, OFFICIAL_START } from '../public/js/domain/sentiment.mjs';

export async function loadHistoricalSupplement() {
  const alignment = JSON.parse(await readFile(
    new URL('../data/fear-greed-history-alignment.json', import.meta.url), 'utf8'
  ));
  // Keep both source values for audit; never silently resolve a disagreement.
  if (!Array.isArray(alignment.rows) || alignment.rows.some(row =>
    !Number.isFinite(row.alexey) || row.alexey !== row.hackingthemarkets ||
    typeof row.supplement !== 'boolean' || row.date >= OFFICIAL_START
  )) throw Error('历史补缺来源不一致或格式无效');
  const validated = parseCSV('Date,Fear Greed,Rating\n' +
    alignment.rows.map(row => `${row.date},${row.alexey},`).join('\n'));
  const dates = new Set(alignment.rows.filter(row => row.supplement).map(row => row.date));
  return validated.filter(row => dates.has(row.date));
}

export function mergeHistoricalSupplement(rows, supplement) {
  // Reviewed historical gap values take precedence even if the fallback later changes.
  const merged = new Map(rows.map(row => [row.date, row]));
  for (const row of supplement) merged.set(row.date, row);
  return [...merged.values()].sort((a, b) => a.date.localeCompare(b.date));
}
