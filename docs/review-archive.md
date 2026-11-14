# 历史代码审查归档 (Review Archive)

> 本文件归档已完成或已被后续版本取代的历史审查过程记录。当前活跃的待修 Bug 请见 [代码审查台账](./code-review.md)，长期重构项见 [技术债清单](./tech-debt.md)。

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
