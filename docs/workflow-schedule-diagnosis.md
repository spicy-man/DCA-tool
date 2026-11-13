# 定时工作流每日失败诊断与改进方案（历史诊断记录）

> **状态：已解决归档（仅作 `v1.17.2` 诊断记录保留）**  
> - 诊断基线：`v1.17.2`（提交 `f08f986`，2026-11-11 起出现、补充核对至 2026-11-13；下文引用的源码行号与行为均对应 `f08f986`）。  
> - 已落地修复：`v1.17.3`（提交 `67303c9`）已上线 `--catch-up` 过期来源自动补抓与收盘后 **2 小时（`graceMinutes = 120`）** 宽限窗口 `hasBlockingDataGap`（替代下文提出的 12 小时方案），对应验证见 [data-status-report.test.mjs](../test/data-status-report.test.mjs)、[refresh-schedule.test.mjs](../test/refresh-schedule.test.mjs) 与 [backend.test.mjs](../test/backend.test.mjs)。
>
> 相关工作流：[pages.yml](../.github/workflows/pages.yml)（`Update data and deploy Pages`）

## 一、结论摘要

1. **不是 EST / EDT（夏令时/冬令时）转换 bug**：时区与夏令时换算逻辑正确，失败与夏令时切换无对应关系。
2. **根本原因是“GitHub Actions 定时任务系统性延迟（约 4–8 小时）+ 完整性判定过严”**：只抓 Fear & Greed（F&G）的纽约 10:01 轮次被延迟到美股收盘（16:00 ET）之后才运行，此时应有交易日已切换为“当天”，而真正负责抓取美股 ETF（`SPY`/`QQQ`/`VGT`/`SMH`/`BRK-B`）的收盘轮次同样被推迟到更晚，导致本轮 `complete=false`，最终在状态汇报步骤退出 1。
3. **属于误报（假警报），不是数据损坏**：失败轮次实际已正常抓取并部署当天的 F&G 数据，美股 ETF 则沿用前一交易日有效快照，并在数小时后由延迟到达的收盘轮次补齐。实际影响是收盘后美股 ETF 数据在页面上延迟数小时更新，且若收盘轮次被 GitHub 丢弃，中间没有自愈补抓。

---

## 二、为什么不是 EST / EDT 的问题

