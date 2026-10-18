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
import { attachChartNavigation, constrainWindow, navigatorState } from './charts/navigation.mjs';
import { loadMarket, renderMarket, drawPrice, invalidateMarket } from './features/market/chart.mjs';
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
  let customWindow = null;
  let lastPreset = '12';
  let marketCalendar = [];

  const bounds = () => ({
    start: Date.parse(rows[0].date),
    end: Date.parse(rows.at(-1).date)
  });

  function draw() {
    plot = drawSentiment($('chart'), {
      visible,
      windowRange,
      hover,
      crossDate,
      threshold: signalSettings().fearThreshold
    });
  }

  function mini() {
    drawOverview($('mini'), rows);
    if (!windowRange || !rows.length) return;
    const state = navigatorState({
      start: Date.parse(windowRange.start),
      end: Date.parse(windowRange.end)
    }, bounds(), $('mini').clientWidth);
    const timeline = $('timeline');
    timeline.min = state.min;
    timeline.max = state.max;
    timeline.value = state.value;
    timeline.style.setProperty('--window-width', state.thumbWidth + 'px');
    timeline.setAttribute('aria-valuetext', windowRange.start + ' 至 ' + windowRange.end);
  }

  function render() {
    if (!rows.length) return;
    const end = iso(Number($('timeline').value));
    const raw = customWindow
      ? rows.filter(r => r.date >= iso(customWindow.start) && r.date <= iso(customWindow.end))
      : selectRange(rows, $('range').value, end);

    windowRange = {
      start: customWindow ? iso(customWindow.start) : raw[0]?.date || end,
      end: customWindow ? iso(customWindow.end) : raw.at(-1)?.date || end,
      frequency: $('frequency').value
    };
    windowRange.calendar = [
      ...new Set([
        ...raw.map(r => r.date),
        ...marketCalendar.filter(date => date >= windowRange.start && date <= windowRange.end)
      ])
    ].sort();

    visible = aggregate(raw, $('frequency').value);
    hover = -1;
    crossDate = null;
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

    $('updated').textContent = '指数数据截至 ' + formatDate(rows.at(-1).date);
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
    setSignalSentiment(rows);
    $('timeline').min = Date.parse(rows[0].date);
    $('timeline').max = Date.parse(rows.at(-1).date);
    $('timeline').value = Date.parse(rows.at(-1).date);
    render();
    await loadHealth();
  }

  $('range').addEventListener('change', () => {
    if ($('range').value === 'custom') return;
    lastPreset = $('range').value;
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
    if (customWindow) {
      const span = customWindow.end - customWindow.start;
      customWindow = constrainWindow({ start: bounds().end - span, end: bounds().end }, bounds());
    }
    $('timeline').value = Date.parse(rows.at(-1).date);
    render();
  });

  $('timeline').addEventListener('input', () => {
    if (!windowRange || !rows.length) return;
    const end = Number($('timeline').value);
    const span = Date.parse(windowRange.end) - Date.parse(windowRange.start);
    applyWindow({ start: end - span, end });
  });

  $('chart').addEventListener('pointermove', e => {
    if (!plot || !visible.length) return;
    const rect = $('chart').getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (mx < plot.left || mx > plot.w - plot.right || my < plot.top || my > plot.h - plot.bottom) {
      hideHover();
      return;
    }
    hover = 0;
    for (let i = 1; i < visible.length; i++) {
      if (Math.abs(plot.x(visible[i].date) - mx) < Math.abs(plot.x(visible[hover].date) - mx)) {
        hover = i;
      }
    }
    const r = visible[hover];
    const tip = $('tooltip');
    tooltipContent(tip, {
      title: formatDate(r.date),
      rows: [
        ['情绪指数', r.score.toFixed(2)],
        ['市场情绪', sentimentLabel(r.score)],
        ['来源', sourceLabel(r.source)]
      ]
    });
    positionTooltip(tip, mx, my, rect.width);
    crossDate = null;
    draw();
    drawPrice(r.date);
  });

  function hideHover() {
    hover = -1;
    crossDate = null;
    $('tooltip').hidden = true;
    draw();
    drawPrice();
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
      visible.map(r => [r.date, r.score, rating(r.score), r.source].join(',')).join('\n');
    downloadCSV('fear-greed-' + visible[0].date + '-' + visible.at(-1).date + '.csv', csv);
  });

  new ResizeObserver(() => {
    if (rows.length) {
      draw();
      mini();
    }
  }).observe($('chart-wrap'));

  appEvents.addEventListener(events.marketHover, event => {
    hover = -1;
    crossDate = event.detail;
    $('tooltip').hidden = true;
    draw();
  });

  function applyWindow(view) {
    customWindow = constrainWindow(view, bounds());
    $('range').value = 'custom';
    render();
  }

  function resetWindow() {
    customWindow = null;
    $('range').value = lastPreset;
    $('timeline').value = Date.parse(rows.at(-1).date);
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
    marketCalendar = [...new Set([...marketCalendar, ...event.detail])].sort();
    if (rows.length) render();
  });

  appEvents.addEventListener(events.strategySettings, () => {
    if (rows.length) draw();
  });

  loadMarket();
  load().catch(error => {
    $('status').textContent = error.message + '。请检查本地数据文件后刷新页面。';
  });
}
