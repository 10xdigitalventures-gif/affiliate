import { Injectable } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import { IngestOrderDto } from '../orders/dto/ingest-order.dto'

/**
 * GoHighLevel (GHL) connector.
 * Verifies webhook authenticity and normalises GHL purchase / order / subscription
 * payloads into the platform-agnostic IngestOrderDto.
 *
 * GHL webhook headers:
 *   x-ghl-signature: HMAC-SHA256 hex digest of raw body
 */
@Injectable()
export class GhlService {
  /** Verify x-ghl-signature (hex HMAC-SHA256 of raw body). */
  verifyWebhook(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
    if (!signatureHeader) return false
    const digest = createHmac('sha256', secret).update(rawBody).digest('hex')
    const a = Buffer.from(digest)
    const b = Buffer.from(signatureHeader)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /**
   * Map a GHL order / purchase / subscription payload to the normalised ingest shape.
   *
   * Supported event types: OrderCreate, InvoicePaid, SubscriptionCreate
   * GHL payload shape (relevant fields):
   * {
   *   id, contactId, contact: { email, firstName, lastName },
   *   amount, currency, status,
   *   discountCodes: ["CODE"],
   *   source: { referralCode: "AFFCODE" },
   *   createdAt
   * }
   */
  mapOrder(storeId: string, payload: any): IngestOrderDto {
    // Coupon code: GHL sends an array of discount codes
    const discountCodes: string[] = payload.discountCodes ?? payload.discount_codes ?? []
    const couponCode = discountCodes[0] ?? undefined

    // Referral / affiliate code: passed via source.referralCode or utm params
    const referralCode: string | undefined =
      payload.source?.referralCode ??
      payload.source?.ref ??
      payload.utm?.ref ??
      undefined

    const amount = Number(payload.amount ?? payload.total ?? payload.price ?? 0)
    const currency: string = (payload.currency ?? 'USD').toUpperCase()

    // Determine order status from GHL financial status
    const rawStatus: string = (payload.status ?? 'paid').toLowerCase()
    const status = rawStatus === 'active' || rawStatus === 'paid' ? 'paid' : rawStatus

    return {
      storeId,
      externalOrderId: String(payload.id ?? payload.orderId ?? payload.invoiceId ?? payload.subscriptionId),
      subtotal: amount,
      total: amount,
      currency,
      status,
      placedAt: payload.createdAt ?? payload.created_at,
      customerEmail: payload.contact?.email ?? payload.email,
      couponCode,
      referralCode,
    }
  }

  /** Map a GHL product / offer payload to the normalised catalog shape. */
  mapProduct(_storeId: string, payload: any) {
    const price = Number(payload.amount ?? payload.price ?? payload.priceAmount ?? 0)
    const active = (payload.availableInStore ?? payload.active ?? true) ? 'active' : 'inactive'
    return {
      externalId: String(payload.id ?? payload._id ?? payload.productId),
      name: payload.name ?? payload.title ?? 'Untitled',
      price,
      sku: payload.sku || null,
      categoryName: payload.category || payload.collection || null,
      status: active as 'active' | 'inactive',
    }
  }

  /** Refund amount from a GHL refund event payload. */
  refundAmount(payload: any): number {
    return Number(payload.refundAmount ?? payload.amount ?? 0)
  }

  /** Original order id from a GHL refund payload. */
  refundOrderId(payload: any): string {
    return String(payload.orderId ?? payload.id)
  }

  /** Classify a GHL webhook event type string. */
  eventType(typeHeader: string | undefined, payload: any): 'order' | 'refund' | 'unknown' {
    const t = (typeHeader ?? payload?.type ?? payload?.eventType ?? '').toLowerCase()
    if (/refund|chargeback/.test(t)) return 'refund'
    if (/order|invoice|subscription|purchase/.test(t)) return 'order'
    return 'unknown'
  }
}
