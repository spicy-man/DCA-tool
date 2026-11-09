# 代码审查与修复记录 (Code Review Log)

> 记录日期：2026-10-21  
> 审查版本：v1.8.3  
> 审查机制：依据 `AGENTS.md` / `COMMIT_GUIDE.md` 规范执行的双人独立审查（Reviewer A 与 Reviewer B）及修复闭环。

---

## 一、 审查背景与范围

用户要求对整个项目进行全面代码审查（Code Review）。按照项目规范，启动两个独立的只读 Reviewer 子代理（Reviewer A 与 Reviewer B）分别对全项目代码进行独立排查，主 Agent 汇总、核实、修复并运行定向测试，随后由两个 Reviewer 分别进行第二轮独立复审，直至两方均确认无未解决的有效问题。

### 审查覆盖范围
- **领域计算层 (`public/js/domain/`)**：`backtest.mjs`、`data-health.mjs`、`fear-strategy.mjs`、`market.mjs`、`pyramid-strategy.mjs`、`sentiment.mjs`、`strategy-summary.mjs`、`trading-calendar.mjs`
- **前端视图与服务层 (`public/js/`)**：`app.mjs`、`application.mjs`、`charts/*`、`features/*`、`services/*`、`ui/*`、`index.html`、`style.css`
- **服务端 (`server.mjs`, `server/`)**：`http-server.mjs`、`network.mjs`、`refresh-schedule.mjs`、`sentiment-history.mjs`、`storage.mjs`、`symbols.mjs`、`updater.mjs`
- **构建与运维脚本 (`scripts/`, `.github/workflows/`)**：`build-site.mjs`、`check-deploy-head.mjs`、`refresh-schedule.mjs`、`report-data-status.mjs`、`sync-version.mjs`、`update-data.mjs`、`version.mjs`、`pages.yml`
- **文档与测试集 (`docs/`, `test/`)**：`docs/architecture.md`、`docs/deployment.md`、`README.md`、`test/*.test.mjs`

---

## 二、 发现问题与修复详情

### 1. 静态构建白名单过滤与本地自定义标的隔离
- **涉及文件**：`scripts/build-site.mjs`、`.gitignore`
- **问题描述**：
  - `build-site.mjs` 原本通过简单的非隐藏、非 `.tmp` 规则整体复制 `public/` 到 `dist/`。当用户在本地使用过自定义标的功能后，`public/data/` 下会生成 `custom-symbols.json` 及个人标的缓存（例如 `voo.json`、`aapl.json`），静态构建会将其无意复制到静态发布目录 `dist/data/` 中，违背了在线站点仅展示内置标的、个人标的仅限本地的设计原则。
  - 另外，`.gitignore` 未忽略 `public/data/custom-symbols.json`，存在误提交风险。
- **修复措施**：
  - 在 `scripts/build-site.mjs` 中对 `public/data/` 目录设置公开白名单 `publicDataFiles = new Set(['fear-greed.csv', 'status.json', ...SYMBOLS.map(s => s.toLowerCase() + '.json')])`，非白名单文件不复制到 `dist/data/`。
  - 在 `.gitignore` 中加入 `public/data/custom-symbols.json`。
  - 遵守数据保护原则，保留用户本地已有的 `public/data/voo.json` 缓存文件，不进行破坏性删除。

### 2. 跨站 `Origin` 头安全解析与文件锁冲突错误码透传
- **涉及文件**：`server/http-server.mjs`、`server/storage.mjs`
- **问题描述**：
  - `/api/symbols` 与 `/api/refresh` 接口直接调用 `new URL(req.headers.origin)`。当请求携带浏览器在沙盒 iframe、`file://` 等跨域请求下发送的合规序列化标头 `Origin: null`，或任何非法 URL 字符串时，会抛出 `TypeError: Invalid URL`，被顶层 `catch` 捕获后返回 HTTP 500，破坏了本应返回 403（跨站拦截）的契约。
  - 当 `addCustomSymbol` 正在下载行情持有 `.refresh.lock`，或存在进程异常残留锁时，调用 `/api/refresh` 触发 `withDataLock` 冲突抛出错误，但 `/api/refresh` 的顶层 `catch` 同样返回 HTTP 500 `"请求失败，已保留原数据"`，导致锁占用的明确诊断提示无法传达给前端。
- **修复措施**：
  - 在 `server/http-server.mjs` 中提取 `sameOrigin(req)` 辅助函数，内部使用 `try / catch` 安全调用 `new URL(req.headers.origin)`，解析失败或跨站均统一返回 403。
  - 在 `server/storage.mjs` 的 `withDataLock` 中为锁冲突错误标记 `lockError.code = 'ELOCKED'`。
  - 在 `server/http-server.mjs` 的顶层 `catch` 中识别 `error.code === 'ELOCKED'`，返回 HTTP 409 及具体错误信息，使前端能够准确感知并发冲突原因。

