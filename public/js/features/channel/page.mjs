import {
  getDeploymentInfo,
  loadMarketSnapshot,
  loadSourceHealth,
  requestSourceRefresh
} from '../../services/data-client.mjs';
import { createAppUpdateWatcher } from '../../ui/app-update.mjs';
import { healthSummary } from '../../domain/data-health.mjs';
import {
  bindDialogCommands,
  bindDialogExitFallback,
  closeDialog,
  enableDialogLightDismiss
} from '../../ui/dialog-utils.mjs';
import {
  ANCHOR_MODES,
  CHANNEL_ASSETS,
  CHANNEL_SYMBOLS,
  MIN_CHANNEL_VIEW_SPAN,
  MS_PER_YEAR,
  SAMPLE_WINDOWS,
  buildChannelDataset,
  buildChannelKDSeries,
  buildChannelKDTiers,
  classifyChannelKD,
  classifyChannelZ,
  constrainChannelView,
  evaluateChannelModel,
  formatIsoDateUtc,
  getFullChannelViewBounds,
  interpolateLnPrice,
  isValidChannelSymbol,
  panChannelView,
  parseIsoDateUtc,
  zoomChannelView
} from '../../domain/log-channel.mjs';
import { kdMultiple, normalizeKDOptions } from '../../domain/kd-strategy.mjs';
import {
  computeBodyDragAnchor,
  computeEndpointRotate,
  drawLogChannelKD,
  drawLogChannelLower,
  drawLogChannelUpper,
  drawValuationThermometer,
  hitTestChannelHandle,
  resolveChannelHover
} from './charts.mjs';
import {
  KD_STORAGE_KEY,
  STORAGE_KEY,
  VALID_TABS,
  createDefaultChannelState,
  createDefaultSymbolConfig,
  loadChannelKDOptions,
  loadChannelState,
  parseChannelState,
  probeChannelStorage,
  saveChannelKDOptions,
  saveChannelState
} from './storage.mjs';

const FIXED_PRICE_BASIS = 'totalReturn';
const SYMBOL_OPTION_LABELS = {
  SPY: 'SPY · 标普 500',
  QQQ: 'QQQ · 纳斯达克 100',
  VGT: 'VGT · 信息技术 ETF',
  SMH: 'SMH · 半导体 ETF',
  'BRK-B': 'BRK-B · 伯克希尔 B'
};

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

function fmtKDMultiple(v) {
  return Number.isFinite(v) ? `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })}N` : '—';
}

