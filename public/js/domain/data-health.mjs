import {latestClosedSession} from './trading-calendar.mjs';
export function healthSummary(status,now=Date.now()){
 const expected=latestClosedSession(now);
 if(!status?.results?.length)return '尚无自动更新记录；应有数据截至 '+expected+'。';
 const names={'Fear & Greed':'恐慌与贪婪指数'};
 const lines=status.results.map(r=>{
  const fresh=!!r.date&&r.date>=expected;
  return `${names[r.symbol]||r.symbol}：${r.date||'无数据'}${!r.ok?'（最近更新失败）':!fresh?'（等待更新）':''}`;
 });
 const time=status.checkedAt?new Date(status.checkedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未知';
 return lines.join(' · ')+'。最近检查：'+time+'（北京时间）；应有数据截至 '+expected+'。';
}
