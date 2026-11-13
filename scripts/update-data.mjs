import {refreshAll} from '../server/updater.mjs';
import {hasBlockingDataGap} from '../public/js/domain/data-health.mjs';
try{
 const status=await refreshAll({skipFresh:process.argv.includes('--scheduled'),catchUp:process.argv.includes('--catch-up'),includeFunds:!process.env.REFRESH_SOURCES,
  ...(process.env.REFRESH_SOURCES ? {sources:process.env.REFRESH_SOURCES.split(',')} : {})});
 console.log(JSON.stringify(status,null,2));
 if(hasBlockingDataGap(status,Date.parse(status.checkedAt))||status.funds?.complete===false||status.funds?.ok===false||status.funds?.performance?.ok===false||status.funds?.performance?.complete===false)process.exitCode=1;
}catch{console.error('数据更新任务失败；请检查来源连接及本地文件。');process.exitCode=1;}
