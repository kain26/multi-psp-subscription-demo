export const channelDefaults = {
  stripeBreaker: 'CLOSED', stripeUsed: 0, stripeLimit: 4,
  paypalBreaker: 'CLOSED', paypalUsed: 0, paypalLimit: 2,
  failureWindow: '0 / 0', cooldown: '—', probes: '—',
};

export function resilienceScenarios(action) {
  return [
    { id: 'fallback', name: '发送前切换', title: 'Stripe OPEN · 新交易可路由到 PayPal',
      summary: '只有请求还没发出，并且支付方式与备用渠道兼容，才可直接切换。',
      initial: { checkout: 'CREATING', payment: 'PENDING', stripeBreaker: 'OPEN' }, resilience: true,
      steps: [
        action('api', 'router', '检查市场 · 币种 · 支付方式', '新交易尚未调用任何 PSP', '先检查政策和渠道是否支持用户选定的支付方式，必要时让用户重新选择。'),
        action('router', 'resilience', 'Stripe OPEN · 快速拒绝', 'Stripe 收到的创建请求为 0', '熔断检查发生在网络调用之前。本地拒绝不计入 PSP 故障率。', {}, 'blocked'),
        action('resilience', 'adapter', '选择兼容的 PayPal Adapter', '固定新尝试的 PSP 与幂等键', '只有兼容且有容量的渠道才能承接。无可用渠道就提示稍后重试，不创建外部交易。', { provider: 'PayPal' }),
        action('adapter', 'paypal', 'createCheckout(originalIntent)', '返回 PayPal 授权链接', '用户仍需完成授权；切换渠道和返回链接都没有确认收款。', { checkout: 'OPEN', sessions: 1 }, 'ok'),
      ] },
    { id: 'bulkhead', name: 'Bulkhead 隔离', title: 'Stripe 并发打满，PayPal 仍可接单',
      summary: '每个 PSP 配自己的并发槽位与连接池。限流则单独约束单位时间的请求量。',
      initial: { stripeUsed: 3 }, resilience: true,
      steps: [
        action('resilience', 'stripe', 'Stripe semaphore.tryAcquire()', 'Stripe 慢请求占满 4 个槽位', '等待中的慢请求仍占用 Stripe 容量。示意值仅用来演示隔离。', { stripeUsed: 4 }),
        action('router', 'resilience', '新 Stripe 请求未获得槽位', '本地拒绝，Stripe 没收到这笔新请求', '并发上限与每秒速率限制可以分别配置。等不到槽位时立即拒绝，或进入有上限的短队列。', {}, 'blocked'),
        action('resilience', 'paypal', 'PayPal semaphore.tryAcquire()', 'PayPal 独立池还有容量', '这是一笔支付方式兼容的新交易。Stripe 的并发耗尽不消耗 PayPal 的槽位。', { paypalUsed: 1 }),
        action('stripe', 'resilience', 'Timeout · 本地连接清理完成', 'Stripe 释放 1 个槽位', '本地停止等待只能释放本地资源。对已经发出的变更请求，是否产生交易仍要核对。', { stripeUsed: 3 }, 'warn'),
        action('paypal', 'resilience', 'PayPal 请求完成', 'PayPal 槽位独立归还', '限流拒绝、舱壁拒绝与 Stripe 错误分别采集指标。', { paypalUsed: 0 }, 'ok'),
      ] },
    { id: 'breaker', name: '熔断与恢复', title: 'Stripe 熔断器独立经历 CLOSED → OPEN → HALF-OPEN',
      summary: '示例用 60 秒窗口、至少 20 次、故障率 50%、冷却 30 秒和最多 3 次探测。',
      initial: { stripeUsed: 1, failureWindow: '9 / 19' }, resilience: true,
      steps: [
        action('stripe', 'resilience', 'Stripe 5xx · 窗口内 10 / 20', '故障率达到 50% · Stripe OPEN', '超时、连接失败、PSP 5xx 可计为渠道故障。余额不足、卡拒等正常业务响应不会计入故障分子。', { stripeBreaker: 'OPEN', stripeUsed: 0, failureWindow: '10 / 20', cooldown: '30 秒' }, 'warn'),
        action('router', 'resilience', 'OPEN 快速拒绝新 Stripe 请求', '新请求不进入 Stripe', '已有交易继续保留其状态。熔断器也不阻止独立入口接收 Webhook。', {}, 'blocked'),
        action('router', 'resilience', '模拟冷却 30 秒结束', 'Stripe 进入 HALF-OPEN', '只放行有限探测。可以使用安全读请求探测，避免为了测健康度产生真实扣款。', { stripeBreaker: 'HALF-OPEN', cooldown: '—', probes: '0 / 3' }),
        action('stripe', 'resilience', '探测 1 超时', '探测失败 · Stripe 再次 OPEN', '一次渠道级探测失败就重新进入冷却。本轮剩余探测不再发起。', { stripeBreaker: 'OPEN', cooldown: '30 秒', probes: '失败' }, 'warn'),
        action('router', 'resilience', '模拟下一次冷却结束', 'Stripe 再次进入 HALF-OPEN', '只评估当前探测轮次，忽略上一轮迟到结果。', { stripeBreaker: 'HALF-OPEN', cooldown: '—', probes: '0 / 3' }),
        action('stripe', 'resilience', '3 次安全探测全部成功', 'Stripe 恢复 CLOSED', '恢复后重置窗口并逐步放量。PayPal 在全程保持自己的熔断状态。', { stripeBreaker: 'CLOSED', failureWindow: '0 / 0', probes: '3 / 3' }, 'ok'),
      ] },
    { id: 'confirmed-failure', name: '确认失败后切换', title: '确认旧尝试无扣款风险后才开新 Attempt',
      summary: '渠道终态证明和业务策略都允许时，才能用新幂等键创建备用渠道尝试。',
      initial: { provider: 'Stripe', payment: 'PENDING', checkout: 'CREATING' }, resilience: true,
      steps: [
        action('adapter', 'stripe', '提交原 Payment Attempt', '原尝试已发送，固定 Stripe', '先持久化 attempt ID、PSP 和 PSP key。短时不可用不能作为重新路由的依据。'),
        action('stripe', 'resilience', '核对渠道终态与业务原因', '旧尝试确认 FAILED · 无有效交易', '用可靠证据确认没有扣款、可继续完成的交易或有效订阅。卡拒和风控拒绝仍按原业务策略处理。', { payment: 'FAILED', checkout: 'FAILED' }, 'warn'),
        action('resilience', 'store', '关闭旧 Attempt · 原子预留新 Attempt', '同一业务意图下，新尝试使用新 key', '通过事务和唯一约束避免多个重试者同时创建新尝试。备用渠道要满足支付方式和授权条件。', { provider: 'PayPal', payment: 'PENDING', checkout: 'CREATING' }),
        action('adapter', 'paypal', 'createCheckout(newAttemptKey)', 'PayPal 返回新的授权链接', '这只确认新 Checkout 已打开，后续到账依然由可信通知或主动查询确认。', { checkout: 'OPEN', sessions: 1 }, 'ok'),
      ] },
    { id: 'renewal-fallback', name: '续费降级', title: '已有 Stripe 订阅需要恢复或重新授权',
      summary: '首购可以按策略选路。自动续费使用原渠道保存的支付凭证与授权。',
      initial: { provider: 'Stripe', stripeBreaker: 'OPEN', checkout: 'COMPLETED',
        payment: 'PENDING', invoice: 'OPEN', subscription: 'ACTIVE', entitlement: 'GRANTED' }, resilience: true,
      steps: [
        action('billing', 'resilience', '读取现有订阅的 PSP 归属', '续费继续绑定 Stripe', '自动续费依赖既有订阅、支付凭证与授权。Stripe OPEN 不会让 PayPal 获得这些授权。'),
        action('resilience', 'reconcile', '查询现有账单 · 等待 Stripe 恢复', '保留原 PSP，安排有界重试', '先核对 Stripe 是否已扣款，避免与渠道自身的扣款重试重复。'),
        action('billing', 'client', '故障持续 · 启用宽限期并通知', '账单保持 OPEN · 权益按宽限期保留', '根据业务策略通知用户，必要时引导在目标 PSP 重新授权。', { subscription: 'PAST_DUE', entitlement: 'GRACE_PERIOD' }, 'warn'),
        action('reconcile', 'billing', '迁移计划 · 校验授权与切换账期', '同一账期只保留一个扣款方', '长期迁移先评估凭证可迁移性、授权与订阅映射，再协调停止旧续费、启用新续费、核对旧未决账期。', {}, 'ok'),
      ] },
  ];
}
