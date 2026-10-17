# 数据更新与部署

## 运行方式

目标仓库：https://github.com/spicy-man/DCA-tool 。预计 Pages 地址为 https://spicy-man.github.io/DCA-tool/ （以 GitHub 实际发布地址为准）。部署由仓库 main 分支的 GitHub Actions 工作流执行；实际状态可在仓库 Actions 与 Settings → Pages 查看。

### 更新入口

- 本地：运行 node server.mjs，页面“更新数据”通过同源 POST /api/refresh 调用 updater.mjs。
- 命令：node scripts/update-data.mjs；数据不齐或来源失败退出码为 1。所有来源独立校验、独立原子替换，失败源保留原文件。
- 定时补抓：node scripts/update-data.mjs --scheduled；只有前一轮已成功、实际快照日期满足目标交易日的来源才跳过网络。手动运行默认强制重新检查所有来源。
- FEAR_GREED_SOURCE=auto（默认）优先 CNN 历史接口，失败或日期滞后时尝试第三方存档；cnn 只用 CNN，archive 只用存档。可用 GitHub 仓库变量 FEAR_GREED_SOURCE 配置。
- 指数只使用 historical.data 中的历史日期与分数，不把即时分数当作日终数据。CNN 日期字段按 UTC 日期标签处理；2021-02-01 前保留现有第三方存档。
- ETF 每个目标交易日首轮重新下载全历史和 Adj Close，重算整段前复权。已有日期丢失（即使总条数不变）、无效 OHLC、重复日期等均拒绝替换。暂时失败最多重试一次；明确返回拒绝访问或限流时不重试、不绕过。

### 调度和状态

.github/workflows/pages.yml 在北京时间每天 06:17、08:17、10:17 执行，并支持 main 推送与手动执行。按 America/New_York、周末、常规美股节假日与提前收盘计算目标日期；收盘后留 60 分钟缓冲。临时休市规则需要随交易所公告维护，不代表交易所实时日历服务。

public/data/status.json 记录各来源的数据日期、来源、最近检查时间、最近成功时间、fresh 与 ok。下载成功但日期不足，仍标为未到齐并使任务失败。页面会根据当前时间重新判断目标日期，不盲信旧 manifest 的 fresh=true。日期到齐仅说明来源已提供该日数据，不保证上游以后不修订。

同一进程合并并发请求，不同进程通过 public/data/.refresh.lock 排他写入；正常结束释放锁。异常退出若留下锁，必须先确认没有更新进程运行再移除，不能在任务运行中删锁。临时文件使用唯一名称。接口有 60 秒冷却并拒绝跨站调用。本地服务默认仅监听 127.0.0.1；不要直接作为公开 API 使用。

### 发布

1. 将项目上传到上述仓库的 main 分支（不上传 dist 和临时锁文件）。
2. 在仓库 Settings → Pages → Build and deployment 中选择 GitHub Actions。
3. 确保允许工作流写入仓库内容；若 main 保护规则禁止机器人直推，数据持久化步骤会失败，需按仓库规则授权或另行采用数据分支。
4. 在 Actions 中运行 Update data and deploy Pages，检查更新、保存与部署步骤。定时任务可能延迟，不能承诺准点；GitHub 还可能在公开仓库长期无活动后停用定时任务。需要关注失败通知和页面日期。

工作流先运行测试，再更新数据、保存有效快照与状态、打包并发布。来源失败时仍发布保留的数据和失败状态，随后将任务标记失败；部署本身失败时网站仍是上一版本，可从 Actions 查看。Git 推送失败不会强制覆盖远端。自动数据提交不会再次触发本工作流，避免循环。

node scripts/build-site.mjs 生成 dist/，每次清理并重建这个固定输出目录。dist/deployment.json 标记静态模式，页面按钮变为“检查更新”，只重新读取已发布数据，不请求后台接口。资源均使用相对路径，兼容 /DCA-tool/。页面不包含 GitHub token、上游密钥或代理配置。普通访客不会触发数据源抓取。

### 数据使用条件

低频请求不等于获得采集或再分发许可。当前适配器不提供 Yahoo/CNN 的授权，也不承诺接口稳定可用；公开发布前应确认对应数据使用条件。第三方仓库代码的开源许可不能自动代表原始行情或指数的再分发许可。

参考：
- https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
- https://www.nyse.com/trade/hours-calendars
- https://github.com/whit3rabbit/fear-greed-data
- https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html


