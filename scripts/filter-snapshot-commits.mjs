import { execFileSync } from 'node:child_process';
import { DEFAULT_DATA_DIR } from '../server/updater.mjs';
import { pruneRedundantSnapshotWrites, readGitHeadSnapshot } from '../server/snapshot-changes.mjs';

const summary = await pruneRedundantSnapshotWrites({
  dataDir: DEFAULT_DATA_DIR,
  readBaseline: name => readGitHeadSnapshot(name),
  restoreBaseline: name => execFileSync('git', ['checkout', 'HEAD', '--', `public/data/${name}`], {
    windowsHide: true, timeout: 30000, stdio: 'inherit'
  })
});
console.log(JSON.stringify(summary));
