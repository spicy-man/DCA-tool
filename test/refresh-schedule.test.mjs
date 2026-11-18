import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledSources } from '../server/refresh-schedule.mjs';

const all = ['Fear & Greed', 'SPY', 'QQQ', 'VGT', 'SMH', 'BRK-B'];
const slot = (hour, weekday = '*') => `1 ${hour} * * ${weekday}`;

test('正常收盘夏冬时均抓两轮K线；FNG工作日每六小时更新且周六晨保留兜底', () => {
  for (const [date, close] of [['2026-10-16', 20], ['2026-11-02', 21]]) {
    const at = (hour, minute = '01') => Date.parse(`${date}T${hour}:${minute}:00Z`);
    assert.deepEqual(scheduledSources(slot(16, '1-5'), at(close)), all);
    assert.deepEqual(scheduledSources(slot(17, '1-5'), at(close + 1)), all);
    assert.deepEqual(scheduledSources(slot(13, '1-5'), at(close - 3)), []);
    assert.deepEqual(scheduledSources(slot(14, '1-5'), at(close - 2)), []);
    assert.deepEqual(scheduledSources(slot(4, '2-6'), at(close)), ['Fear & Greed']);
    for (const hour of [10, 22]) {
      assert.deepEqual(scheduledSources(slot(hour, '1-5'), at(close)), ['Fear & Greed']);
    }
  }
  assert.deepEqual(scheduledSources(slot(4, '2-6'), Date.parse('2026-10-17T08:05Z')), ['Fear & Greed']);
});

test('提前收盘仅13:01和14:01抓K线，工作日节假日仍检查FNG并保留周六晨兜底', () => {
  assert.deepEqual(scheduledSources(slot(13, '1-5'), Date.parse('2026-11-27T18:01Z')), all);
  assert.deepEqual(scheduledSources(slot(14, '1-5'), Date.parse('2026-11-27T19:01Z')), all);
  assert.deepEqual(scheduledSources(slot(16, '1-5'), Date.parse('2026-11-27T21:01Z')), ['Fear & Greed']);
  assert.deepEqual(scheduledSources(slot(17, '1-5'), Date.parse('2026-11-27T22:01Z')), []);
  assert.deepEqual(scheduledSources(slot(16, '1-5'), Date.parse('2026-12-25T22:01Z')), ['Fear & Greed']);
  // 周六晨 04:01 NY 对应周五收盘兜底；周日夜间回溯至周六凌晨而非周日
  assert.deepEqual(scheduledSources(slot(4, '2-6'), Date.parse('2026-10-19T03:30Z')), ['Fear & Greed']);
});

test('任务延迟跨小时仍按触发的计划选择来源，未知调度或非法星期范围拒绝执行', () => {
  assert.deepEqual(scheduledSources(slot(17, '1-5'), Date.parse('2026-10-17T01:30Z')), all);
  assert.deepEqual(scheduledSources(slot(16, '1-5'), Date.parse('2026-10-17T01:30Z')), all);
  assert.throws(() => scheduledSources('invalid'));
  assert.throws(() => scheduledSources('1 4 * * 6-2'));
});

test('catchUp 模式仅补抓缺失、失败或日期滞后的来源，全部新鲜时不重复抓取', () => {
  const freshStatus = {
    results: all.map(symbol => ({ symbol, ok: true, date: '2026-11-02' }))
  };
  assert.deepEqual(
    scheduledSources(slot(13, '1-5'), Date.parse('2026-11-02T21:15Z'), { status: freshStatus, catchUp: true }),
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
    scheduledSources(slot(10), Date.parse('2026-11-02T21:15Z'), { status: staleStatus, catchUp: true }),
    all
  );
  assert.deepEqual(
    scheduledSources(slot(13, '1-5'), Date.parse('2026-11-02T21:15Z'), {
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
    scheduledSources(slot(13, '1-5'), Date.parse('2026-11-02T21:15Z'), {
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
