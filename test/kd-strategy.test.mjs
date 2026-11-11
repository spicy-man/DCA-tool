import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateKDSignals, calculateKDSeries, normalizeKDOptions, kdMultiple } from '../public/js/domain/kd-strategy.mjs';
import { calculatePyramidSignals } from '../public/js/domain/pyramid-strategy.mjs';
import { compareStrategies, comparePortfolioStrategies } from '../public/js/domain/backtest.mjs';
import { isTradingDay, periodKey } from '../public/js/domain/trading-calendar.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<=Math.max(1e-8,Math.abs(b)*1e-10),`${a} != ${b}`);
function sample(start='2019-01-02',end='2026-11-10',flat=false){const rows=[];let i=0;for(let n=Date.parse(start);n<=Date.parse(end);n+=86400000){const date=new Date(n).toISOString().slice(0,10);if(!isTradingDay(date))continue;const close=flat?100:100+Math.sin(i/17)*25+i*.04;rows.push({date,open:close*.99,close,high:flat?close:close+5,low:flat?close:close-6});i++;}return rows;}
const signals=(rows,baseAmount=1000,buyDay=1)=>{const monthlySignals=calculatePyramidSignals(rows,{buyDay,baseAmount});return{monthlySignals,kdSignals:calculateKDSignals(rows,monthlySignals,{baseAmount})};};
const run=(rows,mode='actual',extra={})=>compareStrategies({rows,...signals(rows),fearSignals:[],baseAmount:1000,mode,range:{start:rows[0].date,end:rows.at(-1).date},...extra});

// Literal Pine reference: scan all weekly bars in the exact mapped window, seed
// RSV once and recursively smooth using the dynamic 3-period weekly-bar count.
function reference(rows,period,n=9,sig=3){
 const weeks=[];for(const row of rows){const key=periodKey(row.date,'weekly'),high=row.sourceHigh??row.high,low=row.sourceLow??row.low,close=row.sourceClose??row.close;let w=weeks.at(-1);if(!w||w.key!==key){w={key,date:row.date,end:row.date,high,low,close};weeks.push(w);}else{w.end=row.date;w.high=Math.max(w.high,high);w.low=Math.min(w.low,low);w.close=close;}}
 const starts=[],out=[];let k=null,previous='';for(let i=0;i<weeks.length;i++){const w=weeks[i],key=period==='M'?w.date.slice(0,7):w.date.slice(0,4)+'-'+Math.floor((Number(w.date.slice(5,7))-1)/3);if(key!==previous){starts.unshift(i);previous=key;}const length=count=>starts.length>=count?i-starts[count-1]+1:count*(period==='M'?4:13),window=weeks.slice(Math.max(0,i-length(n)+1),i+1),high=Math.max(...window.map(w=>w.high)),low=Math.min(...window.map(w=>w.low)),rsv=100*(w.close-low)/Math.max(high-low,1e-10),l=length(sig);k=k===null?rsv:(rsv+(l-1)*k)/l;out.push({...w,k});}return out;
}

test('KD全部10档、精确边界、权重和周期校验',()=>{
 for(const[k,n]of [[100,1],[90,1],[89.999999,2],[80,2],[70,4],[60,8],[50,16],[40,32],[30,64],[20,128],[10,256],[9.99999,512],[0,512]])assert.equal(kdMultiple(k,2),n);
 for(const o of [{monthWeight:60},{monthWeight:-1,quarterWeight:101},{period:0},{signal:1.5},{period:201}])assert.throws(()=>normalizeKDOptions(o));
 const rows=sample('2024-01-02','2024-03-01');for(const n of [-1,.001,NaN,Infinity])assert.throws(()=>calculateKDSignals(rows,[],{baseAmount:n}));assert.deepEqual(calculateKDSignals(rows,[],{baseAmount:0}),[]);
});

