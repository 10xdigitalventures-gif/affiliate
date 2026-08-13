import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export type NotificationChannel = 'email' | 'in_app' | 'webhook'

export interface NotificationPrefs {
  inAppEnabled: boolean
  emailEnabled: boolean
}

const PREF_DEFAULTS: NotificationPrefs = { inAppEnabled: true, emailEnabled: true }

export interface RecordArgs {
  organizationId: string
  recipientUserId?: string | null
  type: string
  title: string
  body?: string
  data?: Record<string, unknown>
  channel?: NotificationChannel
}

export interface ListParams {
  unreadOnly?: boolean
  limit?: number
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name)

  constructor(private readonly prisma: PrismaService) {}

  /** Read an org's notification preferences (falls back to defaults). */
  async prefs(organizationId: string): Promise<NotificationPrefs> {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } })
    const s = ((org?.settings ?? {}) as Record<string, unknown>).notifications as Record<string, unknown> | undefined
    return {
      inAppEnabled: s?.inAppEnabled !== undefined ? Boolean(s.inAppEnabled) : PREF_DEFAULTS.inAppEnabled,
      emailEnabled: s?.emailEnabled !== undefined ? Boolean(s.emailEnabled) : PREF_DEFAULTS.emailEnabled,
    }
  }

  /** Low-level create. Never throws — notification failures must not break the caller. */
  async record(args: RecordArgs) {
    try {
      return await this.prisma.notification.create({
        data: {
          organizationId: args.organizationId,
          recipientUserId: args.recipientUserId ?? null,
          type: args.type,
          channel: (args.channel ?? 'in_app') as any,
          title: args.title,
          body: args.body ?? null,
          data: (args.data ?? undefined) as any,
        },
      })
    } catch (err) {
      this.logger.error(`Failed to record notification (${args.type}): ${(err as Error).message}`)
      return null
    }
  }

  /** Notify a single user in-app (respects the org's inAppEnabled preference). */
  async notifyUser(
    organizationId: string,
    recipientUserId: string | null | undefined,
    args: { type: string; title: string; body?: string; data?: Record<string, unknown> },
  ) {
    if (!recipientUserId) return null
    const prefs = await this.prefs(organizationId)
    if (!prefs.inAppEnabled) return null
    return this.record({ organizationId, recipientUserId, ...args })
  }

  /** Notify every user in the org whose roles grant `permissionKey` (e.g. new-application alerts). */
  async notifyOrgAdmins(
    organizationId: string,
    permissionKey: string,
    args: { type: string; title: string; body?: string; data?: Record<string, unknown> },
  ) {
    const prefs = await this.prefs(organizationId)
    if (!prefs.inAppEnabled) return 0
    const admins = await this.prisma.user.findMany({
      where: {
        organizationId,
        roles: { some: { role: { permissions: { some: { permission: { key: permissionKey } } } } } },
      },
      select: { id: true },
    })
    if (admins.length === 0) return 0
    await this.prisma.notification.createMany({
      data: admins.map((u) => ({
        organizationId,
        recipientUserId: u.id,
        type: args.type,
        channel: 'in_app' as any,
        title: args.title,
        body: args.body ?? null,
        data: (args.data ?? undefined) as any,
      })),
    })
    return admins.length
  }

  async list(organizationId: string, userId: string, params: ListParams = {}) {
    const where: any = { organizationId, recipientUserId: userId }
    if (params.unreadOnly) where.readAt = null
    return this.prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(params.limit ?? 50, 200),
    })
  }

  async unreadCount(organizationId: string, userId: string) {
    const count = await this.prisma.notification.count({
      where: { organizationId, recipientUserId: userId, readAt: null },
    })
    return { count }
  }

  async markRead(organizationId: string, userId: string, id: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { id, organizationId, recipientUserId: userId },
    })
    if (!existing) throw new NotFoundException('Notification not found')
    if (existing.readAt) return existing
    return this.prisma.notification.update({ where: { id }, data: { readAt: new Date() } })
  }

  async markAllRead(organizationId: string, userId: string) {
    const res = await this.prisma.notification.updateMany({
      where: { organizationId, recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    })
    return { updated: res.count }
  }
}
