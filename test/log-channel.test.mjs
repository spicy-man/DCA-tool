import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ANCHOR_MODES,
  CHANNEL_SYMBOLS,
  MIN_CHANNEL_VIEW_SPAN,
  MS_PER_YEAR,
  addCalendarMonths,
  buildChannelDataset,
  buildChannelKDSeries,
  buildChannelKDTiers,
  classifyChannelKD,
  classifyChannelZ,
  computeEmpiricalStats,
  constrainChannelView,
  createShiftedCustomAnchor,
  evaluateChannelModel,
  getFullChannelViewBounds,
  interpolateLnPrice,
  panChannelView,
  parseIsoDateUtc,
  solveEndpointChannel,
  subtractCalendarYears,
  tCritical95,
  zoomChannelView
} from '../public/js/domain/log-channel.mjs';
import { calculateKDSeries, kdMultiple } from '../public/js/domain/kd-strategy.mjs';
import { hitTestChannelHandle } from '../public/js/features/channel/charts.mjs';
import {
  KD_STORAGE_KEY,
  SCHEMA_VERSION,
  STORAGE_KEY,
  createDefaultChannelState,
  loadChannelKDOptions,
  loadChannelState,
  parseChannelKDOptions,
  parseChannelState,
  probeChannelStorage,
  saveChannelKDOptions,
  saveChannelState
} from '../public/js/features/channel/storage.mjs';

function makeSyntheticSeries({ startYear = 2012, years = 14, basePrice = 100, annualGrowth = 0.12 } = {}) {
  const rows = [];
  const totalDays = Math.round(years * 365.25);
  const startMs = Date.UTC(startYear, 0, 2);
  for (let d = 0; d <= totalDays; d += 7) {
    const ms = startMs + d * 86400000;
    const date = new Date(ms).toISOString().slice(0, 10);
    const t = d / 365.25;
    const price = basePrice * Math.pow(1 + annualGrowth, t);
    rows.push({ date, sourceClose: price, close: price * 1.05 });
  }
  return rows;
}

test('对数回归在无噪声指数序列上精确还原年化斜率与零残差', () => {
  const rows = makeSyntheticSeries({ annualGrowth: 0.14 });
  const ds = buildChannelDataset('QQQ', rows, { windowId: 'all', priceBasis: 'price' });

  assert.ok(Math.abs(ds.orig.slopePct - 14.0) < 1e-6);
  assert.ok(ds.orig.r2 > 0.999999);
  assert.ok(ds.orig.sigma < 1e-9);
  assert.equal(ds.startDate, rows[0].date);
  assert.equal(ds.endDate, rows.at(-1).date);
});

test('Constrained OLS 旋转支点不变性：任意修改斜率，拟合线必严格经过所选质心', () => {
  const rows = makeSyntheticSeries({ annualGrowth: 0.15 }).map((row, idx) => ({
    ...row,
    sourceClose: row.sourceClose * Math.exp(0.08 * Math.sin(idx / 5))
  }));
  const ds = buildChannelDataset('SPY', rows, { windowId: '15y', priceBasis: 'price' });

  for (const anchorMode of [ANCHOR_MODES.recent7y, ANCHOR_MODES.fullPivot]) {
    for (const slopePct of [7.5, 11.0, 14.5, 18.0]) {
      const m = evaluateChannelModel(ds, { slopePct, anchorMode, keepOrigSigma: true });
      assert.ok(Math.abs(m.lnFit(m.pivot.t) - m.pivot.lnP) < 1e-12);
      assert.ok(Math.abs(m.priceFit(m.pivot.t) - m.pivot.price) < 1e-9);
    }
  }
});

test('日期边界计算正确处理闰年 2 月 29 日与月末对齐', () => {
  assert.equal(subtractCalendarYears('2024-02-29', 7), '2017-02-28');
  assert.equal(subtractCalendarYears('2024-02-29', 4), '2020-02-29');
  assert.equal(addCalendarMonths('2026-08-31', 6), '2027-02-28');
  assert.equal(addCalendarMonths('2027-08-31', 6), '2028-02-29');
  assert.equal(addCalendarMonths('2026-11-25', 12), '2027-11-25');
});

