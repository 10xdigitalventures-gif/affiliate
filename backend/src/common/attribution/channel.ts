/**
 * Traffic-channel classification: did the visitor arrive from a PAID ad
 * (Meta / Google / TikTok / etc.) or from an ORGANIC source?
 *
 * Pure, dependency-free helpers used by the tracking layer (server) and
 * mirrored by the JS snippet / plugins (client) so the signal is consistent.
 */
export type TrafficChannel = 'paid' | 'organic'

/** utm_medium values that indicate paid traffic. */
const PAID_MEDIUMS = new Set([
  'cpc', 'ppc', 'paid', 'paidsocial', 'paid-social', 'paid_social',
  'display', 'cpm', 'cpv', 'banner', 'retargeting', 'remarketing',
  'affiliate-paid', 'social-paid',
])

/** Ad click-id query params -> the network that set them. */
const AD_CLICK_IDS: Record<string, string> = {
  gclid: 'google',
  gbraid: 'google',
  wbraid: 'google',
  gclsrc: 'google',
  dclid: 'google',
  fbclid: 'meta',
  ttclid: 'tiktok',
  msclkid: 'microsoft',
  li_fat_id: 'linkedin',
  twclid: 'twitter',
  epik: 'pinterest',
  sccid: 'snapchat',
}

/** Map a known utm_source to an ad network name (best effort). */
function networkFromSource(source?: string | null): string | undefined {
  if (!source) return undefined
  const s = source.toLowerCase()
  if (/(facebook|fb|instagram|ig|meta)/.test(s)) return 'meta'
  if (/(google|adwords|gads|youtube|yt)/.test(s)) return 'google'
  if (/(tiktok|tt)/.test(s)) return 'tiktok'
  if (/(bing|microsoft|msn)/.test(s)) return 'microsoft'
  if (/(linkedin)/.test(s)) return 'linkedin'
  if (/(twitter|^x$|x-ads)/.test(s)) return 'twitter'
  if (/(pinterest)/.test(s)) return 'pinterest'
  if (/(snap)/.test(s)) return 'snapchat'
  return undefined
}

export interface ChannelInput {
  /** Parsed utm_* values (source/medium/campaign/...). */
  utm?: Record<string, string | undefined> | null
  /** Full query/params bag from the landing URL (to look up ad click ids). */
  params?: Record<string, string | undefined> | null
}

export interface ChannelResult {
  channel: TrafficChannel
  adNetwork?: string
  /** The raw ad click id we matched, if any (for auditing). */
  adClickId?: string
}

/**
 * Classify a landing as paid or organic.
 * PAID when: any known ad click id is present, OR utm_medium is a paid medium.
 * Otherwise ORGANIC.
 */
export function classifyChannel(input: ChannelInput): ChannelResult {
  const utm = input.utm ?? {}
  const params = input.params ?? {}

  // 1) Ad click ids are the strongest paid signal.
  for (const key of Object.keys(AD_CLICK_IDS)) {
    const v = params[key] ?? params[key.toLowerCase()]
    if (v != null && String(v).length > 0) {
      return { channel: 'paid', adNetwork: AD_CLICK_IDS[key], adClickId: String(v) }
    }
  }

  // 2) utm_medium paid classification.
  const medium = (utm.medium ?? params.utm_medium ?? '').toString().toLowerCase().trim()
  if (medium && PAID_MEDIUMS.has(medium)) {
    return { channel: 'paid', adNetwork: networkFromSource(utm.source ?? params.utm_source) }
  }

  // 3) Everything else is organic.
  return { channel: 'organic', adNetwork: networkFromSource(utm.source ?? params.utm_source) }
}

/** Normalize an arbitrary string into a valid TrafficChannel (fallback organic). */
export function normalizeChannel(value?: string | null): TrafficChannel {
  return value === 'paid' ? 'paid' : 'organic'
}
