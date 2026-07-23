import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { PermissionsGuard } from '../common/guards/permissions.guard'
import { RequirePermissions } from '../common/guards/permissions.decorator'
import { JwtPayload } from '../auth/jwt.strategy'
import { FraudService } from './fraud.service'
import { FeatureGuard } from '../entitlements/feature.guard'
import { RequireFeature } from '../entitlements/require-feature.decorator'

class FraudSettingsDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) reviewThreshold?: number
  @IsOptional() @IsInt() @Min(0) @Max(100) blockThreshold?: number
  @IsOptional() @IsInt() @Min(1) orderVelocityLimit?: number
  @IsOptional() @IsInt() @Min(1) orderVelocityWindowHours?: number
  @IsOptional() @IsInt() @Min(1) ipVelocityLimit?: number
  @IsOptional() @IsInt() @Min(1) ipVelocityWindowMinutes?: number
  @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('4', { each: true }) allowlistAffiliateIds?: string[]
}

class ReviewActionDto {
  @IsOptional() @IsString() @MaxLength(500) notes?: string
}

@Controller('fraud')
@UseGuards(JwtAuthGuard, PermissionsGuard, FeatureGuard)
@RequireFeature('fraudTools')
export class FraudController {
  constructor(private readonly fraud: FraudService) {}

  @Get('settings')
  @RequirePermissions('fraud.read')
  getSettings(@Req() req: { user: JwtPayload }) {
    return this.fraud.getSettings(req.user.organizationId)
  }

  @Patch('settings')
  @RequirePermissions('fraud.write')
  updateSettings(@Req() req: { user: JwtPayload }, @Body() dto: FraudSettingsDto) {
    return this.fraud.updateSettings(req.user.organizationId, dto)
  }

  @Get('reviews')
  @RequirePermissions('fraud.read')
  list(@Req() req: { user: JwtPayload }, @Query('status') status?: string) {
    return this.fraud.listReviews(req.user.organizationId, status)
  }

  @Post('reviews/:id/approve')
  @RequirePermissions('fraud.write')
  approve(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: ReviewActionDto,
  ) {
    return this.fraud.approve(req.user.organizationId, id, req.user.sub, dto.notes)
  }

  @Post('reviews/:id/reject')
  @RequirePermissions('fraud.write')
  reject(
    @Req() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: ReviewActionDto,
  ) {
    return this.fraud.reject(req.user.organizationId, id, req.user.sub, dto.notes)
  }
}
