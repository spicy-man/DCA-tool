# 定投助手 · 定投信号

查看 VOO / QQQ 前复权行情、恐慌与贪婪指数及近月回撤金字塔定投信号。使用本地数据快照，无需安装第三方运行依赖。

## 本地启动

需要 Node.js 20 或更高版本，在项目目录运行：

```sh
node server.mjs
```

打开 <http://127.0.0.1:4173>，Windows 也可双击 `start.cmd`。默认仅监听本机；端口可通过 `PORT` 修改，局域网访问及公网部署见[部署说明](docs/deployment.md)。

## 使用

- 选择 VOO / QQQ、日期范围和日／周／月线，两张图共用时间窗口。默认显示近一年，采用展开布局。
- **手机**：图表内双指张开放大、捏合缩小，单指左右拖动；图表外上下滑动页面。
- **电脑**：滚轮缩放，左键拖动；Shift + 滚轮或触控板横向滚动平移，双击恢复预设范围。聚焦图表后可用方向键、加减键及 Home。
- **回到最新**保留当前缩放宽度；手动缩放或拖动后范围显示“自定义”。最小窗口为 14 个自然日。
- 设置每月定投日、基准金额 N（USD）及买入信号开关，设置保存在当前浏览器。日线显示 Buy 1x / Buy 2x 等标签，周线与月线仅保留明细。
- 展开图表下方明细可查看数据、计算口径及导出 CSV。悬停或点击信号可查看详情。
- 本地服务的“更新数据”抓取来源；静态站点的“检查更新”仅重新读取已发布快照。各来源日期和更新状态分别显示。

## 数据与计算口径

### ETF 行情

来源为 Yahoo Finance Chart API，缓存于 `public/data/voo.json`、`public/data/qqq.json`。保留来源 OHLC、Adj Close、成交量与复权因子，供核对。

前复权价格 = 每日 OHLC × (Adj Close / Close) ÷ 最新完整交易日 (Adj Close / Close)。历史窗口变化不会重设复权基准；来源 OHLC 已含 Yahoo 拆股处理，成交量不做价格复权。

周／月 K 线按复权日线聚合：首开、最高、最低、末收、成交量求和。窗口边缘的周期可能不完整。日期使用 America/New_York；未上市、缺失和未收盘日不补值。白色阳线表示收盘不低于开盘，黑色阴线表示收盘低于开盘。

### 恐慌与贪婪指数