### 3. 自定义标的增删后的 `status.json` 与页头 `#status` 同步
- **涉及文件**：`server/updater.mjs`、`public/js/services/events.mjs`、`public/js/ui/symbol-dialog.mjs`、`public/js/application.mjs`
- **问题描述**：
  - `addCustomSymbol` 成功下载新标的行情并写入 `custom-symbols.json` 后，未同步将新标的的检查记录写入 `status.json`。
  - 前端 `symbol-dialog.mjs` 在添加或删除自定义标的成功后，没有通知 `application.mjs` 重新执行 `loadHealth()`，导致顶部 `#status` 状态栏残留已删除标的的报错，或缺失刚添加标的的状态。
- **修复措施**：
  - 在 `server/updater.mjs` 的 `addCustomSymbol` 中，当 `status.json` 存在时构造新标的的健康条目并更新 `results`、`complete` 与 `requestedComplete`。
  - 在 `public/js/services/events.mjs` 中新增 `sourceHealth: 'source-health'` 事件。
  - 在 `public/js/ui/symbol-dialog.mjs` 添加、删除标的成功后，通过应用内通道派发 `appEvents.dispatchEvent(new Event(events.sourceHealth))`。
  - 在 `public/js/application.mjs` 中监听该事件并调用 `loadHealth()`，实现前端状态实时联动。

### 4. 前端空日历边界防护与情绪 CSV 导出标签一致性
- **涉及文件**：`public/js/application.mjs`
- **问题描述**：
  - 当数据初次加载中或极端空日历状态下，用户点击“回到最新”（`#latest`）或切换“FNG起始至今”时，直接读取 `bounds().end` 会得到 `NaN` 并赋值给 `#timeline.value`。
  - 点击“导出指数 CSV”时，原本使用重算的驼峰值 `rating(r.score)`，与官方原始评级标签 `r.label` 及后端保持的口径存在轻微偏差。
- **修复措施**：
  - 在 `render()`、`#range` 切换监听、`#latest` 点击监听和 `resetWindow()` 中增加 `calendar.length` 有效性守卫。
  - 情绪 CSV 导出列改为 `r.label || rating(r.score)`，与 CNN 官方原始标签保持一致。

### 5. NYSE 历史特殊休市日补齐与文档同步
- **涉及文件**：`public/js/domain/trading-calendar.mjs`、`docs/deployment.md`、`docs/architecture.md`
- **问题描述**：
  - SPY 历史始于 1993-01-29，`SPECIAL_CLOSURES` 遗漏了 1994-04-27（前总统尼克松葬礼 NYSE 全天休市日）。
  - `docs/deployment.md` 中 `REFRESH_SOURCES` 示例遗漏了已作为内置标的的 `SMH`。
  - `docs/architecture.md` 中的目录树与 `style.css` 级联顺序说明未包含后续新增的样式文件与服务模块。
- **修复措施**：
  - 在 `trading-calendar.mjs` 中将 `'1994-04-27'` 加入 `SPECIAL_CLOSURES`。
  - 更新 `docs/deployment.md` 与 `docs/architecture.md`，使文档与当前技术实现严格一致。

---

## 三、 排查后排除的疑似问题及依据

在审查过程中，对以下潜在逻辑风险进行了深入推演，确认现有实现合理无缺陷并记录排除依据：

1. **回测时间偏误（Look-ahead Bias）与信号成交时点**：
   - 月度金字塔信号在收盘确定后，在回测中取 `rows[i + 1]`（下一交易日）开盘价成交；恐慌加投信号在生成时已映射为信号日后的首个可用交易日并在该日开盘价买入，未出现偷窥未来或重复顺延问题。
2. **金字塔定投月末对齐与跨月休市顺延**：
   - `calculatePyramidSignals` 采用独立的 `dueYear` / `dueMonth` 游标推进所属月份，2 月底休市顺延至 3 月初执行的定投只推进 2 月指标，3 月底仍会正常生成 3 月计划，不会吞掉正常定投。
3. **单位净值（NAV）与最大回撤计算口径**：
   - 净值模拟严格按照：前日留存现金复利计息 → 当日开盘资产折算入金新增份额 → 执行股票买入 → 日终收盘资产计算收盘净值 `nav` 并更新 `peak`。该口径完全符合 `public/index.html` 与 `test/backtest.test.mjs` 的既定规范。
