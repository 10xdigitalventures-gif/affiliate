/**
 * Email HTML templates. Each returns { subject, html, text }.
 * Kept as simple inline HTML - no template engine dependency.
 *
 * Per-tenant white-label branding + editable copy:
 *  - Branding (header colour, logo, company name) resolves from
 *    settings.branding via brandFromSettings().
 *  - Per-template text overrides (subject / heading / body) resolve from
 *    settings.emailTemplates[<key>]. Missing fields fall back to the platform
 *    defaults below. Override strings may use {placeholder} tokens.
 */

export interface Brand {
  primaryColor: string
  logoUrl: string | null
  companyName: string | null
}

const DEFAULT_BRAND: Brand = { primaryColor: '#1B4DFF', logoUrl: null, companyName: null }

/** Extract a tenant Brand from an Organization.settings JSON blob. */
export function brandFromSettings(settings: unknown): Brand {
  const b = ((settings as any)?.branding ?? {}) as Record<string, any>
  return {
    primaryColor: typeof b.primaryColor === 'string' && b.primaryColor ? b.primaryColor : DEFAULT_BRAND.primaryColor,
    logoUrl: typeof b.logoUrl === 'string' && b.logoUrl ? b.logoUrl : null,
    companyName: typeof b.companyName === 'string' && b.companyName ? b.companyName : null,
  }
}

export interface TemplateOverride {
  subject?: string
  heading?: string
  body?: string
}

/** Per-template editable text overrides from settings.emailTemplates. */
export function overridesFromSettings(settings: unknown): Record<string, TemplateOverride> {
  const t = (settings as any)?.emailTemplates
  return t && typeof t === 'object' ? (t as Record<string, TemplateOverride>) : {}
}

type Vars = Record<string, string | number | null | undefined>

/** Replace {token} placeholders with values (missing -> empty string). */
export function subst(tpl: string, vars: Vars): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => {
    const v = vars[k]
    return v === undefined || v === null ? '' : String(v)
  })
}

interface OrgCtx {
  orgName: string
  /** Optional org settings blob (branding + email template overrides). */
  settings?: unknown
}

function esc(s: string) {
  return String(s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
}

function wrap(orgName: string, title: string, body: string, brand: Brand = DEFAULT_BRAND) {
  const color = brand.primaryColor || DEFAULT_BRAND.primaryColor
  const header = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(orgName)}" style="max-height:28px;max-width:180px;display:block" />`
    : `<p style="margin:0;color:#ffffff;font-size:13px;font-weight:600;letter-spacing:.5px">${esc(orgName)}</p>`
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center" style="padding:32px 16px">
      <table width="540" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;overflow:hidden">
        <tr><td style="background:${color};padding:20px 32px">
          ${header}
        </td></tr>
        <tr><td style="padding:28px 32px 32px">
          <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111827">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:16px 32px;border-top:1px solid #f3f4f6">
          <p style="margin:0;font-size:11px;color:#9ca3af">You received this email because you are part of ${esc(orgName)} affiliate program.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim()
}

function btn(url: string, label: string, brand: Brand = DEFAULT_BRAND) {
  const color = brand.primaryColor || DEFAULT_BRAND.primaryColor
  return `<a href="${url}" style="display:inline-block;margin-top:20px;padding:10px 22px;background:${color};color:#fff;font-size:13px;font-weight:600;border-radius:8px;text-decoration:none">${label}</a>`
}

function p(text: string) {
  return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#374151">${text}</p>`
}

/** Build body HTML from a plain-text override (newline-separated paragraphs). */
function bodyFromText(text: string, vars: Vars): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => p(esc(subst(l, vars))))
    .join('')
}

