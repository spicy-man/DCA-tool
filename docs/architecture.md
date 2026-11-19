# 系统架构说明

本项目采用 **Node.js `>=20` + 浏览器原生 ES Modules**，**零第三方 npm 运行依赖**。浏览器端与服务端共用 `public/js/domain/` 里的纯函数计算逻辑；同一份前端同时运行在本地 Node 服务与 GitHub Pages 静态站点两种模式下。

---

## 一、目录与职责地图

```text
server.mjs                       本地服务启动入口（node server.mjs / start.cmd / start.command）
data/
  fear-greed-history-alignment.json  2011–2021 早期恐慌指数缺口补齐表（仅服务端合并使用）
server/
  http-server.mjs                静态资源服务、/api/refresh、/api/symbols、同源与冷却保护
  updater.mjs                    行情/情绪/基金刷新与新增自定义标的编排入口（refreshAll / refreshFunds / addCustomSymbol）
  storage.mjs                    文件锁（.refresh.lock）、原子写入、历史防回退校验
  network.mjs                    HTTP/代理下载、CNN 请求头与 Yahoo URL
  symbols.mjs                    自定义标的读写、保留快照保护与删除同步
  refresh-schedule.mjs           美东定时更新选源门禁（与 pages.yml cron 对应）
  snapshot-changes.mjs           提交前过滤纯时间戳与东财盘后 shares 抖动
  sentiment-history.mjs          早期恐慌指数历史补缺合并
  fund-quotes.mjs                国内场内 ETF（纳指100 + 标普500）行情、备用源与 F10 费率解析
  fund-performance.mjs           国内 ETF 与 QQQ/SPY 基准的 1/3/5 年前复权收益计算
public/
  index.html                     主页结构与首屏浅色声明
  funds.html                     国内场内 ETF 对比共享页（?group=nasdaq100 | sp500）
  diagram.html                   策略逻辑原图查看页
  style.css                      全站 CSS 加载入口（固定级联顺序）
  css/                           page、header、弹窗、概览、回测、小窗、基金、kd、modern 样式
  data/                          真实数据快照与来源状态（独立于源码）
  diagrams/                      策略逻辑 SVG 原图
  js/
    app.mjs                      主页启动入口（按三阶段顺序初始化各模块）
    funds-page.mjs               基金对比二级页独立入口
    application.mjs              三图共享时间窗口、恐慌图控制、折叠动画、刷新与 PWA 恢复
    domain/                      纯函数领域层：行情复权、交易日历、策略信号、回测、基金、健康度
    charts/                      坐标几何、Canvas 情绪图绘制、指针/触控/键盘导航
    features/market/             K 线图绘制与标的切换控件
    features/strategy/           策略配置（settings）、信号叠加（overlay）、组合弹窗（allocation-dialog）、摘要（summary）、回测（backtest / backtest-view）、加权K（kd）
    features/funds/              国内场内 ETF 对比表格与双条件排序
    services/data-client.mjs     浏览器数据请求封装（相对页面路径，兼容 /DCA-tool/）
    services/market-store.mjs    全站共享的前端行情快照缓存与失效控制
    services/events.mjs          应用内局部 EventTarget 与事件名清单
    ui/                          弹窗、Tooltip、格式化（format）、主图显隐、悬浮小窗、PWA 版本提示、CSV 导出等
scripts/                         命令行入口：更新数据/基金、构建静态站、版本同步、CI 门禁脚本
test/                            领域、后端、前端回归与架构边界测试
docs/                            架构、部署说明与审查/技术债台账
```

---

## 二、依赖方向与模块边界

### 自动测试守卫的约束（[test/architecture.test.mjs](../test/architecture.test.mjs)）

1. **`domain/` 纯净度**：仅导入 `domain/` 内部模块，不引用 `document`、`localStorage`、`fetch` 或 `process`，Node 与浏览器直接共用。
2. **前端相对导入不越界**：`public/js/` 内模块只能使用指向 `public/js/` 内部的相对导入，防止浏览器模块引用服务端代码。
3. **非入口模块零副作用**：除 `app.mjs` 与 `funds-page.mjs` 外，其余前端模块必须可在无 DOM 环境安全导入，统一通过 `init*()` 注册事件与操作 DOM。

### 人工审查遵守的模块边界约定

- **`charts/` 只做几何与绘图**：接收 Canvas 与数据，导航交互通过回调通知外部。
- **`services/` 只做数据通道**：封装浏览器 `fetch` 与应用内 `EventTarget`，不操作 DOM。
- **`server/` 统一持锁写盘**：可导入 `domain/`，不依赖浏览器视图；常规数据写盘均经 `updater.mjs`（数据刷新与新增标的）与 `symbols.mjs`（删除标的）调用 `storage.mjs` 持锁并原子替换（`snapshot-changes.mjs` 的默认基线回退路径亦经 `storage.mjs` 的 `atomicWrite`）。

