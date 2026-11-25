import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FUND_SCHEDULES, scheduledPlan, scheduledSources } from '../server/refresh-schedule.mjs';

const all = ['Fear & Greed', 'SPY', 'QQQ', 'VGT', 'SMH', 'BRK-B'];

test('pages.yml 全部定时 cron 全局唯一且与 refresh-schedule 契约一致', () => {
  const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
  const scheduleSection = workflow.split('\n  schedule:\n')[1]?.split('\n  workflow_dispatch:\n')[0] || '';
  const entries = [...scheduleSection.matchAll(/-\s*cron:\s*'([^']+)'\s*\n\s*timezone:\s*(\S+)/g)]
    .map(([, cron, timezone]) => ({ cron, timezone }));

  assert.equal(entries.length, 11);
  assert.equal(new Set(entries.map(entry => entry.cron)).size, entries.length);

  const shanghaiCrons = entries.filter(entry => entry.timezone === 'Asia/Shanghai').map(entry => entry.cron);
  assert.deepEqual(shanghaiCrons, FUND_SCHEDULES);
  for (const cron of shanghaiCrons) {
    assert.deepEqual(scheduledPlan(cron, Date.parse('2026-11-27T23:50Z')), { sources: [], funds: true });
  }

  const nyCrons = entries.filter(entry => entry.timezone === 'America/New_York').map(entry => entry.cron);
  assert.equal(nyCrons.length, 8);
  for (const cron of nyCrons) {
    const plan = scheduledPlan(cron, Date.parse('2026-11-27T23:50Z'));
    assert.equal(plan.funds, false);
    assert.ok(Array.isArray(plan.sources));
  }
});

test('正常收盘夏冬时均抓两轮K线；18:37仅作护栏；FNG工作日每六小时更新且周六晨兜底', () => {
  for (const [date, close] of [['2026-10-16', 20], ['2026-11-02', 21]]) {
    const at = (hour, minute) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:${minute}:00Z`);
    assert.deepEqual(scheduledSources('13 16 * * 1-5', at(close, '13')), all);
    assert.deepEqual(scheduledSources('19 17 * * 1-5', at(close + 1, '19')), all);
    assert.deepEqual(scheduledSources('37 18 * * 1-5', at(close + 2, '37')), []);
    assert.deepEqual(scheduledSources('29 4 * * 2-6', at(close, '13')), ['Fear & Greed']);
    for (const cron of ['17 10 * * 1-5', '23 22 * * 1-5']) {
      assert.deepEqual(scheduledSources(cron, at(close, '13')), ['Fear & Greed']);
    }
  }
  for (const [date, close] of [['2026-07-06', 20], ['2026-11-02', 21]]) {
    const at = (hour, minute) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:${minute}:00Z`);
    assert.deepEqual(scheduledSources('13 13 * 7,11,12 1-5', at(close - 3, '13')), []);
    assert.deepEqual(scheduledSources('19 14 * 7,11,12 1-5', at(close - 2, '19')), []);
  }
  const freshStatus = { results: all.map(symbol => ({ symbol, ok: true, date: '2026-11-02' })) };
  const staleStatus = {
    results: all.map(symbol => ({
      symbol,
      ok: true,
      date: symbol === 'Fear & Greed' ? '2026-11-02' : '2026-10-30'
    }))
  };
  assert.deepEqual(
    scheduledSources('37 18 * * 1-5', Date.parse('2026-11-02T23:37Z'), { status: freshStatus, catchUp: true }),
    []
  );
  assert.deepEqual(
    scheduledSources('37 18 * * 1-5', Date.parse('2026-11-02T23:37Z'), { status: staleStatus, catchUp: true }),
    all.slice(1)
  );
});