- **工作流配置**：[pages.yml](../.github/workflows/pages.yml) 的 `schedule` 直接使用 GitHub 原生 `timezone: America/New_York` 字段，由平台按夏令时/冬令时调度；中国基金轮次使用无夏令时的 `timezone: Asia/Shanghai`。
- **计划槽位与收盘时间计算**：
  - [refresh-schedule.mjs](../server/refresh-schedule.mjs#L12-L16) 通过格式化当日 `17:00:00Z` 在 `America/New_York` 的小时数来换算当日偏移，再计算 `planned = noon + (hour - nyHour) * 3600000 + 60000`。
  - [trading-calendar.mjs](../public/js/domain/trading-calendar.mjs#L90-L118) 中 `nyDate`、`sessionClose`（同为取 `17:00:00Z` 纽约小时数换算收盘整点）与 `latestClosedSession` 均基于 `America/New_York` IANA 时区，不依赖 runner 系统时区（UTC）。夏令时切换发生在纽约凌晨 02:00，采样 `17:00Z` 始终落在切换后且所有美股 cron 小时数均 `>= 4`，换算结果在 EST 与 EDT 下均准确，且 [refresh-schedule.test.mjs](../test/refresh-schedule.test.mjs) 已覆盖 EDT（`2026-10-16`）与 EST（`2026-11-02`）及提前收盘日。
- **失败时间线不随夏令时切换出现或消失**：2026-11-01 美国切换至冬令时（EST），但 2026-10-29～11-03 期间（横跨 EDT 与 EST）未发生该类失败；自 2026-11-04 起在多个交易日收盘后出现：
  - `#179` `2026-11-04T21:09:39Z`
  - `#190` `2026-11-05T21:24:37Z`
  - `#235` `2026-11-09T23:43:38Z`
  - `#247` `2026-11-10T21:14:26Z`
  - `#259` `2026-11-11T21:49:14Z`
  - `#270` `2026-11-12T21:47:20Z`

---

## 三、失败触发机制

### 1. 失败步骤与退出条件

在 `#235`、`#247`、`#259`、`#270` 中，唯一真正失败的步骤是 **`Report deployment and all source states`**（退出码 1）；`Update sources` 因配置了 `continue-on-error: true` 在步骤视图显示成功，`Deploy valid data including failure status` 也已成功部署。

问题源于两套时间基准错位：

1. **选源按“计划槽位”**：[refresh-schedule.mjs](../server/refresh-schedule.mjs#L6-L26) 根据传入的 `github.event.schedule` 找到最近一个 `planned <= now` 的计划时刻。`1 10 * * *`（纽约 10:01）只返回 `['Fear & Greed']`，不抓美股 ETF；只有 `sessionClose + 1 min`（`1 16 * * *`）与 `+ 61 min`（`1 17 * * 1-5`）才包含美股 ETF。
2. **判齐按“实际运行时间”**：
   - [updater.mjs](../server/updater.mjs#L331) 在 `run()` 中按当前实际时间计算 `expectedDate = latestClosedSession(now)`。只要运行时间跨过当天收盘 + 1 分钟，`expectedDate` 即变为**当天**。
   - [updater.mjs](../server/updater.mjs#L340-L341) 对本轮未选中的来源直接沿用旧 `status.json` 记录（美股 ETF 仍停在**上一交易日**）。
   - [updater.mjs](../server/updater.mjs#L398-L400) 计算两个字段：`requestedComplete`（本轮所选来源是否成功且到齐，此时为 `true`）和 `complete`（**全部**来源是否成功且到齐，此时为 `false`）。
3. **两处把“未到 ETF 收盘抓数轮次”当成故障**：
   - [update-data.mjs](../scripts/update-data.mjs#L6)：`!status.complete` 直接置 `process.exitCode = 1`，导致 `steps.update.outcome == 'failure'`。
   - [report-data-status.mjs](../scripts/report-data-status.mjs#L19)：`if (!status.complete || process.env.UPDATE_OUTCOME === 'failure') process.exitCode = 1;`。

### 2. 为什么每天都会触发

以 2026-11-10（UTC）实际运行记录为例，所有定时轮次普遍比计划晚 **4–8 小时**（但顺序基本保持）：

| 计划槽位（NY / UTC） | 实际运行（UTC） | 延迟 | 本轮动作与结果 |
| --- | --- | --- | --- |
| `1 22 * * *`（11-09 22:01 EST / 11-10 03:01Z） | 10:51 | ~7.8h | 仅 F&G，成功 |
| `1 4 * * *`（04:01 EST / 09:01Z） | 16:41 | ~7.7h | 仅 F&G，成功 |
| `1 10 * * *`（10:01 EST / 15:01Z） | **21:14（#247）** | **~6.2h** | **仅 F&G，跨过 21:01Z 收盘 → `complete=false` → 失败** |
| `1 13 * * 1-5` / `1 14 * * 1-5`（18:01Z / 19:01Z） | 22:49 / 23:53 | ~4.8h | 返回 `[]`，跳过发布 |
| `1 16 * * *` / `1 17 * * 1-5`（21:01Z / 22:01Z） | 次日 00:59 / 01:45 | ~4h | 全来源刷新，`11-10` ETF 补齐 |

只要“纽约 10:01 仅 F&G 轮次”延迟超过约 6 小时，就会稳定落入**当日收盘（+1 分钟）之后、收盘轮次执行之前**的窗口，必然触发一次 `complete=false` 的假失败。

---

## 四、同源潜在问题

1. **提前收盘日同样会误报**：如感恩节次日等 13:00 ET 收盘的交易日，延迟后的 `1 10` 轮次或当天的 `1 16`（提前收盘日该槽位设计为仅 F&G）一旦落在 `13:01` 之后且早于 `13:01`/`14:01` 补跑完成，也会触发同一错误。
2. **ETF 缺少收盘槽位之外的自愈补抓**：[refresh-schedule.mjs](../server/refresh-schedule.mjs#L21) 仅在 `minutesAfterClose` 为 `1` 或 `61` 时选择 ETF。如果 GitHub 丢弃这两个轮次，或两次运行期间 Yahoo 日线尚未完整（[updater.mjs](../server/updater.mjs#L127-L161) 会保留旧行并告警），ETF 会一直停在旧日期直到下一个交易日收盘，期间每次 F&G 轮次都会报警但不会自动重抓。
3. **`Update sources` 步骤语义混杂**：[update-data.mjs](../scripts/update-data.mjs#L6) 将“未选中的来源未到齐”也判定为本步失败，导致 `UPDATE_OUTCOME` 无法区分“本轮抓取失败”与“其他来源尚未到轮次”。

---

## 五、可选修复方案对比与建议

### 方案 A：按宽限截止时间判定告警（消除误报，改动小）

- **做法**：
  1. [update-data.mjs](../scripts/update-data.mjs#L6)：仅当本轮所选来源未完成或失败（`!status.requestedComplete`）或基金更新失败时退出 1，不再因未选来源未到齐将 `update` 步骤判为失败。
  2. [report-data-status.mjs](../scripts/report-data-status.mjs#L19)：在以下任一条件成立时退出 1：
     - `UPDATE_OUTCOME === 'failure'` 或 `!status.requestedComplete`；
     - 存在 `ok === false` 的来源；
     - `!status.complete` 且当前时间已超过最近收盘交易日的宽限截止时间（例如借助 `latestClosedSession(now, DEADLINE_MINUTES)`，取 `DEADLINE_MINUTES = 720` 即收盘后 12 小时）。
  3. 宽限期内仅在摘要提示“等待收盘后计划轮次更新”，不红灯；若真正漏抓，次日清晨轮次仍会报红。
- **优点**：直接消除每日收盘后误报，同时保留对真实漏抓/接口故障的告警能力；不增加额外网络请求。
- **缺点**：单独采用时，若收盘两轮都被 GitHub 丢弃，仍需等到次日收盘才更新 ETF。

### 方案 B：收盘后自动补抓过期 ETF（增加自愈与降延迟）

- **做法**：在 `updater.mjs` `run()`（或定时选源阶段）增加“过期补抓”开关：定时模式下，只要 `expectedDate`（`latestClosedSession(now)`）已推进，且未选中的美股 ETF 快照日期 `< expectedDate`，自动将该 ETF 纳入本轮 `sources` 一起抓取；已达 `expectedDate` 的仍按 `--scheduled` 逻辑跳过。
- **优点**：延迟到达的 `1 10` 轮次或后续任意 F&G 轮次可立即把当天 ETF 补齐，同时解决收盘轮次被丢弃时的自愈问题，缩短页面数据延迟。
- **缺点**：收盘后未齐的 F&G 轮次会多触发一次 Yahoo 请求；若收盘刚过 Yahoo 尚未出全当日 K 线，该轮仍可能仅拿到前日数据（仍需配合方案 A 避免误报）。

### 方案 C（不推荐）：仅检查 `requestedComplete` 或按计划时间判新旧

- 仅看 `requestedComplete` 会在收盘轮次丢失时彻底失去告警；按计划时间判 `expectedDate` 会掩盖实际延迟并导致页面 `checkedAt` 与应有日期语义混乱。

### 推荐结论

采用 **方案 A + 方案 B**：
- **方案 A** 从告警语义上彻底消除“未到补数截止期却提前报红”的误报；
- **方案 B** 让收盘后首个运行的工作流顺带补齐过期 ETF，兼顾延迟优化与丢单自愈。

### 建议覆盖的验证测试

- [data-status-report.test.mjs](../test/data-status-report.test.mjs)：
  - 收盘后不久（如 +14 分钟）、`requestedComplete=true` 而未选 ETF 仍为上一交易日时，应正常退出 `0`；
  - 超过宽限截止时间（如收盘 +12 小时后）ETF 仍未到齐，或任一来源 `ok=false` / `requestedComplete=false` 时，应退出 `1`；
  - 提前收盘日（如 `2026-11-27`）、周末、美股节假日及 EST/EDT 两种时制边界。
- [backend.test.mjs](../test/backend.test.mjs) / [refresh-schedule.test.mjs](../test/refresh-schedule.test.mjs)：
  - 收盘后以 `--scheduled` 仅选 `Fear & Greed` 且 ETF 过期时，补抓开关将其纳入本轮抓取；ETF 已最新时不重复抓；
  - 未选来源过期但未越过宽限期时，`update-data.mjs` 退出 `0`。