test('样本窗口切换、复权口径切换、σ 口径与 7 档入场矩阵推演一致', () => {
  const rows = makeSyntheticSeries({ startYear: 2005, years: 20, annualGrowth: 0.1 });
  const dsAll = buildChannelDataset('VGT', rows, { windowId: 'all', priceBasis: 'price' });
  const ds10y = buildChannelDataset('VGT', rows, { windowId: '10y', priceBasis: 'totalReturn' });

  assert.ok(ds10y.pointCount < dsAll.pointCount);
  assert.ok(ds10y.orig.latestPrice > dsAll.orig.latestPrice);

  const mOrigSig = evaluateChannelModel(dsAll, { slopePct: 8.0, anchorMode: 'recent7y', keepOrigSigma: true });
  const mRecalcSig = evaluateChannelModel(dsAll, { slopePct: 8.0, anchorMode: 'recent7y', keepOrigSigma: false });
  assert.ok(mRecalcSig.sigmaUsed > mOrigSig.sigmaUsed);

  const tierZero = mOrigSig.tiers.find(t => t.k === 0);
  assert.ok(tierZero);
  assert.ok(Math.abs(tierZero.pNow - mOrigSig.fitEnd) < 1e-9);
  assert.ok(Math.abs(tierZero.p6m - tierZero.pNow * Math.sqrt(1.08)) < 1e-9);
  assert.ok(Math.abs(tierZero.p12m - tierZero.pNow * 1.08) < 1e-9);
  assert.equal(classifyChannelZ(-1.6).label, '深度低估');
  assert.equal(classifyChannelZ(1.5).label, '过热');
  assert.ok(Number.isFinite(interpolateLnPrice(dsAll.points, dsAll.tEnd * 0.5)));
});

test('默认增速、前复权默认口径与手动上下平移通道计算严格精确', () => {
  const rows = makeSyntheticSeries({ startYear: 2012, years: 14, annualGrowth: 0.14 });
  const dsDefault = buildChannelDataset('QQQ', rows);
  assert.equal(dsDefault.priceBasis, 'totalReturn');
  assert.equal(dsDefault.defaultSlope, 15.0);

  const mBase = evaluateChannelModel(dsDefault, { slopePct: 15.0, anchorMode: 'recent7y', offsetPct: 0 });
  const mUp = evaluateChannelModel(dsDefault, { slopePct: 15.0, anchorMode: 'recent7y', offsetPct: 10 });
  const mDown = evaluateChannelModel(dsDefault, { slopePct: 15.0, anchorMode: 'recent7y', offsetPct: -10 });

  assert.ok(Math.abs(mUp.fitEnd / mBase.fitEnd - 1.1) < 1e-12);
  assert.ok(Math.abs(mDown.fitEnd / mBase.fitEnd - 0.9) < 1e-12);
  assert.ok(mUp.zEnd < mBase.zEnd && mBase.zEnd < mDown.zEnd);

  const mClamped = evaluateChannelModel(dsDefault, { slopePct: 15.0, offsetPct: 999 });
  assert.equal(mClamped.offsetPct, 60);
});

