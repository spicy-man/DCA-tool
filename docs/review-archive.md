# 历史代码审查归档 (Review Archive)

> 本文件归档已完成或已被后续版本取代的历史审查过程记录。当前活跃的待修 Bug 请见 [代码审查台账](./code-review.md)，长期重构项见 [技术债清单](./tech-debt.md)。

---

## v1.17.0 全量双人审查记录（2026-11-13）

- **范围**：全仓库代码、`.github/workflows/pages.yml` 与全部 8 份文档（环境无 `node` / `npm`，静态核查）。
- **结果**：确认 9 项待修 Bug（1 High / 2 Medium / 6 Low，均已登记至 [代码审查台账](./code-review.md)），并统一同步了 `README.md`、`docs/architecture.md`、`docs/deployment.md`，将技术债拆入 [技术债清单](./tech-debt.md)。

---

## v1.17.0 KD 定投与五策略回测工作区审查（2026-11-11）

两位审查者独立检查了 26 个工作区改动及相关调用路径，主 Agent 复核了发现。首轮为只读审查，59 项定向测试及差异检查通过；最终实现通过 62 项定向测试及 `git diff --check HEAD`。

| 优先级 | 问题与证据 | 处理方式 | 状态 |
| --- | --- | --- | --- |
| P2 | [KD 分档](../public/js/domain/kd-strategy.mjs)：周线高 18.10、低 18.00、收 18.09 时，K 应为 90，但浮点尾差使买入从 1N 变成 1.5N。 | 窄幅窗口先按报价的十进制表示求差，分档时再吸收档线附近的浮点尾差；补充回归测试。 | 已修复 |
| P2 | [回测风险指标](../public/js/domain/backtest.mjs)：恒价 $19、两笔各 $1,000 的普通定投出现虚假回撤及夏普、索提诺、MAR；恒定非零收益也可能出现巨大的夏普值。 | 忽略日收益、波动和回撤分母中的浮点尾差；覆盖单标的、组合及恒定收益。 | 已修复 |
| P2 | [KD 复盘](../public/js/features/market/chart.mjs)：每帧新建行情前缀，导致 KD 缓存失效（SPY 8,504 根日线约 91ms，超出 62.5ms 预算）。 | — | 转入当前台账 |
| P3 | [KD 信号导出](../public/js/domain/kd-strategy.mjs)：KD 月度信号未保留 `buyDay`。 | — | 转入当前台账 |
| P3 | [KD 说明](../public/index.html)：公开站点没有文案所称的「旧版研究」入口。 | — | 转入技术债 |

---

## v1.14.0 定投配比与组合回测审查（2026-11-09）

对发版提交 `f6083a9` 执行双人独立只读审查（39 项定向测试通过），确认以下 5 项问题及 2 项补充发现：

1. **资金摘要与回测成交口径不同**（`strategy-summary.mjs` / `backtest.mjs`）—— **已于 v1.15.0 修复**（组合层共用成交订单对齐起点跨界、跨月顺延、末尾未成交三种边界）。
2. **组合可能混用旧行情或复盘截断行情**（`chart.mjs` / `overlay.mjs`）—— **已于 v1.15.0 修复**（`!next.replay` 才写缓存，联动清理与代次校验）。
3. **清空输入会保存为停投**（`overlay.mjs`）—— 转入当前台账。
4. **配比合计 100% 仍可能超出总金额**（`overlay.mjs`）—— 转入当前台账。
5. **窄屏下标的名被完全裁切**（`public/css/page.css`）—— **已于 v1.15.0 修复**（增加窄屏两行两列网格断点）。
6. **补充发现**：单标的 `simulate` `trades` 浮点尾数（转入当前台账）；文档遗漏 `BRK-B`（已于 2026-11-13 修复）。

---

## v1.8.3 / v1.8.4 全项目审查与修复闭环（2026-10-21）

双人独立审查及第二轮复审闭环，47 项定向测试通过（`build-site.test.mjs`、`backend.test.mjs`、`custom-symbols.test.mjs`、`symbol-dialog.test.mjs`、`application-calendar.test.mjs`、`architecture.test.mjs`）：

1. **静态构建白名单与个人标的隔离**（`scripts/build-site.mjs`、`.gitignore`）—— **已修复**（白名单复制 `public/data/`，并过滤 `dist/data/status.json` 中的个人标的）。
2. **跨站 `Origin` 安全解析与文件锁错误码**（`server/http-server.mjs`、`server/storage.mjs`）—— **已修复**（`sameOrigin` `try/catch` 返回 403；锁冲突返回 `ELOCKED` / 409）。
3. **自定义标的增删后状态同步**（`server/updater.mjs`、`events.mjs`、`symbol-dialog.mjs`、`application.mjs`）—— **已修复**。
4. **空日历边界防护与情绪 CSV 评级一致性**（`public/js/application.mjs`）—— **已修复**。
5. **NYSE 历史特殊休市日补齐与文档同步**（`trading-calendar.mjs` 补 `1994-04-27`）—— **已修复**。
