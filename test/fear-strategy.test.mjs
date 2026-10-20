import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateFearSignals,evaluateFearStrategy} from '../public/js/domain/fear-strategy.mjs';
import {calculatePyramidSignals} from '../public/js/domain/pyramid-strategy.mjs';
import {parseCSV} from '../public/js/domain/sentiment.mjs';
import {signalTooltipRows} from '../public/js/features/strategy/overlay.mjs';
const series=scores=>scores.map((score,i)=>({date:`2025-01-${String(i+1).padStart(2,'0')}`,score}));
const market=dates=>dates.map(date=>({date,close:100,high:100}));
test('下穿采用原始小数，等于阈值不触发，信号后首个交易日执行',()=>{
 const signals=calculateFearSignals(market(['2025-01-02','2025-01-03','2025-01-06']),series([12,10,9.99]),{baseAmount:123.45});
 assert.equal(signals.length,1);assert.equal(signals[0].signalDate,'2025-01-03');assert.equal(signals[0].date,'2025-01-06');assert.equal(signals[0].amount,123.45);assert.equal(signals[0].multiple,1);
});
test('持续低位与阈值附近震荡只触发一次，回升到15后才重置',()=>{
 const sentiment=series([16,9,7,10,9,14.99,9,15,10,9]);
 const signals=calculateFearSignals(market([...sentiment.map(r=>r.date),'2025-01-11']),sentiment);
 assert.deepEqual(signals.map(s=>s.signalDate),['2025-01-02','2025-01-10']);
});
test('可调阈值同步采用加5缓冲；首条已低于阈值不伪造下穿',()=>{
 const sentiment=series([9,8,17,12,11.9]);
 const signals=calculateFearSignals(market([...sentiment.map(r=>r.date),'2025-01-06']),sentiment,{fearThreshold:12});
 assert.deepEqual(signals.map(s=>s.signalDate),['2025-01-05']);assert.equal(signals[0].rearmThreshold,17);
});
test('上市前不补买，无后续完整行情不生成买入',()=>{
 assert.deepEqual(calculateFearSignals(market(['2025-01-05']),series([16,9,8])),[]);
 assert.deepEqual(calculateFearSignals(market(['2025-01-01','2025-01-02']),series([16,9])),[]);
});
test('月度定投同日仍独立保留，tooltip可同时展示两类金额',()=>{
 const rows=market(['2025-01-01','2025-01-02','2025-01-03']);
 const fear=calculateFearSignals(rows,series([16,9]));
 const monthly=calculatePyramidSignals(rows,{buyDay:3});
 assert.equal(fear[0].date,monthly[0].date);
 assert.equal(fear[0].amount+monthly[0].amount,2000);
 const details=signalTooltipRows([monthly[0],fear[0]]);
 assert.equal(details.filter(([key])=>key==='投入金额').length,2);
});
test('拒绝非法阈值、金额、分数及无序数据',()=>{
 for(const fearThreshold of [0,-1,95.1,NaN,Infinity])assert.throws(()=>calculateFearSignals([],[],{fearThreshold}));
 for(const baseAmount of [0,NaN,Infinity])assert.throws(()=>calculateFearSignals([],[],{baseAmount}));
 assert.throws(()=>calculateFearSignals([],series([NaN])));
 assert.throws(()=>calculateFearSignals([],series([16,9]).reverse()));
 assert.throws(()=>calculateFearSignals(market(['2025-01-02','2025-01-01']),[]));
});
test('真实SPY/QQQ/VGT历史信号与可知日期一致，截断未来行情不改变已执行信号',async()=>{
 const sentiment=parseCSV(await readFile(new URL('../public/data/fear-greed.csv',import.meta.url),'utf8'));
 for(const symbol of ['spy','qqq','vgt']){
  const {rows}=JSON.parse(await readFile(new URL('../public/data/'+symbol+'.json',import.meta.url),'utf8'));
  const signals=calculateFearSignals(rows,sentiment);assert.ok(signals.length>0);
  for(const signal of signals){assert.ok(signal.score<10);assert.ok(signal.previousScore>=10);assert.equal(rows.find(r=>r.date>signal.signalDate).date,signal.date);}
  const prefix=rows.slice(0,1000);assert.deepEqual(calculateFearSignals(prefix,sentiment.filter(s=>s.date<=prefix.at(-1).date)),signals.filter(s=>s.date<=prefix.at(-1).date));
 }
});


test('恐慌加投笔数按次放大金额，保留原触发日期与重置规则',()=>{
 const sentiment=series([16,9,8,15,9]);
 const rows=market([...sentiment.map(r=>r.date),'2025-01-06']);
 const defaults=calculateFearSignals(rows,sentiment,{baseAmount:123.45});
 const scaled=calculateFearSignals(rows,sentiment,{baseAmount:123.45,fearBuyCount:3});
 assert.deepEqual(scaled.map(s=>s.date),defaults.map(s=>s.date));
 assert.equal(scaled.length,2);
 assert.ok(scaled.every(s=>s.multiple===3&&Math.abs(s.amount-370.35)<1e-9));
 assert.ok(defaults.every(s=>s.multiple===1&&s.amount===123.45));
 assert.ok(signalTooltipRows(scaled[0]).some(([key,value])=>key==='买入（N）'&&value==='3N'));
 const pending=evaluateFearStrategy(market(['2025-01-01','2025-01-02']),series([16,9]),{baseAmount:123.45,fearBuyCount:3});
 assert.equal(pending.signals.length,0);
 assert.ok(Math.abs(pending.pending[0].amount-370.35)<1e-9);
 for(const fearBuyCount of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>calculateFearSignals([],[],{fearBuyCount}));
 }
 assert.throws(()=>calculateFearSignals([],[],{baseAmount:1e308,fearBuyCount:2}));
});
