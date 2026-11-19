import {refreshAll} from '../server/updater.mjs';
import {hasBlockingDataGap,isFundsHealthy} from '../public/js/domain/data-health.mjs';
try{
 const status=await refreshAll({skipFresh:process.argv.includes('--scheduled'),catchUp:process.argv.includes('--catch-up'),includeFunds:!process.env.REFRESH_SOURCES,
  ...(process.env.REFRESH_SOURCES ? {sources:process.env.REFRESH_SOURCES.split(',')} : {})});
 console.log(JSON.stringify(status,null,2));
 if(hasBlockingDataGap(status,Date.parse(status.checkedAt))||!isFundsHealthy(status.funds))process.exitCode=1;
}catch(error){
 console.error('数据更新任务失败；请检查来源连接及本地文件。',error?.publicMessage||error?.message||error);
 process.exitCode=1;
}
