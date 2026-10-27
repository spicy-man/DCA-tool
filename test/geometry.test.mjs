import test from 'node:test';import assert from 'node:assert/strict';import {createTradingScale,candleMetrics,createPriceAxis,createProfitAxis} from '../public/js/charts/geometry.mjs';
test('周末不占空间；周五到周一与周一到周二等距',()=>{const scale=createTradingScale(['2026-10-09','2026-10-12','2026-10-13'],'daily',43,600);assert.equal(scale.x('2026-10-12')-scale.x('2026-10-09'),scale.x('2026-10-13')-scale.x('2026-10-12'));assert.ok(scale.x('2026-10-13')<643-scale.spacing*2);});
test('同周不同交易日期映射到同一位置，保留两图联动',()=>{const scale=createTradingScale(['2026-10-08','2026-10-09','2026-10-12'],'weekly',43,600);assert.equal(scale.x('2026-10-08'),scale.x('2026-10-09'));assert.equal(scale.dates.length,2);});
test('不同缩放和屏幕倍率的实体、影线对齐整数像素并保持居中',()=>{for(const dpr of [1,1.25,1.5,2,3])for(const spacing of [2,3,5,7,12,24]){const m=candleMetrics(spacing,dpr);assert.ok(Number.isInteger(m.body)&&Number.isInteger(m.wick));assert.equal(m.body%2,m.wick%2);assert.ok(m.body>=m.wick);if(spacing>=5)assert.ok(m.body<spacing*dpr);}});


test('跨年月线、周线及稀疏日历刻度包含年份，短期日线显示月日', () => {
  for (const frequency of ['daily', 'weekly', 'monthly']) {
    const scale = createTradingScale(['2021-01-04', '2023-06-30', '2025-12-31'], frequency, 0, 600);
    assert.ok(scale.ticks(3).every(t => /21|23|25/.test(t.label)), frequency);
  }
  const short = createTradingScale(['2025-01-02', '2025-01-03'], 'daily', 0, 600);
  assert.equal(short.shortTicks, true);
  assert.match(short.ticks(2)[0].label, /2日/);
});

test('价格对数坐标使相同涨幅比值占据相等纵向距离，刻度单调且位于绘图区内', () => {
  const linear = createPriceAxis(50, 500, 20, 300, false);
  const log = createPriceAxis(50, 500, 20, 300, true);
  assert.ok(Math.abs((linear.y(50) - linear.y(100)) - (linear.y(100) - linear.y(150))) < 1e-9);
  assert.ok(Math.abs((log.y(50) - log.y(100)) - (log.y(100) - log.y(200))) < 1e-9);
  const ticks = log.ticks();
  assert.ok(ticks.length >= 2);
  assert.ok(ticks.every((t, i) => t >= log.low && t <= log.high && (!i || t > ticks[i - 1])));
});

test('回测累计盈亏对称对数坐标兼容零与负亏损，对大额正收益压缩并保持严格单调', () => {
  const values = [-4000, 0, 5000, 50000, 500000];
  const linear = createProfitAxis(values, 20, 220, false, 2000);
  const log = createProfitAxis(values, 20, 220, true, 2000);
  assert.ok(log.y(500000) < log.y(50000));
  assert.ok(log.y(50000) < log.y(5000));
  assert.ok(log.y(5000) < log.y(0));
  assert.ok(log.y(0) < log.y(-4000));
  // Log scale gives mid-range positive profits more visual separation than linear when a huge outlier exists.
  assert.ok((log.y(0) - log.y(50000)) > (linear.y(0) - linear.y(50000)));
  assert.ok(log.ticks.includes(0));

  const rounded = createProfitAxis([-1255, 0, 1260], 20, 220, true, 2000);
  assert.ok(rounded.ticks.every(t => rounded.y(t) >= 20 - 1e-9 && rounded.y(t) <= 220 + 1e-9));
});
