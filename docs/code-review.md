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
| [#10](#10-medium-http-servermjs-本地写接口缺少-host-允许列表校验) | **Medium** | [http-server.mjs](../server/http-server.mjs#L29-L37) | `sameOrigin` 仅比对 `Origin.host === Host` 且允许缺省 `Origin`，存在 DNS Rebinding 风险 |
| [#11](#11-medium-http-servermjs-apirefresh-忽略基金与历史收益失败) | **Medium** | [http-server.mjs](../server/http-server.mjs#L110-L136) | 市场 ETF 成功但基金快照或历史收益失败时仍返回 `HTTP 200` 与空 `errors` |
| [#12](#12-medium-updatermjs-本地-json-缓存损坏导致更新中断) | **Medium** | [updater.mjs](../server/updater.mjs#L25-L26) | `updateFundGroup` / `updateETF` / `run` 读取损坏本地 JSON 时未兜底，无法从上游自愈 |
| [#13](#13-medium-updatermjs--symbolsmjs-自定义标的增删非原子且漏检默认全集) | **Medium** | [updater.mjs](../server/updater.mjs#L297-L308) | 先写 `status.json` 后写 `custom-symbols.json`，且重算 `complete` 未校验默认标的全集 |
| [#14](#14-medium-http-servermjs-局部接口方法head-响应与流解码缺陷) | **Medium** | [http-server.mjs](../server/http-server.mjs#L50-L78) | `/deployment.json` 未限方法、`HEAD` 返回响应体、`/api/symbols` 拼接文本块且 `413` 未销毁流 |
| [#15](#15-low-comparisonmjs-场内基金成交额全为空时误显示-000-亿) | **Low** | [comparison.mjs](../public/js/features/funds/comparison.mjs#L124-L125) | 所有基金 `amount === null` 时 `#fund-turnover` 显示 `0.00 亿` 而非 `—` |
| [#16](#16-low-strategy-summarymjs-summarizefunding-峰值并列使用精确-) | **Low** | [strategy-summary.mjs](../public/js/domain/strategy-summary.mjs#L90-L91) | 单标的峰值月份并列比较使用 `amount === peak`，未统一采用 `1e-9` 容差 |
| [#17](#17-low-backtestmjs-组合回测缺少前置行情顺序与正价格校验) | **Low** | [backtest.mjs](../public/js/domain/backtest.mjs#L252-L278) | `comparePortfolioStrategies` 未复用 `compareStrategies` 的前置日线与正价格校验 |
| [#18](#18-low-geometrymjs--chartmjs--sentimentmjs-零宽度画布产生负间距) | **Low** | [geometry.mjs](../public/js/charts/geometry.mjs#L19) | 画布宽度为 0 或折叠时 `pw < 0` 传入 `createTradingScale` 产生负步距 |
| [#19](#19-low-updatermjs--applicationmjs-csv-解析与导出未转义逗号与公式前缀) | **Low** | [application.mjs](../public/js/application.mjs#L315-L316) | `parseCNN` 拼接 `entry.rating` 与前端导出 CSV 未做引号及表格公式前缀防护 |
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

### #10 [Medium] `http-server.mjs` 本地写接口缺少 `Host` 允许列表校验
- **位置**：[server/http-server.mjs](../server/http-server.mjs#L29-L37)、[server/http-server.mjs](../server/http-server.mjs#L66-L108)
- **触发条件**：`sameOrigin` 仅拒绝 `sec-fetch-site === 'cross-site'`，允许无 `Origin` 请求，且仅对比 `new URL(req.headers.origin).host === req.headers.host` 而未校验 `Host`。在 DNS Rebinding 攻击下，恶意域名解析到 `127.0.0.1` 后浏览器发送 `Sec-Fetch-Site: same-origin` 且 `Origin` 与 `Host` 一致。
- **实际影响**：外部恶意页面（经由 DNS Rebinding）或本机无 `Origin` 请求可调用 `POST/DELETE /api/symbols` 与 `POST /api/refresh`，改动本地数据或触发外网抓取。
- **建议修复**：校验 `req.headers.host` 属于允许的回环地址/配置主机名及监听端口；在兼容无 `Origin` 本地单测的前提下收紧校验或要求自定义请求头。

### #11 [Medium] `http-server.mjs` `/api/refresh` 忽略基金与历史收益失败
- **位置**：[server/http-server.mjs](../server/http-server.mjs#L110-L136)
- **触发条件**：市场 ETF 更新成功（`anyOk === true`），但 `status.funds` 或 `status.funds.performance` 返回 `ok: false` 或 `complete: false`。
- **实际影响**：服务端虽未写入冷却缓存（`L113-114`），但 `L127-135` 仅从 `status.results` 构造 `errors`，导致响应仍为 `HTTP 200` 且 `errors: []`，首页 [application.mjs](../public/js/application.mjs#L286-L305) 无法感知基金更新失败。
- **建议修复**：将 `status.funds` 与 `status.funds.performance` 的错误及未到齐状态汇总进 `errors`，并在全部数据源均失败时返回 `502`。

### #12 [Medium] `updater.mjs` 本地 JSON 缓存损坏导致更新中断
- **位置**：[server/updater.mjs](../server/updater.mjs#L25-L26)、[server/updater.mjs](../server/updater.mjs#L118-L119)、[server/updater.mjs](../server/updater.mjs#L334-L335)、[server/symbols.mjs](../server/symbols.mjs#L7)
- **触发条件**：`status.json`、基金快照或任意 `<symbol>.json` 文件截断或语法损坏时，`updateFundGroup`（`L26`）、`updateETF`（`L119`）、`run`（`L335`）直接调用未保护的 `JSON.parse`。
- **实际影响**：单份本地缓存损坏即阻断自动/手动更新流程（关联 `#9`），必须手动删文件后才能恢复，无法由上游拉取自动覆盖修复。
- **建议修复**：提取 `readJsonOptional(file)` 辅助函数捕获 `SyntaxError`，按缺失缓存返回 `null` 并允许上游重新拉取自愈。

### #13 [Medium] `updater.mjs` / `symbols.mjs` 自定义标的增删非原子且漏检默认全集
- **位置**：[server/updater.mjs](../server/updater.mjs#L297-L308)、[server/symbols.mjs](../server/symbols.mjs#L22-L31)（对照 [public/js/domain/data-health.mjs](../public/js/domain/data-health.mjs#L69-L72)）
- **触发条件**：
  1. `addCustomSymbol` 与 `removeCustomSymbol` 均先写 `status.json` 再写 `custom-symbols.json`，若第二次 `atomicWrite` 失败导致两文件不一致。
  2. 两处均仅以 `status.results.every(complete)` 计算 `status.complete`，未校验 `['Fear & Greed', ...SYMBOLS]` 是否齐全。
- **实际影响**：极端写盘失败后配置列表与状态文件分裂；当 `status.results` 缺少默认标的时可能误置 `status.complete = true`。
- **建议修复**：抽离共享 `complete` 判定（校验默认全集在场），并调整写入顺序或在失败时回滚/读取时对账修复。

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

### #19 [Low] `updater.mjs` / `application.mjs` CSV 解析与导出未转义逗号与公式前缀
- **位置**：[server/updater.mjs](../server/updater.mjs#L76-L77)、[public/js/application.mjs](../public/js/application.mjs#L315-L316)
- **触发条件**：上游 CNN `entry.rating` 含逗号时，`parseCNN` 拼接 CSV 字符串再走 `parseCSV` 会被拆列；前端导出可见情绪 CSV 时未对 `label`/`source` 加引号且未防护 `=`, `+`, `-`, `@` 前缀。
- **实际影响**：上游文案变动时解析脆弱；导出的 CSV 缺少表格公式注入防御纵深。
- **建议修复**：`parseCNN` 直接构造并校验对象；导出 CSV 统一按 RFC-4180 加引号并对公式前缀字符做安全转义。

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

## 三、最近一轮审查摘要（2026-11-13 · v1.17.8）

- **审查范围**：双人独立只读全量审查（服务端、构建/CI 脚本、前端域逻辑/图表/特性/UI、HTML/CSS 与全套测试；两方审查前均未预读台账与技术债文档）。
- **测试验证**：运行 `npm test`（`node --test test/*.test.mjs`），**194 / 194 全部通过**（`0 fail`、`0 skipped`）；未做真实浏览器渲染及线上外部接口实测。
- **新增登记**：确认并登记 **13 项**新待修项（**5 Medium** `#10–#14` + **8 Low** `#15–#22`），保留原 `#9`。
- **已排查排除的关键疑似问题**：
  1. **前端 DOM XSS**：`public/` 下零 `innerHTML` / `outerHTML` / `eval` / 内联事件，外链均有 `rel="noreferrer"` 或 `rel="noopener noreferrer"`。
  2. **静态路径穿越与静态构建隔离**：[http-server.mjs](../server/http-server.mjs#L153) 拦截路径穿越与点文件；[build-site.mjs](../scripts/build-site.mjs) 严格白名单过滤 `public/data/` 并剥离个人标的。
  3. **策略未来函数与跨月顺延**：回测成交、`kd-strategy.mjs` 周线确认、`pyramid-strategy.mjs` 跨月顺延及 `backtest.mjs` 风险指标均按既定规则通过 194 项测试验证。
