import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import * as T from '../mail/templates'
import { UpdateEmailTemplateDto } from './dto/update-template.dto'

export interface TemplateDef {
  key: string
  label: string
  description: string
  variables: string[]
  defaultSubject: string
  defaultHeading: string
  defaultBody: string
}

/**
 * Editable email template registry. The rich HTML defaults live in
 * ../mail/templates.ts; these plain-text defaults mirror them for the editor
 * (prefill + reset). Overrides are stored in Organization.settings.emailTemplates.
 */
export const TEMPLATE_DEFS: TemplateDef[] = [
  {
    key: 'emailLoginCode',
    label: 'Email sign-in code',
    description: 'Sent when a user requests a one-time code to sign in.',
    variables: ['firstName', 'orgName', 'code', 'ttlMinutes'],
    defaultSubject: 'Your {orgName} sign-in code',
    defaultHeading: 'Your sign-in code',
    defaultBody: 'Hi {firstName},\nUse this one-time code to securely sign in.',
  },
  {
    key: 'userInvite',
    label: 'Team / affiliate invitation',
    description: 'Sent when you invite someone to join your workspace.',
    variables: ['orgName', 'inviteUrl', 'ttlDays'],
    defaultSubject: 'You have been invited to {orgName}',
    defaultHeading: 'You are invited',
    defaultBody: 'You have been invited to join {orgName}.\nClick the button below to accept the invitation and set your password.',
  },
  {
    key: 'applicationReceived',
    label: 'Application received',
    description: 'Sent to an applicant right after they apply.',
    variables: ['firstName', 'orgName'],
    defaultSubject: 'Your application to {orgName} affiliate program',
    defaultHeading: 'Application received',
    defaultBody: 'Hi {firstName},\nThanks for applying to {orgName} affiliate program. We have received your application and will review it shortly.\nWe will email you as soon as a decision is made.',
  },
  {
    key: 'applicationApproved',
    label: 'Application approved',
    description: 'Sent to an affiliate when their application is approved.',
    variables: ['firstName', 'orgName', 'affiliateCode', 'portalUrl'],
    defaultSubject: 'You are approved. Welcome to {orgName} affiliate program',
    defaultHeading: 'Welcome aboard',
    defaultBody: 'Hi {firstName},\nGreat news - your application to {orgName} affiliate program has been approved.\nYour affiliate code is: {affiliateCode}\nLog in to your affiliate portal to get your links, track clicks, and monitor earnings.',
  },
  {
    key: 'applicationRejected',
    label: 'Application rejected',
    description: 'Sent to an applicant when their application is declined.',
    variables: ['firstName', 'orgName'],
    defaultSubject: 'Update on your {orgName} affiliate application',
    defaultHeading: 'Application update',
    defaultBody: 'Hi {firstName},\nThank you for your interest in {orgName} affiliate program.\nAfter reviewing your application, we are unable to approve it at this time. You are welcome to apply again in the future.',
  },
  {
    key: 'commissionApproved',
    label: 'Commission approved',
    description: 'Sent to an affiliate when a commission is approved.',
    variables: ['firstName', 'orgName', 'amount', 'currency', 'portalUrl'],
    defaultSubject: 'Commission approved - {amount} {currency}',
    defaultHeading: 'Commission approved',
    defaultBody: 'Hi {firstName},\nA commission of {amount} {currency} has been approved and added to your balance.\nLog in to your portal to view your earnings and request a payout.',
  },
  {
    key: 'payoutSent',
    label: 'Payout sent',
    description: 'Sent to an affiliate when a payout is processed.',
    variables: ['firstName', 'orgName', 'amount', 'currency', 'method', 'reference', 'portalUrl'],
    defaultSubject: 'Payout sent - {amount} {currency}',
    defaultHeading: 'Payout sent',
    defaultBody: 'Hi {firstName},\nYour payout of {amount} {currency} via {method} has been processed.\nPlease allow 1-5 business days for the funds to arrive.',
  },
  {
    key: 'newApplicationAlert',
    label: 'New application alert (to admin)',
    description: 'Sent to your team when a new affiliate applies.',
    variables: ['applicantName', 'applicantEmail', 'orgName', 'adminUrl'],
    defaultSubject: 'New affiliate application - {applicantName}',
    defaultHeading: 'New affiliate application',
    defaultBody: 'A new affiliate application has been submitted by {applicantName} ({applicantEmail}).\nOpen the dashboard to review it.',
  },
  {
    key: 'passwordReset',
    label: 'Password reset',
    description: 'Sent when a user requests a password reset.',
    variables: ['firstName', 'orgName', 'resetUrl', 'ttlMinutes'],
    defaultSubject: 'Reset your {orgName} password',
    defaultHeading: 'Reset your password',
    defaultBody: 'Hi {firstName},\nWe received a request to reset your password. Click the button below to choose a new one.\nIf you did not request this, you can safely ignore this email.',
  },
]

