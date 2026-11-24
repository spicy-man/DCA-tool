import test from 'node:test';
import assert from 'node:assert/strict';
import { checkPagesSync } from '../scripts/check-pages-sync.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function mockFetch(routes) {
  return async url => {
    const matched = routes.find(([pattern]) => pattern.test(url));
    if (!matched) throw Error('Unexpected URL: ' + url);
    const handler = matched[1];
    return typeof handler === 'function' ? handler(url) : handler;
  };
}

const okJson = body => ({ ok: true, status: 200, json: async () => body });
const errStatus = status => ({ ok: false, status, json: async () => ({}) });

test('checkPagesSync 精确识别 commit 一致与不一致，以及 deployment.json 缺失', async () => {
  const common = {
    repo: 'spicy-man/DCA-tool',
    headSha: SHA_A,
    localVersion: '2.2.16',
    localStatusCheckedAt: '2026-11-24T05:47:04.776Z',
    token: 'tok',
    now: 123456
  };

  // 1. commit 一致
  const match = await checkPagesSync({
    ...common,
    fetchImpl: mockFetch([
      [/\/repos\/spicy-man\/DCA-tool\/pages$/, okJson({ html_url: 'https://spicy-man.github.io/DCA-tool/' })],
      [/deployment\.json\?_=123456$/, okJson({ mode: 'static', version: '2.2.16', commit: SHA_A.toUpperCase() })]
    ])
  });
  assert.deepEqual(match, { outOfSync: false, reason: 'commit_match', deployedCommit: SHA_A });

  // 2. commit 不一致 -> 触发漂移自愈
  const mismatch = await checkPagesSync({
    ...common,
    fetchImpl: mockFetch([
      [/\/repos\/spicy-man\/DCA-tool\/pages$/, okJson({ html_url: 'https://spicy-man.github.io/DCA-tool' })],
      [/deployment\.json\?_=123456$/, okJson({ mode: 'static', version: '2.2.16', commit: SHA_B })]
    ])
  });
  assert.deepEqual(mismatch, {
    outOfSync: true,
    reason: 'commit_mismatch',
    deployedCommit: SHA_B,
    headSha: SHA_A
  });

  // 3. deployment.json 404 -> 触发补发
  const missing = await checkPagesSync({
    ...common,
    fetchImpl: mockFetch([
      [/\/repos\/spicy-man\/DCA-tool\/pages$/, okJson({ html_url: 'https://spicy-man.github.io/DCA-tool/' })],
      [/deployment\.json\?_=123456$/, errStatus(404)]
    ])
  });
  assert.deepEqual(missing, { outOfSync: true, reason: 'deployment_json_missing' });
});

test('checkPagesSync 支持旧版 deployment.json 回退比对版本、status.json 与部署失败状态，探测故障时 fail-open', async () => {
  const base = {
    repo: 'spicy-man/DCA-tool',
    headSha: SHA_A,
    localVersion: '2.2.16',
    localStatusCheckedAt: '2026-11-24T05:47:04.776Z',
    token: 'tok',
    pagesUrl: 'https://spicy-man.github.io/DCA-tool/',
    now: 999
  };

  // 1. 无 commit 字段但版本落后
  const versionDrift = await checkPagesSync({
    ...base,
    fetchImpl: mockFetch([
      [/deployment\.json\?_=999$/, okJson({ mode: 'static', version: '2.2.15' })]
    ])
  });
  assert.equal(versionDrift.outOfSync, true);
  assert.equal(versionDrift.reason, 'version_mismatch');

  // 2. 无 commit 且版本相同，但线上 status.json 停留在旧 checkedAt（复现 02:04Z vs 05:47Z 失步）
  const statusDrift = await checkPagesSync({
    ...base,
    fetchImpl: mockFetch([
      [/deployment\.json\?_=999$/, okJson({ mode: 'static', version: '2.2.16' })],
      [/data\/status\.json\?_=999$/, okJson({ checkedAt: '2026-11-24T02:04:18.384Z' })]
    ])
  });
  assert.equal(statusDrift.outOfSync, true);
  assert.equal(statusDrift.reason, 'status_mismatch');

  // 3. deployment.json 临时 503，但 Deployments API 显示最近一次部署失败 -> 触发自愈
  const apiFailureDetected = await checkPagesSync({
    ...base,
    fetchImpl: mockFetch([
      [/deployment\.json\?_=999$/, errStatus(503)],
      [/\/deployments\?environment=github-pages&per_page=1$/, okJson([{ id: 8019818684 }])],
      [/\/deployments\/8019818684\/statuses\?per_page=1$/, okJson([{ state: 'failure' }])]
    ])
  });
  assert.deepEqual(apiFailureDetected, {
    outOfSync: true,
    reason: 'last_deployment_failed',
    deploymentId: 8019818684,
    state: 'failure'
  });

  // 4. 全部网络探测失败时 fail-open，不触发无意义重部署
  const unavailable = await checkPagesSync({
    ...base,
    fetchImpl: mockFetch([
      [/deployment\.json\?_=999$/, () => { throw Error('network down'); }],
      [/\/deployments\?environment=github-pages&per_page=1$/, errStatus(500)]
    ])
  });
  assert.equal(unavailable.outOfSync, false);
  assert.equal(unavailable.reason, 'sync_check_unavailable');

  // 5. Pages API 不可用也 fail-open
  const pagesDown = await checkPagesSync({
    ...base,
    pagesUrl: null,
    fetchImpl: mockFetch([
      [/\/repos\/spicy-man\/DCA-tool\/pages$/, errStatus(502)]
    ])
  });
  assert.equal(pagesDown.outOfSync, false);
  assert.equal(pagesDown.reason, 'pages_api_unavailable');
});
