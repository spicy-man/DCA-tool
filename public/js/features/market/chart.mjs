import {appEvents,events} from '../../services/events.mjs';
import {loadMarketSnapshot} from '../../services/data-client.mjs';
import {updateSignals,drawSignalMarkers,getVisibleSignals,showMarketTooltip} from '../strategy/overlay.mjs';
import {createTradingScale,candleMetrics,paintCandle,chartInsets} from '../../charts/geometry.mjs';
import {aggregateOHLC} from '../../domain/market.mjs';
const $=id=>document.getElementById(id),store=new Map();
let settings,shown=[],frame,active=-1,loading=false,requestID=0;
export async function loadMarket(force=false){
 const id=++requestID,symbol=$('symbol').value;loading=true;$('price-title').textContent=symbol+' · 前复权 K 线';$('price-close').textContent='—';$('price-asof').textContent='正在读取 '+symbol+' 行情…';
 try{
 if(force||!store.has(symbol)){const data=await loadMarketSnapshot(symbol);store.set(symbol,data);if(symbol==='VOO')appEvents.dispatchEvent(new CustomEvent(events.marketCalendar,{detail:data.rows.map(r=>r.date)}));}
 if(id!==requestID)return;loading=false;renderMarket(settings);
 }catch(error){if(id!==requestID)return;loading=false;$('price-asof').textContent=error.message;shown=[];$('price-close').textContent='—';$('price-change').textContent='—';$('price-observations').textContent='0 根 K 线';$('price-table').replaceChildren();updateSignals(null,null);drawPrice();}
}
export function invalidateMarket(){store.clear();return loadMarket(true);}
export function renderMarket(next){
 settings=next;if(!next||loading)return;
 const symbol=$('symbol').value,data=store.get(symbol);if(!data)return;
 updateSignals(data,next);
 const daily=data.rows.filter(r=>r.date>=next.start&&r.date<=next.end);
 shown=aggregateOHLC(daily,next.frequency);active=-1;$('price-tooltip').hidden=true;
 $('price-title').textContent=symbol+' · 前复权 K 线';
 $('price-asof').textContent='Yahoo Finance · 数据截至 '+data.anchorDate+' · USD';
 const last=shown.at(-1),previous=shown.at(-2);
 $('price-close').textContent=last?last.close.toFixed(2):'—';
 $('price-change').textContent=last?(previous?`${last.date} · ${((last.close/previous.close-1)*100).toFixed(2)}%`:`${last.date}`):'当前区间无行情';
 $('price-note').textContent=next.frequency==='daily'?'前复权 K 线 · 日线 · 白色阳线 · 黑色阴线':next.frequency==='weekly'?'前复权 K 线 · 周线 · 首开／最高／最低／末收':'前复权 K 线 · 月线 · 首开／最高／最低／末收';
 $('price-observations').textContent=shown.length.toLocaleString()+' 根 K 线';
 $('price-anchor').textContent=`${symbol} 可用历史：${data.rows[0].date} — ${data.anchorDate} · 复权基准：${data.anchorDate} · 更新：${data.fetchedAt.slice(0,10)}`;
 $('price-source').href='https://finance.yahoo.com/quote/'+symbol+'/history/';
 if($('price-table').closest('details').open)renderPriceTable();
 const stale=(Date.now()-Date.parse(data.anchorDate))/864e5>7;
 if(stale)$('price-asof').textContent+=' · 行情超过 7 天未更新';
 if(!shown.length)$('price-empty').textContent=`当前区间无 ${symbol} 行情；可用历史始于 ${data.rows[0].date}。`;
 drawPrice();
}
function renderPriceTable(){
 $('price-table').replaceChildren(...shown.slice().reverse().map(r=>{const tr=document.createElement('tr');for(const v of [r.date,...[r.open,r.high,r.low,r.close].map(n=>n.toFixed(2)),r.volume===null?'—':r.volume.toLocaleString()]){const td=document.createElement('td');td.textContent=v;tr.append(td);}return tr;}));
}

