import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { checkDeployHead } from '../scripts/check-deploy-head.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', windowsHide: true, stdio: 'pipe'
}).trim();

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dca-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = path.join(root, 'remote.git');
  const author = path.join(root, 'author');
  const runner = path.join(root, 'runner');
  git(root, 'init', '--bare', '--initial-branch=main', remote);
  git(root, 'clone', remote, author);
  for (const [key, value] of [['user.name', 'Review fixture'], ['user.email', 'fixture@example.invalid']]) {
    git(author, 'config', key, value);
  }
  await writeFile(path.join(author, 'app.mjs'), 'export const version = 1;\n');
  await mkdir(path.join(author, 'public/data'), { recursive: true });
  await writeFile(path.join(author, 'public/data/status.json'), '{}\n');
  git(author, 'add', '.');
  git(author, 'commit', '-m', 'Initial fixture');
  git(author, 'push', 'origin', 'HEAD:refs/heads/main');
  git(root, 'clone', remote, runner);
  for (const [key, value] of [['user.name', 'Review runner'], ['user.email', 'runner@example.invalid']]) {
    git(runner, 'config', key, value);
  }
  return { root, remote, author, runner };
}

async function commit(cwd, file, text) {
  await writeFile(path.join(cwd, file), text);
  git(cwd, 'add', file);
  git(cwd, 'commit', '-m', 'Advance fixture');
}

test('部署门禁允许当前 main，拒绝尚未持久化的快照提交', async t => {
  const { runner } = await fixture(t);
  assert.equal(checkDeployHead(runner), git(runner, 'rev-parse', 'HEAD'));
  await commit(runner, 'public/data/status.json', '{"checked":true}\n');
  assert.throws(() => checkDeployHead(runner), /停止发布/);
  git(runner, 'push', 'origin', 'HEAD:refs/heads/main');
  assert.equal(checkDeployHead(runner), git(runner, 'rev-parse', 'HEAD'));
});

test('排队或重跑的旧 checkout 遇到代码前进和非快进推送时不得部署', async t => {
  const { author, runner } = await fixture(t);
  await commit(author, 'app.mjs', 'export const version = 2;\n');
  git(author, 'push', 'origin', 'HEAD:refs/heads/main');
  assert.throws(() => checkDeployHead(runner), /停止发布/);
  await commit(runner, 'public/data/status.json', '{"checked":true}\n');
  assert.throws(() => git(runner, 'push', 'origin', 'HEAD:refs/heads/main'));
  assert.throws(() => checkDeployHead(runner), /停止发布/);
  assert.equal(git(author, 'rev-parse', 'HEAD'), git(author, 'ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0]);
});

test('只有数据前进也拒绝旧构建，无法读取远端时关闭部署', async t => {
  const { root, author, runner } = await fixture(t);
  await commit(author, 'public/data/status.json', '{"newer":true}\n');
  git(author, 'push', 'origin', 'HEAD:refs/heads/main');
  assert.throws(() => checkDeployHead(runner), /停止发布/);
  git(runner, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
  assert.throws(() => checkDeployHead(runner));
});
