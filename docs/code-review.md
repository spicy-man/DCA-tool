# 代码审查台账 (Code Review)

> **使用约定**：本文件仅保留**当前待修 Bug**（顶部概览表 + 下方详细定位）与**最近一轮审查摘要**。
> - 长期重构与工程/文档债务见 [技术债清单](./tech-debt.md)
> - 历史审查过程与已修复归档见 [历史审查归档](./review-archive.md)
> - 已修复并验证通过的 Bug 直接从本文件移出并在归档中留痕，不保留删除线。

---

## 一、当前待修 Bug 概览

| 编号 | 优先级 | 模块 | 问题摘要 |
| --- | --- | --- | --- |
| [#1](#1-high-国内-etf-历史全失败时破坏并覆盖有效收益快照) | **High** | [fund-performance.mjs](../server/fund-performance.mjs#L42-L48) | 国内 ETF 历史全部抓取失败时，`.every()` 空数组恒真覆盖此前有效快照 |
| [#2](#2-medium-清空定投金额或恐慌倍数输入框立即保存为-0--关闭) | **Medium** | [overlay.mjs](../public/js/features/strategy/overlay.mjs#L363-L394) | 编辑时退格清空 `#base-amount` / `#fear-buy-count` 立即将 `0`/停投写入 `localStorage` |
| [#3](#3-medium-组合配比独立舍入可能导致分摊金额之和超过-totalamount) | **Medium** | [overlay.mjs](../public/js/features/strategy/overlay.mjs#L681) | 各标的独立 `Math.round(total * weight) / 100`，合计 100% 时仍可能超出总金额 |
| [#4](#4-low-回测复盘每帧新建-rows-数组导致-weakmap-缓存失效) | **Low** | [chart.mjs](../public/js/features/market/chart.mjs#L84) | `replay` 播放每帧切片创建新数组引用，Pyramid 与 KD 缓存每次 miss |
| [#5](#5-low-kd-月度信号未保留-buyday导致导出-csv-列为空) | **Low** | [kd-strategy.mjs](../public/js/domain/kd-strategy.mjs#L186-L191) | KD 月度信号对象缺少 `buyDay`，导出主图 CSV 时 `BuyDay` 列为空 |
| [#6](#6-low-组合回测缺少数值溢出保护单标的-trades-缺少精度取整) | **Low** | [backtest.mjs](../public/js/domain/backtest.mjs#L135) | `comparePortfolioStrategies` 缺 `Number.isFinite` 校验；`simulate` 的 `trades` 存在浮点尾差 |
| [#7](#7-low-symbol-dialogmjs-在判状态码前先调用-responsejson) | **Low** | [symbol-dialog.mjs](../public/js/ui/symbol-dialog.mjs#L59-L60) | 返回非 JSON 错误体时先抛 `SyntaxError`，导致 `405` 升级提示不可达 |
| [#8](#8-low-本地-http-服务对非法-uri-编码或目录路径返回-500) | **Low** | [http-server.mjs](../server/http-server.mjs#L144-L172) | 请求非法编码或目录路径时落入 500 兜底分支而非 400/404 |
| [#9](#9-low-pagesyml-update-写状态前崩溃仍会部署旧-statusjson) | **Low** | [pages.yml](../.github/workflows/pages.yml#L103-L106) | `update-data.mjs` 在写出 `status.json` 前抛错退出，因 `continue-on-error` 仍部署旧状态 |

---

## 二、问题详细定位与修复建议

### #1 [High] 国内 ETF 历史全失败时破坏并覆盖有效收益快照
- **位置**：[server/fund-performance.mjs](../server/fund-performance.mjs#L42-L48)（测试盲区：[test/fund-performance.test.mjs](../test/fund-performance.test.mjs#L87-L93)）
- **触发条件**：生产中 `server/updater.mjs:32-35` 传入 `loadBenchmarkSnapshot`，从本地磁盘读取 `qqq.json`/`spy.json`（不走网络），此时所有国内 ETF（`.SS`/`.SZ`）的 Yahoo Finance 历史请求全部失败。
- **实际影响**：`histories.filter(row => row.ok)` 为空，`availableDates` 为 `[]`，`availableDates.every(dates => dates.has(date))` 发生空集合恒真（vacuous truth），导致 `endDate` 取 `cutoff` 而不会抛出异常进入保留 `previous` 的 `catch` 分支（L56-L60）。结果返回 `ok: true, complete: false, endDate: cutoff` 且全行 `ok: false`，覆盖掉原先有效的 1/3/5 年收益快照。
- **依据**：`server/fund-performance.mjs:42-48` 未检查 `availableDates.length > 0`；`test/fund-performance.test.mjs:87-92` 的全失败用例未传 `loadBenchmarkSnapshot`，网络先在 `QQQ` 报错，未覆盖生产路径。
- **建议修复**：在计算 `endDate` 前增加 `if (!availableDates.length) throw Error('没有可用的基金历史行情');`，并补充传入 `loadBenchmarkSnapshot` 且所有基金抓取失败的回归测试。

### #2 [Medium] 清空定投金额或恐慌倍数输入框立即保存为 `0` / 关闭
- **位置**：[public/js/features/strategy/overlay.mjs](../public/js/features/strategy/overlay.mjs#L363-L394)（事件绑定：[L1174-L1177](../public/js/features/strategy/overlay.mjs#L1174-L1177)）
- **触发条件**：用户在 `#base-amount` 或 `#fear-buy-count` 输入框退格清空内容（准备输入新数字），触发 `input` 事件且 `value === ''`。
- **实际影响**：`Number('') === 0`。`validBaseAmount(0)` 返回 `true` 且 `rawFearCount !== 0` 为 `false`，`apply()` 会立刻将 `baseAmount = 0` 或 `fearEnabled = false` 写入 `state`、`bySymbol[symbol]`、`allocation.fearEnabled[symbol]` 及 `localStorage`。
- **依据**：`overlay.mjs:365-383` 直接 `Number($(...).value)` 而未检查 `.value.trim() === ''`（对比 [kd.mjs](../public/js/features/strategy/kd.mjs#L99) 已显式拦截 `!input.value.trim()`）。
- **建议修复**：在 `apply()` 中对 `base-amount` 与 `fear-buy-count` 的 `.value.trim() === ''` 做空值拦截（提示输入有效数值并提前 `return`，不覆盖已保存配置）。

### #3 [Medium] 组合配比独立舍入可能导致分摊金额之和超过 `totalAmount`
- **位置**：[public/js/features/strategy/overlay.mjs](../public/js/features/strategy/overlay.mjs#L681)（预览）与 [L1031](../public/js/features/strategy/overlay.mjs#L1031)（保存）
- **触发条件**：总定投金额按各标的百分比独立计算，且乘积存在向上四舍五入（例如 `total = 100.01`，两只标的各 `50%`）。
- **实际影响**：两只标的各自计算 `Math.round(total * weight) / 100` 均得 `50.01`，合计 `100.02 > 100.01`，预览与实际保存金额之和超出总金额。
- **建议修复**：抽取共用纯函数供预览与保存调用，按整数美分（最大余数法）在 `weight > 0` 的已选标的间分配舍入余数，确保 `sumWeight === 100` 时分摊之和精确等于 `total`。

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