4. **浮动小窗（Floating Charts）布局切换与占位高度**：
   - 页面顶部布局选择器位于非吸顶的 `.masthead` 中，当页面滚动至主图脱离视口触发浮动小窗时，`.masthead` 已滚动在屏幕外；向上滚动看到布局选择器之前，小窗已恢复至主文档流，不会在浮动态下发生占位高度跳动。

---

## 四、 验证结果

针对上述修改，在 `test/backend.test.mjs`、`test/custom-symbols.test.mjs`、`test/symbol-dialog.test.mjs` 中补充了针对性回归测试断言，并运行了核心定向测试集：

```sh
node --test test/backend.test.mjs test/custom-symbols.test.mjs test/symbol-dialog.test.mjs test/application-calendar.test.mjs test/architecture.test.mjs
```

**测试结果**：46 项测试全部通过（46 pass, 0 fail, 0 error）。

---

## 五、 复审结论

两名独立审查者（Reviewer A 与 Reviewer B）分别对包含修复代码的全项目进行了第二轮独立复审，两方一致确认：
- 第一轮指出的有效问题已全部妥善修复；
- 修复未引入新的逻辑缺陷、安全隐患或性能回归；
- **两方审查本轮均未发现未解决的有效问题**（依据规范，不承诺绝对零 bug）。

---

## 六、 工作区复核补充：公开状态中的个人标的隔离

后续工作区只读复核发现，第 1 项的文件白名单仍会原样复制 `status.json`，个人标的的代码与检查状态可能随静态产物发布，页头也会展示这些条目。因此该项隔离在原修复后仍有遗漏。

本次补充修复：`scripts/build-site.mjs` 仅在构建输出中将 `status.results` 和 `status.requestedSources` 过滤为恐慌与贪婪指数及内置标的，并重算 `complete`、`requestedComplete`；本地状态、个人列表和行情缓存保持原样。公开来源缺失或失败时仍判定整体未到齐。

新增 `test/build-site.test.mjs`，在隔离临时项目中运行实际构建，覆盖个人文件与状态过滤、本地文件不变、公开来源失败或缺失、仅个人来源的更新批次，以及没有状态文件的情形。

实际运行：

```sh
node --test test/build-site.test.mjs test/backend.test.mjs test/custom-symbols.test.mjs test/symbol-dialog.test.mjs test/application-calendar.test.mjs test/architecture.test.mjs
```

结果：47 项测试通过，0 项失败（原记录的 46 项加新增构建回归测试）。构建验证仅生成临时目录中的产物，未更新真实快照。

---

## 七、v1.14.0 定投配比与组合回测审查

2026-11-09 对发版提交 `f6083a9` 进行一轮双人独立只读审查，覆盖组合回测、资金摘要、配比设置、行情缓存和 BRK-B 接入。整体质量中等。BRK-B 的行情、构建与前端链路完整。使用五只标的的真实快照逐一验证时，单标的组合的核心回测指标与原单标的实现一致。

### 已确认问题（待修复）

1. **资金摘要与回测成交口径不同。** 摘要按月度信号日统计，回测按下一交易日开盘成交。恒价日线算例中，摘要显示累计买入 200，回测实际投入 100，差额来自区间末尾尚未成交的信号。跨月成交也会被归到信号所在月，影响峰值月份。建议共用成交订单，覆盖跨月和区间末尾两种边界。相关代码见 [资金摘要](../public/js/domain/strategy-summary.mjs) 和 [组合回测](../public/js/domain/backtest.mjs)。
2. **组合可能混用旧行情或复盘截断行情。** 刷新行情时，组合缓存中的非当前标的可能继续使用旧快照。复盘时，截断日线会写入同一缓存，导致「起始至今」的组合回测少算当前标的的一段历史。建议统一完整行情的缓存与失效规则，将复盘切片留在复盘视图。相关代码见 [主图行情](../public/js/features/market/chart.mjs) 和 [策略与配比](../public/js/features/strategy/overlay.mjs)。
3. **清空输入会保存为停投。** 隔离 Chrome 实测，清空定投金额会把 2000 保存为 0，清空恐慌加投倍数会关闭加投。建议区分编辑中的空值和显式输入的 0，前者保留上次有效设置。相关代码见 [策略与配比](../public/js/features/strategy/overlay.mjs)。
4. **配比合计 100% 仍可能超出总金额。** 100.01 按 50/50 分配时，两份各舍入为 50.01，合计 100.02。建议以整数分分配舍入余数，预览和保存共用计算结果。相关代码见 [策略与配比](../public/js/features/strategy/overlay.mjs)。
5. **窄屏下标的名被完全裁切。** Chrome 在 320 px 视口下测得五个标的名所在列的宽度均为 0。建议在窄屏允许金额预览和恐慌加投开关换行，保证标的名可见。相关代码见 [配比布局](../public/css/page.css)。

