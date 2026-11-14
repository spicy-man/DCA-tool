import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, copyFile, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { SYMBOLS } from '../public/js/domain/market.mjs';
import { versionModuleSpecifiers, versionHtmlScripts } from '../scripts/build-site.mjs';

test('静态构建隔离个人行情和状态，保留公开来源的完整性并保护本地数据', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dca-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of ['scripts/build-site.mjs', 'scripts/version.mjs', 'package.json', 'CHANGELOG.md',
    'public/index.html', 'public/nasdaq-funds.html', 'public/sp500-funds.html', 'public/diagram.html',
    'public/js/funds-page.mjs', 'public/style.css', 'public/js/domain/market.mjs', 'public/js/domain/trading-calendar.mjs']) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await copyFile(new URL('../' + file, import.meta.url), path.join(root, file));
  }
  const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
  const dataDir = path.join(root, 'public/data');
  await mkdir(dataDir, { recursive: true });
  const files = ['fear-greed.csv', 'nasdaq100-etfs.json', 'sp500-etfs.json', ...SYMBOLS.map(symbol => symbol.toLowerCase() + '.json'),
    'custom-symbols.json', 'voo.json', 'aapl.json', '.refresh.lock', 'spy.json.tmp'];
  for (const file of files) await writeFile(path.join(dataDir, file), 'fixture');
  const sources = ['Fear & Greed', ...SYMBOLS];
  const status = { version: 1, expectedDate: '2026-10-20', checkedAt: '2026-10-21T00:00:00Z',
    requestedSources: [...sources, 'VOO'], complete: false, requestedComplete: false,
    results: [...sources.map(symbol => ({ symbol, ok: true, date: '2026-10-20' })),
      { symbol: 'VOO', ok: false, date: '2026-10-19' }] };
  const localFile = path.join(dataDir, 'status.json');
  const outputFile = path.join(root, 'dist/data/status.json');
  const build = () => execFileSync(process.execPath, [path.join(root, 'scripts/build-site.mjs')],
    { encoding: 'utf8', windowsHide: true });
  const save = () => writeFile(localFile, JSON.stringify(status));
  await save();
  const original = await readFile(localFile, 'utf8');
  build();
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist/deployment.json'), 'utf8')),
    { mode: 'static', version });
  assert.ok((await readFile(path.join(root, 'dist/index.html'), 'utf8')).includes(`./js/app.mjs?v=${version}"`));
  for (const rel of ['nasdaq-funds.html', 'sp500-funds.html']) {
    const built = await readFile(path.join(root, 'dist', rel), 'utf8');
    const source = await readFile(path.join(root, 'public', rel), 'utf8');
    assert.ok(built.includes(`./js/funds-page.mjs?v=${version}"`), rel);
    assert.equal(built, versionHtmlScripts(source, version));
  }
  assert.ok((await readFile(path.join(root, 'dist/diagram.html'), 'utf8'))
    .includes(`'./js/ui/diagram-viewer.mjs?v=${version}'`));
  assert.equal(await readFile(path.join(root, 'dist/js/funds-page.mjs'), 'utf8'),
    versionModuleSpecifiers(await readFile(path.join(root, 'public/js/funds-page.mjs'), 'utf8'), version));
  assert.match(versionModuleSpecifiers("  import './a.mjs';\nimport('./b.mjs');\nexport { x } from '../c.mjs?v=1.0.0';", '2.2.1'),
    /import '\.\/a\.mjs\?v=2\.2\.1';\nimport\('\.\/b\.mjs\?v=2\.2\.1'\);\nexport \{ x \} from '\.\.\/c\.mjs\?v=2\.2\.1';/);
  assert.deepEqual((await readdir(path.dirname(outputFile))).sort(),
    ['status.json', 'fear-greed.csv', 'nasdaq100-etfs.json', 'sp500-etfs.json', ...SYMBOLS.map(symbol => symbol.toLowerCase() + '.json')].sort());
  let published = JSON.parse(await readFile(outputFile, 'utf8'));
  assert.deepEqual(published.results, status.results.slice(0, sources.length));
  assert.deepEqual(published.requestedSources, sources);
  assert.equal(published.complete, true);
  assert.equal(published.requestedComplete, true);
  assert.equal(await readFile(localFile, 'utf8'), original);
  for (const file of files) assert.equal(await readFile(path.join(dataDir, file), 'utf8'), 'fixture');

  // Filtering must not conceal a failed or missing public source.
  status.results[0].ok = false;
  status.requestedSources = ['Fear & Greed', 'VOO'];
  await save();
  build();
  published = JSON.parse(await readFile(outputFile, 'utf8'));
  assert.equal(published.complete, false);
  assert.equal(published.requestedComplete, false);
  status.results = status.results.filter(result => result.symbol !== 'SMH');
  status.results[0].ok = true;
  status.requestedSources = ['VOO'];
  await save();
  build();
  published = JSON.parse(await readFile(outputFile, 'utf8'));
  assert.equal(published.complete, false);
  assert.deepEqual(published.requestedSources, []);
  assert.equal(published.requestedComplete, true);

  await rm(localFile);
  build();
  await assert.rejects(readFile(outputFile), { code: 'ENOENT' });
});
