import { loadMarketSnapshot } from '../../services/data-client.mjs';
import { createAppUpdateWatcher } from '../../ui/app-update.mjs';
import {
  ANCHOR_MODES,
  CHANNEL_ASSETS,
  CHANNEL_SYMBOLS,
  MS_PER_YEAR,
  SAMPLE_WINDOWS,
  buildChannelDataset,
  classifyChannelZ,
  evaluateChannelModel,
  interpolateLnPrice,
  parseIsoDateUtc
} from '../../domain/log-channel.mjs';
import {
  computeBodyDragAnchor,
  computeEndpointRotate,
  drawLogChannelLower,
  drawLogChannelUpper,
  drawValuationThermometer,
  hitTestChannelHandle,
  resolveChannelHover
} from './charts.mjs';
import {
  STORAGE_KEY,
  VALID_TABS,
  createDefaultChannelState,
  createDefaultSymbolConfig,
  loadChannelState,
  parseChannelState,
  probeChannelStorage,
  saveChannelState
} from './storage.mjs';

const FIXED_PRICE_BASIS = 'totalReturn';

function el(tag, attrs = null, children = []) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'className') node.className = v;
      else if (k === 'textContent') node.textContent = v;
      else if (k === 'dataset' && typeof v === 'object') {
        for (const [dk, dv] of Object.entries(v)) node.dataset[dk] = String(dv);
      } else if (v === true) node.setAttribute(k, '');
      else node.setAttribute(k, String(v));
    }
  }
  if (children.length) node.append(...children);
  return node;
}

function fmtPrice(v) {
  return Number.isFinite(v) ? '$' + v.toFixed(2) : '—';
}

function fmtPct(v, showPlus = true) {
  if (!Number.isFinite(v)) return '—';
  const sign = showPlus && v > 0 ? '+' : '';
  return `${sign}${(v * 100).toFixed(1)}%`;
}

function fmtSigned(v, digits = 2) {
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(digits);
}

