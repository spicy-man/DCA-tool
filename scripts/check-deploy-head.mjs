import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Compare exact commits, including snapshots. Never deploy unpublished data or
// silently rebase a snapshot onto code that was not tested in this run.
export function checkDeployHead(cwd = process.cwd()) {
  const git = args => execFileSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: 'pipe'
  }).trim();
  const local = git(['rev-parse', 'HEAD']);
  const remote = git(['ls-remote', '--exit-code', 'origin', 'refs/heads/main']).split(/\s+/)[0];
  if (local !== remote) {
    throw Error('main 已前进或当前提交尚未入库，停止发布。请从 main 重新运行工作流。');
  }
  return local;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log('Verified main: ' + checkDeployHead());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
