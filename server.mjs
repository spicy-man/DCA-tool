import {createServer} from './server/http-server.mjs';
const host=process.env.HOST||'127.0.0.1';
const server=createServer({...(process.env.DATA_DIR?{dataDir:process.env.DATA_DIR}:{})});
server.listen(Number(process.env.PORT||4173),host,()=>console.log('定投助手 http://'+host+':'+server.address().port));
