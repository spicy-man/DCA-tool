import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SYMBOLS } from '../public/js/domain/market.mjs';

const run = promisify(execFile);

export function yahooURL(symbol) {
  if (!SYMBOLS.includes(symbol)) throw Error('Unsupported symbol');
  return `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=0&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
}

async function networkProxy() {
  const explicit =
    process.env.MARKET_DATA_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (explicit) return explicit === 'direct' ? '' : explicit;
  if (process.platform !== 'win32') return '';

  try {
    const { stdout } = await run(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { windowsHide: true, timeout: 5000 }
    );
    if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(stdout)) return '';
    const server = stdout.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]?.trim();
    if (!server) return '';
    const selected = server.includes('=')
      ? server.match(/(?:^|;)https=([^;]+)/i)?.[1] || server.match(/(?:^|;)http=([^;]+)/i)?.[1]
      : server;
    return selected ? (/^[a-z]+:\/\//i.test(selected) ? selected : 'http://' + selected) : '';
  } catch {
    return '';
  }
}

export function publicRequestHeaders(url) {
  if (url === 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata/2021-02-01') {
    return {
      'User-Agent': process.env.CNN_FETCH_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://www.cnn.com',
      Referer: 'https://www.cnn.com/'
    };
  }
  return { 'User-Agent': 'Mozilla/5.0' };
}

export async function fetchPublicText(url) {
  const proxy = await networkProxy();
  const headers = publicRequestHeaders(url);
  const timeoutSeconds = headers.Origin === 'https://www.cnn.com' ? 30 : 25;
  if (proxy) {
    // Keep proxy credentials out of command arguments and error messages.
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (/^(https?|all)_proxy$/i.test(key)) delete env[key];
    }
    env.HTTPS_PROXY = proxy;
    try {
      const { stdout } = await run(
        process.platform === 'win32' ? 'curl.exe' : 'curl',
        ['--fail', '--silent', '--show-error', '--location', '--max-time', String(timeoutSeconds),
          ...Object.entries(headers).flatMap(([name, value]) => ['--header', name + ': ' + value]), url],
        { env, windowsHide: true, timeout: (timeoutSeconds + 5) * 1000, maxBuffer: 12 * 1024 * 1024 }
      );
      return stdout;
    } catch (error) {
      const status = error.stderr?.match(/returned error:\s*(\d{3})/i)?.[1];
      throw Error(status ? '数据接口返回 ' + status : '数据下载失败，请检查网络或代理');
    }
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutSeconds * 1000)
  });
  if (!response.ok) throw Error('数据接口返回 ' + response.status);
  return response.text();
}
