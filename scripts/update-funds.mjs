import { refreshFunds } from '../server/updater.mjs';

try {
  const group = process.argv.find(arg => arg.startsWith('--group='))?.slice('--group='.length);
  const snapshot = await refreshFunds(group ? { group } : {});
  console.log(JSON.stringify({ ok: snapshot.ok, checkedAt: snapshot.checkedAt,
    count: snapshot.rows.length, performanceDate: snapshot.performance?.endDate,
    performanceComplete: snapshot.performance?.complete, groups: snapshot.groups,
    error: snapshot.error || snapshot.performance?.error }));
  if (!snapshot.complete) process.exitCode = 1;
} catch {
  console.error('基金快照更新失败，请检查数据源连接或更新锁。');
  process.exitCode = 1;
}
