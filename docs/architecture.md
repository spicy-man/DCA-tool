# 架构说明

项目采用原生 ES Modules，浏览器静态页面与 Node.js 服务共用无环境依赖的领域计算模块。保持零 npm 运行依赖；本地服务与 GitHub Pages 使用同一份前端。

## 目录与职责

```text
server.mjs                      本地启动入口，保留 node server.mjs / start.cmd 用法
server/
  http-server.mjs               静态文件、刷新接口、同源检查和冷却
  updater.mjs                   唯一数据更新编排入口 refreshAll
  network.mjs                   HTTP 下载、代理选择和 Yahoo URL
  storage.mjs                   快照校验、文件锁、原子写入
  symbols.mjs                   自定义标的读写、校验与删除同步
  refresh-schedule.mjs          纽约时区定时更新计划门禁
  sentiment-history.mjs         早期情绪指数历史补缺合并
  nasdaq-funds.mjs              两组 ETF 共用行情、备用源与披露资料解析
  fund-performance.mjs         ETF与QQQ历史下载、原币种1/3/5年累计涨幅与失败保留编排
public/
  index.html                    主页结构和首屏浅色声明
  nasdaq-funds.html             国内纳指100 ETF 独立对比页面
  sp500-funds.html              国内标普500 ETF 独立对比页面
  style.css                     CSS 加载入口，固定加载顺序
  css/                          页面布局、页头、策略弹窗、统计概览、回测与浮动小窗样式
  js/
    app.mjs                     主页启动入口：组合并初始化功能
    funds-page.mjs              基金对比二级页面独立启动入口
    application.mjs             双图窗口协调、页面控件和状态呈现
    domain/                     数据解析、复权、聚合、策略、交易日和数据健康计算
    charts/                     坐标几何、Canvas 情绪图绘制、指针/键盘导航
    features/market/            行情缓存、K 线视图与行情控件
    features/strategy/          定投偏好、信号展示、资金统计、回测对比与明细
    services/data-client.mjs     浏览器 HTTP 请求与部署模式判断
    services/events.mjs          应用内部事件通道与名称
    ui/                         术语、Tooltip、策略弹窗、自定义标的弹窗与桌面小窗
  data/                         真实快照与来源状态，独立于源码重构
  diagrams/                     用户提供的逻辑图
scripts/                        命令行更新和静态构建入口
test/                           领域、后端、交互及架构边界测试
docs/                           架构和部署说明
```

## 依赖方向

1. **domain** 只做计算，不读取 DOM、浏览器存储、网络或磁盘；Node.js 和浏览器均可导入。
2. **charts** 依赖领域计算与图表几何，绘图函数接收 canvas 和视图数据；导航以回调提交窗口，不自行修改页面筛选器。
3. **services** 封装浏览器数据访问及应用内通知，不直接修改 DOM。
4. **features / ui** 负责各自的界面；带界面行为的模块通过 init 函数注册事件，导入阶段不操作 DOM 或发请求。
5. **application** 协调日期范围、两图联动与刷新；**app** 按依赖顺序初始化策略控件、行情视图、弹窗和应用控制器。
6. **server** 可以依赖 domain，不能依赖浏览器视图；网络层不写快照，所有更新经 updater 调用 storage 完成。

当前两个图表功能各自维护显示数据，application 持有共用时间窗口。跨功能通知统一经应用局部 EventTarget，事件名集中定义于 events.mjs：marketCalendar、marketHover、strategySettings、sourceHealth。禁止向全局 window 添加新的业务事件。

## 数据流与更新入口

浏览器 data-client 读取发布快照 → domain 解析/聚合 → application 与功能模块生成视图 → charts 绘图。URL 相对页面解析，不相对脚本文件解析，兼容 GitHub Pages 的 /DCA-tool/ 子路径。

本地更新：页面 → POST /api/refresh → server/updater.mjs 的 refreshAll → network 下载 → domain 校验/计算 → storage 锁和原子替换。命令行和定时任务也调用同一 refreshAll。旧的 refreshETF 独立写入路径已移除，禁止另建绕过锁、历史保护或来源状态记录的写入通道。

主页 QQQ 行情卡片右下角的主题色链接进入 `nasdaq-funds.html`，二级页面仅初始化基金对比，不加载美股图表与回测。国内基金对比使用独立快照 `nasdaq100-etfs.json` 和 features/funds/comparison.mjs；不加入以美股交易日判断健康度的 results，也不进入美元回测。每日脚本调用 updater 的 refreshFunds，和 refreshAll 共用 withDataLock 与 atomicWrite；本地整体更新通过 includeFunds 在同一锁内更新。行情必须覆盖配置的12只，校验价格、时间、净值与回退字段口径，不接受逐只时间倒退。行情失败保留整份旧快照；规模或费率抓取失败保留此前披露值和日期。浏览器通过 fundsUpdated 重新读取快照。

静态站点：刷新图标置灰禁用，提示仅本地部署可更新数据。构建仅复制 public 到 dist，并写入静态部署标记；不需要打包编译 JavaScript。源码不会随服务端模块发布到 Pages。

## 样式与资源

style.css 按 page.css → header.css → strategy-dialog.css → strategy-summary.css → backtest.css → floating-charts.css 的顺序加载，保留已有级联结果；页面始终声明浅色模式，背景色不依赖系统偏好。页面样式保留响应式级联顺序，已清理被后续同选择器覆盖的声明；后续视觉整理应配合多尺寸计算样式和截图验证。

数据、SVG 原图、来源链接、本地偏好键 seeker.pyramid.v1 和数据文件格式保持稳定。后续改文件位置时，同时更新 ES Module 引用、测试、README 和第三方来源说明；历史 CHANGELOG 中的旧路径保留为当时记录。

## 验证与维护

- node --test test/*.test.mjs：测试数据计算、更新保护、导航与模块边界。
- node scripts/build-site.mjs：固定输出 dist/，只复制 public，不抓取或改写真实数据。
- 浏览器检查本地模式与静态子路径，覆盖标的/周期、双图窗口、双指缩放、布局、策略偏好、导出和说明弹窗。
- 调整目录时保持 server.mjs、scripts/ 命令和 GitHub Actions 调用方式兼容；导入模块不应隐式启动服务、访问真实数据或绑定 DOM。

这是小型单页应用的职责分层，不引入框架、数据库或依赖注入容器。若后续新增多个页面，再按实际复用需求演进。

## 国内基金分组

`domain/fund-groups.mjs` 固定配置纳指100/QQQ与标普500/VOO的基金名单、基准、费率来源、页面及快照路径。`fund-navigation` 随主页标的切换入口；共享二级页启动器按 body 的 `data-fund-group` 选择配置。网络层仅接受配置内的快照路径，界面校验基准代码，历史缓存不跨基准复用。updater 在同一数据锁内逐组校验、原子保存，单组失败保留该组原数据；返回的 groups 和 complete 汇总两组结果，逐组文件不包含汇总状态。静态构建只发布明确列入白名单的两组快照。
