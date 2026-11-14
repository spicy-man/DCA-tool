import { estimateMonthlyBuy, nextMonthlyPlan, summarizeFunding } from '../../domain/strategy-summary.mjs';
import { calculatePyramidSignals } from '../../domain/pyramid-strategy.mjs';
import { resetPlanEstimateHelp } from '../../ui/plan-estimate-help.mjs';
import { calculateKDSeries, kdMultiple, kdTierLevel, KD_DEFAULTS } from '../../domain/kd-strategy.mjs';
import { SIGNAL_STRATEGIES, signalName, formatMultiple } from '../../domain/signal-view.mjs';

const money = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateWithWeekday = date => date + '（周' + '日一二三四五六'[new Date(date + 'T12:00:00Z').getUTCDay()] + '）';
const athDrawdownNote = rows => {
  const ath = rows.reduce((peak, row) => Math.max(peak, row.high), 0);
  const drawdown = ath > 0 ? Math.max(0, 1 - rows.at(-1).close / ath) : 0;
  return '自 ATH 回撤 ' + (drawdown * 100).toFixed(2) + '%';
};

export function formatFearStatus(states, threshold) {
  const { latest, armed, rearmThreshold } = states[0];
  const trigger = armed ? '等待下穿 ' + threshold + ' 点' : '等待回升至 ' + rearmThreshold + ' 点重置';
  const pendingLines = states.filter(state => state.pending.length).map(({ symbol, pending }) => {
    const total = pending.reduce((sum, signal) => sum + signal.amount, 0);
    return symbol + ' ' + money(total);
  });
  return {
    heading: '恐慌加投状态（' + latest.date + '）',
    status: trigger + ' · 当前 ' + latest.score.toFixed(2),
    detail: pendingLines.length
      ? ['已触发加投 · 执行日待确认', ...pendingLines].join('\n')
      : '暂无待确认加投'
  };
}

