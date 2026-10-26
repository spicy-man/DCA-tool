import { parseCSV } from '../domain/sentiment.mjs';
import { filterMarketHistory } from '../domain/market.mjs';
import { getFundGroup } from '../domain/fund-groups.mjs';

export async function loadFundSnapshot(groupId = 'nasdaq100') {
  const group = getFundGroup(groupId);
  const response = await fetch('./data/' + group.snapshotFile, { cache: 'no-store' });
  if (!response.ok) throw Error('暂无基金快照，请运行每日基金更新');
  const value = await response.json();
  if (value.version !== 1 || !Array.isArray(value.rows) || (value.groupId && value.groupId !== group.id)) throw Error('基金快照格式无效');
  return value;
}

// URLs resolve relative to the page, so both localhost and GitHub Pages subpaths work.
export async function loadSentimentRows() {
  const response = await fetch('./data/fear-greed.csv', { cache: 'no-store' });
  if (!response.ok) throw Error('无法读取本地数据');
  return parseCSV(await response.text());
}

export async function loadMarketSnapshot(symbol) {
  const response = await fetch('./data/' + symbol.toLowerCase() + '.json', { cache: 'no-store' });
  if (!response.ok) throw Error('本地行情尚未就绪，请点击“更新数据”');
  const data = await response.json();
  if (data.symbol !== symbol || !data.rows?.length) throw Error('行情文件格式无效');
  data.rows = filterMarketHistory(symbol, data.rows);
  if (!data.rows.length) throw Error('暂无当前基金改制后的有效行情');
  return data;
}

export async function getDeploymentMode() {
  try {
    const response = await fetch('./deployment.json', { cache: 'no-store' });
    if (!response.ok) return 'static';
    return (await response.json()).mode === 'local' ? 'local' : 'static';
  } catch {
    return 'static';
  }
}

export async function loadSourceHealth() {
  const response = await fetch('./data/status.json', { cache: 'no-store' });
  return response.ok ? response.json() : null;
}

export async function requestSourceRefresh() {
  const response = await fetch('./api/refresh', { method: 'POST' });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '更新失败，已保留本地数据');
  return result;
}
