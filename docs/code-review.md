# 代码审查台账 (Code Review)

> **使用约定**：本文件仅保留**当前待修 Bug**（顶部概览表 + 下方详细定位）与**最近一轮审查摘要**。
> - 长期重构与工程/文档债务见 [技术债清单](./tech-debt.md)
> - 历史审查过程与已修复归档见 [历史审查归档](./review-archive.md)
> - 已修复并验证通过的 Bug 直接从本文件移出并在归档中留痕，不保留删除线。

---

## 一、当前待修 Bug 概览

| 编号 | 优先级 | 模块 | 问题摘要 |
| --- | --- | --- | --- |
| [#9](#9-low-pagesyml-update-写状态前崩溃仍会部署旧-statusjson) | **Low** | [pages.yml](../.github/workflows/pages.yml#L103-L106) | `update-data.mjs` 在写出 `status.json` 前抛错退出，因 `continue-on-error` 仍部署旧状态 |
| [#14](#14-medium-http-servermjs-局部接口方法head-响应与流解码缺陷) | **Medium** | [http-server.mjs](../server/http-server.mjs#L50-L78) | `/deployment.json` 未限方法、`HEAD` 返回响应体、`/api/symbols` 拼接文本块且 `413` 未销毁流 |
| [#15](#15-low-comparisonmjs-场内基金成交额全为空时误显示-000-亿) | **Low** | [comparison.mjs](../public/js/features/funds/comparison.mjs#L124-L125) | 所有基金 `amount === null` 时 `#fund-turnover` 显示 `0.00 亿` 而非 `—` |
| [#16](#16-low-strategy-summarymjs-summarizefunding-峰值并列使用精确-) | **Low** | [strategy-summary.mjs](../public/js/domain/strategy-summary.mjs#L90-L91) | 单标的峰值月份并列比较使用 `amount === peak`，未统一采用 `1e-9` 容差 |
| [#17](#17-low-backtestmjs-组合回测缺少前置行情顺序与正价格校验) | **Low** | [backtest.mjs](../public/js/domain/backtest.mjs#L252-L278) | `comparePortfolioStrategies` 未复用 `compareStrategies` 的前置日线与正价格校验 |
| [#18](#18-low-geometrymjs--chartmjs--sentimentmjs-零宽度画布产生负间距) | **Low** | [geometry.mjs](../public/js/charts/geometry.mjs#L19) | 画布宽度为 0 或折叠时 `pw < 0` 传入 `createTradingScale` 产生负步距 |
| [#19](#19-low-updatermjs-parsecnn-拼接-csv-未转义逗号) | **Low** | [updater.mjs](../server/updater.mjs#L76-L77) | `parseCNN` 将 `entry.rating` 拼接为 CSV 字符串后再走 `parseCSV`，含逗号时会被拆列 |
| [#20](#20-low-nasdaq-fundsmjs-仅更新年费时未刷新-profilecheckedat) | **Low** | [nasdaq-funds.mjs](../server/nasdaq-funds.mjs#L72-L73) | `netAssets === null` 且 `annualFee !== null` 时更新 `annualFee` 却不更新 `profileCheckedAt` |
| [#21](#21-low-overlaymjs-localstorage-反序列化未过滤原型键) | **Low** | [overlay.mjs](../public/js/features/strategy/overlay.mjs#L1172-L1202) | 还原 `bySymbol`、`weights`、`fearEnabled` 时未跳过 `__proto__` 等特殊键 |
| [#22](#22-low-data-clientmjs-requestsourcerefresh-未兜底非-json-错误响应) | **Low** | [data-client.mjs](../public/js/services/data-client.mjs#L46-L51) | 非 JSON 错误响应时直接抛出原始 `SyntaxError` 而非上下文失败提示 |

---

## 二、问题详细定位与修复建议

### #9 [Low] `pages.yml` `update` 写状态前崩溃仍会部署旧 `status.json`
- **位置**：[.github/workflows/pages.yml](../.github/workflows/pages.yml#L103-L106) 与 [scripts/report-data-status.mjs](../scripts/report-data-status.mjs#L4-L19)
- **触发条件**：`scripts/update-data.mjs` 在 `refreshAll` 写出新 `public/data/status.json` 之前抛错退出（如 `FEAR_GREED_SOURCE` 配置非法、已有 `status.json` 损坏或文件锁异常）。
- **实际影响**：`Update sources` 配置了 `continue-on-error: true`，后续 `Build static site` 与 `Deploy` 仍会继续执行并部署上一轮旧 `status.json`（不过 `report-data-status.mjs` 会检测到 `UPDATE_OUTCOME === 'failure'` 并使 Actions 任务失败）。
- **建议修复**：在 `update` 意外失败且未更新 `status.json` 时，跳过部署或向构建产物注入失败状态提示。

### #14 [Medium] `http-server.mjs` 局部接口方法、`HEAD` 响应与流解码缺陷
- **位置**：[server/http-server.mjs](../server/http-server.mjs#L50-L78)
- **触发条件**：
  1. `/deployment.json`（`L50-53`）接受任意 HTTP 方法且对 `HEAD` 返回响应体；`/data/custom-symbols.json`（`L55-58`）允许 `HEAD` 但仍通过 `send()` 发送 JSON 响应体。
  2. `/api/symbols`（`L71-78`）直接将 `Buffer` 分片拼接到 `string`，且触发 `413` 时直接 `return` 未销毁请求流。
- **实际影响**：`HEAD` 请求返回响应体违反 HTTP 协议语义；跨 TCP 分片的多字节 UTF-8 字符可能损坏；超大请求体不关闭底层流。
- **建议修复**：`/deployment.json` 限制为 `GET`/`HEAD`；`send()` 在 `req.method === 'HEAD'` 时仅发响应头不写体；`/api/symbols` 收集 `Buffer` 分片后统一解码，超限 `413` 时调用 `req.destroy()`。

### #15 [Low] `comparison.mjs` 场内基金成交额全为空时误显示 `0.00 亿`
- **位置**：[public/js/features/funds/comparison.mjs](../public/js/features/funds/comparison.mjs#L124-L125)
- **触发条件**：快照 `rows.length > 0` 且所有基金行 `amount === null`。
- **实际影响**：`row.amount || 0` 汇总为 `0`，界面 `#fund-turnover` 错误展示 `0.00 亿` 而非 `—`。
- **建议修复**：先过滤 `Number.isFinite(row.amount)`，无有效成交额时显示 `—`。

### #16 [Low] `strategy-summary.mjs` `summarizeFunding` 峰值并列使用精确 `===`
- **位置**：[public/js/domain/strategy-summary.mjs](../public/js/domain/strategy-summary.mjs#L90-L91)
- **触发条件**：单标的回测区间内存在两个月度总金额相等但因浮点累加尾差略微偏离（如 `300.30000000000004` vs `300.3`）的月份。
- **实际影响**：`summarizeFunding` 可能遗漏真实并列的高峰月份（而同文件 `summarizeAnnualPeak` 与 `summarizePortfolioFunding` 已使用 `peak > 0` 与 `1e-9` 容差）。
- **建议修复**：统一改用 `peak > 0` 与 `Math.abs(amount - peak) < 1e-9`。

### #17 [Low] `backtest.mjs` 组合回测缺少前置行情顺序与正价格校验
- **位置**：[public/js/domain/backtest.mjs](../public/js/domain/backtest.mjs#L252-L278)（对照 `L169-175`）
- **触发条件**：直接调用 `comparePortfolioStrategies` 且传入未经过 `normalizeYahoo` 校验的乱序或零价格 `rows`（如 `open: 0`）。
- **实际影响**：`L355` 发生除以 `0` 得到 `Infinity`，最终在 `L366-367` 抛出「回测金额超出可计算范围」而非行情数据无效提示。
- **建议修复**：与 `compareStrategies` 共用同一日线递增与正价格前置校验函数。

### #18 [Low] `geometry.mjs` / `chart.mjs` / `sentiment.mjs` 零宽度画布产生负间距
- **位置**：[public/js/charts/geometry.mjs](../public/js/charts/geometry.mjs#L19)、[public/js/features/market/chart.mjs](../public/js/features/market/chart.mjs#L161-L170)、[public/js/charts/sentiment.mjs](../public/js/charts/sentiment.mjs#L22-L26)
- **触发条件**：图表容器折叠或 `clientWidth === 0` 时调用重绘，扣除右侧坐标轴留白后 `pw < 0` 传入 `createTradingScale`。
- **实际影响**：`spacing` 为负值，坐标轴映射方向反转。
- **建议修复**：绘制入口对 `pw <= 0 || ph <= 0` 提前返回，并在 `createTradingScale` 中对非正宽度做保护。

### #19 [Low] `updater.mjs` `parseCNN` 拼接 CSV 未转义逗号
- **位置**：[server/updater.mjs](../server/updater.mjs#L76-L77)
- **触发条件**：上游 CNN `entry.rating` 含逗号时，`parseCNN` 拼接 CSV 字符串再走 `parseCSV` 会被拆列（前端 CSV 导出已通过 [download.mjs](../public/js/ui/download.mjs#L1-L8) 统一转义与防公式注入）。
- **实际影响**：上游文案变动时解析脆弱。
- **建议修复**：`parseCNN` 直接构造并校验对象，不再经由 CSV 字符串拼接中转。

### #20 [Low] `nasdaq-funds.mjs` 仅更新年费时未刷新 `profileCheckedAt`
- **位置**：[server/nasdaq-funds.mjs](../server/nasdaq-funds.mjs#L72-L73)
- **触发条件**：F10 页面仅解析出 `annualFee` 而 `netAssets === null`。
- **实际影响**：`profile.annualFee` 已被新值覆盖，但 `profileCheckedAt` 仍停留在旧时间戳。
- **建议修复**：任一档案字段成功更新时刷新对应核对时间（或拆分资产规模与费率核对时间）。

### #21 [Low] `overlay.mjs` `localStorage` 反序列化未过滤原型键
- **位置**：[public/js/features/strategy/overlay.mjs](../public/js/features/strategy/overlay.mjs#L1172-L1202)
- **触发条件**：`localStorage` 中的 `bySymbol`、`weights` 或 `fearEnabled` JSON 被篡改并包含 `__proto__` 键。
- **实际影响**：`obj['__proto__'] = val` 可能篡改局部映射对象自身原型（属本地存储可写场景下的防御纵深问题）。
- **建议修复**：还原键名时过滤 `__proto__` / `constructor` / `prototype`（或使用 `validSymbol` / `Object.create(null)`）。

### #22 [Low] `data-client.mjs` `requestSourceRefresh` 未兜底非 JSON 错误响应
- **位置**：[public/js/services/data-client.mjs](../public/js/services/data-client.mjs#L46-L51)
- **触发条件**：代理或异常路径对 `/api/refresh` 返回 HTML/纯文本错误页（如 `502 Bad Gateway`）。
- **实际影响**：`await response.json()` 直接抛出原始 `SyntaxError` 而非上下文失败提示。
- **建议修复**：先读取文本再 `try/catch` 解析 JSON，解析失败时抛出 `'更新失败，已保留本地数据'`。

---

## 三、最近一轮审查摘要（2026-11-16 · `v2.2.7` 提交及全量代码审查与修复闭环）

- **审查范围**：提交 `ff8488b`（`v2.2.7`）及完整运行时代码库（`server/`、`public/`、`scripts/`、`start.cmd`、`start.command`、`.github/workflows/`、`test/`）；经首轮只读双人独立审查 + 方案确认后修复 + 第二轮（识别并修复 `floating-charts.mjs` `show(visible)` 回归）+ 第三轮双人独立复审闭环（两方审查前均未预读台账与技术债文档），完整闭环记录已归档至 [历史审查归档](./review-archive.md)。
- **发现与处置**：修复了 6 项有效发现（`status.funds` 落盘与前后端状态展示、主图隐藏态与悬浮小窗联动、自定义标的前端内存缓存/弹窗文案/后端原子回滚与 `requestedComplete` 计算、`sameOrigin` IPv6 `HOST` 与畸形 `Host` 拦截、基金对比页加载失败提示、CSV 公式注入前导换行/空格防护）及第二轮识别的 `floating-charts.mjs` 重复挂载回归；第三轮两方独立复审均未发现未解决的有效问题，保留原待修台账 `#9, #14–#22`（其中 `#19` 收窄为 `updater.mjs` `parseCNN`）不变。
- **测试验证**：`node --test test/*.test.mjs` **215 / 215 全部通过**。
