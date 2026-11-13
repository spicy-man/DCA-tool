import { readFile, appendFile } from 'node:fs/promises';
import { hasBlockingDataGap, healthSummary } from '../public/js/domain/data-health.mjs';

const status = JSON.parse(await readFile(new URL('../public/data/status.json', import.meta.url), 'utf8'));
const blockingGap = hasBlockingDataGap(status, Date.parse(status.checkedAt));
const summary = [
  '## 数据更新与部署',
  '',
  '数据更新步骤：' + (process.env.UPDATE_OUTCOME || '未知'),
  'Pages 部署步骤：' + (process.env.DEPLOY_OUTCOME || '未知'),
  '本轮选择：' + (status.requestedSources || []).join('、'),
  '本轮所选来源：' + (status.requestedComplete ? '成功且日期到齐' : '未全部成功或到齐'),
  !status.complete && !blockingGap ? '提示：当前处于收盘后宽限窗口内（2 小时内），暂未到齐的来源不触发故障告警。' : '',
  '',
  healthSummary(status, Date.parse(status.checkedAt)).replaceAll('\n', '  \n'),
  ''
].filter(Boolean).join('\n\n') + '\n';
console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
// Deployment success must not hide a blocking data gap or update failure.
if (blockingGap || process.env.UPDATE_OUTCOME === 'failure') process.exitCode = 1;
