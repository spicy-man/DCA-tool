import { NASDAQ_FUNDS, normalizeFundQuotes, fundNumber, premiumRate } from '../public/js/domain/nasdaq-funds.mjs';

export const fundQuotesURL = (funds = NASDAQ_FUNDS) => 'https://push2delay.eastmoney.com/api/qt/ulist.np/get?' +
  new URLSearchParams({ fltt: '2', invt: '2', fields: 'f12,f14,f2,f3,f6,f38,f124,f441',
    secids: funds.map(({ code }) => (code.startsWith('5') ? '1.' : '0.') + code).join(',') });
export const FUND_QUOTES_URL = fundQuotesURL();
export const fundProfileURL = code => `https://fundf10.eastmoney.com/jbgk_${code}.html`;
export const tencentQuotesURL = (funds = NASDAQ_FUNDS) => 'https://qt.gtimg.cn/q=' + funds
  .map(({ code }) => (code.startsWith('5') ? 'sh' : 'sz') + code).join(',');
export const TENCENT_QUOTES_URL = tencentQuotesURL();

export function parseTencentQuotes(text, now, funds = NASDAQ_FUNDS) {
  const diff = [...text.matchAll(/v_(?:sz|sh)(\d{6})="([^"\r\n]*)";/g)].map(([, code, line]) => {
    const fields = line.split('~');
    const time = fields[30];
    if (fields[2] !== code || fields[82] !== 'CNY' || !/^\d{14}$/.test(time)) throw Error('备用行情格式无效');
    const iso = time.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6+08:00');
    const price = fundNumber(fields[3]), iopv = fundNumber(fields[78]);
    const published = fundNumber(fields[77]);
    const computed = premiumRate(price, iopv);
    // Guard the undocumented reference-value fields against upstream layout changes.
    if (computed !== null && (published === null || Math.abs(computed - published) > 0.05)) throw Error('备用溢价口径不匹配');
    const amount = fundNumber(fields[57]);
    return { f12: code, f2: price, f441: iopv, f3: fields[32],
      f6: amount === null ? null : amount * 10000, f38: fields[72], f124: Date.parse(iso) / 1000 };
  });
  return normalizeFundQuotes({ rc: 0, data: { diff } }, now, funds);
}

export function parseFundProfile(html) {
  const plain = html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|\s+/g, ' ');
  const scale = plain.match(/净资产规模\s*([\d,.]+)\s*亿元\s*[（(]\s*截止至[：:]\s*(\d{4})年(\d{2})月(\d{2})日/);
  const management = plain.match(/管理费率\s*([\d.]+)%/);
  const custody = plain.match(/托管费率\s*([\d.]+)%/);
  const netAssets = scale ? Number(scale[1].replaceAll(',', '')) * 1e8 : null;
  const annualFee = management && custody ? Number(management[1]) + Number(custody[1]) : null;
  return {
    netAssets: Number.isFinite(netAssets) && netAssets >= 0 ? netAssets : null,
    scaleDate: scale ? `${scale[2]}-${scale[3]}-${scale[4]}` : null,
    annualFee: Number.isFinite(annualFee) && annualFee >= 0 ? annualFee : null
  };
}

// Returns a validated candidate; only updater.mjs owns locking and disk writes.
export async function fetchFundSnapshot({ fetchText, now, previous, funds = NASDAQ_FUNDS }) {
  let rows, quoteSource;
  try {
    rows = normalizeFundQuotes(JSON.parse(await fetchText(fundQuotesURL(funds))), now, funds);
    quoteSource = '东方财富';
  } catch {
    rows = parseTencentQuotes(await fetchText(tencentQuotesURL(funds)), now, funds);
    quoteSource = '腾讯财经';
  }
  for (const row of rows) {
    const old = previous?.rows?.find(item => item.code === row.code);
    if (old?.quoteTime > row.quoteTime) throw Error('基金行情时间倒退');
  }
  const checkedAt = new Date(now).toISOString();
  const enriched = await Promise.all(rows.map(async row => {
    const old = previous?.rows?.find(item => item.code === row.code);
    let profile = { netAssets: old?.netAssets ?? null, scaleDate: old?.scaleDate ?? null,
      annualFee: old?.annualFee ?? null, profileCheckedAt: old?.profileCheckedAt ?? null };
    try {
      const next = parseFundProfile(await fetchText(fundProfileURL(row.code)));
      if (next.netAssets !== null && next.scaleDate <= row.quoteDate && (!profile.scaleDate || next.scaleDate >= profile.scaleDate)) {
        profile.netAssets = next.netAssets;
        profile.scaleDate = next.scaleDate;
      }
      if (next.annualFee !== null) profile.annualFee = next.annualFee;
      if (next.netAssets !== null && next.annualFee !== null) profile.profileCheckedAt = checkedAt;
    } catch { /* Quote updates remain usable when profile pages are unavailable. */ }
    return { ...row, ...profile };
  }));
  return { version: 1, source: quoteSource + ' / 天天基金', quoteSource, checkedAt, lastAttemptAt: checkedAt,
    ok: true, rows: enriched };
}