test('端点旋转求解器固定对侧端点并按年化斜率与平移边界裁剪', () => {
  const rows = makeSyntheticSeries({ annualGrowth: 0.14 });
  const ds = buildChannelDataset('QQQ', rows, { windowId: 'all', priceBasis: 'totalReturn' });
  const m0 = evaluateChannelModel(ds, { slopePct: 15.0, anchorMode: 'recent7y', offsetPct: 0 });

  // Drag right endpoint upward: slope rises and left endpoint stays pinned.
  const rightUp = solveEndpointChannel(ds, {
    fixedT: 0,
    fixedLnP: m0.lnFit(0),
    dragT: ds.tEnd,
    targetLnP: m0.lnFit(ds.tEnd) + 0.18,
    anchorMode: ANCHOR_MODES.recent7y
  });
  assert.ok(rightUp.slopePct > 15.0, '右端上拖应提高年化增速');
  assert.ok(rightUp.customAnchor?.anchorDate && rightUp.customAnchor?.anchorPrice > 0);
  const mRightUp = evaluateChannelModel(ds, {
    slopePct: rightUp.slopePct,
    customAnchor: rightUp.customAnchor,
    anchorMode: ANCHOR_MODES.recent7y
  });
  assert.ok(
    Math.abs(Math.exp(mRightUp.lnFit(0) - m0.lnFit(0)) - 1) < 0.003,
    '右端旋转时左端点应保持固定'
  );

  // Steep upward rotation (> +60% relative to basePivot) still pins left end via customAnchor.
  const steepRightUp = solveEndpointChannel(ds, {
    fixedT: 0,
    fixedLnP: m0.lnFit(0),
    dragT: ds.tEnd,
    targetLnP: m0.lnFit(ds.tEnd) + 1.15,
    anchorMode: ANCHOR_MODES.recent7y
  });
  const mSteepRightUp = evaluateChannelModel(ds, {
    slopePct: steepRightUp.slopePct,
    customAnchor: steepRightUp.customAnchor,
    anchorMode: ANCHOR_MODES.recent7y
  });
  assert.ok(
    Math.abs(Math.exp(mSteepRightUp.lnFit(0) - m0.lnFit(0)) - 1) < 0.003,
    '大角度旋转时借助绝对锚点仍应固定左端点'
  );

  // Drag left endpoint upward: slope decreases and right endpoint stays pinned.
  const leftUp = solveEndpointChannel(ds, {
    fixedT: ds.tEnd,
    fixedLnP: m0.lnFit(ds.tEnd),
    dragT: 0,
    targetLnP: m0.lnFit(0) + 0.18,
    anchorMode: ANCHOR_MODES.recent7y
  });
  assert.ok(leftUp.slopePct < 15.0, '左端上拖应降低年化增速');
  const mLeftUp = evaluateChannelModel(ds, {
    slopePct: leftUp.slopePct,
    customAnchor: leftUp.customAnchor,
    anchorMode: ANCHOR_MODES.recent7y
  });
  assert.ok(
    Math.abs(Math.exp(mLeftUp.lnFit(ds.tEnd) - m0.lnFit(ds.tEnd)) - 1) < 0.003,
    '左端旋转时右端点应保持固定'
  );

  // Extreme upward and downward drags clamp within valid slider/offset bounds.
  const extremeUp = solveEndpointChannel(ds, {
    fixedT: 0,
    fixedLnP: m0.lnFit(0),
    dragT: ds.tEnd,
    targetLnP: m0.lnFit(ds.tEnd) + 20,
    anchorMode: ANCHOR_MODES.recent7y
  });
  assert.equal(extremeUp.slopePct, ds.maxSlope);
  assert.ok(extremeUp.offsetPct >= -40 && extremeUp.offsetPct <= 60);

  const extremeDown = solveEndpointChannel(ds, {
    fixedT: 0,
    fixedLnP: m0.lnFit(0),
    dragT: ds.tEnd,
    targetLnP: m0.lnFit(ds.tEnd) - 20,
    anchorMode: ANCHOR_MODES.recent7y
  });
  assert.equal(extremeDown.slopePct, ds.minSlope);
  assert.ok(extremeDown.offsetPct >= -40 && extremeDown.offsetPct <= 60);
});

test('全部 5 只内置标的真实数据快照均能成功建模且无缺失 sourceClose', async () => {
  for (const sym of CHANNEL_SYMBOLS) {
    const url = new URL(`../public/data/${sym.toLowerCase()}.json`, import.meta.url);
    const data = JSON.parse(await readFile(url, 'utf8'));
    const ds = buildChannelDataset(sym, data.rows, { windowId: '15y', priceBasis: 'price' });
    const m = evaluateChannelModel(ds, { slopePct: ds.defaultSlope, anchorMode: 'recent7y', keepOrigSigma: true });
    assert.ok(ds.pointCount > 3000, `${sym} 样本点数应大于 3000`);
    assert.ok(Number.isFinite(m.zEnd), `${sym} Z-Score 应为有限值`);
    assert.ok(m.sigmaUsed > 0, `${sym} 波动率应大于 0`);
    assert.ok(m.slopePct >= ds.minSlope && m.slopePct <= ds.maxSlope, `${sym} 默认斜率应在滑块范围内`);
  }
});