export function renderStrategySummary(data, range, settings, signals = [], fear = null, {strategy='kdFear',kdOptions=KD_DEFAULTS}={}) {
  const set = (id, value) => { document.getElementById(id).textContent = value; };
  set('strategy-state-label',strategy==='kd'?'最新可用加权K':strategy==='regular'?'定投规则':strategy==='pyramid'?'当前近月回撤':'恐慌加投状态');
  const help = document.getElementById('next-plan-help');
  help.hidden = true;
  resetPlanEstimateHelp();
  document.getElementById('next-plan-estimate-note').hidden = true;
  set('next-plan-estimate-note', '');
  const rows = range?.replay ? data?.rows?.filter(row => row.date <= range.end) : data?.rows;
  if (!rows?.length || !range) {
    for (const id of ['recent-signal', 'next-plan', 'fear-state', 'funding-range']) set(id, '等待行情数据');
    for (const id of ['recent-signal-note', 'next-plan-estimate', 'fear-state-note', 'funding-split', 'funding-average-note', 'funding-peak-note', 'funding-annual-peak-note']) set(id, '');
    for (const id of ['funding-total', 'funding-average', 'funding-peak', 'funding-annual-peak']) set(id, '—');
    return;
  }
  const lastDate = rows.at(-1).date;
  const latest = signals.at(-1);
  if (latest) {
    const sameDate = signals.filter(signal => signal.date === latest.date);
    const names = sameDate.map(signal => signalName(signal) + ' ' + formatMultiple(signal.multiple) + 'N');
    const total = sameDate.reduce((sum, signal) => sum + signal.amount, 0);
    set('recent-signal', latest.date);
    set('recent-signal-note', names.join(' ＋ ') + ' · ' + money(total));
  } else {
    set('recent-signal', '暂无信号');
    set('recent-signal-note', '完整可用历史内尚未产生买入信号');
  }
  const monthlySignals = signals.filter(signal => signal.type === 'monthly');
  const scheduleSignals = monthlySignals.length || settings.baseAmount > 0
    ? monthlySignals
    : calculatePyramidSignals(data.rows, { buyDay: settings.buyDay, baseAmount: 1 }).filter(s => !range.replay || s.date <= range.end);
  const plan = nextMonthlyPlan(rows, scheduleSignals, settings.buyDay);
  set('next-plan', dateWithWeekday(plan.expectedDate));
  const usesKD=strategy==='kd'||strategy==='kdFear';
  const kdState=usesKD?calculateKDSeries(data.rows,kdOptions).get(lastDate):null;
  const estimate = strategy==='regular'?{multiple:1,amount:settings.baseAmount}:usesKD?{multiple:kdState?kdMultiple(kdState.weightedK,kdOptions.tierFactor):1,amount:settings.baseAmount*(kdState?kdMultiple(kdState.weightedK,kdOptions.tierFactor):1)}:estimateMonthlyBuy(rows, settings.baseAmount, plan.expectedDate, scheduleSignals.at(-1)?.date);
  set('next-plan-estimate', estimate
    ? (strategy==='regular'?'固定买入 ':'暂估买入 ') + formatMultiple(estimate.multiple) + 'N · ' + money(estimate.amount)
    : '金额待定，等待下期窗口内的新完整日线');
  if(settings.baseAmount===0)set('next-plan-estimate','当前N为0，不执行买入');
  if(estimate&&usesKD){
    let firstLine='暂无已完成周线，暂按1N';
    if(kdState){
      const level=kdTierLevel(kdState.weightedK);
      const bandLow=(9-level)*10;
      firstLine='加权K '+kdState.weightedK.toFixed(2)+'，第 '+level+' 档（'+bandLow+'–'+(bandLow+10)+'）';
    }
    set('next-plan-estimate-note',firstLine+'\n'+athDrawdownNote(rows));
    help.hidden=false;
  }else if (estimate&&strategy!=='regular') {
    const note = '当前自' + estimate.cutoff.slice(5) + '窗口高点回撤' + (estimate.drawdown * 100).toFixed(2) + '%';
    set('next-plan-estimate-note', note + '\n' + athDrawdownNote(rows));
    help.hidden = false;
  }
  if(strategy==='kd'){
    set('fear-state',kdState?kdState.weightedK.toFixed(2):'暂无已收盘周线');
    set('fear-state-note',kdState?'月K '+kdState.monthK.toFixed(2)+' / 季度K '+kdState.quarterK.toFixed(2)+' · '+kdOptions.monthWeight+'% / '+kdOptions.quarterWeight+'% · 系数 '+kdOptions.tierFactor+' · 周收盘 '+kdState.signalDate+(kdState.full?'':' · 指标预热期'):'暂按1N，不叠加恐慌买入');
  }else if(strategy==='regular'){
    set('fear-state','每月固定1N');set('fear-state-note','不依据回撤或K值调整，不叠加恐慌买入');
  }else if(strategy==='pyramid'){
    const now=estimateMonthlyBuy(rows,settings.baseAmount,lastDate);
    set('fear-state',now?(now.drawdown*100).toFixed(2)+'%':'等待行情');set('fear-state-note','相对前一个日历月窗口高点；不叠加恐慌买入');
  }else if (fear?.disabled) {
    set('fear-state', '未启用恐慌加投');
    set('fear-state-note', '');
  } else if (!fear?.latest) {
    set('fear-state', '暂无指数记录');
    set('fear-state-note', '等待指数数据后判断加投状态');
  } else {
    const { heading, status, detail } = formatFearStatus([{ ...fear, symbol: data.symbol }], settings.fearThreshold);
    set('strategy-state-label', heading);
    set('fear-state', status);
    set('fear-state-note', detail);
  }
  const funding = summarizeFunding(signals, rows, range);
  if (!funding) {
    set('funding-range', '当前区间无行情，无法统计');
    for (const id of ['funding-total', 'funding-average', 'funding-peak', 'funding-annual-peak']) set(id, '—');
    for (const id of ['funding-split', 'funding-average-note', 'funding-peak-note', 'funding-annual-peak-note']) set(id, '');
    return;
  }
  const missingFearData = ['combined','kdFear'].includes(strategy)&&fear && !fear.disabled && !fear.latest && settings.baseAmount > 0;
  set('funding-range', SIGNAL_STRATEGIES[strategy]+' · '+funding.start + ' — ' + funding.end + ' · ' + funding.count + ' 笔信号' +
    (missingFearData ? ' · 暂无指数，未含恐慌加投' : ''));
  const fundingMoney = value => money(value) + '（' + (settings.baseAmount > 0 ? (value / settings.baseAmount).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0') + 'N）';
  set('funding-total', fundingMoney(funding.total));
  set('funding-average', fundingMoney(funding.average));
  set('funding-peak', fundingMoney(funding.peak));
  set('funding-annual-peak', fundingMoney(funding.annualPeak));
  set('funding-split', [
    '基础定投 ' + fundingMoney(funding.regularAmount) + ' · ' + funding.monthlyCount + ' 笔',
    strategy==='regular'?null:(usesKD?'加权K额外投入 ':'月跌幅金字塔加投 ') + fundingMoney(funding.pyramidExtraAmount) + ' · ' + funding.pyramidCount + ' 笔',
    !['combined','kdFear'].includes(strategy)?null:missingFearData ? '恐慌加投 暂无指数数据，无法统计' : '恐慌加投 ' + fundingMoney(funding.fearAmount) + ' · ' + funding.fearCount + ' 笔'
  ].filter(Boolean).join('\n'));
  set('funding-average-note', '覆盖 ' + funding.months + ' 个自然月，包含零投入月份');
  set('funding-peak-note', funding.peak > 0 ? funding.peakMonths[0] + (funding.peakMonths.length > 1 ? ' 等 ' + funding.peakMonths.length + ' 个月并列' : '') : '区间内无投入信号');
  set('funding-annual-peak-note', funding.peakYears.length ? funding.peakYears.join('、') + ' 年' : '区间内无投入信号');
}