type OrgInfo = { settings: Record<string, any>; name: string }

@Injectable()
export class EmailTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private async orgInfo(orgId: string): Promise<OrgInfo> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { settings: true, name: true },
    })
    if (!org) throw new NotFoundException('Organization not found')
    return { settings: (org.settings ?? {}) as Record<string, any>, name: org.name }
  }

  async list(orgId: string) {
    const { settings } = await this.orgInfo(orgId)
    const overrides = T.overridesFromSettings(settings)
    return TEMPLATE_DEFS.map((d) => {
      const ov = overrides[d.key] ?? {}
      return {
        key: d.key,
        label: d.label,
        description: d.description,
        variables: d.variables,
        subject: ov.subject ?? d.defaultSubject,
        heading: ov.heading ?? d.defaultHeading,
        body: ov.body ?? d.defaultBody,
        defaultSubject: d.defaultSubject,
        defaultHeading: d.defaultHeading,
        defaultBody: d.defaultBody,
        isCustomized: Boolean(ov.subject || ov.heading || ov.body),
      }
    })
  }

  async update(orgId: string, key: string, dto: UpdateEmailTemplateDto) {
    const def = TEMPLATE_DEFS.find((d) => d.key === key)
    if (!def) throw new BadRequestException('Unknown template')
    const { settings } = await this.orgInfo(orgId)
    const emailTemplates: Record<string, any> = { ...(settings.emailTemplates ?? {}) }
    const entry: Record<string, string> = {}
    if (typeof dto.subject === 'string' && dto.subject.trim()) entry.subject = dto.subject
    if (typeof dto.heading === 'string' && dto.heading.trim()) entry.heading = dto.heading
    if (typeof dto.body === 'string' && dto.body.trim()) entry.body = dto.body
    if (Object.keys(entry).length === 0) delete emailTemplates[key]
    else emailTemplates[key] = entry
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: { ...settings, emailTemplates } },
    })
    return this.list(orgId)
  }

  async reset(orgId: string, key: string) {
    const def = TEMPLATE_DEFS.find((d) => d.key === key)
    if (!def) throw new BadRequestException('Unknown template')
    const { settings } = await this.orgInfo(orgId)
    const emailTemplates: Record<string, any> = { ...(settings.emailTemplates ?? {}) }
    delete emailTemplates[key]
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { settings: { ...settings, emailTemplates } },
    })
    return this.list(orgId)
  }

  async preview(orgId: string, key: string) {
    const def = TEMPLATE_DEFS.find((d) => d.key === key)
    if (!def) throw new BadRequestException('Unknown template')
    const { settings, name } = await this.orgInfo(orgId)
    const r = renderSample(key, name, settings)
    return { subject: r.subject, html: r.html }
  }
}

function renderSample(key: string, orgName: string, settings: unknown): { subject: string; html: string } {
  const portalUrl = 'https://app.example.com/portal'
  switch (key) {
    case 'emailLoginCode':
      return T.emailLoginCode({ orgName, firstName: 'Alex', code: '482913', ttlMinutes: 10, settings })
    case 'userInvite':
      return T.userInvite({ orgName, inviteUrl: 'https://app.example.com/accept-invite?token=sample', ttlDays: 7, settings })
    case 'applicationReceived':
      return T.applicationReceived({ orgName, firstName: 'Alex', settings })
    case 'applicationApproved':
      return T.applicationApproved({ orgName, firstName: 'Alex', affiliateCode: 'ALEX123', portalUrl, settings })
    case 'applicationRejected':
      return T.applicationRejected({ orgName, firstName: 'Alex', settings })
    case 'commissionApproved':
      return T.commissionApproved({ orgName, firstName: 'Alex', amount: '25.00', currency: 'USD', portalUrl, settings })
    case 'payoutSent':
      return T.payoutSent({ orgName, firstName: 'Alex', amount: '150.00', currency: 'USD', method: 'PayPal', reference: 'TX-12345', portalUrl, settings })
    case 'newApplicationAlert':
      return T.newApplicationAlert({ orgName, applicantName: 'Alex Doe', applicantEmail: 'alex@example.com', adminUrl: 'https://app.example.com/affiliates', settings })
    case 'passwordReset':
      return T.passwordReset({ orgName, firstName: 'Alex', resetUrl: 'https://app.example.com/reset?token=sample', ttlMinutes: 30, settings })
    default:
      throw new BadRequestException('Unknown template')
  }
}
