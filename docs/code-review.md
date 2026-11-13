# 代码审查台账 (Code Review)

> **使用约定**：本文件仅保留**当前待修 Bug**（顶部概览表 + 下方详细定位）与**最近一轮审查摘要**。
> - 长期重构与工程/文档债务见 [技术债清单](./tech-debt.md)
> - 历史审查过程与已修复归档见 [历史审查归档](./review-archive.md)
> - 已修复并验证通过的 Bug 直接从本文件移出并在归档中留痕，不保留删除线。

---

## 一、当前待修 Bug 概览

| 编号 | 优先级 | 模块 | 问题摘要 |
| --- | --- | --- | --- |
| [#9](#9-low-pagesyml-update-写状态前崩溃仍会部署旧-statusjson) | **Low** | [pages.yml](../.github/workflows/pages.yml#L103-L106) | `update-data.mjs` 在写出 `status.json` 前抛错退出，因 `continue-on-error` 仍部署旧状态 |

---

## 二、问题详细定位与修复建议

### #9 [Low] `pages.yml` `update` 写状态前崩溃仍会部署旧 `status.json`
- **位置**：[.github/workflows/pages.yml](../.github/workflows/pages.yml#L103-L106) 与 [scripts/report-data-status.mjs](../scripts/report-data-status.mjs#L4-L19)
- **触发条件**：`scripts/update-data.mjs` 在 `refreshAll` 写出新 `public/data/status.json` 之前抛错退出（如 `FEAR_GREED_SOURCE` 配置非法、已有 `status.json` 损坏或文件锁异常）。
- **实际影响**：`Update sources` 配置了 `continue-on-error: true`，后续 `Build static site` 与 `Deploy` 仍会继续执行并部署上一轮旧 `status.json`（不过 `report-data-status.mjs` 会检测到 `UPDATE_OUTCOME === 'failure'` 并使 Actions 任务失败）。
- **建议修复**：在 `update` 意外失败且未更新 `status.json` 时，跳过部署或向构建产物注入失败状态提示。

---

## 三、最近一轮审查摘要（2026-11-13 · v1.17.0）

- **审查范围**：双人独立只读全量审查（后端、前端、Workflow、测试与全部文档）。
- **验证限制**：审查环境 `PATH` 无 `node` / `npm`，未运行 `node --test`，结论基于静态源码与配置核查。
- **已排查排除的关键疑似问题**：
  1. **回测未来函数与跨月吞单**：月度与 KD 信号均在收盘确认后取 `rows[i + 1]` 开盘成交；`kd-strategy.mjs:65-67` 仅确认已收盘周线；`calculatePyramidSignals` 独立推进 `dueYear/dueMonth`。
  2. **安全边界**：`http-server.mjs:153` 阻止路径穿越与点文件访问；`sameOrigin` 对 `Origin` 做 `try/catch` 校验；`network.mjs` 使用 `execFile` 无 shell；前端无 `innerHTML`。
  3. **Workflow DST 与并发门禁**：`refresh-schedule.mjs` 基于 `17:00:00Z` 动态计算纽约偏移；`queue: max` 串行排队；推送与部署前两次运行 `check-deploy-head.mjs`。
  4. **静态构建隔离**：`build-site.mjs` 使用白名单过滤 `public/data/` 并剥离 `dist/data/status.json` 中的个人标的。
