import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
export async function readVersion(root=projectRoot){
 const pkg=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
 if(!semver.test(pkg.version))throw Error('package.json 版本须为 MAJOR.MINOR.PATCH');
 return pkg.version;
}
export async function checkVersion(root=projectRoot){
 const version=await readVersion(root);
 const html=await readFile(path.join(root,'public/index.html'),'utf8');
 const changelog=await readFile(path.join(root,'CHANGELOG.md'),'utf8');
 const badges=[...html.matchAll(/class="version-badge" aria-label="版本 ([^"]+)">v([^<]+)<\/span>/g)];
 if(badges.length!==1||badges[0][1]!==version||badges[0][2]!==version)throw Error('页头版本徽标与 package.json 不一致');
 const style=await readFile(path.join(root,'public/style.css'),'utf8');
 const imports=[...style.matchAll(/@import url\(['"](\.\/css\/[^'"]+)['"]\);/g)];
 if(!html.includes('style.css?v='+version+'"')||!imports.length||imports.some(([,url])=>!url.endsWith('?v='+version)))throw Error('CSS 缓存版本与 package.json 不一致');
 if(!changelog.includes('目前系统版本为 **v'+version+'**'))throw Error('CHANGELOG 顶部版本声明不一致');
 const entry=changelog.match(/^## [^\n]* v(\d+\.\d+\.\d+) /m);
 if(entry?.[1]!==version)throw Error('CHANGELOG 最新版本条目不一致');
 try{const lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));if(lock.version!==version||lock.packages?.['']?.version!==version)throw Error('package-lock.json 版本不一致');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 return version;
}
export async function syncVersion({root=projectRoot,date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date())}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('日期须为 YYYY-MM-DD');
 const version=await readVersion(root),htmlFile=path.join(root,'public/index.html'),logFile=path.join(root,'CHANGELOG.md');
 const styleFile=path.join(root,'public/style.css');
 let style=await readFile(styleFile,'utf8');
 let html=await readFile(htmlFile,'utf8'),log=await readFile(logFile,'utf8');
 if((html.match(/class="version-badge"/g)||[]).length!==1)throw Error('缺少唯一版本徽标');
 if(!/目前系统版本为 \*\*v[^*]+\*\* \(更新日期: [^)]+\)。/.test(log))throw Error('缺少 CHANGELOG 顶部版本声明');
 html=html.replace(/class="version-badge" aria-label="版本 [^"]+">v[^<]+<\/span>/,'class="version-badge" aria-label="版本 '+version+'">v'+version+'</span>');
 html=html.replace(/style\.css\?v=[^" ]+/,'style.css?v='+version);
 style=style.replace(/(\.\/css\/[^'")?]+\.css)(?:\?v=[^'")]+)?/g,'$1?v='+version);
 log=log.replace(/目前系统版本为 \*\*v[^*]+\*\* \(更新日期: [^)]+\)。/,'目前系统版本为 **v'+version+'** (更新日期: '+date+')。');
 let lock;try{lock=JSON.parse(await readFile(path.join(root,'package-lock.json'),'utf8'));lock.version=version;if(lock.packages?.[''])lock.packages[''].version=version;}
 catch(error){if(error.code!=='ENOENT')throw error;}
 await writeFile(htmlFile,html);await writeFile(logFile,log);await writeFile(styleFile,style);
 if(lock)await writeFile(path.join(root,'package-lock.json'),JSON.stringify(lock,null,2)+'\n');
 return version;
}
