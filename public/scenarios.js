const action = (from,to,op,result,note,patch={},kind='flow')=>({from,to,op,result,note,patch,kind});
export const base={checkout:'—',payment:'—',invoice:'—',subscription:'—',entitlement:'—',provider:null,intents:0,sessions:0,credits:0,inbox:0,pending:0};
const create=action('client','api','POST /subscriptions/checkout','收到购买请求','服务端从可信套餐目录查价格，校验用户、国家、币种和支付方式。此时还未向外部渠道发请求。');
const intent=action('api','store','INSERT SubscriptionIntent','持久化订阅意图与幂等键','本例以用户和 checkout 操作为作用域。相同 key 必须匹配相同请求，改变参数需要新操作。',{intents:1,checkout:'CREATING',subscription:'PENDING'});
const route=action('api','router','route(US, USD, card)','选中 Stripe · 固定本次路由','Router 看能力、配置与健康度。初始选路和已发出请求后的异常恢复遵循不同规则。',{provider:'Stripe'});
const useStripe=action('router','adapter','PaymentProvider.createCheckout()','分派到 Stripe Adapter','上层使用统一接口。各 Adapter 负责供应商请求、鉴权、幂等键、返回值以及错误语义的映射。');
const stripe=action('adapter','stripe','Create Checkout Session','Stripe 创建 cs_demo_01','Stripe Adapter 在支持幂等的创建请求上使用绑定本次尝试的 key。Session 包含业务关联标识。',{sessions:1});
const save=action('adapter','store','save(provider_session_id)','保存 cs_demo_01 和业务关联','把渠道及 Session ID 关联到本地意图。随后由 API 将收银台地址返回给前端。',{checkout:'OPEN'});
const returnUrl=action('api','client','返回 Checkout URL','前端去托管收银台','这里同步请求已经结束。Webhook 随后由 PSP 独立发送。');
const grant=action('queue','billing','grantCredits(invoice_id, credit_type)','本周期 Credits 入账 · Pro 开通','在权益服务自己的数据库事务中原子插入业务唯一键和账本记录，再确认消息。发放键以订阅、发票和权益类型为例。',{entitlement:'GRANTED',credits:1},'ok');
const statePaid=action('billing','store','COMMIT · 状态更新 + Outbox','支付、账单、订阅状态落库','在同一个本地事务内记录已收款、激活对应周期的订阅，并写入待发放权益的 Outbox。权益状态此时仍待完成。',{payment:'SUCCEEDED',invoice:'PAID',subscription:'ACTIVE',entitlement:'PENDING',pending:1});
const publish=action('store','queue','publish(EntitlementRequested)','Outbox 将事件交给队列','Relay 等 Broker 确认再标记已发送。崩溃重试可能再次发布，同一业务权益依然只记一笔。',{pending:0});
const paidSeed={provider:'Stripe',checkout:'COMPLETED',payment:'SUCCEEDED',invoice:'PAID',subscription:'ACTIVE',entitlement:'PENDING',intents:1,sessions:1,inbox:1,pending:1};

