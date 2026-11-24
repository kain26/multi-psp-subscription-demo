# Multi-PSP Subscription Integration

面向系统设计面试的订阅支付动画。五个模块通过 SVG 泳道展示同步 Checkout、异步 Webhook 与权益、对账补偿。九个场景使用模拟数据。

直接打开 `public/index.html` 即可离线演示。HTML 内的 `scenarios` 数组定义各场景、步骤、路径和状态变化。Cloudflare Pages 的静态部署目录为 `public/`。

- **← / →** 上一步或下一步
- **空格** 播放或暂停
- **1–9** 切换场景
- **R** 重置当前场景
- **P / Esc** 切换演讲模式或退出
