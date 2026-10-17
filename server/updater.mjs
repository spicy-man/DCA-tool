import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {fetchPublicText,yahooURL} from './network.mjs';
import {normalizeYahoo,SYMBOLS} from '../public/js/domain/market.mjs';
import {parseCSV,rating,OFFICIAL_START} from '../public/js/domain/sentiment.mjs';
import {latestClosedSession} from '../public/js/domain/trading-calendar.mjs';
import {readOptional,atomicWrite,preserveHistory,withDataLock} from './storage.mjs';
export const DEFAULT_DATA_DIR=fileURLToPath(new URL('../public/data/',import.meta.url));
export const ARCHIVE_URL='https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/fear-greed.csv';
export const CNN_URL='https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2021-02-01';
const pending=new Map();
const csv=rows=>'Date,Fear Greed,Rating\n'+rows.map(r=>[r.date,r.score,rating(r.score)].join(',')).join('\n')+'\n';
export function parseCNN(payload,now=Date.now()){
 const entries=payload?.fear_and_greed_historical?.data;
 if(!Array.isArray(entries)||!entries.length)throw Error('CNN 缺少历史数据');
 const latest=latestClosedSession(now,0);
 const text='Date,Fear Greed,Rating\n'+entries.map(r=>{
  if(!Number.isFinite(r.x)||!Number.isFinite(r.y))throw Error('CNN 日期或分数无效');
  // CNN historical x is a UTC date label, not a New York session timestamp.
  return [new Date(r.x).toISOString().slice(0,10),r.y,rating(r.y)].join(',');
 }).join('\n');
 const rows=parseCSV(text).filter(r=>r.date>=OFFICIAL_START&&r.date<=latest);
 if(!rows.length)throw Error('CNN 没有已收盘历史数据');
 return rows;
}
async function retry(task,wait){
 try{return await task();}catch(error){
  // Never attempt to work around an explicit access denial or rate limit.
  if(/\b(401|403|418|429)\b/.test(error.message))throw error;
  await wait(1500);return task();
 }
}
async function snapshot(dataDir,symbol){
 const text=await readOptional(path.join(dataDir,symbol==='Fear & Greed'?'fear-greed.csv':symbol.toLowerCase()+'.json'));
 if(!text)return null;
 if(symbol==='Fear & Greed'){const rows=parseCSV(text);return {date:rows.at(-1).date,count:rows.length};}
 const data=JSON.parse(text);if(data.symbol!==symbol||!data.rows?.length)throw Error('本地行情格式无效');
 return {date:data.anchorDate,count:data.rows.length};
}
async function updateETF(symbol,{dataDir,fetchText,now}){
 const file=path.join(dataDir,symbol.toLowerCase()+'.json');
 const saved=await readOptional(file),previous=saved?JSON.parse(saved):null;
 const next=normalizeYahoo(JSON.parse(await fetchText(yahooURL(symbol))),symbol,now);
 if(previous)preserveHistory(previous.rows,next.rows);
 await atomicWrite(file,JSON.stringify(next));
 return {date:next.anchorDate,count:next.rows.length,source:'Yahoo Finance'};
}
async function updateSentiment({dataDir,fetchText,now,expectedDate,sentimentSource}){
 const file=path.join(dataDir,'fear-greed.csv'),saved=await readOptional(file),previous=saved?parseCSV(saved):[];
 const candidates=[];
 if(sentimentSource!=='archive'){
  try{
   const tail=parseCNN(JSON.parse(await fetchText(CNN_URL)),now);
   preserveHistory(previous.filter(r=>r.date>=OFFICIAL_START),tail);
   if(!previous.some(r=>r.date<OFFICIAL_START))throw Error('缺少 2021 年以前历史存档，请先使用 archive 初始化');
   const rows=[...previous.filter(r=>r.date<OFFICIAL_START),...tail];
   candidates.push({rows,source:'CNN'});
  }catch{if(sentimentSource==='cnn')throw Error('CNN 更新失败，已保留本地数据');}
 }
 if(sentimentSource==='archive'||sentimentSource==='auto'&&(!candidates.length||candidates[0].rows.at(-1).date<expectedDate)){
  try{
   const rows=parseCSV(await fetchText(ARCHIVE_URL));
   if(rows.at(-1).date>latestClosedSession(now,0))throw Error('指数包含未收盘日期');
   preserveHistory(previous,rows);candidates.push({rows,source:'whit3rabbit/fear-greed-data'});
  }catch{if(!candidates.length)throw Error('指数更新失败：来源不可用或历史校验未通过，已保留本地数据');}
 }
 candidates.sort((a,b)=>b.rows.at(-1).date.localeCompare(a.rows.at(-1).date));
 const {rows,source}=candidates[0];
 await atomicWrite(file,csv(rows));return {date:rows.at(-1).date,count:rows.length,source};
}
export function refreshAll(options={}){
 const dataDir=path.resolve(options.dataDir||DEFAULT_DATA_DIR);
 if(pending.has(dataDir))return pending.get(dataDir);
 const promise=withDataLock(dataDir,()=>run({...options,dataDir})).finally(()=>pending.delete(dataDir));
 pending.set(dataDir,promise);return promise;
}
async function run({dataDir,fetchText=fetchPublicText,now=Date.now(),wait=sleep,skipFresh=false,sentimentSource=process.env.FEAR_GREED_SOURCE||'auto'}){
 if(!['auto','cnn','archive'].includes(sentimentSource))throw Error('FEAR_GREED_SOURCE 必须为 auto、cnn 或 archive');
 const expectedDate=latestClosedSession(now),checkedAt=new Date(now).toISOString();
 const oldText=await readOptional(path.join(dataDir,'status.json')),old=oldText?JSON.parse(oldText):null;
 const context={dataDir,fetchText,now,expectedDate,sentimentSource};
 const results=await Promise.all(['Fear & Greed',...SYMBOLS].map(async symbol=>{
  const last=old?.results?.find(r=>r.symbol===symbol);
  try{
   const current=await snapshot(dataDir,symbol);
   if(skipFresh&&current?.date>=expectedDate&&last?.ok&&last.date===current.date&&last.expectedDate===expectedDate)
    return {...last,...current,skipped:true,checkedAt};
   const value=symbol==='Fear & Greed'?await updateSentiment(context):await retry(()=>updateETF(symbol,context),wait);
   return {symbol,...value,ok:true,fresh:value.date>=expectedDate,expectedDate,checkedAt,lastSuccessAt:checkedAt};
  }catch{
   let cached;try{cached=await snapshot(dataDir,symbol);}catch{}
   return {symbol,ok:false,fresh:!!cached&&cached.date>=expectedDate,...cached,expectedDate,checkedAt,lastSuccessAt:last?.lastSuccessAt||null,source:last?.source||null,error:'更新失败，保留上次有效数据'};
  }
 }));
 const status={version:1,checkedAt,expectedDate,complete:results.every(r=>r.ok&&r.fresh),results};
 await atomicWrite(path.join(dataDir,'status.json'),JSON.stringify(status,null,2)+'\n');
 return status;
}
