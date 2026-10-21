import { setSignalSentiment, signalSettings } from './features/strategy/overlay.mjs';
import { appEvents, events } from './services/events.mjs';
import {
  loadSentimentRows,
  loadSourceHealth,
  getDeploymentMode,
  requestSourceRefresh
} from './services/data-client.mjs';
import { healthSummary } from './domain/data-health.mjs';
import { sentimentLabel, sourceLabel } from './ui/labels.mjs';
import { downloadCSV } from './ui/download.mjs';
import { tooltipContent, positionTooltip } from './ui/tooltip.mjs';
import { drawSentiment, drawOverview } from './charts/sentiment.mjs';
import { periodKey } from './charts/geometry.mjs';
import { attachChartNavigation, constrainWindow, navigatorState } from './charts/navigation.mjs';
import { loadMarket, renderMarket, drawPrice, setMarketHover, invalidateMarket } from './features/market/chart.mjs';
import { aggregate, selectRange, rating } from './domain/sentiment.mjs';

export function initApplication() {
  const $ = id => document.getElementById(id);
  const formatDate = d => d;
  const iso = time => new Date(time).toISOString().slice(0, 10);

  let rows = [];
  let visible = [];
  let plot;
  let hover = -1;
  let windowRange;
  let crossDate;
  let crossY = null;
  let customWindow = null;
  let lastPreset = '12';
  let marketCalendar = [];
  let calendar = [];

  const bounds = () => ({
    start: Date.parse(calendar[0]?.date),
    end: Date.parse(calendar.at(-1)?.date)
  });

  function syncCalendar() {
    const previousEnd = calendar.at(-1)?.date;
    const followLatest = !windowRange || windowRange.end === previousEnd;
    const marketStart = marketCalendar[0];
    const marketEnd = marketCalendar.at(-1);
    calendar = [...new Set([...rows.map(row => row.date), ...marketCalendar])]
      .filter(date => !marketCalendar.length || (date >= marketStart && date <= marketEnd))
      .sort().map(date => ({ date }));
    if (!calendar.length) return;
    const limits = bounds();
    if (customWindow) {
      const span = customWindow.end - customWindow.start;
      customWindow = constrainWindow(followLatest
        ? { start: limits.end - span, end: limits.end }
        : customWindow, limits);
    }
    $('timeline').min = limits.start;
    $('timeline').max = limits.end;
    $('timeline').value = customWindow?.end ?? (followLatest
      ? limits.end : Math.max(limits.start, Math.min(limits.end, Date.parse(windowRange.end))));
  }

  function draw() {
    plot = drawSentiment($('chart'), {
      visible,
      windowRange,
      hover,
      crossDate,
      crossY,
      threshold: signalSettings().fearThreshold
    });
  }

  function mini() {
    for (const [canvasID, timelineID] of [['mini', 'timeline'], ['backtest-mini', 'backtest-timeline']]) {
      const canvas = $(canvasID);
      drawOverview(canvas, rows, bounds());
      if (!windowRange || !rows.length) continue;
      const state = navigatorState({
        start: Date.parse(windowRange.start),
        end: Date.parse(windowRange.end)
      }, bounds(), canvas.clientWidth);
      const timeline = $(timelineID);
      timeline.min = state.min;
      timeline.max = state.max;
      timeline.value = state.value;
      timeline.style.setProperty('--window-width', state.thumbWidth + 'px');
      timeline.setAttribute('aria-valuetext', windowRange.start + ' 至 ' + windowRange.end);
    }
  }

  function render() {
    if (!rows.length || !calendar.length) return;
    const end = iso(Number($('timeline').value));
    const selected = customWindow
      ? calendar.filter(r => r.date >= iso(customWindow.start) && r.date <= iso(customWindow.end))
      : $('range').value === 'sentiment'
        ? calendar.filter(r => r.date >= rows[0].date && r.date <= end)
        : selectRange(calendar, $('range').value, end);

    windowRange = {
      start: customWindow ? iso(customWindow.start) : selected[0]?.date || end,
      end: customWindow ? iso(customWindow.end) : selected.at(-1)?.date || end,
      frequency: $('frequency').value
    };
    windowRange.calendar = selected.map(row => row.date);
    const raw = rows.filter(row => row.date >= windowRange.start && row.date <= windowRange.end);

    visible = aggregate(raw, $('frequency').value);
    hover = -1;
    crossDate = null;
    crossY = null;
    $('tooltip').hidden = true;

    const last = visible.at(-1);
    if (last) {
      $('score').textContent = Math.round(last.score);
      $('score').title = last.score.toFixed(2);
      $('rating').textContent = sentimentLabel(last.score);
    } else {
      $('score').textContent = '—';
      $('score').title = '';
      $('rating').textContent = '当前区间无指数记录';
    }

    $('date-range').textContent = formatDate(windowRange.start) + ' – ' + formatDate(windowRange.end);
    $('sample-note').textContent =
      $('frequency').value === 'daily'
        ? '日线数据 · 周末及缺失日期不补值'
        : $('frequency').value === 'weekly'
          ? '周线 · 取每周末次记录，非平均值'
          : '月线 · 取每月末次记录，非平均值';
    $('observations').textContent = visible.length.toLocaleString() + ' 条记录';

    if ($('data-table').closest('details').open) renderDataTable();
    draw();
    mini();
    renderMarket(windowRange);
  }

  function renderDataTable() {
    $('data-table').replaceChildren(
      ...visible
        .slice()
        .reverse()
        .map(r => {
          const tr = document.createElement('tr');
          for (const value of [r.date, r.score.toFixed(2), sentimentLabel(r.score), sourceLabel(r.source)]) {
            const td = document.createElement('td');
            td.textContent = value;
            tr.append(td);
          }
          return tr;
        })
    );
  }

  $('data-table').closest('details').addEventListener('toggle', () => {
    if ($('data-table').closest('details').open) renderDataTable();
  });

  async function load() {
    rows = await loadSentimentRows();
    syncCalendar();
    setSignalSentiment(rows);
    render();
    await loadHealth();
  }

  $('range').addEventListener('change', () => {
    if ($('range').value === 'custom') return;
    lastPreset = $('range').value;
    if (lastPreset === 'sentiment' && calendar.length) $('timeline').value = bounds().end;
    customWindow = null;
    render();
  });

  $('frequency').addEventListener('change', render);

  function applyLayout() {
    const expanded = $('layout').value === 'expanded';
    $('chart-wrap').classList.toggle('expanded', expanded);
    $('price-wrap').classList.toggle('expanded', expanded);
    draw();
    drawPrice();
  }

  $('layout').addEventListener('change', applyLayout);
  applyLayout();

  $('latest').addEventListener('click', () => {
    if (!calendar.length) return;
    if (customWindow) {
      const span = customWindow.end - customWindow.start;
      customWindow = constrainWindow({ start: bounds().end - span, end: bounds().end }, bounds());
    }
    $('timeline').value = bounds().end;
    render();
  });

  for (const id of ['timeline', 'backtest-timeline']) {
    $(id).addEventListener('input', event => {
      if (!windowRange || !rows.length) return;
      const end = Number(event.currentTarget.value);
      const span = Date.parse(windowRange.end) - Date.parse(windowRange.start);
      applyWindow({ start: end - span, end });
    });
  }

  function showSentimentHover(date, pointer = null) {
    crossDate = date;
    hover = date && windowRange
      ? visible.findIndex(row => periodKey(row.date, windowRange.frequency) === periodKey(date, windowRange.frequency))
      : -1;
    const row = visible[hover];
    crossY = pointer?.y ?? (row && plot ? plot.y(row.score) : null);
    const tip = $('tooltip');
    if (!date || !windowRange) {
      tip.hidden = true;
      draw();
      return;
    }
    tooltipContent(tip, {
      title: formatDate(row?.date || date),
      rows: row ? [
        ['情绪指数', row.score.toFixed(2)],
        ['市场情绪', sentimentLabel(row.score)],
        ['来源', sourceLabel(row.source)]
      ] : [['情绪指数', '该日期无指数记录']]
    });
    positionTooltip(tip, pointer?.x ?? plot?.x(date) ?? $('chart').clientWidth / 2,
      crossY ?? 60, $('chart').clientWidth);
    draw();
  }

  $('chart').addEventListener('pointermove', e => {
    if (!plot || !visible.length) return;
    const rect = $('chart').getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < plot.left || mx > plot.w - plot.right || my < plot.top || my > plot.h - plot.bottom) {
      hideHover();
      return;
    }
    const date = plot.scale.dateAt(mx);
    showSentimentHover(date, { x: mx, y: my });
    setMarketHover(date);
  });

  function hideHover() {
    showSentimentHover(null);
    setMarketHover(null);
  }

  $('chart').addEventListener('pointerleave', hideHover);

  const deploymentReady = getDeploymentMode();

  async function loadHealth() {
    try {
      $('status').textContent = healthSummary(await loadSourceHealth());
    } catch {
      $('status').textContent = '无法检查数据更新状态，请核对各图的数据日期。';
    }
  }

  deploymentReady.then(mode => {
    $('refresh').querySelector('span').textContent = mode === 'static' ? '检查更新' : '更新数据';
  });

  $('refresh').addEventListener('click', async () => {
    const button = $('refresh');
    button.disabled = true;
    button.querySelector('span').textContent = '检查中…';
    const mode = await deploymentReady;
    try {
      if (mode === 'local') {
        $('status').textContent = '正在同步情绪指数与 ETF 行情…';
        await requestSourceRefresh();
      }
      await load();
      await invalidateMarket();
      await loadHealth();
    } catch (error) {
      $('status').textContent = error.message || '检查失败，已保留本地数据。';
    } finally {
      button.disabled = false;
      button.querySelector('span').textContent = mode === 'static' ? '检查更新' : '更新数据';
    }
  });

  $('download').addEventListener('click', () => {
    if (!visible.length) return;
    const csv =
      'Date,Fear Greed,Rating,Source\n' +
      visible.map(r => [r.date, r.score, r.label || rating(r.score), r.source].join(',')).join('\n');
    downloadCSV('fear-greed-' + visible[0].date + '-' + visible.at(-1).date + '.csv', csv);
  });

  new ResizeObserver(() => {
    if (rows.length) {
      draw();
      mini();
    }
  }).observe($('chart-wrap'));

  appEvents.addEventListener(events.marketHover, event => {
    showSentimentHover(event.detail);
  });

  function applyWindow(view) {
    customWindow = constrainWindow(view, bounds());
    $('range').value = 'custom';
    render();
  }

  function resetWindow() {
    if (!calendar.length) return;
    customWindow = null;
    $('range').value = lastPreset;
    $('timeline').value = bounds().end;
    render();
  }

  for (const id of ['price-chart', 'chart']) {
    attachChartNavigation($(id), {
      getWindow: () =>
        rows.length && windowRange
          ? customWindow || { start: Date.parse(windowRange.start), end: Date.parse(windowRange.end) }
          : null,
      getBounds: bounds,
      onChange: applyWindow,
      onReset: resetWindow
    });
  }

  appEvents.addEventListener(events.marketCalendar, event => {
    marketCalendar = [...new Set(event.detail)].sort();
    syncCalendar();
    if (rows.length) render();
  });

  appEvents.addEventListener(events.strategySettings, () => {
    if (rows.length) draw();
  });

  appEvents.addEventListener(events.sourceHealth, loadHealth);

  loadMarket();
  load().catch(error => {
    $('status').textContent = error.message + '。请检查本地数据文件后刷新页面。';
  });
}
