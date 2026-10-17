import {healthSummary} from './data-health.mjs';
import {sentimentLabel,sourceLabel} from './labels.mjs';
import {tooltipContent,positionTooltip} from './tooltip.mjs';
import {createTradingScale,chartInsets} from './chart-geometry.mjs';
import {attachChartNavigation,constrainWindow} from './chart-navigation.mjs';
import {loadMarket,renderMarket,drawPrice,invalidateMarket} from './market-chart.mjs';
import {parseCSV,aggregate,selectRange,OFFICIAL_START,rating} from './data.mjs';
const $=id=>document.getElementById(id), formatDate=d=>d;
let rows=[],visible=[],plot,hover=-1,windowRange,crossDate,customWindow=null,lastPreset='12',marketCalendar=[];
const iso=time=>new Date(time).toISOString().slice(0,10);
const bounds=()=>({start:Date.parse(rows[0].date),end:Date.parse(rows.at(-1).date)});
function context(canvas){const dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=canvas.clientHeight;canvas.width=w*dpr;canvas.height=h*dpr;const c=canvas.getContext('2d');c.scale(dpr,dpr);return {c,w,h};}
function draw(){
 if(!visible.length)return;
 const {c,w,h}=context($('chart')),{left,right}=chartInsets(w),top=10,bottom=32,pw=w-left-right,ph=h-top-bottom;
 const start=Date.parse(windowRange.start),end=Date.parse(windowRange.end),scale=createTradingScale(windowRange.calendar,windowRange.frequency,left,pw),x=scale.x,y=v=>top+(100-v)/100*ph;
 plot={left,right,top,bottom,pw,ph,x,y,w,h,start,end,scale};
 const bands=[[75,100,'#eaf5f1','Extreme greed'],[55,75,'#f2f8f5','Greed'],[45,55,'#f7f8f8','Neutral'],[25,45,'#fcf8ef','Fear'],[0,25,'#fcf1eb','Extreme fear']];
 c.save();c.font='8px Segoe UI, sans-serif';c.textAlign='right';c.textBaseline='middle';
 for(const [lo,hi,color,label] of bands){c.fillStyle=color;c.fillRect(left,y(hi),w-left,y(lo)-y(hi));c.fillStyle='#87948f';c.fillText(label,w-5,y((lo+hi)/2));}
 c.font='10px Segoe UI, sans-serif';c.textAlign='left';
 for(const tick of [0,25,50,75,100]){c.strokeStyle='#ffffff99';c.lineWidth=.6;c.beginPath();c.moveTo(left,y(tick));c.lineTo(w,y(tick));c.stroke();}
 c.restore();c.font='10px Segoe UI, sans-serif';
 c.save();c.strokeStyle='#d05b4b';c.lineWidth=1.2;c.setLineDash([]);c.beginPath();c.moveTo(left,y(10));c.lineTo(w-right,y(10));c.stroke();c.restore();
 const cutoff=Date.parse(OFFICIAL_START);if(cutoff>start&&cutoff<end){c.save();c.setLineDash([4,4]);c.strokeStyle='#819da8';c.beginPath();c.moveTo(x(OFFICIAL_START),top);c.lineTo(x(OFFICIAL_START),h-bottom);c.stroke();c.restore();c.fillStyle='#5d7b88';c.textAlign='left';c.fillText('CNN 官方数据 →',x(OFFICIAL_START)+6,top+12);}
 c.strokeStyle='#273e46';c.lineWidth=1.25;c.lineJoin='round';c.beginPath();visible.forEach((r,i)=>i?c.lineTo(x(r.date),y(r.score)):c.moveTo(x(r.date),y(r.score)));c.stroke();
 c.fillStyle='#8b959c';for(const tick of scale.ticks(w<500?3:6)){c.textAlign='center';const d=new Date(tick.date+'T00:00:00Z');const label=d.toLocaleDateString('zh-CN',scale.dates.length<90?{month:'short',day:'numeric',timeZone:'UTC'}:{month:'short',year:'2-digit',timeZone:'UTC'});c.fillText(label,Math.max(c.measureText(label).width/2+2,tick.x),h-9);}

 if(crossDate){c.save();c.setLineDash([3,4]);c.strokeStyle='#7f949d';c.beginPath();c.moveTo(x(crossDate),top);c.lineTo(x(crossDate),h-bottom);c.stroke();c.restore();}
 if(hover>=0&&visible[hover]){const r=visible[hover],px=x(r.date),py=y(r.score);c.save();c.setLineDash([3,4]);c.strokeStyle='#7f949d';c.beginPath();c.moveTo(px,top);c.lineTo(px,h-bottom);c.stroke();c.restore();c.fillStyle='#19374a';c.beginPath();c.arc(px,py,3,0,Math.PI*2);c.fill();}
}
function mini(){const {c,w,h}=context($('mini'));c.strokeStyle='#91a8b5';c.lineWidth=.8;c.beginPath();rows.forEach((r,i)=>{const x=i/(rows.length-1)*w,y=3+(100-r.score)/100*(h-6);i?c.lineTo(x,y):c.moveTo(x,y);});c.stroke();}
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
async function load(){const response=await fetch('./data/fear-greed.csv',{cache:'no-store'});if(!response.ok)throw Error('无法读取本地数据');const parsed=parseCSV(await response.text());rows=parsed;$('timeline').min=Math.min(30,rows.length-1);$('timeline').max=rows.length-1;$('timeline').value=rows.length-1;render();await loadHealth();}
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
const deploymentReady=fetch('./deployment.json',{cache:'no-store'}).then(async response=>{
 if(!response.ok)throw Error('无法确认部署模式');
 const data=await response.json();return data.mode==='local'?'local':'static';
}).catch(()=>'static');
async function loadHealth(){
 try{const response=await fetch('./data/status.json',{cache:'no-store'});$('status').textContent=healthSummary(response.ok?await response.json():null);}
 catch{$('status').textContent='无法检查数据更新状态，请核对各图的数据日期。';}
}
deploymentReady.then(mode=>{$('refresh').querySelector('span').textContent=mode==='static'?'检查更新':'更新数据';});
$('refresh').addEventListener('click',async()=>{
 const button=$('refresh');button.disabled=true;button.querySelector('span').textContent='检查中…';
 const mode=await deploymentReady;
 try{
  if(mode==='local'){
   $('status').textContent='正在同步情绪指数与 ETF 行情…';
   const response=await fetch('./api/refresh',{method:'POST'}),result=await response.json();
   if(!response.ok)throw Error(result.error||'更新失败，已保留本地数据');
  }
  await load();await invalidateMarket();await loadHealth();
 }catch(error){$('status').textContent=error.message||'检查失败，已保留本地数据。';}
 finally{button.disabled=false;button.querySelector('span').textContent=mode==='static'?'检查更新':'更新数据';}
});
$('download').addEventListener('click',()=>{const csv='Date,Fear Greed,Rating,Source\n'+visible.map(r=>[r.date,r.score,rating(r.score),r.source].join(',')).join('\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='fear-greed-'+visible[0].date+'-'+visible.at(-1).date+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
new ResizeObserver(()=>{if(rows.length){draw();mini();}}).observe($('chart-wrap'));
window.addEventListener('market-hover',event=>{hover=-1;crossDate=event.detail;$('tooltip').hidden=true;draw();});

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
window.addEventListener('market-calendar',event=>{marketCalendar=event.detail;if(rows.length)render();});
loadMarket();
load().catch(error=>{$('status').textContent=error.message+'。请检查本地数据文件后刷新页面。';});

