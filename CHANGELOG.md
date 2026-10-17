# 更新记录

目前系统版本为 **v1.2.2** (更新日期: 2026-10-17)。

## 🔧 v1.2.2 修复月底漏投并完善策略说明 [FIX]

- **月底定投**：按定投所属月份保留每月计划，跨月顺延不再占用下月额度；覆盖 28–31 日、平闰年二月底及休市顺延。
- **可追溯明细**：提示、明细和 CSV 显示定投所属月份与计划日期，区分上月顺延和本月买入。
- **策略说明**：月度与恐慌加投采用一致风格的 SVG 流程图，默认适配弹窗，支持放大查看。
- **界面文案**：使用“每月定投日”“定投金额”“恐慌指数加投阈值”，数据日期与最近检查时间分行显示。

## 🔧 v1.2.1 统一加投标签缩放 [FIX]

- **标签缩放**：蓝色恐慌加投标签与绿色月度定投使用相同的紧凑显示规则，缩小图表时一同收起文字，放大后恢复；保留颜色、悬停明细和无障碍说明。

## ✨ v1.2.0 恐慌指数额外加投 [NEW]

- **蓝色加投信号**：F&G 下穿可调阈值（默认 10）时额外投入 1×N，回升至阈值 +5 后重置，与月度定投独立累加。
- **信号时点与明细**：在指数信号后的首个可用 ETF 交易日展示；明细、提示和 CSV 区分信号类型，记录指数日期、分数及触发阈值。

## ✨ v1.1.0 架构整理与体验完善 [NEW]

- **版本标识**：站名旁显示版本徽标，加入版本同步与一致性检查，并补齐本项目的提交发版规范。
- **架构整理**：分离共享计算、图表、界面和服务端，统一数据更新入口，便于后续维护。
- **移动图表**：支持双指缩放、单指拖动与双图窗口同步；窄屏工具栏保持一行，布局切换移到页头。
- **阅读体验**：更名为“定投助手”，替换图标，两则投资引言移至图表下方，并强化固定浅色模式。
- **策略说明**：通过按钮查看逻辑 SVG，支持放大；补充 Pine 原作者 labmem004 的署名。
- **项目文档**：重写使用说明，拆分部署与架构文档，补充开源参考项目及许可状态。

## 历史变更（未标注日期）

以下为原 README 中的开发记录，按原顺序保留。当时的默认值可能已被后续修改替代；当前用法见 [README](README.md)。

## ETF 前复权行情

新增 VOO / QQQ 可切换的黑白 K 线，与情绪指数共用日期范围、日/周/月频率及十字线。空心表示收盘不低于开盘，实心表示下跌。右上角显示当前窗口末根 K 线的收盘价；百分比相对窗口内上一根 K 线收盘计算。没有上一根时不显示涨跌幅。

行情来自 Yahoo Finance Chart API，保存为 public/data/voo.json 和 qqq.json。每个记录保留来源 OHLC、Adj Close、成交量及复权因子供核对。前复权公式：每日 OHLC × (Adj Close / Close) ÷ 最新完整交易日 (Adj Close / Close)。包含拆股、现金分红调整，并保证最新完整交易日价格等于来源报价。来源 OHLC 已含 Yahoo 的拆股处理，不应视为当年实际成交原价。成交量未做价格复权。切换历史日期不重新锚定前复权基准。

周/月 K 线由区间内复权日线聚合：首开、最高、最低、末收及成交量求和；区间边界的周期可能不完整。QQQ 历史覆盖 1999 年起的可用交易日，上线前、缺失日及未收盘日不补造数据。交易日期使用 America/New_York。截图绿色买入标签未实现。

Refresh 同时尝试更新情绪指数、VOO 和 QQQ，三者独立验证与原子替换，部分失败会单独提示并保留该数据源缓存。行情刷新会重新下载全历史，确保后续分红调整传递到历史价格。页面分别记录行情日期与最近检查时间，不把下载成功等同于数据到齐。

行情代理支持 MARKET_DATA_PROXY、HTTPS_PROXY/ALL_PROXY；Windows 无环境变量时使用已启用的系统 HTTP/HTTPS 代理，未配置则直连。MARKET_DATA_PROXY=direct 可强制直连。使用已有 curl 传输代理请求，不将代理认证信息放入命令参数或错误文本。

新增文件：market.mjs、public/market-data.mjs、public/market-chart.mjs、public/data/voo.json、public/data/qqq.json、test/market.test.mjs。更新文件：server.mjs、public/app.mjs、public/index.html、public/style.css、README.md。

## 图表缩放与拖动

两张图都支持：滚轮以鼠标位置为锚点缩放；按住鼠标左键左右拖动；Shift + 滚轮或触控板横向滚动平移；双击恢复上次选择的预设范围并回到最新日期。聚焦图表后也可用左右方向键平移、加减键缩放、Home 重置。两图时间窗口同步，手动操作时 Range 显示 Custom；Latest 保留缩放宽度并移动到最新日期。范围限制在已有指数历史内，最小窗口 14 个自然日，不生成未来或缺失数据。

