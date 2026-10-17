export function daysInMonth(year,month){return new Date(Date.UTC(year,month,0)).getUTCDate();}
export function previousMonthCutoff(date){
 const [year,month,day]=date.split('-').map(Number),py=month===1?year-1:year,pm=month===1?12:month-1;
 const last=daysInMonth(py,pm),cutDay=day===daysInMonth(year,month)?last:Math.min(day,last);
 return `${py}-${String(pm).padStart(2,'0')}-${String(cutDay).padStart(2,'0')}`;
}
export function pyramidMultiple(drawdown){const level=Math.min(19,Math.floor((Math.max(0,drawdown)+1e-10)/.05));return {level,multiple:level===0?1:2*level};}
// Evaluate the entire available daily history before filtering to the visible chart.
// All input rows are completed New York trading sessions from the market-data cache.
export function calculatePyramidSignals(rows,{buyDay=1,baseAmount=1000}={}){
 if(!Number.isInteger(buyDay)||buyDay<1||buyDay>31||!Number.isFinite(baseAmount)||baseAmount<.01||!Number.isFinite(baseAmount*38))throw Error('定投日须为 1–31，N 须为不小于 0.01 的有效金额');
 const signals=[],window=[];let lastBuyMonth=null,previous=null;
 for(const row of rows){
 if(previous&&row.date<=previous.date)throw Error('策略日线必须按日期递增且不重复');
 if(!Number.isFinite(row.high)||row.high<=0||!Number.isFinite(row.close)||row.close<=0)throw Error('策略日线价格无效');
 const [year,month,day]=row.date.split('-').map(Number),monthKey=year*12+month,cutoff=previousMonthCutoff(row.date);
 window.push(row);while(window.length&&window[0].date<cutoff)window.shift();
 const monthHigh=Math.max(...window.map(r=>r.high)),drawdown=Math.max(0,1-row.close/monthHigh),{level,multiple}=pyramidMultiple(drawdown);
 const dueDay=Math.min(buyDay,daysInMonth(year,month));let rolledDue=false;
 if(previous){const [prevYear,prevMonth,prevDay]=previous.date.split('-').map(Number);rolledDue=monthKey!==prevYear*12+prevMonth&&prevDay<Math.min(buyDay,daysInMonth(prevYear,prevMonth));}
 if((lastBuyMonth===null||monthKey!==lastBuyMonth)&&(day>=dueDay||rolledDue)){
 lastBuyMonth=monthKey;signals.push({date:row.date,cutoff,monthHigh,drawdown,level,multiple,amount:baseAmount*multiple,buyDay,baseAmount,rolledDue});
 }
 previous=row;
 }
 return signals;
}