// Application submitted (to applicant)
export function applicationReceived(ctx: OrgCtx & { firstName: string }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).applicationReceived ?? {}
  const vars: Vars = { firstName: ctx.firstName, orgName: ctx.orgName }
  const subject = ov.subject ? subst(ov.subject, vars) : `Your application to ${ctx.orgName} affiliate program`
  const heading = ov.heading ? subst(ov.heading, vars) : 'Application received'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`Hi ${esc(ctx.firstName)},`) +
      p(`Thanks for applying to <strong>${esc(ctx.orgName)}</strong> affiliate program. We have received your application and will review it shortly.`) +
      p(`We will email you as soon as a decision is made.`)
  const html = wrap(ctx.orgName, heading, bodyHtml, brand)
  const text = ov.body ? subst(ov.body, vars) : `Hi ${ctx.firstName},\n\nThanks for applying to ${ctx.orgName} affiliate program. We will review your application and get back to you soon.`
  return { subject, html, text }
}

// Application approved (to affiliate)
export function applicationApproved(ctx: OrgCtx & {
  firstName: string
  affiliateCode: string
  portalUrl: string
  setupRequired?: boolean
}) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).applicationApproved ?? {}
  const vars: Vars = { firstName: ctx.firstName, orgName: ctx.orgName, affiliateCode: ctx.affiliateCode, portalUrl: ctx.portalUrl }
  const subject = ov.subject ? subst(ov.subject, vars) : `You are approved. Welcome to ${ctx.orgName} affiliate program`
  const heading = ov.heading ? subst(ov.heading, vars) : 'Welcome aboard'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`Hi ${esc(ctx.firstName)},`) +
      p(`Great news - your application to <strong>${esc(ctx.orgName)}</strong> affiliate program has been <strong>approved</strong>.`) +
      p(`Your affiliate code is: <strong style="font-size:18px;color:${brand.primaryColor};letter-spacing:1px">${esc(ctx.affiliateCode)}</strong>`) +
      (ctx.setupRequired
        ? p(`Set your password to activate your account, then you will be taken to your private affiliate portal.`)
        : p(`Log in to your affiliate portal to get your links, track clicks, and monitor earnings.`))
  const buttonLabel = ctx.setupRequired ? 'Set up your affiliate account' : 'Go to your portal'
  const html = wrap(ctx.orgName, heading, bodyHtml + btn(ctx.portalUrl, buttonLabel, brand), brand)
  const text = ov.body
    ? subst(ov.body, vars)
    : ctx.setupRequired
      ? `Hi ${ctx.firstName},\n\nYour application to ${ctx.orgName} affiliate program has been approved.\nYour affiliate code: ${ctx.affiliateCode}\nSet your password and activate your portal: ${ctx.portalUrl}`
      : `Hi ${ctx.firstName},\n\nYour application to ${ctx.orgName} affiliate program has been approved.\nYour affiliate code: ${ctx.affiliateCode}\nPortal: ${ctx.portalUrl}`
  return { subject, html, text }
}

// Application rejected (to applicant)
export function applicationRejected(ctx: OrgCtx & { firstName: string }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).applicationRejected ?? {}
  const vars: Vars = { firstName: ctx.firstName, orgName: ctx.orgName }
  const subject = ov.subject ? subst(ov.subject, vars) : `Update on your ${ctx.orgName} affiliate application`
  const heading = ov.heading ? subst(ov.heading, vars) : 'Application update'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`Hi ${esc(ctx.firstName)},`) +
      p(`Thank you for your interest in <strong>${esc(ctx.orgName)}</strong> affiliate program.`) +
      p(`After reviewing your application, we are unable to approve it at this time. You are welcome to apply again in the future.`)
  const html = wrap(ctx.orgName, heading, bodyHtml, brand)
  const text = ov.body ? subst(ov.body, vars) : `Hi ${ctx.firstName},\n\nUnfortunately we are unable to approve your application to ${ctx.orgName} affiliate program at this time.`
  return { subject, html, text }
}