export const scenarios=[
  {id:'normal',name:'正常购买',title:'首购 Pro · Stripe 托管结账',summary:'从同步 Checkout 请求，到独立的 PSP 回调，再到权益账本。',initial:{},steps:[
    create,intent,route,useStripe,stripe,save,returnUrl,
    action('client','stripe','打开 Hosted Checkout','用户在 PSP 页面提交支付','前端跳转和成功返回页只用于展示进度。开通依据由后端从可信渠道验证。'),
    action('stripe','webhook','checkout.session.completed','结账完成 · 暂不发权益','Session 与本地业务关联。部分支付方式异步结算，不能把这个事件本身当成到账证明。'),
    action('webhook','store','验签 → Inbox(evt_checkout)','记录结账 · Payment 仍待确认','通过持久 Inbox 接收结账事件，再由 Worker 更新状态。这里还没有确认到账。',{checkout:'COMPLETED',payment:'UNCONFIRMED',inbox:1}),
    action('stripe','webhook','invoice.paid','PSP 独立通知后端','本例另外收到发票已付事件，并在后续核对确实收款、金额、币种、账号和计费周期。试用、零金额和站外标记付款可以采用其他政策。'),
    action('webhook','store','验签 → INSERT Inbox → 2xx','原始请求验证后持久化','用原始请求体验签。只有持久化接收成功或确认此前已接收时才返回成功。Inbox 是 Worker 的可靠输入。',{inbox:2}),
    action('store','billing','Worker → normalize + verify','转换为统一已收款事件','不要让订阅服务直接依赖 Stripe 事件名。已经从可信来源核对支付证据，再按统一状态机执行。'),
    statePaid,publish,grant,
  ]},
  {id:'paypal',name:'切换支付方式',title:'选择 PayPal 钱包 · 同一业务接口',summary:'只改变初始路由，Adapter 负责处理供应商字段和授权链接。',initial:{},steps:[
    create,intent,
    action('api','router','route(DE, EUR, paypal_wallet)','示例配置选中 PayPal','本例模拟商户已配置该市场与支付方式。上线前以实际商户和订阅产品能力为准。',{provider:'PayPal'}),
    action('router','adapter','PaymentProvider.createCheckout()','分派到 PayPal Adapter','同一个服务接口。Adapter 把内部套餐映射为 PayPal plan_id，处理授权动作和供应商状态。'),
    action('adapter','paypal','POST /v1/billing/subscriptions','返回订阅 ID 与 approve 链接','本例 PayPal 返回 APPROVAL_PENDING，表示还要由用户授权。此时不能把该状态视作收款。',{sessions:1}),
    action('adapter','store','保存 PayPal subscription_id','绑定渠道订阅标识','这里的计数代表一个渠道 Checkout 对象，实际标识是 PayPal 订阅 ID。恢复和 Webhook 关联复用它。',{checkout:'OPEN'}),
    returnUrl,
  ]},
  {id:'double',name:'重复点击',title:'同一操作只创建一次',summary:'业务 key、数据库唯一约束和 PSP 幂等各守一道关。',initial:{},steps:[
    create,intent,
    action('client','api','相同业务 key 再次提交','第二次请求到达','浏览器重复点击、刷新或客户端重试都可能让请求并发到达。'),
    action('api','store','UNIQUE(user_id, operation, key)','复用同一条 SubscriptionIntent','原子插入或读取既有记录。请求指纹不同应拒绝复用，仍在处理中则返回进度。不能先查有无，再各自调用 PSP。',{},'warn'),
    route,useStripe,stripe,save,
    action('adapter','stripe','相同 PSP key 重试原请求','返回既有 cs_demo_01','同一渠道、同一端点、同一参数和受支持的幂等有效期内，重试复用原操作。PayPal 端点是否支持 PayPal-Request-Id 要按 API 确认。',{},'ok'),
    action('api','client','返回已有 Checkout URL','1 个意图 · 1 个 Session','同一个购买动作拿回同一个结果，未新建第二条订阅。',{},'ok'),
  ]},
  {id:'timeout',name:'PSP 超时',title:'响应丢了，结果仍然未知',summary:'先固定旧渠道并恢复原请求。UNKNOWN 不代表失败。',initial:{intents:1,checkout:'CREATING',subscription:'PENDING'},steps:[
    route,useStripe,stripe,
    action('stripe','adapter','响应丢失 → Timeout','本地标记 UNKNOWN','图中我们知道 Stripe 已创建，但调用方只看到超时。Session 阶段与实际扣款阶段都可能有不确定结果。',{checkout:'UNKNOWN'},'warn'),
    action('router','paypal','尝试切换 PSP','拦截 · 旧请求仍可能成功','在 UNKNOWN 时禁止另一渠道再创建同一购买或扣款。跨 PSP 的幂等键不会互相去重。',{},'blocked'),
    action('adapter','stripe','原 key 重试／查询已知标识','找回 cs_demo_01','在渠道幂等有效期内重试原操作。已知 Session ID 时直接查询，否则用可验证的关联或对账。超过期且仍未知时进入待处理队列。',{},'ok'),
    action('adapter','store','绑定旧 Session','恢复 OPEN · 仍只存在一个 Session','确认旧 Session 仍可用就复用。允许切换前，须按阶段确认旧操作不会继续扣款，或按业务完成关闭和过账处理。',{checkout:'OPEN'},'ok'),
  ]},
  {id:'duplicates',name:'Webhook 重复',title:'不同 Event ID 也不能重复发 Credits',summary:'先以渠道事件去重，再以付款对应的权益计费周期去重。',initial:{...paidSeed,entitlement:'GRANTED',credits:1,pending:0},steps:[
    action('stripe','webhook','重投 evt_01 · 第 2 次','验签通过 · 同事件重投','用户的发票 in_01 已付，账本已有一笔权益。渠道交付可能重试。'),
    action('webhook','store','UNIQUE(provider, event_id)','evt_01 已在 Inbox · 返回 2xx','发现已持久接收的事件后确认响应。这不是再次派发事件。多商户场景还要包含渠道账户作用域。',{},'blocked'),
    action('stripe','webhook','重投 evt_01 · 第 3 次','同一个 Event ID 再次到达','无论渠道重试多少次，重复事件仍命中同一个 Inbox 唯一约束。'),
    action('webhook','store','INSERT Inbox(evt_01)','再次命中唯一键','Inbox 计数仍为 1。',{},'blocked'),
    action('stripe','webhook','另一个 evt_02 · 同一发票','不同 ID 可以通过第一层','不同通知可能指向同一笔业务动作，Worker 归一化后会关联到 in_01。'),
    action('webhook','store','INSERT Inbox(evt_02)','第二个事件被持久接收','这个 Event ID 从未收到过，但发放权益不能依赖 Event ID 判断唯一。',{inbox:2}),
    action('billing','store','UNIQUE(subscription_id, invoice_id, credit_type)','同发票同权益只发放一次','按业务维度写入账本。即便两个事件都到达 Worker，最终只有 1 笔 Credits 发放。',{},'ok'),
  ]},
  {id:'reconcile',name:'丢失与乱序',title:'Webhook 驱动增量，对账修复遗漏',summary:'用渠道快照与状态迁移校验纠正本地视图。',initial:{provider:'Stripe',checkout:'COMPLETED',payment:'UNCONFIRMED',invoice:'OPEN',subscription:'PENDING',intents:1,sessions:1},steps:[
    action('stripe','webhook','invoice.paid 未送达','本地仍显示 OPEN','本例渠道已收款，本地未收到该通知。不要用本地超时直接推断支付失败。',{},'blocked'),
    action('reconcile','store','扫描超时未终态订单','定位 in_01 · 待核验','按账户与游标处理，避免全量重复；可以限定查找窗口并补扫跨边界事件。'),
    action('reconcile','stripe','retrieve invoice / payment','可信来源确认 in_01 已支付','定期对账将渠道账单和本地交易、应发权益做关联。核对金额、币种、订单映射和收款证明。'),
    action('reconcile','billing','重放统一已收款事件','进入相同状态机','对账修复走与 Webhook 相同的域处理入口和业务唯一键。'),
    statePaid,
    action('stripe','webhook','旧 subscription.updated 晚到','到达顺序不代表业务顺序','旧通知的内容可能比当前已确认的状态更旧。'),
    action('billing','stripe','校验资源状态／查询当前快照','拦截过期状态，避免回退','校验合法迁移和同一资源的因果顺序。无法消歧就查询 PSP。合法退款和取消仍可能改变后续状态。',{},'warn'),
    publish,grant,
  ]},
  {id:'outbox',name:'Outbox 恢复',title:'数据库已提交，消息却没发出去',summary:'状态和事件同事务落库，Relay 重投，消费者幂等。',initial:{...paidSeed,subscription:'PENDING',payment:'UNCONFIRMED',invoice:'OPEN',entitlement:'—',pending:0},steps:[
    statePaid,
    action('store','queue','Relay 发送失败／进程崩溃','Outbox 仍待发布','数据库已提交，但 Broker 没确认。这条事件留在表里，业务状态不会因发送失败而丢掉后续任务。',{},'blocked'),
    action('store','queue','Relay 恢复后重试','Broker 收到 · 发送标记尚未写回','即使 Broker 已成功接收，Relay 也可能在写回 sent 标记前崩溃。'),
    grant,
    action('store','queue','Relay 再次发布相同业务事件','可能重复投递','恢复后不能从 sent 标记区分上一轮是否已投递，允许安全重投。',{pending:0},'warn'),
    action('queue','billing','按发票与权益类型写账本','重复消息已处理 · 账本仍为 1','Outbox 提供可恢复投递，不把交付变成 Exactly Once。业务唯一约束保证相同权益只产生一个效果。',{},'ok'),
  ]},
  {id:'entitlement',name:'权益补偿',title:'钱已经收了，Pro 还没开通',summary:'保存任务、延迟重试、对账补偿继续使用同一个业务键。',initial:{...paidSeed},steps:[
    publish,
    action('queue','billing','grantCredits() · 暂时失败','支付仍成功 · 权益待重试','失败发生在权益事务提交前，本例尚未产生账本。持久化重试任务，采用退避。达到阈值后告警或进死信。',{entitlement:'RETRY_PENDING'},'blocked'),
    action('reconcile','store','比对已付发票与权益账本','发现 in_01 缺发放记录','对账任务只补齐缺失效果，不篡改已成功的支付状态。'),
    action('reconcile','queue','重排原发放任务','沿用原业务幂等键','不能因为触发方改为补偿任务，就生成不同的权益 key。',{entitlement:'PENDING'}),
    grant,
  ]},
  {id:'renewal',name:'续费与状态',title:'续费扣款失败，订阅仍可能保留',summary:'Payment、Invoice、Subscription、Entitlement 各自有生命周期。',initial:{...paidSeed,entitlement:'GRANTED',credits:1,pending:0},steps:[
    action('stripe','billing','开启新计费周期 in_02','Invoice → OPEN · 新付款尝试','表上显示当前账单周期和本次支付尝试。上一期已发权益仍保留在历史账本。',{payment:'PENDING',invoice:'OPEN'}),
    action('stripe','webhook','invoice.payment_failed','Payment → FAILED · 账单仍 OPEN','入站事件先验签、落 Inbox、再由 Worker 处理。扣款失败并不自动关闭账单。',{payment:'FAILED',inbox:2},'warn'),
    action('billing','store','transition(subscription)','Subscription → PAST_DUE','按业务规则进入欠费状态。这个示例有宽限期，所以订阅未取消。',{subscription:'PAST_DUE',entitlement:'GRACE_PERIOD'},'warn'),
    action('billing','client','显示宽限期与更新支付方式','已有权益按策略保留 · 未发下期 Credits','是否立即停权由业务策略决定。续费重试、退款或取消需要各自的状态与补偿规则。',{},'ok'),
  ]},
];
