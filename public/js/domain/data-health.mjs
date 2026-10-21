import { latestClosedSession } from './trading-calendar.mjs';

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
    const source = !fresh || !r.ok || r.source === 'whit3rabbit/fear-greed-data'
      ? (r.source === 'whit3rabbit/fear-greed-data' ? '第三方备用存档' : r.source) : '';
    const detail = [state, source, r.ok ? r.warning : r.error].filter(Boolean).join('；');
    const suffix = detail ? '（' + detail + '）' : '';
    return (r.date || '无数据') + suffix + '；检查：' + formatNewYorkTime(r.checkedAt);
  };
  const lines = status.results.filter(r => r.symbol === 'Fear & Greed')
    .map(r => '恐慌与贪婪指数：' + description(r));
  // Share identical dates/status/times, but keep a failed or delayed ticker visible.
  const tickerGroups = new Map();
  for (const r of status.results.filter(r => r.symbol !== 'Fear & Greed')) {
    const detail = description(r);
    if (!tickerGroups.has(detail)) tickerGroups.set(detail, []);
    tickerGroups.get(detail).push(r.symbol);
  }
  if (tickerGroups.size) {
    lines.push([...tickerGroups].map(([detail, symbols]) => symbols.join(' / ') + '：' + detail).join(' · '));
  }
  const complete = status.results.length === 4 && status.results.every(r => r.ok && r.date >= expected);
  return lines.join('。\n') + '。\n整体数据：' + (complete ? '已到齐' : '未全部到齐') +
    '；应有数据截至 ' + expected + '；时间均为纽约时间。';
}
