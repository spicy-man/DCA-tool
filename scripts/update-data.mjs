import {refreshAll} from '../server/updater.mjs';
try{
 const status=await refreshAll({skipFresh:process.argv.includes('--scheduled')});
 console.log(JSON.stringify(status,null,2));
 if(!status.complete)process.exitCode=1;
}catch{console.error('数据更新任务失败；请检查来源连接及本地文件。');process.exitCode=1;}
