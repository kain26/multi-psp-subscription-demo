// TypeScript-style pseudocode. Repository, adapter and queue methods represent
// application contracts. Each example focuses on one boundary, not a full service.
export const codeExamples = {
  normal: {
    title: '创建 Checkout，确认收款后发权益',
    point: '先校验套餐并保存渠道归属。Checkout 返回跳转地址，权益由已核实的收款事件驱动。',
    source: `async function createCheckout(user: User, req: CheckoutRequest) {
  const command = await plans.quoteFor(user, req); // 后端查价
  const attempt = await attempts.reserve(user.id, req.key, command);
  // reserve 校验请求指纹，固定渠道、请求参数和 PSP key
  if (!attempt.owned) return attempt.currentResponse;

  const psp = adapters[attempt.provider];
  const checkout = await psp.createCheckout(attempt.command, attempt.pspKey);
  await attempts.bindCheckout(attempt.id, checkout);
  return { url: checkout.url };
}

async function onProviderEvent(event: ProviderEvent) {
  const payment = await verifyCollectedPayment(event);
  if (payment) {
    return billing.applyPaidAndEnqueueEntitlement(payment);
  }
  if (event.kind === "CHECKOUT_COMPLETED") {
    await attempts.recordCompleted(event);
  }
}`,
  },
  paypal: {
    title: '用 Adapter 统一 Stripe 和 PayPal',
    point: 'Router 只为新尝试选路。Adapter 把渠道标识和授权链接转换为同一种 Checkout 结果。',
    source: `type Checkout = { providerRef: string; url: string };

interface PaymentProvider {
  createCheckout(cmd: CheckoutCommand, key: string): Promise<Checkout>;
}

const paypalAdapter: PaymentProvider = {
  async createCheckout(cmd, key) {
    const sub = await paypal.createSubscription({
      plan_id: planMapping.paypal(cmd.planId),
      custom_id: cmd.intentId,
    }, { requestId: key });

    const approval = sub.links.find(link => link.rel === "approve");
    if (!approval) throw new ProviderProtocolError();
    return { providerRef: sub.id, url: approval.href };
  },
};`,
  },
  double: {
    title: '并发重复点击只创建一次',
    point: '业务唯一键负责选出执行者。请求指纹防止同一个 key 被用于不同选项或金额。',
    source: `async function reserve(userId: string, key: string, cmd: Command) {
  const fingerprint = hashCanonical(cmd);
  return db.transaction(async tx => {
    // UNIQUE(user_id, operation, business_key)
    const row = await tx.attempts.insertOrLoad({
      userId, operation: "CHECKOUT", key, fingerprint,
      provider: pickProvider(cmd), pspKey: randomUUID(),
      command: cmd, status: "CREATING",
    });

    if (row.fingerprint !== fingerprint) throw new Conflict(409);
    if (!row.inserted) return reuseOrReportPending(row);
    return claimFirstExecution(row);
  });
}
// 并发输家读取已有结果或返回处理中。崩溃后由恢复任务接管。`,
  },
  timeout: {
    title: '超时先进入 UNKNOWN',
    point: '继续核对原渠道。触发跨渠道新尝试前，必须有证据表明旧操作无法再成功。',
    source: `async function onCheckoutTimeout(id: string) {
  await attempts.markUnknownAndEnqueueRecoveryIfCreating(id);
}

async function recoverCheckout(attempt: CheckoutAttempt) {
  const psp = adapters[attempt.provider];
  // 优先查已知引用，渠道支持且仍在窗口内才原样重试。
  const evidence = attempt.providerRef
    ? await psp.retrieve(attempt.providerRef)
    : await psp.findByBusinessRef(attempt.intentId);

  if (evidence?.reusable) return attempts.bind(attempt.id, evidence);
  if (evidence?.cannotComplete) {
    return attempts.closeWithProof(attempt.id, evidence);
  }
  if (psp.canReplayOriginal(attempt)) {
    return replayAndBind(attempt, psp, attempt.pspKey);
  }
  await attempts.keepUnknownAndScheduleReview(attempt.id);
}`,
  },
  duplicates: {
    title: '两层幂等保护 Credits',
    point: '同一回调在 Inbox 去重。不同 Event ID 指向同一账单时，账本仍只入账一次。',
    source: `async function receiveWebhook(req: RawWebhookRequest) {
  const event = await webhookAdapters[req.provider].verify(req);
  // UNIQUE(provider, account_id, event_id)
  await inbox.insertIfAbsent(event); // 使用持久化 Inbox 供 Worker 读取
  return 200;
}

async function grantCredits(job: EntitlementJob) {
  return db.transaction(async tx => {
    // UNIQUE(subscription_id, invoice_id, credit_type)
    const inserted = await tx.creditLedger.insertIfAbsent(job);
    if (inserted) {
      await tx.balance.add(job.userId, job.amount);
    }
  });
}
// 消费端在事务成功后 ACK，可安全处理消息重投。`,
  },
  reconcile: {
    title: '丢失靠查单补齐，乱序靠状态机拦截',
    point: '根据 PSP 当前快照校验业务事实，并复用相同的状态机与发放键。',
    source: `async function reconcile(attempt: CheckoutAttempt) {
  const snapshot = await adapters[attempt.provider].retrieveLinked(attempt);
  const paid = verifyInvoicePayment(snapshot, attempt);
  if (paid) await applyPaid(paid);
}

async function applyPaid(paid: VerifiedInvoicePayment) {
  await db.transaction(async tx => {
    const invoice = await tx.invoices.lock(paid.invoiceId);
    // 依据当前账期、业务状态和已处理事实判断合法迁移
    if (!machine.canApply(invoice, paid)) return;

    await tx.billing.recordPaid(paid);
    await tx.outbox.insertIfAbsent(entitlementJobFor(paid));
  });
}
// 晚到且含义不明的通知先查 PSP 当前快照，再交给状态机。`,
  },
  outbox: {
    title: '更新订阅与写 Outbox 同事务',
    point: 'Broker 确认后才标记 sent。确认与写回之间崩溃会导致重投，由消费端幂等兜底。',
    source: `async function applyPaid(invoice: VerifiedInvoicePayment) {
  await db.transaction(async tx => {
    await tx.billing.applyVerifiedPayment(invoice);
    await tx.outbox.insertIfAbsent(entitlementJobFor(invoice));
  });
}

async function relayOnce() {
  const message = await outbox.claimWithLease();
  if (!message) return;

  await broker.publishConfirmed(message.id, message.payload);
  await outbox.markSent(message.id, message.leaseToken);
}
// 确认前失败或还没写回 sent 就崩溃，租约过期后重投。
// 账本仍通过发票与权益类型的唯一键保证一次入账。`,
  },
  entitlement: {
    title: '收款成功，权益失败可补偿',
    point: '失败只推进权益重试。补偿与原任务共用同一个发票和权益类型键。',
    source: `async function handleGrant(job: EntitlementJob) {
  try {
    await grantCredits(job);
    await jobs.complete(job.key);
  } catch (error) {
    await jobs.persistRetry(job.key, job, nextBackoff(job));
    // 原消息在重试任务持久化成功后才 ACK。
  }
}

async function repairMissingCredits(invoice: VerifiedInvoicePayment) {
  const job = entitlementJobFor(invoice); // 沿用原业务幂等键
  if (!await ledger.exists(job.key)) {
    await jobs.scheduleIfNeeded(job);
  }
}
// 并发补偿最终仍以账本唯一约束为准。`,
  },
  renewal: {
    title: '续费失败分别推进交易与订阅状态',
    point: '本次 Payment 失败时 Invoice 可保持 OPEN。已发权益按宽限期策略处理。',
    source: `async function onRenewalFailed(event: VerifiedRenewalFailure) {
  await db.transaction(async tx => {
    const invoice = await tx.invoices.lock(event.invoiceId);
    if (!machine.acceptFailure(invoice, event)) return;

    await tx.payments.markFailed(event.attemptId);
    if (!invoice.isCurrentCycle || invoice.status !== "OPEN") return;
    await tx.subscriptions.moveToPastDue(invoice.subscriptionId);

    const until = policy.graceUntil(invoice);
    if (until) {
      await tx.entitlements.keepUntil(invoice.subscriptionId, until);
    }
  });
}
// 成功续费经过独立的收款验证，再发放下一周期 Credits。`,
  },
};
