import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { SuperAdminGuard } from './superadmin.guard'
import { SuperAdminService } from './superadmin.service'
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto, UpdateTenantStatusDto } from './dto/plan.dto'

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
  createPlan(@Body() dto: CreatePlanDto) {
    return this.svc.createPlan(dto)
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.svc.getPlan(id)
  }

  @Patch('plans/:id')
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.svc.updatePlan(id, dto)
  }

  @Delete('plans/:id')
  deletePlan(@Param('id') id: string) {
    return this.svc.deletePlan(id)
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
  assignPlan(@Param('id') id: string, @Body() dto: AssignPlanDto) {
    return this.svc.assignPlan(id, dto)
  }

  @Patch('tenants/:id/status')
  setTenantStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto) {
    return this.svc.setTenantStatus(id, dto)
  }
}
