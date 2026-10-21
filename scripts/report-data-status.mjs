import { readFile, appendFile } from 'node:fs/promises';
import { healthSummary } from '../public/js/domain/data-health.mjs';

const status = JSON.parse(await readFile(new URL('../public/data/status.json', import.meta.url), 'utf8'));
const summary = [
  '## 数据更新与部署',
  '',
  '数据更新步骤：' + (process.env.UPDATE_OUTCOME || '未知'),
  'Pages 部署步骤：' + (process.env.DEPLOY_OUTCOME || '未知'),
  '本轮选择：' + (status.requestedSources || []).join('、'),
  '本轮所选来源：' + (status.requestedComplete ? '成功且日期到齐' : '未全部成功或到齐'),
  '',
  healthSummary(status, Date.parse(status.checkedAt)).replaceAll('\n', '  \n'),
  ''
].filter(Boolean).join('\n\n') + '\n';
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
// Deployment success must not hide an incomplete source, including an unselected one.
if (!status.complete || process.env.UPDATE_OUTCOME === 'failure') process.exitCode = 1;
