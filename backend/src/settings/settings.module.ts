import { Module } from '@nestjs/common'
import { SettingsService } from './settings.service'
import { SettingsController } from './settings.controller'
import { PrismaModule } from '../prisma/prisma.module'
import { AttributionModule } from '../attribution/attribution.module'

@Module({
  imports: [PrismaModule, AttributionModule],
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
