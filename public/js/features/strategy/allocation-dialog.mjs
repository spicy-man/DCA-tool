import { SYMBOLS } from '../../domain/market.mjs';
import { calculateKDSignals, calculateKDSeries, kdMultiple } from '../../domain/kd-strategy.mjs';
import { evaluateFearStrategy } from '../../domain/fear-strategy.mjs';
import { calculatePyramidSignals } from '../../domain/pyramid-strategy.mjs';
import {
  allocateWeightedAmounts,
  estimateMonthlyBuy,
  nextMonthlyPlan,
  summarizePortfolioFunding,
  validTotalAmount,
  validWeight
} from '../../domain/strategy-summary.mjs';
import { appEvents, events } from '../../services/events.mjs';
import {
  clearFailedMarketSymbols,
  ensureMarketSnapshots,
  getMarketRows,
  isMarketLoading,
  onMarketStoreChange
} from '../../services/market-store.mjs';
import { formatMoney } from '../../ui/format.mjs';
import { bindDialogExitFallback, closeDialog, enableDialogLightDismiss } from '../../ui/dialog-utils.mjs';
import { getKDOptions, readKDTierFactor, setKDTierFactor } from './kd.mjs';
import { formatFearStatus } from './summary.mjs';
import { drawBacktestChart, renderBacktestTable } from './backtest-view.mjs';
import {
  STRATEGY_DEFAULTS,
  activeSymbol,
  getAllocationState,
  getSentimentRows,
  onSentimentChange,
  saveStrategySettings,
  setAllocationState,
  setStrategyParams,
  setSymbolParams,
  signalSettings,
  symbolParams,
  syncControlsForSymbol,
  validAllocationFearCount,
  validBaseAmount
} from './settings.mjs';

const $ = id => document.getElementById(id);

let disposePrevious = null;

function availableSymbolOptions() {
  const select = $('symbol');
  if (select?.options?.length) {
    return Array.from(select.options).map(option => ({
      symbol: option.value,
      label: option.textContent || option.text || option.value
    }));
  }
  return SYMBOLS.map(symbol => ({ symbol, label: symbol }));
}

function renderAllocationStatus(items, buyDay, fearThreshold, message, selectedPlan, kdOptions) {
  const plan = $('allocation-next-plan');
  if (!plan) return;
  const detail = $('allocation-next-detail');
  const recent = $('allocation-recent-signal');
  const recentDetail = $('allocation-recent-detail');
  const fearHeading = $('allocation-fear-heading');
  const fearState = $('allocation-fear-state');
  const fearDetail = $('allocation-fear-detail');
  plan.textContent = message;
  detail.textContent = '';
  recent.textContent = message;
  recentDetail.textContent = '';
  fearHeading.textContent = '恐慌加投状态';
  fearState.textContent = message;
  fearDetail.textContent = '';
  if (!items.length) return;

  const useKD = selectedPlan === 'kdFear';
  const sentimentRows = getSentimentRows();
  const history = [];
  const plans = items.map(({ symbol, rows, baseAmount }) => {
    const monthlySignals = calculatePyramidSignals(rows, { buyDay, baseAmount });
    const signals = useKD ? calculateKDSignals(rows, monthlySignals, { ...kdOptions, baseAmount }) : monthlySignals;
    const lastSignal = signals.at(-1);
    if (lastSignal) {
      const amount = signals.reduce((sum, signal) => signal.date === lastSignal.date ? sum + signal.amount : sum, 0);
      history.push({ symbol, date: lastSignal.date, amount });
    }
    const { expectedDate } = nextMonthlyPlan(rows, monthlySignals, buyDay);
    const kdState = useKD ? calculateKDSeries(rows, kdOptions).get(rows.at(-1).date) : null;
    const estimate = useKD
      ? { amount: baseAmount * (kdState ? kdMultiple(kdState.weightedK, kdOptions.tierFactor) : 1) }
      : estimateMonthlyBuy(rows, baseAmount, expectedDate, lastSignal?.date);
    return { symbol, expectedDate, amount: estimate?.amount, asOf: rows.at(-1).date };
  });
  const sameDate = plans.every(item => item.expectedDate === plans[0].expectedDate);
  const sameAsOf = plans.every(item => item.asOf === plans[0].asOf);
  const complete = sameDate && sameAsOf && plans.every(item => Number.isFinite(item.amount));
  plan.textContent = sameDate ? plans[0].expectedDate : '各标的预计日期不同';
  plan.textContent += complete
    ? ' · 暂估 ' + formatMoney(plans.reduce((sum, item) => sum + item.amount, 0))
    : ' · 合计待定';
  detail.textContent = plans.map(({ symbol, expectedDate, amount, asOf }) => [
    symbol,
    sameDate ? '' : expectedDate,
    Number.isFinite(amount) ? formatMoney(amount) : '金额待定',
    sameAsOf ? '' : '（行情截至 ' + asOf + '）'
  ].filter(Boolean).join(' ')).join('\n');

  const enabled = items.filter(item => item.fearBuyCount > 0);
  const states = sentimentRows.length ? enabled.map(item => ({
    symbol: item.symbol,
    ...evaluateFearStrategy(item.rows, sentimentRows, { ...item, fearThreshold })
  })) : [];
  const latestDate = history.reduce((date, signal) => signal.date > date ? signal.date : date, '');
  const recentSignals = history.filter(signal => signal.date === latestDate);
  recent.textContent = latestDate
    ? latestDate + ' · 合计 ' + formatMoney(recentSignals.reduce((sum, signal) => sum + signal.amount, 0))
    : '暂无月度信号';
  recentDetail.textContent = recentSignals.map(({ symbol, amount }) =>
    symbol + ' ' + formatMoney(amount)).join('\n');

  if (!states.length) {
    fearState.textContent = enabled.length ? '等待指数数据' : '未启用恐慌加投';
    return;
  }
  const fearStatus = formatFearStatus(states, fearThreshold);
  fearHeading.textContent = fearStatus.heading;
  fearState.textContent = fearStatus.status;
  fearDetail.textContent = fearStatus.detail;
}

