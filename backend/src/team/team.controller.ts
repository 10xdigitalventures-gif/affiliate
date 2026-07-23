import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard, RequirePermissions } from '../common/guards/permissions.guard'
import { JwtPayload } from '../auth/jwt.strategy'
import { TeamService } from './team.service'
import { CreateTeamRoleDto, UpdateTeamMemberDto, UpdateTeamRoleDto } from './dto/team.dto'

@Controller('team')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('settings.write')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get('members')
  members(@Req() req: any) {
    return this.team.listMembers((req.user as JwtPayload).organizationId)
  }

  @Get('roles')
  roles(@Req() req: any) {
    return this.team.listRoles((req.user as JwtPayload).organizationId)
  }

  @Get('permissions')
  permissions() {
    return this.team.listPermissions()
  }

  @Get('invitations')
  invitations(@Req() req: any) {
    return this.team.listInvitations((req.user as JwtPayload).organizationId)
  }

  @Post('roles')
  createRole(@Body() dto: CreateTeamRoleDto, @Req() req: any) {
    const user = req.user as JwtPayload
    return this.team.createRole(user.organizationId, user.sub, dto, req.ip)
  }

  @Patch('roles/:id')
  updateRole(@Param('id') id: string, @Body() dto: UpdateTeamRoleDto, @Req() req: any) {
    const user = req.user as JwtPayload
    return this.team.updateRole(user.organizationId, user.sub, id, dto, req.ip)
  }

  @Delete('roles/:id')
  deleteRole(@Param('id') id: string, @Req() req: any) {
    const user = req.user as JwtPayload
    return this.team.deleteRole(user.organizationId, user.sub, id, req.ip)
  }

  @Patch('members/:id')
  updateMember(@Param('id') id: string, @Body() dto: UpdateTeamMemberDto, @Req() req: any) {
    const user = req.user as JwtPayload
    return this.team.updateMember(user.organizationId, user.sub, id, dto, req.ip)
  }

  @Delete('invitations/:id')
  revokeInvitation(@Param('id') id: string, @Req() req: any) {
    const user = req.user as JwtPayload
    return this.team.revokeInvitation(user.organizationId, user.sub, id, req.ip)
  }
}
