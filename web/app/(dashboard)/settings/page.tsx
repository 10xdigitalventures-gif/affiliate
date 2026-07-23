'use client'
import { useState, useEffect } from 'react'
import { Audit, SignupSettings, SubAffiliateSettings, CommissionChannelSettings, CustomerTypeSettings, AttributionSettings, NotificationSettings, ApiKeys, Bulk, Auth, TwoFactor, Sso, Tax } from '@/lib/api'
import type { ImportResult, BulkExportEntity } from '@/lib/api'
import { useFetch, shortDate } from '@/lib/use-fetch'
import { PageHeader } from '@/components/ui/page-header'
import { Card } from '@/components/ui/card'
import { FilterTabs } from '@/components/ui/filter-tabs'
import { DataTable, Column } from '@/components/ui/data-table'
import { Button } from '@/components/ui/button'
import type { AuditEntry, ApiKeyRow, ApiKeyCreated } from '@/lib/api'

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-line last:border-0">
      <div>
        <p className="text-sm font-medium text-ink">{label}</p>
        {hint && <p className="text-xs text-muted mt-0.5">{hint}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? 'bg-brand' : 'bg-gray-200'
        }`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`} />
      </button>
    </div>
  )
}

const SCOPES = ['orders.write', 'orders.read', 'affiliates.read', 'reports.read']

