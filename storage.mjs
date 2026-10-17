import {readFile,writeFile,rename,unlink,mkdir,open} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export async function readOptional(file){try{return await readFile(file,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export async function atomicWrite(file,text){
 await mkdir(path.dirname(file),{recursive:true});
 const temp=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,text,{flag:'wx'});await rename(temp,file);}finally{await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
export function preserveHistory(previous,next){
 const dates=new Set(next.map(r=>r.date));
 if(previous.some(r=>!dates.has(r.date)))throw Error('上游缺失已有历史日期，已保留原数据');
}

export async function withDataLock(dataDir,task){
 await mkdir(dataDir,{recursive:true});
 const file=path.join(dataDir,'.refresh.lock');
 let handle;
 try{handle=await open(file,'wx');}catch(error){if(error.code==='EEXIST')throw Error('已有数据更新任务运行；若上次进程异常退出，请确认无任务运行后移除 .refresh.lock');throw error;}
 try{await handle.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));return await task();}
 finally{await handle.close();await unlink(file);}
}
