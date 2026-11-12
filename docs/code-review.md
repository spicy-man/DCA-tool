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

## 八、KD 定投与五策略回测工作区审查（2026-11-11）

两位审查者独立检查了 26 个工作区改动及相关调用路径，主 Agent 复核了发现。首轮为只读审查，59 项定向测试及差异检查通过；下列问题通过补充算例、真实行情计时或调用链确认。

| 优先级 | 问题与证据 | 处理方式 | 状态 |
| --- | --- | --- | --- |
| P2 | [KD 分档](../public/js/domain/kd-strategy.mjs)：周线高 18.10、低 18.00、收 18.09 时，K 应为 90，但浮点尾差使买入从 1N 变成 1.5N。 | 窄幅窗口先按报价的十进制表示求差，分档时再吸收档线附近的浮点尾差；回归测试覆盖窄幅行情恰好命中及确实低于档线的情况。 | 本次修复 |
| P2 | [回测风险指标](../public/js/domain/backtest.mjs)：恒价 $19、两笔各 $1,000 的普通定投出现虚假回撤及夏普、索提诺、MAR；恒定非零收益也可能出现巨大的夏普值。 | 忽略日收益、波动和回撤分母中的浮点尾差；覆盖单标的、组合及恒定收益。 | 本次修复 |
| P2 | [KD 复盘](../public/js/features/market/chart.mjs)：每帧新建行情前缀，导致 KD 缓存失效。用 SPY 的 8,504 根日线在 Node 中测得仅 KD 重算平均约 91 毫秒，超过 16 日／秒档的 62.5 毫秒预算。 | 按原始行情复用 KD 缓存，按复盘日期读取已确认状态；验证与逐日截断一致。尚未做浏览器计时。 | 待处理 |
| P3 | [KD 信号导出](../public/js/domain/kd-strategy.mjs)：KD 月度信号未保留原计划的 `buyDay`，主图 CSV 的 `BuyDay` 列为空。 | 生成 KD 信号时保留原计划字段，并验证 CSV。 | 待处理 |
| P3 | [KD 说明](../public/index.html)：公开站点没有文案所称的「旧版研究」入口。 | 移除该句，或在有公开入口后再提供链接。 | 待处理 |

修复验证：3 个新增回归用例在原实现上均复现失败。最终实现通过 62 项定向测试及 `git diff --check HEAD`；测试覆盖 KD 实际成交金额、恒价入金、恒定收益、小幅真实波动和既有前端联动。

---

## 九、v1.17.0 全量双人审查、Workflow 与文档核查记录（2026-11-13）

两位独立只读审查者分别对全项目源码、`.github/workflows/pages.yml` 及全部 8 份文档进行了交叉审查，主 Agent 逐条核实代码与文档依据。**环境限制**：当前审查环境 `PATH` 无 `node` / `npm`，未实际运行 `node --test`，以下均基于静态源码与配置核查。

### 1. 未解决的 Bug（已核实）

