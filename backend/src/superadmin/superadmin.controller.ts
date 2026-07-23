import { Body, Controller, Delete, Get, Logger, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { SuperAdminGuard } from './superadmin.guard'
import { SuperAdminService } from './superadmin.service'
import { AssignPlanDto, CreatePlanDto, UpdatePlanDto, UpdateTenantStatusDto } from './dto/plan.dto'
import { CreateTenantDto } from './dto/tenant.dto'
import { AuditService } from '../audit/audit.service'
import { JwtPayload } from '../auth/jwt.strategy'
import { AuthService } from '../auth/auth.service'

/** Platform console. Every route requires a super admin. */
@Controller('admin')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SuperAdminController {
  private readonly logger = new Logger(SuperAdminController.name)

  constructor(
    private readonly svc: SuperAdminService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  private record(actor: JwtPayload, action: string, resourceType: string, resourceId?: string, newValue?: unknown) {
    return this.audit.log({
      organizationId: actor.organizationId,
      userId: actor.sub,
      action,
      resourceType,
      resourceId,
      newValue,
    })
  }

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
  async createPlan(@Body() dto: CreatePlanDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.createPlan(dto)
    await this.record(req.user, 'platform.plan.create', 'plan', result.id, { key: result.key, name: result.name })
    return result
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.svc.getPlan(id)
  }

  @Patch('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.updatePlan(id, dto)
    await this.record(req.user, 'platform.plan.update', 'plan', id, dto)
    return result
  }

  @Delete('plans/:id')
  async deletePlan(@Param('id') id: string, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.deletePlan(id)
    await this.record(req.user, 'platform.plan.delete_or_archive', 'plan', id, result)
    return result
  }

  // Tenants
  @Get('tenants')
  listTenants(@Query('search') search?: string) {
    return this.svc.listTenants(search)
  }

  @Post('tenants')
  async createTenant(@Body() dto: CreateTenantDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.createTenant(dto)
    await this.record(req.user, 'platform.tenant.create', 'organization', result.id, {
      name: result.name,
      slug: result.slug,
      ownerEmail: result.owner.email,
    })
    const shouldSendCode = dto.sendLoginCode !== false && !dto.ownerPassword
    let loginCodeSent = false
    let loginCodeWarning: string | null = null
    if (shouldSendCode) {
      try {
        await this.auth.requestEmailLoginCode({ email: result.owner.email, workspace: result.slug })
        loginCodeSent = true
      } catch (error) {
        loginCodeWarning = 'Organization was created, but the login-code email could not be sent. The owner can request a fresh code from the sign-in page.'
        this.logger.error(
          `Tenant ${result.id} created but owner login-code delivery failed`,
          error instanceof Error ? error.stack : String(error),
        )
      }
    }
    return { ...result, loginCodeSent, loginCodeWarning }
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.svc.getTenant(id)
  }

  @Patch('tenants/:id/plan')
  async assignPlan(@Param('id') id: string, @Body() dto: AssignPlanDto, @Req() req: { user: JwtPayload }) {
    const result = await this.svc.assignPlan(id, dto)
    await this.record(req.user, 'platform.tenant.assign_plan', 'organization', id, {
      planId: dto.planId,
      status: result.status,
      seats: result.seats,
    })
    return result
  }

  @Patch('tenants/:id/status')
  async setTenantStatus(@Param('id') id: string, @Body() dto: UpdateTenantStatusDto, @Req() req: { user: JwtPayload }) {
    const previous = await this.svc.getTenant(id)
    const result = await this.svc.setTenantStatus(id, dto)
    await this.record(req.user, 'platform.tenant.status_change', 'organization', id, {
      from: previous.status,
      to: result.status,
    })
    return result
  }
}