test('安全合规：新增前端模块严禁使用 innerHTML / outerHTML / insertAdjacentHTML / document.write', async () => {
  const files = [
    '../public/js/channel-page.mjs',
    '../public/js/features/channel/page.mjs',
    '../public/js/features/channel/charts.mjs',
    '../public/js/features/channel/storage.mjs',
    '../public/js/ui/channel-navigation.mjs'
  ];
  for (const rel of files) {
    const src = await readFile(new URL(rel, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /\b(innerHTML|outerHTML|insertAdjacentHTML)\b|document\.write\s*\(/, rel);
  }
  const html = await readFile(new URL('../public/channel.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /\bOLS\b|Constrained OLS|波动带宽|拆股复权/);
});

test('绝对时间-价格锚点在切换样本窗口与追加新交易日后保持零漂移', () => {
  const baseRows = makeSyntheticSeries({ startYear: 2010, years: 16, annualGrowth: 0.14 });
  const customAnchor = { anchorDate: '2020-06-15', anchorPrice: 365.4321 };
  const targetMs = parseIsoDateUtc('2025-05-01');

  const ds15y = buildChannelDataset('QQQ', baseRows, { windowId: '15y', priceBasis: 'totalReturn' });
  const ds10y = buildChannelDataset('QQQ', baseRows, { windowId: '10y', priceBasis: 'totalReturn' });
  const m15 = evaluateChannelModel(ds15y, { slopePct: 16.5, customAnchor });
  const m10 = evaluateChannelModel(ds10y, { slopePct: 16.5, customAnchor });
  const p15 = m15.priceFit((targetMs - ds15y.baseMs) / MS_PER_YEAR);
  const p10 = m10.priceFit((targetMs - ds10y.baseMs) / MS_PER_YEAR);
  assert.ok(Math.abs(p15 / p10 - 1) < 1e-9, '切换 15y / 10y 窗口应完全保留同一日历价格中枢');

  // Append 90 future days with deviated price action so rolling pivots move.
  const futureRows = [...baseRows];
  const lastMs = parseIsoDateUtc(baseRows[baseRows.length - 1].date);
  for (let d = 7; d <= 91; d += 7) {
    const date = new Date(lastMs + d * 86400000).toISOString().slice(0, 10);
    futureRows.push({ date, sourceClose: baseRows[baseRows.length - 1].sourceClose * 1.45, close: 999 });
  }
  const dsFuture = buildChannelDataset('QQQ', futureRows, { windowId: '15y', priceBasis: 'totalReturn' });
  const mFuture = evaluateChannelModel(dsFuture, { slopePct: 16.5, customAnchor });
  const pFuture = mFuture.priceFit((targetMs - dsFuture.baseMs) / MS_PER_YEAR);
  assert.ok(Math.abs(pFuture / p15 - 1) < 1e-6, '行情快照新增 90 天后绝对锚定通道不应漂移');

  const shifted = createShiftedCustomAnchor(ds15y, {
    baseAnchorDate: customAnchor.anchorDate,
    baseAnchorPrice: customAnchor.anchorPrice,
    slopePct: 16.5,
    deltaLn: Math.log(1.1)
  });
  assert.equal(shifted.customAnchor.anchorDate, customAnchor.anchorDate);
  assert.ok(Math.abs(shifted.customAnchor.anchorPrice / (customAnchor.anchorPrice * 1.1) - 1) < 1e-4);

  // Cross-date anchor (e.g. 2013 price shifted slightly downward) must not clamp upward against 2023 basePivot.price.
  const crossDateShifted = createShiftedCustomAnchor(ds15y, {
    baseAnchorDate: '2013-01-15',
    baseAnchorPrice: 65,
    slopePct: 15.0,
    deltaLn: -0.002
  });
  assert.equal(crossDateShifted.customAnchor.anchorDate, '2013-01-15');
  assert.ok(crossDateShifted.customAnchor.anchorPrice < 65 && crossDateShifted.customAnchor.anchorPrice > 64.5);
});

test('浏览器持久化：往返保存、旧版 v3 迁移、脏字段严格过滤与写入失败回退', () => {
  function createMemoryStorage() {
    const map = new Map();
    return {
      getItem: k => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: k => { map.delete(k); }
    };
  }

  const mem = createMemoryStorage();
  assert.equal(probeChannelStorage(mem), true);

  const state = createDefaultChannelState();
  state.activeTab = 'QQQ';
  state.windowId = '10y';
  state.symbols.QQQ.slopePct = 17.8;
  state.symbols.QQQ.anchorMode = ANCHOR_MODES.fullPivot;
  state.symbols.QQQ.customAnchor = { anchorDate: '2021-03-15', anchorPrice: 325.125 };
  state.symbols.SPY.slopePct = 11.5;

  const saveRes = saveChannelState(state, mem);
  assert.equal(saveRes.ok, true);

  const loaded = loadChannelState(mem);
  assert.equal(loaded.loadedFromKey, STORAGE_KEY);
  assert.equal(loaded.storageReadable, true);
  assert.equal(loaded.state.activeTab, 'QQQ');
  assert.equal(loaded.state.windowId, '10y');
  assert.equal(loaded.state.symbols.QQQ.slopePct, 17.8);
  assert.equal(loaded.state.symbols.QQQ.anchorMode, ANCHOR_MODES.fullPivot);
  assert.deepEqual(loaded.state.symbols.QQQ.customAnchor, { anchorDate: '2021-03-15', anchorPrice: 325.125 });
  assert.equal(loaded.state.symbols.SPY.slopePct, 11.5);
  assert.equal(loaded.state.symbols.SPY.anchorMode, ANCHOR_MODES.fullPivot);
  assert.equal(loaded.state.symbols.SPY.followHistSlope, true);

  // Legacy flat v3 schema migration
  const legacyRaw = JSON.stringify({
    windowId: 'all',
    anchorMode: ANCHOR_MODES.fullPivot,
    slopes: { SPY: 9.5, QQQ: 16.0 },
    offsets: { QQQ: -7.5 }
  });
  const migrated = parseChannelState(legacyRaw);
  assert.equal(migrated.windowId, 'all');
  assert.equal(migrated.symbols.SPY.slopePct, 9.5);
  assert.equal(migrated.symbols.SPY.followHistSlope, false);
  assert.equal(migrated.symbols.QQQ.slopePct, 16.0);
  assert.equal(migrated.symbols.QQQ.offsetPct, -7.5);
  assert.equal(migrated.symbols.QQQ.anchorMode, ANCHOR_MODES.fullPivot);
  assert.equal(migrated.symbols.QQQ.followHistSlope, false);

  // Reject corrupt non-number values (null / "" / false / NaN) and invalid calendar/negative anchors without losing valid symbols
  const corruptRaw = JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    activeTab: 'UNKNOWN',
    symbols: {
      QQQ: { slopePct: null, offsetPct: '', customAnchor: { anchorDate: 'bad-date', anchorPrice: 100 } },
      SPY: { slopePct: false, offsetPct: NaN, customAnchor: { anchorDate: '2023-02-30', anchorPrice: 120 } },
      VGT: { slopePct: 17.2, customAnchor: { anchorDate: '2023-05-26', anchorPrice: 410 } }
    }
  });
  const sanitized = parseChannelState(corruptRaw);
  assert.equal(sanitized.activeTab, 'SPY');
  assert.equal(sanitized.symbols.QQQ.slopePct, 15);
  assert.equal(sanitized.symbols.QQQ.offsetPct, 0);
  assert.equal(sanitized.symbols.QQQ.customAnchor, null);
  assert.equal(sanitized.symbols.SPY.slopePct, 10);
  assert.equal(sanitized.symbols.SPY.customAnchor, null);
  assert.equal(sanitized.symbols.VGT.slopePct, 17.2);
  assert.deepEqual(sanitized.symbols.VGT.customAnchor, { anchorDate: '2023-05-26', anchorPrice: 410 });

  // Simulate QuotaExceededError / private storage block
  const failingStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('QuotaExceededError'); },
    removeItem: () => {}
  };
  assert.equal(probeChannelStorage(failingStorage), false);
  assert.equal(saveChannelState(state, failingStorage).ok, false);
});