test('提前收盘仅7/11/12月13:13和14:19抓K线，工作日节假日仍检查FNG并保留周六晨兜底', () => {
  // 2025-07-03 (EDT) / 2026-11-27 (EST) / 2026-12-24 (EST) 均为 13:00 提前收盘
  assert.deepEqual(scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2025-07-03T17:13Z')), all);
  assert.deepEqual(scheduledSources('19 14 * 7,11,12 1-5', Date.parse('2025-07-03T18:19Z')), all);
  assert.deepEqual(scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2026-11-27T18:13Z')), all);
  assert.deepEqual(scheduledSources('19 14 * 7,11,12 1-5', Date.parse('2026-11-27T19:19Z')), all);
  assert.deepEqual(scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2026-12-24T18:13Z')), all);
  assert.deepEqual(scheduledSources('19 14 * 7,11,12 1-5', Date.parse('2026-12-24T19:19Z')), all);

  assert.deepEqual(scheduledSources('13 16 * * 1-5', Date.parse('2026-11-27T21:13Z')), ['Fear & Greed']);
  assert.deepEqual(scheduledSources('19 17 * * 1-5', Date.parse('2026-11-27T22:19Z')), []);
  assert.deepEqual(scheduledSources('37 18 * * 1-5', Date.parse('2026-11-27T23:37Z')), []);

  // 2026-12-25 圣诞节休市
  assert.deepEqual(scheduledSources('13 16 * * 1-5', Date.parse('2026-12-25T21:13Z')), ['Fear & Greed']);
  assert.deepEqual(scheduledSources('19 17 * * 1-5', Date.parse('2026-12-25T22:19Z')), []);
  assert.deepEqual(scheduledSources('37 18 * * 1-5', Date.parse('2026-12-25T23:37Z')), []);

  // 周六晨 04:29 NY 对应周五收盘兜底；周日夜间回溯至周六凌晨而非周日
  assert.deepEqual(scheduledSources('29 4 * * 2-6', Date.parse('2026-10-17T08:35Z')), ['Fear & Greed']);
  assert.deepEqual(scheduledSources('29 4 * * 2-6', Date.parse('2026-10-19T03:30Z')), ['Fear & Greed']);
});

test('任务延迟跨小时或跨月仍按计划槽位回溯；非指定月份或非法cron拒绝执行', () => {
  assert.deepEqual(scheduledSources('19 17 * * 1-5', Date.parse('2026-10-17T01:30Z')), all);
  assert.deepEqual(scheduledSources('13 16 * * 1-5', Date.parse('2026-10-17T01:30Z')), all);
  // 8月1日凌晨延迟执行7月31日（普通交易日）13:13 槽位
  assert.deepEqual(scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2026-08-01T05:00Z')), []);
  // 10月不在 7,11,12 月范围内，回溯8天内无匹配月份应抛出异常
  assert.throws(() => scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2026-10-16T20:13Z')), /无法确定计划更新时间/);

  for (const invalid of ['invalid', '1 4 * * 6-2', '60 16 * * 1-5', '13 16 * 13 1-5', '13 15 * * 1-5']) {
    assert.throws(() => scheduledPlan(invalid), /未知数据更新时间/);
  }
});

test('国内ETF槽位在美股新鲜时仅更新基金，延迟跨过收盘或存在过期来源时自动catchUp补抓', () => {
  const freshNov2 = { results: all.map(symbol => ({ symbol, ok: true, date: '2026-11-02' })) };
  for (const cron of FUND_SCHEDULES) {
    assert.deepEqual(scheduledPlan(cron, Date.parse('2026-11-02T23:00Z'), { status: freshNov2 }), {
      sources: [],
      funds: true
    });
    assert.deepEqual(scheduledPlan(cron, Date.parse('2026-11-02T23:00Z'), { status: freshNov2, catchUp: true }), {
      sources: [],
      funds: true
    });
  }

  // 复现 #398 场景：21:23 北京（原 21:01）槽位延迟至美东 11-24 17:55（22:55Z）执行，此时 11-24 美股已收盘而 status 仍停在 11-23
  const nov23Status = {
    results: all.map(symbol => ({
      symbol,
      ok: true,
      date: symbol === 'Fear & Greed' ? '2026-11-24' : '2026-11-23'
    }))
  };
  assert.deepEqual(
    scheduledPlan('23 21 * * 1-6', Date.parse('2026-11-24T22:55Z'), { status: nov23Status, catchUp: true }),
    { sources: ['SPY', 'QQQ', 'VGT', 'SMH', 'BRK-B'], funds: true }
  );

  // 仅部分美股过期或失败时，仅补抓有问题来源
  assert.deepEqual(
    scheduledPlan('11 9 * * 2-6', Date.parse('2026-11-25T01:11Z'), {
      status: {
        results: all.map(symbol => symbol === 'QQQ'
          ? { symbol, ok: false, date: '2026-11-24' }
          : symbol === 'SPY'
            ? { symbol, ok: true, fresh: false, missingDates: ['2026-11-23'], date: '2026-11-24' }
            : { symbol, ok: true, date: '2026-11-24' })
      },
      catchUp: true
    }),
    { sources: ['SPY', 'QQQ'], funds: true }
  );
});

test('catchUp 模式仅补抓缺失、失败或日期滞后的来源，全部新鲜时不重复抓取', () => {
  const freshStatus = {
    results: all.map(symbol => ({ symbol, ok: true, date: '2026-11-02' }))
  };
  assert.deepEqual(
    scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2026-11-02T21:15Z'), { status: freshStatus, catchUp: true }),
    []
  );
  const staleStatus = {
    results: all.map(symbol => ({
      symbol,
      ok: true,
      date: symbol === 'Fear & Greed' ? '2026-11-02' : '2026-10-30'
    }))
  };
  assert.deepEqual(
    scheduledSources('17 10 * * 1-5', Date.parse('2026-11-02T21:15Z'), { status: staleStatus, catchUp: true }),
    all
  );
  assert.deepEqual(
    scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2026-11-02T21:15Z'), {
      status: {
        results: all.map(symbol => ({
          symbol,
          ok: symbol !== 'QQQ',
          date: '2026-11-02'
        }))
      },
      catchUp: true
    }),
    ['QQQ']
  );
  assert.deepEqual(
    scheduledSources('13 13 * 7,11,12 1-5', Date.parse('2026-11-02T21:15Z'), {
      status: {
        results: all.map(symbol => symbol === 'SPY'
          ? { symbol, ok: true, fresh: false, missingDates: ['2026-10-30'], date: '2026-11-02' }
          : { symbol, ok: true, date: '2026-11-02' })
      },
      catchUp: true
    }),
    ['SPY']
  );
});
