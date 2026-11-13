import { readFile } from 'node:fs/promises';
import { scheduledSources } from '../server/refresh-schedule.mjs';

async function readJsonOptional(relativePath, fallback) {
  try {
    return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
  } catch {
    return fallback;
  }
}

const status = await readJsonOptional('../public/data/status.json', null);
const customConfig = await readJsonOptional('../public/data/custom-symbols.json', null);
const customSymbols = Array.isArray(customConfig)
  ? customConfig.map(item => (typeof item === 'string' ? item : item?.symbol)).filter(Boolean)
  : [];

console.log('sources=' + scheduledSources(process.env.REFRESH_SCHEDULE, Date.now(), {
  status,
  customSymbols,
  catchUp: true
}).join(','));
