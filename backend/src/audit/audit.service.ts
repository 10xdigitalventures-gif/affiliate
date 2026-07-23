import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export interface AuditLogArgs {
  organizationId: string
  userId?: string | null
  action: string
  resourceType?: string
  resourceId?: string
  oldValue?: unknown
  newValue?: unknown
  ipAddress?: string
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(args: AuditLogArgs) {
    return this.prisma.auditLog.create({
      data: {
        organizationId: args.organizationId,
        userId: args.userId,
        action: args.action,
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        oldValue: (args.oldValue ?? undefined) as any,
        newValue: (args.newValue ?? undefined) as any,
        ipAddress: args.ipAddress,
      },
    })
  }

  async list(organizationId: string, limit = 100) {
    return this.prisma.auditLog.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })
  }
}
