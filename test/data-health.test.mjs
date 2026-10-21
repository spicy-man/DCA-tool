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
 const text=healthSummary(s,now);const line=text.split('\n')[1];
 assert.match(line,/SPY \/ VGT \/ SMH：2026-10-20/);
 assert.match(line,/QQQ：2026-10-19（最近更新失败；Yahoo Finance；更新失败）；检查：2026-10-20 18:00:00 EDT/);
 assert.match(text,/整体数据：未全部到齐/);
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
});
