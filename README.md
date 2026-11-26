# Multi-PSP Subscription Integration

多支付渠道订阅集成的 Three.js 交互演示。十四个场景覆盖 Stripe 首购、PayPal 初始选路、幂等、异步恢复、支付渠道容错和续费。每个场景显示完整时序、业务状态变化和对应的 TypeScript 伪代码。图中的订单、渠道回执和计数均为模拟数据，页面不调用支付 API。

## 在线预览

- [Multi-PSP 订阅支付 Demo](https://multi-psp-subscription-demo.pages.dev/)
- [PayPal 与 Stripe 订阅生命周期](https://multi-psp-subscription-demo.pages.dev/subscription-lifecycle)

## 本地预览

```sh
python3 -m http.server 4192 --directory public
```

打开 [Demo 首页](http://127.0.0.1:4192/) 或 [订阅生命周期](http://127.0.0.1:4192/subscription-lifecycle.html)。静态部署目录是 `public/`。

## 许可证

项目采用 [MIT 许可证](./LICENSE)。随附的 Three.js 保留其[原始许可证和版权声明](./public/vendor/LICENSE)。
