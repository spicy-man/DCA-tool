# 数据更新与部署

## 运行方式

目标仓库：https://github.com/spicy-man/DCA-tool 。预计 Pages 地址为 https://spicy-man.github.io/DCA-tool/ （以 GitHub 实际发布地址为准）。部署由仓库 main 分支的 GitHub Actions 工作流执行；实际状态可在仓库 Actions 与 Settings → Pages 查看。

### 更新入口

- 本地：运行 node server.mjs，页面“更新数据”通过同源 POST /api/refresh 调用 server/updater.mjs。
- 命令：node scripts/update-data.mjs；数据不齐或来源失败退出码为 1。所有来源独立校验、独立原子替换，失败源保留原文件。
- 可选补抓：node scripts/update-data.mjs --scheduled；只有前一轮已成功、实际快照日期满足目标交易日的 ETF 来源才跳过网络，指数始终重新请求。所有自动定时轮次均强制重新请求，包括收盘后两轮联动及每六小时的独立指数更新，以接收上游修订。跳过网络时保留上次实际检查时间。手动运行默认强制重新检查所有来源。
- REFRESH_SOURCES 可用逗号指定来源（Fear & Greed、SPY、QQQ、VGT、SMH）；未指定时更新全部。未选来源的快照及检查状态保持原样，requestedSources 记录本轮所选来源，requestedComplete 表示本轮来源成功且到齐，complete 按当前目标日期判断全部来源；未选来源仍缺数据时 complete=false，命令仍退出 1，避免 ETF 成功掩盖指数缺失。
- FEAR_GREED_SOURCE=auto（默认）优先直接请求 CNN graphdata/2021-02-01 历史接口，使用上游 fetch_cnn.py 的完整 User-Agent、Accept、Origin、Referer 配置及 30 秒请求超时；与上游相同支持 CNN_FETCH_USER_AGENT 环境变量，Actions 从同名仓库变量传入，未设置时使用上游默认值；直连 fetch 与代理 curl 使用同一组请求头。仅网络请求失败（含 HTTP 错误）时尝试第三方存档；请求成功但响应解析或历史校验失败时保留本地数据并报告具体原因，不自动切源；有效数据日期滞后时继续使用 CNN 并提示缺失日期。cnn 只用 CNN，archive 只用存档；首次缺少 2021 年以前历史时需显式使用 archive 初始化。可用 GitHub 仓库变量 FEAR_GREED_SOURCE 配置。
- 指数按上游 fetch_cnn.py + build_combined.py 处理 fear_and_greed_historical.data：所有时间戳取 UTC 日期，包含实时尾点，同日保留响应中最后一条及其评级，不按美股收盘时间过滤。历史接口请求 2021-02-01 起的数据；如果响应范围缩短，更早的本地历史仍保留，响应范围内接收官方修订，若缺少范围内已有日期则拒绝覆盖。CNN 与备用存档均在最新日期超过 7 天时拒绝写入。2021-02-01 前的第三方存档及独立历史补缺保持原有保护。
- ETF 每个目标交易日首轮重新下载全历史和 Adj Close，重算整段前复权。已有日期丢失（即使总条数不变）、无效 OHLC、重复日期等均拒绝替换。暂时失败最多重试一次；明确返回拒绝访问或限流时不重试、不绕过。

### 调度和状态

.github/workflows/pages.yml 使用 America/New_York 时区自动适配夏冬时，并支持 main 推送与手动执行。K 线仅在交易日收盘后 3 分钟、63 分钟各更新一次：常规为纽约时间 16:03、17:03（北京时间夏令时次日 04:03、05:03，冬令时次日 05:03、06:03）；提前收盘为纽约时间 13:03、14:03。工作流还会在候选时点启动轻量日历检查，但非当日收盘对应时点不抓 K 线、不部署。

FNG 固定在纽约时间每天 16:03、22:03、04:03、10:03 重新抓取，周末与节假日也执行，以接收历史修订。以常规收盘后 3 分钟为起点，纽约本地时间每 6 小时一轮；夏冬时切换当天的实际时间间隔可能为 5 或 7 小时。除这四个固定时点外，FNG 在交易日的两轮 ETF 收盘更新中也一起重新获取：正常收盘为 16:03、17:03，提前收盘为 13:03、14:03；重合时只请求一次。所有这些轮次即使日期已到齐也重新获取，不增加 07:35／08:35／09:35 等额外补抓时段。CNN 仅在网络请求失败时自动回退存档；数据校验失败或日期滞后不自动切源。CNN 与备用存档网络瞬时失败最多重试一次，401/403/418/429 不重试，不轮换请求身份。备用源仍可能滞后或失败，不保证当天数据必定可用。历史修订会覆盖对应日期分数，可能改变历史策略信号；当前快照不是当时可见数据的逐次存档。

