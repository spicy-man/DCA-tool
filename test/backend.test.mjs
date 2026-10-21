import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {refreshAll,parseCNN,CNN_URL,ARCHIVE_URL} from '../server/updater.mjs';
import {withDataLock} from '../server/storage.mjs';
import {latestClosedSession,sessionClose,isTradingDay} from '../public/js/domain/trading-calendar.mjs';
import {normalizeYahoo,SYMBOLS} from '../public/js/domain/market.mjs';
import {healthSummary} from '../public/js/domain/data-health.mjs';
import {createServer} from '../server/http-server.mjs';
const now=Date.parse('2025-01-06T23:00:00Z');
const dates=['2025-01-02','2025-01-03','2025-01-06'];
const csv=ds=>'Date,Fear Greed,Rating\n2021-01-29,40,Fear\n'+ds.map(d=>d+',50,Neutral').join('\n')+'\n';
function yahoo(symbol,ds=dates){return {chart:{result:[{meta:{symbol,currency:'USD'},timestamp:ds.map(d=>Date.parse(d+'T15:00:00Z')/1000),indicators:{quote:[{open:ds.map(()=>100),high:ds.map(()=>110),low:ds.map(()=>90),close:ds.map(()=>100),volume:ds.map(()=>10)}],adjclose:[{adjclose:ds.map(()=>95)}]}}],error:null}};}
const cnn=ds=>({fear_and_greed_historical:{data:ds.map(d=>({x:Date.parse(d+'T00:00:00Z'),y:50}))}});
async function dir(t){const d=await mkdtemp(path.join(os.tmpdir(),'dca-backend-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
async function seed(d){await writeFile(path.join(d,'fear-greed.csv'),csv(dates.slice(0,2)));for(const symbol of SYMBOLS)await writeFile(path.join(d,symbol.toLowerCase()+'.json'),JSON.stringify(normalizeYahoo(yahoo(symbol,dates.slice(0,2)),symbol,now)));}
function source(url){if(url===CNN_URL)return JSON.stringify(cnn(dates));if(url===ARCHIVE_URL)return csv(dates);return JSON.stringify(yahoo(new URL(url).pathname.split('/').at(-1)));}
const opts=d=>({dataDir:d,now,wait:async()=>{}});
test('交易日历：夏冬时、收盘缓冲、周末及未来调度',()=>{
 assert.equal(sessionClose('2026-10-16'),Date.parse('2026-10-16T20:00Z'));
 assert.equal(sessionClose('2026-11-02'),Date.parse('2026-11-02T21:00Z'));
 assert.equal(latestClosedSession(Date.parse('2026-10-16T20:02:59Z')),'2026-10-15');
 assert.equal(latestClosedSession(Date.parse('2026-10-16T20:03Z')),'2026-10-16');
 assert.equal(latestClosedSession(Date.parse('2026-10-17T02:17Z')),'2026-10-16');
 assert.equal(latestClosedSession(Date.parse('2026-10-19T10:00Z')),'2026-10-16');
});
test('交易日历：节日补休、特殊休市及提前收盘',()=>{
 for(const d of ['2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25','2025-01-09'])assert.equal(isTradingDay(d),false,d);
 assert.equal(isTradingDay('2021-12-31'),true);
 assert.equal(sessionClose('2026-11-27'),Date.parse('2026-11-27T18:00Z'));
 assert.equal(sessionClose('2026-12-24'),Date.parse('2026-12-24T18:00Z'));
 assert.equal(sessionClose('2025-07-03'),Date.parse('2025-07-03T17:00Z'));
});
test('跨纽约午夜后，昨夜已收盘数据可读；当天未收盘不纳入',()=>{
 assert.equal(normalizeYahoo(yahoo('SPY'),'SPY',Date.parse('2025-01-07T06:00Z')).anchorDate,'2025-01-06');
 assert.equal(normalizeYahoo(yahoo('SPY'),'SPY',Date.parse('2025-01-06T20:00Z')).anchorDate,'2025-01-03');
});
test('CNN UTC 日期标签不会错移一天，排除盘中，拒绝空分数与重复日',()=>{
 assert.deepEqual(parseCNN(cnn(dates),now).map(r=>r.date),dates);
 assert.equal(parseCNN(cnn(dates),Date.parse('2025-01-06T20:00Z')).at(-1).date,'2025-01-03');
 const bad=cnn(dates);bad.fear_and_greed_historical.data[0].y=null;assert.throws(()=>parseCNN(bad,now));
 assert.throws(()=>parseCNN(cnn([dates[0],dates[0]]),now));
});
test('指数与全部ETF更新成功，写入可追溯状态并保留早期历史',async t=>{
 const d=await dir(t);await seed(d);const status=await refreshAll({...opts(d),fetchText:async url=>source(url)});
 assert.equal(status.complete,true);assert.equal(status.expectedDate,'2025-01-06');
 assert.equal(status.results[0].source,'CNN');
 assert.ok((await readFile(path.join(d,'fear-greed.csv'),'utf8')).includes('2021-01-29'));
 assert.deepEqual(JSON.parse(await readFile(path.join(d,'status.json'),'utf8')),status);
 for(const symbol of SYMBOLS){const data=JSON.parse(await readFile(path.join(d,symbol.toLowerCase()+'.json'),'utf8'));assert.equal(data.symbol,symbol);assert.equal(data.rows.at(-1).close,100);}assert.deepEqual(status.results.map(r=>r.symbol),['Fear & Greed',...SYMBOLS]);
});
test('HTTP 成功但仍是昨天的数据，任务不得宣称已到齐',async t=>{
 const d=await dir(t);await seed(d);
 const status=await refreshAll({...opts(d),sentimentSource:'archive',fetchText:async url=>url===ARCHIVE_URL?csv(dates.slice(0,2)):JSON.stringify(yahoo(new URL(url).pathname.split('/').at(-1),dates.slice(0,2)))});
 assert.equal(status.complete,false);assert.ok(status.results.every(r=>r.ok&&!r.fresh));
 assert.match(healthSummary(status,now),/等待更新/);
 assert.ok(status.results.every(r=>r.message.includes('2025-01-06')));
});

test('已收盘日价格为空：保留有效历史，明确缺失日期，不用即时价格补齐',async t=>{
 const d=await dir(t);await seed(d);
 const status=await refreshAll({...opts(d),fetchText:async url=>{
  if(!url.includes('/SPY?'))return source(url);
  const payload=yahoo('SPY');const result=payload.chart.result[0];
  result.meta.regularMarketPrice=123;
  result.indicators.quote[0].close[2]=null;
  result.indicators.adjclose[0].adjclose[2]=null;
  return JSON.stringify(payload);
 }});
 const spy=status.results.find(r=>r.symbol==='SPY');
 assert.equal(status.complete,false);assert.equal(spy.ok,true);assert.equal(spy.fresh,false);
 assert.equal(spy.date,'2025-01-03');assert.match(spy.message,/Yahoo 日线价格或复权价格缺失：2025-01-06/);
 const saved=JSON.parse(await readFile(path.join(d,'spy.json'),'utf8'));
 assert.equal(saved.rows.length,2);assert.equal(saved.rows.at(-1).sourceClose,100);
 assert.match(healthSummary(status,now),/来源数据未到齐/);
 assert.doesNotMatch(healthSummary(status,Date.parse('2025-01-07T23:00Z')),/来源数据未到齐/);
});

test('CNN 被拒且备用存档滞后时保留两项诊断，不把抓取成功当作数据已更新',async t=>{
 const d=await dir(t);await seed(d);
 const status=await refreshAll({...opts(d),fetchText:async url=>{
  if(url===CNN_URL)throw Error('数据接口返回 418');
  if(url===ARCHIVE_URL)return csv(dates.slice(0,2));
  return source(url);
 }});
 const sentiment=status.results[0];
 assert.equal(status.complete,false);assert.equal(sentiment.ok,true);assert.equal(sentiment.fresh,false);
 assert.match(sentiment.message,/CNN 接口返回 418/);
 assert.match(sentiment.message,/来源有效数据截至 2025-01-03/);
});
test('CNN 不可用自动回退存档，不重复尝试被拒接口',async t=>{
 const d=await dir(t);await seed(d);let calls=0;
 const status=await refreshAll({...opts(d),fetchText:async url=>{if(url===CNN_URL){calls++;throw Error('HTTP 403');}return source(url);}});
 assert.equal(status.complete,true);assert.equal(calls,1);assert.equal(status.results[0].source,'whit3rabbit/fear-greed-data');
});
test('CNN 尚未更新时采用日期更新的备用存档',async t=>{
 const d=await dir(t);await seed(d);
 const status=await refreshAll({...opts(d),fetchText:async url=>url===CNN_URL?JSON.stringify(cnn(dates.slice(0,2))):source(url)});
 assert.equal(status.complete,true);assert.equal(status.results[0].source,'whit3rabbit/fear-greed-data');
});
test('部分来源失败不影响其他源，保留失败源原始字节',async t=>{
 const d=await dir(t);await seed(d);const original=await readFile(path.join(d,'qqq.json'),'utf8');let attempts=0;
 const status=await refreshAll({...opts(d),fetchText:async url=>{if(url.includes('/QQQ?')){attempts++;throw Error('HTTP 403');}return source(url);}});
 assert.equal(status.complete,false);assert.equal(status.results[1].fresh,true);assert.equal(status.results[2].ok,false);assert.equal(attempts,1);
 assert.equal(await readFile(path.join(d,'qqq.json'),'utf8'),original);
});
test('相同记录数但丢失历史日期仍拒绝替换',async t=>{
 const d=await dir(t);await seed(d);const original=await readFile(path.join(d,'spy.json'),'utf8');
 const status=await refreshAll({...opts(d),fetchText:async url=>url.includes('/SPY?')?JSON.stringify(yahoo('SPY',[dates[0],dates[2]])):source(url)});
 assert.equal(status.results[1].ok,false);assert.equal(await readFile(path.join(d,'spy.json'),'utf8'),original);
});
test('请求瞬时失败最多重试一次；每天首轮全历史重算复权',async t=>{
 const d=await dir(t);await seed(d);let count=0;
 const status=await refreshAll({...opts(d),fetchText:async url=>{
  if(!url.includes('/SPY?'))return source(url);
  if(++count===1)throw Error('timeout');const p=yahoo('SPY');p.chart.result[0].indicators.adjclose[0].adjclose=[80,90,95];return JSON.stringify(p);
 }});
 assert.equal(count,2);assert.equal(status.complete,true);
 const data=JSON.parse(await readFile(path.join(d,'spy.json'),'utf8'));assert.ok(Math.abs(data.rows[0].close-100*80/95)<1e-9);assert.equal(data.rows.at(-1).close,100);
});
test('已到齐的补抓跳过网络；手动更新仍请求各源',async t=>{
 const d=await dir(t);await seed(d);await refreshAll({...opts(d),fetchText:async url=>source(url)});
 const result=await refreshAll({...opts(d),skipFresh:true,fetchText:async()=>{throw Error('should not fetch');}});
 assert.equal(result.complete,true);assert.ok(result.results.every(r=>r.skipped));
 let calls=0;await refreshAll({...opts(d),fetchText:async url=>{calls++;return source(url);}});assert.equal(calls,4);
});
test('进程内合并并发；跨进程锁阻止第二个写入者，结束释放锁',async t=>{
 const d=await dir(t);await seed(d);let release;const gate=new Promise(r=>{release=r;});
 const first=refreshAll({...opts(d),fetchText:async url=>{await gate;return source(url);}});
 assert.equal(first,refreshAll({...opts(d)}));release();await first;
 await withDataLock(d,async()=>{await assert.rejects(withDataLock(d,async()=>{}),/已有数据更新任务/);});
 await withDataLock(d,async()=>{});
});

test('FNG单独刷新接受同日历史修订，不请求或覆盖ETF及其检查状态',async t=>{
 const d=await dir(t);await seed(d);
 const first=await refreshAll({...opts(d),fetchText:async url=>source(url)});
 const original=await readFile(path.join(d,'spy.json'),'utf8');
 let calls=0;
 const status=await refreshAll({...opts(d),now:now+6*3600000,sources:['Fear & Greed'],fetchText:async url=>{
  calls++;assert.equal(url,CNN_URL);
  const revised=cnn(dates);revised.fear_and_greed_historical.data.at(-1).y=22;
  return JSON.stringify(revised);
 }});
 assert.equal(calls,1);assert.equal(status.complete,true);
 assert.match(await readFile(path.join(d,'fear-greed.csv'),'utf8'),/2025-01-06,22,/);
 assert.equal(await readFile(path.join(d,'spy.json'),'utf8'),original);
 assert.deepEqual(status.results.slice(1),first.results.slice(1));
});

test('K线第二轮强制请求并接收复权修订，不因日期已到齐跳过',async t=>{
 const d=await dir(t);await seed(d);
 const first=await refreshAll({...opts(d),fetchText:async url=>source(url)});
 let calls=0;
 const status=await refreshAll({...opts(d),sources:SYMBOLS,fetchText:async url=>{
  calls++;assert.notEqual(url,CNN_URL);assert.notEqual(url,ARCHIVE_URL);
  const payload=JSON.parse(source(url));payload.chart.result[0].indicators.adjclose[0].adjclose[0]=80;
  return JSON.stringify(payload);
 }});
 assert.equal(calls,3);assert.equal(status.complete,true);
 assert.deepEqual(status.results[0],first.results[0]);
 const saved=JSON.parse(await readFile(path.join(d,'spy.json'),'utf8'));
 assert.ok(Math.abs(saved.rows[0].close-100*80/95)<1e-9);
});
test('健康状态按浏览器当前日期重新判断，不能把旧 manifest 当成今日成功',()=>{
 const status={checkedAt:new Date(now).toISOString(),results:[{symbol:'SPY',date:'2025-01-06',ok:true,fresh:true}]};
 assert.match(healthSummary(status,Date.parse('2025-01-07T23:00Z')),/等待更新/);
});
test('本地 HTTP：部署模式、快照、跨站保护、方法及冷却防重复刷新',async t=>{
 const d=await dir(t);await seed(d);let calls=0;
 const server=createServer({dataDir:d,refresh:async()=>{calls++;return {complete:true,results:[{symbol:'SPY',ok:true,fresh:true,date:'2025-01-06'}]};}});
 server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 assert.equal((await (await fetch(base+'/deployment.json')).json()).mode,'local');
 assert.equal((await fetch(base+'/data/spy.json')).status,200);
 assert.equal((await fetch(base+'/api/refresh')).status,405);
 assert.equal((await fetch(base+'/api/refresh',{method:'POST',headers:{Origin:'https://untrusted.example'}})).status,403);
 assert.equal((await fetch(base+'/api/refresh',{method:'POST'})).status,200);
 assert.equal((await fetch(base+'/api/refresh',{method:'POST'})).status,200);assert.equal(calls,1);
 assert.equal((await fetch(base+'/data/.refresh.lock')).status,403);
});


test('刷新全部或部分失败可立即重试，成功后才进入冷却，并发仍合并', async t => {
  for (const partial of [false, true]) {
    let calls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const server = createServer({ refresh: async () => {
      calls++;
      if (calls === 1) {
        await gate;
        return { complete: false, results: [
          { symbol: 'SPY', ok: partial, fresh: partial },
          { symbol: 'QQQ', ok: false, fresh: false }
        ] };
      }
      return { complete: true, results: [{ symbol: 'SPY', ok: true, fresh: true }] };
    } });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    t.after(() => new Promise(resolve => server.close(resolve)));
    const url = 'http://127.0.0.1:' + server.address().port + '/api/refresh';
    const first = fetch(url, { method: 'POST' });
    // Wait until the request enters refresh, without depending on a fixed delay.
    while (!calls) await new Promise(resolve => setImmediate(resolve));
    release();
    assert.equal((await first).status, partial ? 200 : 502);
    assert.equal((await fetch(url, { method: 'POST' })).status, 200);
    assert.equal(calls, 2);
    await fetch(url, { method: 'POST' });
    assert.equal(calls, 2);
  }
});


test('ETF单独成功不能掩盖指数滞后，也不能刷新指数检查时间', async t => {
 const d=await dir(t);await seed(d);
 const first=await refreshAll({...opts(d),fetchText:async url=>url===CNN_URL?JSON.stringify(cnn(dates.slice(0,2))):url===ARCHIVE_URL?csv(dates.slice(0,2)):source(url)});
 const next=await refreshAll({...opts(d),now:now+3600000,sources:SYMBOLS,fetchText:async url=>source(url)});
 assert.equal(next.requestedComplete,true);assert.equal(next.complete,false);
 assert.deepEqual(next.results[0],first.results[0]);
 const text=healthSummary(next,now+3600000);
 assert.match(text,/整体数据：未全部到齐/);
 assert.match(text,/检查：2025-01-06 18:00:00 EST/);
 assert.match(text,/检查：2025-01-06 19:00:00 EST/);
});

test('跨交易日重新判断未选来源的日期，不沿用旧 fresh=true', async t => {
 const d=await dir(t);await seed(d);await refreshAll({...opts(d),fetchText:async url=>source(url)});
 const tomorrow=Date.parse('2025-01-07T23:00Z');
 const next=await refreshAll({...opts(d),now:tomorrow,sources:SYMBOLS,fetchText:async url=>JSON.stringify(yahoo(new URL(url).pathname.split('/').at(-1),[...dates,'2025-01-07']))});
 assert.equal(next.results[0].fresh,true);assert.equal(next.requestedComplete,true);assert.equal(next.complete,false);
});

test('补抓缺失指数能够恢复，失败时不覆盖快照且保留两源原因', async t => {
 const d=await dir(t);await seed(d);const original=await readFile(path.join(d,'fear-greed.csv'),'utf8');
 let cnnCalls=0;
 const failed=await refreshAll({...opts(d),sources:['Fear & Greed'],fetchText:async url=>{if(url===CNN_URL){cnnCalls++;throw Error('HTTP 418');}throw Error('HTTP 403');}});
 assert.equal(cnnCalls,1);assert.equal(failed.complete,false);
 assert.match(failed.results[0].error,/CNN 接口返回 418；备用存档 接口返回 403/);
 assert.equal(await readFile(path.join(d,'fear-greed.csv'),'utf8'),original);
 const recovered=await refreshAll({...opts(d),sources:['Fear & Greed'],fetchText:async url=>source(url)});
 assert.equal(recovered.requestedComplete,true);assert.equal(recovered.results[0].date,dates.at(-1));
});

test('CNN瞬时失败重试一次，严格CNN模式保留安全的拒绝原因', async t => {
 const d=await dir(t);await seed(d);let calls=0;
 const recovered=await refreshAll({...opts(d),sources:['Fear & Greed'],fetchText:async url=>{calls++;if(calls===1)throw Error('timeout');return source(url);}});
 assert.equal(calls,2);assert.equal(recovered.requestedComplete,true);
 assert.equal(recovered.results[0].source,'CNN');
 const failed=await refreshAll({...opts(d),sentimentSource:'cnn',sources:['Fear & Greed'],fetchText:async()=>{throw Error('HTTP 418 private-secret');}});
 assert.match(failed.results[0].error,/CNN 接口返回 418/);assert.doesNotMatch(failed.results[0].error,/private-secret/);
});


test('官网实时尾点不混入日历史，同日重复日标签仍拒绝，盘中日期仍排除', () => {
 const payload=cnn(dates);payload.fear_and_greed_historical.data.push({x:Date.parse('2025-01-06T23:40:15Z'),y:99});
 assert.equal(parseCNN(payload,now).at(-1).score,50);
 assert.equal(parseCNN(payload,Date.parse('2025-01-06T20:00Z')).at(-1).date,'2025-01-03');
 payload.fear_and_greed_historical.data.push({x:Date.parse('2025-01-06'),y:51});
 assert.throws(()=>parseCNN(payload,now));
});

test('CNN滚动窗口保留更早历史，修订重叠日期，缺少窗口内已有日期拒绝替换', async t => {
 const d=await dir(t);await seed(d);
 const result=await refreshAll({...opts(d),sources:['Fear & Greed'],sentimentSource:'cnn',fetchText:async()=>{
  const payload=cnn(dates.slice(1));payload.fear_and_greed_historical.data[0].y=27.2;
  payload.fear_and_greed_historical.data.push({x:Date.parse('2025-01-06T23:40Z'),y:99});
  return JSON.stringify(payload);
 }});
 assert.equal(result.requestedComplete,true);
 const saved=await readFile(path.join(d,'fear-greed.csv'),'utf8');
 assert.match(saved,/2021-01-29/);assert.match(saved,/2025-01-02/);assert.match(saved,/2025-01-03,27.2,/);assert.doesNotMatch(saved,/,99,/);
 const failed=await refreshAll({...opts(d),sources:['Fear & Greed'],sentimentSource:'cnn',fetchText:async()=>JSON.stringify(cnn([dates[0],dates[2]]))});
 assert.equal(failed.requestedComplete,false);assert.equal(await readFile(path.join(d,'fear-greed.csv'),'utf8'),saved);
});