| 优先级 | 位置与问题 | 触发条件与实际影响 | 核实依据 |
| --- | --- | --- | --- |
| High | [基金历史收益](../server/fund-performance.mjs#L42-L48)：全失败时 `.every()` 空数组恒真覆盖有效快照 | 生产中通过 `loadBenchmarkSnapshot` 从本地读取 `qqq.json`/`spy.json`，若所有国内 ETF 历史下载均失败，`availableDates` 为 `[]`，`availableDates.every(...)` 恒真导致 `endDate` 取 `cutoff` 而不抛错，未进入保留 `previous` 的 `catch` 分支，返回 `ok: true, complete: false` 且全行 `ok: false`，覆盖此前有效 1/3/5 年收益快照。 | `server/fund-performance.mjs:42-48` 缺少 `availableDates.length > 0` 校验；`test/fund-performance.test.mjs:87-92` 未覆盖带 `loadBenchmarkSnapshot` 的全失败路径。 |
| Medium | [策略与配比](../public/js/features/strategy/overlay.mjs#L363-L394)：清空 `#base-amount` / `#fear-buy-count` 立即保存为 `0`/关闭 | 用户编辑时退格清空输入框，触发 `input` 事件且 `Number('') === 0`，立即覆盖 `state`、`bySymbol`、`allocation.fearEnabled` 与 `localStorage`（承接第七节第 3 项，仍未修复）。 | `overlay.mjs:365-383` 未拦截 `.value.trim() === ''`（对比 `kd.mjs:99` 已拦截空值）。 |
| Medium | [策略与配比](../public/js/features/strategy/overlay.mjs#L681)：组合配比独立舍入可能超出 `totalAmount` | 各标的独立执行 `Math.round(total * weight) / 100`，如 `100.01` 按 `50% / 50%` 分配得 `50.01 + 50.01 = 100.02`（承接第七节第 4 项，仍未修复）。 | `overlay.mjs:681, 1031` 各自独立四舍五入。 |
| Low | [主图行情](../public/js/features/market/chart.mjs#L84)：回测复盘每帧新建 `rows` 数组 | `replay` 播放时每帧 `data.rows.filter(...)` 创建新数组引用，导致 Pyramid 与 KD 的 `WeakMap` 缓存每次 miss（承接第八节 P2 待处理项）。 | `chart.mjs:84`、`overlay.mjs:152-160`、`kd-strategy.mjs:120-124`。 |
| Low | [KD 策略](../public/js/domain/kd-strategy.mjs#L186-L191)：KD 信号未保留 `buyDay` | 导出主图 CSV 时 KD 月度信号的 `BuyDay` 列为空（承接第八节 P3 待处理项）。 | `kd-strategy.mjs:186-191`。 |
| Low | [组合回测](../public/js/domain/backtest.mjs#L321-L369) & [单标的回测](../public/js/domain/backtest.mjs#L135)：数值溢出与浮点尾数 | `comparePortfolioStrategies` 缺少 `simulate`（`backtest.mjs:126`）的 `Number.isFinite` 溢出保护；单标的 `simulate` 的 `trades` 未做 `.toFixed(2)` 取整，小数定投额下可能显示 `7.000000000000001`。 | `backtest.mjs:126, 135, 321-369, 386`。 |
| Low | [自定义标的弹窗](../public/js/ui/symbol-dialog.mjs#L59-L60)：先解析 JSON 再判状态码 | `/api/symbols` 返回非 JSON 错误体时，`await response.json()` 先抛出 `SyntaxError`，导致 `response.status === 405` 的升级提示不可达。 | `symbol-dialog.mjs:59-60, 102`。 |
| Low | [本地 HTTP 服务](../server/http-server.mjs#L144-L172)：非法 URI 或目录路径返回 500 | 请求 `/%E0%A4%A`（`URIError`）或 `/js`（`EISDIR`）时落入兜底分支返回 500，而非 400/404。 | `http-server.mjs:144, 158, 170-172`。 |
| Low | [Pages 工作流](../.github/workflows/pages.yml#L103-L106)：`update` 写状态前崩溃仍发布旧 `status.json` | 若 `update-data.mjs` 在写入新 `status.json` 前抛错退出，因 `continue-on-error: true`，后续仍会构建并部署上一轮旧 `status.json`（Actions 任务本身会由 `report-data-status.mjs` 标红失败）。 | `pages.yml:106, 154`、`report-data-status.mjs:19`。 |

### 2. 疑似问题与已排查排除项（含依据）

1. **回测未来函数与跨月顺延吞单（已排除）**：月度与 KD 信号均在收盘确认后取 `rows[i + 1]` 开盘成交；`kd-strategy.mjs:65-67` 通过 `isTradingDay` 仅确认已收盘周线；`calculatePyramidSignals` 独立推进 `dueYear/dueMonth`，跨月顺延不会吞掉次月计划。
2. **安全边界：路径穿越 / XSS / 命令注入 / `Origin: null`（已排除）**：`http-server.mjs:153` 校验 `file.startsWith(base + path.sep)` 与点文件拒绝；`sameOrigin` 对 `new URL` 做 `try/catch` 统一返回 403；`server/network.mjs` 使用 `execFile` 参数数组且无 shell；前端 DOM 均采用 `textContent` / `createElement` / `replaceChildren`，无 `innerHTML`。
3. **Workflow DST 切换、冬令时双触发与并发覆盖（已排除）**：`server/refresh-schedule.mjs` 基于 `17:00:00Z` 动态计算纽约偏移，避开凌晨 02:00 切换窗口；冬令时 `19:01 UTC` 同时触发美东 `14:01` 与北京 `03:01` 时 `github.event.schedule` 字符串不同且受 `queue: max` 串行排队；推送与部署前两次调用 `scripts/check-deploy-head.mjs` 防覆盖。
4. **静态构建隔离自定义标的（已排除）**：`scripts/build-site.mjs` 通过白名单过滤 `public/data/` 并剥离 `dist/data/status.json` 中的个人标的。

### 3. 技术债与待同步事项

- **代码层技术债**：
  - [nasdaq-funds.html](../public/nasdaq-funds.html#L11) 与 [sp500-funds.html](../public/sp500-funds.html#L11) 引用 `./style.css` 未带 `?v=<version>` 缓存参数，且 [scripts/version.mjs](../scripts/version.mjs#L12-L27) 未覆盖这两页。
  - [public/index.html](../public/index.html#L281) 仍残留指向不存在的「旧版研究」文案（承接第八节 P3 待处理项）。
  - 组合回测与单标的回测各自维护现金、估值与净值循环（承接第七节备注）。
- **文档层技术债**：
  - `docs/architecture.md`、`docs/deployment.md`、`README.md` 已于本次（2026-11-13）统一对齐当前实现并精简用户向说明。
  - [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#L3) 仍引用已不存在的 `README` MIT 建议方案，且 [L21](../THIRD_PARTY_NOTICES.md#L21)、[L53](../THIRD_PARTY_NOTICES.md#L53) 仍将标普 500 对比基准写为 `VOO`（Vanguard）而非实际已切换的 `SPY`（State Street），待后续统一修订。
