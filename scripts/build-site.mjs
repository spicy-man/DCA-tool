import {readFile,writeFile,lstat,rm,cp,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Generated output has one fixed location; never accept arbitrary deletion targets.
const project=fileURLToPath(new URL('../',import.meta.url));
const output=path.join(project,'dist');
export async function buildSite(){
 if(path.dirname(output)!==path.resolve(project)||path.basename(output)!=='dist')throw Error('Invalid build output');
 try{if((await lstat(output)).isSymbolicLink())throw Error('dist 不能为链接');}catch(error){if(error.code!=='ENOENT')throw error;}
 await rm(output,{recursive:true,force:true});
 await mkdir(output,{recursive:true});
 await cp(path.join(project,'public'),output,{recursive:true,filter:file=>!file.endsWith('.tmp')&&!path.basename(file).startsWith('.')});
 await writeFile(path.join(output,'deployment.json'),JSON.stringify({mode:'static'})+'\n');
 await writeFile(path.join(output,'.nojekyll'),'');
 return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await buildSite());
