import { Module } from '@nestjs/common'
import { SignupController } from './signup.controller'
import { ApplicationsModule } from '../applications/applications.module'
import { SettingsModule } from '../settings/settings.module'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule, ApplicationsModule, SettingsModule],
  controllers: [SignupController],
})
export class SignupModule {}
