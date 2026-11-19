# 第三批结构简化交接清单 (Handoff)

> **⚠️ 清理约定：本文件仅用于交接第三批代码结构收敛任务。以下事项全部修复并验证通过后，请直接删除本 `handoff.md` 文件（并同步清理 `docs/tech-debt.md` 中对应条目）。**
>
> - **基线版本**：`v2.2.15`（第一批文档重构 + 第二批核心模块拆分与命名统一已完成并通过双人独立复审）
> - **目标**：继续降低新工程师接手与长期维护的认知成本，不改变对外业务口径与零运行依赖原则。

---

## 一、待完成的第三批收敛项（按推荐顺序）

### 1. 合并单标的与组合回测的日步进净值循环（中优先级）
- **位置**：`public/js/domain/backtest.mjs`（`simulate` 与 `comparePortfolioStrategies`）
- **现状**：单标的回测与组合回测各自写了一套近 90 行的每日现金计息（3% 年化）、开盘 NAV 折算、入金、最大回撤、溢出校验与风险指标循环，后续改资金规则容易出现口径漂移。
- **简化方向**：抽取共用的多资产（`N >= 1`）每日账户步进器，单标的作为 `items.length === 1` 的特例复用同一套逻辑。
- **验证**：`node --test test/backtest.test.mjs test/risk-metrics.test.mjs test/strategy-summary.test.mjs`。

### 2. 为 `application.mjs` 瘦身并理顺前后端边界（中优先级）
- **位置**：`public/js/application.mjs`（633 行）、`public/js/ui/symbol-dialog.mjs`、`public/js/ui/strategy-dialog.mjs`、`server/updater.mjs`、`server/symbols.mjs`
- **现状**：
  1. 价格图与 KD 图都有独立 feature 模块，唯独“恐慌与贪婪指数图”揉在 `application.mjs` 里，且三图悬浮联动一半走 `appEvents`、一半直接函数调用；
  2. `ui/symbol-dialog.mjs` 直接 `fetch('./api/symbols')` 绕过 `services/data-client.mjs`；`ui/strategy-dialog.mjs` 用 `import.meta.url` 拼 `diagram.html` 路径（应相对页面用 `'./diagram.html'`）；
  3. 后端新增自定义标的（`addCustomSymbol`）放在 `server/updater.mjs`，而读取与删除在 `server/symbols.mjs`。
- **简化方向**：
  - 将恐慌图绘制/表格/导出剥离为 `public/js/features/sentiment/chart.mjs`，将通用退场动画超时等待抽至 `ui/dialog-utils.mjs` 与折叠控制器共用，统一三图悬浮通道；
  - 将 `/api/symbols` 与 `custom-symbols.json` 请求迁入 `services/data-client.mjs`；
  - 将 `addCustomSymbol` 收拢回 `server/symbols.mjs`（单标的抓取函数留在 `server/updater.mjs` 供复用）。
- **验证**：`node --test test/architecture.test.mjs test/application-calendar.test.mjs test/symbol-dialog.test.mjs test/custom-symbols.test.mjs test/backend.test.mjs`。

### 3. 抽离共享测试假 DOM、收拢 CI/脚本重复清单与统一构建期资源版本戳（中优先级）
- **位置**：`test/*.test.mjs`、`scripts/build-site.mjs`、`scripts/version.mjs`、`scripts/refresh-schedule.mjs`、`.github/workflows/pages.yml`
- **现状**：
  1. 7 个前端测试文件各自手搓了一套行为不完全一致的假 DOM，生产代码（如 `kd.mjs`、`backtest.mjs`）被迫维护多处防重绑补丁；
  2. `.github/workflows/pages.yml` 与 `server/refresh-schedule.mjs` 存在 10 条 cron 与内置标的清单的重复硬编码；
  3. JS 模块在 `npm run build` 构建期自动加 `?v=`，而 CSS 的 12 处 `?v=` 仍需 `version:sync` 原地改源码。
- **简化方向**：
  - 零依赖抽一份共享 `test/helpers/fake-dom.mjs`，渐进迁移测试；
  - 将工作流选源门禁（含国内基金槽位）与快照白名单统一下沉到脚本输出，减少 workflow 中的 bash 硬编码；
  - 评估将 CSS `?v=` 注入也统一迁至 `scripts/build-site.mjs`（保留 `package.json` / `CHANGELOG.md` / HTML 元数据版本校验），减少发版源码噪音。
- **验证**：`node --test test/*.test.mjs` + `node scripts/build-site.mjs`。

### 4. 整理巨型样式文件 `page.css` 并按页分离样式入口（低优先级，需多视口视觉验收）
- **位置**：`public/css/page.css`（2,101 行）、`public/style.css`、`public/funds.html`
- **现状**：`page.css` 混杂 `#allocation-dialog` / `#symbol-dialog` 样式与 14 个零散的 `@media (max-width: 800px)` 补丁块；`funds.html` 共用 `style.css` 白加载了主页 9 个无关样式文件。
- **简化方向**：拆出弹窗独立 CSS、按组件归并同断点媒体查询，让 `funds.html` 仅加载基础公共样式与 `funds.css`。
- **验证**：改动必须配合桌面与移动端多视口（含 `320px` / `465px` / `800px` / `1280px`）真实浏览器截图与计算样式核验，确认无级联回归。

---

## 二、常用核验命令

```sh
node --test test/*.test.mjs    # 全量自动化测试
git diff --check               # 检查空白与格式
node scripts/build-site.mjs    # 校验版本并构建 dist/
```

> 再次提醒：上述第三批事项完成后（或确认放弃剩余项后），请**直接删除本 `handoff.md` 文件**，不要让过期交接单留在仓库根目录。