test('年化复利 95% 统计置信区间、非对称 1σ 偏离与经验覆盖/分位数计算严谨准确', async () => {
  assert.ok(Math.abs(tCritical95(1) - 12.7062047) < 1e-6);
  assert.ok(Math.abs(tCritical95(10) - 2.2281389) < 1e-6);
  assert.ok(tCritical95(30) > 2.04 && tCritical95(30) < 2.05);
  assert.ok(tCritical95(5000) >= 1.9599 && tCritical95(5000) < 1.961);

  const flatEmp = computeEmpiricalStats([0, 0, 0, 0], 0, 0);
  assert.equal(flatEmp.in1sPct, 100);
  assert.equal(flatEmp.in2sPct, 100);
  assert.equal(flatEmp.percentilePct, 50);

  const rankedEmp = computeEmpiricalStats([-0.2, -0.1, 0, 0.1, 0.25], 0.15, 0.25);
  assert.equal(rankedEmp.in1sPct, 60);
  assert.equal(rankedEmp.in2sPct, 100);
  assert.equal(rankedEmp.percentilePct, 90);

  const cleanRows = makeSyntheticSeries({ annualGrowth: 0.12 });
  const dsClean = buildChannelDataset('SPY', cleanRows, { windowId: 'all', priceBasis: 'totalReturn' });
  assert.ok(Math.abs(dsClean.returnStats.cagrPct - 12.0) < 1e-6);
  assert.ok(dsClean.returnStats.annVolPct < 1e-9);
  assert.ok(Math.abs(dsClean.returnStats.cagrCiLowPct - 12.0) < 1e-6);
  assert.ok(Math.abs(dsClean.returnStats.cagrCiHighPct - 12.0) < 1e-6);

  const spyUrl = new URL('../public/data/spy.json', import.meta.url);
  const spyData = JSON.parse(await readFile(spyUrl, 'utf8'));
  const dsSpy15 = buildChannelDataset('SPY', spyData.rows, { windowId: '15y', priceBasis: 'totalReturn' });
  const rs = dsSpy15.returnStats;
  assert.ok(rs.cagrCiLowPct < rs.cagrPct && rs.cagrPct < rs.cagrCiHighPct);
  assert.ok(rs.annVolPct > 5 && rs.tCrit95 >= 1.9599);
  assert.ok(rs.cagrCiHighPct - rs.cagrCiLowPct > 10, '15 年美股样本的年化复利 95% 置信区间宽度应大于 10 个百分点');

  const mSpy = evaluateChannelModel(dsSpy15, { slopePct: dsSpy15.defaultSlope, anchorMode: 'recent7y' });
  const tierPlus1 = mSpy.tiers.find(t => t.k === 1.0);
  const tierMinus1 = mSpy.tiers.find(t => t.k === -1.0);
  assert.ok(mSpy.bandUp1sPct > Math.abs(mSpy.bandDown1sPct));
  assert.ok(Math.abs(mSpy.bandUp1sPct - tierPlus1.devCenter * 100) < 1e-12);
  assert.ok(Math.abs(mSpy.bandDown1sPct - tierMinus1.devCenter * 100) < 1e-12);
  assert.ok(mSpy.empirical.in1sPct >= 0 && mSpy.empirical.in1sPct <= mSpy.empirical.in2sPct);
  assert.ok(mSpy.empirical.percentilePct > 0 && mSpy.empirical.percentilePct < 100);
  assert.ok(dsSpy15.orig.empirical.in2sPct > 90 && dsSpy15.orig.empirical.in2sPct <= 100);
});

