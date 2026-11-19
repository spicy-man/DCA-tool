# 技术债清单 (Tech Debt)

> 维护规则：记录**非阻断性的结构简化、去重与命名整理项**；明确的功能缺陷见 [代码审查台账](./code-review.md)。清理完成后移入文末「已清理记录」。

---

## 一、优先简化项（降低接手认知成本）

| 优先级 | 模块 / 位置 | 问题描述 | 建议方向 | 状态 |
| :--- | :--- | :--- | :--- | :--- |
| **中** | [domain/backtest.mjs](../public/js/domain/backtest.mjs) | 单标的回测 `simulate` 与组合回测 `comparePortfolioStrategies` 各自维护一套现金计息、净值与回撤循环。 | 抽取共用的多资产（N≥1）每日账户步进器，消除口径漂移风险。 | 待排期 |
| **中** | [application.mjs](../public/js/application.mjs)（633 行） | 情绪图逻辑直接揉在总控里；三图悬浮联动混用直调与 `appEvents`；自定义标的请求在 `ui/symbol-dialog.mjs` 绕过 `data-client.mjs`。 | 剥离 `features/sentiment/chart.mjs`；统一三图悬浮通道；`symbol-dialog` 请求迁入 `data-client.mjs`；`addCustomSymbol` 收拢回 `server/symbols.mjs`。 | 待排期 |
| **中** | [test/](../test/)、`scripts/`、[pages.yml](../.github/workflows/pages.yml) | 7 个测试各自手搓不一致的假 DOM，生产代码含防重绑补丁；内置标的/cron 选源在工作流与脚本重复硬编码；CSS `?v=` 源码同步与 JS 构建注入两套机制并存。 | 抽零依赖共享 `test/helpers/fake-dom.mjs`；cron 选源与白名单收拢到脚本；CSS `?v=` 迁至 `build-site.mjs` 构建期注入。 | 待观察 |
| **低** | [page.css](../public/css/page.css)（2,101 行）、[style.css](../public/style.css) | `page.css` 混杂弹窗样式与 14 个零散 `@media (max-width: 800px)` 块；`funds.html` 经 `style.css` 白加载主页 9 个样式文件。 | 拆出弹窗 CSS、归并断点，按页面分离样式入口（需多视口视觉回归验收）。 | 待观察 |

---

## 二、已清理记录

- **2026-11-19（第二批结构简化）**：拆分 1,311 行上帝模块 [overlay.mjs](../public/js/features/strategy/overlay.mjs)（瘦身至 432 行）为 `settings.mjs`、`allocation-dialog.mjs`、`backtest-view.mjs` 与 `ui/format.mjs`，`allocateWeightedAmounts` 下沉 `domain/strategy-summary.mjs`，统一全站行情缓存至 `services/market-store.mjs`，并在 `app.mjs` 显式初始化 `backtest` 与 `allocation-dialog`；在 [data-health.mjs](../public/js/domain/data-health.mjs) 统一 `isSourceHealthy` / `isFundsHealthy` / `describeFundsIssues` 并由 5 处后端/脚本复用；合并 `domain/nasdaq-funds.mjs` + `domain/fund-groups.mjs` 为 [domain/funds.mjs](../public/js/domain/funds.mjs)、重命名 `server/nasdaq-funds.mjs` 为 [server/fund-quotes.mjs](../server/fund-quotes.mjs)、`server/fund-performance.mjs` 中 `qqq` 改名 `benchmark`、`daysInMonth` 归位 [trading-calendar.mjs](../public/js/domain/trading-calendar.mjs)、统一策略计划 ID（`combined` 兼容 `pyramidFear`）与 `viewRange`/`strategyParams` 命名。

- **2026-11-19**：合并 `AGENTS.md`、`COMMIT_GUIDE.md`、`PROJECT_RELEASE.md` 为单文件 [AGENTS.md](../AGENTS.md)；移除过期交接文档 `handoff.md` 与已解决历史诊断 `docs/workflow-schedule-diagnosis.md`；重排 [README.md](../README.md)（完整保留投资哲学），重写 [architecture.md](./architecture.md) 与 [deployment.md](./deployment.md)，统一 [code-review.md](./code-review.md) 分级格式并补录 `#31`；修复 `overlay.mjs` 隐式依赖 `setKDTierFactor` 刷新主图、首屏 `deployment.json` 重复请求及 CLI 吞异常问题。
- **2026-11-13**：统一同步 `architecture.md`、`deployment.md` 与 `README.md`；为原独立基金对比页补齐样式缓存参数与版本校验；移除 `index.html` 中指向不存在「旧版研究」入口的残留描述；更新 `THIRD_PARTY_NOTICES.md` 将标普 500 基准同步为 `SPY`。
