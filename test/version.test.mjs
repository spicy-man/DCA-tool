import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {checkVersion,syncVersion,readVersion,projectRoot} from '../scripts/version.mjs';

test('项目版本、徽标、更新记录和可选锁文件保持一致',async()=>{
 assert.equal(await checkVersion(),await readVersion());
});
test('拒绝版本漂移，同步脚本修复生成字段并保留人工版本条目',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'dca-version-'));
 t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'public'));
 await writeFile(path.join(root,'package.json'),JSON.stringify({version:'99.8.7'}));
 await writeFile(path.join(root,'public/index.html'),await readFile(path.join(projectRoot,'public/index.html')));
 const log=await readFile(path.join(projectRoot,'CHANGELOG.md'),'utf8');await writeFile(path.join(root,'CHANGELOG.md'),log.replace(/^(## [^\n]* )v\d+\.\d+\.\d+ /m,'$1v99.8.7 '));
 await writeFile(path.join(root,'package-lock.json'),JSON.stringify({version:'1.0.0',packages:{'':{version:'1.0.0'}}}));
 await assert.rejects(checkVersion(root),/徽标/);
 await syncVersion({root,date:'2026-10-17'});assert.equal(await checkVersion(root),'99.8.7');
 const html=await readFile(path.join(root,'public/index.html'),'utf8');assert.ok(html.includes('style.css?v=99.8.7'));
 const synced=await readFile(path.join(root,'CHANGELOG.md'),'utf8');await writeFile(path.join(root,'CHANGELOG.md'),synced.replace(/^(## [^\n]* )v99\.8\.7 /m,'$1v1.0.0 '));
 await assert.rejects(checkVersion(root),/最新版本条目/);
 await writeFile(path.join(root,'package.json'),JSON.stringify({version:'099.8.7'}));await assert.rejects(readVersion(root),/MAJOR/);
});
