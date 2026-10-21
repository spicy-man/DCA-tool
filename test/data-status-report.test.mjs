import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

test('Actions 汇总区分部署、本轮与整体，数据未齐或更新异常均退出失败', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dca-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['scripts/report-data-status.mjs', 'public/js/domain/data-health.mjs', 'public/js/domain/trading-calendar.mjs']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await copyFile(new URL('../' + file, import.meta.url), path.join(root, file));
  }
  await mkdir(path.join(root, 'public/data'), { recursive: true });
  const status = { checkedAt: '2026-10-20T23:35:37Z', expectedDate: '2026-10-20',
    requestedSources: ['SPY', 'QQQ', 'VGT'], requestedComplete: true, complete: false,
    results: ['Fear & Greed', 'SPY', 'QQQ', 'VGT'].map(symbol => ({ symbol, ok: true,
      date: symbol === 'Fear & Greed' ? '2026-10-19' : '2026-10-20', checkedAt: '2026-10-20T23:35:37Z' })) };
  const summary = path.join(root, 'summary.md');
  const run = outcome => spawnSync(process.execPath, [path.join(root, 'scripts/report-data-status.mjs')], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, DEPLOY_OUTCOME: 'success', UPDATE_OUTCOME: outcome, GITHUB_STEP_SUMMARY: summary }
  });
  const save = () => writeFile(path.join(root, 'public/data/status.json'), JSON.stringify(status));
  await save();
  let result = run('failure');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Pages 部署步骤：success/);
  assert.ok(result.stdout.startsWith('## 数据更新与部署'+String.fromCharCode(10,10)+'数据更新步骤：failure'));
  assert.ok(!result.stdout.includes(String.fromCharCode(92,110)));
  assert.match(result.stdout, /本轮所选来源：成功且日期到齐/);
  assert.match(result.stdout, /整体数据：未全部到齐/);
  assert.equal((await readFile(summary, 'utf8')).trimEnd(), result.stdout.trimEnd());
  status.results[0].date = '2026-10-20';status.complete = true;await save();
  result = run('success');assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /整体数据：已到齐/);
  result = run('failure');assert.equal(result.status, 1);
  assert.match(result.stdout, /数据更新步骤：failure/);
});
