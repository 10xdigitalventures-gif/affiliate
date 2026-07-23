import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomBytes } from 'crypto'
import { PrismaService } from '../prisma/prisma.service'
import { MailService } from '../mail/mail.service'
import { NotificationsService } from '../notifications/notifications.service'
import * as T from '../mail/templates'
import { ApplyDto } from './dto/apply.dto'
import { AuthService } from '../auth/auth.service'
import { EntitlementsService } from '../entitlements/entitlements.service'

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
    private readonly entitlements: EntitlementsService,
  ) {}

  private randomCode() {
    return randomBytes(4).toString('hex').toUpperCase()
  }

  private isUniqueConflict(error: unknown) {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
  }

  /** Public: submit an affiliate application for an org (by slug). */
  async apply(orgSlug: string, dto: ApplyDto) {
    const org = await this.prisma.organization.findUnique({ where: { slug: orgSlug } })
    if (!org) throw new NotFoundException('Organization not found')

    const settings = (org.settings ?? {}) as Record<string, unknown>
    if (settings.signupEnabled === false) {
      throw new BadRequestException('Affiliate signup is currently closed')
    }

    const email = dto.email.trim().toLowerCase()

    // Prevent duplicate pending or already-approved applications.
    const existing = await this.prisma.affiliateApplication.findFirst({
      where: { organizationId: org.id, email, status: { in: ['pending', 'approved'] } },
    })
    if (existing?.status === 'approved') {
      throw new BadRequestException('This email already has an approved affiliate application')
    }
    if (existing) throw new BadRequestException('An application with this email is already pending')

    let application
    try {
      application = await this.prisma.affiliateApplication.create({
        data: {
          organizationId: org.id,
          email,
          payload: { firstName: dto.firstName, lastName: dto.lastName, website: dto.website, message: dto.message },
          status: 'pending',
        },
      })
    } catch (error) {
      if (this.isUniqueConflict(error)) {
        throw new BadRequestException('An application with this email is already pending or approved')
      }
      throw error
    }

    const payload = (application.payload ?? {}) as Record<string, string>
    const firstName = payload.firstName ?? 'there'
    const orgName = org.name

    // Email applicant: received
    this.mail.send({ to: email, ...T.applicationReceived({ orgName, firstName, settings: org.settings }) })

    // Auto-approve: instantly create Affiliate
    if (settings.autoApprove === true) {
      const affiliate = await this.approvePendingApplication(application, org.id)
      return { autoApproved: true, affiliate }
    }

    const applicantName = `${firstName} ${payload.lastName ?? ''}`.trim()

    // Email admin (if MAIL_ADMIN_EMAIL set)
    const adminEmail = process.env.MAIL_ADMIN_EMAIL
    if (adminEmail) {
      this.mail.send({ to: adminEmail, ...T.newApplicationAlert({ orgName, applicantName, applicantEmail: email, adminUrl: `${this.mail.appUrl}/affiliates`, settings: org.settings }) })
    }

    // In-app: notify org admins who can manage affiliates
    this.notifications.notifyOrgAdmins(org.id, 'affiliates.write', {
      type: 'application.new',
      title: 'New affiliate application',
      body: `${applicantName} (${email}) applied to your program.`,
      data: { applicationId: application.id, email },
    }).catch(() => {})

    return { autoApproved: false, application: { id: application.id, status: 'pending' } }
  }

  /** Admin: list applications. */
  async list(organizationId: string, status?: string) {
    const validStatuses = new Set(['pending', 'approved', 'rejected'])
    if (status && !validStatuses.has(status)) throw new BadRequestException('Invalid application status')
    return this.prisma.affiliateApplication.findMany({
      where: { organizationId, ...(status ? { status: status as any } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
  }

  /** Admin: approve application -> create Affiliate record. */
  async approve(organizationId: string, id: string, approvedByUserId?: string) {
    const app = await this.prisma.affiliateApplication.findFirst({ where: { id, organizationId } })
    if (!app) throw new NotFoundException('Application not found')
    if (app.status !== 'pending') throw new BadRequestException(`Application is already ${app.status}`)

    const affiliate = await this.approvePendingApplication(app, organizationId, approvedByUserId)
    return { affiliate }
  }

  /** Admin: reject application. */
  async reject(organizationId: string, id: string) {
    const app = await this.prisma.affiliateApplication.findFirst({ where: { id, organizationId } })
    if (!app) throw new NotFoundException('Application not found')
    if (app.status !== 'pending') throw new BadRequestException(`Application is already ${app.status}`)

    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const payload = (app.payload ?? {}) as Record<string, string>
    const claimed = await this.prisma.affiliateApplication.updateMany({
      where: { id, organizationId, status: 'pending' },
      data: { status: 'rejected' },
    })
    if (claimed.count !== 1) throw new BadRequestException('Application was already reviewed')
    this.mail.send({
      to: app.email,
      ...T.applicationRejected({ orgName: org?.name ?? 'Us', firstName: payload.firstName ?? 'there', settings: org?.settings ?? null }),
    })
    return this.prisma.affiliateApplication.findUnique({ where: { id } })
  }

  private async approvePendingApplication(
    app: { id: string; email: string; payload: unknown },
    organizationId: string,
    approvedByUserId?: string,
  ) {
    const claimed = await this.prisma.affiliateApplication.updateMany({
      where: { id: app.id, organizationId, status: 'pending' },
      data: { status: 'approved', reviewedBy: approvedByUserId },
    })
    if (claimed.count !== 1) throw new BadRequestException('Application was already reviewed')

    try {
      const affiliate = await this._createAffiliateFromApplication(app, organizationId)
      await this._provisionPortalAccess(app, affiliate, organizationId, approvedByUserId)
      return affiliate
    } catch (error) {
      // Return the application to a retryable state when capacity, provisioning
      // or another dependency fails after the atomic review claim.
      await this.prisma.affiliateApplication.updateMany({
        where: { id: app.id, organizationId, status: 'approved' },
        data: { status: 'pending', reviewedBy: null },
      }).catch(() => undefined)
      throw error
    }
  }

  private async _createAffiliateFromApplication(
    app: { id: string; email: string; payload: unknown },
    organizationId: string,
  ) {
    await this.entitlements.assertWithinLimit(organizationId, 'affiliates')
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = this.randomCode()
      try {
        return await this.prisma.affiliate.create({
          data: {
            organizationId,
            affiliateCode: code,
            referralSlug: code.toLowerCase(),
            status: 'approved',
          },
        })
      } catch (error) {
        if (!this.isUniqueConflict(error) || attempt === 4) throw error
      }
    }
    throw new BadRequestException('Could not allocate a unique affiliate code')
  }

  private async _provisionPortalAccess(
    app: { id: string; email: string; payload: unknown },
    affiliate: { id: string; affiliateCode: string },
    organizationId: string,
    invitedByUserId?: string,
  ) {
    const payload = (app.payload ?? {}) as Record<string, string>
    const firstName = payload.firstName?.trim() || 'there'
    const fullName = `${payload.firstName ?? ''} ${payload.lastName ?? ''}`.trim() || undefined

    try {
      await this.auth.provisionAffiliateAccess({
        affiliateId: affiliate.id,
        affiliateCode: affiliate.affiliateCode,
        organizationId,
        email: app.email,
        fullName,
        firstName,
        invitedByUserId,
      })
    } catch (error) {
      // Keep a failed approval retryable instead of leaving an orphan affiliate.
      await this.prisma.affiliate.delete({ where: { id: affiliate.id } }).catch(() => undefined)
      throw error
    }
  }
}
