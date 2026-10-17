import {appEvents,events} from './services/events.mjs';
import {loadSentimentRows,loadSourceHealth,getDeploymentMode,requestSourceRefresh} from './services/data-client.mjs';
import {healthSummary} from './domain/data-health.mjs';
import {sentimentLabel,sourceLabel} from './ui/labels.mjs';
import {tooltipContent,positionTooltip} from './ui/tooltip.mjs';
import {drawSentiment,drawOverview} from './charts/sentiment.mjs';
import {attachChartNavigation,constrainWindow} from './charts/navigation.mjs';
import {loadMarket,renderMarket,drawPrice,invalidateMarket} from './features/market/chart.mjs';
import {aggregate,selectRange,rating} from './domain/sentiment.mjs';

export function initApplication(){
const $=id=>document.getElementById(id), formatDate=d=>d;
let rows=[],visible=[],plot,hover=-1,windowRange,crossDate,customWindow=null,lastPreset='12',marketCalendar=[];
const iso=time=>new Date(time).toISOString().slice(0,10);
const bounds=()=>({start:Date.parse(rows[0].date),end:Date.parse(rows.at(-1).date)});
function draw(){plot=drawSentiment($('chart'),{visible,windowRange,hover,crossDate});}
function mini(){drawOverview($('mini'),rows);}
function render(){
 if(!rows.length)return;
 const end=rows[Number($('timeline').value)]?.date||rows.at(-1).date;
 const raw=customWindow?rows.filter(r=>r.date>=iso(customWindow.start)&&r.date<=iso(customWindow.end)):selectRange(rows,$('range').value,end);
 windowRange={start:customWindow?iso(customWindow.start):raw[0].date,end:customWindow?iso(customWindow.end):raw.at(-1).date,frequency:$('frequency').value};
 windowRange.calendar=[...new Set([...raw.map(r=>r.date),...marketCalendar.filter(date=>date>=windowRange.start&&date<=windowRange.end)])].sort();
 visible=aggregate(raw,$('frequency').value);hover=-1;crossDate=null;$('tooltip').hidden=true;
 const last=visible.at(-1);$('score').textContent=Math.round(last.score);$('score').title=last.score.toFixed(2);$('rating').textContent=sentimentLabel(last.score);
 $('updated').textContent='指数数据截至 '+formatDate(rows.at(-1).date);
 $('date-range').textContent=formatDate(windowRange.start)+' – '+formatDate(windowRange.end);
 $('sample-note').textContent=$('frequency').value==='daily'?'日线数据 · 周末及缺失日期不补值':$('frequency').value==='weekly'?'周线 · 取每周末次记录，非平均值':'月线 · 取每月末次记录，非平均值';
 $('observations').textContent=visible.length.toLocaleString()+' 条记录';
 if($('data-table').closest('details').open)renderDataTable();
 draw();mini();renderMarket(windowRange);
}
function renderDataTable(){
 $('data-table').replaceChildren(...visible.slice().reverse().map(r=>{const tr=document.createElement('tr');for(const value of [r.date,r.score.toFixed(2),sentimentLabel(r.score),sourceLabel(r.source)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;}));
}
$('data-table').closest('details').addEventListener('toggle',()=>{if($('data-table').closest('details').open)renderDataTable();});
async function load(){rows=await loadSentimentRows();$('timeline').min=Math.min(30,rows.length-1);$('timeline').max=rows.length-1;$('timeline').value=rows.length-1;render();await loadHealth();}
$('range').addEventListener('change',()=>{if($('range').value==='custom')return;lastPreset=$('range').value;customWindow=null;render();});
$('frequency').addEventListener('change',render);
function applyLayout(){$('chart-wrap').classList.toggle('expanded',$('layout').value==='expanded');$('price-wrap').classList.toggle('expanded',$('layout').value==='expanded');draw();drawPrice();}
$('layout').addEventListener('change',applyLayout);applyLayout();
$('latest').addEventListener('click',()=>{if(customWindow){const span=customWindow.end-customWindow.start;customWindow=constrainWindow({start:bounds().end-span,end:bounds().end},bounds());}$('timeline').value=rows.length-1;render();});
$('timeline').addEventListener('input',()=>{if(customWindow){const end=Date.parse(rows[Number($('timeline').value)].date),span=customWindow.end-customWindow.start;customWindow=constrainWindow({start:end-span,end},bounds());}render();});
$('chart').addEventListener('pointermove',e=>{
 if(!plot||!visible.length)return;const rect=$('chart').getBoundingClientRect(),mx=e.clientX-rect.left,my=e.clientY-rect.top;
 if(mx<plot.left||mx>plot.w-plot.right||my<plot.top||my>plot.h-plot.bottom){hideHover();return;}
 hover=0;for(let i=1;i<visible.length;i++)if(Math.abs(plot.x(visible[i].date)-mx)<Math.abs(plot.x(visible[hover].date)-mx))hover=i;
 const r=visible[hover],tip=$('tooltip');tooltipContent(tip,{title:formatDate(r.date),rows:[['情绪指数',r.score.toFixed(2)],['市场情绪',sentimentLabel(r.score)],['来源',sourceLabel(r.source)]]});positionTooltip(tip,mx,my,rect.width);crossDate=null;draw();drawPrice(r.date);
});
function hideHover(){hover=-1;crossDate=null;$('tooltip').hidden=true;draw();drawPrice();}
$('chart').addEventListener('pointerleave',hideHover);
const deploymentReady=getDeploymentMode();
async function loadHealth(){
 try{$('status').textContent=healthSummary(await loadSourceHealth());}
 catch{$('status').textContent='无法检查数据更新状态，请核对各图的数据日期。';}
}
deploymentReady.then(mode=>{$('refresh').querySelector('span').textContent=mode==='static'?'检查更新':'更新数据';});
$('refresh').addEventListener('click',async()=>{
 const button=$('refresh');button.disabled=true;button.querySelector('span').textContent='检查中…';
 const mode=await deploymentReady;
 try{
  if(mode==='local'){
   $('status').textContent='正在同步情绪指数与 ETF 行情…';
   await requestSourceRefresh();
  }
  await load();await invalidateMarket();await loadHealth();
 }catch(error){$('status').textContent=error.message||'检查失败，已保留本地数据。';}
 finally{button.disabled=false;button.querySelector('span').textContent=mode==='static'?'检查更新':'更新数据';}
});
$('download').addEventListener('click',()=>{const csv='Date,Fear Greed,Rating,Source\n'+visible.map(r=>[r.date,r.score,rating(r.score),r.source].join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='fear-greed-'+visible[0].date+'-'+visible.at(-1).date+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
new ResizeObserver(()=>{if(rows.length){draw();mini();}}).observe($('chart-wrap'));
appEvents.addEventListener(events.marketHover,event=>{hover=-1;crossDate=event.detail;$('tooltip').hidden=true;draw();});

function applyWindow(view){
 customWindow=constrainWindow(view,bounds());
 $('range').value='custom';
 let index=rows.findIndex(r=>r.date>=iso(customWindow.end));
 $('timeline').value=index<0?rows.length-1:index;
 render();
}
function resetWindow(){customWindow=null;$('range').value=lastPreset;$('timeline').value=rows.length-1;render();}
for(const id of ['price-chart','chart'])attachChartNavigation($(id),{
 getWindow:()=>rows.length&&windowRange?(customWindow||{start:Date.parse(windowRange.start),end:Date.parse(windowRange.end)}):null,
 getBounds:bounds,onChange:applyWindow,onReset:resetWindow
});
appEvents.addEventListener(events.marketCalendar,event=>{marketCalendar=event.detail;if(rows.length)render();});
loadMarket();
load().catch(error=>{$('status').textContent=error.message+'。请检查本地数据文件后刷新页面。';});



}
