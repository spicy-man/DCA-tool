# 项目质量评估与推广准备交接文档 (Handoff)

> **记录时间**：2026-11-15  
> **当前版本**：`2.2.4`（`node --test test/*.test.mjs` 共 197 项测试全部通过）  
> **整体结论**：项目核心架构、零依赖工程化水平与金融回测严谨度已达到较高水准，**现阶段可直接分享给懂美股指数定投的朋友、投资社群或技术爱好者使用**（推荐优先使用 GitHub Pages 静态在线版或本地克隆自用）。若后续希望进一步打磨体验或面向更广泛人群推广，可按本文档整理的优先级逐步推进。

---

## 一、现状评估摘要

### 1. 已具备的核心优势
- **零外部运行时依赖**：纯原生 Node.js（`>=20`）+ 浏览器原生 ES Modules，无第三方 npm 依赖与构建打包负担。
- **单向分层与同构领域模型**：`public/js/domain/` 纯函数在 Node 端与浏览器端共用，依赖边界由 `test/architecture.test.mjs` 守护。
- **回测与金融逻辑严谨**：
  - 消除未来函数：月度定投（金字塔 / KD）与恐慌加仓均在信号日收盘确认、下一交易日开盘价成交；周线 KD 严格仅使用已完成交易周。
  - 净值化风险口径：基于时间加权单位净值（Unit NAV）计算最大回撤、Sharpe、Sortino 与 MAR，支持「各自投入」与「同一供资计划（3% 闲置现金计息）」双视角对比。
  - 双部署形态：同时支持 GitHub Pages 静态发布（内置 `SPY`、`QQQ`、`VGT`、`SMH`、`BRK-B` 及 16 只国内场内纳指/标普 ETF 对比）与本地 Node 服务（支持数据刷新与最多 30 个自定义美股/ETF 标的）。

### 2. 推广边界说明
- **在线静态版（GitHub Pages）**：即开即用，适合绝大多数只看核心指数与场内 ETF 溢价/费率的用户；不支持在线添加自定义标的。
- **本地服务版（`node server.mjs` / `start.cmd` / `start.command`）**：单租户文件存储设计（共用 `public/data/custom-symbols.json` 与 `.refresh.lock`），**仅供个人本地或受信任局域网单人使用，不可直接暴露为无鉴权的多人公网写服务**。

---

## 二、本轮审查新定位的待处理项（按优先级排序）

以下问题为本轮双人独立审查新定位并经代码核实的事项（尚未并入 `docs/code-review.md`）：

### P1：高优先级（影响本地版可用性与核心组合回测口径）

#### 1. `.refresh.lock` 缺少陈旧进程（Stale Lock）自愈机制，且 `/api/symbols` 吞掉 `ELOCKED` 409 状态码
- **位置**：`server/storage.mjs:34-55`（`withDataLock`）、`server/http-server.mjs:87-93`（`/api/symbols`）
- **问题与影响**：
  1. 更新数据或添加标的期间若进程被强杀、关闭终端窗口或断电，`public/data/.refresh.lock` 会残留。虽然锁内写入了 `{ pid, startedAt }`，但捕获 `EEXIST` 时未检查进程是否存活或锁是否超时，导致重启后所有更新与自定义标的操作永久锁死报错。
  2. `server/http-server.mjs:91` 在 `/api/symbols` 内部 `catch` 中直接返回 `HTTP 400`，拦截了外层对 `error.code === 'ELOCKED'` 返回 `HTTP 409 Conflict` 的逻辑（`L171-174`）。
- **建议修复方案**：
  - 在 `withDataLock` 捕获 `EEXIST` 时读取 `.refresh.lock`：校验 `pid` 是否存活（`process.kill(pid, 0)`）及 `startedAt` 是否超过合理阈值（如 10 分钟），若为陈旧死锁则自动 `unlink` 并重试一次获取锁。
  - 在 `server/http-server.mjs` `/api/symbols` 的 `catch` 中，若 `error.code === 'ELOCKED'` 则 `throw error` 交由外层统一返回 `409`。

#### 2. 组合回测（Portfolio Backtest）在 0 倍恐慌加投下仍强制截断至 `2011-01-03`
- **位置**：`public/js/domain/strategy-summary.mjs:99-110, 147`（`summarizePortfolioFunding`）
- **问题与影响**：
  - `summarizePortfolioFunding` 固定取 `fngStart = sentiment[0].date`（`2011-01-03`）截断各标的起算日及 `comparePortfolioStrategies` 的 `startDate`。
  - 当用户采用主推的「KD 定投 + 0 倍恐慌加投」（所有标的 `fearBuyCount === 0`，完全不依赖 2011 年起算的 CNN F&G 数据）回测 `SPY`（1993 年起）或 `QQQ`（1999 年起）组合时，仍被强制从 2011 年开始，无法在组合模式下回测 **2000 年科网泡沫** 与 **2008 年次贷危机**。
- **建议修复方案**：
  - 仅在标的启用恐慌加仓（`fearBuyCount > 0`）或组合存在恐慌加仓需求时受 `fngStart` 约束；当 `fearBuyCount === 0` 时允许从各标的历史起点（或最早共同有效起点）开始测算。

