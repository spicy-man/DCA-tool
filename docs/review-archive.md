# 历史代码审查归档 (Review Archive)

> 本文件归档已完成或已被后续版本取代的历史审查过程记录。当前活跃的待修 Bug 请见 [代码审查台账](./code-review.md)，长期重构项见 [技术债清单](./tech-debt.md)。

---

## 代码审查台账 `#23 / #26 / #27 / #28 / #30` 核实与修复闭环（2026-11-16）

- **已修复台账项**：
  1. `#23` **删除自定义标的误删基金快照保护**（[symbols.mjs](../server/symbols.mjs#L8-L16)、[updater.mjs](../server/updater.mjs#L306)、[custom-symbols.test.mjs](../test/custom-symbols.test.mjs#L219-L244)）：新增 `isReservedSymbolFile` 保护 `custom-symbols.json`、`status.json` 及 `FUND_GROUPS` 中的 `nasdaq100-etfs.json` / `sp500-etfs.json`，在 `removeCustomSymbol` 与 `addCustomSymbol` 统一拒绝；`removeCustomSymbol` 在 `withDataLock` 内校验目标是否确在 `custom-symbols.json` 中，未登记目标幂等返回而不删文件、不写盘。
  2. `#26` **情绪快照首载失败降级渲染行情与回测**（[application.mjs](../public/js/application.mjs#L209-L620)、[application-calendar.test.mjs](../test/application-calendar.test.mjs#L739-L799)）：将 `render`、`mini`、时间轴拖动、`attachChartNavigation`、`ResizeObserver`、`marketCalendar` 监听、`visibilitychange` 恢复与字体重绘的门控由 `rows.length` 改为 `calendar.length`；`range === 'sentiment'` 无情绪数据时安全回退至 `'all'` 并显示「情绪指数暂不可用」，保障行情与单标的回测正常展示。
  3. `#27` **内置标的缺失交易日检查与全链路状态联动**（[market.mjs](../public/js/domain/market.mjs#L5-L15)、[updater.mjs](../server/updater.mjs#L125-L448)、[data-health.mjs](../public/js/domain/data-health.mjs#L19-L128)、[symbols.mjs](../server/symbols.mjs#L48-L55)、[build-site.mjs](../scripts/build-site.mjs#L62-L67)、[refresh-schedule.mjs](../server/refresh-schedule.mjs#L11)、[backend.test.mjs](../test/backend.test.mjs#L680-L714)、[data-health.test.mjs](../test/data-health.test.mjs#L86-L93)、[build-site.test.mjs](../test/build-site.test.mjs#L79-L89)、[refresh-schedule.test.mjs](../test/refresh-schedule.test.mjs#L69-L79)）：新增 `findMissingTradingDays` 校验内置标的覆盖区间内的 NYSE 交易日连续性；`snapshot`、`updateETF`（含 `retained` 分支）、`run`、`isStatusComplete`、`healthSummary`、`hasBlockingDataGap`、`syncRequestedComplete`、`buildSite` 与 `scheduledSources(..., { catchUp: true })` 统一检查 `fresh !== false && !missingDates?.length`，缺日时标为数据不完整并允许后续自动补抓自愈。
  4. `#28` **情绪快照未来日期拦截与旧污染点清理**（[updater.mjs](../server/updater.mjs#L67-L281)、[backend.test.mjs](../test/backend.test.mjs#L716-L743)）：`parseCNN` 与 `validateSentimentAge` 按 UTC 口径拒绝 `> today` 的未来日期并加入 `validationFailure` 白名单；`snapshot` 与 `updateSentiment` 读取旧 `fear-greed.csv` 时过滤 `<= today` 的记录，防止异常未来点通过 `preserveHistory` 阻断后续正常刷新或误报 `fresh: true`。
  5. `#30` **前高修复虚线随当前选定主策略切换**（[overlay.mjs](../public/js/features/strategy/overlay.mjs#L231-L237)、[backtest.mjs](../public/js/features/strategy/backtest.mjs#L8-L92)、[index.html](../public/index.html#L446)、[frontend-regressions.test.mjs](../test/frontend-regressions.test.mjs#L1110-L1185)）：`overlay.mjs` 初始/同步及点击主策略开关（`events.strategyView` 携带 `{ detail: viewStrategy }`）均向回测模块同步策略；`backtest.mjs` 维护 `activeStrategy` 并监听 `events.strategyView`，仅重绘前高修复虚线与颜色而不重置复盘或重建结果表（三策略调用仍安全回退至 `combined`）；同步更新 `public/index.html` 说明文案。
- **范围、轮次与验证**：经历两轮双人独立只读复审闭环（两方审查前均未预读 `docs/code-review.md` 与 `docs/tech-debt.md`；第 1 轮后补齐 `scripts/build-site.mjs`、`server/refresh-schedule.mjs` 及 `overlay.mjs`/`backtest.mjs` 主策略按钮联动；第 2 轮两方对最终代码均未发现未解决的有效缺陷或测试缺口）。`npm test`（`node --test test/*.test.mjs`）**223 / 223 全部通过**，`git diff --check` 无异常（剩余限制：未对真实线上 Yahoo/CNN 接口或桌面/移动端真实浏览器执行交互验收）。

---

## `v2.2.7` 提交及全量运行时代码审查与修复闭环（2026-11-16）

- **已修复发现**：
  1. **场内基金状态落盘与前后端展示**（[updater.mjs](../server/updater.mjs#L416-L432)、[update-funds.mjs](../scripts/update-funds.mjs#L6-L18)、[data-health.mjs](../public/js/domain/data-health.mjs#L81-L116)、[application.mjs](../public/js/application.mjs#L416-L467)）：`refreshAll({ includeFunds: true })` 将多分组聚合后的 `status.funds` 写回 `status.json`；`update-funds.mjs` 按 `groups` 聚合顶层 `ok`、`count`、`performanceComplete` 与 `error`；`healthSummary()` 与 `application.mjs` 完整展示场内基金更新失败或未到齐提示，避免被覆盖为「已到齐」。
  2. **主图隐藏态与桌面悬浮小窗联动**（[page.css](../public/css/page.css#L2076-L2078)、[chart-visibility.mjs](../public/js/ui/chart-visibility.mjs#L27-L45)、[floating-charts.mjs](../public/js/ui/floating-charts.mjs#L23-L108)、[application.mjs](../public/js/application.mjs#L169-L178)、[events.mjs](../public/js/services/events.mjs#L3)）：主图遮挡态下隐藏 `#price-scale-toggle` 并同步 `inert`（保留 `.chart-toolbar` 共享控制）；`floating-charts.mjs` 跳过 `is-concealed` 的 `#price-wrap`（两图均不可见时自动隐藏小窗），通过 `events.chartVisibility` 同步切换状态，修复同步 rAF 调度阻塞与第 2 轮发现的 `show(visible)` 重复 `append` / 隐藏提示框回归。
  3. **自定义标的缓存清理、原子回滚与 `requestedComplete` 校验**（[index.html](../public/index.html#L665)、[symbol-dialog.mjs](../public/js/ui/symbol-dialog.mjs#L78-L116)、[chart.mjs](../public/js/features/market/chart.mjs#L75-L78)、[overlay.mjs](../public/js/features/strategy/overlay.mjs#L37-L55)、[symbols.mjs](../server/symbols.mjs#L37-L68)、[updater.mjs](../server/updater.mjs#L280-L309)）：同步弹窗文案为清理本地缓存；增删标的时通过 `invalidateSymbolCache` 与分标的 `symbolCacheEpochs` 清理前端内存缓存；`addCustomSymbol` 与 `removeCustomSymbol` 在 `writeCustomSymbolsWithStatus` 失败时恢复或清理 `<symbol>.json`；抽取 `syncRequestedComplete` 消除无 `requestedSources` 时的空数组真空真值与漏检。
  4. **`sameOrigin` IPv6 `HOST` 与畸形 `Host` 拦截**（[http-server.mjs](../server/http-server.mjs#L42-L78)）：将配置中无方括号的 IPv6 地址同时归一化为裸地址与 `[...]` 形式，并拒绝携带 `pathname`/`search`/`hash` 的 `Host` 头。
  5. **基金对比页加载失败提示**（[comparison.mjs](../public/js/features/funds/comparison.mjs#L184-L188)）：首次读取快照失败时同步更新 `#fund-performance-status`，避免永久停留在「正在读取历史涨幅…」。
  6. **CSV 公式注入边界增强**（[download.mjs](../public/js/ui/download.mjs#L5-L7)）：补充对前导 `\n` 及前导空白后接 `=+\-@` 的防护。
- **范围、轮次与验证**：覆盖 `ff8488b` 及 `server/`、`public/`、`scripts/`、`start.cmd`、`start.command`、`.github/workflows/`、`test/` 全量调用链路；共经历三轮双人独立只读审查与复审闭环（两方审查前均未预读 `docs/code-review.md` 与 `docs/tech-debt.md`；第 2 轮由 Reviewer B 检出 `floating-charts.mjs` `show(visible)` 回归并修复后进入第 3 轮；第 3 轮两方均未发现未解决的有效问题）。`node --test test/*.test.mjs` **215 / 215 全部通过**，`git diff --check` 无异常（剩余限制：浏览器交互与桌面前后滚动视觉未在真实桌面浏览器逐帧实测，均由单测桩与静态分析验证）。

---

## 代码审查台账 #10–#13 与工作区改动审查修复闭环（2026-11-15）

- **已修复台账项（`#10–#13`）**：
  1. `#10` [http-server.mjs](../server/http-server.mjs#L30-L85)：`sameOrigin` 增加 `Host` 允许列表（回环地址、配置 `HOST` / `allowedHosts` 及通配监听时的实际本机连接 IP）与监听端口校验，并拒绝除 `'same-origin'` 以外的 `Sec-Fetch-Site`。
  2. `#11` [http-server.mjs](../server/http-server.mjs#L152-L209)、[updater.mjs](../server/updater.mjs#L46-L55)：`updateFunds` 在 `groups` 中暴露 `performanceOk`；`/api/refresh` 将 `status.funds`、`status.funds.groups`（含 `performanceOk === false` 与 `performanceComplete === false`）与 `status.funds.performance` 的失败或未到齐状态汇总进 `errors`，冷却判定同步校验各分组状态，`fundsAnyOk` 按全部分组独立判定、避免首组失败掩盖次组成功，全部数据源均失败时返回 `502`。
  3. `#12` [storage.mjs](../server/storage.mjs#L14-L23)、[updater.mjs](../server/updater.mjs#L24-L120)、[symbols.mjs](../server/symbols.mjs#L17-L33)：新增 `readJsonOptional`，对损坏的基金快照、行情 `<symbol>.json` 与 `status.json` 捕获 `SyntaxError` 返回 `null` 以允许上游重新拉取自愈。
  4. `#13` [data-health.mjs](../public/js/domain/data-health.mjs#L17-L25)、[symbols.mjs](../server/symbols.mjs#L17-L50)、[updater.mjs](../server/updater.mjs#L283-L407)：抽取共享 `isStatusComplete`（校验 `['Fear & Greed', ...SYMBOLS, ...extraSymbols]` 全集在场），并通过 `writeCustomSymbolsWithStatus` 先写 `custom-symbols.json` 再写 `status.json`（后者失败时回滚列表文件）。
- **工作区双人独立复审追加修复**：
  1. [page.css](../public/css/page.css#L2076-L2077)：主图默认隐藏态（`.price-wrap.is-concealed`）同步隐藏 `#price-empty`，避免空区间提示与中央展开引导重叠。
  2. [start.cmd](../start.cmd#L1-L34)：移除 `goto :fail` 改为线性错误退出流程，规避 Windows `cmd.exe` 在 UTF-8（`chcp 65001`）+ LF 换行下的标签跳转偏移问题。
- **范围、轮次与验证**：两轮双人独立只读审查（两方审查前均未预读 `docs/code-review.md` 与 `docs/tech-debt.md`）；第 2 轮复审后两方均未发现未解决的有效问题。`npm test` **211 / 211 全部通过**，`git diff --check` 无异常（剩余限制：`start.cmd` 仅完成静态批处理语法核查，未在 Windows 真机 `cmd.exe` 实测；`public/data/status.json` 与未跟踪的 `public/data/{googl,aapl,ko}.json` 为本地运行中的自选股数据，静态构建已通过 `build-site.mjs` 过滤）。

---

## 卡片头部基线对齐与窄屏布局修复闭环（2026-11-14）

- **范围与轮次**：
  1. **「加权K指标」与「恐慌与贪婪指数」卡片**：经首轮只读双人独立分析与用户确认后修复，并通过第二轮双人独立复审闭环，两方均无未解决的有效发现。
  2. **顶部行情主卡（`.price-card`）**：经首轮只读定位、两轮修复间复审识别窄屏 `#symbol` 挤压及非 `subgrid` 回退溢出风险后调整方案，并在第 3 轮双人独立复审中两方均无待修有效发现（96 组视口 / 场景 / 字体 / 支持态矩阵全部通过）。
- **已修复项**：
  1. [page.css](../public/css/page.css#L1744-L1797)：将 `.chart-card:not(.price-card) > .chart-heading` 改为 `2×2` CSS Grid（`align-items: baseline`），通过 `display: contents` 将 `h2` / `.score-block > div` 与 `p` / `.score-block > span` 按行归位并补充显式 `line-height`，同时在 `@media (max-width: 800px)` 下将 `.score-block > span` 统一为 `9px`。
  2. [page.css](../public/css/page.css#L1799-L1882)：在不破坏 `#price-quote.is-concealed` 独立模糊盒模型的前提下，为 `.price-card .score-block` 补充 `flex-shrink: 0`；在 `@supports (grid-template-rows: subgrid)` 内将 `.price-card > .chart-heading` 设为两行两列 Grid、`> div:first-child` 设为 `display: contents`、`#price-quote` 跨两行采用 `grid-template-rows: subgrid`，使第 1 行垂直居中（`align-self: center`）、第 2 行 `#price-asof` 与 `#price-change` 按文本基线对齐（`align-self: baseline; line-height: 1.6`）；在 `@supports` 外补充 `@media (max-width: 465px)` 窄屏规则，令 `.price-title-row` 自动折行（`.symbol-control` 占满首行、`#add-symbol` 与 `#allocation-open` 置第二行）并限制 `#price-quote > span` 折行宽度（`max-width: 86px`）。
- **验证与限制**：`git diff --check` 无异常；[ui-modernization.test.mjs](../test/ui-modernization.test.mjs)、[frontend-regressions.test.mjs](../test/frontend-regressions.test.mjs)、[build-site.test.mjs](../test/build-site.test.mjs) 与 [signal-view.test.mjs](../test/signal-view.test.mjs) `22 / 22` 通过，全量 `npm test` **202 / 202 全部通过**；Linux Chromium 覆盖 `1200–320px`（含 `466px / 465px` 断点、5 位整数 `12345.67`、长 stale 提示、禁用/启用 `Inter Variable`、隐藏/展开切换及模拟非 `subgrid` 回退），主路径全视口第 1 行垂直居中差与第 2 行首行基线差均为 `0px` 且无截断、重叠或溢出。非 `subgrid` 浏览器仅作降级保底（无溢出、无重叠，第 2 行不跨列对齐基线）；真实 macOS / iOS / Android 设备视觉渲染待发布后在实机复核。

---

## 跨设备字体与字重一致性修复闭环（2026-11-14）

- **范围与轮次**：针对 Android / Windows / macOS 跨设备字体与字重不一致问题，经首轮只读双人独立分析（定位 `font-synthesis: none`、非标准字重 `550/650/750`、缺少 Android 字体栈回退、欢迎弹窗衬线回退与 Canvas 硬编码字体等根因）后，按用户确认的「方案 B」完成修复并经第二轮双人独立复审闭环，最终两方均无未解决的有效发现。
- **已修复项**：
  1. [public/fonts/inter-latin-wght-normal.woff2](../public/fonts/inter-latin-wght-normal.woff2)、[public/fonts/INTER-LICENSE.txt](../public/fonts/INTER-LICENSE.txt)、[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#L51)：自托管 `@fontsource-variable/inter` v5.3.0 的 Latin / 数字可变子集（~47 KB，SIL OFL 1.1），并在 [index.html](../public/index.html#L18)、[nasdaq-funds.html](../public/nasdaq-funds.html#L18)、[sp500-funds.html](../public/sp500-funds.html#L18) 补充 `<link rel="preload" ... crossorigin>`。
  2. [page.css](../public/css/page.css#L2-L16)、[header.css](../public/css/header.css#L216)、[backtest.css](../public/css/backtest.css#L2-L44)、[strategy-summary.css](../public/css/strategy-summary.css#L5-L18)、[funds.css](../public/css/funds.css#L25-L49)、[strategy-dialog.css](../public/css/strategy-dialog.css#L23-L24)、[welcome-dialog.css](../public/css/welcome-dialog.css#L46-L51)：声明 `Inter Variable` `@font-face`（`font-display: swap` 与拉丁/数字 `unicode-range`），将 `:root` 调整为跨平台无衬线栈并改用 `font-synthesis: weight style`；将中文 UI 字重统一收敛为 `400 / 600 / 700`（保留纯数字/ASCII 的 `.score-block strong` 与 `.version-badge` 为 `500`）；修复 `h3/h4` 字重倒挂、`input[type="date"]` 缺失 `font: inherit` 并补全欢迎弹窗衬线回退栈。
  3. [geometry.mjs](../public/js/charts/geometry.mjs#L5-L9)、[sentiment.mjs](../public/js/charts/sentiment.mjs#L40-L62)、[chart.mjs](../public/js/features/market/chart.mjs#L203-L269)、[kd.mjs](../public/js/features/strategy/kd.mjs#L212-L276)、[application.mjs](../public/js/application.mjs#L606-L613)：抽取共享 `CHART_FONT_STACK` / `chartFont`，在字体加载完成（`document.fonts.ready` / `loadingdone`）时触发三张 Canvas 重绘及 `invalidateKDChart()` 静态缓存失效。
  4. [http-server.mjs](../server/http-server.mjs#L26-L27)、[backend.test.mjs](../test/backend.test.mjs#L442-L444)：补齐 `.woff2`（`font/woff2`）与 `.txt` MIME 映射及接口回归断言。
- **验证与限制**：`node --test test/*.test.mjs` **202 / 202 全部通过**，`node scripts/build-site.mjs` 完整构建 `dist/fonts/`，headless Chrome 实测主页面与基金对比页均成功加载 `Inter Variable` 且控制台零错误；Android 真机与 Windows 实机渲染效果待发布后在对应终端确认，外链 `<img>` 加载的静态流程图 [diagrams/*.svg](../public/diagrams/monthly_dca_logic.svg#L8) 仍使用独立系统字体栈。

---

## KD Canvas 图表重构与工作区改动修复闭环（2026-11-14）

- **范围与轮次**：在 `v2.1.0` Standalone 顶部留白回滚与恐慌卡片布局调整（含 `createChartCollapse` 与 `#kd-panel` `<section>` + `<canvas id="kd-plot">` 重构及 `2026-11-13` 行情/情绪数据刷新）后的完整工作区改动，经只读首轮 + 修复后第二轮双人独立复审闭环，最终两方均无未解决的有效发现。
- **已核实与修复项**：
  1. [page.css](../public/css/page.css#L677-L685)、[page.css](../public/css/page.css#L715-L717)、[kd.mjs](../public/js/features/strategy/kd.mjs#L428-L519)：为 `#kd-plot` 补齐 `cursor: crosshair`、`touch-action: none`、`user-select: none`、`.is-dragging` 与 `.mouse-focused` 规则，并移除 `kd.mjs` 内联 `style.cursor` 赋值以配合 `attachChartNavigation`。
  2. [status.json](../public/data/status.json#L5-L83)：从 `requestedSources` 与 `results` 剥离本地自选股 `GOOGL`，并清理未跟踪的 `public/data/googl.json`（内置 `Fear & Greed`、`SPY`、`QQQ`、`VGT`、`SMH`、`BRK-B` 保留至 `2026-11-13`）。
  3. [backtest.mjs](../public/js/features/strategy/backtest.mjs#L139-L178)、[kd.mjs](../public/js/features/strategy/kd.mjs#L140-L150)：复盘渲染构造共享 `replayWindow` 传入 `renderKDReview` 并在 `events.replayRange` 跳过同引用重复重绘；抽取 `updateChartMeta` 同步 `#kd-sample-note` 与 `#kd-observations` 视图口径。
  4. [application.mjs](../public/js/application.mjs#L478-L485)、[kd.mjs](../public/js/features/strategy/kd.mjs#L432)：在 `events.marketHover`（通过 `kdCollapse.isCollapsed()`）与 `setKDHover`（增加 `$('kd-chart-collapse')?.inert` 判断）阻止 KD 折叠动画期间重显 `#kd-tooltip`。
  5. [kd.mjs](../public/js/features/strategy/kd.mjs#L233-L239)、[modern.css](../public/css/modern.css#L76-L78)、[kd.css](../public/css/kd.css#L21-L24)：单点 KD 序列绘制 3 曲线圆点；移除失效 `.kd-summary-action svg` 选择器并补回 `input[aria-invalid="true"]` 边框样式（同时保留 `modern.css` 对 `@media (display-mode: standalone)` 顶部 `+36px` 留白的回滚）。
  6. [frontend-regressions.test.mjs](../test/frontend-regressions.test.mjs#L624-L713)、[application-calendar.test.mjs](../test/application-calendar.test.mjs#L599-L637)：补充 `aria-invalid`、单点圆点绘制、周线视图/复盘元数据同步、`events.kdHover` 反向联动、`#kd-plot` 键盘导航属性与 KD 折叠过渡期外部悬浮拦截测试。
- **验证与限制**：定向 8 份测试文件 **65 / 65 通过**；全量 `npm test` **198 / 199 通过**（唯一失败为既有的 macOS `/var` 软链导致的 `test/build-site.test.mjs` `dist/nasdaq-funds.html` `ENOENT`）。真机浏览器渲染与触控手势未在 CLI 实测。

---

## Standalone 顶部留白回滚与恐慌/KD 面板交互布局修复闭环（2026-11-14）

- **范围与轮次**：`v2.1.0` 顶部安全区留白、恐慌指数卡片折叠按钮与 `#kd-panel` 折叠/展开全套样式与交互逻辑（涉及 `public/index.html`、`public/css/page.css`、`public/css/funds.css`、`public/css/kd.css`、`public/css/modern.css`、`public/js/application.mjs`、`public/js/features/strategy/kd.mjs`），经只读分析 + 2 轮修复闭环双人独立复审，最终两方均无未解决的有效发现。
- **已修复项**：
  1. `public/css/modern.css#L125-L133`：回滚 `@media (display-mode: standalone)` 的顶部 `+36px` 额外留白，恢复 `v2.0.0` 标准 `env(safe-area-inset-*, 0px)` 适配。
  2. `public/index.html#L308-L325`、`public/css/page.css#L284-L327,L1349-L1351`：将 `#sentiment-chart-toggle` 从 `.chart-heading-side` 移至 `.chart-heading` 下方最右侧（`.sentiment-chart-actions`），恢复右上角 `.score-block` 纯读数对齐并保持展开/收起按钮锚点稳定。
  3. `public/css/page.css#L514-L516`、`public/css/funds.css#L5`、`public/css/kd.css#L1-L60`、`public/css/modern.css#L76-L79`：移除全局 `summary { display: inline-block; }` 恢复全站原生折叠箭头；优化 `.price-card-footer` 在 `#fund-entry[hidden]` 时的右侧留白；将 `#kd-panel > summary` 重构为全宽交互条并动态展示最新加权 K 与倍率摘要；修复 `.kd-metrics` 在 `481px–800px` 断点边框错位、`.kd-controls` 移动端 2×3 网格与防放大 `16px` 字号、`#kd-plot` 移动端留白及 `.backtest-method` 间距。
  4. `public/js/application.mjs#L92`：将 `inFlow` 判定改为 `collapse.contains ? collapse.contains(wrap) : wrap.parentElement === collapse`，修复真实 DOM 因中间容器 `.sentiment-chart-collapse-inner` 导致收起过渡动画被跳过的缺陷。
  5. `public/js/features/strategy/kd.mjs#L23-L24,L96-L101,L162-L170,L217,L236-L240,L280-L281`：根据 `window.innerWidth <= 600` 自适应 `#kd-plot` `viewBox` 与轴标签字号，并监听 `matchMedia('(max-width: 600px)')` 跨断点旋转/缩放时自动重绘。
- **验证与限制**：定向运行 `node --test test/frontend-regressions.test.mjs test/application-calendar.test.mjs test/kd-strategy.test.mjs test/ui-modernization.test.mjs test/signal-view.test.mjs test/strategy-summary.test.mjs`，**50 / 50 全部通过**；真实设备浏览器视觉效果与动画需在真机确认（未改动 `CHANGELOG.md`）。

---

## PWA 适配与切回前台刷新工作区改动审查闭环（2026-11-13）

- **范围与轮次**：工作区 14 个已修改文件、5 个未跟踪 PWA 文件（`manifest.webmanifest`、`icons/*`）及相关调用链路，共 2 轮双人独立审查闭环；最终代码运行 `npm test` **197 / 197 通过**，两方均无未解决的有效发现。
- **已修复项**：
  1. `[High]` [application-calendar.test.mjs](../test/application-calendar.test.mjs#L196-L430)：补齐 `initMarketChart()` 与多监听器数组分派、修正等待循环括号优先级并断言 `SMH` 标题切换，同时通过 `trackAppEvents` 消除 `appEvents` 跨用例泄漏。
  2. `[Medium]` [application.mjs](../public/js/application.mjs#L383-L432)：`visibilitychange` 改为先记录 `expectedID`、仅在 `onCommit` 提交阶段推进 `sentimentRequestID`，避免未变更/失败的切回检查取消并发 `#refresh` `load()`。
  3. `[Low]` [application.mjs](../public/js/application.mjs#L392-L426) / [chart.mjs](../public/js/features/market/chart.mjs#L70-L100) / [overlay.mjs](../public/js/features/strategy/overlay.mjs#L144-L148) / [page.css](../public/css/page.css#L121)：新增 `hasLoadedMarket()` 使首屏或切标失败的行情在 `status.json` 未变时也能恢复重试；通过 `onCommit` 与 `setSignalSentiment(..., { notify: false })` 合并为单次渲染；移除 `#allocation-dialog .allocation-actions` 重复的 `env(safe-area-inset-bottom)` 留白。
- **剩余限制**：CLI 环境仅运行 Node 单元测试与模拟 DOM 集成测试，真机 iOS/Android Standalone PWA 安全区视觉效果需在设备上确认。

---

## v1.17.0 全量双人审查记录（2026-11-13）

- **范围**：全仓库代码、`.github/workflows/pages.yml` 与全部 8 份文档（环境无 `node` / `npm`，静态核查）。
- **结果**：确认 9 项待修 Bug（1 High / 2 Medium / 6 Low，均已登记至 [代码审查台账](./code-review.md)），并统一同步了 `README.md`、`docs/architecture.md`、`docs/deployment.md`，将技术债拆入 [技术债清单](./tech-debt.md)。
- **后续修复（#1–#3，2026-11-13，待 Node.js 环境运行测试验证）**：
  - `#1 [High]` [fund-performance.mjs](../server/fund-performance.mjs#L42-L44)：在计算 `endDate` 前增加 `if (!availableDates.length) throw Error('没有可用的基金历史行情');`，并在 [fund-performance.test.mjs](../test/fund-performance.test.mjs#L167-L179) 补充本地 `loadBenchmarkSnapshot` + 全基金抓取失败回归用例。
  - `#2 [Medium]` [overlay.mjs](../public/js/features/strategy/overlay.mjs#L401-L426)：`apply()` 对 `#base-amount` 与 `#fear-buy-count` 的 `.value.trim() === ''` 进行空值拦截，避免退格清空时覆盖已保存配置。
  - `#3 [Medium]` [overlay.mjs](../public/js/features/strategy/overlay.mjs#L67-L102)：抽取 `allocateWeightedAmounts`（整数美分最大余数法），统一用于组合配比预览与保存；在 [frontend-regressions.test.mjs](../test/frontend-regressions.test.mjs#L1019-L1052) 补充 #2 与 #3 回归用例。
- **后续修复（#4–#8，2026-11-13，Node v24.14.0 全套测试验证通过）**：
  - `#4 [Low]` [chart.mjs](../public/js/features/market/chart.mjs#L84)、[overlay.mjs](../public/js/features/strategy/overlay.mjs#L200-L216)、[summary.mjs](../public/js/features/strategy/summary.mjs#L34-L96)：复盘传入完整 `data.rows` 以命中 Pyramid 与 KD `WeakMap` 缓存，仅按 `next.end` 过滤信号与摘要视图，并在 [frontend-regressions.test.mjs](../test/frontend-regressions.test.mjs#L782-L790) 补充回归用例。
  - `#5 [Low]` [kd-strategy.mjs](../public/js/domain/kd-strategy.mjs#L186-L191)：KD 月度信号保留 `buyDay`，并在 [kd-strategy.test.mjs](../test/kd-strategy.test.mjs#L88) 补充回归用例。
  - `#6 [Low]` [backtest.mjs](../public/js/domain/backtest.mjs#L135)、[backtest.mjs](../public/js/domain/backtest.mjs#L366-L368)：单标的 `trades` 增加 `toFixed(2)` 取整，组合回测补充 `Number.isFinite` 溢出校验，并在 [backtest.test.mjs](../test/backtest.test.mjs#L216-L239) 补充回归用例。
  - `#7 [Low]` [symbol-dialog.mjs](../public/js/ui/symbol-dialog.mjs#L50-L124)：增删请求抽取 `requestSymbols`，先判 `405` 并以 `parseJson` 与响应结构校验兜底非 JSON 响应体，并在 [symbol-dialog.test.mjs](../test/symbol-dialog.test.mjs#L121-L164) 补充回归用例。
  - `#8 [Low]` [http-server.mjs](../server/http-server.mjs#L165-L176)：`URIError` 返回 `400`、`EISDIR` 返回 `404`，并在 [backend.test.mjs](../test/backend.test.mjs#L426-L434) 补充回归用例。

---

## v1.17.0 KD 定投与五策略回测工作区审查（2026-11-11）

两位审查者独立检查了 26 个工作区改动及相关调用路径，主 Agent 复核了发现。首轮为只读审查，59 项定向测试及差异检查通过；最终实现通过 62 项定向测试及 `git diff --check HEAD`。

| 优先级 | 问题与证据 | 处理方式 | 状态 |
| --- | --- | --- | --- |
| P2 | [KD 分档](../public/js/domain/kd-strategy.mjs)：周线高 18.10、低 18.00、收 18.09 时，K 应为 90，但浮点尾差使买入从 1N 变成 1.5N。 | 窄幅窗口先按报价的十进制表示求差，分档时再吸收档线附近的浮点尾差；补充回归测试。 | 已修复 |
| P2 | [回测风险指标](../public/js/domain/backtest.mjs)：恒价 $19、两笔各 $1,000 的普通定投出现虚假回撤及夏普、索提诺、MAR；恒定非零收益也可能出现巨大的夏普值。 | 忽略日收益、波动和回撤分母中的浮点尾差；覆盖单标的、组合及恒定收益。 | 已修复 |
| P2 | [KD 复盘](../public/js/features/market/chart.mjs)：每帧新建行情前缀，导致 KD 缓存失效（SPY 8,504 根日线约 91ms，超出 62.5ms 预算）。 | — | 转入当前台账 |
| P3 | [KD 信号导出](../public/js/domain/kd-strategy.mjs)：KD 月度信号未保留 `buyDay`。 | — | 转入当前台账 |
| P3 | [KD 说明](../public/index.html)：公开站点没有文案所称的「旧版研究」入口。 | — | 转入技术债 |

---

## v1.14.0 定投配比与组合回测审查（2026-11-09）

对发版提交 `f6083a9` 执行双人独立只读审查（39 项定向测试通过），确认以下 5 项问题及 2 项补充发现：

1. **资金摘要与回测成交口径不同**（`strategy-summary.mjs` / `backtest.mjs`）—— **已于 v1.15.0 修复**（组合层共用成交订单对齐起点跨界、跨月顺延、末尾未成交三种边界）。
2. **组合可能混用旧行情或复盘截断行情**（`chart.mjs` / `overlay.mjs`）—— **已于 v1.15.0 修复**（`!next.replay` 才写缓存，联动清理与代次校验）。
3. **清空输入会保存为停投**（`overlay.mjs`）—— 转入当前台账。
4. **配比合计 100% 仍可能超出总金额**（`overlay.mjs`）—— 转入当前台账。
5. **窄屏下标的名被完全裁切**（`public/css/page.css`）—— **已于 v1.15.0 修复**（增加窄屏两行两列网格断点）。
6. **补充发现**：单标的 `simulate` `trades` 浮点尾数（转入当前台账）；文档遗漏 `BRK-B`（已于 2026-11-13 修复）。

---

## v1.8.3 / v1.8.4 全项目审查与修复闭环（2026-10-21）

双人独立审查及第二轮复审闭环，47 项定向测试通过（`build-site.test.mjs`、`backend.test.mjs`、`custom-symbols.test.mjs`、`symbol-dialog.test.mjs`、`application-calendar.test.mjs`、`architecture.test.mjs`）：

1. **静态构建白名单与个人标的隔离**（`scripts/build-site.mjs`、`.gitignore`）—— **已修复**（白名单复制 `public/data/`，并过滤 `dist/data/status.json` 中的个人标的）。
2. **跨站 `Origin` 安全解析与文件锁错误码**（`server/http-server.mjs`、`server/storage.mjs`）—— **已修复**（`sameOrigin` `try/catch` 返回 403；锁冲突返回 `ELOCKED` / 409）。
3. **自定义标的增删后状态同步**（`server/updater.mjs`、`events.mjs`、`symbol-dialog.mjs`、`application.mjs`）—— **已修复**。
4. **空日历边界防护与情绪 CSV 评级一致性**（`public/js/application.mjs`）—— **已修复**。
5. **NYSE 历史特殊休市日补齐与文档同步**（`trading-calendar.mjs` 补 `1994-04-27`）—— **已修复**。
