import test from 'node:test';
import assert from 'node:assert/strict';
import { healthSummary, formatNewYorkTime } from '../public/js/domain/data-health.mjs';

const now = Date.parse('2026-10-21T00:01:50Z');
const status = () => ({ results: ['Fear & Greed', 'SPY', 'QQQ', 'VGT', 'SMH', 'BRK-B'].map(symbol => ({
  symbol, date: '2026-10-20', ok: true, expectedDate: '2026-10-20',
  source: symbol === 'Fear & Greed' ? 'CNN' : 'Yahoo Finance',
  checkedAt: symbol === 'Fear & Greed' ? '2026-10-21T00:01:50Z' : '2026-10-20T23:56:18Z'
})) });

test('同状态ticker按纽约真实检查时间合并展示，跨批与夏冬时切换顺序正确', () => {
 const text=healthSummary(status(),now);
 assert.equal(text.split('\n').length,3);
 assert.match(text,/恐慌与贪婪指数：2026-10-20.*2026-10-20 20:01:50 EDT/);
 assert.match(text,/SPY \/ QQQ \/ VGT \/ SMH \/ BRK-B：2026-10-20.*2026-10-20 19:56:18 EDT/);
 assert.match(text,/整体数据：已到齐/);
 assert.doesNotMatch(text,/北京时间/);

 const crossBatch=status();crossBatch.results[4].checkedAt='2026-10-21T05:06:27Z';
 const batchText=healthSummary(crossBatch,Date.parse('2026-10-21T05:06:27Z'));
 assert.equal(batchText.split('\n').length,3);
 assert.match(batchText,/19:56:18 EDT ～ 2026-10-21 01:06:27 EDT/);
 assert.match(batchText,/整体数据：已到齐/);

 const dst=status();
 for(const r of dst.results)r.date='2026-10-30';
 dst.results[1].checkedAt='2026-11-01T06:01:00Z';
 for(const r of dst.results.slice(2))r.checkedAt='2026-11-01T05:59:00Z';
 assert.match(healthSummary(dst,Date.parse('2026-11-01T07:00Z')),/01:59:00 EDT ～ 2026-11-01 01:01:00 EST/);
});

test('异常、缺失来源、个人标的状态与跨日旧manifest不合并隐藏', () => {
 for(const change of [
  {ok:false,error:'更新失败'}, {date:'2026-10-19'}, {warning:'价格缺失'},
  {checkedAt:null}, {checkedAt:'invalid'}
 ]) {
  const s=status();Object.assign(s.results[4],change);
  const lines=healthSummary(s,now).split('\n');
  assert.equal(lines.length,4);
  assert.match(lines[1],/^SPY \/ QQQ \/ VGT \/ BRK-B：/);
  assert.match(lines[2],/^SMH：/);
 }
 const lag=status();lag.results[2]={...lag.results[2],date:'2026-10-19',ok:false,error:'更新失败',checkedAt:'2026-10-20T22:00:00Z'};
 const lagText=healthSummary(lag,now);
 assert.match(lagText,/QQQ：2026-10-19.*更新失败.*18:00:00 EDT/);
 assert.match(lagText,/整体数据：未全部到齐/);

 const custom=status();custom.results.push({...custom.results[1],symbol:'AAPL'});
 assert.match(healthSummary(custom,now),/整体数据：已到齐/);
 custom.results.at(-1).date='2026-10-19';
 assert.match(healthSummary(custom,now),/整体数据：未全部到齐/);
 custom.results.at(-1).date='2026-10-20';
 custom.results=custom.results.filter(r=>r.symbol!=='SMH');
 assert.match(healthSummary(custom,now),/整体数据：未全部到齐/);
 assert.match(healthSummary(custom,now),/SMH：无数据.*尚无检查记录/);

 const staleManifest={checkedAt:'2025-01-06T22:00:00Z',results:[{symbol:'SPY',date:'2025-01-06',ok:true,fresh:true}]};
 assert.match(healthSummary(staleManifest,Date.parse('2025-01-07T23:00Z')),/等待更新/);
});

test('纽约夏冬时及切换边界自动标明EDT或EST，UTC日期不会冒充本地日期', () => {
 assert.equal(formatNewYorkTime('2026-01-07T01:00:00Z'),'2026-01-06 20:00:00 EST');
 assert.equal(formatNewYorkTime('2026-11-01T05:59:59Z'),'2026-11-01 01:59:59 EDT');
 assert.equal(formatNewYorkTime('2026-11-01T06:00:00Z'),'2026-11-01 01:00:00 EST');
 assert.equal(formatNewYorkTime(null),'尚未检查');
 assert.equal(formatNewYorkTime('invalid'),'尚未检查');
});

test('本地已达应有日期但批量刷新失败时：同错合并、去重保留文案且按检查时间拆分', () => {
 const s=status();
 for(const r of s.results.slice(1)){
  Object.assign(r,{
   ok:false,
   error:'Yahoo Finance 数据校验失败：上游缺失已有历史日期，已保留原数据；已保留上次有效数据'
  });
 }
 const text=healthSummary(s,now);const lines=text.split('\n');
 assert.equal(lines.length,3);
 assert.match(lines[1],/^SPY \/ QQQ \/ VGT \/ SMH \/ BRK-B：2026-10-20（最近更新失败；Yahoo Finance 数据校验失败：上游缺失已有历史日期，已保留上次有效数据）/);
 assert.match(lines[2],/整体数据：已到齐（最近更新失败，继续使用已保存数据）；应有数据截至 2026-10-20/);
 s.results[4].checkedAt='2026-10-20T23:59:00Z';
 assert.equal(healthSummary(s,now).split('\n').length,4);
});
