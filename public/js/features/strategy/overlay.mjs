import {appEvents,events} from '../../services/events.mjs';
import {calculateFearSignals} from '../../domain/fear-strategy.mjs';
import {calculatePyramidSignals} from '../../domain/pyramid-strategy.mjs';
import {tooltipContent,positionTooltip} from '../../ui/tooltip.mjs';
const $=id=>document.getElementById(id),storageKey='seeker.pyramid.v1',cache=new WeakMap();
const defaults={buyDay:1,baseAmount:1000,enabled:true,fearThreshold:10};let state={...defaults},current=[],allCurrent=[],market=null,settings=null,candleMap=new Map(),sentimentRows=[];
export function setSignalSentiment(rows){sentimentRows=rows;appEvents.dispatchEvent(new CustomEvent(events.strategySettings));}
export function signalSettings(){return {...state};}
export function getVisibleSignals(){return current;}
export function signalForDate(date){return current.filter(signal=>signal.date===date);}
export function updateSignals(data,next){
 market=data;settings=next;if(!data||!next){current=[];allCurrent=[];$('signal-layer').replaceChildren();return;}
 let computed=cache.get(data.rows);if(!computed){computed=new Map();cache.set(data.rows,computed);}
 const key=state.buyDay+':'+state.baseAmount;if(!computed.has(key))computed.set(key,calculatePyramidSignals(data.rows,state));
 allCurrent=[...computed.get(key).map(s=>({...s,type:'monthly'})),...calculateFearSignals(data.rows,sentimentRows,state)].sort((a,b)=>a.date.localeCompare(b.date)).filter(r=>r.date>=next.start&&r.date<=next.end);
 current=state.enabled&&next.frequency==='daily'?allCurrent:[];candleMap=new Map(data.rows.map(r=>[r.date,r]));
 $('signal-note').textContent=next.frequency!=='daily'?'买入信号仅在 1 日 K 线显示':!state.enabled?'买入信号已隐藏':`当前区间 ${allCurrent.length} 笔 · 每月 ${state.buyDay} 日 + F&G 跌破 ${state.fearThreshold}`;
 renderSignalTable();
}
export function signalTooltipRows(signal){if(Array.isArray(signal))return signal.flatMap(signalTooltipRows);if(signal.type==='fear')return [['信号类型','恐慌加投（额外）'],['指数信号日',signal.signalDate],['F&G 下穿',signal.previousScore.toFixed(2)+' → '+signal.score.toFixed(2)],['触发 / 重置',signal.fearThreshold+' / '+signal.rearmThreshold],['买入倍数','1 × N'],['投入金额',signal.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD']];return [['信号类型','月度定投'],['定投所属月份',signal.scheduledMonth],['计划定投日',signal.scheduledDate],['近月高点',signal.monthHigh.toFixed(2)],['距高点回撤',(signal.drawdown*100).toFixed(2)+'%'],['买入倍数',signal.multiple+' × N'],['投入金额',signal.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD']];}
export function showMarketTooltip(tip,row,{x,y,width,symbol,frequency,signal=signalForDate(row.date)}){
 tooltipContent(tip,{title:symbol+' · '+row.date,rows:[['开盘价',row.open.toFixed(2)],['最高价',row.high.toFixed(2)],['最低价',row.low.toFixed(2)],['收盘价',row.close.toFixed(2)],...(signal?signalTooltipRows(signal):[])],footer:'USD · 前复权 · '+(frequency==='daily'?'日线':frequency==='weekly'?'周线':'月线')});positionTooltip(tip,x,y,width);
}
export function drawSignalMarkers(frame){
 const layer=$('signal-layer');if(!frame||!current.length){layer.replaceChildren();layer.dataset.layout='';return;}
 const layout=[market.symbol,market.fetchedAt,settings.start,settings.end,frame.w,frame.h,state.buyDay,state.baseAmount,state.enabled,state.fearThreshold].join('|');if(layer.dataset.layout===layout)return;layer.dataset.layout=layout;layer.replaceChildren();
 const points=current.map(signal=>({signal,x:frame.x(signal.date),row:candleMap.get(signal.date)})).filter(p=>p.row);
 const dense=points.some((p,i)=>i&&p.x>points[i-1].x&&p.x-points[i-1].x<54);
 const sameDateCounts=new Map();
 for(const p of points){
 const slot=sameDateCounts.get(p.signal.date)||0;sameDateCounts.set(p.signal.date,slot+1);
 const marker=document.createElement('button');marker.type='button';marker.className='buy-marker'+(p.signal.type==='fear'?' is-fear':'')+(dense?' is-compact':'');marker.textContent='Buy '+p.signal.multiple+'x';marker.dataset.date=p.signal.date;marker.dataset.type=p.signal.type;marker.dataset.multiple=p.signal.multiple;marker.setAttribute('aria-label',`${p.signal.date} ${p.signal.type==='fear'?'恐慌加投':'月度定投'} 买入 ${p.signal.multiple} 倍，${p.signal.amount.toFixed(2)} USD`);
 marker.style.left=p.x+'px';marker.style.top=Math.min(frame.h-frame.bottom-47,frame.y(p.row.low)+8)+slot*24+'px';
 const show=()=>showMarketTooltip($('price-tooltip'),p.row,{x:p.x,y:Math.min(frame.h-32,frame.y(p.row.low)),width:frame.w,symbol:market.symbol,frequency:'daily',signal:p.signal});
 marker.addEventListener('pointerenter',show);marker.addEventListener('focus',show);marker.addEventListener('click',show);marker.addEventListener('pointerleave',()=>{$('price-tooltip').hidden=true;});marker.addEventListener('blur',()=>{$('price-tooltip').hidden=true;});
 layer.append(marker);
 }
}
function renderSignalTable(){
 if(!$('signal-table').closest('details').open)return;
 $('signal-table').replaceChildren(...allCurrent.slice().reverse().map(signal=>{const tr=document.createElement('tr');for(const v of [signal.date,signal.type==='fear'?'恐慌加投 · F&G '+signal.score.toFixed(2):'月度定投 · '+signal.scheduledMonth,signal.type==='fear'?'—':(signal.drawdown*100).toFixed(2)+'%',signal.multiple+'×',signal.amount.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})]){const td=document.createElement('td');td.textContent=v;tr.append(td);}return tr;}));
 $('signal-total').textContent=`当前区间 ${allCurrent.length} 笔 · 合计 ${allCurrent.reduce((sum,s)=>sum+s.amount,0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})} USD`;
}