// Commission approved (to affiliate)
export function commissionApproved(ctx: OrgCtx & { firstName: string; amount: string; currency: string; portalUrl: string }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).commissionApproved ?? {}
  const vars: Vars = { firstName: ctx.firstName, orgName: ctx.orgName, amount: ctx.amount, currency: ctx.currency, portalUrl: ctx.portalUrl }
  const subject = ov.subject ? subst(ov.subject, vars) : `Commission approved - ${ctx.amount} ${ctx.currency}`
  const heading = ov.heading ? subst(ov.heading, vars) : 'Commission approved'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`Hi ${esc(ctx.firstName)},`) +
      p(`A commission of <strong>${esc(ctx.amount)} ${esc(ctx.currency)}</strong> has been approved and added to your balance.`) +
      p(`Log in to your portal to view your earnings and request a payout.`)
  const html = wrap(ctx.orgName, heading, bodyHtml + btn(ctx.portalUrl, 'View earnings', brand), brand)
  const text = ov.body ? subst(ov.body, vars) : `Hi ${ctx.firstName},\n\nA commission of ${ctx.amount} ${ctx.currency} has been approved.\nPortal: ${ctx.portalUrl}`
  return { subject, html, text }
}

// Payout sent (to affiliate)
export function payoutSent(ctx: OrgCtx & { firstName: string; amount: string; currency: string; method: string; reference?: string; portalUrl: string }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).payoutSent ?? {}
  const vars: Vars = { firstName: ctx.firstName, orgName: ctx.orgName, amount: ctx.amount, currency: ctx.currency, method: ctx.method, reference: ctx.reference, portalUrl: ctx.portalUrl }
  const refLine = ctx.reference ? p(`Transaction reference: <strong>${esc(ctx.reference)}</strong>`) : ''
  const subject = ov.subject ? subst(ov.subject, vars) : `Payout sent - ${ctx.amount} ${ctx.currency}`
  const heading = ov.heading ? subst(ov.heading, vars) : 'Payout sent'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`Hi ${esc(ctx.firstName)},`) +
      p(`Your payout of <strong>${esc(ctx.amount)} ${esc(ctx.currency)}</strong> via <strong>${esc(ctx.method)}</strong> has been processed.`) +
      refLine +
      p(`Please allow 1-5 business days for the funds to arrive.`)
  const html = wrap(ctx.orgName, heading, bodyHtml + btn(ctx.portalUrl, 'View payout history', brand), brand)
  const text = ov.body ? subst(ov.body, vars) : `Hi ${ctx.firstName},\n\nYour payout of ${ctx.amount} ${ctx.currency} via ${ctx.method} has been sent.${ctx.reference ? '\nRef: ' + ctx.reference : ''}\nPortal: ${ctx.portalUrl}`
  return { subject, html, text }
}

// New application alert (to admin)
export function newApplicationAlert(ctx: OrgCtx & { applicantName: string; applicantEmail: string; adminUrl: string }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).newApplicationAlert ?? {}
  const vars: Vars = { applicantName: ctx.applicantName, applicantEmail: ctx.applicantEmail, orgName: ctx.orgName, adminUrl: ctx.adminUrl }
  const subject = ov.subject ? subst(ov.subject, vars) : `New affiliate application - ${ctx.applicantName}`
  const heading = ov.heading ? subst(ov.heading, vars) : 'New affiliate application'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`A new affiliate application has been submitted:`) +
      `<table style="font-size:13px;color:#374151;margin:12px 0" cellpadding="4">
      <tr><td style="color:#6b7280">Name</td><td><strong>${esc(ctx.applicantName)}</strong></td></tr>
      <tr><td style="color:#6b7280">Email</td><td>${esc(ctx.applicantEmail)}</td></tr>
    </table>`
  const html = wrap(ctx.orgName, heading, bodyHtml + btn(ctx.adminUrl, 'Review application', brand), brand)
  const text = ov.body ? subst(ov.body, vars) : `New affiliate application from ${ctx.applicantName} (${ctx.applicantEmail}).\nReview: ${ctx.adminUrl}`
  return { subject, html, text }
}

