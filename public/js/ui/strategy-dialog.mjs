import { getKDOptions } from '../features/strategy/kd.mjs';
import { signalSettings } from '../features/strategy/overlay.mjs';
import { kdMultiple } from '../domain/kd-strategy.mjs';
import { appEvents, events } from '../services/events.mjs';
import { bindDialogExitFallback, enableDialogLightDismiss } from './dialog-utils.mjs';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format;

export function renderKDExplanation() {
  const $=id=>document.getElementById(id),o=getKDOptions();
  const { baseAmount: base } = signalSettings();
  const fmt=n=>n.toLocaleString('en-US',{maximumFractionDigits:10});
  $('strategy-kd-parameters').textContent='当前设置：月K '+o.monthWeight+'% · 季度K '+o.quarterWeight+'% · Period '+o.period+' · Signal '+o.signal+' · 分档系数 '+o.tierFactor+' · N = '+money(base);
  $('strategy-kd-calendar').textContent='分别回看 '+o.period+' 个日历月与 '+o.period+' 个日历季度，计算窗口内包含的实际周K线根数；再按 '+o.signal+' 个月／'+o.signal+' 个季度包含的实际周K线根数平滑K。';
  $('strategy-kd-weighted').textContent='加权K = 月K × '+o.monthWeight+'% + 季度K × '+o.quarterWeight+'%';
  $('strategy-kd-tiers').replaceChildren(...Array.from({length:10},(_,level)=>{
    const tr=document.createElement('tr'),lower=90-10*level,upper=100-10*level,multiple=kdMultiple(lower,o.tierFactor);
    for(const value of [lower+' ≤ K '+(level===0?'≤':'<')+' '+upper,level,fmt(multiple)+'N',money(base*multiple)]){const td=document.createElement('td');td.textContent=value;tr.append(td);}return tr;
  }));
  const weighted=(40*o.monthWeight+60*o.quarterWeight)/100,multiple=kdMultiple(weighted,o.tierFactor);
  $('strategy-kd-example').textContent='假设月K=40、季度K=60，则加权K='+fmt(weighted)+'，本次买入 '+fmt(multiple)+'N，即 '+money(base*multiple)+'。同一次普通定投买入 1N。';
  const highest=kdMultiple(0,o.tierFactor);
  $('strategy-kd-funding').textContent='当前系数 '+o.tierFactor+'，最低 K 档单笔买入 '+fmt(highest)+'N（'+money(base*highest)+'）。同月有多笔顺延计划时，分别计入每笔买入金额。';
}

export function initStrategyDialog() {
  const $ = id => document.getElementById(id);
  const strategyDialog = $('strategy-dialog');
  const tabs = ['kd', 'pyramid', 'fear'].map(name => ({
    name,
    tab: $('strategy-tab-' + name),
    panel: $('strategy-' + name + '-panel')
  }));
  let activeIndex = 0;

  function renderActive() {
    const { name } = tabs[activeIndex];
    if (name === 'kd') {
      renderKDExplanation();
      return;
    }
    const { buyDay, baseAmount, fearThreshold, fearBuyCount, fearEnabled } = signalSettings();
    const base = ' · N = ' + money(baseAmount);
    if (name === 'pyramid') {
      $('strategy-pyramid-parameters').textContent = '当前设置：每月 ' + buyDay + ' 日' + base;
    } else {
      const amount = fearEnabled ? fearBuyCount + 'N' : '0 倍（已停用）';
      $('strategy-fear-parameters').textContent = '当前设置：阈值 ' + fearThreshold + ' · 加投 ' + amount + base;
    }
  }

  function selectTab(index) {
    activeIndex = index;
    tabs.forEach(({ tab, panel }, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      panel.hidden = !selected;
    });
    renderActive();
    tabs[index].panel.scrollTop = 0;
  }

  tabs.forEach(({ tab }, index) => {
    tab.addEventListener('click', () => selectTab(index));
    tab.addEventListener('keydown', event => {
      let nextIndex;
      switch (event.key) {
        case 'ArrowLeft': nextIndex = (index - 1 + tabs.length) % tabs.length; break;
        case 'ArrowRight': nextIndex = (index + 1) % tabs.length; break;
        case 'Home': nextIndex = 0; break;
        case 'End': nextIndex = tabs.length - 1; break;
        default: return;
      }
      event.preventDefault();
      selectTab(nextIndex);
      tabs[nextIndex].tab.focus();
    });
  });
  selectTab(activeIndex);
  appEvents.addEventListener(events.strategySettings, () => {
    if ($('strategy-dialog') === strategyDialog && strategyDialog.open) renderActive();
  });

  function open() {
    renderActive();
    strategyDialog.showModal();
    tabs[activeIndex].panel.scrollTop = 0;
  }

  $('strategy-help').addEventListener('click', open);

  bindDialogExitFallback(strategyDialog);
  enableDialogLightDismiss(strategyDialog);

  strategyDialog.querySelectorAll('.strategy-diagram-original').forEach(button => {
    button.addEventListener('click', () => {
      const viewer = new URL('../../diagram.html', import.meta.url);
      viewer.searchParams.set('image', button.dataset.image);
      window.open(viewer.href, '_blank', 'noopener,noreferrer');
    });
  });

  return open;
}
