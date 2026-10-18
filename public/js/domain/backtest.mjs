const DAY_MS = 86400000;
const CASH_ANNUAL_RATE = 0.03;
const yearsBetween = (start, end) => (Date.parse(end) - Date.parse(start)) / DAY_MS / 365;

// Only contributions and one terminal valuation: a monotonic future-value equation.
// Solve in log(1+r) space to support negative and very large annualized returns.
export function moneyWeightedReturn(deposits, end, finalValue) {
  if (!deposits.length || !Number.isFinite(finalValue) || finalValue <= 0) return null;
  const flows = deposits.map(flow => ({ amount: flow.amount, years: yearsBetween(flow.date, end) }));
  if (flows.some(flow => !Number.isFinite(flow.amount) || flow.amount <= 0 || !Number.isFinite(flow.years) || flow.years < 0)) return null;
  if (!flows.some(flow => flow.years > 0)) return null;
  const scale = Math.max(finalValue, ...flows.map(flow => flow.amount));
  const residual = logRate => flows.reduce((sum, flow) => sum + flow.amount / scale * Math.exp(logRate * flow.years), 0) - finalValue / scale;
  let low = -36;
  let high = 700;
  if (residual(low) > 0 || residual(high) < 0) return null;
  for (let i = 0; i < 160; i++) {
    const mid = (low + high) / 2;
    if (residual(mid) > 0) high = mid;
    else low = mid;
  }
  const result = Math.expm1((low + high) / 2);
  return Number.isFinite(result) && result > -1 ? result : null;
}

function simulate(rows, orders, commonDeposits, baseAmount) {
  const buys = new Map();
  const funding = commonDeposits || new Map();
  for (const order of orders) {
    buys.set(order.date, (buys.get(order.date) || 0) + order.amount);
    if (!commonDeposits) funding.set(order.date, (funding.get(order.date) || 0) + order.amount);
  }
  let shares = 0;
  let cash = 0;
  let cashInterest = 0;
  let previousDate = null;
  let invested = 0;
  let units = 0;
  let peak = 1;
  let maxDrawdown = 0;
  const curve = [];
  const deposits = [];
  for (const row of rows) {
    // Prior cash accrues over actual calendar days, including market closures.
    // Today's new funding earns no interest before today's valuation.
    if (previousDate && cash > 0) {
      const interest = cash * Math.expm1(Math.log1p(CASH_ANNUAL_RATE) * yearsBetween(previousDate, row.date));
      cash += interest;
      cashInterest += interest;
    }
    previousDate = row.date;
    // Value existing assets at the open before minting units for today's inflow.
    const openingEquity = shares * row.open + cash;
    const openingNAV = units > 0 ? openingEquity / units : 1;
    const deposit = funding.get(row.date) || 0;
    if (deposit) {
      units += deposit / openingNAV;
      cash += deposit;
      invested += deposit;
      deposits.push({ date: row.date, amount: deposit });
    }
    const amount = buys.get(row.date) || 0;
    if (amount > cash + Math.max(1, invested) * 1e-10) throw Error('回测可用资金不足');
    cash -= amount;
    if (Math.abs(cash) < Math.max(1, invested) * 1e-12) cash = 0;
    shares += amount / row.open;
    const equity = shares * row.close + cash;
    const nav = units > 0 ? equity / units : 1;
    peak = Math.max(peak, nav);
    if (units > 0) maxDrawdown = Math.max(maxDrawdown, 1 - nav / peak);
    curve.push({ date: row.date, equity, invested, profit: equity - invested, nav });
    if (![equity, invested, shares, units, nav].every(Number.isFinite)) throw Error('回测金额超出可计算范围，请调小定投金额');
  }
  const equity = curve.at(-1).equity;
  return {
    invested, equity, profit: equity - invested, cash, cashInterest,
    capitalReturn: invested ? (equity - invested) / invested : null,
    xirr: moneyWeightedReturn(deposits, rows.at(-1).date, equity),
    maxDrawdown: invested ? maxDrawdown : null,
    trades: orders.reduce((sum, order) => sum + order.amount, 0) / baseAmount, curve
  };
}

// Signals are computed on full history; only fills inside the selected window enter
// this fresh account. Monthly close-based decisions fill at the following open.
export function compareStrategies({ rows, monthlySignals, fearSignals, range, baseAmount, mode = 'actual' }) {
  if (!['actual', 'equal'].includes(mode)) throw Error('回测供资口径无效');
  if (!Number.isFinite(baseAmount) || baseAmount < 0.01) throw Error('回测定投金额无效');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if ((i && row.date <= rows[i - 1].date) || !Number.isFinite(Date.parse(row.date)) ||
        !Number.isFinite(row.open) || row.open <= 0 || !Number.isFinite(row.close) || row.close <= 0) {
      throw Error('回测需要日期递增且价格有效的完整日线');
    }
  }
  const daily = rows.filter(row => row.date >= range.start && row.date <= range.end);
  if (!daily.length) return null;
  const start = daily[0].date;
  const end = daily.at(-1).date;
  const index = new Map(rows.map((row, i) => [row.date, i]));
  const inRange = date => date >= start && date <= end;
  let deferredMonthly = 0;
  const monthly = [];
  for (const signal of monthlySignals) {
    const i = index.get(signal.date);
    if (i === undefined) throw Error('月度信号缺少对应行情');
    const fill = rows[i + 1];
    if (fill && inRange(fill.date)) monthly.push({ date: fill.date, amount: signal.amount });
    else if (inRange(signal.date)) deferredMonthly++;
  }
  const fear = fearSignals.filter(signal => inRange(signal.date)).map(signal => ({ date: signal.date, amount: signal.amount }));
  for (const order of [...monthly, ...fear]) {
    if (!index.has(order.date) || !Number.isFinite(order.amount) || order.amount <= 0) throw Error('回测买入信号无效');
  }
  const combined = [...monthly, ...fear].sort((a, b) => a.date.localeCompare(b.date));
  const commonDeposits = mode === 'equal' ? new Map() : null;
  if (commonDeposits) {
    for (const order of combined) commonDeposits.set(order.date, (commonDeposits.get(order.date) || 0) + order.amount);
  }
  const strategies = [
    { id: 'regular', name: '普通定投', orders: monthly.map(order => ({ ...order, amount: baseAmount })) },
    { id: 'pyramid', name: '回撤金字塔', orders: monthly },
    { id: 'combined', name: '金字塔＋恐慌加投', orders: combined }
  ];
  return {
    start, end, mode, deferredMonthly,
    results: strategies.map(strategy => ({ id: strategy.id, name: strategy.name, ...simulate(daily, strategy.orders, commonDeposits, baseAmount) }))
  };
}
