import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { EntitlementsService } from '../entitlements/entitlements.service'
import { CreateTeamRoleDto, UpdateTeamMemberDto, UpdateTeamRoleDto } from './dto/team.dto'

@Injectable()
export class TeamService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  listMembers(organizationId: string) {
    return this.prisma.user.findMany({
      where: {
        organizationId,
        OR: [{ affiliate: null }, { roles: { some: {} } }],
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        status: true,
        isSuperAdmin: true,
        lastLoginAt: true,
        createdAt: true,
        roles: {
          select: {
            role: {
              select: { id: true, name: true, isSystem: true, organizationId: true },
            },
          },
        },
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
    })
  }

  listRoles(organizationId: string) {
    return this.prisma.role.findMany({
      where: { OR: [{ organizationId }, { organizationId: null }] },
      include: {
        permissions: { include: { permission: true } },
        // System roles are shared definitions. Filter their relation counts so
        // a tenant cannot infer how many users/invites exist in other tenants.
        _count: {
          select: {
            users: { where: { user: { organizationId } } },
            invitations: { where: { organizationId, acceptedAt: null } },
          },
        },
      },
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
    })
  }

  listPermissions() {
    return this.prisma.permission.findMany({ orderBy: { key: 'asc' } })
  }

  listInvitations(organizationId: string) {
    return this.prisma.invitation.findMany({
      where: { organizationId, acceptedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        email: true,
        expiresAt: true,
        createdAt: true,
        invitedByUserId: true,
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  }

  async createRole(
    organizationId: string,
    actorUserId: string,
    dto: CreateTeamRoleDto,
    ipAddress?: string,
  ) {
    const name = dto.name.trim()
    await this.assertRoleNameAvailable(organizationId, name)
    const permissions = await this.resolvePermissions(dto.permissionKeys)
    const role = await this.prisma.role.create({
      data: {
        organizationId,
        name,
        permissions: {
          create: permissions.map((permission) => ({ permissionId: permission.id })),
        },
      },
      include: { permissions: { include: { permission: true } } },
    })
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'team.role.created',
      resourceType: 'Role',
      resourceId: role.id,
      newValue: { name: role.name, permissionKeys: permissions.map((item) => item.key) },
      ipAddress,
    })
    return role
  }

  async updateRole(
    organizationId: string,
    actorUserId: string,
    roleId: string,
    dto: UpdateTeamRoleDto,
    ipAddress?: string,
  ) {
    const existing = await this.mutableRole(organizationId, roleId)
    const name = dto.name?.trim()
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertRoleNameAvailable(organizationId, name, roleId)
    }
    const permissions = dto.permissionKeys === undefined
      ? null
      : await this.resolvePermissions(dto.permissionKeys)

    const role = await this.prisma.$transaction(async (tx) => {
      if (permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId } })
        if (permissions.length > 0) {
          await tx.rolePermission.createMany({
            data: permissions.map((permission) => ({ roleId, permissionId: permission.id })),
            skipDuplicates: true,
          })
        }
      }
      return tx.role.update({
        where: { id: roleId },
        data: name ? { name } : {},
        include: { permissions: { include: { permission: true } } },
      })
    })
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'team.role.updated',
      resourceType: 'Role',
      resourceId: role.id,
      oldValue: {
        name: existing.name,
        permissionKeys: existing.permissions.map((item) => item.permission.key),
      },
      newValue: {
        name: role.name,
        permissionKeys: role.permissions.map((item) => item.permission.key),
      },
      ipAddress,
    })
    return role
  }

  async deleteRole(organizationId: string, actorUserId: string, roleId: string, ipAddress?: string) {
    const existing = await this.mutableRole(organizationId, roleId)
    const [members, invitations] = await Promise.all([
      this.prisma.userRole.count({ where: { roleId } }),
      this.prisma.invitation.count({ where: { roleId, acceptedAt: null } }),
    ])
    if (members > 0 || invitations > 0) {
      throw new ConflictException('Remove this role from members and pending invitations before deleting it')
    }
    await this.prisma.role.delete({ where: { id: roleId } })
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'team.role.deleted',
      resourceType: 'Role',
      resourceId: roleId,
      oldValue: { name: existing.name },
      ipAddress,
    })
    return { ok: true }
  }

  async updateMember(
    organizationId: string,
    actorUserId: string,
    memberId: string,
    dto: UpdateTeamMemberDto,
    ipAddress?: string,
  ) {
    if (actorUserId === memberId) {
      throw new ForbiddenException('You cannot change your own roles or suspend your own account')
    }
    if (dto.roleIds === undefined && dto.status === undefined) {
      throw new BadRequestException('No team member changes were supplied')
    }
    const member = await this.prisma.user.findFirst({
      where: { id: memberId, organizationId },
      include: { roles: { include: { role: true } }, affiliate: true },
    })
    if (!member) throw new NotFoundException('Team member not found')
    if (member.isSuperAdmin) throw new ForbiddenException('Platform administrators cannot be changed here')

    let roles: Array<{ id: string; name: string }> | null = null
    if (dto.roleIds !== undefined) {
      if (dto.roleIds.length === 0) throw new BadRequestException('At least one role is required')
      roles = await this.prisma.role.findMany({
        where: { id: { in: dto.roleIds }, OR: [{ organizationId }, { organizationId: null }] },
        select: { id: true, name: true },
      })
      if (roles.length !== dto.roleIds.length) throw new BadRequestException('One or more roles are invalid')
    }

    if (dto.status === 'active' && member.status === 'suspended') {
      await this.entitlements.assertWithinLimit(organizationId, 'teamMembers')
    }

    await this.prisma.$transaction(async (tx) => {
      if (roles) {
        await tx.userRole.deleteMany({ where: { userId: memberId } })
        await tx.userRole.createMany({
          data: roles.map((role) => ({ userId: memberId, roleId: role.id })),
          skipDuplicates: true,
        })
      }
      if (dto.status) {
        await tx.user.update({ where: { id: memberId }, data: { status: dto.status } })
      }
      // Existing access JWTs are short-lived, and the strategy reloads live roles.
      // Refresh-token revocation forces a fresh login for any role/status change.
      await tx.refreshToken.updateMany({
        where: { userId: memberId, revokedAt: null },
        data: { revokedAt: new Date() },
      })
    })

    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: dto.status === 'suspended' ? 'team.member.suspended' : 'team.member.updated',
      resourceType: 'User',
      resourceId: memberId,
      oldValue: { status: member.status, roleIds: member.roles.map((item) => item.roleId) },
      newValue: { status: dto.status ?? member.status, roleIds: roles?.map((item) => item.id) ?? member.roles.map((item) => item.roleId) },
      ipAddress,
    })
    return this.memberById(organizationId, memberId)
  }

  async revokeInvitation(
    organizationId: string,
    actorUserId: string,
    invitationId: string,
    ipAddress?: string,
  ) {
    const invitation = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId, acceptedAt: null },
    })
    if (!invitation) throw new NotFoundException('Pending invitation not found')
    await this.prisma.$transaction(async (tx) => {
      await tx.invitation.delete({ where: { id: invitation.id } })
      const remaining = await tx.invitation.count({
        where: { organizationId, email: invitation.email, acceptedAt: null },
      })
      const placeholder = await tx.user.findFirst({
        where: {
          organizationId,
          email: invitation.email,
          status: 'invited',
          affiliate: null,
          roles: { none: {} },
        },
        select: { id: true },
      })
      if (remaining === 0 && placeholder) await tx.user.delete({ where: { id: placeholder.id } })
    })
    await this.audit.log({
      organizationId,
      userId: actorUserId,
      action: 'team.invitation.revoked',
      resourceType: 'Invitation',
      resourceId: invitationId,
      oldValue: { email: invitation.email, roleId: invitation.roleId },
      ipAddress,
    })
    return { ok: true }
  }

  private memberById(organizationId: string, memberId: string) {
    return this.prisma.user.findFirst({
      where: { id: memberId, organizationId },
      select: {
        id: true,
        email: true,
        fullName: true,
        avatarUrl: true,
        status: true,
        isSuperAdmin: true,
        lastLoginAt: true,
        createdAt: true,
        roles: { select: { role: { select: { id: true, name: true, isSystem: true, organizationId: true } } } },
      },
    })
  }

  private async mutableRole(organizationId: string, roleId: string) {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, organizationId },
      include: { permissions: { include: { permission: true } } },
    })
    if (!role) throw new NotFoundException('Role not found')
    if (role.isSystem) throw new ForbiddenException('System roles cannot be edited or deleted')
    return role
  }

  private async assertRoleNameAvailable(organizationId: string, name: string, excludeId?: string) {
    const existing = await this.prisma.role.findFirst({
      where: {
        organizationId,
        name: { equals: name, mode: 'insensitive' },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true },
    })
    if (existing) throw new ConflictException('A role with this name already exists')
  }

  private async resolvePermissions(keys: string[]) {
    const unique = [...new Set(keys.map((key) => key.trim()).filter(Boolean))]
    const permissions = await this.prisma.permission.findMany({ where: { key: { in: unique } } })
    if (permissions.length !== unique.length) throw new BadRequestException('One or more permissions are invalid')
    return permissions
  }
}
