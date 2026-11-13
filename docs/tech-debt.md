# 技术债清单 (Tech Debt)

> 维护规则：仅记录**非阻断性、暂缓重构或工程/文档债务**；明确的功能缺陷见 [代码审查台账](./code-review.md)。解决后从活跃清单移入文末「已清理记录」。

## 一、代码与工程技术债

| 模块 / 位置 | 问题描述 | 暂缓原因 / 建议方向 | 状态 |
| --- | --- | --- | --- |
| [nasdaq-funds.html](../public/nasdaq-funds.html#L11)<br>[sp500-funds.html](../public/sp500-funds.html#L11)<br>[version.mjs](../scripts/version.mjs#L12-L27) | 两张基金对比页引用 `./style.css` 未带 `?v=<version>` 缓存参数，且 `checkVersion` / `syncVersion` 未覆盖这两页。 | 需同步修改发布校验脚本与两页 HTML 模板。 | 待处理 |
| [public/index.html](../public/index.html#L281) | KD 说明文案仍残留指向不存在的「旧版研究」入口的描述。 | 移除该句或在有公开入口后再补链接。 | 待处理 |
| [backtest.mjs](../public/js/domain/backtest.mjs) | 单标的回测 `simulate` 与组合回测 `comparePortfolioStrategies` 各自维护现金计息、净值与回撤循环。 | 目前单标的与组合各自稳定，后续重构资金/净值规则时统一抽取共用步进器。 | 待观察 |

## 二、文档技术债

| 文档位置 | 问题描述 | 建议方向 | 状态 |
| --- | --- | --- | --- |
| [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#L3)<br>[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#L21)<br>[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#L53) | 第 3 行引用了 `README` 中已不存在的 MIT 建议方案；第 21、53 行仍将标普 500 对比基准写为 `VOO`（Vanguard），未同步为实际已切换的 `SPY`（State Street）。 | 结合仓库正式许可证决定一并核对并更新第三方声明。 | 待处理 |

---

## 三、已清理记录

- **2026-11-13**：统一同步 [architecture.md](./architecture.md)、[deployment.md](./deployment.md) 与 [README.md](../README.md)（补齐 `BRK-B`/`SMH`、目录树、`events.mjs` 事件名、`style.css` 导入顺序，并精简用户向功能说明）。