### 应用内事件清单（[events.mjs](../public/js/services/events.mjs)）

跨模块通知统一走局部 `appEvents`（不向 `window` 派发自定义业务事件），目前共 9 个事件：
`replayRange`、`marketCalendar`、`marketHover`、`kdHover`、`strategySettings`、`symbolSettings`、`strategyView`、`sourceHealth`、`chartVisibility`。

---

## 三、核心数据流与启动顺序

### 1. 读取与更新链路

```mermaid
flowchart LR
  subgraph 浏览器读取
    D["public/data/* 快照"] --> DC["services/data-client.mjs"]
    DC --> DM["domain/* 纯函数"]
    DM --> APP["application / features"]
    APP --> CH["charts / Canvas / SVG"]
  end

  subgraph 服务端更新（本地 / CLI / Actions）
    TR["POST /api/refresh 或 scripts/*"] --> UP["server/updater.mjs"]
    UP --> NET["server/network.mjs"]
    NET --> DM2["domain/* 校验计算"]
    DM2 --> ST["server/storage.mjs（锁 + 原子写）"]
    ST --> D
  end
```

### 2. 主页启动顺序（[app.mjs](../public/js/app.mjs)）

1. **阶段 1（环境与选项就绪）**：先绑定弹窗关闭命令（`bindDialogCommands`），再只请求一次 `deployment.json` → 本地模式下 `initSymbolDialog()` 把自定义标的注入 `<select id="symbol">`。
2. **阶段 2（注册控件与订阅）**：依次初始化 `plan-estimate-help` → `kd` → `backtest` → `overlay` → `allocation-dialog` → `market/chart` → `chart-visibility` → `fund-navigation` → `strategy-dialog`。
3. **阶段 3（启动拉数与联动）**：`initApplication()` 发起首屏行情/情绪拉取 → 挂载 `floating-charts`（依赖 `chart-visibility` 状态）与 `welcome-dialog`。

---

## 四、两种运行模式对比

| 维度 | 本地 Node 服务（`npm start`） | GitHub Pages 静态版（`npm run build`） |
| :--- | :--- | :--- |
| 运行入口 | `server.mjs`（默认 `127.0.0.1:4173`） | `dist/` 静态文件（兼容 `/DCA-tool/` 子路径） |
| `deployment.json` | 服务端动态返回 `{ mode: "local", version }` | 构建时写入 `{ mode: "static", version }` |
| 页面「更新数据」按钮 | 可用（调用同源 `POST /api/refresh`，60 秒冷却） | 置灰禁用，提示仅本地可更新 |
| 自定义美股标的 | 支持增删（最多 30 个，存 `custom-symbols.json`） | 仅展示 5 只内置标的（构建时过滤个人数据） |
| 资产缓存控制 | 响应头 `Cache-Control: no-cache` | 构建期为 `.mjs` 自动追加 `?v=<version>` |

---

## 五、国内场内 ETF 对比模块

- **配置唯一来源**：[domain/funds.mjs](../public/js/domain/funds.mjs) 统一定义 `nasdaq100`（12 只，基准 QQQ）与 `sp500`（4 只，基准 SPY）两组名单、费率、页面路径、快照文件名及行情规范化与排序。
- **独立页面**：主页按当前标的通过 `fund-navigation.mjs` 跳转到 `funds.html?group=nasdaq100` 或 `sp500`，只加载基金对比逻辑，不加载美股 K 线与回测；切回前台时通过 `visibilitychange` 重新读取快照。
- **数据隔离**：写入独立快照 `nasdaq100-etfs.json` / `sp500-etfs.json`，基准历史直接复用本地 `qqq.json` / `spy.json`；不进入美元回测，但在 `status.json` 中单独记录 `funds` 健康状态。
- **容错口径**：行情必须覆盖组内全部基金且时间不倒退，失败保留整份旧快照；F10 规模或费率失败保留上次披露值。

---

## 六、样式顺序与本地持久化键

- **CSS 级联顺序**（[public/style.css](../public/style.css)）：`page.css` → `header.css` → `strategy-dialog.css` → `welcome-dialog.css` → `strategy-summary.css` → `backtest.css` → `floating-charts.css` → `funds.css` → `kd.css` → `modern.css`。全站固定浅色主题，不随系统深色模式切换。
- **稳定 `localStorage` 键**（重构时必须保持向后兼容）：
  - `seeker.pyramid.v1`：全部定投策略参数、分标的金额与组合配比（历史沿用旧名）
  - `seeker.kd.v1`：加权K分档系数与参数版本
  - `seeker.symbol.v1`：当前选中的标的
  - `seeker.strategyView.v1`：主视图选中的策略（`kdFear` / `combined`）
  - `seeker.backtestScale.v1` / `seeker.backtestSeries.v1`：回测图对数刻度与资产/盈亏模式
  - 以及主图显隐、K 线对数刻度、欢迎弹窗已读等 `seeker.*.v1` 偏好键。