test('十进制周线价格恰好命中KD档线时不多买，真实低于档线仍进下一档', () => {
  for (const [low, high, close, expectedAmount] of [
    [18, 18.10, 18.09, 1000],
    [18, 18.20, 18.02, 25600],
    [18, 18.10, 18.089999999, 1500],
    [1000.09, 1000.19, 1000.18, 1000],
    [10, 10.0001, 10.00001, 25600],
    [10, 10.0001, 10.000009999999, 38400]
  ]) {
    const rows = [
      { date: '2024-02-02', open: low, high, low, close },
      { date: '2024-02-05', open: low, high: low, low, close: low }
    ];
    const { kdOrders } = run(rows, 'actual', signals(rows, 1000, 2));
    assert.equal(kdOrders.length, 1);
    assert.equal(kdOrders[0].amount, expectedAmount, `low=${low}, high=${high}, close=${close}`);
  }
});

test('分档系数支持1至3及小数，默认1.5和80/20，系数1与普通定投完全相同',()=>{
 assert.deepEqual(normalizeKDOptions(),{monthWeight:80,quarterWeight:20,period:9,signal:3,tierFactor:1.5});
 assert.equal(kdMultiple(0),38.4);
 assert.equal(normalizeKDOptions({monthWeight:40,quarterWeight:60,period:9,signal:3}).tierFactor,1.5);
 for(const factor of [1,1.1,1.5,2,2.75,3]){
   for(let level=0;level<10;level++)near(kdMultiple(95-10*level,factor),Math.round(factor**level*10)/10);
   near(kdMultiple(80,factor),Math.round(factor*10)/10);near(kdMultiple(79.99999,factor),Math.round(factor**2*10)/10);
 }
 assert.equal(kdMultiple(0,3),19683);assert.equal(kdMultiple(0,1.5),38.4);assert.equal(kdMultiple(70,1.5),2.3);
 for(const factor of [0,.99,3.01,NaN,Infinity,'2',null]){assert.throws(()=>normalizeKDOptions({tierFactor:factor}));assert.throws(()=>kdMultiple(50,factor));}
 const rows=sample('2020-01-02','2024-04-03'),monthlySignals=calculatePyramidSignals(rows,{baseAmount:1000,buyDay:1});
 for(const factor of [1,1.5,3]){
   const kdSignals=calculateKDSignals(rows,monthlySignals,{baseAmount:1000,tierFactor:factor});
   for(const s of kdSignals)near(s.amount,1000*(s.fallback?1:kdMultiple(s.weightedK,factor)));
   assert.deepEqual(calculateKDSeries(rows,{tierFactor:factor}),calculateKDSeries(rows));
   for(const mode of ['actual','equal']){
     const r=run(rows,mode,{monthlySignals,kdSignals});
     if(factor===1)for(const key of ['invested','equity','cash','cashInterest','profit','xirr','maxDrawdown','monthlyBought'])near(r.results[0][key],r.results.find(s=>s.id==='kd')[key]);
     if(mode==='equal')assert.equal(new Set(r.results.map(s=>s.invested)).size,1);
     assert.ok(r.results.every(s=>Number.isFinite(s.equity)&&s.cash>=-1e-8));
   }
 }
});

test('月/季度K与独立Pine递归参考一致，100/0及0/100权重可单独复现',()=>{
 const rows=sample(),m=reference(rows,'M'),q=reference(rows,'Q'),actual=calculateKDSeries(rows);for(let i=0;i<m.length;i++){const day=m[i].end;if(!isTradingDay(new Date(Date.parse(day)+86400000).toISOString().slice(0,10))||new Date(day).getUTCDay()===5){const state=actual.get(day);if(state?.signalDate===day){near(state.monthK,m[i].k);near(state.quarterK,q[i].k);near(state.weightedK,.8*m[i].k+.2*q[i].k);}}}
 for(const [monthWeight,quarterWeight,key]of [[100,0,'monthK'],[0,100,'quarterK']])for(const s of calculateKDSeries(rows,{monthWeight,quarterWeight}).values())if(s)near(s.weightedK,s[key]);
});

