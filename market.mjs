import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {normalizeYahoo,SYMBOLS} from './public/market-data.mjs';
const run=promisify(execFile),pending=new Map();
export function yahooURL(symbol){if(!SYMBOLS.includes(symbol))throw Error('Unsupported symbol');return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=0&period2=${Math.floor(Date.now()/1000)}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;}
async function networkProxy(){
 const explicit=process.env.MARKET_DATA_PROXY||process.env.HTTPS_PROXY||process.env.https_proxy||process.env.ALL_PROXY||process.env.all_proxy;
 if(explicit)return explicit==='direct'?'':explicit;
 if(process.platform!=='win32')return '';
 try{const {stdout}=await run('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{windowsHide:true,timeout:5000});
 if(!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(stdout))return '';
 const server=stdout.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
 if(!server)return '';const selected=server.includes('=')?(server.match(/(?:^|;)https=([^;]+)/i)?.[1]||server.match(/(?:^|;)http=([^;]+)/i)?.[1]):server;
 return selected?(/^[a-z]+:\/\//i.test(selected)?selected:'http://'+selected):'';
 }catch{return '';}
}
export async function fetchPublicText(url){
 const proxy=await networkProxy();
 if(proxy){
 // Keep proxy credentials out of command arguments and error messages.
 const env={...process.env};for(const key of Object.keys(env))if(/^(https?|all)_proxy$/i.test(key))delete env[key];env.HTTPS_PROXY=proxy;
 try{const {stdout}=await run(process.platform==='win32'?'curl.exe':'curl',['--fail','--silent','--show-error','--location','--max-time','25','--user-agent','Mozilla/5.0',url],{env,windowsHide:true,timeout:30000,maxBuffer:12*1024*1024});return stdout;}catch(error){const status=error.stderr?.match(/returned error:\s*(\d{3})/i)?.[1];throw Error(status?'数据接口返回 '+status:'数据下载失败，请检查网络或代理');}
 }
 const response=await fetch(url,{headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error('数据接口返回 '+response.status);return response.text();
}
async function fetchYahoo(symbol){return JSON.parse(await fetchPublicText(yahooURL(symbol)));}
export function refreshETF(symbol){
 if(!SYMBOLS.includes(symbol))return Promise.reject(Error('Unsupported symbol'));
 if(pending.has(symbol))return pending.get(symbol);
 const promise=(async()=>{
 const next=normalizeYahoo(await fetchYahoo(symbol),symbol),file=new URL(`./public/data/${symbol.toLowerCase()}.json`,import.meta.url);
 let previous;try{previous=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(previous&&(next.rows.length<previous.rows.length||next.anchorDate<previous.anchorDate||next.rows[0].date>previous.rows[0].date))throw Error('行情历史缩短或日期倒退，已保留原数据');
 const tmp=new URL(file.href+'.tmp');await writeFile(tmp,JSON.stringify(next));await rename(tmp,file);return {symbol,date:next.anchorDate,count:next.rows.length};
 })().finally(()=>pending.delete(symbol));pending.set(symbol,promise);return promise;
}
