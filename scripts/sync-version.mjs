import {syncVersion} from './version.mjs';
try{console.log('已同步 v'+await syncVersion({date:process.argv.find(arg=>arg.startsWith('--date='))?.slice(7)}));}
catch(error){console.error(error.message);process.exitCode=1;}
