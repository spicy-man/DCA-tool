import { estimateMonthlyBuy, nextMonthlyPlan, summarizeFunding } from '../../domain/strategy-summary.mjs';
import { calculatePyramidSignals } from '../../domain/pyramid-strategy.mjs';
import { resetPlanEstimateHelp } from '../../ui/plan-estimate-help.mjs';

const money = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signalName = signal => signal.type === 'fear' ? '恐慌加投' : '月度定投';
const dateWithWeekday = date => date + '（周' + '日一二三四五六'[new Date(date + 'T12:00:00Z').getUTCDay()] + '）';

export function renderStrategySummary(data, range, settings, signals = [], fear = null) {
  const set = (id, value) => { document.getElementById(id).textContent = value; };
  const help = document.getElementById('next-plan-help');
  help.hidden = true;
  resetPlanEstimateHelp();
  document.getElementById('next-plan-estimate-note').hidden = true;
  set('next-plan-estimate-note', '');
  if (!data?.rows.length || !range) {
    for (const id of ['strategy-asof', 'recent-signal', 'next-plan', 'fear-state', 'funding-range']) set(id, '等待行情数据');
    for (const id of ['recent-signal-note', 'next-plan-estimate', 'fear-state-note', 'funding-split', 'funding-average-note', 'funding-peak-note']) set(id, '');
    for (const id of ['funding-total', 'funding-average', 'funding-peak']) set(id, '—');
    return;
  }
  const lastDate = data.rows.at(-1).date;
  set('strategy-asof', '行情截至 ' + lastDate);
  const latest = signals.at(-1);
  if (latest) {
    const sameDate = signals.filter(signal => signal.date === latest.date);
    set('recent-signal', latest.date);
    set('recent-signal-note', sameDate.map(signal => signalName(signal) + ' ' + signal.multiple + 'N').join(' ＋ ') + ' · ' + money(sameDate.reduce((sum, signal) => sum + signal.amount, 0)));
  } else {
    set('recent-signal', '暂无信号');
    set('recent-signal-note', '完整可用历史内尚未产生买入信号');
  }
  const monthlySignals = signals.filter(signal => signal.type === 'monthly');
  const scheduleSignals = monthlySignals.length || settings.baseAmount > 0 ? monthlySignals : calculatePyramidSignals(data.rows, { buyDay: settings.buyDay, baseAmount: 1 });
  const plan = nextMonthlyPlan(data.rows, scheduleSignals, settings.buyDay);
  set('next-plan', dateWithWeekday(plan.expectedDate));
  const estimate = estimateMonthlyBuy(data.rows, settings.baseAmount, plan.expectedDate, scheduleSignals.at(-1)?.date);
  set('next-plan-estimate', estimate
    ? '暂估买入 ' + estimate.multiple + 'N · ' + money(estimate.amount)
    : '金额待定，等待下期窗口内的新完整日线');
  if (estimate) {
    const note = '当前自' + estimate.cutoff.slice(5) + '窗口高点回撤' + (estimate.drawdown * 100).toFixed(2) + '%';
    const ath = data.rows.reduce((peak, row) => Math.max(peak, row.high), 0);
    const athDrawdown = Math.max(0, 1 - data.rows.at(-1).close / ath);
    set('next-plan-estimate-note', note + '\n自 ATH 回撤 ' + (athDrawdown * 100).toFixed(2) + '%');
    help.hidden = false;
  }
  if (fear.disabled) {
    set('fear-state', '未启用恐慌加投');
    set('fear-state-note', fear.latest ? '最新 F&G ' + fear.latest.score.toFixed(2) + ' · 当前标的未启用恐慌加投' : '当前标的未启用恐慌加投');
  } else if (!fear.latest) {
    set('fear-state', '暂无指数记录');
    set('fear-state-note', '等待指数数据后判断加投状态');
  } else {
    set('fear-state', fear.armed ? '等待下穿 ' + settings.fearThreshold : '等待回升至 ' + fear.rearmThreshold + ' 重置');
    set('fear-state-note', '最新 F&G ' + fear.latest.score.toFixed(2) + (fear.pending.length
      ? ' · ' + fear.pending.length + ' 笔已触发，等待后续完整行情确认执行日'
      : ''));
  }
  const funding = summarizeFunding(signals, data.rows, range);
  if (!funding) {
    set('funding-range', '当前区间无行情，无法统计');
    for (const id of ['funding-total', 'funding-average', 'funding-peak']) set(id, '—');
    for (const id of ['funding-split', 'funding-average-note', 'funding-peak-note']) set(id, '');
    return;
  }
  const missingFearData = fear && !fear.disabled && !fear.latest && settings.baseAmount > 0;
  set('funding-range', funding.start + ' — ' + funding.end + ' · ' + funding.count + ' 笔信号' +
    (missingFearData ? ' · 暂无指数，未含恐慌加投' : ''));
  const fundingMoney = value => money(value) + '（' + (settings.baseAmount > 0 ? (value / settings.baseAmount).toLocaleString('en-US', { maximumFractionDigits: 2 }) : '0') + 'N）';
  set('funding-total', fundingMoney(funding.total));
  set('funding-average', fundingMoney(funding.average));
  set('funding-peak', fundingMoney(funding.peak));
  set('funding-split', [
    '基础定投 ' + fundingMoney(funding.regularAmount) + ' · ' + funding.monthlyCount + ' 笔',
    '金字塔加投 ' + fundingMoney(funding.pyramidExtraAmount) + ' · ' + funding.pyramidCount + ' 笔',
    missingFearData ? '恐慌加投 暂无指数数据，无法统计' : '恐慌加投 ' + fundingMoney(funding.fearAmount) + ' · ' + funding.fearCount + ' 笔'
  ].join('\n'));
  set('funding-average-note', '覆盖 ' + funding.months + ' 个自然月，包含零投入月份');
  set('funding-peak-note', funding.peak > 0 ? funding.peakMonths[0] + (funding.peakMonths.length > 1 ? ' 等 ' + funding.peakMonths.length + ' 个月并列' : '') : '区间内无投入信号');
}