优先修复成交口径和缓存一致性，再分别处理输入、舍入和窄屏布局。组合与单标的回测各自实现了现金、估值和净值逻辑，后续调整这些规则时应明确哪些行为需要共用。

本轮差异检查和 39 项定向测试通过。上述问题由算例、隔离浏览器或调用链核实。审查未修改应用代码，修复和复审待执行。

### 独立复核判断与推荐修复方案（2026-11-09）

经双人独立只读审查与主 Agent 核实，上述 **5 项待修复问题全部成立**，定位准确、修复优先级合理。在落地修复时需补充以下关键边界约束与遗漏项：

#### 1. 资金摘要与回测成交口径不同 — **成立（需注意边界与作用范围）**
- **核实依据**：
  - [`summarizePortfolioFunding`](../public/js/domain/strategy-summary.mjs)（第 103–112 行）直接遍历 `[...monthlySignals, ...fearSignals]`，按月度收盘信号日 `signal.date` 统计累计买入（`total`）和单月峰值（`monthly`）。
  - [`comparePortfolioStrategies`](../public/js/domain/backtest.mjs)（第 171–176 行）将月度信号映射到下一交易日 `fill = rows[i + 1]` 开盘成交。
  - 这导致配比弹窗（[`updatePreview`](../public/js/features/strategy/overlay.mjs) 第 621–649 行）同屏展示的「累计买入」与下方组合回测表的「投入本金」不一致，且在以下 **3 种边界**出现偏差：
    1. **区间末尾未成交信号**：最后一根日线触发月度信号时，`rows[i + 1]` 不存在，摘要多算一笔；
    2. **跨月成交**：月末最后交易日收盘信号在次月首交易日开盘成交，摘要归入上月、回测归入次月（且同函数内 `fearSignals` 已是下一交易日成交日，导致月度与恐慌口径内部也不统一）；
    3. **区间起点跨界信号（补充边界）**：若 `fngStart` 前一交易日触发月度信号、于 `fngStart` 当日开盘成交，`comparePortfolioStrategies`（第 169–175 行）按 `inRange(fill.date)` 会纳入回测，而 `summarizePortfolioFunding`（第 104 行）因 `signal.date < fngStart` 会将其漏算。
- **推荐方案**：
  - **仅在组合层对齐成交订单，保持单标的 [`summarizeFunding`](../public/js/domain/strategy-summary.mjs)（第 43–79 行）原有信号口径不变**。主页面「历史资金需求」明确定义为按信号统计（`X 笔信号`），且单标的回测有 `deferredMonthly` 专门说明未成交笔数；改动单标的 `summarizeFunding` 会破坏主页面语义及现有测试契约。
  - 在组合层提取统一的成交订单构建逻辑供 `summarizePortfolioFunding` 与 `comparePortfolioStrategies` 共用：基于完整 `rows` 计算月度信号后映射为 `rows[i + 1]` 成交日，再按成交日过滤 `[itemStart, itemEnd]`，一次性覆盖**起点跨界、跨月顺延、末尾未成交**全部三种边界，并同步更新 [`test/strategy-summary.test.mjs`](../test/strategy-summary.test.mjs)（第 221–268 行）中的组合算例断言。

#### 2. 组合可能混用旧行情或复盘截断行情 — **成立**
- **核实依据**：
  - **复盘截断污染**：[`renderMarket`](../public/js/features/market/chart.mjs)（第 81–82 行）在 `next.replay` 为真时构造截断日线传给 [`updateSignals`](../public/js/features/strategy/overlay.mjs)（第 121–124 行），后者无条件执行 `marketRowsBySymbol.set(data.symbol, data.rows)`，覆盖了完整历史缓存；若复盘中途打开配比弹窗或切换标的，当前标的将缺失 `replay.end` 之后的历史。
  - **刷新残留旧快照**：点击「更新数据」调用 [`invalidateMarket`](../public/js/features/market/chart.mjs)（第 68–71 行）仅清空 `chart.mjs` 的 `store`，未清理 `overlay.mjs` 的 `marketRowsBySymbol` 与 `failedSymbols`。
