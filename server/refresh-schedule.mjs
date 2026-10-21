import { isTradingDay, nyDate, sessionClose } from '../public/js/domain/trading-calendar.mjs';
import { SYMBOLS } from '../public/js/domain/market.mjs';

// Each workflow entry has one New York hour. Resolve the planned slot rather
// than the runner's hour so a delayed job still refreshes the intended sources.
export function scheduledSources(cron, now = Date.now()) {
  const match = /^3 (4|10|13|14|16|17|22) \* \* (\*|1-5)$/.exec(cron);
  if (!match) throw Error('未知数据更新时间');
  const hour = Number(match[1]);
  let date = nyDate(now);
  for (let i = 0; i < 8; i++) {
    const noon = Date.parse(date + 'T17:00:00Z');
    const nyHour = Number(new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23'
    }).format(noon));
    const planned = noon + (hour - nyHour) * 3600000 + 180000;
    const weekday = new Date(noon).getUTCDay();
    if (planned <= now && (match[2] === '*' || (weekday >= 1 && weekday <= 5))) {
      const sources = [4, 10, 16, 22].includes(hour) ? ['Fear & Greed'] : [];
      const minutesAfterClose = (planned - sessionClose(date)) / 60000;
      if (isTradingDay(date) && [3, 63].includes(minutesAfterClose)) {
        if (!sources.includes('Fear & Greed')) sources.push('Fear & Greed');
        sources.push(...SYMBOLS);
      }
      return sources;
    }
    date = new Date(noon - 86400000).toISOString().slice(0, 10);
  }
  throw Error('无法确定计划更新时间');
}
