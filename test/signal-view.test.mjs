import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSignalHistory, normalizeSignalStrategy, normalizeStatusStrategy } from '../public/js/domain/signal-view.mjs';
import { calculatePyramidSignals } from '../public/js/domain/pyramid-strategy.mjs';
import { calculateKDSignals, calculateKDSeries, kdMultiple } from '../public/js/domain/kd-strategy.mjs';
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
 assert.equal(JSON.stringify(inputs),before);assert.equal(normalizeSignalStrategy('invalid'),'combined');
 assert.equal(normalizeSignalStrategy('kdFear'),'kdFear');
 assert.equal(normalizeStatusStrategy('kd'),'kdFear');assert.equal(normalizeStatusStrategy('pyramid'),'combined');
 for(const strategy of ['regular','pyramid','combined','kd','kdFear'])assert.deepEqual(selectSignalHistory(strategy,{baseAmount:0}),[]);
});

test('状态及资金需求跟随策略，KD按已确认周线估算并展示当前参数；数据失效清空',t=>{
 const previous=globalThis.document,nodes=new Map();globalThis.document={getElementById(id){if(!nodes.has(id))nodes.set(id,{textContent:'',hidden:false,setAttribute(){}});return nodes.get(id);}};t.after(()=>{globalThis.document=previous;});
 const text=id=>nodes.get(id).textContent,settings={baseAmount:1000,buyDay:1,fearThreshold:10},range={start:rows[0].date,end:rows.at(-1).date},monthlySignals=calculatePyramidSignals(rows,settings),kdSignals=calculateKDSignals(rows,monthlySignals,{...options,baseAmount:1000}),fear={disabled:false,latest:{date:'2024-03-04',score:9},armed:false,rearmThreshold:15,pending:[]};
 const input={monthlySignals,kdSignals,fearSignals:[{date:'2024-02-02',amount:3000,multiple:3,type:'fear'}],baseAmount:1000},data={symbol:'TEST',rows};
 for(const strategy of ['regular','pyramid','combined','kd','kdFear']){
   const signals=selectSignalHistory(strategy,input);renderStrategySummary(data,range,settings,signals,fear,{strategy,kdOptions:options});
   if(strategy==='regular'){assert.equal(text('fear-state'),'每月固定1N');assert.equal(text('next-plan-estimate'),'固定买入 1N · 1,000.00');assert.equal(text('funding-total'),'3,000.00（3N）');assert.doesNotMatch(text('funding-split'),/金字塔|恐慌/);}
   if(strategy==='kd'){
     const state=calculateKDSeries(rows,options).get(rows.at(-1).date);assert.equal(text('fear-state'),state.weightedK.toFixed(2));
     assert.match(text('next-plan-estimate'),new RegExp('暂估买入 '+kdMultiple(state.weightedK,1.5)+'N'));
     assert.match(text('next-plan-estimate-note'),/80%.*20%.*1.5.*计划日收盘/);assert.match(text('funding-split'),/KD额外投入/);assert.doesNotMatch(text('funding-split'),/金字塔|恐慌/);
     assert.equal(text('recent-signal'),kdSignals.at(-1).date);assert.match(text('recent-signal-note'),/KD定投/);
   }
   if (strategy === 'combined' || strategy === 'kdFear') {
     assert.equal(text('strategy-state-label'), '恐慌加投状态（2024-03-04）');
     assert.equal(text('fear-state'), '等待回升至 15 点重置 · 当前 9.00');
     assert.equal(text('fear-state-note'), '暂无待确认加投');
   }
   if(strategy==='kdFear'){
     const state=calculateKDSeries(rows,options).get(rows.at(-1).date);
     assert.doesNotMatch(text('recent-signal-note'), /信号K/);
     assert.match(text('next-plan-estimate'),new RegExp('暂估买入 '+kdMultiple(state.weightedK,1.5)+'N'));
     assert.match(text('next-plan-estimate-note'),/未计未来可能触发的恐慌加投/);
     assert.match(text('funding-split'),/KD额外投入/);assert.match(text('funding-split'),/恐慌加投/);
     assert.equal(text('funding-total'),(kdSignals.reduce((sum,s)=>sum+s.amount,3000)).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+'（'+(kdSignals.reduce((sum,s)=>sum+s.amount,3000)/1000).toLocaleString('en-US',{maximumFractionDigits:2})+'N）');
   }
 }
 renderStrategySummary(data, range, settings, [], { ...fear, pending: [{ amount: 3000 }] });
 assert.equal(text('fear-state-note'), '已触发加投 · 执行日待确认\nTEST 3,000.00');
 renderStrategySummary(data, range, settings, [], { ...fear, armed: true, latest: { date: '2024-03-04', score: 33.46 } });
 assert.equal(text('fear-state'), '等待下穿 10 点 · 当前 33.46');
 renderStrategySummary(null,null,settings,[],null,{strategy:'kd',kdOptions:options});assert.equal(text('fear-state'),'等待行情数据');assert.equal(text('next-plan-estimate'),'');assert.equal(text('funding-total'),'—');
});
