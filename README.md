# Multi-PSP Subscription Integration

面向面试的独立 Three.js 动画。九个场景演示 Stripe 首购、PayPal 初始选路、重复点击、PSP 超时、Webhook 重投、丢失与乱序、Outbox、权益补偿和续费失败。图中的订单、渠道回执和计数均为模拟数据，页面不调用支付 API。

```sh
python3 -m http.server 4192 --directory public
```

打开 <http://127.0.0.1:4192/>。静态部署目录是 `public/`。
