import { createServer } from './server/http-server.mjs';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { formatNewYorkTime } from './public/js/domain/data-health.mjs';
import { DEFAULT_DATA_DIR } from './server/updater.mjs';

const host = process.env.HOST || '127.0.0.1';
const dataDir = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const log = message => console.log('[' + formatNewYorkTime(Date.now()) + '] ' + message);
const server = createServer({ dataDir });

async function showDataStatus() {
  try {
    const status = JSON.parse(await readFile(path.join(dataDir, 'status.json'), 'utf8'));
    log('本地数据快照（上次检查：' + formatNewYorkTime(status.checkedAt) + '）');
    for (const result of status.results || []) {
      const label = result.symbol === 'Fear & Greed' ? '恐慌与贪婪指数' : result.symbol;
      log('  ' + label + '：' + (result.date || '暂无日期') + ' · ' + (result.count ?? 0) + ' 条' + (result.ok === false ? ' · 上次更新失败，保留缓存' : '') + (result.warning ? ' · ' + result.warning : ''));
    }
  } catch (error) {
    log(error.code === 'ENOENT' ? '暂无本地数据状态，可在网页点击“检查更新”。' : '无法读取本地数据状态：' + error.message);
  }
}

server.on('request', (req, res) => {
  const pathname = req.url?.split('?')[0];
  if (pathname === '/api/refresh' && req.method === 'POST') {
    log('收到数据更新请求，正在检查数据源…');
    res.on('finish', () => {
      log('数据更新请求完成 · HTTP ' + res.statusCode);
      if (res.statusCode === 200 || res.statusCode === 502) void showDataStatus();
    });
  } else if (pathname === '/' || pathname === '/index.html') {
    res.on('finish', () => log('页面访问 · HTTP ' + res.statusCode));
  }
});

server.on('error', error => {
  log(error.code === 'EADDRINUSE'
    ? '启动失败：端口已被占用，请检查是否已经启动，或设置 PORT 使用其他端口。'
    : '服务错误：' + error.message);
  process.exitCode = 1;
});

server.listen(Number(process.env.PORT || 4173), host, async () => {
  const browserHost = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const url = 'http://' + (browserHost.includes(':') ? '[' + browserHost + ']' : browserHost) + ':' + server.address().port;
  console.log('\n  定投助手 · 本地服务\n  ----------------------------------------');
  log('服务已就绪：' + url);
  log('数据目录：' + path.resolve(dataDir));
  log('在网页点击“检查更新”可刷新数据；按 Ctrl+C 停止服务。');
  await showDataStatus();
  if (process.argv.includes('--open')) {
    const [command, args] = process.platform === 'win32'
      ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
    browser.on('error', error => log('自动打开浏览器失败，请手动访问 ' + url + '（' + error.message + '）'));
    browser.on('exit', code => { if (code) log('浏览器启动命令失败，请手动访问 ' + url); });
    log('正在打开默认浏览器…');
  }
});
