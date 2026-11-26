const phases = [
  {
    label: '建订阅', title: '同一个套餐，两套对象模型',
    note: '演示使用按月自动收款。业务层先创建自己的 SubscriptionIntent，再保存渠道引用。',
    paypal: ['POST /v1/billing/subscriptions', '根据 plan_id 创建订阅，返回订阅 ID 和 approve 链接。Plan 定义周期、试用和收款失败策略。', 'APPROVAL_PENDING · I-SUB-DEMO'],
    stripe: ['POST /v1/checkout/sessions', '传 mode=subscription 和 recurring Price。本例走托管 Checkout。已有 Customer 也可通过 POST /v1/subscriptions 创建。', 'Checkout Session · cs_demo'],
    event: 'CheckoutStarted', adapter: '将 PayPal approve 链接和 Stripe Checkout URL 变成同一种客户端动作。保留渠道、账户、对象类型和 ID，提交超时则进入 UNKNOWN。',
  },
  {
    label: '授权', title: '授权完成，收款仍要单独确认',
    note: '回跳可能早于或晚于 Webhook，也可能没有回跳。激活与收款在业务上是两条状态。',
    paypal: ['BILLING.SUBSCRIPTION.ACTIVATED', '买家批准后，PayPal 按开始时间与计划激活。批准中间状态可通过 GET 查询，激活事件本身只更新订阅。', 'APPROVAL_PENDING → ACTIVE'],
    stripe: ['checkout.session.completed', '完成托管 Checkout 后拿到关联订阅。首次支付需要补认证时，直接建订阅的流程可能停在 incomplete。', 'Session 完成 · 查看 Subscription 和 Invoice'],
    event: 'SubscriptionObserved', adapter: '以验签事件或原渠道查询推进订阅。仅收到回跳、激活通知或 Checkout 完成时，付费 Credits 仍待结算证据。',
  },
  {
    label: '首扣', title: '首次结算，建立账期和权益',
    note: '试用、零金额、设置费以及手动结清按产品策略解释。这里演示首个付费账期。',
    paypal: ['PAYMENT.SALE.COMPLETED', '计划触发首次收款，Webhook 提供 Sale 证据。设置费若失败，查看 setup_fee_failure_action，按 CONTINUE 或 CANCEL 处理。', 'sale_demo_01 · 识别本次款项用途'],
    stripe: ['invoice.paid', '自动收款通常先 finalize 首张 Invoice 再尝试收款。invoice.paid 可能包含渠道外结清，因此仍要审查结清方式和账单行。', 'in_demo_01 · paid'],
    event: 'BillingSettled', adapter: '关联有效订阅，保存带类型的结算证据，确定覆盖的服务期；权益按内部账期幂等发放。',
  },
  {
    label: '第二次扣款', title: '第 2 期到了，原渠道发起本期第一次尝试',
    note: '首次付款建立第 1 期。下月 PSP 使用已授权的付款方式收第 2 期，用户不必重新打开 Checkout。',
    paypal: ['计划扣款 → PAYMENT.SALE.COMPLETED', 'Plan 到期触发自动付款。成功后产生本期 Sale。获取 next_billing_time 用于展示和对账，应用不按这个时间自行扣款。', 'sale_demo_02 · 同一个 I-SUB-DEMO'],
    stripe: ['invoice.created → invoice.finalized → invoice.paid', 'Stripe 为新账期生成新 Invoice，典型原因是 subscription_cycle。定稿后尝试 off-session 扣款。Webhook 到达顺序可以不同。', 'in_demo_02 · 同一个 sub_demo'],
    event: 'BillingSettled', adapter: '续费与首扣归一为同一种结算事实，照常校验账期和商品，对每个已确认的账期发放一次。',
  },
  {
    label: '扣款失败', title: '一次扣款失败，订阅和权益各自判断',
    note: '以下是第 2 期的失败分支。区分余额不足、硬拒绝和待认证。按原 PSP 的证据决定下一步。',
    paypal: ['BILLING.SUBSCRIPTION.PAYMENT.FAILED', 'PayPal 的订阅状态可能仍是 ACTIVE。查询 billing_info，核对失败计数、下次扣款与欠款信息。', 'ACTIVE · 付款未结算'],
    stripe: ['invoice.payment_failed', '失败后查可用的原因。余额不足允许时交给重试策略。硬拒绝提示换卡或联系发卡行。invoice.payment_action_required 则引导用户回来完成认证。', 'Invoice open · Subscription 可能 past_due'],
    event: 'BillingPaymentFailed', adapter: '独立更新账单失败和客户通知。本地 PAST_DUE 使用已识别的未结算账期与业务策略，避免根据单个计数或事件覆盖成功。',
  },
  {
    label: '重试与补收', title: 'PayPal 记录欠款，Stripe 继续处理原 Invoice',
    note: '重复的支付尝试与重复的 Webhook 是两件事。应当记录渠道证据并关联合适的账期。',
    paypal: ['POST /v1/billing/subscriptions/{id}/capture', '官方说明每 5 天重试一次，每周期最多两次。最后一次重试仍失败可计入欠款。产品可选择自动补收，或在支持条件下主动 capture。', '一次补收可能覆盖多个账期'],
    stripe: ['Smart Retries / 自定义重试', '继续处理第 2 期原 Invoice。换卡时检查实际生效的默认付款方式。主动补收前核对自动重试与未决付款。', '多个尝试仍关联同一个 Invoice'],
    event: 'BillingSettled / BillingPaymentFailed', adapter: '成功才更新已结算账期。一个 Sale 可能覆盖多期，一个 Invoice 也可能经历多次尝试。依据结算分配按账期发权益。',
  },
  {
    label: '恢复失败', title: '重试结束，各渠道的后续行为不同',
    note: '权益是否暂停由产品决定。已知失败的订阅仍应归属于原渠道。',
    paypal: ['BILLING.SUBSCRIPTION.SUSPENDED', '失败周期触发计划阈值时，PayPal 可暂停订阅。恢复时核对状态和欠款，按支持的路径补收或 activate。', 'SUSPENDED · 可能还有未收余额'],
    stripe: ['customer.subscription.updated / deleted', '重试耗尽可按配置结束为 canceled、unpaid、继续 past_due，或对符合条件的订阅暂停。', '按恢复配置决定下一状态'],
    event: 'SubscriptionObserved', adapter: '保留原始状态和原因，再套用产品宽限期与停权规则。渠道状态不足时主动查询。',
  },
  {
    label: '变更套餐', title: '升降级的动作、生效日期和金额可能不同',
    note: '本例把渠道下一步和生效时间传回前端，让用户知道何时切换、是否补差价。',
    paypal: ['POST /v1/billing/subscriptions/{id}/revise', 'PayPal 支付方式的套餐变更需要买家重新同意。未同意则保持原计划。官方流程中新价格下个周期生效，不会自动做比例补差。', '可能返回 approve 链接'],
    stripe: ['POST /v1/subscriptions/{id}', '可更新订阅项的 Price，按 proration_behavior 决定是否生成比例计费项及是否立即开票。也可另行安排未来切换。', 'Proration 与付款确认单独跟踪'],
    event: 'PlanChangeRequested', adapter: '统一返回审批动作、预计生效时间和计费能力。审批待完成或差额未付时，业务层仍保留原权益。',
  },
  {
    label: '取消或退款', title: '停止续费与退款分别入账',
    note: '用户可在渠道侧操作。订阅结束时间和原付款是否退回需要单独核对。',
    paypal: ['BILLING.SUBSCRIPTION.CANCELLED / PAYMENT.SALE.REFUNDED', '取消或到期来自订阅事件。Sale 退款或撤销是另一条链路，应关联原交易。', 'CANCELLED / EXPIRED · Sale 状态独立'],
    stripe: ['customer.subscription.deleted / charge.refunded', '可立即取消或设 cancel_at_period_end。退款处理需要关联原付款和 Invoice，并核对是全额还是部分退款。', 'canceled 或待期末取消 · 退款独立'],
    event: 'SubscriptionObserved / BillingReversed', adapter: '订阅时间决定何时停止自动续费，权益规则按服务期执行。退款或撤销按原账期生成调整分录。',
  },
  {
    label: '异常与对账', title: 'Webhook 缺一条、来三次、或乱序都能恢复',
    note: '按渠道账户验签并持久化，返回后交 Worker。丢事件、晚到旧状态或接口超时都可回原渠道查证。',
    paypal: ['GET /v1/billing/subscriptions/{id}/transactions', '按时间窗口拉取 Sale 并查询订阅详情，核对交易、状态和 outstanding_balance。投递失败与扣款失败各有独立重试。', '订阅 + 交易列表是对账输入'],
    stripe: ['GET /v1/invoices?subscription={id}', '分页拉取 Invoice，再核对订阅、付款与退款证据。对事件乱序按当前资源状态及账期处理。', '订阅 + Invoice + 付款证据'],
    event: 'ReconciliationApplied', adapter: '使用相同归一化逻辑回放。Inbox 去重、账期权益唯一约束与账本补偿各负责一类重复或遗漏，不能互相替代。',
  },
];

