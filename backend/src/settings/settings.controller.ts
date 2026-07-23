import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { SettingsService } from './settings.service'
import { SignupSettingsDto } from './dto/signup-settings.dto'
import { SubAffiliateSettingsDto } from './dto/sub-affiliate-settings.dto'
import { AttributionSettingsDto } from './dto/attribution-settings.dto'
import { NotificationSettingsDto } from './dto/notification-settings.dto'
import { CommissionChannelSettingsDto } from './dto/commission-channel-settings.dto'
import { CustomerTypeSettingsDto } from './dto/customer-type-settings.dto'
import { SsoSettingsDto } from './dto/sso-settings.dto'
import { JwtPayload } from '../auth/jwt.strategy'
import { FeatureGuard } from '../entitlements/feature.guard'
import { RequireFeature } from '../entitlements/require-feature.decorator'

@Controller('settings')
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('signup')
  @RequirePermissions('settings.write')
  getSignup(@Req() req: { user: JwtPayload }) {
    return this.settings.getSignupSettings(req.user.organizationId)
  }

  @Patch('signup')
  @RequirePermissions('settings.write')
  updateSignup(@Req() req: { user: JwtPayload }, @Body() dto: SignupSettingsDto) {
    return this.settings.updateSignupSettings(req.user.organizationId, dto)
  }

  @Get('sub-affiliate')
  @RequireFeature('multiTierCommissions')
  @RequirePermissions('settings.write')
  getSubAffiliate(@Req() req: { user: JwtPayload }) {
    return this.settings.getSubAffiliateSettings(req.user.organizationId)
  }

  @Patch('sub-affiliate')
  @RequireFeature('multiTierCommissions')
  @RequirePermissions('settings.write')
  updateSubAffiliate(@Req() req: { user: JwtPayload }, @Body() dto: SubAffiliateSettingsDto) {
    return this.settings.updateSubAffiliateSettings(req.user.organizationId, dto)
  }

  @Get('attribution')
  @RequirePermissions('settings.write')
  getAttribution(@Req() req: { user: JwtPayload }) {
    return this.settings.getAttributionSettings(req.user.organizationId)
  }

  @Patch('attribution')
  @RequirePermissions('settings.write')
  updateAttribution(@Req() req: { user: JwtPayload }, @Body() dto: AttributionSettingsDto) {
    return this.settings.updateAttributionSettings(req.user.organizationId, dto)
  }

  @Get('notifications')
  @RequirePermissions('settings.write')
  getNotifications(@Req() req: { user: JwtPayload }) {
    return this.settings.getNotificationSettings(req.user.organizationId)
  }

  @Patch('notifications')
  @RequirePermissions('settings.write')
  updateNotifications(@Req() req: { user: JwtPayload }, @Body() dto: NotificationSettingsDto) {
    return this.settings.updateNotificationSettings(req.user.organizationId, dto)
  }

  @Get('commission-channel')
  @RequirePermissions('settings.write')
  getCommissionChannel(@Req() req: { user: JwtPayload }) {
    return this.settings.getCommissionChannelSettings(req.user.organizationId)
  }

  @Patch('commission-channel')
  @RequirePermissions('settings.write')
  updateCommissionChannel(@Req() req: { user: JwtPayload }, @Body() dto: CommissionChannelSettingsDto) {
    return this.settings.updateCommissionChannelSettings(req.user.organizationId, dto)
  }

  @Get('customer-type')
  @RequirePermissions('settings.write')
  getCustomerType(@Req() req: { user: JwtPayload }) {
    return this.settings.getCustomerTypeSettings(req.user.organizationId)
  }

  @Patch('customer-type')
  @RequirePermissions('settings.write')
  updateCustomerType(@Req() req: { user: JwtPayload }, @Body() dto: CustomerTypeSettingsDto) {
    return this.settings.updateCustomerTypeSettings(req.user.organizationId, dto)
  }

  @Get('sso')
  @RequireFeature('enterpriseSso')
  @RequirePermissions('settings.write')
  getSso(@Req() req: { user: JwtPayload }) {
    return this.settings.getSsoSettings(req.user.organizationId)
  }

  @Patch('sso')
  @RequireFeature('enterpriseSso')
  @RequirePermissions('settings.write')
  updateSso(@Req() req: { user: JwtPayload }, @Body() dto: SsoSettingsDto) {
    return this.settings.updateSsoSettings(req.user.organizationId, dto)
  }
}
