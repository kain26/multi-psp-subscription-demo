# Multi-PSP Subscription Integration

面向面试的独立 Three.js 动画。十四个场景覆盖 Stripe 首购、PayPal 初始选路、幂等、异步恢复、支付渠道容错和续费。每个场景显示完整时序、业务状态变化和对应的 TypeScript 伪代码。图中的订单、渠道回执和计数均为模拟数据，页面不调用支付 API。

```sh
python3 -m http.server 4192 --directory public
```

打开 <http://127.0.0.1:4192/>。静态部署目录是 `public/`。