本地快照为 `public/data/fear-greed.csv`。2011-01-03 至 2021-01-29 使用[上游仓库](https://github.com/whit3rabbit/fear-greed-data)的第三方历史合并存档，自 2021-02-01 起为上游从 CNN 接口取得的数据；此分界不代表本站独立认证准确性。

更新时优先 CNN 历史接口，失败或滞后时回退存档。仅使用历史日期与分数，不以即时分数代替日终数据。周／月取周期内最后一条记录，周从星期一开始；休市和缺失日期不补值。图中红线跟随 F&G 加投阈值（默认 10），右上角分数对应显示区间末条记录。

### 近月回撤金字塔信号

回看前一个日历月（包含当天、月底对齐）的最高 high，以当日 close 计算回撤。回撤不足 5% 投入 N；其余每满 5% 增加 2N：5% 为 2N、10% 为 4N，最多 38N。

不存在的定投日对齐月末，休市顺延；每个定投所属月份各买一次，上月顺延至本月的买入不占本月额度。同一执行月份可能包含上月顺延及本月定投两笔。按完整可用日线历史计算后筛选显示窗口，缩放和拖动不重置策略状态。初期历史不足一个月时使用当时已有数据。

### F&G 恐慌额外加投

F&G 日终指数从不低于阈值跌至阈值下方时，额外加投 1×N（蓝色 Buy 1x），与绿色月度定投独立累加。默认阈值 10，可调整；触发后须回升到阈值 +5 才可再次触发，避免临界值附近重复买入。这是策略缓冲带，并非统计置信区间。信号在指数日期之后的首个可用 ETF 交易日展示；无后续完整行情时暂不生成买入。

明细和 CSV 区分两类信号，记录指数信号日期、分数及阈值；同日发生时分别列出并合计投入金额。按完整历史识别下穿，首条指数数据已低于阈值时不会假造下穿，ETF 上市前的信号不会补买。

信号仅用于展示，不执行下单或发送通知。

## 技术栈

| 层次 | 技术与用途 |
| --- | --- |
| 页面与交互 | HTML5、CSS、原生 JavaScript ES Modules；响应式布局，固定浅色模式 |
| 图表 | Canvas 2D 自行绘制 K 线与情绪曲线；SVG 图标与逻辑图；Pointer Events 实现拖动和双指缩放 |
| 浏览器能力 | Fetch API 加载快照，localStorage 保存定投设置，原生 dialog 展示策略说明，Blob 导出 CSV |
| 本地服务与更新 | Node.js 20+；使用内置 HTTP、文件系统、子进程和测试模块；Fetch 下载外部数据，代理请求使用系统 curl |
| 数据存储 | CSV / JSON 文件快照、来源状态清单、文件锁与临时文件原子替换 |
| 测试与发布 | node:test / node:assert；GitHub Actions 运行测试、更新数据并构建，GitHub Pages 托管静态站点 |

`package.json` 当前没有 `dependencies` 或 `devDependencies`，不需要 `npm install`。本地运行需要 Node.js；通过代理抓取数据还需要 PATH 中可用的 curl。静态站点访问者只需要浏览器。浏览器验收使用外部环境提供的 Playwright + Edge，不作为项目依赖安装或发布。

## 开源项目与致谢

| 项目 | 本项目的使用方式 | 上游许可证 |
| --- | --- | --- |
| [Node.js](https://github.com/nodejs/node) | 本地服务、数据更新、构建和测试的运行时 | [MIT，另含各组件声明](https://github.com/nodejs/node/blob/main/LICENSE) |
| [curl](https://curl.se/) | `server/network.mjs` 调用系统 curl 下载数据，支持代理 | [curl license](https://curl.se/docs/copyright.html) |
| [whit3rabbit/fear-greed-data](https://github.com/whit3rabbit/fear-greed-data) | 恐慌与贪婪指数历史存档与更新回退来源 | [MIT](https://github.com/whit3rabbit/fear-greed-data/blob/main/LICENSE)；原始数据权利需另外核对 |
| [TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) | K 线像素对齐与实体／影线绘制细节的实现参考；当前未引入其运行库或分发库包 | [Apache-2.0](https://github.com/tradingview/lightweight-charts/blob/master/LICENSE)，另有 [NOTICE](https://github.com/tradingview/lightweight-charts/blob/master/NOTICE) |
| [Playwright](https://github.com/microsoft/playwright) | 开发时的桌面与触摸交互验收，不属于运行依赖 | [Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE) |

自动发布使用 GitHub 官方开源 Actions：`actions/checkout`、`actions/setup-node`、`actions/configure-pages`、`actions/upload-pages-artifact` 和 `actions/deploy-pages`；具体版本见 [工作流](.github/workflows/pages.yml)，各 Action 的许可见[第三方来源说明](THIRD_PARTY_NOTICES.md)。GitHub Pages 为托管服务。

策略计算参考 **labmem004** 编写、用户提供的 Pine v6 脚本，逻辑 SVG 由用户提供。原始发布链接及授权尚未记录，不能将其默认认定为可按本项目协议再许可。来源与授权范围详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 许可证与数据使用

**建议项目自有原创代码采用 [MIT License](https://opensource.org/license/mit)**：允许使用、修改、再分发和商业使用，要求保留版权与许可声明，并包含免责条款，适合这类可自行部署的小型工具。

**当前授权状态：仓库尚未添加 LICENSE，MIT 是建议方案，尚未正式采用。** 公开可访问不等于已经授予开源使用许可；`package.json` 的 `private: true` 仅用于防止误发布到 npm，不是许可证。

正式采用前需确认用户提供的 Pine 脚本及逻辑图的授权，并明确原创代码与第三方材料的边界。采用 MIT 也不会替换第三方原有协议；如果引入或改编第三方受许可代码，须按对应协议保留版权、许可及所需 NOTICE。

CNN、Yahoo Finance 是外部数据服务，不是本项目的开源依赖。`public/data/` 快照、导出 CSV、引言引用及其他第三方内容不因代码采用 MIT 而取得再分发授权；数据及引用材料仍受原权利人条款约束。参考 [Yahoo 服务条款](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html)、[CNN 使用条款](https://www.cnn.com/terms)及上游声明。

## 开发与部署

```sh
node --test test/*.test.mjs     # 运行测试
node scripts/update-data.mjs   # 手动更新各来源
node scripts/build-site.mjs    # 构建静态站点到 dist/
```

- [数据更新与部署](docs/deployment.md)：代理、来源切换、定时补抓、状态、锁和 GitHub Pages 配置。
- [更新记录](CHANGELOG.md)：功能演进与历史修改。
- [提交与发版规范](COMMIT_GUIDE.md)：语义化版本、徽标同步、更新记录与发布校验。
- [架构说明](docs/architecture.md)：目录职责、依赖方向、启动流程与维护约定。
- 项目结构：`public/js/` 前端与共享计算，`public/css/` 样式，`server/` 本地服务和更新器，`scripts/` 命令入口，`test/` 测试；`server.mjs` 保留为启动入口。

原始数据及相关权利归来源方所有；公开发布前请核对 Yahoo、CNN 及上游的数据使用条件。数据日期到齐不保证来源以后不会修订。
