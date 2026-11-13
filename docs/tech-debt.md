# 技术债清单 (Tech Debt)

> 维护规则：仅记录**非阻断性、暂缓重构或工程/文档债务**；明确的功能缺陷见 [代码审查台账](./code-review.md)。解决后从活跃清单移入文末「已清理记录」。

## 一、代码与工程技术债

| 模块 / 位置 | 问题描述 | 暂缓原因 / 建议方向 | 状态 |
| --- | --- | --- | --- |
| [backtest.mjs](../public/js/domain/backtest.mjs) | 单标的回测 `simulate` 与组合回测 `comparePortfolioStrategies` 各自维护现金计息、净值与回撤循环。 | 目前单标的与组合各自稳定，后续重构资金/净值规则时统一抽取共用步进器。 | 待观察 |

## 二、文档技术债

暂无待处理项。

---

## 三、已清理记录

- **2026-11-13**：统一同步 [architecture.md](./architecture.md)、[deployment.md](./deployment.md) 与 [README.md](../README.md)（补齐 `BRK-B`/`SMH`、目录树、`events.mjs` 事件名、`style.css` 导入顺序，并精简用户向功能说明）。
- **2026-11-13**：为 [nasdaq-funds.html](../public/nasdaq-funds.html#L11) 与 [sp500-funds.html](../public/sp500-funds.html#L11) 的 `./style.css` 补齐 `?v=1.17.0`，并将两页纳入 [version.mjs](../scripts/version.mjs) 的 `checkVersion` / `syncVersion` 与 [version.test.mjs](../test/version.test.mjs) 校验。
- **2026-11-13**：移除 [public/index.html](../public/index.html#L281) KD 说明文案中指向不存在的「旧版研究」入口的残留描述。
- **2026-11-13**：更新 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#L3)，移除已失效的 `README` MIT 建议方案引用，并将标普 500 对比基准由 `VOO`（Vanguard）同步为 `SPY`（State Street）。
