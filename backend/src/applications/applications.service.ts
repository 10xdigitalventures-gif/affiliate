import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { NotificationsService } from '../notifications/notifications.service'
import * as T from '../mail/templates'
import { ApplyDto } from './dto/apply.dto'

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
  ) {}

  private randomCode() {
    return Math.random().toString(36).slice(2, 8).toUpperCase()
  }

  /** Public: submit an affiliate application for an org (by slug). */
  async apply(orgSlug: string, dto: ApplyDto) {
    const org = await this.prisma.organization.findUnique({ where: { slug: orgSlug } })
    if (!org) throw new NotFoundException('Organization not found')

    const settings = (org.settings ?? {}) as Record<string, unknown>
    if (settings.signupEnabled === false) {
      throw new BadRequestException('Affiliate signup is currently closed')
    }

    // Prevent duplicate applications
    const existing = await this.prisma.affiliateApplication.findFirst({
      where: { organizationId: org.id, email: dto.email, status: 'pending' },
    })
    if (existing) throw new BadRequestException('An application with this email is already pending')

    const application = await this.prisma.affiliateApplication.create({
      data: {
        organizationId: org.id,
        email: dto.email,
        payload: { firstName: dto.firstName, lastName: dto.lastName, website: dto.website, message: dto.message },
        status: 'pending',
      },
    })

    const payload = (application.payload ?? {}) as Record<string, string>
    const firstName = payload.firstName ?? 'there'
    const orgName = org.name

    // Email applicant: received
    this.mail.send({ to: dto.email, ...T.applicationReceived({ orgName, firstName, settings: org.settings }) })

    // Auto-approve: instantly create Affiliate
    if (settings.autoApprove === true) {
      const affiliate = await this._createAffiliateFromApplication(application, org.id)
      await this.prisma.affiliateApplication.update({ where: { id: application.id }, data: { status: 'approved' } })
      // Email: approved
      this.mail.send({ to: dto.email, ...T.applicationApproved({ orgName, firstName, affiliateCode: affiliate.affiliateCode, portalUrl: `${this.mail.appUrl}/portal`, settings: org.settings }) })
      return { autoApproved: true, affiliate }
    }

    const applicantName = `${firstName} ${payload.lastName ?? ''}`.trim()

    // Email admin (if MAIL_ADMIN_EMAIL set)
    const adminEmail = process.env.MAIL_ADMIN_EMAIL
    if (adminEmail) {
      this.mail.send({ to: adminEmail, ...T.newApplicationAlert({ orgName, applicantName, applicantEmail: dto.email, adminUrl: `${this.mail.appUrl}/affiliates`, settings: org.settings }) })
    }

    // In-app: notify org admins who can manage affiliates
    this.notifications.notifyOrgAdmins(org.id, 'affiliates.write', {
      type: 'application.new',
      title: 'New affiliate application',
      body: `${applicantName} (${dto.email}) applied to your program.`,
      data: { applicationId: application.id, email: dto.email },
    }).catch(() => {})

    return { autoApproved: false, application: { id: application.id, status: 'pending' } }
  }

  /** Admin: list applications. */
  async list(organizationId: string, status?: string) {
    return this.prisma.affiliateApplication.findMany({
      where: { organizationId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  /** Admin: approve application -> create Affiliate record. */
  async approve(organizationId: string, id: string) {
    const app = await this.prisma.affiliateApplication.findFirst({ where: { id, organizationId } })
    if (!app) throw new NotFoundException('Application not found')
    if (app.status !== 'pending') throw new BadRequestException(`Application is already ${app.status}`)

    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const affiliate = await this._createAffiliateFromApplication(app, organizationId)
    await this.prisma.affiliateApplication.update({ where: { id }, data: { status: 'approved' } })

    const payload = (app.payload ?? {}) as Record<string, string>
    const firstName = payload.firstName ?? 'there'
    this.mail.send({
      to: app.email,
      ...T.applicationApproved({
        orgName: org?.name ?? 'Us',
        firstName,
        affiliateCode: affiliate.affiliateCode,
        portalUrl: `${this.mail.appUrl}/portal`,
        settings: org?.settings ?? null,
      }),
    })
    return { affiliate }
  }

  /** Admin: reject application. */
  async reject(organizationId: string, id: string) {
    const app = await this.prisma.affiliateApplication.findFirst({ where: { id, organizationId } })
    if (!app) throw new NotFoundException('Application not found')
    if (app.status !== 'pending') throw new BadRequestException(`Application is already ${app.status}`)

    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const payload = (app.payload ?? {}) as Record<string, string>
    this.mail.send({
      to: app.email,
      ...T.applicationRejected({ orgName: org?.name ?? 'Us', firstName: payload.firstName ?? 'there', settings: org?.settings ?? null }),
    })
    return this.prisma.affiliateApplication.update({ where: { id }, data: { status: 'rejected' } })
  }

  private async _createAffiliateFromApplication(
    app: { id: string; email: string; payload: unknown },
    organizationId: string,
  ) {
    const payload = (app.payload ?? {}) as Record<string, string>
    const code = this.randomCode()
    return this.prisma.affiliate.create({
      data: {
        organizationId,
        affiliateCode: code,
        referralSlug: code.toLowerCase(),
        status: 'approved',
      },
    })
  }
}
