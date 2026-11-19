import { refreshFunds } from '../server/updater.mjs';

try {
  const group = process.argv.find(arg => arg.startsWith('--group='))?.slice('--group='.length);
  const snapshot = await refreshFunds(group ? { group } : {});
  const ok = snapshot.groups ? snapshot.groups.every(g => g.ok !== false) : snapshot.ok;
  const performanceComplete = snapshot.groups
    ? snapshot.groups.every(g => g.performanceOk !== false && g.performanceComplete !== false)
    : snapshot.performance?.complete;
  const error = snapshot.groups
    ? snapshot.groups.map(g => g.error).filter(Boolean).join('；') || undefined
    : (snapshot.error || snapshot.performance?.error);
  console.log(JSON.stringify({ ok, checkedAt: snapshot.checkedAt,
    count: snapshot.groups ? snapshot.groups.reduce((sum, g) => sum + g.count, 0) : snapshot.rows.length,
    performanceDate: snapshot.performance?.endDate,
    performanceComplete,
    groups: snapshot.groups,
    error }));
  if (!snapshot.complete) process.exitCode = 1;
} catch (error) {
  console.error('基金快照更新失败，请检查数据源连接或更新锁。', error?.publicMessage || error?.message || error);
  process.exitCode = 1;
}
