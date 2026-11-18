import { loadFundSnapshot } from '../../services/data-client.mjs';
import { createAppUpdateWatcher } from '../../ui/app-update.mjs';
import { sortFunds, FUND_SORT_FIELDS } from '../../domain/nasdaq-funds.mjs';
import { getFundGroup, FUND_GROUPS } from '../../domain/fund-groups.mjs';
import { performanceRows } from '../../domain/fund-performance.mjs';

const decimal = (value, digits = 2) => typeof value === 'number' && Number.isFinite(value)
  ? value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const percent = value => typeof value === 'number' && Number.isFinite(value)
  ? (value > 0 ? '+' : '') + decimal(value) + '%' : '—';
const timeLabel = value => value ? new Date(value).toLocaleString('zh-CN', {
  timeZone: 'Asia/Shanghai', hour12: false }) : '暂无成功更新';

export function initFundComparison() {
  const $ = id => document.getElementById(id);
  if (!$('fund-table')) return;
  const resolveGroup = search => {
    const queryGroup = new URLSearchParams(search || '').get('group');
    const fallbackGroup = document.body.dataset.fundGroup || 'nasdaq100';
    return getFundGroup(queryGroup && Object.hasOwn(FUND_GROUPS, queryGroup) ? queryGroup : fallbackGroup);
  };
  let group = resolveGroup(globalThis.location?.search);
  let benchmarkInfo = group.benchmark;
  const groupLinks = Object.keys(FUND_GROUPS).map(id => [id, $('fund-group-' + id)]).filter(([, node]) => node);
  function applyGroupMetadata() {
    benchmarkInfo = group.benchmark;
    if (document.body.dataset) document.body.dataset.fundGroup = group.id;
    const pageTitle = `${group.title} ETF 对比`;
    document.title = `${pageTitle} · 定投助手`;
    document.querySelector?.('meta[name="description"]')?.setAttribute('content', `对比国内${group.title} ETF 的参考溢价、年费率、净资产规模、价格与成交额，每日快照。`);
    $('fund-heading').textContent = '场内ETF对比';
    $('fund-count').textContent = `${group.funds.length} 只 / ${group.title}`;
    $('fund-table-scroll')?.setAttribute('aria-label', `${pageTitle}，可横向滚动`);
    $('fund-method').textContent = `参考溢价＝（最新价 ÷ IOPV − 1）× 100%。跨境 ETF 的 IOPV 有时差与估值局限，非当日最终净值；缺失时显示“—”。净资产规模使用最近披露值，日期逐只标注；国内基金年费率为管理费＋托管费，${benchmarkInfo.symbol} 为总费用率（Expense Ratio）。本页数据仅作国内场内 ETF 对比参考，不参与主站美股定投回测。`;
    $('fund-performance-note').textContent = `近1年、3年、5年均用分红、拆分调整后的前复权价格比值计算累计涨幅，不是年化收益。${benchmarkInfo.symbol} 为美元计价，国内场内 ETF 为人民币计价，不做汇率换算。${benchmarkInfo.symbol} 固定首行，不参与基金排序。`;
    $('fund-history-source').textContent = `历史前复权行情与 ${benchmarkInfo.symbol}：Yahoo Finance。`;
    $('benchmark-fee-source').href = benchmarkInfo.source;
    $('benchmark-fee-source').textContent = `${benchmarkInfo.symbol} 总费用率：${benchmarkInfo.provider} 官方披露`;
    for (const [id, link] of groupLinks) {
      if (id === group.id) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
  }
  applyGroupMetadata();
  let snapshot;
  const primaryControl = $('fund-sort');
  const secondaryControl = $('fund-secondary-sort');
  const headers = [...document.querySelectorAll('[data-fund-sort]')];
  for (const control of [primaryControl, secondaryControl]) {
    control.replaceChildren();
    if (control === secondaryControl) {
      const option = document.createElement('option');
      option.value = ''; option.textContent = '不设置'; control.append(option);
    }
    for (const [key, field] of Object.entries(FUND_SORT_FIELDS)) {
      for (const direction of [field.direction, field.direction === 'asc' ? 'desc' : 'asc']) {
        const option = document.createElement('option');
        option.value = key + ':' + direction;
        option.textContent = field.label + (direction === 'asc' ? ' ↑ 升序' : ' ↓ 降序');
        control.append(option);
      }
    }
  }
  primaryControl.value = 'premium:asc';
  secondaryControl.value = '';
  function updateSortIndicators(key, direction, secondary) {
    for (const option of secondaryControl.options) option.disabled = option.value.startsWith(key + ':');
    for (const button of headers) {
      const column = button.dataset.fundSort;
      const level = column === key ? 1 : column === secondary?.key ? 2 : 0;
      const order = level === 1 ? direction : secondary?.direction;
      button.querySelector('.fund-sort-indicator').textContent = level ? (order === 'asc' ? '↑' : '↓') + level : '';
      button.closest('th').removeAttribute('aria-sort');
      if (level === 1) button.closest('th').setAttribute('aria-sort', order === 'asc' ? 'ascending' : 'descending');
      button.setAttribute('aria-label', FUND_SORT_FIELDS[column].label + (level ? `，第${level}排序，${order === 'asc' ? '升序' : '降序'}` : '，点击排序'));
      button.classList.toggle('fund-sort-active', level > 0);
    }
    $('fund-sort-status').textContent = '第一：' + FUND_SORT_FIELDS[key].label + (direction === 'asc' ? ' ↑' : ' ↓') +
      (secondary ? '；第二：' + FUND_SORT_FIELDS[secondary.key].label + (secondary.direction === 'asc' ? ' ↑' : ' ↓') : '');
  }
  function render() {
    const [key, direction] = primaryControl.value.split(':');
    if (secondaryControl.value.startsWith(key + ':')) secondaryControl.value = '';
    const [secondKey, secondDirection] = secondaryControl.value.split(':');
    const secondary = secondKey ? { key: secondKey, direction: secondDirection } : null;
    updateSortIndicators(key, direction, secondary);
    const history = snapshot?.performance?.version === 2 && snapshot.performance.benchmark?.code === benchmarkInfo.symbol ? snapshot.performance : null;
    const rows = sortFunds(performanceRows(snapshot?.rows || [], history), key, direction, secondary);
    $('fund-table').replaceChildren();
    $('fund-benchmark').replaceChildren();
    function appendRow(row, benchmark = false) {
      const tr = document.createElement('tr');
      const identity = document.createElement('td');
      const link = document.createElement('a');
      link.href = benchmark ? benchmarkInfo.source : `https://fund.eastmoney.com/${row.code}.html`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = benchmark ? benchmarkInfo.name : row.manager + group.title;
      identity.append(link);
      const code = document.createElement('small');
      code.textContent = benchmark ? benchmarkInfo.symbol + ' · 美元' : row.code;
      identity.append(code);
      if (benchmark) {
        const badge = document.createElement('span');
        badge.className = 'fund-benchmark-badge'; badge.textContent = '基准'; identity.append(badge);
      }
      tr.append(identity);
      const cells = [
        { text: benchmark ? '—' : percent(row.premium) },
        {
          text: row.annualFee == null ? '—' : decimal(row.annualFee) + '%',
          title: benchmark ? '总费用率（Expense Ratio），' + benchmarkInfo.provider + ' 官方披露；核对日期：' + benchmarkInfo.checkedAt
            : '管理费＋托管费，最近核对：' + timeLabel(row.profileCheckedAt)
        },
        {
          text: benchmark ? '—' : decimal(row.netAssets === null ? null : row.netAssets / 1e8),
          note: row.scaleDate && !benchmark ? '截至 ' + row.scaleDate : ''
        },
        { text: benchmark ? (Number.isFinite(row.price) ? '$' + decimal(row.price) : '—') : decimal(row.price, 3) },
        { text: benchmark ? '—' : decimal(row.iopv, 4) },
        { text: benchmark ? '—' : decimal(row.amount === null ? null : row.amount / 1e8) },
        { text: row.quoteDate || '—' },
        ...[1, 3, 5].map(years => {
          const period = row.periods?.[years];
          return {
            text: period?.status === 'ok' ? percent(period.return) : period?.status === 'short-history' ? `未满${years}年` : '—',
            title: period?.status === 'ok' ? `${period.startDate} 至 ${period.endDate}；${benchmark ? '美元' : '人民币'}计价，前复权累计涨幅，非年化。`
              : row.performanceError ? '历史更新失败，暂不展示该只收益' : period?.status === 'short-history' ? `历史不足${years}年` : '历史数据不足'
          };
        })
      ];
      for (const cell of cells) {
        const td = document.createElement('td');
        td.textContent = cell.text;
        if (cell.title) td.title = cell.title;
        if (cell.note) {
          const date = document.createElement('small');
          date.textContent = cell.note;
          td.append(date);
        }
        tr.append(td);
      }
      $(benchmark ? 'fund-benchmark' : 'fund-table').append(tr);
    }
    // The benchmark has its own tbody, so sorting the fund rows never moves it.
    appendRow({ code: benchmarkInfo.symbol, ...history?.benchmark, annualFee: benchmarkInfo.annualFee }, true);
    $('benchmark-fee-source').href = benchmarkInfo.source;
    for (const row of rows) appendRow(row);
    $('fund-count').textContent = rows.length + ' 只基金';
    $('fund-empty').hidden = rows.length > 0;
    $('fund-updated').textContent = snapshot
      ? (snapshot.ok === false ? snapshot.error + ' · ' : '') + '快照采集：' + timeLabel(snapshot.checkedAt) + '（北京时间）'
      : '正在读取每日快照…';
    const known = rows.filter(row => Number.isFinite(row.premium));
    const lowest = sortFunds(known)[0];
    $('fund-lowest').textContent = lowest ? percent(lowest.premium) : '—';
    $('fund-lowest-name').textContent = lowest ? lowest.manager + ' · ' + lowest.code : '暂无有效参考净值';
    const total = rows.reduce((sum, row) => sum + (row.amount || 0), 0);
    $('fund-turnover').textContent = rows.length ? decimal(total / 1e8) + ' 亿' : '—';
    const dates = [...new Set(rows.map(row => row.quoteDate))].sort();
    $('fund-date').textContent = dates.length > 1 ? dates[0] + ' 至 ' + dates.at(-1) : dates[0] || '—';
    $('fund-coverage').textContent = known.length + ' / ' + group.funds.length + ' 只参考溢价可用';
    $('fund-source').textContent = '行情：' + (snapshot?.quoteSource || '东方财富 / 腾讯财经');
    $('fund-performance-status').textContent = (history?.ok === false ? history.error + ' · ' : '') +
      (history?.benchmark?.quoteDate ? '基准行情截至 ' + history.benchmark.quoteDate + ' · ' : '') +
      (history?.endDate ? '历史涨幅截至 ' + history.endDate : '暂无完整历史收益') +
      ' · 前复权累计涨幅 · ' + benchmarkInfo.symbol + ' 美元 / 场内 ETF 人民币 · 不做汇率换算' +
      (history?.complete === false ? ' · 部分历史数据不完整' : '');
  }
  let lastResumeCheck = 0;
  let resumeChecking = false;
  let initialLoadSettled = false;
  const appUpdates = createAppUpdateWatcher();
  let requestID = 0;
  const snapshotKey = value => (value ? JSON.stringify([
    value.checkedAt,
    value.lastAttemptAt,
    value.ok,
    value.performance?.endDate,
    value.performance?.ok,
    value.performance?.complete
  ]) : null);
  async function load({ silentOnError = false, animate = false } = {}) {
    const id = ++requestID;
    const panel = $('fund-comparison');
    try {
      const next = await loadFundSnapshot(group.id);
      if (id !== requestID) return;
      lastResumeCheck = Date.now();
      if (silentOnError && snapshot && snapshotKey(next) === snapshotKey(snapshot)) return;
      snapshot = next;
      render();
      panel?.classList?.remove?.('is-switching');
      if (animate && panel?.classList) {
        panel.classList.remove?.('is-revealed');
        void panel.offsetWidth;
        panel.classList.add?.('is-revealed');
      }
    } catch {
      if (id !== requestID) return;
      panel?.classList?.remove?.('is-switching');
      if (silentOnError && snapshot?.rows?.length) return;
      $('fund-updated').textContent = '基金快照读取失败，请稍后重试或运行基金数据更新。';
      if (!snapshot?.rows?.length) {
        $('fund-table').replaceChildren();
        $('fund-benchmark').replaceChildren();
        $('fund-performance-status').textContent = '历史涨幅暂不可用，请先完成基金数据更新。';
      }
      $('fund-empty').hidden = !!snapshot?.rows?.length;
    }
  }
  document.addEventListener?.('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || resumeChecking || !initialLoadSettled) return;
    if (globalThis.navigator?.onLine === false || Date.now() - lastResumeCheck < 60000) return;
    resumeChecking = true;
    lastResumeCheck = Date.now();
    try { await Promise.all([load({ silentOnError: true }), appUpdates.checkForUpdate()]); }
    finally { resumeChecking = false; }
  });
  for (const button of headers) button.addEventListener('click', event => {
    const key = button.dataset.fundSort;
    const control = event.shiftKey && !primaryControl.value.startsWith(key + ':') ? secondaryControl : primaryControl;
    const [current, direction] = control.value.split(':');
    control.value = key + ':' + (current === key ? (direction === 'asc' ? 'desc' : 'asc') : FUND_SORT_FIELDS[key].direction);
    render();
  });
  primaryControl.addEventListener('change', render);
  secondaryControl.addEventListener('change', render);
  function switchGroup(nextGroupId, { push = true } = {}) {
    if (!Object.hasOwn(FUND_GROUPS, nextGroupId) || nextGroupId === group.id) return;
    group = getFundGroup(nextGroupId);
    snapshot = null;
    if (push && globalThis.history?.pushState) {
      globalThis.history.pushState(null, '', `./${group.page}`);
    }
    applyGroupMetadata();
    const panel = $('fund-comparison');
    panel?.classList?.remove?.('is-revealed');
    panel?.classList?.add?.('is-switching');
    $('fund-updated').textContent = '正在读取每日快照…';
    $('fund-empty').hidden = true;
    void load({ animate: true });
  }
  for (const [id, link] of groupLinks) {
    link.addEventListener('click', event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      switchGroup(id);
    });
  }
  globalThis.addEventListener?.('popstate', () => {
    switchGroup(resolveGroup(globalThis.location?.search).id, { push: false });
  });
  void appUpdates.checkForUpdate();
  void load().finally(() => {
    initialLoadSettled = true;
    if (!lastResumeCheck) lastResumeCheck = Date.now();
  });
}