test('边界修复：负历史斜率、非法复权回退及 followHistSlope 持久化往返兼容', () => {
  const negRows = makeSyntheticSeries({ startYear: 2015, years: 8, basePrice: 200, annualGrowth: -0.06 });
  for (const sym of CHANNEL_SYMBOLS) {
    const dsSym = buildChannelDataset(sym, negRows, { windowId: 'all' });
    assert.ok(dsSym.presets[1].label.startsWith('中性 '), `${sym} 第二个预设应为中性`);
  }
  const dsNeg = buildChannelDataset('SPY', negRows, { windowId: 'all', priceBasis: 'invalidBasis' });
  assert.equal(dsNeg.priceBasis, 'totalReturn', '非法 priceBasis 应回退至默认的 totalReturn');
  assert.ok(dsNeg.orig.slopePct < 0 && dsNeg.minSlope < 0, '负历史斜率应保留负值下限');

  const mNeg = evaluateChannelModel(dsNeg, { slopePct: dsNeg.orig.slopePct, anchorMode: 'fullPivot' });
  assert.ok(Math.abs(mNeg.slopePct - dsNeg.orig.slopePct) < 1e-6);
  assert.ok(mNeg.fitEnd > 0 && Number.isFinite(mNeg.zEnd));

  const map = new Map();
  const mem = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); }
  };
  const state = createDefaultChannelState();
  state.symbols.SPY.slopePct = -6.2;
  state.symbols.SPY.followHistSlope = true;
  state.symbols.SPY.anchorMode = ANCHOR_MODES.fullPivot;
  state.symbols.QQQ.followHistSlope = false;
  assert.equal(saveChannelState(state, mem).ok, true);

  const reloaded = loadChannelState(mem);
  assert.equal(reloaded.state.symbols.SPY.slopePct, -6.2);
  assert.equal(reloaded.state.symbols.SPY.followHistSlope, true);
  assert.equal(reloaded.state.symbols.QQQ.followHistSlope, false);
});

test('加权K指标整合：跨样本窗口数值与主页全历史周线口径一致、十档高亮及系数持久化', async () => {
  const spyUrl = new URL('../public/data/spy.json', import.meta.url);
  const spyData = JSON.parse(await readFile(spyUrl, 'utf8'));
  const fullKD = calculateKDSeries(spyData.rows);

  const ds15y = buildChannelDataset('SPY', spyData.rows, { windowId: '15y', priceBasis: 'totalReturn' });
  const ds10y = buildChannelDataset('SPY', spyData.rows, { windowId: '10y', priceBasis: 'totalReturn' });
  const kd15 = buildChannelKDSeries(spyData.rows, ds15y, { tierFactor: 2 });
  const kd10 = buildChannelKDSeries(spyData.rows, ds10y, { tierFactor: 2 });

  const fullLatest = fullKD.get(ds15y.endDate);
  assert.ok(fullLatest && kd15.latest && kd10.latest);
  assert.equal(kd15.latest.weightedK, fullLatest.weightedK);
  assert.equal(kd10.latest.weightedK, fullLatest.weightedK);
  assert.equal(kd15.latest.multiple, kdMultiple(fullLatest.weightedK, 2));
  assert.ok(kd15.points.length > kd10.points.length && kd10.points.length > 400);

  const tiers = buildChannelKDTiers(1.5, 25.0);
  assert.equal(tiers.length, 10);
  assert.equal(tiers.filter(t => t.isCurrent).length, 1);
  assert.equal(tiers.find(t => t.isCurrent).rangeLabel, '20–30');
  assert.equal(tiers.find(t => t.isCurrent).multiple, kdMultiple(25.0, 1.5));
  assert.equal(classifyChannelKD(18).label, '极低 · 重仓区');
  assert.equal(classifyChannelKD(92).label, '高位区间');

  const map = new Map();
  const mem = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); }
  };
  assert.equal(saveChannelKDOptions({ tierFactor: 1.8 }, mem), true);
  assert.equal(loadChannelKDOptions(mem).tierFactor, 1.8);
  assert.equal(parseChannelKDOptions('invalid').tierFactor, 1.5);
  assert.equal(
    parseChannelKDOptions(JSON.stringify({ monthWeight: 40, quarterWeight: 60, period: 9, signal: 3, tierFactor: 2 })).tierFactor,
    1.5
  );
  assert.equal(KD_STORAGE_KEY, 'seeker.kd.v1');

  const state = createDefaultChannelState();
  state.showKD = false;
  saveChannelState(state, mem);
  assert.equal(loadChannelState(mem).state.showKD, false);

  const html = await readFile(new URL('../public/channel.html', import.meta.url), 'utf8');
  for (const id of ['channel-kd-canvas', 'channel-kd-tiers', 'channel-kd-factor', 'comp-kd-factor']) {
    assert.ok(html.includes(id), `channel.html 应包含 ${id}`);
  }
  assert.ok(!html.includes('kpi5-kd'), 'channel.html 不应再包含第四张加权K摘要卡');
});

