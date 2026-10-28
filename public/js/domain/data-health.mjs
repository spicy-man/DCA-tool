import { latestClosedSession } from './trading-calendar.mjs';
import { SYMBOLS } from './market.mjs';

const timeFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short'
});

export function formatNewYorkTime(value) {
  if (value == null || value === '') return '尚未检查';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '尚未检查';
  const p = Object.fromEntries(timeFormat.formatToParts(date).map(part => [part.type, part.value]));
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second + ' ' + p.timeZoneName;
}

export function healthSummary(status, now = Date.now()) {
  const expected = latestClosedSession(now);
  if (!status?.results?.length) {
    return '尚无自动更新记录；应有数据截至 ' + expected + '。';
  }
  const description = r => {
    const fresh = !!r.date && r.date >= expected;
    const state = !r.ok ? '最近更新失败' : !fresh
      ? (r.expectedDate === expected && r.message ? '来源数据未到齐，等待更新' : '等待更新') : '';
    const issue = (r.ok ? r.warning : r.error)
      ?.replace('，已保留原数据；已保留上次有效数据', '，已保留上次有效数据');
    const rawSource = !fresh || !r.ok || r.source === 'whit3rabbit/fear-greed-data'
      ? (r.source === 'whit3rabbit/fear-greed-data' ? '第三方备用存档' : r.source) : '';
    const source = rawSource && !issue?.includes(rawSource) ? rawSource : '';
    const detail = [state, source, issue].filter(Boolean).join('；');
    const suffix = detail ? '（' + detail + '）' : '';
    return (r.date || '无数据') + suffix;
  };
  const results = [...status.results];
  for (const symbol of ['Fear & Greed', ...SYMBOLS]) {
    if (!results.some(r => r.symbol === symbol)) {
      results.push({ symbol, ok: false, date: null, checkedAt: null, error: '尚无检查记录，请更新数据' });
    }
  }
  const lines = results.filter(r => r.symbol === 'Fear & Greed')
    .map(r => '恐慌与贪婪指数：' + description(r) + '；检查：' + formatNewYorkTime(r.checkedAt));
  // Healthy tickers share a date even when checked in different batches.
  // Tickers with identical diagnostics and the same valid check time also group together.
  const tickerGroups = new Map();
  for (const r of results.filter(r => r.symbol !== 'Fear & Greed')) {
    const validTime = r.checkedAt != null && r.checkedAt !== '' && Number.isFinite(Date.parse(r.checkedAt));
    const healthy = r.ok && r.date >= expected && !r.warning && validTime;
    const key = healthy
      ? JSON.stringify(['healthy', r.date, r.source])
      : validTime
        ? JSON.stringify(['issue', description(r), formatNewYorkTime(r.checkedAt)])
        : r.symbol;
    if (!tickerGroups.has(key)) tickerGroups.set(key, []);
    tickerGroups.get(key).push(r);
  }
  if (tickerGroups.size) {
    lines.push(...[...tickerGroups.values()].map(group => {
      let checked = formatNewYorkTime(group[0].checkedAt);
      if (group.length > 1) {
        const times = group.map(r => Date.parse(r.checkedAt));
        const first = formatNewYorkTime(Math.min(...times));
        const last = formatNewYorkTime(Math.max(...times));
        checked = first === last ? first : first + ' ～ ' + last;
      }
      return group.map(r => r.symbol).join(' / ') + '：' + description(group[0]) + '；检查：' + checked;
    }));
  }
  const hasAllSymbols = ['Fear & Greed', ...SYMBOLS].every(symbol =>
    status.results.some(r => r.symbol === symbol));
  const allFresh = hasAllSymbols && status.results.every(r => !!r.date && r.date >= expected);
  const complete = allFresh && status.results.every(r => r.ok);
  const overall = complete
    ? '已到齐'
    : allFresh
      ? '已到齐（最近更新失败，继续使用已保存数据）'
      : '未全部到齐';
  return lines.join('。\n') + '。\n整体数据：' + overall +
    '；应有数据截至 ' + expected + '；时间均为纽约时间。';
}
