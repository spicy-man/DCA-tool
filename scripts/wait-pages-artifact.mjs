import path from 'node:path';
import { setTimeout as defaultSleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

function githubHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'DCA-tool-actions'
  };
}

/**
 * 轮询 GitHub Actions Artifacts API，等待刚刚 finalize 的 Pages artifact 在元数据查询接口中可见。
 */
export async function waitForPagesArtifact({
  repo,
  runId,
  artifactName,
  token,
  fetchImpl = fetch,
  sleep = defaultSleep,
  delaysMs = [2000, 4000, 6000, 8000, 10000, 10000, 10000, 10000],
  apiBase = 'https://api.github.com'
}) {
  if (!repo || !runId || !artifactName || !token) {
    throw Error('缺少等待 Pages artifact 所需的参数（repo / runId / artifactName / token）');
  }

  const url = `${apiBase.replace(/\/+$/, '')}/repos/${repo}/actions/runs/${encodeURIComponent(String(runId))}/artifacts?name=${encodeURIComponent(artifactName)}`;
  let lastReason = '未查询到有效 artifact';

  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      const response = await fetchImpl(url, {
        headers: githubHeaders(token),
        signal: AbortSignal.timeout(10000)
      });

      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw Error(`查询 Pages artifact 失败（HTTP ${response.status}），停止重试`);
      }

      if (response.ok) {
        const data = await response.json();
        const artifact = (data?.artifacts || []).find(
          item => item && item.name === artifactName && !item.expired
        );
        if (artifact) {
          return { found: true, artifact, attempts: attempt + 1 };
        }
        lastReason = `Artifact "${artifactName}" 尚未出现在查询结果中`;
      } else {
        lastReason = `GitHub Artifacts API 返回 HTTP ${response.status}`;
      }
    } catch (error) {
      if (/HTTP (401|403|404)/.test(error.message)) throw error;
      lastReason = error?.message || String(error);
    }

    if (attempt < delaysMs.length) {
      await sleep(delaysMs[attempt]);
    }
  }

  throw Error(`等待 Pages artifact 超时（共 ${delaysMs.length + 1} 次查询）：${lastReason}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await waitForPagesArtifact({
      repo: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      artifactName: process.env.ARTIFACT_NAME,
      token: process.env.GITHUB_TOKEN
    });
    console.log(JSON.stringify({
      found: result.found,
      attempts: result.attempts,
      artifactId: result.artifact?.id ?? null,
      name: result.artifact?.name ?? null
    }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
