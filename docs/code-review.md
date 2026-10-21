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
