import {latestClosedSession} from './trading-calendar.mjs';
export const SYMBOLS=['VOO','QQQ'];
const dateNY=timestamp=>new Date(timestamp*1000).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
export function normalizeYahoo(payload,symbol,now=Date.now()){
 if(!SYMBOLS.includes(symbol))throw Error('Unsupported symbol');
 const result=payload?.chart?.result?.[0];
 if(payload?.chart?.error||result?.meta?.symbol!==symbol||result.meta.currency!=='USD')throw Error('Yahoo 行情标识或币种不匹配');
 const quote=result.indicators?.quote?.[0],adjusted=result.indicators?.adjclose?.[0]?.adjclose;
 if(!quote||!adjusted||!result.timestamp?.length)throw Error('行情缺少 OHLC 或复权因子');
 const latest=latestClosedSession(now,0),today=dateNY(now/1000),session=result.meta.currentTradingPeriod?.regular;
 const records=[];const seen=new Set();
 for(let i=0;i<result.timestamp.length;i++){
 const date=dateNY(result.timestamp[i]);
 if(date>latest||(date===today&&session&&dateNY(session.end)===today&&now<session.end*1000))continue;
 const values=[quote.open?.[i],quote.high?.[i],quote.low?.[i],quote.close?.[i],adjusted[i]];
 // Yahoo may include empty bars. Never replace them with zero or previous prices.
 if(values.some(v=>v===null||v===undefined))continue;
 if(values.some(v=>!Number.isFinite(v)||v<=0)||seen.has(date))throw Error('行情价格无效或日期重复');
 const [open,high,low,close,adjClose]=values;
 if(low>Math.min(open,close)+1e-5||high<Math.max(open,close)-1e-5||low>high)throw Error('OHLC 范围异常');
 const volume=quote.volume?.[i];if(volume!=null&&(!Number.isFinite(volume)||volume<0))throw Error('成交量异常');
 seen.add(date);records.push({date,sourceOpen:open,sourceHigh:high,sourceLow:low,sourceClose:close,adjClose,volume:volume??null});
 }
 records.sort((a,b)=>a.date.localeCompare(b.date));
 if(!records.length)throw Error('无完整交易日数据');
 const last=records.at(-1),anchorFactor=last.adjClose/last.sourceClose;
 const rows=records.map(r=>{const factor=(r.adjClose/r.sourceClose)/anchorFactor;return {...r,factor,open:r.sourceOpen*factor,high:r.sourceHigh*factor,low:r.sourceLow*factor,close:r.sourceClose*factor};});
 return {symbol,currency:'USD',timezone:'America/New_York',source:'Yahoo Finance',fetchedAt:new Date(now).toISOString(),anchorDate:last.date,anchorFactor,adjustment:'前复权（拆股及现金分红），以最新完整交易日为基准；OHLC × (AdjClose/Close) ÷ 最新基准因子',rows};
}
export function aggregateOHLC(rows,frequency){
 if(frequency==='daily')return rows;
 const groups=new Map();
 for(const row of rows){const d=new Date(row.date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));const key=frequency==='monthly'?row.date.slice(0,7):d.toISOString().slice(0,10);const previous=groups.get(key);if(!previous)groups.set(key,{...row,periodStart:row.date});else groups.set(key,{...previous,date:row.date,high:Math.max(previous.high,row.high),low:Math.min(previous.low,row.low),close:row.close,volume:previous.volume===null||row.volume===null?null:previous.volume+row.volume});}
 return [...groups.values()];
}

