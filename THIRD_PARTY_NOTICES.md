# 第三方项目、参考资料与授权范围

本文件记录运行工具、数据来源和实现参考，不替代各上游的许可证，也不授予其数据或素材使用权。核对日期：2026-10-17。本仓库尚未正式选定自身许可证，README 中的 MIT 为建议方案。

## 运行工具与开发验证

- **Node.js**：本地服务、更新器、构建脚本及测试使用其标准库。运行时不随静态站点分发。[许可及组件声明](https://github.com/nodejs/node/blob/main/LICENSE)。
- **curl**：`server/network.mjs` 调用系统可执行文件下载 CNN、Yahoo 与历史存档数据，未将 curl 二进制打包进项目。[curl license](https://curl.se/docs/copyright.html)。
- **Playwright**：开发验收通过外部环境提供的 Playwright 和 Edge 完成；未添加为 package.json 依赖，未随网站发布。[Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE)。浏览器本身受其发行方条款约束。

## 历史数据上游

[whit3rabbit/fear-greed-data](https://github.com/whit3rabbit/fear-greed-data) 提供 `fear-greed.csv` 历史存档及回退更新来源。上游 [LICENSE](https://github.com/whit3rabbit/fear-greed-data/blob/main/LICENSE) 为 MIT，版权声明为 Copyright (c) 2026 whit3rabbit。

当前使用其 CSV 数据，并未将上游采集程序引入本项目。MIT 对软件的授权不能自动证明原始 CNN 指数及历史数据可自由再分发；保留来源说明，原始数据使用条件需另行核对。

Yahoo Finance Chart API 与 CNN 历史接口是外部数据服务。数据快照、日期、数值和导出文件的权利归原权利人；不纳入拟议的本项目 MIT 授权。

## K 线绘制参考

[TradingView Lightweight Charts](https://github.com/tradingview/lightweight-charts) 的 [candlesticks-renderer.ts](https://github.com/tradingview/lightweight-charts/blob/master/src/renderers/candlesticks-renderer.ts) 是 K 线像素对齐、实体与影线宽度处理的参考；本项目对应实现见 `public/js/charts/geometry.mjs`。当前未安装、加载或打包 Lightweight Charts 运行库。

上游采用 [Apache License 2.0](https://github.com/tradingview/lightweight-charts/blob/master/LICENSE)，另有 [NOTICE](https://github.com/tradingview/lightweight-charts/blob/master/NOTICE)：TradingView Lightweight Charts，Copyright (c) 2025 TradingView, Inc.，https://www.tradingview.com/ 。此处记录参考来源，不代表 TradingView 对本项目认可或背书。若后续纳入其代码或衍生实现，应随分发保留适用的许可证、变更和 NOTICE 声明。

## 用户提供的策略与逻辑图

- `public/js/domain/pyramid-strategy.mjs`：根据 **labmem004** 编写、用户提供的 Pine v6 脚本移植；作者署名由用户确认，原始发布链接及授权记录尚未补齐。
- `public/diagrams/monthly_dca_logic.svg`：由用户提供，按原文件复制。图中包含独立的回测设定，页面已注明与本站信号口径的差异。

上述材料的原始权利与再许可范围尚待确认，不应仅因被加入仓库就认定为 MIT、Apache-2.0 或其他开源许可。

## 自动发布工具

工作流通过 GitHub Actions 调用下列官方开源 Action，使用版本以 `.github/workflows/pages.yml` 为准。这些工具在 CI 环境运行，其源码不随网站打包：

- [actions/checkout](https://github.com/actions/checkout/blob/main/LICENSE)：MIT。
- [actions/setup-node](https://github.com/actions/setup-node/blob/main/LICENSE)：MIT。
- [actions/configure-pages](https://github.com/actions/configure-pages/blob/main/LICENSE)：MIT。
- [actions/upload-pages-artifact](https://github.com/actions/upload-pages-artifact/blob/main/LICENSE)：MIT。
- [actions/deploy-pages](https://github.com/actions/deploy-pages/blob/main/LICENSE)：MIT。

## 其他内容

页面的巴菲特理念整理和彼得·林奇书籍节选意译保留各自来源链接；作品版权、人物名称、第三方商标及数据品牌不因本项目代码许可证发生转移。