export function drawPrice(crossDate){
 const canvas=$('price-chart'),w=canvas.clientWidth,h=canvas.clientHeight,dpr=devicePixelRatio||1;canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);c.fillStyle='#dbdbdb';c.fillRect(0,0,w,h);frame=null;
 $('price-empty').hidden=shown.length>0||loading;
 if(!settings||!shown.length){$('signal-layer').replaceChildren();$('signal-layer').dataset.layout='';return;}
 const {left,right}=chartInsets(w),top=20,bottom=32,pw=w-left-right,ph=h-top-bottom,start=Date.parse(settings.start),end=Date.parse(settings.end);
 let low=Math.min(...shown.map(r=>r.low)),high=Math.max(...shown.map(r=>r.high));const pad=Math.max((high-low)*.1,high*.002);low-=pad;high+=pad;
 const scale=createTradingScale(settings.calendar,settings.frequency,left,pw);
 const labelSpace=getVisibleSignals().length?52:0;
 const x=scale.x,y=v=>top+(high-v)/(high-low)*(ph-labelSpace);frame={left,right,top,bottom,pw,ph,start,end,w,h,x,y,scale};
 c.font='11px Segoe UI, sans-serif';c.textAlign='left';
 const target=(high-low)/Math.max(3,Math.floor(ph/85)),unit=10**Math.floor(Math.log10(target));
 const tickStep=[1,2,2.5,5,10].map(n=>n*unit).reduce((best,n)=>Math.abs(n-target)<Math.abs(best-target)?n:best);
 for(let price=Math.ceil(low/tickStep)*tickStep;price<=high;price+=tickStep){c.fillStyle='#555555';c.fillText(price.toFixed(2),w-right+10,y(price)+4);}
 c.save();c.beginPath();c.rect(left,top,pw,ph);c.clip();
 // Use whole device pixels for every edge, with the same parity for body and wick.
 const metrics=candleMetrics(scale.spacing,dpr);
 canvas.dataset.barSpacing=scale.spacing.toFixed(3);canvas.dataset.bodyPixels=metrics.body;canvas.dataset.wickPixels=metrics.wick;
 c.save();c.setTransform(1,0,0,1,0,0);
 for(const r of shown)paintCandle(c,{x:x(r.date),openY:y(r.open),closeY:y(r.close),highY:y(r.high),lowY:y(r.low),up:r.close>=r.open},metrics,dpr);
 c.restore();
 c.save();c.setLineDash([1,3]);c.strokeStyle='#444444';c.lineWidth=.8;c.beginPath();c.moveTo(left,y(shown.at(-1).close));c.lineTo(w-right,y(shown.at(-1).close));c.stroke();c.restore();
 const cross=crossDate||(active>=0?shown[active]?.date:null);
 if(cross){c.setLineDash([3,4]);c.strokeStyle='#859aa5';c.beginPath();c.moveTo(x(cross),top);c.lineTo(x(cross),h-bottom);c.stroke();}
 c.restore();drawSignalMarkers(frame);c.fillStyle='#666666';
 for(const tick of scale.ticks(w<500?3:6)){c.textAlign='center';const label=new Date(tick.date+'T00:00:00Z').toLocaleDateString('zh-CN',scale.dates.length<90?{month:'short',day:'numeric',timeZone:'UTC'}:{month:'short',year:'2-digit',timeZone:'UTC'});c.fillText(label,Math.max(c.measureText(label).width/2+2,tick.x),h-10);}

}
function hide(){active=-1;$('price-tooltip').hidden=true;drawPrice();appEvents.dispatchEvent(new CustomEvent(events.marketHover,{detail:null}));}
export function initMarketChart(){
$('price-table').closest('details').addEventListener('toggle',()=>{if($('price-table').closest('details').open)renderPriceTable();});
$('price-chart').addEventListener('pointermove',event=>{
 if(!frame||!shown.length)return;const rect=$('price-chart').getBoundingClientRect(),mx=event.clientX-rect.left,my=event.clientY-rect.top;
 if(mx<frame.left||mx>frame.w-frame.right||my<frame.top||my>frame.h-frame.bottom){hide();return;}
 let closest=0;for(let i=1;i<shown.length;i++)if(Math.abs(frame.x(shown[i].date)-mx)<Math.abs(frame.x(shown[closest].date)-mx))closest=i;
 // Do not snap a cursor from years before an ETF's inception to its first candle.
 if(mx<frame.x(shown[0].date)-frame.scale.spacing/2||mx>frame.x(shown.at(-1).date)+frame.scale.spacing/2){hide();return;}
 active=closest;const r=shown[closest],tip=$('price-tooltip');showMarketTooltip(tip,r,{x:mx,y:my,width:rect.width,symbol:$('symbol').value,frequency:settings.frequency});drawPrice();appEvents.dispatchEvent(new CustomEvent(events.marketHover,{detail:r.date}));
});
$('price-chart').addEventListener('pointerleave',hide);
$('symbol').addEventListener('change',()=>{shown=[];updateSignals(null,null);$('price-tooltip').hidden=true;drawPrice();loadMarket();});
$('price-download').addEventListener('click',()=>{if(!shown.length)return;const data=store.get($('symbol').value);const csv='Date,Open,High,Low,Close,Volume,Adjustment,AnchorDate\n'+shown.map(r=>[r.date,r.open,r.high,r.low,r.close,r.volume??'','QFQ',data.anchorDate].join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=data.symbol+'-qfq-'+settings.frequency+'.csv';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
appEvents.addEventListener(events.strategySettings,()=>{if(settings)renderMarket(settings);});
new ResizeObserver(()=>{document.getElementById('price-tooltip').hidden=true;drawPrice();}).observe($('price-wrap'));


}