数据目标日期按 America/New_York、周末、常规美股节假日与提前收盘计算；收盘后留 3 分钟缓冲。临时休市规则需要随交易所公告维护，不代表交易所实时日历服务。调度门禁按触发的 cron 时点选择来源，避免任务延迟跨小时后误选来源；GitHub 定时任务可能延迟或丢失，不能保证收盘后精确 3 分钟执行。

public/data/status.json 记录各来源的数据日期、来源、最近检查时间、最近成功时间、fresh 与 ok。下载成功但日期不足，仍标为未到齐并使任务失败。页面显示指数与 ticker 的实际来源、降级原因及实际检查时间；ticker 相同状态合并为一行，不同或异常状态仍分别标出；页面、Actions 汇总及本地日志的时间统一使用 America/New_York，并显示 EST／EDT，并根据当前时间重新判断整体状态，不盲信旧 manifest 的 fresh=true。Actions 汇总分开记录 Pages 部署结果、本轮所选来源结果与全部来源状态；部署成功不会掩盖数据未到齐。日期到齐仅说明来源已提供该日数据，不保证上游以后不修订。

同一进程合并并发请求，不同进程通过 public/data/.refresh.lock 排他写入；正常结束释放锁。异常退出若留下锁，必须先确认没有更新进程运行再移除，不能在任务运行中删锁。临时文件使用唯一名称。接口有 60 秒冷却并拒绝跨站调用。本地服务默认仅监听 127.0.0.1；不要直接作为公开 API 使用。

### 发布

1. 将项目上传到上述仓库的 main 分支（不上传 dist 和临时锁文件）。
2. 在仓库 Settings → Pages → Build and deployment 中选择 GitHub Actions。
3. 确保允许工作流写入仓库内容；若 main 保护规则禁止机器人直推，数据持久化步骤会失败，需按仓库规则授权或另行采用数据分支。
4. 在 Actions 中运行 Update data and deploy Pages，检查更新、保存与部署步骤。定时任务可能延迟，不能承诺准点；GitHub 还可能在公开仓库长期无活动后停用定时任务。需要关注失败通知和页面日期。

工作流先运行测试，再更新数据、保存有效快照与状态、打包并发布。来源失败时仍发布保留的数据和失败状态，随后将任务标记失败；快照保存或推送失败则停止构建和部署，避免发布未入库的数据。部署本身失败时网站仍是上一版本，可从 Actions 查看。Git 推送失败不会强制覆盖远端。自动数据提交不会再次触发本工作流，避免循环。

### 分支、并发与恢复

当前采用单主分支的持续部署流程：main 保存代码和行情快照，功能提交推送 main 后自动发布；版本标签及 Release 用于标记软件版本，不单独触发部署。该模式不要求 develop / release 等长期分支，但 main 的任何代码提交都应视为生产候选。

发布工作流仅允许 refs/heads/main，且每次运行均重新检出当前 main，包括排队任务和使用本版工作流的重试。任务共享 pages-and-data 并发组并使用 queue: max，避免后来的空日历检查挤掉等待中的代码发布；GitHub 最多允许 100 个待运行任务，执行先后仍以实际入队为准。

保存快照前与部署前分别比较本地 HEAD 和远端 main。远端已经前进、快照推送被拒绝、或无法确认远端时，任务失败并停止发布，不自动合并未经本轮验证的新代码。恢复时使用 Actions 的 Run workflow，选择 main；新任务会读取最新代码和已保存快照。部署门禁与 GitHub Pages 接受部署之间不是跨服务原子事务，但同一并发组内发布串行，新的 main 发布会随后处理。

GitHub 重跑历史任务沿用历史工作流定义，本次保护不会追溯修改旧任务。不要用旧版本的 Re-run jobs 恢复生产；使用 main 上的 Run workflow。若需回滚，应将所需软件修复或回滚提交推进 main 后发布，保留最新数据与可追溯历史。

代码协作时建议另设只读 pull_request 测试，并将其设为 main 的必需检查。目前仓库工作流只在合入 main 后测试；仅新增 PR 工作流也不会自动开启分支保护。若启用禁止直推的保护规则，还须为机器人快照写入设计明确的授权路径，或将快照迁移到独立数据分支，不能直接开启后使定时更新持续失败。

node scripts/build-site.mjs 生成 dist/，每次清理并重建这个固定输出目录。dist/deployment.json 标记静态模式，页面按钮变为“检查更新”，只重新读取已发布数据，不请求后台接口。资源均使用相对路径，兼容 /DCA-tool/。页面不包含 GitHub token、上游密钥或代理配置。普通访客不会触发数据源抓取。

### 数据使用条件

低频请求不等于获得采集或再分发许可。当前适配器不提供 Yahoo/CNN 的授权，也不承诺接口稳定可用；公开发布前应确认对应数据使用条件。第三方仓库代码的开源许可不能自动代表原始行情或指数的再分发许可。

参考：
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://www.nyse.com/trade/hours-calendars
- https://github.com/whit3rabbit/fear-greed-data
- https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html


