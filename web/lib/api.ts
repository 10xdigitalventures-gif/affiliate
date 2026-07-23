// Thin typed API client. Browser sessions use Secure + HttpOnly cookies issued
// by the API, so JavaScript never reads access or refresh tokens.
const BASE =
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4100/v1').replace(/\/$/, '')

export function setTokens(accessToken: string | null, refreshToken?: string | null) {
  if (typeof window === 'undefined') return
  // Remove credentials left by v5. New tokens live only in HttpOnly cookies.
  window.sessionStorage.removeItem('token')
  window.sessionStorage.removeItem('refresh_token')
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

let refreshInFlight: Promise<boolean> | null = null

async function refreshBrowserSession(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => { refreshInFlight = null })
  }
  return refreshInFlight
}

export async function api<T = any>(path: string, init: RequestInit = {}, allowRefresh = true): Promise<T> {
  let res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const refreshEligible = ![
    '/auth/login',
    '/auth/email-code/request',
    '/auth/email-code/verify',
    '/auth/refresh',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/auth/accept-invite',
    '/auth/2fa/verify',
    '/auth/sso/exchange',
  ].includes(path)
  if (res.status === 401 && allowRefresh && refreshEligible) {
    if (await refreshBrowserSession()) {
      res = await fetch(`${BASE}${path}`, {
        ...init,
        credentials: 'include',
        headers: { 'content-type': 'application/json', ...(init.headers || {}) },
      })
    }
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '')
    let message = raw || res.statusText || `Request failed (${res.status})`
    try {
      const parsed = JSON.parse(raw)
      const value = parsed?.message
      if (Array.isArray(value)) message = value.join(', ')
      else if (typeof value === 'string') message = value
    } catch {
      // Keep a non-JSON response as-is.
    }
    throw new ApiError(message, res.status)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export type Paged<T> = { items: T[]; total: number }

// ---- Auth ----
export type AuthUser = {
  id: string
  email: string
  fullName?: string | null
  phoneNumber?: string | null
  avatarUrl?: string | null
  organizationId: string
  organization?: { id: string; name: string; slug: string }
  permissions: string[]
  affiliateId?: string | null
  isSuperAdmin?: boolean
}
export type AuthSession = { user: AuthUser }

export const Auth = {
  requestEmailCode: (email: string, workspace?: string) =>
    api<{ ok: true; challenge: string; expiresInSeconds: number }>('/auth/email-code/request', {
      method: 'POST',
      body: JSON.stringify({ email, workspace: workspace || undefined }),
    }, false),
  verifyEmailCode: (challenge: string, code: string) =>
    api<AuthSession | { twoFactorRequired: true; challenge: string }>('/auth/email-code/verify', {
      method: 'POST',
      body: JSON.stringify({ challenge, code }),
    }, false),
  async login(email: string, password: string, workspace?: string) {
    const res = await api<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, workspace: workspace || undefined }) })
    setTokens(null, null)
    return res
  },
  async refresh() {
    return api<AuthSession>('/auth/refresh', { method: 'POST', body: '{}' }, false)
  },
  async logout() {
    try {
      await api('/auth/logout', { method: 'POST', body: '{}' }, false)
    } finally {
      setTokens(null, null)
    }
  },
  logoutAll: () => api('/auth/logout-all', { method: 'POST' }),
  me: () => api<AuthUser & { status: string; emailVerifiedAt: string | null; twoFactorEnabled: boolean; isSuperAdmin: boolean }>('/auth/me'),
  updateProfile: (payload: { fullName: string; email: string; currentPassword?: string; phoneNumber?: string | null; avatarUrl?: string | null }) =>
    api<AuthUser & { status: string; emailVerifiedAt: string | null; twoFactorEnabled: boolean; isSuperAdmin: boolean }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  changePassword: (currentPassword: string, newPassword: string) =>
    api<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  forgotPassword: (email: string, workspace?: string) =>
    api<{ ok: boolean }>('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email, workspace: workspace || undefined }) }),
  resetPassword: (token: string, password: string) =>
    api<{ ok: boolean }>('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) }),
  invite: (payload: { email: string; fullName?: string; roleId?: string }) =>
    api<{ ok: boolean; userId: string }>('/auth/invitations', { method: 'POST', body: JSON.stringify(payload) }),
  acceptInvite: async (token: string, password: string, fullName?: string) => {
    const res = await api<AuthSession>('/auth/accept-invite', { method: 'POST', body: JSON.stringify({ token, password, fullName }) })
    setTokens(null, null)
    return res
  },
}

// ---- Workspace team & roles ----
export type TeamRole = {
  id: string
  organizationId: string | null
  name: string
  isSystem: boolean
  permissions: Array<{ permission: { id: string; key: string; description?: string | null } }>
  _count?: { users: number; invitations: number }
}
export type TeamMember = {
  id: string
  email: string
  fullName?: string | null
  phoneNumber?: string | null
  avatarUrl?: string | null
  status: 'active' | 'invited' | 'suspended'
  isSuperAdmin: boolean
  lastLoginAt?: string | null
  createdAt: string
  roles: Array<{ role: Pick<TeamRole, 'id' | 'name' | 'isSystem' | 'organizationId'> }>
}
export type TeamPermission = { id: string; key: string; description?: string | null }
export type TeamInvitation = {
  id: string
  email: string
  expiresAt: string
  createdAt: string
  invitedByUserId?: string | null
  role?: { id: string; name: string } | null
}

export const Team = {
  members: () => api<TeamMember[]>('/team/members'),
  roles: () => api<TeamRole[]>('/team/roles'),
  permissions: () => api<TeamPermission[]>('/team/permissions'),
  invitations: () => api<TeamInvitation[]>('/team/invitations'),
  createRole: (name: string, permissionKeys: string[]) =>
    api<TeamRole>('/team/roles', { method: 'POST', body: JSON.stringify({ name, permissionKeys }) }),
  updateRole: (id: string, payload: { name?: string; permissionKeys?: string[] }) =>
    api<TeamRole>(`/team/roles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteRole: (id: string) => api<{ ok: boolean }>(`/team/roles/${id}`, { method: 'DELETE' }),
  updateMember: (id: string, payload: { roleIds?: string[]; status?: 'active' | 'suspended' }) =>
    api<TeamMember>(`/team/members/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  revokeInvitation: (id: string) =>
    api<{ ok: boolean }>(`/team/invitations/${id}`, { method: 'DELETE' }),
}

// Login response is either full tokens or a 2FA challenge.
export type LoginResult = AuthSession | { twoFactorRequired: true; challenge: string }

// ---- Two-factor authentication ----
export type TwoFactorSetupData = { secret: string; otpauthUrl: string }

export const TwoFactor = {
  setup: () => api<TwoFactorSetupData>('/auth/2fa/setup', { method: 'POST' }),
  enable: (code: string) =>
    api<{ ok: boolean; recoveryCodes: string[] }>('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  disable: (code: string) =>
    api<{ ok: boolean }>('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  async verify(challenge: string, code: string) {
    const res = await api<AuthSession>('/auth/2fa/verify', { method: 'POST', body: JSON.stringify({ challenge, code }) })
    setTokens(null, null)
    return res
  },
}

// ---- SSO (OIDC) ----
export type SsoSettingsData = {
  enabled: boolean
  provider: string
  clientId: string
  hasClientSecret: boolean
  issuerUrl: string
  scopes: string
  allowedDomains: string[]
  autoProvision: boolean
  defaultRoleId: string | null
  callbackUrl: string
}

export const Sso = {
  settings: () => api<SsoSettingsData>('/settings/sso'),
  update: (dto: Partial<Omit<SsoSettingsData, 'hasClientSecret' | 'callbackUrl'>> & { clientSecret?: string }) =>
    api<SsoSettingsData>('/settings/sso', { method: 'PATCH', body: JSON.stringify(dto) }),
  authorizeUrl: (slug: string, next?: string) =>
    api<{ url: string }>(`/auth/sso/${encodeURIComponent(slug)}/authorize${next ? `?next=${encodeURIComponent(next)}` : ''}`),
  exchange: async (code: string) => {
    const res = await api<AuthSession>('/auth/sso/exchange', { method: 'POST', body: JSON.stringify({ code }) }, false)
    setTokens(null, null)
    return res
  },
}

// ---- Bulk CSV import / export ----
export type ImportResult = {
  total: number
  created: number
  skipped: number
  errors: Array<{ row: number; message: string }>
}

export type BulkExportEntity = 'affiliates' | 'commissions' | 'orders' | 'payouts'

async function downloadBulkCsv(path: string, filename: string) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error((await res.text().catch(() => res.statusText)) || `Request failed (${res.status})`)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const Bulk = {
  export: (entity: BulkExportEntity) => downloadBulkCsv(`/bulk/export/${entity}`, `${entity}.csv`),
  affiliateTemplate: () => downloadBulkCsv('/bulk/template/affiliates', 'affiliates-template.csv'),
  importAffiliates: (csv: string) =>
    api<ImportResult>('/bulk/import/affiliates', { method: 'POST', body: JSON.stringify({ csv }) }),
}

export type Affiliate = {
  id: string
  affiliateCode: string
  referralSlug: string
  status: string
  availableBalance: string
  lifetimeEarnings: string
  createdAt: string
}
export type StoreRow = {
  id: string
  name: string
  platform: string
  domain: string
  status: string
  webhookStatus: string
  lastSyncedAt: string | null
}
export type OrderRow = {
  id: string
  externalOrderId: string
  total: string
  currency: string
  status: string
  refundAmount: string
  placedAt: string | null
  // Traffic-source attribution (where the order came from)
  trafficChannel?: string | null
  adNetwork?: string | null
  utmSource?: string | null
  utmCampaign?: string | null
  attributionType?: string | null
}
export type CommissionRow = {
  id: string
  amount: string
  currency: string
  status: string
  createdAt: string
  affiliate?: { affiliateCode: string }
}

const qs = (o: Record<string, string | undefined>) => {
  const p = new URLSearchParams()
  Object.entries(o).forEach(([k, v]) => v && p.set(k, v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export type DownlineData = {
  subAffiliates: Array<{ id: string; affiliateCode: string; status: string; createdAt: string; _count: { subAffiliates: number } }>
  overrideEarnings: number
  overrideCount: number
}

export const Affiliates = {
  list: (status?: string) => api<Paged<Affiliate>>(`/affiliates${qs({ status })}`),
  approve: (id: string) => api(`/affiliates/${id}/approve`, { method: 'POST' }),
  setParent: (id: string, parentAffiliateId: string | null) =>
    api(`/affiliates/${id}/parent`, { method: 'PATCH', body: JSON.stringify({ parentAffiliateId }) }),
  downline: (id: string) => api<DownlineData>(`/affiliates/${id}/downline`),
}
export type ConnectStoreInput = {
  platform: 'shopify' | 'woocommerce' | 'ghl' | 'custom'
  name: string
  domain: string
  accessToken?: string
  consumerKey?: string
  consumerSecret?: string
  webhookSecret?: string
}

// ---- Shopify embedded (App Bridge session-token exchange) ----
export const ShopifyApp = {
  tokenExchange: (sessionToken: string) =>
    api<AuthSession>('/shopify/token-exchange', {
      method: 'POST',
      headers: { authorization: `Bearer ${sessionToken}` },
    }),
}

export const Stores = {
  list: () => api<StoreRow[]>('/stores'),
  connect: (dto: ConnectStoreInput) => api<StoreRow>('/stores/connect', { method: 'POST', body: JSON.stringify(dto) }),
  /**
   * Shopify 1-click app install: returns the Shopify OAuth authorize URL for a
   * shop domain (e.g. "my-shop.myshopify.com"). Redirect the browser to `url`.
   */
  shopifyInstallUrl: (shop: string) =>
    api<{ url: string; configured: boolean }>(`/shopify/install-url${qs({ shop })}`),
}

// ---- Catalog (products + categories) ----
export type CategoryRow = { id: string; name: string; externalId: string | null }
export type ProductRow = {
  id: string
  externalId: string
  sku: string | null
  name: string
  price: string
  status: 'active' | 'inactive'
  categoryId: string | null
  category: CategoryRow | null
  store: { id: string; name: string; platform: string } | null
  createdAt: string
}
export type CatalogStats = { total: number; active: number; inactive: number; categories: number; stores: number }
export type ProductFilters = { storeId?: string; categoryId?: string; status?: string; search?: string; skip?: number; take?: number }
export type UpsertProductInput = {
  storeId: string
  externalId: string
  name: string
  price: number
  sku?: string
  categoryName?: string
  status?: 'active' | 'inactive'
}
export type SyncCatalogInput = { products: Array<Record<string, unknown>>; normalized?: boolean }
export type SyncResult = { storeId: string; jobId: string; total: number; created: number; updated: number; skipped: number }

export const Catalog = {
  products: (f: ProductFilters = {}) =>
    api<Paged<ProductRow>>(
      `/catalog/products${qs({
        storeId: f.storeId,
        categoryId: f.categoryId,
        status: f.status,
        search: f.search,
        skip: f.skip != null ? String(f.skip) : undefined,
        take: f.take != null ? String(f.take) : undefined,
      })}`,
    ),
  product: (id: string) => api<ProductRow>(`/catalog/products/${id}`),
  categories: () => api<CategoryRow[]>('/catalog/categories'),
  stats: () => api<CatalogStats>('/catalog/stats'),
  upsert: (dto: UpsertProductInput) => api<ProductRow>('/catalog/products', { method: 'POST', body: JSON.stringify(dto) }),
  sync: (storeId: string, dto: SyncCatalogInput) =>
    api<SyncResult>(`/catalog/stores/${storeId}/sync`, { method: 'POST', body: JSON.stringify(dto) }),
}
// ---- Coupons ----
export type CouponRow = {
  id: string
  code: string
  status: 'active' | 'expired' | 'disabled'
  discountType: 'percentage' | 'fixed' | null
  expiresAt: string | null
  createdAt: string
  affiliateId: string | null
  store: { id: string; name: string; platform: string } | null
  affiliate: { id: string; affiliateCode: string } | null
  _count?: { orders: number }
}
export type CouponStats = { total: number; active: number; disabled: number; expired: number; assigned: number; unassigned: number }
export type CouponFilters = { storeId?: string; affiliateId?: string; status?: string; search?: string }
export type CreateCouponInput = { storeId: string; code: string; affiliateId?: string; discountType?: 'percentage' | 'fixed' }
export type UpdateCouponInput = {
  code?: string
  discountType?: 'percentage' | 'fixed'
  status?: 'active' | 'expired' | 'disabled'
  affiliateId?: string | null
  expiresAt?: string | null
}
export type BulkGenerateInput = { storeId: string; count: number; prefix?: string; length?: number; affiliateId?: string; discountType?: 'percentage' | 'fixed' }
export type BulkGenerateResult = { requested: number; created: number; coupons: Array<{ id: string; code: string }> }

export const Coupons = {
  list: (f: CouponFilters = {}) =>
    api<CouponRow[]>(`/coupons${qs({ storeId: f.storeId, affiliateId: f.affiliateId, status: f.status, search: f.search })}`),
  stats: () => api<CouponStats>('/coupons/stats'),
  create: (dto: CreateCouponInput) => api<CouponRow>('/coupons', { method: 'POST', body: JSON.stringify(dto) }),
  bulkGenerate: (dto: BulkGenerateInput) => api<BulkGenerateResult>('/coupons/bulk-generate', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, dto: UpdateCouponInput) => api<CouponRow>(`/coupons/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  remove: (id: string) => api<{ id: string; deleted: boolean }>(`/coupons/${id}`, { method: 'DELETE' }),
  assign: (id: string, affiliateId: string) => api<CouponRow>(`/coupons/${id}/assign/${affiliateId}`, { method: 'POST' }),
}

// ---- Affiliate links ----
export type LinkRow = {
  id: string
  destinationUrl: string
  shortCode: string
  shortUrl: string
  clicksCount: number
  storeId: string | null
  campaignId: string | null
  createdAt: string
  affiliate?: { id: string; affiliateCode: string } | null
  campaign?: { id: string; name: string } | null
}
export type LinkStats = { total: number; totalClicks: number }
export type LinkFilters = { affiliateId?: string; storeId?: string; campaignId?: string; search?: string }
export type CreateLinkInput = { affiliateId: string; destinationUrl: string; storeId?: string; campaignId?: string; shortCode?: string }
export type UpdateLinkInput = { destinationUrl?: string; storeId?: string | null; campaignId?: string | null }

export const Links = {
  list: (f: LinkFilters = {}) =>
    api<LinkRow[]>(`/links${qs({ affiliateId: f.affiliateId, storeId: f.storeId, campaignId: f.campaignId, search: f.search })}`),
  stats: () => api<LinkStats>('/links/stats'),
  create: (dto: CreateLinkInput) => api<LinkRow>('/links', { method: 'POST', body: JSON.stringify(dto) }),
  update: (id: string, dto: UpdateLinkInput) => api<LinkRow>(`/links/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  remove: (id: string) => api<{ id: string; deleted: boolean }>(`/links/${id}`, { method: 'DELETE' }),
}

export const Orders = {
  list: () => api<Paged<OrderRow>>('/orders'),
}

// ---- Notifications ----
export type NotificationRow = {
  id: string
  type: string
  title: string
  body: string | null
  data: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}
export const Notifications = {
  list: (unreadOnly = false, limit?: number) =>
    api<NotificationRow[]>(
      `/notifications${qs({ unreadOnly: unreadOnly ? 'true' : undefined, limit: limit != null ? String(limit) : undefined })}`,
    ),
  unreadCount: () => api<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api<NotificationRow>(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => api<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
}

export type NotificationSettingsData = { inAppEnabled: boolean; emailEnabled: boolean }
export const NotificationSettings = {
  get: () => api<NotificationSettingsData>('/settings/notifications'),
  update: (dto: NotificationSettingsData) =>
    api<NotificationSettingsData>('/settings/notifications', { method: 'PATCH', body: JSON.stringify(dto) }),
}
export const Commissions = {
  list: (status?: string) => api<Paged<CommissionRow>>(`/commissions${qs({ status })}`),
  approve: (id: string) => api(`/commissions/${id}/approve`, { method: 'POST' }),
  reverse: (id: string, reason: string) =>
    api(`/commissions/${id}/reverse`, { method: 'POST', body: JSON.stringify({ reason }) }),
}

// ---- Commission rules (global / store / category / product / affiliate) ----
export type RuleScope = 'global' | 'store' | 'category' | 'product' | 'campaign' | 'affiliate'
export type CommissionType = 'percentage' | 'fixed' | 'tiered' | 'recurring'
export type CommissionRule = {
  id: string
  scope: RuleScope
  scopeRefId: string | null
  type: CommissionType
  value: string
  priority: number
  stackable: boolean
  createdAt: string
}
export type CreateCommissionRule = {
  scope: RuleScope
  scopeRefId?: string
  type: CommissionType
  value: number
  priority?: number
  stackable?: boolean
}

export const CommissionRules = {
  list: () => api<CommissionRule[]>('/commission-rules'),
  create: (body: CreateCommissionRule) => api<CommissionRule>('/commission-rules', { method: 'POST', body: JSON.stringify(body) }),
  remove: (id: string) => api(`/commission-rules/${id}`, { method: 'DELETE' }),
}

// ---- Reports (admin analytics) ----
export type ReportRange = { days?: number; from?: string; to?: string }
export type ReportSummary = {
  revenue: number
  commissions: number
  activeAffiliates: number
  orders: number
  clicks: number
  attributedOrders: number
  aov: number
  conversionRate: number
  epc: number
  commissionRate: number
  range: { from: string; to: string; days: number }
}
export type TimePoint = {
  date: string
  revenue: number
  commissions: number
  orders?: number
  clicks?: number
}
export type TopAffiliate = {
  affiliateId: string
  affiliateCode: string
  total: number
  commissionCount?: number
  orders?: number
  revenue?: number
  clicks?: number
  epc?: number
  conversionRate?: number
}
export type StoreBreakdown = {
  storeId: string
  name: string
  platform: string
  domain: string
  revenue: number
  orders: number
  commissions: number
}
export type ProductBreakdown = {
  productId: string
  name: string
  sku: string | null
  categoryId: string | null
  storeId: string
  quantity: number
  revenue: number
  commissionAmount: number
}
export type CategoryBreakdown = {
  categoryId: string | null
  name: string
  quantity: number
  revenue: number
  commissionAmount: number
}

function reportQs(range: ReportRange = {}, extra: Record<string, string | number | undefined> = {}) {
  const p = new URLSearchParams()
  if (range.days != null) p.set('days', String(range.days))
  if (range.from) p.set('from', range.from)
  if (range.to) p.set('to', range.to)
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== '') p.set(k, String(v))
  }
  const q = p.toString()
  return q ? `?${q}` : ''
}

export type SourceBreakdown = {
  channel: string
  adNetwork: string | null
  source: string | null
  orders: number
  revenue: number
  attributedOrders: number
}

export const Reports = {
  summary: (range: ReportRange = { days: 30 }) =>
    api<ReportSummary>(`/reports/summary${reportQs(range)}`),
  timeseries: (range: ReportRange = { days: 30 }) =>
    api<TimePoint[]>(`/reports/timeseries${reportQs(range)}`),
  topAffiliates: (limit = 10, range: ReportRange = { days: 30 }) =>
    api<TopAffiliate[]>(`/reports/top-affiliates${reportQs(range, { limit })}`),
  byStore: (range: ReportRange = { days: 30 }) =>
    api<StoreBreakdown[]>(`/reports/by-store${reportQs(range)}`),
  byProduct: (limit = 10, range: ReportRange = { days: 30 }) =>
    api<ProductBreakdown[]>(`/reports/by-product${reportQs(range, { limit })}`),
  byCategory: (range: ReportRange = { days: 30 }) =>
    api<CategoryBreakdown[]>(`/reports/by-category${reportQs(range)}`),
  bySource: (range: ReportRange = { days: 30 }) =>
    api<SourceBreakdown[]>(`/reports/by-source${reportQs(range)}`),
}

/** Fetch a CSV export with auth and trigger a browser download. */
export async function downloadCsv(
  entity: 'commissions' | 'orders' | 'affiliates',
  range: ReportRange = {},
) {
  const res = await fetch(`${BASE}/reports/export${reportQs(range, { entity })}`, {
    credentials: 'include',
  })
  if (!res.ok) throw new Error('Export failed')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${entity}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

// ---- Affiliate portal (self-service) ----
export type PortalSummary = {
  affiliateCode: string
  referralSlug: string
  currency: string
  lifetimeEarnings: number
  availableBalance: number
  clicks: number
  conversions: number
  earned: number
  pending: number
  conversionRate: number
}
export type PortalLink = {
  id: string
  shortCode: string
  shortUrl: string
  destinationUrl: string
  clicksCount: number
  createdAt: string
}
export type CreatePortalLinkInput = {
  destinationUrl: string
  shortCode?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmContent?: string
  utmTerm?: string
}
export type PortalCoupon = {
  id: string
  code: string
  discountType: 'percentage' | 'fixed' | null
  status: 'active' | 'expired' | 'disabled'
  expiresAt: string | null
  createdAt: string
  store: { id: string; name: string; domain: string; platform: string }
  _count: { orders: number }
}

export const Portal = {
  summary: () => api<PortalSummary>('/portal/summary'),
  links: () => api<PortalLink[]>('/portal/links'),
  createLink: (dto: CreatePortalLinkInput) => api<PortalLink>('/portal/links', { method: 'POST', body: JSON.stringify(dto) }),
  deleteLink: (id: string) => api<{ id: string; deleted: boolean }>(`/portal/links/${id}`, { method: 'DELETE' }),
  coupons: () => api<PortalCoupon[]>('/portal/coupons'),
  orders: () => api<OrderRow[]>('/portal/orders'),
  commissions: () => api<CommissionRow[]>('/portal/commissions'),
  payouts: () => api<PayoutRow[]>('/portal/payouts'),
  requestPayout: (method: string, currency?: string) => api<{ id: string; amount: number; currency: string; status: string }>('/portal/payouts/request', { method: 'POST', body: JSON.stringify({ method, currency }) }),
  payoutMethods: () => api<PayoutMethodRecord[]>('/portal/payout-methods'),
  addPayoutMethod: (method: string, details: Record<string, string>) =>
    api<PayoutMethodRecord>('/portal/payout-methods', { method: 'POST', body: JSON.stringify({ method, details }) }),
  deletePayoutMethod: (id: string) => api('/portal/payout-methods/' + id, { method: 'DELETE' }),
  setDefaultPayoutMethod: (id: string) => api<PayoutMethodRecord>(`/portal/payout-methods/${id}/default`, { method: 'POST' }),
  tax: () => api<TaxStatus>('/portal/tax'),
  submitTax: (dto: TaxFormInput) => api<TaxStatus>('/portal/tax', { method: 'POST', body: JSON.stringify(dto) }),
}

// ---- Tax (1099 / W-9 / W-8BEN) ----
export type TaxFormType = 'w9' | 'w8ben'
export type TaxFormStatus = 'not_submitted' | 'submitted' | 'verified' | 'rejected'
export type TaxStatus = {
  status: TaxFormStatus
  required?: boolean
  formType?: TaxFormType | null
  tinLast4?: string | null
  certifiedAt?: string | null
  reviewNote?: string | null
  legalName?: string | null
  hasTin?: boolean
}
export type TaxFormInput = {
  formType: TaxFormType
  legalName: string
  businessName?: string
  taxClassification?: string
  tinType?: 'ssn' | 'ein'
  tin: string
  country: string
  address1: string
  address2?: string
  city: string
  state?: string
  postalCode?: string
  signature: string
  certify: boolean
}
export type TaxReportRow = {
  affiliateId: string
  affiliateCode: string
  name: string | null
  email?: string | null
  country: string | null
  formType: TaxFormType | null
  formStatus: TaxFormStatus
  tinLast4: string | null
  totalPaid: number
  needs1099: boolean
  missingForm: boolean
}
export type TaxReport = {
  year: number
  threshold: number
  currency?: string
  totalReportable: number
  missingForms: number
  rows: TaxReportRow[]
}
export type TaxAdminView = {
  affiliateId: string
  affiliateCode: string
  status: TaxFormStatus
  formType?: TaxFormType | null
  legalName?: string | null
  tinLast4?: string | null
  certifiedAt?: string | null
  reviewNote?: string | null
  hasTin?: boolean
}
export type TaxSettingsData = { required: boolean; threshold: number }
export const Tax = {
  get: (affiliateId: string) => api<TaxAdminView>(`/tax/affiliates/${affiliateId}`),
  revealTin: (affiliateId: string) => api<{ tin: string; tinType: string | null; legalName: string }>(`/tax/affiliates/${affiliateId}/tin`),
  verify: (affiliateId: string) => api(`/tax/affiliates/${affiliateId}/verify`, { method: 'POST' }),
  reject: (affiliateId: string, note?: string) => api(`/tax/affiliates/${affiliateId}/reject`, { method: 'POST', body: JSON.stringify({ note }) }),
  report: (year?: number) => api<TaxReport>(`/tax/report${year ? `?year=${year}` : ''}`),
  settings: () => api<TaxSettingsData>('/tax/settings'),
  updateSettings: (dto: TaxSettingsData) => api<TaxSettingsData>('/tax/settings', { method: 'PATCH', body: JSON.stringify(dto) }),
}

// ---- Payouts (admin) ----
export type PayoutRow = {
  id: string
  affiliateId: string
  affiliate?: { affiliateCode: string }
  amount: number
  currency: string
  method: string
  status: string
  transactionReference?: string | null
  createdAt: string
  _count?: { items: number }
}
export type PayoutMethodRecord = { id: string; method: string; isDefault: boolean }

// ---- Audit log ----
export type AuditEntry = {
  id: string
  action: string
  resourceType?: string | null
  resourceId?: string | null
  userId?: string | null
  createdAt: string
}

export const Audit = {
  list: (limit = 100) => api<AuditEntry[]>(`/audit?limit=${limit}`),
}

// ---- Affiliate applications ----
export type ApplicationRow = {
  id: string
  email: string
  status: 'pending' | 'approved' | 'rejected'
  payload: Record<string, string> | null
  createdAt: string
}

export const Applications = {
  list: (status?: string) => api<ApplicationRow[]>(`/applications${status ? `?status=${status}` : ''}`),
  approve: (id: string) => api(`/applications/${id}/approve`, { method: 'POST' }),
  reject: (id: string) => api(`/applications/${id}/reject`, { method: 'POST' }),
}

// ---- Signup settings ----
export type SignupBranding = {
  headline: string | null
  subheadline: string | null
  imageUrl: string | null
  accentColor: string
  layout: 'split' | 'centered'
  buttonText: string
}
export type EmbedBranding = SignupBranding & { custom: boolean }
export type SignupSettingsData = {
  signupEnabled: boolean
  autoApprove: boolean
  requireWebsite: boolean
  allowAffiliateLinkCreation: boolean
  branding?: SignupBranding
  embedBranding?: EmbedBranding
  slug?: string
  orgName?: string
}
export type SignupSettingsUpdate = {
  signupEnabled: boolean
  autoApprove: boolean
  requireWebsite?: boolean
  allowAffiliateLinkCreation?: boolean
  headline?: string
  subheadline?: string
  imageUrl?: string
  accentColor?: string
  layout?: 'split' | 'centered'
  buttonText?: string
  // Embed branding (independent design for the iframe embed)
  embedCustom?: boolean
  embedHeadline?: string
  embedSubheadline?: string
  embedImageUrl?: string
  embedAccentColor?: string
  embedLayout?: 'split' | 'centered'
  embedButtonText?: string
}

export const SignupSettings = {
  get: () => api<SignupSettingsData>('/settings/signup'),
  update: (dto: SignupSettingsUpdate) =>
    api<SignupSettingsData>('/settings/signup', { method: 'PATCH', body: JSON.stringify(dto) }),
}

// ---- Sub-affiliate (multi-tier) settings ----
export type SubAffiliateSettingsData = {
  subAffiliateEnabled: boolean
  subAffiliateRate: number
  subAffiliateMaxDepth: number
  subAffiliateDecay: number
}

export const SubAffiliateSettings = {
  get: () => api<SubAffiliateSettingsData>('/settings/sub-affiliate'),
  update: (dto: SubAffiliateSettingsData) =>
    api<SubAffiliateSettingsData>('/settings/sub-affiliate', { method: 'PATCH', body: JSON.stringify(dto) }),
}

export type CommissionChannelSettingsData = {
  enabled: boolean
  codeOrganicRate: number | null
  codePaidRate: number | null
  linkOrganicRate: number | null
  linkPaidRate: number | null
}

export const CommissionChannelSettings = {
  get: () => api<CommissionChannelSettingsData>('/settings/commission-channel'),
  update: (dto: Partial<CommissionChannelSettingsData>) =>
    api<CommissionChannelSettingsData>('/settings/commission-channel', { method: 'PATCH', body: JSON.stringify(dto) }),
}

export type CustomerTypeSettingsData = {
  enabled: boolean
  newCustomerRate: number | null
  returningCustomerRate: number | null
}

export const CustomerTypeSettings = {
  get: () => api<CustomerTypeSettingsData>('/settings/customer-type'),
  update: (dto: Partial<CustomerTypeSettingsData>) =>
    api<CustomerTypeSettingsData>('/settings/customer-type', { method: 'PATCH', body: JSON.stringify(dto) }),
}

// ---- API Keys ----
export type ApiKeyRow = {
  id: string
  name: string
  scopes: string[]
  lastUsedAt: string | null
  createdAt: string
}
export type ApiKeyCreated = ApiKeyRow & { key: string }

export const ApiKeys = {
  list: () => api<ApiKeyRow[]>('/api-keys'),
  create: (dto: { name: string; scopes?: string[] }) =>
    api<ApiKeyCreated>('/api-keys', { method: 'POST', body: JSON.stringify(dto) }),
  revoke: (id: string) => api(`/api-keys/${id}`, { method: 'DELETE' }),
}

export const Payouts = {
  list: (status?: string) => api<PayoutRow[]>(`/payouts${qs({ status })}`),
  findOne: (id: string) => api<PayoutRow>(`/payouts/${id}`),
  createBatch: (affiliateId: string, method: string, currency = 'USD') =>
    api<PayoutRow>('/payouts/batch', { method: 'POST', body: JSON.stringify({ affiliateId, method, currency }) }),
  approve: (id: string) => api(`/payouts/${id}/approve`, { method: 'PATCH' }),
  process: (id: string) =>
    api<{ id: string; status: string; reference: string | null; provider: string }>(`/payouts/${id}/process`, { method: 'POST' }),
  markPaid: (id: string, ref?: string) =>
    api(`/payouts/${id}/mark-paid`, { method: 'PATCH', body: JSON.stringify({ transactionReference: ref }) }),
  fail: (id: string) => api(`/payouts/${id}/fail`, { method: 'PATCH' }),
}

// ---- Fraud scoring + review queue ----
export type FraudSettings = {
  reviewThreshold: number
  blockThreshold: number
  orderVelocityLimit: number
  orderVelocityWindowHours: number
  ipVelocityLimit: number
  ipVelocityWindowMinutes: number
  allowlistAffiliateIds: string[]
}
export type FraudReview = {
  id: string
  score: number
  decision: 'allow' | 'review' | 'block'
  status: 'open' | 'approved' | 'rejected'
  reasons: string[]
  notes?: string | null
  createdAt: string
  reviewedAt?: string | null
  order?: { id: string; externalOrderId: string; total: string | number; currency: string; status: string }
  affiliate?: { id: string; affiliateCode: string; referralSlug: string; status: string }
}
export const Fraud = {
  settings: () => api<FraudSettings>('/fraud/settings'),
  updateSettings: (body: Partial<FraudSettings>) =>
    api<FraudSettings>('/fraud/settings', { method: 'PATCH', body: JSON.stringify(body) }),
  reviews: (status?: string) =>
    api<FraudReview[]>(`/fraud/reviews${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  approve: (id: string, notes?: string) =>
    api(`/fraud/reviews/${id}/approve`, { method: 'POST', body: JSON.stringify({ notes }) }),
  reject: (id: string, notes?: string) =>
    api(`/fraud/reviews/${id}/reject`, { method: 'POST', body: JSON.stringify({ notes }) }),
}

// ---- Attribution models ----
export type CookieModel = 'last_click' | 'first_click' | 'linear' | 'position'
export type CouponProtectionMode = 'off' | 'flag' | 'block'
export type CouponProtection = {
  mode: CouponProtectionMode
  requireClickSupport: boolean
  blockedReferrers: string[]
}
export type AttributionSettingsData = {
  cookieModel: CookieModel
  cookieWindowDays: number
  couponPriority: boolean
  lifetimeEnabled: boolean
  couponProtection: CouponProtection
}
export const AttributionSettings = {
  get: () => api<AttributionSettingsData>('/settings/attribution'),
  update: (dto: Partial<AttributionSettingsData>) =>
    api<AttributionSettingsData>('/settings/attribution', { method: 'PATCH', body: JSON.stringify(dto) }),
}

// ---- Plans, entitlements & super-admin (enterprise layer) ----
export type Plan = {
  id: string
  key: string
  name: string
  description?: string | null
  priceCents: number
  currency: string
  interval: 'month' | 'year'
  features: Record<string, boolean>
  limits: Record<string, number>
  isPublic: boolean
  isArchived: boolean
  sortOrder: number
  trialDays: number
  _count?: { subscriptions: number }
}
export type EntitlementContext = {
  planKey: string | null
  planName: string | null
  status: string | null
  features: Record<string, boolean>
  limits: Record<string, number>
  usage: Record<string, number>
  currentPeriodEnd: string | null
  trialEndsAt: string | null
}
export const Entitlements = {
  me: () => api<EntitlementContext>('/entitlements'),
}
export const Plans = {
  listPublic: () => api<Plan[]>('/plans'),
}

export type Tenant = {
  id: string
  name: string
  slug: string
  status: string
  createdAt: string
  plan: { id: string; key: string; name: string } | null
  subscriptionStatus: string | null
  counts: { users: number; affiliates: number; stores: number }
}
export type PlatformOverview = {
  totalOrgs: number
  activeOrgs: number
  suspendedOrgs: number
  totalUsers: number
  totalAffiliates: number
  activeSubscriptions: number
  mrrCents: number
  planDistribution: Array<{ key: string; name: string; subscribers: number }>
}

// ---- Branding (white-label) ----
export type BrandingData = {
  companyName: string | null
  logoUrl: string | null
  faviconUrl: string | null
  primaryColor: string
  accentColor: string
  loginHeadline: string | null
  supportEmail: string | null
  hidePlatformBranding: boolean
}
export type EmailTemplate = {
  key: string
  label: string
  description: string
  variables: string[]
  subject: string
  heading: string
  body: string
  defaultSubject: string
  defaultHeading: string
  defaultBody: string
  isCustomized: boolean
}
export const EmailTemplates = {
  list: () => api<EmailTemplate[]>('/email-templates'),
  update: (key: string, body: { subject?: string; heading?: string; body?: string }) =>
    api<EmailTemplate[]>(`/email-templates/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(body) }),
  reset: (key: string) =>
    api<EmailTemplate[]>(`/email-templates/${encodeURIComponent(key)}/reset`, { method: 'POST' }),
  preview: (key: string) =>
    api<{ subject: string; html: string }>(`/email-templates/${encodeURIComponent(key)}/preview`, { method: 'POST' }),
}
export const Branding = {
  get: () => api<BrandingData>('/branding'),
  update: (body: Partial<BrandingData>) =>
    api<BrandingData>('/branding', { method: 'PATCH', body: JSON.stringify(body) }),
  resolvePublic: (params: { hostname?: string; slug?: string }) =>
    api<(BrandingData & { organizationId: string; slug: string }) | null>(`/public/branding${qs(params)}`),
}

// ---- Custom domains ----
export type DomainInstructions = {
  cname: { host: string; target: string }
  txt: { host: string; value: string }
}
export type DomainPurpose = 'login' | 'tracking'
export type CustomDomain = {
  id: string
  organizationId: string
  hostname: string
  status: 'pending' | 'verifying' | 'active' | 'failed'
  purpose: DomainPurpose
  verificationToken: string
  isPrimary: boolean
  lastCheckedAt?: string | null
  verifiedAt?: string | null
  createdAt: string
  instructions: DomainInstructions
}
export type TrackingBase = { baseUrl: string; custom: boolean; organizationId: string }
export const Domains = {
  list: () => api<CustomDomain[]>('/domains'),
  add: (hostname: string, purpose: DomainPurpose = 'login') =>
    api<CustomDomain>('/domains', { method: 'POST', body: JSON.stringify({ hostname, purpose }) }),
  verify: (id: string) => api<CustomDomain>(`/domains/${id}/verify`, { method: 'POST' }),
  setPrimary: (id: string) => api<CustomDomain>(`/domains/${id}/primary`, { method: 'POST' }),
  remove: (id: string) => api(`/domains/${id}`, { method: 'DELETE' }),
  trackingBase: () => api<TrackingBase>('/domains/tracking-base'),
}

// ---- Super-admin (platform owner console) ----
export type FeatureKey =
  | 'apiAccess' | 'webhooks' | 'fraudTools' | 'multiTierCommissions'
  | 'advancedReports' | 'bulkOperations' | 'branding' | 'customDomain' | 'prioritySupport'
  | 'enterpriseSso'
export type LimitKey =
  | 'affiliates' | 'stores' | 'teamMembers' | 'apiKeys'
  | 'trackingLinksPerAffiliate' | 'monthlyPayoutRequestsPerAffiliate'

export const FEATURE_CATALOG: { key: FeatureKey; label: string }[] = [
  { key: 'apiAccess', label: 'API access' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'fraudTools', label: 'Fraud detection & review queue' },
  { key: 'multiTierCommissions', label: 'Multi-tier commissions' },
  { key: 'advancedReports', label: 'Advanced reports & analytics' },
  { key: 'bulkOperations', label: 'Bulk import / export' },
  { key: 'branding', label: 'Custom branding (white-label)' },
  { key: 'customDomain', label: 'Custom login domain' },
  { key: 'enterpriseSso', label: 'Enterprise SSO (OIDC)' },
  { key: 'prioritySupport', label: 'Priority support' },
]
export const LIMIT_CATALOG: { key: LimitKey; label: string }[] = [
  { key: 'affiliates', label: 'Affiliates' },
  { key: 'stores', label: 'Connected stores' },
  { key: 'teamMembers', label: 'Team members' },
  { key: 'apiKeys', label: 'API keys' },
  { key: 'trackingLinksPerAffiliate', label: 'Tracking links / affiliate' },
  { key: 'monthlyPayoutRequestsPerAffiliate', label: 'Payout requests / affiliate / month' },
]

export type AdminOverview = {
  totalOrgs: number
  activeOrgs: number
  suspendedOrgs: number
  totalUsers: number
  totalAffiliates: number
  activeSubscriptions: number
  mrrCents: number
  planDistribution: { key: string; name: string; subscribers: number }[]
}

export type AdminPlan = {
  id: string
  key: string
  name: string
  description: string | null
  priceCents: number
  currency: string
  interval: 'month' | 'year'
  features: Record<string, boolean>
  limits: Record<string, number>
  isPublic: boolean
  isArchived: boolean
  sortOrder: number
  trialDays: number
  _count?: { subscriptions: number }
}

export type AdminTenant = {
  id: string
  name: string
  slug: string
  status: string
  createdAt: string
  plan: { id: string; key: string; name: string } | null
  subscriptionStatus: string | null
  counts: { users: number; affiliates: number; stores: number }
}

export type AdminTenantDetail = {
  id: string
  name: string
  slug: string
  status: string
  plan: string | null
  createdAt: string
  subscription: (null | { id: string; status: string; seats: number; plan: AdminPlan }) & Record<string, any>
  _count: { users: number; affiliates: number; stores: number; apiKeys: number }
  entitlements: EntitlementContext
  usage: Record<string, number>
}

export type CreateTenantInput = {
  name: string
  slug: string
  ownerEmail: string
  ownerName?: string
  planId?: string
  defaultCurrency?: string
  status?: 'active' | 'trial'
  sendLoginCode?: boolean
}

export type CreatePlanInput = {
  key: string
  name: string
  description?: string
  priceCents: number
  currency?: string
  interval?: 'month' | 'year'
  features: Record<string, boolean>
  limits: Record<string, number>
  isPublic?: boolean
  sortOrder?: number
  trialDays?: number
}
export type UpdatePlanInput = Partial<Omit<CreatePlanInput, 'key'>> & { isArchived?: boolean }

export const SuperAdmin = {
  overview: () => api<AdminOverview>('/admin/overview'),
  // plans
  plans: () => api<AdminPlan[]>('/admin/plans'),
  createPlan: (dto: CreatePlanInput) => api<AdminPlan>('/admin/plans', { method: 'POST', body: JSON.stringify(dto) }),
  updatePlan: (id: string, dto: UpdatePlanInput) => api<AdminPlan>(`/admin/plans/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deletePlan: (id: string) => api<{ archived: boolean; deleted?: boolean }>(`/admin/plans/${id}`, { method: 'DELETE' }),
  // tenants
  tenants: (search?: string) => api<AdminTenant[]>(`/admin/tenants${qs({ search })}`),
  createTenant: (dto: CreateTenantInput) => api<AdminTenant & { owner: { id: string; email: string; fullName?: string | null }; loginCodeSent: boolean; loginCodeWarning?: string | null }>('/admin/tenants', {
    method: 'POST',
    body: JSON.stringify(dto),
  }),
  tenant: (id: string) => api<AdminTenantDetail>(`/admin/tenants/${id}`),
  assignPlan: (id: string, dto: { planId: string; status?: string; seats?: number; overrides?: { features?: Record<string, boolean>; limits?: Record<string, number> } }) =>
    api(`/admin/tenants/${id}/plan`, { method: 'PATCH', body: JSON.stringify(dto) }),
  setStatus: (id: string, status: 'active' | 'suspended' | 'trial') =>
    api(`/admin/tenants/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
}

// ---- Billing & Payment Gateways (super-admin) ----
export type GatewayProviderKey = 'whop' | 'swich'

export type GatewayConfig = {
  id: string
  scope: 'platform' | 'tenant'
  organizationId: string | null
  provider: GatewayProviderKey
  label: string | null
  companyId: string | null
  hasApiKey: boolean
  hasWebhookSecret: boolean
  isLive: boolean
  isActive: boolean
  isDefault: boolean
  taxEnabled: boolean
  taxPercent: number
  taxLabel: string | null
  taxInclusive: boolean
  webhookUrl: string
  createdAt: string
  updatedAt: string
}

export type UpsertGatewayConfigInput = {
  provider: GatewayProviderKey
  scope?: 'platform' | 'tenant'
  organizationId?: string
  label?: string
  companyId?: string
  apiKey?: string
  webhookSecret?: string
  isLive?: boolean
  isActive?: boolean
  isDefault?: boolean
  taxEnabled?: boolean
  taxPercent?: number
  taxLabel?: string
  taxInclusive?: boolean
}

export type BillingInvoice = {
  id: string
  organizationId: string
  provider: GatewayProviderKey
  number: string | null
  status: string
  currency: string
  subtotalCents: number
  taxCents: number
  totalCents: number
  hostedUrl: string | null
  paidAt: string | null
  createdAt: string
}

// Catalog for rendering the gateway picker / help text in the UI.
export const GATEWAY_CATALOG: Array<{
  key: GatewayProviderKey
  name: string
  blurb: string
  region: string
  supportsPayouts: boolean
  credentials: string[]
}> = [
  {
    key: 'whop',
    name: 'Whop',
    blurb: 'Stripe-like Merchant of Record: saved cards, off-session charges, hosted invoices & receipts, taxes, subscriptions.',
    region: 'Global (USD)',
    supportsPayouts: true,
    credentials: ['Company ID (biz_...)', 'API key', 'Webhook secret (whsec_...)'],
  },
  {
    key: 'swich',
    name: 'Swich',
    blurb: 'Pakistani gateway: cards, JazzCash/Easypaisa, Raast QR, 1LINK bank transfer, plus payouts/disbursements.',
    region: 'Pakistan (PKR)',
    supportsPayouts: true,
    credentials: ['Company / Merchant ID', 'API key', 'Webhook secret'],
  },
]

export const Billing = {
  configs: (scope: 'platform' | 'tenant' = 'platform', organizationId?: string) =>
    api<GatewayConfig[]>(`/billing/config${qs({ scope, organizationId })}`),
  getConfig: (id: string) => api<GatewayConfig>(`/billing/config/${id}`),
  createConfig: (dto: UpsertGatewayConfigInput) =>
    api<GatewayConfig>('/billing/config', { method: 'POST', body: JSON.stringify(dto) }),
  updateConfig: (id: string, dto: UpsertGatewayConfigInput) =>
    api<GatewayConfig>(`/billing/config/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteConfig: (id: string) => api<{ deleted: boolean }>(`/billing/config/${id}`, { method: 'DELETE' }),
  startSetup: (orgId: string, dto: { configId?: string; provider?: GatewayProviderKey; returnUrl?: string }) =>
    api<{ url: string | null; sessionId: string; provider: GatewayProviderKey }>(`/billing/tenants/${orgId}/setup`, { method: 'POST', body: JSON.stringify(dto) }),
  charge: (orgId: string, dto: { amountCents: number; currency?: string; description?: string; recurring?: boolean; autoCharge?: boolean }) =>
    api(`/billing/tenants/${orgId}/charge`, { method: 'POST', body: JSON.stringify(dto) }),
  startSubscription: (orgId: string, dto: { planId: string; trialDaysOverride?: number; configId?: string; returnUrl?: string }) =>
    api(`/billing/tenants/${orgId}/subscription`, { method: 'POST', body: JSON.stringify(dto) }),
  tenantInvoices: (orgId: string) => api<BillingInvoice[]>(`/billing/tenants/${orgId}/invoices`),
  invoices: () => api<BillingInvoice[]>('/billing/invoices'),
  createPayout: (dto: { configId: string; amountCents: number; currency?: string; destination: Record<string, unknown>; reference?: string; purpose?: string }) =>
    api('/billing/payouts', { method: 'POST', body: JSON.stringify(dto) }),
  runCycle: () => api('/billing/run-cycle', { method: 'POST' }),
}

// Tenant-facing gateways: a merchant manages + uses their OWN Whop / Swich
// accounts (scope = 'tenant'), e.g. to pay affiliate payouts through Swich.
export const TenantBilling = {
  configs: () => api<GatewayConfig[]>('/tenant-billing/config'),
  getConfig: (id: string) => api<GatewayConfig>(`/tenant-billing/config/${id}`),
  createConfig: (dto: UpsertGatewayConfigInput) =>
    api<GatewayConfig>('/tenant-billing/config', { method: 'POST', body: JSON.stringify(dto) }),
  updateConfig: (id: string, dto: UpsertGatewayConfigInput) =>
    api<GatewayConfig>(`/tenant-billing/config/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),
  deleteConfig: (id: string) => api<{ deleted: boolean }>(`/tenant-billing/config/${id}`, { method: 'DELETE' }),
  createPayout: (dto: { configId: string; amountCents: number; currency?: string; destination: Record<string, unknown>; reference?: string; purpose?: string }) =>
    api<{ id: string; status: string; provider: GatewayProviderKey }>('/tenant-billing/payouts', { method: 'POST', body: JSON.stringify(dto) }),
}
