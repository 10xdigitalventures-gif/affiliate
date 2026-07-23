import { Injectable } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import { IngestOrderDto } from '../orders/dto/ingest-order.dto'

/**
 * WooCommerce connector. Verifies webhook authenticity and normalises Woo
 * order payloads into the platform-agnostic IngestOrderDto.
 */
@Injectable()
export class WooCommerceService {
  /** base64 HMAC-SHA256 of the raw body, compared to X-WC-Webhook-Signature. */
  verifyWebhook(rawBody: Buffer, signature: string | undefined, secret: string): boolean {
    if (!signature) return false
    const digest = createHmac('sha256', secret).update(rawBody).digest('base64')
    const a = Buffer.from(digest)
    const b = Buffer.from(signature)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  mapOrder(storeId: string, payload: any): IngestOrderDto {
    const meta: Array<{ key: string; value: string }> = payload.meta_data || []
    const referralCode = meta.find((m) => m.key === 'aff_ref')?.value
    const couponCode = (payload.coupon_lines || [])[0]?.code
    const total = Number(payload.total ?? 0)
    const tax = Number(payload.total_tax ?? 0)
    const shipping = Number(payload.shipping_total ?? 0)
    return {
      storeId,
      externalOrderId: String(payload.id),
      subtotal: Math.max(total - tax - shipping, 0),
      total,
      currency: payload.currency || 'USD',
      status: payload.status || 'processing',
      placedAt: payload.date_created,
      customerEmail: payload.billing?.email,
      couponCode,
      referralCode,
    }
  }

  /** Map a WooCommerce product payload to the normalised catalog shape. */
  mapProduct(_storeId: string, payload: any) {
    const categories: Array<{ name: string; id?: number }> = payload.categories || []
    return {
      externalId: String(payload.id),
      name: payload.name ?? 'Untitled',
      price: Number(payload.price ?? payload.regular_price ?? 0),
      sku: payload.sku || null,
      categoryName: categories[0]?.name || null,
      categoryExternalId: categories[0]?.id != null ? String(categories[0].id) : null,
      status: (payload.status === 'publish' ? 'active' : 'inactive') as 'active' | 'inactive',
    }
  }

  refundAmount(payload: any): number {
    // Woo sends the running order total after refund; refunded amount is negative in refunds[]
    const refunds: Array<{ total: string }> = payload.refunds || []
    if (refunds.length) return refunds.reduce((s, r) => s + Math.abs(Number(r.total || 0)), 0)
    return Math.abs(Number(payload.amount ?? 0))
  }

  refundOrderId(payload: any): string {
    return String(payload.order_id ?? payload.id)
  }
}
