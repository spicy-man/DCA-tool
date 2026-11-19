# 数据更新与部署说明

- 目标仓库：`https://github.com/spicy-man/DCA-tool`
- 静态站点：`https://spicy-man.github.io/DCA-tool/`（以仓库 Settings → Pages 实际配置为准）

---

## 一、本地运行与手动更新命令

| 场景 | 命令 | 说明 |
| :--- | :--- | :--- |
| 启动本地服务 | `npm start`（或双击 `start.cmd` / `start.command`） | 默认监听 `127.0.0.1:4173`（局域网单人访问可设 `HOST=<局域网IP>` 或 `0.0.0.0`，见下方环境变量表），页面「更新数据」走同源 `POST /api/refresh`（60 秒冷却） |
| 更新全部数据 | `npm run update-data` | 强制刷新 F&G、全部美股标的及国内两组场内 ETF；来源失败或存在阻塞缺口时退出码 `1` |
| 定时模式更新 | `node scripts/update-data.mjs --scheduled --catch-up` | `--scheduled` 跳过已新鲜的 ETF（F&G 始终重抓）；`--catch-up` 自动补抓过期或缺失的来源 |
| 仅更新国内 ETF | `node scripts/update-funds.mjs` | 默认更新纳指 100 与标普 500 两组，可用 `--group=nasdaq100` 或 `--group=sp500` 指定单组 |
| 构建静态站点 | `npm run build` | 先校验版本一致性，再白名单复制 `public/` 到 `dist/` 并写入静态标记与 `.mjs` `?v=` 参数 |

---

## 二、数据源与环境变量

| 数据类别 | 主来源 / 备用来源 | 核心规则 |
| :--- | :--- | :--- |
| 美股日线（5 只内置 + 自定义） | Yahoo Finance Chart API | 用 `Adj Close` 重算整段前复权；拒绝无效 OHLC、重复日期或已有历史丢失；内置标的若存在缺失交易日会记录告警并在状态中标记不完整 |
| 恐慌与贪婪指数（F&G） | 主：CNN 官方接口（`2021-02-01` 起）<br>备：`whit3rabbit/fear-greed-data`（含 `2011–2021` 历史） | 仅网络/HTTP 失败时回退备用存档；数据校验失败或日期滞后不自动切源；拒绝未来日期与超 7 天陈旧数据 |
| 国内场内 ETF（12 纳指 + 4 标普） | 行情：东方财富（备：腾讯财经）<br>规模/费率：天天基金 F10<br>1/3/5 年收益：Yahoo Finance（基准复用本地 `qqq.json`/`spy.json`） | 必须覆盖组内全部基金且时间不倒退；历史收益按中美共同可用截止日对齐；单只历史失败仅禁用该只区间对比 |

### 可选环境变量（本地 / GitHub Actions Repository Variables）

| 变量名 | 默认值 | 用途 |
| :--- | :--- | :--- |
| `HOST` | `127.0.0.1` | 本地服务监听地址；受信任局域网单人访问可设为局域网 IP 或 `0.0.0.0`（切勿直接暴露公网） |
| `PORT` | `4173` | 本地服务监听端口 |
| `DATA_DIR` | `public/data` | 本地快照与状态文件读写目录 |
| `FEAR_GREED_SOURCE` | `auto` | `auto`（CNN 优先，网络失败回退存档）/ `cnn`（仅 CNN）/ `archive`（仅存档，首次初始化 2021 前历史需显式指定） |
| `CNN_FETCH_USER_AGENT` | 内置 Chrome UA | 覆盖请求 CNN 接口时的 `User-Agent` |
| `REFRESH_SOURCES` | 空（全部） | 逗号分隔指定本轮刷新来源，如 `Fear & Greed,SPY,QQQ` |
| `MARKET_DATA_PROXY` | 未设置 | 显式代理 URL；未设置时依次读取 `HTTPS_PROXY`/`HTTP_PROXY`/`ALL_PROXY`，Windows 无环境变量时回退读系统注册表代理；设为 `direct` 可强制直连 |

---

## 三、GitHub Actions 定时调度一览

工作流定义在 [.github/workflows/pages.yml](../.github/workflows/pages.yml)，使用 GitHub 原生时区自动适配夏/冬令时：