const byId = id => document.getElementById(id);
const nav = byId('phases');
const play = byId('play');
const previous = byId('previous');
const next = byId('next');
const lab = nav.closest('.lab');
const fullSequence = byId('fullSequence');
let current = 0;
let timer;
let frame;

const buttons = phases.map(({ label, paypal, stripe, event }, index) => {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.addEventListener('click', () => { pause(); render(index, true); });
  nav.append(button);

  const row = document.createElement('li');
  const title = document.createElement('h3');
  title.textContent = label;
  const pair = document.createElement('div');
  for (const [provider, signal] of [['PayPal', paypal[0]], ['Stripe', stripe[0]]]) {
    const item = document.createElement('p');
    const name = document.createElement('strong');
    const operation = document.createElement('code');
    name.textContent = provider;
    operation.textContent = signal;
    item.append(name, operation);
    pair.append(item);
  }
  const normalized = document.createElement('p');
  normalized.className = 'lc-overview-event';
  normalized.textContent = 'Adapter → ' + event;
  row.append(title, pair, normalized);
  fullSequence.append(row);
  return button;
});
byId('overview').hidden = false;

function pause() {
  clearInterval(timer);
  timer = undefined;
  play.textContent = '播放演示';
}

function render(index, reveal = false) {
  current = index;
  const step = phases[index];
  byId('stepTitle').textContent = step.title;
  byId('stepNote').textContent = step.note;
  for (const provider of ['paypal', 'stripe']) {
    for (const [i, suffix] of ['Signal', 'Detail', 'State'].entries()) {
      byId(provider + suffix).textContent = step[provider][i];
    }
  }
  byId('domainEvent').textContent = step.event;
  byId('adapterDetail').textContent = step.adapter;
  byId('stepNumber').textContent = `${index + 1} / ${phases.length}`;
  previous.disabled = index === 0;
  next.disabled = index === phases.length - 1;
  buttons.forEach((button, position) => button.setAttribute('aria-pressed', String(index === position)));
  if (reveal && nav.scrollWidth > nav.clientWidth) {
    const button = buttons[index].getBoundingClientRect();
    const row = nav.getBoundingClientRect();
    if (button.left < row.left || button.right > row.right) {
      nav.scrollLeft += button.left - row.left - 4;
    }
  }
  lab.classList.remove('is-updating');
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => lab.classList.add('is-updating'));
}

play.addEventListener('click', () => {
  if (timer) { pause(); return; }
  if (current === phases.length - 1) render(0, true);
  play.textContent = '暂停';
  timer = setInterval(() => {
    render(current + 1, true);
    if (current === phases.length - 1) pause();
  }, 4000);
});
previous.addEventListener('click', () => { pause(); render(current - 1, true); });
next.addEventListener('click', () => { pause(); render(current + 1, true); });
byId('reset').addEventListener('click', () => { pause(); render(0, true); });
nav.addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const focused = buttons.indexOf(event.target);
  if (focused < 0) return;
  event.preventDefault();
  const index = event.key === 'Home' ? 0 : event.key === 'End' ? phases.length - 1 :
    Math.max(0, Math.min(phases.length - 1, focused + (event.key === 'ArrowRight' ? 1 : -1)));
  buttons[index].focus();
  buttons[index].click();
});
render(0);