test('周五及节假日缩短周收盘后更新，周中绝不偷用本周未来高低价',()=>{
 const rows=sample('2020-10-01','2021-01-15'),states=calculateKDSeries(rows);assert.equal(states.get('2020-12-23').signalDate,'2020-12-18');assert.equal(states.get('2020-12-24').signalDate,'2020-12-24');assert.equal(states.get('2021-01-08').signalDate,'2021-01-08');
 const changed=rows.map(r=>r.date>='2020-12-24'?{...r,open:900,high:1000,low:800,close:950}:r),b=calculateKDSeries(changed);for(const r of rows.filter(r=>r.date<'2020-12-24'))assert.deepEqual(states.get(r.date),b.get(r.date));
 const prefix=rows.filter(r=>r.date<='2020-12-23');assert.deepEqual(calculateKDSeries(prefix).get('2020-12-23'),states.get('2020-12-23'));
});

test('K使用源HLC而非前复权账户估值价；平价无波幅时K=0且投入默认系数的9次方',()=>{
 const raw=sample('2024-01-02','2024-03-04'),transformed=raw.map((r,i)=>({...r,sourceHigh:r.high,sourceLow:r.low,sourceClose:r.close,high:r.high*(1+i/100),low:r.low*(1+i/100),close:r.close*(1+i/100)}));assert.deepEqual([...calculateKDSeries(raw)],[...calculateKDSeries(transformed)]);
 const flat=sample('2024-01-02','2024-03-04',true),a=signals(flat).kdSignals;assert.equal(a[0].multiple,1);assert.equal(a[0].fallback,true);assert.ok(a.slice(1).every(s=>s.multiple===38.4&&s.amount===38400));assert.throws(()=>calculateKDSeries([{...raw[0],low:-1}]));
});

test('KD与普通定投信号及次日开盘成交日相同，末日待成交不计资金',()=>{
 const rows=sample('2024-01-02','2024-04-01'),r=run(rows);const regular=r.results[0],kd=r.results.find(s=>s.id==='kd');assert.equal(kd.id,'kd');assert.equal(r.deferredKD,1);assert.equal(r.deferredMonthly,1);assert.equal(r.kdOrders.length,3);assert.equal(r.kdOrders[0].date,'2024-01-03');assert.ok(r.kdOrders.every(o=>o.date>o.signalDate));assert.equal(regular.invested,3000);near(kd.invested,r.kdOrders.reduce((n,o)=>n+o.amount,0));
 for(const buyDay of [1,15,28,29,30,31]){const s=signals(rows,1000,buyDay);assert.deepEqual(s.monthlySignals.map(s=>[s.date,s.scheduledMonth]),s.kdSignals.map(s=>[s.date,s.scheduledMonth]));}
});

test('KD＋恐慌叠加独立恐慌买入，同日合并需求，未成交KD信号不提前投入',()=>{
 const rows=sample('2024-01-02','2024-04-01',true),s=signals(rows);
 const fearDate=rows[rows.findIndex(r=>r.date===s.kdSignals[1].date)+1].date;
 const fearSignals=[{date:fearDate,amount:6000}];
 const actual=run(rows,'actual',{...s,fearSignals}),equal=run(rows,'equal',{...s,fearSignals});
 const kd=actual.results.find(r=>r.id==='kd'),combo=actual.results.find(r=>r.id==='kdFear');
 assert.equal(actual.results.length,5);
 assert.equal(actual.deferredKD,1);
 near(combo.monthlyBought,kd.monthlyBought+6000);
 near(combo.invested,kd.invested+6000);
 near(combo.maxMonthly,kd.maxMonthly+6000);
 near(combo.trades,kd.trades+6);
 assert.equal(combo.name,'KD 定投＋恐慌加投');
 assert.equal(new Set(equal.results.map(r=>r.invested)).size,1);
 const kdFill=actual.kdOrders.find(r=>r.date===fearDate);
 assert.ok(kdFill);
 near(equal.fundingPeak,kdFill.amount+6000);
});

test('组合回测的KD＋恐慌与单标的使用相同订单和供资口径',()=>{
 const rows=sample('2024-01-02','2024-04-03'),s=signals(rows);
 const fearDate=rows[rows.findIndex(r=>r.date===s.kdSignals[1].date)+1].date;
 const fearSignals=[{date:fearDate,amount:2500}];
 for(const mode of ['actual','equal']){
   const single=run(rows,mode,{...s,fearSignals});
   const portfolio=comparePortfolioStrategies({items:[{symbol:'A',rows,...s,fearSignals,baseAmount:1000}],startDate:rows[0].date,mode,totalBaseAmount:1000});
   const a=single.results.find(r=>r.id==='kdFear'),b=portfolio.results.find(r=>r.id==='kdFear');
   for(const key of ['invested','equity','cash','cashInterest','monthlyBought','maxMonthly','profit'])near(a[key],b[key]);
   near(single.fundingPeak??0,portfolio.fundingPeak??0);
 }
});

