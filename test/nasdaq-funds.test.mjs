import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NASDAQ_FUNDS, normalizeFundQuotes, premiumRate, sortFunds } from '../public/js/domain/nasdaq-funds.mjs';
import { FUND_QUOTES_URL, TENCENT_QUOTES_URL, parseFundProfile, parseTencentQuotes } from '../server/nasdaq-funds.mjs';
import { refreshFunds } from '../server/updater.mjs';

const now = Date.parse('2026-10-26T08:00:00Z');
const payload = () => ({ rc: 0, data: { diff: NASDAQ_FUNDS.map(({ code }) => ({
  f12: code, f2: 1.661, f441: 1.4495, f3: -0.42, f6: 900000000,
  f38: 200000000, f124: Date.parse('2026-10-26T07:00:00Z') / 1000
})) } });
const profile = '<th>净资产规模</th><td>346.82亿元（截止至：2026年06月30日）' +
  '<th>管理费率</th><td>0.80%（每年）</td><th>托管费率</th><td>0.20%（每年）</td>';
function tencent() {
  return NASDAQ_FUNDS.map(({ code }) => {
    const fields = Array(88).fill('');
    for (const [index, value] of Object.entries({ 2: code, 3: '1.661', 30: '20261026150000',
      32: '-0.42', 57: '92924.9249', 72: '22954410164', 77: '14.59', 78: '1.4495', 82: 'CNY' })) fields[index] = value;
    return `v_${code.startsWith('5') ? 'sh' : 'sz'}${code}="${fields.join('~')}";`;
  }).join('\n');
}

test('腾讯备用源校验溢价口径、人民币、完整名单和成交额单位', () => {
  const rows = parseTencentQuotes(tencent(), now);
  assert.equal(rows[0].price, 1.661);
  assert.equal(rows[0].iopv, 1.4495);
  assert.equal(rows[0].amount, 929249249);
  assert.equal(rows[0].quoteDate, '2026-10-26');
  assert.throws(() => parseTencentQuotes(tencent().replace('~14.59~', '~1.59~'), now));
  assert.throws(() => parseTencentQuotes(tencent().replace('~CNY~', '~USD~'), now));
  assert.throws(() => parseTencentQuotes(tencent().split('\n').slice(1).join('\n'), now));
});

test('溢价以价格和IOPV计算，缺失/零净值不产生虚假溢价；全部12只校验', () => {
  assert.equal(NASDAQ_FUNDS.length, 12);
  const rows = normalizeFundQuotes(payload(), now);
  assert.equal(rows[0].premium.toFixed(2), '14.59');
  assert.equal(rows[0].quoteDate, '2026-10-26');
  for (const value of [0, null, '', '-', undefined]) {
    const p = payload(); p.data.diff[0].f441 = value;
    assert.equal(normalizeFundQuotes(p, now)[0].premium, null);
  }
  assert.equal(premiumRate(1, 0), null);
  const p = payload(); p.data.diff[0].f2 = null;
  assert.throws(() => normalizeFundQuotes(p, now));
  p.data.diff.shift(); assert.throws(() => normalizeFundQuotes(p, now));
  const dup = payload(); dup.data.diff.push(dup.data.diff[0]);
  assert.throws(() => normalizeFundQuotes(dup, now));
  assert.throws(() => normalizeFundQuotes(payload(), now - 86400000));
  assert.throws(() => normalizeFundQuotes(payload(), now + 16 * 86400000));
});

test('净资产来自披露规模，不用市价乘份额；缺失费率不被转换为零', () => {
  assert.deepEqual(parseFundProfile(profile), { netAssets: 34682000000, scaleDate: '2026-06-30', annualFee: 1 });
  assert.deepEqual(parseFundProfile('接口繁忙'), { netAssets: null, scaleDate: null, annualFee: null });
});

test('排序折价在前，未知数据无论方向都排最后，不修改快照顺序', () => {
  const rows = [{ code: 'a', premium: null }, { code: 'b', premium: 10 }, { code: 'c', premium: -2 }];
  assert.deepEqual(sortFunds(rows).map(r => r.code), ['c', 'b', 'a']);
  assert.deepEqual(sortFunds(rows, 'premium', 'desc').map(r => r.code), ['b', 'c', 'a']);
  assert.equal(rows[0].code, 'a');
});

