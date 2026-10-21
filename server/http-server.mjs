import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { refreshAll, addCustomSymbol } from './updater.mjs';
import { readCustomSymbols, removeCustomSymbol } from './symbols.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

export function createServer({
  publicDir = root,
  dataDir = path.join(publicDir, 'data'),
  refresh = refreshAll,
  addSymbol = addCustomSymbol,
  cooldownMs = 60000
} = {}) {
  let active;
  let lastResult;
  let lastRun = 0;

  return http.createServer(async (req, res) => {
    const send = (code, value) => {
      res.writeHead(code, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      res.end(JSON.stringify(value));
    };

    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/deployment.json') {
        send(200, { mode: 'local' });
        return;
      }

      if (url.pathname === '/data/custom-symbols.json' && ['GET', 'HEAD'].includes(req.method)) {
        send(200, await readCustomSymbols(dataDir));
        return;
      }

      if (url.pathname === '/api/symbols') {
        if (!['POST', 'DELETE'].includes(req.method)) {
          res.setHeader('Allow', 'POST, DELETE');
          send(405, { error: '仅支持 POST 或 DELETE' });
          return;
        }
        if (req.headers['sec-fetch-site'] === 'cross-site' ||
            (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) {
          send(403, { error: '不允许跨站修改标的' });
          return;
        }
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 1024) {
            send(413, { error: '请求内容过长' });
            return;
          }
        }
        let value;
        try { value = JSON.parse(body); } catch {
          send(400, { error: '请求格式无效' });
          return;
        }
        const symbol = typeof value?.symbol === 'string' ? value.symbol.trim().toUpperCase() : '';
        try {
          const result = await (req.method === 'DELETE' ? removeCustomSymbol : addSymbol)(symbol, { dataDir });
          lastResult = null;
          send(200, result);
        } catch (error) {
          send(400, { error: error.message });
        }
        return;
      }

      if (url.pathname === '/api/refresh') {
        if (req.method !== 'POST') {
          res.setHeader('Allow', 'POST');
          send(405, { error: '仅支持 POST' });
          return;
        }
        // Public Pages builds do not expose this endpoint. Keep local writes same-origin.
        if (
          req.headers['sec-fetch-site'] === 'cross-site' ||
          (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)
        ) {
          send(403, { error: '不允许跨站更新' });
          return;
        }

        if (!active && (!lastResult || Date.now() - lastRun >= cooldownMs)) {
          active = refresh({ dataDir })
            .then(value => {
              if (value.results.length && value.results.every(r => r.ok)) {
                lastResult = value;
                lastRun = Date.now();
              }
              return value;
            })
            .finally(() => {
              active = null;
            });
        }

        const status = await (active || lastResult);
        const results = status.results;
        const errors = results
          .filter(r => !r.ok || !r.fresh)
          .map(r => r.symbol + (r.ok ? ' 数据尚未到齐' : ' 更新失败，已保留本地数据'));
        const anyOk = results.some(r => r.ok);
        send(anyOk ? 200 : 502, {
          ...status,
          errors,
          error: anyOk ? undefined : errors.join('；')
        });
        return;
      }

      if (!['GET', 'HEAD'].includes(req.method)) {
        send(405, { error: '不支持的方法' });
        return;
      }

      const pathname = decodeURIComponent(url.pathname);
      const base = pathname.startsWith('/data/') ? path.resolve(dataDir) : path.resolve(publicDir);
      const relative = pathname.startsWith('/data/')
        ? pathname.slice(6)
        : pathname === '/'
          ? 'index.html'
          : pathname.slice(1);
      const file = path.resolve(base, relative);

      if (!file.startsWith(base + path.sep) || path.basename(file).startsWith('.')) {
        send(403, { error: '禁止访问' });
        return;
      }

      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      send(error.code === 'ENOENT' ? 404 : 500, {
        error: error.code === 'ENOENT' ? '文件不存在' : '请求失败，已保留原数据'
      });
    }
  });
}
