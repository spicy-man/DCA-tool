import {checkVersion} from './version.mjs';
import {SYMBOLS} from '../public/js/domain/market.mjs';
import {readFile,writeFile,lstat,rm,cp,mkdir,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Generated output has one fixed location; never accept arbitrary deletion targets.
const project=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(project,'dist');
const dataDir=path.resolve(project,'public','data');
const publicDataFiles=new Set(['fear-greed.csv','status.json','nasdaq100-etfs.json','sp500-etfs.json',...SYMBOLS.map(s=>s.toLowerCase()+'.json')]);

export function versionModuleSpecifiers(source,version){
 return source
  .replace(/(\bfrom\s*)(['"])(\.\.?\/[^'"?#\r\n]+\.mjs)(?:\?v=[^'"#]+)?\2/g,`$1$2$3?v=${version}$2`)
  .replace(/(^[ \t]*|;[ \t]*)(import\s*)(['"])(\.\.?\/[^'"?#\r\n]+\.mjs)(?:\?v=[^'"#]+)?\3/gm,`$1$2$3$4?v=${version}$3`)
  .replace(/(\bimport\s*\(\s*)(['"])(\.\.?\/[^'"?#\r\n]+\.mjs)(?:\?v=[^'"#]+)?\2(\s*\))/g,`$1$2$3?v=${version}$2$4`);
}

export function versionHtmlScripts(html,version){
 return versionModuleSpecifiers(
  html.replace(/(<script\b[^>]*\bsrc=)(['"])(\.\.?\/[^'"?#\r\n]+\.mjs)(?:\?v=[^'"#]+)?\2/gi,`$1$2$3?v=${version}$2`),
  version
 );
}

async function versionAssets(dir,version){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const target=path.join(dir,entry.name);
  if(entry.isDirectory()){
   await versionAssets(target,version);
  }else if(entry.name.endsWith('.mjs')){
   const source=await readFile(target,'utf8');
   const updated=versionModuleSpecifiers(source,version);
   if(updated!==source)await writeFile(target,updated);
  }else if(entry.name.endsWith('.html')){
   const source=await readFile(target,'utf8');
   const updated=versionHtmlScripts(source,version);
   if(updated!==source)await writeFile(target,updated);
  }
 }
}

export async function buildSite(){
 const version=await checkVersion();
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
 await versionAssets(output,version);
 await writeFile(path.join(output,'deployment.json'),JSON.stringify({mode:'static',version})+'\n');
 await writeFile(path.join(output,'.nojekyll'),'');
 return output;
}
if(process.argv[1]&&await realpath(process.argv[1])===await realpath(fileURLToPath(import.meta.url)))console.log(await buildSite());
