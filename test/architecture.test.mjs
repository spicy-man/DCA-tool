import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';

async function modules(directory){
 const found=[];
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const url=new URL(entry.name+(entry.isDirectory()?'/':''),directory);
  if(entry.isDirectory())found.push(...await modules(url));
  else if(entry.name.endsWith('.mjs'))found.push(url);
 }
 return found;
}
const frontend=new URL('../public/js/',import.meta.url);
test('前端模块可在无 DOM 环境导入，只有启动入口执行初始化',async()=>{
 for(const file of await modules(frontend)){
  if(file.href===new URL('app.mjs',frontend).href)continue;
  await import(file.href);
 }
});
test('领域层不依赖界面或 I/O，浏览器模块不引用服务端',async()=>{
 for(const file of await modules(frontend)){
  const source=await readFile(file,'utf8');
  const refs=[...source.matchAll(/from\s*['"]([^'"]+)['"]/g)].map(match=>match[1]);
  for(const ref of refs){
   assert.ok(ref.startsWith('.'),file.pathname+': browser module imports '+ref);
   const target=new URL(ref,file);assert.ok(target.href.startsWith(frontend.href),file.pathname+': import escapes frontend');
   await readFile(target);
   if(file.pathname.includes('/domain/'))assert.ok(target.pathname.includes('/domain/'),file.pathname+': domain imports UI');
  }
  if(file.pathname.includes('/domain/'))assert.doesNotMatch(source,/\b(document|localStorage|fetch|process)\s*[.(]/);
 }
});
