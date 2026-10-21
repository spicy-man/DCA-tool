import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadHistoricalSupplement } from '../server/sentiment-history.mjs';
import { refreshAll, CNN_URL, ARCHIVE_URL } from '../server/updater.mjs';
import { parseCSV } from '../public/js/domain/sentiment.mjs';
import { isTradingDay } from '../public/js/domain/trading-calendar.mjs';

const now = Date.parse('2025-01-06T23:00:00Z');
const base = 'Date,Fear Greed,Rating\n2020-06-05,66,Greed\n2020-07-09,53,Neutral\n2025-01-06,50,Neutral\n';

test('两源逐日对齐，补缺覆盖区间内全部交易日，不补休市日且保留边界', async () => {
  const supplement = await loadHistoricalSupplement();
  const expected = [];
  for (let date = new Date('2020-06-08T00:00:00Z'); date < new Date('2020-07-09T00:00:00Z'); date.setUTCDate(date.getUTCDate() + 1)) {
    const day = date.toISOString().slice(0, 10);
    if (isTradingDay(day)) expected.push(day);
  }
  assert.equal(supplement.length, 22);
  assert.deepEqual(supplement.map(row => row.date), expected);
  const saved = parseCSV(await readFile(new URL('../public/data/fear-greed.csv', import.meta.url), 'utf8'));
  for (const row of supplement) assert.equal(saved.find(r => r.date === row.date)?.score, row.score);
  assert.equal(saved.find(r => r.date === '2020-06-05').score, 66);
  assert.equal(saved.find(r => r.date === '2020-07-09').score, 53);
});

for (const sentimentSource of ['cnn', 'archive', 'auto']) {
  test(`${sentimentSource} 刷新保留独立补缺，备用源缺日或改值均不覆盖`, async t => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'dca-history-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const file = path.join(dataDir, 'fear-greed.csv');
    await writeFile(file, base);
    let archive = base;
    const options = { dataDir, now, sentimentSource, sources: ['Fear & Greed'], fetchText: async url => {
      if (url === CNN_URL) {
        if (sentimentSource === 'auto') throw Error('HTTP 403');
        return JSON.stringify({ fear_and_greed_historical: { data: [{ x: Date.parse('2025-01-06'), y: 22 }] } });
      }
      assert.equal(url, ARCHIVE_URL);
      return archive;
    } };
    for (const upstream of [base, base + '2020-06-08,1,Extreme Fear\n', base]) {
      archive = upstream;
      const status = await refreshAll(options);
      assert.equal(status.requestedComplete, true);
      assert.equal(status.complete, false); // Other sources have never been checked.
      const saved = parseCSV(await readFile(file, 'utf8'));
      assert.equal(saved.length, 25);
      assert.equal(saved.find(row => row.date === '2020-06-08').score, 67);
      assert.equal(saved.find(row => row.date === '2025-01-06').score, sentimentSource === 'cnn' ? 22 : 50);
      assert.equal(status.results[0].count, saved.length);
    }
    // The supplement must not hide loss of unrelated existing historical dates.
    if (sentimentSource !== 'cnn') {
      archive = base.replace('2020-07-09,53,Neutral\n', '');
      const previous = await readFile(file, 'utf8');
      assert.equal((await refreshAll(options)).results[0].ok, false);
      assert.equal(await readFile(file, 'utf8'), previous);
    }
  });
}
