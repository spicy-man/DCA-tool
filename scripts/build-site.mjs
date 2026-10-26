import {checkVersion} from './version.mjs';
import {SYMBOLS} from '../public/js/domain/market.mjs';
import {readFile,writeFile,lstat,rm,cp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Generated output has one fixed location; never accept arbitrary deletion targets.
const project=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(project,'dist');
const dataDir=path.resolve(project,'public','data');
const publicDataFiles=new Set(['fear-greed.csv','status.json','nasdaq100-etfs.json','sp500-etfs.json',...SYMBOLS.map(s=>s.toLowerCase()+'.json')]);
export async function buildSite(){
 await checkVersion();
 if(path.dirname(output)!==path.resolve(project)||path.basename(output)!=='dist')throw Error('Invalid build output');
 try{if((await lstat(output)).isSymbolicLink())throw Error('dist 不能为链接');}catch(error){if(error.code!=='ENOENT')throw error;}
 await rm(output,{recursive:true,force:true});
 await mkdir(output,{recursive:true});
 await cp(path.join(project,'public'),output,{recursive:true,filter:file=>{
  const name=path.basename(file);
  if(file.endsWith('.tmp')||name.startsWith('.'))return false;
  if(path.resolve(path.dirname(file))===dataDir)return publicDataFiles.has(name);
  return true;
 }});
 // The local status also contains personal tickers; publish only built-in sources.
 const statusFile=path.join(output,'data','status.json');
 let status;
 try{status=JSON.parse(await readFile(statusFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 if(status){
  const sources=['Fear & Greed',...SYMBOLS];
  status.results=status.results.filter(result=>sources.includes(result.symbol));
  const complete=symbol=>status.results.some(result=>result.symbol===symbol&&result.ok&&result.date>=status.expectedDate);
  status.complete=sources.every(complete);
  if(status.requestedSources){
   status.requestedSources=status.requestedSources.filter(symbol=>sources.includes(symbol));
   status.requestedComplete=status.requestedSources.every(complete);
  }
  await writeFile(statusFile,JSON.stringify(status,null,2)+'\n');
 }
 await writeFile(path.join(output,'deployment.json'),JSON.stringify({mode:'static'})+'\n');
 await writeFile(path.join(output,'.nojekyll'),'');
 return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await buildSite());