test('图表缩放与平移视口数学：锚点保真、边界裁剪与自动回正', async () => {
  const rows = makeSyntheticSeries({ startYear: 2012, years: 15, annualGrowth: 0.12 });
  const ds = buildChannelDataset('QQQ', rows, { windowId: '15y', priceBasis: 'totalReturn' });
  const bounds = getFullChannelViewBounds(ds, true);
  assert.ok(bounds.tMin < 0 && bounds.tMax > ds.tProj);

  // Anchor point under cursor ratio=0.7 remains invariant after zoom
  const ratio = 0.7;
  const fullAnchorT = bounds.tMin + (bounds.tMax - bounds.tMin) * ratio;
  const z1 = zoomChannelView(null, ratio, 0.5, bounds);
  assert.ok(z1 && z1.tMax - z1.tMin < bounds.tMax - bounds.tMin);
  const z1AnchorT = z1.tMin + (z1.tMax - z1.tMin) * ratio;
  assert.ok(Math.abs(z1AnchorT - fullAnchorT) < 1e-9, '缩放锚点时间应保持精确不变');

  // Extreme zoom in clamps at MIN_CHANNEL_VIEW_SPAN
  const zMin = zoomChannelView(z1, 0.5, 1e-6, bounds);
  assert.ok(Math.abs((zMin.tMax - zMin.tMin) - MIN_CHANNEL_VIEW_SPAN) < 1e-9);

  // Zooming back out past full span snaps cleanly to null
  assert.equal(zoomChannelView(z1, 0.5, 4.0, bounds), null);

  // Panning shifts window and clamps cleanly at left/right boundaries
  assert.equal(panChannelView(null, 0.2, bounds), null);
  const pLeft = panChannelView(z1, -10, bounds);
  assert.equal(pLeft.tMin, bounds.tMin);
  assert.ok(Math.abs((pLeft.tMax - pLeft.tMin) - (z1.tMax - z1.tMin)) < 1e-9);

  const pRight = panChannelView(z1, 10, bounds);
  assert.equal(pRight.tMax, bounds.tMax);
  assert.ok(Math.abs((pRight.tMax - pRight.tMin) - (z1.tMax - z1.tMin)) < 1e-9);
  assert.equal(constrainChannelView({ tMin: bounds.tMin, tMax: bounds.tMax }, bounds), null);

  const html = await readFile(new URL('../public/channel.html', import.meta.url), 'utf8');
  for (const id of [
    'btn-zoom-reset',
    'channel-zoom-range',
    'channel-symbol',
    'add-symbol',
    'symbol-dialog',
    'btn-more-settings',
    'btn-compare-open',
    'channel-compare-dialog',
    'status',
    'refresh',
    'channel-price-close'
  ]) {
    assert.ok(html.includes(id), `channel.html 应包含 ${id}`);
  }
  assert.ok(!html.includes('btn-zoom-in') && !html.includes('btn-zoom-out'), 'channel.html 不应包含 +/- 缩放按钮');
  assert.match(html, /<dialog id="channel-compare-dialog" closedby="any"/);
  assert.doesNotMatch(html, /id="channel-compare-dialog"[^>]*\b(role="dialog"|aria-modal)/);

  const indexHtml = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(indexHtml, /id="add-symbol"[\s\S]*?M12 5v14M5 12h14/);

  // Custom symbol dataset & persistence support
  const dsCustom = buildChannelDataset('AAPL', rows, { windowId: '15y', priceBasis: 'totalReturn' });
  assert.equal(dsCustom.symbol, 'AAPL');
  assert.equal(dsCustom.defaultSlope, 10.0);
  const customState = createDefaultChannelState();
  customState.activeTab = 'AAPL';
  customState.symbols.AAPL = {
    slopePct: 14.5,
    followHistSlope: false,
    anchorMode: ANCHOR_MODES.fullPivot,
    userPreferredAnchor: ANCHOR_MODES.recent7y,
    offsetPct: 0,
    customAnchor: null
  };
  const customStorageMap = new Map();
  const customMem = {
    getItem: k => (customStorageMap.has(k) ? customStorageMap.get(k) : null),
    setItem: (k, v) => { customStorageMap.set(k, String(v)); },
    removeItem: k => { customStorageMap.delete(k); }
  };
  assert.equal(saveChannelState(customState, customMem).ok, true);
  const reloadedCustom = loadChannelState(customMem).state;
  assert.equal(reloadedCustom.activeTab, 'AAPL');
  assert.equal(reloadedCustom.symbols.AAPL.slopePct, 14.5);
});