| 类别 | 调度时间（当地时区） | 抓取目标 | 说明 |
| :--- | :--- | :--- | :--- |
| **美股收盘联动** | 美东周一至周五 `16:01`、`17:01`<br>提前收盘日 `13:01`、`14:01` | 全部美股 ETF + F&G | 日历门禁只在实际交易日收盘 `+1` / `+61` 分钟放行，非收盘槽位直接跳过 |
| **F&G 定时更新** | 美东周一至周五 `10:01`、`16:01`、`22:01`<br>周二至周六 `04:01` | F&G（配合 `--catch-up` 顺带补抓过期 ETF） | 工作日美股节假日仍跑；周六 `04:01` 承接周五收盘修订与兜底，其余周末停跑 |
| **国内场内 ETF** | 北京周二至周六 `09:01`<br>周一至周六 `15:01`、`21:01` | `nasdaq100-etfs.json`、`sp500-etfs.json` | 不触发美股更新；周日及凌晨 `03:01` 停跑；周六 `09:01` 用于对齐周五美股基准收盘 |
| **代码推送 / 手动触发** | 推送 `main` 或手动 `workflow_dispatch` | 全部美股 + F&G + 国内 ETF | 仅 `push` 事件运行全量应用测试；仅 `public/data/**` 变化不触发 `push` 工作流 |

> [!NOTE]
> `server/refresh-schedule.mjs` 按触发的计划槽位选源，不因 GitHub 定时延迟跨小时而误选；修改 `.github/workflows/pages.yml` 中的美东 cron 小时时，必须同步更新 `server/refresh-schedule.mjs` 的匹配规则。

---

## 四、容错、防抖与并发保护

1. **原子写入与失败保留**：每个来源独立校验、临时文件原子替换；任一来源下载或校验失败均保留旧快照，不中断其他正常来源。
2. **2 小时收盘宽限 + 自动补抓（`--catch-up`）**：GitHub 定时任务常延迟数小时。收盘后 2 小时内（`hasBlockingDataGap` 默认 `graceMinutes = 120`），若仅 F&G 轮次抢跑而美股尚未到齐，不误报红灯；后续任意定时轮次带 `--catch-up` 会自动补齐过期或缺失的来源。
3. **无实质变动自动还原（抑制噪音提交）**：`scripts/filter-snapshot-commits.mjs` 在提交前对比 `HEAD`，若整体健康且仅有 `checkedAt`/`profileCheckedAt` 或东财同日盘后 `shares` 缓存抖动，则还原基线文件；定时轮次若最终无改动入库，自动跳过静态构建与 Pages 部署。
4. **并发与文件锁**：同进程合并并发刷新请求；跨进程通过 `public/data/.refresh.lock` 排他写入。异常退出残留的陈旧锁具备自动回收逻辑，但极端并发回收仍存在竞争边界，切勿在有存活更新进程时手动删锁；若需手工排障，须先确认无更新进程运行再清理残锁。
5. **瞬时重试与礼貌约束**：网络瞬时失败最多重试 1 次；遇 `401 / 403 / 418 / 429` 立即停止、不重试、不轮换身份。
6. **本地服务安全边界**：默认仅监听 `127.0.0.1`，写接口校验同源与 `Host` 白名单，仅供个人本地或受信任局域网单人使用，不要直接暴露公网。

---

## 五、首次部署与故障恢复

### 首次开启 GitHub Pages
1. 推送代码到仓库 `main` 分支（不要上传 `dist/` 和锁文件）。
2. 在仓库 **Settings → Pages → Build and deployment** 选择 **GitHub Actions**。
3. 确认工作流拥有写入仓库内容权限（若开启 `main` 分支保护禁直推，需为快照机器人配置授权或改用独立数据分支）。
4. 在 Actions 中手动运行一次 **Update data and deploy Pages** 验证全流程。

### 常见故障恢复
- **远端 `main` 前进导致保存或部署中止**：工作流在保存快照前与部署前均会核对本地 `HEAD` 与远端 `main`（`scripts/check-deploy-head.mjs`），发现落后立即中止，绝不覆盖新提交。恢复时请到 Actions 页面点击 **Run workflow**（选择 `main`）发起新运行。
- **切勿点历史任务的 Re-run jobs**：GitHub 重跑旧任务会沿用历史工作流定义，可能绕过最新保护。
- **回滚生产**：将修复或回滚提交推到 `main` 触发正常发布，保留最新数据快照与可追溯历史。
- **数据未到齐提示**：Actions 汇总会分开展示部署结果与各来源状态；页面始终按当前纽约时间重新判定新鲜度，不会盲信旧 `status.json`。

---

## 六、数据使用合规提醒

低频定时请求不代表获得上游数据采集或再分发许可；Yahoo Finance、CNN、东方财富、腾讯财经与天天基金接口均可能变更或限流，公开发布前请核对各上游服务条款与 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

参考链接：
- [GitHub Pages 自定义工作流文档](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [GitHub Actions schedule 触发说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [NYSE 交易日历与休市时间](https://www.nyse.com/trade/hours-calendars)
- [whit3rabbit/fear-greed-data](https://github.com/whit3rabbit/fear-greed-data)
- [Yahoo 服务条款](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html)
