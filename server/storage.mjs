import { readFile, writeFile, rename, unlink, mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function readOptional(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readJsonOptional(file) {
  const text = await readOptional(file);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function atomicWrite(file, text) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, text, { flag: 'wx' });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

export function preserveHistory(previous, next) {
  const dates = new Set(next.map(r => r.date));
  if (previous.some(r => !dates.has(r.date))) {
    throw Error('上游缺失已有历史日期，已保留原数据');
  }
}

const DEFAULT_STALE_LOCK_MS = 10 * 60 * 1000;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function isStaleLock(file, { now, staleMs }) {
  let stats;
  let text;
  try {
    stats = await stat(file);
    text = await readFile(file, 'utf8');
  } catch (error) {
    return error.code === 'ENOENT';
  }
  try {
    const meta = JSON.parse(text);
    if (meta && Number.isInteger(meta.pid)) {
      if (!isProcessAlive(meta.pid)) return true;
      const startedAt = Date.parse(meta.startedAt);
      return Number.isFinite(startedAt) && now - startedAt > staleMs;
    }
  } catch {
    // Non-JSON or empty lock file (e.g. concurrent open before write or test sentinel)
  }
  return now - stats.mtimeMs > staleMs;
}

export async function withDataLock(dataDir, task, { staleMs = DEFAULT_STALE_LOCK_MS, now = Date.now() } = {}) {
  await mkdir(dataDir, { recursive: true });
  const file = path.join(dataDir, '.refresh.lock');
  let handle;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      handle = await open(file, 'wx');
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (attempt === 0 && await isStaleLock(file, { now, staleMs })) {
        await unlink(file).catch(err => {
          if (err.code !== 'ENOENT') throw err;
        });
        continue;
      }
      const lockError = Error('已有数据更新任务运行；若上次进程异常退出，请确认无任务运行后移除 .refresh.lock');
      lockError.code = 'ELOCKED';
      throw lockError;
    }
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await task();
  } finally {
    await handle.close().catch(() => {});
    await unlink(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