K 线画布配色取自用户参考图：背景 #DBDBDB、黑色边线及影线、上涨白色实体、下跌黑色实体，去掉背景网格，保留细点状收盘价线。绿色标签仍未添加。隐藏的数据表仅在展开时更新，避免拖动时反复创建大量表格单元。

本次新增 public/chart-navigation.mjs、test/navigation.test.mjs；修改 public/app.mjs、public/market-chart.mjs、public/index.html、public/style.css、README.md，无删除。

## K 线绘制细节修正

对照用户 TradingView 截图，重新核对交易日间距、实体占比、边框/影线像素宽度及主图比例，并参考 TradingView Lightweight Charts 官方渲染实现：https://github.com/tradingview/lightweight-charts/blob/master/src/renderers/candlesticks-renderer.ts 。本站仍使用自己的绘制代码，没有引入第三方图表运行库。

- 两图共用交易周期坐标，周末不占横向槽位。以 VOO 可用交易日和情绪数据日期构造共用时间轴；周/月按周期映射，同周的不同末次记录仍在同一横向位置。
- 主图使用设备像素绘制实体与上下影线，不再使用小数像素 strokeRect 叠加描边。实体与影线保持同奇偶宽度，确保居中，白色内芯仅在空间足够时绘制，十字星保留细实体。
- 实体宽度随槽位缩放，取消原先 18 像素上限；收盘线仍为点线。图表背景 #DBDBDB、白色上涨实体、黑色下跌实体/边框/影线保持不变。
- 主图增加到桌面宽度约 43% 的高度，手机 400 像素；右侧价格轴使用整洁刻度，最右保留 3 根 K 线槽位空白。
- 默认范围改为一年，提高默认可读性。其余时间范围、VOO/QQQ、复权、导出与更新口径保持不变。

本次新增 public/chart-geometry.mjs、test/geometry.test.mjs；修改 public/app.mjs、public/market-chart.mjs、public/chart-navigation.mjs、public/style.css、public/index.html、README.md，无删除。


标的调整：QQQM 替换为 QQQ，新增 public/data/qqq.json（1999-03-10 起），删除旧 public/data/qqqm.json；更新 server.mjs、public/market-data.mjs、public/index.html、test/market.test.mjs 和 README.md。

## 1140px 紧凑页面

页面正文最大宽度 1140px，居中布局；收紧页头、筛选工具栏、卡片标题和上下留白。标准布局下，桌面两图高度按可用窗口高度分配（K 线约 62%、情绪图约 38%，设有最小和最大值），优先在一屏内完整展示两张图。来源说明仍在图表下方，展开数据表和 Expanded 布局允许页面滚动。手机保持上下排列与足够的操作高度。本次仅修改 public/style.css、README.md，无新增或删除文件。

## 月跌幅金字塔定投信号

按用户提供的 Pine v6 脚本逐日移植，使用已收盘的前复权日线。可在图表标题旁选择每月 1–31 日、设置 N（USD，默认 1000）及切换标签显示；选项保存在当前浏览器 localStorage。计算模块为 public/pyramid-strategy.mjs，图上标签、设置和信号导出由 public/strategy-overlay.mjs 管理。

回看前一个日历月（包含当天、月底对齐）的最高 high，使用当日 close 计算 `max(0, 1 - close / high)`；`level=min(19,floor((drawdown+1e-10)/0.05))`；0 档为 1N，其余为 2×level×N。最低一档不满 5% 时也买入 N；最高 38N。当前日 high 也参与最高价计算。

不存在的定投日先对齐当月最后一个自然日，休市顺延。严格保留 Pine 的 rolledDue 行为：如果上月月底尚未到期就结束了交易日，则本月首个交易日执行；每个实际执行月份只买一次，顺延买入后当月不会再额外买一次。初始历史不足整月时按当时已取得的日线计算，与 Pine 首条历史行为一致。

先计算标的完整日线历史，再筛选显示窗口；拖动和缩放不重置策略状态。日 K 显示 Buy 1x、Buy 2x 等绿色标签，周/月 K 不显示并提示仅适用 1D。密集区间标签缩为三角，放大后显示文字；每个信号可悬停、聚焦或点击查看。行情明细中提供当前区间的信号表、合计投入和 CSV 导出，即使标签隐藏，明细仍保留计算结果。这里实现图表信号，不执行下单或发送通知。

Tooltip 仅参考用户图片的左右两列排版：字段左对齐，数字右对齐并使用等宽数字；保留网站现有深色样式。普通日线展示开高低收，买入信号额外展示近月高点、回撤、倍数和金额。

测试覆盖闰年、月末回看、跨月顺延、5% 临界值、38N 上限、每月去重和历史前缀不变性，并以 VOO / QQQ 全历史及六种定投日对照独立参考实现。浏览器验证设置保存、标签更新、Tooltip 两列对齐、周线限制、导出、缩放、手机宽度和 1366×768 两图同屏。

本次新增 public/pyramid-strategy.mjs、public/strategy-overlay.mjs、public/tooltip.mjs、test/strategy.test.mjs；修改 public/index.html、public/market-chart.mjs、public/app.mjs、public/style.css、README.md，无删除。

