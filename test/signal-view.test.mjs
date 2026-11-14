import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSignalHistory, normalizeSignalStrategy, normalizeStatusStrategy } from '../public/js/domain/signal-view.mjs';
import { calculatePyramidSignals } from '../public/js/domain/pyramid-strategy.mjs';
import { calculateKDSignals, calculateKDSeries, kdMultiple, kdTierLevel } from '../public/js/domain/kd-strategy.mjs';
import { renderStrategySummary } from '../public/js/features/strategy/summary.mjs';

const rows=['2024-01-02','2024-01-05','2024-02-01','2024-02-02','2024-03-01','2024-03-04'].map((date,i)=>({date,open:100-i*5,high:105-i*5,low:90-i*5,close:100-i*5}));
const options={monthWeight:80,quarterWeight:20,period:9,signal:3,tierFactor:1.5};

test('五策略筛选独立，KD＋恐慌叠加两类信号，切换不修改原始回测信号',()=>{
 const monthlySignals=calculatePyramidSignals(rows,{baseAmount:1000}),kdSignals=calculateKDSignals(rows,monthlySignals,{baseAmount:1000,...options}),fearSignals=[{date:'2024-02-02',amount:3000,multiple:3,type:'fear'}];
 const inputs={monthlySignals,kdSignals,fearSignals,baseAmount:1000},before=JSON.stringify(inputs);
 const regular=selectSignalHistory('regular',inputs),kd=selectSignalHistory('kd',inputs),pyramid=selectSignalHistory('pyramid',inputs),combined=selectSignalHistory('combined',inputs),kdFear=selectSignalHistory('kdFear',inputs);
 assert.ok(regular.every(s=>s.amount===1000&&s.multiple===1&&s.strategy==='regular'));
 assert.deepEqual(kd.map(s=>s.amount),kdSignals.map(s=>s.amount));assert.ok(kd.every(s=>s.strategy==='kd'&&s.type==='monthly'));
 assert.deepEqual(pyramid.map(s=>s.amount),monthlySignals.map(s=>s.amount));assert.equal(combined.length,pyramid.length+1);
 assert.deepEqual(kdFear.filter(s=>s.type==='monthly').map(s=>s.amount),kdSignals.map(s=>s.amount));assert.deepEqual(kdFear.filter(s=>s.type==='fear'),fearSignals);assert.equal(kdFear.length,kd.length+fearSignals.length);
  assert.equal(JSON.stringify(inputs),before);assert.equal(normalizeSignalStrategy('invalid'),'kdFear');
 assert.equal(normalizeSignalStrategy('kdFear'),'kdFear');
 assert.equal(normalizeStatusStrategy('kd'),'kdFear');assert.equal(normalizeStatusStrategy('pyramid'),'combined');
 for(const strategy of ['regular','pyramid','combined','kd','kdFear'])assert.deepEqual(selectSignalHistory(strategy,{baseAmount:0}),[]);
});

test('策略摘要随策略、区间与待确认状态更新，数据失效时清空',t=>{
 const previous=globalThis.document,nodes=new Map();globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,setAttribute(){}});return nodes.get(id);}};t.after(()=>{globalThis.document=previous;});
 const text=id=>nodes.get(id).textContent,settings={baseAmount:1000,buyDay:1,fearThreshold:10},range={start:rows[0].date,end:rows.at(-1).date},monthlySignals=calculatePyramidSignals(rows,settings),kdSignals=calculateKDSignals(rows,monthlySignals,{...options,baseAmount:1000}),fear={disabled:false,latest:{date:'2024-03-04',score:9},armed:false,rearmThreshold:15,pending:[]};
 const input={monthlySignals,kdSignals,fearSignals:[{date:'2024-02-02',amount:3000,multiple:3,type:'fear'}],baseAmount:1000},data={symbol:'TEST',rows};
 for(const strategy of ['regular','pyramid','combined','kd','kdFear']){
   const signals=selectSignalHistory(strategy,input);renderStrategySummary(data,range,settings,signals,fear,{strategy,kdOptions:options});
   if(strategy==='regular'){assert.match(text('funding-total'),/3,000\.00/);assert.doesNotMatch(text('funding-split'),/金字塔|恐慌/);}
   if(strategy==='kd'){
     const state=calculateKDSeries(rows,options).get(rows.at(-1).date);
     assert.equal(text('fear-state'),state.weightedK.toFixed(2));
     assert.ok(text('next-plan-estimate').includes(kdMultiple(state.weightedK,1.5)+'N'));
     assert.match(text('next-plan-estimate-note'),new RegExp(`^加权K ${state.weightedK.toFixed(2)}，第 ${kdTierLevel(state.weightedK)} 档（\\d+–\\d+）\\n自 ATH 回撤 \\d+\\.\\d{2}%$`));
     assert.doesNotMatch(text('next-plan-estimate-note'),/金额可能变化|未计未来/);
     assert.match(text('funding-split'),/加权K额外投入/);assert.doesNotMatch(text('funding-split'),/金字塔|恐慌/);
   }
   if(strategy==='combined'||strategy==='kdFear')assert.match(text('fear-state'),/9\.00/);
   if(strategy==='kdFear'){
     const expected=(kdSignals.reduce((sum,s)=>sum+s.amount,3000)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
     assert.ok(text('funding-total').startsWith(expected));
     assert.match(text('funding-split'),/加权K额外投入/);assert.match(text('funding-split'),/恐慌加投/);
   }
 }
 renderStrategySummary(data,{start:'2024-01-01',end:'2024-01-31'},settings,selectSignalHistory('combined',input),fear,{strategy:'combined'});
 assert.match(text('funding-total'),/1,000\.00/);
 assert.equal(text('recent-signal'),'2024-03-01');
 const oct=[{date:'2026-10-06',high:762.86,close:760},{date:'2026-10-26',high:714,close:712.2},{date:'2026-10-27',high:720,close:718}];
 const octSignals=calculatePyramidSignals(oct,{buyDay:25,baseAmount:2000}).map(s=>({...s,type:'monthly'}));
 renderStrategySummary({symbol:'QQQ',rows:oct},{start:'2026-10-01',end:'2026-10-27'},{...settings,buyDay:25,baseAmount:2000},octSignals,fear,{strategy:'combined'});
 assert.match(text('next-plan'),/^2026-11-25（/);
 assert.match(text('next-plan-estimate-note'),/自 ATH 回撤 5\.88%/);
 assert.equal(nodes.get('next-plan-help').hidden,false);
 renderStrategySummary({symbol:'QQQ',rows:[...oct,{date:'2026-11-02',high:1000,close:718}]},{start:'2026-10-01',end:'2026-10-27',replay:true},{...settings,buyDay:25,baseAmount:2000},octSignals,fear,{strategy:'combined'});
 assert.match(text('next-plan-estimate-note'),/自 ATH 回撤 5\.88%/);
 renderStrategySummary(data,range,settings,[],{...fear,pending:[{amount:3000}]});
 assert.match(text('fear-state-note'),/TEST 3,000\.00/);
 renderStrategySummary(data,range,settings,[],{...fear,armed:true,latest:{date:'2024-03-04',score:33.46}});
 assert.match(text('fear-state'),/33\.46/);
 renderStrategySummary(null,null,settings,[],null,{strategy:'kd',kdOptions:options});
 assert.equal(text('next-plan-estimate'),'');assert.equal(text('funding-total'),'—');assert.equal(nodes.get('next-plan-help').hidden,true);assert.equal(text('fear-state-note'),'');
});
