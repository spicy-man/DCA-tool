import { NASDAQ_FUNDS, QQQ_FEE } from './nasdaq-funds.mjs';

export const SPY_FEE = Object.freeze({ annualFee: 0.0945, checkedAt: '2026-10-26',
  source: 'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy' });

export const SP500_FUNDS = Object.freeze([
  ['513500', '博时'], ['513650', '南方'], ['159612', '国泰'], ['159655', '华夏']
].map(([code, manager]) => Object.freeze({ code, manager })));

export const FUND_GROUPS = Object.freeze({
  nasdaq100: Object.freeze({ id: 'nasdaq100', title: '纳斯达克100', funds: NASDAQ_FUNDS,
    page: 'nasdaq-funds.html', snapshotFile: 'nasdaq100-etfs.json', homeSymbol: 'QQQ',
    button: '纳指100 场内 ETF 对比',
    benchmark: Object.freeze({ symbol: 'QQQ', name: 'Invesco 纳斯达克100 ETF', provider: 'Invesco', ...QQQ_FEE }) }),
  sp500: Object.freeze({ id: 'sp500', title: '标普500', funds: SP500_FUNDS,
    page: 'sp500-funds.html', snapshotFile: 'sp500-etfs.json', homeSymbol: 'SPY',
    button: '标普500 场内 ETF 对比',
    benchmark: Object.freeze({ symbol: 'SPY', name: 'SPDR 标普500 ETF', provider: 'State Street', ...SPY_FEE }) })
});

export function getFundGroup(id = 'nasdaq100') {
  if (!Object.hasOwn(FUND_GROUPS, id)) throw Error('未知基金分组');
  return FUND_GROUPS[id];
}
