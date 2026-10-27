import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledSources } from '../server/refresh-schedule.mjs';

const all = ['Fear & Greed', 'SPY', 'QQQ', 'VGT', 'SMH'];
const slot = (hour, weekday = '*') => `1 ${hour} * * ${weekday}`;

test('正常收盘夏冬时均抓两轮K线；FNG按纽约时间每六小时独立更新', () => {
  for (const [date, close] of [['2026-10-16', 20], ['2026-11-02', 21]]) {
    const at = (hour, minute = '01') => Date.parse(`${date}T${hour}:${minute}:00Z`);
    assert.deepEqual(scheduledSources(slot(16), at(close)), all);
    assert.deepEqual(scheduledSources(slot(17, '1-5'), at(close + 1)), all);
    assert.deepEqual(scheduledSources(slot(13, '1-5'), at(close - 3)), []);
    assert.deepEqual(scheduledSources(slot(14, '1-5'), at(close - 2)), []);
    for (const hour of [4, 10, 22]) {
      assert.deepEqual(scheduledSources(slot(hour), at(close)), ['Fear & Greed']);
    }
  }
});

test('提前收盘仅13:01和14:01抓K线，节假日及周末仍更新FNG', () => {
  assert.deepEqual(scheduledSources(slot(13, '1-5'), Date.parse('2026-11-27T18:01Z')), all);
  assert.deepEqual(scheduledSources(slot(14, '1-5'), Date.parse('2026-11-27T19:01Z')), all);
  assert.deepEqual(scheduledSources(slot(16), Date.parse('2026-11-27T21:01Z')), ['Fear & Greed']);
  assert.deepEqual(scheduledSources(slot(17, '1-5'), Date.parse('2026-11-27T22:01Z')), []);
  for (const date of ['2026-12-25', '2026-10-17']) {
    assert.deepEqual(scheduledSources(slot(16), Date.parse(date + 'T22:01Z')), ['Fear & Greed']);
  }
});

test('任务延迟跨小时仍按触发的计划选择来源，未知调度拒绝执行', () => {
  assert.deepEqual(scheduledSources(slot(17, '1-5'), Date.parse('2026-10-17T01:30Z')), all);
  assert.deepEqual(scheduledSources(slot(16), Date.parse('2026-10-17T01:30Z')), all);
  assert.throws(() => scheduledSources('invalid'));
});
