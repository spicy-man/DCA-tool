import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {daysInMonth,previousMonthCutoff,pyramidMultiple,calculatePyramidSignals} from '../public/js/domain/pyramid-strategy.mjs';
const bar=(date,close=100,high=100)=>({date,close,high});
test('日历月回看包含边界，月底对齐，覆盖闰年和跨年',()=>{for(const [date,cutoff] of [['2025-02-28','2025-01-31'],['2024-02-29','2024-01-31'],['2024-03-31','2024-02-29'],['2025-03-30','2025-02-28'],['2025-04-30','2025-03-31'],['2025-01-31','2024-12-31']])assert.equal(previousMonthCutoff(date),cutoff);assert.equal(daysInMonth(2000,2),29);assert.equal(daysInMonth(2100,2),28);});
test('回撤临界值与最高 38N 严格对应 Pine 规则',()=>{assert.deepEqual([0,.049999,.05,.10,.15,.20,.95,.999].map(v=>pyramidMultiple(v).multiple),[1,1,2,4,6,8,38,38]);assert.equal(pyramidMultiple(.05-1e-12).multiple,2);});
test('包括当天 high，按 close 回撤，cutoff 当天保留且更早高价移除',()=>{const rows=[bar('2025-01-30',150,200),bar('2025-01-31',95,100),bar('2025-02-28',80,90)];const result=calculatePyramidSignals(rows,{buyDay:28,baseAmount:1000}).at(-1);assert.equal(result.monthHigh,100);assert.equal(result.multiple,8);assert.equal(result.amount,8000);const today=calculatePyramidSignals([bar('2025-05-01',95,110)]).at(-1);assert.equal(today.multiple,4);});
test('31 日跨月顺延不占用下月计划，三月月底仍买入',()=>{const rows=['2026-01-30','2026-02-02','2026-02-27','2026-03-02','2026-03-31','2026-04-01'].map(d=>bar(d));assert.deepEqual(calculatePyramidSignals(rows,{buyDay:31}).map(s=>s.date),['2026-02-02','2026-03-02','2026-03-31']);});
test('不存在的月日对齐到月底，不会额外补一笔',()=>{const rows=['2025-01-31','2025-02-28','2025-03-03','2025-03-31'].map(d=>bar(d));assert.deepEqual(calculatePyramidSignals(rows,{buyDay:31}).map(s=>s.date),['2025-01-31','2025-02-28','2025-03-31']);});
test('月初休市顺延，第一条历史不足当月时仍按 Pine 首条行为计算',()=>{const rows=['2026-05-29','2026-06-02','2026-06-03','2026-07-01'].map(d=>bar(d));assert.deepEqual(calculatePyramidSignals(rows).map(s=>s.date),['2026-05-29','2026-06-02','2026-07-01']);});
test('拒绝非法定投参数与无序数据',()=>{for(const buyDay of [0,32,1.5])assert.throws(()=>calculatePyramidSignals([],{buyDay}));for(const baseAmount of [0,.001,NaN,Infinity])assert.throws(()=>calculatePyramidSignals([],{baseAmount}));assert.throws(()=>calculatePyramidSignals([bar('2025-02-01'),bar('2025-01-01')]));});
// Independent timestamp-based reference, rather than calling the implementation's calendar helpers.
function reference(rows,buyDay,n){
 const output=[];if(!rows.length)return output;
 const first=new Date(rows[0].date+'T00:00:00Z');
 for(let month=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),1));month.toISOString().slice(0,10)<=rows.at(-1).date;month.setUTCMonth(month.getUTCMonth()+1)){
 const year=month.getUTCFullYear(),m=month.getUTCMonth(),last=new Date(Date.UTC(year,m+1,0)).getUTCDate();
 const scheduledDate=new Date(Date.UTC(year,m,Math.min(buyDay,last))).toISOString().slice(0,10);
 const r=rows.find(row=>row.date>=scheduledDate);if(!r)continue;
 const d=new Date(r.date+'T00:00:00Z'),day=d.getUTCDate(),endOfMonth=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate(),prevLast=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),0)).getUTCDate();
 const cutoff=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()-1,day===endOfMonth?prevLast:Math.min(day,prevLast))).toISOString().slice(0,10);
 const high=Math.max(...rows.filter(row=>row.date>=cutoff&&row.date<=r.date).map(row=>row.high));
 const level=Math.min(19,Math.floor((Math.max(0,1-r.close/high)+1e-10)/.05)),multiple=level?2*level:1;
 output.push({date:r.date,multiple,amount:n*multiple});
 }
 return output;
}

test('SPY/QQQ 真实历史对照独立逐日参考计算，覆盖 6 种定投日且不使用未来数据',async()=>{for(const symbol of ['spy','qqq']){const data=JSON.parse(await readFile(new URL('../public/data/'+symbol+'.json',import.meta.url),'utf8'));for(const buyDay of [1,15,28,29,30,31]){const signals=calculatePyramidSignals(data.rows,{buyDay,baseAmount:123.45});assert.deepEqual(signals.map(({date,multiple,amount})=>({date,multiple,amount})),reference(data.rows,buyDay,123.45));const months=signals.map(s=>s.scheduledMonth);assert.equal(new Set(months).size,months.length);const prefix=data.rows.slice(0,1000);assert.deepEqual(calculatePyramidSignals(prefix,{buyDay,baseAmount:123.45}),signals.filter(s=>s.date<=prefix.at(-1).date));}}});

test('二月底休市：28 至 31 日均保留二月顺延及三月原定买入',()=>{
 for(const buyDay of [28,29,30,31]){
 const rows=['2026-02-27','2026-03-02','2026-03-27','2026-03-30','2026-03-31','2026-04-01'].map(d=>bar(d));
 const signals=calculatePyramidSignals(rows,{buyDay});
 assert.deepEqual(signals.map(s=>[s.scheduledMonth,s.date]),[['2026-02','2026-03-02'],['2026-03',buyDay<=30?'2026-03-30':'2026-03-31']]);
 assert.equal(signals[0].scheduledDate,'2026-02-28');assert.equal(signals[0].rolledDue,true);
 }
});
test('闰年 2 月 29 日休市顺延，三月定投不被吞掉',()=>{
 const signals=calculatePyramidSignals(['2020-02-28','2020-03-02','2020-03-30','2020-03-31'].map(d=>bar(d)),{buyDay:31});
 assert.deepEqual(signals.map(s=>[s.scheduledDate,s.date]),[['2020-02-29','2020-03-02'],['2020-03-31','2020-03-31']]);
});
test('多年代 28 至 31 日定投逐月不漏投，未到执行日不提前生成',()=>{
 for(const year of [2019,2020,2021,2024,2026]){
 const rows=[];for(let d=new Date(Date.UTC(year,0,1));d<=new Date(Date.UTC(year+1,0,7));d.setUTCDate(d.getUTCDate()+1))if(d.getUTCDay()>0&&d.getUTCDay()<6)rows.push(bar(d.toISOString().slice(0,10)));
 for(const buyDay of [28,29,30,31]){
 const signals=calculatePyramidSignals(rows,{buyDay});
 assert.equal(signals.length,12);assert.equal(new Set(signals.map(s=>s.scheduledMonth)).size,12);
 for(const signal of signals){assert.equal(signal.date,rows.find(r=>r.date>=signal.scheduledDate).date);assert.equal(signal.amount,1000);}
 }
 }
});
