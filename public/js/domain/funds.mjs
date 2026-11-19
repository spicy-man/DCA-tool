// Built-in domestic ETF groups, quote normalization, and sorting.
export const QQQ_FEE = Object.freeze({
  annualFee: 0.18,
  checkedAt: '2026-10-26',
  source: 'https://www.invesco.com/qqq-etf/en/home.html'
});

export const SPY_FEE = Object.freeze({
  annualFee: 0.0945,
  checkedAt: '2026-10-26',
  source: 'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy'
});

// Only ETFs tracking Nasdaq-100; excludes technology-sector indices and LOFs.
export const NASDAQ_FUNDS = Object.freeze([
  ['159941', '广发'], ['159501', '嘉实'], ['159696', '易方达'],
  ['159659', '招商'], ['159660', '汇添富'], ['159632', '华安'],
  ['159513', '大成'], ['513100', '国泰'], ['513300', '华夏'],
  ['513390', '博时'], ['513870', '富国'], ['513110', '华泰柏瑞']
].map(([code, manager]) => Object.freeze({ code, manager })));

export const SP500_FUNDS = Object.freeze([
  ['513500', '博时'], ['513650', '南方'], ['159612', '国泰'], ['159655', '华夏']
].map(([code, manager]) => Object.freeze({ code, manager })));

export const FUND_GROUPS = Object.freeze({
  nasdaq100: Object.freeze({
    id: 'nasdaq100',
    title: '纳斯达克100',
    funds: NASDAQ_FUNDS,
    page: 'funds.html?group=nasdaq100',
    snapshotFile: 'nasdaq100-etfs.json',
    homeSymbol: 'QQQ',
    button: '纳指100 场内 ETF 对比',
    benchmark: Object.freeze({ symbol: 'QQQ', name: 'Invesco 纳斯达克100 ETF', provider: 'Invesco', ...QQQ_FEE })
  }),
  sp500: Object.freeze({
    id: 'sp500',
    title: '标普500',
    funds: SP500_FUNDS,
    page: 'funds.html?group=sp500',
    snapshotFile: 'sp500-etfs.json',
    homeSymbol: 'SPY',
    button: '标普500 场内 ETF 对比',
    benchmark: Object.freeze({ symbol: 'SPY', name: 'SPDR 标普500 ETF', provider: 'State Street', ...SPY_FEE })
  })
});

export function getFundGroup(id = 'nasdaq100') {
  if (!Object.hasOwn(FUND_GROUPS, id)) throw Error('未知基金分组');
  return FUND_GROUPS[id];
}

export function shanghaiDate(time) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(time));
}

export function fundNumber(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function premiumRate(price, iopv) {
  return price > 0 && iopv > 0 ? (price / iopv - 1) * 100 : null;
}

export function normalizeFundQuotes(payload, now = Date.now(), funds = NASDAQ_FUNDS) {
  const data = payload?.data?.diff;
  if (payload?.rc !== 0 || !Array.isArray(data)) throw Error('基金行情格式无效');
  return funds.map(fund => {
    const matches = data.filter(row => row.f12 === fund.code);
    if (matches.length !== 1) throw Error('基金行情缺失或重复');
    const row = matches[0];
    const price = fundNumber(row.f2);
    const stamp = fundNumber(row.f124);
    if (!(price > 0) || !(stamp > 0) || stamp * 1000 > now + 300000) throw Error('基金价格或日期无效');
    const quoteTime = new Date(stamp * 1000).toISOString();
    const quoteDate = shanghaiDate(stamp * 1000);
    if (quoteDate > shanghaiDate(now) || now - stamp * 1000 > 15 * 86400000) throw Error('基金行情日期无效或过期');
    const rawIopv = fundNumber(row.f441);
    const iopv = rawIopv > 0 ? rawIopv : null;
    const amount = fundNumber(row.f6);
    const shares = fundNumber(row.f38);
    return {
      ...fund,
      price,
      change: fundNumber(row.f3),
      iopv,
      premium: premiumRate(price, iopv),
      amount: amount >= 0 ? amount : null,
      shares: shares > 0 ? shares : null,
      quoteDate,
      quoteTime
    };
  });
}

export const FUND_SORT_FIELDS = Object.freeze({
  code: { label: '基金代码', direction: 'asc', type: 'text' },
  premium: { label: '参考溢价率', direction: 'asc' },
  annualFee: { label: '年费率', direction: 'asc' },
  netAssets: { label: '净资产规模', direction: 'desc' },
  price: { label: '最新价', direction: 'asc' },
  iopv: { label: 'IOPV', direction: 'asc' },
  amount: { label: '成交额', direction: 'desc' },
  quoteDate: { label: '行情日期', direction: 'desc', type: 'text' },
  return1: { label: '近1年涨幅', direction: 'desc' },
  return3: { label: '近3年涨幅', direction: 'desc' },
  return5: { label: '近5年涨幅', direction: 'desc' }
});

export function sortFunds(rows, key = 'premium', direction = 'asc', secondary = null) {
  if (!Object.hasOwn(FUND_SORT_FIELDS, key)) key = 'premium';
  const criteria = [{ key, direction }];
  if (secondary && secondary.key !== key && Object.hasOwn(FUND_SORT_FIELDS, secondary.key)) criteria.push(secondary);
  return [...rows].sort((a, b) => {
    for (const criterion of criteria) {
      const av = a[criterion.key], bv = b[criterion.key];
      const text = FUND_SORT_FIELDS[criterion.key].type === 'text';
      const valid = value => text ? typeof value === 'string' && value.length > 0
        : typeof value === 'number' && Number.isFinite(value);
      const aValid = valid(av), bValid = valid(bv);
      // Unknown values always follow known values, in either direction.
      if (aValid !== bValid) return aValid ? -1 : 1;
      if (!aValid) continue;
      const difference = text ? av.localeCompare(bv, 'zh-CN') : av - bv;
      if (difference) return difference * (criterion.direction === 'desc' ? -1 : 1);
    }
    return a.code.localeCompare(b.code);
  });
}
