import { nextMonthlyPlan, summarizeFunding } from '../../domain/strategy-summary.mjs';

const money = value => value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signalName = signal => signal.type === 'fear' ? '恐慌加投' : '月度定投';

export function renderStrategySummary(data, range, settings, signals = [], fear = null) {
  const set = (id, value) => { document.getElementById(id).textContent = value; };
  if (!data?.rows.length || !range) {
    for (const id of ['strategy-asof', 'recent-signal', 'next-plan', 'fear-state', 'funding-range']) set(id, '等待行情数据');
    for (const id of ['recent-signal-note', 'next-plan-note', 'fear-state-note', 'funding-split', 'funding-average-note', 'funding-peak-note']) set(id, '');
    for (const id of ['funding-total', 'funding-average', 'funding-peak']) set(id, '—');
    return;
  }
  const lastDate = data.rows.at(-1).date;
  set('strategy-asof', data.symbol + ' · 行情截至 ' + lastDate + ' · 指数截至 ' + (fear.latest?.date || '暂无记录'));
  const latest = signals.at(-1);
  if (latest) {
    const sameDate = signals.filter(signal => signal.date === latest.date);
    set('recent-signal', latest.date);
    set('recent-signal-note', sameDate.map(signal => signalName(signal) + ' ' + signal.multiple + '×').join(' ＋ ') + ' · ' + money(sameDate.reduce((sum, signal) => sum + signal.amount, 0)));
  } else {
    set('recent-signal', '暂无信号');
    set('recent-signal-note', '完整可用历史内尚未产生买入信号');
  }
  const plan = nextMonthlyPlan(data.rows, signals.filter(signal => signal.type === 'monthly'), settings.buyDay);
  set('next-plan', plan.scheduledDate);
  set('next-plan-note', plan.scheduledMonth + ' 月度计划 · 休市顺延');
  if (!fear.latest) {
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
  set('funding-range', funding.start + ' — ' + funding.end + ' · ' + funding.count + ' 笔信号');
  set('funding-total', money(funding.total));
  set('funding-average', money(funding.average));
  set('funding-peak', money(funding.peak));
  set('funding-split', [
    '普通定投（基础） ' + money(funding.regularAmount) + ' · ' + funding.monthlyCount + ' 笔',
    '金字塔额外加投 ' + money(funding.pyramidExtraAmount) + ' · 其中 ' + funding.pyramidCount + ' 笔加投',
    '恐慌额外加投 ' + money(funding.fearAmount) + ' · ' + funding.fearCount + ' 笔'
  ].join('\n'));
  set('funding-average-note', '覆盖 ' + funding.months + ' 个自然月，包含零投入月份');
  set('funding-peak-note', funding.peak > 0 ? funding.peakMonths[0] + (funding.peakMonths.length > 1 ? ' 等 ' + funding.peakMonths.length + ' 个月并列' : '') : '区间内无投入信号');
}