## 品牌、默认布局与术语

名称改为“候潮”，页面标题“行情与定投信号”，浏览器标题“候潮 · 行情、情绪与定投信号”。新增 public/logo.svg，使用坐标轴和走势节点图形，页头及 favicon 共用同一图标。默认布局改为“展开”，仍可手动切回“紧凑”；此默认要求取代之前优先一屏显示的默认布局。

定投日期、基准金额 N 和信号开关继续使用原 localStorage 存储键 seeker.pyramid.v1，避免更名丢失已保存设置。同一浏览器配置及同一来源地址（协议、主机和端口）会恢复这些值；数值验证与安全读取逻辑保持不变。浏览器实测覆盖刷新后恢复和关闭标签后新开同源标签恢复。

中文界面统一范围、周期、布局、日期、市场情绪等级、表头、更新和导出按钮。“月跌幅”更正为“近月回撤”，避免与自然月涨跌幅混淆；“空心上涨／实心下跌”更正为“白色阳线／黑色阴线”，避免与相对前日涨跌混淆。保留 VOO、QQQ、ETF、USD、CSV 和数据源名称。CSV 导出列名、原始来源标签以及计算函数的机器标识保持不变，保证已有数据与测试兼容。

本次新增 public/logo.svg、public/labels.mjs；修改 public/index.html、public/app.mjs、public/market-chart.mjs、public/strategy-overlay.mjs、public/style.css、README.md，无删除。

最终品牌由用户选定为“候潮”，意为按节奏投入、等待市场起落。SVG 改为圆形潮汐曲线与小圆点，移除坐标轴和走势箭头，页头与浏览器图标同步替换。用户明确要求保持原标签文本，因此图上继续使用 Buy 1x / Buy 2x 等，不作中文翻译；其余中文术语调整继续保留。本地偏好的原存储键不变。

## 图表设置分组

范围、周期、布局、回到最新及日期区间整合到 K 线卡片顶部的共用工具栏，继续同步控制两张图。每月定投日、基准 N、USD 和买入信号开关移出标题行，在标的标题下单独成行。操作提示放到图表底部。仅调整 public/index.html、public/style.css、README.md；原有控件 ID、本地偏好与计算逻辑保持不变，无新增或删除项目文件。

## 顶部投资提醒

页头下方加入两则简短提醒，桌面左右排列、手机上下排列。巴菲特段采用“理念整理”，分批投资低成本宽基指数的内容参考 CNBC 的 2002 年股东大会记录，“回去工作”仅找到二手转述，已分别提供来源链接并明确不作逐字原话。林奇段为《战胜华尔街》公开出版社节选的意译，主要参考第一章定期投资与市场恐慌时持续买入的段落，不将其写成保证获胜的承诺。

来源：
- https://buffett.cnbc.com/video/2002/05/04/morning-session---2002-berkshire-hathaway-annual-meeting.html
- https://www.yahoo.com/news/2013-12-30-warren-buffetts-super-simple-retirement-advice.html
- https://www.simonandschuster.com/books/Beating-the-Street/Peter-Lynch/9781451687064#excerpt

本项仅修改 public/index.html、public/style.css、README.md，无新增或删除项目文件。

页面调整：页面背景改为白色 #FFFFFF；K 线画布保留 #DBDBDB。主标题改为“定投信号”，浏览器标题改为“候潮 · 定投信号”。本次修改 public/style.css、public/index.html、README.md，无新增或删除文件。已在浏览器核对页面背景及画布像素。

更正背景范围：用户指的是引言背景。页面恢复 #DBDBDB，仅 .investment-notes 引言区域使用白底；主标题“定投信号”保持。本次修改 public/style.css、README.md，无新增或删除文件。

页面底色按用户指定改为 #F5F6FA；顶部引言继续白底，K 线画布继续 #DBDBDB。本次修改 public/style.css、README.md，无新增或删除文件。

引言正文字号缩小一档：桌面 13px → 12px，手机 12px → 11px；署名与其他区域保持不变。本次修改 public/style.css、README.md，无新增或删除文件。

贪恐指数画布高度调整为原来的 80%（降低 20%）：展开模式 280px → 224px；桌面紧凑模式及手机标准模式同步按 80% 缩放，K 线高度不变。本次修改 public/style.css、README.md，无新增或删除文件。

贪恐指数新增固定在数值 10 的红色水平参考线（#D05B4B，1.2px），绘制于走势下方，缩放或切换周期后保持同一指数位置。本次修改 public/app.mjs、README.md，无新增或删除项目文件。

术语按用户偏好统一为“恐慌与贪婪指数”“恐慌”“极度恐慌”，同步标题、情绪等级、提示框、图内文字及可访问标签。英文原始数据和计算口径不变。本次修改 public/index.html、public/app.mjs、public/labels.mjs、README.md，无新增或删除文件。



## 自动更新与静态部署

加入独立数据更新器、数据校验和原子替换、来源状态清单、更新锁、交易日判断、定时补抓及 GitHub Pages 工作流。运维说明见 [数据更新与部署](docs/deployment.md)。