function fmtBandSigned(v) {
  if (!Number.isFinite(v)) return '—';
  const rounded = Math.round(v * 10) / 10;
  if (Math.abs(rounded) < 0.05) return '0.0%';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(1)}%`;
}

function fmtRatePct(v) {
  if (!Number.isFinite(v)) return '—';
  const rounded = Math.round(v * 10) / 10;
  if (Math.abs(rounded) < 0.05) return '0.0%';
  return `${rounded < 0 ? '−' : ''}${Math.abs(rounded).toFixed(1)}%`;
}

function resolveTabFromQuery(search) {
  const param = new URLSearchParams(search || '').get('symbol');
  if (!param) return null;
  const upper = param.trim().toUpperCase();
  return VALID_TABS.has(upper) ? upper : null;
}

function syncQuerySymbol(tab) {
  if (!globalThis.history?.replaceState || !globalThis.location) return;
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.set('symbol', tab);
    globalThis.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch {
    // Ignore restricted location contexts.
  }
}

export function initLogChannelPage() {
  const $ = id => document.getElementById(id);
  if (!$('channel-tabs')) return;

  const { state, loadedFromKey, storageReadable } = loadChannelState();
  let storageAvailable = storageReadable && probeChannelStorage();
  const queryTab = resolveTabFromQuery(globalThis.location?.search);
  if (queryTab) state.activeTab = queryTab;
  if (loadedFromKey && loadedFromKey !== STORAGE_KEY && storageAvailable) {
    saveChannelState(state);
  }

  const rawSnapshots = new Map();
  const datasets = new Map();
  const loadErrors = new Map();
  let lastGeom = null;
  let dragState = null;
  let hoverHandle = null;
  let lastResumeCheck = 0;
  let resumeChecking = false;
  let initialSettled = false;
  let moreSettingsOpen = false;
  let resetConfirmTimer = null;
  const appUpdates = createAppUpdateWatcher();

  const tabButtons = [...document.querySelectorAll('#channel-tabs [role="tab"]')];
  const singlePanel = $('channel-single-panel');
  const comparePanel = $('channel-compare-panel');
  const loadStatus = $('channel-load-status');
  const storageBadge = $('channel-storage-badge');
  const btnSymbolReset = $('btn-symbol-reset');
  const btnResetAll = $('btn-reset-slopes');
  const tooltipEl = $('channel-tooltip');
  const chartCard = $('channel-chart-card');
  const upperCanvas = $('channel-upper-canvas');
  const lowerCanvas = $('channel-lower-canvas');
  const thermoCanvas = $('channel-thermo-canvas');

  const slopeSlider = $('channel-slope-slider');
  const slopeBadge = $('channel-slope-badge');
  const presetRow = $('channel-preset-row');
  const windowSelect = $('channel-window-select');
  const btnMoreSettings = $('btn-more-settings');
  const drawerEl = $('channel-more-settings');
  const btnAnchorRecent = $('btn-anchor-recent');
  const btnAnchorFull = $('btn-anchor-full');
  const anchorNote = $('channel-anchor-note');
  const offsetSlider = $('channel-offset-slider');
  const offsetVal = $('channel-offset-val');
  const offsetPill = $('channel-offset-pill');
  const offsetPillText = $('channel-offset-pill-text');
  const chkShowOrigLine = $('chk-show-orig-line');
  const chkShowPivot = $('chk-show-pivot');
  const chkShowProj = $('chk-show-proj');
  const btnResidualToggle = $('btn-residual-toggle');
  const residualWrap = $('channel-residual-wrap');

  const compWindowSelect = $('comp-window-select');
  const compAnchorSelect = $('comp-anchor-select');

  function rebuildDatasets() {
    datasets.clear();
    for (const sym of CHANNEL_SYMBOLS) {
      const snap = rawSnapshots.get(sym);
      if (!snap?.rows?.length) continue;
      try {
        const ds = buildChannelDataset(sym, snap.rows, {
          windowId: state.windowId,
          priceBasis: FIXED_PRICE_BASIS,
          rollingAnchorYears: 7
        });
        datasets.set(sym, ds);
        loadErrors.delete(sym);
      } catch (err) {
        loadErrors.set(sym, err?.message || '计算失败');
      }
    }
  }

  function isHistFollowActive(sym) {
    const cfg = state.symbols[sym];
    return Boolean(
      cfg?.followHistSlope &&
      cfg.customAnchor === null &&
      Math.abs(cfg.offsetPct) < 0.05 &&
      cfg.anchorMode === ANCHOR_MODES.fullPivot
    );
  }

  function freezeHistSlope(sym) {
    const cfg = state.symbols[sym];
    if (!cfg || !cfg.followHistSlope) return;
    const ds = datasets.get(sym);
    if (ds) {
      cfg.slopePct = Math.max(ds.minSlope, Math.min(ds.maxSlope, Math.round(ds.orig.slopePct * 10) / 10));
    }
    cfg.followHistSlope = false;
  }

  function isSymbolCustomized(sym) {
    return !isHistFollowActive(sym);
  }

  function updateStorageBadge() {
    if (!storageBadge) return;
    if (!storageAvailable) {
      storageBadge.hidden = false;
      storageBadge.textContent = '当前浏览器禁止本地缓存，调整仅本次有效';
      storageBadge.className = 'channel-storage-badge is-warn';
      return;
    }
    storageBadge.hidden = true;
    storageBadge.textContent = '';
  }

  function persistState() {
    const res = saveChannelState(state);
    storageAvailable = res.ok;
    updateStorageBadge();
    return res.ok;
  }

  function clearResetConfirm() {
    clearTimeout(resetConfirmTimer);
    resetConfirmTimer = null;
    if (!btnResetAll) return;
    delete btnResetAll.dataset.confirming;
    btnResetAll.classList.remove('is-confirming');
    btnResetAll.textContent = '恢复默认';
  }

  function evaluateSymbol(sym) {
    const ds = datasets.get(sym);
    if (!ds) return null;
    const cfg = state.symbols[sym] || createDefaultSymbolConfig(sym);
    const rawSlope = isHistFollowActive(sym)
      ? ds.orig.slopePct
      : (Number.isFinite(cfg.slopePct) ? cfg.slopePct : ds.defaultSlope);
    const clampedSlope = Math.max(ds.minSlope, Math.min(ds.maxSlope, rawSlope));
    return evaluateChannelModel(ds, {
      slopePct: clampedSlope,
      anchorMode: cfg.anchorMode,
      keepOrigSigma: true,
      offsetPct: cfg.offsetPct,
      customAnchor: cfg.customAnchor
    });
  }

  function syncSharedControls() {
    windowSelect.value = state.windowId;
    compWindowSelect.value = state.windowId;
    const statSymbols = CHANNEL_SYMBOLS.filter(
      sym => state.symbols[sym].customAnchor === null && Math.abs(state.symbols[sym].offsetPct) < 0.05
    );
    const statModes = new Set(statSymbols.map(sym => state.symbols[sym].anchorMode));
    compAnchorSelect.disabled = statSymbols.length === 0;
    compAnchorSelect.value = statModes.size === 1 ? [...statModes][0] : 'mixed';
    const hasLoadedActive = state.activeTab !== 'COMPARE' && datasets.has(state.activeTab);
    slopeSlider.disabled = !hasLoadedActive;
    offsetSlider.disabled = !hasLoadedActive;
  }

  function updateLoadStatus() {
    if (!datasets.size && !loadErrors.size) {
      loadStatus.textContent = '正在读取本地行情快照…';
      return;
    }
    const dates = [...datasets.values()].map(d => d.endDate).sort();
    const latest = dates.at(-1) || '—';
    const winLabel = SAMPLE_WINDOWS[state.windowId].label;
    if (loadErrors.size) {
      loadStatus.textContent = `已加载 ${datasets.size}/${CHANNEL_SYMBOLS.length} 只标的（截至 ${latest}） · 部分读取失败`;
    } else {
      loadStatus.textContent = `前复权（含股息） · 截至 ${latest} · ${winLabel}`;
    }
  }

  function updateTabsState({ scrollIntoView = false } = {}) {
    for (const tab of tabButtons) {
      const tabKey = tab.dataset.tab;
      const active = tabKey === state.activeTab;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
      if (active && scrollIntoView && typeof tab.scrollIntoView === 'function') {
        tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }

    for (const sym of CHANNEL_SYMBOLS) {
      const m = evaluateSymbol(sym);
      const zEl = $(`tab-z-${sym}`);
      if (!zEl) continue;
      if (!m) {
        zEl.textContent = loadErrors.has(sym) ? '!' : '—';
        zEl.className = 'channel-tab-z';
        continue;
      }
      zEl.textContent = fmtSigned(m.zEnd, 2);
      zEl.className = 'channel-tab-z';
    }
  }

  function renderSingleView(sym, { lockedYBounds = null } = {}) {
    const m = evaluateSymbol(sym);
    if (!m) return;

    const ds = m.dataset;
    const st = classifyChannelZ(m.zEnd);
    const activeTabBtn = $(`tab-btn-${sym}`);
    if (activeTabBtn) singlePanel.setAttribute('aria-labelledby', activeTabBtn.id);

    slopeSlider.min = String(ds.minSlope);
    slopeSlider.max = String(ds.maxSlope);
    const isHalfMultiple = Math.abs(m.slopePct * 2 - Math.round(m.slopePct * 2)) < 0.01;
    slopeSlider.step = isHalfMultiple ? '0.5' : '0.1';
    slopeSlider.value = m.slopePct.toFixed(1);
    slopeBadge.textContent = `${m.slopePct.toFixed(1)}%`;

    const cfg = state.symbols[sym];
    const histFollowActive = isHistFollowActive(sym);
    const presetButtons = ds.presets.map(preset => {
      const matched = preset.isOrig
        ? histFollowActive
        : (
          !histFollowActive &&
          !m.isCustomAnchored &&
          Math.abs(m.offsetPct) < 0.05 &&
          Math.abs(preset.value - m.slopePct) < 0.06
        );
      const btn = el('button', {
        type: 'button',
        className: `channel-chip-btn${matched ? ' is-active' : ''}`,
        textContent: preset.label
      });
      btn.addEventListener('click', () => {
        cfg.slopePct = preset.value;
        cfg.followHistSlope = Boolean(preset.isOrig);
        cfg.anchorMode = preset.isOrig ? ANCHOR_MODES.fullPivot : cfg.userPreferredAnchor;
        cfg.customAnchor = null;
        cfg.offsetPct = 0;
        persistState();
        renderAll();
      });
      return btn;
    });
    presetRow.replaceChildren(...presetButtons);

    if (btnSymbolReset) {
      btnSymbolReset.hidden = !isSymbolCustomized(sym);
    }

    // Drawer controls & offset state
    btnMoreSettings.setAttribute('aria-expanded', String(moreSettingsOpen));
    drawerEl.hidden = !moreSettingsOpen;
    btnAnchorRecent.setAttribute('aria-pressed', String(cfg.anchorMode === ANCHOR_MODES.recent7y));
    btnAnchorFull.setAttribute('aria-pressed', String(cfg.anchorMode === ANCHOR_MODES.fullPivot));

    const hasCustomPos = m.isCustomAnchored || Math.abs(m.offsetPct) >= 0.05;
    const clampedSliderOffset = Math.max(-40, Math.min(60, m.offsetPct));
    const isHalfOffset = Math.abs(clampedSliderOffset * 2 - Math.round(clampedSliderOffset * 2)) < 0.01;
    offsetSlider.step = isHalfOffset ? '0.5' : '0.1';
    offsetSlider.value = clampedSliderOffset.toFixed(1);
    offsetVal.textContent = `${m.offsetPct > 0 ? '+' : ''}${m.offsetPct.toFixed(1)}%`;
    offsetPill.hidden = !hasCustomPos;
    if (hasCustomPos) {
      offsetPillText.textContent = m.isCustomAnchored
        ? `已手调通道（相对基准 ${fmtSigned(m.offsetPct, 1)}%）`
        : `已手动平移 ${fmtSigned(m.offsetPct, 1)}%`;
    }

    anchorNote.textContent = m.isCustomAnchored
      ? `当前通道已锁定绝对锚点（${m.customAnchor.anchorDate} · $${m.customAnchor.anchorPrice.toFixed(2)}），切窗口或行情更新不会漂移；点击基准按钮或「复位」可还原统计锚点。`
      : (cfg.anchorMode === ANCHOR_MODES.recent7y
        ? `以近 7 年均值（${ds.recentWindow.startDate} ~ ${ds.recentWindow.endDate}）作为中枢锚点。`
        : `以全窗口均值（${ds.startDate} ~ ${ds.endDate}）作为保守压力测算锚点。`);

    chkShowOrigLine.checked = state.showOrigLine;
    chkShowPivot.checked = state.showPivot;
    chkShowProj.checked = state.showProjection;
    $('lg-orig-wrap').hidden = !state.showOrigLine;
    $('lg-pivot-wrap').hidden = !state.showPivot;

    // 4-column main-project-style summary strip
    const ddPct = m.latestPrice / ds.peakPrice - 1;
    $('kpi1-label').textContent = `${m.symbol} 最新收盘`;
    $('kpi1-price').textContent = fmtPrice(m.latestPrice);
    $('kpi1-foot').textContent = `${ds.endDate} · 距高点 ${fmtPct(ddPct)}`;

    $('kpi2-fit').textContent = fmtPrice(m.fitEnd);
    const anchorTag = m.isCustomAnchored
      ? `手调锚定 (${m.customAnchor.anchorDate})`
      : (cfg.anchorMode === ANCHOR_MODES.recent7y ? '近 7 年均值' : '全周期均值');
    const offsetTag = !m.isCustomAnchored && hasCustomPos ? ` · 平移 ${fmtSigned(m.offsetPct, 1)}%` : '';
    $('kpi2-foot').textContent = `按 ${m.slopePct.toFixed(1)}% 增速 · ${anchorTag}${offsetTag}`;

    const kpi3Dev = $('kpi3-dev');
    const devWord = m.devPct >= 0 ? '偏高' : '折价';
    kpi3Dev.textContent = `${devWord} ${fmtPct(Math.abs(m.devPct), false)}`;
    kpi3Dev.className = '';
    $('kpi3-foot').textContent = `${st.label} · z = ${fmtSigned(m.zEnd, 2)}`;

    $('kpi4-buy').textContent = fmtPrice(m.priceM10);
    const spaceM10 = m.priceM10 / m.latestPrice - 1;
    $('kpi4-foot').textContent = `距现价 ${fmtPct(spaceM10)} · −1.5σ ${fmtPrice(m.priceM15)}`;

    // Chart title & residual visibility
    $('channel-chart-title').textContent = `${m.symbol} 价格通道（${m.slopePct.toFixed(1)}% · ±1σ / ±2σ）`;
    btnResidualToggle.setAttribute('aria-expanded', String(state.showResidual));
    btnResidualToggle.textContent = state.showResidual ? '收起' : '展开';
    residualWrap.hidden = !state.showResidual;

    // Entry price matrix
    $('channel-table-subtitle').textContent =
      `按 ${m.slopePct.toFixed(1)}% 年化增速外推；蓝色高亮行为当前价格所处区间。`;
    $('th-now-date').textContent = `当下参考价 (${ds.endDate.slice(0, 7)})`;
    $('th-6m-date').textContent = `6 个月后 (${ds.proj6mDate.slice(0, 7)})`;
    $('th-12m-date').textContent = `12 个月后 (${ds.proj12mDate.slice(0, 7)})`;

    const tierRows = m.tiers.map(tier => {
      const rowCls = tier.isCurrent ? 'row-current' : (tier.k <= -1.0 ? 'row-buy' : '');
      const diffCls = tier.diffPct < -0.004 ? 'is-good' : (tier.diffPct > 0.004 ? 'is-hot' : '');
      const diffUsd = `${tier.diffUsd >= 0 ? '+' : ''}${tier.diffUsd.toFixed(1)}`;

      const tierCellChildren = [
        el('span', { className: 'channel-tier-dot', style: `background:${tier.color}` }),
        el('span', { className: 'channel-tier-name', textContent: tier.code }),
        el('span', { className: 'channel-tier-desc', textContent: tier.desc })
      ];
      if (tier.isCurrent) tierCellChildren.push(el('span', { className: 'channel-now-tag', textContent: '当前' }));

      return el('tr', { className: rowCls || null }, [
        el('th', { scope: 'row' }, [
          el('div', { className: 'channel-tier-cell' }, tierCellChildren)
        ]),
        el('td', { textContent: tier.k === 0 ? '0.0%' : fmtPct(tier.devCenter) }),
        el('td', { className: 'is-strong', textContent: fmtPrice(tier.pNow) }),
        el('td', { className: diffCls }, [
          el('strong', { textContent: fmtPct(tier.diffPct) }),
          el('span', { className: 'channel-sub-delta', textContent: ` (${diffUsd})` })
        ]),
        el('td', { className: 'is-strong', textContent: fmtPrice(tier.p6m) }),
        el('td', { className: 'is-strong', textContent: fmtPrice(tier.p12m) })
      ]);
    });
    $('channel-entry-tbody').replaceChildren(...tierRows);

    // Bottom collapsed historical reference summary & empirical statistics
    const rs = ds.returnStats;
    $('channel-method-summary').textContent =
      `样本区间：${ds.startDate} 至 ${ds.endDate}（共 ${ds.pointCount} 个交易日，约 ${rs.spanYears.toFixed(1)} 年）· 区间趋势年化约 ${ds.orig.slopePct.toFixed(1)}% · 拟合优度 ${ds.orig.r2.toFixed(3)} · 1σ 偏离幅度 ${fmtBandSigned(m.bandDown1sPct)} / ${fmtBandSigned(m.bandUp1sPct)}（对数 σ = ${m.sigmaUsed.toFixed(3)}）。`;

    const statsEl = $('channel-method-stats');
    if (statsEl) {
      const curEmp = m.empirical;
      const origEmp = ds.orig.empirical;
      const isPureOrig =
        !m.isCustomAnchored &&
        Math.abs(m.offsetPct) < 0.05 &&
        m.anchorMode === ANCHOR_MODES.fullPivot &&
        Math.abs(m.slopePct - ds.orig.slopePct) < 0.05;
      const coverageText = isPureOrig
        ? `当前通道样本内 ±1σ / ±2σ 实际覆盖 ${curEmp.in1sPct.toFixed(1)}% / ${curEmp.in2sPct.toFixed(1)}% 交易日`
        : `当前通道历史覆盖 ±1σ ${curEmp.in1sPct.toFixed(1)}% / ±2σ ${curEmp.in2sPct.toFixed(1)}%（纯历史趋势线为 ${origEmp.in1sPct.toFixed(1)}% / ${origEmp.in2sPct.toFixed(1)}%）`;
      statsEl.textContent =
        `统计参考：区间首尾年化复利 ${fmtRatePct(rs.cagrPct)}（日收益年化波动率 ${rs.annVolPct.toFixed(1)}%，按收益率差分估算年化复利 95% 统计置信区间 ${fmtRatePct(rs.cagrCiLowPct)} ~ ${fmtRatePct(rs.cagrCiHighPct)}）· 当前收盘位于当前通道第 ${curEmp.percentilePct.toFixed(1)}% 历史分位 · ${coverageText}。`;
    }

    renderDualCharts(m, { lockedYBounds });
  }

  function renderDualCharts(model, { lockedYBounds = null } = {}) {
    if (!model) return;
    const dragSide = dragState?.mode === 'left' || dragState?.mode === 'right' ? dragState.mode : null;
    lastGeom = drawLogChannelUpper(upperCanvas, model, {
      showOrigLine: state.showOrigLine,
      showPivot: state.showPivot,
      showProjection: state.showProjection,
      hoverT: state.hoverT,
      lockedYBounds,
      activeHandle: dragSide || hoverHandle,
      pinnedHandle: dragSide ? (dragSide === 'left' ? 'right' : 'left') : null
    });
    if (state.showResidual) {
      drawLogChannelLower(lowerCanvas, model, {
        showProjection: state.showProjection,
        hoverT: state.hoverT,
        geom: lastGeom
      });
    }
  }

  function renderCompareView() {
    const models = CHANNEL_SYMBOLS.map(evaluateSymbol).filter(Boolean);
    if (!models.length) {
      $('channel-comp-tbody').replaceChildren();
      return;
    }

    let bestM = models[0];
    for (const m of models) {
      if (m.zEnd < bestM.zEnd) bestM = m;
    }
    const bestClass = classifyChannelZ(bestM.zEnd);
    $('comp-best-summary').replaceChildren(
      document.createTextNode('当前安全边际最高：'),
      el('strong', { textContent: bestM.symbol }),
      document.createTextNode(`（z = ${fmtSigned(bestM.zEnd, 2)} · ${bestClass.label}）`)
    );

    drawValuationThermometer(thermoCanvas, models);

    const rows = models.map(m => {
      const st = classifyChannelZ(m.zEnd);
      const sp10 = m.priceM10 / m.latestPrice - 1;
      const isBest = m.symbol === bestM.symbol;
      const hasCustomPos = m.isCustomAnchored || Math.abs(m.offsetPct) >= 0.05;

      const tickerBtnChildren = [
        el('span', { className: 'channel-tier-dot', style: `background:${st.dotColor}` }),
        el('div', { className: 'channel-ticker-meta' }, [
          el('div', { className: 'channel-tier-name' }, [
            document.createTextNode(`${m.symbol} ↗`),
            isBest ? el('span', { className: 'channel-badge badge-buy-zone', textContent: '相对便宜' }) : null
          ].filter(Boolean)),
          el('div', { className: 'channel-tier-desc', textContent: m.dataset.shortName })
        ])
      ];

      const tickerBtn = el('button', {
        type: 'button',
        className: 'channel-ticker-jump',
        'aria-label': `查看 ${m.symbol} 通道详情`
      }, tickerBtnChildren);
      tickerBtn.addEventListener('click', () => {
        selectTab(m.symbol, { scrollTab: true });
        globalThis.scrollTo?.({ top: 0, behavior: 'smooth' });
      });

      const minusBtn = el('button', {
        type: 'button',
        className: 'channel-step-btn',
        'aria-label': `降低 ${m.symbol} 预期增速`,
        textContent: '−'
      });
      minusBtn.addEventListener('click', () => {
        freezeHistSlope(m.symbol);
        const next = Math.round((state.symbols[m.symbol].slopePct - 0.5) * 2) / 2;
        state.symbols[m.symbol].slopePct = Math.max(m.dataset.minSlope, Math.min(m.dataset.maxSlope, next));
        persistState();
        renderAll();
      });

      const plusBtn = el('button', {
        type: 'button',
        className: 'channel-step-btn',
        'aria-label': `提高 ${m.symbol} 预期增速`,
        textContent: '+'
      });
      plusBtn.addEventListener('click', () => {
        freezeHistSlope(m.symbol);
        const next = Math.round((state.symbols[m.symbol].slopePct + 0.5) * 2) / 2;
        state.symbols[m.symbol].slopePct = Math.max(m.dataset.minSlope, Math.min(m.dataset.maxSlope, next));
        persistState();
        renderAll();
      });

      const fitCellChildren = [document.createTextNode(fmtPrice(m.fitEnd))];
      if (hasCustomPos) {
        fitCellChildren.push(el('div', {
          className: 'channel-hist-note',
          textContent: `手调 ${fmtSigned(m.offsetPct, 1)}%`
        }));
      }

      return el('tr', { className: isBest ? 'row-buy' : null }, [
        el('th', { scope: 'row' }, [tickerBtn]),
        el('td', { className: 'is-center' }, [
          el('div', { className: 'channel-inline-slope' }, [
            minusBtn,
            el('span', { className: 'channel-inline-val', textContent: `${m.slopePct.toFixed(1)}%` }),
            plusBtn
          ]),
          el('div', { className: 'channel-hist-note', textContent: `历史 ${m.dataset.orig.slopePct.toFixed(1)}%` })
        ]),
        el('td', { className: 'is-strong', textContent: fmtPrice(m.latestPrice) }),
        el('td', null, fitCellChildren),
        el('td', null, [
          el('strong', { className: st.valueClass, textContent: fmtPct(m.devPct) }),
          el('span', { className: 'channel-sub-delta', textContent: ` (z=${fmtSigned(m.zEnd, 2)})` })
        ]),
        el('td', null, [
          el('strong', { className: 'is-good', textContent: fmtPrice(m.priceM10) }),
          el('span', { className: 'channel-sub-delta', textContent: ` (${fmtPct(sp10)})` })
        ]),
        el('td', null, [
          el('span', { className: `channel-badge ${st.badgeClass}`, textContent: st.label })
        ])
      ]);
    });

    $('channel-comp-tbody').replaceChildren(...rows);
  }

  function renderAll({ scrollTab = false, lockedYBounds = null } = {}) {
    syncSharedControls();
    updateLoadStatus();
    updateStorageBadge();
    updateTabsState({ scrollIntoView: scrollTab });

    const isCompare = state.activeTab === 'COMPARE';
    singlePanel.hidden = isCompare;
    comparePanel.hidden = !isCompare;
    if (isCompare) {
      renderCompareView();
    } else {
      renderSingleView(state.activeTab, { lockedYBounds });
    }
  }

  function selectTab(tabKey, { scrollTab = false, focusTab = false } = {}) {
    if (!VALID_TABS.has(tabKey)) return;
    const needsDragFlush = Boolean(dragState?.moved);
    dragState = null;
    hoverHandle = null;
    clearResetConfirm();
    state.activeTab = tabKey;
    state.hoverT = null;
    upperCanvas.classList.remove('is-handle-hover', 'is-dragging');
    tooltipEl.hidden = true;
    syncQuerySymbol(tabKey);
    if (needsDragFlush || VALID_TABS.has(tabKey)) {
      persistState();
    }
    renderAll({ scrollTab });
    if (focusTab) {
      const targetBtn = tabButtons.find(btn => btn.dataset.tab === tabKey);
      targetBtn?.focus?.();
    }
  }

  function renderTooltip(model, clientX, clientY, hover) {
    const t = hover.targetT;
    const fitP = model.priceFit(t);
    const pM10 = fitP * Math.exp(-model.sigmaUsed);
    const pM20 = fitP * Math.exp(-2.0 * model.sigmaUsed);

    const nodes = [
      el('div', { className: 'channel-tt-head' }, [
        el('span', { className: 'channel-tt-date', textContent: hover.dateStr }),
        el('span', { className: 'channel-tt-tag', textContent: hover.isProjection ? '未来推演' : `${model.symbol} 收盘` })
      ])
    ];

    if (!hover.isProjection) {
      const actP = hover.snappedPoint ? hover.snappedPoint.price : Math.exp(interpolateLnPrice(model.dataset.points, t));
      const res = Math.log(actP) - model.lnFit(t);
      const z = model.sigmaUsed > 0 ? res / model.sigmaUsed : 0;
      const dev = actP / fitP - 1;
      const zCls = z <= -0.75 ? 'is-good' : (z >= 0.75 ? 'is-hot' : '');
      nodes.push(
        el('div', { className: 'channel-tt-row' }, [
          el('span', { textContent: `${model.symbol} 收盘价` }),
          el('strong', { textContent: fmtPrice(actP) })
        ]),
        el('div', { className: 'channel-tt-row' }, [
          el('span', { textContent: '合理中枢' }),
          el('strong', { textContent: fmtPrice(fitP) })
        ]),
        el('div', { className: 'channel-tt-row' }, [
          el('span', { textContent: '偏离 / Z 值' }),
          el('strong', { className: zCls || null, textContent: `${fmtPct(dev)} (z=${fmtSigned(z, 2)})` })
        ]),
        el('div', { className: 'channel-tt-row channel-tt-foot' }, [
          el('span', { textContent: '−1σ / −2σ' }),
          el('span', { textContent: `${fmtPrice(pM10)} / ${fmtPrice(pM20)}` })
        ])
      );
    } else {
      const pM15 = fitP * Math.exp(-1.5 * model.sigmaUsed);
      nodes.push(
        el('div', { className: 'channel-tt-row' }, [
          el('span', { textContent: '推演中枢 (0σ)' }),
          el('strong', { textContent: fmtPrice(fitP) })
        ]),
        el('div', { className: 'channel-tt-row' }, [
          el('span', { textContent: '−1.0σ 常规买点' }),
          el('strong', { className: 'is-good', textContent: fmtPrice(pM10) })
        ]),
        el('div', { className: 'channel-tt-row' }, [
          el('span', { textContent: '−1.5σ 击球区' }),
          el('strong', { className: 'is-good', textContent: fmtPrice(pM15) })
        ]),
        el('div', { className: 'channel-tt-row' }, [
          el('span', { textContent: '−2.0σ 黄金坑' }),
          el('strong', { className: 'is-good', textContent: fmtPrice(pM20) })
        ])
      );
    }

    tooltipEl.replaceChildren(...nodes);
    tooltipEl.hidden = false;

    const cardRect = chartCard.getBoundingClientRect();
    const tipW = tooltipEl.offsetWidth || 236;
    const tipH = tooltipEl.offsetHeight || 128;
    let left = clientX - cardRect.left + 16;
    if (left + tipW > cardRect.width - 10) left = clientX - cardRect.left - tipW - 16;
    left = Math.max(8, left);
    const top = Math.max(40, Math.min(cardRect.height - tipH - 12, clientY - cardRect.top - tipH / 2));
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
  }

  function clearHover() {
    const hadHoverHandle = Boolean(hoverHandle);
    hoverHandle = null;
    upperCanvas.classList.remove('is-handle-hover');
    if (state.hoverT === null && !hadHoverHandle) return;
    state.hoverT = null;
    tooltipEl.hidden = true;
    if (state.activeTab !== 'COMPARE') {
      renderDualCharts(evaluateSymbol(state.activeTab));
    }
  }

  function handlePointer(canvas, clientX, clientY) {
    if (state.activeTab === 'COMPARE' || dragState) return;
    const model = evaluateSymbol(state.activeTab);
    if (!model) return;
    const hover = resolveChannelHover(canvas, lastGeom, model, clientX, state.showProjection);
    if (!hover) {
      clearHover();
      return;
    }
    state.hoverT = hover.targetT;
    renderDualCharts(model);
    renderTooltip(model, clientX, clientY, hover);
  }

  function resetCurrentOffset() {
    if (state.activeTab === 'COMPARE') return;
    const cfg = state.symbols[state.activeTab];
    freezeHistSlope(state.activeTab);
    cfg.offsetPct = 0;
    cfg.customAnchor = null;
    persistState();
    renderAll();
  }

  function resetCurrentSymbol() {
    if (state.activeTab === 'COMPARE') return;
    state.symbols[state.activeTab] = createDefaultSymbolConfig(state.activeTab);
    persistState();
    renderAll();
  }

  // Tablist click & ARIA keyboard navigation
  for (const tab of tabButtons) {
    tab.addEventListener('click', () => {
      selectTab(tab.dataset.tab, { scrollTab: true });
    });
  }
  $('channel-tabs').addEventListener('keydown', event => {
    const currentIdx = tabButtons.findIndex(btn => btn.dataset.tab === state.activeTab);
    if (currentIdx < 0) return;
    let nextIdx = null;
    if (event.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabButtons.length;
    else if (event.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabButtons.length) % tabButtons.length;
    else if (event.key === 'Home') nextIdx = 0;
    else if (event.key === 'End') nextIdx = tabButtons.length - 1;
    if (nextIdx === null) return;
    event.preventDefault();
    selectTab(tabButtons[nextIdx].dataset.tab, { scrollTab: true, focusTab: true });
  });

  // Shared window selects
  function setWindow(id) {
    if (!Object.hasOwn(SAMPLE_WINDOWS, id) || state.windowId === id) return;
    state.windowId = id;
    persistState();
    rebuildDatasets();
    renderAll();
  }
  windowSelect.addEventListener('change', event => setWindow(event.target.value));
  compWindowSelect.addEventListener('change', event => setWindow(event.target.value));
  btnSymbolReset?.addEventListener('click', resetCurrentSymbol);

  // Slope slider
  for (const evt of ['mousedown', 'touchstart', 'keydown']) {
    slopeSlider.addEventListener(evt, () => {
      slopeSlider.step = '0.5';
    }, { passive: true });
  }
  slopeSlider.addEventListener('input', event => {
    if (state.activeTab === 'COMPARE' || !datasets.has(state.activeTab)) return;
    const val = Number(event.target.value);
    if (!Number.isFinite(val)) return;
    state.symbols[state.activeTab].slopePct = val;
    state.symbols[state.activeTab].followHistSlope = false;
    persistState();
    renderAll();
  });

  // Drawer toggle & inside controls
  btnMoreSettings.addEventListener('click', () => {
    moreSettingsOpen = !moreSettingsOpen;
    btnMoreSettings.setAttribute('aria-expanded', String(moreSettingsOpen));
    drawerEl.hidden = !moreSettingsOpen;
  });

  btnAnchorRecent.addEventListener('click', () => {
    if (state.activeTab === 'COMPARE') return;
    const cfg = state.symbols[state.activeTab];
    freezeHistSlope(state.activeTab);
    cfg.anchorMode = ANCHOR_MODES.recent7y;
    cfg.userPreferredAnchor = ANCHOR_MODES.recent7y;
    cfg.customAnchor = null;
    cfg.offsetPct = 0;
    persistState();
    renderAll();
  });
  btnAnchorFull.addEventListener('click', () => {
    if (state.activeTab === 'COMPARE') return;
    const cfg = state.symbols[state.activeTab];
    freezeHistSlope(state.activeTab);
    cfg.anchorMode = ANCHOR_MODES.fullPivot;
    cfg.userPreferredAnchor = ANCHOR_MODES.fullPivot;
    cfg.customAnchor = null;
    cfg.offsetPct = 0;
    persistState();
    renderAll();
  });

  for (const evt of ['mousedown', 'touchstart', 'keydown']) {
    offsetSlider.addEventListener(evt, () => {
      offsetSlider.step = '0.5';
    }, { passive: true });
  }
  offsetSlider.addEventListener('input', event => {
    if (state.activeTab === 'COMPARE') return;
    const ds = datasets.get(state.activeTab);
    if (!ds) return;
    const val = Number(event.target.value);
    if (!Number.isFinite(val)) return;
    const clampedPct = Math.max(-40, Math.min(60, Math.round(val * 2) / 2));
    const cfg = state.symbols[state.activeTab];
    freezeHistSlope(state.activeTab);
    if (Math.abs(clampedPct) < 0.05) {
      cfg.offsetPct = 0;
      cfg.customAnchor = null;
    } else {
      const basePivot = cfg.anchorMode === ANCHOR_MODES.fullPivot ? ds.pivots.full : ds.pivots.recent7y;
      cfg.offsetPct = clampedPct;
      cfg.customAnchor = {
        anchorDate: basePivot.date,
        anchorPrice: Number((basePivot.price * (1 + clampedPct / 100)).toFixed(4))
      };
    }
    persistState();
    renderAll();
  });
  $('btn-offset-reset').addEventListener('click', resetCurrentOffset);
  $('btn-offset-reset-drawer').addEventListener('click', resetCurrentOffset);

  chkShowOrigLine.addEventListener('change', event => {
    state.showOrigLine = Boolean(event.target.checked);
    persistState();
    renderAll();
  });
  chkShowPivot.addEventListener('change', event => {
    state.showPivot = Boolean(event.target.checked);
    persistState();
    renderAll();
  });
  chkShowProj.addEventListener('change', event => {
    state.showProjection = Boolean(event.target.checked);
    persistState();
    renderAll();
  });

  btnResidualToggle.addEventListener('click', () => {
    state.showResidual = !state.showResidual;
    persistState();
    renderAll();
  });

  // Compare view controls (protect manually anchored symbols)
  compAnchorSelect.addEventListener('change', event => {
    const val = event.target.value;
    if (!Object.hasOwn(ANCHOR_MODES, val)) return;
    for (const sym of CHANNEL_SYMBOLS) {
      const cfg = state.symbols[sym];
      if (cfg.customAnchor !== null || Math.abs(cfg.offsetPct) >= 0.05) continue;
      freezeHistSlope(sym);
      cfg.anchorMode = val;
      cfg.userPreferredAnchor = val;
    }
    persistState();
    renderAll();
  });
  btnResetAll.addEventListener('click', () => {
    if (btnResetAll.dataset.confirming !== '1') {
      btnResetAll.dataset.confirming = '1';
      btnResetAll.classList.add('is-confirming');
      btnResetAll.textContent = '再次点击确认重置';
      clearTimeout(resetConfirmTimer);
      resetConfirmTimer = setTimeout(clearResetConfirm, 4000);
      return;
    }
    clearResetConfirm();
    for (const sym of CHANNEL_SYMBOLS) {
      state.symbols[sym] = createDefaultSymbolConfig(sym);
    }
    persistState();
    renderAll();
  });

  // Mouse/pen drag on upper canvas: drag endpoint handles to rotate, or body to translate vertically
  upperCanvas.addEventListener('pointerdown', event => {
    if (
      state.activeTab === 'COMPARE' ||
      (event.pointerType !== 'mouse' && event.pointerType !== 'pen') ||
      event.button !== 0 ||
      !lastGeom
    ) {
      return;
    }
    const hit = hitTestChannelHandle(upperCanvas, lastGeom, event.clientX, event.clientY);
    if (!hit) return;

    if (hit === 'left' || hit === 'right') {
      const fixedSide = hit === 'left' ? 'right' : 'left';
      const fixedHandle = lastGeom.handles?.[fixedSide];
      const dragHandle = lastGeom.handles?.[hit];
      if (!fixedHandle || !dragHandle) return;
      hoverHandle = hit;
      upperCanvas.classList.add('is-handle-hover');
      dragState = {
        mode: hit,
        pointerId: event.pointerId,
        startY: event.clientY,
        fixedT: fixedHandle.t,
        fixedLnP: fixedHandle.lnP,
        dragT: dragHandle.t,
        geom: { ...lastGeom },
        lockedYBounds: { lnYMin: lastGeom.lnYMin, lnYMax: lastGeom.lnYMax },
        lastSaveAt: 0,
        moved: false
      };
      renderDualCharts(evaluateSymbol(state.activeTab), { lockedYBounds: dragState.lockedYBounds });
    } else {
      const model = evaluateSymbol(state.activeTab);
      if (!model) return;
      const anchorMs = parseIsoDateUtc(model.basePivot.date);
      const anchorT = Number.isFinite(anchorMs)
        ? (anchorMs - model.dataset.baseMs) / MS_PER_YEAR
        : model.basePivot.t;
      dragState = {
        mode: 'body',
        pointerId: event.pointerId,
        startY: event.clientY,
        startAnchorDate: model.basePivot.date,
        startAnchorPrice: Math.exp(model.lnFit(anchorT)),
        geom: { ...lastGeom },
        lockedYBounds: { lnYMin: lastGeom.lnYMin, lnYMax: lastGeom.lnYMax },
        lastSaveAt: 0,
        moved: false
      };
    }
    try {
      upperCanvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Ignore capture errors on synthetic or restricted pointer events.
    }
  });

  upperCanvas.addEventListener('pointermove', event => {
    if (dragState && event.pointerId === dragState.pointerId) {
      if (!dragState.moved && Math.abs(event.clientY - dragState.startY) <= 3) return;
      dragState.moved = true;
      state.hoverT = null;
      tooltipEl.hidden = true;
      upperCanvas.classList.add('is-dragging');
      const cfg = state.symbols[state.activeTab];
      if (dragState.mode === 'left' || dragState.mode === 'right') {
        const model = evaluateSymbol(state.activeTab);
        if (model) {
          const { slopePct, offsetPct, customAnchor } = computeEndpointRotate(
            upperCanvas,
            dragState.geom,
            model,
            {
              fixedT: dragState.fixedT,
              fixedLnP: dragState.fixedLnP,
              dragT: dragState.dragT
            },
            event.clientY,
            cfg.anchorMode
          );
          cfg.slopePct = slopePct;
          cfg.followHistSlope = false;
          cfg.offsetPct = offsetPct;
          cfg.customAnchor = customAnchor;
        }
      } else {
        const model = evaluateSymbol(state.activeTab);
        if (model) {
          freezeHistSlope(state.activeTab);
          const { customAnchor, offsetPct } = computeBodyDragAnchor(
            dragState.geom,
            dragState.startY,
            event.clientY,
            model,
            {
              startAnchorDate: dragState.startAnchorDate,
              startAnchorPrice: dragState.startAnchorPrice,
              anchorMode: cfg.anchorMode
            }
          );
          cfg.customAnchor = customAnchor;
          cfg.offsetPct = offsetPct;
        }
      }
      if (Date.now() - dragState.lastSaveAt >= 120) {
        dragState.lastSaveAt = Date.now();
        persistState();
      }
      renderAll({ lockedYBounds: dragState.lockedYBounds });
      return;
    }

    if (event.pointerType === 'mouse' && state.activeTab !== 'COMPARE' && lastGeom) {
      const hit = hitTestChannelHandle(upperCanvas, lastGeom, event.clientX, event.clientY);
      const nextHandle = hit === 'left' || hit === 'right' ? hit : null;
      if (nextHandle !== hoverHandle) {
        hoverHandle = nextHandle;
        upperCanvas.classList.toggle('is-handle-hover', Boolean(hoverHandle));
        if (hoverHandle) {
          state.hoverT = null;
          tooltipEl.hidden = true;
        }
        renderDualCharts(evaluateSymbol(state.activeTab));
      }
      if (hoverHandle) return;
    }

    handlePointer(upperCanvas, event.clientX, event.clientY);
  });

  function finishDrag(event = null, { force = false } = {}) {
    if (!dragState) return;
    if (!force && event?.pointerId !== undefined && event.pointerId !== dragState.pointerId) return;
    const pointerId = dragState.pointerId;
    const didMove = dragState.moved;
    const wasHandle = dragState.mode === 'left' || dragState.mode === 'right';
    dragState = null;
    upperCanvas.classList.remove('is-dragging');
    try {
      if (pointerId !== undefined && upperCanvas.hasPointerCapture?.(pointerId)) {
        upperCanvas.releasePointerCapture(pointerId);
      }
    } catch {
      // Ignore release errors after lost capture.
    }
    if (didMove) {
      persistState();
      renderAll();
    } else if (wasHandle && state.activeTab !== 'COMPARE') {
      renderDualCharts(evaluateSymbol(state.activeTab));
    }
  }

  upperCanvas.addEventListener('pointerup', finishDrag);
  upperCanvas.addEventListener('pointercancel', finishDrag);
  upperCanvas.addEventListener('lostpointercapture', finishDrag);
  globalThis.addEventListener?.('pointerup', event => finishDrag(event));
  globalThis.addEventListener?.('blur', () => finishDrag(null, { force: true }));
  globalThis.addEventListener?.('pagehide', () => finishDrag(null, { force: true }));
  globalThis.addEventListener?.('storage', event => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    const prevWindow = state.windowId;
    const remoteState = event.key === STORAGE_KEY
      ? parseChannelState(event.newValue)
      : createDefaultChannelState();
    state.windowId = remoteState.windowId;
    state.showOrigLine = remoteState.showOrigLine;
    state.showPivot = remoteState.showPivot;
    state.showProjection = remoteState.showProjection;
    state.showResidual = remoteState.showResidual;
    state.symbols = remoteState.symbols;
    if (state.windowId !== prevWindow) {
      rebuildDatasets();
    }
    renderAll();
  });
  upperCanvas.addEventListener('mouseleave', () => {
    if (!dragState) clearHover();
  });

  // Touch hover on upper canvas & mouse/touch hover on lower canvas
  upperCanvas.addEventListener('touchstart', event => {
    if (event.touches.length === 1) handlePointer(upperCanvas, event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: true });
  upperCanvas.addEventListener('touchmove', event => {
    if (event.touches.length === 1) handlePointer(upperCanvas, event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: true });
  upperCanvas.addEventListener('touchend', () => setTimeout(clearHover, 1800));

  lowerCanvas.addEventListener('mousemove', event => handlePointer(lowerCanvas, event.clientX, event.clientY));
  lowerCanvas.addEventListener('mouseleave', clearHover);
  lowerCanvas.addEventListener('touchstart', event => {
    if (event.touches.length === 1) handlePointer(lowerCanvas, event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: true });
  lowerCanvas.addEventListener('touchmove', event => {
    if (event.touches.length === 1) handlePointer(lowerCanvas, event.touches[0].clientX, event.touches[0].clientY);
  }, { passive: true });
  lowerCanvas.addEventListener('touchend', () => setTimeout(clearHover, 1800));

  let resizeTimer = null;
  globalThis.addEventListener?.('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.activeTab === 'COMPARE') {
        const models = CHANNEL_SYMBOLS.map(evaluateSymbol).filter(Boolean);
        if (models.length) drawValuationThermometer(thermoCanvas, models);
      } else {
        renderDualCharts(evaluateSymbol(state.activeTab));
      }
    }, 60);
  });

  async function loadAllSnapshots() {
    const results = await Promise.allSettled(
      CHANNEL_SYMBOLS.map(async sym => {
        const snapshot = await loadMarketSnapshot(sym);
        return { sym, snapshot };
      })
    );
    results.forEach((result, idx) => {
      const sym = CHANNEL_SYMBOLS[idx];
      if (result.status === 'fulfilled') {
        rawSnapshots.set(sym, result.value.snapshot);
        loadErrors.delete(sym);
      } else {
        loadErrors.set(sym, result.reason?.message || '读取失败');
      }
    });
    lastResumeCheck = Date.now();
    rebuildDatasets();
    renderAll();
  }

  document.addEventListener?.('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || resumeChecking || !initialSettled) return;
    if (globalThis.navigator?.onLine === false || Date.now() - lastResumeCheck < 60000) return;
    resumeChecking = true;
    lastResumeCheck = Date.now();
    try {
      await Promise.all([loadAllSnapshots(), appUpdates.checkForUpdate()]);
    } finally {
      resumeChecking = false;
    }
  });

  renderAll();
  void appUpdates.checkForUpdate();
  void loadAllSnapshots().finally(() => {
    initialSettled = true;
    if (!lastResumeCheck) lastResumeCheck = Date.now();
  });
}