#### 3. 删除自定义标的时未清理 `<symbol>.json`，残留文件可能阻塞后续重新添加
- **位置**：`server/symbols.mjs:14-33`（`removeCustomSymbol`）、`server/updater.mjs:144-152, 278-282`
- **问题与影响**：
  1. `removeCustomSymbol` 仅更新 `custom-symbols.json` 与 `status.json`，未删除 `public/data/<symbol>.json`，长期增删会堆积孤儿文件。
  2. 若日后上游 Yahoo Finance 对该标的早期除权或历史数据微调，用户重新添加该标的时，`updateETF` 会读取残留的 `<symbol>.json` 执行 `preserveHistory` 校验并抛错，导致无法再次添加。
- **建议修复方案**：
  - 在 `removeCustomSymbol` 的数据锁内同步删除 `path.join(dataDir, symbol.toLowerCase() + '.json')`（忽略 `ENOENT`）。

---

### P2：中低优先级（本地部署体验、交互细节与一致性优化）

#### 4. Windows 启动脚本与代理检测增强
- **位置**：`start.cmd:1-5`、`server/network.mjs:22-37, 59-63`
- **问题与影响**：
  1. `start.cmd` 未设置 UTF-8 代码页（`chcp 65001`），也未像 macOS `start.command` 那样检查 Node.js 是否安装及主版本是否 `>=20`。
  2. `networkProxy()` 仅在 Windows 下读取注册表 `ProxyEnable=0x1` 的 `https=`/`http=`，不支持 `socks=`、PAC 模式或 macOS 系统代理；调用 `curl` 时仅注入 `HTTPS_PROXY` 而删除了 `HTTP_PROXY` / `ALL_PROXY`。
- **建议修复方案**：
  - 对齐 `start.command` 完善 `start.cmd` 的环境检查与友好中文提示。
  - 在 `network.mjs` 中为 `curl` 同时保留/注入 `HTTP_PROXY` 与 `HTTPS_PROXY`，并支持 `socks=` 注册表项解析。

#### 5. 首屏“主图默认隐藏”的新访客体验优化
- **位置**：`public/js/ui/chart-visibility.mjs:1-25`、`public/index.html:86, 166`
- **问题与影响**：
  - `revealed` 硬编码初始为 `false` 且不持久化。首次访问的新用户打开页面看到主行情图与报价被毛玻璃遮罩隐藏，容易误以为页面加载异常。
- **建议修复方案**：
  - 将显隐偏好持久化至 `localStorage`（或首次访问默认展开主图，或在遮罩中央增加更醒目的首次说明与一键展开交互）。

#### 6. 配比弹窗输入防抖、KD 图坐标轴统一与 CSV 导出规范化
- **位置**：
  - `public/js/features/strategy/overlay.mjs:698-882`：多标的配比弹窗 `input` 事件同步触发全量 5 策略历史回测与 SVG 重绘，建议增加 `120–150ms` 防抖（debounce）。
  - `public/js/features/strategy/kd.mjs:178-193`：`drawKDChart` 使用自然日时间戳线性映射且固定宽度 `960`，建议与其他图表统一使用 `createTradingScale` 与响应式宽度。
  - `public/js/features/strategy/overlay.mjs:1235-1263`、`public/js/application.mjs:325-331`、`public/js/features/market/chart.mjs:406-415`：对齐 `kd.mjs:154-155`，统一添加 `\uFEFF` UTF-8 BOM（防 Windows Excel 中文乱码）、RFC-4180 双引号转义与公式前缀（`=`, `+`, `-`, `@`）防护（关联 `docs/code-review.md` `#19`）。

---

## 三、既有台账与合规事项索引

1. **既有待修 Bug 台账（`#9–#22`）**：详见 [docs/code-review.md](./docs/code-review.md)。其中与推广健壮性最相关的包括：
   - `#12`（Medium）：`server/updater.mjs` / `server/symbols.mjs` 读取本地损坏 JSON 缓存时缺少 `SyntaxError` 兜底自愈；
   - `#10`（Medium）：`server/http-server.mjs` 本地写接口 `sameOrigin` 缺少 `Host` 白名单校验；
   - `#11`（Medium）：`server/http-server.mjs` `/api/refresh` 汇总错误时忽略了场内基金快照与历史收益失败；
   - `#13`（Medium）：自定义标的增删写入 `status.json` 与 `custom-symbols.json` 顺序及 `complete` 全集校验。
2. **既有技术债**：详见 [docs/tech-debt.md](./docs/tech-debt.md)（单标的与组合回测净值循环抽取共用步进器）。
3. **开源许可证与第三方权利确认**：详见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。若后续作为公开开源项目正式分发，建议选定仓库 `LICENSE`（如 MIT 或 Apache-2.0），并确认第三方策略灵感/SVG 原图的授权说明。

---

## 四、后续接手常用命令

```sh
# 运行全量自动化测试（当前 197 项）
npm test

# 启动本地服务（默认 http://127.0.0.1:4173）
npm start

# 手动更新全部行情与国内场内 ETF 数据
npm run update-data

# 构建静态站点至 dist/
npm run build
```