test('同供资计划取五策略同日需求最大值而非相加，KD与恐慌同日买入均计入需求',()=>{
 const rows=sample('2024-01-02','2024-04-03',true),s=signals(rows),fearSignals=[{date:'2024-02-02',amount:6000}],a=run(rows,'actual',{...s,fearSignals}),b=run(rows,'equal',{...s,fearSignals});assert.equal(b.results.length,5);assert.equal(new Set(b.results.map(s=>s.invested)).size,1);assert.ok(b.results[0].cash>0&&b.results[0].cashInterest>0);assert.ok(b.results.every(s=>s.cash>=-1e-8));
 const need=new Map();for(const o of s.monthlySignals){const next=rows[rows.findIndex(r=>r.date===o.date)+1];if(next)need.set(next.date,Math.max(need.get(next.date)||0,o.amount));}for(const o of b.kdOrders)need.set(o.date,Math.max(need.get(o.date)||0,o.amount));for(const o of fearSignals){const monthly=s.monthlySignals.filter(s=>rows[rows.findIndex(r=>r.date===s.date)+1]?.date===o.date).reduce((n,r)=>n+r.amount,0),kd=b.kdOrders.filter(r=>r.date===o.date).reduce((n,r)=>n+r.amount,0);need.set(o.date,Math.max(need.get(o.date)||0,monthly+o.amount,kd+o.amount));}near(b.results[0].invested,[...need.values()].reduce((n,v)=>n+v,0));const monthlyNeed=new Map();for(const[date,amount]of need)monthlyNeed.set(date.slice(0,7),(monthlyNeed.get(date.slice(0,7))||0)+amount);near(b.fundingPeak,Math.max(...monthlyNeed.values()));assert.ok(b.results[0].invested>a.results[0].invested);
});

test('组合回测加入KD且共同供资一致，旧调用仍保持原来三策略',()=>{
 const rows=sample('2023-01-03','2024-04-03'),s=signals(rows);const make=kd=>({symbol:'A',rows,...s,kdSignals:kd?s.kdSignals:null,fearSignals:[],baseAmount:1000});for(const mode of ['actual','equal']){const result=comparePortfolioStrategies({items:[make(true),{...make(true),symbol:'B'}],startDate:'2023-02-01',mode,totalBaseAmount:2000});assert.equal(result.results.length,5);assert.ok(result.results.every(r=>r.cash>=-1e-8&&Number.isFinite(r.equity)));if(mode==='equal')assert.equal(new Set(result.results.map(r=>r.invested)).size,1);}assert.equal(comparePortfolioStrategies({items:[make(false)],startDate:rows[0].date}).results.length,3);
});

test('五个模板标的资金、开盘买入份额与年化结果可复算，截断未来不改历史',()=>{
 for(const symbol of ['spy','qqq','vgt','smh','brk-b']){const rows=JSON.parse(fs.readFileSync(new URL('../public/data/'+symbol+'.json',import.meta.url))).rows,s=signals(rows),range={start:'2020-01-02',end:'2025-12-31'},r=run(rows,'actual',{...s,range}),regular=r.results[0],kd=r.results.find(s=>s.id==='kd');let shares=0;for(const order of r.kdOrders)shares+=order.amount/rows.find(r=>r.date===order.date).open;const last=rows.filter(r=>r.date>=range.start&&r.date<=range.end).at(-1);near(kd.equity,shares*last.close);near(kd.invested,r.kdOrders.reduce((n,o)=>n+o.amount,0));assert.ok(kd.invested>=regular.invested&&Number.isFinite(kd.xirr));const prefix=rows.filter(r=>r.date<=range.end),ps=signals(prefix);assert.deepEqual(r.kdOrders,run(prefix,'actual',{...ps,range}).kdOrders);}
});