test('双排序仅在第一条件相同时比较第二条件，分别支持升降序与缺失值', () => {
  const rows = [
    { code: 'a', annualFee: 0.6, netAssets: 100 },
    { code: 'b', annualFee: 0.6, netAssets: 20 },
    { code: 'c', annualFee: 1, netAssets: 1000 },
    { code: 'd', annualFee: null, netAssets: 30 },
    { code: 'e', annualFee: null, netAssets: 200 },
    { code: 'f', annualFee: 0.6, netAssets: null }
  ];
  const codes = (direction, secondary) => sortFunds(rows, 'annualFee', direction, secondary).map(r => r.code);
  assert.deepEqual(codes('asc', { key: 'netAssets', direction: 'desc' }), ['a', 'b', 'f', 'c', 'e', 'd']);
  assert.deepEqual(codes('asc', { key: 'netAssets', direction: 'asc' }), ['b', 'a', 'f', 'c', 'd', 'e']);
  assert.deepEqual(codes('desc', { key: 'netAssets', direction: 'desc' }), ['c', 'a', 'b', 'f', 'e', 'd']);
  assert.deepEqual(codes('asc', { key: 'annualFee', direction: 'desc' }), ['a', 'b', 'f', 'c', 'd', 'e']);
});

test('表头支持成交额、净值和日期排序，第二条件可用于同日行情', () => {
  const rows = [{ code: 'b', quoteDate: '2026-10-26', amount: 100, iopv: 2 },
    { code: 'a', quoteDate: '2026-10-26', amount: 20, iopv: 3 },
    { code: 'c', quoteDate: '2026-10-23', amount: null, iopv: null }];
  assert.deepEqual(sortFunds(rows, 'quoteDate', 'desc', { key: 'amount', direction: 'asc' }).map(r => r.code), ['a', 'b', 'c']);
  assert.deepEqual(sortFunds(rows, 'iopv', 'desc').map(r => r.code), ['a', 'b', 'c']);
  assert.deepEqual(sortFunds(rows, 'code', 'asc').map(r => r.code), ['a', 'b', 'c']);
});

test('更新在锁内原子保存；网络/缺失/日期倒退保留旧行情并记录失败', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dca-funds-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const options = { dataDir: dir, now,
    fetchText: async url => url === FUND_QUOTES_URL ? JSON.stringify(payload()) : profile };
  const first = await refreshFunds(options);
  assert.equal(first.ok, true);
  assert.equal(first.rows.length, 12);
  assert.equal(first.rows[0].netAssets, 34682000000);
  let failed = await refreshFunds({ ...options, now: now + 1000, fetchText: async () => { throw Error('private URL'); } });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.rows, first.rows);
  assert.equal(failed.checkedAt, first.checkedAt);
  assert.doesNotMatch(JSON.stringify(failed), /private URL/);
  const old = payload(); old.data.diff.forEach(r => { r.f124 -= 86400; });
  failed = await refreshFunds({ ...options, fetchText: async () => JSON.stringify(old) });
  assert.equal(failed.ok, false);
  assert.deepEqual(failed.rows, first.rows);
  // Missing profile data retains independently dated disclosures, but current quotes can update.
  const recovered = await refreshFunds({ ...options, fetchText: async url => {
    if (url === FUND_QUOTES_URL) return JSON.stringify(payload());
    throw Error('profile unavailable');
  } });
  assert.equal(recovered.ok, true);
  assert.equal(recovered.rows[0].netAssets, first.rows[0].netAssets);
  assert.equal(recovered.error, undefined);
  const { groups, complete, ...saved } = recovered;
  assert.equal(groups.length, 2);
  assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'nasdaq100-etfs.json'), 'utf8')), saved);
  await writeFile(path.join(dir, '.refresh.lock'), 'busy');
  await assert.rejects(refreshFunds(options), { code: 'ELOCKED' });
});

test('东方财富不可用时使用腾讯，真实来源写入快照', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dca-funds-backup-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const result = await refreshFunds({ dataDir: dir, now, fetchText: async url => {
    if (url === FUND_QUOTES_URL) throw Error('network unavailable');
    return url === TENCENT_QUOTES_URL ? tencent() : profile;
  } });
  assert.equal(result.ok, true);
  assert.equal(result.quoteSource, '腾讯财经');
  assert.equal(result.rows[0].netAssets, 34682000000);
});
