import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { SuperAdminGuard } from './superadmin.guard'
import { SuperAdminService } from './superadmin.service'
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto, UpdateTenantStatusDto } from './dto/plan.dto'
import { JwtPayload } from '../auth/jwt.strategy'

/** Platform console. Every route requires a super admin. */
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SuperAdminController {
  constructor(private readonly svc: SuperAdminService) {}

  @Get('overview')
  overview() {
    return this.svc.overview()
  }

  // Plans
  @Get('plans')
  listPlans() {
    return this.svc.listPlans()
  }

  @Post('plans')
  createPlan(@Body() dto: CreatePlanDto, @Req() req: any) {
    const actor = req.user as JwtPayload
    return this.svc.createPlan(dto, actor.sub)
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.svc.getPlan(id)
  }

  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto, @Req() req: any) {
    const actor = req.user as JwtPayload
    return this.svc.updatePlan(id, dto, actor.sub)
  }

  @Delete('plans/:id')
  deletePlan(@Param('id') id: string, @Req() req: any) {
    const actor = req.user as JwtPayload
    return this.svc.deletePlan(id, actor.sub)
  }

  // Tenants
  @Get('tenants')
  listTenants(@Query('search') search?: string) {
    return this.svc.listTenants(search)
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.svc.getTenant(id)
  }

  @Patch('tenants/:id/plan')
  assignPlan(@Param('id') id: string, @Body() dto: AssignPlanDto, @Req() req: any) {
    const actor = req.user as JwtPayload
    return this.svc.assignPlan(id, dto, actor.sub)
  }

  @Patch('tenants/:id/status')
  setTenantStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto, @Req() req: any) {
    const actor = req.user as JwtPayload
    return this.svc.setTenantStatus(id, dto, actor.sub)
  }
}
