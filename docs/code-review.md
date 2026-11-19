# 代码审查台账 (Code Review)

> **使用约定**：本文件仅保留**当前待修 Bug**（统一按 `P1 / P2 / P3` 分级）与**最近一轮审查摘要**。
> - 长期重构与架构整理见 [技术债清单](./tech-debt.md)
> - 已修复归档与历史审查记录见 [历史审查归档](./review-archive.md)
> - 已修复并验证通过的 Bug 直接移出本文件并归档留痕，不保留删除线。

---

## 一、当前待修 Bug 概览

| 编号 | 优先级 | 模块 | 问题摘要 |
| --- | --- | --- | --- |
| [#24](#24-p1-回收过期锁可破坏写入互斥) | **P1** | [storage.mjs](../server/storage.mjs#L57-L107) | 过期锁回收及释放可能误删其他写入者新获取的锁 |
| [#14](#14-p2-http-servermjs-局部接口方法head-响应与流解码缺陷) | **P2** | [http-server.mjs](../server/http-server.mjs#L50-L78) | `/deployment.json` 未限方法、`HEAD` 返回响应体、`/api/symbols` 拼接文本块且 `413` 未销毁流 |
| [#25](#25-p2-定时与手动发布可绕过应用测试) | **P2** | [pages.yml](../.github/workflows/pages.yml#L91-L102) | 推送测试失败后，后续定时或手动任务检出同一 `main` 提交并跳过测试仍可发布 |
| [#31](#31-p2-组合回测在-0-倍恐慌加投下仍强制截断至-2011-01-03) | **P2** | [strategy-summary.mjs](../public/js/domain/strategy-summary.mjs#L96-L147) | 0 倍恐慌加投完全不依赖 F&G 数据，但组合回测仍强制从 `2011-01-03` 起算 |
| [#9](#9-p3-pagesyml-update-写状态前崩溃仍会部署旧-statusjson) | **P3** | [pages.yml](../.github/workflows/pages.yml#L103-L106) | `update-data.mjs` 在写出 `status.json` 前崩溃，因 `continue-on-error` 仍部署旧状态 |
| [#15](#15-p3-comparisonmjs-场内基金成交额全为空时误显示-000-亿) | **P3** | [comparison.mjs](../public/js/features/funds/comparison.mjs#L124-L125) | 所有基金 `amount === null` 时 `#fund-turnover` 显示 `0.00 亿` 而非 `—` |
| [#16](#16-p3-strategy-summarymjs-summarizefunding-峰值并列使用精确-) | **P3** | [strategy-summary.mjs](../public/js/domain/strategy-summary.mjs#L90-L91) | 单标的峰值月份并列比较使用 `amount === peak`，未统一采用 `1e-9` 容差 |
| [#17](#17-p3-backtestmjs-组合回测缺少前置行情顺序与正价格校验) | **P3** | [backtest.mjs](../public/js/domain/backtest.mjs#L252-L278) | `comparePortfolioStrategies` 未复用 `compareStrategies` 的前置日线与正价格校验 |
| [#18](#18-p3-geometrymjs--chartmjs--sentimentmjs-零宽度画布产生负间距) | **P3** | [geometry.mjs](../public/js/charts/geometry.mjs#L19) | 画布宽度为 0 或折叠时 `pw < 0` 传入 `createTradingScale` 产生负步距 |
| [#19](#19-p3-updatermjs-parsecnn-拼接-csv-未转义逗号) | **P3** | [updater.mjs](../server/updater.mjs#L80-L81) | `parseCNN` 将 `entry.rating` 拼为 CSV 字符串再解析，含逗号时会被拆列 |
| [#20](#20-p3-fund-quotesmjs-仅更新年费时未刷新-profilecheckedat) | **P3** | [fund-quotes.mjs](../server/fund-quotes.mjs#L86-L87) | `netAssets === null` 且 `annualFee !== null` 时更新年费却不刷新 `profileCheckedAt` |
| [#21](#21-p3-settingsmjs-localstorage-反序列化未过滤原型键) | **P3** | [settings.mjs](../public/js/features/strategy/settings.mjs#L183-L214) | 还原 `bySymbol`、`weights`、`fearEnabled` 时未跳过 `__proto__` 等特殊键 |
| [#22](#22-p3-data-clientmjs-requestsourcerefresh-未兜底非-json-错误响应) | **P3** | [data-client.mjs](../public/js/services/data-client.mjs#L53-L58) | 非 JSON 错误响应时直接抛出原始 `SyntaxError` 而非上下文失败提示 |
| [#29](#29-p3-情绪备用存档被标为官方接口) | **P3** | [sentiment.mjs](../public/js/domain/sentiment.mjs#L37-L42) | 来源提示及 CSV 导出硬编码 `2021-02-01` 起为 CNN 官方接口，未反映备用存档渠道 |

---

## 二、问题详细定位与修复建议

### #24 [P1] 回收过期锁可破坏写入互斥
- **位置**：[server/storage.mjs](../server/storage.mjs#L57-L107)
- **触发条件**：多个并发任务同时判定 `.refresh.lock` 过期并按路径删除，或仍存活的 PID 超过 10 分钟被误接管，原持有者退出时又按路径删除新锁。
- **实际影响**：已在隔离目录复现两个任务同时进入临界区，破坏写入互斥。
- **建议修复**：保护存活 PID 的锁，串行化过期锁接管，并在释放锁时校验锁归属（如唯一 token / inode）再删除。

### #14 [P2] `http-server.mjs` 局部接口方法、`HEAD` 响应与流解码缺陷
- **位置**：[server/http-server.mjs](../server/http-server.mjs#L50-L78)
- **触发条件**：`/deployment.json` 接受任意 HTTP 方法且对 `HEAD` 返回响应体；`/data/custom-symbols.json` 对 `HEAD` 仍发 JSON 响应体；`/api/symbols` 拼接 `Buffer` 字符串且 `413` 未销毁请求流。
- **实际影响**：违反 HTTP `HEAD` 语义，跨 TCP 分片的多字节 UTF-8 可能损坏，超大请求体不关闭底层流。
- **建议修复**：`/deployment.json` 限 `GET`/`HEAD`；`send()` 对 `HEAD` 仅写响应头；`/api/symbols` 收集 `Buffer` 后统一解码，超限 `413` 调用 `req.destroy()`。

### #25 [P2] 定时与手动发布可绕过应用测试
- **位置**：[.github/workflows/pages.yml](../.github/workflows/pages.yml#L91-L102)
- **触发条件**：推送到 `main` 的代码因应用测试失败而中断发布，但该提交仍留在 `main`；随后的定时或手动任务检出同一 `main` 提交并跳过应用测试。
- **实际影响**：未通过测试的应用代码可能被后续定时任务构建并部署上线。
- **建议修复**：部署前核验当前应用代码对应的测试结果，或让数据刷新复用已通过验证的代码基线。

### #31 [P2] 组合回测在 0 倍恐慌加投下仍强制截断至 `2011-01-03`
- **位置**：[public/js/domain/strategy-summary.mjs](../public/js/domain/strategy-summary.mjs#L96-L147)
- **触发条件**：在组合配比回测中采用主推的「加权K定投 + 0 倍恐慌加投」（所有标的 `fearBuyCount === 0`）回测 `SPY`（1993 起）或 `QQQ`（1999 起）等长历史标的。
- **实际影响**：虽然完全不依赖 2011 年起算的 CNN F&G 数据，仍强制要求 `sentiment.length > 0` 并按 `fngStart = sentiment[0].date` 截断，无法在组合模式下回测 2000 年科网泡沫与 2008 年次贷危机（与单标的回测口径不一致）。
- **建议修复**：仅当组合中存在 `fearBuyCount > 0` 时受 `fngStart` 约束；全 0 倍恐慌时按各标的最早可用历史（或共同有效起点）测算。

### #9 [P3] `pages.yml` `update` 写状态前崩溃仍会部署旧 `status.json`
- **位置**：[.github/workflows/pages.yml](../.github/workflows/pages.yml#L103-L106)、[scripts/report-data-status.mjs](../scripts/report-data-status.mjs#L4-L19)
- **触发条件**：`scripts/update-data.mjs` 在写出新 `status.json` 前抛错退出。
- **实际影响**：因 `continue-on-error: true`，后续构建与部署仍会发布旧 `status.json`（虽最终报告步骤仍会标红任务）。
- **建议修复**：`update` 异常崩溃且未更新 `status.json` 时跳过部署，或写入明确失败状态。

### #15 [P3] `comparison.mjs` 场内基金成交额全为空时误显示 `0.00 亿`
- **位置**：[public/js/features/funds/comparison.mjs](../public/js/features/funds/comparison.mjs#L124-L125)
- **触发条件**：快照有基金行但全部 `amount === null`。
- **实际影响**：`#fund-turnover` 显示 `0.00 亿` 而非 `—`。
- **建议修复**：先过滤 `Number.isFinite(row.amount)`，无有效值时显示 `—`。

### #16 [P3] `strategy-summary.mjs` `summarizeFunding` 峰值并列使用精确 `===`
- **位置**：[public/js/domain/strategy-summary.mjs](../public/js/domain/strategy-summary.mjs#L90-L91)
- **触发条件**：单标的区间内存在两个理论相等、因浮点累加尾差略微不同的峰值月份。
- **实际影响**：可能漏掉并列峰值月份（同文件 `summarizeAnnualPeak` 与 `summarizePortfolioFunding` 已使用 `1e-9` 容差）。
- **建议修复**：统一改用 `peak > 0 && Math.abs(amount - peak) < 1e-9`。

### #17 [P3] `backtest.mjs` 组合回测缺少前置行情顺序与正价格校验
- **位置**：[public/js/domain/backtest.mjs](../public/js/domain/backtest.mjs#L252-L278)
- **触发条件**：直接调用 `comparePortfolioStrategies` 并传入乱序或零价格 `rows`。
- **实际影响**：除零产生 `Infinity` 并误报「回测金额超出可计算范围」而非行情无效。
- **建议修复**：与 `compareStrategies` 共用同一前置日线递增与正价格校验函数。

### #18 [P3] `geometry.mjs` / `chart.mjs` / `sentiment.mjs` 零宽度画布产生负间距
- **位置**：[public/js/charts/geometry.mjs](../public/js/charts/geometry.mjs#L19)、[public/js/features/market/chart.mjs](../public/js/features/market/chart.mjs#L161-L170)、[public/js/charts/sentiment.mjs](../public/js/charts/sentiment.mjs#L22-L26)
- **触发条件**：容器折叠或 `clientWidth === 0` 时重绘，扣除右侧留白后 `pw < 0`。
- **实际影响**：`spacing` 为负值，坐标轴映射方向反转。
- **建议修复**：绘制入口对 `pw <= 0 || ph <= 0` 提前返回，并在 `createTradingScale` 保护非正宽度。

### #19 [P3] `updater.mjs` `parseCNN` 拼接 CSV 未转义逗号
- **位置**：[server/updater.mjs](../server/updater.mjs#L80-L81)
- **触发条件**：上游 CNN `entry.rating` 含逗号时，`parseCNN` 拼成 CSV 再解析会被拆列。
- **实际影响**：上游文案变动时解析脆弱。
- **建议修复**：直接构造并校验对象，不再经 CSV 字符串中转。

### #20 [P3] `fund-quotes.mjs` 仅更新年费时未刷新 `profileCheckedAt`
- **位置**：[server/fund-quotes.mjs](../server/fund-quotes.mjs#L86-L87)
- **触发条件**：F10 页面仅解析出 `annualFee` 而 `netAssets === null`。
- **实际影响**：`annualFee` 已更新，但 `profileCheckedAt` 仍停留在旧时间。
- **建议修复**：任一档案字段更新成功即刷新对应核对时间（或拆分规模与费率核对时间）。

### #21 [P3] `settings.mjs` `localStorage` 反序列化未过滤原型键
- **位置**：[public/js/features/strategy/settings.mjs](../public/js/features/strategy/settings.mjs#L183-L214)
- **触发条件**：本地存储中的 `bySymbol`、`weights` 或 `fearEnabled` JSON 被篡改含 `__proto__`。
- **实际影响**：局部映射对象原型可能被篡改（防御纵深问题）。
- **建议修复**：还原键名时跳过 `__proto__` / `constructor` / `prototype`（或用 `Object.create(null)`）。

### #22 [P3] `data-client.mjs` `requestSourceRefresh` 未兜底非 JSON 错误响应
- **位置**：[public/js/services/data-client.mjs](../public/js/services/data-client.mjs#L53-L58)
- **触发条件**：代理或异常路径对 `/api/refresh` 返回 HTML/纯文本错误页（如 `502`）。
- **实际影响**：直接抛出原始 `SyntaxError` 而非可读提示。
- **建议修复**：先读取文本再 `try/catch` 解析 JSON，失败时抛出 `'更新失败，已保留本地数据'`。

### #29 [P3] 情绪备用存档被标为官方接口
- **位置**：[public/js/domain/sentiment.mjs](../public/js/domain/sentiment.mjs#L37-L42)
- **触发条件**：通过备用存档（`whit3rabbit/fear-greed-data`）更新 `2021-02-01` 之后的记录。
- **实际影响**：逐日 CSV 未存获取渠道，前端仍按分界日把表格、提示与导出固定标为「CNN 官方接口」。
- **建议修复**：保留可追溯的获取渠道信息，或在展示文案中明确区分指数归属与数据渠道。

---

## 三、最近一轮审查摘要

- **2026-11-19（全项目接手认知成本与文档双人独立只读审查）**：经双人独立评估并落地第一批改动——将 `AGENTS.md`、`COMMIT_GUIDE.md`、`PROJECT_RELEASE.md` 合一为单文件 `AGENTS.md`，删除过期的 `handoff.md`（并将剩余未修项迁入本台账 `#31`）与已归档的 `workflow-schedule-diagnosis.md`，重写 `README.md`、`docs/architecture.md`、`docs/deployment.md`，并完成首批低风险代码止血（斩断 `overlay.mjs` 靠 `setKDTierFactor` 副作用刷新主图、消除首屏 `deployment.json` 重复请求、补齐 CLI 错误日志与隐式契约注释）。架构拆分项已记入 [技术债清单](./tech-debt.md)。
- **2026-11-16（`#23 / #26 / #27 / #28 / #30` 核实与修复闭环）**：两轮双人独立复审通过，已移入 [历史审查归档](./review-archive.md)。
