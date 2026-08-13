import { Injectable, Logger, UnauthorizedException } from '@nestjs/common'
import { WebhookEvent } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StoresService } from '../stores/stores.service'
import { OrdersService } from '../orders/orders.service'
import { ShopifyService } from '../integrations/shopify.service'
import { WooCommerceService } from '../integrations/woocommerce.service'
import { GhlService } from '../integrations/ghl.service'
import { QueueService } from '../queue/queue.service'

type Headers = Record<string, string | string[] | undefined>
const h = (headers: Headers, key: string) => {
  const v = headers[key]
  return Array.isArray(v) ? v[0] : v
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks')

  constructor(
    private readonly prisma: PrismaService,
    private readonly stores: StoresService,
    private readonly orders: OrdersService,
    private readonly shopify: ShopifyService,
    private readonly woo: WooCommerceService,
    private readonly ghl: GhlService,
    private readonly queue: QueueService,
  ) {}

  async handleShopify(storeId: string, headers: Headers, rawBody: Buffer) {
    const ctx = await this.stores.getForWebhook(storeId)
    if (!ctx) return { ok: false, reason: 'unknown store' }

    this.assertVerified(
      !!ctx.webhookSecret &&
        this.shopify.verifyWebhook(rawBody, h(headers, 'x-shopify-hmac-sha256'), ctx.webhookSecret),
      ctx.webhookSecret,
    )

    const payload = JSON.parse(rawBody.toString('utf8') || '{}')
    const topic = h(headers, 'x-shopify-topic') || 'unknown'
    const webhookId = h(headers, 'x-shopify-webhook-id') || `${topic}:${payload.id}`

    return this.process({
      platform: 'shopify',
      store: ctx.store,
      topic,
      idempotencyKey: `shopify:${storeId}:${webhookId}`,
      payload,
      mapOrder: () => this.shopify.mapOrder(storeId, payload),
      mapRefund: () => ({ orderId: this.shopify.refundOrderId(payload), amount: this.shopify.refundAmount(payload) }),
    })
  }

  async handleWoo(storeId: string, headers: Headers, rawBody: Buffer) {
    const ctx = await this.stores.getForWebhook(storeId)
    if (!ctx) return { ok: false, reason: 'unknown store' }

    this.assertVerified(
      !!ctx.webhookSecret &&
        this.woo.verifyWebhook(rawBody, h(headers, 'x-wc-webhook-signature'), ctx.webhookSecret),
      ctx.webhookSecret,
    )

    const payload = JSON.parse(rawBody.toString('utf8') || '{}')
    const topic = h(headers, 'x-wc-webhook-topic') || 'unknown'
    const webhookId = h(headers, 'x-wc-webhook-id') || `${topic}:${payload.id}`

    return this.process({
      platform: 'woocommerce',
      store: ctx.store,
      topic,
      idempotencyKey: `woo:${storeId}:${webhookId}`,
      payload,
      mapOrder: () => this.woo.mapOrder(storeId, payload),
      mapRefund: () => ({ orderId: this.woo.refundOrderId(payload), amount: this.woo.refundAmount(payload) }),
    })
  }

  private assertVerified(verified: boolean, secret: string | null) {
    if (verified) return
    // Dev convenience: allow unsigned webhooks only when no secret is configured and not in production.
    if (!secret && process.env.NODE_ENV !== 'production') return
    throw new UnauthorizedException('Invalid webhook signature')
  }

  /** Re-process a stored WebhookEvent (called by the retry worker; skips signature check). */
  async handleGhl(storeId: string, headers: Headers, rawBody: Buffer) {
    const ctx = await this.stores.getForWebhook(storeId)
    if (!ctx) return { ok: false, reason: 'unknown store' }

    this.assertVerified(
      !!ctx.webhookSecret &&
        this.ghl.verifyWebhook(rawBody, h(headers, 'x-ghl-signature'), ctx.webhookSecret),
      ctx.webhookSecret,
    )

    const payload = JSON.parse(rawBody.toString('utf8') || '{}')
    const eventType = h(headers, 'x-ghl-event-type') ?? h(headers, 'x-webhook-event') ?? payload?.type ?? 'unknown'
    const webhookId = h(headers, 'x-ghl-webhook-id') ?? h(headers, 'x-request-id') ?? `${eventType}:${payload.id}`

    return this.process({
      platform: 'ghl',
      store: ctx.store,
      topic: eventType,
      idempotencyKey: `ghl:${storeId}:${webhookId}`,
      payload,
      mapOrder: () => this.ghl.mapOrder(storeId, payload),
      mapRefund: () => ({ orderId: this.ghl.refundOrderId(payload), amount: this.ghl.refundAmount(payload) }),
    })
  }

  async reprocessEvent(event: WebhookEvent) {
    const ctx = await this.stores.getForWebhook(event.storeId)
    if (!ctx) return { ok: false, reason: 'unknown store' }
    const payload = event.payload as any
    if (event.platform === 'shopify') {
      return this.process({
        platform: 'shopify',
        store: ctx.store,
        topic: event.topic,
        idempotencyKey: event.idempotencyKey,
        payload,
        mapOrder: () => this.shopify.mapOrder(event.storeId, payload),
        mapRefund: () => ({ orderId: this.shopify.refundOrderId(payload), amount: this.shopify.refundAmount(payload) }),
      })
    }
    if (event.platform === 'ghl') {
      return this.process({
        platform: 'ghl',
        store: ctx.store,
        topic: event.topic,
        idempotencyKey: event.idempotencyKey,
        payload,
        mapOrder: () => this.ghl.mapOrder(event.storeId, payload),
        mapRefund: () => ({ orderId: this.ghl.refundOrderId(payload), amount: this.ghl.refundAmount(payload) }),
      })
    }
    return this.process({
      platform: 'woocommerce',
      store: ctx.store,
      topic: event.topic,
      idempotencyKey: event.idempotencyKey,
      payload,
      mapOrder: () => this.woo.mapOrder(event.storeId, payload),
      mapRefund: () => ({ orderId: this.woo.refundOrderId(payload), amount: this.woo.refundAmount(payload) }),
    })
  }

  private isRefundTopic(topic: string) {
    return /refund|chargeback/i.test(topic)
  }
  private isOrderTopic(topic: string) {
    // Shopify: orders/create  |  WooCommerce: order.created  |  GHL: OrderCreate, InvoicePaid, SubscriptionCreate
    return (
      /^order/i.test(topic) ||
      /orders\//i.test(topic) ||
      /invoicepaid/i.test(topic) ||
      /subscriptioncreate/i.test(topic) ||
      /purchase/i.test(topic)
    )
  }

  private async process(args: {
    platform: 'shopify' | 'woocommerce' | 'ghl'
    store: { id: string; organizationId: string }
    topic: string
    idempotencyKey: string
    payload: any
    mapOrder: () => any
    mapRefund: () => { orderId: string; amount: number }
  }) {
    const { platform, store, topic, idempotencyKey, payload } = args

    // Idempotency: never process the same delivery twice.
    const existing = await this.prisma.webhookEvent.findUnique({ where: { idempotencyKey } })
    if (existing?.status === 'processed') return { ok: true, deduped: true }

    const event =
      existing ??
      (await this.prisma.webhookEvent.create({
        data: { storeId: store.id, platform, topic, idempotencyKey, payload, status: 'received' },
      }))

    try {
      if (/uninstall/i.test(topic)) {
        // Shopify app/uninstalled (or equivalent): disconnect the store.
        await this.stores.markDisconnected(store.id)
      } else if (this.isRefundTopic(topic)) {
        const { orderId, amount } = args.mapRefund()
        await this.orders.refundByExternal(store.organizationId, store.id, orderId, amount)
      } else if (this.isOrderTopic(topic)) {
        await this.orders.ingest(store.organizationId, args.mapOrder())
      }
      await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'processed', attempts: { increment: 1 } },
      })
      await this.stores.recordSync(store.id, 'connected')
      return { ok: true, topic }
    } catch (err) {
      const updated = await this.prisma.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'failed', attempts: { increment: 1 } },
      })
      this.logger.error(`Webhook ${idempotencyKey} failed: ${(err as Error).message}`)
      // Schedule retry with exponential backoff (max 3 attempts total)
      await this.queue.addRetry(event.id, updated.attempts).catch(() => {})
      throw err
    }
  }
}