// Team invitation (to invited user)
export function userInvite(ctx: OrgCtx & { inviteUrl: string; ttlDays: number }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).userInvite ?? {}
  const vars: Vars = { orgName: ctx.orgName, inviteUrl: ctx.inviteUrl, ttlDays: ctx.ttlDays }
  const subject = ov.subject ? subst(ov.subject, vars) : `You have been invited to ${ctx.orgName}`
  const heading = ov.heading ? subst(ov.heading, vars) : 'You are invited'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`You have been invited to join <strong>${esc(ctx.orgName)}</strong>.`) +
      p(`Click below to accept the invitation and set your password. This link expires in ${ctx.ttlDays} day${ctx.ttlDays === 1 ? '' : 's'}.`)
  const html = wrap(ctx.orgName, heading, bodyHtml + btn(ctx.inviteUrl, 'Accept invitation', brand), brand)
  const text = ov.body ? subst(ov.body, vars) : `You have been invited to join ${ctx.orgName}.\nAccept and set your password: ${ctx.inviteUrl}\n(This link expires in ${ctx.ttlDays} days.)`
  return { subject, html, text }
}

// Password reset (to user)
export function passwordReset(ctx: OrgCtx & { firstName: string; resetUrl: string; ttlMinutes: number }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).passwordReset ?? {}
  const vars: Vars = { firstName: ctx.firstName, orgName: ctx.orgName, resetUrl: ctx.resetUrl, ttlMinutes: ctx.ttlMinutes }
  const subject = ov.subject ? subst(ov.subject, vars) : `Reset your ${ctx.orgName} password`
  const heading = ov.heading ? subst(ov.heading, vars) : 'Reset your password'
  const bodyHtml = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`Hi ${esc(ctx.firstName)},`) +
      p(`We received a request to reset your password. Click below to choose a new one. This link expires in ${ctx.ttlMinutes} minutes.`) +
      p(`If you did not request this, you can safely ignore this email - your password will not change.`)
  const html = wrap(ctx.orgName, heading, bodyHtml + btn(ctx.resetUrl, 'Reset password', brand), brand)
  const text = ov.body ? subst(ov.body, vars) : `Hi ${ctx.firstName},\n\nReset your password: ${ctx.resetUrl}\n(This link expires in ${ctx.ttlMinutes} minutes.)\n\nIf you did not request this, ignore this email.`
  return { subject, html, text }
}

// Passwordless sign-in code (to user)
export function emailLoginCode(ctx: OrgCtx & { firstName: string; code: string; ttlMinutes: number }) {
  const brand = brandFromSettings(ctx.settings)
  const ov = overridesFromSettings(ctx.settings).emailLoginCode ?? {}
  const vars: Vars = {
    firstName: ctx.firstName,
    orgName: ctx.orgName,
    code: ctx.code,
    ttlMinutes: ctx.ttlMinutes,
  }
  const subject = ov.subject ? subst(ov.subject, vars) : `Your ${ctx.orgName} sign-in code`
  const heading = ov.heading ? subst(ov.heading, vars) : 'Your sign-in code'
  const intro = ov.body
    ? bodyFromText(ov.body, vars)
    : p(`Hi ${esc(ctx.firstName)},`) + p('Use this one-time code to securely sign in:')
  // Always render the code and safety copy even when an administrator customizes
  // the introduction, so a broken template cannot make login emails unusable.
  const bodyHtml = intro +
    `<div style="margin:20px 0;padding:16px;border-radius:10px;background:#f3f4f6;text-align:center;font-size:30px;font-weight:700;letter-spacing:8px;color:#111827">${esc(ctx.code)}</div>` +
    p(`This code expires in ${ctx.ttlMinutes} minutes and can only be used once.`) +
    p('If you did not request this code, you can safely ignore this email.')
  const html = wrap(ctx.orgName, heading, bodyHtml, brand)
  const textIntro = ov.body ? subst(ov.body, vars) : `Hi ${ctx.firstName},\n\nUse this one-time code to securely sign in.`
  const text = `${textIntro}\n\nCode: ${ctx.code}\n\nIt expires in ${ctx.ttlMinutes} minutes and can only be used once.\n\nIf you did not request this, ignore this email.`
  return { subject, html, text }
}
