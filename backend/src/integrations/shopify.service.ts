import { Injectable } from '@nestjs/common'
import { createHmac, timingSafeEqual } from 'crypto'
import { IngestOrderDto } from '../orders/dto/ingest-order.dto'
import { classifyChannel } from '../common/attribution/channel'

/** Parse a URL (or bare query string) into a flat query-param map. */
function parseQuery(url?: string | null): Record<string, string> {
  if (!url) return {}
  try {
    const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : url
    const out: Record<string, string> = {}
    for (const [k, v] of new URLSearchParams(q)) out[k] = v
    return out
  } catch {
    return {}
  }
}

/** Flatten Shopify note_attributes into a plain map. */
function attrsToMap(attrs: Array<{ name: string; value: string }>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const a of attrs || []) if (a && a.name) out[a.name] = a.value
  return out
}

/**
 * Shopify connector. Verifies webhook authenticity and normalises Shopify
 * order payloads into the platform-agnostic IngestOrderDto.
 */
@Injectable()
export class ShopifyService {
  /** HMAC-SHA256(base64) of the raw request body, compared to X-Shopify-Hmac-Sha256. */
  verifyWebhook(rawBody: Buffer, hmacHeader: string | undefined, secret: string): boolean {
    if (!hmacHeader) return false
    const digest = createHmac('sha256', secret).update(rawBody).digest('base64')
    const a = Buffer.from(digest)
    const b = Buffer.from(hmacHeader)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /**
   * Map a Shopify order webhook payload to the normalised ingest shape.
   *
   * UTM / ad-source recovery: Shopify strips query params from the checkout
   * URL, but it records the customer's FIRST landing URL on the order as
   * `landing_site` (e.g. "/products/x?ref=CODE&utm_source=facebook&fbclid=...").
   * We parse attribution signals from that landing URL, and let cart
   * note_attributes (set by our storefront script) override when present. This
   * makes the source survive all the way to the order even though the checkout
   * dropped the parameters.
   */
  mapOrder(storeId: string, payload: any): IngestOrderDto {
    const noteAttrs: Array<{ name: string; value: string }> = payload.note_attributes || []
    const attrs = attrsToMap(noteAttrs)
    const attr = (name: string) => (attrs[name] ? String(attrs[name]) : undefined)

    const landingSite: string | undefined =
      payload.landing_site || payload.landing_site_ref || undefined
    const landingParams = parseQuery(landingSite)

    const referralCode = attr('aff_ref') || landingParams.ref || landingParams.aff || undefined

    const utm = {
      source: attr('utm_source') || landingParams.utm_source,
      medium: attr('utm_medium') || landingParams.utm_medium,
      campaign: attr('utm_campaign') || landingParams.utm_campaign,
      term: attr('utm_term') || landingParams.utm_term,
      content: attr('utm_content') || landingParams.utm_content,
    }

    // Merge landing-url params + note_attributes so ad click-ids (gclid/fbclid…)
    // are visible to the classifier regardless of which layer captured them.
    const ch = classifyChannel({ utm, params: { ...landingParams, ...attrs } })
    const channelAttr = attr('aff_channel')
    const hasSignal = !!(
      channelAttr || utm.source || utm.medium || utm.campaign || ch.adClickId || referralCode
    )
    const channel =
      channelAttr === 'paid'
        ? 'paid'
        : channelAttr === 'organic'
        ? 'organic'
        : hasSignal
        ? ch.channel
        : undefined
    const adNetwork = attr('aff_adnet') || ch.adNetwork

    const couponCode = (payload.discount_codes || [])[0]?.code
    return {
      storeId,
      externalOrderId: String(payload.id),
      subtotal: Number(payload.subtotal_price ?? payload.total_price ?? 0),
      total: Number(payload.total_price ?? payload.subtotal_price ?? 0),
      currency: payload.currency || 'USD',
      status: payload.financial_status || 'paid',
      placedAt: payload.created_at,
      customerEmail: payload.email || payload.customer?.email,
      couponCode,
      referralCode,
      clickId: attr('aff_click'),
      channel,
      adNetwork,
      adClickId: ch.adClickId,
      utmSource: utm.source,
      utmMedium: utm.medium,
      utmCampaign: utm.campaign,
      utmTerm: utm.term,
      utmContent: utm.content,
      landingSite,
      referrer: payload.referring_site || undefined,
    }
  }

  /** Map a Shopify product payload to the normalised catalog shape. */
  mapProduct(_storeId: string, payload: any) {
    const variant = (payload.variants || [])[0] || {}
    const price = Number(variant.price ?? payload.price ?? 0)
    const published = payload.status ? payload.status === 'active' : payload.published_at != null
    return {
      externalId: String(payload.id ?? variant.product_id),
      name: payload.title ?? variant.title ?? 'Untitled',
      price,
      sku: variant.sku || null,
      categoryName: payload.product_type || null,
      status: (published ? 'active' : 'inactive') as 'active' | 'inactive',
    }
  }

  /** Total refunded amount from a Shopify refund webhook payload. */
  refundAmount(payload: any): number {
    const txns: Array<{ amount: string }> = payload.transactions || []
    if (txns.length) return txns.reduce((s, t) => s + Number(t.amount || 0), 0)
    const items: Array<{ subtotal: number }> = payload.refund_line_items || []
    return items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
  }

  /** External order id a refund webhook belongs to. */
  refundOrderId(payload: any): string {
    return String(payload.order_id ?? payload.id)
  }
}
