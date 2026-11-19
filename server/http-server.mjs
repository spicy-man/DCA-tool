import http from 'node:http';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { refreshAll, addCustomSymbol } from './updater.mjs';
import { readCustomSymbols, removeCustomSymbol } from './symbols.mjs';
import { isBuiltinDataFile, readBuiltinDataText, readMergedStatus } from './data-layer.mjs';
import { isFundsHealthy, describeFundsIssues } from '../public/js/domain/data-health.mjs';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const defaultAppVersion = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version || null;
  } catch {
    return null;
  }
})();
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

export function createServer({
  publicDir = root,
  dataDir = path.join(publicDir, 'data'),
  baseDataDir = null,
  refresh = refreshAll,
  addSymbol = addCustomSymbol,
  cooldownMs = 60000,
  appVersion = defaultAppVersion,
  allowedHosts = []
} = {}) {
  let active;
  let lastResult;
  let lastRun = 0;
  const configuredHosts = new Set([
    '127.0.0.1',
    'localhost',
    '::1',
    '[::1]',
    ...(process.env.HOST && !['0.0.0.0', '::'].includes(process.env.HOST) ? [process.env.HOST] : []),
    ...allowedHosts
  ].flatMap(host => {
    const normalized = String(host || '').trim().toLowerCase();
    if (!normalized) return [];
    return normalized.includes(':') && !normalized.startsWith('[') ? [normalized, `[${normalized}]`] : [normalized];
  }));

  let server;
  function sameOrigin(req) {
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite && fetchSite !== 'same-origin') return false;
    const rawHost = req.headers.host;
    if (typeof rawHost !== 'string' || !rawHost) return false;
    let parsedHost;
    try {
      parsedHost = new URL('http://' + rawHost);
    } catch {
      return false;
    }
    if (parsedHost.username || parsedHost.password || parsedHost.pathname !== '/' || parsedHost.search || parsedHost.hash) return false;
    const address = server?.address?.();
    if (address && typeof address === 'object' && address.port) {
      const port = parsedHost.port ? Number(parsedHost.port) : 80;
      if (port !== address.port) return false;
    }
    const hostname = parsedHost.hostname.toLowerCase();
    const wildcard = address && typeof address === 'object' && ['0.0.0.0', '::'].includes(address.address);
    const localIp = req.socket?.localAddress?.replace(/^::ffff:/, '').toLowerCase();
    const bracketedIp = localIp?.includes(':') ? '[' + localIp + ']' : localIp;
    const allowedByWildcard = wildcard && (hostname === localIp || hostname === bracketedIp);
    if (!configuredHosts.has(hostname) && !allowedByWildcard) return false;
    if (!req.headers.origin) return true;
    try {
      const origin = new URL(req.headers.origin);
      return ['http:', 'https:'].includes(origin.protocol) && origin.host.toLowerCase() === rawHost.toLowerCase();
    } catch {
      return false;
    }
  }

  server = http.createServer(async (req, res) => {
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
        send(200, appVersion ? { mode: 'local', version: appVersion } : { mode: 'local' });
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
        if (!sameOrigin(req)) {
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
          const result = await (req.method === 'DELETE' ? removeCustomSymbol : addSymbol)(symbol, { dataDir, baseDataDir });
          lastResult = null;
          send(200, result);
        } catch (error) {
          if (error.code === 'ELOCKED') throw error;
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
        if (!sameOrigin(req)) {
          send(403, { error: '不允许跨站更新' });
          return;
        }

        if (!active && (!lastResult || Date.now() - lastRun >= cooldownMs)) {
          active = refresh({ dataDir, baseDataDir, includeFunds: true })
            .then(value => {
              if (value.results.length && value.results.every(r => r.ok) && isFundsHealthy(value.funds)) {
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
        const funds = status.funds;
        errors.push(...describeFundsIssues(funds, { useGroupTitles: false, incompleteText: '数据尚未到齐' }));
        const fundsAnyOk = !!funds && (
          Array.isArray(funds.groups) && funds.groups.length
            ? funds.groups.some(g => g.ok !== false)
            : funds.ok !== false
        );
        const anyOk = results.some(r => r.ok) || fundsAnyOk;
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

      let data;
      if (baseDataDir && base === path.resolve(dataDir)) {
        if (relative === 'status.json') {
          const status = await readMergedStatus(dataDir, baseDataDir, await readCustomSymbols(dataDir).catch(() => []));
          if (!status) {
            send(404, { error: '文件不存在' });
            return;
          }
          data = JSON.stringify(status, null, 2) + '\n';
        } else if (isBuiltinDataFile(relative)) {
          data = await readBuiltinDataText(dataDir, baseDataDir, relative);
          if (data === null) {
            send(404, { error: '文件不存在' });
            return;
          }
        }
      }
      if (data === undefined) data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (error instanceof URIError) {
        send(400, { error: '无效请求路径' });
        return;
      }
      if (error.code === 'ELOCKED') {
        send(409, { error: error.message });
        return;
      }
      const notFound = error.code === 'ENOENT' || error.code === 'EISDIR';
      send(notFound ? 404 : 500, {
        error: notFound ? '文件不存在' : '请求失败，已保留原数据'
      });
    }
  });
  return server;
}