test('主图命中测试仅在中枢线与可见端点触发通道调整，空白区及越界区仅返回 body', () => {
  const rows = makeSyntheticSeries({ startYear: 2012, years: 14, annualGrowth: 0.12 });
  const ds = buildChannelDataset('SPY', rows, { windowId: '15y', priceBasis: 'totalReturn' });
  const model = evaluateChannelModel(ds, { slopePct: 12.0, anchorMode: 'fullPivot' });

  const mockCanvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 440 })
  };
  const padLeft = 46;
  const plotW = 684;
  const padTop = 20;
  const plotH = 390;
  const tMin = -0.2;
  const tMax = ds.tEnd + 1.0;
  const tLineEnd = ds.tEnd;
  const lnYMin = Math.log(40);
  const lnYMax = Math.log(800);
  const xOf = t => padLeft + ((t - tMin) / (tMax - tMin)) * plotW;
  const yOfLn = lnV => padTop + ((lnYMax - lnV) / (lnYMax - lnYMin)) * plotH;

  const geom = {
    padLeft,
    plotW,
    padTop,
    plotH,
    tMin,
    tMax,
    tLineEnd,
    lnYMin,
    lnYMax,
    handles: {
      left: { x: xOf(0), y: yOfLn(model.lnFit(0)), t: 0, lnP: model.lnFit(0), visible: true },
      right: { x: xOf(tLineEnd), y: yOfLn(model.lnFit(tLineEnd)), t: tLineEnd, lnP: model.lnFit(tLineEnd), visible: true }
    }
  };

  // Visible endpoints hit 'left' and 'right'
  assert.equal(hitTestChannelHandle(mockCanvas, geom, geom.handles.left.x + 4, geom.handles.left.y - 4, model), 'left');
  assert.equal(hitTestChannelHandle(mockCanvas, geom, geom.handles.right.x - 4, geom.handles.right.y + 4, model), 'right');

  // Off-screen invisible handle is NOT hit even within 16px
  const hiddenRightGeom = {
    ...geom,
    handles: {
      ...geom.handles,
      right: { ...geom.handles.right, y: padTop - 13, visible: false }
    }
  };
  assert.notEqual(
    hitTestChannelHandle(mockCanvas, hiddenRightGeom, geom.handles.right.x, padTop + 1, model),
    'right'
  );

  // Midpoint near centerline hits 'centerline'
  const midT = ds.tEnd * 0.5;
  const midX = xOf(midT);
  const midCenterY = yOfLn(model.lnFit(midT));
  assert.equal(hitTestChannelHandle(mockCanvas, geom, midX, midCenterY + 6, model), 'centerline');

  // Blank area far above/below centerline returns 'body'
  assert.equal(hitTestChannelHandle(mockCanvas, geom, midX, padTop + 10, model), 'body');
  assert.equal(hitTestChannelHandle(mockCanvas, geom, midX, padTop + plotH - 10, model), 'body');

  // Extrapolated centerline beyond tLineEnd in right margin returns 'body', not 'centerline'
  const outT = tLineEnd + 0.5;
  assert.equal(hitTestChannelHandle(mockCanvas, geom, xOf(outT), yOfLn(model.lnFit(outT)), model), 'body');
});
