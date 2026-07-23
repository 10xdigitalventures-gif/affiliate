import { Module } from '@nestjs/common'
import { BrandingService } from './branding.service'
import { BrandingController, PublicBrandingController } from './branding.controller'

@Module({
  controllers: [BrandingController, PublicBrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
