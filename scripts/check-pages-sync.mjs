import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA_RE = /^[0-9a-f]{40}$/i;

function githubHeaders(token) {
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DCA-tool-actions'
  };
}

function normalizeBaseUrl(url) {
  return url.endsWith('/') ? url : url + '/';
}

async function resolvePagesBaseUrl({ repo, pagesUrl, token, fetchImpl, apiBase }) {
  if (pagesUrl) return { ok: true, baseUrl: normalizeBaseUrl(pagesUrl) };
  if (!repo) return { ok: false, reason: 'pages_api_unavailable', warning: '缺少 GITHUB_REPOSITORY' };

  const url = `${apiBase.replace(/\/+$/, '')}/repos/${repo}/pages`;
  try {
    const response = await fetchImpl(url, {
      headers: githubHeaders(token),
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 404) {
      return { ok: false, reason: 'pages_unconfigured' };
    }
    if (!response.ok) {
      return { ok: false, reason: 'pages_api_unavailable', warning: `Pages API HTTP ${response.status}` };
    }
    const data = await response.json();
    if (!data?.html_url) {
      return { ok: false, reason: 'pages_unconfigured' };
    }
    return { ok: true, baseUrl: normalizeBaseUrl(data.html_url) };
  } catch (error) {
    return { ok: false, reason: 'pages_api_unavailable', warning: error?.message || String(error) };
  }
}

async function checkLatestDeploymentFailure({ repo, token, fetchImpl, apiBase }) {
  if (!repo) return null;
  const base = apiBase.replace(/\/+$/, '');
  try {
    const depRes = await fetchImpl(
      `${base}/repos/${repo}/deployments?environment=github-pages&per_page=1`,
      { headers: githubHeaders(token), signal: AbortSignal.timeout(10000) }
    );
    if (!depRes.ok) return null;
    const deployments = await depRes.json();
    const latest = Array.isArray(deployments) ? deployments[0] : null;
    if (!latest?.id) return null;

    const statusRes = await fetchImpl(
      `${base}/repos/${repo}/deployments/${latest.id}/statuses?per_page=1`,
      { headers: githubHeaders(token), signal: AbortSignal.timeout(10000) }
    );
    if (!statusRes.ok) return null;
    const statuses = await statusRes.json();
    const state = Array.isArray(statuses) ? statuses[0]?.state : null;
    if (state === 'failure' || state === 'error') {
      return { outOfSync: true, reason: 'last_deployment_failed', deploymentId: latest.id, state };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 检测线上 GitHub Pages 是否落后于当前 main 提交或最近一次部署是否失败，用于无新快照提交时的漂移自愈。
 * 外网探测异常时默认 fail-open（返回 outOfSync: false），避免无变动定时轮次因网络抖动误部署。
 */
export async function checkPagesSync({
  repo,
  headSha,
  localVersion,
  localStatusCheckedAt = null,
  token,
  pagesUrl = null,
  fetchImpl = fetch,
  apiBase = 'https://api.github.com',
  now = Date.now()
}) {
  const resolved = await resolvePagesBaseUrl({ repo, pagesUrl, token, fetchImpl, apiBase });
  if (!resolved.ok) {
    return {
      outOfSync: false,
      reason: resolved.reason,
      ...(resolved.warning ? { warning: resolved.warning } : {})
    };
  }

  const baseUrl = resolved.baseUrl;
  let remoteFetchFailed = false;
  let warning = '';

  try {
    const depRes = await fetchImpl(`${baseUrl}deployment.json?_=${now}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000)
    });
    if (depRes.status === 404) {
      return { outOfSync: true, reason: 'deployment_json_missing' };
    }
    if (!depRes.ok) {
      remoteFetchFailed = true;
      warning = `deployment.json HTTP ${depRes.status}`;
    } else {
      const remote = await depRes.json();
      if (typeof remote?.commit === 'string' && SHA_RE.test(remote.commit.trim())) {
        const deployedCommit = remote.commit.trim().toLowerCase();
        const normalizedHead = typeof headSha === 'string' ? headSha.trim().toLowerCase() : '';
        if (normalizedHead && deployedCommit === normalizedHead) {
          return { outOfSync: false, reason: 'commit_match', deployedCommit };
        }
        return {
          outOfSync: true,
          reason: 'commit_mismatch',
          deployedCommit,
          headSha: normalizedHead || null
        };
      }
      if (localVersion && remote?.version && remote.version !== localVersion) {
        return {
          outOfSync: true,
          reason: 'version_mismatch',
          remoteVersion: remote.version,
          localVersion
        };
      }
    }
  } catch (error) {
    remoteFetchFailed = true;
    warning = error?.message || String(error);
  }

  // 旧版 deployment.json 不含 commit 字段时，补充比对线上 status.json 的 checkedAt
  if (!remoteFetchFailed && localStatusCheckedAt) {
    try {
      const statusRes = await fetchImpl(`${baseUrl}data/status.json?_=${now}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(10000)
      });
      if (statusRes.status === 404) {
        return { outOfSync: true, reason: 'status_json_missing' };
      }
      if (!statusRes.ok) {
        remoteFetchFailed = true;
        warning = `status.json HTTP ${statusRes.status}`;
      } else {
        const remoteStatus = await statusRes.json();
        if (remoteStatus?.checkedAt !== localStatusCheckedAt) {
          return {
            outOfSync: true,
            reason: 'status_mismatch',
            remoteCheckedAt: remoteStatus?.checkedAt ?? null,
            localCheckedAt: localStatusCheckedAt
          };
        }
      }
    } catch (error) {
      remoteFetchFailed = true;
      warning = error?.message || String(error);
    }
  }

  const failedDeployment = await checkLatestDeploymentFailure({ repo, token, fetchImpl, apiBase });
  if (failedDeployment) return failedDeployment;

  if (remoteFetchFailed) {
    return { outOfSync: false, reason: 'sync_check_unavailable', warning };
  }
  return { outOfSync: false, reason: 'in_sync' };
}

async function readLocalMetadata(cwd = process.cwd()) {
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  const pkg = JSON.parse(await readFile(path.join(cwd, 'package.json'), 'utf8'));
  let localStatusCheckedAt = null;
  try {
    const status = JSON.parse(await readFile(path.join(cwd, 'public/data/status.json'), 'utf8'));
    localStatusCheckedAt = status?.checkedAt || null;
  } catch {
    localStatusCheckedAt = null;
  }
  return { headSha, localVersion: pkg.version, localStatusCheckedAt };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result;
  try {
    const meta = await readLocalMetadata();
    result = await checkPagesSync({
      repo: process.env.GITHUB_REPOSITORY,
      headSha: meta.headSha,
      localVersion: meta.localVersion,
      localStatusCheckedAt: meta.localStatusCheckedAt,
      token: process.env.GITHUB_TOKEN,
      pagesUrl: process.env.PAGES_URL || null
    });
  } catch (error) {
    result = { outOfSync: false, reason: 'sync_check_error', warning: error?.message || String(error) };
  }
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `pages_out_of_sync=${result.outOfSync ? 'true' : 'false'}\nsync_reason=${result.reason}\n`
    );
  }
}
