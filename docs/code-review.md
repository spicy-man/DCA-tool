# 代码审查台账 (Code Review)

> **使用约定**：本文件仅保留**当前待修 Bug**（顶部概览表 + 下方详细定位）与**最近一轮审查摘要**。
> - 长期重构与工程/文档债务见 [技术债清单](./tech-debt.md)
> - 历史审查过程与已修复归档见 [历史审查归档](./review-archive.md)
> - 已修复并验证通过的 Bug 直接从本文件移出并在归档中留痕，不保留删除线。

---

## 一、当前待修 Bug 概览

| 编号 | 优先级 | 模块 | 问题摘要 |
| --- | --- | --- | --- |
| [#4](#4-low-回测复盘每帧新建-rows-数组导致-weakmap-缓存失效) | **Low** | [chart.mjs](../public/js/features/market/chart.mjs#L84) | `replay` 播放每帧切片创建新数组引用，Pyramid 与 KD 缓存每次 miss |
| [#5](#5-low-kd-月度信号未保留-buyday导致导出-csv-列为空) | **Low** | [kd-strategy.mjs](../public/js/domain/kd-strategy.mjs#L186-L191) | KD 月度信号对象缺少 `buyDay`，导出主图 CSV 时 `BuyDay` 列为空 |
| [#6](#6-low-组合回测缺少数值溢出保护单标的-trades-缺少精度取整) | **Low** | [backtest.mjs](../public/js/domain/backtest.mjs#L135) | `comparePortfolioStrategies` 缺 `Number.isFinite` 校验；`simulate` 的 `trades` 存在浮点尾差 |
| [#7](#7-low-symbol-dialogmjs-在判状态码前先调用-responsejson) | **Low** | [symbol-dialog.mjs](../public/js/ui/symbol-dialog.mjs#L59-L60) | 返回非 JSON 错误体时先抛 `SyntaxError`，导致 `405` 升级提示不可达 |
| [#8](#8-low-本地-http-服务对非法-uri-编码或目录路径返回-500) | **Low** | [http-server.mjs](../server/http-server.mjs#L144-L172) | 请求非法编码或目录路径时落入 500 兜底分支而非 400/404 |
| [#9](#9-low-pagesyml-update-写状态前崩溃仍会部署旧-statusjson) | **Low** | [pages.yml](../.github/workflows/pages.yml#L103-L106) | `update-data.mjs` 在写出 `status.json` 前抛错退出，因 `continue-on-error` 仍部署旧状态 |

---

## 二、问题详细定位与修复建议

### #4 [Low] 回测复盘每帧新建 `rows` 数组导致 `WeakMap` 缓存失效
- **位置**：[public/js/features/market/chart.mjs](../public/js/features/market/chart.mjs#L84)、[overlay.mjs](../public/js/features/strategy/overlay.mjs#L152-L160)、[kd-strategy.mjs](../public/js/domain/kd-strategy.mjs#L120-L124)
- **触发条件**：开启回测复盘播放（`next.replay === true`）。
- **实际影响**：`data.rows.filter(row => row.date <= next.end)` 在每一帧都创建新的数组引用，导致以 `rows` 引用为键的 `WeakMap` 缓存每次 miss，以最高 16 帧/秒重复计算全历史信号（Node 中 SPY 8,504 根日线仅 KD 重算平均约 91ms，超出 62.5ms 帧预算）。
- **建议修复**：按原始 `data.rows` 引用缓存全历史计算状态，再按复盘日期读取已确认结果。

### #5 [Low] KD 月度信号未保留 `buyDay`，导致导出 CSV 列为空
- **位置**：[public/js/domain/kd-strategy.mjs](../public/js/domain/kd-strategy.mjs#L186-L191)
- **触发条件**：主图启用 KD 策略并点击「导出信号 CSV」。
- **实际影响**：KD 月度信号对象未保留原计划日 `buyDay` 字段，导致导出的 CSV 中 `BuyDay` 列为空。
- **建议修复**：生成 KD 月度信号时保留 `buyDay` 字段并补充导出回归断言。

### #6 [Low] 组合回测缺少数值溢出保护，单标的 `trades` 缺少精度取整
- **位置**：[public/js/domain/backtest.mjs](../public/js/domain/backtest.mjs#L135)（单标的）与 [L321-L369](../public/js/domain/backtest.mjs#L321-L369)（组合）
- **触发条件**：组合回测传入极大 `totalBaseAmount`（如 `1e303`，可通过 `validTotalAmount` 校验）；单标的回测使用带两位小数的 `baseAmount`（如组合分摊后的 `333.33`）。
- **实际影响**：`comparePortfolioStrategies` 未像单标的 `simulate()`（L126）那样校验 `[equity, invested, ..., nav].every(Number.isFinite)`，溢出时静默产生 `Infinity`/`NaN`；单标的 `simulate()` 的 `trades` 直接做裸浮点除法（L135），可能显示 `7.000000000000001`，而组合回测（L386）已使用 `Number((...).toFixed(2))`。
- **建议修复**：为组合回测补充 `Number.isFinite` 溢出校验，并在单标的 `trades` 同步加上 `Number((...).toFixed(2))`。

### #7 [Low] `symbol-dialog.mjs` 在判状态码前先调用 `response.json()`
- **位置**：[public/js/ui/symbol-dialog.mjs](../public/js/ui/symbol-dialog.mjs#L59-L60) 与 [L102](../public/js/ui/symbol-dialog.mjs#L102)
- **触发条件**：`/api/symbols` 返回非 JSON 响应体（如代理、静态托管或旧服务返回的 HTML/空响应）。
- **实际影响**：`await response.json()` 先抛出 `SyntaxError`，导致 `if (response.status === 405)` 的友好升级提示无法触达。
- **建议修复**：先判断 `response.status === 405`（或仅在 `response.headers.get('content-type')?.includes('json')` / `try/catch` 下解析 JSON）。

### #8 [Low] 本地 HTTP 服务对非法 URI 编码或目录路径返回 500
- **位置**：[server/http-server.mjs](../server/http-server.mjs#L144)、[L158](../server/http-server.mjs#L158)、[L170-L172](../server/http-server.mjs#L170-L172)
- **触发条件**：客户端请求 `/%E0%A4%A`（`decodeURIComponent` 抛出 `URIError`）或请求目录如 `/js`（`readFile` 抛出 `EISDIR`）。
- **实际影响**：外层 `catch` 仅识别 `ENOENT`（404）与 `ELOCKED`（409），将其余错误统一返回 HTTP 500 `"请求失败，已保留原数据"`。
- **建议修复**：捕获 `URIError` 返回 400，`EISDIR` 返回 404（或 403）。

### #9 [Low] `pages.yml` `update` 写状态前崩溃仍会部署旧 `status.json`
- **位置**：[.github/workflows/pages.yml](../.github/workflows/pages.yml#L103-L106) 与 [scripts/report-data-status.mjs](../scripts/report-data-status.mjs#L4-L19)
- **触发条件**：`scripts/update-data.mjs` 在 `refreshAll` 写出新 `public/data/status.json` 之前抛错退出（如 `FEAR_GREED_SOURCE` 配置非法、已有 `status.json` 损坏或文件锁异常）。
- **实际影响**：`Update sources` 配置了 `continue-on-error: true`，后续 `Build static site` 与 `Deploy` 仍会继续执行并部署上一轮旧 `status.json`（不过 `report-data-status.mjs` 会检测到 `UPDATE_OUTCOME === 'failure'` 并使 Actions 任务失败）。
- **建议修复**：在 `update` 意外失败且未更新 `status.json` 时，跳过部署或向构建产物注入失败状态提示。

---

## 三、最近一轮审查摘要（2026-11-13 · v1.17.0）

- **审查范围**：双人独立只读全量审查（后端、前端、Workflow、测试与全部文档）。
- **验证限制**：审查环境 `PATH` 无 `node` / `npm`，未运行 `node --test`，结论基于静态源码与配置核查。
- **已排查排除的关键疑似问题**：
  1. **回测未来函数与跨月吞单**：月度与 KD 信号均在收盘确认后取 `rows[i + 1]` 开盘成交；`kd-strategy.mjs:65-67` 仅确认已收盘周线；`calculatePyramidSignals` 独立推进 `dueYear/dueMonth`。
  2. **安全边界**：`http-server.mjs:153` 阻止路径穿越与点文件访问；`sameOrigin` 对 `Origin` 做 `try/catch` 校验；`network.mjs` 使用 `execFile` 无 shell；前端无 `innerHTML`。
  3. **Workflow DST 与并发门禁**：`refresh-schedule.mjs` 基于 `17:00:00Z` 动态计算纽约偏移；`queue: max` 串行排队；推送与部署前两次运行 `check-deploy-head.mjs`。
  4. **静态构建隔离**：`build-site.mjs` 使用白名单过滤 `public/data/` 并剥离 `dist/data/status.json` 中的个人标的。