function apply(){
 const buyDay=Number($('buy-day').value),baseAmount=Number($('base-amount').value),fearThreshold=Number($('fear-threshold').value);
 if(!Number.isFinite(baseAmount)||baseAmount<.01||!Number.isFinite(baseAmount*38)){$('signal-error').textContent='N 请输入不小于 0.01 的有效金额';return;}
 if(!Number.isFinite(fearThreshold)||fearThreshold<=0||fearThreshold>95){$('signal-error').textContent='F&G 阈值请输入大于 0 且不超过 95 的数值';return;}
 $('signal-error').textContent='';state={buyDay,baseAmount,fearThreshold,enabled:$('signals-enabled').checked};try{localStorage.setItem(storageKey,JSON.stringify(state));}catch{}
 appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
}
export function initStrategyOverlay(){
$('signal-table').closest('details').addEventListener('toggle',renderSignalTable);
try{const saved=JSON.parse(localStorage.getItem(storageKey));if(saved&&Number.isInteger(saved.buyDay)&&saved.buyDay>=1&&saved.buyDay<=31&&Number.isFinite(saved.baseAmount)&&saved.baseAmount>=.01&&Number.isFinite(saved.baseAmount*38))state={...defaults,...saved,enabled:saved.enabled!==false,fearThreshold:Number.isFinite(saved.fearThreshold)&&saved.fearThreshold>0&&saved.fearThreshold<=95?saved.fearThreshold:10};}catch{}
$('fear-threshold').value=state.fearThreshold;$('buy-day').value=state.buyDay;$('base-amount').value=state.baseAmount;$('signals-enabled').checked=state.enabled;
for(const id of ['buy-day','base-amount','fear-threshold','signals-enabled'])$(id).addEventListener(id==='base-amount'?'input':'change',apply);
$('signal-download').addEventListener('click',()=>{
 if(!market||!allCurrent.length)return;
 const csv='Symbol,Date,BuyDay,BaseAmountUSD,MonthCutoff,MonthHigh,Drawdown,Multiple,AmountUSD,SignalType,SignalDate,FearScore,FearThreshold,RearmThreshold,ScheduledMonth,ScheduledDate\n'+allCurrent.map(s=>[market.symbol,s.date,s.buyDay,s.baseAmount,s.cutoff,s.monthHigh,s.drawdown,s.multiple,s.amount,s.type,s.signalDate??'',s.score??'',s.fearThreshold??'',s.rearmThreshold??'',s.scheduledMonth??'',s.scheduledDate??''].join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=market.symbol+'-dca-signals.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});



}
