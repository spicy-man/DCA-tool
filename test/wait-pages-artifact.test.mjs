import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPagesArtifact } from '../scripts/wait-pages-artifact.mjs';

test('waitForPagesArtifact 首次命中直接返回，未就绪时按退避等待并重试成功', async () => {
  const waits = [];
  const sleep = async ms => waits.push(ms);

  // 1. 首次即命中
  const immediate = await waitForPagesArtifact({
    repo: 'owner/repo',
    runId: '123',
    artifactName: 'github-pages-123-1',
    token: 'tok',
    sleep,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        artifacts: [{ id: 101, name: 'github-pages-123-1', expired: false }]
      })
    })
  });
  assert.equal(immediate.found, true);
  assert.equal(immediate.attempts, 1);
  assert.equal(immediate.artifact.id, 101);
  assert.deepEqual(waits, []);

  // 2. 前两次返回 0 条（或仅过期条目），第 3 次命中
  let calls = 0;
  const delayed = await waitForPagesArtifact({
    repo: 'owner/repo',
    runId: '456',
    artifactName: 'github-pages-456-1',
    token: 'tok',
    delaysMs: [100, 200, 300],
    sleep,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        return { ok: true, status: 200, json: async () => ({ artifacts: [] }) };
      }
      if (calls === 2) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ artifacts: [{ id: 201, name: 'github-pages-456-1', expired: true }] })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ artifacts: [{ id: 202, name: 'github-pages-456-1', expired: false }] })
      };
    }
  });
  assert.equal(delayed.found, true);
  assert.equal(delayed.attempts, 3);
  assert.equal(delayed.artifact.id, 202);
  assert.deepEqual(waits, [100, 200]);
});

test('waitForPagesArtifact 从 502/网络异常恢复，403 快速失败，超时抛出明确错误', async () => {
  const waits = [];
  const sleep = async ms => waits.push(ms);

  // 1. 502 与网络异常退避恢复
  let calls = 0;
  const recovered = await waitForPagesArtifact({
    repo: 'owner/repo',
    runId: '789',
    artifactName: 'github-pages-789-1',
    token: 'tok',
    delaysMs: [50, 100, 200],
    sleep,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return { ok: false, status: 502, json: async () => ({}) };
      if (calls === 2) throw Error('socket hang up');
      return {
        ok: true,
        status: 200,
        json: async () => ({ artifacts: [{ id: 301, name: 'github-pages-789-1', expired: false }] })
      };
    }
  });
  assert.equal(recovered.attempts, 3);
  assert.deepEqual(waits, [50, 100]);

  // 2. 403 快速失败不等待
  let forbiddenCalls = 0;
  const forbiddenWaits = [];
  await assert.rejects(
    () => waitForPagesArtifact({
      repo: 'owner/repo',
      runId: '789',
      artifactName: 'github-pages-789-1',
      token: 'tok',
      delaysMs: [50, 100],
      sleep: async ms => forbiddenWaits.push(ms),
      fetchImpl: async () => {
        forbiddenCalls++;
        return { ok: false, status: 403, json: async () => ({}) };
      }
    }),
    /HTTP 403/
  );
  assert.equal(forbiddenCalls, 1);
  assert.deepEqual(forbiddenWaits, []);

  // 3. 重试耗尽报错
  const exhaustedWaits = [];
  await assert.rejects(
    () => waitForPagesArtifact({
      repo: 'owner/repo',
      runId: '789',
      artifactName: 'github-pages-789-1',
      token: 'tok',
      delaysMs: [10, 20],
      sleep: async ms => exhaustedWaits.push(ms),
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ artifacts: [] }) })
    }),
    /等待 Pages artifact 超时/
  );
  assert.deepEqual(exhaustedWaits, [10, 20]);
});
