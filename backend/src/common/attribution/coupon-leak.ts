/**
 * Anti-leak coupon protection helpers.
 *
 * Coupon-leak / deal sites (RetailMeNot, Honey, etc.) scrape affiliate coupon
 * codes and republish them. Shoppers who were going to buy anyway grab the code
 * there, and the coupon-owning affiliate collects commission they did not earn.
 *
 * These pure helpers let the attribution layer detect when a coupon conversion
 * most likely leaked, so the tenant can either flag it for review or block the
 * commission entirely.
 */

/** Well-known coupon / deal / cashback domains (host suffix match). */
export const DEFAULT_COUPON_SITES: string[] = [
  'retailmenot.com',
  'honey.com',
  'joinhoney.com',
  'coupons.com',
  'couponcabin.com',
  'slickdeals.net',
  'groupon.com',
  'rakuten.com',
  'ebates.com',
  'dealsplus.com',
  'savings.com',
  'offers.com',
  'wethrift.com',
  'dontpayfull.com',
  'coupert.com',
  'capitaloneshopping.com',
  'couponfollow.com',
  'knoji.com',
  'simplycodes.com',
  'promocodes.com',
  'couponbirds.com',
  'hotdeals.com',
  'dealcatcher.com',
  'bradsdeals.com',
]

/** Extract a normalised (lowercase, no leading www.) host from a referrer string. */
export function referrerHost(referrer?: string | null): string | null {
  if (!referrer) return null
  const raw = String(referrer).trim()
  if (!raw) return null
  try {
    const withScheme = raw.includes('://') ? raw : 'http://' + raw
    const u = new URL(withScheme)
    return u.hostname.toLowerCase().replace(/^www\./, '') || null
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || null
  }
}

/**
 * Returns the matched blocked domain when the referrer host equals or is a
 * subdomain of any blocked domain; otherwise null.
 */
export function matchBlockedReferrer(
  referrer: string | null | undefined,
  blocked: string[],
): string | null {
  const host = referrerHost(referrer)
  if (!host) return null
  for (const entry of blocked) {
    const dom = String(entry).toLowerCase().replace(/^www\./, '').trim()
    if (!dom) continue
    if (host === dom || host.endsWith('.' + dom)) return dom
  }
  return null
}