export default function SettingsPage() {
  // --- Audit ---
  const [limit, setLimit] = useState('100')
  const { data: auditData, loading: auditLoading } = useFetch(() => Audit.list(Number(limit)), [limit])

  // --- Signup settings ---
  const [signupEnabled, setSignupEnabled] = useState(true)
  const [autoApprove, setAutoApprove] = useState(false)
  const [requireWebsite, setRequireWebsite] = useState(false)
  const [allowAffiliateLinkCreation, setAllowAffiliateLinkCreation] = useState(true)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [settingsSaved, setSettingsSaved] = useState(false)
  // Public sign-up page branding + embed
  const [orgSlug, setOrgSlug] = useState('')
  const [brandHeadline, setBrandHeadline] = useState('')
  const [brandSub, setBrandSub] = useState('')
  const [brandImage, setBrandImage] = useState('')
  const [brandAccent, setBrandAccent] = useState('#1B4DFF')
  const [brandLayout, setBrandLayout] = useState<'split' | 'centered'>('split')
  const [brandButton, setBrandButton] = useState('Apply now')
  // Embed — optional independent branding (same fields, own design)
  const [embedCustom, setEmbedCustom] = useState(false)
  const [embedHeadline, setEmbedHeadline] = useState('')
  const [embedSub, setEmbedSub] = useState('')
  const [embedImage, setEmbedImage] = useState('')
  const [embedAccent, setEmbedAccent] = useState('#1B4DFF')
  const [embedLayout, setEmbedLayout] = useState<'split' | 'centered'>('centered')
  const [embedButton, setEmbedButton] = useState('Apply now')
  const [copied, setCopied] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const applyUrl = orgSlug ? `${origin}/apply/${orgSlug}` : ''
  const embedUrl = orgSlug ? `${origin}/embed/${orgSlug}` : ''
  const iframeSnippet = embedUrl
    ? `<iframe src="${embedUrl}" style="width:100%;max-width:520px;border:0;min-height:560px;" title="Affiliate sign-up"></iframe>`
    : ''
  const iframeAutoResize = embedUrl
    ? `<iframe id="affiliate-signup" src="${embedUrl}" style="width:100%;max-width:520px;border:0;min-height:560px;" title="Affiliate sign-up"></iframe>\n<script>\n  window.addEventListener('message', function (e) {\n    if (e.data && e.data.type === 'affiliate-embed' && e.data.event === 'resize') {\n      var f = document.getElementById('affiliate-signup');\n      if (f) f.style.height = e.data.height + 'px';\n    }\n  });\n</script>`
    : ''

  function copy(text: string, id: string) {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(null), 2000)
  }

  useEffect(() => {
    SignupSettings.get().then((s) => {
      setSignupEnabled(s.signupEnabled)
      setAutoApprove(s.autoApprove)
      setRequireWebsite(s.requireWebsite ?? false)
      setAllowAffiliateLinkCreation(s.allowAffiliateLinkCreation ?? true)
      if (s.slug) setOrgSlug(s.slug)
      if (s.branding) {
        setBrandHeadline(s.branding.headline ?? '')
        setBrandSub(s.branding.subheadline ?? '')
        setBrandImage(s.branding.imageUrl ?? '')
        setBrandAccent(s.branding.accentColor ?? '#1B4DFF')
        setBrandLayout(s.branding.layout ?? 'split')
        setBrandButton(s.branding.buttonText ?? 'Apply now')
      }
      if (s.embedBranding) {
        setEmbedCustom(s.embedBranding.custom ?? false)
        setEmbedHeadline(s.embedBranding.headline ?? '')
        setEmbedSub(s.embedBranding.subheadline ?? '')
        setEmbedImage(s.embedBranding.imageUrl ?? '')
        setEmbedAccent(s.embedBranding.accentColor ?? '#1B4DFF')
        setEmbedLayout(s.embedBranding.layout ?? 'centered')
        setEmbedButton(s.embedBranding.buttonText ?? 'Apply now')
      }
      setSettingsLoaded(true)
    }).catch(() => setSettingsLoaded(true))
  }, [])

  async function saveSettings() {
    setSettingsBusy(true)
    setSettingsSaved(false)
    try {
      await SignupSettings.update({
        signupEnabled,
        autoApprove,
        requireWebsite,
        allowAffiliateLinkCreation,
        headline: brandHeadline,
        subheadline: brandSub,
        imageUrl: brandImage,
        accentColor: brandAccent,
        layout: brandLayout,
        buttonText: brandButton,
        embedCustom,
        embedHeadline,
        embedSubheadline: embedSub,
        embedImageUrl: embedImage,
        embedAccentColor: embedAccent,
        embedLayout,
        embedButtonText: embedButton,
      })
      setSettingsSaved(true)
      setTimeout(() => setSettingsSaved(false), 2500)
    } finally { setSettingsBusy(false) }
  }

  // --- Sub-affiliate (multi-tier) settings ---
  const [subEnabled, setSubEnabled] = useState(false)
  const [subRate, setSubRate] = useState(10)
  const [subDepth, setSubDepth] = useState(1)
  const [subDecay, setSubDecay] = useState(1)
  const [subBusy, setSubBusy] = useState(false)
  const [subLoaded, setSubLoaded] = useState(false)
  const [subSaved, setSubSaved] = useState(false)

  useEffect(() => {
    SubAffiliateSettings.get().then((s) => {
      setSubEnabled(s.subAffiliateEnabled)
      setSubRate(s.subAffiliateRate)
      setSubDepth(s.subAffiliateMaxDepth)
      setSubDecay(s.subAffiliateDecay)
      setSubLoaded(true)
    }).catch(() => setSubLoaded(true))
  }, [])

  async function saveSubSettings() {
    setSubBusy(true)
    setSubSaved(false)
    try {
      await SubAffiliateSettings.update({
        subAffiliateEnabled: subEnabled,
        subAffiliateRate: Number(subRate),
        subAffiliateMaxDepth: Number(subDepth),
        subAffiliateDecay: Number(subDecay),
      })
      setSubSaved(true)
      setTimeout(() => setSubSaved(false), 2500)
    } finally { setSubBusy(false) }
  }

  // --- Source-based commission (paid vs organic + coupon code) ---
  const [ccEnabled, setCcEnabled] = useState(false)
  const [ccCodeOrganic, setCcCodeOrganic] = useState<number | ''>(10)
  const [ccCodePaid, setCcCodePaid] = useState<number | ''>(5)
  const [ccLinkOrganic, setCcLinkOrganic] = useState<number | ''>('')
  const [ccLinkPaid, setCcLinkPaid] = useState<number | ''>('')
  const [ccBusy, setCcBusy] = useState(false)
  const [ccLoaded, setCcLoaded] = useState(false)
  const [ccSaved, setCcSaved] = useState(false)

  useEffect(() => {
    CommissionChannelSettings.get().then((s) => {
      setCcEnabled(s.enabled)
      setCcCodeOrganic(s.codeOrganicRate ?? '')
      setCcCodePaid(s.codePaidRate ?? '')
      setCcLinkOrganic(s.linkOrganicRate ?? '')
      setCcLinkPaid(s.linkPaidRate ?? '')
      setCcLoaded(true)
    }).catch(() => setCcLoaded(true))
  }, [])

  async function saveCcSettings() {
    setCcBusy(true)
    setCcSaved(false)
    try {
      await CommissionChannelSettings.update({
        enabled: ccEnabled,
        codeOrganicRate: ccCodeOrganic === '' ? undefined : Number(ccCodeOrganic),
        codePaidRate: ccCodePaid === '' ? undefined : Number(ccCodePaid),
        linkOrganicRate: ccLinkOrganic === '' ? undefined : Number(ccLinkOrganic),
        linkPaidRate: ccLinkPaid === '' ? undefined : Number(ccLinkPaid),
      })
      setCcSaved(true)
      setTimeout(() => setCcSaved(false), 2500)
    } finally { setCcBusy(false) }
  }

  // --- New-vs-returning customer commission ---
  const [ctEnabled, setCtEnabled] = useState(false)
  const [ctNewRate, setCtNewRate] = useState<number | ''>(15)
  const [ctReturningRate, setCtReturningRate] = useState<number | ''>(5)
  const [ctBusy, setCtBusy] = useState(false)
  const [ctLoaded, setCtLoaded] = useState(false)
  const [ctSaved, setCtSaved] = useState(false)

  useEffect(() => {
    CustomerTypeSettings.get().then((s) => {
      setCtEnabled(s.enabled)
      setCtNewRate(s.newCustomerRate ?? '')
      setCtReturningRate(s.returningCustomerRate ?? '')
      setCtLoaded(true)
    }).catch(() => setCtLoaded(true))
  }, [])

  async function saveCtSettings() {
    setCtBusy(true)
    setCtSaved(false)
    try {
      await CustomerTypeSettings.update({
        enabled: ctEnabled,
        newCustomerRate: ctNewRate === '' ? undefined : Number(ctNewRate),
        returningCustomerRate: ctReturningRate === '' ? undefined : Number(ctReturningRate),
      })
      setCtSaved(true)
      setTimeout(() => setCtSaved(false), 2500)
    } finally { setCtBusy(false) }
  }

  // --- Attribution model settings ---
  const [cookieModel, setCookieModel] = useState<'last_click' | 'first_click' | 'linear' | 'position'>('last_click')
  const [cookieWindowDays, setCookieWindowDays] = useState(60)
  const [couponPriority, setCouponPriority] = useState(true)
  const [lifetimeEnabled, setLifetimeEnabled] = useState(true)
  const [couponMode, setCouponMode] = useState<'off' | 'flag' | 'block'>('flag')
  const [requireClickSupport, setRequireClickSupport] = useState(false)
  const [blockedReferrers, setBlockedReferrers] = useState('')
  const [attrBusy, setAttrBusy] = useState(false)
  const [attrLoaded, setAttrLoaded] = useState(false)
  const [attrSaved, setAttrSaved] = useState(false)

  useEffect(() => {
    AttributionSettings.get().then((s) => {
      setCookieModel(s.cookieModel)
      setCookieWindowDays(s.cookieWindowDays)
      setCouponPriority(s.couponPriority)
      setLifetimeEnabled(s.lifetimeEnabled)
      setCouponMode(s.couponProtection?.mode ?? 'flag')
      setRequireClickSupport(s.couponProtection?.requireClickSupport ?? false)
      setBlockedReferrers((s.couponProtection?.blockedReferrers ?? []).join('\n'))
      setAttrLoaded(true)
    }).catch(() => setAttrLoaded(true))
  }, [])

  async function saveAttrSettings() {
    setAttrBusy(true)
    setAttrSaved(false)
    try {
      await AttributionSettings.update({
        cookieModel,
        cookieWindowDays: Number(cookieWindowDays),
        couponPriority,
        lifetimeEnabled,
        couponProtection: {
          mode: couponMode,
          requireClickSupport,
          blockedReferrers: blockedReferrers
            .split(/[\n,]/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean),
        },
      })
      setAttrSaved(true)
      setTimeout(() => setAttrSaved(false), 2500)
    } finally { setAttrBusy(false) }
  }

  // --- Notification settings ---
  const [inAppEnabled, setInAppEnabled] = useState(true)
  const [emailEnabled, setEmailEnabled] = useState(true)
  const [notifBusy, setNotifBusy] = useState(false)
  const [notifLoaded, setNotifLoaded] = useState(false)
  const [notifSaved, setNotifSaved] = useState(false)

  useEffect(() => {
    NotificationSettings.get().then((s) => {
      setInAppEnabled(s.inAppEnabled)
      setEmailEnabled(s.emailEnabled)
      setNotifLoaded(true)
    }).catch(() => setNotifLoaded(true))
  }, [])

  async function saveNotifSettings() {
    setNotifBusy(true)
    setNotifSaved(false)
    try {
      await NotificationSettings.update({ inAppEnabled, emailEnabled })
      setNotifSaved(true)
      setTimeout(() => setNotifSaved(false), 2500)
    } finally { setNotifBusy(false) }
  }

  // --- Security: two-factor authentication ---
  const [twoFaEnabled, setTwoFaEnabled] = useState<boolean | null>(null)
  const [twoFaSetup, setTwoFaSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [twoFaCode, setTwoFaCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [twoFaBusy, setTwoFaBusy] = useState(false)
  const [twoFaError, setTwoFaError] = useState<string | null>(null)

  useEffect(() => {
    Auth.me().then((m: any) => setTwoFaEnabled(!!m.twoFactorEnabled)).catch(() => setTwoFaEnabled(false))
  }, [])

  async function startTwoFaSetup() {
    setTwoFaBusy(true); setTwoFaError(null); setRecoveryCodes(null)
    try {
      const s = await TwoFactor.setup()
      setTwoFaSetup(s)
    } catch (e) { setTwoFaError((e as Error).message) }
    finally { setTwoFaBusy(false) }
  }

  async function confirmTwoFa() {
    setTwoFaBusy(true); setTwoFaError(null)
    try {
      const res = await TwoFactor.enable(twoFaCode.trim())
      setRecoveryCodes(res.recoveryCodes)
      setTwoFaSetup(null)
      setTwoFaCode('')
      setTwoFaEnabled(true)
    } catch (e) { setTwoFaError((e as Error).message) }
    finally { setTwoFaBusy(false) }
  }

  async function disableTwoFa() {
    const code = window.prompt('Enter a current authenticator or recovery code to turn off 2FA')
    if (!code) return
    setTwoFaBusy(true); setTwoFaError(null)
    try {
      await TwoFactor.disable(code.trim())
      setTwoFaEnabled(false)
      setRecoveryCodes(null)
    } catch (e) { setTwoFaError((e as Error).message) }
    finally { setTwoFaBusy(false) }
  }

  // --- Security: single sign-on (SSO) ---
  const [ssoEnabled, setSsoEnabled] = useState(false)
  const [ssoProvider, setSsoProvider] = useState('oidc')
  const [ssoClientId, setSsoClientId] = useState('')
  const [ssoClientSecret, setSsoClientSecret] = useState('')
  const [ssoHasSecret, setSsoHasSecret] = useState(false)
  const [ssoIssuerUrl, setSsoIssuerUrl] = useState('')
  const [ssoScopes, setSsoScopes] = useState('openid email profile')
  const [ssoDomains, setSsoDomains] = useState('')
  const [ssoAutoProvision, setSsoAutoProvision] = useState(false)
  const [ssoDefaultRoleId, setSsoDefaultRoleId] = useState('')
  const [ssoCallbackUrl, setSsoCallbackUrl] = useState('')
  const [ssoBusy, setSsoBusy] = useState(false)
  const [ssoLoaded, setSsoLoaded] = useState(false)
  const [ssoSaved, setSsoSaved] = useState(false)

  useEffect(() => {
    Sso.settings().then((s) => {
      setSsoEnabled(s.enabled)
      setSsoProvider(s.provider)
      setSsoClientId(s.clientId)
      setSsoHasSecret(s.hasClientSecret)
      setSsoIssuerUrl(s.issuerUrl)
      setSsoScopes(s.scopes)
      setSsoDomains((s.allowedDomains ?? []).join('\n'))
      setSsoAutoProvision(s.autoProvision)
      setSsoDefaultRoleId(s.defaultRoleId || '')
      setSsoCallbackUrl(s.callbackUrl)
      setSsoLoaded(true)
    }).catch(() => setSsoLoaded(true))
  }, [])

  async function saveSsoSettings() {
    setSsoBusy(true); setSsoSaved(false)
    try {
      const res = await Sso.update({
        enabled: ssoEnabled,
        provider: ssoProvider,
        clientId: ssoClientId,
        ...(ssoClientSecret ? { clientSecret: ssoClientSecret } : {}),
        issuerUrl: ssoIssuerUrl,
        scopes: ssoScopes,
        allowedDomains: ssoDomains.split(/[\n,]/).map((x) => x.trim().toLowerCase()).filter(Boolean),
        autoProvision: ssoAutoProvision,
        defaultRoleId: ssoDefaultRoleId || undefined,
      })
      setSsoHasSecret(res.hasClientSecret)
      setSsoClientSecret('')
      setSsoSaved(true)
      setTimeout(() => setSsoSaved(false), 2500)
    } finally { setSsoBusy(false) }
  }

  // --- Tax collection (1099 / W-9) ---
  const [taxRequired, setTaxRequired] = useState(false)
  const [taxThreshold, setTaxThreshold] = useState('600')
  const [taxLoaded, setTaxLoaded] = useState(false)
  const [taxBusy, setTaxBusy] = useState(false)
  const [taxSaved, setTaxSaved] = useState(false)
  useEffect(() => {
    Tax.settings().then((s) => {
      setTaxRequired(s.required)
      setTaxThreshold(String(s.threshold))
      setTaxLoaded(true)
    }).catch(() => setTaxLoaded(true))
  }, [])
  async function saveTaxSettings() {
    setTaxBusy(true); setTaxSaved(false)
    try {
      await Tax.updateSettings({ required: taxRequired, threshold: Number(taxThreshold) || 0 })
      setTaxSaved(true)
      setTimeout(() => setTaxSaved(false), 2500)
    } finally { setTaxBusy(false) }
  }

  // --- Bulk CSV import/export ---
  const [importText, setImportText] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [exportBusy, setExportBusy] = useState<string | null>(null)

  async function runExport(entity: BulkExportEntity) {
    setExportBusy(entity)
    try { await Bulk.export(entity) } catch (e: any) { alert(e?.message || 'Export failed') } finally { setExportBusy(null) }
  }

  async function runImport() {
    if (!importText.trim()) return
    setImportBusy(true)
    setImportResult(null)
    setImportError(null)
    try {
      const res = await Bulk.importAffiliates(importText)
      setImportResult(res)
    } catch (e: any) {
      setImportError(e?.message || 'Import failed')
    } finally { setImportBusy(false) }
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportText(await file.text())
  }

  // --- API Keys ---
  const { data: keys, loading: keysLoading, reload: reloadKeys } = useFetch(() => ApiKeys.list(), [])
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyScopes, setNewKeyScopes] = useState(['orders.write'])
  const [keyBusy, setKeyBusy] = useState(false)
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)

  async function createKey() {
    if (!newKeyName.trim()) return
    setKeyBusy(true)
    try {
      const result = await ApiKeys.create({ name: newKeyName.trim(), scopes: newKeyScopes })
      setCreatedKey(result)
      setNewKeyName('')
      setShowCreateForm(false)
      reloadKeys()
    } finally { setKeyBusy(false) }
  }

  async function revokeKey(id: string) {
    if (!confirm('Revoke this API key? This cannot be undone.')) return
    await ApiKeys.revoke(id)
    reloadKeys()
  }

  const auditCols: Column<AuditEntry>[] = [
    { key: 'action', header: 'Action', render: (r) => <span className="font-medium text-xs">{r.action}</span> },
    { key: 'resourceType', header: 'Resource', render: (r) => r.resourceType ? <span className="text-xs">{r.resourceType}{r.resourceId ? ` \u00b7 ${r.resourceId.slice(0, 8)}` : ''}</span> : <span className="text-muted text-xs">—</span> },
    { key: 'userId', header: 'User', render: (r) => <span className="text-xs text-muted">{r.userId ? r.userId.slice(0, 8) : '—'}</span> },
    { key: 'createdAt', header: 'When', render: (r) => shortDate(r.createdAt) },
  ]

  const keyCols: Column<ApiKeyRow>[] = [
    { key: 'name', header: 'Name', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'scopes', header: 'Scopes', render: (r) => <span className="text-xs text-muted">{r.scopes.join(', ')}</span> },
    { key: 'lastUsedAt', header: 'Last used', render: (r) => r.lastUsedAt ? shortDate(r.lastUsedAt) : <span className="text-muted">Never</span> },
    { key: 'createdAt', header: 'Created', render: (r) => shortDate(r.createdAt) },
    { key: 'actions', header: '', align: 'right', render: (r) => <Button variant="outline" onClick={() => revokeKey(r.id)}>Revoke</Button> },
  ]

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader title="Settings" subtitle="Signup, attribution, API keys & audit log" />

      {/* Signup settings */}
      <Card title="Affiliate signup" className="mb-3">
        {!settingsLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <Toggle checked={signupEnabled} onChange={setSignupEnabled} label="Allow affiliate signups" hint="When off, the public signup page shows a closed message" />
            <Toggle checked={autoApprove} onChange={setAutoApprove} label="Auto-approve applications" hint="Instantly create an affiliate account on signup (no manual review)" />
            <Toggle checked={requireWebsite} onChange={setRequireWebsite} label="Require website / social profile" hint="Applicants must provide a website or social link" />
            <Toggle checked={allowAffiliateLinkCreation} onChange={setAllowAffiliateLinkCreation} label="Allow affiliates to create tracking links" hint="Links are limited to connected store domains and always belong to the signed-in affiliate" />

            {/* Branding / customization of the public sign-up form */}
            <div className="mt-4 pt-3 border-t border-line">
              <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">Public sign-up page — branding</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <label className="text-2xs text-muted">Headline</label>
                  <input value={brandHeadline} onChange={(e) => setBrandHeadline(e.target.value)} placeholder="Join our affiliate program"
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
                <div className="col-span-2">
                  <label className="text-2xs text-muted">Sub-heading</label>
                  <textarea rows={2} value={brandSub} onChange={(e) => setBrandSub(e.target.value)} placeholder="Fill in your details to apply and start earning commissions."
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm resize-none" />
                </div>
                <div className="col-span-2">
                  <label className="text-2xs text-muted">Left-side image URL (shown on desktop)</label>
                  <input value={brandImage} onChange={(e) => setBrandImage(e.target.value)} placeholder="https://example.com/banner.jpg"
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                  <p className="text-2xs text-muted mt-0.5">Used in the &quot;Image + form&quot; layout. Leave blank for a centered form.</p>
                </div>
                <div>
                  <label className="text-2xs text-muted">Layout</label>
                  <select value={brandLayout} onChange={(e) => setBrandLayout(e.target.value as 'split' | 'centered')}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm bg-white">
                    <option value="split">Image left · form right</option>
                    <option value="centered">Centered form</option>
                  </select>
                </div>
                <div>
                  <label className="text-2xs text-muted">Accent color</label>
                  <div className="mt-0.5 flex items-center gap-2">
                    <input type="color" value={brandAccent} onChange={(e) => setBrandAccent(e.target.value)}
                      className="h-8 w-10 rounded border border-line p-0.5" />
                    <input value={brandAccent} onChange={(e) => setBrandAccent(e.target.value)}
                      className="flex-1 rounded-md border border-line px-2 py-1.5 text-sm" />
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="text-2xs text-muted">Button text</label>
                  <input value={brandButton} onChange={(e) => setBrandButton(e.target.value)} placeholder="Apply now"
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
              </div>
            </div>

            {/* Embed — optional independent design */}
            <div className="mt-4 pt-3 border-t border-line">
              <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">Embed — design</p>
              <Toggle checked={embedCustom} onChange={setEmbedCustom} label="Use a different design for the embed" hint="The embedded form always collects the same fields. Turn this on to give the embed its own headline, image, colors and layout — otherwise it matches the sign-up page above." />
              {embedCustom && (
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <div className="col-span-2">
                    <label className="text-2xs text-muted">Embed headline</label>
                    <input value={embedHeadline} onChange={(e) => setEmbedHeadline(e.target.value)} placeholder="Become an affiliate"
                      className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-2xs text-muted">Embed sub-heading</label>
                    <textarea rows={2} value={embedSub} onChange={(e) => setEmbedSub(e.target.value)} placeholder="Sign up in seconds and start earning."
                      className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm resize-none" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-2xs text-muted">Embed image URL (shown on desktop in the image layout)</label>
                    <input value={embedImage} onChange={(e) => setEmbedImage(e.target.value)} placeholder="https://example.com/embed-banner.jpg"
                      className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="text-2xs text-muted">Embed layout</label>
                    <select value={embedLayout} onChange={(e) => setEmbedLayout(e.target.value as 'split' | 'centered')}
                      className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm bg-white">
                      <option value="centered">Centered form</option>
                      <option value="split">Image left · form right</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-2xs text-muted">Embed accent color</label>
                    <div className="mt-0.5 flex items-center gap-2">
                      <input type="color" value={embedAccent} onChange={(e) => setEmbedAccent(e.target.value)}
                        className="h-8 w-10 rounded border border-line p-0.5" />
                      <input value={embedAccent} onChange={(e) => setEmbedAccent(e.target.value)}
                        className="flex-1 rounded-md border border-line px-2 py-1.5 text-sm" />
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="text-2xs text-muted">Embed button text</label>
                    <input value={embedButton} onChange={(e) => setEmbedButton(e.target.value)} placeholder="Apply now"
                      className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                  </div>
                </div>
              )}
            </div>

            {/* Direct link + iframe embed */}
            <div className="mt-4 pt-3 border-t border-line">
              <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">Share &amp; embed</p>
              {orgSlug ? (
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="text-2xs text-muted">Direct link (hosted page)</label>
                    <div className="mt-0.5 flex items-center gap-2">
                      <input readOnly value={applyUrl} className="flex-1 rounded-md border border-line px-2 py-1.5 text-xs bg-gray-50 font-mono" />
                      <Button variant="outline" onClick={() => copy(applyUrl, 'link')}>{copied === 'link' ? 'Copied!' : 'Copy'}</Button>
                      <a href={applyUrl} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline whitespace-nowrap">Open ↗</a>
                    </div>
                  </div>
                  <div>
                    <label className="text-2xs text-muted">Embed on your own site (WordPress, Shopify, anywhere)</label>
                    <textarea readOnly rows={2} value={iframeSnippet} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-xs font-mono bg-gray-50 resize-none" />
                    <div className="mt-1 flex items-center gap-3">
                      <Button variant="outline" onClick={() => copy(iframeSnippet, 'iframe')}>{copied === 'iframe' ? 'Copied!' : 'Copy iframe'}</Button>
                      <button className="text-xs text-brand hover:underline" onClick={() => copy(iframeAutoResize, 'iframe2')}>{copied === 'iframe2' ? 'Copied!' : 'Copy with auto-resize script'}</button>
                    </div>
                    <p className="text-2xs text-muted mt-1">The iframe uses your saved design — the embed design if you enabled a custom one, otherwise the sign-up page branding — and submits straight into your program. Paste it into any HTML / Custom-HTML block. The auto-resize version grows the frame to fit the form.</p>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted">Save settings to generate your sign-up link and embed code.</p>
              )}
            </div>

            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={settingsBusy} onClick={saveSettings}>{settingsBusy ? 'Saving...' : 'Save settings'}</Button>
              {settingsSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      {/* Sub-affiliate / multi-tier */}
      <Card title="Multi-tier commissions" className="mb-3">
        {!subLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <Toggle checked={subEnabled} onChange={setSubEnabled} label="Enable sub-affiliate overrides" hint="Reward affiliates a % of the commissions earned by affiliates they recruit" />
            <div className={`grid grid-cols-3 gap-3 mt-3 ${subEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="text-2xs text-muted">Override rate (%)</label>
                <input type="number" min={0} max={100} step={0.5} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm"
                  value={subRate} onChange={(e) => setSubRate(Number(e.target.value))} />
                <p className="text-2xs text-muted mt-0.5">% of the downline&apos;s direct commission</p>
              </div>
              <div>
                <label className="text-2xs text-muted">Tiers (depth)</label>
                <input type="number" min={1} max={10} step={1} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm"
                  value={subDepth} onChange={(e) => setSubDepth(Number(e.target.value))} />
                <p className="text-2xs text-muted mt-0.5">How many levels up to reward</p>
              </div>
              <div>
                <label className="text-2xs text-muted">Per-tier decay</label>
                <input type="number" min={0} max={1} step={0.1} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm"
                  value={subDecay} onChange={(e) => setSubDecay(Number(e.target.value))} />
                <p className="text-2xs text-muted mt-0.5">1 = flat, 0.5 = halve each level</p>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={subBusy} onClick={saveSubSettings}>{subBusy ? 'Saving...' : 'Save settings'}</Button>
              {subSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      {/* Attribution model & coupon-leak protection */}
      <Card title="Attribution & coupon protection" className="mb-3">
        {!attrLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-2xs text-muted">Attribution model</label>
                <select value={cookieModel} onChange={(e) => setCookieModel(e.target.value as 'last_click' | 'first_click' | 'linear' | 'position')}
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm">
                  <option value="last_click">Last click</option>
                  <option value="first_click">First click</option>
                  <option value="linear">Linear (multi-touch)</option>
                  <option value="position">Position-based</option>
                </select>
              </div>
              <div>
                <label className="text-2xs text-muted">Cookie window (days)</label>
                <input type="number" min={1} max={3650} value={cookieWindowDays}
                  onChange={(e) => setCookieWindowDays(Number(e.target.value))}
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
              </div>
            </div>
            <div className="mt-3">
              <Toggle checked={couponPriority} onChange={setCouponPriority}
                label="Coupon code wins over cookies"
                hint="When an affiliate coupon is used, credit that affiliate even if another affiliate's cookie is present." />
              <Toggle checked={lifetimeEnabled} onChange={setLifetimeEnabled}
                label="Lifetime attribution"
                hint="Returning customers stay credited to the affiliate who first referred them." />
            </div>

            <div className="mt-4 pt-3 border-t border-line">
              <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">Coupon leak protection</p>
              <label className="text-2xs text-muted">Protection mode</label>
              <select value={couponMode} onChange={(e) => setCouponMode(e.target.value as 'off' | 'flag' | 'block')}
                className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm">
                <option value="off">Off — always credit coupons</option>
                <option value="flag">Flag — credit but send to review</option>
                <option value="block">Block — suppress leaked coupon credit</option>
              </select>
              <p className="text-2xs text-muted mt-1">
                Deal/coupon sites (e.g. Honey, RetailMeNot) can hijack a sale by injecting their own coupon at checkout. Flag routes suspects to fraud review; Block removes the coupon credit and falls back to click/cookie attribution.
              </p>
              <div className="mt-3">
                <Toggle checked={requireClickSupport} onChange={setRequireClickSupport}
                  label="Require a supporting click"
                  hint="Only credit a coupon when that same affiliate also drove a tracked click within the cookie window." />
              </div>
              <div className="mt-2">
                <label className="text-2xs text-muted">Blocked referrer domains (one per line or comma-separated)</label>
                <textarea value={blockedReferrers} onChange={(e) => setBlockedReferrers(e.target.value)}
                  rows={3} placeholder="honey.com, retailmenot.com"
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm font-mono" />
                <p className="text-2xs text-muted mt-0.5">Extra domains treated as coupon leaks, merged with the built-in deal-site list.</p>
              </div>
            </div>

            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={attrBusy} onClick={saveAttrSettings}>{attrBusy ? 'Saving...' : 'Save settings'}</Button>
              {attrSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      {/* Notification preferences */}
      {/* Source-based commission (paid vs organic + coupon code) */}
      <Card title="Source-based commission (paid vs organic)" className="mb-3">
        {!ccLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <Toggle
              checked={ccEnabled}
              onChange={setCcEnabled}
              label="Enable source-based commission rates"
              hint="Pay a different commission when a customer uses an affiliate's COUPON CODE depending on whether they arrived from a PAID ad we ran vs ORGANIC. Referral-link sales are unaffected unless you set link rates below."
            />
            <div className={`mt-3 ${ccEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-1">Coupon / promo code sales</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs text-muted">Organic rate (%)</label>
                  <input type="number" min={0} max={100} step={0.5} value={ccCodeOrganic}
                    onChange={(e) => setCcCodeOrganic(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                  <p className="text-2xs text-muted mt-0.5">Customer came organically, then entered the code.</p>
                </div>
                <div>
                  <label className="text-2xs text-muted">Paid-ad rate (%)</label>
                  <input type="number" min={0} max={100} step={0.5} value={ccCodePaid}
                    onChange={(e) => setCcCodePaid(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                  <p className="text-2xs text-muted mt-0.5">We ran their video as a paid ad; customer then entered the code.</p>
                </div>
              </div>
              <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-1 mt-4">Referral link sales (optional overrides)</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs text-muted">Organic link rate (%)</label>
                  <input type="number" min={0} max={100} step={0.5} value={ccLinkOrganic} placeholder="Use normal rule"
                    onChange={(e) => setCcLinkOrganic(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-2xs text-muted">Paid link rate (%)</label>
                  <input type="number" min={0} max={100} step={0.5} value={ccLinkPaid} placeholder="Use normal rule"
                    onChange={(e) => setCcLinkPaid(e.target.value === '' ? '' : Number(e.target.value))}
                    className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
              </div>
              <p className="text-2xs text-muted mt-1">Leave link rates blank to keep the normal commission rules for referral-link sales.</p>
            </div>
            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={ccBusy} onClick={saveCcSettings}>{ccBusy ? 'Saving...' : 'Save settings'}</Button>
              {ccSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      {/* New-vs-returning customer commission */}
      <Card title="New vs returning customer rates" className="mb-3">
        {!ctLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <Toggle
              checked={ctEnabled}
              onChange={setCtEnabled}
              label="Enable new-vs-returning commission rates"
              hint="Pay a different commission depending on whether the buyer is a first-time customer or a repeat customer. A buyer is 'returning' once they have any prior order. This takes precedence over source-based rates and normal rules."
            />
            <div className={`mt-3 grid grid-cols-2 gap-3 ${ctEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="text-2xs text-muted">New customer rate (%)</label>
                <input type="number" min={0} max={100} step={0.5} value={ctNewRate}
                  onChange={(e) => setCtNewRate(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                <p className="text-2xs text-muted mt-0.5">Applied to the subtotal on a customer's first purchase.</p>
              </div>
              <div>
                <label className="text-2xs text-muted">Returning customer rate (%)</label>
                <input type="number" min={0} max={100} step={0.5} value={ctReturningRate}
                  onChange={(e) => setCtReturningRate(e.target.value === '' ? '' : Number(e.target.value))}
                  className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                <p className="text-2xs text-muted mt-0.5">Applied to the subtotal for repeat customers.</p>
              </div>
            </div>
            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={ctBusy} onClick={saveCtSettings}>{ctBusy ? 'Saving...' : 'Save settings'}</Button>
              {ctSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      <Card title="Two-factor authentication" className="mb-3">
        {twoFaEnabled === null ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-ink">Authenticator app (TOTP)</p>
                <p className="text-xs text-muted mt-0.5">
                  Require a 6-digit code from an app like Google Authenticator or 1Password at sign-in.
                </p>
              </div>
              <span className={`text-2xs rounded-full px-2 py-0.5 ${twoFaEnabled ? 'bg-success/10 text-success' : 'bg-gray-100 text-muted'}`}>
                {twoFaEnabled ? 'Enabled' : 'Off'}
              </span>
            </div>
            {recoveryCodes && (
              <div className="mt-2 rounded-md border border-line bg-gray-50 p-3">
                <p className="text-xs font-medium">Save your recovery codes</p>
                <p className="text-2xs text-muted mb-2">Each code works once if you lose your device. They will not be shown again.</p>
                <div className="grid grid-cols-2 gap-1 font-mono text-xs">
                  {recoveryCodes.map((c) => <span key={c}>{c}</span>)}
                </div>
              </div>
            )}
            {twoFaSetup ? (
              <div className="mt-2">
                <p className="text-xs text-muted">1. Add this secret to your authenticator app:</p>
                <code className="mt-1 block break-all rounded-md border border-line bg-gray-50 px-2 py-1.5 text-xs">{twoFaSetup.secret}</code>
                <p className="text-2xs text-muted mt-1 break-all">otpauth: {twoFaSetup.otpauthUrl}</p>
                <p className="text-xs text-muted mt-3">2. Enter the current 6-digit code to finish:</p>
                <div className="mt-1 flex items-center gap-2">
                  <input value={twoFaCode} onChange={(e) => setTwoFaCode(e.target.value)} inputMode="numeric" placeholder="123456"
                    className="w-32 rounded-md border border-line px-2 py-1.5 text-sm tracking-widest text-center" />
                  <Button disabled={twoFaBusy} onClick={confirmTwoFa}>{twoFaBusy ? 'Verifying…' : 'Enable 2FA'}</Button>
                  <button type="button" onClick={() => { setTwoFaSetup(null); setTwoFaCode('') }} className="text-2xs text-muted hover:text-brand">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
                {twoFaEnabled ? (
                  <Button variant="danger" disabled={twoFaBusy} onClick={disableTwoFa}>{twoFaBusy ? 'Working…' : 'Turn off 2FA'}</Button>
                ) : (
                  <Button disabled={twoFaBusy} onClick={startTwoFaSetup}>{twoFaBusy ? 'Working…' : 'Set up 2FA'}</Button>
                )}
              </div>
            )}
            {twoFaError && <p className="text-xs text-danger mt-2">{twoFaError}</p>}
          </>
        )}
      </Card>

      <Card title="Single sign-on (SSO)" className="mb-3">
        {!ssoLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <Toggle checked={ssoEnabled} onChange={setSsoEnabled} label="Enable SSO for this workspace"
              hint="Let members sign in through your OIDC identity provider (Google Workspace, Okta, Azure AD, Auth0)." />
            <div className={`mt-3 space-y-3 ${ssoEnabled ? '' : 'opacity-50 pointer-events-none'}`}>
              <div>
                <label className="text-2xs text-muted">Redirect / callback URL (add this to your IdP)</label>
                <code className="mt-0.5 block break-all rounded-md border border-line bg-gray-50 px-2 py-1.5 text-xs">{ssoCallbackUrl}</code>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs text-muted">Client ID</label>
                  <input value={ssoClientId} onChange={(e) => setSsoClientId(e.target.value)} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-2xs text-muted">Client secret {ssoHasSecret && <span className="text-success">(set)</span>}</label>
                  <input type="password" value={ssoClientSecret} onChange={(e) => setSsoClientSecret(e.target.value)} placeholder={ssoHasSecret ? 'leave blank to keep' : ''} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
              </div>
              <div>
                <label className="text-2xs text-muted">OIDC issuer URL</label>
                <input type="url" value={ssoIssuerUrl} onChange={(e) => setSsoIssuerUrl(e.target.value)} placeholder="https://idp.example.com" className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                <p className="mt-1 text-2xs text-muted">Authorization, token, userinfo and signing-key endpoints are securely discovered from this issuer.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-2xs text-muted">Scopes</label>
                  <input value={ssoScopes} onChange={(e) => setSsoScopes(e.target.value)} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="text-2xs text-muted">Allowed email domains</label>
                  <input value={ssoDomains} onChange={(e) => setSsoDomains(e.target.value)} placeholder="acme.com, acme.io" className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
              </div>
              <Toggle checked={ssoAutoProvision} onChange={setSsoAutoProvision} label="Auto-provision new users"
                hint="Create an account automatically on first SSO login when the email domain is allowed." />
              {ssoAutoProvision && (
                <div>
                  <label className="text-2xs text-muted">Default role ID for provisioned users</label>
                  <input value={ssoDefaultRoleId} onChange={(e) => setSsoDefaultRoleId(e.target.value)} className="mt-0.5 w-full rounded-md border border-line px-2 py-1.5 text-sm" />
                </div>
              )}
            </div>
            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={ssoBusy} onClick={saveSsoSettings}>{ssoBusy ? 'Saving...' : 'Save settings'}</Button>
              {ssoSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      <Card title="Tax collection (1099 / W-9)" className="mb-3">
        {!taxLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <Toggle checked={taxRequired} onChange={setTaxRequired} label="Require a tax form before payout"
              hint="Affiliates must submit a W-9 (US) or W-8BEN (non-US) form before they can request a payout." />
            <div className="mt-3">
              <label className="text-2xs text-muted">1099-NEC reporting threshold (USD)</label>
              <input type="number" value={taxThreshold} onChange={(e) => setTaxThreshold(e.target.value)} className="mt-0.5 w-40 rounded-md border border-line px-2 py-1.5 text-sm" />
              <p className="text-2xs text-muted mt-1">US affiliates paid at or above this amount in a calendar year are flagged as needing a 1099-NEC. IRS default is 600.</p>
            </div>
            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={taxBusy} onClick={saveTaxSettings}>{taxBusy ? 'Saving...' : 'Save settings'}</Button>
              {taxSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      <Card title="Email templates" className="mb-3">
        <p className="text-xs text-muted mb-2">Customize the wording of automated emails (invites, approvals, payouts). Your brand colour and logo are applied automatically for each tenant.</p>
        <a href="/settings/email-templates" className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium bg-brand text-white hover:bg-brand-600">Edit email templates</a>
      </Card>
      <Card title="Notifications" className="mb-3">
        {!notifLoaded ? <div className="py-4 text-center text-xs text-muted">Loading…</div> : (
          <>
            <Toggle checked={inAppEnabled} onChange={setInAppEnabled} label="In-app notifications" hint="Show the bell dropdown alerts for commissions, payouts & new applications" />
            <Toggle checked={emailEnabled} onChange={setEmailEnabled} label="Email notifications" hint="Send transactional emails to affiliates and admins (requires SMTP configured)" />
            <div className="mt-3 pt-2 border-t border-line flex items-center gap-3">
              <Button disabled={notifBusy} onClick={saveNotifSettings}>{notifBusy ? 'Saving...' : 'Save settings'}</Button>
              {notifSaved && <span className="text-xs text-success">Saved!</span>}
            </div>
          </>
        )}
      </Card>

      {/* Bulk CSV import / export */}
      <Card title="Bulk import / export" className="mb-3">
        <p className="text-xs text-muted mb-2">Download data as CSV, or bulk-create affiliates from a CSV file.</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {(['affiliates', 'commissions', 'orders', 'payouts'] as BulkExportEntity[]).map((ent) => (
            <Button key={ent} variant="outline" disabled={exportBusy === ent} onClick={() => runExport(ent)}>
              {exportBusy === ent ? 'Exporting…' : `Export ${ent}`}
            </Button>
          ))}
        </div>
        <div className="border-t border-line pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm font-medium text-ink">Import affiliates</p>
            <button className="text-xs text-brand hover:underline" onClick={() => Bulk.affiliateTemplate()}>Download template</button>
          </div>
          <p className="text-2xs text-muted mb-2">Columns: <code className="bg-gray-100 px-1 rounded">affiliateCode</code> (required), referralSlug, status, parentAffiliateCode. Existing codes are skipped.</p>
          <input type="file" accept=".csv,text/csv" onChange={onImportFile} className="block text-xs mb-2" />
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="affiliateCode,referralSlug,status,parentAffiliateCode&#10;SUMMER10,summer10,approved,"
            className="w-full h-24 rounded-md border border-line px-2 py-1.5 text-xs font-mono"
          />
          <div className="mt-2 flex items-center gap-3">
            <Button disabled={importBusy || !importText.trim()} onClick={runImport}>{importBusy ? 'Importing…' : 'Import'}</Button>
            {importResult && (
              <span className="text-xs text-success">Created {importResult.created}, skipped {importResult.skipped}, {importResult.errors.length} error(s)</span>
            )}
            {importError && <span className="text-xs text-danger">{importError}</span>}
          </div>
          {importResult && importResult.errors.length > 0 && (
            <div className="mt-2 rounded-md border border-line bg-gray-50 px-2 py-1.5 max-h-32 overflow-auto">
              {importResult.errors.map((er, i) => (
                <p key={i} className="text-2xs text-danger">Row {er.row}: {er.message}</p>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* API Keys */}
      <Card title="API Keys" className="mb-3">
        <p className="text-xs text-muted mb-3">
          Use API keys to ingest orders programmatically (e.g. custom checkout).
          Send key in <code className="text-xs bg-gray-100 px-1 rounded">x-api-key</code> header to{' '}
          <code className="text-xs bg-gray-100 px-1 rounded">POST /v1/orders/ingest/apikey</code>.
          Keys are shown only once on creation.
        </p>

        {createdKey && (
          <div className="mb-3 rounded-lg border border-success bg-green-50 px-3 py-2.5">
            <p className="text-xs font-medium text-success mb-1">Key created — copy it now, it won't be shown again!</p>
            <code className="text-xs font-mono break-all text-ink select-all">{createdKey.key}</code>
            <button className="ml-2 text-xs text-brand hover:underline" onClick={() => { navigator.clipboard.writeText(createdKey.key); }}>Copy</button>
            <button className="ml-2 text-xs text-muted hover:underline" onClick={() => setCreatedKey(null)}>Dismiss</button>
          </div>
        )}

        {showCreateForm && (
          <div className="mb-3 p-3 rounded-lg border border-line bg-surface">
            <div className="flex gap-2 mb-2">
              <input
                className="flex-1 rounded-md border border-line px-2.5 py-1.5 text-sm outline-none focus:border-brand"
                placeholder="Key name (e.g. Custom Checkout)"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {SCOPES.map((s) => (
                <button
                  key={s}
                  onClick={() => setNewKeyScopes((prev) => prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s])}
                  className={`rounded-md border px-2 py-0.5 text-xs transition ${
                    newKeyScopes.includes(s) ? 'border-brand bg-blue-50 text-brand font-medium' : 'border-line text-muted'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button disabled={keyBusy || !newKeyName.trim()} onClick={createKey}>{keyBusy ? 'Creating...' : 'Create key'}</Button>
              <Button variant="outline" onClick={() => setShowCreateForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {!showCreateForm && (
          <div className="mb-2">
            <Button onClick={() => setShowCreateForm(true)}>New API key</Button>
          </div>
        )}

        <DataTable columns={keyCols} rows={keys ?? []} loading={keysLoading} empty="No API keys yet" />
      </Card>

      {/* Audit Log */}
      <Card title="Audit log">
        <div className="mb-2">
          <FilterTabs value={limit} onChange={setLimit} options={[
            { value: '50', label: 'Last 50' },
            { value: '100', label: 'Last 100' },
            { value: '250', label: 'Last 250' },
          ]} />
        </div>
        <DataTable columns={auditCols} rows={auditData ?? []} loading={auditLoading} empty="No audit events yet" />
      </Card>
    </div>
  )
}