- **推荐方案**：
  - 在 `updateSignals`（第 121–124 行）中仅当 `!next.replay` 时才写入 `marketRowsBySymbol`。
  - 提供缓存失效函数（或在 `invalidateMarket` 时联动清理 `marketRowsBySymbol` 与 `failedSymbols`），并增加**缓存代次（epoch）校验**，防止刷新前在途的异步 [`ensureMarketRows`](../public/js/features/strategy/overlay.mjs)（第 481–502 行）请求在刷新后晚到并回写旧快照。

#### 3. 清空输入会保存为停投 — **成立**
- **核实依据**：
  - [`#base-amount` 与 `#fear-buy-count`](../public/js/features/strategy/overlay.mjs)（第 910–913 行）监听 `input` 事件实时触发 [`apply`](../public/js/features/strategy/overlay.mjs)（第 326–357 行）。当用户退格清空输入框时，`Number("") === 0`，而 `0` 在 v1.14.0 中是合法的停投/关闭加投值，导致编辑途中的空值立即覆盖 `state`、`bySymbol`、`allocation.fearEnabled` 和 `localStorage`。
- **推荐方案**：
  - 在 `apply`（第 326–346 行）中先检查 `.value.trim() === ''`：若为空字符串则视为未完成输入（按无效值提前 `return`，不改写内存状态与 `localStorage`）。用户若清空后直接切换标的，[`syncControlsForSymbol`](../public/js/features/strategy/overlay.mjs)（第 75–84 行）会自动恢复该标的上次保存的有效值。

#### 4. 配比合计 100% 仍可能超出总金额 — **成立（需区分 100% 与非 100% 场景）**
- **核实依据**：
  - [`updatePreview`](../public/js/features/strategy/overlay.mjs)（第 521 行）与 `form` 提交（第 789 行）均对各标的独立执行 `Math.round(total * weight) / 100`，导致 `100.01` 按 `50% / 50%` 分配时各自得 `50.01`（合计 `100.02`）。
- **推荐方案**：
  - 抽取共用纯函数供预览与保存调用，按整数美分（最大余数法 Largest Remainder Method）分配舍入余数。
  - **关键边界约束**：系统允许部分分配（如 `50% + 30% = 80%`）。最大余数法应以 `targetCents = Math.round(total * sumWeight)`（当 `Math.abs(sumWeight - 100) < 1e-6` 时 `targetCents = Math.round(total * 100)`）为目标总分值，仅在 `weight > 0` 的已选标的间按余数分配差额美分，不能把未分配的 `20%` 份额摊给已选标的；单标的配比时结果与原 `Math.round(total * weight) / 100` 保持完全一致。

#### 5. 窄屏下标的名被完全裁切 — **成立**
- **核实依据**：
  - [`#allocation-list li`](../public/css/page.css)（第 66 行）采用四列单行网格 `grid-template-columns: minmax(0, 1fr) auto minmax(88px, auto) auto; gap: 10px`。在 320px 视口下弹窗内容区仅宽 `238px`，后三列及间距占约 `267px`，导致首列 `.allocation-symbol-label` 宽度被压缩为 `0px`。
- **推荐方案**：
  - 在 [`public/css/page.css`](../public/css/page.css)（第 53–73 行）增加窄屏断点（如 `@media (max-width: 600px)`），将 `#allocation-dialog` 内边距收紧为 `16px`，并将 `#allocation-list li` 改为两列两行网格（`grid-template-columns: minmax(0, 1fr) auto`）：首行展示「标的名 + 配比输入」，次行展示「`1N` 金额预览 + 恐慌加投开关」，同时为 `.allocation-estimate-head` 增加 `flex-wrap: wrap`。

#### 补充发现（建议一并处理）
1. **单标的回测 `trades`（买入 N 数）在小数定投金额下存在浮点尾数**：
   - **位置**：[`simulate`](../public/js/domain/backtest.mjs)（第 105 行）对比 [`comparePortfolioStrategies`](../public/js/domain/backtest.mjs)（第 303 行）。
   - **依据**：组合回测对 `trades` 做了 `Number((totalOrderAmount / baseDenom).toFixed(2))` 舍入，而单标的 `simulate`（第 105 行）仍为裸浮点除法 `orders.reduce(...) / baseAmount`。通过配比填入带两位小数的 `baseAmount`（如 `333.33`）后，累计 7N 买入在单标的回测表中会显示为 `7.000000000000001`。建议在 `simulate` 第 105 行同步加上 `Number((...).toFixed(2))`。
2. **文档默认标的列表描述未同步 `BRK-B`**：
   - **位置**：[`README.md`](../README.md)（第 15、162、176 行）、[`docs/deployment.md`](./deployment.md)（第 16 行）仍写着四只内置标的，未列入 `BRK-B`（代码链路本身已完整接入）。
