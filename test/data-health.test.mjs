import test from 'node:test';
import assert from 'node:assert/strict';
import { healthSummary, formatNewYorkTime } from '../public/js/domain/data-health.mjs';

const now = Date.parse('2026-10-21T00:01:50Z');
const status = () => ({ results: ['Fear & Greed', 'SPY', 'QQQ', 'VGT', 'SMH'].map(symbol => ({
  symbol, date: '2026-10-20', ok: true, expectedDate: '2026-10-20',
  source: symbol === 'Fear & Greed' ? 'CNN' : 'Yahoo Finance',
  checkedAt: symbol === 'Fear & Greed' ? '2026-10-21T00:01:50Z' : '2026-10-20T23:56:18Z'
})) });

test('同状态ticker合并为一行，与指数保留不同纽约检查时间', () => {
 const text=healthSummary(status(),now);const lines=text.split('\n');
 assert.equal(lines.length,3);
 assert.equal(lines[0],'恐慌与贪婪指数：2026-10-20；检查：2026-10-20 20:01:50 EDT。');
 assert.equal(lines[1],'SPY / QQQ / VGT / SMH：2026-10-20；检查：2026-10-20 19:56:18 EDT。');
 assert.match(lines[2],/整体数据：已到齐/);
 assert.doesNotMatch(text,/北京时间/);
 assert.doesNotMatch(lines[0],/（/);
 assert.doesNotMatch(lines[1],/（/);
});

test('合并ticker时不隐藏单个滞后或失败，也不冒用其他ticker的检查时间', () => {
 const s=status();s.results[2]={...s.results[2],date:'2026-10-19',ok:false,error:'更新失败',checkedAt:'2026-10-20T22:00:00Z'};
 const text=healthSummary(s,now);const lines=text.split('\n');
 assert.match(lines[1],/SPY \/ VGT \/ SMH：2026-10-20/);
 assert.match(lines[2],/QQQ：2026-10-19（最近更新失败；Yahoo Finance；更新失败）；检查：2026-10-20 18:00:00 EDT/);
 assert.match(text,/整体数据：未全部到齐/);
});

test('同日正常行情跨批次检查仍合并，显示纽约跨日时间范围', () => {
 const s=status();s.results[4].checkedAt='2026-10-21T05:06:27Z';
 const lines=healthSummary(s,Date.parse('2026-10-21T05:06:27Z')).split('\n');
 assert.equal(lines.length,3);
 assert.equal(lines[1],'SPY / QQQ / VGT / SMH：2026-10-20；检查：2026-10-20 19:56:18 EDT ～ 2026-10-21 01:06:27 EDT。');
 assert.match(lines[2],/整体数据：已到齐/);
});

test('检查范围按真实时刻排序，夏冬时回拨不按本地文字排序', () => {
 const s=status();
 for(const r of s.results)r.date='2026-10-30';
 s.results[1].checkedAt='2026-11-01T06:01:00Z';
 for(const r of s.results.slice(2))r.checkedAt='2026-11-01T05:59:00Z';
 assert.match(healthSummary(s,Date.parse('2026-11-01T07:00Z')),/SPY \/ QQQ \/ VGT \/ SMH：2026-10-30；检查：2026-11-01 01:59:00 EDT ～ 2026-11-01 01:01:00 EST/);
});

test('失败、滞后、警告和未知检查时间保持独立，不合并隐藏异常', () => {
 for(const change of [
  {ok:false,error:'更新失败'}, {date:'2026-10-19'}, {warning:'价格缺失'},
  {checkedAt:null}, {checkedAt:'invalid'}
 ]) {
  const s=status();Object.assign(s.results[4],change);
  const lines=healthSummary(s,now).split('\n');
  assert.match(lines[1],/^SPY \/ QQQ \/ VGT：/);
  assert.match(lines[2],/^SMH：/);
  assert.equal(lines.length,4);
 }
});

test('纽约夏冬时及切换边界自动标明EDT或EST，UTC日期不会冒充本地日期', () => {
 assert.equal(formatNewYorkTime('2026-01-07T01:00:00Z'),'2026-01-06 20:00:00 EST');
 assert.equal(formatNewYorkTime('2026-11-01T05:59:59Z'),'2026-11-01 01:59:59 EDT');
 assert.equal(formatNewYorkTime('2026-11-01T06:00:00Z'),'2026-11-01 01:00:00 EST');
 assert.equal(formatNewYorkTime(null),'尚未检查');
 assert.equal(formatNewYorkTime('invalid'),'尚未检查');
});

test('完整状态覆盖全部默认来源并检查每个个人标的，不依赖固定数量', () => {
 const s=status();
 s.results.push({...s.results[1],symbol:'AAPL'});
 assert.match(healthSummary(s,now),/整体数据：已到齐/);
 s.results.at(-1).date='2026-10-19';
 assert.match(healthSummary(s,now),/整体数据：未全部到齐/);
 s.results.at(-1).date='2026-10-20';
 s.results=s.results.filter(r=>r.symbol!=='SMH');
 assert.match(healthSummary(s,now),/整体数据：未全部到齐/);
 assert.match(healthSummary(s,now),/SMH：无数据.*尚无检查记录，请更新数据/);
});

test('本地数据已达应有日期但同批刷新失败时：合并同错标的、去除重复来源与保留文案，并区分已到齐状态', () => {
 const s=status();
 for(const r of s.results.slice(1)){
  Object.assign(r,{
   ok:false,
   error:'Yahoo Finance 数据校验失败：上游缺失已有历史日期，已保留原数据；已保留上次有效数据'
  });
 }
 const text=healthSummary(s,now);const lines=text.split('\n');
 assert.equal(lines.length,3);
 assert.equal(
  lines[1],
  'SPY / QQQ / VGT / SMH：2026-10-20（最近更新失败；Yahoo Finance 数据校验失败：上游缺失已有历史日期，已保留上次有效数据）；检查：2026-10-20 19:56:18 EDT。'
 );
 assert.match(lines[2],/整体数据：已到齐（最近更新失败，继续使用已保存数据）；应有数据截至 2026-10-20/);
 s.results[4].checkedAt='2026-10-20T23:59:00Z';
 assert.equal(healthSummary(s,now).split('\n').length,4);
});