export function initAllocationDialog() {
  disposePrevious?.();
  disposePrevious = null;

  const dialog = $('allocation-dialog');
  const openBtn = $('allocation-open');
  if (!dialog || !openBtn) return;

  const cancelBtn = $('allocation-cancel');
  const form = $('allocation-form');
  const planButtons = {
    combined: $('allocation-plan-pyramidFear'),
    kdFear: $('allocation-plan-kdFear')
  };
  const totalInput = $('allocation-total');
  const buyDayInput = $('allocation-buy-day');
  const thresholdInput = $('allocation-fear-threshold');
  const tierFactorInput = $('allocation-kd-tier-factor');
  const tierFactorError = $('allocation-kd-factor-error');
  const bulkFearInput = $('allocation-bulk-fear-count');
  const bulkFearButton = $('allocation-apply-fear-count');
  const list = $('allocation-list');
  const summary = $('allocation-summary');
  const estimateAverage = $('allocation-estimate-average');
  const estimatePeak = $('allocation-estimate-peak');
  const estimateAnnualPeak = $('allocation-estimate-annual-peak');
  const estimateNote = $('allocation-estimate-note');
  const backtestWrap = $('allocation-backtest-wrap');
  const backtestPeriod = $('allocation-backtest-period');
  const backtestMode = $('allocation-backtest-mode');
  const backtestResults = $('allocation-backtest-results');
  const backtestPlot = $('allocation-backtest-plot');
  const tabEquity = $('allocation-tab-equity');
  const tabProfit = $('allocation-tab-profit');
  const principalLegend = $('allocation-principal-legend');
  const scaleToggle = $('allocation-scale-toggle');
  const message = $('allocation-message');

  let inputs = new Map();
  let allocSeriesMode = 'profit';
  let allocLogScale = true;
  let lastBacktest = null;
  let lastTotal = STRATEGY_DEFAULTS.baseAmount;
  let previewTierFactor = getKDOptions().tierFactor;
  let previewTimer = null;
  let isOpen = false;
  let selectedPlan = getAllocationState().plan;
  const PREVIEW_DEBOUNCE_MS = 130;

  function cancelScheduledPreview() {
    if (previewTimer !== null) {
      clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function runPreviewNow() {
    cancelScheduledPreview();
    updatePreview();
  }

  function schedulePreview() {
    cancelScheduledPreview();
    previewTimer = setTimeout(() => {
      previewTimer = null;
      if (inputs.size) updatePreview();
    }, PREVIEW_DEBOUNCE_MS);
  }

  const refreshIfOpen = () => {
    if ((dialog.open ?? isOpen) && inputs.size) runPreviewNow();
  };
  const unsubscribeStore = onMarketStoreChange(refreshIfOpen);
  const unsubscribeSentiment = onSentimentChange(refreshIfOpen);
  disposePrevious = () => {
    isOpen = false;
    cancelScheduledPreview();
    unsubscribeStore();
    unsubscribeSentiment();
  };

  function validateTierFactor() {
    try {
      const value = readKDTierFactor(tierFactorInput.value);
      tierFactorInput.setAttribute('aria-invalid', 'false');
      tierFactorError.textContent = '';
      return value;
    } catch (error) {
      tierFactorInput.setAttribute('aria-invalid', 'true');
      tierFactorError.textContent = error.message + '。仍显示上一次有效系数的预览。';
      return null;
    }
  }

  const planName = plan => plan === 'kdFear' ? '加权K定投' : '月跌幅金字塔';
  function selectPlan(plan) {
    selectedPlan = plan;
    for (const [value, button] of Object.entries(planButtons)) {
      button.setAttribute('aria-pressed', String(value === selectedPlan));
    }
  }

  function redrawAllocationChart(result) {
    drawBacktestChart(backtestPlot, result, {
      seriesMode: allocSeriesMode,
      logScale: allocLogScale,
      baseAmount: lastTotal,
      principalLegend,
      titlePrefix: '配比组合'
    });
  }

  function updatePreview() {
    const kdOptions = { ...getKDOptions(), tierFactor: previewTierFactor };
    $('allocation-status-heading').textContent = '组合策略状态 · ' + planName(selectedPlan);
    if ($('allocation-kd-funding')) {
      $('allocation-kd-funding').textContent = '另一方案资金需求待有效组合参数与行情就绪后显示。';
    }
    const total = Number(totalInput.value);
    const totalValid = validTotalAmount(total);
    const buyDay = Number(buyDayInput.value);
    const fearThreshold = Number(thresholdInput.value);
    const settingsValid = Number.isInteger(buyDay) && buyDay >= 1 && buyDay <= 31 &&
      Number.isFinite(fearThreshold) && fearThreshold > 0 && fearThreshold <= 95;
    let sumWeight = 0;
    let hasInvalid = false;
    const activeItems = [];
    const parsedEntries = [];
    for (const [symbol, info] of inputs) {
      const raw = info.input.value.trim();
      const weight = raw === '' ? 0 : Number(raw);
      const fearRaw = info.fearCountInput.value;
      const fearCount = Number(fearRaw);
      if (!validAllocationFearCount(fearRaw, 0)) hasInvalid = true;
      parsedEntries.push({ symbol, info, raw, weight, fearRaw, fearCount });
    }
    const allocatedAmounts = totalValid ? allocateWeightedAmounts(total, parsedEntries) : new Map();
    for (const { symbol, info, raw, weight, fearRaw, fearCount } of parsedEntries) {
      if (raw === '' || weight === 0) {
        info.preview.textContent = totalValid ? '1N = 0.00' : '等待总金额';
      } else if (!validWeight(weight)) {
        info.preview.textContent = '配比无效';
        hasInvalid = true;
      } else {
        sumWeight += weight;
        if (totalValid) {
          const computed = allocatedAmounts.get(symbol) ?? 0;
          if (validBaseAmount(computed) && validAllocationFearCount(fearRaw, computed)) {
            info.preview.textContent = '1N = ' + formatMoney(computed);
            if (computed >= 0.01) {
              activeItems.push({ symbol, baseAmount: computed, fearBuyCount: fearCount });
            }
          } else {
            info.preview.textContent = '金额无效';
            hasInvalid = true;
          }
        } else {
          info.preview.textContent = '等待总金额';
        }
      }
    }
    const roundedSum = Math.round(sumWeight * 100) / 100;
    if (roundedSum === 0) {
      summary.textContent = '配比合计：0%（剩余 100% 未分配）';
    } else if (Math.abs(roundedSum - 100) < 1e-6) {
      summary.textContent = '配比合计：100%';
    } else if (roundedSum < 100) {
      summary.textContent = `配比合计：${roundedSum}%（剩余 ${Math.round((100 - roundedSum) * 100) / 100}% 未分配）`;
    } else {
      summary.textContent = `配比合计：${roundedSum}%（已超出 100%）`;
    }

    if (!estimatePeak || !estimateNote) return;
    const setEstimate = (avgText, peakText, annualPeakText, noteText, backtest = null) => {
      if (estimateAverage) estimateAverage.textContent = avgText;
      estimatePeak.textContent = peakText;
      if (estimateAnnualPeak) estimateAnnualPeak.textContent = annualPeakText;
      estimateNote.textContent = noteText;
      if (!backtestWrap || !backtestResults) return;
      lastBacktest = backtest;
      lastTotal = totalValid ? total : STRATEGY_DEFAULTS.baseAmount;
      if (!backtest?.results?.length) {
        backtestWrap.hidden = true;
        backtestResults.replaceChildren();
        if (backtestPlot) backtestPlot.replaceChildren();
        return;
      }
      backtestWrap.hidden = false;
      if (backtestPeriod) {
        const years = ((Date.parse(backtest.end) - Date.parse(backtest.start)) / (365.25 * 86400000)).toFixed(1);
        backtestPeriod.textContent = `组合回测 · ${backtest.start} — ${backtest.end} · ${years}年`;
      }
      renderBacktestTable(backtestResults, backtest.results);
      redrawAllocationChart(backtest);
    };

    if (!totalValid || !settingsValid || hasInvalid) {
      renderAllocationStatus([], buyDay, fearThreshold, '请检查组合参数', selectedPlan);
      setEstimate('—', '—', '—', '请输入有效的定投日、阈值、总金额、配比和加投倍数后自动测算');
      return;
    }
    if (!activeItems.length) {
      renderAllocationStatus([], buyDay, fearThreshold, '暂无投入标的', selectedPlan);
      setEstimate('0.00（0N）', '0.00（0N）', '0.00（0N）', '当前配比下各标的均为 0.00，无买入资金需求');
      return;
    }
    ensureMarketSnapshots(activeItems.map(item => item.symbol));
    if (activeItems.some(item => !getMarketRows(item.symbol)?.length && isMarketLoading(item.symbol))) {
      renderAllocationStatus([], buyDay, fearThreshold, '正在读取行情', selectedPlan);
      setEstimate('正在测算…', '正在测算…', '正在测算…', '正在读取各标的历史行情数据…');
      return;
    }
    const items = activeItems.map(item => ({ ...item, rows: getMarketRows(item.symbol) }));
    const missingMarket = items.some(item => !item.rows?.length);
    const sentimentRows = getSentimentRows();
    renderAllocationStatus(missingMarket ? [] : items, buyDay, fearThreshold, '等待各标的行情', selectedPlan, kdOptions);
    if (!sentimentRows.length || missingMarket) {
      setEstimate('暂无数据', '暂无数据', '暂无数据', '等待恐慌指数与各标的历史行情就绪后自动测算');
      return;
    }
    const mode = backtestMode?.value === 'actual' ? 'actual' : 'equal';
    const funding = summarizePortfolioFunding({
      items,
      sentiment: sentimentRows,
      buyDay,
      fearThreshold,
      mode,
      totalBaseAmount: total,
      kdOptions,
      plan: selectedPlan
    });
    if (!funding) {
      setEstimate('暂无数据', '暂无数据', '暂无数据', '当前行情区间无法测算');
      return;
    }
    const otherId = selectedPlan === 'kdFear' ? 'combined' : 'kdFear';
    const other = funding.backtest?.results.find(strategy => strategy.id === otherId);
    if (other) {
      const shared = mode === 'equal'
        ? '五策略共同供资的历史最大单月外部入金为 ' + formatMoney(funding.backtest.fundingPeak) + '。'
        : '';
      $('allocation-kd-funding').textContent = '另一方案（' + planName(otherId) + '）：累计买入 ' +
        formatMoney(other.monthlyBought) + '，月均 ' + formatMoney(other.monthlyBought / funding.months) +
        '，单月最高买入 ' + formatMoney(other.maxMonthly) + '。' + shared;
    }
    const formatFunding = value => formatMoney(value) + '（' + (value / total).toLocaleString('en-US', { maximumFractionDigits: 2 }) + 'N）';
    const avgText = formatFunding(funding.average);
    const peakText = formatFunding(funding.peak);
    const annualPeakText = formatFunding(funding.annualPeak);
    if (funding.peak > 0) {
      const monthLabel = funding.peakMonths[0] + (funding.peakMonths.length > 1 ? ' 等 ' + funding.peakMonths.length + ' 个月' : '');
      const breakdown = funding.peakBreakdown.map(entry => entry.symbol + ' ' + formatMoney(entry.amount)).join(' ＋ ');
      setEstimate(
        avgText,
        peakText,
        annualPeakText,
        '峰值月份 ' + monthLabel + '（' + breakdown + '）\n' +
        '测算方案 ' + planName(selectedPlan) + ' · 区间 ' + funding.start.slice(0, 7) + ' — ' + funding.end.slice(0, 7) + '（' + funding.months + ' 个月）· 累计买入 ' + formatMoney(funding.total),
        funding.backtest
      );
    } else {
      setEstimate(avgText, peakText, annualPeakText, funding.start.slice(0, 7) + ' — ' + funding.end.slice(0, 7) + ' 区间内无成交买入', funding.backtest);
    }
  }

  function renderList() {
    const allocation = getAllocationState();
    inputs = new Map();
    const rows = availableSymbolOptions().map(({ symbol, label }) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'allocation-symbol-label';
      name.textContent = label;
      li.append(name);

      const wrap = document.createElement('label');
      wrap.className = 'allocation-weight-wrap';
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = '10000';
      input.step = 'any';
      input.inputMode = 'decimal';
      input.placeholder = '0';
      input.className = 'allocation-weight-input';
      input.setAttribute('aria-label', symbol + ' 配比百分比');
      const savedWeight = allocation.weights[symbol];
      input.value = validWeight(savedWeight) ? String(savedWeight) : '0';
      input.addEventListener('input', () => {
        message.textContent = '';
        schedulePreview();
      });
      const unit = document.createElement('span');
      unit.textContent = '%';
      wrap.append(input, unit);
      li.append(wrap);

      const preview = document.createElement('span');
      preview.className = 'allocation-preview';
      li.append(preview);

      const fearCountLabel = document.createElement('label');
      fearCountLabel.className = 'allocation-fear-count';
      const fearCountInput = document.createElement('input');
      fearCountInput.type = 'number';
      fearCountInput.min = '0';
      fearCountInput.step = '1';
      fearCountInput.inputMode = 'numeric';
      const params = symbolParams(symbol);
      const savedFearEnabled = allocation.fearEnabled?.[symbol];
      const fearEnabled = typeof savedFearEnabled === 'boolean' ? savedFearEnabled : params.fearEnabled;
      fearCountInput.value = String(fearEnabled ? params.fearBuyCount : 0);
      fearCountInput.setAttribute('aria-label', symbol + ' 恐慌加投倍数');
      fearCountInput.addEventListener('input', () => {
        message.textContent = '';
        schedulePreview();
      });
      fearCountLabel.append(fearCountInput, '倍');
      li.append(fearCountLabel);

      inputs.set(symbol, { input, preview, fearCountInput });
      return li;
    });
    list.replaceChildren(...rows);
    runPreviewNow();
  }

  openBtn.addEventListener('click', () => {
    const allocation = getAllocationState();
    const params = signalSettings();
    clearFailedMarketSymbols();
    selectPlan(allocation.plan);
    buyDayInput.value = String(params.buyDay);
    thresholdInput.value = String(params.fearThreshold);
    previewTierFactor = getKDOptions().tierFactor;
    tierFactorInput.value = String(previewTierFactor);
    tierFactorInput.setAttribute('aria-invalid', 'false');
    tierFactorError.textContent = '';
    bulkFearInput.value = '';
    totalInput.value = String(
      validTotalAmount(allocation.totalAmount)
        ? allocation.totalAmount
        : validTotalAmount(params.baseAmount)
          ? params.baseAmount
          : STRATEGY_DEFAULTS.baseAmount
    );
    message.textContent = '';
    isOpen = true;
    dialog.showModal?.();
    renderList();
  });

  cancelBtn.addEventListener('click', () => {
    isOpen = false;
    cancelScheduledPreview();
    closeDialog(dialog);
  });
  dialog.addEventListener('close', () => {
    isOpen = false;
    cancelScheduledPreview();
  });
  bindDialogExitFallback(dialog);
  enableDialogLightDismiss(dialog);

  totalInput.addEventListener('input', () => {
    message.textContent = '';
    schedulePreview();
  });

  for (const [plan, button] of Object.entries(planButtons)) {
    button.addEventListener('click', () => {
      if (plan === selectedPlan) return;
      selectPlan(plan);
      message.textContent = '';
      runPreviewNow();
    });
  }

  for (const input of [buyDayInput, thresholdInput]) {
    input.addEventListener('input', () => {
      message.textContent = '';
      schedulePreview();
    });
  }

  tierFactorInput.addEventListener('input', () => {
    const value = validateTierFactor();
    if (value === null || value === previewTierFactor) return;
    previewTierFactor = value;
    schedulePreview();
  });

  bulkFearButton.addEventListener('click', () => {
    const raw = bulkFearInput.value;
    const count = Number(raw);
    if (!validAllocationFearCount(raw, 0)) {
      message.textContent = '统一恐慌加投倍数须为不小于 0 的整数';
      return;
    }
    for (const { fearCountInput } of inputs.values()) fearCountInput.value = String(count);
    message.textContent = '';
    runPreviewNow();
  });

  backtestMode?.addEventListener('change', runPreviewNow);

  for (const [button, mode] of [[tabEquity, 'equity'], [tabProfit, 'profit']]) {
    button?.addEventListener('click', () => {
      if (allocSeriesMode === mode) return;
      allocSeriesMode = mode;
      tabEquity?.setAttribute('aria-selected', String(allocSeriesMode === 'equity'));
      tabProfit?.setAttribute('aria-selected', String(allocSeriesMode === 'profit'));
      if (lastBacktest) redrawAllocationChart(lastBacktest);
    });
  }

  scaleToggle?.addEventListener('click', () => {
    allocLogScale = !allocLogScale;
    scaleToggle.setAttribute('aria-pressed', String(allocLogScale));
    if (lastBacktest) redrawAllocationChart(lastBacktest);
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    cancelScheduledPreview();
    const tierFactor = validateTierFactor();
    if (tierFactor === null) return;
    const total = Number(totalInput.value);
    const buyDay = Number(buyDayInput.value);
    const fearThreshold = Number(thresholdInput.value);
    if (!Number.isInteger(buyDay) || buyDay < 1 || buyDay > 31) {
      message.textContent = '定投日须为 1–31 的整数';
      return;
    }
    if (!Number.isFinite(fearThreshold) || fearThreshold <= 0 || fearThreshold > 95) {
      message.textContent = 'F&G 阈值请输入大于 0 且不超过 95 的数值';
      return;
    }
    if (!validTotalAmount(total)) {
      message.textContent = '总定投金额请输入不小于 0.01 的有效数值';
      return;
    }
    const allocation = getAllocationState();
    const nextWeights = { ...allocation.weights };
    const nextFearEnabled = { ...allocation.fearEnabled };
    const parsedEntries = [];
    for (const [symbol, { input, fearCountInput }] of inputs) {
      const raw = input.value.trim();
      const weight = raw === '' ? 0 : Number(raw);
      if (!validWeight(weight)) {
        message.textContent = symbol + ' 配比请输入 0 至 10000 之间的有效百分比';
        return;
      }
      parsedEntries.push({ symbol, weight, fearRaw: fearCountInput.value });
    }
    const allocatedAmounts = allocateWeightedAmounts(total, parsedEntries);
    const updates = [];
    for (const { symbol, weight, fearRaw } of parsedEntries) {
      const computed = weight === 0 ? 0 : (allocatedAmounts.get(symbol) ?? 0);
      const fearCount = Number(fearRaw);
      if (!validAllocationFearCount(fearRaw, computed)) {
        message.textContent = symbol + ' 恐慌加投倍数须为不小于 0 的整数，且不能超出有效计算范围';
        return;
      }
      const fearEnabled = fearCount > 0;
      if (!validBaseAmount(computed)) {
        message.textContent = symbol + ' 折算后的定投金额（' + computed.toFixed(2) + '）超出有效计算范围';
        return;
      }
      nextWeights[symbol] = weight;
      nextFearEnabled[symbol] = fearEnabled;
      updates.push([symbol, computed, fearEnabled ? fearCount : symbolParams(symbol).fearBuyCount, fearEnabled]);
    }
    setAllocationState({ totalAmount: total, weights: nextWeights, fearEnabled: nextFearEnabled, plan: selectedPlan });
    for (const [symbol, baseAmount, fearBuyCount, fearEnabled] of updates) {
      setSymbolParams(symbol, { baseAmount, fearBuyCount, fearEnabled });
    }
    setStrategyParams({ ...signalSettings(), buyDay, fearThreshold });
    syncControlsForSymbol(activeSymbol(), { notify: false });
    saveStrategySettings();
    isOpen = false;
    closeDialog(dialog);
    setKDTierFactor(tierFactor, undefined, { notify: false });
    appEvents.dispatchEvent(new CustomEvent(events.strategySettings));
  });
}