function resolveTabFromQuery(search) {
  const param = new URLSearchParams(search || '').get('symbol');
  if (!param) return null;
  const upper = param.trim().toUpperCase();
  if (VALID_TABS.has(upper) || isValidChannelSymbol(upper)) return upper;
  return null;
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
  if (!$('channel-symbol')) return;

  const { state, loadedFromKey, storageReadable } = loadChannelState();
  let storageAvailable = storageReadable && probeChannelStorage();
  const queryTab = resolveTabFromQuery(globalThis.location?.search);
  let openCompareOnReady = false;
  if (queryTab === 'COMPARE') {
    state.activeTab = CHANNEL_SYMBOLS.includes(state.activeTab) || isValidChannelSymbol(state.activeTab) ? state.activeTab : 'SPY';
    openCompareOnReady = true;
  } else if (queryTab && (CHANNEL_SYMBOLS.includes(queryTab) || isValidChannelSymbol(queryTab))) {
    state.activeTab = queryTab;
  } else if (!CHANNEL_SYMBOLS.includes(state.activeTab) && !isValidChannelSymbol(state.activeTab)) {
    state.activeTab = 'SPY';
  }
  if (!state.symbols[state.activeTab]) {
    state.symbols[state.activeTab] = createDefaultSymbolConfig(state.activeTab);
  }
  if (loadedFromKey && loadedFromKey !== STORAGE_KEY && storageAvailable) {
    saveChannelState(state);
  }

  const rawSnapshots = new Map();
  const datasets = new Map();
  const kdSeriesMap = new Map();
  const loadErrors = new Map();
  let customSymbols = [];
  const getAllSymbols = () => [...CHANNEL_SYMBOLS, ...customSymbols];
  let kdOptions = loadChannelKDOptions();
  let hoverDate = null;
  let viewRange = null;
  let lastGeom = null;
  let dragState = null;
  let panState = null;
  let pinchState = null;
  const activeTouches = new Map();
  let wheelPendingView = null;
  let wheelRaf = 0;
  let clearHoverTimer = null;
  let hoverHandle = null;
  let lastResumeCheck = 0;
  let resumeChecking = false;
  let initialSettled = false;
  let moreSettingsOpen = false;
  let resetConfirmTimer = null;
  const appUpdates = createAppUpdateWatcher();

  const symbolSelect = $('channel-symbol');
  const btnAddSymbol = $('add-symbol');
  const addSymbolHint = $('add-symbol-hint');
  const symbolDialog = $('symbol-dialog');
  const symbolForm = $('symbol-form');
  const customSymbolInput = $('custom-symbol');
  const customSymbolList = $('custom-symbol-list');
  const symbolMessage = $('symbol-message');
  const symbolSubmitBtn = $('symbol-submit');
  const btnCompareOpen = $('btn-compare-open');
  const compareDialog = $('channel-compare-dialog');
  const statusEl = $('status');
  const refreshBtn = $('refresh');
  const refreshHint = $('refresh-hint');
  const channelAsof = $('channel-asof');
  const priceCloseEl = $('channel-price-close');
  const priceSubEl = $('channel-price-sub');
  const storageBadge = $('channel-storage-badge');
  const btnSymbolReset = $('btn-symbol-reset');
  const btnResetAll = $('btn-reset-slopes');
  const tooltipEl = $('channel-tooltip');
  const chartCard = $('channel-chart-card');
  const upperCanvas = $('channel-upper-canvas');
  const lowerCanvas = $('channel-lower-canvas');
  const kdCanvas = $('channel-kd-canvas');
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
  const btnKDToggle = $('btn-kd-toggle');
  const kdWrap = $('channel-kd-wrap');
  const kdTiersEl = $('channel-kd-tiers');
  const kdFactorInput = $('channel-kd-factor');
  const kdFactorError = $('channel-kd-factor-error');
  const btnZoomReset = $('btn-zoom-reset');
  const zoomRangeEl = $('channel-zoom-range');
  const chartCanvases = [upperCanvas, lowerCanvas, kdCanvas].filter(Boolean);

  const compWindowSelect = $('comp-window-select');
  const compAnchorSelect = $('comp-anchor-select');
  const compKDFactorInput = $('comp-kd-factor');
  const compKDFactorError = $('comp-kd-factor-error');

  function syncKDFactorInputs(preserveSourceId = null) {
    for (const [id, input, errEl] of [
      ['channel-kd-factor', kdFactorInput, kdFactorError],
      ['comp-kd-factor', compKDFactorInput, compKDFactorError]
    ]) {
      if (!input) continue;
      if (preserveSourceId !== id) input.value = String(kdOptions.tierFactor);
      input.setAttribute('aria-invalid', 'false');
      if (errEl) {
        errEl.hidden = true;
        errEl.textContent = '';
      }
    }
  }

  function rebuildKDSeriesOnly() {
    for (const [sym, ds] of datasets.entries()) {
      const snap = rawSnapshots.get(sym);
      if (!snap?.rows?.length) continue;
      try {
        kdSeriesMap.set(sym, buildChannelKDSeries(snap.rows, ds, kdOptions));
      } catch {
        kdSeriesMap.delete(sym);
      }
    }
  }

  function rebuildDatasets() {
    datasets.clear();
    kdSeriesMap.clear();
    for (const sym of getAllSymbols()) {
      const snap = rawSnapshots.get(sym);
      if (!snap?.rows?.length) continue;
      try {
        const ds = buildChannelDataset(sym, snap.rows, {
          windowId: state.windowId,
          priceBasis: FIXED_PRICE_BASIS,
          rollingAnchorYears: 7
        });
        datasets.set(sym, ds);
        try {
          kdSeriesMap.set(sym, buildChannelKDSeries(snap.rows, ds, kdOptions));
        } catch {
          kdSeriesMap.delete(sym);
        }
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
    const allSyms = getAllSymbols();
    if (!allSyms.includes(state.activeTab)) {
      state.activeTab = CHANNEL_SYMBOLS[0];
    }
    symbolSelect.value = state.activeTab;
    const statSymbols = allSyms.filter(sym => {
      const cfg = state.symbols[sym] || (state.symbols[sym] = createDefaultSymbolConfig(sym));
      return cfg.customAnchor === null && Math.abs(cfg.offsetPct) < 0.05;
    });
    const statModes = new Set(statSymbols.map(sym => state.symbols[sym].anchorMode));
    compAnchorSelect.disabled = statSymbols.length === 0;
    compAnchorSelect.value = statModes.size === 1 ? [...statModes][0] : 'mixed';
    const hasLoadedActive = datasets.has(state.activeTab);
    slopeSlider.disabled = !hasLoadedActive;
    offsetSlider.disabled = !hasLoadedActive;
  }

  function updateLoadStatus() {
    if (!channelAsof) return;
    if (!datasets.size && !loadErrors.size) {
      channelAsof.textContent = '正在读取本地行情快照…';
      return;
    }
    const sym = state.activeTab;
    const ds = datasets.get(sym);
    if (ds) {
      channelAsof.textContent = `Yahoo Finance · 数据截至 ${ds.endDate}`;
    } else if (loadErrors.has(sym)) {
      channelAsof.textContent = `${sym} 读取失败：${loadErrors.get(sym)}`;
    } else {
      channelAsof.textContent = '正在读取本地行情快照…';
    }
  }

  function renderSingleView(sym, { lockedYBounds = null } = {}) {
    const m = evaluateSymbol(sym);
    if (!m) {
      if (priceCloseEl) priceCloseEl.textContent = '$—';
      if (priceSubEl) priceSubEl.textContent = '—';
      return;
    }

    const ds = m.dataset;
    const st = classifyChannelZ(m.zEnd);

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

    // Top-right quote block & 4-column summary strip
    const ddPct = m.latestPrice / ds.peakPrice - 1;
    if (priceCloseEl) priceCloseEl.textContent = fmtPrice(m.latestPrice);
    if (priceSubEl) priceSubEl.textContent = `距高点 ${fmtPct(ddPct)} · ${st.label}`;

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

    const kdData = kdSeriesMap.get(sym) || null;
    const kdLatest = kdData?.latest || null;

    // Chart title & subchart visibility
    $('channel-chart-title').textContent = `${m.symbol} 价格通道（${m.slopePct.toFixed(1)}% · ±1σ / ±2σ）`;
    btnResidualToggle.setAttribute('aria-expanded', String(state.showResidual));
    btnResidualToggle.textContent = state.showResidual ? '收起' : '展开';
    residualWrap.hidden = !state.showResidual;

    if (btnKDToggle && kdWrap) {
      btnKDToggle.setAttribute('aria-expanded', String(state.showKD));
      btnKDToggle.textContent = state.showKD ? '收起' : '展开';
      kdWrap.hidden = !state.showKD;
    }

    if (kdTiersEl) {
      const tiers = buildChannelKDTiers(kdOptions.tierFactor, kdLatest?.weightedK ?? null);
      const tierNodes = tiers.map(tier => {
        const rangeChildren = [document.createTextNode(tier.rangeLabel)];
        if (tier.isCurrent) {
          rangeChildren.push(el('span', { className: 'channel-now-tag', textContent: '当前' }));
        }
        return el('div', {
          className: `channel-kd-tier${tier.isBuyZone ? ' is-buy-tier' : ''}${tier.isCurrent ? ' is-current' : ''}`
        }, [
          el('span', { className: 'channel-kd-tier-range' }, rangeChildren),
          el('strong', { className: 'channel-kd-tier-mult', textContent: fmtKDMultiple(tier.multiple) })
        ]);
      });
      kdTiersEl.replaceChildren(...tierNodes);
    }

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

  function getActiveFullBounds() {
    if (state.activeTab === 'COMPARE') return null;
    const ds = datasets.get(state.activeTab);
    return ds ? getFullChannelViewBounds(ds, state.showProjection) : null;
  }

  function updateZoomUI() {
    const isZoomed = Boolean(viewRange);
    for (const canvas of chartCanvases) {
      canvas.classList.toggle('is-pannable', isZoomed);
    }
    if (btnZoomReset) btnZoomReset.hidden = !isZoomed;
    if (zoomRangeEl) {
      const ds = datasets.get(state.activeTab);
      if (isZoomed && ds) {
        const startDate = formatIsoDateUtc(ds.baseMs + Math.max(0, viewRange.tMin) * MS_PER_YEAR).slice(0, 7);
        const endDate = formatIsoDateUtc(ds.baseMs + viewRange.tMax * MS_PER_YEAR).slice(0, 7);
        zoomRangeEl.textContent = `${startDate} ~ ${endDate}`;
        zoomRangeEl.hidden = false;
      } else {
        zoomRangeEl.hidden = true;
        zoomRangeEl.textContent = '';
      }
    }
  }

  function cancelPendingWheel() {
    if (wheelRaf && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(wheelRaf);
    }
    wheelRaf = 0;
    wheelPendingView = null;
  }

  function clearScheduledHover() {
    if (clearHoverTimer) {
      clearTimeout(clearHoverTimer);
      clearHoverTimer = null;
    }
  }

  function applyViewRange(nextView) {
    const bounds = getActiveFullBounds();
    viewRange = bounds ? constrainChannelView(nextView, bounds) : null;
    hoverHandle = null;
    upperCanvas.classList.remove('is-handle-hover');
    state.hoverT = null;
    hoverDate = null;
    tooltipEl.hidden = true;
    updateZoomUI();
    if (state.activeTab !== 'COMPARE') {
      renderDualCharts(evaluateSymbol(state.activeTab));
    }
  }

  function renderDualCharts(model, { lockedYBounds = null } = {}) {
    if (!model) return;
    updateZoomUI(model.dataset);
    const dragSide = dragState?.mode === 'left' || dragState?.mode === 'right' ? dragState.mode : null;
    lastGeom = drawLogChannelUpper(upperCanvas, model, {
      showOrigLine: state.showOrigLine,
      showPivot: state.showPivot,
      showProjection: state.showProjection,
      viewRange,
      hoverT: state.hoverT,
      lockedYBounds,
      activeHandle: dragSide || hoverHandle,
      pinnedHandle: dragSide ? (dragSide === 'left' ? 'right' : 'left') : null
    });
    if (state.showResidual) {
      drawLogChannelLower(lowerCanvas, model, {
        showProjection: state.showProjection,
        viewRange,
        hoverT: state.hoverT,
        geom: lastGeom
      });
    }
    if (state.showKD && kdCanvas) {
      drawLogChannelKD(kdCanvas, model, kdSeriesMap.get(model.symbol) || null, {
        showProjection: state.showProjection,
        viewRange,
        hoverT: state.hoverT,
        hoverDate,
        geom: lastGeom,
        tierFactor: kdOptions.tierFactor
      });
    }
  }

  function renderCompareView() {
    const models = getAllSymbols().map(evaluateSymbol).filter(Boolean);
    if (!models.length) {
      $('channel-comp-tbody').replaceChildren();
      return;
    }

    let bestM = models[0];
    for (const m of models) {
      if (m.zEnd < bestM.zEnd) bestM = m;
    }
    let bestKD = null;
    for (const m of models) {
      const latest = kdSeriesMap.get(m.symbol)?.latest;
      if (latest && (!bestKD || latest.weightedK < bestKD.latest.weightedK)) {
        bestKD = { symbol: m.symbol, latest };
      }
    }
    const bestClass = classifyChannelZ(bestM.zEnd);
    const summaryNodes = [
      document.createTextNode('当前安全边际最高：'),
      el('strong', { textContent: bestM.symbol }),
      document.createTextNode(`（z = ${fmtSigned(bestM.zEnd, 2)} · ${bestClass.label}）`)
    ];
    if (bestKD) {
      summaryNodes.push(
        document.createTextNode(' ｜ 加权K最低：'),
        el('strong', { textContent: bestKD.symbol }),
        document.createTextNode(`（${bestKD.latest.weightedK.toFixed(1)} · ${fmtKDMultiple(bestKD.latest.multiple)}）`)
      );
    }
    $('comp-best-summary').replaceChildren(...summaryNodes);

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
        selectSymbol(m.symbol);
        closeDialog(compareDialog);
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

      const kdLatest = kdSeriesMap.get(m.symbol)?.latest || null;
      const kdCellChildren = kdLatest
        ? [
          el('strong', { className: classifyChannelKD(kdLatest.weightedK).valueClass || null, textContent: kdLatest.weightedK.toFixed(1) }),
          el('span', { className: 'channel-sub-delta', textContent: ` (${fmtKDMultiple(kdLatest.multiple)})` }),
          el('div', { className: 'channel-hist-note', textContent: `月 ${kdLatest.monthK.toFixed(1)} · 季 ${kdLatest.quarterK.toFixed(1)}` })
        ]
        : [el('span', { className: 'channel-sub-delta', textContent: '—' })];

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
        el('td', null, kdCellChildren),
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

  function renderAll({ lockedYBounds = null } = {}) {
    syncSharedControls();
    updateLoadStatus();
    updateStorageBadge();
    renderSingleView(state.activeTab, { lockedYBounds });
    if (compareDialog?.open) {
      renderCompareView();
    }
  }

  function selectSymbol(sym) {
    if (!getAllSymbols().includes(sym)) return;
    if (!state.symbols[sym]) state.symbols[sym] = createDefaultSymbolConfig(sym);
    const needsDragFlush = Boolean(dragState?.moved);
    dragState = null;
    panState = null;
    pinchState = null;
    activeTouches.clear();
    cancelPendingWheel();
    clearScheduledHover();
    hoverHandle = null;
    viewRange = null;
    clearResetConfirm();
    state.activeTab = sym;
    state.hoverT = null;
    hoverDate = null;
    for (const c of chartCanvases) c.classList.remove('is-handle-hover', 'is-dragging', 'is-panning', 'is-pannable');
    tooltipEl.hidden = true;
    syncQuerySymbol(sym);
    if (needsDragFlush || getAllSymbols().includes(sym)) {
      persistState();
    }
    renderAll();
  }

  function openCompareDialog() {
    if (!compareDialog) return;
    if (!compareDialog.open) {
      compareDialog.showModal?.();
    }
    renderCompareView();
    globalThis.requestAnimationFrame?.(() => {
      if (compareDialog.open) renderCompareView();
    });
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
      const kdState = kdSeriesMap.get(model.symbol)?.byDate.get(hover.dateStr);
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
        ])
      );
      if (kdState) {
        const kdMult = kdMultiple(kdState.weightedK, kdOptions.tierFactor);
        const kdCls = kdState.weightedK < 40 ? 'is-good' : (kdState.weightedK >= 90 ? 'is-hot' : '');
        nodes.push(
          el('div', { className: 'channel-tt-row' }, [
            el('span', { textContent: '加权K / 倍率' }),
            el('strong', { className: kdCls || null, textContent: `${kdState.weightedK.toFixed(1)} (${fmtKDMultiple(kdMult)})` })
          ]),
          el('div', { className: 'channel-tt-row' }, [
            el('span', { textContent: '月K / 季度K' }),
            el('span', { textContent: `${kdState.monthK.toFixed(1)} / ${kdState.quarterK.toFixed(1)}` })
          ])
        );
      }
      nodes.push(
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
    clearScheduledHover();
    const hadHoverHandle = Boolean(hoverHandle);
    hoverHandle = null;
    upperCanvas.classList.remove('is-handle-hover');
    if (state.hoverT === null && !hadHoverHandle) return;
    state.hoverT = null;
    hoverDate = null;
    tooltipEl.hidden = true;
    if (state.activeTab !== 'COMPARE') {
      renderDualCharts(evaluateSymbol(state.activeTab));
    }
  }

  function handlePointer(canvas, clientX, clientY) {
    if (state.activeTab === 'COMPARE' || dragState || panState || pinchState) return;
    clearScheduledHover();
    const model = evaluateSymbol(state.activeTab);
    if (!model) return;
    const hover = resolveChannelHover(canvas, lastGeom, model, clientX, state.showProjection);
    if (!hover) {
      clearHover();
      return;
    }
    state.hoverT = hover.targetT;
    hoverDate = hover.dateStr;
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

  // Symbol dropdown & Compare modal
  symbolSelect.addEventListener('change', event => {
    selectSymbol(event.target.value);
  });
  btnCompareOpen?.addEventListener('click', openCompareDialog);
  if (compareDialog) {
    enableDialogLightDismiss(compareDialog);
    bindDialogExitFallback(compareDialog);
  }
  bindDialogCommands(document);

  // Shared window selects
  function setWindow(id) {
    if (!Object.hasOwn(SAMPLE_WINDOWS, id) || state.windowId === id) return;
    state.windowId = id;
    cancelPendingWheel();
    viewRange = null;
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
    viewRange = constrainChannelView(viewRange, getActiveFullBounds());
    persistState();
    renderAll();
  });

  btnZoomReset?.addEventListener('click', () => {
    applyViewRange(null);
  });

  btnResidualToggle.addEventListener('click', () => {
    state.showResidual = !state.showResidual;
    persistState();
    renderAll();
  });

  btnKDToggle?.addEventListener('click', () => {
    state.showKD = !state.showKD;
    persistState();
    renderAll();
  });

  function bindKDFactorInput(input, errEl, id) {
    if (!input) return;
    input.addEventListener('input', () => {
      try {
        const next = normalizeKDOptions({ ...kdOptions, tierFactor: Number(input.value) });
        kdOptions = next;
        syncKDFactorInputs(id);
        saveChannelKDOptions(kdOptions);
        rebuildKDSeriesOnly();
        renderAll();
      } catch (err) {
        input.setAttribute('aria-invalid', 'true');
        if (errEl) {
          errEl.hidden = false;
          errEl.textContent = `${err.message}。仍沿用当前有效系数 ${kdOptions.tierFactor}。`;
        }
      }
    });
  }
  bindKDFactorInput(kdFactorInput, kdFactorError, 'channel-kd-factor');
  bindKDFactorInput(compKDFactorInput, compKDFactorError, 'comp-kd-factor');

  // Compare view controls (protect manually anchored symbols)
  compAnchorSelect.addEventListener('change', event => {
    const val = event.target.value;
    if (!Object.hasOwn(ANCHOR_MODES, val)) return;
    for (const sym of getAllSymbols()) {
      const cfg = state.symbols[sym] || (state.symbols[sym] = createDefaultSymbolConfig(sym));
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
    for (const sym of getAllSymbols()) {
      state.symbols[sym] = createDefaultSymbolConfig(sym);
    }
    persistState();
    renderAll();
  });

  function isInsidePlotX(canvas, clientX) {
    if (!lastGeom) return false;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    return x >= lastGeom.padLeft && x <= lastGeom.padLeft + lastGeom.plotW;
  }

  function scheduleWheelView(nextView) {
    wheelPendingView = nextView;
    if (!wheelRaf && typeof requestAnimationFrame === 'function') {
      wheelRaf = requestAnimationFrame(() => {
        wheelRaf = 0;
        const target = wheelPendingView;
        wheelPendingView = null;
        if (target !== undefined) applyViewRange(target);
      });
    } else if (typeof requestAnimationFrame !== 'function') {
      wheelPendingView = null;
      applyViewRange(nextView);
    }
  }

  function beginPinchOrTouch(canvas) {
    const pts = [...activeTouches.values()].filter(p => p.canvas === canvas);
    pinchState = null;
    if (panState?.canvas === canvas && panState.isTouch) {
      panState = null;
      canvas.classList.remove('is-panning');
    }
    const bounds = getActiveFullBounds();
    if (!bounds || !lastGeom) return;
    if (pts.length >= 2) {
      const [a, b] = pts;
      const rect = canvas.getBoundingClientRect();
      const baseView = viewRange ? { ...viewRange } : { ...bounds };
      const ratio = Math.max(0, Math.min(1, ((a.x + b.x) / 2 - rect.left - lastGeom.padLeft) / lastGeom.plotW));
      pinchState = {
        canvas,
        baseView,
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        ratio
      };
      state.hoverT = null;
      hoverDate = null;
      tooltipEl.hidden = true;
    } else if (pts.length === 1 && viewRange) {
      panState = {
        canvas,
        pointerId: pts[0].id,
        isTouch: true,
        startX: pts[0].x,
        startView: { ...viewRange },
        moved: false
      };
    }
  }

  for (const canvas of chartCanvases) {
    canvas.addEventListener('wheel', event => {
      if (state.activeTab === 'COMPARE' || !lastGeom || !isInsidePlotX(canvas, event.clientX)) return;
      const bounds = getActiveFullBounds();
      if (!bounds) return;
      event.preventDefault();
      if (dragState || panState || pinchState) return;

      const rect = canvas.getBoundingClientRect();
      const scale = event.deltaMode === 1 ? 16 : (event.deltaMode === 2 ? canvas.clientHeight : 1);
      const dx = event.deltaX * scale;
      const dy = event.deltaY * scale;
      const curView = wheelPendingView !== null ? wheelPendingView : viewRange;

      if (event.shiftKey || Math.abs(dx) > Math.abs(dy)) {
        if (!curView) return;
        const delta = event.shiftKey ? (dy || dx) : dx;
        scheduleWheelView(panChannelView(curView, delta / lastGeom.plotW, bounds));
      } else if (dy) {
        const ratio = (event.clientX - rect.left - lastGeom.padLeft) / lastGeom.plotW;
        const factor = Math.exp(Math.max(-500, Math.min(500, dy)) * 0.002);
        scheduleWheelView(zoomChannelView(curView, ratio, factor, bounds));
      }
    }, { passive: false });

    canvas.addEventListener('dblclick', event => {
      if (state.activeTab === 'COMPARE' || !isInsidePlotX(canvas, event.clientX)) return;
      event.preventDefault();
      if (wheelRaf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(wheelRaf);
      wheelRaf = 0;
      wheelPendingView = null;
      applyViewRange(null);
    });

    canvas.addEventListener('keydown', event => {
      if (state.activeTab === 'COMPARE') return;
      const bounds = getActiveFullBounds();
      if (!bounds) return;
      let next;
      if (event.key === 'ArrowLeft') {
        if (!viewRange) return;
        next = panChannelView(viewRange, -0.2, bounds);
      } else if (event.key === 'ArrowRight') {
        if (!viewRange) return;
        next = panChannelView(viewRange, 0.2, bounds);
      } else if (event.key === '+' || event.key === '=' || event.key === 'ArrowUp') {
        next = zoomChannelView(viewRange, 0.5, 0.78, bounds);
      } else if (event.key === '-' || event.key === 'ArrowDown') {
        if (!viewRange) return;
        next = zoomChannelView(viewRange, 0.5, 1.28, bounds);
      } else if (event.key === 'Home' || event.key === '0') {
        if (!viewRange) return;
        event.preventDefault();
        applyViewRange(null);
        return;
      } else {
        return;
      }
      event.preventDefault();
      applyViewRange(next);
    });
  }

  // Mouse/pen/touch drag across charts: rotate endpoints, shift centerline vertically, or pan horizontally when zoomed
  upperCanvas.addEventListener('pointerdown', event => {
    if (state.activeTab === 'COMPARE' || !lastGeom) return;
    clearScheduledHover();
    if (event.pointerType === 'touch') {
      if (!isInsidePlotX(upperCanvas, event.clientX) || activeTouches.size >= 2) return;
      activeTouches.set(event.pointerId, { id: event.pointerId, canvas: upperCanvas, x: event.clientX, y: event.clientY });
      try { upperCanvas.setPointerCapture?.(event.pointerId); } catch {}
      beginPinchOrTouch(upperCanvas);
      if (activeTouches.size === 1 && !viewRange) {
        handlePointer(upperCanvas, event.clientX, event.clientY);
      }
      return;
    }
    if ((event.pointerType !== 'mouse' && event.pointerType !== 'pen') || event.button !== 0) return;

    const model = evaluateSymbol(state.activeTab);
    if (!model) return;
    const hit = hitTestChannelHandle(upperCanvas, lastGeom, event.clientX, event.clientY, model);
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
        startX: event.clientX,
        startY: event.clientY,
        fixedT: fixedHandle.t,
        fixedLnP: fixedHandle.lnP,
        dragT: dragHandle.t,
        geom: { ...lastGeom },
        lockedYBounds: { lnYMin: lastGeom.lnYMin, lnYMax: lastGeom.lnYMax },
        lastSaveAt: 0,
        moved: false
      };
      renderDualCharts(model, { lockedYBounds: dragState.lockedYBounds });
    } else if (hit === 'body') {
      if (!viewRange) return;
      panState = {
        canvas: upperCanvas,
        pointerId: event.pointerId,
        isTouch: false,
        startX: event.clientX,
        startView: { ...viewRange },
        moved: false
      };
    } else {
      const anchorMs = parseIsoDateUtc(model.basePivot.date);
      const anchorT = Number.isFinite(anchorMs)
        ? (anchorMs - model.dataset.baseMs) / MS_PER_YEAR
        : model.basePivot.t;
      dragState = {
        mode: viewRange ? 'auto' : 'body',
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startView: viewRange ? { ...viewRange } : null,
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
    if (event.pointerType === 'touch' && activeTouches.has(event.pointerId)) {
      activeTouches.set(event.pointerId, { id: event.pointerId, canvas: upperCanvas, x: event.clientX, y: event.clientY });
      if (pinchState && pinchState.canvas === upperCanvas) {
        const pts = [...activeTouches.values()].filter(p => p.canvas === upperCanvas);
        if (pts.length >= 2 && lastGeom) {
          const bounds = getActiveFullBounds();
          const [a, b] = pts;
          const rect = upperCanvas.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, ((a.x + b.x) / 2 - rect.left - lastGeom.padLeft) / lastGeom.plotW));
          const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
          const zoomed = zoomChannelView(pinchState.baseView, pinchState.ratio, pinchState.distance / dist, bounds);
          applyViewRange(zoomed ? panChannelView(zoomed, pinchState.ratio - ratio, bounds) : null);
          return;
        }
      }
      if (panState && panState.canvas === upperCanvas && panState.pointerId === event.pointerId && lastGeom) {
        const dx = event.clientX - panState.startX;
        if (!panState.moved && Math.abs(dx) <= 4) return;
        panState.moved = true;
        upperCanvas.classList.add('is-panning');
        applyViewRange(panChannelView(panState.startView, -dx / lastGeom.plotW, getActiveFullBounds()));
        return;
      }
      if (!viewRange) handlePointer(upperCanvas, event.clientX, event.clientY);
      return;
    }

    if (panState && panState.canvas === upperCanvas && event.pointerId === panState.pointerId && lastGeom) {
      const dx = event.clientX - panState.startX;
      if (!panState.moved && Math.abs(dx) <= 3) return;
      panState.moved = true;
      state.hoverT = null;
      hoverDate = null;
      tooltipEl.hidden = true;
      upperCanvas.classList.add('is-panning');
      applyViewRange(panChannelView(panState.startView, -dx / lastGeom.plotW, getActiveFullBounds()));
      return;
    }

    if (dragState && event.pointerId === dragState.pointerId) {
      const dx = event.clientX - dragState.startX;
      const dy = event.clientY - dragState.startY;
      if (!dragState.moved) {
        if (dragState.mode === 'auto') {
          if (Math.hypot(dx, dy) <= 4) return;
          if (Math.abs(dx) >= Math.abs(dy) && dragState.startView) {
            panState = {
              canvas: upperCanvas,
              pointerId: dragState.pointerId,
              isTouch: false,
              startX: dragState.startX,
              startView: dragState.startView,
              moved: true
            };
            dragState = null;
            hoverHandle = null;
            upperCanvas.classList.remove('is-handle-hover');
            upperCanvas.classList.add('is-panning');
            applyViewRange(panChannelView(panState.startView, -dx / lastGeom.plotW, getActiveFullBounds()));
            return;
          }
          dragState.mode = 'body';
        } else if (dragState.mode === 'body') {
          if (Math.abs(dy) <= 4 || Math.abs(dy) < Math.abs(dx)) return;
        } else if (Math.abs(dy) <= 3) {
          return;
        }
      }
      dragState.moved = true;
      state.hoverT = null;
      hoverDate = null;
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
      const model = evaluateSymbol(state.activeTab);
      const hit = hitTestChannelHandle(upperCanvas, lastGeom, event.clientX, event.clientY, model);
      const nextHandle = hit === 'left' || hit === 'right' || hit === 'centerline' ? hit : null;
      if (nextHandle !== hoverHandle) {
        hoverHandle = nextHandle;
        upperCanvas.classList.toggle('is-handle-hover', Boolean(hoverHandle));
        if (hoverHandle === 'left' || hoverHandle === 'right') {
          state.hoverT = null;
          hoverDate = null;
          tooltipEl.hidden = true;
        }
        renderDualCharts(model);
      }
      if (hoverHandle === 'left' || hoverHandle === 'right') return;
    }

    handlePointer(upperCanvas, event.clientX, event.clientY);
  });

  function finishDrag(event = null, { force = false } = {}) {
    if (event?.pointerType === 'touch' && activeTouches.has(event.pointerId)) {
      const entry = activeTouches.get(event.pointerId);
      activeTouches.delete(event.pointerId);
      try {
        if (entry?.canvas?.hasPointerCapture?.(event.pointerId)) {
          entry.canvas.releasePointerCapture(event.pointerId);
        }
      } catch {}
      beginPinchOrTouch(entry.canvas);
      if (!activeTouches.size && !viewRange) {
        clearScheduledHover();
        clearHoverTimer = setTimeout(clearHover, 1800);
      }
    } else if (force && activeTouches.size) {
      activeTouches.clear();
      pinchState = null;
    }

    let endedPan = false;
    let endedPanCanvas = null;
    if (panState && (force || event?.pointerId === undefined || event.pointerId === panState.pointerId)) {
      const { canvas: panCanvas, pointerId: panPid } = panState;
      panState = null;
      endedPan = true;
      endedPanCanvas = panCanvas;
      panCanvas?.classList.remove('is-panning');
      try {
        if (panPid !== undefined && panCanvas?.hasPointerCapture?.(panPid)) {
          panCanvas.releasePointerCapture(panPid);
        }
      } catch {}
    }

    const canSyncMouseHover = Boolean(
      !force &&
      event?.type === 'pointerup' &&
      event?.pointerType === 'mouse' &&
      Number.isFinite(event.clientX) &&
      state.activeTab !== 'COMPARE' &&
      lastGeom
    );

    const endingDrag = dragState && (force || event?.pointerId === undefined || event.pointerId === dragState.pointerId);
    if (!endingDrag) {
      if (endedPan && state.activeTab !== 'COMPARE') {
        const hadHover = Boolean(hoverHandle);
        const releasedOutside = !canSyncMouseHover || (endedPanCanvas && !isInsidePlotX(endedPanCanvas, event.clientX));
        const hadCrosshair = state.hoverT !== null;
        if (hadHover) {
          hoverHandle = null;
          upperCanvas.classList.remove('is-handle-hover');
        }
        if (releasedOutside && hadCrosshair) {
          state.hoverT = null;
          hoverDate = null;
          tooltipEl.hidden = true;
        }
        if (hadHover || (releasedOutside && hadCrosshair)) {
          renderDualCharts(evaluateSymbol(state.activeTab));
        }
      }
      return;
    }

    const pointerId = dragState.pointerId;
    const didMove = dragState.moved;
    const wasHandle = dragState.mode === 'left' || dragState.mode === 'right';
    const prevHover = hoverHandle;
    dragState = null;
    hoverHandle = null;
    upperCanvas.classList.remove('is-dragging', 'is-handle-hover');
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
      if (canSyncMouseHover) {
        const model = evaluateSymbol(state.activeTab);
        const hit = model ? hitTestChannelHandle(upperCanvas, lastGeom, event.clientX, event.clientY, model) : null;
        const nextHandle = hit === 'left' || hit === 'right' || hit === 'centerline' ? hit : null;
        if (nextHandle !== hoverHandle) {
          hoverHandle = nextHandle;
          upperCanvas.classList.toggle('is-handle-hover', Boolean(hoverHandle));
          renderDualCharts(model);
        }
      }
      return;
    }

    if (state.activeTab === 'COMPARE') return;
    const model = evaluateSymbol(state.activeTab);
    const hit = canSyncMouseHover && model
      ? hitTestChannelHandle(upperCanvas, lastGeom, event.clientX, event.clientY, model)
      : null;
    const nextHandle = hit === 'left' || hit === 'right' || hit === 'centerline' ? hit : null;
    hoverHandle = nextHandle;
    upperCanvas.classList.toggle('is-handle-hover', Boolean(hoverHandle));

    let clearedCrosshair = false;
    if (!hit && state.hoverT !== null) {
      state.hoverT = null;
      hoverDate = null;
      tooltipEl.hidden = true;
      clearedCrosshair = true;
    }
    if (wasHandle || prevHover !== hoverHandle || clearedCrosshair) {
      renderDualCharts(model);
    }
  }

  upperCanvas.addEventListener('pointerup', finishDrag);
  upperCanvas.addEventListener('pointercancel', finishDrag);
  upperCanvas.addEventListener('lostpointercapture', finishDrag);
  globalThis.addEventListener?.('pointerup', event => finishDrag(event));
  globalThis.addEventListener?.('blur', () => finishDrag(null, { force: true }));
  globalThis.addEventListener?.('pagehide', () => finishDrag(null, { force: true }));
  globalThis.addEventListener?.('storage', event => {
    if (event.key === KD_STORAGE_KEY || event.key === null) {
      kdOptions = loadChannelKDOptions();
      syncKDFactorInputs();
      rebuildKDSeriesOnly();
      if (event.key === KD_STORAGE_KEY) {
        renderAll();
        return;
      }
    }
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
    state.showKD = remoteState.showKD;
    state.symbols = remoteState.symbols;
    if (state.windowId !== prevWindow) {
      viewRange = null;
      rebuildDatasets();
    } else {
      viewRange = constrainChannelView(viewRange, getActiveFullBounds());
    }
    renderAll();
  });
  upperCanvas.addEventListener('mouseleave', () => {
    if (!dragState && !panState) clearHover();
  });

  for (const subCanvas of [lowerCanvas, kdCanvas].filter(Boolean)) {
    subCanvas.addEventListener('pointerdown', event => {
      if (state.activeTab === 'COMPARE' || !lastGeom || !isInsidePlotX(subCanvas, event.clientX)) return;
      if (event.pointerType === 'touch') {
        if (activeTouches.size >= 2) return;
        activeTouches.set(event.pointerId, { id: event.pointerId, canvas: subCanvas, x: event.clientX, y: event.clientY });
        try { subCanvas.setPointerCapture?.(event.pointerId); } catch {}
        beginPinchOrTouch(subCanvas);
        if (activeTouches.size === 1 && !viewRange) {
          handlePointer(subCanvas, event.clientX, event.clientY);
        }
        return;
      }
      if ((event.pointerType !== 'mouse' && event.pointerType !== 'pen') || event.button !== 0 || !viewRange) return;
      panState = {
        canvas: subCanvas,
        pointerId: event.pointerId,
        isTouch: false,
        startX: event.clientX,
        startView: { ...viewRange },
        moved: false
      };
      try { subCanvas.setPointerCapture?.(event.pointerId); } catch {}
    });

    subCanvas.addEventListener('pointermove', event => {
      if (event.pointerType === 'touch' && activeTouches.has(event.pointerId)) {
        activeTouches.set(event.pointerId, { id: event.pointerId, canvas: subCanvas, x: event.clientX, y: event.clientY });
        if (pinchState && pinchState.canvas === subCanvas) {
          const pts = [...activeTouches.values()].filter(p => p.canvas === subCanvas);
          if (pts.length >= 2 && lastGeom) {
            const bounds = getActiveFullBounds();
            const [a, b] = pts;
            const rect = subCanvas.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, ((a.x + b.x) / 2 - rect.left - lastGeom.padLeft) / lastGeom.plotW));
            const dist = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
            const zoomed = zoomChannelView(pinchState.baseView, pinchState.ratio, pinchState.distance / dist, bounds);
            applyViewRange(zoomed ? panChannelView(zoomed, pinchState.ratio - ratio, bounds) : null);
            return;
          }
        }
        if (panState && panState.canvas === subCanvas && panState.pointerId === event.pointerId && lastGeom) {
          const dx = event.clientX - panState.startX;
          if (!panState.moved && Math.abs(dx) <= 4) return;
          panState.moved = true;
          subCanvas.classList.add('is-panning');
          applyViewRange(panChannelView(panState.startView, -dx / lastGeom.plotW, getActiveFullBounds()));
          return;
        }
        if (!viewRange) handlePointer(subCanvas, event.clientX, event.clientY);
        return;
      }

      if (panState && panState.canvas === subCanvas && event.pointerId === panState.pointerId && lastGeom) {
        const dx = event.clientX - panState.startX;
        if (!panState.moved && Math.abs(dx) <= 3) return;
        panState.moved = true;
        state.hoverT = null;
        hoverDate = null;
        tooltipEl.hidden = true;
        subCanvas.classList.add('is-panning');
        applyViewRange(panChannelView(panState.startView, -dx / lastGeom.plotW, getActiveFullBounds()));
        return;
      }

      handlePointer(subCanvas, event.clientX, event.clientY);
    });

    subCanvas.addEventListener('pointerup', finishDrag);
    subCanvas.addEventListener('pointercancel', finishDrag);
    subCanvas.addEventListener('lostpointercapture', finishDrag);
    subCanvas.addEventListener('mouseleave', () => {
      if (!panState) clearHover();
    });
  }

  let resizeTimer = null;
  globalThis.addEventListener?.('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (compareDialog?.open) {
        const models = getAllSymbols().map(evaluateSymbol).filter(Boolean);
        if (models.length) drawValuationThermometer(thermoCanvas, models);
      }
      renderDualCharts(evaluateSymbol(state.activeTab));
    }, 60);
  });

  const deploymentReady = getDeploymentInfo();

  let customBusy = false;
  function setCustomBusy(value) {
    customBusy = value;
    if (symbolSubmitBtn) symbolSubmitBtn.disabled = value;
    if (customSymbolInput) customSymbolInput.disabled = value;
    if (customSymbolList) {
      for (const btn of customSymbolList.querySelectorAll('button')) btn.disabled = value;
    }
  }

  function syncCustomSymbols(list) {
    const nextList = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const sym = String(raw || '').trim().toUpperCase();
      if (isValidChannelSymbol(sym) && !CHANNEL_SYMBOLS.includes(sym) && !nextList.includes(sym)) {
        nextList.push(sym);
      }
    }
    customSymbols = nextList;

    for (const sym of customSymbols) {
      if (!state.symbols[sym]) state.symbols[sym] = createDefaultSymbolConfig(sym);
    }
    for (const opt of Array.from(symbolSelect.options)) {
      if (!CHANNEL_SYMBOLS.includes(opt.value) && !customSymbols.includes(opt.value)) {
        opt.remove();
      }
    }
    for (const sym of customSymbols) {
      if (!Array.from(symbolSelect.options).some(opt => opt.value === sym)) {
        symbolSelect.add(new Option(sym, sym));
      }
    }

    if (customSymbolList) {
      customSymbolList.replaceChildren(...customSymbols.map(sym => {
        const removeBtn = el('button', {
          type: 'button',
          textContent: '删除',
          'aria-label': `删除 ${sym}`,
          disabled: customBusy
        });
        removeBtn.addEventListener('click', () => removeCustomSymbol(sym));
        return el('li', null, [
          el('strong', { textContent: sym }),
          removeBtn
        ]);
      }));
    }

    if (!getAllSymbols().includes(state.activeTab)) {
      selectSymbol(CHANNEL_SYMBOLS[0]);
    } else {
      symbolSelect.value = state.activeTab;
    }
  }

  async function requestCustomSymbols(method, symbol, fallbackError) {
    const response = await fetch('./api/symbols', {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol })
    });
    if (response.status === 405) {
      throw Error('本地服务尚未更新，请停止旧服务并重新运行 start.cmd，再刷新页面后重试');
    }
    let result = null;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    if (!response.ok) throw Error(result?.error || fallbackError);
    if (!result || !Array.isArray(result.symbols) || (method === 'POST' && !result.symbol)) {
      throw Error(fallbackError);
    }
    return result;
  }

  async function removeCustomSymbol(sym) {
    if (customBusy) return;
    setCustomBusy(true);
    if (symbolMessage) symbolMessage.textContent = `正在删除 ${sym}…`;
    try {
      const result = await requestCustomSymbols('DELETE', sym, '删除失败，请稍后重试');
      rawSnapshots.delete(sym);
      datasets.delete(sym);
      kdSeriesMap.delete(sym);
      loadErrors.delete(sym);
      syncCustomSymbols(result.symbols);
      rebuildDatasets();
      renderAll();
      void loadHealth();
      if (symbolMessage) symbolMessage.textContent = `${sym} 已删除`;
    } catch (error) {
      if (symbolMessage) symbolMessage.textContent = error.message;
    } finally {
      setCustomBusy(false);
    }
  }

  async function loadCustomSymbolsList() {
    try {
      const response = await fetch('./data/custom-symbols.json', { cache: 'no-store' });
      if (response.ok) syncCustomSymbols(await response.json());
      else if (response.status === 404) syncCustomSymbols([]);
      else throw Error('无法读取标的列表');
    } catch {
      if (symbolMessage) symbolMessage.textContent = '自定义标的列表读取失败，请刷新页面后重试。';
    }
  }

  if (symbolDialog) {
    enableDialogLightDismiss(symbolDialog);
    bindDialogExitFallback(symbolDialog);
  }

  deploymentReady.then(async info => {
    const mode = info.mode;
    if (refreshBtn) {
      refreshBtn.disabled = mode !== 'local';
      refreshBtn.title = mode === 'local' ? '更新数据' : '仅本地部署可更新数据';
    }
    if (refreshHint) {
      refreshHint.title = mode === 'local' ? '更新数据' : '仅本地部署可更新数据';
      refreshHint.tabIndex = mode === 'local' ? -1 : 0;
    }
    if (mode === 'local' && btnAddSymbol) {
      btnAddSymbol.disabled = false;
      addSymbolHint?.removeAttribute('title');
      addSymbolHint?.removeAttribute('tabindex');
      btnAddSymbol.addEventListener('click', () => symbolDialog?.showModal?.());
      symbolForm?.addEventListener('submit', async event => {
        event.preventDefault();
        if (customBusy || !customSymbolInput) return;
        const sym = customSymbolInput.value.trim().toUpperCase();
        customSymbolInput.value = sym;
        if (getAllSymbols().includes(sym)) {
          if (symbolMessage) symbolMessage.textContent = `${sym} 已在标的列表中`;
          return;
        }
        setCustomBusy(true);
        if (symbolMessage) symbolMessage.textContent = `正在获取 ${sym} 完整历史行情，请稍候…`;
        try {
          const result = await requestCustomSymbols('POST', sym, '添加失败，请稍后重试');
          syncCustomSymbols(result.symbols);
          try {
            const snap = await loadMarketSnapshot(result.symbol);
            rawSnapshots.set(result.symbol, snap);
            loadErrors.delete(result.symbol);
          } catch (snapErr) {
            loadErrors.set(result.symbol, snapErr?.message || '读取失败');
          }
          rebuildDatasets();
          selectSymbol(result.symbol);
          void loadHealth();
          customSymbolInput.value = '';
          if (symbolMessage) symbolMessage.textContent = `${result.symbol} 已添加`;
        } catch (error) {
          if (symbolMessage) symbolMessage.textContent = error.message;
        } finally {
          setCustomBusy(false);
        }
      });
    }
    void appUpdates.checkForUpdate(info);
  });

  async function loadHealth() {
    if (!statusEl) return null;
    try {
      const health = await loadSourceHealth();
      statusEl.textContent = healthSummary(health);
      return health;
    } catch {
      statusEl.textContent = '无法检查数据更新状态，请核对各图的数据日期。';
      return null;
    }
  }

  refreshBtn?.addEventListener('click', async () => {
    const { mode } = await deploymentReady;
    if (mode !== 'local' || refreshBtn.disabled) return;
    refreshBtn.disabled = true;
    const srSpan = refreshBtn.querySelector('span');
    if (srSpan) srSpan.textContent = '检查中…';
    try {
      if (statusEl) statusEl.textContent = '正在同步情绪指数与 ETF 行情…';
      let refreshError = null;
      let refreshResult = null;
      try {
        refreshResult = await requestSourceRefresh();
      } catch (error) {
        refreshError = error;
      } finally {
        await loadAllSnapshots();
      }
      if (refreshError) throw refreshError;
      const health = await loadHealth();
      if (refreshResult?.errors?.length && !health?.funds && statusEl) {
        statusEl.textContent += '\n' + refreshResult.errors.join('；');
      }
    } catch (error) {
      if (statusEl) statusEl.textContent = error.message || '检查失败，已保留本地数据。';
    } finally {
      refreshBtn.disabled = false;
      if (srSpan) srSpan.textContent = '更新数据';
    }
  });

  async function loadAllSnapshots() {
    const { mode } = await deploymentReady;
    if (mode === 'local') {
      await loadCustomSymbolsList();
    }
    const allSyms = getAllSymbols();
    const results = await Promise.allSettled(
      allSyms.map(async sym => {
        const snapshot = await loadMarketSnapshot(sym);
        return { sym, snapshot };
      })
    );
    results.forEach((result, idx) => {
      const sym = allSyms[idx];
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
    if (openCompareOnReady) {
      openCompareOnReady = false;
      openCompareDialog();
    }
  }

  document.addEventListener?.('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || resumeChecking || !initialSettled) return;
    if (globalThis.navigator?.onLine === false || Date.now() - lastResumeCheck < 60000) return;
    resumeChecking = true;
    lastResumeCheck = Date.now();
    try {
      await Promise.all([loadAllSnapshots(), loadHealth(), appUpdates.checkForUpdate()]);
    } finally {
      resumeChecking = false;
    }
  });

  syncKDFactorInputs();
  renderAll();
  void loadHealth();
  void loadAllSnapshots().finally(() => {
    initialSettled = true;
    if (!lastResumeCheck) lastResumeCheck = Date.now();
  });
}
